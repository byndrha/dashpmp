import { getPool, sql } from "@/lib/db";
import type { PartnerType } from "@/types/dashboard";

export type AgingBucket =
  | "Belum Jatuh Tempo"
  | "1-30 Hari"
  | "31-60 Hari"
  | "61-90 Hari"
  | ">90 Hari";

export interface AgingRow {
  SalesInvoiceID: number;
  VoucherNo: string;
  TransDate: string;
  DueDate: string;
  BusinessPartnerID: number;
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

export async function getAgingReceivables(branchId?: number): Promise<AgingRow[]> {
  const pool = await getPool();
  const request = pool.request();
  if (branchId) request.input("branchId", sql.Int, branchId);

  const result = await request.query(`
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
        (vcs.Netto - vcs.Paid - vcs.Deposit - vcs.OtherPayment) AS Outstanding,
        DATEDIFF(DAY, si.DueDate, GETDATE()) AS DaysOverdue,
        CASE
            WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 0  THEN 'Belum Jatuh Tempo'
            WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 30 THEN '1-30 Hari'
            WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 60 THEN '31-60 Hari'
            WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 90 THEN '61-90 Hari'
            ELSE '>90 Hari'
        END AS AgingBucket
    FROM vCustomerStatement vcs
    JOIN SalesInvoice si ON si.SalesInvoiceID = vcs.SalesInvoiceID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
    LEFT JOIN Branch b ON b.BranchID = si.BranchID
    WHERE si.IsDeleted = 0
      AND (vcs.Netto - vcs.Paid - vcs.Deposit - vcs.OtherPayment) > 0
      ${branchId ? "AND si.BranchID = @branchId" : ""}
    ORDER BY DaysOverdue DESC
  `);

  return result.recordset;
}
