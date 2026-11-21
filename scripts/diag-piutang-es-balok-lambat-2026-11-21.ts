// Diagnostik read-only: ukur waktu tiap query halaman /pmputra/piutang.
// Usage: npx tsx scripts/diag-piutang-es-balok-lambat-2026-11-21.ts
import "dotenv/config";
import { getPiutangSummary, getPiutangPerAgen } from "../src/lib/queries/penjualan-piutang";
import { getEsBalokInvoiceOutstanding } from "../src/lib/queries/piutang-invoice-outstanding";
import { getEsBalokCollectionPriority, getEsBalokPembayaranByDate } from "../src/lib/queries/piutang-priority-es-balok";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const r = await fn();
  console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`);
  return r;
}

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  await timed("warmup pool", () => getPiutangSummary(kode));
  await timed("getPiutangSummary", () => getPiutangSummary(kode));
  await timed("getPiutangPerAgen", () => getPiutangPerAgen(kode, start, end));
  const inv = await timed("getEsBalokInvoiceOutstanding", () => getEsBalokInvoiceOutstanding(kode));
  console.log("  invoice rows:", inv.length, "payload KB:", Math.round(JSON.stringify(inv).length / 1024));
  await timed("getEsBalokCollectionPriority", () => getEsBalokCollectionPriority(kode, inv));
  await timed("getEsBalokPembayaranByDate", () => getEsBalokPembayaranByDate(kode, new Date(`${now.toISOString().slice(0, 10)}T00:00:00`), inv));
  await timed("paralel (seperti page.tsx)", () =>
    Promise.all([getPiutangSummary(kode), getPiutangPerAgen(kode, start, end), getEsBalokInvoiceOutstanding(kode)])
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
