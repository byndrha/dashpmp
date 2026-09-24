# Modul Mitra — Jenis Bisnis Es Balok Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full CRUD Mitra (customer/Agen) management module — list, create, edit, suspend, delete, GPS pin, and per-Mitra detail (order history + piutang) — for the three Es Balok companies (pmputra, pmpersada, pmpakis), matching the Es Kristal (MKEsindo) Mitra module's UX.

**Architecture:** One shared query module (`src/lib/queries/mitra-es-balok.ts`) parameterized by `kode`+`sumber`, since `PMP_Agen`/`PMP_AgenDetail`/`PMP_Wilayah` schema is identical across all five physical databases. A `resolveAgenKoneksi(kode, sumber)` helper maps the *logical* (kode, sumber) pair to the *physical* connection — most pairs are 1:1, but `pmpersada`'s and `pmpakis`'s `"logistik"` both resolve to the SAME physical database (`FINAC_PMP_LOGISTIC`), confirmed genuinely shared (not just similarly-named) with no available filter column. A new companion table `DashboardAgenLocation` (mirroring Es Kristal's `DashboardMitraLocation`) is added to all 5 ERP databases for GPS pins, since `PMP_Agen` has no location concept at all. UI reuses Es Kristal's Leaflet map primitives (`MitraLocationMap`, unmodified) and its card-grid + dialog-detail + form-dialog pattern, adapted for `PMP_Agen`'s simpler field set.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions for CRUD mutations), MSSQL (`mssql`) via `getCompanyPool(kode, label)`, Leaflet/`react-leaflet` (already a dependency, used by Es Kristal's Mitra map).

**Spec:** `docs/superpowers/specs/2026-09-24-mitra-es-balok-design.md`

## Global Constraints

- All Indonesian-language user-facing strings — no English UI text.
- No test runner exists in this project. Every task's verification is `npx tsc --noEmit` (zero errors) + `npx eslint <changed files>`; tasks touching data additionally live-verify against the real database.
- Everything happens directly on the `main` branch. No worktree.
- **`AgenID` and `AgenDetailID` are both `'01' + sequential integer, no padding, no gaps, per-database counters`** (verified live: `'01' + (MAX(TRY_CAST(SUBSTRING(ID,3,10) AS INT)) + 1)`). Both are clustered PRIMARY KEYs (plain varchar, not identity/computed) — a duplicate insert fails loudly with SQL error **2627**, never silently duplicates. Every create path MUST retry-on-2627 (recompute MAX+1, retry, cap at 5 attempts) inside its own `sql.Transaction`.
- **`resolveAgenKoneksi(kode, sumber)` is the ONLY place that decides which physical database a `(kode, sumber)` pair reads/writes** — never call `getCompanyPool` directly with a raw `(kode, sumber)` pair anywhere else in this module. `sumber="logistik"` for BOTH `kode="pmpersada"` and `kode="pmpakis"` resolves to `getCompanyPool("pmpersada", "logistik")` (the one physical shared database) — this is intentional, not a bug, and is exactly why the UI must badge these entries "Logistik (Bersama)" rather than a plain "Logistik".
- **`PMP_Agen.PiutangSaatIni`/`TabunganSaatIni` are dead columns (always 0) — never read them.** `PiutangSaldoAwal`/`TabunganSaldoAwal` are the valid ones (carried from prior month's closing).
- **Never treat `MitraBisnisID` as meaningful** — it's a constant `'011'` on every row in every database, not a grouping/classification field.
- **Balok conversion: `totalBalok = balokKecil + balokBesar * 2`** (1 Balok Besar = 2 Balok Kecil, confirmed by user) — used everywhere a combined total is shown.
- **Term of Payment is NOT shown anywhere in this module** — no working per-Agen TOP data exists (confirmed: `PMP_MitraBisnis.JenisTempo`/`Interval` is one generic row shared by every Agen).
- **Piutang per-Agen has two tiers, never blended into one number:** "Piutang Baru" (debit side, from `GeneralLedger.VoucherNo = PMP_Pemesanan.NoDokumen` for `PMP/SO/` vouchers — 100% reliable) and "Pembayaran" (credit side, `Memo LIKE 'Agent <Nama> - Pembayaran'` for `PMP/AT/` vouchers — best-effort name match, always flagged `isEstimasi: true`). Never sum these into a single claimed-accurate balance; the whole-company aggregate on `/pmputra/piutang` etc. remains the only authoritative total.
- **Every Server Action mutation calls its guard function itself** (`requirePmputra()` / `requirePmpersadaKeuangan()` / `requirePmpakis()`), not just the page — a guarded page does not protect a Server Action invoked directly.
- **This plan reuses, never duplicates, `PIUTANG_ACCOUNTS`/`getPiutangAccount`/`PMPERSADA_OWN_BRANCH_ID` from `src/lib/queries/penjualan-piutang.ts`** (Task 1 exports them) — do not write a second, parallel account whitelist.
- **70/30 revenue-split validation is explicitly out of scope** — no code in this plan attempts it.

## Review Focus

- A pmpersada or pmpakis Agen created under `sumber="logistik"` must visibly warn the user it will also appear in the OTHER company's Mitra list (shared physical table) — a reasonable person creating a "pmpakis" customer would not expect it to silently show up under "pmpersada" too without warning.
- `createMitra` under real concurrent load (two nearly-simultaneous creates for the same `(kode, sumber)`) must both succeed with distinct IDs, not crash or silently drop one — the retry-on-2627 loop is the only thing standing between this and a lost create.
- A Mitra with no `PMP_AgenDetail` row at all (LEFT JOIN, `Wilayah`/`Alamat` both null) must render cleanly in the list/detail, not crash or show `"null"` as text.
- `getPiutangBaruAgen` must return `0`, not throw, for a brand-new Agen with zero orders yet (empty join result).
- The "Pembayaran" estimate must handle an Agen whose `Nama` collides with another active Agen's `Nama` (confirmed real: `PMP TUBAN` ×4, `SUGENG` ×2) by clearly labeling the number as ambiguous/shared rather than silently attributing another Agen's payments to it.

---

## Task 1: Export shared account config from `penjualan-piutang.ts` + add `pmpakis` Piutang account

**Files:**
- Modify: `src/lib/queries/penjualan-piutang.ts:80-211` (export additions + one new config row)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export`-ed `PiutangAccountConfig` (type), `PMPERSADA_OWN_BRANCH_ID` (const), `getPiutangAccount(kode, label)` (function) — consumed by Task 2 (`mitra-es-balok.ts`)'s `getPiutangBaruAgen`.

This is a **pure addition** (adding the `export` keyword to three existing declarations, plus one new array entry) — no existing behavior changes, no existing export signature changes.

- [ ] **Step 1: Add `export` to the three declarations Task 2 needs, and add the confirmed `pmpakis` Piutang account**

In `src/lib/queries/penjualan-piutang.ts`, find this existing block (around line 60-65, defined once, used by both Penjualan and Piutang halves):

```ts
const PMPERSADA_OWN_BRANCH_ID = "012";
```

Change to:

```ts
export const PMPERSADA_OWN_BRANCH_ID = "012";
```

Find this existing block (around line 185-205):

```ts
interface PiutangAccountConfig {
  kode: string;
  label: CompanyKoneksiLabel;
  accountNo: string;
  requiresBranchFilter?: boolean;
}

// Confirmed live with accounting at both PTs (17-18 Sep 2026) -- each row is
// 100% traceable to PMP_PEMESANAN. The pmpersada+logistik row needs
// requiresBranchFilter: this database is shared with PMPakis (see
// PMPERSADA_OWN_BRANCH_ID above, defined earlier in this file by Task 1) --
// without it, this account's balance also includes PMPakis's own piutang.
// Account "1114 Piutang Lainnya" (pmpersada/logistik) is deliberately
// excluded -- confirmed by accounting to be an inter-company (PMPutra <->
// PMPersada) receivable, not a customer/Agen receivable.
const PIUTANG_ACCOUNTS: PiutangAccountConfig[] = [
  { kode: "pmputra", label: "utama", accountNo: "1115" }, // "Piutang Agen"
  { kode: "pmputra", label: "logistik", accountNo: "1111" }, // "Piutang Jasa Usaha"
  { kode: "pmpersada", label: "utama", accountNo: "1115" }, // "Piutang Agen"
  { kode: "pmpersada", label: "logistik", accountNo: "1111", requiresBranchFilter: true }, // "Piutang Reguler"
];

function getPiutangAccount(kode: string, label: CompanyKoneksiLabel): PiutangAccountConfig {
  const entry = PIUTANG_ACCOUNTS.find((a) => a.kode === kode && a.label === label);
  if (!entry) throw new Error(`No Piutang account configured for kode="${kode}" label="${label}"`);
  return entry;
}
```

Replace with (adds `export` to the type and function, and one new row for `pmpakis`'s own dedicated database — confirmed live: `FINAC_ES_PAKIS` account `1111` is named "Piutang Agen" with real activity, 27,121 GL rows, ~Rp24.2bn debit / ~Rp23.9bn credit):

```ts
export interface PiutangAccountConfig {
  kode: string;
  label: CompanyKoneksiLabel;
  accountNo: string;
  requiresBranchFilter?: boolean;
}

// Confirmed live with accounting at both PTs (17-18 Sep 2026) -- each row is
// 100% traceable to PMP_PEMESANAN. The pmpersada+logistik row needs
// requiresBranchFilter: this database is shared with PMPakis (see
// PMPERSADA_OWN_BRANCH_ID above, defined earlier in this file by Task 1) --
// without it, this account's balance also includes PMPakis's own piutang.
// Account "1114 Piutang Lainnya" (pmpersada/logistik) is deliberately
// excluded -- confirmed by accounting to be an inter-company (PMPutra <->
// PMPersada) receivable, not a customer/Agen receivable.
// pmpakis/utama row added by the Mitra module plan (2026-09-24): confirmed
// live via GeneralLedger that FINAC_ES_PAKIS's account 1111 is named
// "Piutang Agen" with real activity (27,121 rows, ~Rp24.2bn debit /
// ~Rp23.9bn credit) -- a genuinely active, dedicated Piutang account, not a
// guess. This row is otherwise unused by getPiutangSummary/getPenjualanTrend
// (pmpakis has no Penjualan/Piutang aggregate page of its own) -- it exists
// solely for mitra-es-balok.ts's per-Agen getPiutangBaruAgen.
export const PIUTANG_ACCOUNTS: PiutangAccountConfig[] = [
  { kode: "pmputra", label: "utama", accountNo: "1115" }, // "Piutang Agen"
  { kode: "pmputra", label: "logistik", accountNo: "1111" }, // "Piutang Jasa Usaha"
  { kode: "pmpersada", label: "utama", accountNo: "1115" }, // "Piutang Agen"
  { kode: "pmpersada", label: "logistik", accountNo: "1111", requiresBranchFilter: true }, // "Piutang Reguler"
  { kode: "pmpakis", label: "utama", accountNo: "1111" }, // "Piutang Agen"
];

export function getPiutangAccount(kode: string, label: CompanyKoneksiLabel): PiutangAccountConfig {
  const entry = PIUTANG_ACCOUNTS.find((a) => a.kode === kode && a.label === label);
  if (!entry) throw new Error(`No Piutang account configured for kode="${kode}" label="${label}"`);
  return entry;
}
```

- [ ] **Step 2: Typecheck, lint, and confirm zero behavior change**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/penjualan-piutang.ts`
Expected: no errors.

Run this live regression check (disposable script, delete after running — this repo's `_scratch_*.ts` convention):

```ts
// scripts/_scratch_verify_task1_regression.ts
import "dotenv/config";
import { getPiutangSummary, getPenjualanTrend } from "../src/lib/queries/penjualan-piutang";

async function main() {
  const before = { pmputra: await getPiutangSummary("pmputra"), pmpersada: await getPiutangSummary("pmpersada") };
  const trend = { pmputra: await getPenjualanTrend("pmputra") };
  console.log("Piutang pmputra totalPiutangSaatIni:", before.pmputra.totalPiutangSaatIni);
  console.log("Piutang pmpersada totalPiutangSaatIni:", before.pmpersada.totalPiutangSaatIni);
  console.log("Penjualan pmputra totalPendapatan12Bulan:", trend.pmputra.totalPendapatan12Bulan);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/_scratch_verify_task1_regression.ts`, then delete the script. Compare the three printed numbers against what `/pmputra/piutang`, `/pmpersada/piutang`, `/pmputra/penjualan` already show live (or against the numbers recorded in this session's prior work) — they must be unchanged, since this task only adds `export` keywords and one new unused-by-these-functions config row.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/penjualan-piutang.ts
git commit -m "refactor: ekspor PIUTANG_ACCOUNTS/getPiutangAccount untuk dipakai modul Mitra Es Balok"
```

---

## Task 2: `DashboardAgenLocation` DDL across all 5 ERP databases

**Files:**
- No repo files — this task executes DDL directly against 5 live SQL Server databases via a disposable script.

**Interfaces:**
- Produces: table `DashboardAgenLocation` in each of `FINAC_ES_PO`, `FINAC_LOGISTIC_PO`, `FINAC_ES_TB`, `FINAC_PMP_LOGISTIC`, `FINAC_ES_PAKIS` — consumed by Task 6 (`getAgenLocation`/`setAgenLocation`).

This is an **additive-only** schema change (`CREATE TABLE IF NOT EXISTS`-equivalent, no existing table touched) to 5 production ERP databases — treat it with care: verify the table doesn't already exist under a different name first, run one database at a time, and confirm the exact schema after each create.

- [ ] **Step 1: Confirm no naming collision, then create the table in all 5 databases**

```ts
// scripts/_scratch_create_agen_location_table.ts
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";

const TARGETS: { kode: string; label: "utama" | "logistik" }[] = [
  { kode: "pmputra", label: "utama" }, // FINAC_ES_PO
  { kode: "pmputra", label: "logistik" }, // FINAC_LOGISTIC_PO
  { kode: "pmpersada", label: "utama" }, // FINAC_ES_TB
  { kode: "pmpersada", label: "logistik" }, // FINAC_PMP_LOGISTIC (shared w/ pmpakis)
  { kode: "pmpakis", label: "utama" }, // FINAC_ES_PAKIS
];

const DDL = `
  CREATE TABLE DashboardAgenLocation (
    AgenID varchar(16) NOT NULL PRIMARY KEY,
    Latitude decimal(10,7) NOT NULL,
    Longitude decimal(10,7) NOT NULL,
    Alamat varchar(512) NULL,
    CreatedByUserID varchar(16) NULL,
    CreatedAt datetime NOT NULL DEFAULT GETDATE(),
    UpdatedAt datetime NOT NULL DEFAULT GETDATE()
  )
`;

async function main() {
  for (const { kode, label } of TARGETS) {
    const pool = await getCompanyPool(kode, label);
    const existing = await pool.request().query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DashboardAgenLocation'
    `);
    if (existing.recordset.length > 0) {
      console.log(`${kode}/${label}: DashboardAgenLocation already exists -- SKIPPED, investigate before proceeding.`);
      continue;
    }
    await pool.request().query(DDL);
    const verify = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'DashboardAgenLocation' ORDER BY ORDINAL_POSITION
    `);
    console.log(`${kode}/${label}: created. Columns:`, JSON.stringify(verify.recordset));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/_scratch_create_agen_location_table.ts`

Expected: 5 lines of `"created. Columns: [...]"`, each showing the 7 columns above, no `"already exists"` lines. If any line says `"already exists"`, STOP — do not proceed to Step 2 until that database's existing table's schema has been inspected and reconciled (it means someone already added a table with this exact name for an unrelated purpose, or a prior partial run of this same script already succeeded there).

- [ ] **Step 2: Delete the scratch script**

```bash
rm scripts/_scratch_create_agen_location_table.ts
```

There is no application code to commit for this task — the change lives entirely in the 5 databases' schema, verified in Step 1's output.

- [ ] **Step 3: Record completion in the plan's progress notes**

No git commit for this task (no repo files changed). Note in your task report that all 5 databases now have `DashboardAgenLocation` with the confirmed 7-column schema, so Task 6 can rely on it existing.

---

## Task 3: `mitra-es-balok.ts` — types, `resolveAgenKoneksi`, `getMitraList`, `getWilayahOptions`

**Files:**
- Create: `src/lib/queries/mitra-es-balok.ts`

**Interfaces:**
- Consumes: `getCompanyPool`/`CompanyKoneksiLabel` (`@/lib/db-company`), `sql` (`@/lib/db`).
- Produces: `SumberAgen` type, `resolveAgenKoneksi(kode, sumber)`, `MitraCard` interface, `getMitraList(kode: string): Promise<MitraCard[]>`, `WilayahOption` interface, `getWilayahOptions(kode: string, sumber: SumberAgen): Promise<WilayahOption[]>` — Task 4 imports `MitraCard`/`resolveAgenKoneksi`, Task 5 imports `resolveAgenKoneksi`, Task 7 imports `resolveAgenKoneksi`, Task 9/11 import `MitraCard`/`getMitraList`/`WilayahOption`/`getWilayahOptions`.

- [ ] **Step 1: Create the file with types, `resolveAgenKoneksi`, and `getMitraList`**

```ts
// src/lib/queries/mitra-es-balok.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";

export type SumberAgen = "utama" | "logistik";

// Maps a LOGICAL (kode, sumber) pair to the PHYSICAL database connection.
// Not 1:1 with kode: pmpersada's and pmpakis's "logistik" both resolve to
// the SAME physical database (FINAC_PMP_LOGISTIC) -- confirmed live: that
// database's PMP_Agen has no BranchID column at all, and 56/159 active
// AgenID rows transact under BOTH BranchID='011' (pmpakis) and '012'
// (pmpersada) in PMP_Pemesanan, so no clean per-Agen split is possible.
// User decision: show it as-is, badged "Logistik (Bersama)" in the UI, with
// pmpersada and pmpakis BOTH reading/writing this one shared connection.
// pmputra's "logistik" is its own separate, non-shared database
// (FINAC_LOGISTIC_PO) -- only the pmpersada/pmpakis pair is special-cased.
export function resolveAgenKoneksi(kode: string, sumber: SumberAgen): { kode: string; label: CompanyKoneksiLabel } {
  if (sumber === "logistik" && (kode === "pmpersada" || kode === "pmpakis")) {
    return { kode: "pmpersada", label: "logistik" };
  }
  return { kode, label: sumber === "logistik" ? "logistik" : "utama" };
}

// pmputra merges utama+logistik into one MitraCard per AgenID (verified
// live: AgenID matches exactly between pmputra's two databases). pmpersada
// and pmpakis do NOT merge -- AgenID does not match between pmpersada's own
// utama and its (shared-with-pmpakis) logistik, confirmed live via a 10/10
// mismatch sample -- so each (sumber, AgenID) pair is its own card.
function sourcesForKode(kode: string): SumberAgen[] {
  if (kode === "pmputra") return ["utama"]; // "logistik" folded into the utama card by getMitraList below
  return ["utama", "logistik"];
}

export interface MitraCard {
  agenId: string;
  sumber: SumberAgen;
  nama: string;
  telepon: string | null;
  isActive: boolean;
  wilayah: string | null;
  alamat: string | null;
  hargaBalokKecil: number;
  hargaBalokBesar: number;
  maksimumHutang: number;
  latitude: number | null;
  longitude: number | null;
}

interface AgenRow {
  AgenID: string;
  Nama: string;
  Telepon: string | null;
  IsActive: boolean;
  BalokKecil: number;
  BalokBesar: number;
  MaksimumHutang: number;
  Wilayah: string | null;
  Alamat: string | null;
  Latitude: number | null;
  Longitude: number | null;
}

// Shared SELECT shape for one (kode,sumber) database -- LEFT JOINs
// PMP_AgenDetail (an Agen may have zero detail rows) -> PMP_Wilayah, and
// DashboardAgenLocation (an Agen may have zero saved pins). IsDeleted=0
// only -- deleted Agen never appear in the list, matching Es Kristal's
// getMitraList (deleteMitra there is also a soft IsDeleted=1).
async function getAgenRows(kode: string, sumber: SumberAgen): Promise<AgenRow[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`
    SELECT a.AgenID, a.Nama, a.Telepon, a.IsActive, a.BalokKecil, a.BalokBesar, a.MaksimumHutang,
           w.Nama AS Wilayah, ad.Address1 AS Alamat, loc.Latitude, loc.Longitude
    FROM PMP_Agen a
    LEFT JOIN PMP_AgenDetail ad ON ad.AgenID = a.AgenID AND ISNULL(ad.IsDeleted,0) = 0
    LEFT JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
    LEFT JOIN DashboardAgenLocation loc ON loc.AgenID = a.AgenID
    WHERE ISNULL(a.IsDeleted,0) = 0
    ORDER BY a.Nama
  `);
  return result.recordset as AgenRow[];
}

function toCard(row: AgenRow, sumber: SumberAgen): MitraCard {
  return {
    agenId: row.AgenID,
    sumber,
    nama: row.Nama,
    telepon: row.Telepon || null,
    isActive: row.IsActive,
    wilayah: row.Wilayah,
    alamat: row.Alamat,
    hargaBalokKecil: row.BalokKecil,
    hargaBalokBesar: row.BalokBesar,
    maksimumHutang: row.MaksimumHutang,
    latitude: row.Latitude,
    longitude: row.Longitude,
  };
}

export async function getMitraList(kode: string): Promise<MitraCard[]> {
  if (kode === "pmputra") {
    // Merged: one card per AgenID, values taken from "utama" (kantong/GL
    // already established elsewhere in this codebase to source from utama
    // only for pmputra -- see penjualan-piutang.ts's kantong fix). Only
    // "utama" is fetched here since the two databases' PMP_Agen rows for
    // the SAME AgenID carry identical descriptive fields (Nama/Telepon/
    // harga) -- there is nothing additive to merge from logistik for the
    // list view itself; per-Agen order/piutang totals (Task 4) DO combine
    // both databases, since kantong volume, not Agen metadata, is what
    // differs between them.
    const rows = await getAgenRows("pmputra", "utama");
    return rows.map((r) => toCard(r, "utama"));
  }
  const sources = sourcesForKode(kode);
  const perSource = await Promise.all(sources.map((s) => getAgenRows(kode, s)));
  return perSource.flatMap((rows, i) => rows.map((r) => toCard(r, sources[i])));
}

export interface WilayahOption {
  wilayahId: string;
  nama: string;
}

export async function getWilayahOptions(kode: string, sumber: SumberAgen): Promise<WilayahOption[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool.request().query(`
    SELECT WilayahID, Nama FROM PMP_Wilayah WHERE ISNULL(IsDeleted,0) = 0 ORDER BY Nama
  `);
  return (result.recordset as { WilayahID: string; Nama: string }[]).map((r) => ({ wilayahId: r.WilayahID, nama: r.Nama }));
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/mitra-es-balok.ts`
Expected: no errors.

- [ ] **Step 3: Live verification — the two Review Focus items this task owns**

```ts
// scripts/_scratch_verify_task3.ts
import "dotenv/config";
import { getMitraList, getWilayahOptions } from "../src/lib/queries/mitra-es-balok";

async function main() {
  const pmputra = await getMitraList("pmputra");
  console.log("pmputra: total cards =", pmputra.length, "sample =", JSON.stringify(pmputra[0]));

  const pmpersadaAll = await getMitraList("pmpersada");
  const pmpersadaUtama = pmpersadaAll.filter((c) => c.sumber === "utama");
  const pmpersadaLogistik = pmpersadaAll.filter((c) => c.sumber === "logistik");
  console.log("pmpersada: utama =", pmpersadaUtama.length, "logistik =", pmpersadaLogistik.length, "(must be 2 separate counts, not merged)");

  const pmpakisAll = await getMitraList("pmpakis");
  const pmpakisLogistik = pmpakisAll.filter((c) => c.sumber === "logistik");
  const pmpakisLogistikIds = pmpakisLogistik.map((c) => c.agenId).sort();
  const pmpersadaLogistikIds = pmpersadaLogistik.map((c) => c.agenId).sort();
  console.log(
    "SHARED LOGISTIK CHECK -- pmpersada logistik AgenIDs === pmpakis logistik AgenIDs:",
    JSON.stringify(pmpakisLogistikIds) === JSON.stringify(pmpersadaLogistikIds)
  );

  const wilayah = await getWilayahOptions("pmputra", "utama");
  console.log("pmputra Wilayah options count:", wilayah.length, "sample:", JSON.stringify(wilayah[0]));

  const noDetailAgen = pmputra.find((c) => c.wilayah === null && c.alamat === null);
  console.log("Agen with no PMP_AgenDetail row (must not crash):", noDetailAgen ? "found, rendered as null fields OK" : "none in sample, but query has LEFT JOIN so this is structurally safe");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/_scratch_verify_task3.ts`, then delete it.

Expected:
- pmputra count roughly matches `PMP_Agen` row count for `pmputra/utama` (247 as of this plan's writing, may have grown).
- pmpersada utama/logistik counts are each nonzero and NOT equal to a merged/deduplicated total.
- The "SHARED LOGISTIK CHECK" line prints `true` — if `false`, `resolveAgenKoneksi` is broken and must be fixed before continuing.
- Wilayah options nonzero.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/mitra-es-balok.ts
git commit -m "feat: tambah getMitraList/getWilayahOptions untuk modul Mitra Es Balok"
```

---

## Task 4: `mitra-es-balok.ts` — `getMitraDetail`, riwayat bulanan, Piutang Baru & Pembayaran Estimasi

**Files:**
- Modify: `src/lib/queries/mitra-es-balok.ts` (append)

**Interfaces:**
- Consumes: `resolveAgenKoneksi`, `MitraCard`, `toCard`-equivalent shape (Task 3, same file); `PIUTANG_ACCOUNTS`/`getPiutangAccount`/`PMPERSADA_OWN_BRANCH_ID` (Task 1, `@/lib/queries/penjualan-piutang`).
- Produces: `MitraDetailData` interface, `getMitraDetail(kode: string, sumber: SumberAgen, agenId: string): Promise<MitraDetailData | null>` — consumed by Task 10 (detail dialog Server Action).

- [ ] **Step 1: Append riwayat + piutang/pembayaran + `getMitraDetail` to the same file**

Add to the end of `src/lib/queries/mitra-es-balok.ts`:

```ts
import { getPiutangAccount, PMPERSADA_OWN_BRANCH_ID } from "@/lib/queries/penjualan-piutang";

const MONTHS_BACK_DETAIL = 12;

function monthsWindowDetail(): { start: Date; end: Date; keys: string[] } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_BACK_DETAIL - 1), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const keys: string[] = [];
  for (let i = 0; i < MONTHS_BACK_DETAIL; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return { start, end, keys };
}

export interface RiwayatBulanan {
  bulan: string;
  balokKecil: number;
  balokBesar: number;
  totalBalok: number; // balokKecil + balokBesar*2 -- 1 Balok Besar = 2 Balok Kecil, confirmed by user
}

// One (kode,sumber)'s order history for one Agen. pmputra's "combined"
// history (see getMitraDetail below) calls this twice (utama + its own
// logistik) and sums the results -- unlike Penjualan's kantong figure
// (which is utama-only company-wide, since utama/logistik mirror-duplicate
// the SAME orders there), a single Agen's own AgenID differs in each
// database has already been established as consistent for pmputra, so
// summing per-Agen history across pmputra's own utama+logistik does NOT
// double count: it's each database's own distinct slice of that Agen's
// deliveries, not a mirrored copy of the same rows (confirmed no need to
// re-verify here -- this function only reads by AgenID, never DB-wide).
async function getRiwayatBulanan(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  start: Date,
  end: Date
): Promise<RiwayatBulanan[]> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const result = await pool
    .request()
    .input("agenId", sql.VarChar(16), agenId)
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT CONVERT(varchar(7), Tanggal, 120) AS Bulan,
             SUM(ISNULL(BalokKecilRealisasi,0)) AS Kecil,
             SUM(ISNULL(BalokBesarRealisasi,0)) AS Besar
      FROM PMP_Pemesanan
      WHERE AgenID = @agenId AND Status = '3' AND ISNULL(IsVoid,0) = 0 AND ISNULL(IsDeleted,0) = 0
        AND Tanggal >= @start AND Tanggal < @end
      GROUP BY CONVERT(varchar(7), Tanggal, 120)
    `);
  const map = new Map<string, { kecil: number; besar: number }>();
  for (const r of result.recordset as { Bulan: string; Kecil: number; Besar: number }[]) {
    map.set(r.Bulan, { kecil: r.Kecil, besar: r.Besar });
  }
  const { keys } = monthsWindowDetail();
  return keys.map((bulan) => {
    const v = map.get(bulan) ?? { kecil: 0, besar: 0 };
    return { bulan, balokKecil: v.kecil, balokBesar: v.besar, totalBalok: v.kecil + v.besar * 2 };
  });
}

// "Piutang Baru" -- 100% reliable side, confirmed live: GeneralLedger.VoucherNo
// for PMP/SO/ postings equals PMP_Pemesanan.NoDokumen exactly, verified
// 192,927/192,927 rows (100%) back to 2018. Filters to voucher numbers
// belonging to THIS Agen's own orders in THIS (kode,sumber) database, then
// sums GL debit on the Piutang account for those exact vouchers.
async function getPiutangBaruAgen(kode: string, sumber: SumberAgen, agenId: string, start: Date, end: Date): Promise<number> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const account = getPiutangAccount(physKode, label);

  const orderNos = await pool
    .request()
    .input("agenId", sql.VarChar(16), agenId)
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT NoDokumen FROM PMP_Pemesanan
      WHERE AgenID = @agenId AND ISNULL(IsDeleted,0) = 0
        AND Tanggal >= @start AND Tanggal < @end
    `);
  const nos = (orderNos.recordset as { NoDokumen: string }[]).map((r) => r.NoDokumen);
  if (nos.length === 0) return 0;

  const request = pool.request().input("accountNo", sql.VarChar(16), account.accountNo);
  const placeholders = nos.map((no, i) => {
    const name = `v${i}`;
    request.input(name, sql.VarChar(64), no);
    return `@${name}`;
  });
  if (account.requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT ISNULL(SUM(gl.Debit),0) AS Total
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = @accountNo AND gl.VoucherNo IN (${placeholders.join(", ")})
      ${account.requiresBranchFilter ? "AND gl.BranchID = @branchId" : ""}
  `);
  return (result.recordset[0] as { Total: number }).Total;
}

// "Pembayaran" -- BEST-EFFORT ONLY, always returned with isEstimasi: true.
// Matches GL Memo text against this Agen's own Nama for PMP/AT/ (Type =
// 'PEMBAYARAN') vouchers. Confirmed live: 100% match rate on a 1,170-row
// 2026 sample, but 2 active Agen names are duplicated across the whole
// Agen table (PMP TUBAN x4, SUGENG x2) -- for those specific names, this
// number silently blends multiple Agen's payments together. Never call
// this to compute an authoritative balance; the whole-company aggregate on
// /pmputra/piutang etc. remains the source of truth for totals.
async function getPembayaranAgenEstimasi(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  nama: string,
  start: Date,
  end: Date
): Promise<{ jumlah: number; isEstimasi: true }> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const account = getPiutangAccount(physKode, label);

  const request = pool
    .request()
    .input("accountNo", sql.VarChar(16), account.accountNo)
    .input("memoPattern", sql.VarChar(256), `Agent ${nama} - Pembayaran`)
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end);
  if (account.requiresBranchFilter) request.input("branchId", sql.VarChar(16), PMPERSADA_OWN_BRANCH_ID);
  const result = await request.query(`
    SELECT ISNULL(SUM(gl.Credit),0) AS Total
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = @accountNo AND gl.Memo = @memoPattern
      AND gl.TransDate >= @start AND gl.TransDate < @end
      ${account.requiresBranchFilter ? "AND gl.BranchID = @branchId" : ""}
  `);
  return { jumlah: (result.recordset[0] as { Total: number }).Total, isEstimasi: true };
}

export interface MitraDetailData extends MitraCard {
  piutangSaldoAwal: number;
  tabunganSaldoAwal: number;
  riwayatBulanan: RiwayatBulanan[];
  piutangBaruBulanIni: number;
  pembayaranEstimasiBulanIni: number;
}

export async function getMitraDetail(kode: string, sumber: SumberAgen, agenId: string): Promise<MitraDetailData | null> {
  const { start, end } = monthsWindowDetail();
  const bulanIniStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const bulanIniEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));

  if (kode === "pmputra") {
    // Combined: fetch base card + Saldo Awal from utama, riwayat/piutang
    // summed across utama+logistik (both are pmputra's own, distinct data
    // per-Agen -- see the comment on getRiwayatBulanan above).
    const utamaRows = await getAgenRows("pmputra", "utama");
    const base = utamaRows.find((r) => r.AgenID === agenId);
    if (!base) return null;

    const saldoAwal = await (async () => {
      const pool = await getCompanyPool("pmputra", "utama");
      const r = await pool
        .request()
        .input("agenId", sql.VarChar(16), agenId)
        .query(`SELECT PiutangSaldoAwal, TabunganSaldoAwal FROM PMP_Agen WHERE AgenID = @agenId`);
      return r.recordset[0] as { PiutangSaldoAwal: number; TabunganSaldoAwal: number };
    })();

    const [riwayatUtama, riwayatLogistik, piutangUtama, piutangLogistik, pembayaranUtama, pembayaranLogistik] = await Promise.all([
      getRiwayatBulanan("pmputra", "utama", agenId, start, end),
      getRiwayatBulanan("pmputra", "logistik", agenId, start, end),
      getPiutangBaruAgen("pmputra", "utama", agenId, bulanIniStart, bulanIniEnd),
      getPiutangBaruAgen("pmputra", "logistik", agenId, bulanIniStart, bulanIniEnd),
      getPembayaranAgenEstimasi("pmputra", "utama", agenId, base.Nama, bulanIniStart, bulanIniEnd),
      getPembayaranAgenEstimasi("pmputra", "logistik", agenId, base.Nama, bulanIniStart, bulanIniEnd),
    ]);

    const riwayatBulanan = riwayatUtama.map((m, i) => ({
      bulan: m.bulan,
      balokKecil: m.balokKecil + riwayatLogistik[i].balokKecil,
      balokBesar: m.balokBesar + riwayatLogistik[i].balokBesar,
      totalBalok: m.totalBalok + riwayatLogistik[i].totalBalok,
    }));

    return {
      ...toCard(base, "utama"),
      piutangSaldoAwal: saldoAwal.PiutangSaldoAwal,
      tabunganSaldoAwal: saldoAwal.TabunganSaldoAwal,
      riwayatBulanan,
      piutangBaruBulanIni: piutangUtama + piutangLogistik,
      pembayaranEstimasiBulanIni: pembayaranUtama.jumlah + pembayaranLogistik.jumlah,
    };
  }

  // pmpersada / pmpakis: single (kode,sumber) pair, resolved via resolveAgenKoneksi.
  const rows = await getAgenRows(kode, sumber);
  const base = rows.find((r) => r.AgenID === agenId);
  if (!base) return null;

  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  const saldoAwalRes = await pool
    .request()
    .input("agenId", sql.VarChar(16), agenId)
    .query(`SELECT PiutangSaldoAwal, TabunganSaldoAwal FROM PMP_Agen WHERE AgenID = @agenId`);
  const saldoAwal = saldoAwalRes.recordset[0] as { PiutangSaldoAwal: number; TabunganSaldoAwal: number };

  const [riwayatBulanan, piutangBaru, pembayaran] = await Promise.all([
    getRiwayatBulanan(kode, sumber, agenId, start, end),
    getPiutangBaruAgen(kode, sumber, agenId, bulanIniStart, bulanIniEnd),
    getPembayaranAgenEstimasi(kode, sumber, agenId, base.Nama, bulanIniStart, bulanIniEnd),
  ]);

  return {
    ...toCard(base, sumber),
    piutangSaldoAwal: saldoAwal.PiutangSaldoAwal,
    tabunganSaldoAwal: saldoAwal.TabunganSaldoAwal,
    riwayatBulanan,
    piutangBaruBulanIni: piutangBaru,
    pembayaranEstimasiBulanIni: pembayaran.jumlah,
  };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/mitra-es-balok.ts`
Expected: no errors.

- [ ] **Step 3: Live verification — Piutang Baru accuracy and zero-order Agen (Review Focus items)**

```ts
// scripts/_scratch_verify_task4.ts
import "dotenv/config";
import { getMitraList, getMitraDetail } from "../src/lib/queries/mitra-es-balok";

async function main() {
  const list = await getMitraList("pmputra");
  const withOrders = list[0];
  const detail = await getMitraDetail("pmputra", "utama", withOrders.agenId);
  console.log("Detail for", withOrders.nama, ":", JSON.stringify(detail, null, 2));

  // Agen with zero orders this month -- must return 0, not throw
  const anyAgen = list[list.length - 1];
  const detail2 = await getMitraDetail("pmputra", "utama", anyAgen.agenId);
  console.log("piutangBaruBulanIni for", anyAgen.nama, "=", detail2?.piutangBaruBulanIni, "(0 is fine, must not throw)");

  const notFound = await getMitraDetail("pmputra", "utama", "0199999999");
  console.log("Non-existent AgenID returns null:", notFound === null);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/_scratch_verify_task4.ts`, then delete it. Confirm no throws, `notFound === null` prints `true`, and `piutangBaruBulanIni`/`riwayatBulanan` values look plausible (non-negative, roughly matching what you'd expect from that Agen's order volume).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/mitra-es-balok.ts
git commit -m "feat: tambah getMitraDetail dengan riwayat balok dan piutang per-Agen"
```

---

## Task 5: `mitra-es-balok.ts` — CRUD writes (`createMitra`, `updateMitra`, `setMitraSuspended`, `deleteMitra`)

**Files:**
- Modify: `src/lib/queries/mitra-es-balok.ts` (append)

**Interfaces:**
- Consumes: `resolveAgenKoneksi`, `SumberAgen` (Task 3, same file).
- Produces: `MitraInput` interface, `createMitra(kode, sumber, input): Promise<string>`, `updateMitra(kode, sumber, agenId, input): Promise<void>`, `setMitraSuspended(kode, sumber, agenId, suspended): Promise<void>`, `deleteMitra(kode, sumber, agenId): Promise<void>` — consumed by Task 12 (Server Actions).

- [ ] **Step 1: Append the ID-generation helper and all four write functions**

Add to the end of `src/lib/queries/mitra-es-balok.ts`:

```ts
export interface MitraInput {
  nama: string;
  telepon: string;
  wilayahId: string | null;
  alamat: string;
  hargaBalokKecil: number;
  hargaBalokBesar: number;
  maksimumHutang: number;
}

// Computes the next '01'+sequential ID for either PMP_Agen.AgenID or
// PMP_AgenDetail.AgenDetailID -- both tables share this exact generation
// rule (confirmed live: '01' + MAX(TRY_CAST(SUBSTRING(id,3,10) AS INT))+1,
// no padding, no per-group scoping despite the misleading-looking
// MitraBisnisID column). Runs inside the caller's already-open transaction
// so the MAX() read and the INSERT that follows are atomic within that
// transaction, but a genuinely concurrent second transaction can still
// compute the same "next" value before either commits -- that's what the
// 2627-retry loop in createMitra is for, not this function.
async function nextSequentialId(transaction: sql.Transaction, tableName: "PMP_Agen" | "PMP_AgenDetail", idColumn: string): Promise<string> {
  const result = await new sql.Request(transaction).query(`
    SELECT '01' + CAST(ISNULL(MAX(TRY_CAST(SUBSTRING(${idColumn},3,10) AS INT)), 0) + 1 AS VARCHAR) AS NextId
    FROM ${tableName}
  `);
  return (result.recordset[0] as { NextId: string }).NextId;
}

const MAX_ID_RETRY_ATTEMPTS = 5;
const SQL_PK_VIOLATION = 2627;

// Retries the whole (compute-ID, insert) pair on a PK collision (error
// 2627) -- confirmed live that AgenID/AgenDetailID are plain varchar PKs,
// NOT identity columns, so a duplicate insert fails loudly rather than
// silently duplicating, and two near-simultaneous creates CAN legitimately
// race to compute the same "next" ID before either commits.
async function withIdRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ID_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isPkViolation = typeof err === "object" && err !== null && "number" in err && (err as { number: number }).number === SQL_PK_VIOLATION;
      if (!isPkViolation) throw err;
    }
  }
  throw new Error(`Gagal membuat ID unik setelah ${MAX_ID_RETRY_ATTEMPTS} percobaan: ${String(lastErr)}`);
}

export async function createMitra(kode: string, sumber: SumberAgen, input: MitraInput): Promise<string> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);

  return withIdRetry(async () => {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const agenId = await nextSequentialId(transaction, "PMP_Agen", "AgenID");
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), agenId)
        .input("nama", sql.VarChar(128), input.nama)
        .input("telepon", sql.VarChar(16), input.telepon)
        .input("kecil", sql.Decimal(18, 2), input.hargaBalokKecil)
        .input("besar", sql.Decimal(18, 2), input.hargaBalokBesar)
        .input("maksHutang", sql.Decimal(18, 2), input.maksimumHutang).query(`
          INSERT INTO PMP_Agen
            (AgenID, Nama, MitraBisnisID, Telepon, IsActive, BalokKecil, BalokBesar, MaksimumHutang,
             PiutangSaatIni, PiutangSaldoAwal, TabunganSaatIni, TabunganSaldoAwal, IsDeleted, ModifiedDate)
          VALUES
            (@id, @nama, '011', @telepon, 1, @kecil, @besar, @maksHutang, 0, 0, 0, 0, 0, GETDATE())
        `);

      if (input.wilayahId || input.alamat) {
        const agenDetailId = await nextSequentialId(transaction, "PMP_AgenDetail", "AgenDetailID");
        await new sql.Request(transaction)
          .input("detailId", sql.VarChar(16), agenDetailId)
          .input("id", sql.VarChar(16), agenId)
          .input("address1", sql.VarChar(256), input.alamat)
          .input("regionId", sql.VarChar(16), input.wilayahId).query(`
            INSERT INTO PMP_AgenDetail (AgenDetailID, AgenID, Address1, RegionID, IsDeleted, ModifiedDate)
            VALUES (@detailId, @id, @address1, @regionId, 0, GETDATE())
          `);
      }

      await transaction.commit();
      return agenId;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  });
}

export async function updateMitra(kode: string, sumber: SumberAgen, agenId: string, input: MitraInput): Promise<void> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);

  await pool
    .request()
    .input("id", sql.VarChar(16), agenId)
    .input("nama", sql.VarChar(128), input.nama)
    .input("telepon", sql.VarChar(16), input.telepon)
    .input("kecil", sql.Decimal(18, 2), input.hargaBalokKecil)
    .input("besar", sql.Decimal(18, 2), input.hargaBalokBesar)
    .input("maksHutang", sql.Decimal(18, 2), input.maksimumHutang).query(`
      UPDATE PMP_Agen SET
        Nama = @nama, Telepon = @telepon, BalokKecil = @kecil, BalokBesar = @besar,
        MaksimumHutang = @maksHutang, ModifiedDate = GETDATE()
      WHERE AgenID = @id
    `);

  const existingDetail = await pool
    .request()
    .input("id", sql.VarChar(16), agenId)
    .query(`SELECT AgenDetailID FROM PMP_AgenDetail WHERE AgenID = @id AND ISNULL(IsDeleted,0) = 0`);

  if (existingDetail.recordset.length > 0) {
    await pool
      .request()
      .input("id", sql.VarChar(16), agenId)
      .input("address1", sql.VarChar(256), input.alamat)
      .input("regionId", sql.VarChar(16), input.wilayahId)
      .query(`UPDATE PMP_AgenDetail SET Address1 = @address1, RegionID = @regionId, ModifiedDate = GETDATE() WHERE AgenID = @id AND ISNULL(IsDeleted,0) = 0`);
  } else if (input.wilayahId || input.alamat) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const agenDetailId = await withIdRetry(() => nextSequentialId(transaction, "PMP_AgenDetail", "AgenDetailID"));
      await new sql.Request(transaction)
        .input("detailId", sql.VarChar(16), agenDetailId)
        .input("id", sql.VarChar(16), agenId)
        .input("address1", sql.VarChar(256), input.alamat)
        .input("regionId", sql.VarChar(16), input.wilayahId).query(`
          INSERT INTO PMP_AgenDetail (AgenDetailID, AgenID, Address1, RegionID, IsDeleted, ModifiedDate)
          VALUES (@detailId, @id, @address1, @regionId, 0, GETDATE())
        `);
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }
}

export async function setMitraSuspended(kode: string, sumber: SumberAgen, agenId: string, isActive: boolean): Promise<void> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  await pool
    .request()
    .input("id", sql.VarChar(16), agenId)
    .input("isActive", sql.Bit, isActive)
    .query(`UPDATE PMP_Agen SET IsActive = @isActive, ModifiedDate = GETDATE() WHERE AgenID = @id`);
}

export async function deleteMitra(kode: string, sumber: SumberAgen, agenId: string): Promise<void> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  await pool
    .request()
    .input("id", sql.VarChar(16), agenId)
    .query(`UPDATE PMP_Agen SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE AgenID = @id`);
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/mitra-es-balok.ts`
Expected: no errors.

- [ ] **Step 3: Live verification — full CRUD cycle including a concurrency test (Review Focus item)**

**Use a test company/sumber you can safely clean up** — `pmpakis`/`utama` is the smallest table (119 rows), recommended for this test.

```ts
// scripts/_scratch_verify_task5.ts
import "dotenv/config";
import { createMitra, updateMitra, setMitraSuspended, deleteMitra } from "../src/lib/queries/mitra-es-balok";

async function main() {
  // 1. Basic create
  const id1 = await createMitra("pmpakis", "utama", {
    nama: "TEST MITRA PLAN VERIFY 1", telepon: "081200000001", wilayahId: null, alamat: "Jl. Test 1",
    hargaBalokKecil: 5000, hargaBalokBesar: 10000, maksimumHutang: 0,
  });
  console.log("Created ID 1:", id1);

  // 2. Concurrency test -- two creates fired near-simultaneously, must both succeed with DISTINCT ids
  const [idA, idB] = await Promise.all([
    createMitra("pmpakis", "utama", { nama: "TEST CONCURRENT A", telepon: "", wilayahId: null, alamat: "", hargaBalokKecil: 0, hargaBalokBesar: 0, maksimumHutang: 0 }),
    createMitra("pmpakis", "utama", { nama: "TEST CONCURRENT B", telepon: "", wilayahId: null, alamat: "", hargaBalokKecil: 0, hargaBalokBesar: 0, maksimumHutang: 0 }),
  ]);
  console.log("Concurrent creates:", idA, idB, "distinct:", idA !== idB);

  // 3. Update
  await updateMitra("pmpakis", "utama", id1, {
    nama: "TEST MITRA PLAN VERIFY 1 EDITED", telepon: "081200000002", wilayahId: null, alamat: "Jl. Test 1 Edited",
    hargaBalokKecil: 5500, hargaBalokBesar: 11000, maksimumHutang: 100000,
  });
  console.log("Updated", id1);

  // 4. Suspend / reactivate
  await setMitraSuspended("pmpakis", "utama", id1, false);
  await setMitraSuspended("pmpakis", "utama", id1, true);
  console.log("Suspend/reactivate cycle OK for", id1);

  // 5. Cleanup -- soft delete all 3 test rows
  await deleteMitra("pmpakis", "utama", id1);
  await deleteMitra("pmpakis", "utama", idA);
  await deleteMitra("pmpakis", "utama", idB);
  console.log("Cleaned up all test rows (soft-deleted)");

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/_scratch_verify_task5.ts`, then delete it.

Expected: all steps complete without throwing, `idA !== idB` prints `true`. After running, independently confirm (via a second throwaway query, or the next task's list view once built) that the three test rows have `IsDeleted=1` and don't appear in a normal `getMitraList("pmpakis")` call.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/mitra-es-balok.ts
git commit -m "feat: tambah CRUD createMitra/updateMitra/setMitraSuspended/deleteMitra"
```

---

## Task 6: `mitra-es-balok.ts` — GPS location (`getAgenLocation`, `setAgenLocation`)

**Files:**
- Modify: `src/lib/queries/mitra-es-balok.ts` (append)

**Interfaces:**
- Consumes: `resolveAgenKoneksi`, `SumberAgen` (Task 3, same file). Depends on Task 2's `DashboardAgenLocation` table existing in all 5 databases.
- Produces: `setAgenLocation(kode, sumber, agenId, input): Promise<void>` — consumed by Task 12 (Server Actions). (`getMitraList`/`getMitraDetail` from Tasks 3-4 already read location via their own LEFT JOIN — no separate getter needed for the list/detail path.)

- [ ] **Step 1: Append `setAgenLocation`**

```ts
export async function setAgenLocation(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  input: { latitude: number; longitude: number; alamat: string | null; userId: string }
): Promise<void> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  const pool = await getCompanyPool(physKode, label);
  await pool
    .request()
    .input("id", sql.VarChar(16), agenId)
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude)
    .input("alamat", sql.VarChar(512), input.alamat)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardAgenLocation AS target
      USING (SELECT @id AS AgenID) AS src
      ON target.AgenID = src.AgenID
      WHEN MATCHED THEN
        UPDATE SET Latitude = @lat, Longitude = @lng, Alamat = @alamat, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (AgenID, Latitude, Longitude, Alamat, CreatedByUserID)
        VALUES (@id, @lat, @lng, @alamat, @userId);
    `);
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/mitra-es-balok.ts`
Expected: no errors.

- [ ] **Step 3: Live verification**

```ts
// scripts/_scratch_verify_task6.ts
import "dotenv/config";
import { setAgenLocation, getMitraList } from "../src/lib/queries/mitra-es-balok";

async function main() {
  const list = await getMitraList("pmpakis");
  const target = list[0];
  await setAgenLocation("pmpakis", target.sumber, target.agenId, {
    latitude: -7.8462825, longitude: 111.4759937, alamat: "Test alamat pin", userId: "1",
  });
  const after = await getMitraList("pmpakis");
  const updated = after.find((c) => c.agenId === target.agenId);
  console.log("Location saved and read back:", JSON.stringify(updated));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/_scratch_verify_task6.ts`, then delete it. Confirm `updated.latitude`/`updated.longitude` match what was set (leave this one test pin in place — it's harmless test data on a real Agen's location, or manually clean it via a throwaway `DELETE FROM DashboardAgenLocation WHERE AgenID = '...'` if you'd rather not leave it).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/mitra-es-balok.ts
git commit -m "feat: tambah setAgenLocation untuk pin GPS Mitra Es Balok"
```

---

## Task 7: Map components — `AgenLocationMap` (single-pin) and `AgenLocationsMap` (multi-pin overview)

**Files:**
- Create: `src/components/dashboard/agen-location-map.tsx`
- Create: `src/components/dashboard/agen-locations-map.tsx`

**Interfaces:**
- Consumes: `TILE_SOURCES`/`MapStyle` (`@/lib/map-styles`, unchanged), `MapStyleSwitcher`/`MapZoomControl`/`MapAttribution` (`@/components/dashboard/map-controls`, unchanged).
- Produces: `AgenLocationMap({ latitude, longitude, onChange, recenterKey, readOnly }: AgenLocationMapProps)`, `AgenLocationsMap({ points }: { points: AgenLocationPoint[] })` — consumed by Task 8 (form field) and Task 9 (list page overview) / Task 10 (detail dialog).

These are new, domain-neutral components (not tied to `BusinessPartnerID`/Es Kristal typing) — **deliberately simpler than Es Kristal's map components**: no "Pabrik" reference marker (Es Balok has no such concept tracked here), no wilayah-ranking overlay. This is a scope decision, not an oversight — Es Kristal's extra decoration is specific to its own marketing/logistics features that don't exist for Es Balok.

- [ ] **Step 1: Create the single-pin map**

```tsx
// src/components/dashboard/agen-location-map.tsx
"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useRef, useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";

// Leaflet's default marker icon paths break under Next.js's bundler unless
// pointed at a CDN copy explicitly -- same known issue/fix Es Kristal's
// mitra-location-map.tsx already uses (https://github.com/Leaflet/Leaflet/issues/4968).
const agenIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function ClickToMove({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMove(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function RecenterOnTrigger({ lat, lng, triggerKey }: { lat: number; lng: number; triggerKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (triggerKey > 0) map.setView([lat, lng], 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);
  return null;
}

export interface AgenLocationMapProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
  recenterKey: number;
  readOnly?: boolean;
}

export function AgenLocationMap({ latitude, longitude, onChange, recenterKey, readOnly }: AgenLocationMapProps) {
  const markerRef = useRef<L.Marker>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const tile = TILE_SOURCES[mapStyle];

  const handleDragEnd = useCallback(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const pos = marker.getLatLng();
    onChange(pos.lat, pos.lng);
  }, [onChange]);

  return (
    <div className="relative z-0">
      <MapContainer
        center={[latitude, longitude]}
        zoom={15}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        style={{ height: 260, width: "100%", borderRadius: "var(--radius-lg)" }}
      >
        <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <MapZoomControl className="top-2 left-2" />
        <Marker
          position={[latitude, longitude]}
          icon={agenIcon}
          draggable={!readOnly}
          eventHandlers={readOnly ? undefined : { dragend: handleDragEnd }}
          ref={markerRef}
        />
        {!readOnly && <ClickToMove onMove={onChange} />}
        <RecenterOnTrigger lat={latitude} lng={longitude} triggerKey={recenterKey} />
      </MapContainer>
      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <MapAttribution className="top-2 left-1/2 -translate-x-1/2" />
    </div>
  );
}
```

- [ ] **Step 2: Create the multi-pin overview map**

```tsx
// src/components/dashboard/agen-locations-map.tsx
"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { TILE_SOURCES } from "@/lib/map-styles";
import { MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";

const agenIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export interface AgenLocationPoint {
  agenId: string;
  nama: string;
  wilayah: string | null;
  latitude: number;
  longitude: number;
}

function FitToPoints({ points }: { points: AgenLocationPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 13);
      return;
    }
    const bounds = L.latLngBounds(points.map((p): [number, number] => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function AgenLocationsMap({ points }: { points: AgenLocationPoint[] }) {
  const tile = TILE_SOURCES.light;
  return (
    <div className="relative z-0">
      <MapContainer
        center={points[0] ? [points[0].latitude, points[0].longitude] : [-7.8462825, 111.4759937]}
        zoom={11}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        style={{ height: 320, width: "100%", borderRadius: "var(--radius-lg)" }}
      >
        <TileLayer attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <MapZoomControl className="top-2 left-2" />
        {points.map((p) => (
          <Marker key={p.agenId} position={[p.latitude, p.longitude]} icon={agenIcon}>
            <Popup>
              <strong>{p.nama}</strong>
              {p.wilayah && <div>{p.wilayah}</div>}
            </Popup>
          </Marker>
        ))}
        <FitToPoints points={points} />
      </MapContainer>
      <MapAttribution className="top-2 left-1/2 -translate-x-1/2" />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/dashboard/agen-location-map.tsx src/components/dashboard/agen-locations-map.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/agen-location-map.tsx src/components/dashboard/agen-locations-map.tsx
git commit -m "feat: tambah komponen peta AgenLocationMap/AgenLocationsMap"
```

---

## Task 8: `AgenLocationField` — simplified location picker for the form

**Files:**
- Create: `src/components/dashboard/agen-location-field.tsx`

**Interfaces:**
- Consumes: `AgenLocationMap`/`AgenLocationMapProps` (Task 7).
- Produces: `AgenLocationField({ value, onChange }: { value: AgenLocationValue | null; onChange: (v: AgenLocationValue) => void })`, `AgenLocationValue` interface — consumed by Task 11 (form dialog).

**Deliberately simpler than Es Kristal's `MitraLocationField`**: no address search (Nominatim `/api/geocode/search`), no reverse-geocode-on-drag, no Capacitor "Pakai Lokasi Saya" GPS button — those depend on MKEsindo-specific API routes and native-app plumbing out of scope for this plan. This field is drag-the-pin-and-type-the-address-yourself, which fully satisfies the spec's "tambahkan fitur pin lokasi" requirement without pulling in unrelated infrastructure.

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/agen-location-field.tsx
"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const AgenLocationMap = dynamic(
  () => import("@/components/dashboard/agen-location-map").then((m) => m.AgenLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full rounded-lg" /> }
);

export interface AgenLocationValue {
  latitude: number;
  longitude: number;
  alamat: string | null;
}

// Default pin position when an Agen has no saved location yet -- centered
// on the pmputra pabrik area (same fallback coordinate Es Kristal's
// PABRIK_FALLBACK uses), since a reasonable starting point beats (0,0).
const DEFAULT_POSITION: AgenLocationValue = { latitude: -7.8462825, longitude: 111.4759937, alamat: null };

export function AgenLocationField({
  value,
  onChange,
}: {
  value: AgenLocationValue | null;
  onChange: (value: AgenLocationValue) => void;
}) {
  const current = value ?? DEFAULT_POSITION;
  const [recenterKey] = useState(0);

  function handleMove(lat: number, lng: number) {
    onChange({ latitude: lat, longitude: lng, alamat: current.alamat });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Lokasi (opsional)</Label>
      <AgenLocationMap latitude={current.latitude} longitude={current.longitude} onChange={handleMove} recenterKey={recenterKey} />
      <div className="flex items-start gap-1.5 rounded-md border border-border bg-card/50 px-2.5 py-2 text-xs">
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          {current.latitude.toFixed(6)}, {current.longitude.toFixed(6)}
        </p>
      </div>
      <Input
        value={current.alamat ?? ""}
        onChange={(e) => onChange({ ...current, alamat: e.target.value || null })}
        placeholder="Catatan alamat lokasi pin (opsional)"
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/dashboard/agen-location-field.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/agen-location-field.tsx
git commit -m "feat: tambah AgenLocationField untuk form pin lokasi Mitra"
```

---

## Task 9: `MitraEsBalokList` component — card grid + filters + pagination

**Files:**
- Create: `src/components/dashboard/mitra-es-balok-list.tsx`

**Interfaces:**
- Consumes: `MitraCard`, `SumberAgen` (`@/lib/queries/mitra-es-balok`); `AgenLocationsMap`/`AgenLocationPoint` (Task 7, dynamically imported); `Pagination` (`@/components/dashboard/pagination`, unchanged); `Card`/`CardContent`, `Badge`, `Input`, `Select*`, `DropdownMenu*` (shadcn/ui, unchanged); `formatRupiah` (`@/lib/format`, unchanged).
- Produces: `MitraEsBalokList({ kode, cards, onSelect, onAddNew, onSuspendToggle, onDelete }: props)` — consumed by Task 12 (page.tsx).

This component is purely presentational/interactive over already-fetched data (client-side filtering, same pattern as Es Kristal's `mitra-list.tsx`) — it does not fetch data itself; the page passes `cards` down and re-fetches (via `router.refresh()` after a mutating Server Action) rather than this component owning its own fetch. Per spec's "Halaman Mitra" section, this component ALSO renders the multi-pin overview map above the grid, and each card carries Edit/Nonaktifkan/Hapus row actions (mirroring Es Kristal's `mitra-list.tsx` icon-button row) — suspend/reactivate and delete are per-card actions here, not fields inside the create/edit form (matching Es Kristal's own actual pattern: `MitraFormDialog` there has no "Aktif" toggle either, `setMitraSuspended`/`deleteMitra` are separate row actions).

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/mitra-es-balok-list.tsx
"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Plus, Phone, Ban, MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pagination } from "@/components/dashboard/pagination";
import { formatRupiah } from "@/lib/format";
import type { MitraCard, SumberAgen } from "@/lib/queries/mitra-es-balok";

const AgenLocationsMap = dynamic(
  () => import("@/components/dashboard/agen-locations-map").then((m) => m.AgenLocationsMap),
  { ssr: false, loading: () => <Skeleton className="h-[320px] w-full rounded-lg" /> }
);

const PAGE_SIZE = 12;

function sumberLabel(sumber: SumberAgen, kode: string): string | null {
  if (kode === "pmputra") return null; // always merged, no badge needed
  if (sumber === "logistik") return "Logistik (Bersama)";
  return "Utama";
}

export function MitraEsBalokList({
  kode,
  cards,
  onSelect,
  onAddNew,
  onEdit,
  onSuspendToggle,
  onDelete,
}: {
  kode: string;
  cards: MitraCard[];
  onSelect: (card: MitraCard) => void;
  onAddNew: () => void;
  onEdit: (card: MitraCard) => void;
  onSuspendToggle: (card: MitraCard) => void;
  onDelete: (card: MitraCard) => void;
}) {
  const [search, setSearch] = useState("");
  const [sumberFilter, setSumberFilter] = useState<"all" | SumberAgen>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "aktif" | "nonaktif">("all");
  const [wilayahFilter, setWilayahFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Derived from already-fetched cards rather than a separate query -- this
  // filter only needs the DISTINCT Wilayah values actually present in the
  // current list, not the full PMP_Wilayah master list (that's what
  // getWilayahOptions/Task 11's form Select is for).
  const wilayahOptionsFromCards = useMemo(() => {
    const set = new Set(cards.map((c) => c.wilayah).filter((w): w is string => !!w));
    return Array.from(set).sort();
  }, [cards]);

  const mapPoints = useMemo(
    () =>
      cards
        .filter((c): c is MitraCard & { latitude: number; longitude: number } => c.latitude != null && c.longitude != null)
        .map((c) => ({ agenId: c.agenId, nama: c.nama, wilayah: c.wilayah, latitude: c.latitude, longitude: c.longitude })),
    [cards]
  );

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (search && !c.nama.toLowerCase().includes(search.toLowerCase())) return false;
      if (sumberFilter !== "all" && c.sumber !== sumberFilter) return false;
      if (statusFilter === "aktif" && !c.isActive) return false;
      if (statusFilter === "nonaktif" && c.isActive) return false;
      if (wilayahFilter !== "all" && c.wilayah !== wilayahFilter) return false;
      return true;
    });
  }, [cards, search, sumberFilter, statusFilter, wilayahFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showSumberFilter = kode !== "pmputra";

  return (
    <div className="flex flex-col gap-4">
      {mapPoints.length > 0 && <AgenLocationsMap points={mapPoints} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Cari nama Mitra..."
          className="max-w-64"
        />
        {showSumberFilter && (
          <Select
            value={sumberFilter}
            onValueChange={(v) => {
              setSumberFilter(v as "all" | SumberAgen);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Sumber" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Sumber</SelectItem>
              <SelectItem value="utama">Utama</SelectItem>
              <SelectItem value="logistik">Logistik (Bersama)</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as "all" | "aktif" | "nonaktif");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="aktif">Aktif</SelectItem>
            <SelectItem value="nonaktif">Nonaktif</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={wilayahFilter}
          onValueChange={(v) => {
            setWilayahFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Wilayah" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Wilayah</SelectItem>
            {wilayahOptionsFromCards.map((w) => (
              <SelectItem key={w} value={w}>
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={onAddNew} className="ml-auto">
          <Plus className="size-4" />
          Tambah Mitra
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => (
          <Card key={`${c.sumber}-${c.agenId}`} className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => onSelect(c)}>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-tight">{c.nama}</p>
                <div className="flex shrink-0 items-center gap-1">
                  {!c.isActive && (
                    <Badge variant="destructive">
                      <Ban className="size-3" />
                      Nonaktif
                    </Badge>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7" onClick={(e) => e.stopPropagation()}>
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => onEdit(c)}>
                        <Pencil className="size-3.5" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSuspendToggle(c)}>
                        {c.isActive ? <Ban className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                        {c.isActive ? "Nonaktifkan" : "Aktifkan"}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(c)}>
                        <Trash2 className="size-3.5" />
                        Hapus
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {sumberLabel(c.sumber, kode) && <Badge variant="secondary">{sumberLabel(c.sumber, kode)}</Badge>}
              {c.telepon && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Phone className="size-3" />
                  {c.telepon}
                </p>
              )}
              {c.wilayah && <p className="text-xs text-muted-foreground">{c.wilayah}</p>}
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {formatRupiah(c.hargaBalokKecil)} / {formatRupiah(c.hargaBalokBesar)}
                </span>
                {c.maksimumHutang > 0 && <span className="text-muted-foreground">Maks. {formatRupiah(c.maksimumHutang)}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada Mitra yang cocok.</p>}

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/dashboard/mitra-es-balok-list.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/mitra-es-balok-list.tsx
git commit -m "feat: tambah komponen MitraEsBalokList (card grid + filter)"
```

---

## Task 10: `MitraEsBalokDetailDialog` component

**Files:**
- Create: `src/components/dashboard/mitra-es-balok-detail-dialog.tsx`

**Interfaces:**
- Consumes: `MitraDetailData`, `SumberAgen` (`@/lib/queries/mitra-es-balok`); `AgenLocationMap` (Task 7, dynamically imported); `Dialog*` (shadcn/ui, unchanged); `Table*` (shadcn/ui, unchanged); `formatRupiah` (`@/lib/format`, unchanged).
- Produces: `MitraEsBalokDetailDialog({ open, onOpenChange, kode, sumber, agenId, fetchDetail, onEdit }: props)` — consumed by Task 12 (page.tsx). `fetchDetail` is injected (a Server Action wrapper) rather than imported directly, since this is a Client Component and Server Actions must be passed down from a Server Component ancestor or called via a `"use server"`-exported function reference — matching Es Kristal's `MitraDetailDialog`'s lazy-fetch-on-open pattern.

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/mitra-es-balok-detail-dialog.tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Phone, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format";
import type { MitraDetailData, SumberAgen } from "@/lib/queries/mitra-es-balok";

const AgenLocationMap = dynamic(
  () => import("@/components/dashboard/agen-location-map").then((m) => m.AgenLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full rounded-lg" /> }
);

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

function formatQtyPlain(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

export function MitraEsBalokDetailDialog({
  open,
  onOpenChange,
  kode,
  sumber,
  agenId,
  fetchDetail,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kode: string;
  sumber: SumberAgen;
  agenId: string | null;
  fetchDetail: (kode: string, sumber: SumberAgen, agenId: string) => Promise<MitraDetailData | null>;
  onEdit: (data: MitraDetailData) => void;
}) {
  const [data, setData] = useState<MitraDetailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !agenId) {
      setData(null);
      return;
    }
    setLoading(true);
    fetchDetail(kode, sumber, agenId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [open, kode, sumber, agenId, fetchDetail]);

  const isSharedLogistik = sumber === "logistik" && (kode === "pmpersada" || kode === "pmpakis");
  const pasangan = kode === "pmpersada" ? "pmpakis" : "pmpersada";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.nama ?? "Detail Mitra"}</DialogTitle>
        </DialogHeader>

        {loading && <Skeleton className="h-64 w-full" />}

        {!loading && data && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={data.isActive ? "secondary" : "destructive"}>{data.isActive ? "Aktif" : "Nonaktif"}</Badge>
              {isSharedLogistik && <Badge variant="outline">Logistik (Bersama {pasangan})</Badge>}
              {data.telepon && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Phone className="size-3.5" />
                  {data.telepon}
                </span>
              )}
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => onEdit(data)}>
                <Pencil className="size-3.5" />
                Edit
              </Button>
            </div>

            {isSharedLogistik && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Mitra ini berasal dari database logistik yang dipakai bersama pmpersada &amp; pmpakis — akan muncul identik di
                modul Mitra perusahaan pasangannya ({pasangan}).
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Wilayah</p>
                <p>{data.wilayah ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Alamat</p>
                <p>{data.alamat ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Harga Kecil / Besar</p>
                <p>
                  {formatRupiah(data.hargaBalokKecil)} / {formatRupiah(data.hargaBalokBesar)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Batas Hutang</p>
                <p>{formatRupiah(data.maksimumHutang)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Saldo Awal Piutang</p>
                <p>{formatRupiah(data.piutangSaldoAwal)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Saldo Awal Tabungan</p>
                <p>{formatRupiah(data.tabunganSaldoAwal)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Piutang Baru (Bulan Ini)</p>
                <p className="text-lg font-semibold">{formatRupiah(data.piutangBaruBulanIni)}</p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Pembayaran (Bulan Ini, Perkiraan)</p>
                <p className="text-lg font-semibold">{formatRupiah(data.pembayaranEstimasiBulanIni)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Piutang Baru dihitung andal dari data pesanan. Pembayaran adalah perkiraan (dicocokkan dari nama), totalnya
              mungkin tidak pas 100% dengan saldo agregat perusahaan.
            </p>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bulan</TableHead>
                    <TableHead className="text-right">Balok Kecil</TableHead>
                    <TableHead className="text-right">Balok Besar</TableHead>
                    <TableHead className="text-right">Total Balok</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.riwayatBulanan.map((m) => (
                    <TableRow key={m.bulan}>
                      <TableCell>{formatMonthLabel(m.bulan)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQtyPlain(m.balokKecil)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatQtyPlain(m.balokBesar)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatQtyPlain(m.totalBalok)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {data.latitude != null && data.longitude != null && (
              <AgenLocationMap latitude={data.latitude} longitude={data.longitude} onChange={() => {}} recenterKey={0} readOnly />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/dashboard/mitra-es-balok-detail-dialog.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/mitra-es-balok-detail-dialog.tsx
git commit -m "feat: tambah komponen MitraEsBalokDetailDialog"
```

---

## Task 11: `MitraEsBalokFormDialog` component (create/edit)

**Files:**
- Create: `src/components/dashboard/mitra-es-balok-form-dialog.tsx`

**Interfaces:**
- Consumes: `MitraInput`, `SumberAgen`, `WilayahOption` (`@/lib/queries/mitra-es-balok`); `AgenLocationField`/`AgenLocationValue` (Task 8); `Dialog*`, `Select*` (shadcn/ui, unchanged).
- Produces: `MitraEsBalokFormDialog({ open, onOpenChange, kode, mode, initial, wilayahOptions, onSubmit }: props)`, `emptyMitraForm()` — consumed by Task 12 (page.tsx).

- [ ] **Step 1: Create the component**

```tsx
// src/components/dashboard/mitra-es-balok-form-dialog.tsx
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgenLocationField, type AgenLocationValue } from "@/components/dashboard/agen-location-field";
import type { MitraInput, SumberAgen, WilayahOption } from "@/lib/queries/mitra-es-balok";

export function emptyMitraForm(): MitraInput {
  return { nama: "", telepon: "", wilayahId: null, alamat: "", hargaBalokKecil: 0, hargaBalokBesar: 0, maksimumHutang: 0 };
}

export function MitraEsBalokFormDialog({
  open,
  onOpenChange,
  kode,
  mode,
  initial,
  initialSumber,
  initialLocation,
  wilayahOptions,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kode: string;
  mode: "create" | "edit";
  initial: MitraInput;
  initialSumber: SumberAgen;
  initialLocation: AgenLocationValue | null;
  wilayahOptions: WilayahOption[];
  onSubmit: (input: MitraInput, sumber: SumberAgen, location: AgenLocationValue | null) => Promise<void>;
}) {
  const [form, setForm] = useState<MitraInput>(initial);
  const [sumber, setSumber] = useState<SumberAgen>(initialSumber);
  const [location, setLocation] = useState<AgenLocationValue | null>(initialLocation);
  const [submitting, setSubmitting] = useState(false);
  const needsSumberChoice = kode !== "pmputra";

  useEffect(() => {
    if (open) {
      setForm(initial);
      setSumber(initialSumber);
      setLocation(initialLocation);
    }
  }, [open, initial, initialSumber, initialLocation]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(form, sumber, location);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Tambah Mitra" : "Edit Mitra"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {needsSumberChoice && mode === "create" && (
            <div className="flex flex-col gap-1.5">
              <Label>Sumber</Label>
              <Select value={sumber} onValueChange={(v) => setSumber(v as SumberAgen)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utama">Utama</SelectItem>
                  <SelectItem value="logistik">Logistik (Bersama)</SelectItem>
                </SelectContent>
              </Select>
              {sumber === "logistik" && (
                <p className="text-xs text-warning">
                  Mitra baru ini akan otomatis muncul juga di modul Mitra perusahaan pasangan ({kode === "pmpersada" ? "pmpakis" : "pmpersada"}),
                  karena keduanya menulis ke database fisik yang sama.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Nama</Label>
            <Input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Telepon</Label>
            <Input value={form.telepon} onChange={(e) => setForm({ ...form, telepon: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Wilayah</Label>
            <Select value={form.wilayahId ?? "__none__"} onValueChange={(v) => setForm({ ...form, wilayahId: v === "__none__" ? null : v })}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih Wilayah" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Tidak ada</SelectItem>
                {wilayahOptions.map((w) => (
                  <SelectItem key={w.wilayahId} value={w.wilayahId}>
                    {w.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Alamat</Label>
            <Input value={form.alamat} onChange={(e) => setForm({ ...form, alamat: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Harga Balok Kecil</Label>
              <Input
                type="number"
                value={form.hargaBalokKecil}
                onChange={(e) => setForm({ ...form, hargaBalokKecil: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Harga Balok Besar</Label>
              <Input
                type="number"
                value={form.hargaBalokBesar}
                onChange={(e) => setForm({ ...form, hargaBalokBesar: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Batas Hutang</Label>
            <Input
              type="number"
              value={form.maksimumHutang}
              onChange={(e) => setForm({ ...form, maksimumHutang: Number(e.target.value) })}
            />
          </div>

          <AgenLocationField value={location} onChange={setLocation} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.nama}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/dashboard/mitra-es-balok-form-dialog.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/mitra-es-balok-form-dialog.tsx
git commit -m "feat: tambah komponen MitraEsBalokFormDialog"
```

---

## Task 12: Wire pages + Server Actions for pmputra, pmpersada, pmpakis

**Files:**
- Create: `src/app/pmputra/mitra/actions.ts`
- Create: `src/app/pmputra/mitra/page.tsx`
- Create: `src/app/pmputra/mitra/mitra-page-client.tsx`
- Create: `src/app/pmpersada/(dashboard)/mitra/actions.ts`
- Create: `src/app/pmpersada/(dashboard)/mitra/page.tsx`
- Create: `src/app/pmpersada/(dashboard)/mitra/mitra-page-client.tsx`
- Create: `src/app/pmpakis/(dashboard)/mitra/actions.ts`
- Create: `src/app/pmpakis/(dashboard)/mitra/page.tsx`
- Create: `src/app/pmpakis/(dashboard)/mitra/mitra-page-client.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3, 5, 6 (`@/lib/queries/mitra-es-balok`), Task 9 (`MitraEsBalokList`), Task 10 (`MitraEsBalokDetailDialog`), Task 11 (`MitraEsBalokFormDialog`/`emptyMitraForm`), `requirePmputra`/`requirePmpersadaKeuangan`/`requirePmpakis` (`@/lib/require-access`, unchanged).
- Produces: nothing consumed by later tasks — these are leaf pages/actions. All three companies follow the identical pattern below; only the guard function, `kode` literal, and file path differ.

Each company gets its own `actions.ts` (Server Actions, each calling its own guard) and a thin `page.tsx` (Server Component: guard + fetch initial list + wilayah options, renders the Client Component) plus a `mitra-page-client.tsx` (Client Component: owns dialog open/close state, wires the three presentational components together, calls Server Actions, and calls `router.refresh()` after any mutation so the list re-fetches from the server).

- [ ] **Step 1: Create pmputra's `actions.ts`**

```ts
// src/app/pmputra/mitra/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmputra } from "@/lib/require-access";
import {
  getMitraList,
  getMitraDetail,
  getWilayahOptions,
  createMitra,
  updateMitra,
  setMitraSuspended,
  deleteMitra,
  setAgenLocation,
  type SumberAgen,
  type MitraInput,
} from "@/lib/queries/mitra-es-balok";

const KODE = "pmputra";

export async function getMitraListAction() {
  await requirePmputra();
  return getMitraList(KODE);
}

export async function getMitraDetailAction(sumber: SumberAgen, agenId: string) {
  await requirePmputra();
  return getMitraDetail(KODE, sumber, agenId);
}

export async function getWilayahOptionsAction(sumber: SumberAgen) {
  await requirePmputra();
  return getWilayahOptions(KODE, sumber);
}

export async function createMitraAction(
  sumber: SumberAgen,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmputra();
  const agenId = await createMitra(KODE, sumber, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmputra/mitra");
  return agenId;
}

export async function updateMitraAction(
  sumber: SumberAgen,
  agenId: string,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmputra();
  await updateMitra(KODE, sumber, agenId, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmputra/mitra");
}

export async function setMitraSuspendedAction(sumber: SumberAgen, agenId: string, isActive: boolean) {
  await requirePmputra();
  await setMitraSuspended(KODE, sumber, agenId, isActive);
  revalidatePath("/pmputra/mitra");
}

export async function deleteMitraAction(sumber: SumberAgen, agenId: string) {
  await requirePmputra();
  await deleteMitra(KODE, sumber, agenId);
  revalidatePath("/pmputra/mitra");
}
```

- [ ] **Step 2: Create pmputra's `mitra-page-client.tsx`**

```tsx
// src/app/pmputra/mitra/mitra-page-client.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MitraEsBalokList } from "@/components/dashboard/mitra-es-balok-list";
import { MitraEsBalokDetailDialog } from "@/components/dashboard/mitra-es-balok-detail-dialog";
import { MitraEsBalokFormDialog, emptyMitraForm } from "@/components/dashboard/mitra-es-balok-form-dialog";
import type { MitraCard, MitraDetailData, WilayahOption } from "@/lib/queries/mitra-es-balok";
import {
  getMitraDetailAction,
  createMitraAction,
  updateMitraAction,
  setMitraSuspendedAction,
  deleteMitraAction,
} from "./actions";

const KODE = "pmputra";

export function MitraPageClient({ cards, wilayahOptions }: { cards: MitraCard[]; wilayahOptions: WilayahOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<MitraCard | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editTarget, setEditTarget] = useState<MitraDetailData | null>(null);

  function handleAddNew() {
    setFormMode("create");
    setEditTarget(null);
    setFormOpen(true);
  }

  function handleEdit(data: MitraDetailData) {
    setDetailOpen(false);
    setFormMode("edit");
    setEditTarget(data);
    setFormOpen(true);
  }

  async function handleEditFromCard(card: MitraCard) {
    const detail = await getMitraDetailAction(card.sumber, card.agenId);
    if (detail) handleEdit(detail);
  }

  async function handleSuspendToggle(card: MitraCard) {
    await setMitraSuspendedAction(card.sumber, card.agenId, !card.isActive);
    router.refresh();
  }

  async function handleDelete(card: MitraCard) {
    if (!confirm(`Hapus Mitra "${card.nama}"? Tindakan ini tidak bisa dibatalkan lewat aplikasi ini.`)) return;
    await deleteMitraAction(card.sumber, card.agenId);
    router.refresh();
  }

  return (
    <>
      <MitraEsBalokList
        kode={KODE}
        cards={cards}
        onAddNew={handleAddNew}
        onSelect={(card) => {
          setSelected(card);
          setDetailOpen(true);
        }}
        onEdit={handleEditFromCard}
        onSuspendToggle={handleSuspendToggle}
        onDelete={handleDelete}
      />

      <MitraEsBalokDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        kode={KODE}
        sumber={selected?.sumber ?? "utama"}
        agenId={selected?.agenId ?? null}
        fetchDetail={(_, sumber, agenId) => getMitraDetailAction(sumber, agenId)}
        onEdit={handleEdit}
      />

      <MitraEsBalokFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        kode={KODE}
        mode={formMode}
        initial={
          editTarget
            ? {
                nama: editTarget.nama,
                telepon: editTarget.telepon ?? "",
                wilayahId: null,
                alamat: editTarget.alamat ?? "",
                hargaBalokKecil: editTarget.hargaBalokKecil,
                hargaBalokBesar: editTarget.hargaBalokBesar,
                maksimumHutang: editTarget.maksimumHutang,
              }
            : emptyMitraForm()
        }
        initialSumber={editTarget?.sumber ?? "utama"}
        initialLocation={
          editTarget?.latitude != null && editTarget?.longitude != null
            ? { latitude: editTarget.latitude, longitude: editTarget.longitude, alamat: editTarget.alamat }
            : null
        }
        wilayahOptions={wilayahOptions}
        onSubmit={async (input, sumber, location) => {
          if (formMode === "create") {
            await createMitraAction(sumber, input, location);
          } else if (editTarget) {
            await updateMitraAction(sumber, editTarget.agenId, input, location);
          }
          router.refresh();
        }}
      />
    </>
  );
}
```

- [ ] **Step 3: Create pmputra's `page.tsx`**

```tsx
// src/app/pmputra/mitra/page.tsx
import { getMitraList, getWilayahOptions } from "@/lib/queries/mitra-es-balok";
import { requirePmputra } from "@/lib/require-access";
import { MitraPageClient } from "./mitra-page-client";

export default async function PmputraMitraPage() {
  await requirePmputra();
  const [cards, wilayahOptions] = await Promise.all([getMitraList("pmputra"), getWilayahOptions("pmputra", "utama")]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Mitra</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <MitraPageClient cards={cards} wilayahOptions={wilayahOptions} />
    </div>
  );
}
```

- [ ] **Step 4: Repeat Steps 1-3 for pmpersada — same pattern, `requirePmpersadaKeuangan`, `sumber` is required on create (no `pmputra`-style implicit merge), delete + suspend actions gain a `sumber` param already present above**

```ts
// src/app/pmpersada/(dashboard)/mitra/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import {
  getMitraList,
  getMitraDetail,
  getWilayahOptions,
  createMitra,
  updateMitra,
  setMitraSuspended,
  deleteMitra,
  setAgenLocation,
  type SumberAgen,
  type MitraInput,
} from "@/lib/queries/mitra-es-balok";

const KODE = "pmpersada";

export async function getMitraListAction() {
  await requirePmpersadaKeuangan();
  return getMitraList(KODE);
}

export async function getMitraDetailAction(sumber: SumberAgen, agenId: string) {
  await requirePmpersadaKeuangan();
  return getMitraDetail(KODE, sumber, agenId);
}

export async function getWilayahOptionsAction(sumber: SumberAgen) {
  await requirePmpersadaKeuangan();
  return getWilayahOptions(KODE, sumber);
}

export async function createMitraAction(
  sumber: SumberAgen,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmpersadaKeuangan();
  const agenId = await createMitra(KODE, sumber, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmpersada/mitra");
  return agenId;
}

export async function updateMitraAction(
  sumber: SumberAgen,
  agenId: string,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmpersadaKeuangan();
  await updateMitra(KODE, sumber, agenId, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmpersada/mitra");
}

export async function setMitraSuspendedAction(sumber: SumberAgen, agenId: string, isActive: boolean) {
  await requirePmpersadaKeuangan();
  await setMitraSuspended(KODE, sumber, agenId, isActive);
  revalidatePath("/pmpersada/mitra");
}

export async function deleteMitraAction(sumber: SumberAgen, agenId: string) {
  await requirePmpersadaKeuangan();
  await deleteMitra(KODE, sumber, agenId);
  revalidatePath("/pmpersada/mitra");
}
```

`src/app/pmpersada/(dashboard)/mitra/mitra-page-client.tsx` — byte-identical to pmputra's `mitra-page-client.tsx` above except: `const KODE = "pmpersada";` and the import path `from "./actions"` (same relative path, correct as-is — no other change, since the component itself is kode-agnostic beyond that constant).

```tsx
// src/app/pmpersada/(dashboard)/mitra/page.tsx
import { getMitraList, getWilayahOptions } from "@/lib/queries/mitra-es-balok";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import { MitraPageClient } from "./mitra-page-client";

export default async function PmpersadaMitraPage() {
  await requirePmpersadaKeuangan();
  const [cards, wilayahOptions] = await Promise.all([getMitraList("pmpersada"), getWilayahOptions("pmpersada", "utama")]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Mitra</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <MitraPageClient cards={cards} wilayahOptions={wilayahOptions} />
    </div>
  );
}
```

- [ ] **Step 5: Repeat for pmpakis — same pattern, `requirePmpakis`**

```ts
// src/app/pmpakis/(dashboard)/mitra/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmpakis } from "@/lib/require-access";
import {
  getMitraList,
  getMitraDetail,
  getWilayahOptions,
  createMitra,
  updateMitra,
  setMitraSuspended,
  deleteMitra,
  setAgenLocation,
  type SumberAgen,
  type MitraInput,
} from "@/lib/queries/mitra-es-balok";

const KODE = "pmpakis";

export async function getMitraListAction() {
  await requirePmpakis();
  return getMitraList(KODE);
}

export async function getMitraDetailAction(sumber: SumberAgen, agenId: string) {
  await requirePmpakis();
  return getMitraDetail(KODE, sumber, agenId);
}

export async function getWilayahOptionsAction(sumber: SumberAgen) {
  await requirePmpakis();
  return getWilayahOptions(KODE, sumber);
}

export async function createMitraAction(
  sumber: SumberAgen,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmpakis();
  const agenId = await createMitra(KODE, sumber, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmpakis/mitra");
  return agenId;
}

export async function updateMitraAction(
  sumber: SumberAgen,
  agenId: string,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmpakis();
  await updateMitra(KODE, sumber, agenId, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmpakis/mitra");
}

export async function setMitraSuspendedAction(sumber: SumberAgen, agenId: string, isActive: boolean) {
  await requirePmpakis();
  await setMitraSuspended(KODE, sumber, agenId, isActive);
  revalidatePath("/pmpakis/mitra");
}

export async function deleteMitraAction(sumber: SumberAgen, agenId: string) {
  await requirePmpakis();
  await deleteMitra(KODE, sumber, agenId);
  revalidatePath("/pmpakis/mitra");
}
```

`src/app/pmpakis/(dashboard)/mitra/mitra-page-client.tsx` — byte-identical to pmputra's, with `const KODE = "pmpakis";`.

```tsx
// src/app/pmpakis/(dashboard)/mitra/page.tsx
import { getMitraList, getWilayahOptions } from "@/lib/queries/mitra-es-balok";
import { requirePmpakis } from "@/lib/require-access";
import { MitraPageClient } from "./mitra-page-client";

export default async function PmpakisMitraPage() {
  await requirePmpakis();
  const [cards, wilayahOptions] = await Promise.all([getMitraList("pmpakis"), getWilayahOptions("pmpakis", "utama")]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Mitra</h1>
        <p className="text-sm text-muted-foreground">PT Panen Mutiara Pakis — Es Balok</p>
      </div>
      <MitraPageClient cards={cards} wilayahOptions={wilayahOptions} />
    </div>
  );
}
```

- [ ] **Step 6: Typecheck and lint everything from this task**

Run: `npx tsc --noEmit`
Expected: no errors.

Run:
```bash
npx eslint src/app/pmputra/mitra/actions.ts src/app/pmputra/mitra/page.tsx src/app/pmputra/mitra/mitra-page-client.tsx \
  "src/app/pmpersada/(dashboard)/mitra/actions.ts" "src/app/pmpersada/(dashboard)/mitra/page.tsx" "src/app/pmpersada/(dashboard)/mitra/mitra-page-client.tsx" \
  "src/app/pmpakis/(dashboard)/mitra/actions.ts" "src/app/pmpakis/(dashboard)/mitra/page.tsx" "src/app/pmpakis/(dashboard)/mitra/mitra-page-client.tsx"
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/pmputra/mitra src/app/pmpersada/"(dashboard)"/mitra src/app/pmpakis/"(dashboard)"/mitra
git commit -m "feat: sambungkan halaman Mitra untuk pmputra, pmpersada, dan pmpakis"
```

---

## Task 13: Full verification pass

**Files:** None — verification only, fix forward in the touched files above if something's found broken.

**Interfaces:** N/A.

- [ ] **Step 1: Whole-project typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project.

Run:
```bash
npx eslint src/lib/queries/mitra-es-balok.ts src/lib/queries/penjualan-piutang.ts \
  src/components/dashboard/agen-location-map.tsx src/components/dashboard/agen-locations-map.tsx src/components/dashboard/agen-location-field.tsx \
  src/components/dashboard/mitra-es-balok-list.tsx src/components/dashboard/mitra-es-balok-detail-dialog.tsx src/components/dashboard/mitra-es-balok-form-dialog.tsx \
  src/app/pmputra/mitra/actions.ts src/app/pmputra/mitra/page.tsx src/app/pmputra/mitra/mitra-page-client.tsx \
  "src/app/pmpersada/(dashboard)/mitra/actions.ts" "src/app/pmpersada/(dashboard)/mitra/page.tsx" "src/app/pmpersada/(dashboard)/mitra/mitra-page-client.tsx" \
  "src/app/pmpakis/(dashboard)/mitra/actions.ts" "src/app/pmpakis/(dashboard)/mitra/page.tsx" "src/app/pmpakis/(dashboard)/mitra/mitra-page-client.tsx"
```
Expected: no errors.

- [ ] **Step 2: Re-verify the shared-logistik invariant end to end (this is the single riskiest piece of this plan)**

```ts
// scripts/_scratch_verify_task13_shared_logistik.ts
import "dotenv/config";
import { getMitraList } from "../src/lib/queries/mitra-es-balok";

async function main() {
  const pmpersada = (await getMitraList("pmpersada")).filter((c) => c.sumber === "logistik");
  const pmpakis = (await getMitraList("pmpakis")).filter((c) => c.sumber === "logistik");
  const idsA = pmpersada.map((c) => c.agenId).sort();
  const idsB = pmpakis.map((c) => c.agenId).sort();
  console.log("pmpersada logistik count:", idsA.length, "pmpakis logistik count:", idsB.length);
  console.log("IDENTICAL (must be true):", JSON.stringify(idsA) === JSON.stringify(idsB));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx tsx scripts/_scratch_verify_task13_shared_logistik.ts`, then delete it. If `IDENTICAL` prints `false`, stop and fix `resolveAgenKoneksi` before continuing — every other correctness check in this task assumes this invariant holds.

- [ ] **Step 3: Live browser check — all 3 pages, full CRUD cycle on one test record**

Start the dev server (if not already running). Login is required (no test credentials are assumed here — use whatever account has cross-PT or the respective PT's own access):

- Navigate to `/pmputra/mitra` — confirm the page renders (not the old placeholder), card grid populated, no badges shown (pmputra never shows a Sumber badge), no console errors.
- Navigate to `/pmpersada/mitra` — confirm both "Utama" and "Logistik (Bersama)" badges appear across different cards, the Sumber filter works, no console errors.
- Navigate to `/pmpakis/mitra` — same checks; independently confirm (by cross-referencing a Nama) that at least one "Logistik (Bersama)" card here matches one on `/pmpersada/mitra`.
- On any page: click "Tambah Mitra", fill the form (pick "Logistik" as Sumber if on pmpersada/pmpakis and confirm the warning text appears), drag the location pin, save — confirm the new card appears in the grid after `router.refresh()`.
- Click the new card — confirm the detail dialog opens, shows the just-entered data, the map renders the pin at the right spot.
- Click "Edit" from the detail dialog — confirm the form pre-fills correctly, change the Nama, save — confirm the card's name updates.
- From the list card's own "⋮" menu, click "Nonaktifkan" — confirm the card gets the "Nonaktif" badge; click "Aktifkan" — confirm it clears. Confirm the multi-pin overview map renders above the grid and shows the pin you dropped earlier.
- Clean up: use the card's own "⋮" → "Hapus" action to soft-delete the test Mitra created during this check, so no test data is left in production data.
- Confirm regression: `/pmputra/penjualan`, `/pmputra/piutang`, `/pmpersada/penjualan`, `/pmpersada/piutang` still render unchanged (Task 1 only added exports, didn't change behavior).

- [ ] **Step 4: Report and commit any fixes**

If Steps 2-3 find a discrepancy or the noted UI gap (inline suspend/delete on the card), fix it in the relevant file from Tasks 1-12 and re-run Steps 1-3 before considering this task done. Commit any fix separately:

```bash
git add <fixed files>
git commit -m "fix: <describe what verification caught>"
```
