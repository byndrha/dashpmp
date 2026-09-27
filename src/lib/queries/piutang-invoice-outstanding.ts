// src/lib/queries/piutang-invoice-outstanding.ts
import { sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "@/lib/queries/mitra-es-balok";
import { branchFilterFor } from "@/lib/queries/piutang-pembayaran";
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

export type EsBalokAgingBucket = "Belum Jatuh Tempo" | "1-30 Hari" | "31-60 Hari" | "61-90 Hari" | ">90 Hari";

export type EsBalokPiutangStatus = "Sehat" | "Perhatian" | "Kritis";

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

// Ported verbatim from aging.ts:95-101's CASE thresholds (same bucket
// boundaries, same DATEDIFF(DAY, ..., GETDATE()) semantics -- daysOverdue
// here already IS that DATEDIFF value, computed in JS at call sites below).
export function esBalokAgingBucket(daysOverdue: number): EsBalokAgingBucket {
  if (daysOverdue <= 0) return "Belum Jatuh Tempo";
  if (daysOverdue <= 30) return "1-30 Hari";
  if (daysOverdue <= 60) return "31-60 Hari";
  if (daysOverdue <= 90) return "61-90 Hari";
  return ">90 Hari";
}

// Ported verbatim from aging.ts:50-55's STATUS_CASE (Sehat <=30, Perhatian
// <=60, else Kritis) and getPiutangStatusOverview's MaxDaysOverdue IS NULL
// -> 'Sehat' branch (aging.ts:163).
export function esBalokStatus(daysOverdue: number | null): EsBalokPiutangStatus {
  if (daysOverdue === null) return "Sehat";
  if (daysOverdue <= 30) return "Sehat";
  if (daysOverdue <= 60) return "Perhatian";
  return "Kritis";
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

// Roster-narrowing step: only Agen with a currently-positive net balance
// are worth fetching per-row data for. Same purpose (and same production
// incident being avoided -- see getPiutangPerAgen's own comments in
// penjualan-piutang.ts) as getPiutangSummary/getPiutangPerAgen's existing
// roster-narrowing pattern; this MUST run before Part B's per-row fetch,
// not after, or Part B still fetches every Agen's raw rows.
async function getAgenIdsWithPositiveBalance(kode: string): Promise<Set<string>> {
  const sources: SumberAgen[] = ["utama", "logistik"];
  const [baselineBySource, pemesananNetBySource, pembayaranNetBySource] = await Promise.all([
    Promise.all(sources.map((s) => getAgenBaselineNet(kode, s))),
    Promise.all(sources.map((s) => getPemesananNetByAgenBefore(kode, s, MAX_DATE))),
    Promise.all(sources.map((s) => getPembayaranNetByAgenBefore(kode, s, MAX_DATE))),
  ]);

  const netByAgen = new Map<string, number>();
  function addNet(agenId: string, delta: number) {
    netByAgen.set(agenId, (netByAgen.get(agenId) ?? 0) + delta);
  }
  for (const rows of [...baselineBySource, ...pemesananNetBySource, ...pembayaranNetBySource] as AgenNetRow[][]) {
    for (const r of rows) addNet(r.AgenID, r.Net);
  }

  const positive = new Set<string>();
  for (const [agenId, net] of netByAgen) {
    if (net > 0) positive.add(agenId);
  }
  return positive;
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
  const dueDate = tanggal.getTime() + 14 * 86400000;
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

  const [positiveAgenIds, roster] = await Promise.all([getAgenIdsWithPositiveBalance(kode), getAgenRoster(kode)]);
  const agenIds = [...positiveAgenIds];

  const rosterByAgenId = new Map<string, { nama: string; segmentasi: Segmentasi | null }>();
  for (const r of roster) rosterByAgenId.set(r.AgenID, { nama: r.Nama, segmentasi: r.Segmentasi });

  const bySource = await Promise.all(sources.map((s) => getInvoiceOutstandingForSource(kode, s, agenIds, rosterByAgenId)));
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
  totalPembayaranPeriode: number;
  totalPenjualanPeriode: number;
  sudahJatuhTempo: number;
  kritisNominal: number;
}

async function getPembayaranPeriodTotal(kode: string, sumber: SumberAgen, start: Date, end: Date): Promise<number> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const branchId = branchFilterFor(kode, sumber);
  const request = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
  if (branchId) request.input("branchId", sql.VarChar(16), branchId);
  const result = await request.query(`
    SELECT SUM(ISNULL(Pembayaran,0)) AS Total
    FROM PMP_Pembayaran
    WHERE IsDeleted = 0 AND Tanggal >= @start AND Tanggal < @end
      ${branchId ? "AND BranchID = @branchId" : ""}
  `);
  return (result.recordset[0] as { Total: number | null }).Total ?? 0;
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

  const [baselineBySource, pemesananBeforeBySource, pembayaranBeforeBySource, pembayaranPeriodBySource, penjualanPeriodBySource] =
    await Promise.all([
      Promise.all(sources.map((s) => getAgenBaselineNet(kode, s))),
      Promise.all(sources.map((s) => getPemesananNetByAgenBefore(kode, s, start))),
      Promise.all(sources.map((s) => getPembayaranNetByAgenBefore(kode, s, start))),
      Promise.all(sources.map((s) => getPembayaranPeriodTotal(kode, s, start, end))),
      Promise.all(sources.map((s) => getPenjualanPeriodTotal(kode, s, start, end))),
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

  const totalPembayaranPeriode = pembayaranPeriodBySource.reduce((s, v) => s + v, 0);
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
    totalPembayaranPeriode,
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
