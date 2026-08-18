# Kinerja Marketing: Existing/NOO/Total Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Kinerja Marketing's single target/capaian figure into three categories — Existing, NOO (New Open Outlet), Total — shown in three anatomies (jumlah outlet, %, Bag Qty) on both `/mkesindo/pemasaran` (desktop) and `/mkesindo/pemasaran-app` (mobile), plus two new monthly trend tables ("Matriks Performa Marketing" and "Pangsa Pasar & Kontribusi Internal"), and extend `PartnerType` from 2 to 3 tiers (Agen/RPA/Outlet).

**Architecture:** `JoinDate` (already on `BusinessPartner`, immutable historical fact) splits any mitra roster into Existing/NOO for any month with no new storage. A new lazily-populated `DashboardMitraCapacitySnapshot` table locks in each month's Target-Existing base (Σ Capacity) the first time that month is queried. Target NOO is a single shared, always-recomputed figure derived from fleet spare capacity (`DashboardArmada.KapasitasMaks` minus each armada's trailing-30-day average load), never stored. `PartnerType` grows a third tier (RPA) via a new `Gender = 'Other'` sentinel, threshold-derived only at Pengajuan-approval time exactly as today's 2-tier split already works. Two new trend-query modules bucket by calendar month (reusing `monthBoundary()`/`resolveResponsibleMarketing()`) and feed both platforms; the existing current-period query (`getMarketingPerformance()`) only gains a `JoinDate` field so its "Mitra Prioritas"/"Seluruh Mitra" rosters can be split into Existing/NOO sub-sections in the UI.

**Tech Stack:** Next.js Server Components/Actions, MSSQL (`mssql` package, `getPool()`/`sql`), Postgres (`akun`/`peran`, read-only here), React client components, Tailwind.

**Spec:** [docs/superpowers/specs/2026-08-18-kinerja-marketing-existing-noo-design.md](../specs/2026-08-18-kinerja-marketing-existing-noo-design.md)

## Global Constraints

- Gender sentinel for the new RPA tier is the literal string `"Other"` (existing values stay `"Male"` = Agen, `"Female"` = Outlet/ex-Retail). `Gender` columns/params are already untyped `VARCHAR`/`string | null` — no schema or type-union change needed to add this value.
- Qty thresholds (`mitra-pengajuan.ts`, `approvePengajuan()` only): qty ≤ 10 → Outlet, 10 < qty ≤ 100 → Agen, qty > 100 → RPA. No other call site derives Gender from qty.
- No migration of existing mitra — `PartnerType`/`Gender` on rows created before this feature stays exactly as-is until manually edited or re-approved.
- Every "Retail" label/literal in UI becomes "Outlet" (label only — the underlying `Gender = "Female"` value is unchanged). `TakeAway` and `Lainnya` are untouched.
- Month bucketing everywhere in this feature uses the app-wide 14:00 WIB rollover (`getBusinessDate()` + `monthBoundary()` from `business-date.ts`) — NOT the Kinerja-Marketing-specific 13:00 rollover (`KINERJA_MARKETING_ROLLOVER_HOUR`), which only governs the existing daily DailyQty grid's visible range and is untouched by this feature.
- `Total` is always `Existing + NOO`, computed by simple addition after both are computed — never re-derived independently from a combined roster.
- Target NOO is one shared figure (fleet-wide), added identically to every marketing's `NOO.bagQtyTarget` and to the combined `NOO.bagQtyTarget` — never divided per marketing, never per-Wilayah.
- Capacity snapshot rows, once written for a given `MonthStart`, are never overwritten (idempotent lazy-capture, first query of a new month locks it in; months before this feature's launch fall back to today's live Capacity applied retroactively — an explicit approximation, not a bug).
- Mobile (`pemasaran-app`) never shows the combined/company-wide view — only the logged-in marketing's own rows, matching the existing cross-marketing data isolation rule used throughout this app.
- No test runner in this project. Verification is `npx tsc --noEmit`, `npx eslint`, and live browser checks (see Task 17).

---

### Task 1: `PartnerType` type — add RPA, rename Retail to Outlet

**Files:**
- Modify: `src/types/dashboard.ts:7`

**Interfaces:**
- Produces: `PartnerType = "Agen" | "Outlet" | "RPA" | "TakeAway" | "Lainnya"` — consumed by Tasks 2, 4, 5, 11.

- [ ] **Step 1: Update the type**

```ts
export type PartnerType = "Agen" | "Outlet" | "RPA" | "TakeAway" | "Lainnya";
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: new errors appear at every place that still compares/renders the literal `"Retail"` against `PartnerType` — these are exactly the call sites Tasks 2 and 4 fix next. Note them, don't fix here.

- [ ] **Step 3: Commit**

```bash
git add src/types/dashboard.ts
git commit -m "feat: add RPA partner type, rename Retail to Outlet"
```

---

### Task 2: `PARTNER_TYPE_CASE` — add RPA branch, rename Retail to Outlet

**Files:**
- Modify: `src/lib/queries/aging.ts:30-45`

**Interfaces:**
- Consumes: `PartnerType` (Task 1).
- Produces: `PARTNER_TYPE_CASE` SQL fragment now emitting `'RPA'`/`'Outlet'` — consumed unchanged by every existing importer (collection-priority.ts, mitra.ts, mitra-do.ts, piutang-payments.ts, sales-cards.ts) and by Tasks 5 and 11.

- [ ] **Step 1: Update the CASE expression and its comment**

```ts
// BusinessPartner field mappings verified against the previous "Dashboard PMP
// Ponorogo" build (ERP has no dedicated columns for these, so legacy fields
// are repurposed):
//   Wilayah    <- NPWPName
//   Kecamatan  <- NPWPAddress
//   Kontak     <- MobileNo
//   TakeAway   <- SalesmanID = '0127'
//   Gender = Female -> Outlet, Gender = Male -> Agen, Gender = Other -> RPA
export const PARTNER_TYPE_CASE = `
  CASE
    WHEN bp.SalesmanID = '0127' THEN 'TakeAway'
    WHEN bp.Gender = 'Other' THEN 'RPA'
    WHEN bp.Gender = 'Female' THEN 'Outlet'
    WHEN bp.Gender = 'Male' THEN 'Agen'
    ELSE 'Lainnya'
  END
`;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: fewer errors than after Task 1 — every consumer of `PARTNER_TYPE_CASE`'s SQL output already renders `PartnerType` dynamically (no hardcoded "Retail" comparisons in those query files per the earlier grep), so this step should introduce no new errors here.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/aging.ts
git commit -m "feat: add RPA branch and Outlet rename to PARTNER_TYPE_CASE"
```

---

### Task 3: Qty thresholds — 3-tier Agen/RPA/Outlet in `approvePengajuan()`

**Files:**
- Modify: `src/lib/queries/mitra-pengajuan.ts:11-14,238`

**Interfaces:**
- Produces: `AGEN_QTY_THRESHOLD = 10`, `RPA_QTY_THRESHOLD = 100` (both local, unexported) — no other task depends on these being exported.

- [ ] **Step 1: Replace the single threshold with two, update the comment**

```ts
// qty <= 10 -> Outlet (Gender "Female"), 10 < qty <= 100 -> Agen (Gender
// "Male"), qty > 100 -> RPA (Gender "Other") — see PARTNER_TYPE_CASE in
// aging.ts for the Gender->PartnerType mapping this feeds into.
const AGEN_QTY_THRESHOLD = 10;
const RPA_QTY_THRESHOLD = 100;
```

- [ ] **Step 2: Update the `gender` derivation inside `approvePengajuan()`**

Replace:

```ts
      gender: row.QtyKantong != null && row.QtyKantong > AGEN_QTY_THRESHOLD ? "Male" : "Female",
```

with:

```ts
      gender:
        row.QtyKantong != null && row.QtyKantong > RPA_QTY_THRESHOLD
          ? "Other"
          : row.QtyKantong != null && row.QtyKantong > AGEN_QTY_THRESHOLD
            ? "Male"
            : "Female",
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors — `MitraInput.gender` is `string | null`, no type change needed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/mitra-pengajuan.ts
git commit -m "feat: 3-tier Agen/RPA/Outlet qty threshold at Pengajuan approval"
```

---

### Task 4: Rename "Retail" label to "Outlet" across Mitra/Aging UI

**Files:**
- Modify: `src/components/dashboard/mitra-list.tsx:239,243,327`
- Modify: `src/components/dashboard/aging-table.tsx:349` (and add an `RPA` filter option alongside it)

**Interfaces:**
- Consumes: `PartnerType` (Task 1).

- [ ] **Step 1: `mitra-list.tsx` — rename the manual Gender select's Outlet label**

The existing 2-option "Tipe Mitra" select (Agen/Retail, backed by `Gender` Male/Female) stays 2-option — RPA is qty-derived automatically at Pengajuan approval (Task 3), not manually settable here, matching the spec's explicit "tidak ada field 'Jenis Usaha' manual" decision. Only the label changes:

```tsx
                <SelectValue>{(v: string) => (v === "Female" ? "Outlet" : "Agen")}</SelectValue>
```
```tsx
                <SelectItem value="Female">Outlet</SelectItem>
```

- [ ] **Step 2: `mitra-list.tsx` — add RPA to the `PARTNER_TYPES` filter array**

```ts
const PARTNER_TYPES = ["Agen", "Outlet", "RPA", "TakeAway", "Lainnya"] as const;
```

This array is `.map()`'d directly into `<SelectItem>`s at line ~514 (`{PARTNER_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}`) — no other change needed there, the new "RPA" and renamed "Outlet" options appear automatically.

- [ ] **Step 3: `aging-table.tsx` — rename Retail, add RPA to the hardcoded filter list**

```tsx
            <SelectItem value="Agen">Agen</SelectItem>
            <SelectItem value="Outlet">Outlet</SelectItem>
            <SelectItem value="RPA">RPA</SelectItem>
            <SelectItem value="TakeAway">TakeAway</SelectItem>
            <SelectItem value="Lainnya">Lainnya</SelectItem>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors remaining from Task 1's `PartnerType` rename.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/mitra-list.tsx src/components/dashboard/aging-table.tsx
git commit -m "feat: rename Retail to Outlet and add RPA filter option in Mitra/Aging UI"
```

---

### Task 5: Unify Mitra Growth panel with the shared `PARTNER_TYPE_CASE`

**Files:**
- Modify: `src/lib/queries/mitra-growth.ts` (entire file)
- Modify: `src/components/dashboard/mitra-growth-panel.tsx` (entire file)

**Interfaces:**
- Consumes: `PARTNER_TYPE_CASE`, `PartnerType` (Tasks 1, 2).
- Produces: `MitraGrowthRow` with an `outlet` field replacing `retail` — no other file in the codebase imports `MitraGrowthRow`/`MitraGrowthCell` besides these two files (confirmed by the pre-plan research grep).

- [ ] **Step 1: Rewrite `mitra-growth.ts` to use the shared CASE/type**

```ts
import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import type { PartnerType } from "@/types/dashboard";

export interface MitraGrowthCell {
  total: number;
  newThisMonth: number;
  newLastMonth: number;
}

export interface MitraGrowthRow {
  wilayah: string;
  agen: MitraGrowthCell;
  outlet: MitraGrowthCell;
  takeaway: MitraGrowthCell;
  rpa: MitraGrowthCell;
  total: MitraGrowthCell;
}

const EMPTY_CELL: MitraGrowthCell = { total: 0, newThisMonth: 0, newLastMonth: 0 };

function addCell(a: MitraGrowthCell, b: MitraGrowthCell): MitraGrowthCell {
  return {
    total: a.total + b.total,
    newThisMonth: a.newThisMonth + b.newThisMonth,
    newLastMonth: a.newLastMonth + b.newLastMonth,
  };
}

interface RawRow {
  Wilayah: string;
  PartnerType: PartnerType;
  Total: number;
  NewThisMonth: number;
  NewLastMonth: number;
}

// "Bulan ini" / "bulan lalu" here mean newly-joined mitra (JoinDate within
// that month) — mitra growth/acquisition, not a running cumulative total.
// `total` per cell IS the cumulative count (as of today), shown alongside
// the new-this-month/new-last-month pair so both readings are visible at
// once, per explicit request.
//
// Classification now reuses the app-wide PARTNER_TYPE_CASE (qty-based RPA
// threshold at Pengajuan approval, see mitra-pengajuan.ts) instead of a
// locally-defined name-prefix RPA rule — unified per explicit product
// decision (see spec §1). "Lainnya" mitra (blank Gender, not TakeAway) are
// excluded from this table, matching the 4 types this panel has always
// shown.
export async function getMitraGrowthByWilayah(): Promise<MitraGrowthRow[]> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const thisMonthStart = monthBoundary(businessToday);
  const lastMonthStart = monthBoundary(businessToday, -1);

  const result = await pool
    .request()
    .input("thisMonthStart", sql.Date, thisMonthStart)
    .input("lastMonthStart", sql.Date, lastMonthStart)
    .query(`
      SELECT
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          ${PARTNER_TYPE_CASE} AS PartnerType,
          COUNT(*) AS Total,
          SUM(CASE WHEN bp.JoinDate >= @thisMonthStart THEN 1 ELSE 0 END) AS NewThisMonth,
          SUM(CASE WHEN bp.JoinDate >= @lastMonthStart AND bp.JoinDate < @thisMonthStart THEN 1 ELSE 0 END) AS NewLastMonth
      FROM BusinessPartner bp
      WHERE ISNULL(bp.IsDeleted, 0) = 0
      GROUP BY
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui'),
          ${PARTNER_TYPE_CASE}
    `);

  const rows = (result.recordset as RawRow[]).filter((r) => r.PartnerType !== "Lainnya");

  const byWilayah = new Map<string, MitraGrowthRow>();
  for (const r of rows) {
    let entry = byWilayah.get(r.Wilayah);
    if (!entry) {
      entry = {
        wilayah: r.Wilayah,
        agen: EMPTY_CELL,
        outlet: EMPTY_CELL,
        takeaway: EMPTY_CELL,
        rpa: EMPTY_CELL,
        total: EMPTY_CELL,
      };
      byWilayah.set(r.Wilayah, entry);
    }
    const cell: MitraGrowthCell = { total: r.Total, newThisMonth: r.NewThisMonth, newLastMonth: r.NewLastMonth };
    if (r.PartnerType === "Agen") entry.agen = cell;
    else if (r.PartnerType === "Outlet") entry.outlet = cell;
    else if (r.PartnerType === "TakeAway") entry.takeaway = cell;
    else entry.rpa = cell;
    entry.total = addCell(entry.total, cell);
  }

  return [...byWilayah.values()].sort((a, b) => a.wilayah.localeCompare(b.wilayah));
}
```

- [ ] **Step 2: Update `mitra-growth-panel.tsx`**

Rename every `retail` reference to `outlet` and the "Retail" header to "Outlet":

```tsx
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { MitraGrowthRow, MitraGrowthCell } from "@/lib/queries/mitra-growth";

const EMPTY_CELL: MitraGrowthCell = { total: 0, newThisMonth: 0, newLastMonth: 0 };

function addCell(a: MitraGrowthCell, b: MitraGrowthCell): MitraGrowthCell {
  return {
    total: a.total + b.total,
    newThisMonth: a.newThisMonth + b.newThisMonth,
    newLastMonth: a.newLastMonth + b.newLastMonth,
  };
}

function GrowthCell({ cell, bold }: { cell: MitraGrowthCell; bold?: boolean }) {
  const delta = cell.newThisMonth - cell.newLastMonth;
  return (
    <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
      <span
        className={cn(
          "inline-flex min-w-9 items-center justify-center rounded-md border bg-secondary/50 px-2 py-0.5 tabular-nums",
          bold ? "font-semibold" : "text-foreground"
        )}
      >
        {cell.total}
      </span>
      <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
        {delta > 0 && <ArrowUp className="size-3 shrink-0 text-primary" />}
        {delta < 0 && <ArrowDown className="size-3 shrink-0 text-destructive" />}
        {delta === 0 && <Minus className="size-3 shrink-0 text-muted-foreground/40" />}
        <span>
          +{cell.newThisMonth} <span className="opacity-60">(lalu +{cell.newLastMonth})</span>
        </span>
      </span>
    </div>
  );
}

function GrowthHalfTable({ rows }: { rows: MitraGrowthRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Wilayah</TableHead>
          <TableHead className="text-right">Agen</TableHead>
          <TableHead className="text-right">Outlet</TableHead>
          <TableHead className="text-right">TakeAway</TableHead>
          <TableHead className="text-right">RPA</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.wilayah}>
            <TableCell className="font-medium">{r.wilayah}</TableCell>
            <TableCell>
              <GrowthCell cell={r.agen} />
            </TableCell>
            <TableCell>
              <GrowthCell cell={r.outlet} />
            </TableCell>
            <TableCell>
              <GrowthCell cell={r.takeaway} />
            </TableCell>
            <TableCell>
              <GrowthCell cell={r.rpa} />
            </TableCell>
            <TableCell>
              <GrowthCell cell={r.total} bold />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MitraGrowthTable({ rows }: { rows: MitraGrowthRow[] }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Belum ada data mitra.</p>;
  }

  const grandTotal = rows.reduce(
    (acc, r) => ({
      agen: addCell(acc.agen, r.agen),
      outlet: addCell(acc.outlet, r.outlet),
      takeaway: addCell(acc.takeaway, r.takeaway),
      rpa: addCell(acc.rpa, r.rpa),
      total: addCell(acc.total, r.total),
    }),
    { agen: EMPTY_CELL, outlet: EMPTY_CELL, takeaway: EMPTY_CELL, rpa: EMPTY_CELL, total: EMPTY_CELL }
  );

  const mid = Math.ceil(rows.length / 2);
  const left = rows.slice(0, mid);
  const right = rows.slice(mid);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 lg:grid-cols-2">
        <GrowthHalfTable rows={left} />
        {right.length > 0 && <GrowthHalfTable rows={right} />}
      </div>

      <Table>
        <TableBody>
          <TableRow className="bg-muted/50">
            <TableCell className="font-semibold">Total Keseluruhan</TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.agen} bold />
            </TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.outlet} bold />
            </TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.takeaway} bold />
            </TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.rpa} bold />
            </TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.total} bold />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/mitra-growth.ts src/components/dashboard/mitra-growth-panel.tsx
git commit -m "feat: unify Mitra Growth RPA classification with shared PARTNER_TYPE_CASE"
```

---

### Task 6: DB migration — `DashboardMitraCapacitySnapshot` table (controller-run)

**Files:**
- None (direct DDL execution, no repo files).

**Interfaces:**
- Produces: `DashboardMitraCapacitySnapshot(SnapshotID, MonthStart, BusinessPartnerID, Capacity, CreatedDate)` — consumed by Task 7.

- [ ] **Step 1: Run the DDL**

Execute via the `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_ddl` tool (controller-run, not delegated):

```sql
CREATE TABLE DashboardMitraCapacitySnapshot (
  SnapshotID INT IDENTITY(1,1) PRIMARY KEY,
  MonthStart DATE NOT NULL,
  BusinessPartnerID VARCHAR(16) NOT NULL,
  Capacity DECIMAL(23,4) NULL,
  CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
);
```

No FK, no explicit index — matches every existing custom `Dashboard*` table's convention in this codebase.

- [ ] **Step 2: Verify the table exists with the right shape**

Execute via `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_get_table_info` (or `sql_execute_dql` with `SELECT TOP 1 * FROM DashboardMitraCapacitySnapshot`).
Expected: all 5 columns present, no error.

---

### Task 7: `mitra-capacity-snapshot.ts` — lazy monthly snapshot query module

**Files:**
- Create: `src/lib/queries/mitra-capacity-snapshot.ts`

**Interfaces:**
- Consumes: `DashboardMitraCapacitySnapshot` (Task 6).
- Produces: `getMonthlyCapacitySnapshot(monthStart: Date): Promise<Map<string, number | null>>` — consumed by Task 10.

- [ ] **Step 1: Write the module**

```ts
import { getPool, sql } from "@/lib/db";

interface CapacitySnapshotRow {
  BusinessPartnerID: string;
  Capacity: number | null;
}

// Lazy snapshot: returns Capacity per BusinessPartnerID as of `monthStart`
// (the 1st of some calendar month, a Date from monthBoundary()). If no
// snapshot row exists yet for that month, one is captured right now from
// LIVE BusinessPartner.Capacity and persisted — the first call for a given
// month locks that month's numbers in; every later call (this month or a
// future one revisiting it) reads the stored snapshot instead of touching
// BusinessPartner again. A monthStart with no snapshot AND already in the
// past (before this feature went live) still gets a snapshot captured from
// TODAY's Capacity, applied retroactively — see spec §2, an explicit
// approximation rather than a historical reconstruction.
export async function getMonthlyCapacitySnapshot(monthStart: Date): Promise<Map<string, number | null>> {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input("monthStart", sql.Date, monthStart)
    .query(`SELECT BusinessPartnerID, Capacity FROM DashboardMitraCapacitySnapshot WHERE MonthStart = @monthStart`);
  if (existing.recordset.length > 0) {
    return new Map((existing.recordset as CapacitySnapshotRow[]).map((r) => [r.BusinessPartnerID, r.Capacity]));
  }

  // Atomic per-row claim (NOT EXISTS), same pattern as addMarketingWilayah
  // in marketing-wilayah.ts — concurrent callers racing for the first query
  // of a new month can't double-insert the same (MonthStart,
  // BusinessPartnerID) pair.
  await pool.request().input("monthStart", sql.Date, monthStart).query(`
    INSERT INTO DashboardMitraCapacitySnapshot (MonthStart, BusinessPartnerID, Capacity)
    SELECT @monthStart, bp.BusinessPartnerID, bp.Capacity
    FROM BusinessPartner bp
    WHERE ISNULL(bp.IsDeleted, 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM DashboardMitraCapacitySnapshot s
        WHERE s.MonthStart = @monthStart AND s.BusinessPartnerID = bp.BusinessPartnerID
      )
  `);

  const captured = await pool
    .request()
    .input("monthStart", sql.Date, monthStart)
    .query(`SELECT BusinessPartnerID, Capacity FROM DashboardMitraCapacitySnapshot WHERE MonthStart = @monthStart`);
  return new Map((captured.recordset as CapacitySnapshotRow[]).map((r) => [r.BusinessPartnerID, r.Capacity]));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Via `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_dql`, run `SELECT MonthStart, COUNT(*) FROM DashboardMitraCapacitySnapshot GROUP BY MonthStart` before and after a call from Task 10's wiring (once that lands) — confirm a month's row count never changes across repeated queries (idempotent lock-in).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/mitra-capacity-snapshot.ts
git commit -m "feat: lazy monthly mitra capacity snapshot query module"
```

---

### Task 8: `armada-noo-target.ts` — shared Target NOO fleet-capacity query

**Files:**
- Create: `src/lib/queries/armada-noo-target.ts`

**Interfaces:**
- Produces: `getArmadaNooDailyCapacity(windowEnd: Date): Promise<number>` — consumed by Task 10.

- [ ] **Step 1: Write the module**

```ts
import { getPool, sql } from "@/lib/db";

const WINDOW_DAYS = 30;

// Σ per-armada (KapasitasMaks - rata-rata muatan harian dalam WINDOW_DAYS
// hari sebelum `windowEnd`, exclusive) — Target NOO harian bersama (satu
// angka, tidak dibagi per marketing/wilayah, armada tidak terikat ke
// wilayah tertentu). Dinamis: tidak disnapshot, selalu dihitung ulang dari
// histori DeliveryOrder yang sudah ada — lihat spec §4 "target ini
// bergerak". Same VehicleMap three-way VehicleNo resolution and 5KG-bag
// halving convention as getPengirimanBoard()'s externalResult query in
// pengiriman-jadwal.ts. Average is total-kantong-in-window / WINDOW_DAYS
// (a fixed 30-day denominator, not "average over active delivery days") so
// a rarely-used armada still reads as having real spare capacity.
export async function getArmadaNooDailyCapacity(windowEnd: Date): Promise<number> {
  const pool = await getPool();
  const windowStart = new Date(windowEnd.getTime() - WINDOW_DAYS * 86400000);

  const result = await pool
    .request()
    .input("windowStart", sql.Date, windowStart)
    .input("windowEnd", sql.Date, windowEnd).query(`
      WITH VehicleMap AS (
          SELECT a.ArmadaID, a.KapasitasMaks, a.ExpeditionDetailID AS Key1, ed.VehicleNo AS Key2, a.Nama AS Key3
          FROM DashboardArmada a
          LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
          WHERE a.IsDeleted = 0
      ),
      DoQty AS (
          SELECT DeliveryOrderID, SUM(CASE WHEN Name LIKE '%5 KG%' THEN Qty / 2.0 ELSE Qty END) AS TotalKantong
          FROM DeliveryOrderDetail
          GROUP BY DeliveryOrderID
      ),
      DailyByArmada AS (
          SELECT vm.ArmadaID, SUM(ISNULL(dq.TotalKantong, 0)) AS TotalKantong30d
          FROM VehicleMap vm
          LEFT JOIN DeliveryOrder do_
            ON do_.IsDeleted = 0 AND do_.VehicleNo <> ''
            AND (do_.VehicleNo = vm.Key1 OR do_.VehicleNo = vm.Key2 OR do_.VehicleNo = vm.Key3)
            AND do_.TransDate >= @windowStart AND do_.TransDate < @windowEnd
          LEFT JOIN DoQty dq ON dq.DeliveryOrderID = do_.DeliveryOrderID
          GROUP BY vm.ArmadaID
      )
      SELECT vm.ArmadaID, vm.KapasitasMaks, ISNULL(dba.TotalKantong30d, 0) AS TotalKantong30d
      FROM VehicleMap vm
      LEFT JOIN DailyByArmada dba ON dba.ArmadaID = vm.ArmadaID
    `);

  let total = 0;
  for (const row of result.recordset as { ArmadaID: number; KapasitasMaks: number | null; TotalKantong30d: number }[]) {
    if (row.KapasitasMaks == null) continue;
    const avgDaily = row.TotalKantong30d / WINDOW_DAYS;
    const empty = row.KapasitasMaks - avgDaily;
    if (empty > 0) total += empty;
  }
  return total;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual sanity check**

Via `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_dql`, run `SELECT SUM(KapasitasMaks) FROM DashboardArmada WHERE IsDeleted = 0` and eyeball that it's a plausible upper bound for what the function should return (function's result must be ≤ this sum, since it never adds negative-empty armada).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/armada-noo-target.ts
git commit -m "feat: shared Target NOO fleet spare-capacity query"
```

---

### Task 9: Add `JoinDate` to existing roster queries

**Files:**
- Modify: `src/lib/queries/marketing-performance.ts:30-36,129-138,184-193`
- Modify: `src/lib/queries/marketing-wilayah.ts:128-138,153-192`

**Interfaces:**
- Produces: `MarketingScopeAllMitra.JoinDate: string | null`, `MarketingMitraAssignment.JoinDate: string | null` — consumed by Task 15 (desktop Existing/NOO roster split) and Task 16 (mobile).

- [ ] **Step 1: `marketing-performance.ts` — add `JoinDate` to the type and SELECT**

```ts
export interface MarketingScopeAllMitra {
  BusinessPartnerID: string;
  Name: string;
  Wilayah: string;
  Kecamatan: string | null;
  Capacity: number | null;
  JoinDate: string | null;
}
```

Update the `mitraResult` query:

```ts
    pool.request().query(`
      SELECT
          BusinessPartnerID,
          Name,
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          Capacity,
          JoinDate
      FROM BusinessPartner
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
```

Update the row type and roster-push in the loop right below:

```ts
  for (const r of mitraResult.recordset as {
    BusinessPartnerID: string;
    Name: string;
    Wilayah: string;
    Kecamatan: string | null;
    Capacity: number | null;
    JoinDate: string | null;
  }[]) {
    const cell = getCell(r.BusinessPartnerID, r.Wilayah, r.Kecamatan);
    if (!cell) continue;
    if (r.Capacity) cell.TargetHarian += r.Capacity;
    resolvedMarketingByMitra.set(r.BusinessPartnerID, cell.MarketingUserID);
    const roster = allMitraByMarketing.get(cell.MarketingUserID) ?? [];
    roster.push({
      BusinessPartnerID: r.BusinessPartnerID,
      Name: r.Name,
      Wilayah: r.Wilayah,
      Kecamatan: r.Kecamatan,
      Capacity: r.Capacity,
      JoinDate: r.JoinDate,
    });
    allMitraByMarketing.set(cell.MarketingUserID, roster);
  }
```

- [ ] **Step 2: `marketing-wilayah.ts` — add `JoinDate` to `MarketingMitraAssignment` and its query**

```ts
export interface MarketingMitraAssignment {
  MarketingMitraID: number;
  MarketingUserID: string;
  MarketingNama: string;
  BusinessPartnerID: string;
  MitraName: string;
  Wilayah: string;
  Kecamatan: string | null;
  Capacity: number | null;
  JoinDate: string | null;
  CreatedAt: string;
}
```

Update `getMarketingMitraAssignments()`'s query and row mapping:

```ts
  const mmResult = await mssqlPool.request().query(`
    SELECT mm.MarketingMitraID, mm.MarketingUserID,
           mm.BusinessPartnerID, bp.Name AS MitraName,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan, bp.Capacity, bp.JoinDate, mm.CreatedAt
    FROM DashboardMarketingMitra mm
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = mm.BusinessPartnerID
  `);
  const rows = mmResult.recordset as {
    MarketingMitraID: number;
    MarketingUserID: string;
    BusinessPartnerID: string;
    MitraName: string;
    Wilayah: string;
    Kecamatan: string | null;
    Capacity: number | null;
    JoinDate: string | null;
    CreatedAt: string;
  }[];
```

And in the final `.map()` that builds the returned rows:

```ts
  return rows
    .map((r) => ({
      MarketingMitraID: r.MarketingMitraID,
      MarketingUserID: r.MarketingUserID,
      MarketingNama: nameMap.get(Number(r.MarketingUserID)) ?? "Tidak diketahui",
      BusinessPartnerID: r.BusinessPartnerID,
      MitraName: r.MitraName,
      Wilayah: r.Wilayah,
      Kecamatan: r.Kecamatan,
      Capacity: r.Capacity,
      JoinDate: r.JoinDate,
      CreatedAt: r.CreatedAt,
    }))
    .sort((a, b) => a.MarketingNama.localeCompare(b.MarketingNama) || a.MitraName.localeCompare(b.MitraName));
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (both are additive fields).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/marketing-performance.ts src/lib/queries/marketing-wilayah.ts
git commit -m "feat: add JoinDate to marketing roster queries for Existing/NOO split"
```

---

### Task 10: `marketing-performance-trend.ts` — Matriks Performa Marketing trend query

**Files:**
- Create: `src/lib/queries/marketing-performance-trend.ts`

**Interfaces:**
- Consumes: `getMarketingUsers`, `getMarketingWilayahAssignments`, `getMarketingMitraAssignments`, `resolveResponsibleMarketing`, `buildMitraOverrideMap` (`marketing-wilayah.ts`); `getMonthlyCapacitySnapshot` (Task 7); `getArmadaNooDailyCapacity` (Task 8); `monthBoundary`, `getBusinessDate` (`business-date.ts`).
- Produces: `CategoryAnatomy`, `MarketingTrendMonth`, `MarketingTrendRow`, `MarketingPerformanceTrendData`, `getMarketingPerformanceTrend(monthsBack: number): Promise<MarketingPerformanceTrendData>` — consumed by Task 11 and Task 12/13 (actions).

- [ ] **Step 1: Write the module**

```ts
import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import {
  getMarketingUsers,
  getMarketingWilayahAssignments,
  getMarketingMitraAssignments,
  resolveResponsibleMarketing,
  buildMitraOverrideMap,
} from "@/lib/queries/marketing-wilayah";
import { getMonthlyCapacitySnapshot } from "@/lib/queries/mitra-capacity-snapshot";
import { getArmadaNooDailyCapacity } from "@/lib/queries/armada-noo-target";

const KANTONG_QTY_EXPR = `SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END)`;

export interface CategoryAnatomy {
  general: number;
  bagQtyActual: number;
  bagQtyTarget: number;
  pct: number | null;
}

export interface MarketingTrendMonth {
  monthStartISO: string;
  existing: CategoryAnatomy;
  noo: CategoryAnatomy;
  total: CategoryAnatomy;
}

export interface MarketingTrendRow {
  MarketingUserID: string;
  MarketingNama: string;
  months: MarketingTrendMonth[];
}

export interface MarketingPerformanceTrendData {
  months: string[];
  rows: MarketingTrendRow[];
  combined: MarketingTrendMonth[];
}

function daysInMonth(monthStart: Date): number {
  return Math.round((monthBoundary(monthStart, 1).getTime() - monthStart.getTime()) / 86400000);
}

function makeAnatomy(): CategoryAnatomy {
  return { general: 0, bagQtyActual: 0, bagQtyTarget: 0, pct: null };
}

function makeMonth(monthStartISO: string): MarketingTrendMonth {
  return { monthStartISO, existing: makeAnatomy(), noo: makeAnatomy(), total: makeAnatomy() };
}

function finalizeAnatomy(a: CategoryAnatomy): void {
  a.pct = a.bagQtyTarget > 0 ? (a.bagQtyActual / a.bagQtyTarget) * 100 : null;
}

interface MitraMeta {
  BusinessPartnerID: string;
  JoinDate: string | null;
  MarketingUserID: string | null;
}

// Per-Marketing (plus a company-wide `combined` row) monthly trend of
// Existing/NOO/Total — "Matriks Performa Marketing" (spec §5). `monthsBack`
// is 3 (default) or 12 (expanded) months ending at the current WIB business
// month, oldest first. Only Marketing with at least one Wilayah/Kecamatan
// assignment (or a per-mitra priority override) get a row — same rule as
// getMarketingPerformance().
export async function getMarketingPerformanceTrend(monthsBack: number): Promise<MarketingPerformanceTrendData> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const currentMonthStart = monthBoundary(businessToday);

  const monthStarts: Date[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) monthStarts.push(monthBoundary(currentMonthStart, -i));
  const earliestMonthStart = monthStarts[0];
  const rangeEnd = monthBoundary(currentMonthStart, 1);

  const [assignments, marketingUsers, mitraAssignments, mitraResult, dailyResult] = await Promise.all([
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
    getMarketingMitraAssignments(),
    pool.request().query(`
      SELECT
          BusinessPartnerID,
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          JoinDate
      FROM BusinessPartner
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
    pool
      .request()
      .input("rangeStart", sql.Date, earliestMonthStart)
      .input("rangeEnd", sql.Date, rangeEnd)
      .query(`
        SELECT
            bp.BusinessPartnerID,
            CAST(do_.TransDate AS DATE) AS TransDate,
            ${KANTONG_QTY_EXPR} AS QtyKantong
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @rangeStart AND do_.TransDate < @rangeEnd
        GROUP BY bp.BusinessPartnerID, CAST(do_.TransDate AS DATE)
      `),
  ]);

  const mitraOverrides = buildMitraOverrideMap(mitraAssignments);
  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));

  const mitraMeta = new Map<string, MitraMeta>();
  for (const r of mitraResult.recordset as { BusinessPartnerID: string; Wilayah: string; Kecamatan: string | null; JoinDate: string | null }[]) {
    const marketingName = resolveResponsibleMarketing(r.BusinessPartnerID, r.Wilayah, r.Kecamatan, assignments, mitraOverrides);
    const user = marketingName ? marketingByName.get(marketingName) : undefined;
    mitraMeta.set(r.BusinessPartnerID, { BusinessPartnerID: r.BusinessPartnerID, JoinDate: r.JoinDate, MarketingUserID: user?.UserID ?? null });
  }

  const actualByMitraMonth = new Map<string, Map<string, number>>();
  for (const r of dailyResult.recordset as { BusinessPartnerID: string; TransDate: string; QtyKantong: number }[]) {
    const rowMonthStartISO = monthBoundary(new Date(r.TransDate)).toISOString().slice(0, 10);
    let byMonth = actualByMitraMonth.get(r.BusinessPartnerID);
    if (!byMonth) {
      byMonth = new Map();
      actualByMitraMonth.set(r.BusinessPartnerID, byMonth);
    }
    byMonth.set(rowMonthStartISO, (byMonth.get(rowMonthStartISO) ?? 0) + r.QtyKantong);
  }

  const marketingIdsWithScope = new Set<string>();
  for (const a of assignments) {
    const id = marketingByName.get(a.MarketingNama)?.UserID;
    if (id) marketingIdsWithScope.add(id);
  }
  for (const name of mitraOverrides.values()) {
    const id = marketingByName.get(name)?.UserID;
    if (id) marketingIdsWithScope.add(id);
  }

  const monthsISO = monthStarts.map((m) => m.toISOString().slice(0, 10));
  const rows: MarketingTrendRow[] = [...marketingIdsWithScope].map((userId) => ({
    MarketingUserID: userId,
    MarketingNama: marketingUsers.find((u) => u.UserID === userId)?.Nama ?? "Tidak diketahui",
    months: monthsISO.map((iso) => makeMonth(iso)),
  }));
  const rowByMarketing = new Map(rows.map((r) => [r.MarketingUserID, r]));
  const combined: MarketingTrendMonth[] = monthsISO.map((iso) => makeMonth(iso));

  for (let i = 0; i < monthStarts.length; i++) {
    const monthStart = monthStarts[i];
    const monthStartISO = monthsISO[i];
    const nextMonthStart = monthBoundary(monthStart, 1);
    const days = daysInMonth(monthStart);

    const [snapshot, nooDailyCapacity] = await Promise.all([
      getMonthlyCapacitySnapshot(monthStart),
      getArmadaNooDailyCapacity(monthStart.getTime() === currentMonthStart.getTime() ? businessToday : nextMonthStart),
    ]);
    const targetNooThisMonth = nooDailyCapacity * days;

    for (const meta of mitraMeta.values()) {
      if (!meta.MarketingUserID) continue;
      if (meta.JoinDate == null || new Date(meta.JoinDate).getTime() >= nextMonthStart.getTime()) continue;
      const isNoo = new Date(meta.JoinDate).getTime() >= monthStart.getTime();
      const actual = actualByMitraMonth.get(meta.BusinessPartnerID)?.get(monthStartISO) ?? 0;
      const capacity = snapshot.get(meta.BusinessPartnerID) ?? 0;

      const row = rowByMarketing.get(meta.MarketingUserID);
      if (row) {
        const bucket = isNoo ? row.months[i].noo : row.months[i].existing;
        bucket.general += 1;
        bucket.bagQtyActual += actual;
        if (!isNoo) bucket.bagQtyTarget += capacity ?? 0;
      }

      const combinedBucket = isNoo ? combined[i].noo : combined[i].existing;
      combinedBucket.general += 1;
      combinedBucket.bagQtyActual += actual;
      if (!isNoo) combinedBucket.bagQtyTarget += capacity ?? 0;
    }

    // Target NOO is one shared figure added once per row per month (never
    // per-mitra) — see Global Constraints.
    for (const row of rows) row.months[i].noo.bagQtyTarget = targetNooThisMonth;
    combined[i].noo.bagQtyTarget = targetNooThisMonth;
  }

  for (const row of rows) {
    for (const month of row.months) {
      month.total.general = month.existing.general + month.noo.general;
      month.total.bagQtyActual = month.existing.bagQtyActual + month.noo.bagQtyActual;
      month.total.bagQtyTarget = month.existing.bagQtyTarget + month.noo.bagQtyTarget;
      finalizeAnatomy(month.existing);
      finalizeAnatomy(month.noo);
      finalizeAnatomy(month.total);
    }
  }
  for (const month of combined) {
    month.total.general = month.existing.general + month.noo.general;
    month.total.bagQtyActual = month.existing.bagQtyActual + month.noo.bagQtyActual;
    month.total.bagQtyTarget = month.existing.bagQtyTarget + month.noo.bagQtyTarget;
    finalizeAnatomy(month.existing);
    finalizeAnatomy(month.noo);
    finalizeAnatomy(month.total);
  }

  rows.sort((a, b) => a.MarketingNama.localeCompare(b.MarketingNama));
  return { months: monthsISO, rows, combined };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual cross-check against the existing current-period query**

Via a scratch script or the DQL tool, compare `getMarketingPerformanceTrend(1)`'s current-month `combined[0].total.bagQtyActual` against `getMarketingPerformance()`'s `cells` summed `DailyQty` for the same calendar-month window — they should be close (not necessarily identical, since `getMarketingPerformance()`'s period is the configurable marketing-period setting, not always a calendar month; this is an expected, documented difference, not a bug).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/marketing-performance-trend.ts
git commit -m "feat: Matriks Performa Marketing monthly Existing/NOO/Total trend query"
```

---

### Task 11: `pangsa-pasar-trend.ts` — Pangsa Pasar & Kontribusi Internal trend query

**Files:**
- Create: `src/lib/queries/pangsa-pasar-trend.ts`

**Interfaces:**
- Consumes: `PARTNER_TYPE_CASE` (Task 2); `getMarketingUsers`, `getMarketingWilayahAssignments`, `getMarketingMitraAssignments`, `resolveResponsibleMarketing`, `buildMitraOverrideMap` (`marketing-wilayah.ts`); `MarketingPerformanceTrendData` (Task 10, passed in — not re-queried).
- Produces: `PangsaPasarMonth`, `PangsaPasarRow`, `PangsaPasarTrendData`, `getPangsaPasarTrend(monthsBack: number, performanceTrend: MarketingPerformanceTrendData): Promise<PangsaPasarTrendData>` — consumed by Task 12/13 (actions).

- [ ] **Step 1: Write the module**

```ts
import { getPool } from "@/lib/db";
import { monthBoundary } from "@/lib/business-date";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import {
  getMarketingUsers,
  getMarketingWilayahAssignments,
  getMarketingMitraAssignments,
  resolveResponsibleMarketing,
  buildMitraOverrideMap,
} from "@/lib/queries/marketing-wilayah";
import type { MarketingPerformanceTrendData } from "@/lib/queries/marketing-performance-trend";

export interface PangsaPasarMonth {
  monthStartISO: string;
  agen: number;
  rpa: number;
  outlet: number;
  total: number;
  agenPct: number | null;
  rpaPct: number | null;
  outletPct: number | null;
  lost: number;
}

export interface PangsaPasarRow {
  MarketingUserID: string;
  MarketingNama: string;
  months: PangsaPasarMonth[];
}

export interface PangsaPasarTrendData {
  months: string[];
  rows: PangsaPasarRow[];
  combined: PangsaPasarMonth[];
}

function makeMonth(monthStartISO: string): PangsaPasarMonth {
  return { monthStartISO, agen: 0, rpa: 0, outlet: 0, total: 0, agenPct: null, rpaPct: null, outletPct: null, lost: 0 };
}

interface MitraMeta {
  BusinessPartnerID: string;
  JoinDate: string | null;
  PartnerType: string;
  MarketingUserID: string | null;
}

// "Pangsa Pasar & Kontribusi Internal" (spec §6) — per-Marketing monthly
// Agen/RPA/Outlet roster counts (as-of-month-end, PARTNER_TYPE_CASE-based;
// TakeAway/Lainnya excluded, same convention as Mitra Growth), each with %
// share of the company-wide total that month, plus Lost (month-over-month
// delta of Total Bag Qty). Reuses `performanceTrend` (from
// getMarketingPerformanceTrend()) for Lost instead of re-querying
// DeliveryOrder — `performanceTrend.months` MUST be the same `monthsBack`
// call result, same order; callers always fetch performanceTrend first and
// pass it straight through. The first displayed month has no prior-month
// data available in the window, so its `lost` is 0 (documented boundary
// case, not a bug).
export async function getPangsaPasarTrend(
  monthsBack: number,
  performanceTrend: MarketingPerformanceTrendData
): Promise<PangsaPasarTrendData> {
  const pool = await getPool();
  const monthStarts = performanceTrend.months.map((iso) => new Date(iso));

  const [assignments, marketingUsers, mitraAssignments, mitraResult] = await Promise.all([
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
    getMarketingMitraAssignments(),
    pool.request().query(`
      SELECT
          BusinessPartnerID,
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          JoinDate,
          ${PARTNER_TYPE_CASE} AS PartnerType
      FROM BusinessPartner
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
  ]);
  const mitraOverrides = buildMitraOverrideMap(mitraAssignments);
  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));

  const mitraMeta: MitraMeta[] = (
    mitraResult.recordset as { BusinessPartnerID: string; Wilayah: string; Kecamatan: string | null; JoinDate: string | null; PartnerType: string }[]
  ).map((r) => {
    const marketingName = resolveResponsibleMarketing(r.BusinessPartnerID, r.Wilayah, r.Kecamatan, assignments, mitraOverrides);
    const user = marketingName ? marketingByName.get(marketingName) : undefined;
    return { BusinessPartnerID: r.BusinessPartnerID, JoinDate: r.JoinDate, PartnerType: r.PartnerType, MarketingUserID: user?.UserID ?? null };
  });

  const marketingIdsWithScope = new Set(performanceTrend.rows.map((r) => r.MarketingUserID));
  const rows: PangsaPasarRow[] = [...marketingIdsWithScope].map((userId) => ({
    MarketingUserID: userId,
    MarketingNama: marketingUsers.find((u) => u.UserID === userId)?.Nama ?? "Tidak diketahui",
    months: performanceTrend.months.map((iso) => makeMonth(iso)),
  }));
  const rowByMarketing = new Map(rows.map((r) => [r.MarketingUserID, r]));
  const combined: PangsaPasarMonth[] = performanceTrend.months.map((iso) => makeMonth(iso));

  for (let i = 0; i < monthStarts.length; i++) {
    const nextMonthStart = monthBoundary(monthStarts[i], 1);
    for (const meta of mitraMeta) {
      if (!meta.MarketingUserID) continue;
      if (meta.PartnerType !== "Agen" && meta.PartnerType !== "RPA" && meta.PartnerType !== "Outlet") continue;
      if (meta.JoinDate == null || new Date(meta.JoinDate).getTime() >= nextMonthStart.getTime()) continue;

      const key: "agen" | "rpa" | "outlet" = meta.PartnerType === "Agen" ? "agen" : meta.PartnerType === "RPA" ? "rpa" : "outlet";
      const row = rowByMarketing.get(meta.MarketingUserID);
      if (row) {
        row.months[i][key] += 1;
        row.months[i].total += 1;
      }
      combined[i][key] += 1;
      combined[i].total += 1;
    }
  }

  for (let i = 0; i < monthStarts.length; i++) {
    for (const row of rows) {
      const m = row.months[i];
      m.agenPct = combined[i].agen > 0 ? (m.agen / combined[i].agen) * 100 : null;
      m.rpaPct = combined[i].rpa > 0 ? (m.rpa / combined[i].rpa) * 100 : null;
      m.outletPct = combined[i].outlet > 0 ? (m.outlet / combined[i].outlet) * 100 : null;

      const trendRow = performanceTrend.rows.find((p) => p.MarketingUserID === row.MarketingUserID);
      const currActual = trendRow?.months[i].total.bagQtyActual ?? 0;
      const prevActual = i > 0 ? trendRow?.months[i - 1].total.bagQtyActual : undefined;
      m.lost = prevActual != null ? currActual - prevActual : 0;
    }
    const cm = combined[i];
    const prevCombinedActual = i > 0 ? performanceTrend.combined[i - 1].total.bagQtyActual : undefined;
    cm.lost = prevCombinedActual != null ? performanceTrend.combined[i].total.bagQtyActual - prevCombinedActual : 0;
  }

  rows.sort((a, b) => a.MarketingNama.localeCompare(b.MarketingNama));
  return { months: performanceTrend.months, rows, combined };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/pangsa-pasar-trend.ts
git commit -m "feat: Pangsa Pasar & Kontribusi Internal monthly trend query"
```

---

### Task 12: Desktop server action — `getMarketingTrendDataAction`

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/pemasaran/actions.ts`

**Interfaces:**
- Consumes: `getMarketingPerformanceTrend` (Task 10), `getPangsaPasarTrend` (Task 11).
- Produces: `MarketingTrendBundle`, `getMarketingTrendDataAction(monthsBack: 3 | 12): Promise<ActionResult<MarketingTrendBundle>>` — consumed by Task 15.

- [ ] **Step 1: Add imports**

At the top of the file, alongside the existing imports:

```ts
import { STAFF_ROLE_ID } from "@/lib/roles";
import { MARKETING_ROLE_ID } from "@/lib/queries/mitra-pengajuan";
import { getMarketingPerformanceTrend, type MarketingPerformanceTrendData } from "@/lib/queries/marketing-performance-trend";
import { getPangsaPasarTrend, type PangsaPasarTrendData } from "@/lib/queries/pangsa-pasar-trend";
```

- [ ] **Step 2: Add the action**

Append to the end of the file:

```ts
export interface MarketingTrendBundle {
  performance: MarketingPerformanceTrendData;
  pangsaPasar: PangsaPasarTrendData;
  showCombined: boolean;
}

// Same "who can see Kinerja Marketing" gate as the page (canViewKinerjaMarketing
// in page.tsx) — everyone except plain Staff. Plain Marketing sessions get
// their own row only and no combined figures, same narrowing
// performanceForSession already applies to getMarketingPerformance().
export async function getMarketingTrendDataAction(monthsBack: 3 | 12): Promise<ActionResult<MarketingTrendBundle>> {
  return runAction(async () => {
    const session = await auth();
    const user = session?.user;
    if (!user) throw new AppError("Unauthorized");
    if (user.roleId === STAFF_ROLE_ID && !user.isSuperAdmin) {
      throw new AppError("Tidak punya izin melihat Kinerja Marketing");
    }

    const performanceFull = await getMarketingPerformanceTrend(monthsBack);
    const pangsaPasarFull = await getPangsaPasarTrend(monthsBack, performanceFull);

    const isPlainMarketing = !user.isSuperAdmin && user.roleId === MARKETING_ROLE_ID;
    if (!isPlainMarketing) {
      return { performance: performanceFull, pangsaPasar: pangsaPasarFull, showCombined: true };
    }
    return {
      performance: { ...performanceFull, rows: performanceFull.rows.filter((r) => r.MarketingUserID === user.id) },
      pangsaPasar: { ...pangsaPasarFull, rows: pangsaPasarFull.rows.filter((r) => r.MarketingUserID === user.id) },
      showCombined: false,
    };
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/pemasaran/actions.ts"
git commit -m "feat: desktop server action for Kinerja Marketing trend data"
```

---

### Task 13: Mobile server action — `getKinerjaMarketingTrendAction`

**Files:**
- Modify: `src/app/mkesindo/pemasaran-app/actions.ts`

**Interfaces:**
- Consumes: `getMarketingPerformanceTrend` (Task 10), `getPangsaPasarTrend` (Task 11).
- Produces: `getKinerjaMarketingTrendAction(monthsBack: 3 | 12): Promise<ActionResult<{ performance: MarketingPerformanceTrendData; pangsaPasar: PangsaPasarTrendData }>>` — consumed by Task 16.

- [ ] **Step 1: Add imports**

Alongside the existing imports:

```ts
import { getMarketingPerformanceTrend, type MarketingPerformanceTrendData } from "@/lib/queries/marketing-performance-trend";
import { getPangsaPasarTrend, type PangsaPasarTrendData } from "@/lib/queries/pangsa-pasar-trend";
```

- [ ] **Step 2: Add the action**

Append near `getKinerjaMarketingAction`:

```ts
export async function getKinerjaMarketingTrendAction(
  monthsBack: 3 | 12
): Promise<ActionResult<{ performance: MarketingPerformanceTrendData; pangsaPasar: PangsaPasarTrendData }>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const performanceFull = await getMarketingPerformanceTrend(monthsBack);
    const pangsaPasarFull = await getPangsaPasarTrend(monthsBack, performanceFull);
    // Mobile never shows the combined/company-wide view — only the caller's
    // own row, same cross-marketing isolation rule as getKinerjaMarketingAction.
    return {
      performance: { ...performanceFull, rows: performanceFull.rows.filter((r) => r.MarketingUserID === session.user.id) },
      pangsaPasar: { ...pangsaPasarFull, rows: pangsaPasarFull.rows.filter((r) => r.MarketingUserID === session.user.id) },
    };
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/mkesindo/pemasaran-app/actions.ts
git commit -m "feat: mobile server action for Kinerja Marketing trend data"
```

---

### Task 14: `marketing-trend-tables.tsx` — shared trend table components

**Files:**
- Create: `src/components/dashboard/marketing-trend-tables.tsx`

**Interfaces:**
- Consumes: `CategoryAnatomy` (Task 10), `PangsaPasarMonth` (Task 11) shapes (structurally, via inline prop types — no import needed since these components only need the field shapes, not the exact exported type names, to stay reusable without a circular import back into the query layer's `.ts` files from a `.tsx` file).
- Produces: `MatriksPerformaTable`, `PangsaPasarTable`, `TrendExpandButton` — consumed by Task 15 (desktop) and Task 16 (mobile).

- [ ] **Step 1: Write the module**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Anatomy {
  general: number;
  bagQtyActual: number;
  bagQtyTarget: number;
  pct: number | null;
}

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function formatMonthLabel(monthStartISO: string): string {
  return new Date(monthStartISO).toLocaleDateString("id-ID", { month: "short", year: "numeric", timeZone: "UTC" });
}

function AnatomyCell({ anatomy }: { anatomy: Anatomy }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-[11px] tabular-nums">
      <span className="font-semibold">{formatQty(anatomy.general)} outlet</span>
      <span className="text-muted-foreground">
        {formatQty(anatomy.bagQtyActual)}/{formatQty(anatomy.bagQtyTarget)}
      </span>
      <span className={cn(anatomy.pct != null && anatomy.pct >= 100 && "font-medium text-primary")}>
        {anatomy.pct != null ? `${anatomy.pct.toFixed(0)}%` : "-"}
      </span>
    </div>
  );
}

// "Matriks Performa Marketing" (spec §5) — Existing/NOO/Total rows x one
// column per month. Used both for the company-wide combined figures and,
// with per-marketing data, inside each MarketingCard.
export function MatriksPerformaTable({
  months,
  existing,
  noo,
  total,
  title,
}: {
  months: string[];
  existing: Anatomy[];
  noo: Anatomy[];
  total: Anatomy[];
  title: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="p-2 text-left font-medium text-muted-foreground">{title}</th>
            {months.map((m) => (
              <th key={m} className="p-2 text-center font-medium text-muted-foreground">
                {formatMonthLabel(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="p-2 font-medium">Existing</td>
            {existing.map((a, i) => (
              <td key={months[i]} className="p-2">
                <AnatomyCell anatomy={a} />
              </td>
            ))}
          </tr>
          <tr className="border-b">
            <td className="p-2 font-medium">NOO</td>
            {noo.map((a, i) => (
              <td key={months[i]} className="p-2">
                <AnatomyCell anatomy={a} />
              </td>
            ))}
          </tr>
          <tr>
            <td className="p-2 font-semibold">Total</td>
            {total.map((a, i) => (
              <td key={months[i]} className="p-2">
                <AnatomyCell anatomy={a} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface PangsaPasarMonthLike {
  monthStartISO: string;
  agen: number;
  rpa: number;
  outlet: number;
  total: number;
  agenPct: number | null;
  rpaPct: number | null;
  outletPct: number | null;
  lost: number;
}

// "Pangsa Pasar & Kontribusi Internal" (spec §6) — one row per month.
export function PangsaPasarTable({ rows }: { rows: PangsaPasarMonthLike[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="p-2 text-left font-medium text-muted-foreground">Bulan</th>
            <th className="p-2 text-center font-medium text-muted-foreground">Agen</th>
            <th className="p-2 text-center font-medium text-muted-foreground">RPA</th>
            <th className="p-2 text-center font-medium text-muted-foreground">Outlet</th>
            <th className="p-2 text-center font-medium text-muted-foreground">Total</th>
            <th className="p-2 text-center font-medium text-muted-foreground">Lost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.monthStartISO} className="border-b last:border-0">
              <td className="p-2 font-medium">{formatMonthLabel(r.monthStartISO)}</td>
              <td className="p-2 text-center tabular-nums">
                {formatQty(r.agen)}
                {r.agenPct != null && <span className="ml-1 text-[10px] text-muted-foreground">({r.agenPct.toFixed(0)}%)</span>}
              </td>
              <td className="p-2 text-center tabular-nums">
                {formatQty(r.rpa)}
                {r.rpaPct != null && <span className="ml-1 text-[10px] text-muted-foreground">({r.rpaPct.toFixed(0)}%)</span>}
              </td>
              <td className="p-2 text-center tabular-nums">
                {formatQty(r.outlet)}
                {r.outletPct != null && <span className="ml-1 text-[10px] text-muted-foreground">({r.outletPct.toFixed(0)}%)</span>}
              </td>
              <td className="p-2 text-center font-semibold tabular-nums">{formatQty(r.total)}</td>
              <td className={cn("p-2 text-center font-medium tabular-nums", r.lost > 0 && "text-primary", r.lost < 0 && "text-destructive")}>
                {r.lost > 0 ? `+${formatQty(r.lost)}` : formatQty(r.lost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrendExpandButton({ expanded, onToggle, pending }: { expanded: boolean; onToggle: () => void; pending: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onToggle} disabled={pending}>
      {pending ? "Memuat..." : expanded ? "Tampilkan 3 bulan" : "Tampilkan 12 bulan"}
    </Button>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/marketing-trend-tables.tsx
git commit -m "feat: shared Matriks Performa / Pangsa Pasar trend table components"
```

---

### Task 15: Desktop UI — wire trend tables and NOO toggle into `marketing-performance-panel.tsx` + `pemasaran/page.tsx`

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/pemasaran/page.tsx`
- Modify: `src/components/dashboard/marketing-performance-panel.tsx` (entire file)

**Interfaces:**
- Consumes: `getMarketingPerformanceTrend`, `getPangsaPasarTrend` (Tasks 10, 11); `getMarketingTrendDataAction`, `MarketingTrendBundle` (Task 12); `MatriksPerformaTable`, `PangsaPasarTable`, `TrendExpandButton` (Task 14); `MarketingScopeAllMitra.JoinDate`, `MarketingMitraAssignment.JoinDate` (Task 9).

- [ ] **Step 1: `page.tsx` — fetch the initial (3-month) trend bundle server-side**

Add imports:

```ts
import { getMarketingPerformanceTrend } from "@/lib/queries/marketing-performance-trend";
import { getPangsaPasarTrend } from "@/lib/queries/pangsa-pasar-trend";
import type { MarketingTrendBundle } from "@/app/mkesindo/(dashboard)/pemasaran/actions";
```

Add a small loader function above the `PemasaranPage` component (mirrors the sequential-then-parallel shape needed since `getPangsaPasarTrend` depends on `getMarketingPerformanceTrend`'s result):

```ts
async function loadTrendBundle(canView: boolean, sessionUserId: string, isPlainMarketing: boolean): Promise<MarketingTrendBundle | null> {
  if (!canView) return null;
  const performanceFull = await getMarketingPerformanceTrend(3);
  const pangsaPasarFull = await getPangsaPasarTrend(3, performanceFull);
  if (!isPlainMarketing) return { performance: performanceFull, pangsaPasar: pangsaPasarFull, showCombined: true };
  return {
    performance: { ...performanceFull, rows: performanceFull.rows.filter((r) => r.MarketingUserID === sessionUserId) },
    pangsaPasar: { ...pangsaPasarFull, rows: pangsaPasarFull.rows.filter((r) => r.MarketingUserID === sessionUserId) },
    showCombined: false,
  };
}
```

Inside `PemasaranPage()`, replace the existing setup block (the two lines right after `canViewKinerjaMarketing` is computed, through the start of the `Promise.all`) so `isPlainMarketing` is computed BEFORE the `Promise.all` instead of after it (it only needs `session`, already available) and `loadTrendBundle` is included as one more parallel fetch. Current code:

```ts
  const canViewKinerjaMarketing = !(session.user.roleId === STAFF_ROLE_ID && !session.user.isSuperAdmin);

  const [
    rows,
    allKpiRows,
    priceLevels,
    wilayahAssignments,
    marketingUsers,
    mitraAssignments,
    mitraOptions,
    performance,
    wilayahDelivery,
    marketingPositions,
  ] = await Promise.all([
```

Replace with:

```ts
  const canViewKinerjaMarketing = !(session.user.roleId === STAFF_ROLE_ID && !session.user.isSuperAdmin);
  const isPlainMarketing = !session.user.isSuperAdmin && session.user.roleId === MARKETING_ROLE_ID;

  const [
    rows,
    allKpiRows,
    priceLevels,
    wilayahAssignments,
    marketingUsers,
    mitraAssignments,
    mitraOptions,
    performance,
    wilayahDelivery,
    marketingPositions,
    trendBundle,
  ] = await Promise.all([
```

And add `loadTrendBundle(canViewKinerjaMarketing, session.user.id, isPlainMarketing)` as the final entry of that same `Promise.all([...])` array (right after the existing `canManageWilayah ? getLatestMarketingPositions() : Promise.resolve([]),` entry, matching the new `marketingPositions, trendBundle,` destructuring order above).

Finally, delete the now-redundant later line `const isPlainMarketing = !session.user.isSuperAdmin && session.user.roleId === MARKETING_ROLE_ID;` that currently appears further down in the function body (right before `const kpiRows = ...`) — it was moved up above the `Promise.all` and must not be declared twice.

Pass the result to the panel:

```tsx
      {canViewKinerjaMarketing && performanceForSession && (
        <MarketingPerformancePanel
          data={performanceForSession}
          kpiRows={kpiRows}
          canManageSettings={canManageWilayah}
          mitraAssignments={mitraAssignmentsForSession}
          initialTrendBundle={trendBundle}
        />
      )}
```

- [ ] **Step 2: `marketing-performance-panel.tsx` — add trend state, NOO split, and wiring**

Add imports at the top:

```tsx
import { useEffect } from "react";
import { MatriksPerformaTable, PangsaPasarTable, TrendExpandButton } from "@/components/dashboard/marketing-trend-tables";
import { getMarketingTrendDataAction, type MarketingTrendBundle } from "@/app/mkesindo/(dashboard)/pemasaran/actions";
import type { MarketingTrendRow } from "@/lib/queries/marketing-performance-trend";
import type { PangsaPasarRow } from "@/lib/queries/pangsa-pasar-trend";
```

Extend `MarketingCard`'s props and body to add the NOO toggle as a third sibling section, filtering "Mitra Prioritas"/"Seluruh Mitra" down to Existing-only, and rendering the per-marketing trend tables when available. Replace the `MarketingCard` function entirely:

```tsx
function MarketingCard({
  row,
  kpi,
  dates,
  todayISO,
  mitraPrioritas,
  allMitra,
  mitraDailyQty,
  onMitraClick,
  forceOpen,
  dailyDelta,
  trendRow,
  pangsaPasarRow,
  trendMonths,
}: {
  row: AggregatedRow;
  kpi: MarketingKPIRow | undefined;
  dates: string[];
  todayISO: string;
  mitraPrioritas: MarketingMitraAssignment[];
  allMitra: MarketingScopeAllMitra[];
  mitraDailyQty: Record<string, number[]>;
  onMitraClick: (businessPartnerId: string) => void;
  forceOpen: boolean;
  dailyDelta: { positive: number[]; negative: number[] };
  trendRow: MarketingTrendRow | undefined;
  pangsaPasarRow: PangsaPasarRow | undefined;
  trendMonths: string[];
}) {
  const [open, setOpen] = useState(false);
  const [openAll, setOpenAll] = useState(false);
  const [openNoo, setOpenNoo] = useState(false);
  const kunjungan = kpi?.Kunjungan ?? 0;
  const konversiPct = kpi && kpi.Kunjungan > 0 ? (kpi.Konversi / kpi.Kunjungan) * 100 : 0;

  // Current WIB business month, as a "YYYY-MM-01" string — todayISO is
  // already a business-date ISO string (getBusinessDateISO()), so slicing
  // to year-month and re-appending "-01" is a safe string comparison
  // against JoinDate without re-parsing timezones.
  const currentMonthStartISO = `${todayISO.slice(0, 7)}-01`;
  // JoinDate arrives from the server as a real JS Date at runtime (the
  // underlying BusinessPartner.JoinDate column is SQL datetime — the mssql
  // driver returns a Date object, and React's RSC serialization preserves
  // Date instances across the server/client boundary), even though its
  // declared type is `string | null`. Comparing a Date directly against an
  // ISO string via `<`/`>=` always evaluates false (Date coerces to its
  // numeric timestamp, the string fails ToNumber). Normalize both sides
  // through `new Date(...)` before comparing — this also works unchanged if
  // JoinDate genuinely is a string at runtime, since `new Date(dateObj)`
  // clones a Date input as-is. Matches the same normalization already used
  // in marketing-performance-trend.ts/pangsa-pasar-trend.ts.
  const isExisting = (joinDate: string | null) =>
    !joinDate || new Date(joinDate).getTime() < new Date(currentMonthStartISO).getTime();
  const isNoo = (joinDate: string | null) =>
    !!joinDate && new Date(joinDate).getTime() >= new Date(currentMonthStartISO).getTime();

  const sortedMitra = useMemo(
    () => [...mitraPrioritas].filter((m) => isExisting(m.JoinDate)).sort(compareCapacityDesc),
    [mitraPrioritas, currentMonthStartISO]
  );
  const sortedAllMitra = useMemo(
    () => [...allMitra].filter((m) => isExisting(m.JoinDate)).sort(compareCapacityDesc),
    [allMitra, currentMonthStartISO]
  );
  const sortedNooMitra = useMemo(
    () => [...allMitra].filter((m) => isNoo(m.JoinDate)).sort(compareCapacityDesc),
    [allMitra, currentMonthStartISO]
  );
  const showPrioritas = open || forceOpen;
  const showAll = openAll || forceOpen;
  const showNoo = openNoo || forceOpen;

  return (
    <div className="flex flex-col">
      <div className="flex items-stretch">
        <Link
          href={`/mkesindo/transaksi?marketing=${encodeURIComponent(row.MarketingNama)}`}
          className={cn(
            "sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1.5 bg-card py-3 pr-3 transition-colors hover:bg-accent/50",
            INFO_COL_CLASS
          )}
          title="Lihat Transaksi DO per Mitra untuk Marketing ini"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-medium">{row.MarketingNama}</p>
            <span className="shrink-0 rounded-md border bg-secondary/50 px-2 py-0.5 text-xs font-semibold tabular-nums">
              {formatQty(row.TargetHarian)}/hari
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Pencapaian <span className="font-medium text-foreground">{formatQty(row.TotalQty)}</span>{" "}
            <span className={cn(row.PctAchievement != null && row.PctAchievement >= 100 && "font-medium text-primary")}>
              ({row.PctAchievement != null ? row.PctAchievement.toFixed(0) : "-"}%)
            </span>
          </p>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              Kunjungan {kunjungan.toLocaleString("id-ID")}/{TARGET_KUNJUNGAN_BULANAN}
            </span>
            <span>Konversi {konversiPct.toFixed(0)}%</span>
          </div>
        </Link>
        <div className="flex border-l">
          {dates.map((dateISO, i) => (
            <DayCell
              key={dateISO}
              dateISO={dateISO}
              qty={row.DailyQty[i]}
              positiveDelta={i > 0 ? dailyDelta.positive[i] : 0}
              negativeDelta={i > 0 ? dailyDelta.negative[i] : 0}
              isPast={dateISO <= todayISO}
            />
          ))}
        </div>
      </div>

      {trendRow && (
        <div className="border-t px-3 py-2">
          <MatriksPerformaTable
            months={trendMonths}
            existing={trendRow.months.map((m) => m.existing)}
            noo={trendRow.months.map((m) => m.noo)}
            total={trendRow.months.map((m) => m.total)}
            title="Matriks Performa"
          />
          {pangsaPasarRow && <PangsaPasarTable rows={pangsaPasarRow.months} />}
        </div>
      )}

      {sortedMitra.length > 0 && (
        <div className="pb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 pl-3 text-[11px] text-muted-foreground"
            onClick={() => setOpen((v) => !v)}
            disabled={forceOpen}
          >
            <Star className="size-3 fill-primary text-primary" />
            {showPrioritas ? "Sembunyikan" : "Tampilkan"} {sortedMitra.length} mitra prioritas (Existing)
            <ChevronDown className={cn("size-3 transition-transform", showPrioritas && "rotate-180")} />
          </Button>
          {showPrioritas && (
            <div className="flex flex-col divide-y border-t">
              {sortedMitra.map((m) => (
                <MitraPrioritasRow
                  key={m.MarketingMitraID}
                  mitra={m}
                  dailyQty={mitraDailyQty[m.BusinessPartnerID] ?? []}
                  dates={dates}
                  todayISO={todayISO}
                  onMitraClick={onMitraClick}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {sortedAllMitra.length > 0 && (
        <div className="pb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 pl-3 text-[11px] text-muted-foreground"
            onClick={() => setOpenAll((v) => !v)}
            disabled={forceOpen}
          >
            <Users className="size-3" />
            {showAll ? "Sembunyikan" : "Tampilkan"} {sortedAllMitra.length} seluruh mitra (Existing)
            <ChevronDown className={cn("size-3 transition-transform", showAll && "rotate-180")} />
          </Button>
          {showAll && (
            <div className="flex flex-col divide-y border-t">
              {sortedAllMitra.map((m) => (
                <AllMitraRow
                  key={m.BusinessPartnerID}
                  mitra={m}
                  dailyQty={mitraDailyQty[m.BusinessPartnerID] ?? []}
                  dates={dates}
                  todayISO={todayISO}
                  onMitraClick={onMitraClick}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {sortedNooMitra.length > 0 && (
        <div className="pb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 pl-3 text-[11px] text-muted-foreground"
            onClick={() => setOpenNoo((v) => !v)}
            disabled={forceOpen}
          >
            <Users className="size-3 text-primary" />
            {showNoo ? "Sembunyikan" : "Tampilkan"} {sortedNooMitra.length} mitra NOO bulan ini
            <ChevronDown className={cn("size-3 transition-transform", showNoo && "rotate-180")} />
          </Button>
          {showNoo && (
            <div className="flex flex-col divide-y border-t">
              {sortedNooMitra.map((m) => (
                <AllMitraRow
                  key={m.BusinessPartnerID}
                  mitra={m}
                  dailyQty={mitraDailyQty[m.BusinessPartnerID] ?? []}
                  dates={dates}
                  todayISO={todayISO}
                  onMitraClick={onMitraClick}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

Update `MarketingPerformancePanel`'s signature and body to own the trend state and pass per-row trend data down. Replace the function signature and the top of its body:

```tsx
export function MarketingPerformancePanel({
  data,
  kpiRows,
  canManageSettings,
  mitraAssignments,
  initialTrendBundle,
}: {
  data: MarketingPerformanceData;
  kpiRows: MarketingKPIRow[];
  canManageSettings: boolean;
  mitraAssignments: MarketingMitraAssignment[];
  initialTrendBundle: MarketingTrendBundle | null;
}) {
  const { cells, periodDays, rangeStartISO, todayISO, mitraDailyQty, allMitraByMarketing } = data;
  const [wilayahFilter, setWilayahFilter] = useState(ALL);
  const [kecamatanFilter, setKecamatanFilter] = useState(ALL);
  const [detailMitraId, setDetailMitraId] = useState<string | null>(null);
  const [mitraSearch, setMitraSearch] = useState("");
  const mitraSearchQuery = mitraSearch.trim().toLowerCase();

  const [trendBundle, setTrendBundle] = useState(initialTrendBundle);
  const [trendExpanded, setTrendExpanded] = useState(false);
  const [trendPending, startTrendTransition] = useTransition();

  useEffect(() => {
    setTrendBundle(initialTrendBundle);
    setTrendExpanded(false);
  }, [initialTrendBundle]);

  function handleTrendToggle() {
    const nextMonthsBack: 3 | 12 = trendExpanded ? 3 : 12;
    startTrendTransition(async () => {
      const result = await getMarketingTrendDataAction(nextMonthsBack);
      if (result.success) {
        setTrendBundle(result.data);
        setTrendExpanded(!trendExpanded);
      }
    });
  }

  const trendRowByMarketing = useMemo(
    () => new Map((trendBundle?.performance.rows ?? []).map((r) => [r.MarketingUserID, r])),
    [trendBundle]
  );
  const pangsaPasarRowByMarketing = useMemo(
    () => new Map((trendBundle?.pangsaPasar.rows ?? []).map((r) => [r.MarketingUserID, r])),
    [trendBundle]
  );
```

Add `useTransition` to the existing `"use client"` React import line (it already imports `useMemo, useState, useTransition` per the file's current header — no change needed there, just confirming it's already available).

Add the combined section inside `CardContent`, right before the existing `rows.length === 0 ? ... :` conditional block — insert this new block right after the closing `</CardHeader>` and before `<CardContent>`'s existing ternary:

```tsx
      {trendBundle?.showCombined && (
        <CardContent className="border-b pb-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Gabungan Seluruh Marketing</p>
            <TrendExpandButton expanded={trendExpanded} onToggle={handleTrendToggle} pending={trendPending} />
          </div>
          <div className="flex flex-col gap-4">
            <MatriksPerformaTable
              months={trendBundle.performance.months}
              existing={trendBundle.performance.combined.map((m) => m.existing)}
              noo={trendBundle.performance.combined.map((m) => m.noo)}
              total={trendBundle.performance.combined.map((m) => m.total)}
              title="Matriks Performa (Gabungan)"
            />
            <PangsaPasarTable rows={trendBundle.pangsaPasar.combined} />
          </div>
        </CardContent>
      )}
```

Finally, pass the per-row trend data into each `MarketingCard` call inside the existing render loop:

```tsx
              {visibleRows.map(({ row: r, mitraPrioritas, allMitra, forceOpen }) => (
                <MarketingCard
                  key={r.MarketingUserID}
                  row={r}
                  kpi={kpiByUserId.get(r.MarketingUserID)}
                  dates={dates}
                  todayISO={todayISO}
                  mitraPrioritas={mitraPrioritas}
                  allMitra={allMitra}
                  mitraDailyQty={mitraDailyQty}
                  onMitraClick={setDetailMitraId}
                  forceOpen={forceOpen}
                  dailyDelta={deltaPerDateByMarketing.get(r.MarketingUserID) ?? EMPTY_DELTA}
                  trendRow={trendRowByMarketing.get(r.MarketingUserID)}
                  pangsaPasarRow={pangsaPasarRowByMarketing.get(r.MarketingUserID)}
                  trendMonths={trendBundle?.performance.months ?? []}
                />
              ))}
```

If not already showing a per-card expand affordance, note: the per-card trend tables always render at whatever `monthsBack` the shared `trendBundle` state currently holds (3 or 12) — the single `TrendExpandButton` in the combined section controls both the combined AND every card's trend tables at once, since they all read from the same `trendBundle` state. For plain-Marketing sessions (`showCombined` false, single card), place a second `TrendExpandButton` inline near that one card instead — add it next to the panel's `<CardTitle>` when `!trendBundle?.showCombined`:

```tsx
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="font-display">Kinerja Marketing</CardTitle>
            <CardDescription>
              Total QTY DO harian dari seluruh mitra dalam cakupan wilayah &amp; kecamatan tiap Marketing, periode{" "}
              {rangeStartISO} &ndash; {addDaysISO(rangeStartISO, periodDays - 1)}.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {trendBundle && !trendBundle.showCombined && (
              <TrendExpandButton expanded={trendExpanded} onToggle={handleTrendToggle} pending={trendPending} />
            )}
            {canManageSettings && <PeriodSettings rangeStartISO={rangeStartISO} periodDays={periodDays} />}
          </div>
        </div>
```

(This replaces the existing `<div className="flex flex-wrap items-start justify-between gap-2">...{canManageSettings && <PeriodSettings .../>}</div>` block in `CardHeader` — same structure, `PeriodSettings` now sits inside a small flex row alongside the new conditional expand button.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint src/app/mkesindo/\(dashboard\)/pemasaran/page.tsx src/components/dashboard/marketing-performance-panel.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/pemasaran/page.tsx" src/components/dashboard/marketing-performance-panel.tsx
git commit -m "feat: wire Existing/NOO/Total trend tables and NOO roster into desktop Kinerja Marketing"
```

---

### Task 16: Mobile UI — `kinerja-marketing-sub-tab.tsx` rewrite

**Files:**
- Modify: `src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx` (entire file)

**Interfaces:**
- Consumes: `getKinerjaMarketingAction` (existing), `getKinerjaMarketingTrendAction` (Task 13); `MatriksPerformaTable`, `PangsaPasarTable`, `TrendExpandButton` (Task 14); `MarketingScopeAllMitra.JoinDate` (Task 9).

- [ ] **Step 1: Rewrite the file**

```tsx
"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Star, Loader2, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getKinerjaMarketingAction, getKinerjaMarketingTrendAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { MarketingPerformanceData } from "@/lib/queries/marketing-performance";
import type { MarketingPerformanceTrendData } from "@/lib/queries/marketing-performance-trend";
import type { PangsaPasarTrendData } from "@/lib/queries/pangsa-pasar-trend";
import { MatriksPerformaTable, PangsaPasarTable, TrendExpandButton } from "@/components/dashboard/marketing-trend-tables";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function SummaryCard({ label, general, actual, target }: { label: string; general: number; actual: number; target: number }) {
  const pct = target > 0 ? (actual / target) * 100 : null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-0.5 p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-display text-lg font-semibold tabular-nums">{formatQty(general)} outlet</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {formatQty(actual)}/{formatQty(target)} kantong{pct != null ? ` (${pct.toFixed(0)}%)` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

export function KinerjaMarketingSubTab() {
  const [data, setData] = useState<MarketingPerformanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNoo, setShowNoo] = useState(false);

  const [trend, setTrend] = useState<{ performance: MarketingPerformanceTrendData; pangsaPasar: PangsaPasarTrendData } | null>(null);
  const [trendExpanded, setTrendExpanded] = useState(false);
  const [trendPending, startTrendTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getKinerjaMarketingAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setData(result.data);
    });
    getKinerjaMarketingTrendAction(3).then((result) => {
      if (cancelled || !result.success) return;
      setTrend(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleTrendToggle() {
    const nextMonthsBack: 3 | 12 = trendExpanded ? 3 : 12;
    startTrendTransition(async () => {
      const result = await getKinerjaMarketingTrendAction(nextMonthsBack);
      if (result.success) {
        setTrend(result.data);
        setTrendExpanded(!trendExpanded);
      }
    });
  }

  const ownMitraId = data?.cells[0]?.MarketingUserID;
  const roster = useMemo(() => (ownMitraId && data ? (data.allMitraByMarketing[ownMitraId] ?? []) : []), [ownMitraId, data]);

  const todayISO = data?.todayISO ?? "";
  const currentMonthStartISO = todayISO ? `${todayISO.slice(0, 7)}-01` : "";
  const existingRoster = useMemo(
    () =>
      roster
        .filter((m) => !m.JoinDate || new Date(m.JoinDate).getTime() < new Date(currentMonthStartISO).getTime())
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO]
  );
  const nooRoster = useMemo(
    () =>
      roster
        .filter((m) => !!m.JoinDate && new Date(m.JoinDate).getTime() >= new Date(currentMonthStartISO).getTime())
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO]
  );

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const windowSize = Math.min(5, data.periodDays);
  const last5 = Array.from({ length: windowSize }, (_, i) => data.periodDays - windowSize + i);
  const ownTrendRow = trend?.performance.rows[0];
  const ownPangsaPasarRow = trend?.pangsaPasar.rows[0];
  const currentMonth = ownTrendRow?.months[ownTrendRow.months.length - 1];

  function RosterCard({ m }: { m: (typeof roster)[number] }) {
    const daily = data!.mitraDailyQty[m.BusinessPartnerID] ?? [];
    const total = daily.reduce((s, q) => s + q, 0);
    return (
      <Card key={m.BusinessPartnerID}>
        <CardContent className="flex flex-col gap-1.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="flex items-center gap-1 text-sm font-medium">
                {(m.Capacity ?? 0) > 0 && <Star className="size-3 fill-warning text-warning" />}
                {m.Name}
              </p>
              <p className="text-xs text-muted-foreground">
                {m.Wilayah}
                {m.Kecamatan ? ` - ${m.Kecamatan}` : ""} · Target {formatQty(m.Capacity ?? 0)}/hari
              </p>
            </div>
            <p className="shrink-0 tabular-nums font-medium">{formatQty(total)} kantong</p>
          </div>
          <div className="flex gap-1.5">
            {last5.map((i) => (
              <span key={i} className="rounded bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                {formatQty(daily[i] ?? 0)}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {currentMonth && (
        <div className="grid grid-cols-3 gap-2">
          <SummaryCard label="Existing" general={currentMonth.existing.general} actual={currentMonth.existing.bagQtyActual} target={currentMonth.existing.bagQtyTarget} />
          <SummaryCard label="NOO" general={currentMonth.noo.general} actual={currentMonth.noo.bagQtyActual} target={currentMonth.noo.bagQtyTarget} />
          <SummaryCard label="Total" general={currentMonth.total.general} actual={currentMonth.total.bagQtyActual} target={currentMonth.total.bagQtyTarget} />
        </div>
      )}

      {existingRoster.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="px-1 text-xs font-semibold text-muted-foreground">Existing</p>
          {existingRoster.map((m) => (
            <RosterCard key={m.BusinessPartnerID} m={m} />
          ))}
        </div>
      )}

      {nooRoster.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-fit gap-1 px-1 text-xs text-muted-foreground"
            onClick={() => setShowNoo((v) => !v)}
          >
            <Users className={cn("size-3.5", showNoo && "text-primary")} />
            {showNoo ? "Sembunyikan" : "Tampilkan"} {nooRoster.length} mitra NOO bulan ini
          </Button>
          {showNoo && nooRoster.map((m) => <RosterCard key={m.BusinessPartnerID} m={m} />)}
        </div>
      )}

      {ownTrendRow && (
        <div className="flex flex-col gap-2 rounded-lg border p-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Matriks Performa</p>
            <TrendExpandButton expanded={trendExpanded} onToggle={handleTrendToggle} pending={trendPending} />
          </div>
          <MatriksPerformaTable
            months={ownTrendRow.months.map((m) => m.monthStartISO)}
            existing={ownTrendRow.months.map((m) => m.existing)}
            noo={ownTrendRow.months.map((m) => m.noo)}
            total={ownTrendRow.months.map((m) => m.total)}
            title="Bulan"
          />
          {ownPangsaPasarRow && (
            <>
              <p className="text-xs font-semibold">Pangsa Pasar &amp; Kontribusi Internal</p>
              <PangsaPasarTable rows={ownPangsaPasarRow.months} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx
git commit -m "feat: Existing/NOO/Total summary, NOO roster, and trend tables in mobile Kinerja Marketing"
```

---

### Task 17: Full verification pass

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-16.

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors across the whole project.

- [ ] **Step 2: Full lint**

Run: `npx eslint .`
Expected: zero errors (warnings acceptable only if they pre-exist elsewhere in the project, unrelated to this feature).

- [ ] **Step 3: Live browser check — desktop, Super Admin**

Start the dev server (`preview_start` with the project's configured dev-server name), log in as a Super Admin account, navigate to `/mkesindo/pemasaran`. Confirm:
- The combined "Matriks Performa" and "Pangsa Pasar" tables render above the per-marketing cards, with 3 months of data.
- Clicking "Tampilkan 12 bulan" swaps every table (combined and every card) to 12 months and the button now reads "Tampilkan 3 bulan".
- Each `MarketingCard` shows its own Matriks Performa + Pangsa Pasar tables, and "Mitra Prioritas"/"Seluruh Mitra"/the new "mitra NOO bulan ini" toggle all expand independently.
- No mitra with a `JoinDate` in the current month appears under "Mitra Prioritas" or "Seluruh Mitra" — only under the NOO toggle.
- Every place that used to say "Retail" (Mitra list Tipe Mitra filter/select, Aging Tipe Mitra filter, Mitra Growth table header) now says "Outlet", and "RPA" appears as a selectable filter option where relevant.

- [ ] **Step 4: Live browser check — desktop, plain Marketing session**

Log in as a Marketing-role account, navigate to `/mkesindo/pemasaran`. Confirm:
- No combined tables render (only that Marketing's own card).
- A `TrendExpandButton` sits inline near the card header (not just inside the missing combined section) and still works.

- [ ] **Step 5: Live browser check — mobile, Marketing session**

Navigate to `/mkesindo/pemasaran-app`, open the Pemasaran tab's Kinerja Marketing sub-tab. Confirm:
- Three summary cards (Existing/NOO/Total) render at top with plausible non-zero numbers (assuming the logged-in account has an assigned Wilayah/Kecamatan with mitra).
- Existing roster renders below, NOO roster is collapsed behind its own toggle.
- Matriks Performa + Pangsa Pasar tables render at the bottom, horizontally scrollable, with the same 3→12 month expand control working.
- No company-wide/combined figures are visible anywhere on this screen.

- [ ] **Step 6: Manual DB verification — snapshot idempotency**

Via `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_dql`, run `SELECT MonthStart, COUNT(*) AS Cnt FROM DashboardMitraCapacitySnapshot GROUP BY MonthStart ORDER BY MonthStart` once, reload the pages from Steps 3-5 again, then re-run the same query — `Cnt` per `MonthStart` must be unchanged (no duplicate/overwritten rows).

- [ ] **Step 7: Cross-check Total against the existing current-period figures**

Compare the current month's `combined.total.bagQtyActual` (from the desktop combined Matriks Performa table, Step 3) against the sum of every card's `TotalQty` badge on the same page (the pre-existing `PctAchievement`/`TotalQty` figures, unchanged by this feature) — they should be close; note and explain (not silently fix) any large discrepancy, since a small one is expected from the marketing-period-setting-vs-calendar-month difference documented in Task 10.

- [ ] **Step 8: Commit any fixes found during verification**

```bash
git add -A
git commit -m "fix: verification-pass fixes for Kinerja Marketing Existing/NOO feature"
```

(Only if Steps 1-7 surfaced real issues — skip this step entirely if verification passed clean.)
