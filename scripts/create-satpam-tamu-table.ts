// One-off table creation for the satpam-app Tamu feature -- idempotent,
// safe to re-run.
// Usage: npx tsx scripts/create-satpam-tamu-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSatpamTamu' AND xtype='U')
    CREATE TABLE DashboardSatpamTamu (
      KunjunganID         INT IDENTITY PRIMARY KEY,
      NamaTamu            VARCHAR(128) NOT NULL,
      AsalInstansi        VARCHAR(128) NULL,
      TujuanKunjungan     VARCHAR(256) NOT NULL,
      Dikunjungi          VARCHAR(128) NOT NULL,
      NomorKendaraan      VARCHAR(32) NULL,
      FotoMasukPath       VARCHAR(256) NOT NULL,
      FotoMasukLatitude   DECIMAL(10,7) NULL,
      FotoMasukLongitude  DECIMAL(10,7) NULL,
      WaktuMasuk          DATETIME NOT NULL DEFAULT GETDATE(),
      FotoKeluarPath      VARCHAR(256) NULL,
      FotoKeluarLatitude  DECIMAL(10,7) NULL,
      FotoKeluarLongitude DECIMAL(10,7) NULL,
      WaktuKeluar         DATETIME NULL,
      IsDeleted           BIT NOT NULL DEFAULT 0,
      ModifiedDate        DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  console.log("DashboardSatpamTamu ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
