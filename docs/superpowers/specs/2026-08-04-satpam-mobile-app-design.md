# Satpam Mobile App (Jalur A) — Design Spec

**Company:** PT Mitra Kelola Esindo only. **Module:** new standalone mobile route section, built inside the existing PMPGroupAnalys Next.js project.

## Goal

A dedicated, mobile-first, full-screen experience for Satpam to do vehicle
gate inspections — two screens, based on user-supplied HTML/DESIGN.md
mockups (`beranda-inspeksi-pengiriman`, `live-inspeksi-kendaraan`),
re-implemented against this project's real shadcn component library and
design tokens rather than the mockups' literal styling. This is **Jalur
A only** — everything except automatic AI side-detection, which is a
separate, later sub-project (see Non-goals).

## Non-goals

- **AI/computer-vision side detection is explicitly out of scope for this
  spec.** The mockup's "MENDETEKSI: SISI DEPAN" label and scanning-corner
  overlay imply a real on-device ML model that recognizes which physical
  side of a truck is currently in the camera's view. The user confirmed
  this needs to be a genuinely working on-device model (not a third-party
  vision API call, for privacy/cost reasons) — and that no training data
  (photos of this company's trucks from each side) exists yet. Building
  this requires its own data-collection and model-training project before
  any integration code can even be written. Jalur A instead uses **manual
  tap-to-select** for which of the 6 photo slots is the active capture
  target — architected so Jalur B can later replace the manual tap with an
  automatic label/selection without changing anything else about the
  screen.
- No change to the existing desktop dashboard's `VehicleCheckDialog`/`CheckForm`
  (Validasi Rute's embedded Cek Keamanan Kendaraan) — this mobile app is a
  new, additional entry point for Satpam, not a replacement. Both write to
  the exact same `createVehicleCheckAction`/`DashboardVehicleCheck` backend.
- No new database tables. The one new concept (muatan confirmation) reuses
  the existing `MuatanQty` column — see below.
- No offline support — this app assumes a live network connection, same
  assumption the rest of the dashboard already makes.

## Screen 1 — Beranda Inspeksi Pengiriman

**Route:** `src/app/satpam-app/page.tsx` — a new top-level route segment,
**outside** the `(dashboard)` route group (same pattern already
established by `src/app/login/page.tsx` and `src/app/invoice/[token]/page.tsx`:
a standalone page with no sidebar/topbar dashboard chrome). Gated to
`session.user.isSatpam` — a non-Satpam session is redirected the same way
other access-gated routes in this app already handle it (see
`requireModuleAccess`/`akses-ditolak` precedent).

**Data:** a new query, `getSatpamInspectionList(businessDate: string):
Promise<SatpamInspectionCard[]>` in a new file
`src/lib/queries/satpam-inspection.ts`, returning one row per Jadwal
needing a Satpam decision today, for both `BERANGKAT` and `DATANG` in one
query (the client splits them into the two tabs):

```ts
export interface SatpamInspectionCard {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null; // real plate, from ExpeditionDetail — same source armada-expeditiondetail-linkage.ts already established
  driverName: string | null;
  jamJadwal: string; // ISO
  doVoucherNo: string | null; // first stop's DO voucher, for display — null if Status still Draft (no DO yet)
  status: "Draft" | "Terbit";
  tipe: "BERANGKAT" | "DATANG";
  hasCheck: boolean; // true if a DashboardVehicleCheck already exists for this Jadwal+Tipe
}
```

Query joins `DashboardPengirimanJadwal` + `DashboardArmada`/`ExpeditionDetail`
+ `Salesman` + `DashboardVehicleCheck` (left join, per Tipe), filtered to
today's `businessDate` window using the **general dashboard rollover
convention (14:00 WIB)** — the same one Papan Pengiriman's own board query
uses. (This project has a second, narrower rollover convention — 13:00 WIB,
specific to the Kinerja Marketing panel only — which does not apply here;
this screen is squarely in the Papan Pengiriman/delivery-scheduling domain,
not Kinerja Marketing.) `BERANGKAT` rows only need
`Status = 'Terbit'` to ever show `hasCheck: true`/eligible (a Draft Jadwal
can still appear, just always `hasCheck: false` and rendered as "Proses
Muat"); `DATANG` rows additionally require a `BERANGKAT` check to already
exist (mirrors the existing sequential Cek Berangkat → Cek Datang gate).

**UI:** tabs "KEBERANGKATAN"/"KEDATANGAN" (shadcn `Tabs`), each showing a
scrollable list of cards (shadcn `Card`), one per `SatpamInspectionCard`:
armada name + plate, driver name, time badge, DO voucher (or a
"belum ada DO" placeholder if still Draft), and a trailing button:

- `Status: 'Terbit'`, `hasCheck: false` → **"Inspeksi"** button (shadcn
  `Button`, using the `--warning`/`--warning-foreground` token pair already
  defined in this project's `globals.css` for both light and dark theme —
  the natural mapping for the mockup's amber "Security" role accent,
  no new color token needed). Tapping navigates to
  `/satpam-app/inspeksi/[jadwalId]?tipe=BERANGKAT` (or `DATANG`).
- `Status: 'Draft'` → **"Proses Muat"**, rendered disabled (shadcn `Button`
  `variant="outline"` `disabled`), matching the mockup's dimmed third card —
  nothing to inspect yet.
- `hasCheck: true` → card doesn't need to appear at all (already inspected;
  the query only returns rows still needing a decision).

Icons: `lucide-react` (`User`, `Clock`, `History`, `SlidersHorizontal` for
filter) — this project has zero Material Symbols usage anywhere; adopting
`lucide-react` (used in literally every component built this session) is
the only choice consistent with the existing codebase, not a real decision
point.

## Screen 2 — Live Inspeksi Kendaraan

**Route:** `src/app/satpam-app/inspeksi/[jadwalId]/page.tsx`, reading
`?tipe=BERANGKAT|DATANG` from the query string. Same standalone,
no-dashboard-chrome, `isSatpam`-gated pattern as Screen 1.

**Fixed dark theme:** this screen always renders dark, regardless of the
visitor's system color-scheme preference — camera-viewfinder UIs are
conventionally dark (matches native camera apps, and helps with the
DESIGN.md's own stated outdoor-glare/legibility goal). Implemented by
forcing the `dark` class on this route's root element, then using the
project's **existing** `.dark { --background: ...; --card: ...; }` token
values already defined in `globals.css` — not the mockup's hardcoded hex
colors. This keeps the screen visually consistent with the rest of the
app's dark mode rather than introducing a third, one-off palette.

**Layout**, top to bottom:
1. Full-screen live camera feed as the background (the currently-active
   slot's live view — see Capture below), with a dark gradient overlay
   matching the mockup's legibility treatment (top/bottom scrims).
2. Top bar: back button, "Inspeksi Kendaraan" title, armada name + plate
   (in the `--warning` accent color), driver name, help icon.
3. A status pill: "LIVE VIEW" + "X/6 SELESAI" counter.
4. A label showing the currently-active target's name (e.g. "Sisi Depan")
   — in Jalur A this is **driven by which slot the user last tapped**, not
   by detection; it's the exact same "active target" concept already
   proven in the desktop `CheckForm`, just relabeled for this screen's
   visual style. (This is the seam Jalur B plugs into later — swapping a
   manually-set value for an automatically-detected one, with zero other
   changes to this screen.)
5. A large shutter button (manual capture) — tapping it snapshots the
   current live frame for whichever slot is active, exactly like the
   desktop `LiveCameraCaptureField`'s tap-to-capture behavior.
6. A bottom sheet ("Data Kendaraan"): the 6-slot flat grid (Depan,
   Belakang, Kiri, Kanan, Kabin, Muatan — same six `JenisFotoKendaraan`
   values already established, just laid out as a flat row of tappable
   thumbnails instead of a 3D cube), each slot showing its captured photo
   once taken (or a placeholder icon before capture) and **tapping any
   slot makes it the active target** (swapping the live camera view to
   that slot, same one-active-target-at-a-time model as the desktop
   build). Below the grid: Odometer number input, and a Fuel Bar selector
   (0-4, with an explicit tappable "E" segment for 0 — the mockup only
   showed 4 segments with no zero state; adding "E" closes that gap and
   keeps the full 0-4 range already established in
   `DashboardVehicleCheck.FuelBar`).
7. A sticky full-width footer button: **"Kendaraan Berangkat"** (tipe
   `BERANGKAT`) or **"Kendaraan Tiba"** (tipe `DATANG`) — disabled until
   all 6 photos + Odometer + Fuel Bar + the muatan confirmation (below) are
   filled, exactly the same `canSubmit` shape the desktop `CheckForm`
   already uses.

**Capture mechanism:** reuses the desktop build's proven
`getUserMedia`/`<video>`/`<canvas>` capture logic (real `MediaStream`,
tap-to-snapshot, tap-again-to-retake), but **not** the `LiveCameraCaptureField`
component itself as-is — that component's `size="main"|"toggle"` visual
treatment (small bordered box) doesn't fit a full-screen edge-to-edge
camera view. The underlying capture logic (stream lifecycle, canvas
snapshot, retake-on-tap, the double-tap re-entrancy guard) is extracted
into a shared hook, `useLiveCameraCapture`, that both the desktop
component and this new full-screen screen consume — the desktop component
becomes a thin wrapper around the hook plus its existing small-box JSX; this
new screen gets its own full-screen JSX around the same hook. This avoids
duplicating the getUserMedia/canvas logic in two places while letting each
surface have its own appropriate visual treatment.

**Muatan confirmation (replaces a plain Qty input):** per the user's explicit
choice, this screen does **not** show a "Jumlah Koli" number field the way
the desktop build does. Instead, once all 6 photos are captured, a
confirmation step appears (a shadcn `Dialog` or inline card — implementer's
call on the cleanest fit within this screen's existing bottom-sheet flow):
"Muatan sudah sesuai?" with **Ya** / **Tidak** buttons.

- **Ya** → `MuatanQty` is set to the Jadwal's own already-known expected
  total (the same `totalQty` sum-across-all-stops figure the desktop
  `selesaiMuat`/capacity-check logic already computes — reused directly,
  not recalculated differently here), with no further typing needed.
- **Tidak** → reveals a manual number input (same validation as the
  desktop build: required, `>= 0`) for the Satpam to record the actual
  observed count when it differs from the expected total.

This still ends up calling the exact same `createVehicleCheckAction`
with a real `muatanQty: number` — the confirmation step is purely a
front-end UX difference in how that number gets filled in, not a backend
change.

## Files

- Create: `src/app/satpam-app/page.tsx` (Screen 1)
- Create: `src/app/satpam-app/inspeksi/[jadwalId]/page.tsx` (Screen 2)
- Create: `src/lib/queries/satpam-inspection.ts` (`getSatpamInspectionList`)
- Create: `src/hooks/use-live-camera-capture.ts` (extracted shared capture
  logic, consumed by both the desktop `LiveCameraCaptureField` and the new
  full-screen mobile capture UI)
- Modify: `src/components/dashboard/live-camera-capture-field.tsx` (refactor
  to consume the new shared hook instead of owning the capture logic
  directly — behavior unchanged, verified against the same live-verification
  scenarios already proven for this component)
- Create: mobile-specific components under a new `src/components/satpam-app/`
  directory (card list, full-screen capture view, muatan-confirmation step,
  fuel bar with "E") — exact file split left to the implementation plan.

## Open risks, explicitly accepted

- The hook-extraction refactor of `LiveCameraCaptureField` touches
  already-shipped, already-reviewed code from earlier this session. The
  implementation plan must re-verify the desktop component's existing
  behavior (capture, retake, toggle-never-streams, double-tap guard, the
  `active`-transition retake reset from the most recent fix round) still
  holds after the refactor — this is a real regression risk given how much
  scrutiny that component already received, not just a mechanical extraction.
- Screen 2's browser camera access requires a secure context — already a
  known, accepted non-issue for this project (production is HTTPS).
- Jalur B (AI side detection) is explicitly deferred; this spec's "active
  target" state is designed to be swappable later, but that swap itself is
  not designed here — it's a future spec's problem once training data exists.
