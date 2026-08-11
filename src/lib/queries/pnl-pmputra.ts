// src/lib/queries/pnl-pmputra.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import type { BEPSummary, PnLSummary } from "@/lib/queries/pnl";
import type { DateRangeFilter } from "@/types/dashboard";

// Per-database category classification — re-derived from real PMPutra
// ChartOfAccount data (utama + logistik), user-confirmed 2026-08-03. Do NOT
// copy pnl.ts's PNL_KATEGORI_CASE verbatim; MKEsindo's own carve-outs don't
// apply here. The two databases' BiayaTetap/Adjustment sets are NOT the same
// account numbers (utama's 6101.xx sub-accounts include BPJS Kesehatan/
// Ketenagakerjaan, which logistik's 6101.xx range doesn't have at all — only
// Gaji/THR exist there), so this must stay a per-label function, not one
// shared CASE string.
//
// utama (FINAC_ES_PO):
//   BiayaTetap = Gaji (6101.01), BPJS Kesehatan (6101.03), BPJS
//     Ketenagakerjaan (6101.04), Sewa (6103) — an exact set, NOT the whole
//     6101.xx range: THR (6101.02) is deliberately excluded, falls through
//     to BebanOperasional like any other prefix-6 account.
//   Adjustment = Beban Pajak Lainnya (6120).
// logistik (FINAC_LOGISTIC_PO):
//   BiayaTetap = Gaji (6101.01), Sewa (6103) — logistik has no BPJS
//     sub-accounts under 6101.xx to include.
//   Adjustment = Beban Pajak Lainnya (6606).
export function pmputraKategoriCase(label: CompanyKoneksiLabel): string {
  const adjustmentAccount = label === "utama" ? "'6120'" : "'6606'";
  const biayaTetapAccounts =
    label === "utama" ? "'6101.01','6101.03','6101.04','6103'" : "'6101.01','6103'";
  return `
    CASE
        WHEN LEFT(coa.AccountNo,1) = '4' THEN 'Pendapatan'
        WHEN LEFT(coa.AccountNo,1) = '5' THEN 'HPP'
        WHEN coa.AccountNo = ${adjustmentAccount} THEN 'Adjustment'
        WHEN coa.AccountNo IN (${biayaTetapAccounts}) THEN 'BiayaTetap'
        WHEN LEFT(coa.AccountNo,1) = '6' THEN 'BebanOperasional'
        WHEN LEFT(coa.AccountNo,1) = '7' THEN 'PenghasilanLainnya'
        WHEN LEFT(coa.AccountNo,1) = '8' THEN 'BebanLainnya'
    END
  `;
}

interface RawCategoryTotal {
  Kategori: string;
  TotalDebit: number;
  TotalCredit: number;
}

interface PnLCategoryTotals {
  Pendapatan: { debit: number; credit: number };
  HPP: { debit: number; credit: number };
  BiayaTetap: { debit: number; credit: number };
  BebanOperasional: { debit: number; credit: number };
  PenghasilanLainnya: { debit: number; credit: number };
  Adjustment: { debit: number; credit: number };
  BebanLainnya: { debit: number; credit: number };
}

function emptyTotals(): PnLCategoryTotals {
  return {
    Pendapatan: { debit: 0, credit: 0 },
    HPP: { debit: 0, credit: 0 },
    BiayaTetap: { debit: 0, credit: 0 },
    BebanOperasional: { debit: 0, credit: 0 },
    PenghasilanLainnya: { debit: 0, credit: 0 },
    Adjustment: { debit: 0, credit: 0 },
    BebanLainnya: { debit: 0, credit: 0 },
  };
}

async function getPnLTotalsForLabel(label: CompanyKoneksiLabel, filter: DateRangeFilter): Promise<PnLCategoryTotals> {
  const pool = await getCompanyPool("pmputra", label);
  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
      SELECT
          ${pmputraKategoriCase(label)} AS Kategori,
          SUM(gl.Debit)  AS TotalDebit,
          SUM(gl.Credit) AS TotalCredit
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE gl.TransDate >= @startDate
        AND gl.TransDate <  @endDate
        AND LEFT(coa.AccountNo,1) IN ('4','5','6','7','8')
      GROUP BY ${pmputraKategoriCase(label)}
    `);

  const totals = emptyTotals();
  for (const r of result.recordset as RawCategoryTotal[]) {
    if (r.Kategori in totals) {
      totals[r.Kategori as keyof PnLCategoryTotals] = { debit: r.TotalDebit, credit: r.TotalCredit };
    }
  }
  return totals;
}

function sumTotals(a: PnLCategoryTotals, b: PnLCategoryTotals): PnLCategoryTotals {
  const out = emptyTotals();
  for (const key of Object.keys(out) as (keyof PnLCategoryTotals)[]) {
    out[key] = { debit: a[key].debit + b[key].debit, credit: a[key].credit + b[key].credit };
  }
  return out;
}

export async function getPnLPmputra(filter: DateRangeFilter): Promise<PnLSummary> {
  const [utama, logistik] = await Promise.all([
    getPnLTotalsForLabel("utama", filter),
    getPnLTotalsForLabel("logistik", filter),
  ]);
  const t = sumTotals(utama, logistik);

  const pendapatan = t.Pendapatan.credit - t.Pendapatan.debit;
  const hpp = t.HPP.debit - t.HPP.credit;
  const labaKotor = pendapatan - hpp;
  const biayaTetap = t.BiayaTetap.debit - t.BiayaTetap.credit;
  const bebanOperasional = t.BebanOperasional.debit - t.BebanOperasional.credit;
  const labaOperasional = labaKotor - biayaTetap - bebanOperasional;
  const penghasilanLainnya = t.PenghasilanLainnya.credit - t.PenghasilanLainnya.debit;
  const adjustment = t.Adjustment.debit - t.Adjustment.credit;
  const bebanLainnya = t.BebanLainnya.debit - t.BebanLainnya.credit;
  const labaBersih = labaOperasional + penghasilanLainnya - adjustment - bebanLainnya;

  return {
    Pendapatan: pendapatan,
    HPP: hpp,
    LabaKotor: labaKotor,
    BiayaTetap: biayaTetap,
    BebanOperasional: bebanOperasional,
    LabaOperasional: labaOperasional,
    PenghasilanLainnya: penghasilanLainnya,
    Adjustment: adjustment,
    BebanLainnya: bebanLainnya,
    LabaBersih: labaBersih,
  };
}

interface RawBEPTotal {
  Kategori: string;
  TotalDebit: number;
  TotalCredit: number;
}

async function getBEPTotalsForLabel(
  label: CompanyKoneksiLabel,
  filter: DateRangeFilter
): Promise<Map<string, { debit: number; credit: number }>> {
  const pool = await getCompanyPool("pmputra", label);
  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
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

  const map = new Map<string, { debit: number; credit: number }>();
  for (const r of result.recordset as RawBEPTotal[]) {
    map.set(r.Kategori, { debit: r.TotalDebit, credit: r.TotalCredit });
  }
  return map;
}

export async function getBEPPmputra(filter: DateRangeFilter): Promise<BEPSummary> {
  const [utama, logistik] = await Promise.all([
    getBEPTotalsForLabel("utama", filter),
    getBEPTotalsForLabel("logistik", filter),
  ]);

  function combined(key: string): { debit: number; credit: number } {
    const a = utama.get(key) ?? { debit: 0, credit: 0 };
    const b = logistik.get(key) ?? { debit: 0, credit: 0 };
    return { debit: a.debit + b.debit, credit: a.credit + b.credit };
  }

  const revenue = combined("REVENUE").credit - combined("REVENUE").debit;
  const variableCost = combined("VARIABLE").debit - combined("VARIABLE").credit;
  const fixedCost = combined("FIXED").debit - combined("FIXED").credit;
  const mixedCost = combined("MIXED").debit - combined("MIXED").credit;

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
