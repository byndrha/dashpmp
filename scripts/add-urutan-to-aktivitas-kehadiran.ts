// One-off schema migration -- DashboardAktivitasProduksiKehadiran gains a
// Urutan column (drag-reorder support for the redesigned per-shift roster
// -- see docs/superpowers/specs/2026-08-28-produksi-app-kualitas-aktivitas-revisi-design.md).
// Existing rows get Urutan = 0 (their old relative order was never
// meaningful -- the column simply didn't exist; real ordering starts the
// next time each shift's roster is saved through the new UI). Idempotent.
// Usage: npx tsx scripts/add-urutan-to-aktivitas-kehadiran.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardAktivitasProduksiKehadiran' AND COLUMN_NAME = 'Urutan'
  `);
  if (result.recordset.length === 0) {
    await pool.request().query(`ALTER TABLE DashboardAktivitasProduksiKehadiran ADD Urutan INT NOT NULL DEFAULT 0`);
    console.log("Added DashboardAktivitasProduksiKehadiran.Urutan.");
  } else {
    console.log("DashboardAktivitasProduksiKehadiran.Urutan already exists -- nothing to do.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
