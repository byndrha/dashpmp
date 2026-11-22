// Uji BACA-SAJA (2026-11-22): untuk tiap Agen yang punya pesanan belum lunas,
// cek apakah komponen getKomponenSelisihPiutang menjumlah tepat ke selisih
// Sisa Hutang − total pesanan belum lunas. Usage: npx tsx <file> [kode] [maks]
import "dotenv/config";
import { getPiutangPerAgen } from "../src/lib/queries/penjualan-piutang";
import { getEsBalokInvoiceOutstanding, getKomponenSelisihPiutang } from "../src/lib/queries/piutang-invoice-outstanding";

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const maks = Number(process.argv[3] ?? 40);
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  const [perAgen, invoice] = await Promise.all([getPiutangPerAgen(kode, start, end), getEsBalokInvoiceOutstanding(kode)]);
  const fifoByAgen = new Map<string, number>();
  for (const r of invoice) fifoByAgen.set(r.agenId, (fifoByAgen.get(r.agenId) ?? 0) + r.outstanding);
  const calon = perAgen.filter((a) => fifoByAgen.has(a.agenId) && Math.abs(a.saldoAkhir - fifoByAgen.get(a.agenId)!) >= 1).slice(0, maks);
  let cocok = 0;
  const jenis: Record<string, number> = {};
  const tidak: { nama: string; selisih: number; sisa: number }[] = [];
  for (const a of calon) {
    const selisih = a.saldoAkhir - fifoByAgen.get(a.agenId)!;
    const k = await getKomponenSelisihPiutang(kode, a.agenId, end);
    for (const x of k) jenis[x.label.replace(/ \(.*\)$/, "")] = (jenis[x.label.replace(/ \(.*\)$/, "")] ?? 0) + 1;
    const sisa = Math.round(selisih - k.reduce((t, x) => t + x.nilai, 0));
    if (Math.abs(sisa) <= 2) cocok++;
    else tidak.push({ nama: a.nama, selisih: Math.round(selisih), sisa });
  }
  console.log(kode, `agen dgn selisih diuji: ${calon.length}, cocok: ${cocok}`);
  console.log("komponen muncul:", jenis);
  if (tidak.length) console.table(tidak.slice(0, 15));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
