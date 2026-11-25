// Log hasil penawaran mitra (DashboardMitraContactLog) jadi append-only:
// setiap simpan = baris baru, log terbaru per (mitra, tanggal) yang dianggap
// benar. Dulu satu baris per (mitra, tanggal, saluran) yang diedit di tempat
// (MERGE), sehingga riwayatnya hilang.
//  - lepas constraint unik (BusinessPartnerID, LogDate, ContactType)
//  - tambah kolom DilakukanOleh (siapa yang follow-up, dipilih user)
//  - ContactType tetap dipakai sebagai "melalui" (Chat/Telepon/Kunjungan)
//  - kolom hapus-lunak IsDeleted/DihapusOlehUserID/DihapusPada
// Baris lama tidak diubah — otomatis jadi riwayat. Idempoten, aman diulang.
// Usage: npx tsx scripts/ubah-mitra-contact-log-riwayat.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF EXISTS (SELECT * FROM sys.objects WHERE name='UQ_DashboardMitraContactLog_Mitra_Date_Type' AND type='UQ')
      ALTER TABLE DashboardMitraContactLog DROP CONSTRAINT UQ_DashboardMitraContactLog_Mitra_Date_Type
  `);

  await pool.request().query(`
    IF COL_LENGTH('DashboardMitraContactLog', 'DilakukanOleh') IS NULL
      ALTER TABLE DashboardMitraContactLog ADD DilakukanOleh NVARCHAR(100) NULL
  `);

  // Hapus-lunak (khusus Accounting/Direktur): log disembunyikan, tidak
  // dibuang — tetap tercatat siapa & kapan menghapus.
  await pool.request().query(`
    IF COL_LENGTH('DashboardMitraContactLog', 'IsDeleted') IS NULL
      ALTER TABLE DashboardMitraContactLog ADD
        IsDeleted BIT NOT NULL CONSTRAINT DF_DashboardMitraContactLog_IsDeleted DEFAULT 0,
        DihapusOlehUserID VARCHAR(16) NULL,
        DihapusPada DATETIME NULL
  `);

  const cek = await pool.request().query(`
    SELECT COUNT(*) AS Baris,
           (SELECT COUNT(*) FROM sys.objects WHERE name='UQ_DashboardMitraContactLog_Mitra_Date_Type') AS SisaConstraint,
           COL_LENGTH('DashboardMitraContactLog', 'DilakukanOleh') AS KolomOleh,
           COL_LENGTH('DashboardMitraContactLog', 'IsDeleted') AS KolomHapus
    FROM DashboardMitraContactLog
  `);
  console.log("DashboardMitraContactLog siap (append-only):", cek.recordset[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
