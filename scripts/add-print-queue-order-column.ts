// One-off schema migration adding SortOrder to DashboardPrintQueue — lets
// the print-management page's drag-and-drop reorder (Task 5) override the
// default CreatedAt/PrintQueueID FIFO order for still-Pending rows.
// Idempotent, safe to re-run.
// Usage: npx tsx scripts/add-print-queue-order-column.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DashboardPrintQueue') AND name = 'SortOrder')
    ALTER TABLE DashboardPrintQueue ADD SortOrder INT NULL
  `);

  console.log("DashboardPrintQueue.SortOrder ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
