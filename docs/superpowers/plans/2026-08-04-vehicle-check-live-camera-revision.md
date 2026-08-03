# Vehicle Check Live-Camera + Layout Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `VehicleCheckDialog`'s file-input photo capture with an in-page live camera view (tap-to-snapshot, no native camera app), and redesign each cube face's layout per the user's annotated feedback: large primary capture area, a small secondary-target toggle on DEPAN/BELAKANG, and one persistent Simpan button visible regardless of which cube side faces forward.

**Architecture:** A new `LiveCameraCaptureField` component wraps `getUserMedia`/`<video>`/`<canvas>` capture behind the exact same `onCapture(file: File)` contract the old `CameraCaptureField` used, so nothing downstream (upload route, server action, `VehicleCheckRow`) changes. `CheckForm` (inside `vehicle-check-dialog.tsx`) is restructured to use it, add per-side main/toggle target state for DEPAN/BELAKANG, and reposition the Simpan button. `TruckSideIllustration`'s SVGs are redrawn with more detail. `TruckCubeCarousel`'s rotation mechanics are untouched.

**Tech Stack:** Next.js 16 (App Router, `"use client"`), React 19, TypeScript, Tailwind v4, browser `MediaDevices.getUserMedia`/`HTMLCanvasElement`.

## Global Constraints

- `onUploadPhoto(file: File, jenisFoto: JenisFotoKendaraan): Promise<string>` and `onSubmitCheck`'s input shape are unchanged — this plan is UI-only, no backend/data-model changes.
- Exactly one live camera stream open at a time: only the primary target of the currently front-facing cube side (and, for DEPAN/BELAKANG, only whichever of the two targets is currently toggled "main") ever calls `getUserMedia`. Every other instance renders a captured-photo thumbnail or a static placeholder, never a stream.
- The small toggle box (`size="toggle"`) is a pure switcher: tapping it always swaps which target is "main," and never itself opens a camera or calls `onCapture`, regardless of whether it already has a captured photo.
- Tapping an already-captured **main** area retakes it immediately (no separate retake button/icon).
- Camera permission denied / unsupported: show an inline error + "Coba Lagi" retry button. No fallback to file-input capture.
- `TruckCubeCarousel`'s own file (`src/components/dashboard/truck-cube-carousel.tsx`) is not modified by this plan — only what each face renders changes, in `vehicle-check-dialog.tsx`.
- No new npm dependency.

---

## Task 1: `LiveCameraCaptureField` component

**Files:**
- Create: `src/components/dashboard/live-camera-capture-field.tsx`

**Interfaces:**
- Produces:
  ```ts
  function LiveCameraCaptureField(props: {
    label: string;
    photoUrl: string | null;
    size: "main" | "toggle";
    onCapture: (file: File) => void;
    onTogglePress?: () => void;
    active: boolean;
    disabled?: boolean;
  }): JSX.Element
  ```
  Task 3 renders one `"main"` instance and (on DEPAN/BELAKANG) one `"toggle"` instance per cube side.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const localPreviewUrlRef = useRef<string | null>(null);
  const [retaking, setRetaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    localPreviewUrlRef.current = localPreviewUrl;
  });

  // Best-effort release of the last captured frame's object URL when this
  // field's whole lifetime ends (dialog closed) — not on every re-render,
  // only true unmount, hence the empty deps array plus the ref above to
  // read the *latest* value at that point.
  useEffect(() => {
    return () => {
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    };
  }, []);

  const displayedPhotoUrl = retaking ? null : (localPreviewUrl ?? photoUrl);
  const showLive = size === "main" && active && !disabled && displayedPhotoUrl == null;

  useEffect(() => {
    if (!showLive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }
    let cancelled = false;
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
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
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

  function handleAreaClick() {
    if (disabled) return;
    if (size === "toggle") {
      onTogglePress?.();
      return;
    }
    if (displayedPhotoUrl != null) {
      setRetaking(true);
      return;
    }
    if (showLive) {
      handleCapture();
    }
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
                setError(null);
                setRetryCount((c) => c + 1);
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

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit` — expect 0 new errors from this file.
Run: `npx eslint src/components/dashboard/live-camera-capture-field.tsx` — expect 0 errors.

- [ ] **Step 3: Live browser check**

No automated test harness exists in this project (no jest/vitest configured)
— this component needs a real camera permission prompt, so verify it
directly:

1. Create a throwaway route (no leading underscore — Next.js treats those
   as private/non-routable in this project, confirmed in an earlier task)
   such as `src/app/(dashboard)/scratch-live-camera/page.tsx` rendering
   `<LiveCameraCaptureField label="Test" photoUrl={photo} size="main"
   active onCapture={(f) => setPhoto(URL.createObjectURL(f))} />` inside a
   small client component with local `useState<string | null>(null)` for
   `photo`.
2. Open it in the browser preview, grant camera permission when prompted,
   confirm the live video feed renders and fills the area.
3. Tap the area — confirm it captures a frame and displays it as a static
   image (no more live video).
4. Tap the captured image again — confirm it goes back to live video
   (retake), then tap again — confirm a new photo replaces the old one.
5. Also render a `size="toggle"` instance with an `onTogglePress` that logs
   to the console — confirm tapping it NEVER shows a live camera feed or
   calls `onCapture`, only fires `onTogglePress`, even if it's passed a
   `photoUrl`.
6. If the browser/OS denies camera permission (or you can simulate this via
   the browser's site-settings), confirm the error message + "Coba Lagi"
   button render, and that clicking "Coba Lagi" re-prompts for permission.
7. Delete the scratch route afterward. Confirm `git status --short` is
   clean of it.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/live-camera-capture-field.tsx
git commit -m "Add LiveCameraCaptureField: in-page camera capture via getUserMedia"
```

---

## Task 2: Redraw `TruckSideIllustration`

**Files:**
- Modify: `src/components/dashboard/truck-side-illustration.tsx` (full rewrite of the three internal SVG components; exported interface unchanged)

**Interfaces:**
- No change to `TruckSideIllustration({ side: TruckSide }): JSX.Element` — same signature Task 3 (and the existing `vehicle-check-dialog.tsx`) already consumes.

- [ ] **Step 1: Replace the three illustration components**

```tsx
import type { TruckSide } from "@/lib/vehicle-check-types";

// Placeholder line-art per truck side — not a real vehicle photo. Redrawn
// with more detail/proportion than the original bare-primitive version, per
// user feedback on the built UI. Swapping these for real illustrations or
// reference photos later is a pure asset change: the carousel only ever
// consumes a ReactNode per side.

function DepanIllustration() {
  return (
    <svg
      viewBox="0 0 140 100"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M28 34 h84 a8 8 0 0 1 8 8 v28 h-100 v-28 a8 8 0 0 1 8 -8 z" />
      <rect x="40" y="40" width="60" height="22" rx="3" />
      <line x1="70" y1="40" x2="70" y2="62" />
      <rect x="52" y="66" width="36" height="10" rx="2" />
      <line x1="52" y1="71" x2="88" y2="71" />
      <rect x="30" y="66" width="14" height="8" rx="2" />
      <rect x="96" y="66" width="14" height="8" rx="2" />
      <line x1="24" y1="80" x2="116" y2="80" />
      <circle cx="42" cy="86" r="10" />
      <circle cx="42" cy="86" r="4" />
      <circle cx="98" cy="86" r="10" />
      <circle cx="98" cy="86" r="4" />
    </svg>
  );
}

function SampingIllustration({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 220 100"
      className="h-full w-full"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M10 46 h34 v-16 a4 4 0 0 1 4 -4 h10 a4 4 0 0 1 4 4 v16 h4 v34 h-56 z" />
      <rect x="20" y="34" width="22" height="14" rx="2" />
      <rect x="66" y="20" width="140" height="60" rx="4" />
      <line x1="100" y1="20" x2="100" y2="80" />
      <line x1="140" y1="20" x2="140" y2="80" />
      <line x1="180" y1="20" x2="180" y2="80" />
      <line x1="10" y1="80" x2="206" y2="80" />
      <circle cx="34" cy="86" r="10" />
      <circle cx="34" cy="86" r="4" />
      <circle cx="150" cy="86" r="10" />
      <circle cx="150" cy="86" r="4" />
      <circle cx="182" cy="86" r="10" />
      <circle cx="182" cy="86" r="4" />
    </svg>
  );
}

function BelakangIllustration() {
  return (
    <svg
      viewBox="0 0 140 100"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <rect x="22" y="14" width="96" height="66" rx="4" />
      <line x1="70" y1="14" x2="70" y2="80" />
      <rect x="30" y="24" width="32" height="46" rx="2" />
      <rect x="78" y="24" width="32" height="46" rx="2" />
      <line x1="62" y1="46" x2="66" y2="46" />
      <line x1="74" y1="46" x2="78" y2="46" />
      <rect x="22" y="60" width="8" height="14" rx="2" />
      <rect x="110" y="60" width="8" height="14" rx="2" />
      <line x1="18" y1="84" x2="122" y2="84" />
      <circle cx="42" cy="90" r="10" />
      <circle cx="42" cy="90" r="4" />
      <circle cx="98" cy="90" r="10" />
      <circle cx="98" cy="90" r="4" />
    </svg>
  );
}

export function TruckSideIllustration({ side }: { side: TruckSide }) {
  if (side === "DEPAN") return <DepanIllustration />;
  if (side === "BELAKANG") return <BelakangIllustration />;
  return <SampingIllustration flip={side === "KIRI"} />;
}
```

- [ ] **Step 2: Verify and eyeball the result**

Run: `npx tsc --noEmit` and `npx eslint src/components/dashboard/truck-side-illustration.tsx` — expect 0 errors from this file.

This is a visual asset — render all 4 sides in the browser (the existing
`VehicleCheckDialog`, once Task 3 lands, is the real place to see it in
context; if you want an earlier look, a throwaway scratch route works the
same way as Task 1's Step 3, deleted afterward) and confirm each side now
reads as a recognizable box-truck silhouette (cab + box distinction on the
side view, split rear doors on the back view, grille/headlights on the
front view) rather than bare rectangles. If a proportion looks visibly off
once you see it rendered, adjust the coordinates — the exact numbers above
are a reasonable starting point, not a pixel-perfect mandate.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/truck-side-illustration.tsx
git commit -m "Redraw truck-side illustrations with more detail and proportion"
```

---

## Task 3: `CheckForm` rewrite — live camera + toggle layout + persistent Simpan

**Files:**
- Modify: `src/components/dashboard/vehicle-check-dialog.tsx` (imports, `CheckForm` full rewrite)
- Delete: `src/components/dashboard/camera-capture-field.tsx` (fully superseded, no other consumers)

**Interfaces:**
- Consumes: `LiveCameraCaptureField` (Task 1), `TruckSideIllustration` (Task 2, same signature).
- No change to `VehicleCheckDialog`'s own exported signature, `CheckSummary`, or `FuelBarSelector` — only `CheckForm`'s internals and the import list change.

- [ ] **Step 1: Update the import**

Replace:

```ts
import { CameraCaptureField } from "@/components/dashboard/camera-capture-field";
```

with:

```ts
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
```

- [ ] **Step 2: Replace `CheckForm` in full**

```tsx
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
  const [depanMainTarget, setDepanMainTarget] = useState<JenisFotoKendaraan>("DEPAN");
  const [belakangMainTarget, setBelakangMainTarget] = useState<JenisFotoKendaraan>("BELAKANG");
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
    const mainTarget = side === "DEPAN" ? depanMainTarget : side === "BELAKANG" ? belakangMainTarget : primary;
    const toggleTarget = secondary ? (mainTarget === primary ? secondary : primary) : null;
    const setMainTarget = side === "DEPAN" ? setDepanMainTarget : setBelakangMainTarget;

    return (
      <div className="relative flex h-full w-full flex-col gap-2 p-2">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-muted-foreground/10">
          <TruckSideIllustration side={side} />
        </div>
        <div className="relative flex min-h-0 flex-1 gap-2">
          <LiveCameraCaptureField
            label={JENIS_FOTO_LABEL[mainTarget]}
            photoUrl={photos[mainTarget] ?? null}
            size="main"
            active={activeSide === side}
            disabled={uploading != null || pending}
            onCapture={(file) => handleCapture(file, mainTarget)}
          />
          {toggleTarget && (
            <LiveCameraCaptureField
              label={JENIS_FOTO_LABEL[toggleTarget]}
              photoUrl={photos[toggleTarget] ?? null}
              size="toggle"
              active={false}
              disabled={uploading != null || pending}
              onCapture={() => {}}
              onTogglePress={() => setMainTarget(toggleTarget)}
            />
          )}
        </div>
        {side === "DEPAN" && (
          <div className="relative flex w-full flex-col gap-2">
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
            className="relative"
          />
        )}
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
      <div className="flex justify-end">
        <Button
          size="lg"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="bg-emerald-600 px-6 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50 disabled:text-white/70"
        >
          {pending ? "Menyimpan..." : `Simpan ${TIPE_LABEL[tipe]}`}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

Note what's deliberately removed from the old version: the closing
disclaimer paragraph ("Foto wajib diambil langsung dari kamera...") is
gone entirely, per the user's explicit request — no replacement text. The
`Button`'s `size="sm"` became `size="lg"` with an emerald color override
and moved into a `flex justify-end` wrapper (right-aligned, bigger, green)
— it was already rendered once beneath `TruckCubeCarousel` rather than
per-side, so it was already visible regardless of `activeSide`; this change
is a styling/positioning pass on an already-persistent element, not a
structural relocation.

`CheckSummary` and `FuelBarSelector` (the two other functions in this file)
are unchanged — only `CheckForm` and the import list change.

- [ ] **Step 3: Delete the superseded component**

Delete `src/components/dashboard/camera-capture-field.tsx`. Confirm nothing
else imports it: `grep -rn "camera-capture-field" src/` should return
nothing once this task is done.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expect 0 errors project-wide.
Run: `npx eslint src` — expect 0 errors.
Run: `npm run build` — expect success (if it fails on a stale
`.next/dev/types` artifact, a known Turbopack cache-staleness issue seen
earlier in this project, run `rm -rf .next` and rebuild first).

- [ ] **Step 5: Live browser verification**

Open the real Validasi Rute UI (a `Terbit` Jadwal, as a Satpam-privileged
session if available — never enter credentials yourself) and confirm:

1. Opening "Cek Keamanan Kendaraan" shows the cube with the new layout: a
   large camera area per side, plus a small toggle box on DEPAN/BELAKANG.
2. On DEPAN: grant camera permission, confirm live video shows in the main
   area, tap to capture "Depan," confirm the toggle box (showing "Kabin")
   still displays the rotated placeholder camera icon (no stream). Tap the
   toggle box — confirm the main area swaps to a live camera feed for
   Kabin, and the toggle box now shows the previously-captured Depan photo
   as a static thumbnail. Tap the toggle box again — confirm it swaps back,
   and the main area now shows the just-captured Kabin photo as a static
   image (not live).
3. Tap an already-captured main-area photo — confirm it goes back to live
   video (retake), capture again, confirm the new photo replaces the old
   one.
4. Repeat the same check on BELAKANG (Belakang⇄Muatan toggle).
5. Confirm KANAN and KIRI each show a single full-area live camera feed,
   with no toggle box and no odometer/fuel/muatan inputs.
6. Confirm the odometer input, Fuel Bar selector (all 5 states), and
   Jumlah Koli input all still work exactly as before (unchanged field
   logic) — just in the new layout position.
7. Confirm the "Simpan" button (bigger, green, right-aligned) stays visible
   and correctly enabled/disabled while dragging the cube through all 4
   sides — it must never disappear or move out of view regardless of
   `activeSide`.
8. Resize to a mobile viewport (~375px) and repeat the capture/toggle/retake
   checks — confirm layout and camera permission flow both still work.
9. Take a screenshot of the final DEPAN-side layout for the report — this
   is a subjective visual-match check against the user's own annotated
   feedback, and the report's screenshot is what lets the controller (and
   ultimately the user) confirm it actually matches, not just that the code
   runs.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/vehicle-check-dialog.tsx
git rm src/components/dashboard/camera-capture-field.tsx
git commit -m "Rework CheckForm: live-camera capture, main/toggle layout, persistent Simpan"
```

---

## Task 4: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Re-run the full static check suite**

Run: `npx tsc --noEmit`, `npx eslint src`, `npm run build` — all three must
pass clean with zero errors.

- [ ] **Step 2: Confirm no leftover scratch files**

Run: `git status --short` — must be clean (no stray scratch routes from
Task 1's or Task 2's live checks).

- [ ] **Step 3: End-to-end live browser walkthrough on a real Jadwal**

Repeat Task 3's Step 5 checklist (items 1-8) one more time end-to-end
against a real `Terbit` Jadwal from the dev server preview, this time
completing a full Cek Berangkat submission (all 6 photos captured via live
camera across both toggle targets on DEPAN/BELAKANG, odometer, fuel bar,
muatan qty filled in, "Simpan" clicked) to confirm the whole flow still
successfully calls `createVehicleCheckAction` and the dialog transitions to
the read-only `CheckSummary` view afterward — this exercises the full
capture-to-submit path with the new UI, not just each piece in isolation.

- [ ] **Step 4: Screenshot for user sign-off**

Take a screenshot of the DEPAN side (main camera area + toggle box +
odometer + fuel bar + Simpan button all visible) and the BELAKANG side.
Include both in the final report — this redesign was driven by the user's
own visual annotation, so the controller should relay these screenshots
back to the user for explicit confirmation rather than treating a clean
review as equivalent to "matches what they wanted to see."
