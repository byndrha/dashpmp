// One-off schema creation for driver-app status features (istirahat,
// pengiriman terkendala, driver-app-only stop reordering).
// Idempotent — safe to re-run. Usage: npx tsx scripts/create-driver-status-tables.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPengirimanIstirahat' AND xtype='U')
    CREATE TABLE DashboardPengirimanIstirahat (
      IstirahatID   INT IDENTITY PRIMARY KEY,
      JadwalID      INT NOT NULL,
      SalesmanID    VARCHAR(16) NOT NULL,
      Keterangan    VARCHAR(200) NOT NULL,
      WaktuMulai    DATETIME NOT NULL DEFAULT GETDATE(),
      WaktuSelesai  DATETIME NULL,
      CreatedDate   DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPengirimanTerkendala' AND xtype='U')
    CREATE TABLE DashboardPengirimanTerkendala (
      TerkendalaID    INT IDENTITY PRIMARY KEY,
      JadwalDetailID  INT NOT NULL,
      SalesmanID      VARCHAR(16) NOT NULL,
      Alasan          VARCHAR(200) NOT NULL,
      IsResolved      BIT NOT NULL DEFAULT 0,
      CreatedDate     DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('DashboardPengirimanJadwalDetail') AND name = 'UrutanOverride'
    )
    ALTER TABLE DashboardPengirimanJadwalDetail ADD UrutanOverride INT NULL
  `);

  console.log("DashboardPengirimanIstirahat + DashboardPengirimanTerkendala + UrutanOverride ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
