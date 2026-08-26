// One-off schema migration — DashboardProduksiKualitas.SuhuEs is renamed to
// DiameterDalamCm: this form used to record ice temperature, now records
// the ice block's inner diameter instead (explicit request). Same decimal
// type/values, just a column rename — sp_rename preserves existing data.
// Idempotent, safe to re-run.
// Usage: npx tsx scripts/rename-kualitas-suhues-to-diameter.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardProduksiKualitas' AND COLUMN_NAME IN ('SuhuEs', 'DiameterDalamCm')
  `);
  const columns = new Set((result.recordset as { COLUMN_NAME: string }[]).map((r) => r.COLUMN_NAME));
  if (columns.has("DiameterDalamCm")) {
    console.log("DashboardProduksiKualitas.DiameterDalamCm already exists — nothing to do.");
  } else if (columns.has("SuhuEs")) {
    await pool.request().query(`EXEC sp_rename 'DashboardProduksiKualitas.SuhuEs', 'DiameterDalamCm', 'COLUMN'`);
    console.log("Renamed DashboardProduksiKualitas.SuhuEs -> DiameterDalamCm.");
  } else {
    throw new Error("Neither SuhuEs nor DiameterDalamCm found on DashboardProduksiKualitas — unexpected schema state.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
