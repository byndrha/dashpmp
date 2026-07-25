# Validasi Waktu Pengiriman, Data Armada, dan Ubah Pemesanan — Design Spec

**Status:** Approved by user 2026-07-25, proceeding to implementation plan.

## Goal

Five additions to the Pemesanan/Pengiriman modules just shipped:

1. A departure's scheduled time (`JamJadwal`) can never be earlier than the `TransDate` of any Sales Order bundled into it — enforced server-side wherever `JamJadwal` is set or changed.
2. `DashboardArmada` gains fuel and tax fields: Jenis BBM, Biaya BBM/Liter, Pajak 5 Tahunan (date), Biaya Pajak 5 Tahunan.
3. Papan Pengiriman's per-armada row shows Kapasitas, Total Kantong hari itu, and Total Jarak Tempuh hari itu (the latter persisted at "Berangkat" time, summed only over departed — `Terbit` — Jadwal).
4. Validasi Rute shows Jenis BBM and a computed Total Biaya BBM (liters × Biaya BBM/Liter).
5. A new "Ubah Pemesanan" dialog lets staff change **one** Sales Order's armada/waktu/driver assignment — detaching it from whatever Draft it's currently bundled into (without disturbing the other Sales Orders still in that Draft) and rescheduling it as its own Draft.

## Scope boundary (explicit user decision)

The 14:00 WIB "business date" cutoff convention (`getBusinessDateISO()`, already implemented and already used for Papan Pengiriman's "today") is applied fully within Pemesanan and Pengiriman/Papan Pengiriman in this plan — picker minimums, defaults, and the ordering example the user gave. It is **not** retrofitted into any other module (Piutang, Penjualan, Transaksi, etc.) as part of this plan — that remains the separately-tracked systemic finding from a prior review.

## Part 1: `JamJadwal >= MAX(SalesOrder.TransDate)` validation

**Where enforced (server-side, single source of truth):** `src/lib/queries/pengiriman-jadwal.ts`. A new private helper:

```ts
async function assertJamJadwalNotBeforeOrders(pool: sql.ConnectionPool, salesOrderIds: string[], jamJadwal: Date): Promise<void>
```

Queries `SELECT MAX(TransDate) AS MaxTransDate FROM SalesOrder WHERE SalesOrderID IN (...)` for the given IDs and throws `Waktu pengiriman (${formatDate/formatTime of jamJadwal}) tidak boleh sebelum waktu pemesanan SO terkait (${formatDate/formatTime of MaxTransDate}).` if `jamJadwal < MaxTransDate`. No-ops on an empty ID list.

Called from:
- `createJadwalDraft` — before the INSERT, using `input.salesOrderIds`.
- `updateJadwalDriverTime` — before the UPDATE, using the Jadwal's currently-bundled, non-deleted `SalesOrderID`s (one extra `SELECT` against `DashboardPengirimanJadwalDetail`). This covers both the "Simpan" button and drag-to-reschedule, since both call this same function.
- `addSalesOrdersToJadwal` — before inserting the new detail rows, using the Jadwal's **current `JamJadwal`** (read from the header) against the **newly-added** `salesOrderIds` only (the already-bundled SOs were already validated when they were added).

**Client-side UX (soft guidance, not the enforcement):** the Pemesanan form's delivery-date `Input` gets `min={todayBusinessDateISO}` (computed the same way `getBusinessDateISO()` already does — see Part 1a). No new client-side validation is added to the Papan Pengiriman create-draft/reschedule flows beyond surfacing the server's thrown error message in the existing error-display pattern (`error && <p className="text-destructive">...`), consistent with how every other server-validated rule in these dialogs already surfaces.

### Part 1a: `getBusinessDateISO()` reused for the Pemesanan form's date floor

`pemesanan-form-dialog.tsx`'s Tanggal Kirim `Input` gets `min={todayISO}`, where `todayISO` is a new prop threaded from the page (`getBusinessDateISO()`, already exported from `src/lib/business-date.ts`, already imported and used in `delivery/page.tsx` — `pemesanan/page.tsx` just needs the same import and to pass it down as a prop, same as `PengirimanBoard` already receives `todayISO`).

## Part 2: `DashboardArmada` fuel + tax fields

**DDL:**
```sql
ALTER TABLE DashboardArmada ADD
  JenisBBM VARCHAR(20) NULL,
  BiayaBBMPerLiter DECIMAL(18,2) NULL,
  PajakLimaTahunan DATE NULL,
  BiayaPajakLimaTahunan DECIMAL(18,2) NULL;
```

**New client-safe constants file** `src/lib/armada-fuel.ts` (mirrors the existing `armada-status.ts` — kept separate from `armada.ts` for the same reason `ARMADA_STATUS` was split out: `armada.ts` imports `mssql`, and a client component importing a runtime value from it leaks `mssql` into the browser bundle — this exact bug already happened once in this codebase and was fixed by this same split):
```ts
export const FUEL_TYPES = ["Pertalite", "Pertamax", "Pertamax Turbo", "Solar", "Dexlite"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
```

`src/lib/queries/armada.ts`: `ArmadaRow` and `ArmadaInput` both gain `jenisBBM`/`JenisBBM: FuelType | null`, `biayaBBMPerLiter`/`BiayaBBMPerLiter: number | null`, `pajakLimaTahunan`/`PajakLimaTahunan: string | Date | null`, `biayaPajakLimaTahunan`/`BiayaPajakLimaTahunan: number | null`. `getArmadaList`/`createArmada`/`updateArmada` extended to select/insert/update the 4 new columns (parameterized: `sql.VarChar(20)`, `sql.Decimal(18,2)`, `sql.Date`, `sql.Decimal(18,2)`). Re-exports `FUEL_TYPES`/`FuelType` the same way it already re-exports `ARMADA_STATUS`/`ArmadaStatus`.

**UI** (`armada-dialog.tsx`'s `ArmadaFormDialog`): 4 new fields in the same `grid grid-cols-2` form, next to the existing Konsumsi BBM/Kapasitas Maks fields — a `Select` for Jenis BBM (same controlled-state pattern already used for `status` in that same form), and 3 plain `Input`s (number/date/number) read via `FormData` in `handleSubmit`, same as the existing `konsumsiBBM`/`kapasitasMaks` fields.

## Part 3: Papan Pengiriman per-armada daily stats

**Total Kantong hari itu** and **Kapasitas**: no backend change — `ArmadaRowBoard` already receives `armada` (has `KapasitasMaks`) and `jadwal: JadwalCardData[]` (each card already carries `TotalKantong`) as props. Compute `jadwal.reduce((sum, j) => sum + j.TotalKantong, 0)` inline in the component.

**Total Jarak Tempuh hari itu:** requires persisting a route distance, which today is only ever computed transiently client-side in `RouteValidationDialog` via `/api/routing/multi` and never saved. Per the user's explicit decision: persisted once, at `startBerangkat` time (the moment the route is mandatorily re-validated server-side anyway), summed only over `Terbit` Jadwal for that day (`JamAktualBerangkat` non-null) — Draft departures contribute 0 to this figure.

**DDL:**
```sql
ALTER TABLE DashboardPengirimanJadwal ADD JarakKM DECIMAL(10,2) NULL;
```

`startBerangkat` (`pengiriman-jadwal.ts`) already calls `getMultiPointRoute(...)` for validation and discards the result — change it to capture `route.distanceKm` and include `JarakKM = @jarakKM` in the same claim/`UPDATE ... SET Status = 'Terbit', JamAktualBerangkat = GETDATE()` statement that already exists in that function.

`getPengirimanBoard`'s `JadwalCard` interface and its SQL both gain `JarakKM: number | null`. `ArmadaRowBoard` sums `jadwal.filter((j) => j.JamAktualBerangkat != null).reduce((sum, j) => sum + (j.JarakKM ?? 0), 0)`.

**Layout:** the sticky info column (`w-56` in `ArmadaRowBoard`) currently shows Foto/Nama/PlatNomor + Status badge + "+" button. Add a compact 3-stat row (Kapasitas, Kantong, Jarak) below the existing status row — small `text-[10px] text-muted-foreground` labels over `tabular-nums` numbers, consistent with the compact stat styling already used elsewhere in this dashboard (e.g. `open-deliveries-panel.tsx`'s KPI cards, scaled down to fit the sticky column's existing width).

## Part 4: Validasi Rute — Jenis BBM + Total Biaya BBM

`RouteValidationDialog` currently receives `konsumsiBBM`/`kapasitasMaks` as props (resolved by the caller from `openArmada`). Add `jenisBBM: FuelType | null` and `biayaBBMPerLiter: number | null` the same way — `pengiriman-board.tsx` passes `openArmada?.JenisBBM ?? null` and `openArmada?.BiayaBBMPerLiter ?? null`.

Inside the dialog, alongside the existing `totalFuelLiters` computation, add:
```ts
const totalFuelCost = totalFuelLiters != null && biayaBBMPerLiter != null ? totalFuelLiters * biayaBBMPerLiter : null;
```
Rendered in the existing route-stats row (next to distance/duration/fuel-liters), plus a `Jenis BBM: {jenisBBM}` label shown whenever `jenisBBM` is set — same `<span className="flex items-center gap-1">` pattern already used for the distance/duration/fuel stats in that row.

## Part 5: "Ubah Pemesanan" — per-SO reschedule detached from its Draft siblings

**The problem:** a Draft Jadwal can bundle multiple Sales Orders (one departure, several stops). Today the only way to change one SO's vehicle/time is `Batalkan Draft` (cancels the **whole** departure, unscheduling every bundled SO) or `Tambahkan` (only adds more). There's no way to move **one** SO to a different vehicle/time without disturbing its Draft siblings.

**New query-layer functions** (`src/lib/queries/pengiriman-jadwal.ts`):

- `removeSalesOrderFromJadwal(jadwalId: number, salesOrderId: string): Promise<void>` — soft-deletes the matching `DashboardPengirimanJadwalDetail` row (guard: header `Status = 'Draft'`, mirroring every other Draft-only mutation in this file). If that was the last non-deleted detail row on the Jadwal, also soft-deletes the header (mirrors `deleteJadwalDraft`'s own cleanup discipline — no empty ghost Drafts left on the board).
- `getCurrentAssignment(salesOrderId: string): Promise<{ jadwalId: number; armadaId: number; jamJadwal: Date; salesmanId: string | null } | null>` — looks up the SO's current **Draft** Jadwal (if any, via `DashboardPengirimanJadwalDetail`/`DashboardPengirimanJadwal`, `Status = 'Draft'`, both non-deleted); returns `null` if the SO isn't currently in any Draft (either never scheduled, or already `Terbit`). Used to pre-fill "Ubah Pemesanan".

**New orchestrator** (`src/lib/queries/pemesanan.ts`, alongside the existing `createPemesanan`):

```ts
export interface ReschedulePemesananInput {
  salesOrderId: string;
  armadaId: number;
  deliveryDateTime: Date;
  salesmanId: string | null;
}
export async function reschedulePemesanan(input: ReschedulePemesananInput): Promise<{ jadwalId: number }>
```

If `getCurrentAssignment(salesOrderId)` returns a row, calls `removeSalesOrderFromJadwal(currentJadwalId, salesOrderId)` first (freeing the SO from its old bundle without touching its siblings). Then creates a fresh Draft via the existing `createJadwalDraft({ armadaId, jamJadwal: deliveryDateTime, salesOrderIds: [salesOrderId] })` (which already enforces capacity and the new Part-1 time validation) and `updateJadwalDriverTime` for the driver, same two-step pattern `createPemesanan` already uses. On failure after the removal but before the new Draft is fully created, there is nothing to compensate for on the *old* side (the SO is simply back to "Belum Dijadwalkan" until retried) — `createJadwalDraft`'s own existing compensating cleanup already covers a failure inside its own call.

**New UI** (`src/components/dashboard/ubah-pemesanan-dialog.tsx`, new file): same shape as `PemesananFormDialog` (Task 6 of the prior plan) but Mitra/Qty/Varian are **read-only display**, not editable inputs — only Armada, Waktu Pengiriman, and Driver are editable, pre-filled from `getCurrentAssignment` (or blank/defaults if the SO was never scheduled). Reuses the same Armada-disabled-when-not-"Baik" rule and error-surfacing pattern as `PemesananFormDialog`.

**Two entry points, both opening the same dialog:**
1. `route-validation-dialog.tsx`'s `SortableStopRow` (inside "Daftar Tujuan") becomes clickable — opens "Ubah Pemesanan" for that stop's `SalesOrderID`. This directly answers the motivating scenario: detach one stop from a bundled Draft to move it elsewhere.
2. `pemesanan-list.tsx`'s rows get an "Ubah" action (icon button, same row-action pattern as `armada-dialog.tsx`'s edit/delete icons) — reachable even for an SO that was never scheduled at all (`Status = "Belum Dijadwalkan"`, no Draft to detach from — `getCurrentAssignment` simply returns `null` and the dialog opens blank).

## Data shape reference (verified live)

`DashboardArmada` (13 rows) and `DashboardPengirimanJadwal` (20 rows) both currently have no columns beyond what's already described in prior specs — confirmed via live schema query immediately before writing this spec. The 2 `ALTER TABLE`s above are additive only, all new columns nullable, no risk to existing rows or the desktop ERP app (neither table is ERP-owned; both are dashboard-only, same as every other `Dashboard*` table in this codebase).

## Out of scope

- Retrofitting the 14:00 cutoff convention into any module outside Pemesanan/Pengiriman.
- Editing Mitra/Qty/Varian via "Ubah Pemesanan" (still SO-content-immutable, per the original Pemesanan spec's explicit decision — only scheduling fields move here).
- Recomputing/backfilling `JarakKM` for the 20 already-existing `DashboardPengirimanJadwal` rows (historical Terbit departures keep `JarakKM = NULL`; their contribution to "Total Jarak Tempuh hari itu" is simply 0 — acceptable since Part 3's board only ever shows one day at a time going forward, not a historical rollup).
