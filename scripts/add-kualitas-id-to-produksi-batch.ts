// One-off schema migration — DashboardProduksiBatch gains a nullable
// KualitasID (FK-by-convention, not enforced, matching this codebase's
// existing style for similar links) so a production stock entry can
// reference the specific Pemeriksaan Kualitas record it was produced under.
// Nullable: historical batches predate this link and have no Kualitas
// record to point at. Idempotent, safe to re-run.
// Usage: npx tsx scripts/add-kualitas-id-to-produksi-batch.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardProduksiBatch' AND COLUMN_NAME = 'KualitasID'
  `);
  if (result.recordset.length === 0) {
    await pool.request().query(`ALTER TABLE DashboardProduksiBatch ADD KualitasID INT NULL`);
    console.log("Added DashboardProduksiBatch.KualitasID.");
  } else {
    console.log("DashboardProduksiBatch.KualitasID already exists — nothing to do.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
