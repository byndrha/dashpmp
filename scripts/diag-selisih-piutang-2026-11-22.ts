// Uji BACA-SAJA (2026-11-22): mengurai selisih antara Sisa Hutang kartu per
// Agen (getPiutangPerAgen) dan total pesanan belum lunas FIFO
// (getEsBalokInvoiceOutstanding) menjadi komponen, lalu memastikan
// komponennya menjumlah tepat ke selisih.
// Usage: npx tsx scripts/diag-selisih-piutang-2026-11-22.ts [kode] [nama agen]
import "dotenv/config";
import { getPiutangPerAgen } from "../src/lib/queries/penjualan-piutang";
import { getEsBalokInvoiceOutstanding, getKomponenSelisihPiutang } from "../src/lib/queries/piutang-invoice-outstanding";

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const nama = (process.argv[3] ?? "BAGUS").toUpperCase();
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  const [perAgen, invoice] = await Promise.all([getPiutangPerAgen(kode, start, end), getEsBalokInvoiceOutstanding(kode)]);
  const agen = perAgen.find((r) => r.nama.trim().toUpperCase() === nama);
  if (!agen) throw new Error(`Agen ${nama} tidak ditemukan`);
  const fifo = invoice.filter((r) => r.agenId === agen.agenId).reduce((s, r) => s + r.outstanding, 0);
  const komponen = await getKomponenSelisihPiutang(kode, agen.agenId, end);
  const jumlahKomponen = komponen.reduce((s, k) => s + k.nilai, 0);
  console.log({ agen: agen.nama, agenId: agen.agenId, saldoAkhir: agen.saldoAkhir, fifo, selisih: agen.saldoAkhir - fifo });
  console.table(komponen);
  console.log("jumlah komponen:", jumlahKomponen, "| sisa tak terjelaskan:", agen.saldoAkhir - fifo - jumlahKomponen);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
