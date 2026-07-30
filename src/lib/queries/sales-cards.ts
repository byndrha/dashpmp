import { getPool, sql } from "@/lib/db";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import { encodeInvoiceToken } from "@/lib/queries/invoice-public";
import type { DateRangeFilter, PartnerType } from "@/types/dashboard";

// Kemasan classification: item names containing "5 KG" are 5KG kantong,
// everything else ("Es Tube", "Es Tube Jual", "Es Tube Bonus", "Es Contoh",
// "Es Tube Afiliasi") is 10KG — verified against live item names.
const KEMASAN_5KG = (col: string) => `CASE WHEN ${col} LIKE '%5 KG%' THEN 1 ELSE 0 END`;

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
  // Both only populated once the underlying invoice is fully paid (same
  // "isPaid" convention as DeliveryCard.SPVoucherNo below) — for the Kartu
  // Transaksi export, an unpaid SO's SI/SP columns stay blank rather than
  // showing an invoice number that isn't settled yet. Resolved via the
  // SO's earliest DeliveryOrder — same 1:1-in-practice assumption already
  // relied on elsewhere in this file.
  SIVoucherNo: string | null;
  SPVoucherNo: string | null;
}

export async function getSalesOrderCards(filter: DateRangeFilter): Promise<SalesOrderCard[]> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);
  if (filter.wilayah) request.input("wilayah", sql.VarChar(128), filter.wilayah);

  const result = await request.query(`
    -- SI/SP rollup is done as set-based CTEs (not a per-row correlated
    -- OUTER APPLY chain) — the naive per-row version timed out scanning a
    -- whole date range's worth of SalesOrders, since it re-ran the
    -- REPLACE()-based SalesInvoice join (non-sargable, see
    -- getDeliveryCardsForOrders below) once per outer row instead of once
    -- total. DoRep is pre-scoped to only DeliveryOrders belonging to a SO
    -- in this date range (FilteredSO), keeping the DeliveryOrder/SalesInvoice
    -- scan small regardless of how wide the date range is.
    WITH FilteredSO AS (
        SELECT so_.SalesOrderID
        FROM SalesOrder so_
        LEFT JOIN BusinessPartner bp_ ON bp_.BusinessPartnerID = so_.BusinessPartnerID
        WHERE so_.IsDeleted = 0
          AND so_.TransDate >= @startDate AND so_.TransDate < @endDate
          ${filter.wilayah ? "AND bp_.NPWPName = @wilayah" : ""}
    ),
    DoRep AS (
        SELECT do_.SalesOrderID, do_.DeliveryOrderID,
               ROW_NUMBER() OVER (PARTITION BY do_.SalesOrderID ORDER BY do_.TransDate ASC) AS rn
        FROM DeliveryOrder do_
        JOIN FilteredSO f ON f.SalesOrderID = do_.SalesOrderID
        WHERE do_.IsDeleted = 0
    ),
    SiRep AS (
        -- SalesInvoice.DeliveryOrderID carries literal single-quote
        -- characters around the id — see getDeliveryCardsForOrders below.
        SELECT dr.SalesOrderID, si2.SalesInvoiceID, si2.VoucherNo AS SIVoucherNo, si2.Netto AS SINetto, si2.Paid AS SIPaid
        FROM DoRep dr
        JOIN SalesInvoice si2 ON REPLACE(si2.DeliveryOrderID, '''', '') = dr.DeliveryOrderID AND si2.IsDeleted = 0
        WHERE dr.rn = 1
    ),
    SpRep AS (
        SELECT sr.SalesOrderID, sp2.VoucherNo AS SPVoucherNo,
               ROW_NUMBER() OVER (PARTITION BY sr.SalesOrderID ORDER BY sp2.TransDate DESC) AS rn
        FROM SiRep sr
        JOIN SalesPaymentDetail spd ON spd.SalesInvoiceID = sr.SalesInvoiceID AND spd.IsDeleted = 0
        JOIN SalesPayment sp2 ON sp2.SalesPaymentID = spd.SalesPaymentID AND sp2.IsDeleted = 0
    )
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
        ISNULL(SUM(CASE WHEN ${KEMASAN_5KG("sod.Name")} = 1 THEN sod.Qty ELSE 0 END), 0) AS Qty5KG,
        si.SIVoucherNo,
        si.SINetto,
        si.SIPaid,
        sp.SPVoucherNo
    FROM SalesOrder so
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
    LEFT JOIN SiRep si ON si.SalesOrderID = so.SalesOrderID
    LEFT JOIN SpRep sp ON sp.SalesOrderID = so.SalesOrderID AND sp.rn = 1
    WHERE so.IsDeleted = 0
      AND so.TransDate >= @startDate AND so.TransDate < @endDate
      ${filter.wilayah ? "AND bp.NPWPName = @wilayah" : ""}
    GROUP BY so.SalesOrderID, so.VoucherNo, so.TransDate, bp.BusinessPartnerID, bp.Name,
             bp.NPWPName, bp.NPWPAddress, bp.SalesmanID, bp.Gender,
             si.SIVoucherNo, si.SINetto, si.SIPaid, sp.SPVoucherNo
    ORDER BY so.TransDate DESC
  `);

  return result.recordset.map((row) => {
    const isPaid = !!row.SIVoucherNo && row.SINetto > 0 && row.SIPaid >= row.SINetto;
    return {
      SalesOrderID: row.SalesOrderID,
      VoucherNo: row.VoucherNo,
      TransDate: row.TransDate,
      BusinessPartnerID: row.BusinessPartnerID,
      CustomerName: row.CustomerName,
      PartnerType: row.PartnerType,
      Wilayah: row.Wilayah,
      Kecamatan: row.Kecamatan,
      Qty10KG: row.Qty10KG,
      Qty5KG: row.Qty5KG,
      SIVoucherNo: isPaid ? row.SIVoucherNo : null,
      SPVoucherNo: isPaid ? row.SPVoucherNo : null,
    };
  });
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
  // Set whenever an SI exists, Lunas or not — the public page itself decides
  // (live, at request time) whether to show billing details or a "sudah
  // lunas" message, so the token stays valid to open either way.
  InvoiceToken: string | null;
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
        si.SalesInvoiceID,
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
             si.SalesInvoiceID, si.VoucherNo, si.Netto, si.Paid, sp.VoucherNo
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
      SIVoucherNo: row.SIVoucherNo,
      PaymentStatus: hasInvoice ? (isPaid ? "Lunas" : "BelumLunas") : null,
      SPVoucherNo: isPaid ? row.SPVoucherNo : null,
      InvoiceToken: hasInvoice ? encodeInvoiceToken(row.SalesInvoiceID) : null,
    };
  });
}
