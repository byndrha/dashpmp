// src/lib/queries/hpp-bersih-pmpersada.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import type { HPPBersihAccountRow, HPPBersihData } from "@/lib/queries/hpp-bersih";

// User-provided, verified against real ChartOfAccount rows in both
// databases, confirmed 2026-08-11. PMPersada has no Amoniak account
// (unlike PMPutra) -- 5 utama accounts instead of 6.
const HPP_BERSIH_ACCOUNTS: { label: CompanyKoneksiLabel; accountNo: string; displayName: string }[] = [
  { label: "utama", accountNo: "6105", displayName: "Listrik" },
  { label: "utama", accountNo: "6114", displayName: "Garam" },
  { label: "utama", accountNo: "6115", displayName: "Air" },
  { label: "utama", accountNo: "6103", displayName: "Sewa" },
  { label: "utama", accountNo: "6116", displayName: "Oli" },
  { label: "logistik", accountNo: "6122.01", displayName: "BBM Es" },
  { label: "logistik", accountNo: "6115", displayName: "Sparepart" },
  { label: "logistik", accountNo: "6121", displayName: "Oli" },
  { label: "logistik", accountNo: "6114", displayName: "Vulkanisir" },
  { label: "logistik", accountNo: "6119", displayName: "Pembelian Ban" },
  { label: "logistik", accountNo: "6103", displayName: "Sewa" },
];

async function getMonthlyNominalForLabel(
  label: CompanyKoneksiLabel,
  accountNos: string[],
  yearStart: Date,
  yearEnd: Date
): Promise<Map<string, number[]>> {
  const pool = await getCompanyPool("pmpersada", label);
  const request = pool.request().input("yearStart", sql.Date, yearStart).input("yearEnd", sql.Date, yearEnd);
  const inClause = accountNos
    .map((no, i) => {
      request.input(`no${i}`, sql.VarChar(16), no);
      return `@no${i}`;
    })
    .join(", ");

  const result = await request.query(`
    SELECT coa.AccountNo, MONTH(gl.TransDate) AS Mo,
           SUM(gl.Debit) AS TotalDebit, SUM(gl.Credit) AS TotalCredit
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo IN (${inClause})
      AND gl.TransDate >= @yearStart AND gl.TransDate < @yearEnd
    GROUP BY coa.AccountNo, MONTH(gl.TransDate)
  `);

  const byAccount = new Map<string, number[]>();
  for (const no of accountNos) byAccount.set(no, new Array(12).fill(0));
  for (const r of result.recordset as { AccountNo: string; Mo: number; TotalDebit: number; TotalCredit: number }[]) {
    const arr = byAccount.get(r.AccountNo);
    if (arr) arr[r.Mo - 1] += r.TotalDebit - r.TotalCredit;
  }
  return byAccount;
}

async function getMonthlyBalokRealisasi(yearStart: Date, yearEnd: Date): Promise<number[]> {
  const pool = await getCompanyPool("pmpersada", "utama");
  const result = await pool
    .request()
    .input("yearStart", sql.Date, yearStart)
    .input("yearEnd", sql.Date, yearEnd)
    .query(`
      SELECT MONTH(Tanggal) AS Mo,
             SUM(ISNULL(BalokKecilRealisasi,0) + ISNULL(BalokBesarRealisasi,0)) AS Qty
      FROM PMP_Pemesanan
      WHERE Status = '3' AND ISNULL(IsVoid,0) = 0 AND ISNULL(IsDeleted,0) = 0
        AND Tanggal >= @yearStart AND Tanggal < @yearEnd
      GROUP BY MONTH(Tanggal)
    `);
  const totals = new Array(12).fill(0);
  for (const r of result.recordset as { Mo: number; Qty: number }[]) totals[r.Mo - 1] = r.Qty;
  return totals;
}

export async function getHPPBersihPmpersada(year: number): Promise<HPPBersihData> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const utamaAccounts = HPP_BERSIH_ACCOUNTS.filter((a) => a.label === "utama").map((a) => a.accountNo);
  const logistikAccounts = HPP_BERSIH_ACCOUNTS.filter((a) => a.label === "logistik").map((a) => a.accountNo);

  const [utamaNominal, logistikNominal, totalBalokTerjual] = await Promise.all([
    getMonthlyNominalForLabel("utama", utamaAccounts, yearStart, yearEnd),
    getMonthlyNominalForLabel("logistik", logistikAccounts, yearStart, yearEnd),
    getMonthlyBalokRealisasi(yearStart, yearEnd),
  ]);

  const accounts: HPPBersihAccountRow[] = HPP_BERSIH_ACCOUNTS.map((a) => {
    const monthlyNominal =
      (a.label === "utama" ? utamaNominal.get(a.accountNo) : logistikNominal.get(a.accountNo)) ??
      new Array(12).fill(0);
    const monthlyRatio = monthlyNominal.map((nominal, i) => (totalBalokTerjual[i] ? nominal / totalBalokTerjual[i] : 0));
    return { AccountNo: `${a.label}:${a.accountNo}`, AccountName: a.displayName, MonthlyNominal: monthlyNominal, MonthlyRatio: monthlyRatio };
  });

  const totalHPPBersih = new Array(12).fill(0);
  for (const acc of accounts) {
    for (let i = 0; i < 12; i++) totalHPPBersih[i] += acc.MonthlyRatio[i];
  }

  return { year, accounts, totalKantongPenjualan: totalBalokTerjual, totalHPPBersih };
}
