// Adds FotoBeratKemasanPath (VARCHAR(256), NULL) to DashboardProduksiKualitas
// -- a second, independent evidence photo alongside the existing FotoPath
// ("Foto Bukti Sampel"), for the packaging-weight check. Idempotent, safe to
// re-run -- checks INFORMATION_SCHEMA first, same pattern as
// scripts/revisi-kualitas-qty-diameter-drop-checks.ts.
// Usage: npx tsx scripts/add-kualitas-foto-berat-kemasan.ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

const TABLE = "DashboardProduksiKualitas";
const COLUMN = "FotoBeratKemasanPath";

async function columnExists(pool: Awaited<ReturnType<typeof getPool>>, column: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("t", sql.VarChar(128), TABLE)
    .input("c", sql.VarChar(128), column)
    .query(`SELECT 1 AS Found FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t AND COLUMN_NAME = @c`);
  return result.recordset.length > 0;
}

async function main() {
  const pool = await getPool();

  if (await columnExists(pool, COLUMN)) {
    console.log(`${COLUMN} already exists -- skipping.`);
  } else {
    await pool.request().query(`ALTER TABLE ${TABLE} ADD ${COLUMN} VARCHAR(256) NULL`);
    console.log(`Added ${COLUMN} to ${TABLE}.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
