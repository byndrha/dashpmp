# PT Prima Maesa Putra — Modul Keuangan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full Keuangan module for PT Prima Maesa Putra (`/pmputra/keuangan`) at parity with MKEsindo's `/pnl` — P&L, BEP, Detail COA vs Budget, Balance Sheet, Cash Flow, Cash Flow Harian, HPP Bersih — reading live data from `FINAC_ES_PO` + `FINAC_LOGISTIC_PO`.

**Architecture:** New query files under `src/lib/queries/*-pmputra.ts`, each following the existing MKEsindo file's shape but consolidating two `getPmputraPool()` connections at the category-total level (never a raw cross-database SQL JOIN). Three existing MKEsindo presentational components get a small prop-injection refactor (they currently hardcode imports of MKEsindo's own server actions) so they can be reused by both `/pnl` and the new page without behavior change for MKEsindo. Two new MSSQL tables + one new column go into `FINAC_ES_PO` for data that has no ERP equivalent (Cash Flow Harian, Budget, CostBehavior).

**Tech Stack:** Next.js Server Components/Actions, `mssql`, existing `src/lib/db-pmputra.ts` (`getPmputraPool`) and `src/lib/queries/perusahaan-koneksi.ts` (already implemented, unmodified).

## Global Constraints

- No test framework exists in this project (`package.json` has no `test` script) — verification is `npx eslint <files>`, `npm run build`, and live checks against real data via throwaway `npx tsx` scripts (deleted after use) or the browser. Every task's "test" steps follow this convention, not Jest/Vitest.
- Never touch `src/lib/queries/pnl.ts`, `keuangan-detail.ts`, `balance-sheet.ts`, `cash-flow.ts`, `cash-flow-harian.ts`, `hpp-bersih.ts`, or MKEsindo's `DashboardBudget`/`DashboardCashFlowDaily`/`DashboardCashFlowExpense` tables — every new query lives in a new `*-pmputra.ts` file / new `PMP_*` table.
- All new MSSQL access goes through `getPmputraPool("utama" | "logistik")` from `src/lib/db-pmputra.ts` — never `getPool()` from `src/lib/db.ts` (that's MKEsindo's connection).
- All new pages/actions are gated by `requirePmputra()` from `src/lib/require-access.ts`.
- Money values are `DECIMAL`/`number`, never floating-point-unsafe string math — follow the exact patterns already used in the MKEsindo query files being ported.

---

## Task 0: DDL — new PMPutra tables + CostBehavior column

**Files:**
- Create (temporary, deleted at the end of this task): `scripts/migrate-pmputra-keuangan-schema.ts`

**Interfaces:**
- Produces (for later tasks): `FINAC_ES_PO` tables `PMP_CashFlowDaily(BusinessDate, KasDiTangan, PengeluaranKasDiTangan, UpdatedByUserID, UpdatedAt)`, `PMP_CashFlowExpense(ID, BusinessDate, Deskripsi, Nominal, CreatedByUserID, CreatedAt)`, `PMP_Budget(ID, ChartOfAccountID, BudgetYear, BudgetMonth, Amount, CreatedByUserID, UpdatedAt)`, and `ChartOfAccount.CostBehavior` (nullable `VARCHAR(16)`, values `'FIXED'`/`'VARIABLE'`/`'MIXED'`).

- [ ] **Step 1: Write the DDL script**

```ts
// scripts/migrate-pmputra-keuangan-schema.ts
// One-off DDL for PT Prima Maesa Putra's Keuangan module — creates the 3
// PMP_* tables (mirroring MKEsindo's DashboardCashFlowDaily/
// DashboardCashFlowExpense/DashboardBudget column-for-column) and adds
// ChartOfAccount.CostBehavior, which MKEsindo's copy of this same ERP has
// but PMPutra's does not (confirmed via INFORMATION_SCHEMA.COLUMNS — see
// docs/superpowers/specs/2026-08-01-pmputra-keuangan-design.md). Run once,
// then delete this file (same convention as every other one-off DDL script
// in this project).
//
// Usage: npx tsx scripts/migrate-pmputra-keuangan-schema.ts
import "dotenv/config";
import { getPmputraPool } from "../src/lib/db-pmputra";

async function main() {
  const pool = await getPmputraPool("utama");

  const existing = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME IN ('PMP_CashFlowDaily', 'PMP_CashFlowExpense', 'PMP_Budget')
  `);
  const existingNames = new Set((existing.recordset as { TABLE_NAME: string }[]).map((r) => r.TABLE_NAME));

  if (!existingNames.has("PMP_CashFlowDaily")) {
    await pool.request().query(`
      CREATE TABLE PMP_CashFlowDaily (
        BusinessDate DATE NOT NULL PRIMARY KEY,
        KasDiTangan DECIMAL(23,2) NOT NULL,
        PengeluaranKasDiTangan DECIMAL(23,2) NOT NULL,
        UpdatedByUserID VARCHAR(16) NOT NULL,
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE()
      )
    `);
    console.log("Created PMP_CashFlowDaily.");
  } else {
    console.log("PMP_CashFlowDaily already exists.");
  }

  if (!existingNames.has("PMP_CashFlowExpense")) {
    await pool.request().query(`
      CREATE TABLE PMP_CashFlowExpense (
        ID INT IDENTITY PRIMARY KEY,
        BusinessDate DATE NOT NULL,
        Deskripsi VARCHAR(256) NOT NULL,
        Nominal DECIMAL(23,2) NOT NULL,
        CreatedByUserID VARCHAR(16) NOT NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
      )
    `);
    console.log("Created PMP_CashFlowExpense.");
  } else {
    console.log("PMP_CashFlowExpense already exists.");
  }

  if (!existingNames.has("PMP_Budget")) {
    await pool.request().query(`
      CREATE TABLE PMP_Budget (
        ID INT IDENTITY PRIMARY KEY,
        ChartOfAccountID VARCHAR(16) NOT NULL,
        BudgetYear INT NOT NULL,
        BudgetMonth INT NOT NULL,
        Amount DECIMAL(23,4) NOT NULL,
        CreatedByUserID VARCHAR(16) NOT NULL,
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_PMP_Budget UNIQUE (ChartOfAccountID, BudgetYear, BudgetMonth)
      )
    `);
    console.log("Created PMP_Budget.");
  } else {
    console.log("PMP_Budget already exists.");
  }

  const coaCol = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ChartOfAccount' AND COLUMN_NAME = 'CostBehavior'
  `);
  if (coaCol.recordset.length === 0) {
    await pool.request().query(`ALTER TABLE ChartOfAccount ADD CostBehavior VARCHAR(16) NULL`);
    console.log("Added ChartOfAccount.CostBehavior.");
  } else {
    console.log("ChartOfAccount.CostBehavior already exists.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/migrate-pmputra-keuangan-schema.ts`
Expected: 4 "Created ..." lines (or "already exists" if re-run), exit code 0.

- [ ] **Step 3: Verify against live data**

Run this ad hoc (paste into a `node -e` or a throwaway script, then discard):
```ts
import "dotenv/config";
import { getPmputraPool } from "./src/lib/db-pmputra";
const pool = await getPmputraPool("utama");
const r = await pool.request().query(`
  SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'PMP_CashFlow%' OR TABLE_NAME = 'PMP_Budget'
`);
console.log(r.recordset);
const c = await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ChartOfAccount' AND COLUMN_NAME='CostBehavior'`);
console.log(c.recordset);
```
Expected: 3 table rows + 1 CostBehavior column row.

- [ ] **Step 4: Delete the script and commit**

```bash
rm scripts/migrate-pmputra-keuangan-schema.ts
git status
```
Expected: nothing to commit for this task (schema changes live in the database, not git) — confirm working tree is clean before moving to Task 1.

---

## Task 1: P&L for PMPutra

**Files:**
- Create: `src/lib/queries/pnl-pmputra.ts`

**Interfaces:**
- Consumes: `getPmputraPool` from `src/lib/db-pmputra.ts`; `PnLSummary` type from `src/lib/queries/pnl.ts`; `DateRangeFilter` from `src/types/dashboard.ts`.
- Produces: `getPnLPmputra(filter: DateRangeFilter): Promise<PnLSummary>`.

- [ ] **Step 1: Write the query module**

Carve-out codes below are re-derived from real PMPutra COA data (not copied from `pnl.ts`) — see verification in Step 2. Both databases share the same category-classification CASE (`6101%` → BiayaTetap for Gaji/THR/BPJS, `6103` → BiayaTetap for Sewa, everything else prefix-6 → BebanOperasional); PMPutra has no `630x` tax-account pattern or `640x` depreciation-expense pattern like MKEsindo does, so those two carve-outs are correctly omitted (verified: `6301`-`6409`/`6401`-`6404` in both PMPutra databases are ordinary operational expenses, not tax or depreciation).

```ts
// src/lib/queries/pnl-pmputra.ts
import { sql } from "@/lib/db";
import { getPmputraPool, type PmputraKoneksiLabel } from "@/lib/db-pmputra";
import type { PnLSummary } from "@/lib/queries/pnl";
import type { DateRangeFilter } from "@/types/dashboard";

// Re-derived from real PMPutra ChartOfAccount data (utama + logistik) — do
// NOT copy pnl.ts's PNL_KATEGORI_CASE verbatim. MKEsindo's carve-outs
// (630x=tax, 640x=depreciation, 6115=Air) don't apply here: PMPutra has no
// 630x/640x pattern matching those meanings (verified — those ranges hold
// ordinary maintenance/supplies expenses in both PMPutra databases), and
// 6115 means "Sparepart" in `logistik`, not a utility. Only Gaji/THR/BPJS
// (6101%) and Sewa (6103, confirmed present and meaning "rent" in both
// databases) are pulled out of prefix 6 into BiayaTetap.
export const PMPUTRA_PNL_KATEGORI_CASE = `
  CASE
      WHEN LEFT(coa.AccountNo,1) = '4' THEN 'Pendapatan'
      WHEN LEFT(coa.AccountNo,1) = '5' THEN 'HPP'
      WHEN coa.AccountNo LIKE '6101%' OR coa.AccountNo = '6103' THEN 'BiayaTetap'
      WHEN LEFT(coa.AccountNo,1) = '6' THEN 'BebanOperasional'
      WHEN LEFT(coa.AccountNo,1) = '7' THEN 'PenghasilanLainnya'
      WHEN LEFT(coa.AccountNo,1) = '8' THEN 'BebanLainnya'
  END
`;

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

async function getPnLTotalsForLabel(label: PmputraKoneksiLabel, filter: DateRangeFilter): Promise<PnLCategoryTotals> {
  const pool = await getPmputraPool(label);
  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
      SELECT
          ${PMPUTRA_PNL_KATEGORI_CASE} AS Kategori,
          SUM(gl.Debit)  AS TotalDebit,
          SUM(gl.Credit) AS TotalCredit
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE gl.TransDate >= @startDate
        AND gl.TransDate <  @endDate
        AND LEFT(coa.AccountNo,1) IN ('4','5','6','7','8')
      GROUP BY ${PMPUTRA_PNL_KATEGORI_CASE}
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
```

- [ ] **Step 2: Verify against live data**

Write a throwaway script, run it, then delete it:
```ts
// scratchpad_verify_pnl.ts
import "dotenv/config";
import { getPnLPmputra } from "./src/lib/queries/pnl-pmputra";
async function main() {
  const result = await getPnLPmputra({ startDate: "2026-01-01", endDate: "2026-08-02" });
  console.log(result);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx scratchpad_verify_pnl.ts`
Expected: a `PnLSummary` object with non-zero `Pendapatan` and `HPP` (2026 has 592k+ GeneralLedger rows). Sanity-check `Pendapatan > 0` and `LabaKotor = Pendapatan - HPP` holds arithmetically.
Then: `rm scratchpad_verify_pnl.ts`

- [ ] **Step 3: Typecheck and lint**

Run: `npx eslint src/lib/queries/pnl-pmputra.ts`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/pnl-pmputra.ts
git commit -m "Add PMPutra P&L query, consolidating FINAC_ES_PO + FINAC_LOGISTIC_PO"
```

---

## Task 2: BEP for PMPutra

**Files:**
- Modify: `src/lib/queries/pnl-pmputra.ts`

**Interfaces:**
- Consumes: `BEPSummary` type from `src/lib/queries/pnl.ts`.
- Produces: `getBEPPmputra(filter: DateRangeFilter): Promise<BEPSummary>`.

- [ ] **Step 1: Add the query function**

BEP's classification (`REVENUE`/`VARIABLE` by prefix, else `coa.CostBehavior`) has no MKEsindo-specific carve-outs at all — it's portable as written, once `ChartOfAccount.CostBehavior` exists (Task 0) and is populated (Task 8's UI). Until accounts are tagged, `FixedCost`/`MixedCost` will read 0 — expected, not a bug (mirrors MKEsindo's own `WHERE ... CostBehavior IS NOT NULL` exclusion of untagged accounts).

Append to `src/lib/queries/pnl-pmputra.ts`:
```ts
import type { BEPSummary } from "@/lib/queries/pnl";

interface RawBEPTotal {
  Kategori: string;
  TotalDebit: number;
  TotalCredit: number;
}

async function getBEPTotalsForLabel(
  label: PmputraKoneksiLabel,
  filter: DateRangeFilter
): Promise<Map<string, { debit: number; credit: number }>> {
  const pool = await getPmputraPool(label);
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
```

- [ ] **Step 2: Verify against live data**

```ts
// scratchpad_verify_bep.ts
import "dotenv/config";
import { getBEPPmputra } from "./src/lib/queries/pnl-pmputra";
async function main() {
  console.log(await getBEPPmputra({ startDate: "2026-01-01", endDate: "2026-08-02" }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx scratchpad_verify_bep.ts`
Expected: `Revenue > 0`, `FixedCost = 0` and `MixedCost = 0` (no accounts tagged yet — expected until Task 8 ships). Then `rm scratchpad_verify_bep.ts`.

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/lib/queries/pnl-pmputra.ts
git add src/lib/queries/pnl-pmputra.ts
git commit -m "Add PMPutra BEP query"
```

---

## Task 3: Balance Sheet for PMPutra

**Files:**
- Create: `src/lib/queries/balance-sheet-pmputra.ts`

**Interfaces:**
- Consumes: `BalanceSheetRow`, `BalanceSheetKategori` types from `src/lib/queries/balance-sheet.ts`.
- Produces: `getBalanceSheetPmputra(filter: DateRangeFilter): Promise<BalanceSheetRow[]>`.

`BALANCE_SHEET_KATEGORI_CASE` is pure prefix-range logic (`1[0-6]%`/`LEFT(...,1)`) with no MKEsindo-specific carve-outs — confirmed portable as-is. Unlike P&L, rows here are NOT combined across databases (each account row stays distinct — a "Kas Besar" row from `utama` and one from `logistik` are two separate balance-sheet lines, since `BalanceSheetTable` groups by `Kategori` for display, not by account identity across databases).

- [ ] **Step 1: Write the query module**

```ts
// src/lib/queries/balance-sheet-pmputra.ts
import { sql } from "@/lib/db";
import { getPmputraPool, type PmputraKoneksiLabel } from "@/lib/db-pmputra";
import { BALANCE_SHEET_KATEGORI_CASE, type BalanceSheetKategori, type BalanceSheetRow } from "@/lib/queries/balance-sheet";
import type { DateRangeFilter } from "@/types/dashboard";

const DEBIT_NORMAL: BalanceSheetKategori[] = ["AsetLancar", "AsetTetap"];

async function getBalanceSheetRowsForLabel(
  label: PmputraKoneksiLabel,
  filter: DateRangeFilter
): Promise<Omit<BalanceSheetRow, "SaldoPercent">[]> {
  const pool = await getPmputraPool(label);
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
```

- [ ] **Step 2: Verify against live data**

```ts
// scratchpad_verify_bs.ts
import "dotenv/config";
import { getBalanceSheetPmputra } from "./src/lib/queries/balance-sheet-pmputra";
async function main() {
  const rows = await getBalanceSheetPmputra({ startDate: "2026-01-01", endDate: "2026-08-02" });
  console.log(`${rows.length} rows`);
  console.log(rows.slice(0, 5));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx scratchpad_verify_bs.ts`
Expected: rows from both databases present (spot-check a `logistik:` prefixed `ChartOfAccountID` appears somewhere in the output). Then `rm scratchpad_verify_bs.ts`.

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/lib/queries/balance-sheet-pmputra.ts
git add src/lib/queries/balance-sheet-pmputra.ts
git commit -m "Add PMPutra Balance Sheet query"
```

---

## Task 4: Cash Flow (period) for PMPutra

**Files:**
- Create: `src/lib/queries/cash-flow-pmputra.ts`

**Interfaces:**
- Consumes: `CashFlowSummary`, `CashFlowTypeRow` types from `src/lib/queries/cash-flow.ts`.
- Produces: `getCashFlowPmputra(filter: DateRangeFilter): Promise<CashFlowSummary>`.

**Important correction (verified against live data, do not copy MKEsindo's filter verbatim):** MKEsindo's `KAS_DI_TANGAN_FILTER` matches bare `AccountNo IN ('1101','1102')` because in MKEsindo's COA, 1101=Kas Besar and 1102=Kas Kecil are both plain 4-digit cash accounts. PMPutra's COA is structured differently — `1101.01`/`1101.02`/`1101.03` are all cash sub-accounts (Kas Besar/Kecil/Pusat), while `1102.xx` are all bank accounts (Mandiri, BCA, Deposito, etc). Using MKEsindo's filter as-is would either match zero rows or wrongly include bank balances. The PMPutra-specific "Kas di Tangan" filter must match `LEFT(AccountNo,4) = '1101'` only.

- [ ] **Step 1: Write the query module**

```ts
// src/lib/queries/cash-flow-pmputra.ts
import { sql } from "@/lib/db";
import { getPmputraPool, type PmputraKoneksiLabel } from "@/lib/db-pmputra";
import type { CashFlowSummary, CashFlowTypeRow } from "@/lib/queries/cash-flow";
import type { DateRangeFilter } from "@/types/dashboard";

// Same "Kas + Bank" prefix rule as MKEsindo (11=Kas, 12=Bank) — confirmed
// present in both PMPutra databases with this exact prefix scheme.
const KAS_BANK_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,2) IN ('11','12') AND ISNULL(coa.IsDeleted,0) = 0`;
// PMPutra-specific: unlike MKEsindo, only the 1101.* sub-accounts are cash
// ("Kas di Tangan") — 1102.* is Bank here, not Kas Kecil (verified against
// real COA rows in both utama and logistik).
const KAS_DI_TANGAN_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,4) = '1101' AND ISNULL(coa.IsDeleted,0) = 0`;

const TYPE_LABEL: Record<string, string> = {
  SALESPAYMENT: "Pembayaran dari Pelanggan",
  SALESDEPOSIT: "Uang Muka Penjualan",
  SALESCREDIT: "Kredit Penjualan",
  SALESRETURN: "Retur Penjualan",
  EXPENSE: "Beban Operasional",
  PURCHASEPAYMENT: "Pembayaran ke Supplier",
  VOUCHER: "Voucher / Transfer Lainnya",
};
function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

interface RawCashFlowResult {
  pendapatan: number;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
  pemasukan: { type: string; amount: number }[];
  pengeluaran: { type: string; amount: number }[];
}

async function getCashFlowForLabel(label: PmputraKoneksiLabel, filter: DateRangeFilter): Promise<RawCashFlowResult> {
  const pool = await getPmputraPool(label);
  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
      SELECT ISNULL(SUM(gl.Debit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.Type = 'SALESPAYMENT'
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate;

      SELECT ISNULL(SUM(gl.Debit), 0) - ISNULL(SUM(gl.Credit), 0) AS Saldo
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_DI_TANGAN_FILTER}
        AND gl.TransDate < @endDate;

      SELECT ISNULL(SUM(gl.Credit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_DI_TANGAN_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate;

      SELECT gl.Type, ISNULL(SUM(gl.Debit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate
      GROUP BY gl.Type
      HAVING SUM(gl.Debit) <> 0;

      SELECT gl.Type, ISNULL(SUM(gl.Credit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate
      GROUP BY gl.Type
      HAVING SUM(gl.Credit) <> 0;
    `);

  const [pendapatanRs, kasDiTanganRs, pengeluaranKasDiTanganRs, pemasukanRs, pengeluaranRs] =
    result.recordsets as unknown as [
      { Total: number }[],
      { Saldo: number }[],
      { Total: number }[],
      { Type: string; Total: number }[],
      { Type: string; Total: number }[],
    ];

  return {
    pendapatan: pendapatanRs[0]?.Total ?? 0,
    kasDiTangan: kasDiTanganRs[0]?.Saldo ?? 0,
    pengeluaranKasDiTangan: pengeluaranKasDiTanganRs[0]?.Total ?? 0,
    pemasukan: pemasukanRs.map((r) => ({ type: r.Type, amount: r.Total })),
    pengeluaran: pengeluaranRs.map((r) => ({ type: r.Type, amount: r.Total })),
  };
}

function mergeTypeRows(a: { type: string; amount: number }[], b: { type: string; amount: number }[]): CashFlowTypeRow[] {
  const map = new Map<string, number>();
  for (const r of [...a, ...b]) map.set(r.type, (map.get(r.type) ?? 0) + r.amount);
  return [...map.entries()]
    .map(([type, amount]) => ({ type, label: typeLabel(type), amount }))
    .sort((x, y) => y.amount - x.amount);
}

export async function getCashFlowPmputra(filter: DateRangeFilter): Promise<CashFlowSummary> {
  const [utama, logistik] = await Promise.all([
    getCashFlowForLabel("utama", filter),
    getCashFlowForLabel("logistik", filter),
  ]);

  const pemasukan = mergeTypeRows(utama.pemasukan, logistik.pemasukan);
  const pengeluaran = mergeTypeRows(utama.pengeluaran, logistik.pengeluaran);

  return {
    pendapatanOperasional: utama.pendapatan + logistik.pendapatan,
    kasDiTangan: utama.kasDiTangan + logistik.kasDiTangan,
    pengeluaranKasDiTangan: utama.pengeluaranKasDiTangan + logistik.pengeluaranKasDiTangan,
    totalPemasukan: pemasukan.reduce((s, r) => s + r.amount, 0),
    totalPengeluaran: pengeluaran.reduce((s, r) => s + r.amount, 0),
    pemasukan,
    pengeluaran,
  };
}
```

- [ ] **Step 2: Verify against live data**

```ts
// scratchpad_verify_cf.ts
import "dotenv/config";
import { getCashFlowPmputra } from "./src/lib/queries/cash-flow-pmputra";
async function main() {
  console.log(await getCashFlowPmputra({ startDate: "2026-01-01", endDate: "2026-08-02" }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx scratchpad_verify_cf.ts`
Expected: `kasDiTangan` is a plausible cash balance (not wildly larger than `pendapatanOperasional` for the period, which would suggest bank balances leaked in). Then `rm scratchpad_verify_cf.ts`.

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/lib/queries/cash-flow-pmputra.ts
git add src/lib/queries/cash-flow-pmputra.ts
git commit -m "Add PMPutra period Cash Flow query"
```

---

## Task 5: Cash Flow Harian for PMPutra (reads/writes `PMP_CashFlowDaily`/`PMP_CashFlowExpense`)

**Files:**
- Create: `src/lib/queries/cash-flow-harian-pmputra.ts`

**Interfaces:**
- Consumes: `CashFlowHarian`, `CashFlowHarianHistoryRow`, `CashFlowExpenseItem` types from `src/lib/queries/cash-flow-harian.ts`; `KAS_BANK_FILTER`-equivalent logic (redefined here, see Task 4's PMPutra-specific note — Cash Flow Harian's "Pendapatan Operasional" reuses the same `KAS_BANK_FILTER` pattern, `SALESPAYMENT` type, single-database `utama` only per the spec's decision).
- Produces: `getCashFlowHarianPmputra(businessDate: string): Promise<CashFlowHarian>`, `getCashFlowHarianHistoryPmputra(limit?: number): Promise<CashFlowHarianHistoryRow[]>`, `saveCashFlowDailyFiguresPmputra(input): Promise<void>`, `addCashFlowExpensePmputra(input): Promise<void>`, `deleteCashFlowExpensePmputra(id: number): Promise<void>`.

- [ ] **Step 1: Write the query module**

```ts
// src/lib/queries/cash-flow-harian-pmputra.ts
import { sql } from "@/lib/db";
import { getPmputraPool } from "@/lib/db-pmputra";
import type { CashFlowHarian, CashFlowHarianHistoryRow } from "@/lib/queries/cash-flow-harian";

const KAS_BANK_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,2) IN ('11','12') AND ISNULL(coa.IsDeleted,0) = 0`;

function nextDayISO(dateISO: string): string {
  const d = new Date(dateISO);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString().slice(0, 10);
}

export async function getCashFlowHarianHistoryPmputra(limit = 60): Promise<CashFlowHarianHistoryRow[]> {
  const pool = await getPmputraPool("utama");
  const result = await pool.request().input("limit", sql.Int, limit).query(`
    SELECT TOP (@limit)
        d.BusinessDate,
        cf.KasDiTangan,
        cf.PengeluaranKasDiTangan,
        ISNULL(e.TotalPengeluaran, 0) AS TotalPengeluaranKas,
        ISNULL(e.ItemCount, 0) AS ItemCount
    FROM (
        SELECT BusinessDate FROM PMP_CashFlowDaily
        UNION
        SELECT BusinessDate FROM PMP_CashFlowExpense
    ) d
    LEFT JOIN PMP_CashFlowDaily cf ON cf.BusinessDate = d.BusinessDate
    LEFT JOIN (
        SELECT BusinessDate, SUM(Nominal) AS TotalPengeluaran, COUNT(*) AS ItemCount
        FROM PMP_CashFlowExpense
        GROUP BY BusinessDate
    ) e ON e.BusinessDate = d.BusinessDate
    ORDER BY d.BusinessDate DESC
  `);

  return (
    result.recordset as {
      BusinessDate: string;
      KasDiTangan: number | null;
      PengeluaranKasDiTangan: number | null;
      TotalPengeluaranKas: number;
      ItemCount: number;
    }[]
  ).map((r) => ({
    businessDate: new Date(r.BusinessDate).toISOString().slice(0, 10),
    kasDiTangan: r.KasDiTangan,
    pengeluaranKasDiTangan: r.PengeluaranKasDiTangan,
    totalPengeluaranKas: r.TotalPengeluaranKas,
    itemCount: r.ItemCount,
  }));
}

export async function getCashFlowHarianPmputra(businessDate: string): Promise<CashFlowHarian> {
  const pool = await getPmputraPool("utama");
  const result = await pool
    .request()
    .input("date", sql.Date, businessDate)
    .input("nextDate", sql.Date, nextDayISO(businessDate))
    .query(`
      SELECT ISNULL(SUM(gl.Debit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.Type = 'SALESPAYMENT'
        AND gl.TransDate >= @date AND gl.TransDate < @nextDate;

      SELECT KasDiTangan, PengeluaranKasDiTangan, UpdatedAt
      FROM PMP_CashFlowDaily
      WHERE BusinessDate = @date;

      SELECT ID, Deskripsi, Nominal
      FROM PMP_CashFlowExpense
      WHERE BusinessDate = @date
      ORDER BY CreatedAt ASC;
    `);

  const [pendapatanRs, dailyRs, expenseRs] = result.recordsets as unknown as [
    { Total: number }[],
    { KasDiTangan: number; PengeluaranKasDiTangan: number; UpdatedAt: string }[],
    { ID: number; Deskripsi: string; Nominal: number }[],
  ];

  const daily = dailyRs[0];
  const daftarPengeluaranKas = expenseRs.map((r) => ({ id: r.ID, deskripsi: r.Deskripsi, nominal: r.Nominal }));

  return {
    businessDate,
    pendapatanOperasional: pendapatanRs[0]?.Total ?? 0,
    kasDiTangan: daily?.KasDiTangan ?? null,
    pengeluaranKasDiTangan: daily?.PengeluaranKasDiTangan ?? null,
    updatedAt: daily?.UpdatedAt ?? null,
    daftarPengeluaranKas,
    totalPengeluaranKas: daftarPengeluaranKas.reduce((s, r) => s + r.nominal, 0),
  };
}

export async function saveCashFlowDailyFiguresPmputra(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
  userId: string;
}): Promise<void> {
  const pool = await getPmputraPool("utama");
  await pool
    .request()
    .input("date", sql.Date, input.businessDate)
    .input("kas", sql.Decimal(23, 2), input.kasDiTangan)
    .input("peng", sql.Decimal(23, 2), input.pengeluaranKasDiTangan)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE PMP_CashFlowDaily AS target
      USING (SELECT @date AS BusinessDate) AS src
      ON target.BusinessDate = src.BusinessDate
      WHEN MATCHED THEN
        UPDATE SET KasDiTangan = @kas, PengeluaranKasDiTangan = @peng,
                   UpdatedByUserID = @userId, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessDate, KasDiTangan, PengeluaranKasDiTangan, UpdatedByUserID)
        VALUES (@date, @kas, @peng, @userId);
    `);
}

export async function addCashFlowExpensePmputra(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
  userId: string;
}): Promise<void> {
  const pool = await getPmputraPool("utama");
  await pool
    .request()
    .input("date", sql.Date, input.businessDate)
    .input("deskripsi", sql.VarChar(256), input.deskripsi)
    .input("nominal", sql.Decimal(23, 2), input.nominal)
    .input("userId", sql.VarChar(16), input.userId).query(`
      INSERT INTO PMP_CashFlowExpense (BusinessDate, Deskripsi, Nominal, CreatedByUserID)
      VALUES (@date, @deskripsi, @nominal, @userId)
    `);
}

export async function deleteCashFlowExpensePmputra(id: number): Promise<void> {
  const pool = await getPmputraPool("utama");
  await pool.request().input("id", sql.Int, id).query(`DELETE FROM PMP_CashFlowExpense WHERE ID = @id`);
}
```

- [ ] **Step 2: Verify against live data**

```ts
// scratchpad_verify_cfh.ts
import "dotenv/config";
import {
  addCashFlowExpensePmputra,
  getCashFlowHarianPmputra,
  deleteCashFlowExpensePmputra,
  saveCashFlowDailyFiguresPmputra,
  getCashFlowHarianHistoryPmputra,
} from "./src/lib/queries/cash-flow-harian-pmputra";

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  await saveCashFlowDailyFiguresPmputra({ businessDate: today, kasDiTangan: 1000000, pengeluaranKasDiTangan: 0, userId: "test" });
  await addCashFlowExpensePmputra({ businessDate: today, deskripsi: "Test verifikasi plan", nominal: 5000, userId: "test" });
  const day = await getCashFlowHarianPmputra(today);
  console.log(day);
  const history = await getCashFlowHarianHistoryPmputra(5);
  console.log(history);
  // Clean up the test row so it doesn't pollute real data.
  const testItem = day.daftarPengeluaranKas.find((i) => i.deskripsi === "Test verifikasi plan");
  if (testItem) await deleteCashFlowExpensePmputra(testItem.id);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx scratchpad_verify_cfh.ts`
Expected: `day.kasDiTangan === 1000000`, `day.daftarPengeluaranKas` contains the test row before cleanup, no errors. Then `rm scratchpad_verify_cfh.ts`.

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/lib/queries/cash-flow-harian-pmputra.ts
git add src/lib/queries/cash-flow-harian-pmputra.ts
git commit -m "Add PMPutra Cash Flow Harian query (PMP_CashFlowDaily/PMP_CashFlowExpense)"
```

---

## Task 6: Detail COA vs Budget + CostBehavior for PMPutra

**Files:**
- Create: `src/lib/queries/keuangan-detail-pmputra.ts`

**Interfaces:**
- Consumes: `COADetailRow`, `COAKategori` types from `src/lib/queries/keuangan-detail.ts`; `PMPUTRA_PNL_KATEGORI_CASE` from Task 1's `pnl-pmputra.ts`.
- Produces: `getCOADetailPmputra(filter: DateRangeFilter): Promise<COADetailRow[]>`, `setCOABudgetPmputra(input): Promise<void>`, `listChartOfAccountForCostBehaviorPmputra(): Promise<{ChartOfAccountID: string; AccountNo: string; AccountName: string; CostBehavior: string | null}[]>`, `setCostBehaviorPmputra(chartOfAccountId: string, costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null): Promise<void>`.

This report is single-database (`utama` only, per the spec's decision — manual budget entries live in `FINAC_ES_PO`'s new `PMP_Budget` table).

- [ ] **Step 1: Write the query module**

```ts
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
```

- [ ] **Step 2: Verify against live data**

```ts
// scratchpad_verify_coa.ts
import "dotenv/config";
import {
  getCOADetailPmputra,
  listChartOfAccountForCostBehaviorPmputra,
  setCostBehaviorPmputra,
} from "./src/lib/queries/keuangan-detail-pmputra";

async function main() {
  const rows = await getCOADetailPmputra({ startDate: "2026-07-01", endDate: "2026-08-01" });
  console.log(`${rows.length} COA detail rows`);
  const cbList = await listChartOfAccountForCostBehaviorPmputra();
  console.log(`${cbList.length} prefix-6 accounts available for tagging`);
  if (cbList[0]) {
    await setCostBehaviorPmputra(cbList[0].ChartOfAccountID, "FIXED");
    const after = await listChartOfAccountForCostBehaviorPmputra();
    console.log("Tagged:", after.find((r) => r.ChartOfAccountID === cbList[0].ChartOfAccountID));
    await setCostBehaviorPmputra(cbList[0].ChartOfAccountID, null); // revert test change
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx scratchpad_verify_coa.ts`
Expected: non-zero row counts, the tag/revert round-trip succeeds without error. Then `rm scratchpad_verify_coa.ts`.

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/lib/queries/keuangan-detail-pmputra.ts
git add src/lib/queries/keuangan-detail-pmputra.ts
git commit -m "Add PMPutra COA Detail vs Budget query + CostBehavior tagging"
```

---

## Task 7: HPP Bersih for PMPutra

**Files:**
- Create: `src/lib/queries/hpp-bersih-pmputra.ts`

**Interfaces:**
- Consumes: `HPPBersihData`, `HPPBersihAccountRow` types from `src/lib/queries/hpp-bersih.ts`.
- Produces: `getHPPBersihPmputra(year: number): Promise<HPPBersihData>`.

Uses the 12 user-specified accounts (6 per database) and `PMP_Pemesanan.BalokKecilRealisasi + BalokBesarRealisasi` (WHERE `Status = '3'`, `IsVoid = 0`, `IsDeleted = 0`) as the monthly divisor, from `utama` only.

- [ ] **Step 1: Write the query module**

```ts
// src/lib/queries/hpp-bersih-pmputra.ts
import { sql } from "@/lib/db";
import { getPmputraPool, type PmputraKoneksiLabel } from "@/lib/db-pmputra";
import type { HPPBersihAccountRow, HPPBersihData } from "@/lib/queries/hpp-bersih";

// User-provided, verified against real ChartOfAccount rows in both
// databases (see docs/superpowers/specs/2026-08-01-pmputra-keuangan-design.md).
// Display names use the fuller, disambiguated labels since both databases
// have an account literally named "Oli".
const HPP_BERSIH_ACCOUNTS: { label: PmputraKoneksiLabel; accountNo: string; displayName: string }[] = [
  { label: "utama", accountNo: "6105", displayName: "Listrik" },
  { label: "utama", accountNo: "6113", displayName: "Garam" },
  { label: "utama", accountNo: "6112", displayName: "Air" },
  { label: "utama", accountNo: "6103", displayName: "Sewa" },
  { label: "utama", accountNo: "6119", displayName: "Oli Mesin Produksi" },
  { label: "utama", accountNo: "6124", displayName: "Amoniak" },
  { label: "logistik", accountNo: "6122.01", displayName: "BBM" },
  { label: "logistik", accountNo: "6115", displayName: "Sparepart" },
  { label: "logistik", accountNo: "6121", displayName: "Oli Kendaraan" },
  { label: "logistik", accountNo: "6114", displayName: "Ban Vulkanisir" },
  { label: "logistik", accountNo: "6119", displayName: "Ban Baru" },
  { label: "logistik", accountNo: "6103", displayName: "Sewa Prama" },
];

async function getMonthlyNominalForLabel(
  label: PmputraKoneksiLabel,
  accountNos: string[],
  yearStart: Date,
  yearEnd: Date
): Promise<Map<string, number[]>> {
  const pool = await getPmputraPool(label);
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
  const pool = await getPmputraPool("utama");
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

export async function getHPPBersihPmputra(year: number): Promise<HPPBersihData> {
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
```

- [ ] **Step 2: Verify against live data**

```ts
// scratchpad_verify_hpp.ts
import "dotenv/config";
import { getHPPBersihPmputra } from "./src/lib/queries/hpp-bersih-pmputra";
async function main() {
  const data = await getHPPBersihPmputra(2026);
  console.log(`year=${data.year}, ${data.accounts.length} accounts`);
  console.log("totalKantongPenjualan (Balok):", data.totalKantongPenjualan);
  console.log("totalHPPBersih:", data.totalHPPBersih);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx scratchpad_verify_hpp.ts`
Expected: `data.accounts.length === 12`, `totalKantongPenjualan` has non-zero months (matches known 2026 `PMP_Pemesanan` activity), no NaN/Infinity in `totalHPPBersih`. Then `rm scratchpad_verify_hpp.ts`.

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/lib/queries/hpp-bersih-pmputra.ts
git add src/lib/queries/hpp-bersih-pmputra.ts
git commit -m "Add PMPutra HPP Bersih query (dual-DB accounts, PMP_Pemesanan divisor)"
```

---

## Task 8: Refactor `COADetailTable` to accept an `onSaveBudget` prop

**Files:**
- Modify: `src/components/dashboard/coa-detail-table.tsx`
- Modify: `src/app/(dashboard)/pnl/page.tsx:140-144` (pass the prop explicitly, preserving current MKEsindo behavior)

**Interfaces:**
- Produces: `COADetailTable`'s new prop `onSaveBudget: (input: { chartOfAccountId: string; year: number; month: number; amount: number }) => Promise<void>`.

- [ ] **Step 1: Change the component to accept the action as a prop**

In `src/components/dashboard/coa-detail-table.tsx`, remove the hardcoded import and add the prop:

```ts
// Remove this line:
import { saveCOABudgetAction } from "@/app/(dashboard)/pnl/actions";
```

Change the function signature and `handleSubmit`:
```ts
export function COADetailTable({
  rows,
  year,
  month,
  onSaveBudget,
}: {
  rows: COADetailRow[];
  year: number;
  month: number;
  onSaveBudget: (input: { chartOfAccountId: string; year: number; month: number; amount: number }) => Promise<void>;
}) {
  const [editing, setEditing] = useState<COADetailRow | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    if (!editing) return;
    const amount = Number(formData.get("amount"));
    startTransition(async () => {
      await onSaveBudget({ chartOfAccountId: editing.ChartOfAccountID, year, month, amount });
      setEditing(null);
    });
  }
```
(Everything else in the file is unchanged.)

- [ ] **Step 2: Update the MKEsindo call site**

In `src/app/(dashboard)/pnl/page.tsx`, add the import and pass the prop (this preserves exactly the current behavior — MKEsindo's own `saveCOABudgetAction`):
```ts
import { saveCOABudgetAction } from "@/app/(dashboard)/pnl/actions";
```
Change the `<COADetailTable>` usage:
```tsx
<COADetailTable
  rows={coaDetail}
  year={periodStart.getUTCFullYear()}
  month={periodStart.getUTCMonth() + 1}
  onSaveBudget={saveCOABudgetAction}
/>
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx eslint src/components/dashboard/coa-detail-table.tsx "src/app/(dashboard)/pnl/page.tsx"`
Expected: no output.
Run: `npm run build`
Expected: succeeds (this confirms the prop type matches `saveCOABudgetAction`'s real signature — a mismatch would fail type-checking here).

- [ ] **Step 4: Manually verify MKEsindo's own budget-editing still works**

Start the dev server, log in as an MKEsindo superadmin, go to `/pnl`, open "Detail per Akun (COA)", click the piggy-bank icon on any row, set a budget amount, save. Confirm the value now shows in the "APBP" column (same as before this refactor).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/coa-detail-table.tsx "src/app/(dashboard)/pnl/page.tsx"
git commit -m "Make COADetailTable's save-budget action injectable via prop"
```

---

## Task 9: Refactor `CashFlowHarianPanel` to accept action props

**Files:**
- Modify: `src/components/dashboard/cash-flow-harian-panel.tsx`
- Modify: `src/app/(dashboard)/pnl/page.tsx:97` (pass the props explicitly)

**Interfaces:**
- Produces: `CashFlowHarianPanel`'s new props `onSaveFigures`, `onAddExpense`, `onDeleteExpense` (same parameter/return shapes as `saveCashFlowDailyFiguresAction`/`addCashFlowExpenseAction`/`deleteCashFlowExpenseAction`).

- [ ] **Step 1: Change the component**

In `src/components/dashboard/cash-flow-harian-panel.tsx`, remove the hardcoded import:
```ts
// Remove:
import {
  saveCashFlowDailyFiguresAction,
  addCashFlowExpenseAction,
  deleteCashFlowExpenseAction,
} from "@/app/(dashboard)/pnl/actions";
```

Change the function signature:
```ts
export function CashFlowHarianPanel({
  data,
  onSaveFigures,
  onAddExpense,
  onDeleteExpense,
}: {
  data: CashFlowHarian;
  onSaveFigures: (input: { businessDate: string; kasDiTangan: number; pengeluaranKasDiTangan: number }) => Promise<void>;
  onAddExpense: (input: { businessDate: string; deskripsi: string; nominal: number }) => Promise<void>;
  onDeleteExpense: (id: number) => Promise<void>;
}) {
```

Update the three handlers to call the props instead of the removed imports:
```ts
  function handleSaveFigures() {
    startTransition(async () => {
      await onSaveFigures({
        businessDate: data.businessDate,
        kasDiTangan: Number(kasDiTangan) || 0,
        pengeluaranKasDiTangan: Number(pengeluaranKasDiTangan) || 0,
      });
    });
  }

  function handleAddExpense() {
    if (!deskripsi.trim() || !(Number(nominal) > 0)) return;
    startTransition(async () => {
      await onAddExpense({
        businessDate: data.businessDate,
        deskripsi: deskripsi.trim(),
        nominal: Number(nominal),
      });
      setDeskripsi("");
      setNominal("");
    });
  }

  function handleDeleteExpense(id: number) {
    startTransition(async () => {
      await onDeleteExpense(id);
    });
  }
```
(Everything else in the file — JSX, state, date navigation — is unchanged.)

- [ ] **Step 2: Update the MKEsindo call site**

In `src/app/(dashboard)/pnl/page.tsx`, add the imports:
```ts
import {
  saveCashFlowDailyFiguresAction,
  addCashFlowExpenseAction,
  deleteCashFlowExpenseAction,
} from "@/app/(dashboard)/pnl/actions";
```
Change the usage:
```tsx
<CashFlowHarianPanel
  key={cashFlowHarian.businessDate}
  data={cashFlowHarian}
  onSaveFigures={saveCashFlowDailyFiguresAction}
  onAddExpense={addCashFlowExpenseAction}
  onDeleteExpense={deleteCashFlowExpenseAction}
/>
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
npx eslint src/components/dashboard/cash-flow-harian-panel.tsx "src/app/(dashboard)/pnl/page.tsx"
npm run build
```
Expected: both clean.

- [ ] **Step 4: Manually verify MKEsindo's Cash Flow Harian still works**

On `/pnl`, in the "Cash Flow Harian" card: set "Kas di Tangan", save; add an expense; delete it. Confirm all three actions still work exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/cash-flow-harian-panel.tsx "src/app/(dashboard)/pnl/page.tsx"
git commit -m "Make CashFlowHarianPanel's actions injectable via props"
```

---

## Task 10: Refactor `HPPBersihPanel` to accept a navigate prop and PMPutra-appropriate copy

**Files:**
- Modify: `src/components/dashboard/hpp-bersih-panel.tsx`
- Modify: `src/app/(dashboard)/pnl/page.tsx:182` (pass the prop explicitly)

**Interfaces:**
- Produces: `HPPBersihPanel`'s new props `onNavigateYear: (year: number) => Promise<HPPBersihData>`, `unitLabel?: string` (default `"Kantong"`), `formulaAccountsLabel?: string` (default the existing hardcoded MKEsindo account list text).

- [ ] **Step 1: Change the component**

In `src/components/dashboard/hpp-bersih-panel.tsx`, remove the hardcoded import:
```ts
// Remove:
import { getHPPBersihAction } from "@/app/(dashboard)/pnl/actions";
```

Change the function signature and body:
```ts
export function HPPBersihPanel({
  initialData,
  onNavigateYear,
  unitLabel = "Kantong",
  formulaAccountsLabel = "5000, 6103, 6105, 6108, 6110, 6115, 6126, 6101",
}: {
  initialData: HPPBersihData;
  onNavigateYear: (year: number) => Promise<HPPBersihData>;
  unitLabel?: string;
  formulaAccountsLabel?: string;
}) {
  const [data, setData] = useState(initialData);
  const [pending, startTransition] = useTransition();

  function navigate(nextYear: number) {
    startTransition(async () => {
      const result = await onNavigateYear(nextYear);
      setData(result);
    });
  }
```

Update the two places that hardcode "kantong" wording — the `CardDescription` and the total-row label:
```tsx
          <CardDescription>
            Detail HPP Bersih per bulan &mdash; jumlah nominal tiap akun COA dibagi total {unitLabel.toLowerCase()}{" "}
            penjualan bulan tersebut.
          </CardDescription>
```
```tsx
              <TableRow className="bg-card/50">
                <TableCell className={cn("px-2 py-1.5", STICKY_LABEL_CLASS, "bg-card/50")}>
                  <p className="text-xs font-medium leading-tight">Total {unitLabel} Penjualan</p>
                </TableCell>
```
And the formula footer text:
```tsx
          <p className="mt-1 font-data">
            HPP Bersih = &Sigma; (Nominal Akun COA &divide; Total {unitLabel} Penjualan), per bulan, dijumlahkan dari
            akun: {formulaAccountsLabel}.
          </p>
```
(Everything else — table structure, tooltips, month columns — is unchanged.)

- [ ] **Step 2: Update the MKEsindo call site**

In `src/app/(dashboard)/pnl/page.tsx`, add the import:
```ts
import { getHPPBersihAction } from "@/app/(dashboard)/pnl/actions";
```
Change the usage (no `unitLabel`/`formulaAccountsLabel` needed — defaults match MKEsindo's existing copy exactly):
```tsx
<HPPBersihPanel initialData={hppBersih} onNavigateYear={getHPPBersihAction} />
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
npx eslint src/components/dashboard/hpp-bersih-panel.tsx "src/app/(dashboard)/pnl/page.tsx"
npm run build
```
Expected: both clean.

- [ ] **Step 4: Manually verify MKEsindo's HPP Bersih still works**

On `/pnl`, scroll to "Perhitungan HPP Bersih", click the year navigation arrows, confirm the table refetches and the wording still says "kantong" (unchanged from before this refactor).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/hpp-bersih-panel.tsx "src/app/(dashboard)/pnl/page.tsx"
git commit -m "Make HPPBersihPanel's year-navigation action and unit wording configurable"
```

---

## Task 11: `CostBehaviorEditor` component (new — no MKEsindo equivalent exists)

**Files:**
- Create: `src/components/dashboard/cost-behavior-editor.tsx`

**Interfaces:**
- Consumes: `CostBehaviorRow` type from Task 6's `keuangan-detail-pmputra.ts`.
- Produces: `CostBehaviorEditor({ rows, onSetCostBehavior }: { rows: CostBehaviorRow[]; onSetCostBehavior: (chartOfAccountId: string, costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null) => Promise<void> })`.

MKEsindo has no app-level UI for this at all (its `CostBehavior` values were set directly in the database) — this is genuinely new, not a port.

- [ ] **Step 1: Write the component**

```tsx
// src/components/dashboard/cost-behavior-editor.tsx
"use client";

import { useState, useTransition } from "react";
import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CostBehaviorRow } from "@/lib/queries/keuangan-detail-pmputra";

const OPTIONS: { value: "FIXED" | "VARIABLE" | "MIXED" | "NONE"; label: string }[] = [
  { value: "NONE", label: "Belum ditandai" },
  { value: "FIXED", label: "Tetap (Fixed)" },
  { value: "VARIABLE", label: "Variabel" },
  { value: "MIXED", label: "Campuran (Mixed)" },
];

export function CostBehaviorEditor({
  rows,
  onSetCostBehavior,
}: {
  rows: CostBehaviorRow[];
  onSetCostBehavior: (chartOfAccountId: string, costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null) => Promise<void>;
}) {
  const [localRows, setLocalRows] = useState(rows);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleChange(row: CostBehaviorRow, value: string) {
    const next = value === "NONE" ? null : (value as "FIXED" | "VARIABLE" | "MIXED");
    setPendingId(row.ChartOfAccountID);
    startTransition(async () => {
      await onSetCostBehavior(row.ChartOfAccountID, next);
      setLocalRows((prev) =>
        prev.map((r) => (r.ChartOfAccountID === row.ChartOfAccountID ? { ...r, CostBehavior: next } : r))
      );
      setPendingId(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Klasifikasi Biaya untuk BEP</CardTitle>
        <CardDescription className="flex items-start gap-1.5">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Tandai setiap akun Beban Operasional sebagai Tetap/Variabel/Campuran. Akun yang belum ditandai tidak ikut
          dihitung di Break-Even Point di bawah.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 px-2 text-xs">Akun</TableHead>
              <TableHead className="h-8 px-2 text-xs">Klasifikasi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {localRows.map((r) => (
              <TableRow key={r.ChartOfAccountID}>
                <TableCell className="px-2 py-1.5">
                  <p className="text-xs font-medium leading-tight">{r.AccountName}</p>
                  <p className="font-data text-[10px] leading-tight text-muted-foreground">{r.AccountNo}</p>
                </TableCell>
                <TableCell className="px-2 py-1.5">
                  <Select
                    value={r.CostBehavior ?? "NONE"}
                    onValueChange={(v) => v && handleChange(r, v)}
                    disabled={pendingId === r.ChartOfAccountID}
                  >
                    <SelectTrigger className="h-8 w-44 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint src/components/dashboard/cost-behavior-editor.tsx`
Expected: no output. (Full behavior verification happens in Task 13's live check, once this is wired into the real page — this component has no server dependency of its own to test in isolation beyond compiling.)

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/cost-behavior-editor.tsx
git commit -m "Add CostBehaviorEditor component for PMPutra's BEP account tagging"
```

---

## Task 12: Server actions for `/pmputra/keuangan`

**Files:**
- Create: `src/app/pmputra/keuangan/actions.ts`

**Interfaces:**
- Consumes: every `*Pmputra` function from Tasks 1-7; `requirePmputra` from `src/lib/require-access.ts`.
- Produces: `saveCOABudgetPmputraAction`, `saveCashFlowDailyFiguresPmputraAction`, `addCashFlowExpensePmputraAction`, `deleteCashFlowExpensePmputraAction`, `getHPPBersihPmputraAction`, `setCostBehaviorPmputraAction` — all `"use server"`.

- [ ] **Step 1: Write the actions file**

```ts
// src/app/pmputra/keuangan/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requirePmputra } from "@/lib/require-access";
import { setCOABudgetPmputra, setCostBehaviorPmputra } from "@/lib/queries/keuangan-detail-pmputra";
import {
  saveCashFlowDailyFiguresPmputra,
  addCashFlowExpensePmputra,
  deleteCashFlowExpensePmputra,
} from "@/lib/queries/cash-flow-harian-pmputra";
import { getHPPBersihPmputra } from "@/lib/queries/hpp-bersih-pmputra";

export async function saveCOABudgetPmputraAction(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
}) {
  const session = await requirePmputra();
  await setCOABudgetPmputra({ ...input, userId: session.user.id });
  revalidatePath("/pmputra/keuangan");
}

export async function saveCashFlowDailyFiguresPmputraAction(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
}) {
  const session = await requirePmputra();
  await saveCashFlowDailyFiguresPmputra({ ...input, userId: session.user.id });
  revalidatePath("/pmputra/keuangan");
}

export async function addCashFlowExpensePmputraAction(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
}) {
  const session = await requirePmputra();
  if (!input.deskripsi.trim() || !(input.nominal > 0)) throw new Error("Data tidak valid");
  await addCashFlowExpensePmputra({ ...input, userId: session.user.id });
  revalidatePath("/pmputra/keuangan");
}

export async function deleteCashFlowExpensePmputraAction(id: number) {
  await requirePmputra();
  await deleteCashFlowExpensePmputra(id);
  revalidatePath("/pmputra/keuangan");
}

// Read-only refetch (year navigation) — auth() alone is enough, same
// reasoning as MKEsindo's getHPPBersihAction.
export async function getHPPBersihPmputraAction(year: number) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return getHPPBersihPmputra(year);
}

export async function setCostBehaviorPmputraAction(
  chartOfAccountId: string,
  costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null
) {
  await requirePmputra();
  await setCostBehaviorPmputra(chartOfAccountId, costBehavior);
  revalidatePath("/pmputra/keuangan");
}
```

- [ ] **Step 2: Lint and typecheck**

```bash
npx eslint src/app/pmputra/keuangan/actions.ts
npm run build
```
Expected: both clean (a real build here confirms every imported function name/signature matches Tasks 1-7 exactly).

- [ ] **Step 3: Commit**

```bash
git add src/app/pmputra/keuangan/actions.ts
git commit -m "Add server actions for PMPutra Keuangan module"
```

---

## Task 13: `/pmputra/keuangan` page

**Files:**
- Create: `src/app/pmputra/keuangan/page.tsx`

**Interfaces:**
- Consumes: every query function from Tasks 1-7, every action from Task 12, `KpiCard`/`SimpleBarChart`/`COADetailTable`/`BalanceSheetTable`/`CashFlowPanel`/`CashFlowHarianPanel`/`CashFlowHarianHistoryPanel`/`HPPBersihPanel`/`CostBehaviorEditor`/`FilterBar` components (all now prop-injectable per Tasks 8-11), `resolveFilter`/`DashboardSearchParams` from `src/lib/date-range.ts`, `getBusinessDateISO` from `src/lib/business-date.ts`, `requirePmputra` from `src/lib/require-access.ts`.

- [ ] **Step 1: Write the page**

```tsx
// src/app/pmputra/keuangan/page.tsx
import { Wallet, TrendingUp, Landmark, PiggyBank } from "lucide-react";
import { getPnLPmputra, getBEPPmputra } from "@/lib/queries/pnl-pmputra";
import {
  getCOADetailPmputra,
  listChartOfAccountForCostBehaviorPmputra,
} from "@/lib/queries/keuangan-detail-pmputra";
import { getBalanceSheetPmputra } from "@/lib/queries/balance-sheet-pmputra";
import { getCashFlowPmputra } from "@/lib/queries/cash-flow-pmputra";
import { getCashFlowHarianPmputra, getCashFlowHarianHistoryPmputra } from "@/lib/queries/cash-flow-harian-pmputra";
import { getHPPBersihPmputra } from "@/lib/queries/hpp-bersih-pmputra";
import { getBusinessDateISO } from "@/lib/business-date";
import { requirePmputra } from "@/lib/require-access";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { SimpleBarChart } from "@/components/charts/simple-bar-chart";
import { COADetailTable } from "@/components/dashboard/coa-detail-table";
import { BalanceSheetTable } from "@/components/dashboard/balance-sheet-table";
import { CashFlowPanel } from "@/components/dashboard/cash-flow-panel";
import { CashFlowHarianPanel } from "@/components/dashboard/cash-flow-harian-panel";
import { CashFlowHarianHistoryPanel } from "@/components/dashboard/cash-flow-harian-history-panel";
import { HPPBersihPanel } from "@/components/dashboard/hpp-bersih-panel";
import { CostBehaviorEditor } from "@/components/dashboard/cost-behavior-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah, formatPercent, formatDate } from "@/lib/format";
import {
  saveCOABudgetPmputraAction,
  saveCashFlowDailyFiguresPmputraAction,
  addCashFlowExpensePmputraAction,
  deleteCashFlowExpensePmputraAction,
  getHPPBersihPmputraAction,
  setCostBehaviorPmputraAction,
} from "@/app/pmputra/keuangan/actions";

export default async function PmputraKeuanganPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  await requirePmputra();
  const params = await searchParams;
  const filter = resolveFilter(params);
  const cfDate = params.cfDate ?? getBusinessDateISO();

  const [pnl, bep, coaDetail, costBehaviorRows, balanceSheet, cashFlow, cashFlowHarian, cashFlowHarianHistory, hppBersih] =
    await Promise.all([
      getPnLPmputra(filter),
      getBEPPmputra(filter),
      getCOADetailPmputra(filter),
      listChartOfAccountForCostBehaviorPmputra(),
      getBalanceSheetPmputra(filter),
      getCashFlowPmputra(filter),
      getCashFlowHarianPmputra(cfDate),
      getCashFlowHarianHistoryPmputra(),
      getHPPBersihPmputra(new Date().getUTCFullYear()),
    ]);

  const periodStart = new Date(filter.startDate);
  const endDateUTC = new Date(filter.endDate);
  const balanceSheetCutoff = new Date(
    Date.UTC(endDateUTC.getUTCFullYear(), endDateUTC.getUTCMonth(), endDateUTC.getUTCDate() - 1)
  );

  const compositionData = [
    { name: "HPP", value: pnl.HPP },
    { name: "Biaya Tetap", value: pnl.BiayaTetap },
    { name: "Beban Operasional", value: pnl.BebanOperasional },
    { name: "Laba Bersih", value: Math.max(pnl.LabaBersih, 0) },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Keuangan</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <FilterBar />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pendapatan" value={formatRupiah(pnl.Pendapatan)} icon={Wallet} />
        <KpiCard label="Laba Kotor" value={formatRupiah(pnl.LabaKotor)} icon={TrendingUp} />
        <KpiCard
          label="Laba Operasional"
          value={formatRupiah(pnl.LabaOperasional)}
          icon={Landmark}
          tone={pnl.LabaOperasional >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Laba Bersih"
          value={formatRupiah(pnl.LabaBersih)}
          icon={PiggyBank}
          tone={pnl.LabaBersih >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <div className="flex flex-col gap-4 @4xl:col-span-3">
          <CashFlowPanel data={cashFlow} asOfLabel={formatDate(balanceSheetCutoff)} />
          <CashFlowHarianPanel
            key={cashFlowHarian.businessDate}
            data={cashFlowHarian}
            onSaveFigures={saveCashFlowDailyFiguresPmputraAction}
            onAddExpense={addCashFlowExpensePmputraAction}
            onDeleteExpense={deleteCashFlowExpensePmputraAction}
          />
          <CashFlowHarianHistoryPanel rows={cashFlowHarianHistory} activeDate={cfDate} />
        </div>

        <div className="flex flex-col gap-4 @4xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Rincian P&amp;L</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Pendapatan" value={pnl.Pendapatan} />
              <Row label="HPP" value={-pnl.HPP} />
              <Row label="Laba Kotor" value={pnl.LabaKotor} bold />
              <Row label="Biaya Tetap" value={-pnl.BiayaTetap} />
              <Row label="Beban Operasional" value={-pnl.BebanOperasional} />
              <Row label="Laba Operasional" value={pnl.LabaOperasional} bold />
              <Row label="Penghasilan Lainnya" value={pnl.PenghasilanLainnya} />
              <Row label="Adjustment" value={-pnl.Adjustment} />
              <Row label="Beban Lainnya" value={-pnl.BebanLainnya} />
              <Row label="Laba Bersih" value={pnl.LabaBersih} bold />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Komposisi Biaya vs Laba</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleBarChart data={compositionData} height={200} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <div className="@4xl:col-span-3 @4xl:border-r @4xl:border-border @4xl:pr-4">
          <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">
            Detail per Akun (COA) &mdash; APBP vs Realisasi
          </h2>
          <COADetailTable
            rows={coaDetail}
            year={periodStart.getUTCFullYear()}
            month={periodStart.getUTCMonth() + 1}
            onSaveBudget={saveCOABudgetPmputraAction}
          />
        </div>
        <div className="@4xl:col-span-2">
          <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">
            Detail Balance Sheet &mdash; per {formatDate(balanceSheetCutoff)}
          </h2>
          <BalanceSheetTable rows={balanceSheet} />
        </div>
      </div>

      <hr className="border-border" />

      <CostBehaviorEditor rows={costBehaviorRows} onSetCostBehavior={setCostBehaviorPmputraAction} />

      <Card>
        <CardHeader>
          <CardTitle>Break-Even Point (BEP)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Revenue" value={formatRupiah(bep.Revenue)} />
            <Stat label="Biaya Variabel" value={formatRupiah(bep.VariableCost)} />
            <Stat label="Biaya Tetap" value={formatRupiah(bep.FixedCost)} />
            <Stat label="Margin Kontribusi" value={formatPercent(bep.MarginKontribusiPct)} />
            <Stat label="BEP / Bulan" value={formatRupiah(bep.BEPPerBulan)} />
          </div>
          <div className="rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Rumus Perhitungan BEP:</p>
            <p className="mt-1 font-data">Margin Kontribusi = 1 &minus; (Biaya Variabel &divide; Revenue)</p>
            <p className="font-data">BEP per Bulan = Biaya Tetap &divide; Margin Kontribusi</p>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Akun bertanda "Campuran (Mixed)" sebesar {formatRupiah(bep.MixedCost)} sengaja tidak dimasukkan ke
        perhitungan BEP di atas.
      </p>

      <HPPBersihPanel
        initialData={hppBersih}
        onNavigateYear={getHPPBersihPmputraAction}
        unitLabel="Balok"
        formulaAccountsLabel="Listrik, Garam, Air, Sewa, Oli Mesin Produksi, Amoniak (FINAC_ES_PO) + BBM, Sparepart, Oli Kendaraan, Ban Vulkanisir, Ban Baru, Sewa Prama (FINAC_LOGISTIC_PO)"
      />
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold border-t pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatRupiah(value)}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: Lint and build**

```bash
npx eslint src/app/pmputra/keuangan/page.tsx
npm run build
```
Expected: both clean. Confirm the build's route list includes `/pmputra/keuangan` as a distinct static route (not swallowed by the `[modul]` catch-all) — check the `next build` output's route tree.

- [ ] **Step 3: Commit**

```bash
git add src/app/pmputra/keuangan/page.tsx
git commit -m "Add PT Prima Maesa Putra Keuangan page"
```

---

## Task 14: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full build**

```bash
npm run build
```
Expected: clean, `/pmputra/keuangan` listed as its own route.

- [ ] **Step 2: Full lint**

```bash
npx eslint src
```
Expected: no errors.

- [ ] **Step 3: Live browser check as Nila**

Start the dev server. Log in as `Nila` (the PMPutra Accounting account). Navigate to `/pmputra/keuangan`. Verify:
- 4 KPI cards show non-zero Pendapatan/Laba figures.
- "Rincian P&L" and "Komposisi Biaya vs Laba" render.
- Cash Flow panel and Cash Flow Harian panel render; add a real test expense in Cash Flow Harian, confirm it appears in "Daftar Pengeluaran Kas", then delete it.
- "Detail per Akun (COA)" table renders with real account rows; open the budget-edit dialog on one row, save a value, confirm it appears in "APBP" column.
- "Detail Balance Sheet" renders with both `utama` and `logistik` accounts present (scroll to find at least one account name unique to `FINAC_LOGISTIC_PO`, e.g. "Sparepart" or "Vulkanisir").
- "Klasifikasi Biaya untuk BEP" lists prefix-6 accounts; tag 2-3 as FIXED, confirm the BEP card's "Biaya Tetap" figure updates after a page refresh.
- "Perhitungan HPP Bersih" table shows 12 account rows (6 from each database) with "Balok" wording (not "Kantong"), year navigation arrows work.

- [ ] **Step 4: Confirm no regression on MKEsindo's own `/pnl`**

Log in as an MKEsindo superadmin, load `/pnl`, confirm every panel (P&L, BEP, Cash Flow, Cash Flow Harian, COA Detail, Balance Sheet, HPP Bersih) still shows MKEsindo's own data exactly as before this plan (this is the regression check for Tasks 8-10's prop-injection refactors).

- [ ] **Step 5: Final commit if any fixes were needed**

If Steps 3-4 surfaced any issues, fix them, re-run Steps 1-4, then:
```bash
git add -A
git commit -m "Fix issues found during PMPutra Keuangan verification pass"
```
