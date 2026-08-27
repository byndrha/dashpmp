// One-off table creation for Modul Laporan Tahap 2 (Aktivitas Produksi)
// — idempotent, safe to re-run.
// Usage: npx tsx scripts/create-aktivitas-produksi-tables.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardTimProduksiAnggota' AND xtype='U')
    CREATE TABLE DashboardTimProduksiAnggota (
      AnggotaID     INT IDENTITY PRIMARY KEY,
      Shift         TINYINT NOT NULL,
      Nama          VARCHAR(100) NOT NULL,
      IsDeleted     BIT NOT NULL DEFAULT 0,
      CreatedDate   DATETIME NOT NULL DEFAULT GETDATE(),
      ModifiedDate  DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardAktivitasProduksiShift' AND xtype='U')
    CREATE TABLE DashboardAktivitasProduksiShift (
      AktivitasID             INT IDENTITY PRIMARY KEY,
      TanggalUsaha            DATE NOT NULL,
      Shift                   TINYINT NOT NULL,
      ShiftMulai              DATETIME NOT NULL,
      StafOperasionalAkunID   INT NULL,
      StokEsSebelumnya10KG    INT NOT NULL DEFAULT 0,
      PecahKemasanQty         INT NOT NULL DEFAULT 0,
      EsJatuhQty              INT NOT NULL DEFAULT 0,
      GantiReturnQty          INT NOT NULL DEFAULT 0,
      SealerJebolQty          INT NOT NULL DEFAULT 0,
      CreatedByAkunID         INT NOT NULL,
      CreatedDate             DATETIME NOT NULL DEFAULT GETDATE(),
      ModifiedDate            DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_AktivitasProduksiShift UNIQUE (TanggalUsaha, Shift)
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardAktivitasProduksiKehadiran' AND xtype='U')
    CREATE TABLE DashboardAktivitasProduksiKehadiran (
      AktivitasID   INT NOT NULL,
      AnggotaID     INT NOT NULL,
      PRIMARY KEY (AktivitasID, AnggotaID)
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardProduksiMesinEvent' AND xtype='U')
    CREATE TABLE DashboardProduksiMesinEvent (
      EventID             INT IDENTITY PRIMARY KEY,
      MesinID             INT NOT NULL,
      JenisEvent          VARCHAR(10) NOT NULL,
      WaktuEvent          DATETIME NOT NULL,
      DicatatOlehAkunID   INT NOT NULL,
      CreatedDate         DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  console.log("DashboardTimProduksiAnggota + DashboardAktivitasProduksiShift + DashboardAktivitasProduksiKehadiran + DashboardProduksiMesinEvent ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
