import { getPool, sql } from "@/lib/db";
import type { DateRangeFilter } from "@/types/dashboard";

export interface DailySales {
  BranchID: string;
  BranchName: string;
  SalesDate: string;
  InvoiceCount: number;
  GrossAmount: number;
  TotalDiscount: number;
  TotalTax: number;
  NetSales: number;
}

export async function getDailySales(filter: DateRangeFilter): Promise<DailySales[]> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);

  if (filter.branchId) request.input("branchId", sql.VarChar(16), filter.branchId);

  const result = await request.query(`
    SELECT
        si.BranchID,
        b.Name AS BranchName,
        CAST(si.TransDate AS DATE) AS SalesDate,
        COUNT(DISTINCT si.SalesInvoiceID) AS InvoiceCount,
        SUM(si.Amount)     AS GrossAmount,
        SUM(si.DiscRp)     AS TotalDiscount,
        SUM(si.TaxValue)   AS TotalTax,
        SUM(si.Netto)      AS NetSales
    FROM SalesInvoice si
    LEFT JOIN Branch b ON b.BranchID = si.BranchID
    WHERE si.IsDeleted = 0
      AND ISNULL(si.IsPerforma, 0) = 0
      AND si.TransDate >= @startDate
      AND si.TransDate <  @endDate
      ${filter.branchId ? "AND si.BranchID = @branchId" : ""}
    GROUP BY si.BranchID, b.Name, CAST(si.TransDate AS DATE)
    ORDER BY SalesDate DESC, BranchName
  `);

  // mssql returns SQL `DATE` columns as JS Date objects, not strings — normalize
  // to an ISO date string so downstream code (sorting, grouping by key, display
  // formatting) can treat SalesDate as the plain string the type declares.
  return result.recordset.map((row) => ({
    ...row,
    SalesDate:
      row.SalesDate instanceof Date ? row.SalesDate.toISOString().slice(0, 10) : row.SalesDate,
  }));
}
