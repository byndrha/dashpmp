# Papan Pengiriman (Kanban/Timeline Armada) — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** Replace the simple per-DO "Penugasan Armada & Driver" tab (built in the previous Armada/Driver phase) with a timeline board: one row per vehicle, with departure cards positioned along a 24-hour axis, each departure bundling multiple Delivery Orders into one trip.

**Architecture:** Two new dashboard-owned tables (`DashboardPengirimanJadwal` header + `DashboardPengirimanJadwalDetail` line items) sit alongside the existing `DashboardArmada` (expanded with vehicle profile fields) and the ERP's `Salesman` (driver identity, unchanged from the prior phase). The board itself reuses the sticky-left + shared-horizontal-scroll technique already built for the Transaksi DO-per-Mitra panel, with `@dnd-kit/core` added for drag-to-reschedule. Vehicle photos are saved to local disk under `public/uploads/armada/` — no third-party storage service.

**Tech Stack:** Next.js Server Components + Server Actions, raw parameterized `mssql` queries, `@dnd-kit/core` (new dependency) for drag interaction, Node's `fs` for local file writes.

## Global Constraints

- No automated test suite exists in this codebase — verification is `npx tsc --noEmit`, `npm run lint`, and manual browser checks.
- This board **replaces** the existing "Penugasan Armada & Driver" tab and its `delivery-assignment-panel.tsx`/`armada-dialog.tsx`'s per-DO assignment UI — that tab is removed, not kept alongside.
- When a DO joins a Jadwal (departure), `DeliveryOrder.SalesmanID`/`VehicleNo` are still written (via the already-built `assignDeliveryDriver`/`assignDeliveryVehicle` from `src/lib/queries/delivery.ts`) so every other existing view (`getOpenDeliveries`, etc.) keeps working unchanged.
- Vehicles with `Status` other than `'Baik'` cannot be selected when creating a new departure, but their row still renders on the board.
- Rescheduling a departure's time is supported two ways: dragging the card on the board, and editing the time in a dialog opened by clicking the card. Both write the same `JamJadwal` field through the same server action.
- `JamMulaiMuat`/`JamAktualBerangkat` are only ever set by a staff button press ("Mulai Muat" / "Berangkat") at the moment it happens — never manually typed.
- File uploads go to `public/uploads/armada/` on the server's own disk — no `@vercel/blob`, S3, or Cloudinary. This directory must survive redeploys (Coolify persistent volume) — flagged as a deployment prerequisite, not something the app code can guarantee.

---

## Data Model

### `DashboardArmada` — extended (ALTER TABLE)

```sql
ALTER TABLE DashboardArmada ADD
  PlatNomor VARCHAR(20) NULL,
  Brand VARCHAR(64) NULL,
  Model VARCHAR(64) NULL,
  KonsumsiBBM DECIMAL(10,2) NULL,  -- liter per km
  KapasitasMaks DECIMAL(23,4) NULL, -- max kantong per trip
  Status VARCHAR(20) NOT NULL DEFAULT 'Baik', -- Baik | Rusak | Perbaikan | Tertahan
  FotoPath VARCHAR(256) NULL; -- e.g. "/uploads/armada/3-1690000000.jpg"
```

### New: `DashboardPengirimanJadwal` (one row per departure card)

```sql
CREATE TABLE DashboardPengirimanJadwal (
  JadwalID INT IDENTITY(1,1) PRIMARY KEY,
  ArmadaID INT NOT NULL,
  SalesmanID VARCHAR(16) NULL,
  JamJadwal DATETIME NOT NULL,
  JamMulaiMuat DATETIME NULL,
  JamAktualBerangkat DATETIME NULL,
  IsDeleted BIT NOT NULL DEFAULT 0,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()
);
```

### New: `DashboardPengirimanJadwalDetail` (which DOs ride on this departure)

```sql
CREATE TABLE DashboardPengirimanJadwalDetail (
  JadwalDetailID INT IDENTITY(1,1) PRIMARY KEY,
  JadwalID INT NOT NULL,
  DeliveryOrderID VARCHAR(16) NOT NULL,
  IsDeleted BIT NOT NULL DEFAULT 0
);
```

`Total Kantong Muatan` and `Total DO` are never stored — always computed live by joining to `DeliveryOrder`/`DeliveryOrderDetail` (reusing the same `KANTONG_QTY_EXPR` convention already established in `mitra-do.ts`).

---

## Components & Data Flow

### `src/lib/queries/armada.ts` (extended)

- `ArmadaRow` gains: `PlatNomor`, `Brand`, `Model`, `KonsumsiBBM`, `KapasitasMaks`, `Status`, `FotoPath` (all `| null` except `Status`).
- `createArmada`/`updateArmada` take the full field set instead of just `nama`.
- New: `ARMADA_STATUS = ["Baik", "Rusak", "Perbaikan", "Tertahan"] as const`.

### `src/app/api/upload/armada-foto/route.ts` (new)

- `POST` handler accepting `multipart/form-data`, validates it's an image (mime-type + size cap, e.g. 5MB), writes to `public/uploads/armada/<ArmadaID>-<timestamp>.<ext>`, returns the relative path to store in `FotoPath`.
- Gated by `requireModuleAccess("delivery")` same as the rest of this module.

### `src/lib/queries/pengiriman-jadwal.ts` (new)

- `JadwalCard` type: `JadwalID`, `ArmadaID`, `SalesmanID`, `DriverName`, `JamJadwal`, `JamMulaiMuat`, `JamAktualBerangkat`, `TotalKantong`, `TotalDO`.
- `getPengirimanBoard(businessDate: string): Promise<{ armada: ArmadaRow[]; jadwal: JadwalCard[] }>` — all vehicles + all of that date's departures (grouped client-side by `ArmadaID`).
- `getJadwalDetail(jadwalId: number): Promise<JadwalDetailRow[]>` — one row per DO in that departure: `DeliveryOrderID`, `CustomerName`, `Qty`, `Wilayah`, `Kecamatan`, `Alamat`, `MobileNo`.
- `getUnassignedDeliveryOrders(businessDate: string): Promise<UnassignedDO[]>` — DOs for that date not yet in any non-deleted `DashboardPengirimanJadwalDetail` row, for the "+" create-departure picker.
- `createJadwal(input: { armadaId, salesmanId, jamJadwal, deliveryOrderIds }): Promise<number>` — inserts the header + detail rows, and calls `assignDeliveryDriver`/`assignDeliveryVehicle` for each DO.
- `updateJadwalTime(jadwalId, jamJadwal): Promise<void>` — powers both drag and dialog-edit.
- `startMuat(jadwalId): Promise<void>` / `startBerangkat(jadwalId): Promise<void>` — set `JamMulaiMuat`/`JamAktualBerangkat` to `GETDATE()`.

### UI: `src/components/dashboard/pengiriman-board.tsx` (new, replaces `delivery-assignment-panel.tsx`)

- Date nav (prev/next/date-input + loading bar) — same pattern as `piutang-payments-panel.tsx`.
- One sticky-left `ArmadaRowCard` per vehicle (photo, plat nomor, brand/model, status badge) — rows sorted by their earliest not-yet-departed `JamJadwal` for the selected date (vehicles with no pending departure sort last).
- A 24-hour ruler (shared horizontal scroll, same sync-scroll technique as `mitra-do-panel.tsx`) with `JadwalCard` components absolutely positioned by hour within each vehicle's row. Scale: 80px per hour (1920px total width for 00:00–24:00), hour gridlines every 80px matching the vertical-divider-line convention from the Transaksi DO panel. Each `JadwalCard` is a fixed 72px wide, `left = jamJadwal-as-decimal-hours * 80`.
- `@dnd-kit/core`'s `DndContext`/`useDraggable`/`useDroppable` wire dragging a card to a new hour position; `onDragEnd` computes the new `JamJadwal` from the horizontal drag delta (rounded to the nearest 15-minute increment — 20px at this scale) and calls `updateJadwalTimeAction`.
- Clicking a card (not dragging) opens `JadwalDetailDialog`: list of DOs (Penerima/Jumlah/Wilayah/Kecamatan/Alamat/Telepon), a time field to edit `JamJadwal` directly, and "Mulai Muat"/"Berangkat" buttons.
- "+" button per vehicle row opens `CreateJadwalDialog`: multi-select from `getUnassignedDeliveryOrders`, a time picker, a Driver select (reusing `getDriverOptions` from the prior phase) — disabled entirely if that vehicle's `Status !== "Baik"`.

### `src/components/dashboard/armada-dialog.tsx` (extended)

- Add fields for `PlatNomor`, `Brand`, `Model`, `KonsumsiBBM`, `KapasitasMaks`, `Status` (select), and a photo `<input type="file">` wired to the new upload route.

---

## Migration Notes

- `src/components/dashboard/delivery-assignment-panel.tsx` and its per-DO Driver/Armada `Select`s are deleted; `pengiriman-tabs.tsx`'s "Penugasan Armada & Driver" tab is replaced with "Papan Pengiriman" rendering `PengirimanBoard`.
- Any DO already carrying `SalesmanID`/`VehicleNo` from the old per-DO assignment flow keeps that data — nothing is migrated into a `Jadwal`, since there's no reliable way to reconstruct which DOs traveled together on the same trip from that flow's data. Old assignments simply aren't retroactively grouped into departures.

## Out of Scope (this phase)

- Kernet (co-driver) tracking.
- Editing/removing a DO from an already-created Jadwal (only adding at creation time).
- Any notion of recurring/templated departures.
- Automatic conflict detection (e.g. same driver double-booked across two vehicles at the same time) — not validated in this phase.

## Testing

Manual verification via the browser preview: extend an Armada with all new fields + a photo; create a departure bundling 2+ DOs; confirm those DOs now show the assigned Driver/Armada in the "Pengiriman Terbuka" tab; drag a departure card to a new hour and confirm `JamJadwal` updates; click a card, click "Mulai Muat" then "Berangkat", confirm timestamps appear; confirm a non-"Baik" vehicle can't be selected in the "+" create-departure flow; confirm vehicle rows reorder as departures are added/rescheduled.
