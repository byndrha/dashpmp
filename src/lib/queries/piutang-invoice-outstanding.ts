// src/lib/queries/piutang-invoice-outstanding.ts
import { sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "@/lib/queries/mitra-es-balok";
import { branchFilterFor } from "@/lib/queries/piutang-pembayaran";
import { ownBranchFilter } from "@/lib/queries/penjualan-piutang";
import {
  getAgenBaselineNet,
  getAgenRoster,
  getPemesananNetByAgenBefore,
  getPembayaranNetByAgenBefore,
  type AgenNetRow,
} from "@/lib/queries/penjualan-piutang";
import type { Segmentasi } from "@/lib/segmentasi-mitra";

// This module exists because Es Balok's data model has no invoice-level
// link between PMP_Pembayaran (payment) and PMP_Pemesanan (order) -- unlike
// MKEsindo's vCustomerStatement, which already matches each SalesPayment to
// a specific SalesInvoiceID and gives each invoice an explicit DueDate. See
// docs/superpowers/specs/2026-09-27-piutang-es-balok-mkesindo-style.md
// ("Kendala model data") for the full rationale. What follows is a FIFO
// APPROXIMATION, confirmed with the user: per (kode, sumber, AgenID), sort
// PMP_Pemesanan oldest-first and "absorb" the Agen's total Pembayaran
// (NEVER Tarikan -- Tarikan increases debt, it does not settle an order)
// against them oldest-to-newest until the payment pool runs out. Whatever
// is left unabsorbed on each order is that order's "Invoice Outstanding"
// row. "Jatuh tempo" (due date) is likewise an assumption, not an ERP fact:
// Tanggal + 14 days.

import {
  esBalokAgingBucket,
  esBalokStatus,
  ES_BALOK_JATUH_TEMPO_HARI,
  type EsBalokAgingBucket,
  type EsBalokPiutangStatus,
} from "@/lib/piutang-es-balok-status";
export { esBalokAgingBucket, esBalokStatus, type EsBalokAgingBucket, type EsBalokPiutangStatus };

export interface EsBalokInvoiceRow {
  agenId: string;
  agenNama: string;
  segmentasi: Segmentasi | null;
  sumber: SumberAgen;
  noDokumen: string;
  tanggal: string; // ISO date (yyyy-MM-dd)
  outstanding: number;
  daysOverdue: number;
  agingBucket: EsBalokAgingBucket;
  status: EsBalokPiutangStatus;
}

// Cutoff passed as the "before" bound to getPemesananNetByAgenBefore/
// getPembayaranNetByAgenBefore so they return each Agen's TOTAL net-to-date
// (every real row's Tanggal is always < this), matching what the
// now-unused unbounded getPemesananNetByAgen/getPembayaranNetByAgen would
// have returned -- without needing those non-exported functions. NOT the
// JS max representable Date (8640000000000000ms, year 275760): that value
// overflows SQL Server's `datetime` column range (max 9999-12-31) and the
// mssql driver rejects it as an out-of-range parameter before the query
// even runs (confirmed live). 9999-12-31 is the actual max valid value.
const MAX_DATE = new Date(9999, 11, 31);

// Roster-narrowing step: only Agen with a currently-positive net balance in
// THIS SPECIFIC SOURCE are worth fetching per-row data for. Same purpose
// (and same production incident being avoided -- see getPiutangPerAgen's
// own comments in penjualan-piutang.ts) as getPiutangSummary/
// getPiutangPerAgen's existing roster-narrowing pattern; this MUST run
// before Part B's per-row fetch, not after, or Part B still fetches every
// Agen's raw rows.
//
// FIXED (code review, per-source data-loss bug): an earlier version of this
// function combined utama+logistik net into ONE map before filtering,
// which silently dropped any Agen whose two sources have opposite-signed
// balances (e.g. utama = -100 credit, logistik = +50 real debt -> combined
// = -50 -> filtered out entirely, so getRawFifoInputs never even fetched
// that Agen's logistik rows and the genuinely-outstanding +50 never became
// an EsBalokInvoiceRow). This is exactly the same per-source-independence
// principle the FIFO loop itself already respects (utama and logistik are
// legally separate PTs, one can never offset the other -- see
// bayarPiutang/tarikPiutang in piutang-pembayaran.ts) -- the roster filter
// must respect it too, or it undoes the FIFO's own correctness before the
// FIFO ever runs. Returns one Agen-ID list PER source, each filtered using
// only that source's own baseline+Pesanan+Pembayaran net.
async function getAgenIdsWithPositiveBalance(kode: string): Promise<Record<SumberAgen, string[]>> {
  const sources: SumberAgen[] = ["utama", "logistik"];
  const [baselineBySource, pemesananNetBySource, pembayaranNetBySource] = await Promise.all([
    Promise.all(sources.map((s) => getAgenBaselineNet(kode, s))),
    Promise.all(sources.map((s) => getPemesananNetByAgenBefore(kode, s, MAX_DATE))),
    Promise.all(sources.map((s) => getPembayaranNetByAgenBefore(kode, s, MAX_DATE))),
  ]);

  const result: Record<SumberAgen, string[]> = { utama: [], logistik: [] };
  sources.forEach((sumber, i) => {
    const netByAgen = new Map<string, number>();
    function addNet(agenId: string, delta: number) {
      netByAgen.set(agenId, (netByAgen.get(agenId) ?? 0) + delta);
    }
    for (const rows of [baselineBySource[i], pemesananNetBySource[i], pembayaranNetBySource[i]] as AgenNetRow[][]) {
      for (const r of rows) addNet(r.AgenID, r.Net);
    }
    for (const [agenId, net] of netByAgen) {
      if (net > 0) result[sumber].push(agenId);
    }
  });
  return result;
}

interface PesananRawRow {
  AgenID: string;
  NoDokumen: string;
  Tanggal: Date;
  NetValue: number;
}

interface PembayaranTotalRow {
  AgenID: string;
  TotalPembayaran: number;
}

// Raw (unaggregated) Pesanan rows and per-Agen combined Pembayaran totals
// for ONE source, filtered to the Part A Agen set -- this is the only
// per-row fetch in the whole module, and it is bounded to at most a few
// dozen Agen (positive-balance ones), not the whole roster.
//
// DEVIATION FROM THE TASK BRIEF'S LITERAL STEP 3 SQL, found during live-data
// verification (Step 6) and confirmed by inspecting individual rows: the
// brief's plan (and this function's own first draft) assumed
// PMP_Pemesanan's own `Pembayaran` column is a down payment tied ONLY to
// that specific order, to be subtracted from that row's own NetValue before
// FIFO even sees it. Live row-level inspection for Agen "0120"/utama
// disproved this -- e.g. order "PMP/SO/000401/2018-01/GE/HO" has a gross
// order value of Rp80.500 but Pembayaran=Rp878.500 on that SAME row, ~11x
// the order's own value. This column is really a LUMP-SUM payment the ERP
// happens to record against whichever Pemesanan row is current that day --
// functionally identical to a PMP_Pembayaran table row, not a per-order
// down payment. Treating it as row-scoped (subtract-and-discard-excess)
// throws away most of it as "excess", which is why the first fix attempt
// still overstated company-wide outstanding ~14.6x (Rp5.1 miliar vs the
// ERP-validated getPiutangSummary().totalPiutangSaatIni of Rp349.093.830).
// The existing validated Net formula (getPemesananNetByAgen in
// penjualan-piutang.ts) treats it exactly this way too: it SUMS
// Pemesanan.Pembayaran across ALL of an Agen's rows and nets it against the
// SUM of gross order values, with no per-row pairing at all. This function
// now does the same: NetValue below is net of Retur ONLY (the brief's
// original, unmodified formula), and Pemesanan.Pembayaran is pooled
// together with PMP_Pembayaran.Pembayaran into ONE combined payment pool
// that FIFO then allocates oldest-order-first (see
// getInvoiceOutstandingForSource below).
async function getRawFifoInputs(
  kode: string,
  sumber: SumberAgen,
  agenIds: string[]
): Promise<{ pesanan: PesananRawRow[]; pembayaranTotals: PembayaranTotalRow[] }> {
  if (agenIds.length === 0) return { pesanan: [], pembayaranTotals: [] };

  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = branchFilterFor(kode, sumber);

  const idParams = agenIds.map((_, i) => `@agen${i}`);
  const buildIdInputs = (request: sql.Request) => {
    agenIds.forEach((id, i) => request.input(`agen${i}`, sql.VarChar(16), id));
    if (branchId) request.input("branchId", sql.VarChar(16), branchId);
  };

  const pesananRequest = pool.request();
  buildIdInputs(pesananRequest);
  const pesananResult = await pesananRequest.query(`
    SELECT AgenID, NoDokumen, Tanggal,
      (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga
        + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga AS NetValue
    FROM PMP_Pemesanan
    WHERE IsDeleted = 0 AND AgenID IN (${idParams.join(", ")})
      ${branchId ? "AND BranchID = @branchId" : ""}
  `);

  const pesananPembayaranRequest = pool.request();
  buildIdInputs(pesananPembayaranRequest);
  const pesananPembayaranResult = await pesananPembayaranRequest.query(`
    SELECT AgenID, SUM(ISNULL(Pembayaran,0)) AS TotalPembayaran
    FROM PMP_Pemesanan
    WHERE IsDeleted = 0 AND AgenID IN (${idParams.join(", ")})
      ${branchId ? "AND BranchID = @branchId" : ""}
    GROUP BY AgenID
  `);

  const pembayaranRequest = pool.request();
  buildIdInputs(pembayaranRequest);
  const pembayaranResult = await pembayaranRequest.query(`
    SELECT AgenID, SUM(ISNULL(Pembayaran,0)) AS TotalPembayaran
    FROM PMP_Pembayaran
    WHERE IsDeleted = 0 AND AgenID IN (${idParams.join(", ")})
      ${branchId ? "AND BranchID = @branchId" : ""}
    GROUP BY AgenID
  `);

  const combinedPembayaran = new Map<string, number>();
  for (const r of pesananPembayaranResult.recordset as PembayaranTotalRow[]) {
    combinedPembayaran.set(r.AgenID, (combinedPembayaran.get(r.AgenID) ?? 0) + r.TotalPembayaran);
  }
  for (const r of pembayaranResult.recordset as PembayaranTotalRow[]) {
    combinedPembayaran.set(r.AgenID, (combinedPembayaran.get(r.AgenID) ?? 0) + r.TotalPembayaran);
  }

  return {
    pesanan: pesananResult.recordset as PesananRawRow[],
    pembayaranTotals: [...combinedPembayaran.entries()].map(([AgenID, TotalPembayaran]) => ({ AgenID, TotalPembayaran })),
  };
}

function daysOverdueFor(tanggal: Date): number {
  const dueDate = tanggal.getTime() + ES_BALOK_JATUH_TEMPO_HARI * 86400000;
  return Math.floor((Date.now() - dueDate) / 86400000);
}

async function getInvoiceOutstandingForSource(
  kode: string,
  sumber: SumberAgen,
  agenIds: string[],
  rosterByAgenId: Map<string, { nama: string; segmentasi: Segmentasi | null }>
): Promise<EsBalokInvoiceRow[]> {
  const { pesanan, pembayaranTotals } = await getRawFifoInputs(kode, sumber, agenIds);

  const totalPembayaranByAgen = new Map<string, number>();
  for (const r of pembayaranTotals) totalPembayaranByAgen.set(r.AgenID, r.TotalPembayaran);

  const pesananByAgen = new Map<string, PesananRawRow[]>();
  for (const p of pesanan) {
    const list = pesananByAgen.get(p.AgenID) ?? [];
    list.push(p);
    pesananByAgen.set(p.AgenID, list);
  }

  const rows: EsBalokInvoiceRow[] = [];
  for (const [agenId, group] of pesananByAgen) {
    const pesananSortedAsc = [...group].sort((a, b) => new Date(a.Tanggal).getTime() - new Date(b.Tanggal).getTime());
    let remainingPayment = totalPembayaranByAgen.get(agenId) ?? 0;

    for (const p of pesananSortedAsc) {
      if (p.NetValue <= 0) continue; // fully-retur'd order never enters FIFO
      const consumed = Math.min(remainingPayment, p.NetValue);
      remainingPayment -= consumed;
      const outstanding = p.NetValue - consumed;
      if (outstanding > 0.01) {
        const tanggal = new Date(p.Tanggal);
        const daysOverdue = daysOverdueFor(tanggal);
        const roster = rosterByAgenId.get(agenId);
        rows.push({
          agenId,
          agenNama: roster?.nama ?? agenId,
          segmentasi: roster?.segmentasi ?? null,
          sumber,
          noDokumen: p.NoDokumen,
          tanggal: tanggal.toISOString().slice(0, 10),
          outstanding,
          daysOverdue,
          agingBucket: esBalokAgingBucket(daysOverdue),
          status: esBalokStatus(daysOverdue),
        });
      }
    }
  }
  return rows;
}

export async function getEsBalokInvoiceOutstanding(kode: string): Promise<EsBalokInvoiceRow[]> {
  const sources: SumberAgen[] = ["utama", "logistik"];

  const [agenIdsBySource, roster] = await Promise.all([getAgenIdsWithPositiveBalance(kode), getAgenRoster(kode)]);

  const rosterByAgenId = new Map<string, { nama: string; segmentasi: Segmentasi | null }>();
  for (const r of roster) rosterByAgenId.set(r.AgenID, { nama: r.Nama, segmentasi: r.Segmentasi });

  const bySource = await Promise.all(
    sources.map((s) => getInvoiceOutstandingForSource(kode, s, agenIdsBySource[s], rosterByAgenId))
  );
  return bySource.flat();
}

// totalOutstanding/ratioPiutangOmzetPct were REMOVED from this interface
// per SDD ruling (see this module's own note below getEsBalokPiutangPeriodSummary):
// a FIFO-summed, per-source total can never be made to equal
// getPiutangSummary's totalPiutangSaatIni (which nets utama+logistik
// together per Agen) whenever an Agen has opposite-signed source balances --
// that was a genuine plan defect (Review Focus #5), not a bug in this
// file's FIFO. The "Total Piutang Outstanding" KPI now reads
// getPiutangSummary's totalPiutangSaatIni directly instead.
export interface EsBalokPeriodSummary {
  saldoAwalPeriode: number;
  // Hutang (jumlah saldo bersih positif per Agen) di akhir periode — dasar
  // yang sama dengan saldoAwalPeriode & Total Piutang.
  saldoAkhirPeriode: number;
  totalPembayaranPeriode: number;
  totalTarikanPeriode: number;
  totalPenjualanPeriode: number;
  sudahJatuhTempo: number;
  kritisNominal: number;
}

// Pembayaran periode = PMP_Pembayaran.Pembayaran + PMP_Pemesanan.Pembayaran —
// rumus yang sama dengan kolom "Pembayaran" tabel Tren Pergerakan Piutang
// Bulanan (getPiutangSummary, dikonfirmasi benar 2026-11-22). Versi lama
// hanya membaca PMP_Pembayaran, sehingga lebih kecil dari tabel tren.
async function getPembayaranPeriodTotal(
  kode: string,
  sumber: SumberAgen,
  start: Date,
  end: Date
): Promise<{ pembayaran: number; tarikan: number }> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = ownBranchFilter(kode, sumber);
  const req = () => {
    const r = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
    if (branchId) r.input("branchId", sql.VarChar(16), branchId);
    return r;
  };
  const filterCabang = branchId ? "AND BranchID = @branchId" : "";
  const [bayar, pesanan] = await Promise.all([
    req().query(`
      SELECT SUM(ISNULL(Pembayaran,0)) AS Pembayaran, SUM(ISNULL(Tarikan,0)) AS Tarikan
      FROM PMP_Pembayaran
      WHERE IsDeleted = 0 AND Tanggal >= @start AND Tanggal < @end ${filterCabang}
    `),
    req().query(`
      SELECT SUM(ISNULL(Pembayaran,0)) AS Pembayaran
      FROM PMP_Pemesanan
      WHERE IsDeleted = 0 AND Tanggal >= @start AND Tanggal < @end ${filterCabang}
    `),
  ]);
  const b = bayar.recordset[0] as { Pembayaran: number | null; Tarikan: number | null };
  const p = pesanan.recordset[0] as { Pembayaran: number | null };
  return { pembayaran: (b.Pembayaran ?? 0) + (p.Pembayaran ?? 0), tarikan: b.Tarikan ?? 0 };
}

async function getPenjualanPeriodTotal(kode: string, sumber: SumberAgen, start: Date, end: Date): Promise<number> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = branchFilterFor(kode, sumber);
  const request = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);
  const result = await request.query(`
    SELECT SUM(
      (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga
      + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga
    ) AS Total
    FROM PMP_Pemesanan
    WHERE IsDeleted = 0 AND Tanggal >= @start AND Tanggal < @end
      ${branchId ? "AND BranchID = @branchId" : ""}
  `);
  return (result.recordset[0] as { Total: number | null }).Total ?? 0;
}

export async function getEsBalokPiutangPeriodSummary(
  kode: string,
  start: Date,
  end: Date,
  invoiceRows: EsBalokInvoiceRow[]
): Promise<EsBalokPeriodSummary> {
  const sources: SumberAgen[] = ["utama", "logistik"];

  const [
    baselineBySource,
    pemesananBeforeBySource,
    pembayaranBeforeBySource,
    pembayaranPeriodBySource,
    penjualanPeriodBySource,
    pemesananSebelumAkhir,
    pembayaranSebelumAkhir,
  ] =
    await Promise.all([
      Promise.all(sources.map((s) => getAgenBaselineNet(kode, s))),
      Promise.all(sources.map((s) => getPemesananNetByAgenBefore(kode, s, start))),
      Promise.all(sources.map((s) => getPembayaranNetByAgenBefore(kode, s, start))),
      Promise.all(sources.map((s) => getPembayaranPeriodTotal(kode, s, start, end))),
      Promise.all(sources.map((s) => getPenjualanPeriodTotal(kode, s, start, end))),
      Promise.all(sources.map((s) => getPemesananNetByAgenBefore(kode, s, end))),
      Promise.all(sources.map((s) => getPembayaranNetByAgenBefore(kode, s, end))),
    ]);

  // Saldo Awal Periode: same baseline+net-before-cutoff pattern as
  // getPiutangSummary's own totalPiutangSaatIni loop (sum only the
  // POSITIVE per-Agen nets), just with the caller's `start` as the cutoff
  // instead of "now" -- per Review Focus #3, deliberately NOT
  // reimplemented from scratch.
  const netByAgen = new Map<string, number>();
  function addNet(agenId: string, delta: number) {
    netByAgen.set(agenId, (netByAgen.get(agenId) ?? 0) + delta);
  }
  for (const rows of [...baselineBySource, ...pemesananBeforeBySource, ...pembayaranBeforeBySource] as AgenNetRow[][]) {
    for (const r of rows) addNet(r.AgenID, r.Net);
  }
  let saldoAwalPeriode = 0;
  for (const net of netByAgen.values()) {
    if (net >= 0) saldoAwalPeriode += net;
  }

  const netAkhir = new Map<string, number>();
  for (const rows of [...baselineBySource, ...pemesananSebelumAkhir, ...pembayaranSebelumAkhir] as AgenNetRow[][]) {
    for (const r of rows) netAkhir.set(r.AgenID, (netAkhir.get(r.AgenID) ?? 0) + r.Net);
  }
  let saldoAkhirPeriode = 0;
  for (const net of netAkhir.values()) if (net > 0) saldoAkhirPeriode += net;

  const totalPembayaranPeriode = pembayaranPeriodBySource.reduce((s, v) => s + v.pembayaran, 0);
  const totalTarikanPeriode = pembayaranPeriodBySource.reduce((s, v) => s + v.tarikan, 0);
  const totalPenjualanPeriode = penjualanPeriodBySource.reduce((s, v) => s + v, 0);

  // sudahJatuhTempo/kritisNominal are FIFO-derived subtotals of
  // invoiceRows.outstanding -- informational numbers scoped to the Invoice
  // Outstanding view. They deliberately do NOT need to reconcile to
  // totalPiutangSaatIni or any other externally-validated total (see the
  // interface's own comment above).
  const sudahJatuhTempo = invoiceRows
    .filter((r) => r.agingBucket !== "Belum Jatuh Tempo")
    .reduce((s, r) => s + r.outstanding, 0);
  const kritisNominal = invoiceRows.filter((r) => r.agingBucket === ">90 Hari").reduce((s, r) => s + r.outstanding, 0);

  return {
    saldoAwalPeriode,
    saldoAkhirPeriode,
    totalPembayaranPeriode,
    totalTarikanPeriode,
    totalPenjualanPeriode,
    sudahJatuhTempo,
    kritisNominal,
  };
}

export interface EsBalokStatusBucket {
  status: EsBalokPiutangStatus;
  mitraCount: number;
  outstanding: number;
}

// Pure function, no DB access -- mirrors getPiutangStatusOverview
// (aging.ts:176-187): group per Agen (not per invoice), take each Agen's
// MAX daysOverdue among its own outstanding rows, derive ONE status for
// that Agen from that max, then bucket Agen (not rows) into the 3 statuses.
export function getEsBalokStatusOverview(rows: EsBalokInvoiceRow[]): EsBalokStatusBucket[] {
  const byAgen = new Map<string, EsBalokInvoiceRow[]>();
  for (const r of rows) {
    const list = byAgen.get(r.agenId) ?? [];
    list.push(r);
    byAgen.set(r.agenId, list);
  }

  const perAgen: { status: EsBalokPiutangStatus; outstanding: number }[] = [];
  for (const group of byAgen.values()) {
    const maxDaysOverdue = Math.max(...group.map((r) => r.daysOverdue));
    const outstanding = group.reduce((s, r) => s + r.outstanding, 0);
    perAgen.push({ status: esBalokStatus(maxDaysOverdue), outstanding });
  }

  return (["Kritis", "Perhatian", "Sehat"] as EsBalokPiutangStatus[]).map((status) => {
    const matching = perAgen.filter((a) => a.status === status);
    return {
      status,
      mitraCount: matching.length,
      outstanding: matching.reduce((s, a) => s + a.outstanding, 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Rincian selisih Sisa Hutang (kartu per Agen) vs total pesanan belum lunas
// (FIFO di atas). Selisih itu BUKAN galat: Sisa Hutang = saldo awal ERP +
// pesanan bersih − pembayaran + tarikan (dijumlah utama+logistik, sampai
// tanggal akhir periode), sedangkan FIFO hanya mengalokasikan pembayaran ke
// pesanan bernilai positif, per sumber, sepanjang masa. Per sumber s yang
// ikut FIFO berlaku identitas:
//   Net_s − FIFO_s = SaldoAwal_s + Tarikan_s + (P_s − P⁺_s) − max(0, Bayar_s − P⁺_s)
// (P = nilai bersih semua pesanan, P⁺ = hanya yang bernilai positif, Bayar =
// Pemesanan.Pembayaran + PMP_Pembayaran.Pembayaran). Sumber yang saldonya
// tidak positif tidak ikut FIFO sama sekali, jadi seluruh saldonya masuk
// selisih. Transaksi bertanggal >= akhir periode ada di FIFO tetapi tidak
// di Sisa Hutang kartu. Sisa yang tak terurai (mis. beda filter cabang)
// dihitung di klien sebagai "Lainnya".
export interface DokumenSelisih {
  noDokumen: string;
  tanggal: string | null; // yyyy-MM-dd (tanggal ERP, naive WIB)
  nilai: number;
  jenis: "Pemesanan" | "Pembayaran" | "Tarikan" | "Bayar di pesanan";
}

export interface KomponenSelisih {
  label: string;
  nilai: number; // + menambah Sisa Hutang di atas total pesanan belum lunas
  keterangan?: string;
  // Dokumen pembentuk komponen ini (terbaru dulu, maks. BATAS_DOKUMEN);
  // `jumlahDokumen` = jumlah sebenarnya bila daftar dipotong.
  dokumen?: DokumenSelisih[];
  jumlahDokumen?: number;
}

const LABEL_SUMBER: Record<SumberAgen, string> = { utama: "utama", logistik: "logistik" };
const BATAS_DOKUMEN = 12;

interface BarisPesanan {
  NoDokumen: string;
  Tanggal: Date;
  NetValue: number;
  Pembayaran: number;
}
interface BarisPembayaran {
  NoDokumen: string;
  Tanggal: Date;
  Pembayaran: number;
  Tarikan: number;
}

const isoTanggal = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// Pembayaran (PMP_Pembayaran + pembayaran yang dicatat langsung di pesanan)
// yang TIDAK tertampung tagihan: pembayaran melunasi yang tertua dulu, jadi
// kelebihan sebesar `lebih` ada di pembayaran-pembayaran TERBARU. Pembayaran
// terakhir yang hanya sebagian lebih dicatat sebesar bagian lebihnya saja.
function pembayaranBerlebih(pesanan: BarisPesanan[], bayar: BarisPembayaran[], lebih: number): DokumenSelisih[] {
  const semua: DokumenSelisih[] = [
    ...bayar
      .filter((r) => Number(r.Pembayaran) > 0)
      .map((r) => ({ noDokumen: r.NoDokumen, tanggal: isoTanggal(r.Tanggal), nilai: Number(r.Pembayaran), jenis: "Pembayaran" as const })),
    ...pesanan
      .filter((r) => Number(r.Pembayaran) > 0)
      .map((r) => ({ noDokumen: r.NoDokumen, tanggal: isoTanggal(r.Tanggal), nilai: Number(r.Pembayaran), jenis: "Bayar di pesanan" as const })),
  ].sort((x, y) => (y.tanggal ?? "").localeCompare(x.tanggal ?? ""));
  const hasil: DokumenSelisih[] = [];
  let sisa = lebih;
  for (const d of semua) {
    if (sisa < 1) break;
    const ambil = Math.min(sisa, d.nilai);
    hasil.push({ ...d, nilai: Math.round(ambil) });
    sisa -= ambil;
  }
  return hasil;
}

export async function getKomponenSelisihPiutang(kode: string, agenId: string, akhirEksklusif: Date): Promise<KomponenSelisih[]> {
  const sources: SumberAgen[] = ["utama", "logistik"];
  const perSumber = await Promise.all(
    sources.map(async (sumber) => {
      const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
      const pool = await getCompanyPool(physKode, label);
      const branchId = branchFilterFor(kode, sumber);
      const req = () => {
        const r = pool.request().input("agen", sql.VarChar(16), agenId);
        if (branchId) r.input("branchId", sql.VarChar(16), branchId);
        return r;
      };
      const filterCabang = branchId ? "AND BranchID = @branchId" : "";
      // Baris per dokumen (bukan SUM) supaya tiap komponen bisa menyebut
      // dokumen & tanggalnya; volumenya per Agen kecil (ratusan baris).
      const [awal, pesananRes, bayarRes] = await Promise.all([
        req().query(`SELECT SUM(PiutangSaldoAwal - TabunganSaldoAwal) AS Net FROM PMP_Agen WHERE IsDeleted = 0 AND AgenID = @agen`),
        req().query(`
          SELECT NoDokumen, Tanggal, ISNULL(Pembayaran,0) AS Pembayaran,
            (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga
              + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga AS NetValue
          FROM PMP_Pemesanan WHERE IsDeleted = 0 AND AgenID = @agen ${filterCabang}`),
        req().query(`
          SELECT NoDokumen, Tanggal, ISNULL(Pembayaran,0) AS Pembayaran, ISNULL(Tarikan,0) AS Tarikan
          FROM PMP_Pembayaran WHERE IsDeleted = 0 AND AgenID = @agen ${filterCabang}`),
      ]);
      const n = (v: unknown) => Number(v ?? 0) || 0;
      const pesanan = pesananRes.recordset as BarisPesanan[];
      const bayar = bayarRes.recordset as BarisPembayaran[];
      const saldoAwal = n(awal.recordset[0]?.Net);
      const P = pesanan.reduce((t, r) => t + n(r.NetValue), 0);
      const PPlus = pesanan.reduce((t, r) => t + Math.max(0, n(r.NetValue)), 0);
      const totalBayar = pesanan.reduce((t, r) => t + n(r.Pembayaran), 0) + bayar.reduce((t, r) => t + n(r.Pembayaran), 0);
      const tarikan = bayar.reduce((t, r) => t + n(r.Tarikan), 0);
      const net = saldoAwal + P - totalBayar + tarikan;
      const akhirMs = akhirEksklusif.getTime();
      const dokSetelahAkhir: DokumenSelisih[] = [
        ...pesanan
          .filter((r) => new Date(r.Tanggal).getTime() >= akhirMs && Math.abs(n(r.NetValue) - n(r.Pembayaran)) >= 1)
          .map((r) => ({ noDokumen: r.NoDokumen, tanggal: isoTanggal(r.Tanggal), nilai: Math.round(n(r.NetValue) - n(r.Pembayaran)), jenis: "Pemesanan" as const })),
        ...bayar
          .filter((r) => new Date(r.Tanggal).getTime() >= akhirMs && Math.abs(n(r.Tarikan) - n(r.Pembayaran)) >= 1)
          .map((r) => ({
            noDokumen: r.NoDokumen,
            tanggal: isoTanggal(r.Tanggal),
            nilai: Math.round(n(r.Tarikan) - n(r.Pembayaran)),
            jenis: (n(r.Tarikan) > 0 ? "Tarikan" : "Pembayaran") as DokumenSelisih["jenis"],
          })),
      ];
      const setelahAkhir = dokSetelahAkhir.reduce((t, d) => t + d.nilai, 0);
      return { sumber, saldoAwal, P, PPlus, totalBayar, tarikan, net, setelahAkhir, pesanan, bayar, dokSetelahAkhir };
    })
  );

  const urutTerbaru = (d: DokumenSelisih[]) => [...d].sort((x, y) => (y.tanggal ?? "").localeCompare(x.tanggal ?? ""));
  const komponen: KomponenSelisih[] = [];
  const tambah = (label: string, nilai: number, keterangan?: string, dokumen?: DokumenSelisih[]) => {
    if (Math.abs(nilai) < 1) return;
    const urut = dokumen ? urutTerbaru(dokumen) : undefined;
    komponen.push({
      label,
      nilai: Math.round(nilai),
      keterangan,
      dokumen: urut?.slice(0, BATAS_DOKUMEN),
      jumlahDokumen: urut?.length,
    });
  };
  for (const s of perSumber) {
    const nama = LABEL_SUMBER[s.sumber];
    const adaData = s.saldoAwal !== 0 || s.P !== 0 || s.totalBayar !== 0 || s.tarikan !== 0;
    if (!adaData) continue;
    if (s.net <= 0) {
      // Tidak ikut FIFO: seluruh saldo sumber ini (biasanya tabungan) masuk selisih.
      tambah(
        `Saldo ${nama} (tidak dialokasikan ke pesanan)`,
        s.net,
        s.net < 0
          ? `Tabungan/kelebihan bayar di database ini mengurangi Sisa Hutang gabungan${
              s.saldoAwal < 0 ? ` (termasuk tabungan awal ERP ${formatRupiahPolos(-s.saldoAwal)})` : ""
            }.`
          : undefined,
        s.net < 0 ? pembayaranBerlebih(s.pesanan, s.bayar, -s.net - Math.max(0, -s.saldoAwal)) : undefined
      );
      continue;
    }
    tambah(`Saldo awal ERP (${nama})`, s.saldoAwal, "Piutang/tabungan awal yang dicatat di data Agen, bukan dari dokumen bertanggal.");
    tambah(
      `Tarikan tabungan (${nama})`,
      s.tarikan,
      "Tarikan menambah hutang tetapi tidak terikat ke pesanan.",
      s.bayar
        .filter((r) => Number(r.Tarikan) > 0)
        .map((r) => ({ noDokumen: r.NoDokumen, tanggal: isoTanggal(r.Tanggal), nilai: Math.round(Number(r.Tarikan)), jenis: "Tarikan" as const }))
    );
    tambah(
      `Retur melebihi pesanan (${nama})`,
      s.P - s.PPlus,
      "Pesanan yang nilai bersihnya negatif setelah retur.",
      s.pesanan
        .filter((r) => Number(r.NetValue) < 0)
        .map((r) => ({ noDokumen: r.NoDokumen, tanggal: isoTanggal(r.Tanggal), nilai: Math.round(Number(r.NetValue)), jenis: "Pemesanan" as const }))
    );
    const lebih = Math.max(0, s.totalBayar - s.PPlus);
    tambah(
      `Kelebihan bayar (${nama})`,
      -lebih,
      "Pembayaran melebihi seluruh pesanan, jadi tidak ada pesanan yang menampungnya.",
      pembayaranBerlebih(s.pesanan, s.bayar, lebih)
    );
  }
  const sumberFifo = perSumber.filter((s) => s.net > 0);
  tambah(
    "Transaksi setelah tanggal akhir periode",
    -sumberFifo.reduce((t, s) => t + s.setelahAkhir, 0),
    "Sudah masuk daftar pesanan belum lunas, belum masuk Sisa Hutang periode ini.",
    sumberFifo.flatMap((s) => s.dokSetelahAkhir)
  );
  return komponen;
}

function formatRupiahPolos(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}
