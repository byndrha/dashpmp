# GPS Kendaraan (Hino Connect + SoloFleet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "GPS Kendaraan" tab to `/mkesindo/delivery` that shows live position + 14-day route trail for company trucks, sourced from Hino Connect and SoloFleet (two third-party GPS-tracker platforms with different auth and payload formats), matched to `Armada` by plat nomor.

**Architecture:** Two provider adapters (`hino-connect.ts`, `solofleet.ts`) implement one `VehicleGpsProvider` interface behind a single sync function. The sync function normalizes both providers' output (including WIB→UTC timestamp conversion for SoloFleet) into one Postgres table (`armada_gps_riwayat`), matches plate numbers to `Armada`, and enforces 14-day retention. A client-side poller (mounted only while the new tab is active, mirroring `PrintQueuePoller`) calls the sync server action every 30-60s. Credentials for both platforms are stored encrypted in a new `gps_kendaraan_kredensial` table, managed from the existing `/grup/perusahaan` admin page.

**Tech Stack:** Next.js Server Actions, Postgres (`pg`, via `getPgPool()`), `leaflet`/`react-leaflet` (existing dependency), AES-256-GCM via Node `crypto` (existing `crypto-secret.ts` pattern), `amazon-cognito-identity-js` (new dependency, for Hino Connect's Cognito SRP login).

**Spec:** [docs/superpowers/specs/2026-09-26-gps-kendaraan-hino-solofleet-design.md](../specs/2026-09-26-gps-kendaraan-hino-solofleet-design.md)

## Global Constraints

- Retention for `armada_gps_riwayat`: exactly **14 days** (spec, confirmed by user).
- Client-side polling only for this phase — **no server cron**. Poller runs only while the "GPS Kendaraan" tab is the active tab (spec's explicit constraint; user asked to be reminded to migrate to server-side cron later — see Task 9's comment requirement).
- Credential storage: encrypted at rest (AES-256-GCM), admin UI lives on the **existing** `/grup/perusahaan` page — do not create a new page.
- Plate matching: exact match after normalization (uppercase, strip spaces/dashes/dots) against `Armada.PlatNomor`. Unmatched vehicles are **shown, not hidden**, with a "Belum terhubung ke Armada" badge.
- One provider's failure must never block the other provider's sync (isolated try/catch per adapter).
- SoloFleet's `lastupdated` is WIB local time (`+07:00` offset in the string); Hino's `lastTransmissionTimestamp` is UTC (`Z` suffix). Both must be normalized to UTC before being stored in `recorded_at` (a `timestamptz` column) — this project has a known history of WIB/UTC bugs, treat this as a spec requirement, not a nicety.
- This codebase has no automated test runner (no vitest/jest configured) — verification throughout this plan uses `npx tsx` ad hoc scripts (matching `scripts/migrate-*.ts` convention) and, for UI, the browser tools, not `pytest`/`jest` commands.

## Review Focus

- **Vehicle whose `plate` field equals its own VIN (Hino, when the tracker isn't registered with a real plate yet):** must not accidentally match an `Armada` row — normalization must not coincidentally produce a match, and the row should surface as unmatched. (Task 5)
- **SoloFleet's `lastupdated` string vs. `gpstimeISO`:** the adapter must use the one field that's actually reliable for `recorded_at`; picking the wrong one (or mis-parsing the `+07:00` offset as UTC) reproduces the exact WIB/UTC bug class already fixed elsewhere in this project. (Task 4)
- **One provider's credentials missing or its login failing entirely (e.g., before the admin fills in SoloFleet's password):** sync must still write Hino's data and show a "gagal sync" badge for SoloFleet, not throw and abort the whole action. (Task 7)
- **Two vehicles from different providers reporting the same plate number** (shouldn't normally happen, but nothing in the data guarantees uniqueness across Hino/SoloFleet): the "latest position per armada" query must have a defined tie-break (most recent `recorded_at` wins), not silently return two rows or an arbitrary one. (Task 6)
- **A stored credential row with a blank/placeholder password field on submit (the perusahaan_koneksi UI convention of "blank = keep existing"):** the GPS credential upsert must follow the same write-only convention, not overwrite a working password with an accidental blank submit. (Task 8)

---

## File Structure

- **Create** `scripts/migrate-gps-kendaraan-db.ts` — idempotent table creation (follows `migrate-akun-lokasi.ts` pattern)
- **Create** `src/lib/queries/gps-kendaraan-kredensial.ts` — CRUD for `gps_kendaraan_kredensial`
- **Create** `src/lib/queries/armada-gps.ts` — insert/query for `armada_gps_riwayat` (latest positions, trail, retention cleanup, plate matching)
- **Modify** `src/lib/crypto-secret.ts` — add `encryptGpsCredential`/`decryptGpsCredential` with a new derived key
- **Create** `src/lib/gps-providers/types.ts` — shared `VehicleGpsProvider` interface + `NormalizedVehiclePosition` type + plate-normalization helper
- **Create** `src/lib/gps-providers/hino-connect.ts` — Hino Connect adapter
- **Create** `src/lib/gps-providers/solofleet.ts` — SoloFleet adapter
- **Create** `src/lib/gps-providers/sync.ts` — `syncVehicleGpsPositions()`: calls both adapters (isolated try/catch), matches plates, upserts, runs retention
- **Modify** `src/app/mkesindo/(dashboard)/delivery/actions.ts` — add `syncVehicleGpsPositionsAction`, `getVehiclePositionsAction`, `getVehicleTrailAction`
- **Modify** `src/app/grup/perusahaan/actions.ts` — add `upsertGpsKredensialAction`
- **Create** `src/components/dashboard/gps-kendaraan-kredensial-form.tsx` — small standalone form (2 rows: Hino, SoloFleet), not per-PT
- **Modify** `src/app/grup/perusahaan/page.tsx` — fetch existing credential rows, render the new form
- **Create** `src/components/dashboard/vehicle-gps-panel.tsx` — map + list + poller for the new tab
- **Modify** `src/components/dashboard/pengiriman-tabs.tsx` — add 4th tab
- **Modify** `src/app/mkesindo/(dashboard)/delivery/page.tsx` — fetch initial vehicle positions, pass the new panel into `PengirimanTabs`

---

### Task 1: Database schema — `gps_kendaraan_kredensial` and `armada_gps_riwayat`

**Files:**
- Create: `scripts/migrate-gps-kendaraan-db.ts`

**Interfaces:**
- Produces: two tables other tasks query directly by name — `gps_kendaraan_kredensial (id, provider, username, password_encrypted, extra_config, updated_at, updated_by_akun_id)` with `UNIQUE (provider)`; `armada_gps_riwayat (id, provider, external_vehicle_id, plat_nomor_raw, plat_nomor_normalized, armada_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at, fetched_at, raw_payload)` with indexes `(armada_id, recorded_at)` and `(provider, external_vehicle_id, recorded_at)`.

- [ ] **Step 1: Write `scripts/migrate-gps-kendaraan-db.ts`**

Follow `scripts/migrate-akun-lokasi.ts` exactly (same `Client` construction from `DIRECTORY_DB_*` env vars, same `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` style). Columns exactly as listed in this task's Interfaces block. `provider` is `VARCHAR(16) NOT NULL` with a `CHECK (provider IN ('hino', 'solofleet'))` on both tables. `armada_id` is a plain nullable `INTEGER` (no `REFERENCES` — `Armada` lives in the MSSQL ERP DB, not this Postgres DB, same cross-DB-reference-by-value pattern as `expedition.ts`'s `ExpeditionDetailID`). `id`/`external_vehicle_id`/`plat_nomor_raw`/`plat_nomor_normalized` are `TEXT NOT NULL`. `latitude`/`longitude`/`speed_kmh`/`heading` are `DOUBLE PRECISION` (`latitude`/`longitude` NOT NULL, the rest nullable). `ignition_on` is `BOOLEAN` nullable. `recorded_at`/`fetched_at` are `TIMESTAMPTZ NOT NULL` (`fetched_at` defaults `now()`). `raw_payload` is `JSONB`. `password_encrypted` is `TEXT NOT NULL`, `extra_config` is `JSONB`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_by_akun_id TEXT`.

- [ ] **Step 2: Run the migration**

Run: `npx tsx scripts/migrate-gps-kendaraan-db.ts`
Expected: prints `"gps_kendaraan_kredensial table ready."` and `"armada_gps_riwayat table ready."` (or equivalent per your own log lines), exits 0. Re-run once more to confirm idempotency (no errors second time).

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-gps-kendaraan-db.ts
git commit -m "feat: tambah skema DB gps_kendaraan_kredensial dan armada_gps_riwayat"
```

---

### Task 2: Credential encryption helpers

**Files:**
- Modify: `src/lib/crypto-secret.ts`

**Interfaces:**
- Consumes: nothing new (same `AUTH_SECRET`-derived-key pattern already in this file).
- Produces: `encryptGpsCredential(plaintext: string): string`, `decryptGpsCredential(ciphertext: string): string` — used by Task 3.

- [ ] **Step 1: Add `getGpsCredentialKey()` + `encryptGpsCredential`/`decryptGpsCredential` to `src/lib/crypto-secret.ts`**

Copy the exact structure of this file's existing `getGDriveKey`/`encryptGDriveToken`/`decryptGDriveToken` trio, with the derived-key prefix `"gps-kendaraan-credential:"` (a new prefix, distinct from every other purpose in this file — same reasoning as the file's existing comments: a leaked GPS credential must not unlock DB or Drive credentials, and vice versa).

- [ ] **Step 2: Verify round-trip**

Run an ad hoc check: `npx tsx -e "import {encryptGpsCredential,decryptGpsCredential} from './src/lib/crypto-secret'; const c = encryptGpsCredential('test123'); console.log(decryptGpsCredential(c) === 'test123')"`
Expected: prints `true`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/crypto-secret.ts
git commit -m "feat: tambah enkripsi kredensial GPS Kendaraan"
```

---

### Task 3: Credential query layer

**Files:**
- Create: `src/lib/queries/gps-kendaraan-kredensial.ts`

**Interfaces:**
- Consumes: `encryptGpsCredential`/`decryptGpsCredential` (Task 2), `getPgPool()` (`src/lib/pg.ts`).
- Produces:
  ```ts
  export interface GpsKredensialRow { id: number; provider: "hino" | "solofleet"; username: string; extraConfig: Record<string, unknown> | null; updatedAt: string }
  export interface UpsertGpsKredensialInput { provider: "hino" | "solofleet"; username: string; password: string | null; extraConfig?: Record<string, unknown> }
  export async function listGpsKredensial(): Promise<GpsKredensialRow[]>
  export async function upsertGpsKredensial(input: UpsertGpsKredensialInput, updatedByAkunId: string | null): Promise<void>
  export async function resolveGpsKredensial(provider: "hino" | "solofleet"): Promise<{ username: string; password: string; extraConfig: Record<string, unknown> | null } | null>
  ```
  `upsertGpsKredensial` follows `perusahaan-koneksi.ts`'s `upsertKoneksi` convention exactly: `password: null` (or blank) means "keep existing" (`UPDATE ... WHERE provider = $1`, no-op on `password_encrypted`); a non-null password does the `INSERT ... ON CONFLICT (provider) DO UPDATE` with a freshly encrypted value. Reuse `AppError` from `src/lib/action-result.ts` for the "no existing row and no password" case, matching `perusahaan-koneksi.ts`'s message style.

- [ ] **Step 1: Write `src/lib/queries/gps-kendaraan-kredensial.ts`**

Model this file directly on `src/lib/queries/perusahaan-koneksi.ts` — same three functions (`resolveKoneksi`→`resolveGpsKredensial`, `listAllKoneksi`→`listGpsKredensial`, `upsertKoneksi`→`upsertGpsKredensial`), same SQL shape, swapped to this task's columns/types and `encryptGpsCredential`/`decryptGpsCredential`.

- [ ] **Step 2: Verify against the live table**

Run: `npx tsx -e "import {upsertGpsKredensial, resolveGpsKredensial} from './src/lib/queries/gps-kendaraan-kredensial'; await upsertGpsKredensial({provider:'hino', username:'test', password:'pw123'}, null); console.log(await resolveGpsKredensial('hino'))"`
Expected: prints an object with `username: 'test'`, `password: 'pw123'` (decrypted round-trip through the real table). Clean up the test row afterward (`DELETE FROM gps_kendaraan_kredensial WHERE username = 'test'` via `psql`/`npx tsx`) so it doesn't linger as fake data.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/gps-kendaraan-kredensial.ts
git commit -m "feat: tambah query layer kredensial GPS Kendaraan"
```

---

### Task 4: Provider interface, plate normalization, and timestamp normalization

**Files:**
- Create: `src/lib/gps-providers/types.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface NormalizedVehiclePosition {
    provider: "hino" | "solofleet";
    externalVehicleId: string;
    plateRaw: string;
    latitude: number;
    longitude: number;
    speedKmh: number | null;
    heading: number | null;
    ignitionOn: boolean | null;
    recordedAtUtc: Date;      // ALWAYS UTC — see normalizeToUtc below
    rawPayload: unknown;
  }
  export interface VehicleGpsProvider {
    readonly provider: "hino" | "solofleet";
    fetchPositions(): Promise<NormalizedVehiclePosition[]>;
  }
  export function normalizePlate(plate: string): string
  export function normalizeToUtc(isoOrOffsetString: string): Date
  ```
  Used by Task 5, 6, 7.

- [ ] **Step 1: Write `normalizePlate`**

`normalizePlate("AE 8072 SQ")` → uppercase, then strip everything that's not `[A-Z0-9]` (covers spaces, dashes, dots in one pass) → e.g. `"AE8072SQ"`.

- [ ] **Step 2: Write `normalizeToUtc`**

`new Date(isoOrOffsetString)` — JavaScript's `Date` parser already correctly interprets both `"2026-09-26T06:43:06Z"` (Hino, UTC) and `"2026-09-26T13:46:45+07:00"` (SoloFleet, WIB-with-explicit-offset) as the same instant, converting both to the same internal UTC timestamp. The function exists as a named seam (not inlined at each call site) so this exact interpretation is documented once and testable once, not reasoned about separately in each adapter.

- [ ] **Step 3: Verify both functions with an ad hoc script**

Run: `npx tsx -e "import {normalizePlate,normalizeToUtc} from './src/lib/gps-providers/types'; console.log(normalizePlate('AE-8072 SQ.') === normalizePlate('AE8072SQ')); console.log(normalizeToUtc('2026-09-26T13:46:45+07:00').getTime() === normalizeToUtc('2026-09-26T06:46:45Z').getTime())"`
Expected: prints `true` twice — confirms plate normalization is punctuation/spacing-insensitive, and confirms SoloFleet's WIB offset string and Hino's UTC string for the same real-world instant produce the identical stored timestamp.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gps-providers/types.ts
git commit -m "feat: tambah interface VehicleGpsProvider dan util normalisasi plat/waktu"
```

---

### Task 5: SoloFleet adapter

**Files:**
- Create: `src/lib/gps-providers/solofleet.ts`

**Interfaces:**
- Consumes: `VehicleGpsProvider`, `NormalizedVehiclePosition`, `normalizePlate`, `normalizeToUtc` (Task 4); `resolveGpsKredensial("solofleet")` (Task 3).
- Produces: `export const solofleetProvider: VehicleGpsProvider`

- [ ] **Step 1: Implement login + fetch**

`fetchPositions()`: read credentials via `resolveGpsKredensial("solofleet")` (throw `AppError` if none configured — Task 7 catches this per-provider). POST username/password to `https://www.solofleet.com/Account/Login` to obtain the session cookie (inspect the login form's exact field names via the browser at implementation time — the design's Discovery phase confirmed the endpoint pattern but not this form's field names — then `fetch` `https://www.solofleet.com/Vehicle/vehiclelivewithoutzonetripNewModelCondense` with that cookie attached via `Cookie` header, `credentials` not needed since this is a direct server-to-server call, not a browser one). Parse the JSON body's `vehicles[]` array per the spec's documented shape (`alias`, `x`, `y`, `spd`, `course`, `lastupdated`, `vehicleid`, `deviceid`).

- [ ] **Step 2: Map each vehicle to `NormalizedVehiclePosition`**

`plateRaw: v.alias`, `latitude: v.y`, `longitude: v.x`, `speedKmh: v.spd`, `heading: v.course`, `ignitionOn: v.IP1 === 1 ? true : v.IP1 === 0 ? false : null` (per spec sample, `IP1` looks like an ignition/input flag — confirm against a live response at implementation time, since Discovery did not explicitly identify this field's meaning), `recordedAtUtc: normalizeToUtc(v.lastupdated)`, `externalVehicleId: String(v.deviceid ?? v.vehicleid)`, `rawPayload: v`.

- [ ] **Step 3: Manual verification against the live account**

Run: `npx tsx -e "import {solofleetProvider} from './src/lib/gps-providers/solofleet'; console.log(await solofleetProvider.fetchPositions())"` (requires Task 3's credential row to already exist for `provider: 'solofleet'` — use the real account from Discovery).
Expected: an array of `NormalizedVehiclePosition` objects with plausible Indonesian lat/lng values and non-garbage plate strings, no thrown error.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gps-providers/solofleet.ts
git commit -m "feat: tambah adapter GPS SoloFleet"
```

---

### Task 6: Hino Connect adapter

**Files:**
- Create: `src/lib/gps-providers/hino-connect.ts`
- Modify: `package.json` (add `amazon-cognito-identity-js` dependency)

**Interfaces:**
- Consumes: `VehicleGpsProvider`, `NormalizedVehiclePosition`, `normalizePlate`, `normalizeToUtc` (Task 4); `resolveGpsKredensial("hino")` (Task 3).
- Produces: `export const hinoConnectProvider: VehicleGpsProvider`

- [ ] **Step 1: Install `amazon-cognito-identity-js`**

Run: `npm install amazon-cognito-identity-js`

- [ ] **Step 2: Implement Cognito login**

Use `CognitoUserPool` with `UserPoolId: "ap-southeast-1_D0GwdGbuB"`, `ClientId: "keguk4gegt09c9kmfa5rvb1b8"` (both confirmed by Discovery, hardcode as module constants — these identify the Hino Connect application itself, not per-customer values). Authenticate via `CognitoUser.authenticateUser` with `AuthenticationDetails` (library handles SRP automatically) using credentials from `resolveGpsKredensial("hino")`. Extract the access token from the successful session (`session.getAccessToken().getJwtToken()`).

- [ ] **Step 3: Implement `fetchPositions()`**

POST to `https://be-pub-sg-hino.gazellecomputing.com/mapproxy/map/clusters` with `Authorization: Bearer <token>` and the fixed Indonesia-wide bounding box from the spec (`topLeftCorner: {lon:103.0977934375, lat:-1.9072132966240953}`, `bottomRightCorner: {lon:114.89710984375, lat:-11.798864459079624}`, `fleets: []`, `deviceListMaxLen: 500` — raised from Discovery's `25` so a growing fleet doesn't silently truncate, `zoomLevel: 7`, `hideExpired: true`). Flatten every `data[].devices[]` across all returned clusters into one array.

- [ ] **Step 4: Map each device to `NormalizedVehiclePosition`**

`plateRaw: d.plate`, `latitude: d.vehicleLastInfo.latitude_deg`, `longitude: d.vehicleLastInfo.longitude_deg`, `speedKmh: d.vehicleLastInfo.speed_kmh`, `heading: d.vehicleLastInfo.heading_deg`, `ignitionOn: null` (Hino's payload has no direct ignition field in the sample captured — `vehicleState` is a coarser MOVING/IDLE/OFF status, not a boolean; leave `null` rather than guessing), `recordedAtUtc: normalizeToUtc(d.vehicleLastInfo.lastTransmissionTimestamp)`, `externalVehicleId: d.vehicleId`, `rawPayload: d`.

- [ ] **Step 5: Skip devices whose `plate` equals their own `vin`**

Per the spec's Discovery note (some Hino devices report VIN as a placeholder plate) — filter these OUT of the returned array entirely rather than passing them through to be treated as a real, unmatchable plate. This directly covers this plan's Review Focus item on VIN-as-plate.

- [ ] **Step 6: Manual verification against the live account**

Run: `npx tsx -e "import {hinoConnectProvider} from './src/lib/gps-providers/hino-connect'; console.log(await hinoConnectProvider.fetchPositions())"` (requires Task 3's credential row for `provider: 'hino'`).
Expected: an array of `NormalizedVehiclePosition` objects, none with a `plateRaw` that looks like a VIN (17 alphanumeric chars), no thrown error.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/gps-providers/hino-connect.ts
git commit -m "feat: tambah adapter GPS Hino Connect"
```

---

### Task 7: Armada GPS query layer — insert, plate matching, latest position, trail, retention

**Files:**
- Create: `src/lib/queries/armada-gps.ts`

**Interfaces:**
- Consumes: `NormalizedVehiclePosition` (Task 4); `getPgPool()`.
- Produces:
  ```ts
  export interface VehiclePositionRow {
    armadaId: number | null; provider: "hino" | "solofleet"; plateRaw: string;
    latitude: number; longitude: number; speedKmh: number | null; heading: number | null;
    recordedAt: string; // ISO
  }
  export interface VehicleTrailPoint { latitude: number; longitude: number; recordedAt: string }
  export async function insertVehiclePositions(positions: NormalizedVehiclePosition[], armadaByPlate: Map<string, number>): Promise<void>
  export async function getLatestVehiclePositions(): Promise<VehiclePositionRow[]>
  export async function getVehicleTrail(armadaId: number, hoursBack: number): Promise<VehicleTrailPoint[]>
  export async function cleanupOldVehiclePositions(): Promise<void>
  ```
  Used by Task 8 (sync orchestration) and Task 10 (server actions).

- [ ] **Step 1: Implement `insertVehiclePositions`**

For each position, look up `armadaByPlate.get(normalizePlate(position.plateRaw))` (caller passes this map — built from `Armada.PlatNomor`, see Task 8) to get `armadaId | undefined`, then `INSERT INTO armada_gps_riwayat (provider, external_vehicle_id, plat_nomor_raw, plat_nomor_normalized, armada_id, latitude, longitude, speed_kmh, heading, ignition_on, recorded_at, raw_payload) VALUES (...)` per row — one `INSERT` per position is fine at this data volume (a handful of vehicles).

- [ ] **Step 2: Implement `getLatestVehiclePositions`**

`SELECT DISTINCT ON (COALESCE(armada_id::text, provider || ':' || external_vehicle_id)) ...` ordered by that same key then `recorded_at DESC` — this covers the Review Focus item on two providers reporting the same plate (they'd have different `armada_id` only if BOTH matched the same Armada row, which the `DISTINCT ON (armada_id)` alone would collapse into one; grouping by the raw `provider:external_vehicle_id` for unmatched rows, and by `armada_id` for matched ones, keeps every distinct physical device visible while still deduping repeated pings from the same device to its single latest one). Return one row per device (matched or not), `armadaId: null` when unmatched.

- [ ] **Step 3: Implement `getVehicleTrail`**

`SELECT latitude, longitude, recorded_at FROM armada_gps_riwayat WHERE armada_id = $1 AND recorded_at >= now() - ($2 || ' hours')::interval ORDER BY recorded_at ASC` — same shape as `akun-lokasi.ts`'s `getMarketingPositionHistory`, scoped to one `armada_id`.

- [ ] **Step 4: Implement `cleanupOldVehiclePositions`**

`DELETE FROM armada_gps_riwayat WHERE recorded_at < now() - INTERVAL '14 days'` — called once per sync cycle (Task 8), not scheduled separately (same self-cleaning pattern as `akun_lokasi`).

- [ ] **Step 5: Manual verification**

Run an ad hoc script that calls `insertVehiclePositions` with 2 fake positions (one with a plate matching a real `Armada.PlatNomor` from your ERP, one with a made-up unmatched plate), then `getLatestVehiclePositions()` and confirm both rows appear, the matched one has a non-null `armadaId`, the other's is `null`. Delete the test rows afterward.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/armada-gps.ts
git commit -m "feat: tambah query layer posisi GPS armada dengan pencocokan plat nomor"
```

---

### Task 8: Sync orchestration — isolated per-provider failure handling

**Files:**
- Create: `src/lib/gps-providers/sync.ts`

**Interfaces:**
- Consumes: `hinoConnectProvider` (Task 6), `solofleetProvider` (Task 5), `insertVehiclePositions`/`cleanupOldVehiclePositions` (Task 7), `getArmadaList` (`src/lib/queries/armada.ts`, existing), `normalizePlate` (Task 4).
- Produces:
  ```ts
  export interface ProviderSyncStatus { provider: "hino" | "solofleet"; ok: boolean; error: string | null; syncedAt: string }
  export async function syncVehicleGpsPositions(): Promise<ProviderSyncStatus[]>
  ```
  Used by Task 10's `syncVehicleGpsPositionsAction`.

- [ ] **Step 1: Build the plate→armadaId map once per sync**

Call `getArmadaList()` (existing), build `new Map(list.map(a => [normalizePlate(a.PlatNomor ?? ""), a.ArmadaID]))`, skipping rows with a blank `PlatNomor`.

- [ ] **Step 2: Run both providers in isolated try/catch**

```ts
const providers = [hinoConnectProvider, solofleetProvider];
const statuses: ProviderSyncStatus[] = [];
for (const p of providers) {
  try {
    const positions = await p.fetchPositions();
    await insertVehiclePositions(positions, armadaByPlate);
    statuses.push({ provider: p.provider, ok: true, error: null, syncedAt: new Date().toISOString() });
  } catch (err) {
    statuses.push({ provider: p.provider, ok: false, error: err instanceof Error ? err.message : String(err), syncedAt: new Date().toISOString() });
  }
}
await cleanupOldVehiclePositions();
return statuses;
```
(This is the whole function — small enough to give verbatim rather than describe, per one provider's failure must never block the other's Global Constraint.)

- [ ] **Step 3: Manual verification — simulate one provider failing**

Temporarily rename/break one provider's credential row (e.g. `UPDATE gps_kendaraan_kredensial SET username = 'wrong' WHERE provider = 'solofleet'`), run `npx tsx -e "import {syncVehicleGpsPositions} from './src/lib/gps-providers/sync'; console.log(await syncVehicleGpsPositions())"`.
Expected: returned array has `{provider: "solofleet", ok: false, error: "..."}` AND `{provider: "hino", ok: true, ...}` — Hino's data still landed in `armada_gps_riwayat` (check via `getLatestVehiclePositions()`) despite SoloFleet failing. Restore the credential row afterward.

- [ ] **Step 4: Commit**

```bash
git add src/lib/gps-providers/sync.ts
git commit -m "feat: tambah orkestrasi sync GPS Kendaraan dengan isolasi kegagalan per-provider"
```

---

### Task 9: Server actions

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: `syncVehicleGpsPositions` (Task 8), `getLatestVehiclePositions`/`getVehicleTrail` (Task 7).
- Produces:
  ```ts
  export async function syncVehicleGpsPositionsAction(): Promise<ActionResult<ProviderSyncStatus[]>>
  export async function getVehiclePositionsAction(): Promise<ActionResult<VehiclePositionRow[]>>
  export async function getVehicleTrailAction(armadaId: number, hoursBack: number): Promise<ActionResult<VehicleTrailPoint[]>>
  ```
  Used by Task 12 (`vehicle-gps-panel.tsx`) and Task 13 (`delivery/page.tsx`, initial fetch).

- [ ] **Step 1: Add the three actions**

Follow this file's existing `runAction(async () => { await requireModuleAccess("delivery"); return ...; })` wrapper style (see e.g. `getSisaReturTersediaAction`). Add a code comment on `syncVehicleGpsPositionsAction` recording the Global Constraint: *"Client-side polling only — this project has no server cron. TODO(user, reminder requested 2026-09-26): migrate to a server-side scheduled sync (API route + external scheduler) so positions keep updating when no one has the tab open."* — this is the explicit reminder the user asked for.

- [ ] **Step 2: Manual verification**

Run the app locally (or via the browser tools against the dev server), open a Node/browser console equivalent, or add a temporary log line — confirm each action returns `{success: true, data: [...]}` shape when called with a valid session. (Full UI verification happens in Task 14.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/delivery/actions.ts"
git commit -m "feat: tambah server action sync dan query posisi GPS Kendaraan"
```

---

### Task 10: Credential admin UI on `/grup/perusahaan`

**Files:**
- Create: `src/components/dashboard/gps-kendaraan-kredensial-form.tsx`
- Modify: `src/app/grup/perusahaan/actions.ts`
- Modify: `src/app/grup/perusahaan/page.tsx`

**Interfaces:**
- Consumes: `listGpsKredensial`/`upsertGpsKredensial` (Task 3), `requireGrupAccess` (existing), `runAction`/`ActionResult`/`AppError` (existing).
- Produces: `upsertGpsKredensialAction(input: UpsertGpsKredensialInput): Promise<ActionResult<void>>` (server action); `<GpsKendaraanKredensialForm existing={GpsKredensialRow[]} />` (client component, self-contained — owns its own dialog/inline-edit state, no props threaded from a parent list like `perusahaan-list.tsx`'s per-row dialogs, since these 2 rows are global, not per-PT).

- [ ] **Step 1: Add `upsertGpsKredensialAction` to `src/app/grup/perusahaan/actions.ts`**

Mirror `upsertKoneksiAction`'s validation style (non-empty username; per this task's Global Constraint, blank password on an existing row means "keep existing" — enforced already inside `upsertGpsKredensial`, Task 3).

- [ ] **Step 2: Write `GpsKendaraanKredensialForm`**

Two fixed rows (Hino Connect, SoloFleet) — not a dynamic add/remove list like `perusahaan-list.tsx`'s koneksi blocks, since there are exactly two known providers. Each row: username input, password input (`placeholder="(kosongkan untuk mempertahankan password saat ini)"` when `existing` already has a row for that provider), submit button. On submit, call `upsertGpsKredensialAction`; on `{success:false}`, show `result.error` (reuse whatever inline error display pattern `perusahaan-list.tsx` uses).

- [ ] **Step 3: Wire into `src/app/grup/perusahaan/page.tsx`**

Add `listGpsKredensial()` to the existing `Promise.all([...])`, pass the result to a newly rendered `<GpsKendaraanKredensialForm existing={gpsKredensial} />` placed below the existing `<PerusahaanList ... />` (or wherever fits the page's existing layout — this section is page-level, not per-PT-row, unlike everything `PerusahaanList` already renders).

- [ ] **Step 4: Manual verification via browser**

Start the dev server, navigate to `/grup/perusahaan`, confirm the two-row form renders, submit the real Hino/SoloFleet credentials (the same ones used manually during Discovery) for both providers, confirm no error toast/message, then re-run Task 8's manual sync script and confirm it now succeeds for both providers using the stored credentials (not hardcoded ones).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/gps-kendaraan-kredensial-form.tsx "src/app/grup/perusahaan/actions.ts" "src/app/grup/perusahaan/page.tsx"
git commit -m "feat: tambah form kredensial GPS Kendaraan di halaman admin Perusahaan"
```

---

### Task 11: Vehicle GPS map + list panel

**Files:**
- Create: `src/components/dashboard/vehicle-gps-panel.tsx`

**Interfaces:**
- Consumes: `getVehiclePositionsAction`/`getVehicleTrailAction`/`syncVehicleGpsPositionsAction` (Task 9); `VehiclePositionRow`/`VehicleTrailPoint` types (Task 7); existing `MapStyleSwitcher`/`MapZoomControl`/`MapAttribution`/`TILE_SOURCES` (`src/components/dashboard/map-controls.tsx`, `src/lib/map-styles.ts`).
- Produces: `export function VehicleGpsPanel({ initialPositions }: { initialPositions: VehiclePositionRow[] })` — mounted inside the new tab in Task 12.

- [ ] **Step 1: Build the static layout — map + side list, no polling yet**

Follow `route-map.tsx`'s structure (`MapContainer`, `TileLayer` keyed on `mapStyle`, `MapZoomControl`, `MapStyleSwitcher`, `MapAttribution`) with a `Marker` per `VehiclePositionRow` (reuse or adapt `route-map.tsx`'s `truckIcon(bearingDeg)` divIcon, using each vehicle's own `heading` instead of route-derived bearing). Render `initialPositions` as the starting state. Side list: one row per vehicle — plat nomor (or `plateRaw` with a distinct visual treatment when `armadaId` is null, e.g. an outlined "Belum terhubung ke Armada" badge), provider badge (Hino/SoloFleet), speed, "terakhir update X menit lalu" (compute from `recordedAt` client-side).

- [ ] **Step 2: Add the trail polyline with a time-range filter**

A small control (`1 jam` / `6 jam` / `24 jam`, matching this plan's UI conventions) that, on change, calls `getVehicleTrailAction(armadaId, hoursBack)` for the currently-selected vehicle (clicking a vehicle in the list or its marker selects it) and draws the result as a `Polyline`.

- [ ] **Step 3: Add the polling effect**

`useState` for `positions` initialized from `initialPositions`; a `useEffect` (mounted/unmounted with this component, i.e. only while this tab is the active `TabsContent` — confirm `TabsContent` unmounts inactive panels, matching `PengirimanTabs`'s existing behavior) with `setInterval(async () => { await syncVehicleGpsPositionsAction(); const r = await getVehiclePositionsAction(); if (r.success) setPositions(r.data); }, 45000)` (45s — within the spec's 30-60s range), cleared on unmount. Show a small "gagal sync: <provider>" indicator when the latest `syncVehicleGpsPositionsAction` result contains a `{ok: false}` entry (surfaces this plan's per-provider failure isolation to the user, per the design's error-handling section).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/vehicle-gps-panel.tsx
git commit -m "feat: tambah panel peta dan daftar GPS Kendaraan"
```

---

### Task 12: Wire the new tab into `pengiriman-tabs.tsx` and `delivery/page.tsx`

**Files:**
- Modify: `src/components/dashboard/pengiriman-tabs.tsx`
- Modify: `src/app/mkesindo/(dashboard)/delivery/page.tsx`

**Interfaces:**
- Consumes: `VehicleGpsPanel` (Task 11), `getVehiclePositionsAction` (Task 9, called at the page level for the initial fetch — server components can't call "use server" actions directly for a GET-style read, so instead import `getLatestVehiclePositions` from `src/lib/queries/armada-gps.ts` directly, matching how `page.tsx` already calls query functions like `getOpenDeliveries` directly rather than through their action wrappers).

- [ ] **Step 1: Add the 4th tab to `pengiriman-tabs.tsx`**

Add `{ value: "gps", label: "GPS Kendaraan" }` to the `TABS` array; add a `gpsPanel: React.ReactNode` prop and a matching `<TabsContent value="gps">{gpsPanel}</TabsContent>`.

- [ ] **Step 2: Fetch initial positions and pass the panel in `delivery/page.tsx`**

Add `getLatestVehiclePositions()` to the existing `Promise.all([...])`; pass `gpsPanel={<VehicleGpsPanel initialPositions={vehiclePositions} />}` into `<PengirimanTabs>`.

- [ ] **Step 3: Browser verification**

Start the dev server, log in, navigate to `/mkesindo/delivery`, click the new "GPS Kendaraan" tab, confirm: the map renders with truck markers at plausible positions, the side list shows plat nomor + provider badges, switching away from the tab and back doesn't error, waiting ~45s shows the "terakhir update" time refresh. Take a screenshot as proof.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/pengiriman-tabs.tsx "src/app/mkesindo/(dashboard)/delivery/page.tsx"
git commit -m "feat: tambahkan tab GPS Kendaraan ke halaman Pengiriman"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section has a task — schema (Task 1), credential encryption (Task 2), credential CRUD (Task 3), provider normalization contract (Task 4), both adapters (Task 5, 6), armada-gps query layer incl. retention (Task 7), isolated sync orchestration (Task 8), server actions incl. the explicit cron-migration reminder (Task 9), admin UI on the existing `/grup/perusahaan` page (Task 10), map/list/poller UI (Task 11), tab wiring (Task 12).
- **Review Focus coverage:** VIN-as-plate (Task 6 Step 5), WIB/UTC (Task 4 Steps 2-3, reused by both adapters), one-provider-down isolation (Task 8 Step 3), same-plate-two-providers tie-break (Task 7 Step 2), blank-password-keeps-existing (Task 3's `upsertGpsKredensial`, Task 10 Step 2's placeholder copy).
- **Known open unknown, called out explicitly rather than hidden:** SoloFleet's login form's exact field names (Task 5 Step 1) and Hino's Cognito auth flow detail (`USER_PASSWORD_AUTH` vs `USER_SRP_AUTH` — resolved by using `amazon-cognito-identity-js`, which handles either transparently) were not fully nailed down during Discovery; both tasks name the verification step that will surface a wrong guess immediately (a real HTTP call against real credentials), rather than leaving a silent gap.
- **No test runner in this repo:** every verification step uses `npx tsx` ad hoc scripts or the browser tools, consistent with `scripts/migrate-*.ts`'s existing convention — not `pytest`/`vitest`, which are not present in this codebase.
