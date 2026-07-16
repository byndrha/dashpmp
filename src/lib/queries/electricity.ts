import { getPool, sql } from "@/lib/db";
import type { DateRangeFilter } from "@/types/dashboard";

const ELECTRICITY_ACCOUNT_ID = "0166"; // AccountNo 6105 "Listrik", verified against live data

export interface ElectricityEntry {
  TransDate: string;
  BranchID: string;
  BranchName: string;
  VoucherNo: string;
  Debit: number;
  Credit: number;
  Memo: string | null;
}

export async function getElectricityCosts(filter: DateRangeFilter): Promise<ElectricityEntry[]> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);

  if (filter.branchId) request.input("branchId", sql.VarChar(16), filter.branchId);

  const result = await request.query(`
    SELECT
        gl.TransDate,
        gl.BranchID,
        b.Name AS BranchName,
        gl.VoucherNo,
        gl.Debit,
        gl.Credit,
        gl.Memo
    FROM GeneralLedger gl
    LEFT JOIN Branch b ON b.BranchID = gl.BranchID
    WHERE gl.ChartOfAccountID = '${ELECTRICITY_ACCOUNT_ID}'
      AND gl.TransDate >= @startDate
      AND gl.TransDate <  @endDate
      ${filter.branchId ? "AND gl.BranchID = @branchId" : ""}
    ORDER BY gl.TransDate DESC
  `);

  return result.recordset;
}
