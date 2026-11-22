// Uji BACA-SAJA (2026-11-22): getUmurPiutangBersih harus menjumlah TEPAT ke
// getPiutangSummary().totalPiutangSaatIni. Usage: npx tsx <file> [kode]
import "dotenv/config";
import { getPiutangSummary } from "../src/lib/queries/penjualan-piutang";
import { getUmurPiutangBersih } from "../src/lib/queries/umur-piutang-bersih";

const jt = (n: number) => `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;
async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const t = Date.now();
  const umur = await getUmurPiutangBersih(kode);
  const ms = Date.now() - t;
  const summary = await getPiutangSummary(kode);
  const sumEmber = umur.ember.reduce((s, e) => s + e.nominal, 0);
  const sumStatus = umur.status.reduce((s, e) => s + e.nominal, 0);
  console.log(`${kode}: ${ms} ms, ${umur.jumlahAgen} agen ber-hutang`);
  console.log("Total Piutang:", jt(summary.totalPiutangSaatIni), "| umur.total:", jt(umur.total), "| Σember:", jt(sumEmber), "| Σstatus:", jt(sumStatus));
  console.log(umur.ember.map((e) => `${e.ember}: ${jt(e.nominal)}`).join(" · "));
  console.log(umur.status.map((s) => `${s.status}: ${s.mitra} mitra ${jt(s.nominal)}`).join(" · "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
