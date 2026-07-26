# Manajemen Perusahaan (PT) untuk Superadmin — Design Spec

**Status:** Approved by user 2026-07-27, proceeding to implementation plan.

## Goal

This dashboard was built for one company (PT Mitra Kelola Esindo, database `MKEsindo`), but the underlying product is meant to serve many PTs, each with its own database, own business type (Es Kristal, Es Balok, ...), own Wilayah, and own pabrik coordinates. Right now that reality is hardcoded in two places — `pt-switcher.tsx`'s `ENTITIES`/`STATIC_REPORTS` arrays, and a disabled "+ Tambah PT lain (segera)" menu item that is literally a placeholder for this feature.

Give Superadmin a real place to register and manage future PTs: name, business type, Wilayah, pabrik coordinates, and (optionally, for whenever a PT's dashboard is actually built) its database connection credentials. This is a **registry/catalog only** — it does not make the live dashboard actually query a different database when a different PT is selected. That's explicitly out of scope; see below.

## Why this shape

- **Registry over live multi-tenant switching**: actually rewiring every query in this codebase (100+ files, all calling the single global `getPool()` from `src/lib/db.ts`) to be tenant-aware is a separate, much larger project. The near-term need is just to stop losing track of PTs that haven't been built yet — a catalog Superadmin can add to as new PTs come in, that the existing PT Switcher already has a UI slot for.
- **PT Switcher becomes the registry's only consumer for now**: `pt-switcher.tsx`'s hardcoded arrays are replaced by real rows from the new table. PT Mitra Kelola Esindo and PT Prima Maesa Putra are seeded as the first two rows (statuses `AktifPenuh` and `StandaloneHTML` respectively) so there is exactly one source of truth, not a hardcoded list plus a separate registry that could drift apart.
- **Nested under a new sidebar module, not under `/akun`**: per explicit user choice, "Perusahaan" gets its own entry in the sidebar's "Administrasi" section (where "Akun" already lives), visible only to Superadmin — same gate (`requireSuperAdmin()`), same section, just a second link instead of a second button inside the Akun page.
- **Password field is write-only**: the DB password is encrypted at rest and never sent back to the browser in readable form. This matches how a real secrets-management UI behaves and avoids ever exposing a live credential over the wire after the moment it's typed in.

## Data model

New table, `DashboardPerusahaan`:

```sql
CREATE TABLE DashboardPerusahaan (
  PerusahaanID INT IDENTITY PRIMARY KEY,
  Nama VARCHAR(128) NOT NULL,
  JenisBisnis VARCHAR(128) NULL,
  Wilayah VARCHAR(128) NULL,
  PabrikLatitude DECIMAL(10,7) NULL,
  PabrikLongitude DECIMAL(10,7) NULL,
  PabrikAlamat VARCHAR(512) NULL,
  Status VARCHAR(20) NOT NULL DEFAULT 'Draft', -- 'Draft' | 'StandaloneHTML' | 'AktifPenuh'
  StandaloneUrl VARCHAR(512) NULL,             -- only meaningful when Status = 'StandaloneHTML'
  DbServer VARCHAR(256) NULL,
  DbPort INT NULL,
  DbName VARCHAR(128) NULL,
  DbUser VARCHAR(128) NULL,
  DbPasswordEncrypted VARCHAR(512) NULL,       -- AES-256-GCM ciphertext (iv+authTag+ciphertext), base64url
  Catatan VARCHAR(1024) NULL,
  CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
  UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
  IsDeleted BIT NOT NULL DEFAULT 0
);
```

Seed data (part of the same migration, Task 0):
- `('PT Mitra Kelola Esindo', 'Es Kristal', 'Ponorogo', <pabrik lat/lng from DashboardPabrikLocation>, 'AktifPenuh', NULL, ...)`
- `('PT Prima Maesa Putra', 'Es Balok', 'Ponorogo', NULL, 'StandaloneHTML', '/static/prima-maesa-putra', ...)`

No DB credentials are seeded for either row — MKEsindo's own connection stays exactly where it is today (`src/lib/db.ts`, driven by env vars), this table does not replace or duplicate that. The credential fields exist for **future** PTs whose dashboards haven't been built yet, so whoever builds PT #3's dashboard later has the connection details already captured instead of chasing them down again.

## Security: credential encryption

New `src/lib/crypto-secret.ts`, separate from the existing `src/lib/crypto-token.ts`:
- `encryptSecret(plaintext: string): string` — AES-256-GCM, **random** IV per call (not the deterministic HMAC-derived IV `crypto-token.ts` uses for public links). Determinism is actively undesirable here: a stored secret has no "same link every time" requirement, and a random IV means two PTs that happen to share a password don't produce identical ciphertext.
- `decryptSecret(ciphertext: string): string` — reverses it. Both keyed off `AUTH_SECRET` with their own purpose prefix (`"perusahaan-db-credential"`), so this key is independent from both the invoice-token key and the payment-token key.
- The query layer (`src/lib/queries/perusahaan.ts`) never returns `DbPasswordEncrypted` or a decrypted password to any caller — `PerusahaanRow` exposes only `HasDbPassword: boolean`. Decryption exists in the module for whenever a future feature actually needs to open a connection with these credentials; nothing in this plan calls `decryptSecret` yet.
- The edit form's password field always renders empty with placeholder text ("(tidak diubah, kosongkan untuk tetap pakai yang lama)"); submitting blank leaves the stored credential untouched, submitting a value re-encrypts and overwrites it.

## Backend

### `src/lib/crypto-secret.ts` (new)
`encryptSecret`/`decryptSecret` as described above.

### `src/lib/queries/perusahaan.ts` (new)
```ts
export type PerusahaanStatus = "Draft" | "StandaloneHTML" | "AktifPenuh";

// Field names mirror the DB columns directly (PascalCase), matching the
// dominant convention across this codebase's newer query files (e.g.
// invoice-public.ts, sales-cards.ts, mitra-pengajuan.ts) rather than
// pabrik-location.ts's older camelCase style.
export interface PerusahaanRow {
  PerusahaanID: number;
  Nama: string;
  JenisBisnis: string | null;
  Wilayah: string | null;
  PabrikLatitude: number | null;
  PabrikLongitude: number | null;
  PabrikAlamat: string | null;
  Status: PerusahaanStatus;
  StandaloneUrl: string | null;
  DbServer: string | null;
  DbPort: number | null;
  DbName: string | null;
  DbUser: string | null;
  HasDbPassword: boolean;
  Catatan: string | null;
}

export interface PerusahaanInput {
  Nama: string;
  JenisBisnis: string | null;
  Wilayah: string | null;
  PabrikLatitude: number | null;
  PabrikLongitude: number | null;
  PabrikAlamat: string | null;
  Status: PerusahaanStatus;
  StandaloneUrl: string | null;
  DbServer: string | null;
  DbPort: number | null;
  DbName: string | null;
  DbUser: string | null;
  DbPassword: string | null; // null/blank on update = keep existing; always used as-is on create
  Catatan: string | null;
}

export async function listPerusahaan(): Promise<PerusahaanRow[]>;
export async function createPerusahaan(input: PerusahaanInput): Promise<number>; // returns PerusahaanID
export async function updatePerusahaan(id: number, input: PerusahaanInput): Promise<void>;
export async function softDeletePerusahaan(id: number): Promise<void>;

// Client-safe subset for the PT Switcher — no credential fields at all,
// not even the boolean, since the switcher has no business need for it.
export interface PerusahaanSwitcherEntry {
  PerusahaanID: number;
  Nama: string;
  Status: PerusahaanStatus;
  StandaloneUrl: string | null;
}
export async function listPerusahaanForSwitcher(): Promise<PerusahaanSwitcherEntry[]>; // excludes Status = 'Draft'
```

`updatePerusahaan` only touches `DbPasswordEncrypted` when `input.DbPassword` is non-blank (re-encrypts and overwrites); otherwise leaves the column as-is in the `UPDATE` statement.

### `src/app/(dashboard)/perusahaan/actions.ts` (new)
`"use server"` wrappers around `createPerusahaan`/`updatePerusahaan`/`softDeletePerusahaan`, each calling `requireSuperAdmin()` before doing anything (matching every other Super-Admin-only action in this codebase, e.g. `akun/actions.ts`), then `revalidatePath("/perusahaan")`. The switcher-list read path is called directly from the layout server component, no action needed.

### `src/app/(dashboard)/layout.tsx`
Fetch `listPerusahaanForSwitcher()` alongside the existing `session`/`profile` fetch, pass the result into `AppSidebar` as a new `perusahaanList` prop.

### `src/components/dashboard/app-sidebar.tsx`
- Accept `perusahaanList: PerusahaanSwitcherEntry[]` prop, thread it into `<PTSwitcher list={perusahaanList} />`.
- Add a second item to the existing `isSuperAdmin &&` Administrasi block: `Perusahaan` (icon `Building2`, already used elsewhere in this file's sibling `pt-switcher.tsx` — new import here), linking to `/perusahaan`.

### `src/components/dashboard/pt-switcher.tsx`
Remove the hardcoded `ENTITIES`/`STATIC_REPORTS` arrays. Accept `list: PerusahaanSwitcherEntry[]` prop instead:
- `Status: "AktifPenuh"` rows render as normal switchable entries (checkmark on whichever one — for now, always MKEsindo, since it's the only `AktifPenuh` row and there is no actual switching behavior yet; selecting a different `AktifPenuh` entry does nothing until the later live-multi-tenant project exists — out of scope here, so the item can be present but inert, same as today's single-entry list already effectively is).
- `Status: "StandaloneHTML"` rows render exactly like today's `STATIC_REPORTS` — external-link icon, opens `StandaloneUrl` in a new tab.
- `Status: "Draft"` rows are excluded entirely by `listPerusahaanForSwitcher()` — nothing to render.
- Remove the disabled "+ Tambah PT lain (segera)" item — that's now a real, working link (handled by the new sidebar entry, not the switcher itself).

## Frontend

### `src/components/dashboard/perusahaan-list.tsx` (new)
Card/table list of all `PerusahaanRow`s: Nama, Jenis Bisnis, Wilayah, Status (badge, color per status), "Ubah"/"Hapus" actions. "+ Tambah PT" button opens the same dialog component in create mode.

### `src/components/dashboard/perusahaan-form-dialog.tsx` (new)
Single dialog reused for create and edit (externally controlled via a `target: PerusahaanRow | "new" | null` prop, matching the `UbahPemesananDialog`/`ArmadaManager` list-to-form pattern already established in this codebase):
- Nama, Jenis Bisnis, Wilayah — text inputs.
- Pabrik: Latitude/Longitude/Alamat — reuses the same location-picker pattern as `PabrikLocationSettings`/`LocationViewMap` where practical, or plain numeric inputs if the map picker doesn't generalize cleanly (implementer's call, documented at implementation time).
- Status — select (`Draft` / `Standalone HTML` / `Aktif Penuh`); `StandaloneUrl` field only rendered/required when Status = `StandaloneHTML`.
- Kredensial DB (collapsible/optional section): Server, Port, Nama Database, Username, Password (always blank on open, placeholder as described above).
- Catatan — textarea.
- Delete is a separate confirm-then-call action from the list, not part of this dialog.

### `src/app/(dashboard)/perusahaan/page.tsx` (new)
Nested under `(dashboard)`, matching every other dashboard module's file layout (e.g. `(dashboard)/pemesanan/`) — this page needs the sidebar/header chrome, unlike the public token pages (`/invoice`, `/payment`) which deliberately sit outside `(dashboard)`. `requireSuperAdmin()`, fetches `listPerusahaan()`, renders `PerusahaanList`. Route resolves to `/perusahaan` (the `(dashboard)` segment is a route group, not a URL segment), matching `/akun` resolving from `(dashboard)/akun/page.tsx`.

## Error handling

- `createPerusahaan`/`updatePerusahaan` validate `Nama` is non-blank server-side (thrown `Error`, surfaced inline in the dialog — same pattern as every other create/edit dialog in this codebase).
- No cross-table references exist to this new table yet, so `softDeletePerusahaan` has no cascading-cleanup concerns.
- `decryptSecret` throwing (e.g. `AUTH_SECRET` rotated after data was encrypted) is a real but unreachable-today risk, since nothing calls it yet in this plan — noted for whoever builds the feature that eventually does.

## Out of scope (explicitly not building)

- Actually connecting to / querying a different PT's database from this dashboard when switched — the entire point of calling this a registry, not live multi-tenancy.
- A "Test Koneksi" button that dials the entered DB credentials from the server — not requested, and carries its own risk (server making arbitrary outbound connections to whatever host/port a Superadmin types in).
- Any change to how MKEsindo's own connection (`src/lib/db.ts`, env-var driven) works — untouched.
- Migrating `DashboardPabrikLocation`'s single-row pattern into this table for MKEsindo — the seed row copies its lat/lng for display purposes only; `DashboardPabrikLocation` remains the live source of truth the rest of the app (route validation, etc.) actually reads from.
