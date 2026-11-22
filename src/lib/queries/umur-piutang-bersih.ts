// Umur piutang Es Balok atas dasar SALDO BERSIH per Agen — dasar yang sama
// dengan getPiutangSummary().totalPiutangSaatIni dan tabel "Tren Pergerakan
// Piutang Bulanan" (dikonfirmasi benar oleh pengguna 2026-11-22).
//
// Kenapa bukan getEsBalokInvoiceOutstanding (FIFO per sumber)? FIFO itu
// menghitung utama & logistik terpisah dan hanya dari pesanan, sehingga
// jumlahnya tidak pernah sama dengan Total Piutang (diukur 2026-11-22,
// scripts/diag-ringkasan-piutang-es-balok-2026-11-22.ts: PMPutra FIFO 601 jt
// vs Total Piutang 306 jt — 190 jt milik Agen yang bersihnya tabungan, tarikan
// 244 jt tak pernah masuk, dst.). Panel ringkasan yang menampilkan keduanya
// berdampingan jadi saling bertentangan.
//
// Aturan di sini: hutang bersih H Agen (> 0) = tagihan TERBARU yang belum
// tertutup pembayaran (pembayaran melunasi yang tertua dulu). Tagihan
// ("debit") = pesanan bernilai bersih positif + tarikan tabungan, dari utama
// & logistik digabung. H dialokasikan ke debit dari yang terbaru mundur;
// sisa H yang melebihi semua debit = saldo awal ERP (tanpa tanggal, dianggap
// tertua). Dengan begitu semua ember umur menjumlah TEPAT ke Total Piutang.
import { sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "@/lib/queries/mitra-es-balok";
import {
  getAgenBaselineNet,
  getPemesananNetByAgenBefore,
  getPembayaranNetByAgenBefore,
  ownBranchFilter,
} from "@/lib/queries/penjualan-piutang";
import {
  esBalokAgingBucket,
  esBalokStatus,
  ES_BALOK_JATUH_TEMPO_HARI,
  type EsBalokAgingBucket,
  type EsBalokPiutangStatus,
} from "@/lib/piutang-es-balok-status";

const MAX_DATE = new Date(9999, 11, 31);

export type EmberUmur = EsBalokAgingBucket | "Saldo Awal";

export interface UmurPiutangBersih {
  total: number; // = getPiutangSummary().totalPiutangSaatIni
  ember: { ember: EmberUmur; nominal: number }[];
  status: { status: EsBalokPiutangStatus; mitra: number; nominal: number }[];
  jumlahAgen: number;
}

export const URUTAN_EMBER: EmberUmur[] = ["Belum Jatuh Tempo", "1-30 Hari", "31-60 Hari", "61-90 Hari", ">90 Hari", "Saldo Awal"];

interface DebitRow {
  AgenID: string;
  Tanggal: Date;
  Jumlah: number;
}

// Debit terbaru per Agen yang cukup untuk menutup H Agen itu (running sum
// dari yang terbaru, dipotong begitu melewati H) — SATU query per sumber,
// tidak menarik seluruh riwayat Agen ke Node.
async function getDebitTerbaru(kode: string, sumber: SumberAgen, hutang: Map<string, number>): Promise<DebitRow[]> {
  if (hutang.size === 0) return [];
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = ownBranchFilter(kode, sumber);
  const request = pool.request();
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);
  const nilai: string[] = [];
  [...hutang.entries()].forEach(([agenId, h], i) => {
    request.input(`a${i}`, sql.VarChar(16), agenId);
    request.input(`h${i}`, sql.Decimal(19, 2), h);
    nilai.push(`(@a${i}, @h${i})`);
  });
  const filterCabang = branchId ? "AND BranchID = @branchId" : "";
  const result = await request.query(`
    WITH h AS (SELECT * FROM (VALUES ${nilai.join(", ")}) v(AgenID, H)),
    d AS (
      SELECT AgenID, Tanggal, NV AS Jumlah FROM (
        SELECT AgenID, Tanggal,
          (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga
            + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga AS NV
        FROM PMP_Pemesanan WHERE IsDeleted = 0 ${filterCabang}
      ) p WHERE NV > 0
      UNION ALL
      SELECT AgenID, Tanggal, Tarikan FROM PMP_Pembayaran
      WHERE IsDeleted = 0 AND ISNULL(Tarikan,0) > 0 ${filterCabang}
    ),
    r AS (
      SELECT d.AgenID, d.Tanggal, d.Jumlah, h.H,
        SUM(d.Jumlah) OVER (PARTITION BY d.AgenID ORDER BY d.Tanggal DESC ROWS UNBOUNDED PRECEDING) AS Kum
      FROM d JOIN h ON h.AgenID = d.AgenID
    )
    SELECT AgenID, Tanggal, Jumlah FROM r WHERE Kum - Jumlah < H
  `);
  return result.recordset as DebitRow[];
}

function hariLewatJatuhTempo(tanggal: Date): number {
  const jatuhTempo = new Date(tanggal).getTime() + ES_BALOK_JATUH_TEMPO_HARI * 86400000;
  return Math.floor((Date.now() - jatuhTempo) / 86400000);
}

export async function getUmurPiutangBersih(kode: string): Promise<UmurPiutangBersih> {
  const sources: SumberAgen[] = ["utama", "logistik"];

  // Hutang bersih per Agen — rumus identik dengan getPiutangSummary.
  const [baseline, pemesanan, pembayaran] = await Promise.all([
    Promise.all(sources.map((s) => getAgenBaselineNet(kode, s))),
    Promise.all(sources.map((s) => getPemesananNetByAgenBefore(kode, s, MAX_DATE))),
    Promise.all(sources.map((s) => getPembayaranNetByAgenBefore(kode, s, MAX_DATE))),
  ]);
  const net = new Map<string, number>();
  for (const rows of [...baseline, ...pemesanan, ...pembayaran]) {
    for (const r of rows) net.set(r.AgenID, (net.get(r.AgenID) ?? 0) + r.Net);
  }
  const hutang = new Map<string, number>();
  for (const [agenId, n] of net) if (n > 0) hutang.set(agenId, n);

  const debitPerSumber = await Promise.all(sources.map((s) => getDebitTerbaru(kode, s, hutang)));
  const debitPerAgen = new Map<string, DebitRow[]>();
  for (const rows of debitPerSumber) {
    for (const r of rows) {
      const list = debitPerAgen.get(r.AgenID) ?? [];
      list.push(r);
      debitPerAgen.set(r.AgenID, list);
    }
  }

  const ember = new Map<EmberUmur, number>(URUTAN_EMBER.map((e) => [e, 0]));
  const status = new Map<EsBalokPiutangStatus, { mitra: number; nominal: number }>([
    ["Sehat", { mitra: 0, nominal: 0 }],
    ["Perhatian", { mitra: 0, nominal: 0 }],
    ["Kritis", { mitra: 0, nominal: 0 }],
  ]);
  let total = 0;
  for (const [agenId, h] of hutang) {
    total += h;
    let sisa = h;
    let terburuk: number | null = null;
    const debit = (debitPerAgen.get(agenId) ?? []).sort((a, b) => new Date(b.Tanggal).getTime() - new Date(a.Tanggal).getTime());
    for (const d of debit) {
      if (sisa <= 0) break;
      const ambil = Math.min(sisa, Number(d.Jumlah));
      sisa -= ambil;
      const hari = hariLewatJatuhTempo(d.Tanggal);
      const e = esBalokAgingBucket(hari);
      ember.set(e, ember.get(e)! + ambil);
      terburuk = terburuk === null ? hari : Math.max(terburuk, hari);
    }
    if (sisa > 0.01) {
      // Melebihi semua tagihan bertanggal = saldo awal ERP (dianggap tertua).
      ember.set("Saldo Awal", ember.get("Saldo Awal")! + sisa);
      terburuk = Number.POSITIVE_INFINITY;
    }
    const st = esBalokStatus(terburuk === Number.POSITIVE_INFINITY ? 9999 : terburuk);
    const s = status.get(st)!;
    s.mitra += 1;
    s.nominal += h;
  }

  return {
    total,
    ember: URUTAN_EMBER.map((e) => ({ ember: e, nominal: ember.get(e)! })),
    status: (["Kritis", "Perhatian", "Sehat"] as EsBalokPiutangStatus[]).map((st) => ({ status: st, ...status.get(st)! })),
    jumlahAgen: hutang.size,
  };
}
