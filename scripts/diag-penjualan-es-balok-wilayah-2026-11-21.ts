// Verifikasi read-only filter wilayah modul Penjualan Es Balok.
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";
import { getTrenHarianBalok } from "../src/lib/queries/penjualan-es-balok";

async function main() {
  for (const kode of ["pmputra", "pmpersada", "pmpakis"]) {
    const pool = await getCompanyPool(kode, "utama");
    const r = await pool.request().query(`
      SELECT TOP 3 w.Nama, COUNT(DISTINCT p.PemesananID) n
      FROM PMP_Pemesanan p
      JOIN PMP_AgenDetail ad ON ad.AgenID = p.AgenID AND ISNULL(ad.IsDeleted,0)=0
      JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
      WHERE p.IsDeleted=0 AND p.Tanggal >= '2026-11-01'
      GROUP BY w.Nama ORDER BY n DESC`);
    const agenTanpaWil = await pool.request().query(`
      SELECT COUNT(DISTINCT p.AgenID) n FROM PMP_Pemesanan p
      WHERE p.IsDeleted=0 AND p.Tanggal >= '2026-11-01'
        AND NOT EXISTS (SELECT 1 FROM PMP_AgenDetail ad JOIN PMP_Wilayah w ON w.WilayahID=ad.RegionID WHERE ad.AgenID=p.AgenID AND ISNULL(ad.IsDeleted,0)=0)`);
    console.log(kode, r.recordset, "agen tanpa wilayah:", agenTanpaWil.recordset[0].n);
    const w = r.recordset[0]?.Nama;
    if (w) {
      const hr = await getTrenHarianBalok(kode, { startDate: "2026-11-15", endDate: "2026-11-21", wilayah: w });
      const all = await getTrenHarianBalok(kode, { startDate: "2026-11-15", endDate: "2026-11-21" });
      console.log(`  ${w}:`, hr.map((p) => `${p.key.slice(5)} ${Math.round(p.nominal)}/${p.qtyKecil}`).join(" | "));
      console.log(`  semua:`, all.map((p) => `${p.key.slice(5)} ${Math.round(p.nominal)}/${p.qtyKecil}`).join(" | "));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
