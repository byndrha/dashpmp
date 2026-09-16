# Modul Kinerja Karyawan — Aspek Penjualan (Marketing and Collection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Kinerja" module (`/mkesindo/kinerja`) showing a dynamic monthly NOO/Existing/Total sales-performance table for the "Marketing and Collection" jabatan, built on a generic Jabatan → Aspek Kinerja → Business Rule architecture that other job titles can extend later without touching this code.

**Architecture:** A lightweight Postgres metadata layer (`jabatan`, `jabatan_peran_map`, `aspek_kinerja`) describes WHO has WHAT aspect; the actual calculation is a TypeScript module registered in a small registry (`src/lib/kinerja/registry.ts`), not a generic formula engine — this matches the codebase's existing convention of expressing business rules as commented TypeScript, not data-driven DSLs. The Marketing and Collection / Penjualan calculator attributes every `BusinessPartner` (mitra) to exactly one Marketing employee's `akun.id`: mitra with an approved Pengajuan get permanent NOO credit (for the approval month) then permanent Existing status afterward, tied to the *submitting* Marketing regardless of later wilayah reassignment; mitra with no Pengajuan trail (legacy) fall back to the existing wilayah-based `resolveResponsibleMarketing()` and are permanently Existing. Monthly kantong-sold quantities come from `DeliveryOrder`/`DeliveryOrderDetail` (the same `KANTONG_QTY_EXPR` convention used elsewhere), aggregated per mitra per month, then rolled up per owning employee into NOO/Existing buckets and converted into month-over-month deltas and a Rp200/kantong Rupiah figure.

**Tech Stack:** Next.js 16 App Router Server Components, Postgres (`pg`, `getPgPool()`) for the new `jabatan`/`aspek_kinerja` metadata, MSSQL (`mssql`, `getPool()` — MKEsindo only for this phase) for `DashboardMitraPengajuan`/`BusinessPartner`/`DeliveryOrder` data, existing `src/lib/queries/marketing-wilayah.ts` for the wilayah-based fallback.

**Spec:** `docs/superpowers/specs/2026-09-16-kinerja-karyawan-penjualan-marketing-design.md`

## Global Constraints

- Scope for this phase is **MKEsindo only** — use `getPool()` from `src/lib/db.ts` (MKEsindo-hardcoded), never `getCompanyPool()`. Confirmed in the spec's own "Asumsi Belum Terverifikasi".
- `session.user.id` is a **string** (see `src/types/next-auth.d.ts`); `akun.id` in Postgres is a `number` — always convert with `Number(session.user.id)` or `String(akun.id)` depending on direction, never compare across types directly.
- `resolveResponsibleMarketing()` (`src/lib/queries/marketing-wilayah.ts:308-326`) returns a Marketing's **display name** (`string | null`), NOT an `akun.id` — despite `MarketingWilayahAssignment` internally carrying `MarketingUserID`. To get back to an `akun.id`, build a `Nama -> UserID` reverse map from `getMarketingUsers()` (`marketing-wilayah.ts:28-35`, which already returns `{ UserID: string; Nama: string }[]` where `UserID` is `String(akun.id)`). This is an accepted, documented limitation (two Marketing sharing an exact `nama` would collide) — do not attempt to fix `resolveResponsibleMarketing()` itself, it is used elsewhere and out of scope.
- Kantong quantity convention (verbatim, copy exactly, do not retype from memory): `` `SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END)` `` — a 5KG bag counts as half a kantong. Verified live at `src/lib/queries/mitra-do.ts:67`.
- Rollover: use the **app-wide** `ROLLOVER_HOUR = 14` (`src/lib/business-date.ts`) for this module's "current month" boundary — NOT the Kinerja-Marketing-specific 13:00 rollover (`KINERJA_MARKETING_ROLLOVER_HOUR` in `marketing-performance.ts`), which belongs to the old, untouched Pemasaran panel.
- Rate constant: **1 Kantong Es = Rp200**, applied as `totalQty * 200` (can be negative).
- **Do not modify** any file under the existing "Kinerja Marketing" feature: `src/lib/queries/marketing-performance.ts`, `src/lib/queries/marketing-performance-trend.ts`, `src/components/dashboard/marketing-performance-panel.tsx`, `src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx`, or anything under `src/app/mkesindo/(dashboard)/pemasaran/`. This is a separate, independent feature by explicit user decision.
- `DashboardMitraPengajuan.MarketingUserID` and `.ConvertedBusinessPartnerID` are the only durable link between a Pengajuan and the mitra it produced (no DB-level FK). A Pengajuan row can be hard-deleted after conversion (`deletePengajuan`) without touching the resulting `BusinessPartner` — when that happens, the mitra silently falls through to the legacy/wilayah-fallback path in this feature's own attribution query (no special-casing needed, this is automatic from the query design in Task 3).
- No unit-test framework exists in this repo. Verification throughout this plan is: `npx tsc --noEmit` (and `npx eslint` where configured) for every task, plus either a live-data verification script (for query/calculation tasks) or a browser check (for UI tasks) — matching how every prior plan in this repo (e.g. Modul Inventaris) was verified.

---

### Task 1: Postgres schema for Jabatan/Aspek Kinerja + seed + query helpers

**Files:**
- Create: `scripts/migrate-kinerja-db.ts`
- Create: `src/lib/queries/kinerja-jabatan.ts`

**Interfaces:**
- Consumes: nothing from this plan (first task).
- Produces: Postgres tables `jabatan`, `jabatan_peran_map`, `aspek_kinerja`; `JabatanRow`, `AspekKinerjaRow` types and `getJabatanByPeranId(peranId: number): Promise<JabatanRow | null>`, `getAspekKinerjaList(jabatanId: number): Promise<AspekKinerjaRow[]>` — consumed by Task 5.

- [ ] **Step 1: Write the migration script**

```typescript
// scripts/migrate-kinerja-db.ts
// One-off, idempotent setup for the Modul Kinerja Karyawan metadata layer
// (jabatan/aspek_kinerja) in the existing pmp_directory Postgres DB, plus
// the seed row for "Marketing and Collection" / "Penjualan". Safe to
// re-run — every statement uses IF NOT EXISTS / ON CONFLICT.
//
// Usage: npx tsx scripts/migrate-kinerja-db.ts
import "dotenv/config";
import { Client } from "pg";

const DIRECTORY_DB_NAME = process.env.DIRECTORY_DB_NAME || "pmp_directory";

async function main() {
  const client = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: DIRECTORY_DB_NAME,
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS jabatan (
        id SERIAL PRIMARY KEY,
        kode VARCHAR(50) NOT NULL UNIQUE,
        nama VARCHAR(100) NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS jabatan_peran_map (
        jabatan_id INTEGER NOT NULL REFERENCES jabatan(id),
        peran_id INTEGER NOT NULL,
        PRIMARY KEY (jabatan_id, peran_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS aspek_kinerja (
        id SERIAL PRIMARY KEY,
        jabatan_id INTEGER NOT NULL REFERENCES jabatan(id),
        kode VARCHAR(50) NOT NULL,
        nama VARCHAR(100) NOT NULL,
        satuan VARCHAR(50) NOT NULL,
        UNIQUE (jabatan_id, kode)
      )
    `);

    const jabatanResult = await client.query(`
      INSERT INTO jabatan (kode, nama) VALUES ('marketing_collection', 'Marketing and Collection')
      ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama
      RETURNING id
    `);
    const jabatanId = jabatanResult.rows[0].id as number;

    // 1003 = MARKETING_ROLE_ID (src/lib/roles.ts) — kept as a literal here
    // rather than importing that TS constant, since this script runs
    // standalone via tsx and the value is a stable, already-existing
    // DashboardRole id, not something this migration should re-derive.
    await client.query(
      `INSERT INTO jabatan_peran_map (jabatan_id, peran_id) VALUES ($1, 1003) ON CONFLICT DO NOTHING`,
      [jabatanId]
    );

    await client.query(
      `INSERT INTO aspek_kinerja (jabatan_id, kode, nama, satuan)
       VALUES ($1, 'penjualan', 'Penjualan', 'Kantong Es Terjual')
       ON CONFLICT (jabatan_id, kode) DO UPDATE SET nama = EXCLUDED.nama, satuan = EXCLUDED.satuan`,
      [jabatanId]
    );

    console.log("Kinerja tables (jabatan, jabatan_peran_map, aspek_kinerja) ready + seeded.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/migrate-kinerja-db.ts`
Expected: `Kinerja tables (jabatan, jabatan_peran_map, aspek_kinerja) ready + seeded.` with no errors. Re-run it a second time immediately after — expected: identical output, no errors (idempotency check).

- [ ] **Step 3: Verify live**

Run: `npx tsx -e "import 'dotenv/config'; import { getPgPool } from './src/lib/pg'; getPgPool().query('SELECT j.kode AS jabatan, a.kode AS aspek, a.satuan FROM jabatan j JOIN aspek_kinerja a ON a.jabatan_id = j.id').then(r => console.log(r.rows)).then(() => process.exit(0))"`
Expected: `[ { jabatan: 'marketing_collection', aspek: 'penjualan', satuan: 'Kantong Es Terjual' } ]`

- [ ] **Step 4: Write the query helpers**

```typescript
// src/lib/queries/kinerja-jabatan.ts
import { getPgPool } from "@/lib/pg";

export interface JabatanRow {
  id: number;
  kode: string;
  nama: string;
}

export interface AspekKinerjaRow {
  id: number;
  jabatanId: number;
  kode: string;
  nama: string;
  satuan: string;
}

export async function getJabatanByPeranId(peranId: number): Promise<JabatanRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT j.id, j.kode, j.nama
     FROM jabatan j
     JOIN jabatan_peran_map m ON m.jabatan_id = j.id
     WHERE m.peran_id = $1
     LIMIT 1`,
    [peranId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as { id: number; kode: string; nama: string };
  return { id: row.id, kode: row.kode, nama: row.nama };
}

export async function getAspekKinerjaList(jabatanId: number): Promise<AspekKinerjaRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, jabatan_id, kode, nama, satuan FROM aspek_kinerja WHERE jabatan_id = $1 ORDER BY id`,
    [jabatanId]
  );
  return (result.rows as { id: number; jabatan_id: number; kode: string; nama: string; satuan: string }[]).map((r) => ({
    id: r.id,
    jabatanId: r.jabatan_id,
    kode: r.kode,
    nama: r.nama,
    satuan: r.satuan,
  }));
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify the helpers against live data**

Run: `npx tsx -e "import 'dotenv/config'; import { getJabatanByPeranId, getAspekKinerjaList } from './src/lib/queries/kinerja-jabatan'; (async () => { const j = await getJabatanByPeranId(1003); console.log(j); if (j) console.log(await getAspekKinerjaList(j.id)); process.exit(0); })()"`
Expected: prints the `marketing_collection` jabatan row, then an array containing the `penjualan` aspek row.

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate-kinerja-db.ts src/lib/queries/kinerja-jabatan.ts
git commit -m "feat: add Postgres schema + query helpers for Modul Kinerja Karyawan (Jabatan/Aspek Kinerja)"
```

---

### Task 2: Access control — `kinerja` ModuleKey + sidebar entry

**Files:**
- Modify: `src/lib/permissions.ts`
- Modify: `src/components/dashboard/app-sidebar.tsx`

**Interfaces:**
- Consumes: nothing from this plan.
- Produces: `"kinerja"` added to `ModuleKey` — consumed by `requireModuleAccess("kinerja")` in Task 5's page, and by the Peran/izin admin UI (unaffected, reads `MODULE_KEYS` automatically).

- [ ] **Step 1: Read the full current file first**

Open `src/lib/permissions.ts` in full (it is short, ~41 lines) before editing. Confirm whether a per-module display-label map (e.g. `MODULE_LABEL` or similar, used by a Peran/izin admin editor to show a human-readable name per `ModuleKey`) exists anywhere in this file or in whatever component renders the Peran editor's permission checkboxes (search the repo for `MODULE_KEYS` usages to find it). This plan cannot assume its exact name from a prior summary — verify directly.

- [ ] **Step 2: Add the ModuleKey**

In `src/lib/permissions.ts`, add `"kinerja"` to the `MODULE_KEYS` array:

```typescript
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "pemesanan", "mitra", "pemasaran", "produksi", "laporan", "kinerja"] as const;
```

If Step 1 found a display-label map, add an entry there too (`kinerja: "Kinerja"` or whatever the existing map's shape is) following its exact existing pattern — do not invent a new mechanism if one already exists.

- [ ] **Step 3: Add the sidebar entry**

In `src/components/dashboard/app-sidebar.tsx`, add an icon import from `lucide-react` (use `TrendingUp`, alongside the other icon imports at the top of the file) and append one entry to `NAV_ITEMS` (after the existing `"produksi"`/`"laporan"` entries, matching the exact `{ href, label, icon, moduleKey }` shape used by every other entry — no `exact` field, that's Beranda-only):

```typescript
{ href: "/mkesindo/kinerja", label: "Kinerja", icon: TrendingUp, moduleKey: "kinerja" },
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/components/dashboard/app-sidebar.tsx
git commit -m "feat: add kinerja ModuleKey and sidebar nav entry"
```

---

### Task 3: Mitra ownership & NOO/Existing attribution

**Files:**
- Create: `src/lib/kinerja/marketing-collection-attribution.ts`

**Interfaces:**
- Consumes: `getMarketingWilayahAssignments`, `getMarketingUsers`, `getCrossWilayahProposalOverrides`, `resolveResponsibleMarketing`, `MarketingWilayahAssignment` (all from `src/lib/queries/marketing-wilayah.ts`); `getPool` (`src/lib/db.ts`).
- Produces: `MitraOwnership` type, `resolveAllMitraOwnership(): Promise<MitraOwnership[]>` — consumed by Task 4.

- [ ] **Step 1: Write the attribution module**

```typescript
// src/lib/kinerja/marketing-collection-attribution.ts
//
// Business-rule-specific mitra ownership resolution for the "Marketing
// and Collection" jabatan's "Penjualan" aspek. Every mitra (BusinessPartner)
// is attributed to exactly one owning Marketing akun.id, with a status:
// NOO for exactly the calendar month their Pengajuan was approved, then
// permanently Existing afterward — OR permanently Existing from the start
// if they have no approved Pengajuan at all (legacy mitra).
//
// Deliberately NOT reusing resolveResponsibleMarketing() as the sole
// resolution path: that function's wilayah-based assignment is
// live/retroactive (an assignment change today silently reshapes past
// months' figures in the OLD "Kinerja Marketing" panel — see its own
// design note), which is the opposite of what THIS feature needs for NOO
// credit (permanent, tied to whoever actually submitted the winning
// Pengajuan). It IS reused as the fallback for mitra with no Pengajuan
// trail (legacy mitra), matching this plan's explicit design decision.
import { getPool } from "@/lib/db";
import {
  getMarketingWilayahAssignments,
  getMarketingUsers,
  getCrossWilayahProposalOverrides,
  resolveResponsibleMarketing,
} from "@/lib/queries/marketing-wilayah";

export interface MitraOwnership {
  businessPartnerId: string;
  /** akun.id as a string, matching MarketingUserID's/session.user.id's convention. */
  ownerAkunId: string;
  /** UTC-midnight first-of-month the mitra became NOO, or null if it was never NOO (legacy mitra, permanently Existing). */
  nooMonthStart: Date | null;
}

interface ApprovedPengajuanRow {
  MarketingUserID: string;
  BusinessPartnerID: string;
  ReviewedAt: Date;
}

async function getApprovedPengajuanWithReviewedAt(): Promise<ApprovedPengajuanRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.MarketingUserID, p.ConvertedBusinessPartnerID AS BusinessPartnerID, p.ReviewedAt
    FROM DashboardMitraPengajuan p
    WHERE p.Status = 'Disetujui' AND p.ConvertedBusinessPartnerID IS NOT NULL
  `);
  return result.recordset as ApprovedPengajuanRow[];
}

async function getAllBusinessPartnerBasics(): Promise<
  { BusinessPartnerID: string; Wilayah: string | null; Kecamatan: string | null }[]
> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT bp.BusinessPartnerID,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan
    FROM BusinessPartner bp
  `);
  return result.recordset as { BusinessPartnerID: string; Wilayah: string | null; Kecamatan: string | null }[];
}

function monthBoundaryUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Resolves ownership for every BusinessPartner in the ERP. Call once per
 * page load and reuse the resulting array — this does a handful of
 * MSSQL/Postgres round-trips total, not one per mitra.
 */
export async function resolveAllMitraOwnership(): Promise<MitraOwnership[]> {
  const [approvedPengajuan, allMitra, assignments, marketingUsers] = await Promise.all([
    getApprovedPengajuanWithReviewedAt(),
    getAllBusinessPartnerBasics(),
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
  ]);
  const crossWilayahOverrides = await getCrossWilayahProposalOverrides(assignments);

  // Nama -> akun.id reverse lookup — see Global Constraints for why this
  // is needed (resolveResponsibleMarketing returns a display name).
  const namaToAkunId = new Map(marketingUsers.map((m) => [m.Nama, m.UserID]));

  // Approved Pengajuan keyed by the mitra it produced. If duplicates ever
  // exist (should not, per the app-level claim-then-act approval logic),
  // the first one found wins.
  const pengajuanByMitra = new Map<string, ApprovedPengajuanRow>();
  for (const p of approvedPengajuan) {
    if (!pengajuanByMitra.has(p.BusinessPartnerID)) pengajuanByMitra.set(p.BusinessPartnerID, p);
  }

  const ownerships: MitraOwnership[] = [];
  for (const mitra of allMitra) {
    const pengajuan = pengajuanByMitra.get(mitra.BusinessPartnerID);
    if (pengajuan) {
      ownerships.push({
        businessPartnerId: mitra.BusinessPartnerID,
        ownerAkunId: pengajuan.MarketingUserID,
        nooMonthStart: monthBoundaryUtc(pengajuan.ReviewedAt),
      });
      continue;
    }
    // Legacy mitra, or a mitra whose approving Pengajuan row was later
    // hard-deleted (deletePengajuan does not touch BusinessPartner) —
    // both fall here automatically, no special-casing needed.
    const ownerName = resolveResponsibleMarketing(
      mitra.BusinessPartnerID,
      mitra.Wilayah,
      mitra.Kecamatan,
      assignments,
      crossWilayahOverrides
    );
    const ownerAkunId = ownerName ? namaToAkunId.get(ownerName) : undefined;
    if (!ownerAkunId) continue; // unassigned mitra — excluded, matches existing convention
    ownerships.push({ businessPartnerId: mitra.BusinessPartnerID, ownerAkunId, nooMonthStart: null });
  }
  return ownerships;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify against live data**

Run: `npx tsx -e "import 'dotenv/config'; import { resolveAllMitraOwnership } from './src/lib/kinerja/marketing-collection-attribution'; (async () => { const o = await resolveAllMitraOwnership(); console.log('total mitra beratribusi:', o.length); console.log('contoh NOO:', o.filter(x => x.nooMonthStart !== null).slice(0, 3)); console.log('contoh Existing (legacy):', o.filter(x => x.nooMonthStart === null).slice(0, 3)); process.exit(0); })()"`
Expected: a positive total count, at least a few entries in each of the two example arrays (assuming the ERP has both approved-Pengajuan mitra and legacy mitra, which the earlier investigation confirmed is the case). Manually cross-check 1-2 `businessPartnerId` values from each list against `DashboardMitraPengajuan`/`BusinessPartner` directly to confirm the attribution logic is sound before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/lib/kinerja/marketing-collection-attribution.ts
git commit -m "feat: add mitra ownership/NOO-Existing attribution for Kinerja Penjualan"
```

---

### Task 4: Monthly quantity aggregation, delta/Rupiah calculation, registry

**Files:**
- Create: `src/lib/kinerja/qty-strategy.ts`
- Create: `src/lib/kinerja/marketing-collection-penjualan.ts`
- Create: `src/lib/kinerja/registry.ts`

**Interfaces:**
- Consumes: `resolveAllMitraOwnership`, `MitraOwnership` (Task 3); `getPool` (`src/lib/db.ts`); `monthBoundary`, `getBusinessDate` (`src/lib/business-date.ts`).
- Produces: `applyQtyStrategy(rawQty, strategy): number`; `BulanPenjualan`, `HistoriPenjualanKaryawan` types and `getHistoriPenjualanSemuaKaryawan(): Promise<Map<string, HistoriPenjualanKaryawan>>`; `AspekKinerjaCalculator` type and `getCalculator(jabatanKode, aspekKode): AspekKinerjaCalculator | null` — all consumed by Task 5.

- [ ] **Step 1: Write the QTY strategy layer**

```typescript
// src/lib/kinerja/qty-strategy.ts
//
// "QTY Average" / "QTY non Average" formulas have not been finalized by
// the business yet (per the spec's "Asumsi Belum Terverifikasi"). This
// module exists so that whichever formula is decided later can be dropped
// in here WITHOUT changing the table structure or any query above it.
export type QtyStrategyKey = "non_average" | "average";

// Tahap 1: passthrough for both strategies — raw quantity, unmodified.
export function applyQtyStrategy(rawQty: number, _strategy: QtyStrategyKey): number {
  return rawQty;
}
```

- [ ] **Step 2: Write the aggregation + calculation module**

```typescript
// src/lib/kinerja/marketing-collection-penjualan.ts
import { getPool } from "@/lib/db";
import { resolveAllMitraOwnership, type MitraOwnership } from "@/lib/kinerja/marketing-collection-attribution";
import { applyQtyStrategy } from "@/lib/kinerja/qty-strategy";
import { monthBoundary, getBusinessDate } from "@/lib/business-date";

const RATE_PER_KANTONG = 200;

export interface BulanPenjualan {
  /** ISO date, first of month, e.g. "2026-07-01". */
  bulanMulai: string;
  qtyNooBerjalan: number;
  qtyNooSebelumnya: number;
  deltaNoo: number;
  qtyExistingBerjalan: number;
  qtyExistingSebelumnya: number;
  deltaExisting: number;
  totalQty: number;
  nilaiRupiah: number;
}

export interface HistoriPenjualanKaryawan {
  akunId: string;
  bulanList: BulanPenjualan[];
}

interface QtyPerMitraBulan {
  BusinessPartnerID: string;
  BulanMulai: Date;
  QtyKantong: number;
}

async function getQtyKantongPerMitraPerBulan(): Promise<QtyPerMitraBulan[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT do_.BusinessPartnerID,
           DATEFROMPARTS(YEAR(do_.TransDate), MONTH(do_.TransDate), 1) AS BulanMulai,
           SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END) AS QtyKantong
    FROM DeliveryOrder do_
    JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
    WHERE do_.IsDeleted = 0
    GROUP BY do_.BusinessPartnerID, DATEFROMPARTS(YEAR(do_.TransDate), MONTH(do_.TransDate), 1)
  `);
  return result.recordset as QtyPerMitraBulan[];
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7); // "YYYY-MM"
}

/**
 * Builds the full monthly history table for every akun that owns at least
 * one mitra under this business rule. Call once per page load — all the
 * MSSQL/Postgres work happens inside this one function, not per-employee.
 */
export async function getHistoriPenjualanSemuaKaryawan(): Promise<Map<string, HistoriPenjualanKaryawan>> {
  const [ownerships, qtyPerMitraBulan] = await Promise.all([
    resolveAllMitraOwnership(),
    getQtyKantongPerMitraPerBulan(),
  ]);

  const ownershipByMitra = new Map<string, MitraOwnership>(ownerships.map((o) => [o.businessPartnerId, o]));

  // qtyByKey["akunId|YYYY-MM|noo"] / "...|existing" — built once by walking
  // every (mitra, bulan) qty row and attributing it via the ownership
  // resolved above.
  const qtyByKey = new Map<string, number>();
  const allMonthKeys = new Set<string>();
  // Always include the current business month as a column even if it has
  // zero deliveries so far — the table must reach "today", not stop at
  // the last month with data.
  allMonthKeys.add(monthKey(monthBoundary(getBusinessDate())));

  for (const row of qtyPerMitraBulan) {
    const ownership = ownershipByMitra.get(row.BusinessPartnerID);
    if (!ownership) continue; // unattributed mitra — excluded, matches existing convention
    const rowMonthStart = new Date(Date.UTC(row.BulanMulai.getUTCFullYear(), row.BulanMulai.getUTCMonth(), 1));
    if (ownership.nooMonthStart && rowMonthStart.getTime() < ownership.nooMonthStart.getTime()) continue; // before mitra existed
    const isNooThisMonth =
      ownership.nooMonthStart != null && rowMonthStart.getTime() === ownership.nooMonthStart.getTime();
    const mk = monthKey(rowMonthStart);
    allMonthKeys.add(mk);
    const key = `${ownership.ownerAkunId}|${mk}|${isNooThisMonth ? "noo" : "existing"}`;
    qtyByKey.set(key, (qtyByKey.get(key) ?? 0) + row.QtyKantong);
  }

  const sortedMonthKeys = Array.from(allMonthKeys).sort();
  const akunIds = new Set(ownerships.map((o) => o.ownerAkunId));

  const result = new Map<string, HistoriPenjualanKaryawan>();
  for (const akunId of akunIds) {
    const bulanList: BulanPenjualan[] = [];
    for (let i = 0; i < sortedMonthKeys.length; i++) {
      const mk = sortedMonthKeys[i];
      const prevMk = i > 0 ? sortedMonthKeys[i - 1] : null;
      const rawNoo = qtyByKey.get(`${akunId}|${mk}|noo`) ?? 0;
      const rawExisting = qtyByKey.get(`${akunId}|${mk}|existing`) ?? 0;
      const rawNooPrev = prevMk ? qtyByKey.get(`${akunId}|${prevMk}|noo`) ?? 0 : 0;
      const rawExistingPrev = prevMk ? qtyByKey.get(`${akunId}|${prevMk}|existing`) ?? 0 : 0;

      const qtyNooBerjalan = applyQtyStrategy(rawNoo, "non_average");
      const qtyNooSebelumnya = applyQtyStrategy(rawNooPrev, "non_average");
      const qtyExistingBerjalan = applyQtyStrategy(rawExisting, "average");
      const qtyExistingSebelumnya = applyQtyStrategy(rawExistingPrev, "average");

      const deltaNoo = qtyNooBerjalan - qtyNooSebelumnya;
      const deltaExisting = qtyExistingBerjalan - qtyExistingSebelumnya;
      const totalQty = deltaNoo + deltaExisting;

      bulanList.push({
        bulanMulai: `${mk}-01`,
        qtyNooBerjalan,
        qtyNooSebelumnya,
        deltaNoo,
        qtyExistingBerjalan,
        qtyExistingSebelumnya,
        deltaExisting,
        totalQty,
        nilaiRupiah: totalQty * RATE_PER_KANTONG,
      });
    }
    result.set(akunId, { akunId, bulanList });
  }
  return result;
}
```

- [ ] **Step 3: Write the registry**

```typescript
// src/lib/kinerja/registry.ts
//
// Jabatan/aspek other than Marketing and Collection / Penjualan register
// their own calculator here later — this file is the ONLY place a new
// jabatan's business rule needs to be wired in, nothing else in this
// plan's Task 5 page needs to change.
import { getHistoriPenjualanSemuaKaryawan, type HistoriPenjualanKaryawan } from "@/lib/kinerja/marketing-collection-penjualan";

export interface AspekKinerjaCalculator {
  hitungHistoriSemuaKaryawan(): Promise<Map<string, HistoriPenjualanKaryawan>>;
}

const registry = new Map<string, AspekKinerjaCalculator>();
registry.set("marketing_collection:penjualan", {
  hitungHistoriSemuaKaryawan: getHistoriPenjualanSemuaKaryawan,
});

export function getCalculator(jabatanKode: string, aspekKode: string): AspekKinerjaCalculator | null {
  return registry.get(`${jabatanKode}:${aspekKode}`) ?? null;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify against live data**

Run: `npx tsx -e "import 'dotenv/config'; import { getHistoriPenjualanSemuaKaryawan } from './src/lib/kinerja/marketing-collection-penjualan'; (async () => { const h = await getHistoriPenjualanSemuaKaryawan(); const [id, histori] = [...h.entries()][0]; console.log('akunId contoh:', id); console.log(JSON.stringify(histori.bulanList, null, 2)); process.exit(0); })()"`
Expected: prints one employee's full monthly history array with plausible `qtyNooBerjalan`/`qtyExistingBerjalan`/`deltaNoo`/`deltaExisting`/`totalQty`/`nilaiRupiah` numbers (no `NaN`, no `undefined`). Manually verify one month's `nilaiRupiah` equals `totalQty * 200` by hand, and that `deltaNoo`/`deltaExisting` match `qty...Berjalan - qty...Sebelumnya` exactly.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kinerja/qty-strategy.ts src/lib/kinerja/marketing-collection-penjualan.ts src/lib/kinerja/registry.ts
git commit -m "feat: add monthly delta/Rupiah calculation and jabatan/aspek registry for Kinerja Penjualan"
```

---

### Task 5: `/mkesindo/kinerja` page + monthly history table

**Files:**
- Create: `src/app/mkesindo/(dashboard)/kinerja/page.tsx`
- Create: `src/components/dashboard/kinerja-penjualan-table.tsx`

**Interfaces:**
- Consumes: `requireModuleAccess` (`src/lib/require-access.ts`); `getJabatanByPeranId`, `getAspekKinerjaList` (Task 1); `getCalculator` (Task 4); `listAkun` (`src/lib/queries/akun.ts`); `MARKETING_ROLE_ID` (`src/lib/roles.ts`); `BulanPenjualan` type (Task 4).
- Produces: the `/mkesindo/kinerja` route; `KinerjaPenjualanTable` component, `KaryawanPenjualan` type — consumed by Task 6.

- [ ] **Step 1: Write the page**

```tsx
// src/app/mkesindo/(dashboard)/kinerja/page.tsx
import type { Metadata } from "next";
import { requireModuleAccess } from "@/lib/require-access";
import { getJabatanByPeranId, getAspekKinerjaList } from "@/lib/queries/kinerja-jabatan";
import { getCalculator } from "@/lib/kinerja/registry";
import { listAkun } from "@/lib/queries/akun";
import { MARKETING_ROLE_ID } from "@/lib/roles";
import { KinerjaPenjualanTable } from "@/components/dashboard/kinerja-penjualan-table";

export const metadata: Metadata = { title: "Kinerja" };

export default async function KinerjaPage() {
  const session = await requireModuleAccess("kinerja");

  const jabatan = await getJabatanByPeranId(MARKETING_ROLE_ID);
  if (!jabatan) {
    return <p className="text-sm text-muted-foreground">Jabatan Marketing and Collection belum dikonfigurasi.</p>;
  }
  const aspekList = await getAspekKinerjaList(jabatan.id);
  const aspekPenjualan = aspekList.find((a) => a.kode === "penjualan");
  if (!aspekPenjualan) {
    return <p className="text-sm text-muted-foreground">Aspek Penjualan belum dikonfigurasi untuk jabatan ini.</p>;
  }

  const calculator = getCalculator(jabatan.kode, aspekPenjualan.kode);
  if (!calculator) {
    return <p className="text-sm text-muted-foreground">Business rule untuk aspek ini belum tersedia.</p>;
  }

  const [historiByAkunId, allAkun] = await Promise.all([calculator.hitungHistoriSemuaKaryawan(), listAkun()]);

  const isPlainMarketing = !session.user.isSuperAdmin && session.user.roleId === MARKETING_ROLE_ID;
  // listAkun() does not filter by is_active — a deactivated Marketing
  // employee's historical row still appears here, per the spec's edge
  // case 2 (kredit NOO tetap melekat walau akun dinonaktifkan).
  const marketingAkunList = allAkun.filter((a) => a.peranId === MARKETING_ROLE_ID);
  const visibleAkunList = isPlainMarketing
    ? marketingAkunList.filter((a) => String(a.id) === session.user.id)
    : marketingAkunList;

  const karyawanList = visibleAkunList.map((akun) => ({
    akunId: String(akun.id),
    nama: akun.nama,
    histori: historiByAkunId.get(String(akun.id)) ?? { akunId: String(akun.id), bulanList: [] },
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Kinerja Karyawan</h1>
      <p className="text-sm text-muted-foreground">
        {jabatan.nama} — Aspek {aspekPenjualan.nama}, dihitung dari jumlah {aspekPenjualan.satuan}.
      </p>
      <KinerjaPenjualanTable
        jabatanNama={jabatan.nama}
        aspekNama={aspekPenjualan.nama}
        satuan={aspekPenjualan.satuan}
        karyawanList={karyawanList}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the table component**

```tsx
// src/components/dashboard/kinerja-penjualan-table.tsx
"use client";

import { useState } from "react";
import type { BulanPenjualan } from "@/lib/kinerja/marketing-collection-penjualan";

export interface KaryawanPenjualan {
  akunId: string;
  nama: string;
  histori: { akunId: string; bulanList: BulanPenjualan[] };
}

function formatBulan(bulanMulai: string): string {
  const d = new Date(bulanMulai + "T00:00:00Z");
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatSigned(n: number): string {
  if (n > 0) return `+${n.toLocaleString("id-ID")}`;
  if (n < 0) return n.toLocaleString("id-ID");
  return "0";
}

function formatRupiah(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}Rp${Math.abs(n).toLocaleString("id-ID")}`;
}

export function KinerjaPenjualanTable({
  jabatanNama,
  aspekNama,
  satuan,
  karyawanList,
}: {
  jabatanNama: string;
  aspekNama: string;
  satuan: string;
  karyawanList: KaryawanPenjualan[];
}) {
  const [selectedAkunId, setSelectedAkunId] = useState<string | null>(karyawanList[0]?.akunId ?? null);
  const [detailBulan, setDetailBulan] = useState<BulanPenjualan | null>(null);

  const selected = karyawanList.find((k) => k.akunId === selectedAkunId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {karyawanList.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {karyawanList.map((k) => (
            <button
              key={k.akunId}
              onClick={() => {
                setSelectedAkunId(k.akunId);
                setDetailBulan(null);
              }}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                k.akunId === selectedAkunId ? "border-primary bg-primary/10 font-medium" : "border-border"
              }`}
            >
              {k.nama}
            </button>
          ))}
        </div>
      )}

      {!selected || selected.histori.bulanList.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Belum ada data {aspekNama.toLowerCase()}.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="p-2 text-left font-medium">
                    {jabatanNama} — {aspekNama} ({satuan})
                  </th>
                  {selected.histori.bulanList.map((b) => (
                    <th key={b.bulanMulai} className="p-2 text-right font-medium">
                      {formatBulan(b.bulanMulai)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="p-2 font-medium">
                    NOO
                    <div className="text-xs font-normal text-muted-foreground">Selisih dari bulan lalu</div>
                  </td>
                  {selected.histori.bulanList.map((b) => (
                    <td
                      key={b.bulanMulai}
                      className="cursor-pointer p-2 text-right hover:bg-muted/40"
                      onClick={() => setDetailBulan(b)}
                    >
                      {formatSigned(b.deltaNoo)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="p-2 font-medium">
                    Existing
                    <div className="text-xs font-normal text-muted-foreground">Selisih dari bulan lalu</div>
                  </td>
                  {selected.histori.bulanList.map((b) => (
                    <td
                      key={b.bulanMulai}
                      className="cursor-pointer p-2 text-right hover:bg-muted/40"
                      onClick={() => setDetailBulan(b)}
                    >
                      {formatSigned(b.deltaExisting)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2 font-medium">Total</td>
                  {selected.histori.bulanList.map((b) => (
                    <td
                      key={b.bulanMulai}
                      className="cursor-pointer p-2 text-right hover:bg-muted/40"
                      onClick={() => setDetailBulan(b)}
                    >
                      <div>
                        {formatSigned(b.totalQty)} {satuan}
                      </div>
                      <div className="text-xs text-muted-foreground">{formatRupiah(b.nilaiRupiah)}</div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {detailBulan && (
            <div className="rounded-xl border p-4 text-sm">
              <p className="mb-2 font-medium">Rincian Perhitungan — {formatBulan(detailBulan.bulanMulai)}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="font-medium">NOO</p>
                  <p>QTY sebelumnya: {detailBulan.qtyNooSebelumnya.toLocaleString("id-ID")} {satuan}</p>
                  <p>QTY berjalan: {detailBulan.qtyNooBerjalan.toLocaleString("id-ID")} {satuan}</p>
                  <p>Selisih: {formatSigned(detailBulan.deltaNoo)} {satuan}</p>
                </div>
                <div>
                  <p className="font-medium">Existing</p>
                  <p>QTY sebelumnya: {detailBulan.qtyExistingSebelumnya.toLocaleString("id-ID")} {satuan}</p>
                  <p>QTY berjalan: {detailBulan.qtyExistingBerjalan.toLocaleString("id-ID")} {satuan}</p>
                  <p>Selisih: {formatSigned(detailBulan.deltaExisting)} {satuan}</p>
                </div>
              </div>
              <div className="mt-3 border-t pt-2">
                <p className="font-medium">
                  Total: {formatSigned(detailBulan.totalQty)} {satuan}
                </p>
                <p className="font-medium">
                  Nilai: {detailBulan.totalQty.toLocaleString("id-ID")} × Rp200 = {formatRupiah(detailBulan.nilaiRupiah)}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds, with `/mkesindo/kinerja` listed among the generated routes.

- [ ] **Step 5: Manual verification (this task is UI-observable — verify in the browser per this project's standing convention)**

Start the dev server, log in as a superadmin/Direktur account, navigate to `/mkesindo/kinerja`. Confirm: page loads, at least one employee button appears (if more than one Marketing exists), the table shows dynamic month columns ending at the current business month, clicking a cell opens the "Rincian Perhitungan" panel below the table with matching numbers. If the sandboxed environment lacks an authenticated session or live DB network access, this is an accepted, already-established limitation for this repo's agent environment — fall back to the Step 3/4 checks and report clearly what could and couldn't be verified.

- [ ] **Step 6: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/kinerja/page.tsx" src/components/dashboard/kinerja-penjualan-table.tsx
git commit -m "feat: add /mkesindo/kinerja page with monthly NOO/Existing/Total table"
```

---

### Task 6: Upgrade audit drill-down to a Dialog

**Files:**
- Create: `src/components/dashboard/kinerja-penjualan-detail-dialog.tsx`
- Modify: `src/components/dashboard/kinerja-penjualan-table.tsx`

**Interfaces:**
- Consumes: `BulanPenjualan` type (Task 4); `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle` (`src/components/ui/dialog.tsx`, already used by other modules e.g. Inventaris).
- Produces: `KinerjaPenjualanDetailDialog` component — used only within this table, not consumed elsewhere.

This task replaces Task 5's always-visible inline detail panel with a proper modal, consistent with the rest of the app's UI conventions (Inventaris uses `Dialog` for equivalent detail/form surfaces) — a pure UI/UX refinement, no new data logic.

- [ ] **Step 1: Write the dialog component**

```tsx
// src/components/dashboard/kinerja-penjualan-detail-dialog.tsx
"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BulanPenjualan } from "@/lib/kinerja/marketing-collection-penjualan";

function formatBulan(bulanMulai: string): string {
  const d = new Date(bulanMulai + "T00:00:00Z");
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatSigned(n: number): string {
  if (n > 0) return `+${n.toLocaleString("id-ID")}`;
  if (n < 0) return n.toLocaleString("id-ID");
  return "0";
}

function formatRupiah(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}Rp${Math.abs(n).toLocaleString("id-ID")}`;
}

export function KinerjaPenjualanDetailDialog({
  bulan,
  satuan,
  onOpenChange,
}: {
  bulan: BulanPenjualan | null;
  satuan: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={bulan !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rincian Perhitungan{bulan ? ` — ${formatBulan(bulan.bulanMulai)}` : ""}</DialogTitle>
        </DialogHeader>
        {bulan && (
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-medium">NOO</p>
              <p>
                QTY sebelumnya: {bulan.qtyNooSebelumnya.toLocaleString("id-ID")} {satuan}
              </p>
              <p>
                QTY berjalan: {bulan.qtyNooBerjalan.toLocaleString("id-ID")} {satuan}
              </p>
              <p>
                Selisih: {formatSigned(bulan.deltaNoo)} {satuan}
              </p>
            </div>
            <div>
              <p className="font-medium">Existing</p>
              <p>
                QTY sebelumnya: {bulan.qtyExistingSebelumnya.toLocaleString("id-ID")} {satuan}
              </p>
              <p>
                QTY berjalan: {bulan.qtyExistingBerjalan.toLocaleString("id-ID")} {satuan}
              </p>
              <p>
                Selisih: {formatSigned(bulan.deltaExisting)} {satuan}
              </p>
            </div>
            <div className="border-t pt-2">
              <p className="font-medium">
                Total: {formatSigned(bulan.totalQty)} {satuan}
              </p>
              <p className="font-medium">
                Nilai: {bulan.totalQty.toLocaleString("id-ID")} × Rp200 = {formatRupiah(bulan.nilaiRupiah)}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire it into the table, replacing the inline panel**

In `src/components/dashboard/kinerja-penjualan-table.tsx`:
- Add the import: `import { KinerjaPenjualanDetailDialog } from "@/components/dashboard/kinerja-penjualan-detail-dialog";`
- Delete the entire `{detailBulan && (...)}` inline block added in Task 5 Step 2 (the `<div className="rounded-xl border p-4 text-sm">...</div>` panel).
- In its place, right after the closing `</div>` of the table's `overflow-x-auto` wrapper (still inside the `<>...</>` fragment), add:

```tsx
<KinerjaPenjualanDetailDialog
  bulan={detailBulan}
  satuan={satuan}
  onOpenChange={(open) => {
    if (!open) setDetailBulan(null);
  }}
/>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

In the browser (same accepted limitation as Task 5 if the sandbox has no session/DB access): confirm clicking a cell now opens a modal dialog (not an inline panel) with identical numbers to what Task 5's inline panel showed, and that closing the dialog (X button, clicking outside, or Escape) clears `detailBulan` cleanly with no leftover state.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/kinerja-penjualan-detail-dialog.tsx src/components/dashboard/kinerja-penjualan-table.tsx
git commit -m "feat: upgrade Kinerja Penjualan audit drill-down to a Dialog"
```

---

## Self-Review Notes (spec coverage)

- Struktur Jabatan → Aspek Kinerja → Business Rule, extensible untuk jabatan lain tanpa mengganggu Marketing and Collection: Task 1 (metadata tables) + Task 4 (registry pattern).
- Atribusi mitra NOO (permanen, via Pengajuan) vs Existing (fallback wilayah untuk mitra lama): Task 3.
- Perhitungan delta kohort-vs-kohort (NOO) dan kohort-vs-dirinya-sendiri (Existing), Total, konversi Rp200/kantong, tanda +/0/-: Task 4.
- Layer konfigurasi QTY Average/non Average tanpa formula final: Task 4 (`qty-strategy.ts`).
- Kolom bulan dinamis sampai bulan berjalan (termasuk bulan tanpa transaksi): Task 4 (`allMonthKeys` selalu menyertakan bulan bisnis saat ini) + Task 5 (render kolom dari `bulanList`).
- Satuan eksplisit "Kantong Es Terjual", tidak pernah "poin": Task 5/6 (label diambil dari `aspekPenjualan.satuan`, dirender apa adanya).
- Audit trail per bulan (QTY sebelumnya/berjalan/selisih/Total/Rupiah): Task 5 (panel inline) lalu Task 6 (dialog).
- Kontrol akses per-PT lewat sistem Peran/izin yang sudah ada, Marketing hanya lihat baris sendiri: Task 2 (ModuleKey) + Task 5 (page-level filtering).
- Tidak mengubah modul Kinerja Marketing yang sudah ada: dinyatakan eksplisit di Global Constraints, tidak ada task yang menyentuh file-file itu.
- Edge case (Pengajuan dihapus, akun dinonaktifkan, bulan kosong, status Pengajuan bukan Disetujui): ditangani di Task 3 (fallback otomatis, tidak butuh SELECT khusus WHERE Status='Disetujui' saja) dan Task 5 (`listAkun()` tidak memfilter `is_active`).
