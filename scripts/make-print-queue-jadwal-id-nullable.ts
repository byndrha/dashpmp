// One-off schema migration — DashboardPrintQueue.JadwalID becomes nullable
// so a Takeaway order (which has no Jadwal at all) can still be enqueued
// for thermal printing. Idempotent, safe to re-run.
// Usage: npx tsx scripts/make-print-queue-jadwal-id-nullable.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardPrintQueue' AND COLUMN_NAME = 'JadwalID'
  `);
  const isNullable = (result.recordset[0] as { IS_NULLABLE: string } | undefined)?.IS_NULLABLE === "YES";
  if (!isNullable) {
    await pool.request().query(`ALTER TABLE DashboardPrintQueue ALTER COLUMN JadwalID INT NULL`);
  }
  console.log("DashboardPrintQueue.JadwalID is nullable.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
