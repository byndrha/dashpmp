# Driver-app real-time status: arrival gating, istirahat lock, and pengiriman terkendala

## Context

`/mkesindo/driver-app`'s per-stop screen (`PengirimanStep`) already lets a driver swipe "Geser untuk Tiba" the moment they open it — with no check that they're actually anywhere near the destination — and already has a phone button (`CallChoiceDialog`, Telepon/WhatsApp) and a "SOS" button (`KendalaDialog`, for *vehicle* problems: ban bocor, mogok, kecelakaan, macet — a different concept from what this design adds). There is no way for a driver to log a break, and nothing survives the app being force-closed: all in-progress state today lives only in React state.

This design adds four things, confirmed with the user across a dedicated brainstorming session:

1. **Arrival gating** — the "Tiba" swipe only appears within 100m of the destination.
2. **Istirahat (break) tracking** — a new button, a full-screen lock overlay with a live timer, backed by a server row so it survives the app being closed and reopened.
3. **Pengiriman Terkendala** — a self-reported "couldn't reach the recipient" flag, separate from the existing vehicle-Kendala mechanism, that reorders the affected stop to last (with manual override).
4. **Two small display additions**: per-stop travel-time estimate in driver-app's destination list, and per-stop actual arrival time in the desktop Validasi Rute dialog.

## Decisions made during brainstorming

- **Pengiriman Terkendala is a fully separate mechanism from the existing vehicle-Kendala/SOS button** — different table, different dialog, different trigger. The two concepts (vehicle trouble vs. recipient unreachable) stay independent rather than merging into one dropdown.
- **The istirahat overlay is a hard, full-screen lock** — no interaction with anything underneath (not even Tiba/BBM/phone) until "Selesai Istirahat" is pressed. This is also what makes the "survives app being closed" requirement (PR #4) meaningful: the lock isn't a UI mode, it's a server-truth check re-run on every load.
- **Arrival radius: 100 meters**, computed via the existing `haversineKm()` (`src/lib/route-estimate.ts`, no server-only imports — already safe to use from a client component).
- **GPS failure/denial: keep the gate locked, show a clear message** ("Lokasi tidak terdeteksi — aktifkan GPS") — no manual override. The phone button stays available either way, so a driver is never fully stuck.
- **A call attempt cannot be verified from the web app** (dialing/WhatsApp hands off to the OS) — Pengiriman Terkendala is therefore self-reported: a "Tidak bisa dihubungi? Laporkan Pengiriman Terkendala" link appears near the phone button only after the driver has opened `CallChoiceDialog` at least once for that stop.
- **Terkendala reordering is per-stop, not general drag-and-drop.** Only the flagged stop gets ▲▼ controls to move it manually among the remaining stops; every other stop's order is untouched. Reordering is realized via a new nullable `UrutanOverride` column rather than mutating the real `Urutan` staff set on desktop — the "official" order stays intact in history.
- **Terkendala is a status flag, not a delivery block.** Once the driver eventually reaches that stop (now further down the queue), Tiba → Konfirmasi Kirim proceeds exactly as normal. Nothing needs to be "unlocked" first.
- **Validasi Rute's new time summary shows three numbers together**, not just one: Total Berjalan (since Berangkat), Total Istirahat (summed), and Waktu Efektif Pengiriman (the difference) — this is what "waktu istirahat dengan waktu pengiriman... terakumulasi" meant: the two are shown as a comparable pair, not a lone break-time figure.
- **All of this data is fetched on dialog-open, not polled live.** Matches how every other panel in `RouteValidationDialog` already works. If staff later need a truly live break-status view while the dialog stays open, the existing 10-second driver-GPS-polling pattern is a direct template — deliberately not built now (YAGNI).

## Data model (MSSQL, same conventions as `DashboardPengirimanKendala`)

```sql
CREATE TABLE DashboardPengirimanIstirahat (
  IstirahatID   INT IDENTITY PRIMARY KEY,
  JadwalID      INT NOT NULL,
  SalesmanID    VARCHAR(16) NOT NULL,
  Keterangan    VARCHAR(200) NOT NULL,   -- "Makan" / "Toilet" / "Sholat" / free text under "Lainnya"
  WaktuMulai    DATETIME NOT NULL DEFAULT GETDATE(),
  WaktuSelesai  DATETIME NULL,           -- NULL = currently on break; this is the lock's source of truth
  CreatedDate   DATETIME NOT NULL DEFAULT GETDATE()
)

CREATE TABLE DashboardPengirimanTerkendala (
  TerkendalaID    INT IDENTITY PRIMARY KEY,
  JadwalDetailID  INT NOT NULL,
  SalesmanID      VARCHAR(16) NOT NULL,
  Alasan          VARCHAR(200) NOT NULL, -- "Alamat tidak ditemukan" / "Lokasi tutup" / "Penerima tidak merespon" / free text under "Lainnya"
  IsResolved      BIT NOT NULL DEFAULT 0,
  CreatedDate     DATETIME NOT NULL DEFAULT GETDATE()
)

ALTER TABLE DashboardPengirimanJadwalDetail ADD UrutanOverride INT NULL
```

`UrutanOverride`, when non-null, wins over `Urutan` purely for driver-app's own remaining-stops ordering — desktop Validasi Rute's stop list and history continue to read `Urutan` unchanged.

**Important layering note**: `getDriverJadwalStops()` (`src/lib/queries/pengiriman-jadwal.ts`) is shared — it's driver-app's own read path AND, since an earlier session, also what `RouteValidationDialog` reads via `getJadwalDetailAction` (desktop). This function's own `ORDER BY` must stay exactly `Urutan` (unchanged) even after it starts also selecting `UrutanOverride` — it must NOT re-sort by `UrutanOverride ?? Urutan` itself, or desktop's stop list would silently reorder whenever a driver moves a Terkendala stop. The `UrutanOverride ?? Urutan` re-sort happens ONE layer up, client-side, only inside driver-app's own `stop-flow.tsx` (where `remainingStops` is derived) — desktop's `RouteValidationDialog` never performs this re-sort and keeps rendering whatever order `getDriverJadwalStops()` returns (i.e., plain `Urutan`).

## 1. Arrival gating (`PengirimanStep`)

- Compute `distanceToActiveStopKm = haversineKm(position, { lat: activeStop.Latitude, lng: activeStop.Longitude })` whenever `position` (already tracked) updates.
- **≥ 100m or `position == null`**: the "Geser untuk Tiba" control is not rendered at all. In its place:
  - If `position` exists: small text "±XXXm menuju tujuan".
  - If `position` is null: "Lokasi tidak terdeteksi — aktifkan GPS".
  - The phone button stays visible and functional in both cases.
- **< 100m**: the swipe control renders exactly as it does today.

No new table — this is display/condition logic only, nothing to persist.

## 2. Istirahat (break) tracking

**New button** in `PengirimanStep`'s top-right icon cluster (alongside Isi BBM / SOS).

**`IstirahatDialog`** (mirrors `KendalaDialog`'s shape): dropdown Makan / Toilet / Sholat / Lainnya (free text when Lainnya), one "Mulai Istirahat" button. On confirm: `startIstirahatAction(jadwalId, keterangan)` → `INSERT INTO DashboardPengirimanIstirahat (JadwalID, SalesmanID, Keterangan) VALUES (...)`.

**New layout** `src/app/mkesindo/driver-app/layout.tsx` (doesn't exist today — `(tabs)` and `jadwal/[jadwalId]` are separate branches with no shared parent). This layout:
- Server-side: resolves the driver's session, calls a new `getActiveIstirahat(salesmanId): Promise<{ istirahatId: number; keterangan: string; waktuMulai: string } | null>` (query for a row with `WaktuSelesai IS NULL` for this driver).
- Renders `{children}` normally, plus an `IstirahatOverlay` client component that receives the active-istirahat data (or null) as a prop.

**`IstirahatOverlay`**: if the prop is non-null, renders a `fixed inset-0 z-[100]` full-screen panel (above everything, including any open dialog in `children`) showing the keterangan and a live timer computed client-side as `now - waktuMulai` (ticking every second), with one button: "Selesai Istirahat" → `endIstirahatAction(istirahatId)` → `UPDATE DashboardPengirimanIstirahat SET WaktuSelesai = GETDATE() WHERE IstirahatID = @id`, then the layout's server data is revalidated (`revalidatePath`) so the overlay disappears.

Because the layout re-checks `getActiveIstirahat` on every load (including a fresh page load after the browser/PWA was killed and reopened), the lock is enforced by the server row, not by any client state — closing the app mid-break and reopening it immediately re-shows the overlay with the correct elapsed time.

## 3. Pengiriman Terkendala

- `PengirimanStep` tracks a local `hasAttemptedCall` boolean (set true once `CallChoiceDialog` has been opened for the current `activeStop`, reset when `activeStop` changes). While true, a small text link "Tidak bisa dihubungi? Laporkan Pengiriman Terkendala" renders near the phone button.
- **`TerkendalaDialog`** (new, separate from `KendalaDialog`): dropdown Alamat tidak ditemukan / Lokasi tutup / Penerima tidak merespon / Lainnya (free text). On confirm: `reportTerkendalaAction(jadwalDetailId, alasan)` → `INSERT INTO DashboardPengirimanTerkendala (JadwalDetailID, SalesmanID, Alasan) VALUES (...)`, then sets that detail's `UrutanOverride` to `MAX(current remaining stops' effective order) + 1` (pushing it to last among what's left).
- The destination list in `PengirimanStep` (via `stop-flow.tsx`'s `remainingStops` derivation) re-sorts by `UrutanOverride ?? Urutan` client-side — see the layering note under Data Model above; `getDriverJadwalStops()` itself keeps returning plain-`Urutan` order. The flagged stop's row gets a "Terkendala" badge (same visual treatment as the existing "Kendala dilaporkan" ETA-line text) plus ▲▼ buttons that swap its `UrutanOverride` with the adjacent stop's effective position (a new `moveTerkendalaStopAction(jadwalDetailId, direction: "up" | "down")`).
- `DriverStopRow` (`src/lib/queries/pengiriman-jadwal.ts`) gains `IsTerkendala: boolean` and `TerkendalaAlasan: string | null`, populated by the same extra-query `getDriverJadwalStops()` already runs for `JamTiba`/`JamSelesai` (one more `LEFT JOIN DashboardPengirimanTerkendala tk ON tk.JadwalDetailID = jd.JadwalDetailID AND tk.IsResolved = 0`). Because `DriverStopRow` already flows to BOTH driver-app and desktop's `RouteValidationDialog`, this one field addition is what lets the "Terkendala" badge render on **both** surfaces — driver-app's own destination list AND desktop's `SortableStopRow` (confirmed as wanted in Bagian 5 of brainstorming) — without a second query.
- No block on eventually delivering there — Tiba/Konfirmasi Kirim/Konfirmasi Terima proceed unchanged once the driver reaches it.

## 4. Two display additions

- **Driver-app destination list** (`PengirimanStep`, the `remainingStops.map(...)` block): alongside the existing cumulative `distanceByDetailId` (shown as "X.X km"), add a parallel `durationByDetailId` map computed the same way — summing `effectiveRoute.legs[i].durationMinutes` cumulatively — rendered as a second line under the km text, e.g. "~12 menit".
- **Validasi Rute** (`RouteValidationDialog`'s `SortableStopRow`): show each stop's actual `JamTiba` (already present on `DriverStopRow`, already flowing into `order` — no new query needed) as a small timestamp under the destination name once it's set, e.g. "Tiba 14:32".

## 5. Validasi Rute time summary

Extends the existing "Riwayat Status" popover area (`RouteValidationDialog`) with three figures, computed from a new `getIstirahatForJadwal(jadwalId): Promise<{ keterangan: string; waktuMulai: string; waktuSelesai: string | null; durasiMenit: number }[]>`:

- **Total Berjalan**: `JamAktualBerangkat` to now (still Terbit) or to the latest `JamSelesai`/Datang check (completed).
- **Total Istirahat**: `SUM(durasiMenit)` across every istirahat row for the Jadwal (an in-progress row, `waktuSelesai == null`, counts up to "now").
- **Waktu Efektif Pengiriman**: Total Berjalan − Total Istirahat.

Individual istirahat sessions (keterangan + duration) are listed in the same popover, same list style as the existing status-history timeline.

## Global constraints

- `DashboardPengirimanTerkendala`/`DashboardPengirimanIstirahat` are entirely separate from `DashboardPengirimanKendala` — no shared table, no shared dialog.
- The istirahat lock's source of truth is always the server row (`WaktuSelesai IS NULL`), never client-only state — this is what makes it survive an app kill.
- `UrutanOverride` is driver-app-only convenience ordering. `getDriverJadwalStops()` may SELECT it (both driver-app and desktop's `RouteValidationDialog` share this function), but must never sort by it — only `stop-flow.tsx`'s client-side `remainingStops` derivation applies the `UrutanOverride ?? Urutan` re-sort. The staff-authored `Urutan`/history stays exactly as it was on desktop.
- Arrival gating has no override path when GPS fails — the phone button is the only always-available action in that state.
