// One-off table creation for the satpam-app Patroli feature -- idempotent,
// safe to re-run.
// Usage: npx tsx scripts/create-satpam-patroli-tables.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSatpamPatroliSesi' AND xtype='U')
    CREATE TABLE DashboardSatpamPatroliSesi (
      SesiID            INT IDENTITY PRIMARY KEY,
      SatpamAkunID      INT NOT NULL,
      ShiftType         VARCHAR(12) NULL,
      TanggalUsahaShift DATE NULL,
      MulaiWaktu        DATETIME NOT NULL DEFAULT GETDATE(),
      SelesaiWaktu      DATETIME NULL,
      IsDeleted         BIT NOT NULL DEFAULT 0,
      ModifiedDate      DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSatpamPatroliFoto' AND xtype='U')
    CREATE TABLE DashboardSatpamPatroliFoto (
      FotoID       INT IDENTITY PRIMARY KEY,
      SesiID       INT NOT NULL,
      TitikPatroli VARCHAR(50) NULL,
      Keterangan   VARCHAR(256) NULL,
      FotoPath     VARCHAR(256) NOT NULL,
      Latitude     DECIMAL(10,7) NULL,
      Longitude    DECIMAL(10,7) NULL,
      WaktuFoto    DATETIME NOT NULL DEFAULT GETDATE(),
      IsDeleted    BIT NOT NULL DEFAULT 0
    )
  `);

  console.log("DashboardSatpamPatroliSesi + DashboardSatpamPatroliFoto ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
