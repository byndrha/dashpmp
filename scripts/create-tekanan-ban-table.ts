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

  // Foto ban (JenisFoto 'TEKANAN_BAN') wajib di Cek Berangkat, tetapi CHECK
  // constraint lama di DashboardVehicleCheckPhoto hanya mengizinkan 6 jenis
  // foto — INSERT foto ban ditolak dan seluruh Cek Berangkat gagal disimpan
  // ("Terjadi kesalahan tak terduga"). Ganti constraint JenisFoto lama
  // (namanya dibuat otomatis, dicari lewat definisinya) dengan yang
  // mencakup TEKANAN_BAN.
  await pool.request().query(`
    DECLARE @nama sysname, @sql nvarchar(400);
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
      SELECT name FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('DashboardVehicleCheckPhoto')
        AND definition LIKE '%JenisFoto%'
        AND definition NOT LIKE '%TEKANAN_BAN%';
    OPEN c;
    FETCH NEXT FROM c INTO @nama;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      SET @sql = N'ALTER TABLE DashboardVehicleCheckPhoto DROP CONSTRAINT ' + QUOTENAME(@nama);
      EXEC sp_executesql @sql;
      FETCH NEXT FROM c INTO @nama;
    END
    CLOSE c;
    DEALLOCATE c;

    IF NOT EXISTS (
      SELECT 1 FROM sys.check_constraints
      WHERE parent_object_id = OBJECT_ID('DashboardVehicleCheckPhoto') AND definition LIKE '%TEKANAN_BAN%'
    )
      ALTER TABLE DashboardVehicleCheckPhoto ADD CONSTRAINT CK_DashboardVehicleCheckPhoto_JenisFoto
        CHECK (JenisFoto IN ('DEPAN','SAMPING_KANAN','SAMPING_KIRI','BELAKANG','BOX_MUATAN','KABIN','TEKANAN_BAN'));
  `);

  console.log("Selesai: DashboardVehicleCheckBan + DashboardArmada.JumlahBan + JenisFoto TEKANAN_BAN siap.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
