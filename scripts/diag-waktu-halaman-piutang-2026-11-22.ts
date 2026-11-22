// Uji BACA-SAJA (2026-11-22): ukur durasi tiap query halaman Piutang Es Balok
// satu per satu (berurutan, tanpa saling berebut pool). Usage: npx tsx <file> [kode]
import "dotenv/config";
import { getPiutangSummary, getPiutangPerAgen } from "../src/lib/queries/penjualan-piutang";
import { getEsBalokInvoiceOutstanding, getEsBalokPiutangPeriodSummary } from "../src/lib/queries/piutang-invoice-outstanding";
import { getEsBalokCollectionPriority, getEsBalokPembayaranByDate } from "../src/lib/queries/piutang-priority-es-balok";
import { getUmurPiutangBersih } from "../src/lib/queries/umur-piutang-bersih";

async function ukur<T>(nama: string, f: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const r = await f();
  console.log(nama.padEnd(32), `${Date.now() - t} ms`);
  return r;
}
async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  await ukur("getPiutangSummary", () => getPiutangSummary(kode));
  await ukur("getPiutangPerAgen", () => getPiutangPerAgen(kode, start, end));
  const inv = await ukur("getEsBalokInvoiceOutstanding", () => getEsBalokInvoiceOutstanding(kode));
  await ukur("getEsBalokCollectionPriority", () => getEsBalokCollectionPriority(kode, inv));
  await ukur("getEsBalokPembayaranByDate", () => getEsBalokPembayaranByDate(kode, start, inv));
  await ukur("getEsBalokPiutangPeriodSummary", () => getEsBalokPiutangPeriodSummary(kode, start, end, inv));
  await ukur("getUmurPiutangBersih", () => getUmurPiutangBersih(kode));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
