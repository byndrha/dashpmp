// Uji BACA-SAJA (2026-11-22): jalankan query halaman Piutang Es Balok
// PARALEL seperti saat render + aksi klien, untuk melihat efek pool (max 5).
import "dotenv/config";
import { getPiutangSummary, getPiutangPerAgen } from "../src/lib/queries/penjualan-piutang";
import { getEsBalokInvoiceOutstanding, getEsBalokPiutangPeriodSummary } from "../src/lib/queries/piutang-invoice-outstanding";
import { getUmurPiutangBersih } from "../src/lib/queries/umur-piutang-bersih";

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const t = Date.now();
  const tandai = (n: string) => <T,>(p: Promise<T>) => p.then((r) => (console.log(n.padEnd(28), Date.now() - t, "ms"), r));
  await Promise.all([
    tandai("summary")(getPiutangSummary(kode)),
    tandai("perAgen")(getPiutangPerAgen(kode, start, end)),
    tandai("invoice")(getEsBalokInvoiceOutstanding(kode)),
    tandai("periode")(getEsBalokPiutangPeriodSummary(kode, start, end, [])),
    tandai("umur")(getUmurPiutangBersih(kode)),
    tandai("perAgen (aksi kartu)")(getPiutangPerAgen(kode, start, end)),
  ]);
  console.log("total", Date.now() - t, "ms");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
