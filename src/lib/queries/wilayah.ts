import { getPool } from "@/lib/db";

export async function getWilayahList(): Promise<string[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT NPWPName AS Wilayah
    FROM BusinessPartner
    WHERE ISNULL(IsDeleted, 0) = 0
      AND NPWPName IS NOT NULL
      AND LTRIM(RTRIM(NPWPName)) <> ''
    ORDER BY NPWPName
  `);

  return result.recordset.map((r: { Wilayah: string }) => r.Wilayah.trim());
}
