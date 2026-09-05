// One-off schema migration for the "Jual Ulang Es Retur di Rute
// Pengiriman" feature -- idempotent, safe to re-run.
// Usage: npx tsx scripts/create-retur-resale-schema.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('DashboardPengirimanStopDeliveryItem') AND name = 'KondisiRetur'
    )
    ALTER TABLE DashboardPengirimanStopDeliveryItem ADD KondisiRetur VARCHAR(10) NULL
  `);
  console.log("DashboardPengirimanStopDeliveryItem.KondisiRetur ready.");

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPengirimanReturResale' AND xtype='U')
    CREATE TABLE DashboardPengirimanReturResale (
      ResaleID                INT IDENTITY PRIMARY KEY,
      StopDeliveryItemID      INT NOT NULL,
      Jalur                   VARCHAR(20) NOT NULL,
      Qty                     DECIMAL(23,4) NOT NULL,
      TargetSalesOrderDetailID VARCHAR(16) NULL,
      SalesOrderID            VARCHAR(16) NULL,
      LokasiLat               DECIMAL(10,7) NULL,
      LokasiLng               DECIMAL(10,7) NULL,
      DicatatOlehAkunID       INT NOT NULL,
      DicatatVia              VARCHAR(10) NOT NULL,
      CreatedDate             DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT FK_ReturResale_StopDeliveryItem FOREIGN KEY (StopDeliveryItemID)
        REFERENCES DashboardPengirimanStopDeliveryItem(StopDeliveryItemID)
    )
  `);
  console.log("DashboardPengirimanReturResale ready.");

  // NOTE: BusinessPartner's real schema (verified live via MCP SQL tool,
  // 2026-09-05) has NO IsCustomer / IsSupplier / IsEmployee columns at all
  // -- those don't exist in this ERP's table, unlike what an initial draft
  // of this script assumed. BusinessPartnerID is the only NOT NULL column;
  // everything else (including Name, IsDeleted, Gender, SalesmanID) is
  // nullable. Column list below reflects the actual schema.
  const existing = await pool
    .request()
    .query(`SELECT BusinessPartnerID FROM BusinessPartner WHERE BusinessPartnerID = 'RETAILRETURN'`);
  if (existing.recordset.length === 0) {
    await pool.request().query(`
      INSERT INTO BusinessPartner
        (BusinessPartnerID, Name, IsDeleted, Gender, SalesmanID)
      VALUES
        ('RETAILRETURN', 'Retail Return', 0, 'Other', NULL)
    `);
    console.log("BusinessPartner 'RETAILRETURN' seeded.");
  } else {
    console.log("BusinessPartner 'RETAILRETURN' already exists, skipped.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
