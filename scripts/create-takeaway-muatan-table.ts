// One-off schema creation for TakeAway loading tracking
// (DashboardTakeAwayMuatan) — idempotent, safe to re-run.
// Usage: npx tsx scripts/create-takeaway-muatan-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardTakeAwayMuatan' AND xtype='U')
    CREATE TABLE DashboardTakeAwayMuatan (
      TakeAwayMuatanID  INT IDENTITY PRIMARY KEY,
      SalesOrderID      VARCHAR(16) NOT NULL UNIQUE,
      Variant           VARCHAR(8) NOT NULL,
      QtyDipesan        INT NOT NULL,
      JamMulaiMuat      DATETIME NULL,
      JamSelesaiMuat    DATETIME NULL,
      QtyDimuat         INT NULL,
      DicatatOlehAkunID INT NULL,
      DeliveryOrderID   VARCHAR(16) NULL,
      SalesInvoiceID    VARCHAR(16) NULL,
      IsDeleted         BIT NOT NULL DEFAULT 0,
      CreatedDate       DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  console.log("DashboardTakeAwayMuatan ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
