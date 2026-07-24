import { getPool, sql } from "@/lib/db";

// Exact order requested — display order of the detail rows follows this,
// not whatever order SQL happens to return them in.
const HPP_BERSIH_ACCOUNT_NOS = ["5000", "6103", "6105", "6108", "6110", "6115", "6126", "6101"];

export interface HPPBersihAccountRow {
  AccountNo: string;
  AccountName: string;
  // Both length-12, index 0 = January.
  MonthlyNominal: number[];
  MonthlyRatio: number[];
}

export interface HPPBersihData {
  year: number;
  accounts: HPPBersihAccountRow[];
  // Kemasan-normalized (5KG items counted as half a kantong) — same
  // KANTONG_QTY_EXPR/kemasanCase convention used app-wide for capacity and
  // delivery figures (mitra-do.ts, delivery.ts, sales-overview.ts's
  // Qty10KG/Qty5KG), so a "kantong" here means the same thing it does
  // everywhere else in the app.
  totalKantongPenjualan: number[];
  // Sum of every account's MonthlyRatio for that month — the actual "HPP
  // Bersih" figure per the requested formula.
  totalHPPBersih: number[];
}

function buildInClause(request: sql.Request, values: string[], prefix: string): string {
  return values
    .map((v, i) => {
      const name = `${prefix}${i}`;
      request.input(name, sql.VarChar(16), v);
      return `@${name}`;
    })
    .join(", ");
}

// HPP Bersih = Σ over the 8 listed accounts of (that account's monthly
// Nominal ÷ that month's Total Kantong Penjualan) — computed per account so
// each one's own contribution stays visible ("detail rinciannya"), not just
// the combined total.
//
// "5000" (Harga Pokok Penjualan) and "6101" (Gaji dan Upah) are category
// headers in ChartOfAccount (IsChildest = false) with zero direct
// GeneralLedger activity — verified live. Their real postings sit on child
// accounts (5001-5006, 6101.01-6101.05 respectively, via ParentID), so
// those are resolved and summed under the parent's display row instead.
export async function getHPPBersih(year: number): Promise<HPPBersihData> {
  const pool = await getPool();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const accountsRequest = pool.request();
  const accountNoClause = buildInClause(accountsRequest, HPP_BERSIH_ACCOUNT_NOS, "no");
  const accountsResult = await accountsRequest.query(`
    SELECT ChartOfAccountID, AccountNo, Description, IsChildest
    FROM ChartOfAccount
    WHERE AccountNo IN (${accountNoClause})
      AND ISNULL(IsDeleted, 0) = 0
  `);
  const accountRows = accountsResult.recordset as {
    ChartOfAccountID: string;
    AccountNo: string;
    Description: string;
    IsChildest: boolean;
  }[];

  const parentIds = accountRows.filter((r) => !r.IsChildest).map((r) => r.ChartOfAccountID);
  const childrenByParent = new Map<string, string[]>();
  if (parentIds.length > 0) {
    const childrenRequest = pool.request();
    const parentIdClause = buildInClause(childrenRequest, parentIds, "pid");
    const childrenResult = await childrenRequest.query(`
      SELECT ChartOfAccountID, ParentID
      FROM ChartOfAccount
      WHERE ParentID IN (${parentIdClause})
        AND ISNULL(IsDeleted, 0) = 0
    `);
    for (const r of childrenResult.recordset as { ChartOfAccountID: string; ParentID: string }[]) {
      const list = childrenByParent.get(r.ParentID);
      if (list) list.push(r.ChartOfAccountID);
      else childrenByParent.set(r.ParentID, [r.ChartOfAccountID]);
    }
  }

  // leaf ChartOfAccountID -> which of the 8 display AccountNo it rolls up into.
  const leafToDisplay = new Map<string, string>();
  for (const r of accountRows) {
    const leafIds = r.IsChildest ? [r.ChartOfAccountID] : (childrenByParent.get(r.ChartOfAccountID) ?? []);
    for (const id of leafIds) leafToDisplay.set(id, r.AccountNo);
  }
  const allLeafIds = [...leafToDisplay.keys()];

  const glRequest = pool.request().input("yearStart", sql.Date, yearStart).input("yearEnd", sql.Date, yearEnd);
  const leafIdClause = allLeafIds.length > 0 ? buildInClause(glRequest, allLeafIds, "leaf") : null;

  const [glResult, kantongResult] = await Promise.all([
    leafIdClause
      ? glRequest.query(`
          SELECT gl.ChartOfAccountID, MONTH(gl.TransDate) AS Mo,
                 SUM(gl.Debit) AS TotalDebit, SUM(gl.Credit) AS TotalCredit
          FROM GeneralLedger gl
          WHERE gl.ChartOfAccountID IN (${leafIdClause})
            AND gl.TransDate >= @yearStart AND gl.TransDate < @yearEnd
          GROUP BY gl.ChartOfAccountID, MONTH(gl.TransDate)
        `)
      : Promise.resolve({ recordset: [] as { ChartOfAccountID: string; Mo: number; TotalDebit: number; TotalCredit: number }[] }),
    pool
      .request()
      .input("yearStart", sql.Date, yearStart)
      .input("yearEnd", sql.Date, yearEnd)
      .query(`
        SELECT MONTH(si.TransDate) AS Mo,
               ISNULL(SUM(CASE WHEN sid.Name LIKE '%5 KG%' THEN sid.Qty / 2.0 ELSE sid.Qty END), 0) AS Qty
        FROM SalesInvoiceDetail sid
        JOIN SalesInvoice si ON si.SalesInvoiceID = sid.SalesInvoiceID
        WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma, 0) = 0
          AND si.TransDate >= @yearStart AND si.TransDate < @yearEnd
        GROUP BY MONTH(si.TransDate)
      `),
  ]);

  const totalKantongPenjualan = new Array(12).fill(0);
  for (const r of kantongResult.recordset as { Mo: number; Qty: number }[]) {
    totalKantongPenjualan[r.Mo - 1] = r.Qty;
  }

  const nominalByDisplay = new Map<string, number[]>();
  for (const r of accountRows) nominalByDisplay.set(r.AccountNo, new Array(12).fill(0));

  for (const r of glResult.recordset as { ChartOfAccountID: string; Mo: number; TotalDebit: number; TotalCredit: number }[]) {
    const displayNo = leafToDisplay.get(r.ChartOfAccountID);
    if (!displayNo) continue;
    const arr = nominalByDisplay.get(displayNo);
    // Debit-normal (cost/expense) — same sign convention as HPP/BiayaTetap
    // etc. in pnl.ts.
    if (arr) arr[r.Mo - 1] += r.TotalDebit - r.TotalCredit;
  }

  const accounts: HPPBersihAccountRow[] = accountRows
    .slice()
    .sort((a, b) => HPP_BERSIH_ACCOUNT_NOS.indexOf(a.AccountNo) - HPP_BERSIH_ACCOUNT_NOS.indexOf(b.AccountNo))
    .map((r) => {
      const monthlyNominal = nominalByDisplay.get(r.AccountNo) ?? new Array(12).fill(0);
      const monthlyRatio = monthlyNominal.map((nominal, i) =>
        totalKantongPenjualan[i] ? nominal / totalKantongPenjualan[i] : 0
      );
      return { AccountNo: r.AccountNo, AccountName: r.Description, MonthlyNominal: monthlyNominal, MonthlyRatio: monthlyRatio };
    });

  const totalHPPBersih = new Array(12).fill(0);
  for (const acc of accounts) {
    for (let i = 0; i < 12; i++) totalHPPBersih[i] += acc.MonthlyRatio[i];
  }

  return { year, accounts, totalKantongPenjualan, totalHPPBersih };
}
