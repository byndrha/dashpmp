// Uji BACA-SAJA (2026-11-22): angka periode panel ringkasan (1 bln berjalan)
// harus sama dengan baris bulan ini di tabel Tren Pergerakan Piutang Bulanan.
// Usage: npx tsx <file> [kode]
import "dotenv/config";
import { getPiutangSummary } from "../src/lib/queries/penjualan-piutang";
import { getEsBalokPiutangPeriodSummary } from "../src/lib/queries/piutang-invoice-outstanding";

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  const [summary, periode] = await Promise.all([getPiutangSummary(kode), getEsBalokPiutangPeriodSummary(kode, start, end, [])]);
  const bulan = summary.months[summary.months.length - 1];
  console.log(kode, "tren bulan ini:", { baru: bulan.piutangBaru, bayar: bulan.piutangPembayaran, tarikan: bulan.piutangTarikan });
  console.log("panel periode:", { penjualan: periode.totalPenjualanPeriode, bayar: periode.totalPembayaranPeriode, tarikan: periode.totalTarikanPeriode });
  console.log("saldo awal:", periode.saldoAwalPeriode, "saldo akhir:", periode.saldoAkhirPeriode, "Total Piutang:", summary.totalPiutangSaatIni);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
