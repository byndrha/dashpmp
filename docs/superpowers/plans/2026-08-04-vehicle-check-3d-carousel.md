# Vehicle Check Pop-up + 3D Truck Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move "Cek Keamanan Kendaraan" from an always-visible inline Card into a pop-up dialog, replace its flat photo grid with a draggable 3D truck-box carousel, change Fuel Meter to a 5-level bar selector, and add a required cargo-unit-count field.

**Architecture:** A new generic `TruckCubeCarousel` (CSS 3D transforms + Pointer Events, no new dependency) hosts per-side content; a new `VehicleCheckDialog` replaces `VehicleCheckPanel` as the pop-up entry point and composes the carousel with the existing `CameraCaptureField`; `DashboardVehicleCheck.FuelLevel` (fraction string) is replaced by `FuelBar` (0-4 tinyint) and a new `MuatanQty` (int) column is added.

**Tech Stack:** Next.js 16 (App Router, `"use client"` components), React 19, TypeScript, Tailwind v4, shadcn/`@base-ui/react` Dialog, MSSQL via `mssql` (`sql`/`getPool()` from `@/lib/db`).

## Global Constraints

- No new npm dependency for the 3D effect — build it with CSS `transform-style: preserve-3d` / `rotateY` / `translateZ` and native Pointer Events, per the design spec's explicit non-goal.
- The 6 photo types (`DEPAN`, `SAMPING_KANAN`, `SAMPING_KIRI`, `BELAKANG`, `BOX_MUATAN`, `KABIN`), their capture mechanism (`CameraCaptureField`, camera-only), and their VPS storage path are unchanged — only how they're grouped/navigated in the UI.
- `isSatpam` gate (who can fill the form) and `Status = 'Terbit'` gate (when) are unchanged.
- Fuel scale is 5 levels, 0-4 bars (`0` = empty/"E", `4` = full), replacing the old `E`/`1/4`/`1/2`/`3/4`/`F` fraction values 1:1 in meaning.
- `MuatanQty` (cargo unit/koli count) is required on every check (both `BERANGKAT` and `DATANG`), minimum `0` (a returning empty truck is valid).
- Rotation order around the truck is `DEPAN -> KANAN -> BELAKANG -> KIRI` (a clockwise walk), matching `TRUCK_SIDE_ORDER`.
- Truck-side illustrations are placeholder line-art SVGs (not real photos) — swappable later without code changes since the carousel only consumes `ReactNode`s per side.

---

## Task 0: Database migration — FuelBar + MuatanQty columns

This task is run directly by the plan's controller (not dispatched to a
subagent implementer) — it's a one-off live-DB DDL script with no lasting
git artifact, following the same pattern used for this session's prior
`DashboardPengirimanJadwal` column additions.

**Files:**
- Create (temporary, delete after running): `scripts/migrate-vehicle-check-fuelbar-muatanqty.ts`

- [ ] **Step 1: Write the migration script**

```ts
import { getPool, sql } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`ALTER TABLE DashboardVehicleCheck ADD FuelBar TINYINT NULL`);
  await pool.request().query(`ALTER TABLE DashboardVehicleCheck ADD MuatanQty INT NULL`);

  await pool.request().query(`
    UPDATE DashboardVehicleCheck SET FuelBar = CASE FuelLevel
      WHEN 'E' THEN 0 WHEN '1/4' THEN 1 WHEN '1/2' THEN 2
      WHEN '3/4' THEN 3 WHEN 'F' THEN 4 END
  `);
  await pool.request().query(`UPDATE DashboardVehicleCheck SET MuatanQty = 0 WHERE MuatanQty IS NULL`);

  await pool.request().query(`ALTER TABLE DashboardVehicleCheck ALTER COLUMN FuelBar TINYINT NOT NULL`);
  await pool.request().query(`ALTER TABLE DashboardVehicleCheck ALTER COLUMN MuatanQty INT NOT NULL`);
  await pool.request().query(`ALTER TABLE DashboardVehicleCheck DROP COLUMN FuelLevel`);

  const check = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardVehicleCheck' AND COLUMN_NAME IN ('FuelBar', 'MuatanQty', 'FuelLevel')
  `);
  console.log(check.recordset);

  const sample = await pool.request().query(`SELECT TOP 5 VehicleCheckID, FuelBar, MuatanQty FROM DashboardVehicleCheck`);
  console.log(sample.recordset);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/migrate-vehicle-check-fuelbar-muatanqty.ts`

Expected: the `INFORMATION_SCHEMA.COLUMNS` query prints `FuelBar` (tinyint,
NO), `MuatanQty` (int, NO), and no `FuelLevel` row at all (confirms the
drop succeeded). The sample query prints existing rows (if any) with
`FuelBar` correctly backfilled from their old fraction value and
`MuatanQty` at `0`.

- [ ] **Step 3: Delete the script**

This is a one-off DDL migration, not lasting application code — delete
`scripts/migrate-vehicle-check-fuelbar-muatanqty.ts` after it runs
successfully. No git commit for this task (schema lives in the database,
not in git).

---

## Task 1: Types + query layer

**Files:**
- Modify: `src/lib/vehicle-check-types.ts`
- Modify: `src/lib/queries/vehicle-check.ts`

**Interfaces:**
- Produces: `FuelBar` (`0 | 1 | 2 | 3 | 4`), `FUEL_BAR_MAX`, `TruckSide`
  (`"DEPAN" | "KANAN" | "BELAKANG" | "KIRI"`), `TRUCK_SIDE_ORDER`,
  `TRUCK_SIDE_LABEL`, `TRUCK_SIDE_PRIMARY_PHOTO`, `TRUCK_SIDE_SECONDARY_PHOTO`
  (all from `vehicle-check-types.ts`); `VehicleCheckRow.fuelBar: FuelBar`,
  `VehicleCheckRow.muatanQty: number` (replacing `fuelLevel`);
  `createVehicleCheck(input: { ...; fuelBar: FuelBar; muatanQty: number; ... })`
  and `getVehicleChecksForJadwal` returning the updated `VehicleCheckRow`
  shape (both from `vehicle-check.ts`) — later tasks depend on these exact
  names and shapes.

- [ ] **Step 1: Rewrite `src/lib/vehicle-check-types.ts`**

```ts
// Client-safe vehicle-check types/constants, split out of
// src/lib/queries/vehicle-check.ts so "use client" components (e.g.
// VehicleCheckDialog, RouteValidationDialog) don't pull in that module's
// `@/lib/db` import (mssql + its Node-only deps like tls) into the client
// bundle. Mirrors the same split already used for armada-status.ts vs
// armada.ts.

export type VehicleCheckTipe = "BERANGKAT" | "DATANG";

// 0-4 bar fuel gauge, replacing the old 5-value fraction scale
// (E/1/4/1/2/3/4/F) with the same 5 discrete levels.
export type FuelBar = 0 | 1 | 2 | 3 | 4;
export const FUEL_BAR_MAX: FuelBar = 4;

export type JenisFotoKendaraan =
  | "DEPAN"
  | "SAMPING_KANAN"
  | "SAMPING_KIRI"
  | "BELAKANG"
  | "BOX_MUATAN"
  | "KABIN";

export const JENIS_FOTO_LIST: JenisFotoKendaraan[] = [
  "DEPAN",
  "SAMPING_KANAN",
  "SAMPING_KIRI",
  "BELAKANG",
  "BOX_MUATAN",
  "KABIN",
];

export const JENIS_FOTO_LABEL: Record<JenisFotoKendaraan, string> = {
  DEPAN: "Depan",
  SAMPING_KANAN: "Samping Kanan",
  SAMPING_KIRI: "Samping Kiri",
  BELAKANG: "Belakang",
  BOX_MUATAN: "Box Muatan",
  KABIN: "Kabin (Area Speedometer)",
};

// The 4 physical sides a Satpam walks around, in the order
// TruckCubeCarousel rotates through them (a clockwise walk around the
// vehicle: DEPAN -> KANAN -> BELAKANG -> KIRI -> back to DEPAN).
export type TruckSide = "DEPAN" | "KANAN" | "BELAKANG" | "KIRI";

export const TRUCK_SIDE_ORDER: TruckSide[] = ["DEPAN", "KANAN", "BELAKANG", "KIRI"];

export const TRUCK_SIDE_LABEL: Record<TruckSide, string> = {
  DEPAN: "Depan",
  KANAN: "Kanan",
  BELAKANG: "Belakang",
  KIRI: "Kiri",
};

// Each side's primary exterior photo slot.
export const TRUCK_SIDE_PRIMARY_PHOTO: Record<TruckSide, JenisFotoKendaraan> = {
  DEPAN: "DEPAN",
  KANAN: "SAMPING_KANAN",
  BELAKANG: "BELAKANG",
  KIRI: "SAMPING_KIRI",
};

// Only DEPAN and BELAKANG have a second, nested photo slot.
export const TRUCK_SIDE_SECONDARY_PHOTO: Partial<Record<TruckSide, JenisFotoKendaraan>> = {
  DEPAN: "KABIN",
  BELAKANG: "BOX_MUATAN",
};

export interface VehicleCheckPhoto {
  jenisFoto: JenisFotoKendaraan;
  filePath: string;
}

export interface VehicleCheckRow {
  vehicleCheckId: number;
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelBar: FuelBar;
  muatanQty: number;
  checkedByUserId: string;
  checkedAt: string;
  photos: VehicleCheckPhoto[];
}
```

- [ ] **Step 2: Update `src/lib/queries/vehicle-check.ts`'s import/re-export and `getVehicleChecksForJadwal`**

Replace the top import/re-export block:

```ts
import { getPool, sql } from "@/lib/db";
import {
  type VehicleCheckTipe,
  type FuelBar,
  type JenisFotoKendaraan,
  JENIS_FOTO_LIST,
  JENIS_FOTO_LABEL,
  type VehicleCheckPhoto,
  type VehicleCheckRow,
} from "@/lib/vehicle-check-types";

// Re-exported so existing server-side importers (upload route, server
// actions) can keep doing `import { ... } from "@/lib/queries/vehicle-check"`
// unchanged. Client components should import these from
// "@/lib/vehicle-check-types" directly instead, to avoid pulling this
// module's `@/lib/db` (mssql) dependency into the client bundle.
export type { VehicleCheckTipe, FuelBar, JenisFotoKendaraan, VehicleCheckPhoto, VehicleCheckRow };
export { JENIS_FOTO_LIST, JENIS_FOTO_LABEL };
```

Replace `getVehicleChecksForJadwal`'s SELECT and row-mapping:

```ts
export async function getVehicleChecksForJadwal(jadwalId: number): Promise<VehicleCheckRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`
      SELECT vc.VehicleCheckID, vc.JadwalID, vc.Tipe, vc.OdometerKM, vc.FuelBar, vc.MuatanQty,
             vc.CheckedByUserID, vc.CheckedAt,
             p.JenisFoto, p.FilePath
      FROM DashboardVehicleCheck vc
      LEFT JOIN DashboardVehicleCheckPhoto p ON p.VehicleCheckID = vc.VehicleCheckID
      WHERE vc.JadwalID = @jadwalId
      ORDER BY vc.Tipe, p.JenisFoto
    `);

  const rows = result.recordset as {
    VehicleCheckID: number;
    JadwalID: number;
    Tipe: VehicleCheckTipe;
    OdometerKM: number;
    FuelBar: FuelBar;
    MuatanQty: number;
    CheckedByUserID: string;
    CheckedAt: Date;
    JenisFoto: JenisFotoKendaraan | null;
    FilePath: string | null;
  }[];

  const byId = new Map<number, VehicleCheckRow>();
  for (const r of rows) {
    let entry = byId.get(r.VehicleCheckID);
    if (!entry) {
      entry = {
        vehicleCheckId: r.VehicleCheckID,
        jadwalId: r.JadwalID,
        tipe: r.Tipe,
        odometerKM: r.OdometerKM,
        fuelBar: r.FuelBar,
        muatanQty: r.MuatanQty,
        checkedByUserId: r.CheckedByUserID,
        checkedAt: r.CheckedAt.toISOString(),
        photos: [],
      };
      byId.set(r.VehicleCheckID, entry);
    }
    if (r.JenisFoto && r.FilePath) {
      entry.photos.push({ jenisFoto: r.JenisFoto, filePath: r.FilePath });
    }
  }
  return [...byId.values()];
}
```

- [ ] **Step 3: Update `createVehicleCheck`**

```ts
export async function createVehicleCheck(input: {
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelBar: FuelBar;
  muatanQty: number;
  userId: string;
  photos: VehicleCheckPhoto[];
}): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const jadwal = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .query(`SELECT Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
    const jadwalStatus = (jadwal.recordset[0] as { Status: string } | undefined)?.Status;
    if (jadwalStatus !== "Terbit") {
      throw new Error("Cek kendaraan hanya dapat diisi untuk keberangkatan yang sudah Terbit.");
    }

    const existing = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .input("tipe", sql.VarChar(10), input.tipe)
      .query(`SELECT VehicleCheckID FROM DashboardVehicleCheck WHERE JadwalID = @jadwalId AND Tipe = @tipe`);
    if (existing.recordset.length > 0) {
      throw new Error(
        input.tipe === "BERANGKAT"
          ? "Cek Berangkat untuk keberangkatan ini sudah pernah diisi."
          : "Cek Datang untuk keberangkatan ini sudah pernah diisi."
      );
    }

    const header = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .input("tipe", sql.VarChar(10), input.tipe)
      .input("odometerKM", sql.Int, input.odometerKM)
      .input("fuelBar", sql.TinyInt, input.fuelBar)
      .input("muatanQty", sql.Int, input.muatanQty)
      .input("userId", sql.VarChar(16), input.userId).query(`
        INSERT INTO DashboardVehicleCheck (JadwalID, Tipe, OdometerKM, FuelBar, MuatanQty, CheckedByUserID)
        OUTPUT INSERTED.VehicleCheckID
        VALUES (@jadwalId, @tipe, @odometerKM, @fuelBar, @muatanQty, @userId)
      `);
    const vehicleCheckId = (header.recordset[0] as { VehicleCheckID: number }).VehicleCheckID;

    for (const photo of input.photos) {
      await new sql.Request(transaction)
        .input("vehicleCheckId", sql.Int, vehicleCheckId)
        .input("jenisFoto", sql.VarChar(16), photo.jenisFoto)
        .input("filePath", sql.VarChar(256), photo.filePath).query(`
          INSERT INTO DashboardVehicleCheckPhoto (VehicleCheckID, JenisFoto, FilePath)
          VALUES (@vehicleCheckId, @jenisFoto, @filePath)
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

`getJamKembaliAktualMap` is untouched — it never reads `FuelLevel`/`FuelBar`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expect errors in `src/app/(dashboard)/delivery/actions.ts`
and `src/components/dashboard/vehicle-check-panel.tsx` (both still reference
`FuelLevel`/`fuelLevel` — fixed in Tasks 2 and 5). No errors should appear
inside `src/lib/vehicle-check-types.ts` or `src/lib/queries/vehicle-check.ts`
themselves.

Run: `npx eslint src/lib/vehicle-check-types.ts src/lib/queries/vehicle-check.ts` — expect 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vehicle-check-types.ts src/lib/queries/vehicle-check.ts
git commit -m "Replace vehicle-check FuelLevel with FuelBar, add MuatanQty"
```

---

## Task 2: Server action validation

**Files:**
- Modify: `src/app/(dashboard)/delivery/actions.ts:34-41` (import), `:202-224` (`createVehicleCheckAction`)

**Interfaces:**
- Consumes: `FuelBar`, `createVehicleCheck` (Task 1).
- Produces: `createVehicleCheckAction(input: { jadwalId: number; tipe: VehicleCheckTipe; odometerKM: number; fuelBar: FuelBar; muatanQty: number; photos: VehicleCheckPhoto[] })` — Task 6's `route-validation-dialog.tsx` calls this exact signature.

- [ ] **Step 1: Update the import**

```ts
import {
  getVehicleChecksForJadwal,
  createVehicleCheck,
  type VehicleCheckRow,
  type VehicleCheckTipe,
  type FuelBar,
  type VehicleCheckPhoto,
} from "@/lib/queries/vehicle-check";
```

- [ ] **Step 2: Update `createVehicleCheckAction`**

```ts
export async function createVehicleCheckAction(input: {
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelBar: FuelBar;
  muatanQty: number;
  photos: VehicleCheckPhoto[];
}): Promise<void> {
  const session = await requireModuleAccess("delivery");
  // Deliberately NOT bypassed by isSuperAdmin — see the design spec's "Deliberately
  // not bypassed by isSuperAdmin" note. A gate-check record is a physical-presence
  // claim, not a general permission.
  if (!session.user.isSatpam) {
    throw new Error("Hanya Satpam yang dapat mengisi Cek Berangkat/Cek Datang.");
  }
  if (input.photos.length !== 6) {
    throw new Error("Semua 6 foto kendaraan wajib diisi.");
  }
  if (!(input.odometerKM > 0)) {
    throw new Error("Odometer wajib diisi dengan angka yang valid.");
  }
  if (!(input.fuelBar >= 0 && input.fuelBar <= 4)) {
    throw new Error("Fuel Meter wajib diisi.");
  }
  if (!(input.muatanQty >= 0)) {
    throw new Error("Jumlah muatan wajib diisi dengan angka 0 atau lebih.");
  }
  await createVehicleCheck({ ...input, userId: session.user.id });
  revalidatePath("/delivery");
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect this file to now be clean (no more
`FuelLevel` references here); remaining errors, if any, should only be in
`src/components/dashboard/vehicle-check-panel.tsx` and
`src/components/dashboard/route-validation-dialog.tsx` (fixed in Tasks 5-6).

Run: `npx eslint src/app/\(dashboard\)/delivery/actions.ts` — expect 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/delivery/actions.ts"
git commit -m "Validate fuelBar/muatanQty in createVehicleCheckAction"
```

---

## Task 3: Truck-side placeholder illustrations

**Files:**
- Create: `src/components/dashboard/truck-side-illustration.tsx`

**Interfaces:**
- Consumes: `TruckSide` (Task 1, `@/lib/vehicle-check-types`).
- Produces: `TruckSideIllustration({ side: TruckSide }): JSX.Element` — Task 5
  renders this behind each carousel side's content.

- [ ] **Step 1: Write the component**

```tsx
import type { TruckSide } from "@/lib/vehicle-check-types";

// Simple placeholder line-art per truck side — not a real vehicle photo.
// Swapping these for real illustrations or reference photos later is a
// pure asset change: the carousel only ever consumes a ReactNode per side.

function DepanIllustration() {
  return (
    <svg viewBox="0 0 120 80" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="20" y="14" width="80" height="46" rx="6" />
      <rect x="34" y="20" width="52" height="20" rx="3" />
      <line x1="60" y1="40" x2="60" y2="60" />
      <circle cx="34" cy="66" r="8" />
      <circle cx="86" cy="66" r="8" />
    </svg>
  );
}

function SampingIllustration({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 160 80"
      className="h-full w-full"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="8" y="18" width="40" height="38" rx="4" />
      <rect x="16" y="24" width="18" height="14" rx="2" />
      <rect x="48" y="10" width="104" height="46" rx="4" />
      <circle cx="30" cy="62" r="8" />
      <circle cx="128" cy="62" r="8" />
    </svg>
  );
}

function BelakangIllustration() {
  return (
    <svg viewBox="0 0 120 80" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="20" y="10" width="80" height="52" rx="4" />
      <line x1="60" y1="10" x2="60" y2="62" />
      <rect x="28" y="18" width="24" height="36" rx="2" />
      <rect x="68" y="18" width="24" height="36" rx="2" />
      <circle cx="34" cy="68" r="8" />
      <circle cx="86" cy="68" r="8" />
    </svg>
  );
}

export function TruckSideIllustration({ side }: { side: TruckSide }) {
  if (side === "DEPAN") return <DepanIllustration />;
  if (side === "BELAKANG") return <BelakangIllustration />;
  return <SampingIllustration flip={side === "KIRI"} />;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — expect 0 new errors from this file.
Run: `npx eslint src/components/dashboard/truck-side-illustration.tsx` — expect 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/truck-side-illustration.tsx
git commit -m "Add placeholder truck-side line-art illustrations"
```

---

## Task 4: `TruckCubeCarousel` component

**Files:**
- Create: `src/components/dashboard/truck-cube-carousel.tsx`

**Interfaces:**
- Consumes: `TruckSide`, `TRUCK_SIDE_ORDER` (Task 1, `@/lib/vehicle-check-types`).
- Produces:
  ```ts
  function TruckCubeCarousel(props: {
    sides: Record<TruckSide, React.ReactNode>;
    activeSide: TruckSide;
    onActiveSideChange: (side: TruckSide) => void;
  }): JSX.Element
  ```
  Task 5 renders this as a controlled component, feeding it 4 `ReactNode`s
  (one per truck side) and tracking `activeSide` in its own state.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TRUCK_SIDE_ORDER, type TruckSide } from "@/lib/vehicle-check-types";

// A face placed at `rotateY(A) translateZ(r)` faces the viewer once the
// cube's own rotation brings its angle to 0, i.e. when the cube's rotateY
// equals -A. KANAN/KIRI's signs below are the standard CSS-cube convention
// (right face at +90deg, left face at -90deg) — validated interactively in
// this feature's brainstorming session before implementation started.
const SIDE_DEGREES: Record<TruckSide, number> = {
  DEPAN: 0,
  KANAN: 90,
  BELAKANG: 180,
  KIRI: -90,
};

function nearestSide(deg: number): TruckSide {
  const norm = ((deg % 360) + 360) % 360;
  if (norm < 45 || norm >= 315) return "DEPAN";
  if (norm >= 45 && norm < 135) return "KANAN";
  if (norm >= 135 && norm < 225) return "BELAKANG";
  return "KIRI";
}

export function TruckCubeCarousel({
  sides,
  activeSide,
  onActiveSideChange,
}: {
  sides: Record<TruckSide, React.ReactNode>;
  activeSide: TruckSide;
  onActiveSideChange: (side: TruckSide) => void;
}) {
  const [rotY, setRotY] = useState(-SIDE_DEGREES[activeSide]);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartRot = useRef(0);

  // Recompute rotY (via the shortest path from its current value) whenever
  // the parent changes `activeSide` some other way than a drag on this
  // component itself (e.g. the arrow buttons below).
  useEffect(() => {
    if (dragging) return;
    setRotY((current) => {
      const base = Math.round(current / 360) * 360;
      return base - SIDE_DEGREES[activeSide];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSide]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    setDragging(true);
    dragStartX.current = e.clientX;
    dragStartRot.current = rotY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setRotY(dragStartRot.current + (e.clientX - dragStartX.current) * 0.5);
  }

  function handlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    const landed = nearestSide(-rotY);
    const base = Math.round(rotY / 360) * 360;
    setRotY(base - SIDE_DEGREES[landed]);
    onActiveSideChange(landed);
  }

  function step(dir: 1 | -1) {
    const idx = TRUCK_SIDE_ORDER.indexOf(activeSide);
    const next = TRUCK_SIDE_ORDER[(idx + dir + TRUCK_SIDE_ORDER.length) % TRUCK_SIDE_ORDER.length];
    onActiveSideChange(next);
  }

  return (
    <div className="flex w-full items-center justify-center gap-2">
      <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => step(-1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <div
        className="relative h-[380px] w-full max-w-[280px] select-none"
        style={{ perspective: "900px", touchAction: "pan-y" }}
      >
        <div
          className="relative h-full w-full cursor-grab active:cursor-grabbing"
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateY(${rotY}deg)`,
            transition: dragging ? "none" : "transform 0.2s ease-out",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {TRUCK_SIDE_ORDER.map((side) => (
            <div
              key={side}
              className="absolute inset-0 overflow-y-auto rounded-lg border bg-card"
              style={{
                transform: `rotateY(${SIDE_DEGREES[side]}deg) translateZ(140px)`,
                backfaceVisibility: "hidden",
              }}
            >
              {sides[side]}
            </div>
          ))}
        </div>
      </div>
      <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => step(1)}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit` — expect 0 new errors from this file.
Run: `npx eslint src/components/dashboard/truck-cube-carousel.tsx` — expect 0 errors.

- [ ] **Step 3: Live browser check of the drag/rotate/snap behavior**

This component has no automated test harness in this project (no
`jest`/`vitest` configured) — verify it by rendering it in a throwaway page
and interacting with it directly, the same way this session has verified
other interactive UI:

1. Create a throwaway route `src/app/(dashboard)/_scratch-carousel/page.tsx`
   that renders `<TruckCubeCarousel sides={{ DEPAN: <div>Depan</div>, KANAN:
   <div>Kanan</div>, BELAKANG: <div>Belakang</div>, KIRI: <div>Kiri</div> }}
   activeSide={side} onActiveSideChange={setSide} />` inside a small client
   component wrapping a local `useState<TruckSide>("DEPAN")`.
2. Open it in the browser preview. Drag left — confirm `KANAN` becomes the
   front-facing side after release (snaps cleanly, no half-rotated resting
   state). Drag right from `DEPAN` — confirm `KIRI` becomes front-facing.
   Click the right arrow from `DEPAN` — confirm it goes to `KANAN`; from
   `KANAN`, confirm it goes to `BELAKANG`.
3. If the drag direction feels backwards (dragging left shows `KIRI` instead
   of `KANAN`), the fix is a single sign flip: negate the drag delta in
   `handlePointerMove` (`dragStartRot.current - (e.clientX - dragStartX.current) * 0.5`).
   Do not change `SIDE_DEGREES` — that mapping is what keeps `nearestSide`
   and the arrow-button stepping internally consistent.
4. Confirm each face's content (plain `<div>` text in this throwaway check)
   doesn't visually clip inside the `h-[380px]` face container. Task 5 will
   put much richer content (photo buttons + inputs) in the `DEPAN`/`BELAKANG`
   faces — if this simple text already feels cramped, increase the
   `h-[380px]` constant now so Task 5 doesn't inherit an undersized cube.
5. Delete `src/app/(dashboard)/_scratch-carousel/page.tsx` once satisfied —
   it was only for this manual check, not a feature route.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/truck-cube-carousel.tsx
git commit -m "Add TruckCubeCarousel: drag-to-rotate 3D truck-box carousel"
```

---

## Task 5: `VehicleCheckDialog` (replaces `VehicleCheckPanel`)

**Files:**
- Create: `src/components/dashboard/vehicle-check-dialog.tsx`

**Interfaces:**
- Consumes: `TruckCubeCarousel` (Task 4), `TruckSideIllustration` (Task 3),
  `CameraCaptureField` (existing, unchanged), `TruckSide`, `TRUCK_SIDE_LABEL`,
  `TRUCK_SIDE_PRIMARY_PHOTO`, `TRUCK_SIDE_SECONDARY_PHOTO`, `FuelBar`,
  `FUEL_BAR_MAX`, `JENIS_FOTO_LIST`, `JENIS_FOTO_LABEL`, `VehicleCheckRow`,
  `VehicleCheckTipe`, `VehicleCheckPhoto`, `JenisFotoKendaraan` (Task 1,
  `@/lib/vehicle-check-types`).
- Produces:
  ```ts
  function VehicleCheckDialog(props: {
    jadwalId: number;
    armadaId: number;
    isSatpam: boolean;
    onUploadPhoto: (file: File, jenisFoto: JenisFotoKendaraan) => Promise<string>;
    onSubmitCheck: (input: {
      tipe: VehicleCheckTipe;
      odometerKM: number;
      fuelBar: FuelBar;
      muatanQty: number;
      photos: VehicleCheckPhoto[];
    }) => Promise<void>;
    checks: VehicleCheckRow[];
  }): JSX.Element
  ```
  This is byte-for-byte the same prop shape `VehicleCheckPanel` had before
  (only `fuelLevel: FuelLevel` in `onSubmitCheck`'s input became `fuelBar:
  FuelBar` plus a new `muatanQty: number`) — Task 6 swaps the import and
  component name in `route-validation-dialog.tsx` with no other prop changes
  needed at the call site.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Gauge, Fuel, Clock, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CameraCaptureField } from "@/components/dashboard/camera-capture-field";
import { TruckCubeCarousel } from "@/components/dashboard/truck-cube-carousel";
import { TruckSideIllustration } from "@/components/dashboard/truck-side-illustration";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  JENIS_FOTO_LIST,
  JENIS_FOTO_LABEL,
  TRUCK_SIDE_LABEL,
  TRUCK_SIDE_PRIMARY_PHOTO,
  TRUCK_SIDE_SECONDARY_PHOTO,
  FUEL_BAR_MAX,
  type VehicleCheckRow,
  type VehicleCheckTipe,
  type FuelBar,
  type VehicleCheckPhoto,
  type JenisFotoKendaraan,
  type TruckSide,
} from "@/lib/vehicle-check-types";

const TIPE_LABEL: Record<VehicleCheckTipe, string> = { BERANGKAT: "Cek Berangkat", DATANG: "Cek Datang" };

function CheckSummary({ check }: { check: VehicleCheckRow }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">{TIPE_LABEL[check.tipe]}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3" />
          {formatTime(check.checkedAt)}
        </span>
      </div>
      <div className="flex flex-wrap gap-4 text-muted-foreground">
        <span className="flex items-center gap-1">
          <Gauge className="size-3" />
          {check.odometerKM.toLocaleString("id-ID")} KM
        </span>
        <span className="flex items-center gap-1">
          <Fuel className="size-3" />
          {check.fuelBar} / {FUEL_BAR_MAX} bar
        </span>
        <span className="flex items-center gap-1">
          <Package className="size-3" />
          {check.muatanQty.toLocaleString("id-ID")} koli
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {check.photos.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset
          <img key={p.jenisFoto} src={p.filePath} alt={JENIS_FOTO_LABEL[p.jenisFoto]} className="h-14 w-full rounded object-cover" />
        ))}
      </div>
    </div>
  );
}

function FuelBarSelector({ value, onChange }: { value: FuelBar; onChange: (v: FuelBar) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">Fuel Meter</span>
      <div className="flex items-end gap-1">
        <button
          type="button"
          onClick={() => onChange(0)}
          className={cn(
            "flex h-7 w-6 items-end justify-center rounded-sm border pb-0.5 text-[10px] font-medium transition-colors",
            value === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-muted-foreground"
          )}
          aria-label="Kosong (E)"
        >
          E
        </button>
        {([1, 2, 3, 4] as FuelBar[]).map((bar, i) => (
          <button
            key={bar}
            type="button"
            onClick={() => onChange(bar)}
            className={cn(
              "w-5 rounded-sm border transition-colors",
              bar <= value ? "border-primary bg-primary" : "border-border bg-muted"
            )}
            style={{ height: `${14 + i * 6}px` }}
            aria-label={`${bar} bar`}
          />
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground">
        {value} / {FUEL_BAR_MAX} bar
      </span>
    </div>
  );
}

function CheckForm({
  tipe,
  onUploadPhoto,
  onSubmitCheck,
}: {
  tipe: VehicleCheckTipe;
  onUploadPhoto: (file: File, jenisFoto: JenisFotoKendaraan) => Promise<string>;
  onSubmitCheck: (input: {
    tipe: VehicleCheckTipe;
    odometerKM: number;
    fuelBar: FuelBar;
    muatanQty: number;
    photos: VehicleCheckPhoto[];
  }) => Promise<void>;
}) {
  const [activeSide, setActiveSide] = useState<TruckSide>("DEPAN");
  const [photos, setPhotos] = useState<Partial<Record<JenisFotoKendaraan, string>>>({});
  const [uploading, setUploading] = useState<JenisFotoKendaraan | null>(null);
  const [odometerKM, setOdometerKM] = useState("");
  const [fuelBar, setFuelBar] = useState<FuelBar>(2);
  const [muatanQty, setMuatanQty] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleCapture(file: File, jenisFoto: JenisFotoKendaraan) {
    setError(null);
    setUploading(jenisFoto);
    try {
      const path = await onUploadPhoto(file, jenisFoto);
      setPhotos((prev) => ({ ...prev, [jenisFoto]: path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setUploading(null);
    }
  }

  const allPhotosReady = JENIS_FOTO_LIST.every((j) => photos[j] != null);
  const canSubmit = allPhotosReady && Number(odometerKM) > 0 && muatanQty !== "" && Number(muatanQty) >= 0 && !pending;

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await onSubmitCheck({
          tipe,
          odometerKM: Number(odometerKM),
          fuelBar,
          muatanQty: Number(muatanQty),
          photos: JENIS_FOTO_LIST.map((jenisFoto) => ({ jenisFoto, filePath: photos[jenisFoto] as string })),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan cek kendaraan.");
      }
    });
  }

  function renderSideContent(side: TruckSide) {
    const primary = TRUCK_SIDE_PRIMARY_PHOTO[side];
    const secondary = TRUCK_SIDE_SECONDARY_PHOTO[side];
    return (
      <div className="relative flex h-full w-full flex-col items-center gap-2 p-3">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-muted-foreground/20">
          <TruckSideIllustration side={side} />
        </div>
        <p className="relative text-xs font-medium">{TRUCK_SIDE_LABEL[side]}</p>
        <div className="relative flex w-full flex-col items-center gap-2">
          <CameraCaptureField
            label={JENIS_FOTO_LABEL[primary]}
            disabled={uploading != null || pending}
            onCapture={(file) => handleCapture(file, primary)}
          />
          {secondary && (
            <CameraCaptureField
              label={JENIS_FOTO_LABEL[secondary]}
              disabled={uploading != null || pending}
              onCapture={(file) => handleCapture(file, secondary)}
            />
          )}
          {side === "DEPAN" && (
            <div className="flex w-full flex-col gap-2">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Odometer (KM)"
                value={odometerKM}
                onChange={(e) => setOdometerKM(e.target.value)}
              />
              <FuelBarSelector value={fuelBar} onChange={setFuelBar} />
            </div>
          )}
          {side === "BELAKANG" && (
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="Jumlah Koli/Unit Muatan"
              value={muatanQty}
              onChange={(e) => setMuatanQty(e.target.value)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-xs font-medium">{TIPE_LABEL[tipe]}</p>
      <TruckCubeCarousel
        activeSide={activeSide}
        onActiveSideChange={setActiveSide}
        sides={{
          DEPAN: renderSideContent("DEPAN"),
          KANAN: renderSideContent("KANAN"),
          BELAKANG: renderSideContent("BELAKANG"),
          KIRI: renderSideContent("KIRI"),
        }}
      />
      <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
        {pending ? "Menyimpan..." : `Simpan ${TIPE_LABEL[tipe]}`}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[10px] text-muted-foreground">
        Foto wajib diambil langsung dari kamera. Catatan: sebagian browser tetap menampilkan pintasan galeri di
        antarmuka kameranya sendiri — ini batasan platform, bukan sesuatu yang bisa diblokir sepenuhnya dari sisi
        web.
      </p>
    </div>
  );
}

export function VehicleCheckDialog({
  jadwalId: _jadwalId,
  armadaId: _armadaId,
  isSatpam,
  onUploadPhoto,
  onSubmitCheck,
  checks,
}: {
  jadwalId: number;
  armadaId: number;
  isSatpam: boolean;
  onUploadPhoto: (file: File, jenisFoto: JenisFotoKendaraan) => Promise<string>;
  onSubmitCheck: (input: {
    tipe: VehicleCheckTipe;
    odometerKM: number;
    fuelBar: FuelBar;
    muatanQty: number;
    photos: VehicleCheckPhoto[];
  }) => Promise<void>;
  checks: VehicleCheckRow[];
}) {
  const [open, setOpen] = useState(false);
  const berangkat = checks.find((c) => c.tipe === "BERANGKAT");
  const datang = checks.find((c) => c.tipe === "DATANG");
  const statusText = `Cek Keamanan Kendaraan — Berangkat: ${berangkat ? "sudah" : "belum"}, Datang: ${
    berangkat ? (datang ? "sudah" : "belum") : "-"
  }`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" className="w-full justify-start text-left" />}>
        {statusText}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cek Keamanan Kendaraan</DialogTitle>
          <DialogDescription>Rekam kondisi kendaraan saat berangkat dan datang, khusus diisi oleh Satpam.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {berangkat ? (
            <CheckSummary check={berangkat} />
          ) : isSatpam ? (
            <CheckForm tipe="BERANGKAT" onUploadPhoto={onUploadPhoto} onSubmitCheck={onSubmitCheck} />
          ) : (
            <p className="text-xs text-muted-foreground">Belum ada Cek Berangkat.</p>
          )}

          {datang ? (
            <CheckSummary check={datang} />
          ) : berangkat ? (
            isSatpam ? (
              <CheckForm tipe="DATANG" onUploadPhoto={onUploadPhoto} onSubmitCheck={onSubmitCheck} />
            ) : (
              <p className="text-xs text-muted-foreground">Belum ada Cek Datang.</p>
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Note: `jadwalId`/`armadaId` are destructured as `_jadwalId`/`_armadaId` —
this component doesn't use them directly (`onUploadPhoto`/`onSubmitCheck`
already close over them in the parent, exactly as `VehicleCheckPanel` did
before), but the prop names must stay `jadwalId`/`armadaId` in the type so
Task 6's call site doesn't need to change its JSX props.

This task only uses `"use client"`, existing `Dialog`/`Button`/`Input`
components, and plain React state — none of it is Next-version-sensitive,
so no `node_modules/next/dist/docs` lookup is needed for this task
specifically (per this repo's `AGENTS.md`, that doc check matters when a
task touches Next.js APIs directly; this one doesn't). The Dialog in this
project is `@base-ui/react`, not Radix — there is no existing
`DialogTrigger` usage anywhere else in this codebase to copy, so this was
verified directly against
`node_modules/@base-ui/react/dialog/trigger/DialogTrigger.d.ts` and
`node_modules/@base-ui/react/internals/types.d.ts`: every Base UI component
(including `DialogTrigger`) accepts a `render` prop taking a `ReactElement`
to swap in as the rendered root element, with the component's own children
passed through into it — that's exactly the `render={<Button .../>}` +
children pattern used above (and already used once in this same file, by
`DialogContent`'s built-in close button). There is no `asChild` prop here —
that's a Radix API this library doesn't have.

- [ ] **Step 2: Delete the superseded component**

Delete `src/components/dashboard/vehicle-check-panel.tsx` — fully replaced
by this file. Confirm nothing else imports it:
`grep -rn "vehicle-check-panel" src/` should return nothing once Task 6
(next task) also updates its one remaining import site.

(This step only deletes the file; the import-site update happens in Task 6,
since it lives in a different file. It's fine for this task's build to
still show one dangling import error from `route-validation-dialog.tsx`
until Task 6 lands — the task loop's reviewer will see the file deleted and
`route-validation-dialog.tsx` not yet updated, and that's expected given the
task boundary here.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect exactly one remaining error, in
`src/components/dashboard/route-validation-dialog.tsx`, about the now-deleted
`vehicle-check-panel` import (fixed in Task 6).

Run: `npx eslint src/components/dashboard/vehicle-check-dialog.tsx` — expect 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/vehicle-check-dialog.tsx
git rm src/components/dashboard/vehicle-check-panel.tsx
git commit -m "Replace VehicleCheckPanel with VehicleCheckDialog (pop-up + cube carousel)"
```

---

## Task 6: Wire `VehicleCheckDialog` into Validasi Rute

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx:35-42` (imports),
  `:595-605` (`handleSubmitVehicleCheck`), `:1052-1061` (render site)

**Interfaces:**
- Consumes: `VehicleCheckDialog`, `FuelBar`, `createVehicleCheckAction` (updated
  signature from Task 2) — all from Tasks 1, 2, 5.

- [ ] **Step 1: Update imports**

Replace:

```ts
import { VehicleCheckPanel } from "@/components/dashboard/vehicle-check-panel";
import type {
  VehicleCheckRow,
  VehicleCheckTipe,
  FuelLevel,
  VehicleCheckPhoto,
  JenisFotoKendaraan,
} from "@/lib/vehicle-check-types";
```

with:

```ts
import { VehicleCheckDialog } from "@/components/dashboard/vehicle-check-dialog";
import type {
  VehicleCheckRow,
  VehicleCheckTipe,
  FuelBar,
  VehicleCheckPhoto,
  JenisFotoKendaraan,
} from "@/lib/vehicle-check-types";
```

- [ ] **Step 2: Update `handleSubmitVehicleCheck`**

Replace:

```ts
  async function handleSubmitVehicleCheck(input: {
    tipe: VehicleCheckTipe;
    odometerKM: number;
    fuelLevel: FuelLevel;
    photos: VehicleCheckPhoto[];
  }): Promise<void> {
    if (jadwalId == null) return;
    await createVehicleCheckAction({ jadwalId, ...input });
    const rows = await getVehicleChecksForJadwalAction(jadwalId);
    setVehicleChecks(rows);
  }
```

with:

```ts
  async function handleSubmitVehicleCheck(input: {
    tipe: VehicleCheckTipe;
    odometerKM: number;
    fuelBar: FuelBar;
    muatanQty: number;
    photos: VehicleCheckPhoto[];
  }): Promise<void> {
    if (jadwalId == null) return;
    await createVehicleCheckAction({ jadwalId, ...input });
    const rows = await getVehicleChecksForJadwalAction(jadwalId);
    setVehicleChecks(rows);
  }
```

- [ ] **Step 3: Swap the render site**

Replace:

```tsx
            {!isDraft && jadwalId != null && armadaId != null && (
              <VehicleCheckPanel
                jadwalId={jadwalId}
                armadaId={armadaId}
                isSatpam={isSatpam}
                onUploadPhoto={handleUploadVehiclePhoto}
                onSubmitCheck={handleSubmitVehicleCheck}
                checks={vehicleChecks}
              />
            )}
```

with:

```tsx
            {!isDraft && jadwalId != null && armadaId != null && (
              <VehicleCheckDialog
                jadwalId={jadwalId}
                armadaId={armadaId}
                isSatpam={isSatpam}
                onUploadPhoto={handleUploadVehiclePhoto}
                onSubmitCheck={handleSubmitVehicleCheck}
                checks={vehicleChecks}
              />
            )}
```

- [ ] **Step 4: Verify types, lint, build**

Run: `npx tsc --noEmit` — expect 0 errors project-wide.
Run: `npx eslint src` — expect 0 errors.
Run: `npm run build` — expect success. If it fails on a stale `.next/dev/types` artifact (a known, previously-seen Turbopack cache-staleness issue in this project), run `rm -rf .next` and rebuild before concluding there's a real error.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx
git commit -m "Wire VehicleCheckDialog into Validasi Rute"
```

---

## Task 7: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Re-run the full static check suite**

Run: `npx tsc --noEmit`, `npx eslint src`, `npm run build` — all three must
pass clean with zero errors (0 new warnings beyond whatever this project
already accepted before this plan started).

- [ ] **Step 2: Live DB smoke check of the updated `createVehicleCheck`**

Write a throwaway `npx tsx` script (wrapped in an async `main()`, delete
after running, per this project's established convention) that:
1. Finds a real `Terbit` `DashboardPengirimanJadwal` row with no existing
   `DashboardVehicleCheck` for either `Tipe` (or reuses one from this
   session's prior testing if one still qualifies).
2. Calls `createVehicleCheck` directly with a real `jadwalId`, `tipe:
   "BERANGKAT"`, a plausible `odometerKM`, `fuelBar: 3`, `muatanQty: 12`, and
   6 fake-but-well-formed `photos` entries (matching `JENIS_FOTO_LIST`, any
   placeholder `filePath` string — this only exercises the DB write path,
   not the actual upload route).
3. Calls `getVehicleChecksForJadwal` for that `jadwalId` and confirms the
   returned row's `fuelBar === 3` and `muatanQty === 12`.

This mirrors how Task 1 of the prior Satpam plan (this same session)
verified `createVehicleCheck`/`getVehicleChecksForJadwal` against live data
before any UI existed — reuse that same approach here for the two changed
columns.

Do NOT fabricate a live `DashboardVehicleCheck` row against a Jadwal that
doesn't already have test data from this session's own prior verification,
if that can be avoided — prefer reusing an existing already-fabricated test
Jadwal from this session over creating a new permanent record. If no such
reusable Jadwal exists, creating one more is consistent with this session's
already-established practice of live-verifying against real data.

- [ ] **Step 3: Live browser walkthrough**

1. Open Validasi Rute for a `Terbit` Jadwal (Draft ones won't show the
   button at all — confirm that too, briefly, on a Draft Jadwal).
2. Confirm the inline Card is gone, replaced by a single button reading
   "Cek Keamanan Kendaraan — Berangkat: ..., Datang: ...".
3. Click it — confirm a Dialog opens on top of Validasi Rute without
   closing it.
4. If `isSatpam` (or test as a Satpam session, matching how this session
   verified the original Satpam plan): confirm the cube carousel renders,
   drag it through all 4 sides, confirm `DEPAN` shows the Odometer input +
   Fuel Bar selector (click through 0-4 and the "E" button, confirm the
   bar-fill visual updates), confirm `BELAKANG` shows the "Jumlah
   Koli/Unit Muatan" input, confirm `KANAN`/`KIRI` show only their single
   photo button.
5. Resize the browser to a mobile viewport (e.g. 375px wide) and repeat the
   drag/click checks — confirm the dialog and cube both still fit and
   respond to touch-like pointer drags without fighting page scroll.
6. If not `isSatpam`: confirm the dialog still opens but shows the
   read-only "Belum ada Cek Berangkat." placeholder instead of a form.

- [ ] **Step 4: Confirm no leftover scratch files**

Run: `git status --short` — must be clean (no stray scratch scripts/pages
left from Task 4's Step 3 or this task's Step 2).
