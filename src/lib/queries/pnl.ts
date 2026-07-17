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
  BiayaTetap: number;
  BebanOperasional: number;
  LabaOperasional: number;
  PenghasilanLainnya: number;
  Adjustment: number;
  LabaBersih: number;
}

// Category classification uses AccountNo prefix (standard Indonesian COA
// convention, verified against data) with two carve-outs the business asked
// for on top of the plain prefix split:
//   - 630x ("Beban Pajak" — PPh21/23/25/29, PBB, etc.) is tax, not an
//     operating expense, so it's pulled out of prefix 6 and grouped with
//     prefix 8 into "Adjustment".
//   - 6101* (Gaji dan Upah), 6103 (Sewa), 6115 (Air), and 640x (Beban
//     Penyusutan/depreciation) are fixed costs, split out of prefix 6 into
//     their own "Biaya Tetap" line rather than lumped into "Beban
//     Operasional". This is a P&L presentation choice only — it does not
//     touch ChartOfAccount.CostBehavior, which is a separate classification
//     used by the BEP calculation below.
export const PNL_KATEGORI_CASE = `
  CASE
      WHEN LEFT(coa.AccountNo,1) = '4' THEN 'Pendapatan'
      WHEN LEFT(coa.AccountNo,1) = '5' THEN 'HPP'
      WHEN coa.AccountNo LIKE '6101%' OR coa.AccountNo = '6103' OR coa.AccountNo = '6115'
           OR coa.AccountNo LIKE '640%' THEN 'BiayaTetap'
      WHEN coa.AccountNo LIKE '630%' THEN 'Adjustment'
      WHEN LEFT(coa.AccountNo,1) = '6' THEN 'BebanOperasional'
      WHEN LEFT(coa.AccountNo,1) = '7' THEN 'PenghasilanLainnya'
      WHEN LEFT(coa.AccountNo,1) = '8' THEN 'Adjustment'
  END
`;

export async function getPnL(filter: DateRangeFilter): Promise<PnLSummary> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);

  const result = await request.query(`
    SELECT
        ${PNL_KATEGORI_CASE} AS Kategori,
        SUM(gl.Debit)  AS TotalDebit,
        SUM(gl.Credit) AS TotalCredit
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE gl.TransDate >= @startDate
      AND gl.TransDate <  @endDate
      AND LEFT(coa.AccountNo,1) IN ('4','5','6','7','8')
    GROUP BY ${PNL_KATEGORI_CASE}
  `);

  const rows = result.recordset as RawCategoryTotal[];
  const byKategori = (k: string) => rows.find((r) => r.Kategori === k) ?? { TotalDebit: 0, TotalCredit: 0 };

  const pendapatan = byKategori("Pendapatan").TotalCredit - byKategori("Pendapatan").TotalDebit;
  const hpp = byKategori("HPP").TotalDebit - byKategori("HPP").TotalCredit;
  const labaKotor = pendapatan - hpp;
  const biayaTetap = byKategori("BiayaTetap").TotalDebit - byKategori("BiayaTetap").TotalCredit;
  const bebanOperasional = byKategori("BebanOperasional").TotalDebit - byKategori("BebanOperasional").TotalCredit;
  const labaOperasional = labaKotor - biayaTetap - bebanOperasional;
  const penghasilanLainnya = byKategori("PenghasilanLainnya").TotalCredit - byKategori("PenghasilanLainnya").TotalDebit;
  const adjustment = byKategori("Adjustment").TotalDebit - byKategori("Adjustment").TotalCredit;
  const labaBersih = labaOperasional + penghasilanLainnya - adjustment;

  return {
    Pendapatan: pendapatan,
    HPP: hpp,
    LabaKotor: labaKotor,
    BiayaTetap: biayaTetap,
    BebanOperasional: bebanOperasional,
    LabaOperasional: labaOperasional,
    PenghasilanLainnya: penghasilanLainnya,
    Adjustment: adjustment,
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
// by a rough assumption. This uses ChartOfAccount.CostBehavior directly and
// is intentionally independent of the Biaya Tetap/Beban Operasional P&L
// presentation split above.
export async function getBEP(filter: DateRangeFilter): Promise<BEPSummary> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);

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
