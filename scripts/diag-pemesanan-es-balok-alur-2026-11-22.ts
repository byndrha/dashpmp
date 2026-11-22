// Diagnostik BACA-SAJA (2026-11-22): alur & status pemesanan ERP Es Balok.
// Usage: npx tsx scripts/diag-pemesanan-es-balok-alur-2026-11-22.ts [kode]
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const pool = await getCompanyPool(kode, "utama");
  const q = async (judul: string, sql: string) => {
    const r = await pool.request().query(sql);
    console.log(`\n== ${judul}`);
    console.table(r.recordset);
  };
  await q("status 30 hari", `SELECT Status, COUNT(*) N, SUM(CASE WHEN ISNULL(JumlahRealisasi,0)>0 THEN 1 ELSE 0 END) AdaRealisasi
    FROM PMP_Pemesanan WHERE IsDeleted=0 AND IsVoid=0 AND Tanggal >= DATEADD(DAY,-30,GETDATE()) GROUP BY Status`);
  await q("jadwal? (30 hari)", `SELECT CASE WHEN d.PemesananID IS NULL THEN 'tanpa jadwal' ELSE 'ada jadwal' END K, p.Status, COUNT(*) N
    FROM PMP_Pemesanan p OUTER APPLY (SELECT TOP 1 PemesananID FROM PMP_PenjadwalanDetail d WHERE d.PemesananID=p.PemesananID AND ISNULL(d.IsDeleted,0)=0) d
    WHERE p.IsDeleted=0 AND p.IsVoid=0 AND p.Tanggal >= DATEADD(DAY,-30,GETDATE()) GROUP BY CASE WHEN d.PemesananID IS NULL THEN 'tanpa jadwal' ELSE 'ada jadwal' END, p.Status`);
  await q("contoh terbaru", `SELECT TOP 8 p.PemesananID, p.NoDokumen, p.Tanggal, p.Status, a.Nama Agen, p.BalokKecilPesanan PK, p.BalokBesarPesanan PB,
    p.BalokKecilRealisasi RK, p.BalokBesarRealisasi RB, p.BalokKecilRetur TK, p.BalokBesarRetur TB, p.BalokKecilHarga HK, p.BalokBesarHarga HB,
    p.JumlahTotal, p.Pembayaran, p.AlasanBedaRealisasi, p.AlasanRetur, p.ModifiedDate
    FROM PMP_Pemesanan p LEFT JOIN PMP_Agen a ON a.AgenID=p.AgenID WHERE p.IsDeleted=0 ORDER BY p.Tanggal DESC`);
  await q("PMP_Realisasi kolom", `SELECT c.name Kolom, ty.name Tipe FROM sys.columns c JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID('PMP_Realisasi')`);
  await q("PMP_Penyelesaian kolom", `SELECT c.name Kolom, ty.name Tipe FROM sys.columns c JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID('PMP_Penyelesaian')`);
  await q("PMP_AgenDetail kolom", `SELECT c.name Kolom, ty.name Tipe FROM sys.columns c JOIN sys.types ty ON ty.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID('PMP_AgenDetail')`);
  await q("jam pesanan masuk (jam dari Tanggal, 30 hari)", `SELECT DATEPART(HOUR,Tanggal) Jam, COUNT(*) N FROM PMP_Pemesanan WHERE IsDeleted=0 AND Tanggal >= DATEADD(DAY,-30,GETDATE()) GROUP BY DATEPART(HOUR,Tanggal) ORDER BY Jam`);
  await q("pesanan per hari 7 hari", `SELECT CAST(Tanggal AS date) Tgl, COUNT(*) N, SUM(ISNULL(BalokKecilPesanan,0)+ISNULL(BalokBesarPesanan,0)) Pesan, SUM(ISNULL(BalokKecilRealisasi,0)+ISNULL(BalokBesarRealisasi,0)) Real
    FROM PMP_Pemesanan WHERE IsDeleted=0 AND IsVoid=0 AND Tanggal >= DATEADD(DAY,-7,GETDATE()) GROUP BY CAST(Tanggal AS date) ORDER BY Tgl`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
