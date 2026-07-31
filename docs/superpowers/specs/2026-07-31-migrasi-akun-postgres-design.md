# Migrate Akun/Peran/Izin from MSSQL to Postgres (PMP Group as central account authority)

## Context

MKEsindo's MSSQL database (`DashboardUser`/`DashboardRole`/`DashboardRolePermission`) accidentally became the primary store for every dashboard login, even though the app now has a proper central Postgres "directory" DB (`pmp_directory`) built specifically to bridge multiple companies. Today, `src/lib/auth.ts`'s `authorize()` checks Postgres `akun_direktori` first (Direktur/PMPutra-only accounts) and falls back to MSSQL `DashboardUser` for every existing MKEsindo account — a two-hop lookup on every single login.

The user wants PMP Group (Postgres) to become the single central account authority for every PT's accounts, with each role's permission grid scoped independently per PT, and login resolving directly against Postgres with no fallback hop to another database.

Decisions locked during brainstorming (verbatim from the user, in order):
1. **Peran sepenuhnya terpisah per PT** — not one shared role definition with a per-PT permission overlay. Each PT owns its own independent set of roles; no role name/definition is shared across PTs.
2. **Satu akun hanya satu PT** — an account is never simultaneously scoped to more than one PT (mirrors the existing Direktur/PMPutra pattern already built).
3. **Pertahankan nilai RoleID yang sama persis** during migration — the 6 files that hardcode MKEsindo `RoleID` integers (`src/lib/roles.ts`'s `MARKETING_ROLE_ID`, `APPROVER_ROLE_IDS`, `STAFF_ROLE_ID`, `WILAYAH_MANAGER_ROLE_IDS`, plus their consumers) are **not touched** — the migration forces Postgres `peran.id` to match the old MSSQL `RoleID` exactly.
4. **Hapus/kosongkan MSSQL tables after verified migration** — but as an explicit, separate, user-confirmed step, not automatic.
5. **Gabung jadi satu halaman "Kelola Akun" dengan filter PT** — `/grup/akun` and `/grup/akun/direktori` merge into one page.

## What stays untouched

- `src/lib/db.ts`, `getPool()`, and every one of the ~52 existing MKEsindo query files (`src/lib/queries/*` for business data, not accounts) — this migration only touches the account/role/permission subsystem, not MKEsindo's operational data.
- `src/lib/require-access.ts` — `requireModuleAccess()`, `requireSuperAdmin()`, `requireGrupAccess()`, `requirePmputra()` are **not modified at all**. They only read `session.user.*` fields already on the JWT; the underlying data source moving from MSSQL to Postgres is invisible to them.
- Every one of the ~33 existing `requireModuleAccess(...)` call sites across ~16 page/action files — zero changes needed, by construction (same guarantee `getPool()` gave its 52 callers in the prior plan).
- `src/lib/permissions.ts`'s `MODULE_KEYS`/`PermissionMap`/`canView()`/`fullPermissionMap()` — unchanged; still the fixed list of MKEsindo's own modules. `peran_izin.module_key` is a plain string column, not constrained to this enum, so a future PT with its own module set is not blocked by this design.
- `src/types/next-auth.d.ts` — no new fields needed. `roleId`, `isSuperAdmin`, `permissions`, `accountScope`, `perusahaanId` already exist on `Session.user`/`User`/`JWT`; `roleId` simply starts referencing Postgres `peran.id` instead of MSSQL `RoleID` (same slot, same type).
- `proxy.ts` — unchanged; already routes purely on `accountScope`, which keeps meaning the same three values (`"mkesindo" | "direktur" | "pmputra"`).
- `scripts/migrate-directory-db.ts`, `perusahaan`/`perusahaan_koneksi` tables, `resolveKoneksi`/`getPool()`'s Postgres-backed MSSQL connection resolution (the *previous* plan's work) — completely separate concern from this one, not touched.

## Data model changes (Postgres, `pmp_directory`)

```sql
-- Role, now PT-scoped. `id` is a normal SERIAL, but the migration script
-- explicitly sets `id` on insert to match the old MSSQL RoleID, then
-- resyncs the sequence via setval() (step 2 below) — a standard, safe
-- Postgres pattern for preserving explicit IDs during a one-time import.
CREATE TABLE peran (
  id SERIAL PRIMARY KEY,
  perusahaan_id INT NOT NULL REFERENCES perusahaan(id),
  nama VARCHAR(64) NOT NULL,
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (perusahaan_id, nama)
);

CREATE TABLE peran_izin (
  peran_id INT NOT NULL REFERENCES peran(id) ON DELETE CASCADE,
  module_key VARCHAR(32) NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (peran_id, module_key)
);

-- akun_direktori renamed and broadened into the single universal accounts
-- table. `scope` ('direktur'/'pmputra') is DROPPED as a stored column —
-- it becomes a derived value at query time (perusahaan_id IS NULL ->
-- "direktur", else look up perusahaan.kode), avoiding a second source of
-- truth that could drift out of sync with perusahaan_id/peran_id.
ALTER TABLE akun_direktori RENAME TO akun;
ALTER TABLE akun ADD COLUMN peran_id INT REFERENCES peran(id);
ALTER TABLE akun ADD COLUMN nomor_telepon VARCHAR(32);
ALTER TABLE akun DROP COLUMN scope;
-- perusahaan_id already existed on akun_direktori (nullable — NULL means
-- Direktur). peran_id is nullable for the same reason: a Direktur account
-- has no perusahaan_id and no peran_id.
```

Constraint invariant (enforced in application code, not a DB CHECK, to keep the migration simple): `perusahaan_id IS NULL` if and only if `peran_id IS NULL` — an account is either a cross-company Direktur (both null) or a PT-scoped account with a role in that PT (both set).

`peran.is_super_admin` replaces `DashboardRole.IsSuperAdmin` — the `requireGrupAccess()` bridge (an MKEsindo-scoped superadmin account may also reach `/grup`) keeps working unmodified, since `session.user.isSuperAdmin` is still computed the same way, just sourced from `peran.is_super_admin` via a join instead of `DashboardRole.IsSuperAdmin`.

## Migration mechanics (one-off script, read-only against MSSQL)

`scripts/migrate-akun-to-postgres.ts` (run once via `npx tsx`, kept in the repo like `migrate-directory-db.ts` since it documents exactly what the cutover did — not deleted after use, unlike the smaller one-off seed scripts used elsewhere in this project):

1. Read all `DashboardRole` rows from MSSQL. For each, `INSERT INTO peran (id, perusahaan_id, nama, is_super_admin) VALUES (<RoleID>, <mkesindo's perusahaan.id>, RoleName, IsSuperAdmin)` — explicit `id` forces the exact old value.
2. `SELECT setval('peran_id_seq', (SELECT MAX(id) FROM peran))` — resyncs the auto-increment sequence so roles created later through the admin UI don't collide with migrated IDs.
3. Read all `DashboardRolePermission` rows. For each, `INSERT INTO peran_izin (peran_id, module_key, can_view, can_edit)` — `peran_id` matches directly since role IDs were preserved in step 1.
4. Read all `DashboardUser` rows. For each, `INSERT INTO akun (username, password_hash, nama, email, nomor_telepon, peran_id, perusahaan_id, is_active, failed_login_count, locked_until, last_login_at, last_login_ip)` with `perusahaan_id` = mkesindo's id and `peran_id` = the user's old `RoleID` (now a valid `peran.id` per step 1). `PasswordHash` is copied byte-for-byte — bcrypt hashes are self-contained (algorithm + salt + hash in one string) and portable, no re-hashing needed. Account `id` is a fresh auto-increment value; nothing in the codebase hardcodes a specific `UserID`, so no ID-preservation is needed here (unlike roles).
5. Verification pass: row counts must match exactly between MSSQL source and Postgres destination for all three tables (roles, role-permissions, users), plus a spot-check of a handful of random rows' field values.
6. This script never writes to MSSQL — it is strictly read-from-MSSQL, write-to-Postgres. Emptying the old MSSQL tables is a separate, later, explicitly-confirmed step (see Cutover).

## Auth rewrite (`src/lib/auth.ts`)

`authorize()` collapses to a single Postgres-only lookup — the `authorizeMkesindo()` MSSQL branch and the "try Postgres, fall through to MSSQL" pattern are deleted entirely:

```
authorize(username, password):
  row = findAkunByUsername(username)   // joins akun + peran + perusahaan
  if !row or !row.isActive: return null
  if row.lockedUntil > now: return null
  if !bcrypt.compare(password, row.passwordHash): record failure, return null
  record success
  return {
    id, name, username,
    roleId: row.peranId ?? 0,
    isSuperAdmin: row.isSuperAdmin ?? false,
    permissions: row.isSuperAdmin ? fullPermissionMap() : await getPermissionMapForPeran(row.peranId),
    accountScope: row.perusahaanId == null ? "direktur" : row.perusahaanKode,  // "mkesindo" | "pmputra" | future codes
    perusahaanId: row.perusahaanId,
  }
```

MSSQL `DashboardUser` is never queried during login after this change — this is what removes the "muter" behavior.

`getPermissionMapForRole(roleId)` (currently in `src/lib/queries/akun.ts`, MSSQL) is replaced by `getPermissionMapForPeran(peranId)` (new `src/lib/queries/akun.ts`, Postgres) — same input/output shape (`PermissionMap`), reading `peran_izin` instead of `DashboardRolePermission`.

## Admin UI (`src/lib/queries/akun.ts`, `/grup/akun`, `/grup/akun/peran`)

The old MSSQL `src/lib/queries/akun.ts` is deleted. `src/lib/queries/akun-direktori.ts` is renamed to `src/lib/queries/akun.ts` (Postgres) and extended with PT-aware CRUD: `listAkun(perusahaanIdOrNull)`, `createAkun`, `updateAkun`, `resetAkunPassword`, `deleteAkun`, `listPeranByPerusahaan(perusahaanId)`, `createPeran`, `deletePeran`, `getRolePermissionsForPerusahaan(perusahaanId)`, `setPeranIzin`. `countActiveSuperAdmins` becomes PT-scoped (counts active superadmin accounts within one `perusahaan_id`, since "at least one superadmin" is now a per-PT invariant, not a global one — a PT with zero accounts entirely, like a freshly-registered future PT, has no superadmin requirement to satisfy yet).

Pages:
- **`/grup/akun`** (merges the current `/grup/akun` + `/grup/akun/direktori`): one account list with a PT filter/tabs (Direktur / MKEsindo / PMPutra / future PTs). The create/edit form shows a Peran dropdown scoped to the selected PT when a PT is chosen; selecting "Direktur" hides the PT/Peran fields entirely (mirrors today's Direktur-account form).
- **`/grup/akun/peran`**: gains a PT selector at the top; the role list and permission grid shown are scoped to whichever PT is selected, not one flat global list.
- **`/grup/akun/direktori`**: retired, its functionality absorbed into `/grup/akun`.

Existing safety rules (can't delete your own logged-in account, can't demote/deactivate the last active superadmin) are preserved, now evaluated per-PT instead of globally.

## Cutover & rollback

1. Run the migration script (read-only against MSSQL, writes to Postgres), verify row counts and spot-check values.
2. Deploy the rewritten `auth.ts` (Postgres-only `authorize()`). This is the point of no automatic rollback — from here, every MKEsindo account must be able to log in through the new Postgres path, since the MSSQL path is no longer wired in at all.
3. This plan's own verification (direct scripts: confirm migrated row counts, confirm a known test account's bcrypt hash round-trips correctly) is not a substitute for a real login — per this session's standing rule, no browser-login automation is performed by the agent. **A real login by the user is the required final check**, same as the previous plan's residual item.
4. Emptying/dropping the old MSSQL credential data (`DashboardUser.PasswordHash` etc.) is **a separate step, only executed after the user explicitly confirms real logins are working** — not automatically part of this plan's execution, and not something the agent will do unprompted.

## Explicitly out of scope this pass

- Any change to PMPutra's actual module/query layer (still has zero real modules, per the prior plan's explicit deferral).
- Letting one account span multiple PTs (explicitly rejected during brainstorming).
- Sharing role definitions across PTs (explicitly rejected — each PT's roles are fully independent).
- Any change to `perusahaan`/`perusahaan_koneksi`/`resolveKoneksi`/MKEsindo's live MSSQL *data* connection — that's the prior, separate plan, already shipped.

## Risks

- **Point of no automatic rollback at cutover**: once `auth.ts` is deployed Postgres-only, every existing MKEsindo user's ability to log in depends entirely on the migration having copied their account correctly. Mitigated by: read-only migration script (MSSQL untouched until explicit later confirmation), row-count + spot-check verification before cutover, and old MSSQL data staying intact (not emptied) until the user confirms real logins work.
- **RoleID-preservation is load-bearing**: if the migration script's explicit-ID insert fails for any role (e.g. a permission or sequence conflict), the 6 files hardcoding MKEsindo RoleIDs would silently point at the wrong role post-migration. Verification must explicitly check that migrated `peran.id` values equal their source `RoleID` values, not just that row counts match.
- **Per-PT "at least one active superadmin" invariant**: existing `countActiveSuperAdmins`/`updateUserAction`/`deleteUserAction` guards must be re-scoped to `perusahaan_id`, not left global — otherwise deactivating MKEsindo's last superadmin could incorrectly be blocked (or allowed) based on some other PT's superadmin count.
