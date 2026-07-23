# SO→DO Route Validation & Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct "Buat Keberangkatan Baru" so it creates `DeliveryOrder` documents from `SalesOrder` rows (draft, then published only after mandatory route validation), instead of grouping DOs that don't exist yet. Add manual drag-and-drop stop ordering, a route map (Pabrik → stops → Pabrik) with OSRM distance/time/fuel estimates, and a responsive (non-scrolling) timeline.

**Architecture:** `DashboardPengirimanJadwal.Status` gains `'Draft'`/`'Terbit'`. Draft Jadwal rows reference `SalesOrder` only (via a new `SalesOrderID` column on `DashboardPengirimanJadwalDetail`) — no real ERP writes happen. Publishing loops the ordered detail rows and INSERTs real `DeliveryOrder`/`DeliveryOrderDetail` rows mirroring the exact live-data-verified shape of existing SO-linked DOs, writes the new `DeliveryOrderID` back onto each detail row, and flips `Status`. A new `DashboardPabrikLocation` table becomes the single source of truth for the factory coordinate, replacing 3 existing hardcoded copies.

**Tech Stack:** Next.js 16 Server Components/Actions, raw parameterized `mssql`, OSRM (existing `src/lib/osrm.ts`), Leaflet/`react-leaflet` (existing pattern), `@dnd-kit/core` (existing) + `@dnd-kit/sortable` (new).

**Read first:** `docs/superpowers/specs/2026-07-23-so-to-do-route-validation-design.md` — this plan implements that spec exactly; every value/behavior decision below traces back to it.

## Global Constraints

- **One SO = one whole DO.** No partial-quantity splitting anywhere in this plan.
- **Status values are exactly** `'Draft'` and `'Terbit'` (VARCHAR(10)) — no other strings.
- **Draft → Terbit is one-way.** No "un-publish" action exists.
- **OSRM route computation is mandatory before publishing** — the "Terbitkan" button stays disabled until a route has been successfully computed for the current stop order (confirmed by the user, not a suggestion).
- **Driver is optional at draft creation, required before publish.**
- **Post-publish editing** (`updateJadwalDriverTime`) is limited to time + driver, cascading only `VehicleNo`/`SalesmanID` onto linked `DeliveryOrder` rows — SO composition never changes after publish. `Urutan` (stop order) stays freely editable in both states since it's dashboard-only bookkeeping with no `DeliveryOrder` field it touches.
- **Client-side WIB time handling** (unchanged from the existing board): times are constructed/read with plain `new Date(...)`/`.getHours()`/`.getMinutes()`, never `parseWibDateTimeLocal` — this is a client-only round trip, browser-local time is trusted to be WIB.
- **Exclusive-upper-bound date filtering** (`col >= @start AND col < @end`) for any new date-range query, matching the codebase-wide convention — and where the compared column is a `datetime` representing a WIB instant (like `JamJadwal`), the boundary must be WIB-shifted (`DATEADD(HOUR, -7, ...)`), matching the fix already applied to `getPengirimanBoard`.
- **No nested Dialog-inside-Dialog.** Only one of `CreateJadwalDialog` / `RouteValidationDialog` / `ArmadaManager`'s internal dialogs is ever open at a time from the board.
- **5KG-counts-as-half-a-kantong** convention (`Name LIKE '%5 KG%' THEN Qty/2.0 ELSE Qty`) applies to `SalesOrderDetail.Qty` the same way it already applies to `DeliveryOrderDetail`/`DeliveryOrderDetail.Qty` elsewhere in this codebase (mitra-do.ts, the existing `JADWAL_KANTONG_EXPR`).
- **Verified live-data facts this plan's code depends on** (checked 2026-07-23 against production data, do not re-derive):
  - `DeliveryOrder.VoucherNo` resets monthly, identical convention to `SalesOrder.VoucherNo` (`MKE/DO/000001/2026-07/003/001` at the start of July, `MKE/DO/002968/...` by month-end) — same `MAX(SUBSTRING(...))+1` pattern as `sales-order.ts`'s `nextVoucherSeq`.
  - Freshly-created `DeliveryOrder` rows (not yet processed further) have `IsClosed=0, IsInvoiced=0, StatusForm=1, Rate=1, CurrencyID='', OverLimit=0`, and `Notes/PIC/ReferenceNo/ProjectID/AddressDeliveryID/AddressDelivery/ExpeditionID` all `''` (empty string, not NULL). `ShippingNo`/`BusinessPartnerLocationID`/`IsDOReturn` are NULL. `BranchID='011'`, `DepartmentID='0110'` (same constants `sales-order.ts` already uses for SO).
  - `DeliveryOrderDetail` rows created alongside an SO-linked DO have `Delivered` set equal to `Qty` at creation (not `0`) — DOs in this ERP represent an executed delivery, not a pending one. `UnitRatio = Qty`, `Ratio = 1`, `Disc = 0`, `DiscValue = NULL`, `DiscRp = 0`, `Cashback = 0`, `Outstanding = Qty` (this column is already documented elsewhere in this codebase as unreliable/ignored by readers — matching the observed value is harmless, not load-bearing).
  - `DeliveryOrderID`/`DeliveryOrderDetailID` are `varchar` — this plan mints new ones via the same `MAX(TRY_CAST(...AS INT))+1`, 8-digit zero-padded pattern `sales-order.ts` already uses for `SalesOrderID`/`SalesOrderDetailID`.

---

### Task 0: Database migration (controller-run, not delegated)

Run directly against the database — do not dispatch to a subagent (matches this project's established pattern for schema changes).

- [ ] **Step 1: Confirm the prior plan's test data is gone**

```sql
SELECT COUNT(*) AS n FROM DashboardPengirimanJadwal WHERE IsDeleted = 0;
SELECT COUNT(*) AS n FROM DashboardArmada WHERE IsDeleted = 0;
```
Expected: both `0` (already confirmed and soft-deleted by the user 2026-07-23 — this step just re-verifies before altering the schema those tables belong to).

- [ ] **Step 2: Apply the DDL**

```sql
ALTER TABLE DashboardPengirimanJadwal ADD Status VARCHAR(10) NOT NULL DEFAULT 'Draft';
ALTER TABLE DashboardPengirimanJadwal ADD CreatedByUserID VARCHAR(16) NULL;

ALTER TABLE DashboardPengirimanJadwalDetail ADD SalesOrderID VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE DashboardPengirimanJadwalDetail ADD Urutan INT NOT NULL DEFAULT 0;
ALTER TABLE DashboardPengirimanJadwalDetail ALTER COLUMN DeliveryOrderID VARCHAR(16) NULL;

CREATE TABLE DashboardPabrikLocation (
  ID INT IDENTITY PRIMARY KEY,
  Latitude DECIMAL(10,7) NOT NULL,
  Longitude DECIMAL(10,7) NOT NULL,
  Alamat VARCHAR(512) NULL,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()
);
INSERT INTO DashboardPabrikLocation (Latitude, Longitude, Alamat)
VALUES (-7.8462825, 111.4759937, NULL);
```

- [ ] **Step 3: Verify**

```sql
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'DashboardPengirimanJadwal' AND COLUMN_NAME IN ('Status','CreatedByUserID');
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'DashboardPengirimanJadwalDetail' AND COLUMN_NAME IN ('SalesOrderID','Urutan','DeliveryOrderID');
SELECT * FROM DashboardPabrikLocation;
```
Expected: `Status` NOT NULL varchar, `CreatedByUserID` nullable varchar; `SalesOrderID` NOT NULL varchar, `Urutan` NOT NULL int, `DeliveryOrderID` now nullable; one `DashboardPabrikLocation` row with the seeded coordinate.

---

### Task 1: Multi-point OSRM routing

**Files:**
- Modify: `src/lib/osrm.ts` (append)
- Create: `src/app/api/routing/multi/route.ts`

**Interfaces:**
- Produces: `getMultiPointRoute(points: Coordinate[]): Promise<MultiPointRoute>` from `osrm.ts`; `POST /api/routing/multi` accepting `{points: Coordinate[]}`, returning `MultiPointRoute` JSON or `{error: string}`.

- [ ] **Step 1: Append to `src/lib/osrm.ts`**

```ts
export interface RouteLeg {
  distanceKm: number;
  durationMinutes: number;
}

export interface MultiPointRoute {
  distanceKm: number;
  durationMinutes: number;
  // Raw GeoJSON [lng, lat] pairs in route order, as OSRM returns them — the
  // caller (a Leaflet component) is responsible for flipping to [lat, lng]
  // when building a Polyline, this module stays UI-agnostic.
  geometry: [number, number][];
  // One entry per consecutive waypoint pair (points[0]->points[1],
  // points[1]->points[2], ...) — length is always points.length - 1.
  legs: RouteLeg[];
}

/**
 * Hitung rute lengkap melalui banyak titik berurutan (mis. Pabrik -> stop1 ->
 * stop2 -> ... -> Pabrik), termasuk geometri untuk digambar di peta dan
 * rincian jarak/durasi per-segmen (leg).
 */
export async function getMultiPointRoute(points: Coordinate[]): Promise<MultiPointRoute> {
  if (points.length < 2) {
    throw new Error("getMultiPointRoute needs at least 2 points");
  }
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`OSRM request failed: ${res.status}`);
  }
  const data = await res.json();
  if (data.code !== "Ok") {
    throw new Error(`OSRM error: ${data.code} - ${data.message ?? "unknown"}`);
  }

  const route = data.routes[0];
  const legs = route.legs.map((leg: { distance: number; duration: number }) => ({
    distanceKm: Math.round((leg.distance / 1000) * 10) / 10,
    durationMinutes: Math.round(leg.duration / 60),
  }));

  return {
    distanceKm: Math.round((route.distance / 1000) * 10) / 10,
    durationMinutes: Math.round(route.duration / 60),
    geometry: route.geometry.coordinates,
    legs,
  };
}
```

- [ ] **Step 2: Create `src/app/api/routing/multi/route.ts`**

```ts
// app/api/routing/multi/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getMultiPointRoute, type Coordinate } from "@/lib/osrm";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const points = body?.points as Coordinate[] | undefined;

  if (!Array.isArray(points) || points.length < 2) {
    return NextResponse.json({ error: "Minimal 2 titik diperlukan" }, { status: 400 });
  }
  if (points.some((p) => typeof p.lat !== "number" || typeof p.lng !== "number")) {
    return NextResponse.json({ error: "Setiap titik harus punya lat & lng numerik" }, { status: 400 });
  }

  try {
    const result = await getMultiPointRoute(points);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Multi-point routing error:", err);
    return NextResponse.json({ error: "Gagal menghitung rute" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/osrm.ts src/app/api/routing/multi/route.ts
git commit -m "Add multi-point OSRM routing for delivery-run stop sequences"
```

---

### Task 2: Pabrik location — data layer

**Files:**
- Create: `src/lib/queries/pabrik-location.ts`
- Create: `src/app/api/pabrik-location/route.ts`
- Modify: `src/app/api/routing/route.ts`

**Interfaces:**
- Produces: `PabrikLocation`, `getPabrikLocation()`, `setPabrikLocation(input)` from `pabrik-location.ts`; `GET /api/pabrik-location` returning `PabrikLocation` JSON — consumed by Task 3's client components.

- [ ] **Step 1: Create `src/lib/queries/pabrik-location.ts`**

```ts
import { getPool, sql } from "@/lib/db";

export interface PabrikLocation {
  latitude: number;
  longitude: number;
  alamat: string | null;
}

// Same coordinate the DDL seeds DashboardPabrikLocation with — only used as
// a last-resort fallback if that single row is ever somehow missing (should
// never happen; Task 0's migration always inserts exactly one row).
const PABRIK_FALLBACK: PabrikLocation = {
  latitude: -7.8462825,
  longitude: 111.4759937,
  alamat: null,
};

export async function getPabrikLocation(): Promise<PabrikLocation> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 Latitude, Longitude, Alamat FROM DashboardPabrikLocation ORDER BY ID
  `);
  const row = result.recordset[0] as { Latitude: number; Longitude: number; Alamat: string | null } | undefined;
  if (!row) return PABRIK_FALLBACK;
  return { latitude: row.Latitude, longitude: row.Longitude, alamat: row.Alamat };
}

export async function setPabrikLocation(input: {
  latitude: number;
  longitude: number;
  alamat: string | null;
}): Promise<void> {
  const pool = await getPool();
  const existing = await pool.request().query(`SELECT TOP 1 ID FROM DashboardPabrikLocation ORDER BY ID`);
  const id = (existing.recordset[0] as { ID: number } | undefined)?.ID;

  const request = pool
    .request()
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude)
    .input("alamat", sql.VarChar(512), input.alamat);

  if (id != null) {
    await request
      .input("id", sql.Int, id)
      .query(`UPDATE DashboardPabrikLocation SET Latitude = @lat, Longitude = @lng, Alamat = @alamat, ModifiedDate = GETDATE() WHERE ID = @id`);
  } else {
    // Defensive only — Task 0's migration always seeds one row, so this
    // branch shouldn't run in practice.
    await request.query(`INSERT INTO DashboardPabrikLocation (Latitude, Longitude, Alamat) VALUES (@lat, @lng, @alamat)`);
  }
}
```

- [ ] **Step 2: Create `src/app/api/pabrik-location/route.ts`**

```ts
// app/api/pabrik-location/route.ts
import { NextResponse } from "next/server";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";

// GET-only, no auth guard — this is a single non-sensitive coordinate, and
// it's read from plain client components (map pickers) the same way
// /api/geocode already is.
export async function GET() {
  const location = await getPabrikLocation();
  return NextResponse.json(location);
}
```

- [ ] **Step 3: Retrofit `src/app/api/routing/route.ts`**

Replace the hardcoded `PABRIK_ORIGIN` with a live lookup:

```ts
// app/api/routing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRoute } from "@/lib/osrm";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const destLat = searchParams.get("lat");
  const destLng = searchParams.get("lng");

  if (!destLat || !destLng) {
    return NextResponse.json(
      { error: "Parameter lat & lng wajib diisi" },
      { status: 400 }
    );
  }

  try {
    const pabrik = await getPabrikLocation();
    const result = await getRoute(
      { lat: pabrik.latitude, lng: pabrik.longitude },
      { lat: parseFloat(destLat), lng: parseFloat(destLng) }
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("Routing error:", err);
    return NextResponse.json(
      { error: "Gagal menghitung rute" },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/pabrik-location.ts src/app/api/pabrik-location/route.ts src/app/api/routing/route.ts
git commit -m "Add Pabrik location query layer, retrofit /api/routing off the hardcoded constant"
```

---

### Task 3: Pabrik location settings UI + retrofit map components

**Files:**
- Create: `src/components/dashboard/pabrik-location-settings.tsx`
- Modify: `src/app/(dashboard)/akun/actions.ts` (append)
- Modify: `src/app/(dashboard)/akun/page.tsx`
- Modify: `src/components/dashboard/mitra-location-field.tsx`
- Modify: `src/components/dashboard/mitra-location-map.tsx`

**Interfaces:**
- Consumes: `PabrikLocation`, `getPabrikLocation`, `setPabrikLocation` from Task 2's `pabrik-location.ts`; `GET /api/pabrik-location` from Task 2.
- Produces: `PabrikLocationSettings` component (default export style not used elsewhere in this codebase — named export, matching convention).

- [ ] **Step 1: Retrofit `src/components/dashboard/mitra-location-map.tsx`**

Add a `pabrikPosition` prop instead of the internal hardcoded constant:

Replace:
```ts
// Same coordinates as PABRIK_ORIGIN in app/api/routing/route.ts.
const PABRIK_POSITION: [number, number] = [-7.8462825, 111.4759937];
```
with nothing (delete this constant).

Replace:
```ts
export interface MitraLocationMapProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
  recenterKey: number;
}

export function MitraLocationMap({ latitude, longitude, onChange, recenterKey }: MitraLocationMapProps) {
```
with:
```ts
export interface MitraLocationMapProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
  recenterKey: number;
  // [lat, lng] — sourced from DashboardPabrikLocation via the caller
  // (MitraLocationField), not hardcoded here anymore.
  pabrikPosition: [number, number];
}

export function MitraLocationMap({ latitude, longitude, onChange, recenterKey, pabrikPosition }: MitraLocationMapProps) {
```

And replace the marker line:
```tsx
<Marker position={PABRIK_POSITION} icon={pabrikIcon} />
```
with:
```tsx
<Marker position={pabrikPosition} icon={pabrikIcon} />
```

- [ ] **Step 2: Retrofit `src/components/dashboard/mitra-location-field.tsx`**

Replace:
```ts
// Same coordinates as PABRIK_ORIGIN in app/api/routing/route.ts — a sensible
// starting pin for a mitra that doesn't have a saved location yet, since
// mitra are all within driving distance of the pabrik anyway.
const PABRIK_DEFAULT: MitraLocationValue = {
  latitude: -7.8462825,
  longitude: 111.4759937,
  alamat: null,
};
```
with:
```ts
// Last-resort fallback while /api/pabrik-location hasn't resolved yet (or
// if it errors) — same coordinate DashboardPabrikLocation is seeded with.
// A sensible starting pin for a mitra with no saved location either way,
// since mitra are all within driving distance of the pabrik.
const PABRIK_FALLBACK: MitraLocationValue = {
  latitude: -7.8462825,
  longitude: 111.4759937,
  alamat: null,
};
```

Add state + a fetch effect inside `MitraLocationField`, right after the existing `debounceRef` declaration:

```ts
  const [pabrik, setPabrik] = useState<MitraLocationValue>(PABRIK_FALLBACK);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pabrik-location")
      .then((res) => res.json())
      .then((data: { latitude: number; longitude: number; alamat: string | null }) => {
        if (!cancelled) setPabrik(data);
      })
      .catch(() => {
        // Keep PABRIK_FALLBACK — this only affects the map's decorative
        // Pabrik marker and a mitra-with-no-location's starting pin,
        // neither is worth surfacing an error for.
      });
    return () => {
      cancelled = true;
    };
  }, []);
```

Replace every use of `PABRIK_DEFAULT` in the component body with `pabrik` (there is exactly one: `const current = value ?? PABRIK_DEFAULT;` becomes `const current = value ?? pabrik;`).

Pass the new prop to `MitraLocationMap`:
```tsx
        <MitraLocationMap
          latitude={current.latitude}
          longitude={current.longitude}
          onChange={handleMove}
          recenterKey={recenterKey}
          pabrikPosition={[pabrik.latitude, pabrik.longitude]}
        />
```

- [ ] **Step 3: Create `src/components/dashboard/pabrik-location-settings.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import { setPabrikLocationAction } from "@/app/(dashboard)/akun/actions";

// Reuses MitraLocationField's generic lat/lng/alamat editing UI (search,
// "use my location", reverse geocode, draggable pin) for the single global
// Pabrik point instead of a per-mitra one — the field's API is already
// value/onChange, nothing mitra-specific about it beyond its name.
export function PabrikLocationSettings({ initial }: { initial: MitraLocationValue }) {
  const [value, setValue] = useState<MitraLocationValue>(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(false);
    startTransition(async () => {
      await setPabrikLocationAction({
        latitude: value.latitude,
        longitude: value.longitude,
        alamat: value.alamat,
      });
      setSaved(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Lokasi Pabrik</CardTitle>
        <CardDescription>
          Titik awal &amp; akhir rute pengiriman. Dipakai di seluruh aplikasi (validasi rute, estimasi jarak mitra).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <MitraLocationField value={value} onChange={setValue} />
        <Button size="sm" className="self-end" disabled={pending} onClick={handleSave}>
          <Save className="size-3.5" />
          {pending ? "Menyimpan..." : "Simpan Lokasi Pabrik"}
        </Button>
        {saved && !pending && <p className="text-right text-xs text-primary">Tersimpan.</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Append to `src/app/(dashboard)/akun/actions.ts`**

Read the existing file first to match its import/export style, then append:

```ts
import { getPabrikLocation, setPabrikLocation } from "@/lib/queries/pabrik-location";

export async function getPabrikLocationAction() {
  return getPabrikLocation();
}

export async function setPabrikLocationAction(input: { latitude: number; longitude: number; alamat: string | null }): Promise<void> {
  await setPabrikLocation(input);
  revalidatePath("/akun");
}
```
(If `revalidatePath` isn't already imported in this file, add `import { revalidatePath } from "next/cache";` alongside the other imports.)

- [ ] **Step 5: Wire into `src/app/(dashboard)/akun/page.tsx`**

```tsx
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/lib/require-access";
import { listUsers, listRoles } from "@/lib/queries/akun";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { AkunList } from "@/components/dashboard/akun-list";
import { PabrikLocationSettings } from "@/components/dashboard/pabrik-location-settings";
import { Button } from "@/components/ui/button";

export default async function AkunPage() {
  await requireSuperAdmin();
  const [users, roles, pabrikLocation] = await Promise.all([listUsers(), listRoles(), getPabrikLocation()]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Akun</h1>
        <Button variant="outline" render={<Link href="/akun/peran" />}>
          <ShieldCheck className="size-4" />
          Peran &amp; Otoritas
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Hanya Super Administrator yang dapat melihat dan mengatur seluruh akun serta otoritasnya.
      </p>
      <AkunList users={users} roles={roles} />
      <PabrikLocationSettings initial={pabrikLocation} />
    </div>
  );
}
```

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/pabrik-location-settings.tsx src/components/dashboard/mitra-location-field.tsx src/components/dashboard/mitra-location-map.tsx "src/app/(dashboard)/akun/actions.ts" "src/app/(dashboard)/akun/page.tsx"
git commit -m "Add editable Pabrik location settings, retire hardcoded coordinate copies"
```

---

### Task 4: `pengiriman-jadwal.ts` — full rewrite for SO-based drafts and publishing

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts` (full rewrite)

**Interfaces:**
- Consumes: `ArmadaRow`, `getArmadaList` from `armada.ts`; `assignDeliveryDriver`, `assignDeliveryVehicle` from `delivery.ts`.
- Produces: `JadwalCard` (now includes `Status`, `TotalStop` replacing `TotalDO`), `getPengirimanBoard`, `JadwalDetailRow` (now includes `JadwalDetailID`, `SalesOrderID`, `DeliveryOrderID`, `Urutan`, `Latitude`, `Longitude`), `getJadwalDetail`, `AvailableSalesOrder`, `getAvailableSalesOrders`, `createJadwalDraft`, `deleteJadwalDraft`, `updateJadwalUrutan`, `updateJadwalDriverTime`, `publishJadwal`, `startMuat`, `startBerangkat` — consumed by Task 5.

- [ ] **Step 1: Replace `src/lib/queries/pengiriman-jadwal.ts` in full**

```ts
import { getPool, sql } from "@/lib/db";
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";
import { getArmadaList, type ArmadaRow } from "@/lib/queries/armada";

// Same 5KG-counts-as-half-a-kantong normalization already established in
// mitra-do.ts's KANTONG_QTY_EXPR, applied to SalesOrderDetail.Qty since that
// (not DeliveryOrderDetail) is the uniform source of line-item data for
// both Draft and Terbit Jadwal rows — a Draft has no DeliveryOrderDetail
// yet.
const JADWAL_KANTONG_EXPR = `SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN sod.Qty / 2.0 ELSE sod.Qty END)`;

export type JadwalStatus = "Draft" | "Terbit";

export interface JadwalCard {
  JadwalID: number;
  ArmadaID: number;
  SalesmanID: string | null;
  DriverName: string | null;
  JamJadwal: string | Date;
  JamMulaiMuat: string | Date | null;
  JamAktualBerangkat: string | Date | null;
  Status: JadwalStatus;
  TotalKantong: number;
  // Renamed from TotalDO — during Draft this counts SO lines, not DO
  // documents (there are none yet). Same count either way since one SO
  // becomes exactly one DO, just a more accurate name.
  TotalStop: number;
}

export async function getPengirimanBoard(businessDate: string): Promise<{ armada: ArmadaRow[]; jadwal: JadwalCard[] }> {
  const pool = await getPool();
  const [armada, jadwalResult] = await Promise.all([
    getArmadaList(),
    pool
      .request()
      .input("businessDate", sql.Date, businessDate).query(`
        SELECT
            j.JadwalID,
            j.ArmadaID,
            j.SalesmanID,
            sm.Name AS DriverName,
            j.JamJadwal,
            j.JamMulaiMuat,
            j.JamAktualBerangkat,
            j.Status,
            ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS TotalKantong,
            COUNT(DISTINCT jd.JadwalDetailID) AS TotalStop
        FROM DashboardPengirimanJadwal j
        LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
        LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
        LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
        WHERE j.IsDeleted = 0
          AND j.JamJadwal >= DATEADD(HOUR, -7, CAST(@businessDate AS DATETIME)) AND j.JamJadwal < DATEADD(HOUR, -7, DATEADD(DAY, 1, CAST(@businessDate AS DATETIME)))
        GROUP BY j.JadwalID, j.ArmadaID, j.SalesmanID, sm.Name, j.JamJadwal, j.JamMulaiMuat, j.JamAktualBerangkat, j.Status
        ORDER BY j.JamJadwal
      `),
  ]);
  return { armada, jadwal: jadwalResult.recordset };
}

export interface JadwalDetailRow {
  JadwalDetailID: number;
  SalesOrderID: string;
  DeliveryOrderID: string | null;
  Urutan: number;
  CustomerName: string;
  Qty: number;
  Wilayah: string;
  Kecamatan: string | null;
  Alamat: string | null;
  MobileNo: string | null;
  Latitude: number | null;
  Longitude: number | null;
}

// Always sources customer/qty/address from SalesOrder/SalesOrderDetail via
// jd.SalesOrderID, uniformly for Draft and Terbit — DeliveryOrderID is
// bookkeeping only (set once real DO rows exist after publish), never a
// read dependency. Ordered by Urutan so this doubles as "the current stop
// order" for the route-validation UI.
export async function getJadwalDetail(jadwalId: number): Promise<JadwalDetailRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT
          jd.JadwalDetailID,
          jd.SalesOrderID,
          jd.DeliveryOrderID,
          jd.Urutan,
          bp.Name AS CustomerName,
          ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          bp.NPWPAddress AS Kecamatan,
          bp.Address AS Alamat,
          bp.MobileNo,
          ml.Latitude,
          ml.Longitude
      FROM DashboardPengirimanJadwalDetail jd
      JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
      JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = so.BusinessPartnerID
      WHERE jd.JadwalID = @jadwalId AND jd.IsDeleted = 0
      GROUP BY jd.JadwalDetailID, jd.SalesOrderID, jd.DeliveryOrderID, jd.Urutan,
               bp.Name, bp.NPWPName, bp.NPWPAddress, bp.Address, bp.MobileNo, ml.Latitude, ml.Longitude
      ORDER BY jd.Urutan
    `);
  return result.recordset;
}

export interface AvailableSalesOrder {
  SalesOrderID: string;
  VoucherNo: string;
  CustomerName: string;
  Wilayah: string;
  Qty: number;
  DueDate: string | Date | null;
}

// SO is "available" for a departure on businessDate when: DueDate falls on
// that day, it's open (not closed/deleted), no DeliveryOrder has been
// created from it yet, and it isn't already sitting in another active
// (non-deleted) Jadwal's detail rows — draft or published.
export async function getAvailableSalesOrders(businessDate: string): Promise<AvailableSalesOrder[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate).query(`
      SELECT
          so.SalesOrderID,
          so.VoucherNo,
          bp.Name AS CustomerName,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty,
          so.DueDate
      FROM SalesOrder so
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
      WHERE so.IsDeleted = 0
        AND so.IsClosed = 0
        AND so.DueDate >= @businessDate AND so.DueDate < DATEADD(DAY, 1, @businessDate)
        AND NOT EXISTS (
          SELECT 1 FROM DeliveryOrder do_ WHERE do_.SalesOrderID = so.SalesOrderID AND do_.IsDeleted = 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM DashboardPengirimanJadwalDetail jd
          JOIN DashboardPengirimanJadwal j ON j.JadwalID = jd.JadwalID
          WHERE jd.SalesOrderID = so.SalesOrderID AND jd.IsDeleted = 0 AND j.IsDeleted = 0
        )
      GROUP BY so.SalesOrderID, so.VoucherNo, bp.Name, bp.NPWPName, so.DueDate
      ORDER BY bp.Name
    `);
  return result.recordset;
}

export async function createJadwalDraft(input: {
  armadaId: number;
  jamJadwal: Date;
  salesOrderIds: string[];
}): Promise<number> {
  const pool = await getPool();

  const result = await pool
    .request()
    .input("armadaId", sql.Int, input.armadaId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal).query(`
      INSERT INTO DashboardPengirimanJadwal (ArmadaID, SalesmanID, JamJadwal, Status, IsDeleted, ModifiedDate)
      OUTPUT inserted.JadwalID
      VALUES (@armadaId, NULL, @jamJadwal, 'Draft', 0, GETDATE())
    `);
  const jadwalId = (result.recordset[0] as { JadwalID: number }).JadwalID;

  try {
    for (let i = 0; i < input.salesOrderIds.length; i++) {
      await pool
        .request()
        .input("jadwalId", sql.Int, jadwalId)
        .input("soId", sql.VarChar(16), input.salesOrderIds[i])
        .input("urutan", sql.Int, i)
        .query(`
          INSERT INTO DashboardPengirimanJadwalDetail (JadwalID, SalesOrderID, DeliveryOrderID, Urutan, IsDeleted)
          VALUES (@jadwalId, @soId, NULL, @urutan, 0)
        `);
    }
  } catch (err) {
    // Same compensating-cleanup discipline as the rest of this file's
    // multi-step writes: don't leave a half-created draft visible.
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`UPDATE DashboardPengirimanJadwalDetail SET IsDeleted = 1 WHERE JadwalID = @jadwalId`);
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`UPDATE DashboardPengirimanJadwal SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
    throw err;
  }

  return jadwalId;
}

export async function deleteJadwalDraft(jadwalId: number): Promise<void> {
  const pool = await getPool();
  const statusResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const status = (statusResult.recordset[0] as { Status: JadwalStatus } | undefined)?.Status;
  if (status !== "Draft") {
    throw new Error("Hanya keberangkatan berstatus Draft yang bisa dibatalkan.");
  }

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwalDetail SET IsDeleted = 1 WHERE JadwalID = @jadwalId`);
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}

// Persists a manual drag-and-drop stop reorder — dashboard-only bookkeeping,
// touches no DeliveryOrder field, so it's safe to call regardless of
// Draft/Terbit status.
export async function updateJadwalUrutan(jadwalId: number, orderedDetailIds: number[]): Promise<void> {
  const pool = await getPool();
  for (let i = 0; i < orderedDetailIds.length; i++) {
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .input("detailId", sql.Int, orderedDetailIds[i])
      .input("urutan", sql.Int, i)
      .query(`UPDATE DashboardPengirimanJadwalDetail SET Urutan = @urutan WHERE JadwalID = @jadwalId AND JadwalDetailID = @detailId`);
  }
}

export async function updateJadwalDriverTime(
  jadwalId: number,
  input: { jamJadwal: Date; salesmanId: string | null }
): Promise<void> {
  const pool = await getPool();
  const current = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status, ArmadaID FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = current.recordset[0] as { Status: JadwalStatus; ArmadaID: number } | undefined;
  if (!row) throw new Error("Keberangkatan tidak ditemukan.");

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal)
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamJadwal = @jamJadwal, SalesmanID = @salesmanId, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);

  if (row.Status === "Terbit") {
    const armadaResult = await pool
      .request()
      .input("armadaId", sql.Int, row.ArmadaID)
      .query(`SELECT Nama FROM DashboardArmada WHERE ArmadaID = @armadaId`);
    const armadaNama = (armadaResult.recordset[0] as { Nama: string } | undefined)?.Nama ?? null;

    const linkedDOs = await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`
        SELECT DeliveryOrderID FROM DashboardPengirimanJadwalDetail
        WHERE JadwalID = @jadwalId AND IsDeleted = 0 AND DeliveryOrderID IS NOT NULL
      `);
    for (const r of linkedDOs.recordset as { DeliveryOrderID: string }[]) {
      await assignDeliveryDriver(r.DeliveryOrderID, input.salesmanId);
      await assignDeliveryVehicle(r.DeliveryOrderID, armadaNama);
    }
  }
}

export async function startMuat(jadwalId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamMulaiMuat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}

export async function startBerangkat(jadwalId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamAktualBerangkat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}

const DOC_SUFFIX = "003/001";
const BRANCH_ID = "011";
const DEPARTMENT_ID = "0110";

async function nextDeliveryOrderId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderID AS INT)) AS MaxID FROM DeliveryOrder`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDeliveryOrderDetailId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderDetailID AS INT)) AS MaxID FROM DeliveryOrderDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDOVoucherSeq(pool: sql.ConnectionPool, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/DO/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq
      FROM DeliveryOrder
      WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

interface SalesOrderForPublish {
  BusinessPartnerID: string;
  DueDate: Date | null;
}
interface SalesOrderDetailForPublish {
  SalesOrderDetailID: string;
  ItemID: string;
  Name: string;
  Qty: number;
  Unit: string;
  Price: number;
  Amount: number;
}

// Draft -> Terbit. For each detail row (in Urutan order), creates one real
// DeliveryOrder + its DeliveryOrderDetail line(s) from the linked
// SalesOrder/SalesOrderDetail, shaped to match live-verified existing
// SO-linked DO rows exactly (see this plan's Global Constraints). Writes
// the new DeliveryOrderID back onto the detail row, then flips
// Jadwal.Status. On partial failure, soft-deletes only the DeliveryOrder/
// DeliveryOrderDetail rows this call itself created (not the Jadwal/SO
// selection) and rethrows — matching createJadwalDraft's own compensating-
// cleanup precedent, scoped to what this function owns.
export async function publishJadwal(jadwalId: number): Promise<void> {
  const pool = await getPool();

  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT ArmadaID, SalesmanID, Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; SalesmanID: string | null; Status: JadwalStatus } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new Error("Keberangkatan ini sudah diterbitkan.");
  if (!headerRow.SalesmanID) throw new Error("Driver wajib diisi sebelum menerbitkan.");

  const armadaResult = await pool
    .request()
    .input("armadaId", sql.Int, headerRow.ArmadaID)
    .query(`SELECT Nama FROM DashboardArmada WHERE ArmadaID = @armadaId`);
  const armadaNama = (armadaResult.recordset[0] as { Nama: string } | undefined)?.Nama ?? null;

  const details = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`
      SELECT JadwalDetailID, SalesOrderID FROM DashboardPengirimanJadwalDetail
      WHERE JadwalID = @jadwalId AND IsDeleted = 0
      ORDER BY Urutan
    `);
  const detailRows = details.recordset as { JadwalDetailID: number; SalesOrderID: string }[];
  if (detailRows.length === 0) throw new Error("Tidak ada SO pada keberangkatan ini.");

  const createdDeliveryOrderIds: string[] = [];
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    for (const detail of detailRows) {
      const soResult = await pool
        .request()
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .query(`SELECT BusinessPartnerID, DueDate FROM SalesOrder WHERE SalesOrderID = @soId`);
      const so = soResult.recordset[0] as SalesOrderForPublish | undefined;
      if (!so) throw new Error(`Sales Order ${detail.SalesOrderID} tidak ditemukan.`);

      const sodResult = await pool
        .request()
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .query(`SELECT SalesOrderDetailID, ItemID, Name, Qty, Unit, Price, Amount FROM SalesOrderDetail WHERE SalesOrderID = @soId`);
      const soDetails = sodResult.recordset as SalesOrderDetailForPublish[];

      const deliveryOrderId = await nextDeliveryOrderId(pool);
      const voucherSeq = await nextDOVoucherSeq(pool, yearMonth);
      const voucherNo = `MKE/DO/${voucherSeq}/${yearMonth}/${DOC_SUFFIX}`;

      await pool
        .request()
        .input("id", sql.VarChar(16), deliveryOrderId)
        .input("voucherNo", sql.VarChar(128), voucherNo)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .input("vehicleNo", sql.VarChar(50), armadaNama)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID)
        .input("dueDate", sql.DateTime, so.DueDate).query(`
          INSERT INTO DeliveryOrder
            (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
             IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
             BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
             ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
          VALUES
            (@id, @voucherNo, GETDATE(), @branchId, @departmentId, @bpId, '', @soId,
             0, '', @vehicleNo, '', 0, GETDATE(), '', NULL,
             NULL, 0, '', 1, 1, @salesmanId, 0,
             '', @dueDate, '', '', NULL)
        `);
      createdDeliveryOrderIds.push(deliveryOrderId);

      for (const sod of soDetails) {
        const detailId = await nextDeliveryOrderDetailId(pool);
        await pool
          .request()
          .input("id", sql.VarChar(16), detailId)
          .input("doId", sql.VarChar(16), deliveryOrderId)
          .input("itemId", sql.VarChar(160), sod.ItemID)
          .input("name", sql.VarChar(160), sod.Name)
          .input("qty", sql.Decimal(23, 4), sod.Qty)
          .input("unit", sql.VarChar(8), sod.Unit)
          .input("price", sql.Decimal(23, 4), sod.Price)
          .input("amount", sql.Decimal(23, 4), sod.Amount)
          .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID).query(`
            INSERT INTO DeliveryOrderDetail
              (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue,
               DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
            VALUES
              (@id, @doId, @itemId, @qty, @unit, @qty, 1, @price, 0, NULL,
               0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
          `);
      }

      await pool
        .request()
        .input("detailId", sql.Int, detail.JadwalDetailID)
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .query(`UPDATE DashboardPengirimanJadwalDetail SET DeliveryOrderID = @doId WHERE JadwalDetailID = @detailId`);
    }
  } catch (err) {
    for (const doId of createdDeliveryOrderIds) {
      await pool
        .request()
        .input("doId", sql.VarChar(16), doId)
        .query(`UPDATE DeliveryOrder SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);
      await pool
        .request()
        .input("doId", sql.VarChar(16), doId)
        .query(`UPDATE DashboardPengirimanJadwalDetail SET DeliveryOrderID = NULL WHERE DeliveryOrderID = @doId`);
    }
    throw err;
  }

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET Status = 'Terbit', ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors. (Type errors here are expected in `delivery/actions.ts` until Task 5 updates it — that's fine, this task only needs `pengiriman-jadwal.ts` itself to type-check standalone; confirm by checking the tsc output specifically references files other than this one.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "Rewrite pengiriman-jadwal.ts for SO-based Draft/Terbit lifecycle"
```

---

### Task 5: Server actions for the new Jadwal lifecycle

**Files:**
- Modify: `src/app/(dashboard)/delivery/actions.ts` (full rewrite of the Jadwal-related section)

**Interfaces:**
- Consumes: everything Task 4 exports from `pengiriman-jadwal.ts`.
- Produces: `createJadwalDraftAction`, `deleteJadwalDraftAction`, `updateJadwalUrutanAction`, `updateJadwalDriverTimeAction`, `publishJadwalAction`, `getAvailableSalesOrdersAction`, `getJadwalDetailAction`, `startMuatAction`, `startBerangkatAction` — consumed by Tasks 6-7.

- [ ] **Step 1: Replace `src/app/(dashboard)/delivery/actions.ts` in full**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createArmada, updateArmada, deleteArmada, type ArmadaInput } from "@/lib/queries/armada";
import {
  createJadwalDraft,
  deleteJadwalDraft,
  updateJadwalUrutan,
  updateJadwalDriverTime,
  publishJadwal,
  startMuat,
  startBerangkat,
  getJadwalDetail,
  getAvailableSalesOrders,
  type JadwalDetailRow,
  type AvailableSalesOrder,
} from "@/lib/queries/pengiriman-jadwal";

export async function createArmadaAction(input: ArmadaInput): Promise<number> {
  const id = await createArmada(input);
  revalidatePath("/delivery");
  return id;
}

export async function updateArmadaAction(id: number, input: ArmadaInput): Promise<void> {
  await updateArmada(id, input);
  revalidatePath("/delivery");
}

export async function deleteArmadaAction(id: number): Promise<void> {
  await deleteArmada(id);
  revalidatePath("/delivery");
}

export async function createJadwalDraftAction(input: {
  armadaId: number;
  jamJadwal: Date;
  salesOrderIds: string[];
}): Promise<number> {
  const id = await createJadwalDraft(input);
  revalidatePath("/delivery");
  return id;
}

export async function deleteJadwalDraftAction(jadwalId: number): Promise<void> {
  await deleteJadwalDraft(jadwalId);
  revalidatePath("/delivery");
}

export async function updateJadwalUrutanAction(jadwalId: number, orderedDetailIds: number[]): Promise<void> {
  await updateJadwalUrutan(jadwalId, orderedDetailIds);
  revalidatePath("/delivery");
}

export async function updateJadwalDriverTimeAction(
  jadwalId: number,
  input: { jamJadwal: Date; salesmanId: string | null }
): Promise<void> {
  await updateJadwalDriverTime(jadwalId, input);
  revalidatePath("/delivery");
}

export async function publishJadwalAction(jadwalId: number): Promise<void> {
  await publishJadwal(jadwalId);
  revalidatePath("/delivery");
}

export async function startMuatAction(jadwalId: number): Promise<void> {
  await startMuat(jadwalId);
  revalidatePath("/delivery");
}

export async function startBerangkatAction(jadwalId: number): Promise<void> {
  await startBerangkat(jadwalId);
  revalidatePath("/delivery");
}

// Read-only — no revalidatePath needed, these just fetch data on demand
// when a dialog opens.
export async function getJadwalDetailAction(jadwalId: number): Promise<JadwalDetailRow[]> {
  return getJadwalDetail(jadwalId);
}

export async function getAvailableSalesOrdersAction(businessDate: string): Promise<AvailableSalesOrder[]> {
  return getAvailableSalesOrders(businessDate);
}
```

Note what's deliberately removed and why:
- `createJadwalAction`, `updateJadwalTimeAction`, `getUnassignedDeliveryOrdersAction` — superseded by the Draft/Terbit equivalents above.
- `assignDeliveryDriverAction`, `assignDeliveryVehicleAction` — confirmed via grep (2026-07-23) to have zero remaining callers anywhere in `src/` since the old delivery-assignment flow was deleted; `publishJadwal`/`updateJadwalDriverTime` call the underlying `assignDeliveryDriver`/`assignDeliveryVehicle` query functions directly, not through these action wrappers.

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: errors only in `pengiriman-board.tsx` (still importing the old, now-removed action names — expected, fixed in Task 7). No errors in any other file.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/delivery/actions.ts"
git commit -m "Rewrite delivery server actions for SO-based Draft/Terbit lifecycle"
```

---

### Task 6: Route validation dialog — reorder, map, estimates, publish

**Files:**
- Create: `src/components/dashboard/route-validation-dialog.tsx`
- Modify: `package.json` (new dependency: `@dnd-kit/sortable`)

**Interfaces:**
- Consumes: `JadwalCard`, `JadwalDetailRow` from `pengiriman-jadwal.ts`; `getJadwalDetailAction`, `updateJadwalUrutanAction`, `updateJadwalDriverTimeAction`, `publishJadwalAction`, `startMuatAction`, `startBerangkatAction` from Task 5; `DriverOption` from `delivery.ts`; `MultiPointRoute` type from `osrm.ts`; `POST /api/routing/multi` from Task 1; `GET /api/pabrik-location` from Task 2.
- Produces: `RouteValidationDialog({ jadwal, businessDate, drivers, onOpenChange })` — consumed by Task 7.

- [ ] **Step 1: Install the dependency**

```bash
npm install @dnd-kit/sortable
```

- [ ] **Step 2: Create `src/components/dashboard/route-validation-dialog.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import dynamic from "next/dynamic";
import { GripVertical, MapPin, Phone, Route as RouteIcon, Fuel, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { JadwalCard as JadwalCardData, JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import type { MultiPointRoute } from "@/lib/osrm";
import {
  getJadwalDetailAction,
  updateJadwalUrutanAction,
  updateJadwalDriverTimeAction,
  publishJadwalAction,
  deleteJadwalDraftAction,
  startMuatAction,
  startBerangkatAction,
} from "@/app/(dashboard)/delivery/actions";

const RouteMap = dynamic(() => import("@/components/dashboard/route-map").then((m) => m.RouteMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

function combineDateAndTime(businessDate: string, timeHHMM: string): Date {
  return new Date(`${businessDate}T${timeHHMM}:00`);
}

function SortableStopRow({ detail, index }: { detail: JadwalDetailRow; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: detail.JadwalDetailID,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 border-b bg-card px-3 py-2 text-sm last:border-b-0",
        isDragging && "z-10 opacity-70 shadow-lg"
      )}
    >
      <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
        <GripVertical className="size-4" />
      </button>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{detail.CustomerName}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {detail.Wilayah}
          {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
        </p>
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">{detail.Qty} kantong</span>
      {detail.Latitude == null && (
        <Badge variant="outline" className="shrink-0 border-destructive/30 text-[10px] text-destructive">
          Tanpa lokasi
        </Badge>
      )}
    </div>
  );
}

export function RouteValidationDialog({
  jadwal,
  businessDate,
  drivers,
  konsumsiBBM,
  onOpenChange,
  onDeleted,
}: {
  jadwal: JadwalCardData | null;
  businessDate: string;
  drivers: DriverOption[];
  // Fuel estimate input — the Armada the open Jadwal belongs to, resolved
  // by the caller (JadwalCard itself doesn't carry KonsumsiBBM, ArmadaRow
  // does).
  konsumsiBBM: number | null;
  onOpenChange: (open: boolean) => void;
  // Fired after a successful "Batalkan Draft" so the caller can close this
  // dialog (it has no Jadwal left to show once deleted).
  onDeleted?: () => void;
}) {
  const [detail, setDetail] = useState<JadwalDetailRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<JadwalDetailRow[]>([]);
  const [time, setTime] = useState("00:00");
  const [driverId, setDriverId] = useState("");
  const [pabrik, setPabrik] = useState<{ latitude: number; longitude: number } | null>(null);
  const [route, setRoute] = useState<MultiPointRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const jadwalId = jadwal?.JadwalID ?? null;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (jadwalId == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrder([]);
      return;
    }
    setLoading(true);
    setError(null);
    getJadwalDetailAction(jadwalId)
      .then((rows) => {
        setDetail(rows);
        setOrder(rows);
      })
      .finally(() => setLoading(false));
  }, [jadwalId]);

  useEffect(() => {
    if (jadwal == null) return;
    const d = new Date(jadwal.JamJadwal);
    // Syncs the editable time/driver fields from the open card — not
    // derivable from render since these are user-editable inputs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDriverId(jadwal.SalesmanID ?? "");
  }, [jadwal]);

  useEffect(() => {
    if (jadwalId == null) return;
    fetch("/api/pabrik-location")
      .then((res) => res.json())
      .then((data: { latitude: number; longitude: number }) => setPabrik(data))
      .catch(() => setPabrik(null));
  }, [jadwalId]);

  // Recomputes the route whenever the stop order or the pabrik location
  // changes. Every stop must have a saved coordinate — otherwise a full
  // route genuinely can't be computed, so this surfaces as routeError
  // (which in turn keeps "Terbitkan" disabled, matching the mandatory-route
  // rule) instead of silently skipping stops.
  useEffect(() => {
    if (pabrik == null || order.length === 0) return;
    const missing = order.some((o) => o.Latitude == null || o.Longitude == null);
    if (missing) {
      setRoute(null);
      setRouteError("Beberapa tujuan belum punya lokasi tersimpan — tidak bisa hitung rute.");
      return;
    }
    setRouteLoading(true);
    setRouteError(null);
    const points = [
      { lat: pabrik.latitude, lng: pabrik.longitude },
      ...order.map((o) => ({ lat: o.Latitude as number, lng: o.Longitude as number })),
      { lat: pabrik.latitude, lng: pabrik.longitude },
    ];
    fetch("/api/routing/multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    })
      .then((res) => res.json())
      .then((data: MultiPointRoute | { error: string }) => {
        if ("error" in data) {
          setRoute(null);
          setRouteError(data.error);
        } else {
          setRoute(data);
        }
      })
      .catch(() => {
        setRoute(null);
        setRouteError("Gagal menghitung rute.");
      })
      .finally(() => setRouteLoading(false));
  }, [order, pabrik]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((o) => o.JadwalDetailID === active.id);
    const newIndex = order.findIndex((o) => o.JadwalDetailID === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    if (jadwalId != null) {
      startTransition(() => updateJadwalUrutanAction(jadwalId, next.map((d) => d.JadwalDetailID)));
    }
  }

  function handleSaveDriverTime() {
    if (jadwalId == null) return;
    startTransition(() =>
      updateJadwalDriverTimeAction(jadwalId, {
        jamJadwal: combineDateAndTime(businessDate, time),
        salesmanId: driverId || null,
      })
    );
  }

  function handlePublish() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await publishJadwalAction(jadwalId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menerbitkan DO.");
      }
    });
  }

  function handleDeleteDraft() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteJadwalDraftAction(jadwalId);
        onDeleted?.();
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal membatalkan draft.");
      }
    });
  }

  function handleMuat() {
    if (jadwalId == null) return;
    startTransition(() => startMuatAction(jadwalId));
  }

  function handleBerangkat() {
    if (jadwalId == null) return;
    startTransition(() => startBerangkatAction(jadwalId));
  }

  const isDraft = jadwal?.Status === "Draft";
  const canPublish = isDraft && driverId !== "" && route != null && !routeLoading;
  const totalFuelLiters = useMemo(() => {
    if (route == null || konsumsiBBM == null) return null;
    return Math.round(route.distanceKm * konsumsiBBM * 10) / 10;
  }, [route, konsumsiBBM]);

  return (
    <Dialog open={jadwalId != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Validasi Rute
            {jadwal && (
              <Badge variant="outline" className={cn("text-[10px]", isDraft ? "border-dashed" : "border-primary/30 text-primary")}>
                {jadwal.Status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>Atur waktu, driver, urutan pengiriman, dan validasi rute sebelum menerbitkan DO.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
              <Select value={driverId} onValueChange={(v) => setDriverId(v ?? "")}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Driver">
                    {(v: string) => drivers.find((d) => d.SalesmanID === v)?.Name ?? "Pilih Driver"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => (
                    <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                      {d.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" disabled={pending} onClick={handleSaveDriverTime}>
                Simpan
              </Button>
            </div>

            {!isDraft && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" disabled={pending} onClick={handleMuat}>
                  Mulai Muat
                </Button>
                <Button size="sm" className="flex-1" disabled={pending} onClick={handleBerangkat}>
                  Berangkat
                </Button>
              </div>
            )}

            <div className="flex max-h-72 flex-col overflow-y-auto rounded-lg border">
              {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
              {!loading && order.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada SO.</p>
              )}
              {!loading && order.length > 0 && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={order.map((o) => o.JadwalDetailID)} strategy={verticalListSortingStrategy}>
                    {order.map((d, i) => (
                      <SortableStopRow key={d.JadwalDetailID} detail={d} index={i} />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {routeError && <p className="text-xs text-destructive">{routeError}</p>}
            {route && (
              <div className="flex flex-wrap gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                <span className="flex items-center gap-1">
                  <RouteIcon className="size-3.5 text-muted-foreground" />
                  {route.distanceKm.toLocaleString("id-ID")} km
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5 text-muted-foreground" />
                  {route.durationMinutes} menit
                </span>
                {totalFuelLiters != null && (
                  <span className="flex items-center gap-1">
                    <Fuel className="size-3.5 text-muted-foreground" />
                    {totalFuelLiters.toLocaleString("id-ID")} L
                  </span>
                )}
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            {isDraft && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={pending} onClick={handleDeleteDraft}>
                  Batalkan Draft
                </Button>
                <Button className="flex-1" disabled={!canPublish || pending} onClick={handlePublish}>
                  {pending ? "Menerbitkan..." : "Terbitkan"}
                </Button>
              </div>
            )}
          </div>

          <div className="min-h-[320px] md:min-h-full">
            {pabrik && order.length > 0 ? (
              <RouteMap
                pabrik={pabrik}
                stops={order.filter((o) => o.Latitude != null && o.Longitude != null) as (JadwalDetailRow & { Latitude: number; Longitude: number })[]}
                geometry={route?.geometry ?? null}
              />
            ) : (
              <Skeleton className="h-full min-h-[320px] w-full rounded-lg" />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create `src/components/dashboard/route-map.tsx`**

```tsx
"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import L from "leaflet";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";

const pabrikIcon = L.divIcon({
  className: "",
  html: '<div style="background:#ea580c;width:16px;height:16px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function stopIcon(order: number) {
  return L.divIcon({
    className: "",
    html: `<div style="background:#16a34a;color:white;width:22px;height:22px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;font-family:sans-serif">${order}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export function RouteMap({
  pabrik,
  stops,
  geometry,
}: {
  pabrik: { latitude: number; longitude: number };
  stops: (JadwalDetailRow & { Latitude: number; Longitude: number })[];
  // Raw GeoJSON [lng, lat] pairs from MultiPointRoute — flipped to Leaflet's
  // [lat, lng] here, the only place in this feature that cares about the
  // difference.
  geometry: [number, number][] | null;
}) {
  const polylinePositions: [number, number][] | undefined = geometry?.map(([lng, lat]) => [lat, lng]);

  return (
    <MapContainer
      center={[pabrik.latitude, pabrik.longitude]}
      zoom={12}
      scrollWheelZoom
      attributionControl={false}
      style={{ height: "100%", minHeight: 320, width: "100%", borderRadius: "var(--radius-lg)" }}
    >
      <TileLayer url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png" />
      <Marker position={[pabrik.latitude, pabrik.longitude]} icon={pabrikIcon} />
      {stops.map((s, i) => (
        <Marker key={s.JadwalDetailID} position={[s.Latitude, s.Longitude]} icon={stopIcon(i + 1)} />
      ))}
      {polylinePositions && <Polyline positions={polylinePositions} pathOptions={{ color: "#2563eb", weight: 4 }} />}
    </MapContainer>
  );
}
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors in `route-validation-dialog.tsx` and `route-map.tsx` themselves (this component isn't wired into the board yet — that's Task 7 — so it's fine if it's currently unused; `tsc` checks types regardless).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx src/components/dashboard/route-map.tsx package.json package-lock.json
git commit -m "Add route validation dialog: drag-drop stop order, map, OSRM estimates, publish"
```

---

### Task 7: Board rework — responsive timeline, SO-based create, wire the new dialog

**Files:**
- Modify: `src/components/dashboard/pengiriman-board.tsx` (full rewrite)

**Interfaces:**
- Consumes: `RouteValidationDialog` from Task 6; `createJadwalDraftAction`, `getAvailableSalesOrdersAction` from Task 5; `JadwalCard`, `AvailableSalesOrder` from `pengiriman-jadwal.ts`.
- Produces: `PengirimanBoard({ armada, jadwal, drivers, businessDate, todayISO })` — same signature as before, consumed by `delivery/page.tsx` (unchanged).

- [ ] **Step 1: Replace `src/components/dashboard/pengiriman-board.tsx` in full**

```tsx
"use client";

import { DndContext, useDraggable, useSensor, useSensors, PointerSensor, type DragEndEvent } from "@dnd-kit/core";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArmadaManager } from "@/components/dashboard/armada-dialog";
import { RouteValidationDialog } from "@/components/dashboard/route-validation-dialog";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { JadwalCard as JadwalCardData, AvailableSalesOrder } from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import {
  createJadwalDraftAction,
  getAvailableSalesOrdersAction,
  updateJadwalDriverTimeAction,
} from "@/app/(dashboard)/delivery/actions";

// 24-hour axis, but the per-hour width is now derived from the available
// container width at render time (see useContainerWidth below) instead of a
// fixed 80px — a fixed width made the timeline wider than most screens,
// forcing a long horizontal scrollbar. DAY_WIDTH always equals the
// container's own width now, so there's nothing to scroll in the normal
// case.
const MIN_HOUR_WIDTH = 28;
const MIN_CARD_WIDTH = 40;

function hourFraction(value: string | Date): number {
  const d = new Date(value);
  return d.getHours() + d.getMinutes() / 60;
}

function combineDateAndTime(businessDate: string, timeHHMM: string): Date {
  return new Date(`${businessDate}T${timeHHMM}:00`);
}

// Measures the scroll container's own clientWidth on mount and on resize,
// so the 24h axis can be sized to fit it exactly.
function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(MIN_HOUR_WIDTH * 24);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

function CreateJadwalDialog({
  open,
  onOpenChange,
  armadaId,
  businessDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  armadaId: number | null;
  businessDate: string;
}) {
  const [available, setAvailable] = useState<AvailableSalesOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [time, setTime] = useState("08:00");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    // Resets the form when the dialog re-opens for a new Armada — not
    // derivable from render since these are user-editable fields.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(new Set());
    setTime("08:00");
    setError(null);
    getAvailableSalesOrdersAction(businessDate).then(setAvailable);
  }, [open, businessDate]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit() {
    if (armadaId == null || selected.size === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        await createJadwalDraftAction({
          armadaId,
          jamJadwal: combineDateAndTime(businessDate, time),
          salesOrderIds: [...selected],
        });
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal membuat draft keberangkatan.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keberangkatan Baru</DialogTitle>
          <DialogDescription>
            Pilih Sales Order yang akan menjadi DO pada keberangkatan ini. Driver &amp; rute divalidasi setelah draft
            dibuat — belum menerbitkan dokumen apa pun.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-lg border">
            {available.map((so) => (
              <button
                key={so.SalesOrderID}
                type="button"
                onClick={() => toggle(so.SalesOrderID)}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                  selected.has(so.SalesOrderID) ? "bg-primary/10" : "hover:bg-muted"
                )}
              >
                <span className="min-w-0 truncate">
                  {so.CustomerName} <span className="text-xs text-muted-foreground">· {so.Wilayah}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{so.Qty} kantong</span>
              </button>
            ))}
            {available.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada SO yang tersedia.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={pending || selected.size === 0 || armadaId == null} onClick={handleSubmit} className="ml-auto">
            {pending ? "Menyimpan..." : `Buat Draft (${selected.size} SO)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraggableJadwalCard({
  jadwal: j,
  hourWidth,
  cardWidth,
  onCardClick,
}: {
  jadwal: JadwalCardData;
  hourWidth: number;
  cardWidth: number;
  onCardClick: (jadwalId: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `jadwal-${j.JadwalID}`,
    data: { jadwalId: j.JadwalID },
  });
  const isDraft = j.Status === "Draft";

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      onClick={() => !isDragging && onCardClick(j.JadwalID)}
      className={cn(
        "absolute top-2 flex flex-col gap-0.5 rounded-md border p-1 text-left text-[9px] shadow-sm",
        isDraft ? "border-dashed border-muted-foreground/40 bg-muted/40" : "border-primary/30 bg-primary/10",
        isDragging && "z-20 opacity-70 shadow-lg"
      )}
      style={{
        left: hourFraction(j.JamJadwal) * hourWidth,
        width: cardWidth,
        transform: transform ? `translateX(${transform.x}px)` : undefined,
      }}
    >
      <span className="font-semibold tabular-nums">{formatTime(j.JamJadwal)}</span>
      <span className="tabular-nums text-muted-foreground">{j.TotalKantong} kantong</span>
      <span className="tabular-nums text-muted-foreground">
        {j.TotalStop} {isDraft ? "SO" : "DO"}
      </span>
      {isDraft && <span className="text-muted-foreground">Draft</span>}
      {j.JamAktualBerangkat && <span className="text-primary">Berangkat</span>}
    </button>
  );
}

function ArmadaRowBoard({
  armada,
  jadwal,
  hourWidth,
  dayWidth,
  onCardClick,
  onCreateClick,
}: {
  armada: ArmadaRow;
  jadwal: JadwalCardData[];
  hourWidth: number;
  dayWidth: number;
  onCardClick: (jadwalId: number) => void;
  onCreateClick: (armadaId: number) => void;
}) {
  const cardWidth = Math.max(MIN_CARD_WIDTH, hourWidth - 6);
  return (
    <div className="flex items-stretch self-start">
      <div className="sticky left-0 z-10 flex w-56 shrink-0 flex-col gap-1.5 bg-card py-3 pr-3">
        <div className="flex items-center gap-2">
          {armada.FotoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={armada.FotoPath} alt={armada.Nama} className="size-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
              Foto
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{armada.Nama}</p>
            <p className="truncate text-xs text-muted-foreground">{armada.PlatNomor ?? "-"}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-1">
          <Badge
            variant="outline"
            className={cn(
              "h-5 px-1.5 text-[10px]",
              armada.Status === "Baik" && "border-primary/30 text-primary",
              armada.Status !== "Baik" && "border-destructive/30 text-destructive"
            )}
          >
            {armada.Status}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            disabled={armada.Status !== "Baik"}
            onClick={() => onCreateClick(armada.ArmadaID)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative shrink-0 border-l" style={{ width: dayWidth, height: 72 }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute top-0 h-full border-r" style={{ left: h * hourWidth, width: hourWidth }} />
        ))}
        {jadwal.map((j) => (
          <DraggableJadwalCard key={j.JadwalID} jadwal={j} hourWidth={hourWidth} cardWidth={cardWidth} onCardClick={onCardClick} />
        ))}
      </div>
    </div>
  );
}

export function PengirimanBoard({
  armada,
  jadwal,
  drivers,
  businessDate,
  todayISO,
}: {
  armada: ArmadaRow[];
  jadwal: JadwalCardData[];
  drivers: DriverOption[];
  businessDate: string;
  todayISO: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const isToday = businessDate === todayISO;
  const [detailJadwalId, setDetailJadwalId] = useState<number | null>(null);
  const [createArmadaId, setCreateArmadaId] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const hourWidth = Math.max(MIN_HOUR_WIDTH, containerWidth / 24);
  const dayWidth = hourWidth * 24;

  const jadwalByArmada = useMemo(() => {
    const map = new Map<number, JadwalCardData[]>();
    for (const j of jadwal) {
      const list = map.get(j.ArmadaID) ?? [];
      list.push(j);
      map.set(j.ArmadaID, list);
    }
    return map;
  }, [jadwal]);

  const sortedArmada = useMemo(() => {
    function nextPendingHour(armadaId: number): number {
      const list = jadwalByArmada.get(armadaId) ?? [];
      const pending = list.filter((j) => !j.JamAktualBerangkat);
      if (pending.length === 0) return Infinity;
      return Math.min(...pending.map((j) => hourFraction(j.JamJadwal)));
    }
    return [...armada].sort((a, b) => {
      const diff = nextPendingHour(a.ArmadaID) - nextPendingHour(b.ArmadaID);
      return diff !== 0 ? diff : a.Nama.localeCompare(b.Nama);
    });
  }, [armada, jadwalByArmada]);

  const openJadwal = jadwal.find((j) => j.JadwalID === detailJadwalId) ?? null;
  const openArmada = openJadwal ? armada.find((a) => a.ArmadaID === openJadwal.ArmadaID) : null;

  function goToDate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pengirimanDate", newDate);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function shiftDate(deltaDays: number) {
    const d = new Date(businessDate);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + deltaDays));
    goToDate(next.toISOString().slice(0, 10));
  }

  function handleDragEnd(event: DragEndEvent) {
    const jadwalId = event.active.data.current?.jadwalId as number | undefined;
    if (jadwalId == null || event.delta.x === 0) return;

    const current = jadwal.find((j) => j.JadwalID === jadwalId);
    if (!current) return;

    const currentHour = hourFraction(current.JamJadwal);
    const deltaHours = event.delta.x / hourWidth;
    const newHour = Math.min(23.75, Math.max(0, Math.round((currentHour + deltaHours) * 4) / 4));
    const hour = Math.floor(newHour);
    const minute = Math.round((newHour - hour) * 60);
    const newTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

    // Reschedule-by-drag calls the same driver/time update path the
    // validation dialog uses, keeping only the time — driver stays as-is.
    startTransition(() => {
      updateJadwalDriverTimeAction(jadwalId, {
        jamJadwal: combineDateAndTime(businessDate, newTime),
        salesmanId: current.SalesmanID,
      });
    });
  }

  return (
    <Card className="relative">
      {isPending && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15">
          <div className="h-full w-1/3 animate-indeterminate rounded-full bg-primary" />
        </div>
      )}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="font-display">
            Papan Pengiriman {isToday ? "Hari Ini" : formatDate(businessDate)}
          </CardTitle>
          <CardDescription>{jadwal.length} keberangkatan terjadwal</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ArmadaManager armada={armada} />
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-8" disabled={isPending} onClick={() => shiftDate(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              type="date"
              value={businessDate}
              max={todayISO}
              disabled={isPending}
              onChange={(e) => e.target.value && goToDate(e.target.value)}
              className="h-8 w-40 text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={isToday || isPending}
              onClick={() => shiftDate(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {sortedArmada.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada armada. Tambah lewat &quot;Kelola Armada&quot;.</p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div ref={containerRef} className="overflow-x-auto">
              <div className="flex flex-col divide-y">
                {sortedArmada.map((a) => (
                  <ArmadaRowBoard
                    key={a.ArmadaID}
                    armada={a}
                    jadwal={jadwalByArmada.get(a.ArmadaID) ?? []}
                    hourWidth={hourWidth}
                    dayWidth={dayWidth}
                    onCardClick={setDetailJadwalId}
                    onCreateClick={setCreateArmadaId}
                  />
                ))}
              </div>
            </div>
          </DndContext>
        )}
      </CardContent>

      <RouteValidationDialog
        jadwal={openJadwal}
        businessDate={businessDate}
        drivers={drivers}
        konsumsiBBM={openArmada?.KonsumsiBBM ?? null}
        onOpenChange={(open) => !open && setDetailJadwalId(null)}
        onDeleted={() => setDetailJadwalId(null)}
      />
      <CreateJadwalDialog
        open={createArmadaId != null}
        onOpenChange={(open) => !open && setCreateArmadaId(null)}
        armadaId={createArmadaId}
        businessDate={businessDate}
      />
    </Card>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors project-wide.

- [ ] **Step 3: Verify lint**

Run: `npm run lint`
Expected: 0 errors (warnings in pre-existing unrelated generated files are fine, matching every prior task in this project).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx src/components/dashboard/route-validation-dialog.tsx
git commit -m "Rework Papan Pengiriman board: responsive timeline, SO-based drafts, cancel-draft"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 0 TypeScript errors, 0 lint errors, build succeeds.

- [ ] **Step 2: Manual browser walkthrough — responsive timeline**

Navigate to `/delivery` → "Papan Pengiriman". Confirm no horizontal scrollbar appears under the timeline at a normal desktop width, and that the 24 hour gridlines still span the visible width evenly. Resize the window narrower and confirm the timeline still fits (hour width shrinks, cards stay legible down to `MIN_HOUR_WIDTH`/`MIN_CARD_WIDTH`).

- [ ] **Step 3: Manual browser walkthrough — draft creation from SO**

Click "+" on a Status "Baik" vehicle. Confirm the list shows Sales Order rows (not DeliveryOrder rows) — cross-check against the DB that at least one `SalesOrder` with `IsClosed=0`, no linked `DeliveryOrder`, `DueDate` on the board's current date exists to pick from (create one via Pengajuan approval flow if none exist for today). Select 1-2 SOs, leave Driver unset (there's no Driver field in this dialog anymore per the design — confirm), submit. Confirm: a Draft-styled (dashed border) card appears on the board, and via direct SQL that `DeliveryOrder`/`DeliveryOrderDetail` have NOT gained any new rows (only `DashboardPengirimanJadwal`/`DashboardPengirimanJadwalDetail` did, with `SalesOrderID` set and `DeliveryOrderID` NULL).

- [ ] **Step 4: Manual browser walkthrough — route validation & publish**

Click the Draft card. Confirm the Validasi Rute dialog opens: time/driver editable, stop list drag-reorderable (drag one row, confirm order visually changes and persists after closing/reopening the dialog), map appears on the right with an orange Pabrik marker, numbered green stop markers matching the current order, and (once route resolves) a blue polyline connecting them. Confirm distance/duration/fuel figures appear. Leave Driver empty and confirm "Terbitkan" is disabled; select a Driver and confirm it becomes enabled once the route successfully resolves. Click "Terbitkan". Confirm: the card's badge changes from "Draft" to nothing (solid style), and via direct SQL that new `DeliveryOrder` row(s) now exist with `SalesOrderID` matching the selected SO(s), `VehicleNo`/`SalesmanID` matching the Armada/driver, `VoucherNo` following the `MKE/DO/xxxxxx/YYYY-MM/003/001` pattern with the correct monthly sequence, and `DashboardPengirimanJadwalDetail.DeliveryOrderID` now populated.

- [ ] **Step 5: Manual browser walkthrough — cancel a draft**

Create a second draft, open it, click "Batalkan Draft". Confirm the card disappears from the board and the SO(s) it held become selectable again in a fresh "+" dialog (re-open Create for the same Armada/date and confirm they're back in the list).

- [ ] **Step 6: Manual browser walkthrough — post-publish edit cascade**

On the published card from Step 4, reopen Validasi Rute, change the driver to a different one and/or the time, click "Simpan". Confirm via direct SQL that every `DeliveryOrder` row linked to that Jadwal now has the new `SalesmanID`/`VehicleNo`. Confirm stop reordering still works (drag a row) even though the Jadwal is `Terbit`.

- [ ] **Step 7: Manual browser walkthrough — Pabrik location settings**

As a Super Admin, navigate to `/akun`. Confirm a "Lokasi Pabrik" card appears with the map pre-centered on the existing coordinate. Move the pin slightly, save, reload the page, and confirm the new coordinate persisted. Open a Mitra's location editor (`/mitra`) and confirm its map's orange Pabrik reference dot reflects the updated coordinate too (not the old hardcoded one).

- [ ] **Step 8: Regression spot-checks**

Confirm `/delivery` → "Pengiriman Terbuka" tab still loads and shows the newly-published DO(s) from Step 4 with the correct Kendaraan column. Confirm `/transaksi` still loads without errors (unaffected by this plan's changes, but shares `DeliveryOrder`/`SalesOrder` reads).
