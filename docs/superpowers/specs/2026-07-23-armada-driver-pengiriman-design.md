# Modul Armada & Driver (fondasi Pengiriman) — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into an implementation plan.

**Goal:** Give staff a way to assign a vehicle (Armada) and driver to each Delivery Order, and surface that assignment wherever DO details are shown — the first piece of the eventual Pengiriman (shipping) module, ahead of Sales Order → Delivery Order auto-creation.

**Architecture:** Reuse the ERP's existing `Salesman` table as the Driver identity (it already carries real driver names on live `SalesOrder`/`DeliveryOrder` rows via `SalesmanID`, informally repurposed from its literal "salesman" meaning). Add one new dashboard-owned table, `DashboardArmada`, for vehicle master data. Assignment writes go directly into `DeliveryOrder.SalesmanID` and `DeliveryOrder.VehicleNo` — both columns already exist in the ERP schema, just unused in current practice for `VehicleNo` and previously invisible in this dashboard for both. The existing `/delivery` page (which already shows an open-deliveries report, not an empty placeholder) gains a second tab for the new assignment workflow.

**Tech Stack:** Next.js Server Components + Server Actions, raw parameterized `mssql` queries (existing codebase convention, no ORM), Base UI-backed `Select`/`Dialog`/`Tabs` primitives already in `src/components/ui`.

## Global Constraints

- Driver data comes from the ERP `Salesman` table only — no new driver table, no new columns on `Salesman`. `SalesmanID = "0127"` ("Ambil Sendiri"/TakeAway, per the existing `PARTNER_TYPE_CASE` convention in `src/lib/queries/aging.ts`) must be excluded from the assignable driver list.
- `DashboardArmada` carries exactly one user-facing field: `Nama` (e.g. "GrandMax 1972"). No Jenis Kendaraan, Plat Nomor, or Kapasitas in this phase — explicitly out of scope, confirmed with the user.
- Assignment writes to `DeliveryOrder` are single-column `UPDATE ... WHERE DeliveryOrderID = @id` statements only. This phase never `INSERT`s into `DeliveryOrder` — no VoucherNo sequencing, no StatusForm/financial fields to reason about.
- The existing `/delivery` page's current content (open-deliveries report, `getOpenDeliveries()` in `src/lib/queries/delivery.ts`) is preserved as-is, moved under a "Pengiriman Terbuka" tab — not rewritten or removed.
- The new assignment tab follows the same date-navigation UX already built for Piutang's Pembayaran panel: prev/next day buttons, a date `<input>`, defaulting to business-today, and a `useTransition`-driven indeterminate loading bar (`.animate-indeterminate` utility already in `globals.css`) since the underlying query is a real server round-trip.
- Module access reuses the existing `requireModuleAccess("delivery")` gate for the whole page (both tabs) — no new permission scope.
- Old/legacy `VehicleNo` values already sitting in historical `DeliveryOrder` rows (free-text codes like `"0129"`, unrelated to any `DashboardArmada.Nama`) are left untouched — displayed as plain read-only text when they don't match a known Armada, no migration or reconciliation.

---

## Data Model

### New table: `DashboardArmada`

```sql
CREATE TABLE DashboardArmada (
  ArmadaID INT IDENTITY(1,1) PRIMARY KEY,
  Nama VARCHAR(128) NOT NULL,
  IsDeleted BIT NOT NULL DEFAULT 0,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()
);
```

Follows the same shape as other dashboard-owned companion tables (`DashboardMitraLocation`, `DashboardCollectionTarget`): soft-delete via `IsDeleted`, `ModifiedDate` maintained on every write.

### Existing tables touched (no schema changes, only new read/write usage)

- `Salesman` (`SalesmanID`, `Name`, `IsDeleted`) — read-only, source of Driver identity.
- `DeliveryOrder` (`DeliveryOrderID`, `SalesmanID`, `VehicleNo`, `TransDate`, `BusinessPartnerID`, `IsDeleted`) — `SalesmanID`/`VehicleNo` become writable from this dashboard for the first time; everything else stays read-only as it already is throughout the codebase.

---

## Components & Data Flow

### `src/lib/queries/armada.ts` (new)

CRUD for `DashboardArmada`, mirroring the shape of `src/lib/queries/mitra.ts`:

- `getArmadaList(): Promise<ArmadaRow[]>` — all non-deleted armada, sorted by Nama.
- `createArmada(nama: string): Promise<number>` — returns new `ArmadaID`.
- `updateArmada(id: number, nama: string): Promise<void>`
- `deleteArmada(id: number): Promise<void>` — soft delete (`IsDeleted = 1`).

### `src/lib/queries/delivery.ts` (extended)

- `getDriverOptions(): Promise<{ SalesmanID: string; Name: string }[]>` — reads `Salesman` where `IsDeleted = 0` and `SalesmanID <> '0127'`.
- `getDeliveryAssignments(businessDate: string): Promise<DeliveryAssignmentRow[]>` — one row per `DeliveryOrder` (not per detail line, unlike `getOpenDeliveries`) for the given business date: `DeliveryOrderID`, `VoucherNo`, `TransDate`, `CustomerName`, `Wilayah`, current `SalesmanID`/driver name (LEFT JOIN `Salesman`), current `VehicleNo`.
- `assignDeliveryDriver(deliveryOrderId: string, salesmanId: string | null): Promise<void>` — `UPDATE DeliveryOrder SET SalesmanID = @salesmanId WHERE DeliveryOrderID = @id`.
- `assignDeliveryVehicle(deliveryOrderId: string, vehicleName: string | null): Promise<void>` — `UPDATE DeliveryOrder SET VehicleNo = @vehicleName WHERE DeliveryOrderID = @id`.

### UI: `/delivery` page restructure

- `src/app/(dashboard)/delivery/page.tsx` — fetches data for both tabs (existing `getOpenDeliveries`/`getWilayahList`, plus new `getDeliveryAssignments`/`getDriverOptions`/`getArmadaList` for the default business date), renders a new `PengirimanTabs` client component with the two panels as children — same composition pattern as `src/components/dashboard/piutang-tabs.tsx` (client-side tab state, no URL param, no page navigation on switch).
- `src/components/dashboard/delivery-assignment-panel.tsx` (new) — the "Penugasan Armada & Driver" tab content: date nav (prev/next + date input + loading bar, copied pattern from `piutang-payments-panel.tsx`), a list/table of that date's DOs, each row with a Driver `Select` (options from `getDriverOptions`) and an Armada `Select` (options from `getArmadaList`), each triggering its own server action on change. Includes a "Kelola Armada" button opening a management dialog.
- `src/components/dashboard/armada-dialog.tsx` (new) — simple list + create/edit/delete dialog for `DashboardArmada`, modeled on the Mitra module's dialog pattern but with a single `Nama` field.
- `src/app/(dashboard)/delivery/actions.ts` (new) — server actions wrapping `assignDeliveryDriver`, `assignDeliveryVehicle`, and the Armada CRUD functions, each calling `router.refresh()`-equivalent revalidation and reusing `requireModuleAccess("delivery")` for authorization.

---

## Error Handling

- Assignment `Select` writes are optimistic-on-success: on failure, revert the visible selection and show an inline error (matching existing patterns like `mitra-list.tsx`'s dialog error handling).
- `getDeliveryAssignments` for a date with zero DOs shows an empty-state message, consistent with every other empty-state in this codebase (e.g. `piutang-payments-panel.tsx`'s "Belum ada pembayaran...").
- Deleting an Armada that's currently referenced by a DO's `VehicleNo` (by name match) is allowed — soft-delete only removes it from future assignment dropdowns, it does not touch any `DeliveryOrder` row (`VehicleNo` is a denormalized text snapshot, not a live FK).

## Out of Scope (this phase)

- Jenis Kendaraan, Plat Nomor, Kapasitas angkut fields on Armada.
- Kernet (co-driver/helper) tracking.
- A default vehicle-driver pairing (e.g. "this truck's usual driver").
- Creating new `DeliveryOrder` rows (this phase only updates existing ones).
- Sales Order → Delivery Order auto-creation (tracked separately — see project memory `sales-order-auto-creation` / roadmap note for what comes after Armada + Driver land).
- Migrating/reconciling legacy `VehicleNo` free-text values from before this feature existed.

## Testing

- Manual verification via the browser preview (per this project's established practice — no automated test suite exists in this codebase): create/edit/delete an Armada; assign a driver and a vehicle to a real DO for today and for a past date; confirm the assignment persists after a page reload; confirm the driver dropdown excludes SalesmanID `0127`; confirm the existing "Pengiriman Terbuka" tab's content and filtering are unchanged.
