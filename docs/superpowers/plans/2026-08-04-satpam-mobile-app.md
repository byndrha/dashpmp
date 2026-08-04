# Satpam Mobile App (Jalur A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new full-screen mobile routes for Satpam gate inspections — a home list ("Beranda Inspeksi Pengiriman") and a live camera inspection flow ("Live Inspeksi Kendaraan") — built against this project's existing shadcn design system and reusing the existing `DashboardPengirimanJadwal`/`DashboardVehicleCheck` backend, per the approved design spec.

**Architecture:** Two new standalone routes under `src/app/satpam-app/`, outside the `(dashboard)` route group (same no-chrome pattern as `/login`, `/invoice/[token]`). A new `requireSatpam()` access guard. A new read query for the home list. The desktop `LiveCameraCaptureField`'s capture logic is extracted into a shared `useLiveCameraCapture` hook so the new full-screen mobile capture UI and the existing desktop component both consume the same, already-proven getUserMedia/canvas logic without duplicating it.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), React 19, TypeScript, Tailwind v4, shadcn/`@base-ui/react`, MSSQL via `mssql`.

## Global Constraints

- New routes live at `src/app/satpam-app/...`, **outside** the `(dashboard)` route group — no sidebar/topbar dashboard chrome, matching the existing `/login` and `/invoice/[token]` precedent.
- Every new page is gated by a new `requireSatpam()` helper (mirrors `requireSuperAdmin`/`requirePmputra` in `src/lib/require-access.ts` exactly) — redirects to `/login` if unauthenticated, `/akses-ditolak` if authenticated but not Satpam.
- No new database tables or columns. The muatan-confirmation step still writes a plain `muatanQty: number` via the existing `createVehicleCheckAction` — "Ya" just auto-fills that number from the Jadwal's already-known expected total instead of asking the Satpam to type it.
- Colors map to this project's existing shadcn CSS tokens — the mockups' amber accent maps to the existing `--warning`/`--warning-foreground` token pair already defined in `globals.css` (both light and dark) — no new color token is introduced. Icons are `lucide-react` (this project has zero Material Symbols usage anywhere).
- Screen 2 always renders in dark mode regardless of system preference, using this project's **existing** `.dark { ... }` token values in `globals.css` — never the mockup's hardcoded hex colors.
- The `useLiveCameraCapture` hook extraction (Task 4) must not change the desktop `LiveCameraCaptureField`'s existing observable behavior in any way — same capture/retake/toggle-never-streams/double-tap-guard/retake-reset-on-inactive behavior already shipped and reviewed earlier this session.
- AI-based automatic side detection is out of scope for this plan entirely (Jalur B, a separate future plan) — the "active target" side is always set by the user tapping a slot.
- The 14:00 WIB rollover convention (`ROLLOVER_HOUR` / `getBusinessDateISO()` in `src/lib/business-date.ts`) is used for "today" on the home list — not the narrower 13:00 WIB convention that applies only to the Kinerja Marketing panel.

---

## Task 1: `requireSatpam()` access guard

**Files:**
- Modify: `src/lib/require-access.ts`

**Interfaces:**
- Produces: `requireSatpam(): Promise<Session>` — Tasks 3 and 5's page components call this.

- [ ] **Step 1: Add the guard**

Add after the existing `requirePmputra` function, at the end of the file:

```ts
export async function requireSatpam() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isSatpam) redirect("/akses-ditolak");
  return session;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/require-access.ts` — expect 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/require-access.ts
git commit -m "Add requireSatpam access guard"
```

---

## Task 2: `getSatpamInspectionList` query

**Files:**
- Create: `src/lib/queries/satpam-inspection.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SatpamInspectionCard {
    jadwalId: number;
    armadaNama: string;
    vehicleNo: string | null;
    driverName: string | null;
    jamJadwal: string; // ISO
    doVoucherNo: string | null;
    status: "Draft" | "Terbit";
    tipe: "BERANGKAT" | "DATANG";
    hasCheck: boolean;
  }
  export async function getSatpamInspectionList(businessDate: string): Promise<SatpamInspectionCard[]>
  ```
  Task 3 consumes this exact shape.

- [ ] **Step 1: Write the query module**

```ts
import { getPool, sql } from "@/lib/db";

export interface SatpamInspectionCard {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  jamJadwal: string;
  doVoucherNo: string | null;
  status: "Draft" | "Terbit";
  tipe: "BERANGKAT" | "DATANG";
  // Always false in the array this function returns (see the filter at the
  // bottom) — kept on the type because a future consumer showing an
  // "already inspected today" view would need it; this function's own job
  // is strictly "what still needs a decision".
  hasCheck: boolean;
}

// One row per Jadwal-and-Tipe combination still needing a Satpam decision
// today (businessDate, 14:00 WIB rollover — see ROLLOVER_HOUR in
// business-date.ts). BERANGKAT rows always appear (Draft ones just aren't
// actionable yet); DATANG rows only appear once BERANGKAT is Terbit AND has
// its own recorded check — mirrors the sequential Cek Berangkat -> Cek
// Datang gate already enforced server-side in vehicle-check.ts's
// createVehicleCheck.
export async function getSatpamInspectionList(businessDate: string): Promise<SatpamInspectionCard[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate).query(`
      SELECT
        j.JadwalID,
        a.Nama AS ArmadaNama,
        ISNULL(ed.VehicleNo, a.Nama) AS VehicleNo,
        sm.Name AS DriverName,
        j.JamJadwal,
        j.Status,
        (
          SELECT TOP 1 do_.VoucherNo
          FROM DashboardPengirimanJadwalDetail jd
          JOIN DeliveryOrder do_ ON do_.DeliveryOrderID = jd.DeliveryOrderID AND do_.IsDeleted = 0
          WHERE jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
          ORDER BY jd.Urutan
        ) AS DoVoucherNo,
        vcb.VehicleCheckID AS BerangkatCheckID,
        vcd.VehicleCheckID AS DatangCheckID
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      LEFT JOIN DashboardVehicleCheck vcb ON vcb.JadwalID = j.JadwalID AND vcb.Tipe = 'BERANGKAT'
      LEFT JOIN DashboardVehicleCheck vcd ON vcd.JadwalID = j.JadwalID AND vcd.Tipe = 'DATANG'
      WHERE j.IsDeleted = 0
        -- businessDate is a 14:00 WIB rollover label — see ROLLOVER_HOUR in
        -- business-date.ts and the identical window used in
        -- pengiriman-jadwal.ts's getPengirimanBoard.
        AND j.JamJadwal >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
        AND j.JamJadwal < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
      ORDER BY j.JamJadwal
    `);

  const rows = result.recordset as {
    JadwalID: number;
    ArmadaNama: string;
    VehicleNo: string | null;
    DriverName: string | null;
    JamJadwal: Date;
    Status: "Draft" | "Terbit";
    DoVoucherNo: string | null;
    BerangkatCheckID: number | null;
    DatangCheckID: number | null;
  }[];

  const cards: SatpamInspectionCard[] = [];
  for (const r of rows) {
    cards.push({
      jadwalId: r.JadwalID,
      armadaNama: r.ArmadaNama,
      vehicleNo: r.VehicleNo,
      driverName: r.DriverName,
      jamJadwal: r.JamJadwal.toISOString(),
      doVoucherNo: r.DoVoucherNo,
      status: r.Status,
      tipe: "BERANGKAT",
      hasCheck: r.BerangkatCheckID != null,
    });
    if (r.Status === "Terbit" && r.BerangkatCheckID != null) {
      cards.push({
        jadwalId: r.JadwalID,
        armadaNama: r.ArmadaNama,
        vehicleNo: r.VehicleNo,
        driverName: r.DriverName,
        jamJadwal: r.JamJadwal.toISOString(),
        doVoucherNo: r.DoVoucherNo,
        status: r.Status,
        tipe: "DATANG",
        hasCheck: r.DatangCheckID != null,
      });
    }
  }

  return cards.filter((c) => !c.hasCheck);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/satpam-inspection.ts` — expect 0 errors.

- [ ] **Step 3: Live-verify against real data**

Write a throwaway `npx tsx -r dotenv/config` script (async `main()`, deleted after running — this project's one-off scripts need `-r dotenv/config` to load the Postgres directory env vars) that calls `getSatpamInspectionList` with today's real `businessDate` (use `getBusinessDateISO()` from `src/lib/business-date.ts`) and prints the result. Cross-check a couple of rows by hand against direct `DashboardPengirimanJadwal`/`DashboardVehicleCheck` queries: confirm a real `Status: 'Draft'` Jadwal appears with `tipe: "BERANGKAT"`, and confirm a Jadwal that already has a real `DashboardVehicleCheck` row for `BERANGKAT` does NOT appear with `tipe: "BERANGKAT"` in the results (filtered out correctly).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/satpam-inspection.ts
git commit -m "Add getSatpamInspectionList query for Satpam mobile home screen"
```

---

## Task 3: Screen 1 — Beranda Inspeksi Pengiriman

**Files:**
- Create: `src/app/satpam-app/page.tsx`
- Create: `src/components/satpam-app/beranda-client.tsx`

**Interfaces:**
- Consumes: `requireSatpam` (Task 1), `getSatpamInspectionList`/`SatpamInspectionCard` (Task 2), `getBusinessDateISO` (existing, `src/lib/business-date.ts`).

- [ ] **Step 1: Write the page (Server Component)**

```tsx
import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { SatpamBerandaClient } from "@/components/satpam-app/beranda-client";

export default async function SatpamBerandaPage() {
  await requireSatpam();
  const cards = await getSatpamInspectionList(getBusinessDateISO());
  return <SatpamBerandaClient cards={cards} />;
}
```

- [ ] **Step 2: Write the client component**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatTime } from "@/lib/format";
import type { SatpamInspectionCard } from "@/lib/queries/satpam-inspection";

function InspectionCard({ card }: { card: SatpamInspectionCard }) {
  const router = useRouter();
  const ready = card.status === "Terbit";

  return (
    <Card className={`flex flex-row overflow-hidden p-0 ${ready ? "border-warning/40" : ""}`}>
      <div className={`w-2 shrink-0 ${ready ? "bg-warning" : "bg-border"}`} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-display text-lg font-semibold leading-tight">
              {card.armadaNama}
              {card.vehicleNo && card.vehicleNo !== card.armadaNama ? ` — ${card.vehicleNo}` : ""}
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <User className="size-4" /> {card.driverName ?? "Belum ada driver"}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-2 py-1 font-mono text-sm">
            <Clock className="size-3.5" /> {formatTime(card.jamJadwal)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span className="font-mono text-sm">{card.doVoucherNo ?? "Belum ada DO"}</span>
          {ready ? (
            <Button
              size="sm"
              className="bg-warning text-warning-foreground hover:bg-warning/90"
              onClick={() => router.push(`/satpam-app/inspeksi/${card.jadwalId}?tipe=${card.tipe}`)}
            >
              Inspeksi
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>
              Proses Muat
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function SatpamBerandaClient({ cards }: { cards: SatpamInspectionCard[] }) {
  const [tab, setTab] = useState<"BERANGKAT" | "DATANG">("BERANGKAT");
  const filtered = cards.filter((c) => c.tipe === tab);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b bg-background px-4 py-3">
        <h1 className="font-display text-xl font-bold">Inspeksi Pengiriman</h1>
      </header>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "BERANGKAT" | "DATANG")} className="flex-1">
        <div className="px-4 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="BERANGKAT" className="flex-1">
              Keberangkatan
            </TabsTrigger>
            <TabsTrigger value="DATANG" className="flex-1">
              Kedatangan
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value={tab} className="flex flex-col gap-3 px-4 py-4">
          <p className="text-sm text-muted-foreground">Menunggu Inspeksi ({filtered.length})</p>
          {filtered.map((c) => (
            <InspectionCard key={`${c.jadwalId}-${c.tipe}`} card={c} />
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">Tidak ada yang perlu diinspeksi.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

Note: `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` in this project are `@base-ui/react/tabs`-backed (`src/components/ui/tabs.tsx`), not Radix — already confirmed the `value`/`onValueChange` prop names match what's used above (verified directly against `node_modules/@base-ui/react/tabs/root/TabsRoot.d.ts` before this plan was written), so no API surprises expected here.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/app/satpam-app/page.tsx src/components/satpam-app/beranda-client.tsx` — expect 0 errors.
Run: `npm run build` — expect success (if it fails on a stale `.next/dev/types` artifact, a known Turbopack cache-staleness issue seen earlier in this project, run `rm -rf .next` and rebuild first).

- [ ] **Step 4: Live-verify**

Open `/satpam-app` in the browser as a Satpam session (never enter credentials yourself — this project's dev server may already have an authenticated session). Confirm: no dashboard sidebar/topbar chrome around this page; tabs switch between Keberangkatan/Kedatangan; cards show real armada/driver/time/DO data matching what the desktop Papan Pengiriman shows for the same Jadwal; a Draft Jadwal shows a disabled "Proses Muat" button; a Terbit Jadwal with no check yet shows an enabled amber "Inspeksi" button; tapping it navigates to `/satpam-app/inspeksi/[jadwalId]?tipe=...` (this route doesn't exist yet until Task 5 lands — a 404 here is expected and fine for this task). Also confirm a non-Satpam session gets redirected to `/akses-ditolak` when visiting `/satpam-app` directly.

- [ ] **Step 5: Commit**

```bash
git add src/app/satpam-app/page.tsx src/components/satpam-app/beranda-client.tsx
git commit -m "Add Satpam mobile app home screen (Beranda Inspeksi Pengiriman)"
```

---

## Task 4: Extract `useLiveCameraCapture` hook, refactor `LiveCameraCaptureField`

**Files:**
- Create: `src/hooks/use-live-camera-capture.ts`
- Modify: `src/components/dashboard/live-camera-capture-field.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface UseLiveCameraCaptureOptions {
    label: string;
    photoUrl: string | null;
    active: boolean;
    disabled?: boolean;
    onCapture: (file: File) => void;
  }
  export interface UseLiveCameraCaptureResult {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    displayedPhotoUrl: string | null;
    showLive: boolean;
    error: string | null;
    retry: () => void;
    handleTap: () => void;
  }
  export function useLiveCameraCapture(options: UseLiveCameraCaptureOptions): UseLiveCameraCaptureResult
  ```
  Task 5's full-screen mobile capture UI consumes this directly (one hook
  instance per currently-active photo slot, remounted via `key` when the
  active slot changes — see Task 5).

**This task carries real regression risk** — it moves already-shipped,
already-reviewed logic (capture, retake, the double-tap guard, the
retake-reset-on-inactive fix) into a new file, and the desktop component
must come out byte-for-byte behaviorally identical.

- [ ] **Step 1: Write the hook**

The hook is the *exact* current logic from `live-camera-capture-field.tsx`
(the version as of this plan, including this session's `capturingRef`
double-tap guard and the `retaking`-reset-on-`active`-false fix), with the
`size`/`onTogglePress` concepts removed — those are `LiveCameraCaptureField`-specific
(a toggle box that swaps which target is "main"), not part of the
capture logic itself.

```ts
"use client";

import { useEffect, useRef, useState } from "react";

export interface UseLiveCameraCaptureOptions {
  label: string;
  photoUrl: string | null;
  active: boolean;
  disabled?: boolean;
  onCapture: (file: File) => void;
}

export interface UseLiveCameraCaptureResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  displayedPhotoUrl: string | null;
  showLive: boolean;
  error: string | null;
  retry: () => void;
  handleTap: () => void;
}

export function useLiveCameraCapture({
  label,
  photoUrl,
  active,
  disabled,
  onCapture,
}: UseLiveCameraCaptureOptions): UseLiveCameraCaptureResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const localPreviewUrlRef = useRef<string | null>(null);
  const [retaking, setRetaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    localPreviewUrlRef.current = localPreviewUrl;
  });

  useEffect(() => {
    return () => {
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!active) setRetaking(false);
  }, [active]);

  const displayedPhotoUrl = retaking ? null : (localPreviewUrl ?? photoUrl);
  const showLive = active && !disabled && displayedPhotoUrl == null;

  useEffect(() => {
    if (!showLive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        if (!cancelled) setError("Izin kamera diperlukan untuk mengambil foto.");
      });
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [showLive, retryCount]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || capturingRef.current) return;
    capturingRef.current = true;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      capturingRef.current = false;
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        capturingRef.current = false;
        if (!blob) return;
        setLocalPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setRetaking(false);
        const file = new File([blob], `${label}.jpg`, { type: "image/jpeg" });
        onCapture(file);
      },
      "image/jpeg",
      0.9
    );
  }

  function handleTap() {
    if (disabled) return;
    if (displayedPhotoUrl != null) {
      setRetaking(true);
      return;
    }
    if (showLive) {
      if (capturingRef.current) return;
      handleCapture();
    }
  }

  function retry() {
    setError(null);
    setRetryCount((c) => c + 1);
  }

  return { videoRef, displayedPhotoUrl, showLive, error, retry, handleTap };
}
```

- [ ] **Step 2: Refactor `LiveCameraCaptureField` to consume the hook**

Replace the entire file with:

```tsx
"use client";

import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLiveCameraCapture } from "@/hooks/use-live-camera-capture";

export function LiveCameraCaptureField({
  label,
  photoUrl,
  size,
  onCapture,
  onTogglePress,
  active,
  disabled,
}: {
  label: string;
  photoUrl: string | null;
  size: "main" | "toggle";
  onCapture: (file: File) => void;
  onTogglePress?: () => void;
  active: boolean;
  disabled?: boolean;
}) {
  const { videoRef, displayedPhotoUrl, showLive, error, retry, handleTap } = useLiveCameraCapture({
    label,
    photoUrl,
    active: size === "main" && active,
    disabled,
    onCapture,
  });

  function handleAreaClick() {
    if (disabled) return;
    if (size === "toggle") {
      onTogglePress?.();
      return;
    }
    handleTap();
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={handleAreaClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleAreaClick();
        }
      }}
      aria-label={label}
      className={cn(
        "relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border bg-muted/30 text-xs",
        size === "main" ? "h-full w-full" : "h-20 w-20 shrink-0",
        disabled && "pointer-events-none cursor-not-allowed opacity-50"
      )}
    >
      {displayedPhotoUrl != null ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL or uploaded path, not a static build asset
        <img src={displayedPhotoUrl} alt={label} className="h-full w-full object-cover" />
      ) : showLive ? (
        error ? (
          <div className="flex flex-col items-center gap-1 p-2 text-center text-[10px] text-destructive">
            <span>Izin kamera diperlukan untuk mengambil foto.</span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                retry();
              }}
            >
              Coba Lagi
            </Button>
          </div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        )
      ) : (
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <Camera className="size-5" style={{ transform: "rotate(15deg)" }} />
          <span className="px-1 text-center leading-tight">{label}</span>
        </div>
      )}
    </div>
  );
}
```

Note this is deliberately structured so the JSX render tree is unchanged
from the pre-refactor version — only the state/logic moved into the hook.
`size === "toggle"` instances pass `active: false` into the hook (since
`size === "main" && active` is false for them), so the hook's own
`showLive` computation is `false` for them regardless of the `active` prop
— preserving the existing invariant that toggle instances never open a
camera stream.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect 0 errors project-wide.
Run: `npx eslint src/hooks/use-live-camera-capture.ts src/components/dashboard/live-camera-capture-field.tsx` — expect 0 errors.
Run: `npm run build` — expect success.

- [ ] **Step 4: Re-verify the desktop component's full existing behavior — this is the real test for this task**

No automated test suite exists for this project. Since this refactor
touches already-shipped, already-reviewed code, re-run the SAME live
verification scenarios already proven for this component earlier this
session (reuse the `canvas.captureStream()`-based synthetic `getUserMedia`
patch technique, since the Browser pane sandbox blocks real camera
hardware):

1. Open the real Validasi Rute → Cek Keamanan Kendaraan flow (a real
   Terbit Jadwal). Confirm live video renders for the active main slot,
   tap captures a frame, tap again retakes, a new capture replaces the old
   one.
2. Confirm a toggle-size instance (e.g. the Kabin/Muatan toggle box) never
   shows a live feed or fires `onCapture`, only ever swaps which target is
   "main" — regardless of whether it already has a captured photo.
3. Confirm the double-tap re-entrancy guard still holds: two rapid taps on
   a live capture area produce exactly one captured photo, not two.
4. Confirm the retake-reset-on-inactive fix still holds: capture a photo,
   tap it to retake (live video reopens), navigate the cube to a different
   side WITHOUT capturing a replacement, then navigate back — confirm the
   original photo is shown again (not a false "not captured" state, and no
   unprompted camera reopen).
5. Confirm the permission-denied error path (or the synthetic-stream
   patch's error path if you force one) still shows the error message +
   "Coba Lagi" button, and retry re-invokes `getUserMedia`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-live-camera-capture.ts src/components/dashboard/live-camera-capture-field.tsx
git commit -m "Extract useLiveCameraCapture hook from LiveCameraCaptureField"
```

---

## Task 5: Screen 2 — Live Inspeksi Kendaraan

**Files:**
- Create: `src/app/satpam-app/inspeksi/[jadwalId]/page.tsx`
- Create: `src/components/satpam-app/live-inspeksi-client.tsx`

**Interfaces:**
- Consumes: `requireSatpam` (Task 1), `useLiveCameraCapture` (Task 4),
  `getJadwalDetail` (existing, `src/lib/queries/pengiriman-jadwal.ts`),
  `createVehicleCheckAction` (existing, `src/app/(dashboard)/delivery/actions.ts`),
  `JENIS_FOTO_LIST`/`JENIS_FOTO_LABEL`/`FUEL_BAR_MAX`/`FuelBar`/`JenisFotoKendaraan`/`VehicleCheckTipe`
  (existing, `src/lib/vehicle-check-types.ts`).

- [ ] **Step 1: Write the page (Server Component)**

```tsx
import { notFound } from "next/navigation";
import { requireSatpam } from "@/lib/require-access";
import { getJadwalDetail } from "@/lib/queries/pengiriman-jadwal";
import { getPool, sql } from "@/lib/db";
import { LiveInspeksiClient } from "@/components/satpam-app/live-inspeksi-client";
import type { VehicleCheckTipe } from "@/lib/vehicle-check-types";

export default async function LiveInspeksiPage({
  params,
  searchParams,
}: {
  params: Promise<{ jadwalId: string }>;
  searchParams: Promise<{ tipe?: string }>;
}) {
  await requireSatpam();
  const { jadwalId: jadwalIdParam } = await params;
  const { tipe: tipeParam } = await searchParams;
  const jadwalId = Number(jadwalIdParam);
  const tipe: VehicleCheckTipe = tipeParam === "DATANG" ? "DATANG" : "BERANGKAT";
  if (!Number.isInteger(jadwalId)) notFound();

  const pool = await getPool();
  const headerResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT j.ArmadaID, a.Nama AS ArmadaNama, ISNULL(ed.VehicleNo, a.Nama) AS VehicleNo, sm.Name AS DriverName
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      WHERE j.JadwalID = @jadwalId AND j.IsDeleted = 0
    `);
  const header = headerResult.recordset[0] as
    | { ArmadaID: number; ArmadaNama: string; VehicleNo: string | null; DriverName: string | null }
    | undefined;
  if (!header) notFound();

  const stops = await getJadwalDetail(jadwalId);
  const expectedMuatanQty = stops.reduce((sum, s) => sum + s.Qty, 0);

  return (
    <div className="dark">
      <LiveInspeksiClient
        jadwalId={jadwalId}
        armadaId={header.ArmadaID}
        tipe={tipe}
        armadaNama={header.ArmadaNama}
        vehicleNo={header.VehicleNo}
        driverName={header.DriverName}
        expectedMuatanQty={expectedMuatanQty}
      />
    </div>
  );
}
```

The `dark` class forces this route's Tailwind dark-variant tokens on
regardless of the visitor's system color-scheme preference — per the spec,
this screen is always dark. The client component below is written entirely
against this project's existing semantic tokens (`bg-background`,
`text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`,
`bg-warning`/`text-warning-foreground`), never hardcoded hex or literal
`black`/`white` Tailwind utilities, so that forcing `dark` here actually
does something and stays consistent with the rest of the app's dark mode
instead of introducing a fourth one-off palette. The one deliberate
exception is the full-screen camera scrim, which sits directly on top of
live `<video>` pixels, not a themed surface — `bg-black` there is compositing
against video, not styling a panel, so it stays literal.

- [ ] **Step 2: Write the client component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, HelpCircle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLiveCameraCapture } from "@/hooks/use-live-camera-capture";
import { createVehicleCheckAction } from "@/app/(dashboard)/delivery/actions";
import {
  JENIS_FOTO_LIST,
  JENIS_FOTO_LABEL,
  FUEL_BAR_MAX,
  type VehicleCheckTipe,
  type FuelBar,
  type JenisFotoKendaraan,
  type VehicleCheckPhoto,
} from "@/lib/vehicle-check-types";

const TIPE_LABEL: Record<VehicleCheckTipe, string> = { BERANGKAT: "Kendaraan Berangkat", DATANG: "Kendaraan Tiba" };

async function uploadPhoto(file: File, jenisFoto: JenisFotoKendaraan, armadaId: number): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("armadaId", String(armadaId));
  formData.append("jenisFoto", jenisFoto);
  const res = await fetch("/api/upload/satpam-check", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto.");
  return data.path;
}

function ActiveSlotView({
  jenisFoto,
  photoUrl,
  disabled,
  onCapture,
}: {
  jenisFoto: JenisFotoKendaraan;
  photoUrl: string | null;
  disabled: boolean;
  onCapture: (file: File) => void;
}) {
  const { videoRef, displayedPhotoUrl, showLive, error, retry, handleTap } = useLiveCameraCapture({
    label: JENIS_FOTO_LABEL[jenisFoto],
    photoUrl,
    active: true,
    disabled,
    onCapture,
  });

  return (
    <div className="absolute inset-0" onClick={handleTap}>
      {displayedPhotoUrl != null ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL or uploaded path
        <img src={displayedPhotoUrl} alt={JENIS_FOTO_LABEL[jenisFoto]} className="h-full w-full object-cover" />
      ) : showLive ? (
        error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-black px-6 text-center text-white">
            <p className="text-sm">{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="border-white/40 text-white"
              onClick={(e) => {
                e.stopPropagation();
                retry();
              }}
            >
              Coba Lagi
            </Button>
          </div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        )
      ) : (
        <div className="h-full w-full bg-black" />
      )}
    </div>
  );
}

function FuelBarSelector({ value, onChange }: { value: FuelBar; onChange: (v: FuelBar) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fuelmeter (/{FUEL_BAR_MAX})</span>
      <div className="flex h-8 gap-1">
        <button
          type="button"
          onClick={() => onChange(0)}
          className={cn(
            "flex w-8 items-center justify-center rounded-l-xl border text-[10px] font-bold transition-colors",
            value === 0 ? "border-warning bg-warning text-black" : "border-border bg-muted/20 text-muted-foreground"
          )}
        >
          E
        </button>
        {([1, 2, 3, 4] as FuelBar[]).map((bar) => (
          <button
            key={bar}
            type="button"
            onClick={() => onChange(bar)}
            className={cn(
              "flex-1 border transition-colors last:rounded-r-xl",
              bar <= value ? "border-warning bg-warning" : "border-border bg-muted/20"
            )}
            aria-label={`${bar} bar`}
          />
        ))}
      </div>
    </div>
  );
}

export function LiveInspeksiClient({
  jadwalId,
  armadaId,
  tipe,
  armadaNama,
  vehicleNo,
  driverName,
  expectedMuatanQty,
}: {
  jadwalId: number;
  armadaId: number;
  tipe: VehicleCheckTipe;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  expectedMuatanQty: number;
}) {
  const router = useRouter();
  const [activeSlot, setActiveSlot] = useState<JenisFotoKendaraan>("DEPAN");
  const [photos, setPhotos] = useState<Partial<Record<JenisFotoKendaraan, string>>>({});
  const [uploading, setUploading] = useState<JenisFotoKendaraan | null>(null);
  const [odometerKM, setOdometerKM] = useState("");
  const [fuelBar, setFuelBar] = useState<FuelBar>(2);
  const [muatanQty, setMuatanQty] = useState<number | null>(null);
  const [showMuatanDialog, setShowMuatanDialog] = useState(false);
  const [manualMuatanInput, setManualMuatanInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleCapture(file: File, jenisFoto: JenisFotoKendaraan) {
    setError(null);
    setUploading(jenisFoto);
    try {
      const path = await uploadPhoto(file, jenisFoto, armadaId);
      setPhotos((prev) => ({ ...prev, [jenisFoto]: path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setUploading(null);
    }
  }

  const allPhotosReady = JENIS_FOTO_LIST.every((j) => photos[j] != null);
  const canSubmit = allPhotosReady && Number(odometerKM) > 0 && muatanQty != null && !pending;

  function handleSubmit() {
    if (!canSubmit || muatanQty == null) return;
    setError(null);
    startTransition(async () => {
      try {
        const photoList: VehicleCheckPhoto[] = JENIS_FOTO_LIST.map((jenisFoto) => ({
          jenisFoto,
          filePath: photos[jenisFoto] as string,
        }));
        await createVehicleCheckAction({ jadwalId, tipe, odometerKM: Number(odometerKM), fuelBar, muatanQty, photos: photoList });
        router.push("/satpam-app");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan inspeksi.");
      }
    });
  }

  const photosDone = JENIS_FOTO_LIST.filter((j) => photos[j] != null).length;

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-foreground">
      <ActiveSlotView
        jenisFoto={activeSlot}
        photoUrl={photos[activeSlot] ?? null}
        disabled={uploading != null || pending}
        onCapture={(file) => handleCapture(file, activeSlot)}
      />

      {/* Top bar — sits directly on the live camera feed, so its scrim stays
          literal black/transparent (compositing against video pixels, not a
          themed surface); text/icons use the forced-dark foreground token. */}
      <div className="relative z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4">
        <Button size="icon" variant="ghost" className="rounded-full bg-black/40 text-foreground" onClick={() => router.back()}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex flex-col items-center">
          <p className="font-display text-lg font-bold">Inspeksi Kendaraan</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">
            {armadaNama}
            {vehicleNo && vehicleNo !== armadaNama ? ` - ${vehicleNo}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">Driver: {driverName ?? "-"}</p>
        </div>
        <Button size="icon" variant="ghost" className="rounded-full bg-black/40 text-foreground">
          <HelpCircle className="size-5" />
        </Button>
      </div>

      {/* Status pill */}
      <div className="relative z-10 mx-4 flex items-center justify-between rounded-full bg-black/40 px-4 py-2 text-xs">
        <span className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-warning" /> LIVE VIEW
        </span>
        <span className="font-mono font-bold">
          {photosDone}/{JENIS_FOTO_LIST.length} SELESAI
        </span>
      </div>

      <div className="flex-1" />

      {/* Bottom sheet — a real themed surface (not overlaying video), so it
          uses this project's existing card/border/muted tokens like every
          other dark-mode panel in the app. */}
      <div className="relative z-10 rounded-t-3xl border-t border-border bg-card/90 px-4 pb-4 pt-6 backdrop-blur-md">
        <p className="mb-3 font-display text-base font-semibold">Data Kendaraan</p>
        <div className="mb-4 grid grid-cols-6 gap-2">
          {JENIS_FOTO_LIST.map((j) => (
            <button
              key={j}
              type="button"
              onClick={() => setActiveSlot(j)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-1",
                j === activeSlot ? "border-warning bg-warning/10" : "border-border bg-muted/30"
              )}
            >
              <div className="aspect-square w-full overflow-hidden rounded bg-muted/50">
                {photos[j] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- uploaded path, not a static build asset
                  <img src={photos[j]} alt={JENIS_FOTO_LABEL[j]} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <span className={cn("text-[9px] font-bold uppercase", j === activeSlot ? "text-warning" : "text-muted-foreground")}>
                {JENIS_FOTO_LABEL[j]}
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Odometer (KM)</label>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="Mis. 45020"
              value={odometerKM}
              onChange={(e) => setOdometerKM(e.target.value)}
              className="border-border bg-muted/20 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <FuelBarSelector value={fuelBar} onChange={setFuelBar} />
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </div>

      {/* Sticky footer */}
      <div className="relative z-10 border-t border-border bg-background p-4">
        <Button
          className="h-14 w-full gap-2 bg-warning font-display text-base text-black hover:bg-warning/90 disabled:bg-muted disabled:text-muted-foreground"
          disabled={!allPhotosReady || !(Number(odometerKM) > 0)}
          onClick={() => {
            if (muatanQty == null) {
              setShowMuatanDialog(true);
              return;
            }
            handleSubmit();
          }}
        >
          <Truck className="size-5" />
          {pending ? "Menyimpan..." : TIPE_LABEL[tipe]}
        </Button>
      </div>

      <Dialog open={showMuatanDialog} onOpenChange={setShowMuatanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Muatan sudah sesuai?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Total muatan seharusnya: <strong>{expectedMuatanQty}</strong> koli.
          </p>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Jumlah koli sebenarnya"
            value={manualMuatanInput}
            onChange={(e) => setManualMuatanInput(e.target.value)}
            className="hidden data-[show=true]:block"
            data-show={manualMuatanInput !== "__hidden__"}
          />
          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                const manual = Number(manualMuatanInput);
                if (!(manual >= 0)) return;
                setMuatanQty(manual);
                setShowMuatanDialog(false);
              }}
            >
              Tidak, catat manual
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                setMuatanQty(expectedMuatanQty);
                setShowMuatanDialog(false);
              }}
            >
              Ya, sesuai
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

The muatan-confirmation dialog's exact layout (whether the manual input is
always visible or only appears after tapping "Tidak" once) is left to your
judgment during live verification — the logic above (Ya sets `muatanQty`
straight from `expectedMuatanQty`; Tidak requires the manual input `>= 0`
before it's accepted) is what must hold, not the precise two-tap-vs-one-tap
interaction shape. If you simplify the dialog's structure, keep both
outcomes reachable and keep `muatanQty` `null` until one of them commits a
value (the submit button must stay conceptually gated on a confirmed
number, not fire the dialog and immediately assume success).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect 0 errors project-wide.
Run: `npx eslint src/app/satpam-app/inspeksi/[jadwalId]/page.tsx src/components/satpam-app/live-inspeksi-client.tsx` — expect 0 errors.
Run: `npm run build` — expect success.

- [ ] **Step 4: Live-verify end-to-end**

Using the same `canvas.captureStream()`-based synthetic `getUserMedia`
patch technique already proven earlier this session (the Browser pane
sandbox blocks real camera hardware): navigate from Screen 1's "Inspeksi"
button on a real Terbit Jadwal into this screen. Confirm:
1. Live video renders full-screen for the Depan slot by default.
2. Tapping the shutter/video area captures a photo; tapping a captured
   photo retakes it.
3. Tapping a different slot in the bottom grid switches the full-screen
   view to that slot's live feed (or its captured photo if already taken)
   — confirm this doesn't leak a stale photo from the previously-active
   slot (same class of bug fixed earlier this session for the desktop
   toggle — verify it doesn't recur here).
4. Odometer input and Fuel Bar (including the new "E" segment) work.
5. Once all 6 photos + Odometer are filled, tapping the submit button
   opens the muatan-confirmation dialog (not a direct submit). "Ya" sets
   the count from the real computed `expectedMuatanQty` (cross-check this
   number against the real stop list total shown on the desktop board for
   the same Jadwal). "Tidak" requires a manual number before proceeding.
6. After confirming muatan, the submit button becomes clickable and
   actually calls `createVehicleCheckAction` — confirm a real
   `DashboardVehicleCheck` row gets created (query the DB directly) with
   the correct `muatanQty`, then confirm Screen 1 no longer lists this
   Jadwal+Tipe once you navigate back.
7. Same data-safety discipline as every other task this session: this
   WILL create one real permanent `DashboardVehicleCheck` row — expected
   and consistent with established practice, not something to avoid or
   fake.

- [ ] **Step 5: Commit**

```bash
git add "src/app/satpam-app/inspeksi/[jadwalId]/page.tsx" src/components/satpam-app/live-inspeksi-client.tsx
git commit -m "Add Satpam mobile app live inspection screen (Live Inspeksi Kendaraan)"
```

---

## Task 6: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Re-run the full static check suite**

Run: `npx tsc --noEmit`, `npx eslint src`, `npm run build` — all three must pass clean.

- [ ] **Step 2: Confirm no leftover scratch files**

Run: `git status --short` — must be clean.

- [ ] **Step 3: End-to-end live browser walkthrough, both screens in sequence**

Open `/satpam-app` as a real Satpam session on a real Terbit Jadwal with no
existing BERANGKAT check, tap "Inspeksi", complete the full live inspection
flow (Task 5's Step 4 checklist) through to a real submitted
`DashboardVehicleCheck` row, confirm redirect back to `/satpam-app`, and
confirm that Jadwal no longer appears under "Keberangkatan" but a
"Kedatangan" entry for the same Jadwal now appears (once `Status` conditions
allow — matches the existing sequential Berangkat→Datang gate).

- [ ] **Step 4: Confirm the desktop Cek Keamanan Kendaraan flow still works unchanged**

Open the existing Validasi Rute → Cek Keamanan Kendaraan dialog on the
desktop dashboard (unrelated Jadwal) and confirm capture/retake/toggle/fuel
bar/submit all still work exactly as before — this is the regression check
for Task 4's hook extraction, re-run one more time at the whole-branch
level after everything else in this plan has landed.
