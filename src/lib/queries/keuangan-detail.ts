import { getDaysInMonth } from "date-fns";
import { getPool, sql } from "@/lib/db";
import { PNL_KATEGORI_CASE } from "@/lib/queries/pnl";
import type { DateRangeFilter } from "@/types/dashboard";

export type COAKategori =
  | "Pendapatan"
  | "HPP"
  | "BiayaTetap"
  | "BebanOperasional"
  | "PenghasilanLainnya"
  | "Adjustment";

// Credit-normal categories (revenue/income) vs debit-normal (cost) —
// mirrors the sign convention in getPnL.
const CREDIT_NORMAL: COAKategori[] = ["Pendapatan", "PenghasilanLainnya"];

function realisasiSign(kategori: COAKategori, debit: number, credit: number): number {
  return CREDIT_NORMAL.includes(kategori) ? credit - debit : debit - credit;
}

export interface COADetailRow {
  ChartOfAccountID: string;
  AccountNo: string;
  AccountName: string;
  Kategori: COAKategori;
  Realisasi: number;
  RealisasiPercent: number;
  BudgetAmount: number | null;
  BudgetPercent: number | null;
  ProyeksiAkhirBulan: number;
}

export async function getCOADetail(filter: DateRangeFilter): Promise<COADetailRow[]> {
  const pool = await getPool();
  const start = new Date(filter.startDate);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + 1;

  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .input("budgetYear", sql.Int, year)
    .input("budgetMonth", sql.Int, month)
    .query(`
    SELECT
        coa.ChartOfAccountID,
        coa.AccountNo,
        coa.Description AS AccountName,
        ${PNL_KATEGORI_CASE} AS Kategori,
        ISNULL(SUM(gl.Debit), 0)  AS TotalDebit,
        ISNULL(SUM(gl.Credit), 0) AS TotalCredit,
        b.Amount AS BudgetAmount
    FROM ChartOfAccount coa
    JOIN GeneralLedger gl
        ON gl.ChartOfAccountID = coa.ChartOfAccountID
        AND gl.TransDate >= @startDate
        AND gl.TransDate <  @endDate
    LEFT JOIN DashboardBudget b
        ON b.ChartOfAccountID = coa.ChartOfAccountID
        AND b.BudgetYear = @budgetYear
        AND b.BudgetMonth = @budgetMonth
    WHERE ISNULL(coa.IsDeleted, 0) = 0
      AND coa.IsChildest = 1
      AND LEFT(coa.AccountNo, 1) IN ('4','5','6','7','8')
    GROUP BY coa.ChartOfAccountID, coa.AccountNo, coa.Description, b.Amount
    HAVING SUM(gl.Debit) <> 0 OR SUM(gl.Credit) <> 0
    ORDER BY coa.AccountNo
  `);

  const rows = result.recordset as {
    ChartOfAccountID: string;
    AccountNo: string;
    AccountName: string;
    Kategori: COAKategori;
    TotalDebit: number;
    TotalCredit: number;
    BudgetAmount: number | null;
  }[];

  const withRealisasi = rows.map((r) => ({
    ...r,
    Realisasi: realisasiSign(r.Kategori, r.TotalDebit, r.TotalCredit),
  }));

  const totalByKategori = new Map<COAKategori, number>();
  for (const r of withRealisasi) {
    totalByKategori.set(r.Kategori, (totalByKategori.get(r.Kategori) ?? 0) + Math.abs(r.Realisasi));
  }

  // Projection: extrapolate realisasi-to-date across the elapsed days of the
  // period out to a full calendar month. Only meaningful when the filter
  // covers (part of) a single month, which is the dashboard's default.
  const now = new Date();
  const end = new Date(filter.endDate);
  const periodEnd = end < now ? end : now;
  const elapsedDays = Math.max(
    1,
    Math.round((periodEnd.getTime() - start.getTime()) / 86400000)
  );
  const daysInMonth = getDaysInMonth(start);

  return withRealisasi.map((r) => ({
    ChartOfAccountID: r.ChartOfAccountID,
    AccountNo: r.AccountNo,
    AccountName: r.AccountName,
    Kategori: r.Kategori,
    Realisasi: r.Realisasi,
    RealisasiPercent: totalByKategori.get(r.Kategori)
      ? (Math.abs(r.Realisasi) / totalByKategori.get(r.Kategori)!) * 100
      : 0,
    BudgetAmount: r.BudgetAmount,
    BudgetPercent: r.BudgetAmount ? (r.Realisasi / r.BudgetAmount) * 100 : null,
    ProyeksiAkhirBulan: (r.Realisasi / elapsedDays) * daysInMonth,
  }));
}

export async function setCOABudget(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("coaId", sql.VarChar(16), input.chartOfAccountId)
    .input("year", sql.Int, input.year)
    .input("month", sql.Int, input.month)
    .input("amount", sql.Decimal(23, 4), input.amount)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardBudget AS target
      USING (SELECT @coaId AS ChartOfAccountID, @year AS BudgetYear, @month AS BudgetMonth) AS src
      ON target.ChartOfAccountID = src.ChartOfAccountID
         AND target.BudgetYear = src.BudgetYear
         AND target.BudgetMonth = src.BudgetMonth
      WHEN MATCHED THEN
        UPDATE SET Amount = @amount, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (ChartOfAccountID, BudgetYear, BudgetMonth, Amount, CreatedByUserID)
        VALUES (@coaId, @year, @month, @amount, @userId);
    `);
}
