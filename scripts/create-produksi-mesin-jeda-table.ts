// Tabel Catatan Jeda Mesin (Es Kristal / MKEsindo): alasan mesin tidak
// berproduksi pada rentang waktu tertentu — dicatat dari linimasa Riwayat
// Produksi (tombol "+" di samping chip jeda). Idempoten, aman diulang.
// Usage: npx tsx scripts/create-produksi-mesin-jeda-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  // WaktuMulai/WaktuSelesai disimpan naive-WIB (sama seperti
  // DashboardProduksiMesinEvent.WaktuEvent).
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardProduksiMesinJeda' AND xtype='U')
    CREATE TABLE DashboardProduksiMesinJeda (
      JedaID              INT IDENTITY PRIMARY KEY,
      MesinID             INT NOT NULL,
      WaktuMulai          DATETIME NOT NULL,
      WaktuSelesai        DATETIME NOT NULL,
      Penyebab            VARCHAR(30) NOT NULL,
      Keterangan          NVARCHAR(500) NULL,
      DicatatOlehAkunID   INT NOT NULL,
      IsDeleted           BIT NOT NULL DEFAULT 0,
      CreatedDate         DATETIME NOT NULL DEFAULT GETDATE(),
      ModifiedDate        DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_ProduksiMesinJeda_Waktu')
    CREATE INDEX IX_ProduksiMesinJeda_Waktu ON DashboardProduksiMesinJeda (WaktuMulai, MesinID) WHERE IsDeleted = 0
  `);

  console.log("DashboardProduksiMesinJeda ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
