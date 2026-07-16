import { getPool, sql } from "@/lib/db";
import type { PartnerType } from "@/types/dashboard";

export type AgingBucket =
  | "Belum Jatuh Tempo"
  | "1-30 Hari"
  | "31-60 Hari"
  | "61-90 Hari"
  | ">90 Hari";

export interface AgingRow {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string;
  DueDate: string;
  BusinessPartnerID: string;
  CustomerName: string;
  BranchName: string;
  Wilayah: string | null;
  Kecamatan: string | null;
  Kontak: string | null;
  PartnerType: PartnerType;
  Outstanding: number;
  DaysOverdue: number;
  AgingBucket: AgingBucket;
}

// BusinessPartner field mappings verified against the previous "Dashboard PMP
// Ponorogo" build (ERP has no dedicated columns for these, so legacy fields
// are repurposed):
//   Wilayah    <- NPWPName
//   Kecamatan  <- NPWPAddress
//   Kontak     <- MobileNo
//   TakeAway   <- SalesmanID = '0127'
//   Gender = Female -> Retail, Gender = Male -> Agen
const PARTNER_TYPE_CASE = `
  CASE
    WHEN bp.SalesmanID = '0127' THEN 'TakeAway'
    WHEN bp.Gender = 'Female' THEN 'Retail'
    WHEN bp.Gender = 'Male' THEN 'Agen'
    ELSE 'Lainnya'
  END
`;

export async function getAgingReceivables(branchId?: string): Promise<AgingRow[]> {
  const pool = await getPool();
  const request = pool.request();
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);

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
        b.Name  AS BranchName,
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
        END AS AgingBucket
    FROM CustomerBalance cb
    JOIN SalesInvoice si ON si.SalesInvoiceID = cb.SalesInvoiceID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
    LEFT JOIN Branch b ON b.BranchID = si.BranchID
    WHERE si.IsDeleted = 0
      AND (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) > 0
      ${branchId ? "AND si.BranchID = @branchId" : ""}
    ORDER BY si.TransDate DESC
  `);

  return result.recordset;
}
