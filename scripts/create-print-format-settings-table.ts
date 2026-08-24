// One-off schema creation for the SI Awal receipt format toggles
// (DashboardPrintFormatSettings) — single-row settings table, same pattern
// as DashboardSiteSettings. Idempotent, safe to re-run.
// Usage: npx tsx scripts/create-print-format-settings-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPrintFormatSettings' AND xtype='U')
    CREATE TABLE DashboardPrintFormatSettings (
      ID                INT IDENTITY PRIMARY KEY,
      ShowMitraAddress  BIT NOT NULL DEFAULT 1,
      ShowDriverName    BIT NOT NULL DEFAULT 1,
      ShowBankTransfer  BIT NOT NULL DEFAULT 1,
      ShowQrCode        BIT NOT NULL DEFAULT 1,
      ShowDisclaimer    BIT NOT NULL DEFAULT 1,
      UpdatedAt         DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM DashboardPrintFormatSettings)
    INSERT INTO DashboardPrintFormatSettings DEFAULT VALUES
  `);

  console.log("DashboardPrintFormatSettings ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
