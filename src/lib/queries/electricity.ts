import { getPool, sql } from "@/lib/db";
import type { DateRangeFilter } from "@/types/dashboard";

const ELECTRICITY_ACCOUNT_ID = "0166"; // AccountNo 6105 "Listrik", verified against live data

export interface ElectricityEntry {
  TransDate: string;
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

  const result = await request.query(`
    SELECT
        gl.TransDate,
        gl.VoucherNo,
        gl.Debit,
        gl.Credit,
        gl.Memo
    FROM GeneralLedger gl
    WHERE gl.ChartOfAccountID = '${ELECTRICITY_ACCOUNT_ID}'
      AND gl.TransDate >= @startDate
      AND gl.TransDate <  @endDate
    ORDER BY gl.TransDate DESC
  `);

  return result.recordset;
}
