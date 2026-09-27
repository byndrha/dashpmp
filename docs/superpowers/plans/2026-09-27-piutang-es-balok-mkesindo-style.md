# Piutang Es Balok — Redesain ala MKEsindo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Piutang page for pmputra and pmpersada (Es Balok) to match MKEsindo's `/mkesindo/aging` layout — a 3-row KPI panel, a Sehat/Perhatian/Kritis status panel, and 3 tabs (Invoice Outstanding, Pembayaran, Prioritas Pemulihan) — while keeping the existing "Total Piutang/Tabungan Mitra Saat Ini" KPI cards, the monthly trend table, and "Rincian per Agen" untouched.

**Architecture:** Two new query files compute an approximate per-Pesanan "invoice" view via FIFO payment matching (Es Balok has no invoice-level due date or payment-to-order link, unlike MKEsindo's `vCustomerStatement`) and a new Postgres table backs the "target pelunasan" feature. Every UI primitive (`KpiCard`, `PiutangStatusPanel`, `PiutangTabs`, `Dialog`, `Pagination`, `ExportXlsxButton`) is reused as-is from MKEsindo's own components — only the query layer and 3 new Es-Balok-specific table components are new.

**Tech Stack:** Next.js Server Components + Server Actions, TypeScript, `mssql` (per-company MSSQL pools via `getCompanyPool`), `pg` (directory Postgres via `getPgPool`), existing `@/components/ui/*` primitives.

**Spec:** `docs/superpowers/specs/2026-09-27-piutang-es-balok-mkesindo-style.md`

## Global Constraints

- No automated test runner exists in this repository (confirmed: no `test` script, no `*.test.ts` files). Every task's verification step is `npx tsc --noEmit` (must show zero errors for the changed files) plus a live browser check against the running dev server at the relevant route — the same verification convention used throughout this codebase's history. Do not attempt to introduce a test framework.
- FIFO matching (spec, section "Kendala model data"): per `(kode, sumber, AgenID)`, sort `PMP_Pemesanan` by `Tanggal` ascending; only `PMP_Pembayaran.Pembayaran` consumes Pesanan value (never `Tarikan` — Tarikan increases the balance, it does not settle an order).
- "Jatuh tempo" = `Tanggal Pesanan + 14 hari` (spec's documented assumption — implement exactly this value; do not invent a different grace period).
- Aging buckets/status thresholds are IDENTICAL to MKEsindo's `aging.ts`: bucket "Belum Jatuh Tempo" (DaysOverdue ≤ 0), "1-30 Hari" (≤30), "31-60 Hari" (≤60), "61-90 Hari" (≤90), ">90 Hari" (else). Status "Sehat" (≤30 or null), "Perhatian" (≤60), "Kritis" (else).
- AgenID is the SAME literal string across a company's "utama" and "logistik" databases for one physical mitra (confirmed by reading `getPiutangPerAgen`'s existing cross-source merge logic in `penjualan-piutang.ts`) — no cross-database ID reconciliation is needed anywhere in this plan.
- `PMPAKIS_OWN_BRANCH_ID`/pmpakis are OUT OF SCOPE — pmpakis has no Piutang page yet. Every new function only needs to handle `kode === "pmputra"` and `kode === "pmpersada"`.
- Never removes or changes behavior of: `PiutangPerAgenTable`, `PiutangBayarDialog`, `getPiutangSummary`, `getPiutangPerAgen`, `bayarPiutang`/`tarikPiutang`, the monthly trend table in `piutang-summary-panel.tsx` added earlier this session.
- New Postgres DDL is executed once, directly, against the directory database (no migration-file system exists in this repo — confirmed, do not add one). Correction from the original plan text (ledgered during execution): the SQL MCP tools available in this environment only reach SQL Server/MSSQL databases, not the Postgres directory DB — the DDL was actually run via a throwaway `npx tsx` script importing `getPgPool()` (see Task 2's own execution notes).

## Review Focus

1. An Agen whose current balance is a Tabungan (negative net) must NEVER appear in Invoice Outstanding / Status Panel / Prioritas Pemulihan — all three are scoped to `outstanding > 0` rows only, same as MKEsindo's `WHERE ... > 0` filters.
2. A Pesanan that is fully covered by Retur (net value ≤ 0) must be excluded from FIFO entirely (never consumed, never emitted as a 0-or-negative "outstanding" row) — Task 3's Step 3 test must cover this.
3. FIFO must never let `remainingPayment` go negative or double-consume — Task 3's Step 3 test must include an Agen whose total Pembayaran exceeds the sum of all their Pesanan (fully paid, zero rows emitted) and one whose payment sits exactly between two Pesanan (first fully consumed, second partially).
4. The FIFO-and-row-level fetch must stay bounded to Agen with a positive current balance only — fetching every Pesanan/Pembayaran row for the WHOLE roster is the exact connection-pool-exhaustion mistake this module hit earlier this session (see `getPiutangPerAgen`'s own comments); Task 3 must filter the roster down first.
5. "Total Piutang Outstanding" (new KPI card) and the existing "Total Piutang Mitra Saat Ini" card must show the IDENTICAL Rupiah figure. **Resolved by construction, not by reconciliation** (Ruling recorded in the SDD ledger after Task 3 surfaced a genuine conflict: per-source FIFO cannot mathematically reproduce `getPiutangSummary`'s cross-source-netted total whenever an Agen has opposite-signed balances in utama vs logistik — confirmed live on pmputra, ~29% gap). "Total Piutang Outstanding" reads `data.totalPiutangSaatIni` directly (the SAME value already used by the existing card), never a sum of FIFO rows — `EsBalokPeriodSummary` has NO `totalOutstanding` field. Task 9/10's verification step confirms both cards render the same prop-sourced value, not that two independent computations happen to agree.

---

## Task 1: Export shared per-Agen helpers (no behavior change)

**Files:**
- Modify: `src/lib/queries/penjualan-piutang.ts:213,224,438,722,742` (add `export` to `AgenNetRow`, `getAgenBaselineNet`, `getAgenRoster`, `getPemesananNetByAgenBefore`, `getPembayaranNetByAgenBefore`)
- Modify: `src/lib/queries/piutang-pembayaran.ts:15` (add `export` to `branchFilterFor`)

**Interfaces:**
- Produces: `export interface AgenNetRow { AgenID: string; Net: number }`, `export async function getAgenBaselineNet(kode: string, sumber: SumberAgen): Promise<AgenNetRow[]>`, `export async function getAgenRoster(kode: string): Promise<{ AgenID: string; Nama: string; Segmentasi: Segmentasi | null; Latitude: number | null; Longitude: number | null }[]>`, `export async function getPemesananNetByAgenBefore(kode: string, sumber: SumberAgen, start: Date): Promise<AgenNetRow[]>`, `export async function getPembayaranNetByAgenBefore(kode: string, sumber: SumberAgen, start: Date): Promise<AgenNetRow[]>`, `export function branchFilterFor(kode: string, sumber: SumberAgen): string | null`.

- [ ] **Step 1: Add `export` to each of the 6 declarations listed above** — purely mechanical, no logic changes, no renames.

- [ ] **Step 2: Run `npx tsc --noEmit`**

Expected: zero new errors (these were already valid internal names; exporting them cannot break anything that compiled before).

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/penjualan-piutang.ts src/lib/queries/piutang-pembayaran.ts
git commit -m "refactor: ekspor helper Agen-ledger untuk dipakai modul Piutang Es Balok baru"
```

---

## Task 2: Postgres target-pelunasan table + CRUD

**Files:**
- Create: `src/lib/queries/piutang-target-es-balok.ts`

**Interfaces:**
- Consumes: `getPgPool()` from `@/lib/pg` (pattern: `pool.query(sql, params)` with `$1, $2` placeholders — see `src/lib/queries/metode-pembayaran.ts:150-181` for the exact style to follow).
- Produces: `export interface EsBalokCollectionTarget { agenId: string; targetDate: string | null; targetAmount: number | null; note: string | null }`, `export async function getEsBalokCollectionTargets(kode: string): Promise<Map<string, EsBalokCollectionTarget>>`, `export async function setEsBalokCollectionTarget(kode: string, agenId: string, input: { targetDate: string | null; targetAmount: number | null; note: string | null }, userId: string): Promise<void>`, `export async function removeEsBalokCollectionTarget(kode: string, agenId: string): Promise<void>`.

- [ ] **Step 1: Create the Postgres table** by running this exact DDL once against the directory database, via the available SQL execution tool (this is a one-time manual action, not app code — do not add a migration runner):

```sql
CREATE TABLE IF NOT EXISTS piutang_es_balok_target (
  id BIGSERIAL PRIMARY KEY,
  kode VARCHAR(32) NOT NULL,
  agen_id VARCHAR(16) NOT NULL,
  target_date DATE,
  target_amount NUMERIC(18,2),
  note VARCHAR(256),
  created_by_user_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kode, agen_id)
);
```

Verify: query `SELECT to_regclass('piutang_es_balok_target');` returns a non-null value.

- [ ] **Step 2: Implement `getEsBalokCollectionTargets(kode)` in `src/lib/queries/piutang-target-es-balok.ts`**

`SELECT agen_id, target_date, target_amount, note FROM piutang_es_balok_target WHERE kode = $1`, mapped into a `Map<string, EsBalokCollectionTarget>` keyed by `agen_id` (so callers can do an O(1) lookup per Agen instead of an array `.find`).

- [ ] **Step 3: Implement `setEsBalokCollectionTarget(kode, agenId, input, userId)`**

An `INSERT ... ON CONFLICT (kode, agen_id) DO UPDATE SET target_date = EXCLUDED.target_date, target_amount = EXCLUDED.target_amount, note = EXCLUDED.note, updated_at = now()` — same upsert intent as MKEsindo's `setCollectionTarget` MERGE, translated to Postgres's `ON CONFLICT` syntax.

- [ ] **Step 4: Implement `removeEsBalokCollectionTarget(kode, agenId)`**

`DELETE FROM piutang_es_balok_target WHERE kode = $1 AND agen_id = $2`.

- [ ] **Step 5: Run `npx tsc --noEmit`**

Expected: zero errors in `piutang-target-es-balok.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/piutang-target-es-balok.ts
git commit -m "feat: tabel + CRUD target pelunasan Piutang Es Balok (Postgres)"
```

---

## Task 3: FIFO invoice-outstanding engine + period summary + status overview

**Files:**
- Create: `src/lib/queries/piutang-invoice-outstanding.ts`

**Interfaces:**
- Consumes: `getAgenRoster`, `getAgenBaselineNet`, `getPemesananNetByAgenBefore`, `getPembayaranNetByAgenBefore`, `AgenNetRow` (Task 1, from `@/lib/queries/penjualan-piutang`); `branchFilterFor` (Task 1, from `@/lib/queries/piutang-pembayaran`); `resolveAgenKoneksi`, `type SumberAgen` (from `@/lib/queries/mitra-es-balok`); `getCompanyPool` (from `@/lib/db-company`); `sql` (from `@/lib/db`); `type Segmentasi` (from `@/lib/segmentasi-mitra`).
- Produces: `export type EsBalokAgingBucket = "Belum Jatuh Tempo" | "1-30 Hari" | "31-60 Hari" | "61-90 Hari" | ">90 Hari"`, `export type EsBalokPiutangStatus = "Sehat" | "Perhatian" | "Kritis"`, `export interface EsBalokInvoiceRow { agenId: string; agenNama: string; segmentasi: Segmentasi | null; sumber: SumberAgen; noDokumen: string; tanggal: string; outstanding: number; daysOverdue: number; agingBucket: EsBalokAgingBucket; status: EsBalokPiutangStatus }`, `export async function getEsBalokInvoiceOutstanding(kode: string): Promise<EsBalokInvoiceRow[]>`, `export function esBalokAgingBucket(daysOverdue: number): EsBalokAgingBucket`, `export function esBalokStatus(daysOverdue: number | null): EsBalokPiutangStatus`, `export interface EsBalokPeriodSummary { saldoAwalPeriode: number; totalPembayaranPeriode: number; totalPenjualanPeriode: number; sudahJatuhTempo: number; kritisNominal: number }` (deliberately has NO `totalOutstanding`/`ratioPiutangOmzetPct` field — see Task 6 Step 3/4 and the Global Constraints Review Focus #5 note on why), `export async function getEsBalokPiutangPeriodSummary(kode: string, start: Date, end: Date, invoiceRows: EsBalokInvoiceRow[]): Promise<EsBalokPeriodSummary>`, `export interface EsBalokStatusBucket { status: EsBalokPiutangStatus; mitraCount: number; outstanding: number }`, `export function getEsBalokStatusOverview(rows: EsBalokInvoiceRow[]): EsBalokStatusBucket[]`.

- [ ] **Step 1: Implement `esBalokAgingBucket(daysOverdue)` and `esBalokStatus(daysOverdue)`**

Pure functions, no DB access — port the exact `CASE` thresholds from `src/lib/queries/aging.ts:95-101` (bucket) and `:50-55` (status) into JS `if`/`else` chains. `esBalokStatus(null)` returns `"Sehat"` (matches `aging.ts`'s `MaxDaysOverdue IS NULL` branch).

- [ ] **Step 2: Implement `getEsBalokInvoiceOutstanding(kode)` — Part A: bound the roster to Agen with a positive current balance**

For each `sumber` in `["utama", "logistik"]`, call `getAgenBaselineNet`, then sum with net-to-date Pesanan/Pembayaran (reuse the exact same 3-source-summing pattern already in `getPiutangSummary` — `getPemesananNetByAgen`/`getPembayaranNetByAgen` are NOT exported and NOT needed here; instead call `getPemesananNetByAgenBefore`/`getPembayaranNetByAgenBefore` with `start = new Date(8640000000000000)` i.e. the max representable Date, which yields the Agen's TOTAL net-to-date exactly like the unbounded versions) to build one `Map<AgenID, number>` of each Agen's current net across both sources combined. Filter to `AgenID`s where `net > 0`. This is the SAME roster-narrowing purpose as `getPiutangPerAgen`'s existing pattern — do not skip it, it is what keeps the next step's per-row fetch cheap (see Review Focus #4).

- [ ] **Step 3: Implement `getEsBalokInvoiceOutstanding(kode)` — Part B: fetch raw rows and run FIFO, only for the filtered Agen set**

For each `sumber`, run one query returning EVERY non-deleted `PMP_Pemesanan` row (`AgenID`, `NoDokumen`, `Tanggal`, net value `= (BalokKecilRealisasi-ISNULL(BalokKecilRetur,0))*BalokKecilHarga + (BalokBesarRealisasi-ISNULL(BalokBesarRetur,0))*BalokBesarHarga`) filtered to `AgenID IN (...)` (the Part A set) and `branchFilterFor`'s filter when non-null, plus one query summing `PMP_Pembayaran.Pembayaran` per `AgenID` (same `AgenID IN (...)` + branch filter) for that source. Then, in JS, group Pesanan rows by `AgenID`, sort each group by `Tanggal` ascending, and run FIFO:

```ts
let remainingPayment = totalPembayaranByAgen.get(agenId) ?? 0;
for (const pesanan of pesananSortedAsc) {
  if (pesanan.netValue <= 0) continue; // fully-retur'd order never enters FIFO (Review Focus #2)
  const consumed = Math.min(remainingPayment, pesanan.netValue);
  remainingPayment -= consumed;
  const outstanding = pesanan.netValue - consumed;
  if (outstanding > 0.01) {
    // emit one EsBalokInvoiceRow: daysOverdue = days between (Tanggal + 14) and today
  }
}
```

Join `agenNama`/`segmentasi` from `getAgenRoster(kode)` (utama-only roster, same limitation `getPiutangPerAgen` already documents and accepts). `daysOverdue = Math.floor((Date.now() - (tanggal.getTime() + 14*86400000)) / 86400000)`.

- [ ] **Step 4: Implement `getEsBalokPiutangPeriodSummary(kode, start, end, invoiceRows)`**

**No `totalOutstanding`/`ratioPiutangOmzetPct` field here** (Ruling, SDD ledger: per-source FIFO cannot reconcile exactly to `getPiutangSummary`'s cross-source-netted total whenever an Agen has opposite-signed balances in utama vs logistik — confirmed on real pmputra data, ~29% gap. "Total Piutang Outstanding" and the ratio are computed by the CALLER — Task 6 — directly from `data.totalPiutangSaatIni` (a prop it already has from the existing `getPiutangSummary` call), never from a FIFO-rows sum. This function only returns the 4 fields below, all independently well-defined regardless of the netting question):
- `saldoAwalPeriode`: for each `sumber`, sum `getAgenBaselineNet` + `getPemesananNetByAgenBefore(kode, sumber, start)` + `getPembayaranNetByAgenBefore(kode, sumber, start)` into one net-per-Agen map (same pattern as Step 2 but cutoff = the caller's `start`, not max-date), then sum only the POSITIVE nets (same `if (net >= 0) total += net` rule as `getPiutangSummary`'s own `totalPiutangSaatIni` loop).
- `totalPembayaranPeriode`: one query per source, `SELECT SUM(ISNULL(Pembayaran,0)) FROM PMP_Pembayaran WHERE IsDeleted=0 AND Tanggal >= @start AND Tanggal < @end` (+ branch filter), summed across sources.
- `totalPenjualanPeriode`: one query per source, `SELECT SUM(net Pesanan value) FROM PMP_Pemesanan WHERE IsDeleted=0 AND Tanggal >= @start AND Tanggal < @end` (+ branch filter), summed across sources.
- `sudahJatuhTempo = invoiceRows.filter(r => r.agingBucket !== "Belum Jatuh Tempo").reduce((s, r) => s + r.outstanding, 0)` (mirrors `piutang-sections.tsx:54-56`'s `totalOverdue` — an informational subtotal of the FIFO/Invoice-Outstanding view itself, not required to reconcile to `totalPiutangSaatIni`).
- `kritisNominal = invoiceRows.filter(r => r.agingBucket === ">90 Hari").reduce((s, r) => s + r.outstanding, 0)` (mirrors `piutang-sections.tsx:57`'s `totalCritical`, same caveat as above).

- [ ] **Step 5: Implement `getEsBalokStatusOverview(rows)`**

Pure function (no DB access): group `rows` by `agenId`, per-Agen `maxDaysOverdue = Math.max(...group.map(r => r.daysOverdue))` and `status = esBalokStatus(maxDaysOverdue)`, then bucket into 3 `EsBalokStatusBucket`s (`Kritis`, `Perhatian`, `Sehat`) with `mitraCount` and summed `outstanding`, mirroring `getPiutangStatusOverview` in `aging.ts:176-187`.

- [ ] **Step 6: Manual verification — run against real data**

Spot-check ONE Agen known to have outstanding orders (e.g. an Agen shown in "Rincian per Agen" with `SISA HUTANG > 0` for pmputra) whose balance is NOT split across both sources with opposite signs (i.e. one source is zero/near-zero, or both sources are the same sign) — for such an Agen, the sum of that Agen's `EsBalokInvoiceRow.outstanding` from `getEsBalokInvoiceOutstanding("pmputra")` SHOULD equal their `SISA HUTANG` figure shown on the existing card. This will NOT hold for an Agen with a genuine credit in one source and a debt in the other (per-source FIFO structurally cannot see the other source's offsetting balance — this is expected and correct, not a bug; see Global Constraints' Review Focus #5 note) — if your spot-check Agen happens to be one of these, pick a different one rather than treating the mismatch as a failure. Then find (or construct via a temporary console log of the FIFO inputs) 2 more cases and confirm by hand: (a) an Agen whose total Pembayaran ≥ sum of all their Pesanan's net value — must produce ZERO rows for that Agen (Review Focus #3); (b) an Agen with ≥2 Pesanan where the payment total falls strictly between the first Pesanan's value and the sum of the first two — must produce exactly ONE row (the second Pesanan, partially outstanding), not two.

- [ ] **Step 7: Run `npx tsc --noEmit`**

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/piutang-invoice-outstanding.ts
git commit -m "feat: engine FIFO invoice-outstanding + ringkasan periode Piutang Es Balok"
```

---

## Task 4: Collection priority query + Pembayaran-by-date query

**Files:**
- Create: `src/lib/queries/piutang-priority-es-balok.ts`

**Interfaces:**
- Consumes: `EsBalokInvoiceRow`, `EsBalokPiutangStatus`, `esBalokStatus` (Task 3); `getAgenRoster`, `resolveAgenKoneksi`, `branchFilterFor` (Task 1); `getEsBalokCollectionTargets` (Task 2); `getCompanyPool`, `sql`.
- Produces: `export interface EsBalokPriorityRow { agenId: string; agenNama: string; segmentasi: Segmentasi | null; piutangBerjalan: number; maxDaysOverdue: number | null; status: EsBalokPiutangStatus; terakhirPesan: string | null; terakhirBayar: string | null; targetDate: string | null; targetAmount: number | null; targetNote: string | null; isTarget: boolean }`, `export async function getEsBalokCollectionPriority(kode: string, invoiceRows: EsBalokInvoiceRow[]): Promise<EsBalokPriorityRow[]>`, `export interface EsBalokPembayaranRow { agenId: string; agenNama: string; sumber: SumberAgen; noDokumen: string; tanggal: string; pembayaran: number; tarikan: number; sisaPiutang: number; status: EsBalokPiutangStatus }`, `export async function getEsBalokPembayaranByDate(kode: string, date: Date, invoiceRows: EsBalokInvoiceRow[]): Promise<EsBalokPembayaranRow[]>`.

- [ ] **Step 1: Implement `getEsBalokCollectionPriority(kode, invoiceRows)`**

Group `invoiceRows` by `agenId`: `piutangBerjalan = sum(outstanding)`, `maxDaysOverdue = max(daysOverdue)`. For each such Agen (only Agen present in `invoiceRows`, i.e. `piutangBerjalan > 0`), fetch `terakhirPesan`/`terakhirBayar` via one small query per source (`SELECT AgenID, MAX(Tanggal) FROM PMP_Pemesanan WHERE IsDeleted=0 AND AgenID IN (...) GROUP BY AgenID` and the equivalent for `PMP_Pembayaran`, taking the later of the two sources' MAX per Agen), and left-join `getEsBalokCollectionTargets(kode)` for `targetDate`/`targetAmount`/`targetNote`/`isTarget` (`isTarget = targets.has(agenId)`). `status = esBalokStatus(maxDaysOverdue)`. Sort by `piutangBerjalan` descending.

- [ ] **Step 2: Implement `getEsBalokPembayaranByDate(kode, date, invoiceRows)`**

For each `sumber`, query `PMP_Pembayaran` rows where `Tanggal >= @date AND Tanggal < DATEADD(DAY,1,@date)` (+ branch filter), returning `AgenID, NoDokumen, Tanggal, Pembayaran, Tarikan`. Join `agenNama` from `getAgenRoster(kode)`. For `sisaPiutang`/`status`, build a `Map<agenId, outstanding>` from `invoiceRows` first (sum per Agen) and look up (default `0`/`esBalokStatus(null)` for an Agen with no outstanding rows). Sort by `Tanggal` descending.

- [ ] **Step 3: Run `npx tsc --noEmit`**

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/piutang-priority-es-balok.ts
git commit -m "feat: query prioritas pemulihan + pembayaran harian Piutang Es Balok"
```

---

## Task 5: Server actions for both companies

**Files:**
- Modify: `src/app/pmputra/piutang/actions.ts`
- Modify: `src/app/pmpersada/(dashboard)/piutang/actions.ts`

**Interfaces:**
- Consumes: everything Task 3 and Task 4 produce; `requirePmputra`/`requirePmpersadaKeuangan` (already imported in both files).
- Produces (added to EACH file, `KODE` already defined per file):
  - `export async function getEsBalokInvoiceOutstandingAction(): Promise<EsBalokInvoiceRow[]>`
  - `export async function getEsBalokPeriodSummaryAction(startDate: string, endDate: string): Promise<EsBalokPeriodSummary>` (compute `invoiceRows` internally via `getEsBalokInvoiceOutstanding(KODE)` then call `getEsBalokPiutangPeriodSummary`)
  - `export async function getEsBalokStatusOverviewAction(): Promise<EsBalokStatusBucket[]>`
  - `export async function getEsBalokCollectionPriorityAction(): Promise<EsBalokPriorityRow[]>`
  - `export async function setEsBalokCollectionTargetAction(agenId: string, input: { targetDate: string | null; targetAmount: number | null; note: string | null }): Promise<{ success: true } | { success: false; error: string }>` (wrap in try/catch, `userId` from the session — check how `bayarPiutangAction` or another mutating action in this codebase obtains the current user id and follow the same pattern)
  - `export async function removeEsBalokCollectionTargetAction(agenId: string): Promise<{ success: true } | { success: false; error: string }>`
  - `export async function getEsBalokPembayaranByDateAction(dateISO: string): Promise<EsBalokPembayaranRow[]>` (compute `invoiceRows` internally, parse `dateISO` as `new Date(\`${dateISO}T00:00:00\`)`)

- [ ] **Step 1: Find how an existing mutating Server Action in this codebase resolves the current user's ID** (grep for `getServerSession`/`auth()`/similar in `src/app/pmputra/piutang/actions.ts`'s neighboring files, e.g. how `mitra-pengajuan` or `akun` actions get `userId`), and use that exact pattern for `setEsBalokCollectionTargetAction`.

- [ ] **Step 2: Add all 7 actions to `src/app/pmputra/piutang/actions.ts`** with `KODE = "pmputra"`, each wrapped with `await requirePmputra();` first (matching every existing action in the file).

- [ ] **Step 3: Add the same 7 actions to `src/app/pmpersada/(dashboard)/piutang/actions.ts`** with `KODE = "pmpersada"`, each wrapped with `await requirePmpersadaKeuangan();`.

- [ ] **Step 4: Run `npx tsc --noEmit`**

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/pmputra/piutang/actions.ts" "src/app/pmpersada/(dashboard)/piutang/actions.ts"
git commit -m "feat: server actions untuk panel KPI, 3 tab, dan target pelunasan Piutang Es Balok"
```

---

## Task 6: KPI panel + status panel (top of page)

**Files:**
- Modify: `src/components/dashboard/piutang-summary-panel.tsx`

**Interfaces:**
- Consumes: `EsBalokPeriodSummary`, `EsBalokStatusBucket` (Task 3, imported as types); `getEsBalokPeriodSummaryAction`, `getEsBalokStatusOverviewAction` (Task 5, passed as props — this component must stay a Client Component per its existing `"use client"`, so it CANNOT import Server Actions from a different route's `actions.ts` directly for a different-page reuse; instead accept them as function props, same as `PiutangPerAgenTable` already does with `fetchAction`).
- Produces: `PiutangSummaryPanel` gains 2 new OPTIONAL props: `fetchPeriodSummary?: (startDate: string, endDate: string) => Promise<EsBalokPeriodSummary>`, `fetchStatusOverview?: () => Promise<EsBalokStatusBucket[]>`. Optional (not required) so this task leaves every existing caller (both page.tsx files, still on the old prop set until Task 9/10) compiling and rendering exactly as before — when the props are omitted, skip rendering the 3 new rows entirely and render only what the component renders today. Existing props (`data: PiutangSummaryData`) unchanged — the 2 existing KPI cards and the monthly trend table this component already renders are NOT removed.

- [ ] **Step 1: If `fetchPeriodSummary`/`fetchStatusOverview` are both undefined, render the component exactly as it renders today (early return after the existing 2 KPI cards + trend table, skip everything below in Steps 2-5).** Otherwise, add a date-range state (`startDate`/`endDate`, default = current month start / today, same `monthStartISO`/`todayISO` helpers already in `piutang-per-agen-table.tsx` — copy them locally, this file doesn't import from that one) and a "Terapkan" button, matching the date-input markup already used in `PiutangPerAgenTable` (`<input type="date">` pair + `Button`).

- [ ] **Step 2: On mount and on "Terapkan", call `fetchPeriodSummary(startDate, endDate)` and `fetchStatusOverview()`, store results in state**, showing a `Skeleton` (already imported pattern elsewhere in this codebase, e.g. `AgingPage`'s `KpiRowSkeleton`) while loading.

- [ ] **Step 3: Render Row 1 (3 `KpiCard`s)**: "Saldo Awal Periode" (`Wallet` icon, `periodSummary.saldoAwalPeriode`), "Pembayaran Piutang Periode Ini" (`HandCoins` icon, `tone="positive"`, `periodSummary.totalPembayaranPeriode`), "Rasio Piutang / Omzet" (`Percent` icon, `tone={pct > 30 ? "negative" : "default"}` — compute `pct = periodSummary.totalPenjualanPeriode !== 0 ? (data.totalPiutangSaatIni / periodSummary.totalPenjualanPeriode) * 100 : 0` HERE in the component, using the EXISTING `data.totalPiutangSaatIni` prop as the numerator, not any field off `periodSummary` — see Step 4's note on why) — same icons/tones as `piutang-sections.tsx:34-46`.

- [ ] **Step 4: Render Row 2 (3 `KpiCard`s)**: "Total Piutang Outstanding" (`Receipt` icon — `data.totalPiutangSaatIni`, the SAME existing prop the "Total Piutang Mitra Saat Ini" card below already renders — deliberately NOT a field off `EsBalokPeriodSummary`, which has no such field; Ruling in the SDD ledger: per-source FIFO cannot be reconciled exactly to this cross-source-netted figure, so the two cards are made identical by sourcing the same value rather than by computing two numbers that are supposed to agree), "Sudah Jatuh Tempo" (`AlertTriangle` icon, `tone="warning"` — `periodSummary.sudahJatuhTempo`), ">90 Hari (Kritis)" (`Flame` icon, `tone="negative"` — `periodSummary.kritisNominal`).

- [ ] **Step 5: Render Row 3**: `PiutangStatusPanel` (import from `@/components/dashboard/piutang-status-panel`) fed with `statusOverview.map(b => ({ status: b.status, count: b.mitraCount, total: b.outstanding }))` — note this component's `StatusBucket` type imports `PiutangStatus` from `aging.ts`; since `EsBalokPiutangStatus` is the exact same 3-literal string union, a plain object literal satisfies it structurally without needing a cast.

- [ ] **Step 6: Keep the existing "Total Piutang Mitra Saat Ini" / "Total Tabungan Mitra Saat Ini" `KpiCard`s and the monthly trend `Card`** exactly where they are today, placed BELOW the 3 new rows (order: new Row 1 → new Row 2 → new Row 3 status panel → existing 2 KPI cards → existing trend table) — nothing about the existing JSX for those two pieces changes.

- [ ] **Step 7: Run `npx tsc --noEmit`**

Expected: zero errors — the 2 new props are optional, so existing callers (both page.tsx files, unchanged until Task 9/10) still type-check and render exactly as they do today.

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboard/piutang-summary-panel.tsx
git commit -m "feat: panel KPI 3-baris + status Sehat/Perhatian/Kritis ala MKEsindo"
```

---

## Task 7: Invoice Outstanding tab + Pembayaran tab UI

**Files:**
- Create: `src/components/dashboard/es-balok-invoice-outstanding-table.tsx`
- Create: `src/components/dashboard/es-balok-pembayaran-panel.tsx`

**Interfaces:**
- Consumes: `EsBalokInvoiceRow`, `EsBalokPembayaranRow`, `EsBalokPiutangStatus` (Task 3/4, as types); `formatRupiah`, `formatDate`, `formatDays` (`@/lib/format`); `segmentasiLabel`/`SEGMENTASI_OPTIONS` (`@/lib/segmentasi-mitra`); `Pagination`, `ExportXlsxButton`, `Card`/`CardContent`, `Badge`, `Input`, `Select*`.
- Produces: `export function EsBalokInvoiceOutstandingTable({ rows }: { rows: EsBalokInvoiceRow[] })`, `export function EsBalokPembayaranPanel({ rows, onDateChange }: { rows: EsBalokPembayaranRow[]; onDateChange: (dateISO: string) => void })`.

- [ ] **Step 1: `EsBalokInvoiceOutstandingTable` — group `rows` by `agenId`** (port `groupByMitra` from `aging-table.tsx:78-107`, replacing `BusinessPartnerID`/`CustomerName`/`Wilayah` fields with `agenId`/`agenNama`/`segmentasi`), producing per-Agen: `totalOutstanding`, `maxDaysOverdue`, `worstStatus`, and its list of `EsBalokInvoiceRow`s sorted newest-DaysOverdue-first.

- [ ] **Step 2: Render a searchable (`Input` on `agenNama`), sortable (by Nama / Outstanding / DaysOverdue, `SortToggle` pattern from `aging-table.tsx`), paginated (`Pagination`, page size 12) list of per-Agen cards**, each card showing: Nama + Segmentasi badge + worst-status `Badge` (colors from `STATUS_BADGE` in `aging-table.tsx:57-61`, same 3-key map), `TotalOutstanding`, and its Pesanan rows collapsed to 2 with a "+N transaksi lainnya" expand (same `COLLAPSED_PREVIEW_COUNT` pattern already used in `piutang-per-agen-table.tsx`'s `TransaksiRow`) — each Pesanan row shows `NoDokumen`, `Tanggal`, aging-bucket `Badge` (colors from `BUCKET_TONE` in `aging-table.tsx:49-55`), and `outstanding` amount.

- [ ] **Step 3: Add `ExportXlsxButton`** with columns: Agen, Segmentasi, No Dokumen, Tanggal, Outstanding, Hari Terlambat, Kategori Umur, Status (one row per `EsBalokInvoiceRow`, not per Agen).

- [ ] **Step 4: `EsBalokPembayaranPanel` — render a date picker (`<input type="date">`) calling `onDateChange`**, then a simple list/table of `rows`: Agen, No Dokumen, Tanggal, Pembayaran (green if >0), Tarikan (if >0), Sisa Piutang, Status badge — no grouping needed (already one row per payment document), sorted newest first (already sorted by the query).

- [ ] **Step 5: Run `npx tsc --noEmit`**

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/es-balok-invoice-outstanding-table.tsx src/components/dashboard/es-balok-pembayaran-panel.tsx
git commit -m "feat: tabel Invoice Outstanding + panel Pembayaran harian Piutang Es Balok"
```

---

## Task 8: Prioritas Pemulihan tab UI + target dialog

**Files:**
- Create: `src/components/dashboard/es-balok-collection-priority-table.tsx`

**Interfaces:**
- Consumes: `EsBalokPriorityRow` (Task 4, as type); `setEsBalokCollectionTargetAction`, `removeEsBalokCollectionTargetAction` (Task 5, passed as props `onSetTarget`/`onRemoveTarget` — this is a reusable component for 2 different pages/companies, so it must NOT import a specific route's `actions.ts` directly, same reasoning as Task 6's `fetchPeriodSummary` prop); `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter`, `Input`, `Label`, `Button`, `ExportXlsxButton`, `Pagination`.
- Produces: `export function EsBalokCollectionPriorityTable({ rows, onSetTarget, onRemoveTarget }: { rows: EsBalokPriorityRow[]; onSetTarget: (agenId: string, input: { targetDate: string | null; targetAmount: number | null; note: string | null }) => Promise<{ success: true } | { success: false; error: string }>; onRemoveTarget: (agenId: string) => Promise<{ success: true } | { success: false; error: string }> })`.

- [ ] **Step 1: Port `CollectionPriorityTable` (`collection-priority-table.tsx`) field-for-field**, replacing `BusinessPartnerID`→`agenId`, `CustomerName`→`agenNama`, `PartnerType`/`Wilayah`/`Kecamatan`→`segmentasi` (single badge instead of 3 text fields), `PiutangAwal`→drop (Es Balok's `EsBalokPriorityRow` has no period-start figure — remove the "Piutang Awal" stat and the `progress()` bar helper that depends on it; keep `PiutangBerjalan`, `Omzet` is also not on `EsBalokPriorityRow` — drop the "Omzet"/`ratio()` stat too), `Tren`/`Rotasi`/`AvgQtyPerOrderDay` → also not present on `EsBalokPriorityRow`, drop those stat lines and the `TrenIcon` helper. What remains per card: Nama, Segmentasi, Status badge, Piutang Berjalan, Hari Terlambat Maks (`formatDays`), Terakhir Pesan, Terakhir Bayar, and the Target block (identical to the original: nominal + tanggal, no progress bar since there's no `PiutangAwal` to bar against).

- [ ] **Step 2: Headline/rest split** — same logic as the original (`targeted` rows + top-5 non-targeted Kritis/Perhatian, rest paginated below), keyed by `agenId`.

- [ ] **Step 3: Target dialog** — same form (Tanggal Target Lunas, Nominal Target, Catatan) and same submit/remove flow as the original, calling `onSetTarget`/`onRemoveTarget` props instead of importing a fixed action.

- [ ] **Step 4: `ExportXlsxButton`** with columns: Agen, Segmentasi, Piutang Berjalan, Hari Terlambat Maks, Target Nominal, Target Tanggal, Catatan Target, Status, Target Aktif.

- [ ] **Step 5: Run `npx tsc --noEmit`**

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/es-balok-collection-priority-table.tsx
git commit -m "feat: tabel Prioritas Pemulihan + dialog target pelunasan Piutang Es Balok"
```

---

## Task 9: Wire pmputra's Piutang page

**Files:**
- Modify: `src/app/pmputra/piutang/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 5-8; existing `getPiutangSummary`, `getPiutangPerAgen`, `PiutangSummaryPanel`, `PiutangPerAgenTable`, `PiutangTabs` (`@/components/dashboard/piutang-tabs`).

- [ ] **Step 1: In the page (a Server Component), call the Task 3/4 query functions directly for the INITIAL render** — `const invoiceRows = await getEsBalokInvoiceOutstanding(KODE)`, then `getEsBalokPiutangPeriodSummary(KODE, monthStart(), tomorrow(), invoiceRows)`, `getEsBalokStatusOverview(invoiceRows)`, `getEsBalokCollectionPriority(KODE, invoiceRows)`, `getEsBalokPembayaranByDate(KODE, new Date(), invoiceRows)` — same direct-call pattern already used for `getPiutangSummary`/`getPiutangPerAgen` on this page, NOT through the Task 5 Server Actions (those exist only so Client Components can re-fetch after an interaction — the date-range change in Task 6, the date picker in Task 7's Pembayaran panel, and Task 8's target mutations).

- [ ] **Step 2: Pass `fetchPeriodSummary={getEsBalokPeriodSummaryAction}` and `fetchStatusOverview={getEsBalokStatusOverviewAction}` to `<PiutangSummaryPanel>`** alongside its existing `data={data}` prop.

- [ ] **Step 3: Render `<PiutangTabs>` between the summary panel and the existing "Rincian per Agen" heading**, with:
  - `invoicePanel={<EsBalokInvoiceOutstandingTable rows={invoiceRows} />}`
  - `pembayaranPanel={<EsBalokPembayaranPanelContainer />}` — since `EsBalokPembayaranPanel` needs to re-fetch on date change, wrap it in a small client component in this same file (or inline a `"use client"` wrapper) that holds date state and calls `getEsBalokPembayaranByDateAction`, seeded with today's data fetched server-side.
  - `prioritasPanel={<EsBalokCollectionPriorityTable rows={priorityRows} onSetTarget={setEsBalokCollectionTargetAction} onRemoveTarget={removeEsBalokCollectionTargetAction} />}`

- [ ] **Step 4: Confirm "Rincian per Agen" (`<PiutangPerAgenTable>`) still renders below, completely unchanged.**

- [ ] **Step 5: Run `npx tsc --noEmit`**

Expected: zero errors.

- [ ] **Step 6: Start the dev server, navigate to `/pmputra/piutang` in the browser, and verify:**
  - The 3 new KPI rows + status panel render with real numbers (not 0/NaN for every card).
  - All 3 tabs switch and show data (Invoice Outstanding cards, today's Pembayaran list, Prioritas Pemulihan cards).
  - Setting a target in Prioritas Pemulihan, reloading the page, and reopening that Agen's dialog shows the saved target (proves the Postgres round-trip works).
  - "Rincian per Agen" below still works exactly as before (Bayar/Tarik still functional) — Global Constraints line "never removes or changes behavior of... PiutangPerAgenTable".
  - Screenshot both "Total Piutang Outstanding" (new) and "Total Piutang Mitra Saat Ini" (existing) and confirm the Rupiah figures match exactly (Review Focus #5).

- [ ] **Step 7: Commit**

```bash
git add "src/app/pmputra/piutang/page.tsx"
git commit -m "feat: pasang panel KPI + 3 tab ala MKEsindo ke halaman Piutang pmputra"
```

---

## Task 10: Wire pmpersada's Piutang page

**Files:**
- Modify: `src/app/pmpersada/(dashboard)/piutang/page.tsx`

**Interfaces:**
- Consumes: same as Task 9, but the `pmpersada` variants of every Task 5 action.

- [ ] **Step 1-4: Mirror Task 9's steps 1-4 exactly**, substituting `pmpersada`'s own actions/queries (`kode = "pmpersada"`).

- [ ] **Step 5: Run `npx tsc --noEmit`**

Expected: zero errors.

- [ ] **Step 6: Start the dev server, navigate to `/pmpersada/piutang`, and repeat every check from Task 9's Step 6**, additionally confirming the "utama vs shared-logistik BranchID filter" still isolates pmpersada's own rows correctly (spot-check one Agen's Invoice Outstanding total against their "Rincian per Agen" SISA HUTANG, same as Task 3 Step 6 but through the full UI this time).

- [ ] **Step 7: Commit**

```bash
git add "src/app/pmpersada/(dashboard)/piutang/page.tsx"
git commit -m "feat: pasang panel KPI + 3 tab ala MKEsindo ke halaman Piutang pmpersada"
```
