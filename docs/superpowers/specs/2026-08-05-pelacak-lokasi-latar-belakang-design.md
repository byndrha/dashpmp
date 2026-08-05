# Pelacak Lokasi Latar Belakang — Design Spec

**Company:** PT Mitra Kelola Esindo / PMP Group. **Module:** Android app-wide background location collection, with a first viewer built into the existing Pemasaran module.

## Goal

Continuous background GPS location tracking for every logged-in account on the Android app, laying the infrastructure so future role-specific features never have to build their own location collection from scratch. The first concrete use of this data: a live-position map for Marketing accounts, added to the existing Pemasaran module, viewable by the same Supervisor/Accounting/Manager/Super Admin tier that already manages Marketing oversight features there.

## Non-goals

- **Not Driver-specific for this version.** The user explicitly deferred Driver tracking/viewing — data collection still runs for every role (including Driver, once a Driver-role account exists and logs in on Android), but no Driver-facing viewer is built now.
- **Not a live in-page indicator for the tracked user.** The persistent Android notification (a platform requirement, not a design choice — see Architecture) is the only visible sign of tracking to the person being tracked; no additional in-app "you are being tracked" UI is built.
- **No iOS work.** This project's Capacitor config targets Android; iOS background location has entirely different platform mechanics and is out of scope.
- **No desktop/web tracking.** Background GPS only makes sense inside the native Android app wrapper. The tracking bootstrap explicitly no-ops when the app is opened in a regular desktop/mobile browser (`Capacitor.isNativePlatform()` gate).
- **No route-history UI beyond the live map's current scope.** The database stores full trail history (a deliberate choice — see Architecture), but this version's Marketing map shows only each account's latest position, not a full playback/timeline view. A future feature can query the same table for a specific person's route on a specific day without any schema change.

## Architecture

### Native plugin

The already-installed `@capacitor/geolocation` plugin was directly confirmed (by reading its native Android source) to have no foreground-service implementation at all — it is tied to the Activity lifecycle and will not reliably report location once the app is backgrounded for more than a short window. Real background tracking needs a plugin with its own Android foreground service.

Verified via live research against npm/GitHub (not from training memory): the most commonly cited option, `@capacitor-community/background-geolocation`, has an open, unfixed crash bug specifically on Capacitor 8 and should not be used. The chosen plugin is **`@capgo/background-geolocation`** — actively maintained, declares `@capacitor/core: >=8.0.0`, free (MPL-2.0, no license key needed for production unlike the paid Transistorsoft alternative), and bundles its own Android manifest entries (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` for Android 14+, `POST_NOTIFICATIONS` for Android 13+, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, on top of the `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION` already present) and handles the mandatory persistent notification itself — the app only supplies the notification's title/message text.

### Trigger

A small client component mounted once in the root layout (`src/app/layout.tsx`), gated on two conditions: `Capacitor.isNativePlatform()` (from `@capacitor/core` — false in any browser, true only inside the actual Android app) and an authenticated NextAuth session (`useSession()` from `next-auth/react`). Once both are true, it calls the plugin's start function with a ~1–2 minute update interval and a callback that fires on every position update. This applies uniformly to every account/role — the component itself carries no role-specific logic, matching the user's explicit "track everyone, so future role-specific features aren't confused" goal.

### Data flow and storage

Each position update from the native callback is sent to a new server action, which inserts one row into a new Postgres table (same database and access pattern as the `akun`/`akun_sesi` tables from the session-management feature):

```sql
CREATE TABLE akun_lokasi (
  id BIGSERIAL PRIMARY KEY,
  akun_id INTEGER NOT NULL REFERENCES akun(id),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX akun_lokasi_akun_id_recorded_at_idx ON akun_lokasi (akun_id, recorded_at DESC);
```

Per the user's explicit choice, this stores **full trail history** (one row per ping), not just a latest-position-only row — enabling a future route-playback feature without a schema change.

**Retention (30 days), self-cleaning on write:** rather than standing up a cron job or scheduled task (this project has no background-job infrastructure of its own), every insert also deletes that same account's rows older than 30 days, in the same request. This keeps the table bounded with zero new infrastructure — a pattern that only needs regular write traffic to stay effective, which continuous 1–2 minute pings guarantee.

### Viewer: Pemasaran module

A new panel/section on the existing `/pemasaran` page, gated the same way as the existing "Cakupan Wilayah Marketing" management feature there (`canManageWilayah`: Supervisor/Accounting/Manager/Super Admin — not Marketing accounts themselves, and not Superadmin-only the way the session-management page is). A new query fetches each Marketing account's (`roleId === MARKETING_ROLE_ID`) single most recent `akun_lokasi` row, and renders them as pins on a Leaflet map — reusing this project's existing multi-point map pattern (`MapContainer`/`TileLayer`/`Marker`/`Popup` from `react-leaflet`, the existing `MapStyleSwitcher`/`MapZoomControl`/`MapAttribution` controls, the same tile sources already defined in `src/lib/map-styles.ts`) rather than introducing a new mapping approach. Each pin shows the account's name and a "last updated X minutes ago" freshness label.

## Files

- Add dependency: `@capgo/background-geolocation`
- Create (DDL): `akun_lokasi` table in Postgres — one-off migration script, same pattern as prior Postgres schema changes in this project
- Create: `src/components/location-tracking-bootstrap.tsx` (client component: native + session gate, starts/stops the plugin, forwards position updates)
- Modify: `src/app/layout.tsx` (mount the bootstrap component once, app-wide)
- Create: `src/lib/queries/akun-lokasi.ts` (`recordLokasi`, `getLatestMarketingPositions`, and the self-cleaning retention delete)
- Create: a server action wrapping `recordLokasi` for the client bootstrap to call
- Modify: `src/app/(dashboard)/pemasaran/page.tsx` and a new `src/components/dashboard/marketing-location-map.tsx` (the map panel, gated by `canManageWilayah`)

## Open risks, explicitly accepted

- Exact plugin option field names (update interval, accuracy level, notification text config) were confirmed to exist via research but not verified character-for-character against the installed package's own TypeScript definitions — the implementation plan must read `node_modules/@capgo/background-geolocation`'s actual type definitions directly before writing the integration code, the same discipline already used for the Android offline-fallback feature.
- This plan cannot be verified end-to-end in this environment: no Android SDK/emulator is available here to confirm the foreground service, persistent notification, and background callback delivery actually work on a real device. The implementation plan must state this limitation plainly rather than claim a verification method that doesn't apply.
- Every account that logs into the Android app will see a persistent "location is being tracked" notification the moment this ships — a real, user-visible change across the whole workforce, already discussed directly with the user during design, not a silent side effect.
- `akun_lokasi` inherits the same one-time-disruption consideration as `akun_sesi` did NOT — this table is purely additive (no existing behavior depends on it), so there is no equivalent "everyone gets logged out" side effect here.
