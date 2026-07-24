import { getPool, sql } from "@/lib/db";
import type { PartnerType } from "@/types/dashboard";

export type AgingBucket =
  | "Belum Jatuh Tempo"
  | "1-30 Hari"
  | "31-60 Hari"
  | "61-90 Hari"
  | ">90 Hari";

export type PiutangStatus = "Sehat" | "Perhatian" | "Kritis";

export interface AgingRow {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string;
  DueDate: string;
  BusinessPartnerID: string;
  CustomerName: string;
  Wilayah: string | null;
  Kecamatan: string | null;
  Kontak: string | null;
  PartnerType: PartnerType;
  Outstanding: number;
  DaysOverdue: number;
  AgingBucket: AgingBucket;
  Status: PiutangStatus;
}

// BusinessPartner field mappings verified against the previous "Dashboard PMP
// Ponorogo" build (ERP has no dedicated columns for these, so legacy fields
// are repurposed):
//   Wilayah    <- NPWPName
//   Kecamatan  <- NPWPAddress
//   Kontak     <- MobileNo
//   TakeAway   <- SalesmanID = '0127'
//   Gender = Female -> Retail, Gender = Male -> Agen
export const PARTNER_TYPE_CASE = `
  CASE
    WHEN bp.SalesmanID = '0127' THEN 'TakeAway'
    WHEN bp.Gender = 'Female' THEN 'Retail'
    WHEN bp.Gender = 'Male' THEN 'Agen'
    ELSE 'Lainnya'
  END
`;

// Status thresholds follow the existing aging buckets: Sehat = belum jatuh
// tempo s/d 30 hari lewat, Perhatian = 31-60 hari, Kritis = >60 hari.
const STATUS_CASE = `
  CASE
    WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 30 THEN 'Sehat'
    WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 60 THEN 'Perhatian'
    ELSE 'Kritis'
  END
`;

export async function getAgingReceivables(wilayah?: string): Promise<AgingRow[]> {
  const pool = await getPool();
  const request = pool.request();
  if (wilayah) request.input("wilayah", sql.VarChar(128), wilayah);

  // vCustomerStatement is a UNION ALL view: one row per invoice (Netto/Deposit)
  // PLUS one row per payment applied to that invoice (Paid/OtherPayment). It is
  // NOT pre-aggregated, so it must be GROUP BY'd per SalesInvoiceID before use —
  // joining it to SalesInvoice directly (as the original reference query did)
  // fans out to one row per payment and computes the outstanding formula on each
  // individual row, which both massively overcounts "outstanding" invoices
  // (~221k rows instead of the true ~500) and ignores payments entirely for any
  // invoice that has been paid.
  const result = await request.query(`
    WITH CustomerBalance AS (
        SELECT
            SalesInvoiceID,
            SUM(Netto)        AS Netto,
            SUM(Deposit)      AS Deposit,
            SUM(Paid)         AS Paid,
            SUM(OtherPayment) AS OtherPayment
        FROM vCustomerStatement
        GROUP BY SalesInvoiceID
    )
    SELECT
        si.SalesInvoiceID,
        si.VoucherNo,
        si.TransDate,
        si.DueDate,
        bp.BusinessPartnerID,
        bp.Name AS CustomerName,
        bp.NPWPName    AS Wilayah,
        bp.NPWPAddress AS Kecamatan,
        bp.MobileNo    AS Kontak,
        ${PARTNER_TYPE_CASE} AS PartnerType,
        (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) AS Outstanding,
        DATEDIFF(DAY, si.DueDate, GETDATE()) AS DaysOverdue,
        CASE
            WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 0  THEN 'Belum Jatuh Tempo'
            WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 30 THEN '1-30 Hari'
            WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 60 THEN '31-60 Hari'
            WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 90 THEN '61-90 Hari'
            ELSE '>90 Hari'
        END AS AgingBucket,
        ${STATUS_CASE} AS Status
    FROM CustomerBalance cb
    JOIN SalesInvoice si ON si.SalesInvoiceID = cb.SalesInvoiceID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
    WHERE si.IsDeleted = 0
      AND (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) > 0
      ${wilayah ? "AND bp.NPWPName = @wilayah" : ""}
    ORDER BY si.TransDate DESC
  `);

  return result.recordset;
}

export interface PiutangStatusBucket {
  status: PiutangStatus;
  mitraCount: number;
  outstanding: number;
  ratioPct: number;
  avgAgingDays: number;
}

export interface PiutangStatusOverview {
  totalMitra: number;
  totalOutstanding: number;
  buckets: PiutangStatusBucket[];
}

// Lightweight per-mitra rollup for Beranda's "Detail Piutang" panel — same
// per-mitra Status logic as getCollectionPriority() (MAX days-overdue across
// a mitra's unpaid invoices, not per-invoice like getAgingReceivables()'s
// STATUS_CASE), so the Kritis/Perhatian/Sehat counts stay consistent with
// what /aging shows. Deliberately skips getCollectionPriority()'s
// OrderStats/PaymentStats/DashboardCollectionTarget joins — this panel only
// needs the aggregate counts/totals, not per-mitra order/payment/target detail.
export async function getPiutangStatusOverview(): Promise<PiutangStatusOverview> {
  const pool = await getPool();

  const result = await pool.request().query(`
    WITH InvoiceBalance AS (
        SELECT si.SalesInvoiceID, si.BusinessPartnerID, si.DueDate,
               (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) AS Outstanding
        FROM (
            SELECT SalesInvoiceID, SUM(Netto) AS Netto, SUM(Deposit) AS Deposit,
                   SUM(Paid) AS Paid, SUM(OtherPayment) AS OtherPayment
            FROM vCustomerStatement
            GROUP BY SalesInvoiceID
        ) cb
        JOIN SalesInvoice si ON si.SalesInvoiceID = cb.SalesInvoiceID
        WHERE si.IsDeleted = 0
    ),
    MitraBalance AS (
        SELECT BusinessPartnerID,
               SUM(CASE WHEN Outstanding > 0 THEN Outstanding ELSE 0 END) AS PiutangBerjalan,
               MAX(CASE WHEN Outstanding > 0 THEN DATEDIFF(DAY, DueDate, GETDATE()) END) AS MaxDaysOverdue
        FROM InvoiceBalance
        GROUP BY BusinessPartnerID
    )
    SELECT
        PiutangBerjalan,
        MaxDaysOverdue,
        CASE
            WHEN MaxDaysOverdue IS NULL OR MaxDaysOverdue <= 30 THEN 'Sehat'
            WHEN MaxDaysOverdue <= 60 THEN 'Perhatian'
            ELSE 'Kritis'
        END AS Status
    FROM MitraBalance
    WHERE PiutangBerjalan > 0
  `);

  const rows = result.recordset as { PiutangBerjalan: number; MaxDaysOverdue: number | null; Status: PiutangStatus }[];

  const totalMitra = rows.length;
  const totalOutstanding = rows.reduce((sum, r) => sum + r.PiutangBerjalan, 0);

  const buckets: PiutangStatusBucket[] = (["Kritis", "Perhatian", "Sehat"] as PiutangStatus[]).map((status) => {
    const matching = rows.filter((r) => r.Status === status);
    const outstanding = matching.reduce((sum, r) => sum + r.PiutangBerjalan, 0);
    const agingSum = matching.reduce((sum, r) => sum + (r.MaxDaysOverdue ?? 0), 0);
    return {
      status,
      mitraCount: matching.length,
      outstanding,
      ratioPct: totalOutstanding ? (outstanding / totalOutstanding) * 100 : 0,
      avgAgingDays: matching.length ? agingSum / matching.length : 0,
    };
  });

  return { totalMitra, totalOutstanding, buckets };
}
