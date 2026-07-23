# SO→DO Route Validation & Publishing — Design Spec

**Status:** Approved by user, 2026-07-23.

## Why

The existing "Buat Keberangkatan Baru" flow (built in the earlier Papan
Pengiriman plan) was based on a misunderstanding: it lets staff group
*already-existing* `DeliveryOrder` rows onto a departure card. In reality,
`DeliveryOrder` documents don't exist yet at that point — the flow should
**create** them, from `SalesOrder` rows that haven't been fulfilled yet. This
spec corrects that and adds the two capabilities the user described as a
consequence: draft/publish staging, and mandatory route validation (manual
stop ordering + map + distance/time/fuel estimates) before a departure's DO
documents are actually issued.

## Current State (confirmed via live DB inspection)

- `DeliveryOrder.SalesOrderID` and `DeliveryOrderDetail.SalesOrderDetailID`
  already exist as columns — SO→DO traceability is a pre-existing ERP schema
  pattern (the desktop app already supports it), not something this plan
  invents.
- `src/lib/queries/sales-order.ts`'s `createSalesOrderFromPengajuan` already
  demonstrates the exact ID/VoucherNo sequencing convention
  (`MAX(TRY_CAST(...AS INT))+1` padded IDs, monthly-reset voucher sequence
  scanned via `LIKE` pattern) that DO creation must mirror for `MKE/DO/...`
  vouchers.
- `src/lib/osrm.ts` already wraps an OSRM instance with `getRoute` (2-point)
  and `getDistanceMatrix` (1-to-many) — built, per its own comment, with this
  exact delivery-sequencing use case in mind. Needs one addition: a
  multi-waypoint route function (Pabrik → stop → stop → ... → Pabrik) that
  also returns route geometry for map drawing and per-leg
  distance/duration.
- `src/app/api/routing/route.ts` already has a hardcoded Pabrik coordinate
  (`PABRIK_ORIGIN`, from Google Maps: `-7.8462825, 111.4759937`), duplicated
  in `src/components/dashboard/mitra-location-field.tsx`'s `PABRIK_DEFAULT`.
  Both get retired in favor of one settings-backed source of truth (see
  Pabrik Location below).
- `DashboardArmada.KonsumsiBBM` (L/km) already exists — fuel estimate is
  `totalRouteKm × KonsumsiBBM`.
- `src/components/dashboard/mitra-location-field.tsx` +
  `mitra-location-map.tsx` already implement an editable Leaflet
  pick-a-point-on-map field (search, "use my location", reverse geocode) —
  reused as-is for the new Pabrik Location settings field.
- `DashboardPengirimanJadwal` (2 rows) / `DashboardPengirimanJadwalDetail` (3
  rows) currently hold rows created during the prior plan's live testing
  (test vehicles "GrandMax Test 2026" / "GrranMax 1973"). These predate
  `SalesOrderID` and have no SO to backfill from. **Migration decision,
  needs the user's confirmation during spec review:** soft-delete these 2
  test Jadwal rows (and their 3 detail rows) as part of the DDL task, since
  they're artifacts of automated verification, not real departures. If the
  user wants to keep them, they'd need to be manually backfilled with a
  placeholder or left with a nullable `SalesOrderID`, complicating every
  query that joins through it — soft-delete is the clean option and is
  recommended.

## Status Lifecycle

`DashboardPengirimanJadwal.Status`: `'Draft'` → `'Terbit'`. One-way — there is
no "un-publish."

**Draft** (created by "+" on an Armada row):
- Staff pick one or more `SalesOrder` rows (not yet fulfilled by any DO, not
  already claimed by another active Jadwal) plus a time. Driver is optional
  at this stage.
- Nothing is written to `DeliveryOrder`/`DeliveryOrderDetail` at all. The
  selected SOs are recorded only in `DashboardPengirimanJadwalDetail`
  (`SalesOrderID` set, `DeliveryOrderID` still NULL).
- Freely editable/cancelable: add/remove SOs, change vehicle, delete the
  whole draft (soft-delete header + details, releasing the SOs back to the
  "available" pool). None of this touches real ERP tables.

**Terbit** (published, via the route-validation dialog's "Terbitkan" button):
- Preconditions, checked client- and server-side: driver is set, and OSRM
  successfully computed a route for the current stop order (mandatory per
  the user's explicit choice — no publishing with a failed/unattempted
  route).
- For each `JadwalDetail` row, in `Urutan` order: create one real
  `DeliveryOrder` + its `DeliveryOrderDetail` row(s) from the linked
  `SalesOrder`/`SalesOrderDetail` (mirroring `createSalesOrderFromPengajuan`'s
  sequencing pattern, `MKE/DO/...` vouchers), set `VehicleNo`/`SalesmanID`
  from the Jadwal, link `SalesOrderID`/`SalesOrderDetailID`, and write the
  new `DeliveryOrderID` back onto the `JadwalDetail` row. `Jadwal.Status`
  flips to `'Terbit'`.
- Partial-failure handling: same compensating-cleanup discipline as the
  existing `createJadwal` (see `pengiriman-jadwal.ts`) — if DO creation fails
  partway through the loop, roll back only what this operation itself
  created (the newly-inserted `DeliveryOrder`/`DeliveryOrderDetail` rows for
  SOs already processed in this same publish call), not the Jadwal/SO
  selection itself, and surface the error so staff can retry.
- Once `'Terbit'`: SO composition is locked (no add/remove). Time, driver,
  and stop order (`Urutan`) remain editable — editing writes `VehicleNo` +
  `SalesmanID` to every linked `DeliveryOrder` (matching the user's explicit
  scope choice; `Urutan` reordering is dashboard-only bookkeeping with no
  effect on any `DeliveryOrder` field, so it stays freely editable even
  post-publish).

## Data Model Changes

```sql
ALTER TABLE DashboardPengirimanJadwal ADD Status VARCHAR(10) NOT NULL DEFAULT 'Draft';
ALTER TABLE DashboardPengirimanJadwal ADD CreatedByUserID VARCHAR(16) NULL;

ALTER TABLE DashboardPengirimanJadwalDetail ADD SalesOrderID VARCHAR(16) NULL; -- backfilled below, then tightened
ALTER TABLE DashboardPengirimanJadwalDetail ADD Urutan INT NOT NULL DEFAULT 0;
ALTER TABLE DashboardPengirimanJadwalDetail ALTER COLUMN DeliveryOrderID VARCHAR(16) NULL;

-- Migration: soft-delete the 2 pre-existing test Jadwal rows and their 3
-- detail rows (see "Current State" above) before tightening SalesOrderID to
-- NOT NULL, since they have no SO to backfill.
UPDATE DashboardPengirimanJadwalDetail SET IsDeleted = 1 WHERE JadwalID IN (1, 2);
UPDATE DashboardPengirimanJadwal SET IsDeleted = 1 WHERE JadwalID IN (1, 2);
ALTER TABLE DashboardPengirimanJadwalDetail ALTER COLUMN SalesOrderID VARCHAR(16) NOT NULL;

CREATE TABLE DashboardPabrikLocation (
  ID INT IDENTITY PRIMARY KEY,
  Latitude DECIMAL(10,7) NOT NULL,
  Longitude DECIMAL(10,7) NOT NULL,
  Alamat VARCHAR(512) NULL,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()
);
-- Single row, seeded with the existing hardcoded constant. Read/write logic
-- always targets this one row (upsert by "the only row", same singleton
-- pattern as DashboardMonthlyTarget's per-key MERGE, but keyless here).
INSERT INTO DashboardPabrikLocation (Latitude, Longitude, Alamat)
VALUES (-7.8462825, 111.4759937, NULL);
```

`src/app/api/routing/route.ts` and `mitra-location-field.tsx`'s
`PABRIK_DEFAULT` both switch to reading `DashboardPabrikLocation` instead of
their local hardcoded constants.

## Query/Action Layer Changes (`src/lib/queries/pengiriman-jadwal.ts`)

- `getAvailableSalesOrders(businessDate)` replaces
  `getUnassignedDeliveryOrders`: selects `SalesOrder`/`SalesOrderDetail`
  where `DueDate` falls on `businessDate`, `IsClosed = 0`, `IsDeleted = 0`,
  `NOT EXISTS` a `DeliveryOrder` for that `SalesOrderID`, and `NOT EXISTS` an
  active `DashboardPengirimanJadwalDetail` row for it either (so an SO
  already sitting in another draft doesn't show as available).
- `createJadwalDraft(input: {armadaId, jamJadwal, salesOrderIds})` — no
  `salesmanId` param (optional, added later). Creates the Jadwal header
  (`Status='Draft'`) and detail rows (`SalesOrderID` set, `DeliveryOrderID`
  NULL, `Urutan` = selection index).
- `deleteJadwalDraft(jadwalId)` — only valid while `Status='Draft'`;
  soft-deletes header + details.
- `updateJadwalUrutan(jadwalId, orderedDetailIds: number[])` — persists
  drag-and-drop reordering (works in both Draft and Terbit states).
- `updateJadwalDriverTime(jadwalId, {jamJadwal, salesmanId})` — replaces
  direct use of `updateJadwalTime` from the route-validation dialog; when
  `Status='Terbit'`, additionally re-writes `VehicleNo` (from the Jadwal's
  current `ArmadaID`) and `SalesmanID` to every linked `DeliveryOrder` via
  the existing `assignDeliveryVehicle`/`assignDeliveryDriver`.
- `publishJadwal(jadwalId)` — the Draft→Terbit transition described above.
  Implementer must verify live `DeliveryOrder.VoucherNo` numbering behavior
  against real data before coding the sequence-scan query (same
  live-data-verification discipline `sales-order.ts`'s author used for
  SO's monthly reset — don't assume DO resets identically without checking).
- `getJadwalDetail(jadwalId)` reworked to always source line-item info
  (customer, wilayah, qty, address, coordinates) from
  `SalesOrder`/`SalesOrderDetail`/`BusinessPartner` via the detail row's
  `SalesOrderID`, uniformly for both Draft and Terbit — `DeliveryOrderID` is
  bookkeeping only, never a read dependency.
- New: `getPabrikLocation()` / `setPabrikLocation()` (mirrors
  `mitra-location.ts`'s shape).
- New: a multi-point route function in `osrm.ts` —
  `getMultiPointRoute(points: Coordinate[]): Promise<{distanceKm, durationMinutes, geometryGeoJSON, legs: {distanceKm, durationMinutes}[]}>`
  — one OSRM `/route/v1/driving/{coords}` call with all waypoints,
  `overview=full&geometries=geojson`, reading `routes[0].legs[]` for the
  per-segment breakdown the user asked for ("estimasi waktu yang ditempuh
  dari satu poin ke poin lainnya"). Exposed via a new API route (per
  `osrm.ts`'s own existing comment: never call OSRM directly from a client
  component).

## UI Changes

**`pengiriman-board.tsx`**
- Timeline width fix: `HOUR_WIDTH` becomes computed from the available
  container width (measured client-side) instead of a fixed `80px`, so
  `DAY_WIDTH` always fits one screen with no horizontal scrollbar. The
  15-minute drag-snap math is unaffected (still hour-fraction based, just
  against a smaller per-hour pixel constant).
- Jadwal cards get a visual Draft indicator (dashed border / small "Draft"
  label) vs. the normal solid style once `Terbit`.
- "+" button opens the reworked create dialog: lists available `SalesOrder`
  rows (via `getAvailableSalesOrders`) instead of unassigned DOs; Driver
  select becomes optional; submit calls `createJadwalDraft` (no vehicle/DO
  writes yet).
- Clicking a card now opens the new **Validasi Rute** dialog (replaces the
  old simple detail dialog) for both Draft and Terbit cards.

**New: Validasi Rute dialog**
- Left/top: editable Jam Keberangkatan + Driver (calls
  `updateJadwalDriverTime`).
- Middle: the stop list, drag-and-drop reorderable
  (`@dnd-kit/sortable`, new dependency — official companion package to the
  already-installed `@dnd-kit/core`, standard fit for vertical list
  reordering) — reordering calls `updateJadwalUrutan`.
- Right, large: Leaflet map — Pabrik marker (start/end), numbered markers
  per stop in `Urutan` order, polyline from the multi-point route's
  geometry. Below/beside it: per-leg distance & duration, totals, and the
  fuel estimate (`totalKm × Armada.KonsumsiBBM`).
- "Terbitkan" button: disabled until driver is set AND the route call has
  succeeded for the current stop order; on click, calls `publishJadwal`.
  Once `Terbit`, the button is replaced by a "Terbit" status indicator — the
  rest of the dialog (time/driver/reorder/map) stays open and editable.

## Out of Scope (this spec)

- Splitting one SO's quantity across multiple DOs/departures — one SO always
  becomes exactly one whole DO.
- Editing SO composition (add/remove stops) on an already-`Terbit` Jadwal.
- Automatic route/stop-order optimization — ordering is always manual
  drag-and-drop.
