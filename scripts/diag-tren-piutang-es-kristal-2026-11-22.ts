// Uji BACA-SAJA (2026-11-22): tren bulanan Es Kristal harus cocok dengan
// perubahan saldo awal bulan ke bulan (getPiutangPeriodSummary), dan status
// per mitra dari data umur harus sama dengan status getCollectionPriority.
import "dotenv/config";
import { getTrenPiutangBulananEsKristal } from "../src/lib/queries/piutang-tren-es-kristal";
import { getPiutangPeriodSummary } from "../src/lib/queries/piutang-summary";
import { getAgingReceivables } from "../src/lib/queries/aging";
import { getCollectionPriority } from "../src/lib/queries/collection-priority";

const jt = (n: number) => `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;
async function main() {
  const tren = await getTrenPiutangBulananEsKristal();
  const awalBulan = (m: string) => `${m}-01`;
  const berikut = (m: string) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo, 1)); return d.toISOString().slice(0, 10); };
  for (const m of tren.slice(-6)) {
    const p = await getPiutangPeriodSummary({ startDate: awalBulan(m.month), endDate: berikut(m.month) });
    const q = await getPiutangPeriodSummary({ startDate: berikut(m.month), endDate: berikut(m.month) });
    const delta = q.SaldoAwalPeriode - p.SaldoAwalPeriode;
    console.log(m.month, "jual", jt(m.piutangBaru), "=", jt(p.TotalPenjualanPeriode), "| bayar", jt(m.piutangPembayaran), "=", jt(p.TotalPembayaranPeriode), "| Δsaldo", jt(delta), "vs bersih", jt(m.netMovement), "selisih", jt(delta - m.netMovement));
  }
  const [rows, prio] = await Promise.all([getAgingReceivables(), getCollectionPriority()]);
  const maks = new Map<string, number>();
  for (const r of rows) maks.set(r.BusinessPartnerID, Math.max(maks.get(r.BusinessPartnerID) ?? -99999, r.DaysOverdue));
  const st = (d: number) => (d <= 30 ? "Sehat" : d <= 60 ? "Perhatian" : "Kritis");
  let beda = 0;
  for (const p of prio) if (st(maks.get(p.BusinessPartnerID) ?? -1) !== p.Status) beda++;
  console.log("status beda:", beda, "dari", prio.length, "| mitra aging:", maks.size);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
