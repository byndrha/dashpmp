# Pemasaran-app Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 4 features from the spec — cross-wilayah proposal ownership merged into NOO,
Kinerja Marketing mobile redesign (absorb Log Kunjungan, price/date/delta/search/filter),
Pengiriman relocated to Beranda as a table, and richer Pengajuan cards with a new approval
Keterangan field and a map view.

**Architecture:** Query-layer changes in `src/lib/queries/*` flow automatically to both
`/mkesindo/pemasaran` (desktop) and `/mkesindo/pemasaran-app` (mobile) since they call the same
functions. UI changes are made once per tree where the spec requires both (NOO classification
consistency) and once for mobile-only where the feature is mobile-specific (Kinerja Marketing
redesign, Pengiriman relocation, Pengajuan cards).

**Tech Stack:** Next.js Server Actions, MSSQL (`getPool()`/`sql`), Postgres (`getPgPool()`, for
`akun` name resolution — this app's two-database split, established convention throughout
`marketing-wilayah.ts`/`mitra-pengajuan.ts`).

**Spec:** `docs/superpowers/specs/2026-08-19-pemasaran-app-enhancements-design.md`

## Global Constraints

- `MarketingUserID` on `DashboardMitraPengajuan`/`DashboardMarketingWilayah`/`DashboardMarketingMitra`
  is a **Postgres `akun.id`**, not an MSSQL `Salesman.SalesmanID` — name resolution always happens
  via a separate Postgres query + in-application-code merge (see `getMarketingWilayahAssignments()`
  in `marketing-wilayah.ts` for the established pattern). Never JOIN it against an MSSQL table.
- `Wilayah`/`Kecamatan` on `BusinessPartner` are derived columns (`NPWPName`/`NPWPAddress`,
  `ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui')` for Wilayah) — always alias
  through this exact expression when reading them, matching every existing query in this area.
- An admin-set "Mitra Prioritas" override (`DashboardMarketingMitra`) wins over the new
  cross-wilayah-proposal override when both exist for the same mitra — apply proposal overrides
  first, then let Prioritas overwrite on conflict when merging into one Map.
- This repo has no automated test framework — verification is `npx tsc --noEmit` +
  `npx eslint <files>` plus a live browser check via the Browser pane tool for UI tasks, and a
  live SQL check via the project's SQL MCP tool for schema/query tasks.
- The desktop `/mkesindo/pemasaran` UI is touched ONLY where a query-layer type change needs a
  matching consumer-side update to keep NOO classification consistent (Task 3) or where the new
  `Keterangan` field needs an input control (Task 1's approve/reject dialogs) — no other desktop
  UI/layout change is in scope.

---

### Task 1: `Keterangan` column + approve/reject signature changes

**Files:**
- Create: `scripts/add-pengajuan-keterangan-column.ts`
- Modify: `src/lib/queries/mitra-pengajuan.ts`
- Modify: `src/app/mkesindo/(dashboard)/pemasaran/actions.ts`
- Modify: `src/components/dashboard/pengajuan-list.tsx`

**Interfaces:**
- Produces: `PengajuanRow.Keterangan: string | null`, `approvePengajuan(pengajuanId, reviewerUserId, keterangan?: string | null)`, `rejectPengajuan(pengajuanId, reviewerUserId, keterangan: string | null)` — consumed by Task 8 (mobile display).

- [ ] **Step 1: One-off column-add script**

```ts
// One-off: adds Keterangan to DashboardMitraPengajuan (general-purpose
// approval/rejection note, replacing CatatanTolak going forward — old
// CatatanTolak values are left in place as a read-fallback, not migrated).
// Usage: npx tsx scripts/add-pengajuan-keterangan-column.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('DashboardMitraPengajuan') AND name = 'Keterangan'
    )
    ALTER TABLE DashboardMitraPengajuan ADD Keterangan VARCHAR(500) NULL
  `);
  console.log("DashboardMitraPengajuan.Keterangan ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it live**

Run: `npx tsx scripts/add-pengajuan-keterangan-column.ts`
Expected: prints "DashboardMitraPengajuan.Keterangan ready." with no errors.

- [ ] **Step 3: Update `PengajuanRow` and `getPengajuanList()`**

In `src/lib/queries/mitra-pengajuan.ts`:

```ts
export interface PengajuanRow {
  PengajuanID: number;
  MarketingUserID: string;
  MarketingNama: string;
  NamaCalon: string;
  NoHP: string | null;
  WaktuPermintaanSampai: string | null;
  QtyKantong: number | null;
  PriceLevel: number | null;
  Wilayah: string | null;
  Kecamatan: string | null;
  Alamat: string | null;
  Latitude: number | null;
  Longitude: number | null;
  Kapasitas: number | null;
  Kompetitor: string | null;
  Status: PengajuanStatus;
  CatatanTolak: string | null;
  Keterangan: string | null;
  ConvertedBusinessPartnerID: string | null;
  CreatedAt: string;
}
```

Add `dmp.Keterangan,` to the `SELECT` list in `getPengajuanList()` (right after `dmp.CatatanTolak,`).

- [ ] **Step 4: Extend `approvePengajuan()` and `rejectPengajuan()`**

```ts
export async function approvePengajuan(
  pengajuanId: number,
  reviewerUserId: string,
  keterangan?: string | null
): Promise<void> {
  // ...unchanged claim/create-mitra/set-location/create-SO logic above...

    await pool
      .request()
      .input("id", sql.Int, pengajuanId)
      .input("bpId", sql.VarChar(16), businessPartnerId)
      .input("reviewer", sql.VarChar(16), reviewerUserId)
      .input("keterangan", sql.VarChar(500), keterangan ?? null).query(`
        UPDATE DashboardMitraPengajuan
        SET Status = 'Disetujui', ConvertedBusinessPartnerID = @bpId,
            ReviewedByUserID = @reviewer, ReviewedAt = GETDATE(), Keterangan = @keterangan
        WHERE PengajuanID = @id AND Status = 'Diproses'
      `);
  // ...unchanged catch block below...
}

export async function rejectPengajuan(
  pengajuanId: number,
  reviewerUserId: string,
  keterangan: string | null
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, pengajuanId)
    .input("reviewer", sql.VarChar(16), reviewerUserId)
    .input("keterangan", sql.VarChar(500), keterangan).query(`
      UPDATE DashboardMitraPengajuan
      SET Status = 'Ditolak', Keterangan = @keterangan,
          ReviewedByUserID = @reviewer, ReviewedAt = GETDATE()
      WHERE PengajuanID = @id AND Status = 'Menunggu'
    `);
}
```

(`rejectPengajuan` stops writing `CatatanTolak` — only `Keterangan` from now on. Old rows keep
their `CatatanTolak` value untouched, read as a fallback per Step 6.)

- [ ] **Step 5: Update the desktop action + approve dialog to collect keterangan**

Read `src/app/mkesindo/(dashboard)/pemasaran/actions.ts` first to find the exact current
`approvePengajuanAction`/`rejectPengajuanAction` signatures, then thread a new optional
`keterangan?: string | null` parameter through `approvePengajuanAction` to `approvePengajuan()`,
and change `rejectPengajuanAction`'s existing `catatan` parameter to just pass straight through to
`rejectPengajuan()` unchanged (already compatible — only the query-layer target column changes).

In `src/components/dashboard/pengajuan-list.tsx`: `handleApprove(row)` currently does a bare
`confirm()` with no note-collection. Replace it with a small dialog mirroring the existing
`RejectDialog` component (lines ~90-116) — same `Textarea` + `DialogFooter` shape, labeled
"Setujui Pengajuan" / "Catatan (opsional)", calling `approvePengajuanAction(row.PengajuanID, keterangan)`
instead of the current bare `approvePengajuanAction(row.PengajuanID)`. Name the new component
`ApproveDialog`, following `RejectDialog`'s existing prop shape (`open`, `onOpenChange`, `onConfirm`, `pending`).

- [ ] **Step 6: Update the Ditolak display to the new fallback, and add a Disetujui display**

Change the existing block:
```tsx
{row.Status === "Ditolak" && row.CatatanTolak && (
  <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{row.CatatanTolak}</p>
)}
```
to:
```tsx
{row.Status === "Ditolak" && (row.Keterangan ?? row.CatatanTolak) && (
  <p className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{row.Keterangan ?? row.CatatanTolak}</p>
)}
{row.Status === "Disetujui" && row.Keterangan && (
  <p className="rounded-md bg-primary/10 px-2 py-1.5 text-xs text-primary">{row.Keterangan}</p>
)}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/mitra-pengajuan.ts src/app/mkesindo/\(dashboard\)/pemasaran/actions.ts src/components/dashboard/pengajuan-list.tsx scripts/add-pengajuan-keterangan-column.ts`
— both clean. Live check via the project's SQL MCP tool:
`SELECT TOP 1 Keterangan FROM DashboardMitraPengajuan` — expect no error (column exists).

- [ ] **Step 8: Commit**

```bash
git add scripts/add-pengajuan-keterangan-column.ts src/lib/queries/mitra-pengajuan.ts "src/app/mkesindo/(dashboard)/pemasaran/actions.ts" src/components/dashboard/pengajuan-list.tsx
git commit -m "feat: add general-purpose Keterangan field for Pengajuan approve/reject"
```

---

### Task 2: Cross-wilayah proposal ownership override

**Files:**
- Modify: `src/lib/queries/marketing-wilayah.ts`
- Modify: `src/app/mkesindo/(dashboard)/pemasaran/page.tsx`
- Modify: `src/lib/queries/marketing-performance.ts`
- Modify: `src/lib/queries/marketing-performance-trend.ts`

**Interfaces:**
- Produces: `getCrossWilayahProposalOverrides(assignments: MarketingWilayahAssignment[]): Promise<Map<string, string>>` in `marketing-wilayah.ts` — consumed by Task 3 (merged into the ownership-resolution override map both `getMarketingPerformance()` and `getMarketingPerformanceTrend()` already build).
- `src/app/mkesindo/pemasaran-app/actions.ts` is NOT touched by this task — `getKinerjaMarketingAction()` there just calls `getMarketingPerformance()` and narrows the result, so it inherits the new overrides automatically once Step 2 lands.

- [ ] **Step 1: Write `getCrossWilayahProposalOverrides()`**

Append to `src/lib/queries/marketing-wilayah.ts` (same file as `resolveResponsibleMarketing`,
`buildMitraOverrideMap`):

```ts
// Mitra whose approved Pengajuan was proposed by a marketing outside that
// mitra's own Wilayah/Kecamatan coverage — the proposer stays responsible
// regardless of territory, same override tier as an admin-set Mitra
// Prioritas assignment (both feed the same override Map; Prioritas wins on
// conflict — merged at each call site, not here). Computed live off
// DashboardMitraPengajuan's already-permanent MarketingUserID +
// ConvertedBusinessPartnerID link — no migration needed, this covers every
// historical approval automatically.
//
// MarketingUserID here is a Postgres akun.id (same convention as
// getMarketingWilayahAssignments above) — resolved to a name via a
// separate Postgres query, never JOINed against an MSSQL table.
export async function getCrossWilayahProposalOverrides(
  assignments: MarketingWilayahAssignment[]
): Promise<Map<string, string>> {
  const mssqlPool = await getPool();
  const pgPool = getPgPool();

  const result = await mssqlPool.request().query(`
    SELECT p.MarketingUserID, p.ConvertedBusinessPartnerID AS BusinessPartnerID,
           ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           bp.NPWPAddress AS Kecamatan
    FROM DashboardMitraPengajuan p
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = p.ConvertedBusinessPartnerID
    WHERE p.Status = 'Disetujui' AND p.ConvertedBusinessPartnerID IS NOT NULL
  `);
  const rows = result.recordset as {
    MarketingUserID: string;
    BusinessPartnerID: string;
    Wilayah: string;
    Kecamatan: string | null;
  }[];

  const akunIds = [...new Set(rows.map((r) => Number(r.MarketingUserID)).filter(Number.isFinite))];
  const nameMap = new Map<number, string>();
  if (akunIds.length > 0) {
    const namesResult = await pgPool.query(`SELECT id, nama FROM akun WHERE id = ANY($1::int[])`, [akunIds]);
    for (const r of namesResult.rows as { id: number; nama: string }[]) nameMap.set(r.id, r.nama);
  }

  const overrides = new Map<string, string>();
  for (const r of rows) {
    const marketingNama = nameMap.get(Number(r.MarketingUserID));
    if (!marketingNama) continue;
    // "Cross-wilayah" = no assignment row for THIS marketing covers the
    // mitra's actual Wilayah/Kecamatan — same matching order as
    // resolveResponsibleMarketing() itself (specific Kecamatan, then
    // whole-Wilayah), just checked in the opposite direction (does this
    // marketing's own coverage include this mitra, not "who covers it").
    const ownAssignments = assignments.filter((a) => a.MarketingNama === marketingNama);
    const covered = ownAssignments.some(
      (a) => a.Wilayah === r.Wilayah && (a.Kecamatan === r.Kecamatan || a.Kecamatan === null)
    );
    if (!covered) overrides.set(r.BusinessPartnerID, marketingNama);
  }
  return overrides;
}
```

- [ ] **Step 2: Wire into `getMarketingPerformance()`**

In `src/lib/queries/marketing-performance.ts`, change the top of `getMarketingPerformance()`:

```ts
export async function getMarketingPerformance(): Promise<MarketingPerformanceData> {
  const [period, assignments, marketingUsers, mitraAssignments] = await Promise.all([
    getMarketingPeriodSetting(),
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
    getMarketingMitraAssignments(),
  ]);
  const crossWilayahOverrides = await getCrossWilayahProposalOverrides(assignments);
  const prioritasOverrides = buildMitraOverrideMap(mitraAssignments);
  // Prioritas wins on conflict — spread crossWilayah first so prioritas
  // entries overwrite any matching key.
  const mitraOverrides = new Map([...crossWilayahOverrides, ...prioritasOverrides]);
  // ...rest of the function body is unchanged from here, but now also
  // needs prioritasOverrides/crossWilayahOverrides available inside the
  // mitra-loop below for Task 3's per-row flags — see Task 3 for that part.
```

Add `getCrossWilayahProposalOverrides` to the `import { ... } from "@/lib/queries/marketing-wilayah"`
line at the top of the file.

- [ ] **Step 3: Wire into `getMarketingPerformanceTrend()`**

In `src/lib/queries/marketing-performance-trend.ts`, same pattern — after the existing
`const mitraOverrides = buildMitraOverrideMap(mitraAssignments);` line (line 110), change to:

```ts
  const crossWilayahOverrides = await getCrossWilayahProposalOverrides(assignments);
  const prioritasOverrides = buildMitraOverrideMap(mitraAssignments);
  const mitraOverrides = new Map([...crossWilayahOverrides, ...prioritasOverrides]);
```

Add `getCrossWilayahProposalOverrides` to this file's existing import from `marketing-wilayah.ts`.
The `mitraMeta` build loop (lines 113-118) already uses `mitraOverrides` via
`resolveResponsibleMarketing(...)` — ownership resolution for the trend is automatically correct
once this Map includes the new overrides. Task 3 covers the separate NOO-bucketing change this
same file needs (whether a mitra counts as NOO, not just who owns it).

- [ ] **Step 4: Wire into desktop `pemasaran/page.tsx`**

Read `src/app/mkesindo/(dashboard)/pemasaran/page.tsx` first to find its exact existing
`buildMitraOverrideMap(...)` call site, and apply the identical merge pattern from Step 2
(`crossWilayahOverrides` first, `prioritasOverrides`/existing call second, merged into one Map)
before it's passed to `resolveResponsibleMarketing`/`MarketingPerformancePanel`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` (repo-wide) and `npx eslint` on all 5 modified files — both clean.
Live check via the project's SQL MCP tool: run the exact SELECT from Step 1's query manually
(swap in a real `Disetujui` PengajuanID's data) and confirm it returns sensible rows — at least 0
rows without erroring, and if any exist, spot-check one against `DashboardMarketingWilayah`
manually to confirm the "cross-wilayah" classification looks right by hand.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/marketing-wilayah.ts "src/app/mkesindo/(dashboard)/pemasaran/page.tsx" src/lib/queries/marketing-performance.ts src/lib/queries/marketing-performance-trend.ts
git commit -m "feat: cross-wilayah Pengajuan proposals grant permanent mitra ownership"
```

---

### Task 3: NOO classification — roster flags + monthly trend OR-condition + desktop consistency

**Files:**
- Modify: `src/lib/queries/marketing-performance.ts`
- Modify: `src/lib/queries/marketing-performance-trend.ts`
- Modify: `src/components/dashboard/marketing-performance-panel.tsx`

**Interfaces:**
- Consumes: `crossWilayahOverrides`/`prioritasOverrides` (Task 2, now built in both query files).
- Produces: `MarketingScopeAllMitra.IsCrossWilayahProposal: boolean`, `MarketingScopeAllMitra.IsPriorityOverride: boolean`, `MarketingScopeAllMitra.PriceLevel: number | null` — consumed by Tasks 4/5 (mobile roster split + Harga display) and this task's own desktop consistency update.

- [ ] **Step 1: Extend `MarketingScopeAllMitra` and the roster-building loop**

In `src/lib/queries/marketing-performance.ts`:

```ts
export interface MarketingScopeAllMitra {
  BusinessPartnerID: string;
  Name: string;
  Wilayah: string;
  Kecamatan: string | null;
  Capacity: number | null;
  JoinDate: string | null;
  PriceLevel: number | null;
  // A mitra qualifying via cross-wilayah Pengajuan ownership (Task 2) counts
  // as NOO every month it's resolved into this scope, not just its JoinDate
  // month — see marketing-performance-trend.ts's isNoo for the same rule
  // applied historically.
  IsCrossWilayahProposal: boolean;
  // Shown separately in the roster as "Mitra Prioritas", same admin-set
  // DashboardMarketingMitra override desktop already curates.
  IsPriorityOverride: boolean;
}
```

Add `PriceLevel` to the `mitraResult` SELECT (the plain `BusinessPartner` query, lines 130-140):

```ts
    pool.request().query(`
      SELECT
          BusinessPartnerID,
          Name,
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          Capacity,
          JoinDate,
          PriceLevel
      FROM BusinessPartner
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
```

Update the row-shape cast (lines 175-182) and the roster-push block (lines 188-195) to carry the
three new fields through, using the `prioritasOverrides`/`crossWilayahOverrides` Maps from Task 2's
Step 2:

```ts
    roster.push({
      BusinessPartnerID: r.BusinessPartnerID,
      Name: r.Name,
      Wilayah: r.Wilayah,
      Kecamatan: r.Kecamatan,
      Capacity: r.Capacity,
      JoinDate: r.JoinDate,
      PriceLevel: r.PriceLevel,
      IsCrossWilayahProposal: crossWilayahOverrides.has(r.BusinessPartnerID) && !prioritasOverrides.has(r.BusinessPartnerID),
      IsPriorityOverride: prioritasOverrides.has(r.BusinessPartnerID),
    });
```

(The `IsCrossWilayahProposal` check excludes anything already claimed by an admin Prioritas
override — a mitra with both shows only as Prioritas, matching Task 2's precedence rule, and
avoiding a double-listing between the "Mitra Prioritas" and "Mitra NOO" sections in Task 5.)

- [ ] **Step 2: Monthly trend OR-condition**

In `src/lib/queries/marketing-performance-trend.ts`, the `MitraMeta` interface and its build loop
need the same flag. Add to `MitraMeta`:

```ts
interface MitraMeta {
  BusinessPartnerID: string;
  JoinDate: string | null;
  MarketingUserID: string | null;
  IsCrossWilayahProposal: boolean;
}
```

In the `mitraMeta` build loop (lines 113-118), set it from `crossWilayahOverrides` (already built
in Task 2 Step 3), excluding anything Prioritas already claims (same precedence rule as Task 3
Step 1):

```ts
  for (const r of mitraResult.recordset as { BusinessPartnerID: string; Wilayah: string; Kecamatan: string | null; JoinDate: string | null }[]) {
    const marketingName = resolveResponsibleMarketing(r.BusinessPartnerID, r.Wilayah, r.Kecamatan, assignments, mitraOverrides);
    const user = marketingName ? marketingByName.get(marketingName) : undefined;
    mitraMeta.set(r.BusinessPartnerID, {
      BusinessPartnerID: r.BusinessPartnerID,
      JoinDate: r.JoinDate,
      MarketingUserID: user?.UserID ?? null,
      IsCrossWilayahProposal: crossWilayahOverrides.has(r.BusinessPartnerID) && !prioritasOverrides.has(r.BusinessPartnerID),
    });
  }
```

Then in the per-month loop (line 165), change the NOO condition from pure JoinDate to the OR:

```ts
      const isNoo = new Date(meta.JoinDate).getTime() >= monthStart.getTime() || meta.IsCrossWilayahProposal;
```

Leave line 164's skip condition (`if (meta.JoinDate == null || new Date(meta.JoinDate).getTime() >= nextMonthStart.getTime()) continue;`)
**unchanged** — a cross-wilayah-proposed mitra still only counts from its own JoinDate onward, it
doesn't retroactively appear in months before it existed; only the NOO-vs-Existing bucketing
*after* that point changes.

- [ ] **Step 3: Desktop consistency**

In `src/components/dashboard/marketing-performance-panel.tsx`, the `isNoo`/`isExisting` helpers
(lines 386-389) need the same OR-condition. Since `allMitra`/`mitraPrioritas` here are
`MarketingScopeAllMitra[]` (same type extended in Step 1), change:

```ts
  const isExisting = (m: { JoinDate: string | null; IsCrossWilayahProposal: boolean }) =>
    (!m.JoinDate || new Date(m.JoinDate).getTime() < new Date(currentMonthStartISO).getTime()) && !m.IsCrossWilayahProposal;
  const isNoo = (m: { JoinDate: string | null; IsCrossWilayahProposal: boolean }) =>
    (!!m.JoinDate && new Date(m.JoinDate).getTime() >= new Date(currentMonthStartISO).getTime()) || m.IsCrossWilayahProposal;
```

And update the 3 call sites (`sortedMitra`/`sortedAllMitra`/`sortedNooMitra`, lines 392-401) from
`isExisting(m.JoinDate)`/`isNoo(m.JoinDate)` to `isExisting(m)`/`isNoo(m)` (passing the whole row
now that the helpers need `IsCrossWilayahProposal` too, not just `JoinDate`).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` (repo-wide) and `npx eslint` on all 3 files — both clean. Cross-check per
the spec's own testing note: the current-month `Total` figures from `getMarketingPerformanceTrend()`
must still equal `getMarketingPerformance()`'s own current-period figures (Total = Existing + NOO
either way — this task only redraws the Existing/NOO boundary, the Total is unaffected) — spot
check via the SQL MCP tool or a live browser comparison between the two views for one marketing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/marketing-performance.ts src/lib/queries/marketing-performance-trend.ts src/components/dashboard/marketing-performance-panel.tsx
git commit -m "feat: extend NOO classification to include cross-wilayah proposal ownership"
```

---

### Task 4: Mobile Kinerja Marketing — clickable date box + Hasil Kunjungan

**Files:**
- Modify: `src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx`

**Interfaces:**
- Consumes: `getVisitLogDetailAction`, `saveVisitLogAction` (`@/app/mkesindo/pemasaran-app/actions`, already exist, already used by `log-kunjungan-sub-tab.tsx`).

- [ ] **Step 1: Read the desktop precedent first**

Read `src/components/dashboard/marketing-performance-panel.tsx`'s `MitraDayCell` component in
full (search for its definition, roughly lines 115-230 per earlier research) — it's the exact
interaction (Popover + `getMarketingVisitLogAction`/`saveMarketingVisitLogAction`, a `hasEntry` dot)
this task ports to mobile, using a Dialog instead of a Popover (mobile's existing pattern, per
`log-kunjungan-sub-tab.tsx`'s own Dialog) and mobile's own already-scoped
`getVisitLogDetailAction`/`saveVisitLogAction` (not the desktop-named ones — different action
files, same underlying `marketing-visit-log.ts` query functions).

- [ ] **Step 2: Add per-day click handling to `RosterCard`**

Replace the current non-interactive day badges (lines 126-132):

```tsx
          <div className="flex gap-1.5">
            {last5.map((i) => (
              <span key={i} className="rounded bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                {formatQty(daily[i] ?? 0)}
              </span>
            ))}
          </div>
```

with a new `DayBox` sub-component per day, showing the date above, qty in the middle, delta below,
green background when that mitra+date has a visit-log entry, opening a Dialog on click:

```tsx
function DayBox({
  businessPartnerId,
  dateISO,
  qty,
  prevQty,
  hasEntry,
  onOpen,
}: {
  businessPartnerId: string;
  dateISO: string;
  qty: number;
  prevQty: number | null;
  hasEntry: boolean;
  onOpen: () => void;
}) {
  const delta = prevQty != null ? qty - prevQty : null;
  const dayLabel = dateISO.slice(8, 10);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-12 shrink-0 flex-col items-center gap-0.5 rounded px-1.5 py-1 text-[11px]",
        hasEntry ? "bg-primary/15" : "bg-muted"
      )}
    >
      <span className="text-[9px] text-muted-foreground">{dayLabel}</span>
      <span className="tabular-nums font-medium">{formatQty(qty)}</span>
      {delta != null && (
        <span className={cn("flex items-center gap-0.5 text-[9px]", delta >= 0 ? "text-primary" : "text-destructive")}>
          {delta >= 0 ? <ArrowUp className="size-2.5" /> : <ArrowDown className="size-2.5" />}
          {formatQty(Math.abs(delta))}
        </span>
      )}
    </button>
  );
}
```

Add `ArrowUp`, `ArrowDown` to the `lucide-react` import line.

- [ ] **Step 3: Wire dates, visit-log state, and the dialog into `RosterCard`/the parent**

`RosterCard` needs the actual calendar dates for each `last5` index (currently only qty is
tracked, no date string) — derive from `data.rangeStartISO` + index, matching how
`marketing-performance.ts`'s `DailyQty` array is indexed (`dayIndex` = days since `rangeStart`).
Add a per-mitra-per-date visit-log-entry lookup: fetch lazily on dialog open (matching
`marketing-visit-log.ts`'s own documented "fetched only when clicked" design, same as desktop) via
`getVisitLogDetailAction(businessPartnerId, dateISO)`, save via `saveVisitLogAction`. Track
`hasEntry` per date with a local `Set<string>` keyed `${businessPartnerId}|${dateISO}`, updated
optimistically after a successful save so the box turns green without a full reload — mirror
`log-kunjungan-sub-tab.tsx`'s existing `editingIdRef`/stale-response-guard pattern for the
save-in-flight dialog, adapted to a per-day key instead of per-mitra.

- [ ] **Step 4: Verify — static**

Run: `npx tsc --noEmit` and `npx eslint src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx` — both clean.

- [ ] **Step 5: Verify — live**

Using the Browser pane tool, log in as a marketing user, open Kinerja Marketing, click a day box
for a mitra, confirm the Hasil Kunjungan dialog opens, type a note, save, confirm the box turns
green and the dialog closes. Re-open the same box, confirm the saved note is pre-filled.

- [ ] **Step 6: Commit**

```bash
git add src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx
git commit -m "feat: clickable quantity boxes open Hasil Kunjungan in mobile Kinerja Marketing"
```

---

### Task 5: Mobile Kinerja Marketing — Harga, 3-way roster split, search/filter, date-range

**Files:**
- Modify: `src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx`
- Modify: `src/app/mkesindo/pemasaran-app/actions.ts`

**Interfaces:**
- Consumes: `MarketingScopeAllMitra.PriceLevel`/`IsCrossWilayahProposal`/`IsPriorityOverride` (Task 3).

- [ ] **Step 1: Fetch Prioritas roster + PriceLevel options in `getKinerjaMarketingAction`**

`getKinerjaMarketingAction` already narrows `allMitraByMarketing` to the caller's own roster — no
change needed there for the Prioritas split, since `IsPriorityOverride` now lives directly on each
roster row (Task 3). Add `getPriceLevelOptions()` (already imported in this file for a different
action) to this action's `Promise.all` if Harga needs Rupiah conversion client-side, OR resolve
`PriceLevel → Rupiah` server-side before returning — prefer server-side (simpler client, one
lookup instead of threading `PriceLevelOption[]` through every card): add a `hargaByLevel: Map` or
inline `Harga: number | null` onto each returned roster row before sending it to the client.

- [ ] **Step 2: 3-way roster split in `kinerja-marketing-sub-tab.tsx`**

Replace the current `existingRoster`/`nooRoster` split (lines 77-90) with three:

```tsx
  const prioritasRoster = useMemo(
    () => roster.filter((m) => m.IsPriorityOverride).sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster]
  );
  const semuaMitraRoster = useMemo(
    () =>
      roster
        .filter((m) => !m.IsPriorityOverride && !m.IsCrossWilayahProposal && (!m.JoinDate || new Date(m.JoinDate).getTime() < new Date(currentMonthStartISO).getTime()))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO]
  );
  const nooRoster = useMemo(
    () =>
      roster
        .filter((m) => !m.IsPriorityOverride && (m.IsCrossWilayahProposal || (!!m.JoinDate && new Date(m.JoinDate).getTime() >= new Date(currentMonthStartISO).getTime())))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO]
  );
```

Render three sections instead of two (`existingRoster`'s current block becomes "Mitra Prioritas"
always-visible + "Semua Mitra" always-visible, `nooRoster`'s existing toggle-button block stays as
"Mitra NOO", same collapsible pattern).

- [ ] **Step 3: Search + Wilayah/Kecamatan filter + date-range control**

Add local state: `const [search, setSearch] = useState("")`, `const [wilayahFilter, setWilayahFilter] = useState<string | null>(null)`,
`const [windowDays, setWindowDays] = useState<5 | 7 | 30>(5)`. Apply `search`/`wilayahFilter` as an
additional `.filter()` step on each of the three rosters (name substring match, case-insensitive;
Wilayah/Kecamatan exact match against a dropdown populated from `[...new Set(roster.map(m => m.Wilayah))]`).
Replace `const windowSize = Math.min(5, data.periodDays);` (line 101) with
`const windowSize = Math.min(windowDays, data.periodDays);` — if `data.periodDays` doesn't already
cover 30 days by default, note this as a follow-up rather than widening the query window in this
task (out of scope per the spec unless testing reveals it's needed — check `getMarketingPeriodSetting()`'s
default before deciding).

- [ ] **Step 4: Harga on each `RosterCard`**

Add a line to `RosterCard`'s header block showing `formatRupiah(m.Harga)` when non-null, next to
the existing Target/hari line.

- [ ] **Step 5: Verify — static**

Run: `npx tsc --noEmit` and `npx eslint src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx src/app/mkesindo/pemasaran-app/actions.ts` — both clean.

- [ ] **Step 6: Verify — live**

Using the Browser pane tool: confirm all 3 roster sections render with sensible content, confirm
search narrows results, confirm the Wilayah filter narrows results, confirm switching the
date-range control changes how many day-boxes render per card, confirm Harga shows on cards where
a mitra has a PriceLevel set.

- [ ] **Step 7: Commit**

```bash
git add src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx src/app/mkesindo/pemasaran-app/actions.ts
git commit -m "feat: Harga, Mitra Prioritas/NOO roster split, search and filters in mobile Kinerja Marketing"
```

---

### Task 6: Remove "Log Kunjungan" sub-tab

**Files:**
- Modify: `src/components/pemasaran-app/pemasaran-tab.tsx`
- Delete: `src/components/pemasaran-app/log-kunjungan-sub-tab.tsx`

- [ ] **Step 1: Remove the tab entry and import**

In `pemasaran-tab.tsx`: remove `{ key: "kunjungan", label: "Log Kunjungan" }` from `SUB_TABS`,
remove the `"kunjungan"` case from the `visited.has(...)`/render block, remove the
`LogKunjunganSubTab` import, remove `"kunjungan"` from the `SubTabKey` union type. If `"kinerja"`
is no longer the only reasonable default, leave `activeSubTab`'s initial value as `"kinerja"`
(unchanged — still the sensible default tab).

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/pemasaran-app/log-kunjungan-sub-tab.tsx
```

- [ ] **Step 3: Verify — static**

Run: `npx tsc --noEmit` (repo-wide, confirms nothing else imports the deleted file) and
`npx eslint src/components/pemasaran-app/pemasaran-tab.tsx` — both clean.

- [ ] **Step 4: Verify — live**

Using the Browser pane tool, confirm the "Pemasaran" tab now shows only Kinerja Marketing,
Pengiriman, Pengajuan (Pengiriman's own removal is Task 7 — at this point it's still present).

- [ ] **Step 5: Commit**

```bash
git add src/components/pemasaran-app/pemasaran-tab.tsx
git commit -m "feat: remove Log Kunjungan sub-tab, absorbed into Kinerja Marketing"
```

---

### Task 7: Pengiriman → table in Beranda, remove Pengiriman sub-tab

**Files:**
- Modify: `src/components/pemasaran-app/beranda-tab.tsx`
- Modify: `src/components/pemasaran-app/pemasaran-tab.tsx`
- Modify: `src/app/mkesindo/pemasaran-app/actions.ts` (if `getWilayahDeliveryAction` needs to move — it can stay where it is, just gets a new caller)
- Delete: `src/components/pemasaran-app/pengiriman-sub-tab.tsx`

**Interfaces:**
- Consumes: `getWilayahDeliveryAction` (existing, already in `actions.ts`, no signature change).

- [ ] **Step 1: Add the table section to `beranda-tab.tsx`**

Add the same `useState<PemasaranWilayahDeliveryRow[] | null>`/`useEffect(getWilayahDeliveryAction)`
fetch pattern `pengiriman-sub-tab.tsx` already has, and a new Card placed after the existing
"Perbandingan Penjualan" Card (before "Top Mitra — Piutang Tertinggi"):

```tsx
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pengiriman per Wilayah</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Wilayah</th>
                <th className="px-3 py-2 text-right font-medium">Bulan Ini</th>
                <th className="px-3 py-2 text-right font-medium">Bulan Lalu</th>
                <th className="px-3 py-2 text-right font-medium">%</th>
                <th className="px-3 py-2 text-right font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {delivery?.map((r) => (
                <tr key={r.Wilayah} className="border-b last:border-0">
                  <td className="px-3 py-2">{r.Wilayah}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.AvgPerHariThisMonth.toLocaleString("id-ID", { maximumFractionDigits: 1 })}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.AvgPerHariLastMonth.toLocaleString("id-ID", { maximumFractionDigits: 1 })}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", r.PctChange != null && r.PctChange >= 0 ? "text-primary" : "text-destructive")}>
                    {r.PctChange != null ? `${r.PctChange.toFixed(1)}%` : "-"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.TotalTarget.toLocaleString("id-ID", { maximumFractionDigits: 1 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
```

Add the `getWilayahDeliveryAction` import and a `delivery` state variable fetched the same way
`sales`/`topPiutang` already are in this file's existing `useEffect`.

- [ ] **Step 2: Remove the "Pengiriman" sub-tab entry**

In `pemasaran-tab.tsx`: remove `{ key: "pengiriman", label: "Pengiriman" }` from `SUB_TABS`, the
`"pengiriman"` render case, the `PengirimanSubTab` import, and `"pengiriman"` from `SubTabKey`.

- [ ] **Step 3: Delete the file**

```bash
git rm src/components/pemasaran-app/pengiriman-sub-tab.tsx
```

- [ ] **Step 4: Verify — static**

Run: `npx tsc --noEmit` (repo-wide) and `npx eslint src/components/pemasaran-app/beranda-tab.tsx src/components/pemasaran-app/pemasaran-tab.tsx` — both clean.

- [ ] **Step 5: Verify — live**

Using the Browser pane tool, confirm Beranda now shows the Pengiriman table with the same figures
the old per-Wilayah panel showed, and confirm the "Pemasaran" tab no longer has a Pengiriman entry.

- [ ] **Step 6: Commit**

```bash
git add src/components/pemasaran-app/beranda-tab.tsx src/components/pemasaran-app/pemasaran-tab.tsx
git commit -m "feat: move Pengiriman to Beranda as a table, remove Pengiriman sub-tab"
```

---

### Task 8: Pengajuan card enhancements — badges, info, Keterangan, map

**Files:**
- Modify: `src/components/pemasaran-app/pengajuan-sub-tab.tsx`

**Interfaces:**
- Consumes: `PengajuanRow.Keterangan` (Task 1), `getPriceLevelOptions`/`PriceLevelOption` (`@/lib/queries/mitra`, already imported elsewhere in this app), `MitraLocationMap` (`@/components/dashboard/mitra-location-map`, dynamic-imported per `mitra-location-field.tsx`'s existing pattern).

- [ ] **Step 1: Partner-type + Potensial badges**

Add a shared classification helper (or inline constants matching `mitra-pengajuan.ts`'s
`AGEN_QTY_THRESHOLD`/`RPA_QTY_THRESHOLD` — read that file's exact values first, don't guess):

```tsx
function classifyPartnerType(qtyKantong: number | null): "Outlet" | "Agen" | "RPA" | null {
  if (qtyKantong == null) return null;
  if (qtyKantong > 100) return "RPA";
  if (qtyKantong > 10) return "Agen";
  return "Outlet";
}
```

Render a `Badge` for the result (if non-null) and a separate `Badge` "Potensial" when
`r.QtyKantong != null`, next to the existing Status badge.

- [ ] **Step 2: Surface WaktuPermintaanSampai, QtyKantong, Harga**

Fetch `getPriceLevelOptionsAction()` once (already exported in `actions.ts`) in this component's
own `useEffect` alongside the existing Pengajuan list fetch, build a `Level → Rupiah` map, and
render a line per card showing `formatDate/formatTime(r.WaktuPermintaanSampai)`,
`r.QtyKantong` kantong, and the resolved Harga for `r.PriceLevel` (fallback "-" if either is null).

- [ ] **Step 3: Keterangan display**

```tsx
{r.Status !== "Menunggu" && (r.Keterangan ?? r.CatatanTolak) && (
  <p className={cn("rounded-md px-2 py-1.5 text-xs", r.Status === "Ditolak" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")}>
    {r.Keterangan ?? r.CatatanTolak}
  </p>
)}
```

(Replaces the current `r.Status === "Ditolak" && r.CatatanTolak` block, extending it to Disetujui
too and preferring the new field.)

- [ ] **Step 4: Click-to-map dialog**

Read `src/components/dashboard/mitra-location-map.tsx` first to confirm its exact prop interface
(it's dynamically imported elsewhere with `ssr: false` — follow the same import pattern). Make
each `Card` clickable (only when `r.Latitude`/`r.Longitude` are both non-null) opening a Dialog
containing the map centered on that position (read-only — no pin-drag save handler wired, since
this is a display-only view of an already-submitted Pengajuan) plus a link/button:

```tsx
<a
  href={`https://www.google.com/maps?q=${r.Latitude},${r.Longitude}`}
  target="_blank"
  rel="noopener noreferrer"
  className="..."
>
  Buka di Google Maps
</a>
```

- [ ] **Step 5: Verify — static**

Run: `npx tsc --noEmit` and `npx eslint src/components/pemasaran-app/pengajuan-sub-tab.tsx` — both clean.

- [ ] **Step 6: Verify — live**

Using the Browser pane tool: confirm badges render correctly for a few different QtyKantong
values, confirm WaktuPermintaanSampai/QtyKantong/Harga show, confirm a Ditolak/Disetujui card
shows its Keterangan, confirm clicking a card with a location opens the map dialog and the Google
Maps link has the right coordinates.

- [ ] **Step 7: Commit**

```bash
git add src/components/pemasaran-app/pengajuan-sub-tab.tsx
git commit -m "feat: richer Pengajuan cards — classification, Keterangan, map view"
```

---

## Final check

After all 8 tasks: `npx tsc --noEmit` and a full lint pass across the whole repo, then a
walkthrough in the Browser pane tool of the complete Kinerja Marketing flow (search, filter,
date-range, click a day box, verify green highlight, verify Harga) plus Beranda's new Pengiriman
table plus a full Pengajuan card (badges, info, map) — logged in as a real marketing user whose
roster includes at least one Mitra Prioritas and, if any exist in live data, one cross-wilayah
proposal case.
