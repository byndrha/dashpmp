# Pemasaran-app Enhancements — Design Spec

## Context

Four related but separable improvements to `/mkesindo/pemasaran-app` (mobile, marketing-rep-facing)
and, where the query layer is shared, `/mkesindo/pemasaran` (desktop):

1. Mitra proposed by a marketing person outside their own wilayah should stay that marketing's
   responsibility, not fall to whoever owns the wilayah.
2. The "Kinerja Marketing" sub-tab absorbs "Log Kunjungan" (visit logging becomes a click on a
   mitra's quantity box, not a separate tab) and gains price, date/delta labels, a "visited today"
   highlight, and search/filter.
3. "Pengiriman" sub-tab becomes a table and moves out of the "Pemasaran" bottom-nav tab into
   "Beranda".
4. "Pengajuan" cards surface more of the data they already have, plus a new approval-keterangan
   field, plus a map view.

All four are scoped to files already read directly during brainstorming — see "Data model
changes" and "Architecture" below for exact functions/lines. `pemasaran-app`'s UI components
(`src/components/pemasaran-app/*`) and desktop's (`src/components/dashboard/*`) are **separate,
duplicated implementations** sharing only the query layer (`src/lib/queries/*`) — a query-layer
change flows to both automatically; a UI change must be made once per tree. Desktop's Kinerja
Marketing UI (`marketing-performance-panel.tsx`) already has the clickable-quantity-box +
visit-log-popover pattern this spec ports to mobile — it is the direct precedent, not something
invented here.

## Decisions made during brainstorming

- **Terminology**: "NOO" already means "New Open Outlet" (`JoinDate` within the current month) per
  the 2026-08-18 Existing/NOO spec, already shipped (`aae3354`, `dfc0c02`, and related commits).
  The user's new "cross-wilayah proposed mitra" concept is **merged into the same NOO bucket**,
  not given a separate name — explicit, confirmed decision, made with the consequence spelled out
  and accepted: **NOO becomes a union of two independent conditions** (see Architecture §2), and a
  mitra qualifying via the cross-wilayah-proposal condition counts as NOO **every month**, not just
  its join month. Mitra qualifying purely by `JoinDate` keep their existing, unchanged
  period-based behavior — "mitra yang baru gabung bulan ini atau bulan lalu akan tetap tercatat
  menurut periodenya masing-masing" (user's own words). This will shift already-displayed
  Existing/NOO/Total trend numbers for any marketing with cross-wilayah proposals in their history
  — accepted explicitly, twice, not a side effect to soften.
- **Retroactive, no migration needed.** The cross-wilayah-ownership rule applies to *all* approved
  Pengajuan, past and future — but this requires no backfill/migration script, because
  `DashboardMitraPengajuan.MarketingUserID` + `ConvertedBusinessPartnerID` already permanently
  link proposer → resulting mitra for every historical approval. The rule is computed live off
  data that already exists.
- **Resolution precedence**: an admin-set "Mitra Prioritas" override (`DashboardMarketingMitra`)
  wins over a proposal-derived override if both exist for the same mitra — Prioritas is a
  deliberate admin correction and should not be silently shadowed by the automatic rule.
- **"Penyesuaian tampilan transaksi" filter** = a date-range control for how many days of quantity
  boxes render per mitra card (5 hari / 7 hari / 1 bulan), not a transaction-type filter.
- **"Potensial" label** = automatic, derived from `QtyKantong` being filled on the Pengajuan row —
  no new field, no manual flag.
- **Partner-type label on Pengajuan cards** uses the already-shipped 3-tier Outlet/Agen/RPA
  classification (qty ≤10 / 10–100 / >100, same thresholds `approvePengajuan()` already applies at
  conversion time) rather than the user's literal "[Retail/Agen]" wording — "Retail" was renamed
  to "Outlet" everywhere in the 2026-08-18 rename; a pending (not-yet-approved) Pengajuan doesn't
  have this classification stored yet, so the card computes a **preview** using the same
  thresholds, not a stored field.
- **Approval keterangan**: a new, general-purpose `Keterangan` column (not a rename of the
  existing `CatatanTolak`, to avoid a destructive migration) — filled optionally at both approve
  and reject time, going forward. Old rejected rows keep displaying via `CatatanTolak` as a
  fallback (`Keterangan ?? CatatanTolak`) since they predate the new column.

## Data model changes

**MSSQL — `DashboardMitraPengajuan`** (one-off ALTER script, run once via `npx tsx`, kept in
`scripts/` per this repo's convention):

```sql
ALTER TABLE DashboardMitraPengajuan ADD Keterangan VARCHAR(500) NULL;
```

`PengajuanRow` (`src/lib/queries/mitra-pengajuan.ts:34-54`) gains `Keterangan: string | null`.
`approvePengajuan(pengajuanId, reviewerUserId, keterangan?: string | null)` (line 192) and
`rejectPengajuan(...)` (line 299) both write to this column now — `rejectPengajuan` stops writing
`CatatanTolak` for new rejections (kept only as a read-fallback for old rows).

No other schema change. Existing/NOO computation and cross-wilayah ownership are entirely derived
from already-stored columns (`DashboardMitraPengajuan.MarketingUserID`/`ConvertedBusinessPartnerID`,
`BusinessPartner.JoinDate`, `DashboardMarketingWilayah`, `DashboardMarketingMitra`).

## Architecture

### 1. Cross-wilayah ownership → `buildMitraOverrideMap()`

`src/lib/queries/marketing-wilayah.ts` — `resolveResponsibleMarketing()` (line 258) itself is
**unchanged**; it already takes a pre-built `mitraOverrides?: Map<string, string>` and lets it win
first. The map just needs more entries.

New function, same file:

```ts
// Mitra whose approved Pengajuan was proposed by a marketing outside that
// mitra's own Wilayah/Kecamatan — the proposer stays responsible regardless
// of territory, same precedence tier as an admin-set Mitra Prioritas
// override (both live in the same override Map). Computed live: no
// migration needed, DashboardMitraPengajuan.MarketingUserID +
// ConvertedBusinessPartnerID already link every historical approval.
export async function getCrossWilayahProposalOverrides(): Promise<Map<string, string>> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.ConvertedBusinessPartnerID AS BusinessPartnerID, sm.Name AS MarketingNama,
           bp.Wilayah AS MitraWilayah, bp.Kecamatan AS MitraKecamatan
    FROM DashboardMitraPengajuan p
    JOIN Salesman sm ON sm.SalesmanID = p.MarketingUserID
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = p.ConvertedBusinessPartnerID
    WHERE p.Status = 'Disetujui' AND p.ConvertedBusinessPartnerID IS NOT NULL
  `);
  // Filtered in JS against the same assignment-matching semantics
  // resolveResponsibleMarketing() already uses, rather than duplicating that
  // matching logic in SQL — this function needs assignments to know
  // "cross-wilayah" for THIS marketing, so it takes them as an argument.
  ...
}
```

(Exact signature/filtering worked out in the implementation plan — the point captured here is: one
new query, JOINing Pengajuan→Salesman→BusinessPartner, filtered to rows where the proposer's own
Wilayah assignment doesn't cover the mitra's actual Wilayah/Kecamatan.)

Both `pemasaran-app/actions.ts` and desktop `pemasaran/page.tsx` call
`getMarketingMitraAssignments()` + `buildMitraOverrideMap()` today — both call sites add
`getCrossWilayahProposalOverrides()` and merge it into the same Map **before** the Mitra Prioritas
entries are applied on top (so Prioritas wins on conflict, per the precedence decision above).

### 2. NOO bucket — union of two conditions

Both UI trees compute Existing/NOO client-side by filtering an already-fetched roster on
`JoinDate` (mobile: `kinerja-marketing-sub-tab.tsx:77-90`, `existingRoster`/`nooRoster`; desktop:
`marketing-performance-panel.tsx:375-400`, `isExisting`/`isNoo` helpers). Both need:

- A new boolean field on the roster row type (e.g. `IsCrossWilayahProposal`), populated in
  `getMarketingPerformance()` (`marketing-performance.ts`) from the same override map built in
  §1 — `true` when the row's `BusinessPartnerID` is a key in `getCrossWilayahProposalOverrides()`'s
  result for the current marketing.
- The `isNoo`/`nooRoster` filter becomes `isNooByJoinDate(JoinDate) || row.IsCrossWilayahProposal`;
  `isExisting`/`existingRoster` becomes `isExistingByJoinDate(JoinDate) && !row.IsCrossWilayahProposal`
  (a cross-wilayah-proposed mitra is NEVER counted Existing, even if its `JoinDate` is old — it's
  permanently NOO per the accepted decision).
- The monthly trend query (`marketing-performance-trend.ts`, `getMarketingPerformanceTrend()`)
  needs the same OR-condition applied per historical month it computes, not just the current-month
  roster view — otherwise the trend table and the roster toggle would disagree.

### 3. Kinerja Marketing mobile redesign

`src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx` + a new/adapted `RosterCard`:

- Port `MitraDayCell`'s pattern from `marketing-performance-panel.tsx:115-230`: each per-mitra
  date box becomes clickable, opening the existing Hasil Kunjungan UI (`saveMarketingVisitLogAction`/
  `getMarketingVisitLogAction`, already used by both desktop's popover and mobile's current Log
  Kunjungan dialog — reused as-is, just retriggered from a new location).
- Date label above each box, delta (`qty - prevQty`, same calc as desktop line 133) below, using
  the same `ArrowUp`/`ArrowDown` + primary/destructive coloring desktop already has.
- Green background (not desktop's small dot) when `hasEntry` is true for that mitra+date.
- Add `PriceLevel` to `getMarketingPerformance()`'s roster SELECT, resolve to Rupiah via the
  already-existing `getPriceLevelOptions()` (same mechanism `pengajuan-form.tsx:131-149` already
  uses) — shown on each `RosterCard`.
- Search input (mitra name, client-side filter over the already-fetched roster — no new query).
- Wilayah/Kecamatan filter (client-side, narrows within the marketing's own roster — mobile never
  shows other marketings' data, so this is a within-roster filter, not cross-marketing).
- Date-range control for how many day-columns render (5/7/30) — purely a client-side slice of
  however many days the underlying hourly/daily data already covers; if the current query doesn't
  fetch 30 days by default, `getMarketingPerformance()`'s day-window needs extending to cover the
  largest selectable range.
- **"Log Kunjungan" sub-tab removed** from `pemasaran-tab.tsx`'s tab list — its component file can
  be deleted once the click-to-log flow is confirmed working from Kinerja Marketing (this plan's
  final task).

### 4. Pengiriman → table, relocated to Beranda

- New table-shaped section in `src/components/pemasaran-app/beranda-tab.tsx` (placed after the
  existing "Perbandingan Penjualan" card, per the file read during brainstorming), same columns
  `getPemasaranWilayahDelivery()` already returns (Wilayah, Avg/hari Bulan Ini, Avg/hari Bulan
  Lalu, %Perubahan, Total Target) — same data source, table markup instead of the current
  per-Wilayah Card stack.
- `pengiriman-sub-tab.tsx` and its "Pengiriman" entry in `pemasaran-tab.tsx`'s sub-tab list are
  removed once the Beranda table is confirmed working.

### 5. Pengajuan card enhancements

`src/components/pemasaran-app/pengajuan-sub-tab.tsx`:

- Partner-type badge (Outlet/Agen/RPA), computed client-side from `QtyKantong` using the same
  thresholds `approvePengajuan()` uses server-side (kept as a simple shared constant, not
  duplicated magic numbers, so a future threshold change only happens in one place worth naming in
  the plan).
- "Potensial" badge when `QtyKantong != null`.
- Surface `WaktuPermintaanSampai`, `QtyKantong`, and Harga (`PriceLevel` → `getPriceLevelOptions()`)
  — all already on `PengajuanRow`, no query change needed for these three.
- Surface `Keterangan ?? CatatanTolak` (§ Data model changes) for any non-`Menunggu` status.
- Card becomes clickable → opens a dialog reusing `MitraLocationField`'s underlying
  `MitraLocationMap` (read-only mode, centered on the Pengajuan's own `Latitude`/`Longitude`) plus
  a `https://www.google.com/maps?q=<lat>,<lng>` link/button to open the native Google Maps app.

## Non-goals (explicitly out of scope)

- No change to `/mkesindo/pemasaran` desktop's own UI beyond the query-layer changes in §1/§2
  that flow to it automatically (new override map entries, new NOO condition) — desktop's roster
  display, trend tables, and Kinerja Marketing layout are not otherwise touched.
- No change to how `DashboardMarketingMitra` (Mitra Prioritas) itself is created/managed — still
  admin-manual via the desktop panel, unchanged.
- No reclassification/migration of already-approved mitra's stored `Gender`/PartnerType — the
  cross-wilayah override only affects *ownership resolution* and *NOO bucket membership*, not the
  underlying Outlet/Agen/RPA classification already fixed at approval time.
- No new "Jenis Usaha" manual field anywhere — Outlet/Agen/RPA stays qty-derived everywhere,
  consistent with the existing product decision the 2026-08-18 spec already made.
- The monthly trend table's historical drift from this change (§ Decisions) is accepted, not
  mitigated with a snapshot/freeze mechanism — consistent with how the existing Existing/NOO spec
  already treats wilayah-reassignment drift as expected behavior, not a bug to guard against.

## Risks

- **Trend-number visibility**: any marketing with cross-wilayah proposals in their history will
  see their historical Matriks Performa Existing/NOO split change the next time they open the app
  after this ships — worth a heads-up to affected marketing staff outside of this implementation,
  since the numbers moving without an obvious in-app explanation could look like a bug from their
  perspective even though it's intended.
- **Duplicated UI logic**: the NOO OR-condition and the Outlet/Agen/RPA threshold constants need to
  land identically in both the mobile and desktop trees (§2, §5) — a plan task should verify both
  sides produce the same classification for the same mitra, not just that each compiles.
- **`Keterangan` column**: adding it without backfilling old `CatatanTolak` values into it means
  the `Keterangan ?? CatatanTolak` fallback must be applied everywhere `PengajuanRow` is displayed,
  not just the mobile card — worth grepping for existing `CatatanTolak` render sites (desktop's
  Pengajuan list, if any) before implementation to avoid missing one.

## Files touched (implementation plan will detail exact steps)

- Modified: `src/lib/queries/marketing-wilayah.ts` (new `getCrossWilayahProposalOverrides`),
  `src/lib/queries/marketing-performance.ts` (add `IsCrossWilayahProposal`, `PriceLevel` to roster
  SELECT), `src/lib/queries/marketing-performance-trend.ts` (OR-condition in monthly split),
  `src/lib/queries/mitra-pengajuan.ts` (`Keterangan` column, `approvePengajuan`/`rejectPengajuan`
  signatures), `src/app/mkesindo/pemasaran-app/actions.ts`, `src/app/mkesindo/(dashboard)/pemasaran/page.tsx`.
- Modified (mobile UI): `src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx`,
  `src/components/pemasaran-app/pemasaran-tab.tsx`, `src/components/pemasaran-app/beranda-tab.tsx`,
  `src/components/pemasaran-app/pengajuan-sub-tab.tsx`.
- Modified (desktop, query-layer consequences only): `src/components/dashboard/marketing-performance-panel.tsx`
  (NOO OR-condition), `src/components/dashboard/marketing-trend-tables.tsx` if it independently
  computes NOO membership.
- Removed (once their replacement is confirmed working): `src/components/pemasaran-app/log-kunjungan-sub-tab.tsx`,
  `src/components/pemasaran-app/pengiriman-sub-tab.tsx`.
- One-off script: `ALTER TABLE DashboardMitraPengajuan ADD Keterangan` (run once via `npx tsx`, kept
  in `scripts/`, per this repo's convention).
