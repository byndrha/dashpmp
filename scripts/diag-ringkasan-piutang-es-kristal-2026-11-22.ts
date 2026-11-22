// Uji BACA-SAJA (2026-11-22): apakah angka panel ringkasan Piutang Es Kristal
// (/mkesindo/aging) saling konsisten — Total Outstanding, Jatuh Tempo, >90,
// kotak status, dan ringkasan periode.
import "dotenv/config";
import { getAgingReceivables } from "../src/lib/queries/aging";
import { getCollectionPriority } from "../src/lib/queries/collection-priority";
import { getPiutangPeriodSummary } from "../src/lib/queries/piutang-summary";
import { resolveFilter } from "../src/lib/date-range";

const jt = (n: number) => `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;
async function main() {
  const t = Date.now();
  const filter = resolveFilter({});
  const [rows, prio, periode] = await Promise.all([getAgingReceivables(), getCollectionPriority(), getPiutangPeriodSummary(filter)]);
  console.log("waktu", Date.now() - t, "ms | filter", filter.startDate, "→", filter.endDate);
  const total = rows.reduce((s, r) => s + r.Outstanding, 0);
  const lewat = rows.filter((r) => r.AgingBucket !== "Belum Jatuh Tempo").reduce((s, r) => s + r.Outstanding, 0);
  const lebih90 = rows.filter((r) => r.AgingBucket === ">90 Hari").reduce((s, r) => s + r.Outstanding, 0);
  const ember: Record<string, number> = {};
  for (const r of rows) ember[r.AgingBucket] = (ember[r.AgingBucket] ?? 0) + r.Outstanding;
  console.log("Total outstanding (aging):", jt(total), "| invoice:", rows.length, "| mitra:", new Set(rows.map((r) => r.BusinessPartnerID)).size);
  console.log("Lewat JT:", jt(lewat), "| >90:", jt(lebih90));
  console.log("Ember:", Object.fromEntries(Object.entries(ember).map(([k, v]) => [k, jt(v)])));
  const st: Record<string, [number, number]> = {};
  for (const p of prio) st[p.Status] = [(st[p.Status]?.[0] ?? 0) + 1, (st[p.Status]?.[1] ?? 0) + p.PiutangBerjalan];
  console.log("Status (prioritas):", Object.fromEntries(Object.entries(st).map(([k, [n, v]]) => [k, `${n} mitra ${jt(v)}`])), "Σ", jt(prio.reduce((s, p) => s + p.PiutangBerjalan, 0)));
  console.log("Periode:", { saldoAwal: jt(periode.SaldoAwalPeriode), bayar: jt(periode.TotalPembayaranPeriode), jual: jt(periode.TotalPenjualanPeriode), rasio: periode.RatioPiutangOmzetPct.toFixed(1) + "%" });
  console.log("Cek alur: awal + jual − bayar =", jt(periode.SaldoAwalPeriode + periode.TotalPenjualanPeriode - periode.TotalPembayaranPeriode), "vs total", jt(total));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
