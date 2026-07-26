import { getPool, sql } from "@/lib/db";
import { encodeIdToken, decodeIdToken, INVOICE_TOKEN_PURPOSE, PAYMENT_TOKEN_PURPOSE } from "@/lib/crypto-token";

// No `DashboardInvoicePublicLink` table, no per-invoice row to create —
// every Sales Invoice is reachable this way automatically, and the page
// always reflects live invoice/payment data instead of a snapshot.
export function encodeInvoiceToken(salesInvoiceId: string): string {
  return encodeIdToken(INVOICE_TOKEN_PURPOSE, salesInvoiceId);
}

function decodeInvoiceToken(token: string): string | null {
  return decodeIdToken(INVOICE_TOKEN_PURPOSE, token);
}

export interface PublicInvoiceLine {
  Name: string;
  Qty: number;
  Amount: number;
}

export interface PublicInvoiceSalesOrder {
  VoucherNo: string;
  TransDate: string | Date;
  Lines: PublicInvoiceLine[];
  Total: number;
}

export interface PublicDeliveryLine extends PublicInvoiceLine {
  Delivered: number;
}

export interface PublicInvoiceDelivery {
  VoucherNo: string;
  TransDate: string | Date;
  Driver: string | null;
  VehicleNo: string | null;
  // Only ever populated for deliveries scheduled through this dashboard's
  // Papan Pengiriman board (DashboardPengirimanJadwal) — null for the
  // overwhelming majority of historical/legacy deliveries. The ERP schema
  // has no "arrival at customer" or "received/verified by customer" field
  // anywhere, so that part of the narrative genuinely can't be shown.
  DepartureTime: string | Date | null;
  Lines: PublicDeliveryLine[];
  Total: number;
}

export interface PublicOtherInvoice {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string | Date;
  Outstanding: number;
  Token: string;
}

export interface PublicInvoice {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string | Date;
  DueDate: string | Date | null;
  Netto: number;
  CustomerName: string;
  // True once si.Paid covers si.Netto — this already reflects the ERP's own
  // payment accounting regardless of how many separate SalesPayment rows
  // (or a single payment spanning several invoices via SalesPaymentDetail)
  // contributed to it. Once true, the page shows a "sudah lunas" message
  // plus a link to the payment document instead of billing details.
  IsPaid: boolean;
  // Token for the SalesPayment that most recently paid this invoice — only
  // set once IsPaid, null otherwise (nothing to link to yet).
  PaymentToken: string | null;
  SalesOrder: PublicInvoiceSalesOrder | null;
  Delivery: PublicInvoiceDelivery | null;
  OtherOutstanding: PublicOtherInvoice[];
}

// Only ever selects columns already confirmed live elsewhere in this
// codebase (aging.ts, sales.ts, sales-cards.ts, pengiriman-jadwal.ts) — no
// column here is a guess. Always a live query, never a stored snapshot, so
// a token's rendered amount/paid-status/other-bills is always current as of
// the moment it's opened.
export async function getInvoiceByToken(token: string): Promise<PublicInvoice | null> {
  const salesInvoiceId = decodeInvoiceToken(token);
  if (!salesInvoiceId) return null;

  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesInvoiceId", sql.VarChar(16), salesInvoiceId).query(`
      SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate, si.DueDate, si.Netto, si.Paid,
             si.BusinessPartnerID, si.DeliveryOrderID, bp.Name AS CustomerName
      FROM SalesInvoice si
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
      WHERE si.SalesInvoiceID = @salesInvoiceId AND si.IsDeleted = 0
    `);
  const row = result.recordset[0] as
    | {
        SalesInvoiceID: string;
        VoucherNo: string;
        TransDate: string | Date;
        DueDate: string | Date | null;
        Netto: number;
        Paid: number;
        BusinessPartnerID: string | null;
        DeliveryOrderID: string | null;
        CustomerName: string;
      }
    | undefined;
  if (!row) return null;

  const isPaid = row.Netto > 0 && row.Paid >= row.Netto;
  // SalesInvoice.DeliveryOrderID is stored with literal single-quote
  // characters around it (e.g. "'01185115'"), same quirk sales-cards.ts
  // already works around.
  const deliveryOrderId = row.DeliveryOrderID ? row.DeliveryOrderID.replace(/'/g, "").trim() || null : null;

  const [salesOrder, delivery, otherOutstanding, paymentToken] = await Promise.all([
    deliveryOrderId ? getSalesOrderForDelivery(pool, deliveryOrderId) : Promise.resolve(null),
    deliveryOrderId ? getDeliveryDetail(pool, deliveryOrderId) : Promise.resolve(null),
    row.BusinessPartnerID
      ? getOtherOutstandingInvoices(pool, row.BusinessPartnerID, salesInvoiceId)
      : Promise.resolve([]),
    isPaid ? getMostRecentPaymentToken(pool, salesInvoiceId) : Promise.resolve(null),
  ]);

  return {
    SalesInvoiceID: row.SalesInvoiceID,
    VoucherNo: row.VoucherNo,
    TransDate: row.TransDate,
    DueDate: row.DueDate,
    Netto: row.Netto,
    CustomerName: row.CustomerName,
    IsPaid: isPaid,
    PaymentToken: paymentToken,
    SalesOrder: salesOrder,
    Delivery: delivery,
    OtherOutstanding: otherOutstanding,
  };
}

async function getDeliveryDetail(
  pool: Awaited<ReturnType<typeof getPool>>,
  deliveryOrderId: string
): Promise<PublicInvoiceDelivery | null> {
  const [headerResult, linesResult] = await Promise.all([
    pool
      .request()
      .input("deliveryOrderId", sql.VarChar(16), deliveryOrderId).query(`
        SELECT do_.VoucherNo, do_.TransDate, do_.PIC AS Driver, do_.VehicleNo, jad.JamAktualBerangkat
        FROM DeliveryOrder do_
        LEFT JOIN DashboardPengirimanJadwalDetail jadd
               ON jadd.DeliveryOrderID = do_.DeliveryOrderID AND jadd.IsDeleted = 0
        LEFT JOIN DashboardPengirimanJadwal jad ON jad.JadwalID = jadd.JadwalID
        WHERE do_.DeliveryOrderID = @deliveryOrderId AND do_.IsDeleted = 0
      `),
    pool
      .request()
      .input("deliveryOrderId", sql.VarChar(16), deliveryOrderId).query(`
        SELECT dod.Name, dod.Qty, dod.Delivered, dod.Amount
        FROM DeliveryOrderDetail dod
        WHERE dod.DeliveryOrderID = @deliveryOrderId
        ORDER BY dod.DeliveryOrderDetailID
      `),
  ]);
  const header = headerResult.recordset[0] as
    | { VoucherNo: string; TransDate: string | Date; Driver: string | null; VehicleNo: string | null; JamAktualBerangkat: string | Date | null }
    | undefined;
  if (!header) return null;

  const lines = linesResult.recordset as { Name: string; Qty: number; Delivered: number; Amount: number }[];
  return {
    VoucherNo: header.VoucherNo,
    TransDate: header.TransDate,
    Driver: header.Driver,
    VehicleNo: header.VehicleNo,
    DepartureTime: header.JamAktualBerangkat,
    Lines: lines,
    Total: lines.reduce((sum, l) => sum + l.Amount, 0),
  };
}

async function getSalesOrderForDelivery(
  pool: Awaited<ReturnType<typeof getPool>>,
  deliveryOrderId: string
): Promise<PublicInvoiceSalesOrder | null> {
  const soIdResult = await pool
    .request()
    .input("deliveryOrderId", sql.VarChar(16), deliveryOrderId)
    .query(`SELECT SalesOrderID FROM DeliveryOrder WHERE DeliveryOrderID = @deliveryOrderId AND IsDeleted = 0`);
  const salesOrderId = (soIdResult.recordset[0] as { SalesOrderID: string | null } | undefined)?.SalesOrderID;
  if (!salesOrderId) return null;

  const [headerResult, linesResult] = await Promise.all([
    pool
      .request()
      .input("salesOrderId", sql.VarChar(16), salesOrderId)
      .query(`SELECT VoucherNo, TransDate FROM SalesOrder WHERE SalesOrderID = @salesOrderId AND IsDeleted = 0`),
    pool
      .request()
      .input("salesOrderId", sql.VarChar(16), salesOrderId).query(`
        SELECT Name, Qty, Amount
        FROM SalesOrderDetail
        WHERE SalesOrderID = @salesOrderId
        ORDER BY SalesOrderDetailID
      `),
  ]);
  const header = headerResult.recordset[0] as { VoucherNo: string; TransDate: string | Date } | undefined;
  if (!header) return null;

  const lines = linesResult.recordset as { Name: string; Qty: number; Amount: number }[];
  return {
    VoucherNo: header.VoucherNo,
    TransDate: header.TransDate,
    Lines: lines,
    Total: lines.reduce((sum, l) => sum + l.Amount, 0),
  };
}

// Same vCustomerStatement-based Outstanding formula as aging.ts (the
// established "outstanding invoices" definition app-wide) — nets out
// Deposit/OtherPayment, not just Paid vs Netto.
async function getOtherOutstandingInvoices(
  pool: Awaited<ReturnType<typeof getPool>>,
  businessPartnerId: string,
  excludeSalesInvoiceId: string
): Promise<PublicOtherInvoice[]> {
  const result = await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), businessPartnerId)
    .input("excludeId", sql.VarChar(16), excludeSalesInvoiceId).query(`
      WITH CustomerBalance AS (
          SELECT SalesInvoiceID, SUM(Netto) AS Netto, SUM(Deposit) AS Deposit,
                 SUM(Paid) AS Paid, SUM(OtherPayment) AS OtherPayment
          FROM vCustomerStatement
          GROUP BY SalesInvoiceID
      )
      SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate,
             (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) AS Outstanding
      FROM CustomerBalance cb
      JOIN SalesInvoice si ON si.SalesInvoiceID = cb.SalesInvoiceID
      WHERE si.IsDeleted = 0
        AND si.BusinessPartnerID = @businessPartnerId
        AND si.SalesInvoiceID <> @excludeId
        AND (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) > 0
      ORDER BY si.TransDate DESC
    `);
  return (
    result.recordset as { SalesInvoiceID: string; VoucherNo: string; TransDate: string | Date; Outstanding: number }[]
  ).map((r) => ({
    SalesInvoiceID: r.SalesInvoiceID,
    VoucherNo: r.VoucherNo,
    TransDate: r.TransDate,
    Outstanding: r.Outstanding,
    Token: encodeInvoiceToken(r.SalesInvoiceID),
  }));
}

async function getMostRecentPaymentToken(
  pool: Awaited<ReturnType<typeof getPool>>,
  salesInvoiceId: string
): Promise<string | null> {
  const result = await pool
    .request()
    .input("salesInvoiceId", sql.VarChar(16), salesInvoiceId).query(`
      SELECT TOP 1 sp.SalesPaymentID
      FROM SalesPaymentDetail spd
      JOIN SalesPayment sp ON sp.SalesPaymentID = spd.SalesPaymentID AND sp.IsDeleted = 0
      WHERE spd.SalesInvoiceID = @salesInvoiceId AND spd.IsDeleted = 0
      ORDER BY sp.TransDate DESC
    `);
  const salesPaymentId = (result.recordset[0] as { SalesPaymentID: string } | undefined)?.SalesPaymentID;
  return salesPaymentId ? encodeIdToken(PAYMENT_TOKEN_PURPOSE, salesPaymentId) : null;
}
