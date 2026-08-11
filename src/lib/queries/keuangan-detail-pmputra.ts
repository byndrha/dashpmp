// src/lib/queries/keuangan-detail-pmputra.ts
import { getDaysInMonth } from "date-fns";
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import { pmputraKategoriCase } from "@/lib/queries/pnl-pmputra";
import type { COADetailRow, COAKategori } from "@/lib/queries/keuangan-detail";
import type { DateRangeFilter } from "@/types/dashboard";
import { AppError } from "@/lib/action-result";

const CREDIT_NORMAL: COAKategori[] = ["Pendapatan", "PenghasilanLainnya"];

function realisasiSign(kategori: COAKategori, debit: number, credit: number): number {
  return CREDIT_NORMAL.includes(kategori) ? credit - debit : debit - credit;
}

// Splits a label-prefixed ChartOfAccountID (e.g. "logistik:0162", produced
// by getCOADetailRowsForLabel / listChartOfAccountForCostBehaviorPmputra
// below, same convention as balance-sheet-pmputra.ts) back into its label
// and bare numeric ID. Throws on anything that doesn't parse to a known
// CompanyKoneksiLabel — this should never happen for IDs that round-tripped
// through this module's own list functions, so a malformed ID here means a
// caller passed something else in and should fail loudly, not silently.
function parseLabeledId(labeledId: string): { label: CompanyKoneksiLabel; id: string } {
  const idx = labeledId.indexOf(":");
  const label = idx === -1 ? "" : labeledId.slice(0, idx);
  const id = idx === -1 ? "" : labeledId.slice(idx + 1);
  if (label !== "utama" && label !== "logistik") {
    throw new AppError(`ChartOfAccountID tidak valid (tidak diawali label database): "${labeledId}"`);
  }
  return { label, id };
}

async function getCOADetailRowsForLabel(
  label: CompanyKoneksiLabel,
  filter: DateRangeFilter,
  budgetYear: number,
  budgetMonth: number
): Promise<
  {
    ChartOfAccountID: string;
    AccountNo: string;
    AccountName: string;
    Kategori: COAKategori;
    TotalDebit: number;
    TotalCredit: number;
    BudgetAmount: number | null;
  }[]
> {
  const pool = await getCompanyPool("pmputra", label);
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);

  // PMP_Budget is a manually-entered table that only exists in the `utama`
  // (FINAC_ES_PO) database — same manual-entry-table exception as Cash Flow
  // Harian's PMP_CashFlowDaily/PMP_CashFlowExpense. `logistik` has no such
  // table, so its rows always report BudgetAmount: null rather than
  // attempting a cross-database join.
  const budgetJoin =
    label === "utama"
      ? `LEFT JOIN PMP_Budget b
           ON b.ChartOfAccountID = coa.ChartOfAccountID
           AND b.BudgetYear = @budgetYear
           AND b.BudgetMonth = @budgetMonth`
      : "";
  const budgetSelect = label === "utama" ? "b.Amount AS BudgetAmount" : "CAST(NULL AS DECIMAL(23,4)) AS BudgetAmount";
  const budgetGroupBy = label === "utama" ? ", b.Amount" : "";

  if (label === "utama") {
    request.input("budgetYear", sql.Int, budgetYear).input("budgetMonth", sql.Int, budgetMonth);
  }

  const result = await request.query(`
    SELECT
        coa.ChartOfAccountID,
        coa.AccountNo,
        coa.Description AS AccountName,
        ${pmputraKategoriCase(label)} AS Kategori,
        ISNULL(SUM(gl.Debit), 0)  AS TotalDebit,
        ISNULL(SUM(gl.Credit), 0) AS TotalCredit,
        ${budgetSelect}
    FROM ChartOfAccount coa
    JOIN GeneralLedger gl
        ON gl.ChartOfAccountID = coa.ChartOfAccountID
        AND gl.TransDate >= @startDate
        AND gl.TransDate <  @endDate
    ${budgetJoin}
    WHERE ISNULL(coa.IsDeleted, 0) = 0
      AND coa.IsChildest = 1
      AND LEFT(coa.AccountNo, 1) IN ('4','5','6','7','8')
    GROUP BY coa.ChartOfAccountID, coa.AccountNo, coa.Description${budgetGroupBy}
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

  return rows.map((r) => ({ ...r, ChartOfAccountID: `${label}:${r.ChartOfAccountID}` }));
}

export async function getCOADetailPmputra(filter: DateRangeFilter): Promise<COADetailRow[]> {
  const start = new Date(filter.startDate);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + 1;

  const [utama, logistik] = await Promise.all([
    getCOADetailRowsForLabel("utama", filter, year, month),
    getCOADetailRowsForLabel("logistik", filter, year, month),
  ]);
  const rows = [...utama, ...logistik];

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

  return withRealisasi
    .map((r) => ({
      ChartOfAccountID: r.ChartOfAccountID,
      AccountNo: r.AccountNo,
      AccountName: r.AccountName,
      Kategori: r.Kategori,
      Realisasi: r.Realisasi,
      RealisasiPercent: totalByKategori.get(r.Kategori) ? (Math.abs(r.Realisasi) / totalByKategori.get(r.Kategori)!) * 100 : 0,
      BudgetAmount: r.BudgetAmount,
      BudgetPercent: r.BudgetAmount ? (r.Realisasi / r.BudgetAmount) * 100 : null,
      ProyeksiAkhirBulan: (r.Realisasi / elapsedDays) * daysInMonth,
    }))
    .sort((a, b) => a.AccountNo.localeCompare(b.AccountNo));
}

export async function setCOABudgetPmputra(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
  userId: string;
}): Promise<void> {
  const { label, id } = parseLabeledId(input.chartOfAccountId);
  if (label === "logistik") {
    throw new AppError(
      "Budget tidak dapat diatur untuk akun logistik — tabel Budget hanya ada di database utama."
    );
  }

  const pool = await getCompanyPool("pmputra", "utama");
  await pool
    .request()
    .input("coaId", sql.VarChar(16), id)
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

async function listCostBehaviorRowsForLabel(label: CompanyKoneksiLabel): Promise<CostBehaviorRow[]> {
  const pool = await getCompanyPool("pmputra", label);
  const result = await pool.request().query(`
    SELECT ChartOfAccountID, AccountNo, Description AS AccountName, CostBehavior
    FROM ChartOfAccount
    WHERE ISNULL(IsDeleted, 0) = 0 AND IsChildest = 1 AND LEFT(AccountNo, 1) = '6'
    ORDER BY AccountNo
  `);
  return (result.recordset as CostBehaviorRow[]).map((r) => ({
    ...r,
    ChartOfAccountID: `${label}:${r.ChartOfAccountID}`,
  }));
}

// Only prefix-6 (Beban Operasional) accounts are relevant to BEP's
// FIXED/VARIABLE/MIXED split — prefix 4/5 are already auto-classified as
// REVENUE/VARIABLE in getBEPPmputra, tagging them would have no effect.
// Covers both databases, same as getBEPPmputra itself sums CostBehavior
// costs from both — otherwise logistik's prefix-6 accounts could never be
// tagged via this UI at all.
export async function listChartOfAccountForCostBehaviorPmputra(): Promise<CostBehaviorRow[]> {
  const [utama, logistik] = await Promise.all([
    listCostBehaviorRowsForLabel("utama"),
    listCostBehaviorRowsForLabel("logistik"),
  ]);
  return [...utama, ...logistik].sort((a, b) => a.AccountNo.localeCompare(b.AccountNo));
}

export async function setCostBehaviorPmputra(
  chartOfAccountId: string,
  costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null
): Promise<void> {
  const { label, id } = parseLabeledId(chartOfAccountId);
  const pool = await getCompanyPool("pmputra", label);
  await pool
    .request()
    .input("id", sql.VarChar(16), id)
    .input("cb", sql.VarChar(16), costBehavior)
    .query(`UPDATE ChartOfAccount SET CostBehavior = @cb WHERE ChartOfAccountID = @id`);
}
