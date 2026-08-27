// One-off table creation for Modul Laporan Tahap 1 (Stok Bahan Baku) —
// idempotent, safe to re-run. Usage:
// npx tsx scripts/create-stok-bahan-baku-tables.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardStokBahanBakuShift' AND xtype='U')
    CREATE TABLE DashboardStokBahanBakuShift (
      StokBahanBakuID                BIGINT IDENTITY PRIMARY KEY,
      TanggalUsaha                   DATE NOT NULL,
      Shift                          TINYINT NOT NULL,
      ShiftMulai                     DATETIME NOT NULL,
      JenisBarang                    VARCHAR(20) NOT NULL,
      StokMasukGudang                INT NOT NULL DEFAULT 0,
      StokMasukInventoriOperasional  INT NOT NULL DEFAULT 0,
      StokDipakaiProduksi            INT NOT NULL DEFAULT 0,
      StokRusakProduksi              INT NOT NULL DEFAULT 0,
      OperasionalAkunID              INT NULL,
      OperasionalDiisiPada           DATETIME NULL,
      ProduksiAkunID                 INT NULL,
      ProduksiDiisiPada              DATETIME NULL,
      CreatedDate                    DATETIME NOT NULL DEFAULT GETDATE(),
      ModifiedDate                   DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_StokBahanBakuShift UNIQUE (TanggalUsaha, Shift, JenisBarang)
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardStokBahanBakuSaldoAwal' AND xtype='U')
    CREATE TABLE DashboardStokBahanBakuSaldoAwal (
      JenisBarang                     VARCHAR(20) NOT NULL PRIMARY KEY,
      SaldoAwalGudang                 INT NOT NULL DEFAULT 0,
      SaldoAwalInventoriOperasional   INT NOT NULL DEFAULT 0,
      DiisiOlehAkunID                 INT NULL,
      ModifiedDate                    DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  for (const jenis of ["Plastik10KG", "Plastik5KG", "IkatKabel"]) {
    await pool.request().input("jenis", jenis).query(`
      IF NOT EXISTS (SELECT * FROM DashboardStokBahanBakuSaldoAwal WHERE JenisBarang = @jenis)
      INSERT INTO DashboardStokBahanBakuSaldoAwal (JenisBarang) VALUES (@jenis)
    `);
  }

  console.log("DashboardStokBahanBakuShift + DashboardStokBahanBakuSaldoAwal ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
