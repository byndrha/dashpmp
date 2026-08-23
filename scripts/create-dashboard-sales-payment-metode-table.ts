// One-off table creation for DashboardSalesPaymentMetode (MKEsindo MSSQL).
// Idempotent — safe to re-run. Usage: npx tsx scripts/create-dashboard-sales-payment-metode-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSalesPaymentMetode' AND xtype='U')
    CREATE TABLE DashboardSalesPaymentMetode (
      SalesPaymentID   VARCHAR(16)  NOT NULL PRIMARY KEY,
      MetodeKode       VARCHAR(64)  NOT NULL,
      Catatan          VARCHAR(500) NULL,
      CreatedDate      DATETIME     NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log("DashboardSalesPaymentMetode ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
