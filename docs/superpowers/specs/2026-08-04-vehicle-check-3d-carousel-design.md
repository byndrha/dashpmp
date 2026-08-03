# Vehicle Check Pop-up + 3D Truck Carousel — Design Spec

**Company:** PT Mitra Kelola Esindo only. **Module:** Pengiriman (`delivery`), Satpam vehicle-check subsystem.

## Goal

Redo how "Cek Keamanan Kendaraan" is presented and filled in inside Validasi
Rute, without changing what it verifies or who can fill it in:

1. Move it out of the always-visible inline Card and into a pop-up dialog,
   opened from a single status button, matching the "sibling dialog on top"
   pattern `UbahPemesananDialog` already uses against this same parent dialog.
2. Replace the flat 3x2 grid of photo-capture buttons with a 3D truck-box
   carousel — a real CSS 3D cube the user drags to rotate through the
   vehicle's four physical sides, each showing a placeholder truck-side
   illustration until its photo is captured.
3. Change Fuel Meter from a 5-value fraction dropdown (`E`/`1/4`/`1/2`/`3/4`/`F`)
   to a 5-level bar selector (0-4 bars).
4. Add a new required field, "jumlah koli/unit muatan" (cargo unit count),
   entered by Satpam on the Belakang side.
5. Make the whole thing usable on a phone (this is filled in standing at a
   vehicle gate, not at a desk).

## Non-goals

- No change to who can fill this in (`isSatpam` gate, unchanged), when
  (`Status = 'Terbit'` only, unchanged), or the immutability/no-delete-path
  design of a check once submitted.
- No change to the 6 photo types themselves (`DEPAN`, `SAMPING_KANAN`,
  `SAMPING_KIRI`, `BELAKANG`, `BOX_MUATAN`, `KABIN`) or how they're
  captured/uploaded (`CameraCaptureField`, camera-only capture, VPS storage
  path) — only how they're visually grouped and navigated.
- No new animation/3D library dependency (no `three.js`, `framer-motion`,
  or carousel package) — the cube is built with CSS 3D transforms and
  Pointer Events already available in this stack.
- No tour-guide/onboarding feature — that's a separate subsystem, tracked in
  its own future spec (the user explicitly agreed this plan can wait).
- No change to `getJamKembaliAktualMap` or any other consumer of
  `DashboardVehicleCheck` beyond the two column changes below.

## Data model changes

```sql
-- 1. Add the new bar-scale fuel column and the new cargo-count column.
ALTER TABLE DashboardVehicleCheck ADD FuelBar TINYINT NULL;
ALTER TABLE DashboardVehicleCheck ADD MuatanQty INT NULL;

-- 2. Backfill FuelBar for existing rows from the old fraction column.
UPDATE DashboardVehicleCheck SET FuelBar = CASE FuelLevel
  WHEN 'E' THEN 0 WHEN '1/4' THEN 1 WHEN '1/2' THEN 2
  WHEN '3/4' THEN 3 WHEN 'F' THEN 4 END;

-- 3. Backfill MuatanQty for existing rows to 0 (no cargo-count data exists
--    before this plan; 0 is a safe, non-blocking placeholder for old rows,
--    which are all test data from this session's own live verification).
UPDATE DashboardVehicleCheck SET MuatanQty = 0 WHERE MuatanQty IS NULL;

-- 4. Make both NOT NULL now that every row has a value, then drop the old column.
ALTER TABLE DashboardVehicleCheck ALTER COLUMN FuelBar TINYINT NOT NULL;
ALTER TABLE DashboardVehicleCheck ALTER COLUMN MuatanQty INT NOT NULL;
ALTER TABLE DashboardVehicleCheck DROP COLUMN FuelLevel;
```

`DashboardVehicleCheckPhoto` is untouched — still `(VehicleCheckID, JenisFoto,
FilePath)`, still 6 rows per check.

## Types — `src/lib/vehicle-check-types.ts`

- `FuelLevel` type and `FUEL_LEVELS` (or equivalent) are removed. Replaced by:
  ```ts
  export type FuelBar = 0 | 1 | 2 | 3 | 4;
  export const FUEL_BAR_MAX: FuelBar = 4;
  ```
- `VehicleCheckRow.fuelLevel: FuelLevel` becomes `VehicleCheckRow.fuelBar: FuelBar`.
- `VehicleCheckRow` gains `muatanQty: number`.
- New grouping constants driving the carousel (not a data-model change, just
  UI-facing metadata alongside the existing `JENIS_FOTO_LIST`/`JENIS_FOTO_LABEL`):
  ```ts
  export type TruckSide = "DEPAN" | "KANAN" | "BELAKANG" | "KIRI";
  export const TRUCK_SIDE_ORDER: TruckSide[] = ["DEPAN", "KANAN", "BELAKANG", "KIRI"];
  export const TRUCK_SIDE_PRIMARY_PHOTO: Record<TruckSide, JenisFotoKendaraan> = {
    DEPAN: "DEPAN",
    KANAN: "SAMPING_KANAN",
    BELAKANG: "BELAKANG",
    KIRI: "SAMPING_KIRI",
  };
  // Only DEPAN and BELAKANG have a second nested photo slot.
  export const TRUCK_SIDE_SECONDARY_PHOTO: Partial<Record<TruckSide, JenisFotoKendaraan>> = {
    DEPAN: "KABIN",
    BELAKANG: "BOX_MUATAN",
  };
  ```

## Server — `src/lib/queries/vehicle-check.ts`

- `getVehicleChecksForJadwal`: SELECT list changes `vc.FuelLevel` →
  `vc.FuelBar, vc.MuatanQty`; row mapping adds `fuelBar`/`muatanQty` in place
  of `fuelLevel`.
- `createVehicleCheck`: input changes `fuelLevel: FuelLevel` → `fuelBar: FuelBar`,
  adds `muatanQty: number`. The INSERT statement's column list and bound
  inputs change accordingly (`sql.TinyInt` for `fuelBar`, `sql.Int` for
  `muatanQty`). Everything else about this function — the transaction, the
  Terbit-only gate, the one-check-per-(JadwalID,Tipe) uniqueness check — is
  unchanged.
- `src/app/(dashboard)/delivery/actions.ts`'s vehicle-check server action
  (`handleSubmitVehicleCheck`'s server-side counterpart) passes through the
  renamed/new fields unchanged in shape (thin wrapper, no new logic).

## Components

### `TruckCubeCarousel` (new, reusable) — `src/components/dashboard/truck-cube-carousel.tsx`

A generic drag-to-rotate 3D cube, not vehicle-check-specific in its own
right (it takes 4 arbitrary React nodes, one per side):

```ts
interface TruckCubeCarouselProps {
  sides: Record<TruckSide, React.ReactNode>;
  activeSide: TruckSide;
  onActiveSideChange: (side: TruckSide) => void;
}
```

- Renders a `perspective`-wrapped container with a `preserve-3d` inner cube;
  each side is `position: absolute; inset: 0` with its own
  `rotateY(Nx90deg) translateZ(halfWidth)` matching `TRUCK_SIDE_ORDER`'s
  walk (`DEPAN` at 0°, `KANAN` at 90°, `BELAKANG` at 180°, `KIRI` at -90° —
  the exact angles validated in the brainstorming companion's cube demo).
- Pointer Events (`pointerdown`/`pointermove`/`pointerup`, not
  touch-specific handlers) drag the cube's `rotateY` in real time; on
  release, it snaps to the nearest 90° increment and calls
  `onActiveSideChange` with the resulting `TruckSide`. This exactly matches
  the interaction validated in the brainstorming companion prototype.
- `touch-action: pan-y` on the drag surface so a horizontal drag doesn't
  fight the page's vertical scroll on mobile.
- Also exposes small left/right arrow buttons beside the cube (not
  drag-only) as an accessible/discoverable alternative to dragging —
  clicking one rotates to the adjacent side in `TRUCK_SIDE_ORDER`.
- Each side's placeholder: before this task builds the real truck-side SVGs,
  it renders a simple flat illustration (line-art box-truck silhouette from
  that viewing angle, using the dashboard's existing theme CSS variables for
  stroke/fill) behind the side's content — the illustration is a static
  visual backdrop, not interactive, and has no effect on form state.

### `VehicleCheckDialog` (new) — `src/components/dashboard/vehicle-check-dialog.tsx`

Replaces `VehicleCheckPanel`'s current inline-Card role. Same props
`VehicleCheckPanel` has today (`jadwalId`, `armadaId`, `isSatpam`,
`onUploadPhoto`, `onSubmitCheck`, `checks`), plus dialog open-state handling
local to this component (it manages its own `open`/`onOpenChange`, the
parent only renders the trigger).

- Renders a status button in place of today's Card:
  `"Cek Keamanan Kendaraan — Berangkat: {sudah|belum}, Datang: {sudah|belum|-}"`
  (Datang shows `-` until Berangkat exists, matching the existing
  sequential gate). Clicking opens the `Dialog`.
- Inside the `Dialog` (`DialogContent className="max-w-lg max-h-[90vh]
  overflow-y-auto"` — shadcn's `DialogContent` already shrinks to near-full
  viewport width on small screens by default the same way
  `UbahPemesananDialog`'s does; the extra `max-h-[90vh] overflow-y-auto` is
  new here specifically because this dialog now holds a full carousel plus
  inputs, more content than any existing sibling dialog on this parent):
  for each tipe (`BERANGKAT`
  then `DATANG`, same sequential-gate rule as today — `DATANG`'s form only
  renders once `BERANGKAT` exists), shows either the existing
  `CheckSummary` (unchanged) or a new `CheckForm` build around
  `TruckCubeCarousel` instead of the flat photo grid:
  - `TruckCubeCarousel`'s 4 sides render:
    - `KANAN` / `KIRI`: just that side's single `CameraCaptureField`.
    - `DEPAN`: `CameraCaptureField` for `DEPAN`, a second smaller
      `CameraCaptureField` for `KABIN`, the Odometer `Input`, and the new
      Fuel Bar selector (5 clickable bar segments, 0-4, replacing the old
      `Select`).
    - `BELAKANG`: `CameraCaptureField` for `BELAKANG`, a second smaller
      `CameraCaptureField` for `BOX_MUATAN`, and the new "Jumlah Koli/Unit
      Muatan" `Input` (`type="number"`, `min={0}`).
  - Submit gating (`canSubmit`) is unchanged in spirit: all 6 photos
    present, odometer > 0, plus now `muatanQty` filled (`!== ""`, `>= 0`
    accepted so an empty return load is valid).
  - `handleSubmit` passes `fuelBar` (number) and `muatanQty` (number)
    instead of the old `fuelLevel` string.

### `CameraCaptureField`

No changes. Reused exactly as-is inside each carousel side.

## Access control

No change — `isSatpam` continues to gate whether a `CheckForm` renders vs. a
read-only placeholder, exactly as it does inside today's `VehicleCheckPanel`.

## Open risk, explicitly accepted

The truck-side placeholder illustrations are simple static SVGs written as
part of this plan (line-art, not photographic), not real reference photos of
this company's actual vehicles — the user asked for a placeholder image,
not a photoreal asset pipeline. Swapping in real illustrations or photos
later is a pure asset change, no code restructuring needed, since the
carousel only cares that each side receives a `ReactNode`.
