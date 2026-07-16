import { getPool } from "@/lib/db";
import type { Branch } from "@/types/dashboard";

export async function getBranches(): Promise<Branch[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT BranchID, Name AS BranchName
    FROM Branch
    ORDER BY Name
  `);
  return result.recordset;
}
