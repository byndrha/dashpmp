// One-off schema migration adding FailCount to DashboardPrintQueue — the
// dead-letter/retry-limit support for the thermal-print job queue (final
// review Finding 2). Idempotent, safe to re-run.
// Usage: npx tsx scripts/add-print-queue-fail-count-column.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DashboardPrintQueue') AND name = 'FailCount')
    ALTER TABLE DashboardPrintQueue ADD FailCount INT NOT NULL DEFAULT 0
  `);

  console.log("DashboardPrintQueue.FailCount ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
