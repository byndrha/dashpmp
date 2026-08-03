# Satpam Role & Vehicle Gate-Check — Design Spec

**Company:** PT Mitra Kelola Esindo (MKEsindo) only. **Module scope:** Pengiriman (`delivery`) only.

## Goal

Add a new "Satpam" role that can only see the Pengiriman module, plus a gate-security
workflow inside the existing Validasi Rute dialog: two camera-verified vehicle
inspections per departed (Terbit) Jadwal — **Cek Berangkat** (leaving the factory) and
**Cek Datang** (returning) — each capturing 6 photos (depan, samping kanan, samping
kiri, belakang, box muatan, kabin/speedometer) plus odometer (KM) and fuel level.
Only Satpam can create these records; once created, a record is immutable. Cek
Datang's timestamp becomes the real "Kembali ke Pabrik" arrival time on the
Papan Pengiriman timeline, replacing today's 15-minute estimate marker.

## Non-goals

- No change to the existing "Berangkat" button / DO-creation flow — Satpam's checks
  are an independent audit record, not a gate on any existing action.
- No editing or deleting a submitted check (immutable by design — "terkontrol").
- No enforcement that Cek Berangkat happens before the vehicle physically leaves —
  this is a logging tool, not a physical barrier.
- No support for PMPutra or any company other than MKEsindo.
- No true camera-vs-gallery enforcement beyond the standard
  `<input capture>` attribute — this is a browser/OS-level UI convention, not a
  server-enforceable guarantee. Documented as a known limitation, not solved.

## Data model (new)

### Postgres — `peran` gets one new column

```sql
ALTER TABLE peran ADD COLUMN is_satpam BOOLEAN NOT NULL DEFAULT false;
```

Same pattern as the existing `is_super_admin` column — a role-level flag, independent
of the per-module `peran_izin` view/edit grid, exposed through the JWT session
(`session.user.isSatpam`) exactly like `isSuperAdmin` already is (`auth.ts`,
`akun.ts`'s row mapping, `next-auth.d.ts`). **Deliberately not bypassed by
`isSuperAdmin`** — a superadmin does not automatically count as Satpam for the
purpose of creating a gate-check record (this is a physical-presence audit trail,
not a general permission).

The "Satpam" role itself is created through the existing Peran editor
(`/grup/akun/peran`) once this flag exists there — no new admin page needed, just
one new toggle in that UI (alongside the module view/edit grid), scoped to
MKEsindo's `perusahaan_id` like any other role there.

### MSSQL (MKEsindo's own DB, alongside `DashboardPengirimanJadwal`) — 2 new tables

```sql
CREATE TABLE DashboardVehicleCheck (
  VehicleCheckID INT IDENTITY PRIMARY KEY,
  JadwalID INT NOT NULL REFERENCES DashboardPengirimanJadwal(JadwalID),
  Tipe VARCHAR(10) NOT NULL CHECK (Tipe IN ('BERANGKAT','DATANG')),
  OdometerKM INT NOT NULL,
  FuelLevel VARCHAR(4) NOT NULL, -- 'E','1/4','1/2','3/4','F'
  CheckedByUserID VARCHAR(16) NOT NULL,
  CheckedAt DATETIME NOT NULL DEFAULT GETDATE(),
  CONSTRAINT UQ_VehicleCheck_JadwalTipe UNIQUE (JadwalID, Tipe)
);

CREATE TABLE DashboardVehicleCheckPhoto (
  VehicleCheckPhotoID INT IDENTITY PRIMARY KEY,
  VehicleCheckID INT NOT NULL REFERENCES DashboardVehicleCheck(VehicleCheckID),
  JenisFoto VARCHAR(16) NOT NULL CHECK (JenisFoto IN
    ('DEPAN','SAMPING_KANAN','SAMPING_KIRI','BELAKANG','BOX_MUATAN','KABIN')),
  FilePath VARCHAR(256) NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
  CONSTRAINT UQ_VehicleCheckPhoto_CheckJenis UNIQUE (VehicleCheckID, JenisFoto)
);
```

The `UNIQUE (JadwalID, Tipe)` constraint is what makes a check immutable in
practice: once `BERANGKAT` or `DATANG` exists for a Jadwal, a second insert attempt
fails at the DB level — the server action re-checks first for a clean error message,
but the constraint is the real guarantee.

`CheckedByUserID` stores the Postgres `akun.id` (as a string, matching the existing
`session.user.id` convention used elsewhere for `CreatedByUserID`-style columns in
this app).

## Query layer

New file `src/lib/queries/vehicle-check.ts`:
- `getVehicleChecksForJadwal(jadwalId): Promise<VehicleCheckRow[]>` — 0, 1, or 2 rows
  (BERANGKAT/DATANG), each with its 6 photos nested.
- `createVehicleCheck(input: { jadwalId, tipe, odometerKM, fuelLevel, userId, photos: { jenisFoto, filePath }[] }): Promise<void>` —
  inserts the header row + 6 photo rows in one connection (not a real transaction
  wrapper, matching this codebase's established non-transactional best-effort style
  for multi-step MSSQL writes — see `feedback` memory on this pattern); throws a
  clean, translated error if the unique constraint fires (already-checked-in).
- `getJamKembaliAktualMap(jadwalIds: number[]): Promise<Map<number, Date>>` — bulk
  lookup of DATANG's `CheckedAt` per Jadwal, used by the board query below.

## Wiring into the Papan Pengiriman board's "Kembali ke Pabrik" marker

`getPengirimanBoard` (`pengiriman-jadwal.ts`) gains one more LEFT JOIN to
`DashboardVehicleCheck` (`Tipe='DATANG'`), surfaced on `JadwalCard` as a new
nullable `JamKembaliAktual: string | null`. In `pengiriman-board.tsx`'s
`autoSegments` computation (~line 804-832): when `JamKembaliAktual` is present, the
"Dalam Perjalanan" segment's end and the "Kembali ke Pabrik" marker's position both
use that real timestamp instead of the estimated
`JamAktualBerangkat + DurasiMenit`. When absent (no Satpam check yet, or MKEsindo
chooses not to require one for a given trip), behavior is byte-identical to today —
this is purely additive, not a breaking change to existing Jadwal rows.

## UI — inside the existing `RouteValidationDialog`

New component `src/components/dashboard/vehicle-check-panel.tsx`, rendered only
when `!isDraft` (Terbit Jadwal — a Draft has no real departure to check yet):

- Fetches this Jadwal's existing checks (0-2) via a new server action.
- **If the logged-in user has `session.user.isSatpam === true`:**
  - No BERANGKAT check yet → show the "Cek Berangkat" form (6
    `CameraCaptureField`s + odometer number input + fuel-level select + submit
    button, disabled until all 6 photos are present).
  - BERANGKAT exists, no DATANG yet → show the "Cek Datang" form, same shape.
  - Both exist → show both as read-only summaries (thumbnails + odometer + fuel +
    timestamp), no form.
- **If the logged-in user does NOT have `isSatpam`:** always read-only — shows
  whatever checks exist so far as summaries (per the "visible to everyone who opens
  Validasi Rute" decision), or a plain "Belum ada Cek Berangkat/Cek Datang" note if
  none yet. No form ever rendered for a non-Satpam session, even if they could
  somehow reach the submit action (defense in depth — the server action re-checks
  `isSatpam` independently, it's not a client-only gate).

New reusable `src/components/dashboard/camera-capture-field.tsx`:
`<input type="file" accept="image/*" capture="environment" />` per slot, shows a
thumbnail preview once a photo is picked, replaces on re-pick. Ships with a short
inline caption noting the capture-attribute caveat (some mobile browsers still
surface a gallery shortcut next to the camera control — a platform limitation, not
a bug in this feature).

## Upload endpoint

New route `src/app/api/upload/satpam-check/route.ts`, mirroring
`api/upload/armada-foto/route.ts`'s shape (same `ALLOWED_TYPES`/`MAX_SIZE_BYTES`,
same `requireModuleAccess("delivery")` gate) plus an explicit
`session.user.isSatpam` check (403 if false — this endpoint writes evidentiary
photos, so it gets its own auth check rather than trusting the page-level gate
alone). Writes to
`public/uploads/satpam-check/{armadaId}/{yyyyMMdd-HHmmss}-{jenisFoto}.{ext}`,
takes `armadaId` and `jenisFoto` as extra form fields alongside the file. Returns
`{ path }` the same way the Armada endpoint does.

## Server actions

`src/app/(dashboard)/delivery/actions.ts` gains:
- `getVehicleChecksForJadwalAction(jadwalId)` — read, `requireModuleAccess("delivery")`
  only (visible to anyone who can open Validasi Rute, per the visibility decision).
- `createVehicleCheckAction(input)` — `requireModuleAccess("delivery")` +
  **explicit `session.user.isSatpam` check** (not superadmin-bypassable), then
  `createVehicleCheck(...)`. Revalidates the delivery board path so the "Kembali ke
  Pabrik" marker updates live after a Cek Datang.

## Fuel level representation

Simple 5-value select (`E`, `1/4`, `1/2`, `3/4`, `F`) stored as `VARCHAR(4)` —
matches how a satpam would actually read an analog gauge, avoids over-engineering a
numeric percentage nobody can read precisely off a dashboard needle.

## Open risk, explicitly accepted

The `capture="environment"` attribute is a request to the OS/browser to prefer the
camera UI — it is a UX convention, not a hard technical block on selecting an
existing photo. No web standard exists to fully prevent gallery access from a file
picker. This is disclosed in the UI itself (see `camera-capture-field.tsx` above)
rather than silently over-promised.
