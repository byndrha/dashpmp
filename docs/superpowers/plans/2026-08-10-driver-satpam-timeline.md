# Driver-App & Satpam-App Vertical Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace driver-app's Riwayat tab and add a new section below satpam-app's Beranda, both showing a compact vertical timeline (dot+line, uniform spacing, newest on top) of activity within the current 14:00-WIB-rollover business-date window.

**Architecture:** Two new read-only query functions (one per app, each following this codebase's existing WIB-rollover-window SQL pattern) feed a new shared, data-agnostic `VerticalTimeline`/`VerticalTimelineItem` UI primitive in `src/components/ui/`. Driver-app's Riwayat tab and its keep-alive tab shell are updated to fetch and render the new data instead of the old undated 50-row history. Satpam-app's Beranda keeps its existing pending-check list untouched and gains the new timeline as an appended section.

**Tech Stack:** Next.js/TypeScript, MSSQL (raw SQL via `mssql`), React Server + Client Components. No test framework in this repo — verification via `tsc --noEmit`, `eslint`, and live browser checks.

## Global Constraints

- Business-date window: reuse the **exact SQL pattern already in `src/lib/queries/satpam-inspection.ts`'s `getSatpamInspectionList`** (lines 57-58) — `col >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME))) AND col < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME)))`, with `@businessDate` bound as `sql.Date` from `getBusinessDateISO()`. **Deviation from the approved spec** ([2026-08-10-driver-satpam-timeline-design.md](../specs/2026-08-10-driver-satpam-timeline-design.md)): the spec's illustrative `getBusinessDateWindowUTC` TS helper is NOT built — this proven, already-in-production SQL pattern expresses the identical 14:00-WIB-rollover window directly in T-SQL and is simpler; no new function is added to `business-date.ts`. Behavior is identical to what the spec approved (the window itself), only the mechanism changed to match existing convention.
- No date navigation (always current business date via `getBusinessDateISO()`, no args). No pagination.
- Driver-app entry = one Jadwal (already-completed only, same `HAVING COUNT(sa.JadwalDetailID) = SUM(sa.IsSelesai)` filter as `getDriverJadwalHistory`), anchored on `JamAktualBerangkat`, with BBM/Kendala shown as compact lines inside the same card — never as separate timeline entries.
- Satpam-app entry = one `DashboardVehicleCheck` row (one per Cek Berangkat or Cek Datang event), anchored on `CheckedAt`. Satpam-app's existing pending-check list (`getSatpamInspectionList`, unchanged) stays at the top of Beranda; the new timeline is appended below it, not merged into it.
- `VerticalTimeline`/`VerticalTimelineItem` (`src/components/ui/vertical-timeline.tsx`) render uniform spacing between entries regardless of the real time gap between them — no calendar/agenda-style proportional spacing.
- `getDriverJadwalHistory` and `getSatpamInspectionList` are NOT modified or removed — new functions are added alongside them.

---

### Task 1: `getDriverTimeline` query + types

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts` (add new exports after `getDriverJadwalHistory`, currently ending at line 410)

**Interfaces:**
- Produces: `DriverTimelineBBM`, `DriverTimelineKendala`, `DriverTimelineEntry` interfaces; `getDriverTimeline(salesmanId: string, businessDateISO: string): Promise<DriverTimelineEntry[]>` — used by Task 4.

- [ ] **Step 1: Add the new types and function**

Insert immediately after `getDriverJadwalHistory`'s closing `}` (current line 410), before the blank line at 411:

```ts

export interface DriverTimelineBBM {
  waktuMasukSpbu: string;
  waktuIsi: string | null;
  liter: number | null;
}

export interface DriverTimelineKendala {
  waktuLapor: string;
  jenisKendala: string;
}

export interface DriverTimelineEntry {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  jamAktualBerangkat: string;
  totalStop: number;
  totalKantong: number;
  bbm: DriverTimelineBBM[];
  kendala: DriverTimelineKendala[];
}

// Timeline for driver-app's Riwayat tab — completed Jadwal (same
// HAVING COUNT(...) = SUM(IsSelesai) filter as getDriverJadwalHistory
// above, this function's sibling, which stays unmodified) whose actual
// departure falls in the current 14:00-WIB-rollover business-date window
// (see ROLLOVER_HOUR in business-date.ts). Unlike getDriverJadwalHistory,
// scoped to one business day rather than a flat row-count cap, and each
// entry carries its own BBM refuel and Kendala report rows (fetched
// separately below and merged in, the same "fetch flat rows once, group
// by parent ID in TS" shape as getVehicleChecksForJadwal groups photos) —
// both are shown as compact lines inside the Jadwal's own timeline card,
// never as separate timeline entries.
export async function getDriverTimeline(salesmanId: string, businessDateISO: string): Promise<DriverTimelineEntry[]> {
  const pool = await getPool();
  const jadwalResult = await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("businessDate", sql.Date, businessDateISO).query(`
      WITH StopAgg AS (
          SELECT jd.JadwalID, jd.JadwalDetailID,
                 ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Kantong,
                 CASE WHEN sd.JamSelesai IS NOT NULL THEN 1 ELSE 0 END AS IsSelesai
          FROM DashboardPengirimanJadwalDetail jd
          LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
          LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
          WHERE jd.IsDeleted = 0
          GROUP BY jd.JadwalID, jd.JadwalDetailID, sd.JamSelesai
      )
      SELECT
          j.JadwalID,
          a.Nama AS ArmadaNama,
          ed.VehicleNo,
          j.JamAktualBerangkat,
          COUNT(sa.JadwalDetailID) AS TotalStop,
          SUM(sa.Kantong) AS TotalKantong
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      JOIN StopAgg sa ON sa.JadwalID = j.JadwalID
      WHERE j.SalesmanID = @salesmanId AND j.IsDeleted = 0
        -- businessDate is a 14:00 WIB rollover label — same window as
        -- getSatpamInspectionList (satpam-inspection.ts).
        AND j.JamAktualBerangkat >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
        AND j.JamAktualBerangkat < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
      GROUP BY j.JadwalID, a.Nama, ed.VehicleNo, j.JamAktualBerangkat
      HAVING COUNT(sa.JadwalDetailID) = SUM(sa.IsSelesai)
      ORDER BY j.JamAktualBerangkat DESC
    `);

  const jadwalRows = jadwalResult.recordset as {
    JadwalID: number;
    ArmadaNama: string;
    VehicleNo: string | null;
    JamAktualBerangkat: Date;
    TotalStop: number;
    TotalKantong: number;
  }[];

  if (jadwalRows.length === 0) return [];

  const jadwalIds = jadwalRows.map((r) => r.JadwalID);
  const request = pool.request();
  const placeholders = jadwalIds.map((id, i) => {
    request.input(`j${i}`, sql.Int, id);
    return `@j${i}`;
  });

  const [bbmResult, kendalaResult] = await Promise.all([
    request.query(`
      SELECT JadwalID, WaktuMasukSpbu, WaktuIsi, Liter
      FROM DashboardPengirimanBBM
      WHERE JadwalID IN (${placeholders.join(",")})
      ORDER BY WaktuMasukSpbu
    `),
    pool
      .request()
      .query(
        // Separate request object — the one above already consumed its
        // positional @j0.. inputs for the BBM query; mssql request objects
        // are single-use per set of bound inputs.
        `SELECT JadwalID, WaktuLapor, JenisKendala FROM DashboardPengirimanKendala WHERE JadwalID IN (${jadwalIds.join(",")}) ORDER BY WaktuLapor`
      ),
  ]);

  const bbmByJadwal = new Map<number, DriverTimelineBBM[]>();
  for (const r of bbmResult.recordset as { JadwalID: number; WaktuMasukSpbu: Date; WaktuIsi: Date | null; Liter: number | null }[]) {
    const list = bbmByJadwal.get(r.JadwalID) ?? [];
    list.push({ waktuMasukSpbu: r.WaktuMasukSpbu.toISOString(), waktuIsi: r.WaktuIsi?.toISOString() ?? null, liter: r.Liter });
    bbmByJadwal.set(r.JadwalID, list);
  }

  const kendalaByJadwal = new Map<number, DriverTimelineKendala[]>();
  for (const r of kendalaResult.recordset as { JadwalID: number; WaktuLapor: Date; JenisKendala: string }[]) {
    const list = kendalaByJadwal.get(r.JadwalID) ?? [];
    list.push({ waktuLapor: r.WaktuLapor.toISOString(), jenisKendala: r.JenisKendala });
    kendalaByJadwal.set(r.JadwalID, list);
  }

  return jadwalRows.map((r) => ({
    jadwalId: r.JadwalID,
    armadaNama: r.ArmadaNama,
    vehicleNo: r.VehicleNo,
    jamAktualBerangkat: r.JamAktualBerangkat.toISOString(),
    totalStop: r.TotalStop,
    totalKantong: r.TotalKantong,
    bbm: bbmByJadwal.get(r.JadwalID) ?? [],
    kendala: kendalaByJadwal.get(r.JadwalID) ?? [],
  }));
}
```

Note on the Kendala query: `jadwalIds.join(",")` is safe string interpolation here (not user input — every ID came from `jadwalRows`, which was itself just fetched from `DashboardPengirimanJadwal.JadwalID`, an `int` column, via a parameterized query one line above; there is no path for an attacker-controlled string to reach this array). The BBM query instead uses bound `@j0..@jN` placeholders on `request` — keep both queries as shown (not a real inconsistency to "fix", just two established patterns from elsewhere in this file for the same IN-list problem; picking bound params for one and inline for the other here purely because `request` object reuse across two `.query()` calls with different input sets is what makes the second one need its own fresh `pool.request()`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "feat: getDriverTimeline query for driver-app vertical timeline"
```

---

### Task 2: `getSatpamTimeline` query + types

**Files:**
- Modify: `src/lib/queries/satpam-inspection.ts` (add new exports after `getSatpamInspectionList`, currently ending at line 103)

**Interfaces:**
- Consumes: `VehicleCheckTipe` from `@/lib/vehicle-check-types` (already exists: `export type VehicleCheckTipe = "BERANGKAT" | "DATANG";`).
- Produces: `SatpamTimelineEntry` interface; `getSatpamTimeline(businessDateISO: string): Promise<SatpamTimelineEntry[]>` — used by Task 5.

- [ ] **Step 1: Add the import and the new type + function**

Add to the top of the file (currently only `import { getPool, sql } from "@/lib/db";` at line 1):

```ts
import type { VehicleCheckTipe } from "@/lib/vehicle-check-types";
```

Then append at the end of the file, after `getSatpamInspectionList`'s closing `}` (current line 103):

```ts

export interface SatpamTimelineEntry {
  vehicleCheckId: number;
  jadwalId: number;
  tipe: VehicleCheckTipe;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  checkedAt: string;
  odometerKM: number;
}

// Timeline for satpam-app's Beranda, appended below the existing pending
// list (getSatpamInspectionList above, unmodified) — completed check
// events (both BERANGKAT and DATANG, each its own entry since they can be
// hours apart) whose CheckedAt falls in the current business-date window.
// Same 14:00-WIB-rollover window expression as getSatpamInspectionList's
// own JamJadwal filter above, applied to CheckedAt instead.
export async function getSatpamTimeline(businessDateISO: string): Promise<SatpamTimelineEntry[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDateISO).query(`
      SELECT
        vc.VehicleCheckID,
        vc.JadwalID,
        vc.Tipe,
        a.Nama AS ArmadaNama,
        ISNULL(ed.VehicleNo, a.Nama) AS VehicleNo,
        sm.Name AS DriverName,
        vc.CheckedAt,
        vc.OdometerKM
      FROM DashboardVehicleCheck vc
      JOIN DashboardPengirimanJadwal j ON j.JadwalID = vc.JadwalID
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      WHERE vc.CheckedAt >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
        AND vc.CheckedAt < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
      ORDER BY vc.CheckedAt DESC
    `);

  const rows = result.recordset as {
    VehicleCheckID: number;
    JadwalID: number;
    Tipe: VehicleCheckTipe;
    ArmadaNama: string;
    VehicleNo: string | null;
    DriverName: string | null;
    CheckedAt: Date;
    OdometerKM: number;
  }[];

  return rows.map((r) => ({
    vehicleCheckId: r.VehicleCheckID,
    jadwalId: r.JadwalID,
    tipe: r.Tipe,
    armadaNama: r.ArmadaNama,
    vehicleNo: r.VehicleNo,
    driverName: r.DriverName,
    checkedAt: r.CheckedAt.toISOString(),
    odometerKM: r.OdometerKM,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/satpam-inspection.ts
git commit -m "feat: getSatpamTimeline query for satpam-app vertical timeline"
```

---

### Task 3: `VerticalTimeline` shared UI component

**Files:**
- Create: `src/components/ui/vertical-timeline.tsx`

**Interfaces:**
- Produces: `VerticalTimeline` (wrapper), `VerticalTimelineItem` (one entry: dot + time label + card content) — used by Task 4 and Task 5. Pure presentational, no data-layer imports.

- [ ] **Step 1: Write the component**

```tsx
import type { ReactNode } from "react";

// Compact vertical activity timeline: a thin rail with one dot per entry
// on the left, entry content on the right. Deliberately NOT a
// calendar/agenda view — spacing between entries is always the same
// fixed gap, never proportional to the real time elapsed between them
// (a 5-minute gap and a 5-hour gap between two entries look identical).
export function VerticalTimeline({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

export function VerticalTimelineItem({
  time,
  isLast = false,
  children,
}: {
  time: string;
  isLast?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" />
        {!isLast && <span className="w-px flex-1 bg-border" />}
      </div>
      <div className="flex-1 pb-3">
        <p className="mb-1 font-mono text-xs text-muted-foreground">{time}</p>
        {children}
      </div>
    </div>
  );
}
```

`isLast` on the final item omits the trailing line segment below its dot, so the rail doesn't dangle past the last entry. Callers pass `isLast={i === entries.length - 1}` when mapping.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/vertical-timeline.tsx
git commit -m "feat: VerticalTimeline shared UI primitive"
```

---

### Task 4: Driver-app wiring (Riwayat tab)

**Files:**
- Modify: `src/app/mkesindo/driver-app/actions.ts:1-31` (imports), add new action after `getDriverJadwalHistoryAction` (current lines 144-149)
- Modify: `src/components/driver-app/driver-tab-shell.tsx` (riwayat state type + fetch call)
- Modify: `src/components/driver-app/riwayat-list.tsx` (full rewrite)
- Modify: `src/app/mkesindo/driver-app/(tabs)/riwayat/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `getDriverTimeline`, `DriverTimelineEntry` from Task 1; `VerticalTimeline`, `VerticalTimelineItem` from Task 3.
- Produces: `getDriverTimelineAction(): Promise<ActionResult<DriverTimelineEntry[]>>` — the only new export other consumers might reach; no other file in this task changes its own exported signature.

- [ ] **Step 1: Add `getDriverTimelineAction`**

In `src/app/mkesindo/driver-app/actions.ts`, change the import block at lines 5-18 from:

```ts
import {
  getDriverJadwalList,
  getDriverJadwalStops,
  getDriverJadwalHistory,
  getStopOrderItems,
  recordStopArrival,
  confirmStopDelivery,
  assertOwnsJadwal,
  assertOwnsJadwalDetail,
  type DriverJadwalCard,
  type DriverStopRow,
  type StopOrderItem,
  type ConfirmStopDeliveryInput,
} from "@/lib/queries/pengiriman-jadwal";
```

to:

```ts
import {
  getDriverJadwalList,
  getDriverJadwalStops,
  getDriverJadwalHistory,
  getDriverTimeline,
  getStopOrderItems,
  recordStopArrival,
  confirmStopDelivery,
  assertOwnsJadwal,
  assertOwnsJadwalDetail,
  type DriverJadwalCard,
  type DriverStopRow,
  type DriverTimelineEntry,
  type StopOrderItem,
  type ConfirmStopDeliveryInput,
} from "@/lib/queries/pengiriman-jadwal";
```

Also add this import (new line, alongside the other `@/lib` imports near line 30):

```ts
import { getBusinessDateISO } from "@/lib/business-date";
```

Then add this new action immediately after `getDriverJadwalHistoryAction`'s closing `}` (current lines 144-149):

```ts

export async function getDriverTimelineAction(): Promise<ActionResult<DriverTimelineEntry[]>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    return getDriverTimeline(salesmanId, getBusinessDateISO());
  });
}
```

`getDriverJadwalHistory`/`getDriverJadwalHistoryAction` stay exactly as-is — do not remove or modify them.

- [ ] **Step 2: Rewrite `riwayat-list.tsx`**

Replace the entire file with:

```tsx
"use client";

import { Fuel, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
import { formatTime } from "@/lib/format";
import type { DriverTimelineEntry } from "@/lib/queries/pengiriman-jadwal";

export function RiwayatList({ entries }: { entries: DriverTimelineEntry[] }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Riwayat</h1>
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Belum ada aktivitas hari ini.</p>
      ) : (
        <VerticalTimeline>
          {entries.map((e, i) => (
            <VerticalTimelineItem key={e.jadwalId} time={formatTime(e.jamAktualBerangkat)} isLast={i === entries.length - 1}>
              <Card className="py-3">
                <CardContent className="flex flex-col gap-1 px-4">
                  <p className="text-sm font-medium">
                    {e.armadaNama} {e.vehicleNo ? `• ${e.vehicleNo}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.totalStop} lokasi &mdash; {e.totalKantong} kantong
                  </p>
                  {e.bbm.map((b, bi) => (
                    <p key={bi} className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Fuel className="size-3" /> Isi BBM {formatTime(b.waktuIsi ?? b.waktuMasukSpbu)}
                    </p>
                  ))}
                  {e.kendala.map((k, ki) => (
                    <p key={ki} className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="size-3" /> Kendala: {k.jenisKendala} {formatTime(k.waktuLapor)}
                    </p>
                  ))}
                </CardContent>
              </Card>
            </VerticalTimelineItem>
          ))}
        </VerticalTimeline>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `driver-tab-shell.tsx`**

Change the import at line 19 from:

```ts
import type { DriverJadwalCard, DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
```

to:

```ts
import type { DriverJadwalCard, DriverStopRow, DriverTimelineEntry } from "@/lib/queries/pengiriman-jadwal";
```

Change the action import at line 15 from `getDriverJadwalHistoryAction,` to `getDriverTimelineAction,` (in the import block starting at line 12).

Change the `initialRiwayat` prop type (line 67) from `DriverJadwalCard[]` to `DriverTimelineEntry[]`.

Change the `riwayat` state (line 80) from:
```ts
const [riwayat, setRiwayat] = useState<DriverJadwalCard[] | null>(initialRiwayat ?? null);
```
to:
```ts
const [riwayat, setRiwayat] = useState<DriverTimelineEntry[] | null>(initialRiwayat ?? null);
```

Change the fetch call inside the `riwayat` branch of the `load()` effect (lines 149-161) from `getDriverJadwalHistoryAction()` to `getDriverTimelineAction()` — the rest of that branch's shape (`result.success` check, `setRiwayat(result.data)`) stays identical since both actions return an `ActionResult<T[]>`.

Change the render call (line 213) from `<RiwayatList history={riwayat} />` to `<RiwayatList entries={riwayat} />`, matching Step 2's renamed prop.

- [ ] **Step 4: Rewrite `riwayat/page.tsx`**

Replace the entire file with:

```tsx
import { requireDriver } from "@/lib/require-access";
import { getDriverTimeline } from "@/lib/queries/pengiriman-jadwal";
import { getBusinessDateISO } from "@/lib/business-date";
import { DriverTabShell } from "@/components/driver-app/driver-tab-shell";

export default async function DriverRiwayatPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const timeline = salesmanId ? await getDriverTimeline(salesmanId, getBusinessDateISO()) : [];

  return (
    <DriverTabShell
      initialTab="riwayat"
      driverName={session.user.name ?? session.user.username}
      initialRiwayat={timeline}
      initialError={salesmanId ? undefined : "Akun ini belum ditautkan ke data Driver, hubungi Admin."}
    />
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no new errors/warnings from the 4 files touched in this task.

- [ ] **Step 7: Commit**

```bash
git add src/app/mkesindo/driver-app/actions.ts src/components/driver-app/driver-tab-shell.tsx src/components/driver-app/riwayat-list.tsx "src/app/mkesindo/driver-app/(tabs)/riwayat/page.tsx"
git commit -m "feat: wire driver-app Riwayat tab to new vertical timeline"
```

---

### Task 5: Satpam-app wiring (Beranda)

**Files:**
- Modify: `src/app/mkesindo/satpam-app/page.tsx` (full rewrite)
- Modify: `src/components/satpam-app/beranda-client.tsx` (add timeline section)

**Interfaces:**
- Consumes: `getSatpamTimeline`, `SatpamTimelineEntry` from Task 2; `VerticalTimeline`, `VerticalTimelineItem` from Task 3.
- Produces: nothing new consumed elsewhere — `SatpamBerandaClient`'s prop list grows but it has exactly one caller (`page.tsx`, updated in the same task).

- [ ] **Step 1: Update `page.tsx`**

Replace the entire file with:

```tsx
import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList, getSatpamTimeline } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { getUserById } from "@/lib/queries/akun";
import { SatpamBerandaClient } from "@/components/satpam-app/beranda-client";

export default async function SatpamBerandaPage() {
  const session = await requireSatpam();
  const businessDateISO = getBusinessDateISO();
  const [cards, timeline, profile] = await Promise.all([
    getSatpamInspectionList(businessDateISO),
    getSatpamTimeline(businessDateISO),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <SatpamBerandaClient
      cards={cards}
      timeline={timeline}
      userName={session.user.name ?? session.user.username}
      profile={profile}
    />
  );
}
```

- [ ] **Step 2: Add the timeline section to `beranda-client.tsx`**

Add this import (alongside the existing `SatpamInspectionCard` type import at line 10):

```ts
import type { SatpamTimelineEntry } from "@/lib/queries/satpam-inspection";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
```

Add a new component, placed right after the existing `InspectionCard` function (before `export function SatpamBerandaClient`, current line 58):

```tsx
function TimelineCard({ entry }: { entry: SatpamTimelineEntry }) {
  return (
    <Card className="p-3">
      <p className="text-sm font-medium">
        {entry.tipe === "BERANGKAT" ? "Cek Berangkat" : "Cek Datang"} — {entry.armadaNama}
        {entry.vehicleNo && entry.vehicleNo !== entry.armadaNama ? ` (${entry.vehicleNo})` : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        {entry.driverName ?? "Tanpa driver"} &mdash; {entry.odometerKM.toLocaleString("id-ID")} KM
      </p>
    </Card>
  );
}
```

Change the `SatpamBerandaClient` function signature (current lines 58-66) from:

```tsx
export function SatpamBerandaClient({
  cards,
  userName,
  profile,
}: {
  cards: SatpamInspectionCard[];
  userName: string;
  profile: OwnProfile | null;
}) {
```

to:

```tsx
export function SatpamBerandaClient({
  cards,
  timeline,
  userName,
  profile,
}: {
  cards: SatpamInspectionCard[];
  timeline: SatpamTimelineEntry[];
  userName: string;
  profile: OwnProfile | null;
}) {
```

Add the new timeline section right after the existing `<Tabs>...</Tabs>` block closes (current line 99, `</Tabs>`), still inside the outer `<div className="flex min-h-screen flex-col bg-background">`:

```tsx
      <div className="flex flex-col gap-3 border-t px-4 py-4">
        <h2 className="font-display text-base font-semibold">Riwayat Hari Ini</h2>
        {timeline.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada aktivitas hari ini.</p>
        ) : (
          <VerticalTimeline>
            {timeline.map((entry, i) => (
              <VerticalTimelineItem key={entry.vehicleCheckId} time={formatTime(entry.checkedAt)} isLast={i === timeline.length - 1}>
                <TimelineCard entry={entry} />
              </VerticalTimelineItem>
            ))}
          </VerticalTimeline>
        )}
      </div>
```

(`formatTime` is already imported at this file's existing line 9 and used inside `InspectionCard` — reused here as-is, no new formatting import needed.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors/warnings from the 2 files touched in this task (in particular, confirm the leftover `Fuel` import mentioned in Step 2 was NOT added — it would trigger `@typescript-eslint/no-unused-vars`).

- [ ] **Step 5: Commit**

```bash
git add src/app/mkesindo/satpam-app/page.tsx src/components/satpam-app/beranda-client.tsx
git commit -m "feat: append vertical timeline to satpam-app Beranda"
```

---

### Task 6: Full verification pass

**Files:** None — verification only.

- [ ] **Step 1: Typecheck & lint the whole project**

Run: `npx tsc --noEmit` then `npm run lint`.
Expected: both clean (or identical to the pre-existing baseline noted in prior plans this session — 4 pre-existing `react-hooks/refs` errors and ~37 warnings unrelated to any file this plan touches; confirm nothing new).

- [ ] **Step 2: Live browser verification — driver-app Riwayat**

1. Start the dev server, log in as a driver account with at least one completed Jadwal today (departed within the current business-date window) — ideally one with a BBM log and/or a Kendala report attached, to exercise the compact-detail-lines rendering.
2. Navigate to `/mkesindo/driver-app/riwayat`.
3. Confirm: entries render newest-first (top to bottom), each card compact regardless of BBM/Kendala count, uniform gap between cards (visually inspect that a card representing a Jadwal from hours ago isn't pushed further down than one from minutes ago beyond the normal fixed spacing).
4. If the driver has zero completed Jadwal in today's business-date window, confirm the "Belum ada aktivitas hari ini." empty state renders instead of a blank list.

- [ ] **Step 3: Live browser verification — satpam-app Beranda**

1. Log in as a Satpam account.
2. Navigate to `/mkesindo/satpam-app`.
3. Confirm the existing pending-check list (tabs "Keberangkatan"/"Kedatangan") still renders exactly as before, unchanged, above the new "Riwayat Hari Ini" section.
4. Confirm the new timeline section below it shows completed Cek Berangkat/Cek Datang events for today's business date, newest first, each as its own entry (not merged with its paired Berangkat/Datang event even if from the same Jadwal).
5. If there are zero completed checks today, confirm "Belum ada aktivitas hari ini." renders.

- [ ] **Step 4: Read console/network for errors**

Use `read_console_messages` and `read_network_requests` on both pages from Steps 2-3 — confirm no new client-side errors and no failed requests to the new action/query paths.

- [ ] **Step 5: Commit (only if Steps 1-4 required fixes)**

If verification surfaced issues, fix them and commit separately with a message describing the fix. If everything passed as built, no additional commit is needed.
