// One-off schema creation for the thermal-print job queue
// (DashboardPrintQueue) — idempotent, safe to re-run.
// Usage: npx tsx scripts/create-print-queue-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPrintQueue' AND xtype='U')
    CREATE TABLE DashboardPrintQueue (
      PrintQueueID    INT IDENTITY PRIMARY KEY,
      SalesInvoiceID  VARCHAR(16) NOT NULL,
      JadwalID        INT NOT NULL,
      IsManual        BIT NOT NULL DEFAULT 0,
      Status          VARCHAR(20) NOT NULL DEFAULT 'Pending',
      CreatedAt       DATETIME NOT NULL DEFAULT GETDATE(),
      PrintedAt       DATETIME NULL
    )
  `);

  console.log("DashboardPrintQueue ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
