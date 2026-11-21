// Verifikasi read-only fungsi query modul Penjualan Es Balok terhadap DB live.
// Usage: npx tsx scripts/diag-penjualan-es-balok-verifikasi-2026-11-21.ts
import "dotenv/config";
import {
  getTodayWib,
  getPenjualanBalokHari,
  getPenjualanBalokBulan,
  getPenjualanBalokYtd,
  getTrenHarianBalok,
  getTrenBulananBalok,
  getWilayahListBalok,
  getTargetBalok,
} from "../src/lib/queries/penjualan-es-balok";

async function main() {
  const today = getTodayWib().toISOString().slice(0, 10);
  console.log("today WIB:", today);
  for (const kode of ["pmputra", "pmpersada", "pmpakis"]) {
    console.log(`\n===== ${kode} =====`);
    const [hari, bulan, ytd, target, wil] = await Promise.all([
      getPenjualanBalokHari(kode, "2026-11-20"),
      getPenjualanBalokBulan(kode, "2026-10-01"),
      getPenjualanBalokYtd(kode),
      getTargetBalok(kode, 2026, 11),
      getWilayahListBalok(kode),
    ]);
    console.log("hari 20 Nov:", JSON.stringify(hari));
    console.log("bulan Okt:", JSON.stringify({ n: bulan.nominal, q: bulan.qty, p: bulan.perbandingan, r: bulan.rataRata }));
    console.log("ytd:", JSON.stringify(ytd));
    console.log("target Nov:", JSON.stringify({ t: target.TargetNominalMonthly, real: target.RealisasiNominalToDate, q: target.RealisasiQtyToDate, day: target.CurrentDay }));
    console.log("wilayah:", wil.length, wil.slice(0, 5).join(", "));
    const bln = await getTrenBulananBalok(kode, 0);
    console.log("bulanan:", bln.slice(-4).map((p) => `${p.key} nom=${Math.round(p.nominal)} gl=${Math.round(p.pendapatanGL ?? 0)} q=${p.qtyKecil}/${p.qtyBesar}`).join(" | "));
    const hr = await getTrenHarianBalok(kode, { startDate: "2026-11-15", endDate: "2026-11-21", wilayah: wil[0] });
    console.log(`harian (wilayah ${wil[0]}):`, hr.map((p) => `${p.key.slice(5)} ${Math.round(p.nominal)}/${p.qtyKecil}`).join(" | "));
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
