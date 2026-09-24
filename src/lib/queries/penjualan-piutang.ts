// src/lib/queries/penjualan-piutang.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";

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
  piutangBaru: number; // GL Debit on the Piutang account this month
  piutangTertagih: number; // GL Credit on the Piutang account this month
  netMovement: number; // piutangBaru - piutangTertagih
}

export interface PiutangSummaryData {
  totalPiutangSaatIni: number; // GL balance as of today, utama + logistik
  totalPiutangUtama: number;
  totalPiutangLogistik: number;
  months: PiutangTrendMonth[];
}

export interface PiutangAccountConfig {
  kode: string;
  label: CompanyKoneksiLabel;
  accountNo: string;
  requiresBranchFilter?: boolean;
}

// Confirmed live with accounting at both PTs (17-18 Sep 2026) -- each row is
// 100% traceable to PMP_PEMESANAN. The pmpersada+logistik row needs
// requiresBranchFilter: this database is shared with PMPakis (see
// PMPERSADA_OWN_BRANCH_ID above, defined earlier in this file by Task 1) --
// without it, this account's balance also includes PMPakis's own piutang.
// Account "1114 Piutang Lainnya" (pmpersada/logistik) is deliberately
// excluded -- confirmed by accounting to be an inter-company (PMPutra <->
// PMPersada) receivable, not a customer/Agen receivable.
// pmpakis/utama row added by the Mitra module plan (2026-09-24): confirmed
// live via GeneralLedger that FINAC_ES_PAKIS's account 1111 is named
// "Piutang Agen" with real activity (27,121 rows, ~Rp24.2bn debit /
// ~Rp23.9bn credit) -- a genuinely active, dedicated Piutang account, not a
// guess. This row is otherwise unused by getPiutangSummary/getPenjualanTrend
// (pmpakis has no Penjualan/Piutang aggregate page of its own) -- it exists
// solely for mitra-es-balok.ts's per-Agen getPiutangBaruAgen.
export const PIUTANG_ACCOUNTS: PiutangAccountConfig[] = [
  { kode: "pmputra", label: "utama", accountNo: "1115" }, // "Piutang Agen"
  { kode: "pmputra", label: "logistik", accountNo: "1111" }, // "Piutang Jasa Usaha"
  { kode: "pmpersada", label: "utama", accountNo: "1115" }, // "Piutang Agen"
  { kode: "pmpersada", label: "logistik", accountNo: "1111", requiresBranchFilter: true }, // "Piutang Reguler"
  { kode: "pmpakis", label: "utama", accountNo: "1111" }, // "Piutang Agen"
];

export function getPiutangAccount(kode: string, label: CompanyKoneksiLabel): PiutangAccountConfig {
  const entry = PIUTANG_ACCOUNTS.find((a) => a.kode === kode && a.label === label);
  if (!entry) throw new Error(`No Piutang account configured for kode="${kode}" label="${label}"`);
  return entry;
}

// Current balance (Debit-normal asset account) -- no date filter, matches
// balance-sheet-pmputra.ts's own "as of today" pattern for AsetLancar.
async function getPiutangBalance(kode: string, label: CompanyKoneksiLabel): Promise<number> {
  const pool = await getCompanyPool(kode, label);
  const account = getPiutangAccount(kode, label);
  const request = pool.request().input("accountNo", sql.VarChar(16), account.accountNo);
  if (account.requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT ISNULL(SUM(gl.Debit),0) AS TotalDebit, ISNULL(SUM(gl.Credit),0) AS TotalCredit
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = @accountNo
      ${account.requiresBranchFilter ? "AND gl.BranchID = @branchId" : ""}
  `);
  const r = result.recordset[0] as { TotalDebit: number; TotalCredit: number };
  return r.TotalDebit - r.TotalCredit;
}

async function getPiutangMovementByMonth(
  kode: string,
  label: CompanyKoneksiLabel,
  start: Date,
  end: Date
): Promise<Map<string, { baru: number; tertagih: number }>> {
  const pool = await getCompanyPool(kode, label);
  const account = getPiutangAccount(kode, label);
  const request = pool
    .request()
    .input("accountNo", sql.VarChar(16), account.accountNo)
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end);
  if (account.requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
      SELECT CONVERT(varchar(7), gl.TransDate, 120) AS Bulan,
             SUM(gl.Debit) AS Baru, SUM(gl.Credit) AS Tertagih
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE coa.AccountNo = @accountNo
        AND gl.TransDate >= @start AND gl.TransDate < @end
        ${account.requiresBranchFilter ? "AND gl.BranchID = @branchId" : ""}
      GROUP BY CONVERT(varchar(7), gl.TransDate, 120)
    `);
  const map = new Map<string, { baru: number; tertagih: number }>();
  for (const r of result.recordset as { Bulan: string; Baru: number; Tertagih: number }[]) {
    map.set(r.Bulan, { baru: r.Baru, tertagih: r.Tertagih });
  }
  return map;
}

export async function getPiutangSummary(kode: string): Promise<PiutangSummaryData> {
  const { start, end, keys } = monthsWindow();

  const [totalPiutangUtama, totalPiutangLogistik, movementUtama, movementLogistik] = await Promise.all([
    getPiutangBalance(kode, "utama"),
    getPiutangBalance(kode, "logistik"),
    getPiutangMovementByMonth(kode, "utama", start, end),
    getPiutangMovementByMonth(kode, "logistik", start, end),
  ]);

  const months: PiutangTrendMonth[] = keys.map((key) => {
    const mU = movementUtama.get(key) ?? { baru: 0, tertagih: 0 };
    const mL = movementLogistik.get(key) ?? { baru: 0, tertagih: 0 };
    const piutangBaru = mU.baru + mL.baru;
    const piutangTertagih = mU.tertagih + mL.tertagih;
    return { month: key, piutangBaru, piutangTertagih, netMovement: piutangBaru - piutangTertagih };
  });

  return {
    totalPiutangSaatIni: totalPiutangUtama + totalPiutangLogistik,
    totalPiutangUtama,
    totalPiutangLogistik,
    months,
  };
}
