// src/lib/queries/balance-sheet-pmputra.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import { BALANCE_SHEET_KATEGORI_CASE, type BalanceSheetKategori, type BalanceSheetRow } from "@/lib/queries/balance-sheet";
import type { DateRangeFilter } from "@/types/dashboard";

const DEBIT_NORMAL: BalanceSheetKategori[] = ["AsetLancar", "AsetTetap"];

async function getBalanceSheetRowsForLabel(
  label: CompanyKoneksiLabel,
  filter: DateRangeFilter
): Promise<Omit<BalanceSheetRow, "SaldoPercent">[]> {
  const pool = await getCompanyPool("pmputra", label);
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

  // Prefix the ChartOfAccountID with the database label so a row from
  // `utama` never collides with a same-ID row from `logistik` when both
  // arrays get concatenated (React key uniqueness, same reason the P&L
  // combines by category total instead of trying to merge rows by ID).
  return rows.map((r) => ({
    ChartOfAccountID: `${label}:${r.ChartOfAccountID}`,
    AccountNo: r.AccountNo,
    AccountName: r.AccountName,
    Kategori: r.Kategori,
    Saldo: DEBIT_NORMAL.includes(r.Kategori) ? r.TotalDebit - r.TotalCredit : r.TotalCredit - r.TotalDebit,
  }));
}

export async function getBalanceSheetPmputra(filter: DateRangeFilter): Promise<BalanceSheetRow[]> {
  const [utama, logistik] = await Promise.all([
    getBalanceSheetRowsForLabel("utama", filter),
    getBalanceSheetRowsForLabel("logistik", filter),
  ]);
  const combined = [...utama, ...logistik];

  const totalByKategori = new Map<BalanceSheetKategori, number>();
  for (const r of combined) {
    totalByKategori.set(r.Kategori, (totalByKategori.get(r.Kategori) ?? 0) + Math.abs(r.Saldo));
  }

  return combined
    .map((r) => ({
      ...r,
      SaldoPercent: totalByKategori.get(r.Kategori) ? (Math.abs(r.Saldo) / totalByKategori.get(r.Kategori)!) * 100 : 0,
    }))
    .sort((a, b) => a.AccountNo.localeCompare(b.AccountNo));
}
