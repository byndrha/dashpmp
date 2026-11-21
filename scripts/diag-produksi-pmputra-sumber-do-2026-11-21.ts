// Diagnostik read-only: sumber DO per kendaraan untuk modul Produksi PMPutra.
// Bandingkan PMP_Penjadwalan utama vs logistik (pola yang sama dengan cek
// PMPersada/PMPakis 2026-11-09 di src/lib/queries/produksi-do-erp.ts).
// Usage: npx tsx scripts/diag-produksi-pmputra-sumber-do-2026-11-21.ts
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";

async function main() {
  for (const label of ["utama", "logistik"] as const) {
    const pool = await getCompanyPool("pmputra", label);
    const db = (await pool.request().query("SELECT DB_NAME() AS db")).recordset[0].db;
    const tabel = await pool.request().query(`
      SELECT OBJECT_ID('PMP_Penjadwalan') a, OBJECT_ID('PMP_PenjadwalanDetail') b,
             OBJECT_ID('PMP_DaftarKendaraan') c, OBJECT_ID('PMP_Sopir') d`);
    const kendaraan = await pool.request().query(
      `SELECT COUNT(*) n FROM PMP_DaftarKendaraan WHERE ISNULL(IsDeleted,0)=0`
    );
    const harian = await pool.request().query(`
      SELECT CONVERT(varchar(10), j.Tanggal, 120) Tgl, COUNT(DISTINCT j.DaftarKendaraanID) Kendaraan,
             COUNT(DISTINCT j.NoDokumen) Jadwal,
             SUM(ISNULL(p.BalokKecilRealisasi,0)) Kecil, SUM(ISNULL(p.BalokBesarRealisasi,0)) Besar
      FROM PMP_Penjadwalan j
      JOIN PMP_PenjadwalanDetail d ON d.PenjadwalanID = j.PenjadwalanID AND ISNULL(d.IsDeleted,0)=0
      JOIN PMP_Pemesanan p ON p.PemesananID = d.PemesananID
      WHERE ISNULL(j.IsDeleted,0)=0 AND j.Tanggal >= '2026-11-14'
      GROUP BY CONVERT(varchar(10), j.Tanggal, 120) ORDER BY Tgl`);
    const jam = await pool.request().query(`
      SELECT DATEPART(HOUR, Tanggal) h, COUNT(*) n FROM PMP_Penjadwalan
      WHERE ISNULL(IsDeleted,0)=0 AND Tanggal >= '2026-11-01' GROUP BY DATEPART(HOUR, Tanggal) ORDER BY h`);
    const branch = await pool.request().query(`
      SELECT ISNULL(BranchID,'(null)') b, COUNT(*) n FROM PMP_Penjadwalan
      WHERE ISNULL(IsDeleted,0)=0 AND Tanggal >= '2026-11-01' GROUP BY BranchID`);
    console.log(`\n== ${label} (${db})`);
    console.log("tabel:", tabel.recordset[0], "kendaraan aktif:", kendaraan.recordset[0].n);
    console.log("branch Nov:", branch.recordset.map((r) => `${r.b}:${r.n}`).join(" "));
    console.log("jam Nov:", jam.recordset.map((r) => `${r.h}:${r.n}`).join(" "));
    for (const r of harian.recordset) console.log(`  ${r.Tgl} kend=${r.Kendaraan} jadwal=${r.Jadwal} kecil=${r.Kecil} besar=${r.Besar}`);
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
