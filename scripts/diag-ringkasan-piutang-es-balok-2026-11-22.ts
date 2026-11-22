// Uji BACA-SAJA (2026-11-22): mengapa angka panel ringkasan Piutang Es Balok
// tidak saling cocok (Sudah Jatuh Tempo > Total Piutang; Kritis+Perhatian+
// Sehat ≈ 2× Total Piutang). Menghitung semua angka panel lalu mengurai
// selisih FIFO vs Total Piutang (getPiutangSummary, sudah dikonfirmasi benar)
// per jenis penyebab.
// Usage: npx tsx scripts/diag-ringkasan-piutang-es-balok-2026-11-22.ts [kode]
import "dotenv/config";
import { sql } from "../src/lib/db";
import { getCompanyPool } from "../src/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "../src/lib/queries/mitra-es-balok";
import { branchFilterFor } from "../src/lib/queries/piutang-pembayaran";
import { getPiutangSummary } from "../src/lib/queries/penjualan-piutang";
import { getEsBalokInvoiceOutstanding, getEsBalokStatusOverview } from "../src/lib/queries/piutang-invoice-outstanding";

const jt = (n: number) => `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;

interface Agg { saldoAwal: number; P: number; PPlus: number; bayar: number; tarikan: number }

async function aggSumber(kode: string, sumber: SumberAgen): Promise<Map<string, Agg>> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = branchFilterFor(kode, sumber);
  const f = branchId ? "AND BranchID = @b" : "";
  const r = () => {
    const q = pool.request();
    if (branchId) q.input("b", sql.VarChar(16), branchId);
    return q;
  };
  const [a, p, b] = await Promise.all([
    r().query(`SELECT AgenID, SUM(PiutangSaldoAwal - TabunganSaldoAwal) AS V FROM PMP_Agen WHERE IsDeleted = 0 GROUP BY AgenID`),
    r().query(`SELECT AgenID, SUM(NV) AS P, SUM(CASE WHEN NV > 0 THEN NV ELSE 0 END) AS PPlus, SUM(ISNULL(Pembayaran,0)) AS Bayar FROM (
      SELECT AgenID, Pembayaran, (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga AS NV
      FROM PMP_Pemesanan WHERE IsDeleted = 0 ${f}) x GROUP BY AgenID`),
    r().query(`SELECT AgenID, SUM(ISNULL(Pembayaran,0)) AS Bayar, SUM(ISNULL(Tarikan,0)) AS Tarikan FROM PMP_Pembayaran WHERE IsDeleted = 0 ${f} GROUP BY AgenID`),
  ]);
  const m = new Map<string, Agg>();
  const g = (id: string) => m.get(id) ?? (m.set(id, { saldoAwal: 0, P: 0, PPlus: 0, bayar: 0, tarikan: 0 }), m.get(id)!);
  for (const x of a.recordset) g(x.AgenID).saldoAwal += Number(x.V ?? 0);
  for (const x of p.recordset) { const o = g(x.AgenID); o.P += Number(x.P ?? 0); o.PPlus += Number(x.PPlus ?? 0); o.bayar += Number(x.Bayar ?? 0); }
  for (const x of b.recordset) { const o = g(x.AgenID); o.bayar += Number(x.Bayar ?? 0); o.tarikan += Number(x.Tarikan ?? 0); }
  return m;
}

async function main() {
  const kode = process.argv[2] ?? "pmputra";
  const [summary, rows, utama, logistik] = await Promise.all([
    getPiutangSummary(kode),
    getEsBalokInvoiceOutstanding(kode),
    aggSumber(kode, "utama"),
    aggSumber(kode, "logistik"),
  ]);
  const fifoTotal = rows.reduce((s, r) => s + r.outstanding, 0);
  const jatuhTempo = rows.filter((r) => r.agingBucket !== "Belum Jatuh Tempo").reduce((s, r) => s + r.outstanding, 0);
  const lebih90 = rows.filter((r) => r.agingBucket === ">90 Hari").reduce((s, r) => s + r.outstanding, 0);
  const status = getEsBalokStatusOverview(rows);
  console.log(`\n== ${kode} ==`);
  console.log("Total Piutang (netted, terkonfirmasi):", jt(summary.totalPiutangSaatIni), "| Tabungan:", jt(summary.totalTabunganSaatIni));
  console.log("FIFO total pesanan belum lunas:", jt(fifoTotal), "| Sudah jatuh tempo:", jt(jatuhTempo), "| >90 hari:", jt(lebih90));
  console.log("Status:", status.map((s) => `${s.status} ${s.mitraCount} mitra ${jt(s.outstanding)}`).join(" · "));

  // Net gabungan per Agen (sama dengan getPiutangSummary) & FIFO per Agen.
  const ids = new Set([...utama.keys(), ...logistik.keys()]);
  const fifoByAgen = new Map<string, number>();
  for (const r of rows) fifoByAgen.set(r.agenId, (fifoByAgen.get(r.agenId) ?? 0) + r.outstanding);
  const sebab: Record<string, number> = {};
  const tambah = (k: string, v: number) => (sebab[k] = (sebab[k] ?? 0) + v);
  let fifoAgenTabungan = 0, nAgenTabungan = 0, positifTanpaFifo = 0;
  for (const id of ids) {
    const net = [utama.get(id), logistik.get(id)].reduce((t, s) => t + (s ? s.saldoAwal + s.P - s.bayar + s.tarikan : 0), 0);
    const fifo = fifoByAgen.get(id) ?? 0;
    if (net <= 0) {
      if (fifo > 0) { fifoAgenTabungan += fifo; nAgenTabungan++; }
      continue;
    }
    if (fifo === 0) positifTanpaFifo += net;
    // komponen (Net − FIFO) per sumber — sama dengan getKomponenSelisihPiutang
    for (const [nama, m] of [["utama", utama], ["logistik", logistik]] as const) {
      const s = m.get(id);
      if (!s) continue;
      const n = s.saldoAwal + s.P - s.bayar + s.tarikan;
      if (n <= 0) { tambah(`saldo ${nama} ≤0 (tdk ikut FIFO)`, n); continue; }
      tambah("saldo awal ERP", s.saldoAwal);
      tambah("tarikan", s.tarikan);
      tambah("retur > pesanan", s.P - s.PPlus);
      tambah("kelebihan bayar", -Math.max(0, s.bayar - s.PPlus));
    }
  }
  console.log(`FIFO milik Agen yg bersihnya TABUNGAN (tak masuk Total Piutang): ${jt(fifoAgenTabungan)} dari ${nAgenTabungan} agen`);
  console.log("Agen positif tanpa pesanan FIFO:", jt(positifTanpaFifo));
  console.log("Uraian (Net − FIFO) Agen ber-hutang:", Object.fromEntries(Object.entries(sebab).map(([k, v]) => [k, jt(v)])));
  const cek = summary.totalPiutangSaatIni - (fifoTotal - fifoAgenTabungan) - Object.values(sebab).reduce((a, b) => a + b, 0);
  console.log("Sisa tak terurai:", jt(cek));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
