// Uji BACA-SAJA getPesananBalokHari (2026-11-22).
// Usage: npx tsx scripts/diag-pemesanan-es-balok-query-2026-11-22.ts [kode] [YYYY-MM-DD]
import "dotenv/config";
import { getPesananBalokHari, type KodeEsBalok } from "../src/lib/queries/pemesanan-es-balok";

async function main() {
  const kode = (process.argv[2] ?? "pmputra") as KodeEsBalok;
  const tgl = process.argv[3] ?? new Date().toISOString().slice(0, 10);
  const t = Date.now();
  const rows = await getPesananBalokHari(kode, tgl);
  console.log(kode, tgl, `${rows.length} pesanan, ${Date.now() - t} ms`);
  const per: Record<string, number> = {};
  for (const r of rows) per[r.tahap] = (per[r.tahap] ?? 0) + 1;
  console.log("per tahap:", per);
  console.log("tanpa wilayah:", rows.filter((r) => !r.wilayah).length, "| beda realisasi:", rows.filter((r) => r.alasanBeda).length);
  console.table(rows.slice(0, 5).map((r) => ({ no: r.noDokumen, agen: r.agen, wil: r.wilayah, pk: r.pesanKecil, pb: r.pesanBesar, kend: r.kendaraan, maks: r.kendaraanMaks, tahap: r.tahap })));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
