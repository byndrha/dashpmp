// Tren pergerakan piutang bulanan Es Kristal (MKEsindo) — 12 bulan terakhir.
// Rumus SAMA dengan getPiutangPeriodSummary (piutang-summary.ts), supaya
// tabel tren dan alur "Saldo awal → Saldo akhir" di panel ringkasan selalu
// cocok:
//   Penjualan  = SUM(SalesInvoice.Netto), IsDeleted = 0, bukan performa
//   Pembayaran = SUM(SalesPayment.Amount), IsDeleted = 0
// Es Kristal tidak punya tarikan tabungan → piutangTarikan selalu 0.
// Bentuk keluaran = PiutangTrendMonth Es Balok, jadi komponen tampilan
// TrenPiutangBulanan dipakai bersama.
import { getPool, sql } from "@/lib/db";
import type { PiutangTrendMonth } from "@/lib/queries/penjualan-piutang";

const JUMLAH_BULAN = 12;

// Jendela bulan dalam tanggal kalender biasa (DATE, tanpa zona) — sama dengan
// filter halaman Piutang Es Kristal (resolveFilter: awal bulan s.d. awal
// bulan berikutnya).
function jendelaBulan(): { awal: string; akhir: string; kunci: string[] } {
  const sekarang = new Date();
  const kunci: string[] = [];
  for (let i = JUMLAH_BULAN - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(sekarang.getFullYear(), sekarang.getMonth() - i, 1));
    kunci.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const akhirD = new Date(Date.UTC(sekarang.getFullYear(), sekarang.getMonth() + 1, 1));
  return { awal: `${kunci[0]}-01`, akhir: akhirD.toISOString().slice(0, 10), kunci };
}

export async function getTrenPiutangBulananEsKristal(): Promise<PiutangTrendMonth[]> {
  const pool = await getPool();
  const { awal, akhir, kunci } = jendelaBulan();
  const req = () => pool.request().input("awal", sql.Date, awal).input("akhir", sql.Date, akhir);
  const [jual, bayar] = await Promise.all([
    req().query(`
      SELECT CONVERT(varchar(7), si.TransDate, 120) AS Bulan, SUM(si.Netto) AS Total
      FROM SalesInvoice si
      WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma, 0) = 0
        AND si.TransDate >= @awal AND si.TransDate < @akhir
      GROUP BY CONVERT(varchar(7), si.TransDate, 120)
    `),
    req().query(`
      SELECT CONVERT(varchar(7), sp.TransDate, 120) AS Bulan, SUM(sp.Amount) AS Total
      FROM SalesPayment sp
      WHERE sp.IsDeleted = 0 AND sp.TransDate >= @awal AND sp.TransDate < @akhir
      GROUP BY CONVERT(varchar(7), sp.TransDate, 120)
    `),
  ]);
  const peta = (rows: { Bulan: string; Total: number | null }[]) => new Map(rows.map((r) => [r.Bulan, Number(r.Total ?? 0)]));
  const j = peta(jual.recordset);
  const b = peta(bayar.recordset);
  return kunci.map((month) => {
    const piutangBaru = j.get(month) ?? 0;
    const piutangPembayaran = b.get(month) ?? 0;
    return { month, piutangBaru, piutangPembayaran, piutangTarikan: 0, netMovement: piutangBaru - piutangPembayaran };
  });
}
