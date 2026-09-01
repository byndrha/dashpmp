// One-off table creation for the Satpam duty roster (Fondasi Roster Shift
// Satpam) -- idempotent, safe to re-run.
// Usage: npx tsx scripts/create-satpam-jadwal-jaga-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSatpamJadwalJaga' AND xtype='U')
    CREATE TABLE DashboardSatpamJadwalJaga (
      JadwalJagaID    INT IDENTITY PRIMARY KEY,
      TanggalUsaha    DATE NOT NULL,
      ShiftType       VARCHAR(12) NOT NULL,
      SatpamAkunID    INT NOT NULL,
      Catatan         VARCHAR(256) NULL,
      IsDeleted       BIT NOT NULL DEFAULT 0,
      CreatedByAkunID INT NOT NULL,
      CreatedDate     DATETIME NOT NULL DEFAULT GETDATE(),
      ModifiedDate    DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  console.log("DashboardSatpamJadwalJaga ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
