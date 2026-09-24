// src/lib/queries/penjualan-piutang.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "@/lib/queries/mitra-es-balok";

const MONTHS_BACK = 12;

// Rolling 12-month window ending at the current month (not a fixed
// calendar year, and not navigable -- this module has no year-picker UI,
// unlike HPPBersihPanel). `keys` gives the "yyyy-MM" key for every month in
// the window in order, so callers can build a dense array even for months
// with zero matching rows.
function monthsWindow(): { start: Date; end: Date; keys: string[] } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_BACK - 1), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const keys: string[] = [];
  for (let i = 0; i < MONTHS_BACK; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return { start, end, keys };
}

export interface PenjualanTrendMonth {
  month: string; // "2026-01"
  kantongKecil: number;
  kantongBesar: number;
  kantongTotal: number;
  pendapatanRp: number; // GL, utama + logistik combined
}

export interface PenjualanTrendData {
  months: PenjualanTrendMonth[];
  totalKantong12Bulan: number;
  totalPendapatan12Bulan: number;
}

// Physical kantong counts from PMP_Pemesanan -- same table/filter as the
// existing getMonthlyBalokRealisasi (hpp-bersih-pmputra.ts), already proven
// reliable. Never read this table's price/Rupiah columns (see plan Global
// Constraints).
async function getKantongByMonth(
  kode: string,
  label: CompanyKoneksiLabel,
  start: Date,
  end: Date
): Promise<Map<string, { kecil: number; besar: number }>> {
  const pool = await getCompanyPool(kode, label);
  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end)
    .query(`
      SELECT CONVERT(varchar(7), Tanggal, 120) AS Bulan,
             SUM(ISNULL(BalokKecilRealisasi,0)) AS Kecil,
             SUM(ISNULL(BalokBesarRealisasi,0)) AS Besar
      FROM PMP_Pemesanan
      WHERE Status = '3' AND ISNULL(IsVoid,0) = 0 AND ISNULL(IsDeleted,0) = 0
        AND Tanggal >= @start AND Tanggal < @end
      GROUP BY CONVERT(varchar(7), Tanggal, 120)
    `);
  const map = new Map<string, { kecil: number; besar: number }>();
  for (const r of result.recordset as { Bulan: string; Kecil: number; Besar: number }[]) {
    map.set(r.Bulan, { kecil: r.Kecil, besar: r.Besar });
  }
  return map;
}

// PMPersada's own branch code inside its shared "logistik" database
// (FINAC_PMP_LOGISTIC) -- that one database is also used by PMPakis
// (BranchID "011"), confirmed live 18 Sep 2026 via accounting cross-check.
// Every query against pmpersada+logistik must filter to this branch or its
// totals silently include PMPakis's own transactions too.
export const PMPERSADA_OWN_BRANCH_ID = "012";

interface PenjualanAccountConfig {
  kode: string;
  label: CompanyKoneksiLabel;
  accountNo: string;
  requiresBranchFilter?: boolean;
}

// Confirmed live with accounting at both PTs (17-18 Sep 2026) -- each row is
// 100% traceable to PMP_PEMESANAN (real ice-sales orders). Deliberately NOT
// a `LEFT(AccountNo,1) = '4'` prefix scan: that would also sum "Jasa
// Logistik"/"Jasa Logistik Luar" (armada-scheduling revenue, PMP_PENJADWALAN
// -tagged, unrelated to ice sales) and "Pendapatan Lain Lain" (non-core).
const PENJUALAN_ACCOUNTS: PenjualanAccountConfig[] = [
  { kode: "pmputra", label: "utama", accountNo: "4001" }, // "Pendapatan Balok Kecil"
  { kode: "pmputra", label: "utama", accountNo: "4002" }, // "Pendapatan Balok Besar"
  { kode: "pmputra", label: "logistik", accountNo: "4001" }, // "Pendapatan Reguler"
  { kode: "pmpersada", label: "utama", accountNo: "4004" }, // "Pendapatan Balok Kecil"
  { kode: "pmpersada", label: "utama", accountNo: "4005" }, // "Pendapatan Balok Besar"
  { kode: "pmpersada", label: "logistik", accountNo: "4001", requiresBranchFilter: true }, // "Pendapatan Reguler"
];

function getPenjualanAccounts(kode: string, label: CompanyKoneksiLabel): PenjualanAccountConfig[] {
  const entries = PENJUALAN_ACCOUNTS.filter((a) => a.kode === kode && a.label === label);
  if (entries.length === 0) throw new Error(`No Penjualan account configured for kode="${kode}" label="${label}"`);
  return entries;
}

// Pendapatan (revenue) from GeneralLedger, filtered to the exact
// PENJUALAN_ACCOUNTS whitelist for this (kode,label) -- same Credit-Debit
// sign convention pnl.ts/pnl-pmputra.ts already use for revenue accounts
// (credit-normal).
async function getPendapatanByMonth(
  kode: string,
  label: CompanyKoneksiLabel,
  start: Date,
  end: Date
): Promise<Map<string, number>> {
  const pool = await getCompanyPool(kode, label);
  const accounts = getPenjualanAccounts(kode, label);
  const requiresBranchFilter = accounts.some((a) => a.requiresBranchFilter);

  const request = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
  const accountParams = accounts.map((a, i) => {
    const paramName = `acc${i}`;
    request.input(paramName, sql.VarChar(16), a.accountNo);
    return `@${paramName}`;
  });
  if (requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);

  const result = await request.query(`
    SELECT CONVERT(varchar(7), gl.TransDate, 120) AS Bulan,
           SUM(gl.Credit - gl.Debit) AS Pendapatan
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo IN (${accountParams.join(", ")})
      AND gl.TransDate >= @start AND gl.TransDate < @end
      ${requiresBranchFilter ? "AND gl.BranchID = @branchId" : ""}
    GROUP BY CONVERT(varchar(7), gl.TransDate, 120)
  `);
  const map = new Map<string, number>();
  for (const r of result.recordset as { Bulan: string; Pendapatan: number }[]) {
    map.set(r.Bulan, r.Pendapatan);
  }
  return map;
}

export async function getPenjualanTrend(kode: string): Promise<PenjualanTrendData> {
  const { start, end, keys } = monthsWindow();

  // Kantong sengaja hanya dari "utama" (tidak digabung dengan "logistik" seperti Pendapatan
  // di bawah): verifikasi live membuktikan PMP_Pemesanan pmputra di utama dan logistik
  // mirror-duplicate data fisik yang sama (bukan dua order book independen) — menjumlahkan
  // keduanya akan double-count setiap kantong. Sama seperti precedent di
  // hpp-bersih-pmputra.ts / hpp-bersih-pmpersada.ts yang juga sumber kantong dari utama saja.
  const [kantongUtama, pendapatanUtama, pendapatanLogistik] = await Promise.all([
    getKantongByMonth(kode, "utama", start, end),
    getPendapatanByMonth(kode, "utama", start, end),
    getPendapatanByMonth(kode, "logistik", start, end),
  ]);

  const months: PenjualanTrendMonth[] = keys.map((key) => {
    const kU = kantongUtama.get(key) ?? { kecil: 0, besar: 0 };
    const kantongKecil = kU.kecil;
    const kantongBesar = kU.besar;
    const pendapatanRp = (pendapatanUtama.get(key) ?? 0) + (pendapatanLogistik.get(key) ?? 0);
    return { month: key, kantongKecil, kantongBesar, kantongTotal: kantongKecil + kantongBesar, pendapatanRp };
  });

  return {
    months,
    totalKantong12Bulan: months.reduce((sum, m) => sum + m.kantongTotal, 0),
    totalPendapatan12Bulan: months.reduce((sum, m) => sum + m.pendapatanRp, 0),
  };
}

export interface PiutangTrendMonth {
  month: string;
  piutangBaru: number; // Pesanan - Retur this month (utama + logistik combined)
  piutangTertagih: number; // Pembayaran this month, on Pemesanan + on PMP_Pembayaran
  netMovement: number; // piutangBaru - piutangTertagih
}

export interface PiutangSummaryData {
  totalPiutangSaatIni: number; // SUM over agents with a positive net balance ("Hutang")
  totalTabunganSaatIni: number; // SUM over agents with a negative net balance ("Tabungan"), as a positive number
  months: PiutangTrendMonth[];
}

// This whole section replaces an earlier GL-account-balance approach
// (GeneralLedger account "1115 Piutang Agen" etc) that, for pmputra,
// UNDER-reported the true figure by ~Rp42jt (dashboard showed
// Rp276.283.689; reported by user 2026-09-24). The user then shared TWO
// candidate ERP report queries -- a per-Agen "Kartu Piutang" script (whose
// company-wide total didn't reconcile, since it's designed for one Agen at
// a time) and finally the actual "Rekening Agen Gabungan" export query,
// confirmed live to reproduce the reported figures almost exactly
// (TotalTabunganAwal matched to the Rupiah: Rp40.505.700). This is a literal
// translation of THAT query.
//
// Critical modeling detail this query captures that the GL approach missed:
// each Agen's balance is signed (PiutangSaldoAwal - TabunganSaldoAwal can be
// negative, meaning that Agen is in savings surplus, not debt) -- and the
// company-wide "Piutang"/"Hutang" total is the sum of only the
// POSITIVE-balance Agents, while "Tabungan" is the sum of the (absolute
// value of) negative-balance Agents. Netting all Agents together into one
// signed company-wide number (as an earlier draft of this fix did) silently
// cancels genuine debt against genuine savings across different Agents,
// which is not how the ERP's own report presents it.
//
// Baseline (PiutangSaldoAwal - TabunganSaldoAwal) is summed from BOTH
// "utama" and "logistik" PMP_Agen here -- unlike the Mitra module's own
// rule (identity/baseline fields are utama-only), confirmed live that this
// specific report adds both databases' baseline fields together.

interface AgenNetRow {
  AgenID: string;
  Net: number;
}

// All aggregation happens in SQL (GROUP BY AgenID) -- PMP_Pemesanan alone
// has 200,000+ rows per database; pulling raw rows into Node and summing
// them there (an earlier version of this function did that) saturated the
// shared connection pool and briefly starved every other page's queries.
// Each of these three queries returns at most ~250 rows (one per Agen).

async function getAgenBaselineNet(kode: string, sumber: SumberAgen): Promise<AgenNetRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`
    SELECT AgenID, SUM(PiutangSaldoAwal - TabunganSaldoAwal) AS Net
    FROM PMP_Agen WHERE IsDeleted = 0 GROUP BY AgenID
  `);
  return result.recordset as AgenNetRow[];
}

async function getPemesananNetByAgen(kode: string, sumber: SumberAgen): Promise<AgenNetRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const requiresBranchFilter = kode === "pmpersada" && sumber === "logistik";
  const request = pool.request();
  if (requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT AgenID, SUM(
      (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga
      + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga
      - ISNULL(Pembayaran,0)
    ) AS Net
    FROM PMP_Pemesanan
    WHERE IsDeleted = 0
      ${requiresBranchFilter ? "AND BranchID = @branchId" : ""}
    GROUP BY AgenID
  `);
  return result.recordset as AgenNetRow[];
}

async function getPembayaranNetByAgen(kode: string, sumber: SumberAgen): Promise<AgenNetRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const requiresBranchFilter = kode === "pmpersada" && sumber === "logistik";
  const request = pool.request();
  if (requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT AgenID, SUM(ISNULL(Tarikan,0) - ISNULL(Pembayaran,0)) AS Net
    FROM PMP_Pembayaran
    WHERE IsDeleted = 0
      ${requiresBranchFilter ? "AND BranchID = @branchId" : ""}
    GROUP BY AgenID
  `);
  return result.recordset as AgenNetRow[];
}

interface MonthMovementRow {
  Bulan: string;
  Baru: number;
  Tertagih: number;
}

// Bounded to the 12-month trend window -- unlike the per-agent balance
// queries above, this one legitimately needs per-row date bucketing, so it
// stays server-side via CONVERT(...,120) grouping rather than a full fetch.
async function getPemesananMovementByMonth(
  kode: string,
  sumber: SumberAgen,
  start: Date,
  end: Date
): Promise<MonthMovementRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const requiresBranchFilter = kode === "pmpersada" && sumber === "logistik";
  const request = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
  if (requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT CONVERT(varchar(7), Tanggal, 120) AS Bulan,
           SUM(BalokKecilRealisasi * BalokKecilHarga + BalokBesarRealisasi * BalokBesarHarga
             - ISNULL(BalokKecilRetur,0) * BalokKecilHarga - ISNULL(BalokBesarRetur,0) * BalokBesarHarga) AS Baru,
           SUM(ISNULL(Pembayaran,0)) AS Tertagih
    FROM PMP_Pemesanan
    WHERE IsDeleted = 0 AND Tanggal >= @start AND Tanggal < @end
      ${requiresBranchFilter ? "AND BranchID = @branchId" : ""}
    GROUP BY CONVERT(varchar(7), Tanggal, 120)
  `);
  return result.recordset as MonthMovementRow[];
}

async function getPembayaranMovementByMonth(
  kode: string,
  sumber: SumberAgen,
  start: Date,
  end: Date
): Promise<MonthMovementRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const requiresBranchFilter = kode === "pmpersada" && sumber === "logistik";
  const request = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
  if (requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT CONVERT(varchar(7), Tanggal, 120) AS Bulan,
           SUM(ISNULL(Tarikan,0)) AS Baru, SUM(ISNULL(Pembayaran,0)) AS Tertagih
    FROM PMP_Pembayaran
    WHERE IsDeleted = 0 AND Tanggal >= @start AND Tanggal < @end
      ${requiresBranchFilter ? "AND BranchID = @branchId" : ""}
    GROUP BY CONVERT(varchar(7), Tanggal, 120)
  `);
  return result.recordset as MonthMovementRow[];
}

export async function getPiutangSummary(kode: string): Promise<PiutangSummaryData> {
  const { start, end, keys } = monthsWindow();
  const sources: SumberAgen[] = ["utama", "logistik"];

  const [baselineBySource, pemesananNetBySource, pembayaranNetBySource, pemesananMonthBySource, pembayaranMonthBySource] =
    await Promise.all([
      Promise.all(sources.map((s) => getAgenBaselineNet(kode, s))),
      Promise.all(sources.map((s) => getPemesananNetByAgen(kode, s))),
      Promise.all(sources.map((s) => getPembayaranNetByAgen(kode, s))),
      Promise.all(sources.map((s) => getPemesananMovementByMonth(kode, s, start, end))),
      Promise.all(sources.map((s) => getPembayaranMovementByMonth(kode, s, start, end))),
    ]);

  const netByAgen = new Map<string, number>();
  function addNet(agenId: string, delta: number) {
    netByAgen.set(agenId, (netByAgen.get(agenId) ?? 0) + delta);
  }
  for (const rows of [...baselineBySource, ...pemesananNetBySource, ...pembayaranNetBySource]) {
    for (const r of rows) addNet(r.AgenID, r.Net);
  }

  let totalPiutangSaatIni = 0;
  let totalTabunganSaatIni = 0;
  for (const net of netByAgen.values()) {
    if (net >= 0) totalPiutangSaatIni += net;
    else totalTabunganSaatIni += -net;
  }

  const movementByMonth = new Map<string, { baru: number; tertagih: number }>();
  function addMovement(bulan: string, baru: number, tertagih: number) {
    const cur = movementByMonth.get(bulan) ?? { baru: 0, tertagih: 0 };
    movementByMonth.set(bulan, { baru: cur.baru + baru, tertagih: cur.tertagih + tertagih });
  }
  for (const rows of [...pemesananMonthBySource, ...pembayaranMonthBySource]) {
    for (const r of rows) addMovement(r.Bulan, r.Baru, r.Tertagih);
  }

  const months: PiutangTrendMonth[] = keys.map((key) => {
    const m = movementByMonth.get(key) ?? { baru: 0, tertagih: 0 };
    return { month: key, piutangBaru: m.baru, piutangTertagih: m.tertagih, netMovement: m.baru - m.tertagih };
  });

  return { totalPiutangSaatIni, totalTabunganSaatIni, months };
}

export interface PiutangPerAgenRow {
  agenId: string;
  nama: string;
  tabunganAwal: number;
  hutangAwal: number;
  pesanan: number;
  retur: number;
  pembayaran: number;
  tarikan: number;
  saldoAkhir: number; // signed: positive = Hutang, negative = Tabungan
}

interface AgenRosterRow {
  AgenID: string;
  Nama: string;
}

// The roster (which AgenID/Nama pairs exist at all) comes from "utama"
// only, matching the reference query's own INNER JOIN against
// FINAC_ES_PO.PMP_Agen -- an AgenID that exists only in "logistik" (never
// in "utama") has no row in this per-Agen table, same limitation the
// reference query itself has. It's still counted in getPiutangSummary's
// company-wide totals above, which key off AgenID directly rather than an
// utama-rooted roster.
async function getAgenRoster(kode: string): Promise<AgenRosterRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, "utama");
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`SELECT AgenID, Nama FROM PMP_Agen WHERE IsDeleted = 0`);
  return result.recordset as AgenRosterRow[];
}

interface AgenPeriodRow {
  AgenID: string;
  Pesanan: number;
  Retur: number;
  Pembayaran: number;
}

async function getPemesananPeriodByAgen(kode: string, sumber: SumberAgen, start: Date, end: Date): Promise<AgenPeriodRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const requiresBranchFilter = kode === "pmpersada" && sumber === "logistik";
  const request = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
  if (requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT AgenID,
           SUM(BalokKecilRealisasi * BalokKecilHarga + BalokBesarRealisasi * BalokBesarHarga) AS Pesanan,
           SUM(ISNULL(BalokKecilRetur,0) * BalokKecilHarga + ISNULL(BalokBesarRetur,0) * BalokBesarHarga) AS Retur,
           SUM(ISNULL(Pembayaran,0)) AS Pembayaran
    FROM PMP_Pemesanan
    WHERE IsDeleted = 0 AND Tanggal BETWEEN @start AND @end
      ${requiresBranchFilter ? "AND BranchID = @branchId" : ""}
    GROUP BY AgenID
  `);
  return result.recordset as AgenPeriodRow[];
}

interface AgenPembayaranPeriodRow {
  AgenID: string;
  Pembayaran: number;
  Tarikan: number;
}

async function getPembayaranPeriodByAgen(
  kode: string,
  sumber: SumberAgen,
  start: Date,
  end: Date
): Promise<AgenPembayaranPeriodRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const requiresBranchFilter = kode === "pmpersada" && sumber === "logistik";
  const request = pool.request().input("start", sql.DateTime, start).input("end", sql.DateTime, end);
  if (requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT AgenID, SUM(ISNULL(Pembayaran,0)) AS Pembayaran, SUM(ISNULL(Tarikan,0)) AS Tarikan
    FROM PMP_Pembayaran
    WHERE IsDeleted = 0 AND Tanggal BETWEEN @start AND @end
      ${requiresBranchFilter ? "AND BranchID = @branchId" : ""}
    GROUP BY AgenID
  `);
  return result.recordset as AgenPembayaranPeriodRow[];
}

// Per-Agen breakdown matching the reference "Rekening Agen Gabungan" export
// column-for-column: Tabungan Awal, Hutang Awal, Pesanan, Retur, Pembayaran,
// Tarikan, Saldo Akhir -- for a caller-chosen [start, end) period. "Awal"
// figures are the Agen's signed balance immediately before `start` (same
// baseline+cumulative-before-start formula as getPiutangSummary), split into
// the two always-non-negative display columns the reference report uses.
export async function getPiutangPerAgen(kode: string, start: Date, end: Date): Promise<PiutangPerAgenRow[]> {
  const sources: SumberAgen[] = ["utama", "logistik"];

  const [roster, baselineBySource, pemesananBeforeBySource, pembayaranBeforeBySource, pemesananPeriodBySource, pembayaranPeriodBySource] =
    await Promise.all([
      getAgenRoster(kode),
      Promise.all(sources.map((s) => getAgenBaselineNet(kode, s))),
      Promise.all(sources.map((s) => getPemesananNetByAgenBefore(kode, s, start))),
      Promise.all(sources.map((s) => getPembayaranNetByAgenBefore(kode, s, start))),
      Promise.all(sources.map((s) => getPemesananPeriodByAgen(kode, s, start, end))),
      Promise.all(sources.map((s) => getPembayaranPeriodByAgen(kode, s, start, end))),
    ]);

  const saldoAwalByAgen = new Map<string, number>();
  function addAwal(agenId: string, delta: number) {
    saldoAwalByAgen.set(agenId, (saldoAwalByAgen.get(agenId) ?? 0) + delta);
  }
  for (const rows of [...baselineBySource, ...pemesananBeforeBySource, ...pembayaranBeforeBySource]) {
    for (const r of rows) addAwal(r.AgenID, r.Net);
  }

  const periodByAgen = new Map<string, { pesanan: number; retur: number; pembayaran: number; tarikan: number }>();
  function addPeriod(agenId: string, delta: { pesanan?: number; retur?: number; pembayaran?: number; tarikan?: number }) {
    const cur = periodByAgen.get(agenId) ?? { pesanan: 0, retur: 0, pembayaran: 0, tarikan: 0 };
    periodByAgen.set(agenId, {
      pesanan: cur.pesanan + (delta.pesanan ?? 0),
      retur: cur.retur + (delta.retur ?? 0),
      pembayaran: cur.pembayaran + (delta.pembayaran ?? 0),
      tarikan: cur.tarikan + (delta.tarikan ?? 0),
    });
  }
  for (const rows of pemesananPeriodBySource) {
    for (const r of rows) addPeriod(r.AgenID, { pesanan: r.Pesanan, retur: r.Retur, pembayaran: r.Pembayaran });
  }
  for (const rows of pembayaranPeriodBySource) {
    for (const r of rows) addPeriod(r.AgenID, { pembayaran: r.Pembayaran, tarikan: r.Tarikan });
  }

  return roster.map((agen) => {
    const saldoAwal = saldoAwalByAgen.get(agen.AgenID) ?? 0;
    const period = periodByAgen.get(agen.AgenID) ?? { pesanan: 0, retur: 0, pembayaran: 0, tarikan: 0 };
    const saldoAkhir = saldoAwal + period.pesanan - period.retur - period.pembayaran + period.tarikan;
    return {
      agenId: agen.AgenID,
      nama: agen.Nama,
      tabunganAwal: saldoAwal < 0 ? -saldoAwal : 0,
      hutangAwal: saldoAwal >= 0 ? saldoAwal : 0,
      pesanan: period.pesanan,
      retur: period.retur,
      pembayaran: period.pembayaran,
      tarikan: period.tarikan,
      saldoAkhir,
    };
  });
}

async function getPemesananNetByAgenBefore(kode: string, sumber: SumberAgen, start: Date): Promise<AgenNetRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const requiresBranchFilter = kode === "pmpersada" && sumber === "logistik";
  const request = pool.request().input("start", sql.DateTime, start);
  if (requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT AgenID, SUM(
      (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga
      + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga
      - ISNULL(Pembayaran,0)
    ) AS Net
    FROM PMP_Pemesanan
    WHERE IsDeleted = 0 AND Tanggal < @start
      ${requiresBranchFilter ? "AND BranchID = @branchId" : ""}
    GROUP BY AgenID
  `);
  return result.recordset as AgenNetRow[];
}

async function getPembayaranNetByAgenBefore(kode: string, sumber: SumberAgen, start: Date): Promise<AgenNetRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const requiresBranchFilter = kode === "pmpersada" && sumber === "logistik";
  const request = pool.request().input("start", sql.DateTime, start);
  if (requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT AgenID, SUM(ISNULL(Tarikan,0) - ISNULL(Pembayaran,0)) AS Net
    FROM PMP_Pembayaran
    WHERE IsDeleted = 0 AND Tanggal < @start
      ${requiresBranchFilter ? "AND BranchID = @branchId" : ""}
    GROUP BY AgenID
  `);
  return result.recordset as AgenNetRow[];
}
