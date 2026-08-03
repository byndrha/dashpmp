# Vehicle Check Live-Camera + Layout Revision — Design Spec

**Company:** PT Mitra Kelola Esindo only. **Module:** Pengiriman (`delivery`), Satpam vehicle-check subsystem.

**Supersedes (UI details only):** `docs/superpowers/specs/2026-08-04-vehicle-check-3d-carousel-design.md`'s
`VehicleCheckDialog`/`CameraCaptureField` UI sections, after the built UI (plan
`docs/superpowers/plans/2026-08-04-vehicle-check-3d-carousel.md`, Tasks 0-6,
all implemented and reviewed clean) didn't match the user's actual
expectations. The prior spec's data model, backend query layer, server
action, `TruckCubeCarousel`'s rotation mechanism, and pop-up/dialog framing
all stand — this spec only revises photo capture and in-dialog layout.

## Goal

Two changes to the already-built `VehicleCheckDialog`:

1. Replace file-input-based photo capture (`CameraCaptureField`, which opens
   the device's native camera app via `<input type="file" capture>`) with a
   live in-page camera view the Satpam taps directly to snapshot — no native
   camera UI ever opens.
2. Redesign each cube face's internal layout per the user's annotated
   feedback: a large primary capture area, a small secondary-target toggle
   (Depan⇄Kabin, Belakang⇄Muatan), and a persistent Simpan button that stays
   visible regardless of which cube side is front-facing.

## Non-goals

- No change to `DashboardVehicleCheck`'s schema, `createVehicleCheck`,
  `getVehicleChecksForJadwal`, or `createVehicleCheckAction` — `VehicleCheckPhoto[]`
  and the `onUploadPhoto(file, jenisFoto)` upload path are unchanged; this is
  a capture-UI and layout change only.
- No change to `TruckCubeCarousel`'s rotation/drag/snap mechanics — the cube
  keeps working exactly as built (Task 4), only what's rendered inside each
  face changes.
- No change to who can fill the form (`isSatpam`) or when (`Status = 'Terbit'`).
- No pre-warming of camera streams on non-front-facing cube sides — exactly
  one live stream is open at a time, matching the front-facing side's
  currently-active target. Considered and rejected as unnecessary complexity
  for a first working version.
- No desktop-specific fallback beyond the permission-denied error message —
  this feature is phone-first, filled in standing at a vehicle gate.

## Capture mechanism — `LiveCameraCaptureField` (replaces `CameraCaptureField`)

`src/components/dashboard/camera-capture-field.tsx` is deleted (no other
consumers exist). A new component,
`src/components/dashboard/live-camera-capture-field.tsx`, replaces it:

```ts
interface LiveCameraCaptureFieldProps {
  label: string;
  photoUrl: string | null;       // an already-captured photo's preview URL, if any
  size: "main" | "toggle";
  onCapture: (file: File) => void;   // used only when size === "main"
  onTogglePress?: () => void;        // used only when size === "toggle"
  active: boolean;                    // meaningful only when size === "main"
  disabled?: boolean;
}
```

**`size === "toggle"` is a pure switcher, never a capture surface.** Its own
tap handler always calls `onTogglePress` (which the parent wires to swap
`depanMainTarget`/`belakangMainTarget` — see below) and never opens a
camera stream or calls `onCapture`, regardless of `photoUrl` or `active`.
This matches the user's own description of the small box's role ("untuk
switch area utama... dan sebaliknya") — it shows the *other* target's
status (captured thumbnail, or the static placeholder icon) purely as a
preview, and tapping it always means "bring this target into the main
area," never "capture/retake right here." Only `size === "main"` instances
ever request a stream or capture/retake a photo. This resolves what would
otherwise be an ambiguity: if a toggle box already has a photo, tapping it
does NOT retake that photo in place — it swaps that target into the main
area, where the retake-by-tap rule (below) then applies.

For a `size === "main"` instance:

- **`photoUrl` set (a photo already exists for this target):** renders the
  captured image (`object-cover`, filling the area). Tapping it transitions
  back into live-view mode and immediately re-requests the camera stream,
  discarding the old preview once a new snapshot is taken — i.e., tapping an
  already-captured main area retakes it, per the user's explicit choice
  ("tap lagi langsung foto ulang").
- **`photoUrl` null and `active` true:** opens a live camera stream
  (`navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })`),
  rendered as `<video autoPlay muted playsInline>` filling the area. Tapping
  anywhere on the area draws the current video frame onto an offscreen
  `<canvas>` sized to the video's native resolution, converts it via
  `canvas.toBlob()` into a `File` (`image/jpeg`, matching the existing
  `ALLOWED_TYPES`/upload route expectations unchanged from the prior spec),
  and calls `onCapture(file)`. The stream is requested in a `useEffect` on
  mount and its tracks are stopped (`stream.getTracks().forEach(t => t.stop())`)
  on unmount — released whenever this instance stops being the active
  target (cube rotates away, or the toggle switches to the other target).
- **`photoUrl` null and `active` false:** no stream requested at all — a
  static placeholder (a camera icon, tilted ~15° for visual distinction from
  an actionable button) with `label` beneath it. This is the state for the
  toggle box's non-active target and for any target on a non-front-facing
  cube side.
- **Permission denied / `getUserMedia` unsupported / no camera device:**
  renders an inline error state ("Izin kamera diperlukan untuk mengambil
  foto.") with a "Coba Lagi" button that re-invokes `getUserMedia` on click.
  No fallback to file-input capture — the live-camera path is the only path,
  matching the user's explicit choice.
- `size="main"` and `size="toggle"` differ only in the container's
  dimensions/border-radius/font-size — same internal logic and states for both.

**Only one live stream at a time:** `active` is computed by the parent
(`CheckForm`, below) as "this target is the primary target of the currently
front-facing cube side, per `TruckCubeCarousel`'s `activeSide`, AND (for
DEPAN/BELAKANG) it's the currently-toggled-in target." Every other
`LiveCameraCaptureField` instance across the 4 faces renders with
`active={false}` and never calls `getUserMedia`, regardless of whether it's
mounted (all 4 faces stay mounted simultaneously, per `TruckCubeCarousel`'s
existing behavior — only `active` gates the stream, not mounting).

## `CheckForm` layout revision — `src/components/dashboard/vehicle-check-dialog.tsx`

Per-side content changes (only inside `CheckForm`'s `renderSideContent`;
`TruckCubeCarousel`'s own code is untouched):

- **KANAN / KIRI:** a single full-area `LiveCameraCaptureField`
  (`size="main"`, `active={activeSide === side}`) — no toggle, no other
  inputs, matching today's "single photo only" rule for these two sides.
- **DEPAN:** a new local state `depanMainTarget: "DEPAN" | "KABIN"`
  (default `"DEPAN"`). Renders:
  - A large `LiveCameraCaptureField` (`size="main"`) bound to whichever
    photo type `depanMainTarget` currently points at, `active={activeSide
    === "DEPAN"}` (the toggle only ever affects which single photo type is
    "main" — the stream itself is still gated by cube-side front-facing-ness).
  - A small `LiveCameraCaptureField` (`size="toggle"`) bound to the *other*
    photo type (whichever `depanMainTarget` isn't currently pointing at),
    always `active={false}` (the toggle box never itself opens a stream — it
    only shows a captured thumbnail or the static placeholder icon).
    Tapping the toggle box swaps `depanMainTarget`, which swaps which
    photo type is "main" (and therefore which one may open a stream, if
    `activeSide === "DEPAN"` and it has no photo yet).
  - Odometer `Input` and `FuelBarSelector` beneath the toggle box, larger
    than before per the annotation (the field logic itself — value/onChange
    /validation — is unchanged from the already-reviewed Task 5 code).
- **BELAKANG:** identical structure to DEPAN, with `belakangMainTarget:
  "BELAKANG" | "BOX_MUATAN"` (default `"BELAKANG"`) and the "Jumlah
  Koli/Unit Muatan" `Input` beneath the toggle box instead of
  Odometer/FuelBar.

**Persistent Simpan button:** moves out of `CheckForm`'s per-side render
entirely, to a single button rendered once beneath the `TruckCubeCarousel`
(sibling to it, not inside any face), always visible regardless of
`activeSide`. Its `disabled`/`onClick` logic (`canSubmit`, `handleSubmit`)
is unchanged from the already-reviewed Task 5 code — only its position in
the JSX tree moves.

**Disclaimer text removed:** the paragraph ("Foto wajib diambil langsung
dari kamera. Catatan: sebagian browser tetap menampilkan pintasan galeri...")
is deleted outright, no replacement. It no longer applies — a live
`getUserMedia` stream has no gallery-shortcut affordance the way a native
`<input capture>` UI could show one, so the caveat is moot.

## `TruckSideIllustration` redraw — `src/components/dashboard/truck-side-illustration.tsx`

The four placeholder SVGs (`DepanIllustration`, `SampingIllustration`,
`BelakangIllustration`) are redrawn with more detail and correct proportion
— still inline vector line-art (no new asset pipeline, no photo), but
depicting an actual recognizable box-truck silhouette from each viewing
angle (cab shape, wheel wells, box outline, window lines) rather than the
current bare rect/circle/line primitives. The exported interface
(`TruckSideIllustration({ side: TruckSide })`) is unchanged — only the
internal SVG paths change, so nothing that consumes this component needs to
change. Rendered more dimly than before (`text-muted-foreground/10` or
similar, down from the prior `/20`) since it now sits behind a live video
feed rather than a static empty face, and needs to recede further to avoid
visually competing with the camera view.

## Files touched

- Delete: `src/components/dashboard/camera-capture-field.tsx`
- Create: `src/components/dashboard/live-camera-capture-field.tsx`
- Modify: `src/components/dashboard/vehicle-check-dialog.tsx` (`CheckForm`
  restructure: main/toggle target state per side, persistent Simpan button,
  disclaimer removal)
- Modify: `src/components/dashboard/truck-side-illustration.tsx` (redrawn
  SVG paths only, same exported interface)
- Unchanged: `src/components/dashboard/truck-cube-carousel.tsx`,
  `src/lib/vehicle-check-types.ts`, `src/lib/queries/vehicle-check.ts`,
  `src/app/(dashboard)/delivery/actions.ts`,
  `src/components/dashboard/route-validation-dialog.tsx`,
  `src/app/api/upload/satpam-check/route.ts` — all stand as already
  implemented and reviewed in the prior plan.

## Open risk, explicitly accepted

`getUserMedia` requires a secure context (HTTPS, or `localhost` for local
dev) — this project's production deployment is already HTTPS, so this is a
theoretical, not practical, constraint, noted here for completeness rather
than as a real blocker.
