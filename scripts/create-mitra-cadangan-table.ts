// Mitra "Cadangan" (Es Kristal / MKEsindo): mitra semu tempat menumpang stok
// es gratis cadangan (Complimentary) — BUKAN tujuan antar. Stop SO mitra
// cadangan dikecualikan dari rute, Validasi Rute, dan Aplikasi Driver, dan
// tidak membutuhkan titik lokasi. Idempoten, aman diulang.
//
// Usage:
//   npx tsx scripts/create-mitra-cadangan-table.ts
//     -> buat tabel + tandai mitra bernama "%Complimentary%" sebagai Cadangan.
//   npx tsx scripts/create-mitra-cadangan-table.ts --hapus-pin
//     -> SETELAH kode yang mengenal Cadangan ter-deploy: hapus pin palsu mitra
//        cadangan (koordinat lama disimpan di PinLatitudeLama/PinLongitudeLama
//        supaya bisa dipulihkan). Jangan dijalankan sebelum deploy — versi lama
//        masih mewajibkan titik dan akan memblokir Selesai Muat.
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const hapusPin = process.argv.includes("--hapus-pin");
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardMitraCadangan' AND xtype='U')
    CREATE TABLE DashboardMitraCadangan (
      BusinessPartnerID   VARCHAR(16) NOT NULL PRIMARY KEY,
      PinLatitudeLama     DECIMAL(10, 7) NULL,
      PinLongitudeLama    DECIMAL(10, 7) NULL,
      DitandaiOlehAkunID  INT NULL,
      CreatedDate         DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  const tandai = await pool.request().query(`
    INSERT INTO DashboardMitraCadangan (BusinessPartnerID, PinLatitudeLama, PinLongitudeLama)
    SELECT bp.BusinessPartnerID, ml.Latitude, ml.Longitude
    FROM BusinessPartner bp
    LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = bp.BusinessPartnerID
    WHERE bp.Name LIKE '%Complimentary%'
      AND NOT EXISTS (SELECT 1 FROM DashboardMitraCadangan c WHERE c.BusinessPartnerID = bp.BusinessPartnerID)
  `);
  console.log(`Ditandai Cadangan: ${tandai.rowsAffected[0]} mitra baru.`);

  if (hapusPin) {
    // Simpan dulu koordinat yang belum tercatat, baru hapus pin.
    await pool.request().query(`
      UPDATE c SET PinLatitudeLama = ml.Latitude, PinLongitudeLama = ml.Longitude
      FROM DashboardMitraCadangan c
      JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = c.BusinessPartnerID
      WHERE c.PinLatitudeLama IS NULL
    `);
    const hapus = await pool.request().query(`
      DELETE ml FROM DashboardMitraLocation ml
      JOIN DashboardMitraCadangan c ON c.BusinessPartnerID = ml.BusinessPartnerID
    `);
    console.log(`Pin palsu dihapus: ${hapus.rowsAffected[0]} baris.`);
  }

  const daftar = await pool.request().query(`
    SELECT c.BusinessPartnerID, bp.Name, c.PinLatitudeLama, c.PinLongitudeLama
    FROM DashboardMitraCadangan c JOIN BusinessPartner bp ON bp.BusinessPartnerID = c.BusinessPartnerID
    ORDER BY bp.Name
  `);
  console.table(daftar.recordset);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
