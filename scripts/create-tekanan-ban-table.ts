// Tekanan ban per posisi pada Cek Berangkat (aplikasi Security) +
// jumlah ban per armada. Idempoten & hanya menambah (aman diulang).
//
// Jalankan per tenant SEBELUM kode ter-deploy:
//   npx tsx scripts/create-tekanan-ban-table.ts
//   ESKRISTAL_PERUSAHAAN_KODE=<kode tenant lain> npx tsx scripts/create-tekanan-ban-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardVehicleCheckBan' AND xtype='U')
    CREATE TABLE DashboardVehicleCheckBan (
      VehicleCheckBanID INT IDENTITY(1,1) PRIMARY KEY,
      VehicleCheckID    INT NOT NULL,
      Posisi            VARCHAR(12) NOT NULL,
      PSI               DECIMAL(5,1) NOT NULL,
      CONSTRAINT UQ_DashboardVehicleCheckBan UNIQUE (VehicleCheckID, Posisi)
    )
  `);

  // NULL = ditebak dari merek (Hino = 6, selain itu 4) — lihat jumlahBanArmada().
  await pool.request().query(`
    IF COL_LENGTH('DashboardArmada', 'JumlahBan') IS NULL
      ALTER TABLE DashboardArmada ADD JumlahBan TINYINT NULL
  `);

  console.log("Selesai: DashboardVehicleCheckBan + DashboardArmada.JumlahBan siap.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
