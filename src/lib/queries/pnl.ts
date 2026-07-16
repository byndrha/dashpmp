import { getPool, sql } from "@/lib/db";
import type { DateRangeFilter } from "@/types/dashboard";

interface RawCategoryTotal {
  Kategori: string;
  TotalDebit: number;
  TotalCredit: number;
}

export interface PnLSummary {
  Pendapatan: number;
  HPP: number;
  LabaKotor: number;
  BebanOperasional: number;
  LabaOperasional: number;
  LainLain: number;
  AdjustmentPajak: number;
  LabaBersih: number;
}

// Category classification uses AccountNo prefix (standard Indonesian COA
// convention, verified against data): 4=Pendapatan 5=HPP 6=Beban Operasional
// 7=Pendapatan/Beban Lain 8=Adjustment/Pajak. ChartOfAccount.Type is NOT used
// (values are inconsistent with standard accounting meaning).
export async function getPnL(filter: DateRangeFilter): Promise<PnLSummary> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);

  if (filter.branchId) request.input("branchId", sql.VarChar(16), filter.branchId);

  const result = await request.query(`
    SELECT
        LEFT(coa.AccountNo,1) AS Prefix,
        SUM(gl.Debit)  AS TotalDebit,
        SUM(gl.Credit) AS TotalCredit
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE gl.TransDate >= @startDate
      AND gl.TransDate <  @endDate
      ${filter.branchId ? "AND gl.BranchID = @branchId" : ""}
      AND LEFT(coa.AccountNo,1) IN ('4','5','6','7','8')
    GROUP BY LEFT(coa.AccountNo,1)
  `);

  const rows = result.recordset as { Prefix: string; TotalDebit: number; TotalCredit: number }[];
  const byPrefix = (p: string) => rows.find((r) => r.Prefix === p) ?? { TotalDebit: 0, TotalCredit: 0 };

  const pendapatan = byPrefix("4").TotalCredit - byPrefix("4").TotalDebit;
  const hpp = byPrefix("5").TotalDebit - byPrefix("5").TotalCredit;
  const labaKotor = pendapatan - hpp;
  const bebanOperasional = byPrefix("6").TotalDebit - byPrefix("6").TotalCredit;
  const labaOperasional = labaKotor - bebanOperasional;
  const lainLain = byPrefix("7").TotalCredit - byPrefix("7").TotalDebit;
  const adjustmentPajak = byPrefix("8").TotalDebit - byPrefix("8").TotalCredit;
  const labaBersih = labaOperasional + lainLain - adjustmentPajak;

  return {
    Pendapatan: pendapatan,
    HPP: hpp,
    LabaKotor: labaKotor,
    BebanOperasional: bebanOperasional,
    LabaOperasional: labaOperasional,
    LainLain: lainLain,
    AdjustmentPajak: adjustmentPajak,
    LabaBersih: labaBersih,
  };
}

export interface BEPSummary {
  Revenue: number;
  VariableCost: number;
  FixedCost: number;
  MixedCost: number;
  MarginKontribusiPct: number;
  BEPPerBulan: number;
}

// HPP (5xxx) is treated as fully variable (standard for production/trading
// businesses). MIXED accounts (Bonus, Mesin, Peralatan Kendaraan, Peralatan
// Mesin Produksi, Beban Usaha Lainnya, Beban Penunjang) are deliberately kept
// out of the Fixed/Variable split and shown separately, so BEP isn't biased
// by a rough assumption.
export async function getBEP(filter: DateRangeFilter): Promise<BEPSummary> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);

  if (filter.branchId) request.input("branchId", sql.VarChar(16), filter.branchId);

  const result = await request.query(`
    SELECT
        CASE
            WHEN LEFT(coa.AccountNo,1) = '4' THEN 'REVENUE'
            WHEN LEFT(coa.AccountNo,1) = '5' THEN 'VARIABLE'
            ELSE coa.CostBehavior
        END AS Kategori,
        SUM(gl.Debit)  AS TotalDebit,
        SUM(gl.Credit) AS TotalCredit
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE gl.TransDate >= @startDate
      AND gl.TransDate <  @endDate
      ${filter.branchId ? "AND gl.BranchID = @branchId" : ""}
      AND (
            LEFT(coa.AccountNo,1) IN ('4','5')
            OR (LEFT(coa.AccountNo,1) = '6' AND coa.CostBehavior IS NOT NULL)
          )
    GROUP BY CASE
            WHEN LEFT(coa.AccountNo,1) = '4' THEN 'REVENUE'
            WHEN LEFT(coa.AccountNo,1) = '5' THEN 'VARIABLE'
            ELSE coa.CostBehavior
        END
  `);

  const rows = result.recordset as RawCategoryTotal[];
  const byKategori = (k: string) => rows.find((r) => r.Kategori === k) ?? { TotalDebit: 0, TotalCredit: 0 };

  const revenue = byKategori("REVENUE").TotalCredit - byKategori("REVENUE").TotalDebit;
  const variableCost = byKategori("VARIABLE").TotalDebit - byKategori("VARIABLE").TotalCredit;
  const fixedCost = byKategori("FIXED").TotalDebit - byKategori("FIXED").TotalCredit;
  const mixedCost = byKategori("MIXED").TotalDebit - byKategori("MIXED").TotalCredit;

  const marginKontribusiPct = revenue !== 0 ? 1 - variableCost / revenue : 0;
  const bepPerBulan = marginKontribusiPct !== 0 ? fixedCost / marginKontribusiPct : 0;

  return {
    Revenue: revenue,
    VariableCost: variableCost,
    FixedCost: fixedCost,
    MixedCost: mixedCost,
    MarginKontribusiPct: marginKontribusiPct,
    BEPPerBulan: bepPerBulan,
  };
}
