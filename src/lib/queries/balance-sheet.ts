import { getPool, sql } from "@/lib/db";
import type { DateRangeFilter } from "@/types/dashboard";

export type BalanceSheetKategori = "AsetLancar" | "AsetTetap" | "Liabilitas" | "Ekuitas";

const DEBIT_NORMAL: BalanceSheetKategori[] = ["AsetLancar", "AsetTetap"];

// Standard Indonesian COA convention, same prefix scheme PNL_KATEGORI_CASE
// (pnl.ts) already relies on for prefixes 4-8 — prefix 1 = Aset, 2 =
// Liabilitas, 3 = Ekuitas. Verified against live data: 1000-1699 covers
// Kas/Bank/Piutang/Persediaan/Uang Muka/Pajak Dibayar Dimuka ("Aset
// Lancar"), 1700-1899 covers Fixed Asset and its contra account "Akumulasi
// Penyusutan" ("Aset Tetap" — the contra naturally nets negative since it's
// computed the same Debit-Credit way as every other prefix-1 account, no
// special-casing needed), 2xxx is Hutang/Pajak Keluaran, 3xxx is Modal/Laba
// Rugi. Splitting Aset into Lancar/Tetap is a presentation choice only, the
// same way PNL_KATEGORI_CASE splits prefix 6 into Biaya Tetap/Beban
// Operasional.
export const BALANCE_SHEET_KATEGORI_CASE = `
  CASE
      WHEN coa.AccountNo LIKE '1[0-6]%' THEN 'AsetLancar'
      WHEN LEFT(coa.AccountNo,1) = '1' THEN 'AsetTetap'
      WHEN LEFT(coa.AccountNo,1) = '2' THEN 'Liabilitas'
      WHEN LEFT(coa.AccountNo,1) = '3' THEN 'Ekuitas'
  END
`;

export interface BalanceSheetRow {
  ChartOfAccountID: string;
  AccountNo: string;
  AccountName: string;
  Kategori: BalanceSheetKategori;
  Saldo: number;
  SaldoPercent: number;
}

// Balance sheet accounts (1/2/3) accumulate from inception, unlike P&L
// accounts (4-8) which reset each period — so this is a point-in-time
// snapshot "as of" the filter's end date (its exclusive upper bound), not a
// range bounded by the filter's start date the way getPnL()/getCOADetail()
// are.
//
// Note: mid-year, TotalAset generally won't equal TotalLiabilitas +
// TotalEkuitas — verified against live data. The gap is the current year's
// running profit/loss, which this ERP only posts to Equity (3202, "Laba
// Rugi Berjalan") at year-end close, not continuously through the year.
// That's a real characteristic of the source ledger, not a bug in this
// query — deliberately not "corrected" here with a computed plug figure
// that wouldn't match the ERP's own reports.
export async function getBalanceSheetDetail(filter: DateRangeFilter): Promise<BalanceSheetRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("cutoff", sql.Date, filter.endDate)
    .query(`
      SELECT
          coa.ChartOfAccountID,
          coa.AccountNo,
          coa.Description AS AccountName,
          ${BALANCE_SHEET_KATEGORI_CASE} AS Kategori,
          ISNULL(SUM(gl.Debit), 0)  AS TotalDebit,
          ISNULL(SUM(gl.Credit), 0) AS TotalCredit
      FROM ChartOfAccount coa
      JOIN GeneralLedger gl
          ON gl.ChartOfAccountID = coa.ChartOfAccountID
          AND gl.TransDate < @cutoff
      WHERE ISNULL(coa.IsDeleted, 0) = 0
        AND coa.IsChildest = 1
        AND LEFT(coa.AccountNo, 1) IN ('1','2','3')
      GROUP BY coa.ChartOfAccountID, coa.AccountNo, coa.Description
      HAVING SUM(gl.Debit) <> 0 OR SUM(gl.Credit) <> 0
      ORDER BY coa.AccountNo
    `);

  const rows = result.recordset as {
    ChartOfAccountID: string;
    AccountNo: string;
    AccountName: string;
    Kategori: BalanceSheetKategori;
    TotalDebit: number;
    TotalCredit: number;
  }[];

  const withSaldo = rows.map((r) => ({
    ...r,
    Saldo: DEBIT_NORMAL.includes(r.Kategori) ? r.TotalDebit - r.TotalCredit : r.TotalCredit - r.TotalDebit,
  }));

  const totalByKategori = new Map<BalanceSheetKategori, number>();
  for (const r of withSaldo) {
    totalByKategori.set(r.Kategori, (totalByKategori.get(r.Kategori) ?? 0) + Math.abs(r.Saldo));
  }

  return withSaldo.map((r) => ({
    ChartOfAccountID: r.ChartOfAccountID,
    AccountNo: r.AccountNo,
    AccountName: r.AccountName,
    Kategori: r.Kategori,
    Saldo: r.Saldo,
    SaldoPercent: totalByKategori.get(r.Kategori) ? (Math.abs(r.Saldo) / totalByKategori.get(r.Kategori)!) * 100 : 0,
  }));
}
