import { getPool } from "@/lib/db";

export interface ChartOfAccountOption {
  id: string;
  name: string;
}

// Feeds the admin "Kelola Pembayaran" dialog's coa_id combobox — real MSSQL
// accounts only, never typed freely.
export async function getChartOfAccountOptions(): Promise<ChartOfAccountOption[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ChartOfAccountID, Name FROM ChartOfAccount WHERE ISNULL(IsDeleted, 0) = 0 ORDER BY ChartOfAccountID
  `);
  return (result.recordset as { ChartOfAccountID: string; Name: string }[]).map((r) => ({ id: r.ChartOfAccountID, name: r.Name }));
}
