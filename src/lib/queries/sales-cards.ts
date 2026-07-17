import { getPool, sql } from "@/lib/db";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import type { DateRangeFilter, PartnerType } from "@/types/dashboard";

// Kemasan classification: item names containing "5 KG" are 5KG kantong,
// everything else ("Es Tube", "Es Tube Jual", "Es Tube Bonus", "Es Contoh",
// "Es Tube Afiliasi") is 10KG — verified against live item names.
const KEMASAN_5KG = (col: string) => `CASE WHEN ${col} LIKE '%5 KG%' THEN 1 ELSE 0 END`;

/** Strips the "MKE/SI/" or "MKE/SP/" prefix, per the transaction-card reference design. */
export function shortenVoucher(voucherNo: string | null, prefix: string): string | null {
  if (!voucherNo) return null;
  return voucherNo.startsWith(prefix) ? voucherNo.slice(prefix.length) : voucherNo;
}

export interface SalesOrderCard {
  SalesOrderID: string;
  VoucherNo: string;
  TransDate: string;
  BusinessPartnerID: string;
  CustomerName: string;
  PartnerType: PartnerType;
  Wilayah: string;
  Kecamatan: string | null;
  Qty10KG: number;
  Qty5KG: number;
}

export async function getSalesOrderCards(filter: DateRangeFilter): Promise<SalesOrderCard[]> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);
  if (filter.wilayah) request.input("wilayah", sql.VarChar(128), filter.wilayah);

  const result = await request.query(`
    SELECT
        so.SalesOrderID,
        so.VoucherNo,
        so.TransDate,
        bp.BusinessPartnerID,
        bp.Name AS CustomerName,
        ${PARTNER_TYPE_CASE} AS PartnerType,
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        bp.NPWPAddress AS Kecamatan,
        ISNULL(SUM(CASE WHEN ${KEMASAN_5KG("sod.Name")} = 0 THEN sod.Qty ELSE 0 END), 0) AS Qty10KG,
        ISNULL(SUM(CASE WHEN ${KEMASAN_5KG("sod.Name")} = 1 THEN sod.Qty ELSE 0 END), 0) AS Qty5KG
    FROM SalesOrder so
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
    WHERE so.IsDeleted = 0
      AND so.TransDate >= @startDate AND so.TransDate < @endDate
      ${filter.wilayah ? "AND bp.NPWPName = @wilayah" : ""}
    GROUP BY so.SalesOrderID, so.VoucherNo, so.TransDate, bp.BusinessPartnerID, bp.Name,
             bp.NPWPName, bp.NPWPAddress, bp.SalesmanID, bp.Gender
    ORDER BY so.TransDate DESC
  `);

  return result.recordset;
}

export type BillingStatus = "SudahDitagih" | "BelumDitagih";
export type PaymentStatus = "Lunas" | "BelumLunas" | null;

export interface DeliveryCard {
  DeliveryOrderID: string;
  SalesOrderID: string;
  VoucherNo: string;
  TransDate: string;
  Driver: string | null;
  VehicleNo: string | null;
  Qty10KG: number;
  Qty5KG: number;
  BillingStatus: BillingStatus;
  SIVoucherNo: string | null;
  PaymentStatus: PaymentStatus;
  SPVoucherNo: string | null;
}

export async function getDeliveryCardsForOrders(salesOrderIds: string[]): Promise<DeliveryCard[]> {
  if (salesOrderIds.length === 0) return [];
  const pool = await getPool();
  const request = pool.request();
  const placeholders = salesOrderIds.map((id, i) => {
    request.input(`so${i}`, sql.VarChar(16), id);
    return `@so${i}`;
  });

  const result = await request.query(`
    SELECT
        do_.DeliveryOrderID,
        do_.SalesOrderID,
        do_.VoucherNo,
        do_.TransDate,
        do_.PIC AS Driver,
        do_.VehicleNo,
        ISNULL(SUM(CASE WHEN ${KEMASAN_5KG("dod.Name")} = 0 THEN dod.Delivered ELSE 0 END), 0) AS Qty10KG,
        ISNULL(SUM(CASE WHEN ${KEMASAN_5KG("dod.Name")} = 1 THEN dod.Delivered ELSE 0 END), 0) AS Qty5KG,
        si.VoucherNo AS SIVoucherNo,
        si.Netto AS SINetto,
        si.Paid AS SIPaid,
        sp.VoucherNo AS SPVoucherNo
    FROM DeliveryOrder do_
    LEFT JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
    -- SalesInvoice.DeliveryOrderID is stored with literal single-quote
    -- characters around the id (e.g. "'01185115'" instead of "01185115"),
    -- verified against live data — strip them before joining or this never
    -- matches and every delivery looks perpetually unbilled.
    LEFT JOIN SalesInvoice si ON REPLACE(si.DeliveryOrderID, '''', '') = do_.DeliveryOrderID AND si.IsDeleted = 0
    OUTER APPLY (
        SELECT TOP 1 sp2.VoucherNo
        FROM SalesPaymentDetail spd
        JOIN SalesPayment sp2 ON sp2.SalesPaymentID = spd.SalesPaymentID AND sp2.IsDeleted = 0
        WHERE spd.SalesInvoiceID = si.SalesInvoiceID AND spd.IsDeleted = 0
        ORDER BY sp2.TransDate DESC
    ) sp
    WHERE do_.IsDeleted = 0
      AND do_.SalesOrderID IN (${placeholders.join(",")})
    GROUP BY do_.DeliveryOrderID, do_.SalesOrderID, do_.VoucherNo, do_.TransDate, do_.PIC, do_.VehicleNo,
             si.VoucherNo, si.Netto, si.Paid, sp.VoucherNo
    ORDER BY do_.TransDate ASC
  `);

  return result.recordset.map((row) => {
    const hasInvoice = !!row.SIVoucherNo;
    const isPaid = hasInvoice && row.SINetto > 0 && row.SIPaid >= row.SINetto;
    return {
      DeliveryOrderID: row.DeliveryOrderID,
      SalesOrderID: row.SalesOrderID,
      VoucherNo: row.VoucherNo,
      TransDate: row.TransDate,
      Driver: row.Driver,
      VehicleNo: row.VehicleNo,
      Qty10KG: row.Qty10KG,
      Qty5KG: row.Qty5KG,
      BillingStatus: hasInvoice ? "SudahDitagih" : "BelumDitagih",
      SIVoucherNo: shortenVoucher(row.SIVoucherNo, "MKE/SI/"),
      PaymentStatus: hasInvoice ? (isPaid ? "Lunas" : "BelumLunas") : null,
      SPVoucherNo: isPaid ? shortenVoucher(row.SPVoucherNo, "MKE/SP/") : null,
    };
  });
}
