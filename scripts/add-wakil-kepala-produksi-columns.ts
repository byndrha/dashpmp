// One-off schema migration — adds Wakil Kepala Produksi support: a
// standing per-Tim deputy assignment, plus per-shift attendance flags
// for both Kepala and Wakil. Idempotent, safe to re-run.
// Usage: npx tsx scripts/add-wakil-kepala-produksi-columns.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function addColumnIfMissing(pool: Awaited<ReturnType<typeof getPool>>, table: string, column: string, ddl: string) {
  const result = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'
  `);
  if (result.recordset.length === 0) {
    await pool.request().query(ddl);
    console.log(`Added ${table}.${column}.`);
  } else {
    console.log(`${table}.${column} already exists — nothing to do.`);
  }
}

async function main() {
  const pool = await getPool();
  await addColumnIfMissing(pool, "DashboardTimProduksi", "WakilKepalaAkunID", `ALTER TABLE DashboardTimProduksi ADD WakilKepalaAkunID INT NULL`);
  await addColumnIfMissing(
    pool,
    "DashboardAktivitasProduksiShift",
    "KepalaHadir",
    `ALTER TABLE DashboardAktivitasProduksiShift ADD KepalaHadir BIT NOT NULL DEFAULT 1`
  );
  await addColumnIfMissing(
    pool,
    "DashboardAktivitasProduksiShift",
    "WakilHadir",
    `ALTER TABLE DashboardAktivitasProduksiShift ADD WakilHadir BIT NOT NULL DEFAULT 1`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
