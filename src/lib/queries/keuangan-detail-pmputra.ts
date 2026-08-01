// src/lib/queries/keuangan-detail-pmputra.ts
import { getDaysInMonth } from "date-fns";
import { sql } from "@/lib/db";
import { getPmputraPool } from "@/lib/db-pmputra";
import { PMPUTRA_PNL_KATEGORI_CASE } from "@/lib/queries/pnl-pmputra";
import type { COADetailRow, COAKategori } from "@/lib/queries/keuangan-detail";
import type { DateRangeFilter } from "@/types/dashboard";

const CREDIT_NORMAL: COAKategori[] = ["Pendapatan", "PenghasilanLainnya"];

function realisasiSign(kategori: COAKategori, debit: number, credit: number): number {
  return CREDIT_NORMAL.includes(kategori) ? credit - debit : debit - credit;
}

export async function getCOADetailPmputra(filter: DateRangeFilter): Promise<COADetailRow[]> {
  const pool = await getPmputraPool("utama");
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
        ${PMPUTRA_PNL_KATEGORI_CASE} AS Kategori,
        ISNULL(SUM(gl.Debit), 0)  AS TotalDebit,
        ISNULL(SUM(gl.Credit), 0) AS TotalCredit,
        b.Amount AS BudgetAmount
    FROM ChartOfAccount coa
    JOIN GeneralLedger gl
        ON gl.ChartOfAccountID = coa.ChartOfAccountID
        AND gl.TransDate >= @startDate
        AND gl.TransDate <  @endDate
    LEFT JOIN PMP_Budget b
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

  const withRealisasi = rows.map((r) => ({ ...r, Realisasi: realisasiSign(r.Kategori, r.TotalDebit, r.TotalCredit) }));

  const totalByKategori = new Map<COAKategori, number>();
  for (const r of withRealisasi) {
    totalByKategori.set(r.Kategori, (totalByKategori.get(r.Kategori) ?? 0) + Math.abs(r.Realisasi));
  }

  const now = new Date();
  const end = new Date(filter.endDate);
  const periodEnd = end < now ? end : now;
  const elapsedDays = Math.max(1, Math.round((periodEnd.getTime() - start.getTime()) / 86400000));
  const daysInMonth = getDaysInMonth(start);

  return withRealisasi.map((r) => ({
    ChartOfAccountID: r.ChartOfAccountID,
    AccountNo: r.AccountNo,
    AccountName: r.AccountName,
    Kategori: r.Kategori,
    Realisasi: r.Realisasi,
    RealisasiPercent: totalByKategori.get(r.Kategori) ? (Math.abs(r.Realisasi) / totalByKategori.get(r.Kategori)!) * 100 : 0,
    BudgetAmount: r.BudgetAmount,
    BudgetPercent: r.BudgetAmount ? (r.Realisasi / r.BudgetAmount) * 100 : null,
    ProyeksiAkhirBulan: (r.Realisasi / elapsedDays) * daysInMonth,
  }));
}

export async function setCOABudgetPmputra(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
  userId: string;
}): Promise<void> {
  const pool = await getPmputraPool("utama");
  await pool
    .request()
    .input("coaId", sql.VarChar(16), input.chartOfAccountId)
    .input("year", sql.Int, input.year)
    .input("month", sql.Int, input.month)
    .input("amount", sql.Decimal(23, 4), input.amount)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE PMP_Budget AS target
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

export interface CostBehaviorRow {
  ChartOfAccountID: string;
  AccountNo: string;
  AccountName: string;
  CostBehavior: "FIXED" | "VARIABLE" | "MIXED" | null;
}

// Only prefix-6 (Beban Operasional) accounts are relevant to BEP's
// FIXED/VARIABLE/MIXED split — prefix 4/5 are already auto-classified as
// REVENUE/VARIABLE in getBEPPmputra, tagging them would have no effect.
export async function listChartOfAccountForCostBehaviorPmputra(): Promise<CostBehaviorRow[]> {
  const pool = await getPmputraPool("utama");
  const result = await pool.request().query(`
    SELECT ChartOfAccountID, AccountNo, Description AS AccountName, CostBehavior
    FROM ChartOfAccount
    WHERE ISNULL(IsDeleted, 0) = 0 AND IsChildest = 1 AND LEFT(AccountNo, 1) = '6'
    ORDER BY AccountNo
  `);
  return result.recordset as CostBehaviorRow[];
}

export async function setCostBehaviorPmputra(
  chartOfAccountId: string,
  costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null
): Promise<void> {
  const pool = await getPmputraPool("utama");
  await pool
    .request()
    .input("id", sql.VarChar(16), chartOfAccountId)
    .input("cb", sql.VarChar(16), costBehavior)
    .query(`UPDATE ChartOfAccount SET CostBehavior = @cb WHERE ChartOfAccountID = @id`);
}
