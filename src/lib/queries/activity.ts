import { getPool } from "@/lib/db";

export interface RecentInvoice {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string;
  BranchName: string;
  CustomerName: string;
  Netto: number;
}

export async function getRecentInvoices(limit = 15): Promise<RecentInvoice[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP ${limit}
        si.SalesInvoiceID,
        si.VoucherNo,
        si.TransDate,
        b.Name  AS BranchName,
        bp.Name AS CustomerName,
        si.Netto
    FROM SalesInvoice si
    LEFT JOIN Branch b ON b.BranchID = si.BranchID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
    WHERE si.IsDeleted = 0
      AND ISNULL(si.IsPerforma, 0) = 0
    ORDER BY si.TransDate DESC
  `);

  return result.recordset;
}

export interface TodayBranchPulse {
  BranchID: string;
  BranchName: string;
  NetSales: number;
  InvoiceCount: number;
}

export async function getTodayBranchPulse(): Promise<TodayBranchPulse[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
        b.BranchID,
        b.Name AS BranchName,
        ISNULL(SUM(si.Netto), 0) AS NetSales,
        COUNT(si.SalesInvoiceID) AS InvoiceCount
    FROM Branch b
    LEFT JOIN SalesInvoice si
        ON si.BranchID = b.BranchID
        AND si.IsDeleted = 0
        AND ISNULL(si.IsPerforma, 0) = 0
        AND si.TransDate >= CAST(GETDATE() AS DATE)
        AND si.TransDate <  DATEADD(DAY, 1, CAST(GETDATE() AS DATE))
    WHERE ISNULL(b.IsDeleted, 0) = 0
    GROUP BY b.BranchID, b.Name
    ORDER BY b.Name
  `);

  return result.recordset;
}
