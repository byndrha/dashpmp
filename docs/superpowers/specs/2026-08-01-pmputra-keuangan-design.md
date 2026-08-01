# PT Prima Maesa Putra — Modul Keuangan (integrasi FINAC_ES_PO / FINAC_LOGISTIC_PO)

## Context

`/pmputra` exists today as a pure skeleton (sidebar + placeholder pages for 9 modules) with real,
already-working connections to both PMPutra databases (`getPmputraPool("utama")` →
`FINAC_ES_PO`, `getPmputraPool("logistik")` → `FINAC_LOGISTIC_PO`, both resolved via
`perusahaan_koneksi`, already verified reachable and live). An Accounting account ("Nila",
`peran_id=1009`, `perusahaan_id=2`) already exists and can log in, landing on `/pmputra`.

This spec covers building out the **Keuangan** module specifically — the first of the 9 — to full
parity with MKEsindo's `/pnl` page (chosen as the starting module since it matches the Accounting
role that already exists). The other 8 modules (Piutang, Penjualan, Transaksi, Biaya Listrik,
Pengiriman, Pemesanan, Mitra, Pemasaran) are explicitly out of scope — separate future specs.

## Key findings from schema exploration

- `FINAC_ES_PO`/`FINAC_LOGISTIC_PO` are the same underlying ERP product as MKEsindo's own MSSQL
  database (same table names: `ChartOfAccount`, `GeneralLedger`, `SalesInvoice`, `BusinessPartner`,
  etc.) with ~300 tables each, plus dozens of `PMP_*` custom tables the business already added
  directly into `FINAC_ES_PO` for their own logistics/order-scheduling needs (not part of the base
  ERP product).
- `ChartOfAccount.AccountNo` follows the same standard-Indonesian-COA prefix convention MKEsindo's
  queries already rely on (4=Pendapatan, 5=HPP, 6=Beban Operasional, 7=Penghasilan Lainnya,
  8=Beban Lainnya) — confirmed against real PMPutra COA rows (e.g. `4001`="Pendapatan Balok
  Kecil", `6105`="Listrik"). `GeneralLedger` has 592,601 real rows, active through today
  (2026-08-01).
- **`SalesInvoice`/`SalesInvoiceDetail` are empty** (0 rows) — PMPutra does not use the ERP's
  standard Sales module. Real order/delivery data instead lives in the custom `PMP_Pemesanan`
  table (201,759 rows, active through today, 11,157 rows in 2026 alone), which has
  `BalokKecilRealisasi`/`BalokBesarRealisasi` (realized/delivered quantities) and `Status` (`'3'` =
  completed, 99.96% of 2026 rows).
- Two of MKEsindo's 7 Keuangan sub-reports depend on MKEsindo-only custom tables with no PMPutra
  equivalent yet: **Cash Flow Harian** (`DashboardCashFlowDaily`/`DashboardCashFlowExpense` — daily
  manually-entered cash balance + expense log) and **Detail COA vs Budget**
  (`DashboardBudget` — manually-entered monthly budget per account). Both need new tables + input
  UI built for PMPutra, not just a repointed read query.
- **BEP has the same problem**: it classifies prefix-6 accounts by `ChartOfAccount.CostBehavior`
  (`FIXED`/`VARIABLE`/`MIXED`, manually tagged per account) — a column that exists on MKEsindo's
  copy of this ERP's `ChartOfAccount` table but **is not part of PMPutra's schema at all**
  (confirmed via `INFORMATION_SCHEMA.COLUMNS` — PMPutra's `ChartOfAccount` has no `CostBehavior`
  column). Needs the same treatment as Cash Flow Harian/Budget: add the column, build a small
  classification UI.

## Decisions made during brainstorming

- **Full scope**: all 7 of MKEsindo's Keuangan sub-reports get a PMPutra equivalent in this pass —
  P&L, BEP, Detail COA vs Budget, Balance Sheet, Cash Flow, Cash Flow Harian, HPP Bersih —
  including building the two new input tables/UIs, not deferring them.
- **Two databases, one consolidated report** (not two side-by-side reports): `FINAC_LOGISTIC_PO` is
  the logistics side of the same PT, not a separate legal entity. Every report combines both.
- **Consolidation happens in application code, at the category level, not raw SQL**: MSSQL can't
  JOIN across two separate databases here. Each report's query runs once against `getPmputraPool
  ("utama")` and once against `getPmputraPool("logistik")`, each independently classifying its own
  `ChartOfAccount` rows into categories (Pendapatan/HPP/etc, or account-group buckets for Balance
  Sheet) — only the resulting category totals are summed together. This is safe because
  classification depends only on each database's own `AccountNo`, never a cross-database ID
  comparison (the two DBs' `ChartOfAccountID`/`AccountNo` values are unrelated codespaces, e.g.
  `6119` means "Oli" in `utama` and "Ban Baru" in `logistik`).
- **HPP Bersih's specific accounts** (user-provided, verified against real COA rows):
  - `utama` (FINAC_ES_PO): `6105` Listrik, `6113` Garam, `6112` Air, `6103` Sewa, `6119` Oli
    (Mesin Produksi), `6124` Amoniak.
  - `logistik` (FINAC_LOGISTIC_PO): `6122.01` BBM ES, `6115` Sparepart, `6121` Oli (Kendaraan),
    `6114` Vulkanisir, `6119` Ban Baru, `6103` Sewa (Prama).
  - Display labels use the user's fuller descriptive names (e.g. "Oli Mesin Produksi" / "Oli
    Kendaraan") rather than the raw COA `Description` alone, since both databases have an account
    literally named just "Oli" — ambiguous once combined into one list.
- **HPP Bersih's per-unit ratio divisor**: sum of `BalokKecilRealisasi + BalokBesarRealisasi` from
  `PMP_Pemesanan` (WHERE `Status = '3'` AND `IsVoid = 0` AND `IsDeleted = 0`), grouped by month —
  "per Balok terjual", combining kecil+besar into one denominator, mirroring MKEsindo's
  kantong-based ratio exactly except for the unit and source table.
- **New custom tables live in `FINAC_ES_PO`** (not Postgres), prefixed `PMP_` to match the
  business's own existing convention there (`PMP_Pemesanan`, `PMP_Penjadwalan`, etc.) — keeps this
  feature on a single connection (`getPmputraPool("utama")`) instead of introducing Postgres as a
  third data source for what's otherwise a pure MSSQL reporting feature.

## Data model additions

**`FINAC_ES_PO`** (one-off DDL script, run once via `npx tsx`, then discarded — same convention as
every other DDL in this project):

```sql
CREATE TABLE PMP_CashFlowDaily (
  ID INT IDENTITY PRIMARY KEY,
  BusinessDate DATE NOT NULL UNIQUE,
  SaldoAwal DECIMAL(18,2) NOT NULL,
  SaldoAkhir DECIMAL(18,2) NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
  UpdatedAt DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE PMP_CashFlowExpense (
  ID INT IDENTITY PRIMARY KEY,
  BusinessDate DATE NOT NULL,
  Keterangan VARCHAR(256) NOT NULL,
  Nominal DECIMAL(18,2) NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE PMP_Budget (
  ID INT IDENTITY PRIMARY KEY,
  ChartOfAccountID VARCHAR(16) NOT NULL,
  Year INT NOT NULL,
  Month INT NOT NULL,
  Nominal DECIMAL(18,2) NOT NULL,
  UNIQUE (ChartOfAccountID, Year, Month)
);

ALTER TABLE ChartOfAccount ADD CostBehavior VARCHAR(16) NULL;
```

`CostBehavior` is added directly to the vendor `ChartOfAccount` table (not a `PMP_` custom table) —
matching exactly how MKEsindo's own copy of this same ERP already carries it, so the BEP query
logic ports over unchanged once the column exists and is populated.

Same shape as MKEsindo's `DashboardCashFlowDaily`/`DashboardCashFlowExpense`/`DashboardBudget` —
deliberately not reusing those tables (they're on a completely different MSSQL server) or renaming
their columns, to keep the query-layer logic (see below) a near-verbatim port.

## Query layer

New file `src/lib/queries/pnl-pmputra.ts`, one function per report, each following the same shape:
run the equivalent of the MKEsindo query against both pools, sum category totals. Example for P&L:

```ts
async function getPnLForPool(pool: sql.ConnectionPool, filter: DateRangeFilter): Promise<PnLCategoryTotals> {
  // same PNL_KATEGORI_CASE + GeneralLedger/ChartOfAccount query as pnl.ts, parameterized by pool
}

export async function getPnLPmputra(filter: DateRangeFilter): Promise<PnLSummary> {
  const [utama, logistik] = await Promise.all([
    getPnLForPool(await getPmputraPool("utama"), filter),
    getPnLForPool(await getPmputraPool("logistik"), filter),
  ]);
  // sum utama + logistik per category, then same derivation math as pnl.ts's getPnL
}
```

Same pattern for BEP (`getBEPPmputra`) and Balance Sheet (`getBalanceSheetPmputra`) — reuses each
existing query's SQL shape, parameterized by pool and run twice.

**Important carve-out caveat**: `PNL_KATEGORI_CASE`'s base prefix split (4/5/6/7/8) is safe to
reuse as-is — confirmed against real PMPutra COA rows. Its *specific carve-out codes* are not:
`AccountNo = '6115'` is hardcoded as "BiayaTetap" because that's "Air" (a utility) in MKEsindo's own
COA — but `6115` means "Sparepart" in PMPutra's `logistik` database, which should stay
"BebanOperasional". The carve-out list (`630x` tax → Adjustment; `6101%`/`6103`/`6115`/`640%` →
BiayaTetap) must be re-derived per PMPutra database by checking what each specific code actually
means there, not copy-pasted from `pnl.ts`. `6103` ("Sewa") happens to check out already (confirmed
in both PMPutra databases), but every other carve-out code needs the same verification during
implementation before the query is written.

Cash Flow (`getCashFlowPmputra`) follows the same twice-then-sum pattern for its GeneralLedger-based
figures.

Cash Flow Harian (`getCashFlowHarianPmputra`) and Budget-vs-Actual (`getCOADetailPmputra`) read/write
`PMP_CashFlowDaily`/`PMP_CashFlowExpense`/`PMP_Budget` — single-database (`utama` only, since these
are manual entries the Accounting user makes directly, no reason to split across two DBs) — closely
mirroring `cash-flow-harian.ts`/`keuangan-detail.ts`'s existing logic and server actions
(add/delete expense, set daily saldo, set monthly budget per account).

A small new admin UI (part of the Budget-vs-Actual area) lets Nila tag each of PMPutra's ~180
`ChartOfAccount` rows with `CostBehavior` (FIXED/VARIABLE/MIXED/untagged) — untagged accounts are
excluded from BEP's `WHERE ... CostBehavior IS NOT NULL` clause, same as MKEsindo's existing
behavior, so BEP is simply incomplete (not wrong) until this classification work is done.

HPP Bersih (`getHPPBersihPmputra`) — new logic (not a direct port): fixed 12-account list (6 per
database, hardcoded like MKEsindo's `HPP_BERSIH_ACCOUNT_NOS`, but here also carrying which pool
each belongs to), monthly nominal per account via the same `GeneralLedger` groupby pattern, divided
by monthly `SUM(BalokKecilRealisasi + BalokBesarRealisasi)` from `PMP_Pemesanan` (`utama` only,
since that's the order table's home database).

## UI

New route `src/app/pmputra/keuangan/page.tsx` (a static sibling to the `[modul]` catch-all — Next.js
resolves the static route for an exact `/pmputra/keuangan` match, leaving the other 8 module keys on
the existing placeholder). Reuses existing presentational components as-is where the data shape
matches (`KpiCard`, `SimpleBarChart`, `COADetailTable`, `BalanceSheetTable`, `CashFlowPanel`,
`CashFlowHarianPanel`, `CashFlowHarianHistoryPanel`, `HPPBersihPanel`, `FilterBar`) — same visual
language as MKEsindo's `/pnl`, per the user's original "gunakan tampilan seperti modul yang sudah
kita bangun" instruction from the earlier multi-company design. New server actions for the two
input features (`addCashFlowExpensePmputraAction`, `setCashFlowSaldoPmputraAction`,
`setBudgetPmputraAction`, etc.) in `src/app/pmputra/keuangan/actions.ts`, gated by `requirePmputra()`.

## Non-goals

- No changes to any other `/pmputra` module (Piutang, Penjualan, etc.) — still placeholders.
- No changes to MKEsindo's own `/pnl` or its query files — every PMPutra query lives in new,
  separate files.
- No per-module permission gating added to `/pmputra` in this pass (today, any `pmputra`-scope
  account sees the full sidebar) — out of scope, unrelated to data integration.
- TransDate WIB/UTC handling: not re-litigated here — the existing project-wide convention
  (documented elsewhere) is followed as-is; if a boundary bug surfaces during implementation it's
  fixed the same way it was for MKEsindo, not redesigned.

## Risks

- `PMP_Pemesanan.Status` semantics are inferred from data (`'3'` is overwhelmingly the common value
  for 2026 rows) rather than from a lookup table — worth a quick sanity check with the user during
  implementation if the numbers look off.
- HPP Bersih combines two databases' cost accounts by simple sum with no currency/scale
  normalization step — acceptable since both databases share the same currency (IDR) and company.
