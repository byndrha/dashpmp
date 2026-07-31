# Migrate Akun/Peran/Izin from MSSQL to Postgres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the authoritative account/role/permission store for every existing MKEsindo user out of MSSQL (`DashboardUser`/`DashboardRole`/`DashboardRolePermission`) into the central Postgres "directory" DB (`pmp_directory`), unify it with the existing Direktur/PMPutra accounts (`akun_direktori`), make roles fully PT-scoped, and collapse login into a single Postgres-only lookup — no more Postgres-then-MSSQL fallback.

**Architecture:** Two new Postgres tables (`peran`, `peran_izin`) replace `DashboardRole`/`DashboardRolePermission`, PT-scoped via `perusahaan_id`. `akun_direktori` is renamed to `akun` and gains `peran_id`/`nomor_telepon`, becoming the single accounts table for every scope (Direktur = `perusahaan_id`/`peran_id` both NULL; every PT-scoped account has both set). A one-off migration script copies existing MSSQL role/permission/user rows into Postgres, preserving `RoleID` values exactly so the 6 files hardcoding them need no changes. `src/lib/auth.ts`'s `authorize()` becomes a single Postgres lookup. `src/lib/require-access.ts` (and all ~33 existing `requireModuleAccess()` call sites) are untouched — they only read `session.user.*`, never a database directly. `/grup/akun` and `/grup/akun/direktori` merge into one page with a PT filter.

**Tech Stack:** Next.js 16 App Router, Server Actions, `pg` (Postgres) via `@/lib/pg`, `bcryptjs`, Node `crypto` (unrelated to this plan — no credential encryption needed here, passwords are bcrypt-hashed not encrypted).

## Global Constraints

- Direct-to-`main` workflow, no feature branch — explicit prior user consent, same as every prior plan this session.
- Push only on explicit user request — commit locally after each task, do not push until asked.
- No automated test runner in this project — verification is one-off `npx tsx` scripts (written, run, confirmed, then deleted — never committed) plus `npx tsc --noEmit` + `npx eslint` + `npx next build`.
- All new Postgres queries use `$1, $2, ...` positional parameters — never string-interpolate a value into SQL.
- **RoleID preservation is load-bearing.** `src/lib/roles.ts`'s `MARKETING_ROLE_ID`, `APPROVER_ROLE_IDS`, `STAFF_ROLE_ID`, `WILAYAH_MANAGER_ROLE_IDS` (consumed by `marketing-wilayah.ts`, `pemasaran/page.tsx`, `pemasaran/actions.ts`, `(dashboard)/page.tsx`, `mitra-pengajuan.ts`) reference raw MSSQL `RoleID` integers. The migration MUST insert `peran.id` with these exact same integer values — verify this explicitly, not just row counts.
- **One account, one PT** (or Direktur, cross-company, no PT) — never both a `perusahaan_id` and no `peran_id`, or vice versa. Enforce in application code on every create/update.
- **Roles are fully independent per PT** — no role definition is shared across `perusahaan_id` values. `UNIQUE (perusahaan_id, nama)` on `peran`, not a global unique name.
- `requireModuleAccess()`, `requireSuperAdmin()`, `requireGrupAccess()`, `requirePmputra()` in `src/lib/require-access.ts` must NOT be modified — they read `session.user.*` only.
- **Old MSSQL tables (`DashboardUser`/`DashboardRole`/`DashboardRolePermission`) are read-only in this plan and never emptied or dropped.** Emptying them is a separate, later, explicitly user-confirmed action outside this plan's execution — do not do it even after verification passes.
- Standing rule: no browser-login automation, even for verification — verify via direct Node/tsx scripts.

---

### Task 0: Postgres schema — `peran`, `peran_izin`, and `akun` changes (controller-run DDL)

**Files:** none (DDL run directly against the live `pmp_directory` Postgres database, not part of a code commit — same convention as the prior plan's Task 0)

- [ ] **Step 1: Run this DDL**

```sql
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

ALTER TABLE akun_direktori RENAME TO akun;
ALTER TABLE akun ADD COLUMN peran_id INT REFERENCES peran(id);
ALTER TABLE akun ADD COLUMN nomor_telepon VARCHAR(32);
ALTER TABLE akun DROP COLUMN scope;
```

Note: `ALTER TABLE ... RENAME` does **not** rename the table's existing constraints (e.g. the unique-username constraint stays named `akun_direktori_username_key`, not `akun_username_key`) — this is expected and handled in Task 4 by matching on `/username_key/i` instead of the old table-specific name, not by renaming the constraint here.

- [ ] **Step 2: Verify**

Run:
```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'akun' ORDER BY ordinal_position;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'peran' ORDER BY ordinal_position;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'peran_izin' ORDER BY ordinal_position;
```
Expected: `akun` has `peran_id` (integer, nullable) and `nomor_telepon` (character varying, nullable), no `scope` column. `peran` has `id, perusahaan_id, nama, is_super_admin, created_at, updated_at`. `peran_izin` has `peran_id, module_key, can_view, can_edit`.

```sql
SELECT count(*) FROM akun; -- expect 2 (the existing Direktur/PMPutra test accounts, if any were created; 0 is also fine if none exist yet)
```

---

### Task 1: Migration script — copy MSSQL roles/permissions/users into Postgres (controller-run)

**Files:**
- Create: `scripts/migrate-akun-to-postgres.ts` (kept in the repo afterward — documents exactly what the cutover did, same convention as `scripts/migrate-directory-db.ts`, unlike the smaller one-off seed scripts used elsewhere in this project that get deleted)

**Interfaces:**
- Consumes: `getPool as getMssqlPool, sql` from `@/lib/db` (existing), `getPgPool` from `@/lib/pg` (existing).

- [ ] **Step 1: Write the file**

```ts
// One-off migration: copies DashboardRole/DashboardRolePermission/DashboardUser
// from MSSQL into Postgres (peran/peran_izin/akun), preserving RoleID values
// exactly. Read-only against MSSQL — never writes there. Safe to re-run
// (roles/permissions use ON CONFLICT upsert; users are skipped if already
// present by username).
//
// Usage: npx tsx scripts/migrate-akun-to-postgres.ts
import "dotenv/config";
import { getPool as getMssqlPool } from "../src/lib/db";
import { getPgPool } from "../src/lib/pg";

interface MssqlRole {
  RoleID: number;
  RoleName: string;
  IsSuperAdmin: boolean;
}
interface MssqlRolePermission {
  RoleID: number;
  ModuleKey: string;
  CanView: boolean;
  CanEdit: boolean;
}
interface MssqlUser {
  UserID: number;
  Nama: string;
  Username: string;
  PasswordHash: string;
  NomorTelepon: string | null;
  Email: string | null;
  RoleID: number;
  IsActive: boolean;
  FailedLoginCount: number | null;
  LockedUntil: Date | null;
  LastLoginAt: Date | null;
  LastLoginIP: string | null;
}

async function main() {
  const mssql = await getMssqlPool();
  const pg = getPgPool();

  const perusahaanRow = await pg.query(`SELECT id FROM perusahaan WHERE kode = 'mkesindo'`);
  if (perusahaanRow.rows.length === 0) throw new Error('No perusahaan row with kode="mkesindo" — run migrate-directory-db.ts first.');
  const mkesindoId = perusahaanRow.rows[0].id as number;

  // 1. Roles — explicit id preserves the exact MSSQL RoleID.
  const rolesResult = await mssql.request().query(`SELECT RoleID, RoleName, IsSuperAdmin FROM DashboardRole`);
  const roles = rolesResult.recordset as MssqlRole[];
  for (const r of roles) {
    await pg.query(
      `INSERT INTO peran (id, perusahaan_id, nama, is_super_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET nama = EXCLUDED.nama, is_super_admin = EXCLUDED.is_super_admin`,
      [r.RoleID, mkesindoId, r.RoleName, r.IsSuperAdmin]
    );
  }
  await pg.query(`SELECT setval('peran_id_seq', (SELECT COALESCE(MAX(id), 1) FROM peran))`);
  console.log(`Migrated ${roles.length} roles (IDs preserved).`);

  // 2. Role permissions.
  const permsResult = await mssql.request().query(`SELECT RoleID, ModuleKey, CanView, CanEdit FROM DashboardRolePermission`);
  const perms = permsResult.recordset as MssqlRolePermission[];
  for (const p of perms) {
    await pg.query(
      `INSERT INTO peran_izin (peran_id, module_key, can_view, can_edit)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (peran_id, module_key) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
      [p.RoleID, p.ModuleKey, p.CanView, p.CanEdit]
    );
  }
  console.log(`Migrated ${perms.length} role permissions.`);

  // 3. Users — password_hash copied byte-for-byte (bcrypt hashes are
  // self-contained and portable, no re-hashing). New auto-increment akun.id
  // is fine; nothing in the codebase hardcodes a specific UserID.
  const usersResult = await mssql.request().query(`
    SELECT UserID, Nama, Username, PasswordHash, NomorTelepon, Email, RoleID, IsActive,
           FailedLoginCount, LockedUntil, LastLoginAt, LastLoginIP
    FROM DashboardUser
  `);
  const users = usersResult.recordset as MssqlUser[];
  let migrated = 0;
  let skipped = 0;
  for (const u of users) {
    const exists = await pg.query(`SELECT 1 FROM akun WHERE username = $1`, [u.Username]);
    if ((exists.rowCount ?? 0) > 0) {
      skipped++;
      continue;
    }
    await pg.query(
      `INSERT INTO akun
         (username, password_hash, nama, email, nomor_telepon, peran_id, perusahaan_id,
          is_active, failed_login_count, locked_until, last_login_at, last_login_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        u.Username, u.PasswordHash, u.Nama, u.Email, u.NomorTelepon, u.RoleID, mkesindoId,
        u.IsActive, u.FailedLoginCount ?? 0, u.LockedUntil, u.LastLoginAt, u.LastLoginIP,
      ]
    );
    migrated++;
  }
  console.log(`Migrated ${migrated} users, skipped ${skipped} already-present (of ${users.length} MSSQL source rows).`);

  // 4. Verification — row counts and RoleID-preservation spot-check.
  const pgRoleCount = await pg.query(`SELECT count(*) FROM peran WHERE perusahaan_id = $1`, [mkesindoId]);
  const pgUserCount = await pg.query(`SELECT count(*) FROM akun WHERE perusahaan_id = $1`, [mkesindoId]);
  console.log(`Postgres peran count (mkesindo): ${pgRoleCount.rows[0].count} vs MSSQL DashboardRole: ${roles.length}`);
  console.log(`Postgres akun count (mkesindo): ${pgUserCount.rows[0].count} vs MSSQL DashboardUser: ${users.length}`);

  for (const r of roles) {
    const check = await pg.query(`SELECT nama, is_super_admin FROM peran WHERE id = $1`, [r.RoleID]);
    const ok = check.rows[0]?.nama === r.RoleName && check.rows[0]?.is_super_admin === r.IsSuperAdmin;
    console.log(`  RoleID ${r.RoleID} ("${r.RoleName}") preserved correctly: ${ok}`);
    if (!ok) {
      console.error("MIGRATION FAILED: RoleID mismatch detected.");
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the live databases**

Run: `npx tsx scripts/migrate-akun-to-postgres.ts`

Expected: prints migrated counts for roles/permissions/users, then a `RoleID N ("...") preserved correctly: true` line for every single MSSQL role — every line must say `true`. If any says `false`, stop and investigate before proceeding to any later task; do not touch MSSQL.

- [ ] **Step 3: Independent spot-check**

Run this read-only verification (adjust the sample username to a real one from the printed migration, e.g. any known active account):
```sql
-- Against Postgres:
SELECT a.username, a.nama, r.nama AS peran_nama, r.is_super_admin, a.perusahaan_id
FROM akun a JOIN peran r ON r.id = a.peran_id
WHERE a.perusahaan_id = (SELECT id FROM perusahaan WHERE kode = 'mkesindo')
ORDER BY a.nama;
```
Compare a handful of rows by eye against the equivalent `SELECT du.Username, du.Nama, r.RoleName, r.IsSuperAdmin FROM DashboardUser du JOIN DashboardRole r ON r.RoleID = du.RoleID` against MSSQL — names, roles, and superadmin flags must match exactly.

- [ ] **Step 4: Commit the script**

```bash
git add scripts/migrate-akun-to-postgres.ts
git commit -m "Add migration script: copy MSSQL Akun/Peran/Izin into Postgres"
```

(No `git status` cleanup needed here — unlike the smaller seed scripts elsewhere in this project, this one is kept, matching `migrate-directory-db.ts`'s precedent as a durable record of the cutover.)

---

### Task 2: `src/lib/queries/akun.ts` — unified Postgres query module

**Files:**
- Create (overwrites, after deleting the old MSSQL-backed file first): `src/lib/queries/akun.ts`
- Delete: `src/lib/queries/akun-direktori.ts` (fully absorbed into the new `akun.ts`)
- Modify (import path only, `@/lib/queries/akun-direktori` → `@/lib/queries/akun`): `src/app/grup/perusahaan/page.tsx`, `src/components/dashboard/perusahaan-form-dialog.tsx`, `src/components/dashboard/perusahaan-list.tsx`

**Interfaces:**
- Consumes: `getPgPool` from `@/lib/pg`, `MODULE_KEYS`/`ModuleKey`/`PermissionMap` from `@/lib/permissions`.
- Produces (all consumed by later tasks): `AkunAuthRow`, `findAkunByUsername(username)`, `recordFailedLogin(id, currentFailedCount)`, `recordSuccessfulLogin(id, ip)`, `getPermissionMapForPeran(peranId)` — used by Task 3. `OwnProfileRow`, `getUserById(id)`, `updateOwnProfile(input)`, `changeOwnPassword(input)` — names/shapes preserved exactly, zero changes needed in `src/app/(dashboard)/profile-actions.ts` or `src/app/(dashboard)/layout.tsx`. `PerusahaanDirektoriOption`, `listPerusahaanDirektori()` — preserved exactly for the 3 import-path-only files above. `AkunRow`, `listAkun()`, `countActiveSuperAdmins(perusahaanId, excludeAkunId?)`, `CreateAkunInput`, `createAkun(input)`, `UpdateAkunInput`, `updateAkun(input)`, `resetAkunPassword(id, newPassword)`, `deleteAkun(id)` — used by Task 4. `PeranRow`, `listAllPeran()`, `PeranIzinRow`, `getAllPeranIzin()`, `createPeran(perusahaanId, nama)`, `deletePeran(peranId)`, `setPeranIzin(input)` — used by Task 5.

- [ ] **Step 1: Delete the old MSSQL query file**

```bash
rm src/lib/queries/akun-direktori.ts
```
(Its contents are being absorbed into the new file below — this isn't a data loss, it's a rename-with-expansion.)

- [ ] **Step 2: Write the new `src/lib/queries/akun.ts`**

```ts
import bcrypt from "bcryptjs";
import { getPgPool } from "@/lib/pg";
import { MODULE_KEYS, type ModuleKey, type PermissionMap } from "@/lib/permissions";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

// ---------- Auth (consumed by auth.ts's single-stage authorize()) ----------

export interface AkunAuthRow {
  id: number;
  username: string;
  passwordHash: string;
  nama: string;
  peranId: number | null;
  perusahaanId: number | null;
  perusahaanKode: string | null; // null only for Direktur accounts
  isSuperAdmin: boolean;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export async function findAkunByUsername(username: string): Promise<AkunAuthRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT a.id, a.username, a.password_hash, a.nama, a.peran_id, a.perusahaan_id, p.kode AS perusahaan_kode,
            COALESCE(r.is_super_admin, false) AS is_super_admin,
            a.is_active, a.failed_login_count, a.locked_until
     FROM akun a
     LEFT JOIN perusahaan p ON p.id = a.perusahaan_id
     LEFT JOIN peran r ON r.id = a.peran_id
     WHERE a.username = $1`,
    [username]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    nama: row.nama,
    peranId: row.peran_id,
    perusahaanId: row.perusahaan_id,
    perusahaanKode: row.perusahaan_kode,
    isSuperAdmin: row.is_super_admin,
    isActive: row.is_active,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
  };
}

export async function recordFailedLogin(id: number, currentFailedCount: number): Promise<void> {
  const pool = getPgPool();
  const newFailedCount = currentFailedCount + 1;
  const lockedUntil = newFailedCount >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
  await pool.query(`UPDATE akun SET failed_login_count = $1, locked_until = $2 WHERE id = $3`, [
    newFailedCount,
    lockedUntil,
    id,
  ]);
}

export async function recordSuccessfulLogin(id: number, ip: string | null): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE akun SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), last_login_ip = $1, updated_at = now()
     WHERE id = $2`,
    [ip, id]
  );
}

export async function getPermissionMapForPeran(peranId: number): Promise<PermissionMap> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT module_key, can_view, can_edit FROM peran_izin WHERE peran_id = $1`, [peranId]);
  const map: PermissionMap = {};
  for (const row of result.rows as { module_key: string; can_view: boolean; can_edit: boolean }[]) {
    if ((MODULE_KEYS as readonly string[]).includes(row.module_key)) {
      map[row.module_key as ModuleKey] = { canView: row.can_view, canEdit: row.can_edit };
    }
  }
  return map;
}

// ---------- Own profile — names/shapes preserved exactly for
// src/app/(dashboard)/profile-actions.ts and src/app/(dashboard)/layout.tsx,
// which import getUserById/updateOwnProfile/changeOwnPassword and must not
// need any changes. ----------

export interface OwnProfileRow {
  nama: string;
  username: string;
  nomorTelepon: string | null;
  email: string | null;
}

export async function getUserById(id: number): Promise<OwnProfileRow | null> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT nama, username, nomor_telepon, email FROM akun WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return { nama: row.nama, username: row.username, nomorTelepon: row.nomor_telepon, email: row.email };
}

export async function updateOwnProfile(input: {
  userId: number;
  nama: string;
  nomorTelepon: string | null;
  email: string | null;
}): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE akun SET nama = $1, nomor_telepon = $2, email = $3, updated_at = now() WHERE id = $4`, [
    input.nama,
    input.nomorTelepon,
    input.email,
    input.userId,
  ]);
}

export async function changeOwnPassword(input: {
  userId: number;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT password_hash FROM akun WHERE id = $1`, [input.userId]);
  const row = result.rows[0] as { password_hash: string } | undefined;
  if (!row) throw new Error("Akun tidak ditemukan.");

  const currentOk = await bcrypt.compare(input.currentPassword, row.password_hash);
  if (!currentOk) throw new Error("Password saat ini salah.");

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await pool.query(`UPDATE akun SET password_hash = $1, updated_at = now() WHERE id = $2`, [passwordHash, input.userId]);
}

// ---------- Perusahaan lookup — preserved exactly for perusahaan-form-dialog.tsx,
// perusahaan-list.tsx, grup/perusahaan/page.tsx (previous plan's admin UI). ----------

export interface PerusahaanDirektoriOption {
  id: number;
  kode: string;
  nama: string;
}

export async function listPerusahaanDirektori(): Promise<PerusahaanDirektoriOption[]> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT id, kode, nama FROM perusahaan ORDER BY nama`);
  return result.rows;
}

// ---------- Admin: Akun CRUD (consumed by /grup/akun) ----------

export interface AkunRow {
  id: number;
  username: string;
  nama: string;
  email: string | null;
  nomorTelepon: string | null;
  perusahaanId: number | null;
  perusahaanNama: string | null; // null for Direktur
  perusahaanKode: string | null; // null for Direktur
  peranId: number | null;
  peranNama: string | null; // null for Direktur
  isActive: boolean;
  lastLoginAt: Date | null;
}

export async function listAkun(): Promise<AkunRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT a.id, a.username, a.nama, a.email, a.nomor_telepon,
           a.perusahaan_id, p.nama AS perusahaan_nama, p.kode AS perusahaan_kode,
           a.peran_id, r.nama AS peran_nama,
           a.is_active, a.last_login_at
    FROM akun a
    LEFT JOIN perusahaan p ON p.id = a.perusahaan_id
    LEFT JOIN peran r ON r.id = a.peran_id
    ORDER BY a.nama
  `);
  return result.rows.map((row) => ({
    id: row.id,
    username: row.username,
    nama: row.nama,
    email: row.email,
    nomorTelepon: row.nomor_telepon,
    perusahaanId: row.perusahaan_id,
    perusahaanNama: row.perusahaan_nama,
    perusahaanKode: row.perusahaan_kode,
    peranId: row.peran_id,
    peranNama: row.peran_nama,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
  }));
}

// PT-scoped: "at least one active superadmin" is now an invariant per
// perusahaan_id, not global — a Direktur-only account count (perusahaanId
// null) never needs this check.
export async function countActiveSuperAdmins(perusahaanId: number, excludeAkunId?: number): Promise<number> {
  const pool = getPgPool();
  const params: unknown[] = [perusahaanId];
  let query = `
    SELECT count(*) FROM akun a
    JOIN peran r ON r.id = a.peran_id
    WHERE a.perusahaan_id = $1 AND r.is_super_admin = true AND a.is_active = true
  `;
  if (excludeAkunId != null) {
    params.push(excludeAkunId);
    query += ` AND a.id <> $2`;
  }
  const result = await pool.query(query, params);
  return Number(result.rows[0].count);
}

export interface CreateAkunInput {
  nama: string;
  username: string;
  password: string;
  email: string | null;
  nomorTelepon: string | null;
  perusahaanId: number | null; // null = Direktur
  peranId: number | null; // null = Direktur
}

export async function createAkun(input: CreateAkunInput): Promise<void> {
  const pool = getPgPool();
  const passwordHash = await bcrypt.hash(input.password, 12);
  await pool.query(
    `INSERT INTO akun (username, password_hash, nama, email, nomor_telepon, perusahaan_id, peran_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.username, passwordHash, input.nama, input.email, input.nomorTelepon, input.perusahaanId, input.peranId]
  );
}

export interface UpdateAkunInput {
  id: number;
  nama: string;
  email: string | null;
  nomorTelepon: string | null;
  perusahaanId: number | null;
  peranId: number | null;
  isActive: boolean;
}

export async function updateAkun(input: UpdateAkunInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE akun SET nama = $1, email = $2, nomor_telepon = $3, perusahaan_id = $4, peran_id = $5, is_active = $6, updated_at = now()
     WHERE id = $7`,
    [input.nama, input.email, input.nomorTelepon, input.perusahaanId, input.peranId, input.isActive, input.id]
  );
}

export async function resetAkunPassword(id: number, newPassword: string): Promise<void> {
  const pool = getPgPool();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    `UPDATE akun SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $2`,
    [passwordHash, id]
  );
}

export async function deleteAkun(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM akun WHERE id = $1`, [id]);
}

// ---------- Admin: Peran CRUD (consumed by /grup/akun/peran). "listAll"/
// "getAll" (not per-PT-filtered server-side) matches the established
// pattern from the previous plan's listAllKoneksi() — small table, UI
// filters client-side by the selected PT. ----------

export interface PeranRow {
  id: number;
  perusahaanId: number;
  nama: string;
  isSuperAdmin: boolean;
  akunCount: number;
}

export async function listAllPeran(): Promise<PeranRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT r.id, r.perusahaan_id, r.nama, r.is_super_admin,
           (SELECT count(*) FROM akun a WHERE a.peran_id = r.id) AS akun_count
    FROM peran r
    ORDER BY r.perusahaan_id, r.is_super_admin DESC, r.nama
  `);
  return result.rows.map((row) => ({
    id: row.id,
    perusahaanId: row.perusahaan_id,
    nama: row.nama,
    isSuperAdmin: row.is_super_admin,
    akunCount: Number(row.akun_count),
  }));
}

export interface PeranIzinRow {
  peranId: number;
  moduleKey: string;
  canView: boolean;
  canEdit: boolean;
}

export async function getAllPeranIzin(): Promise<PeranIzinRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT peran_id, module_key, can_view, can_edit FROM peran_izin`);
  return result.rows.map((row) => ({
    peranId: row.peran_id,
    moduleKey: row.module_key,
    canView: row.can_view,
    canEdit: row.can_edit,
  }));
}

export async function createPeran(perusahaanId: number, nama: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(`INSERT INTO peran (perusahaan_id, nama) VALUES ($1, $2)`, [perusahaanId, nama]);
}

export async function deletePeran(peranId: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM peran_izin WHERE peran_id = $1`, [peranId]);
  await pool.query(`DELETE FROM peran WHERE id = $1`, [peranId]);
}

export async function setPeranIzin(input: {
  peranId: number;
  moduleKey: ModuleKey;
  canView: boolean;
  canEdit: boolean;
}): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO peran_izin (peran_id, module_key, can_view, can_edit)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (peran_id, module_key) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
    [input.peranId, input.moduleKey, input.canView, input.canEdit]
  );
}
```

- [ ] **Step 3: Confirm the old MSSQL content is fully gone**

Step 2 already overwrote `src/lib/queries/akun.ts` in place — the old MSSQL-backed functions (`listUsers`, the old `getUserById`, `listRoles`, `getRolePermissions`, `createUser`, `updateUser`, `resetUserPassword`, `deleteUser`, `createRole`, `deleteRole`, `setRolePermission`) no longer exist anywhere in the file.

Run: `grep -n "DashboardUser\|DashboardRole\|from \"@/lib/db\"" src/lib/queries/akun.ts`
Expected: no output — the new file has zero references to MSSQL tables or `@/lib/db`.

- [ ] **Step 4: Fix the 3 import-path-only consumers**

In `src/app/grup/perusahaan/page.tsx`, change:
```ts
import { listPerusahaanDirektori } from "@/lib/queries/akun-direktori";
```
to:
```ts
import { listPerusahaanDirektori } from "@/lib/queries/akun";
```

In `src/components/dashboard/perusahaan-form-dialog.tsx`, change:
```ts
import type { PerusahaanDirektoriOption } from "@/lib/queries/akun-direktori";
```
to:
```ts
import type { PerusahaanDirektoriOption } from "@/lib/queries/akun";
```

In `src/components/dashboard/perusahaan-list.tsx`, change:
```ts
import type { PerusahaanDirektoriOption } from "@/lib/queries/akun-direktori";
```
to:
```ts
import type { PerusahaanDirektoriOption } from "@/lib/queries/akun";
```

- [ ] **Step 5: Verify with a one-off script against the live Postgres database**

Create `scripts/verify-akun.ts`:
```ts
import "dotenv/config";
import {
  findAkunByUsername,
  getPermissionMapForPeran,
  listAkun,
  listAllPeran,
  getAllPeranIzin,
  countActiveSuperAdmins,
  createAkun,
  updateAkun,
  resetAkunPassword,
  deleteAkun,
  createPeran,
  deletePeran,
  listPerusahaanDirektori,
} from "../src/lib/queries/akun";

async function main() {
  const perusahaanList = await listPerusahaanDirektori();
  const mkesindo = perusahaanList.find((p) => p.kode === "mkesindo");
  if (!mkesindo) throw new Error("mkesindo perusahaan row not found — did Task 1's migration run?");

  const akunBefore = await listAkun();
  console.log("Akun count (should include migrated MKEsindo users):", akunBefore.length);

  const peranList = await listAllPeran();
  const mkeRole = peranList.find((p) => p.perusahaanId === mkesindo.id && !p.isSuperAdmin);
  console.log("Found a non-superadmin MKEsindo peran to test with:", mkeRole?.nama);
  if (!mkeRole) throw new Error("No non-superadmin MKEsindo role found to test against.");

  const permMap = await getPermissionMapForPeran(mkeRole.id);
  console.log("Permission map for that role has keys:", Object.keys(permMap));

  const superAdminCountBefore = await countActiveSuperAdmins(mkesindo.id);
  console.log("Active MKEsindo superadmins:", superAdminCountBefore, "— expect >= 1");

  // Full CRUD round-trip on a throwaway test account + role.
  await createPeran(mkesindo.id, "Verify Test Role");
  const peranAfterCreate = await listAllPeran();
  const testRole = peranAfterCreate.find((p) => p.nama === "Verify Test Role" && p.perusahaanId === mkesindo.id);
  console.log("Test role created:", !!testRole);
  if (!testRole) throw new Error("Test role creation failed");

  await createAkun({
    nama: "Verify Test User",
    username: "verify_test_user_akun_migration",
    password: "testpass123",
    email: null,
    nomorTelepon: null,
    perusahaanId: mkesindo.id,
    peranId: testRole.id,
  });
  const akunAfterCreate = await listAkun();
  const testAkun = akunAfterCreate.find((a) => a.username === "verify_test_user_akun_migration");
  console.log("Test akun created:", !!testAkun, "peranNama:", testAkun?.peranNama);
  if (!testAkun) throw new Error("Test akun creation failed");

  const authRow = await findAkunByUsername("verify_test_user_akun_migration");
  console.log("findAkunByUsername resolves:", authRow?.nama, "isSuperAdmin:", authRow?.isSuperAdmin, "perusahaanKode:", authRow?.perusahaanKode);

  await updateAkun({
    id: testAkun.id,
    nama: "Verify Test User Updated",
    email: null,
    nomorTelepon: null,
    perusahaanId: mkesindo.id,
    peranId: testRole.id,
    isActive: true,
  });
  await resetAkunPassword(testAkun.id, "newtestpass456");
  const akunAfterUpdate = (await listAkun()).find((a) => a.id === testAkun.id);
  console.log("Name updated:", akunAfterUpdate?.nama === "Verify Test User Updated");

  await deleteAkun(testAkun.id);
  await deletePeran(testRole.id);
  const akunAfterDelete = await listAkun();
  const peranAfterDelete = await listAllPeran();
  console.log("Test akun gone:", !akunAfterDelete.some((a) => a.id === testAkun.id));
  console.log("Test role gone:", !peranAfterDelete.some((p) => p.id === testRole.id));

  const izin = await getAllPeranIzin();
  console.log("getAllPeranIzin row count:", izin.length, "— expect > 0 (migrated from DashboardRolePermission)");

  if (
    !mkesindo ||
    !mkeRole ||
    superAdminCountBefore < 1 ||
    !testRole ||
    !testAkun ||
    authRow?.perusahaanKode !== "mkesindo" ||
    akunAfterUpdate?.nama !== "Verify Test User Updated" ||
    akunAfterDelete.some((a) => a.id === testAkun.id) ||
    peranAfterDelete.some((p) => p.id === testRole.id) ||
    izin.length === 0
  ) {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/verify-akun.ts`
Expected output ends with `PASS`. Then delete the script.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit` — expect errors confined to `src/lib/auth.ts` (still importing the now-deleted old `akun-direktori.ts` names, fixed in Task 3), `src/app/grup/akun/*`, `src/app/grup/akun/peran/*`, `src/components/dashboard/akun-list.tsx`, `src/components/dashboard/akun-direktori-list.tsx`, `src/components/dashboard/peran-editor.tsx` (all fixed in Tasks 3-5) — not in `src/lib/queries/akun.ts` itself or the 3 files touched in Step 4.
Run: `npx eslint src/lib/queries/akun.ts "src/app/grup/perusahaan/page.tsx" src/components/dashboard/perusahaan-form-dialog.tsx src/components/dashboard/perusahaan-list.tsx` — expect no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/akun.ts "src/app/grup/perusahaan/page.tsx" src/components/dashboard/perusahaan-form-dialog.tsx src/components/dashboard/perusahaan-list.tsx
git rm src/lib/queries/akun-direktori.ts
git commit -m "Replace MSSQL akun.ts with unified Postgres akun/peran/peran_izin query layer"
```

---

### Task 3: Rewrite `src/lib/auth.ts` — single-stage Postgres login (HIGH RISK)

**Files:**
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Consumes: `findAkunByUsername`, `recordFailedLogin`, `recordSuccessfulLogin`, `getPermissionMapForPeran` from `@/lib/queries/akun` (Task 2).
- Produces: `authorize()` behavior — same external contract (NextAuth `Credentials` provider), no changes to `src/types/next-auth.d.ts` (already has `accountScope`/`perusahaanId`/`roleId`/`isSuperAdmin`/`permissions` on `Session.user`/`User`/`JWT`).

This removes MSSQL from the login path entirely. `proxy.ts`, `require-access.ts`, and every page's `requireModuleAccess()` call are unaffected — they only read `session.user.*`.

- [ ] **Step 1: Replace the whole file**

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import {
  findAkunByUsername,
  recordFailedLogin,
  recordSuccessfulLogin,
  getPermissionMapForPeran,
} from "@/lib/queries/akun";
import { fullPermissionMap } from "@/lib/permissions";

type AccountScope = "mkesindo" | "direktur" | "pmputra";

interface AuthorizedUser {
  id: string;
  name: string;
  username: string;
  roleId: number;
  isSuperAdmin: boolean;
  permissions: ReturnType<typeof fullPermissionMap>;
  accountScope: AccountScope;
  perusahaanId: number | null;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      // Single Postgres lookup — every account (Direktur, MKEsindo, PMPutra)
      // now lives in the same akun table. See docs/superpowers/specs/
      // 2026-07-31-migrasi-akun-postgres-design.md for why the previous
      // "try Postgres, fall back to MSSQL" two-hop lookup was removed.
      async authorize(credentials, request) {
        const username = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!username || !password) return null;

        const row = await findAkunByUsername(username);
        if (!row || !row.isActive) return null;

        if (row.lockedUntil && new Date(row.lockedUntil) > new Date()) return null;

        const ip = request?.headers?.get("x-forwarded-for") ?? null;
        const passwordOk = await bcrypt.compare(password, row.passwordHash);

        if (!passwordOk) {
          await recordFailedLogin(row.id, row.failedLoginCount);
          return null;
        }

        await recordSuccessfulLogin(row.id, ip);

        // Super Administrator bypasses the permission grid entirely, same
        // as before — now sourced from peran.is_super_admin instead of
        // DashboardRole.IsSuperAdmin. A Direktur account has no peran at
        // all (peranId null) — /grup gates on accountScope directly, not
        // this permission map, so an empty map is correct for it.
        const permissions = row.isSuperAdmin
          ? fullPermissionMap()
          : row.peranId != null
            ? await getPermissionMapForPeran(row.peranId)
            : {};

        const user: AuthorizedUser = {
          id: String(row.id),
          name: row.nama,
          username: row.username,
          roleId: row.peranId ?? 0,
          isSuperAdmin: row.isSuperAdmin,
          permissions,
          accountScope: (row.perusahaanKode ?? "direktur") as AccountScope,
          perusahaanId: row.perusahaanId,
        };
        return user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as AuthorizedUser;
        token.id = u.id;
        token.username = u.username;
        token.roleId = u.roleId;
        token.isSuperAdmin = u.isSuperAdmin;
        token.permissions = u.permissions;
        token.accountScope = u.accountScope;
        token.perusahaanId = u.perusahaanId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.roleId = token.roleId as number;
        session.user.isSuperAdmin = token.isSuperAdmin as boolean;
        session.user.permissions = token.permissions as ReturnType<typeof fullPermissionMap>;
        session.user.accountScope = token.accountScope as AccountScope;
        session.user.perusahaanId = token.perusahaanId as number | null;
      }
      return session;
    },
  },
});
```

- [ ] **Step 2: Live-verify the login logic end-to-end via a direct script (not browser login)**

Create `scripts/verify-auth-login.ts` — this simulates exactly what `authorize()` does, against a real test account, without going through NextAuth's HTTP layer (which needs a running server) or a browser:

```ts
import "dotenv/config";
import bcrypt from "bcryptjs";
import {
  findAkunByUsername,
  recordFailedLogin,
  recordSuccessfulLogin,
  getPermissionMapForPeran,
  createAkun,
  createPeran,
  deleteAkun,
  deletePeran,
  listPerusahaanDirektori,
  listAllPeran,
} from "../src/lib/queries/akun";
import { fullPermissionMap } from "../src/lib/permissions";

async function main() {
  const perusahaanList = await listPerusahaanDirektori();
  const mkesindo = perusahaanList.find((p) => p.kode === "mkesindo");
  if (!mkesindo) throw new Error("mkesindo perusahaan not found");

  await createPeran(mkesindo.id, "Verify Login Test Role");
  const peranList = await listAllPeran();
  const testRole = peranList.find((p) => p.nama === "Verify Login Test Role" && p.perusahaanId === mkesindo.id);
  if (!testRole) throw new Error("test role creation failed");

  await createAkun({
    nama: "Verify Login Test",
    username: "verify_login_test_akun",
    password: "correctpassword1",
    email: null,
    nomorTelepon: null,
    perusahaanId: mkesindo.id,
    peranId: testRole.id,
  });

  // Simulate a successful login exactly like authorize() does.
  const row = await findAkunByUsername("verify_login_test_akun");
  if (!row) throw new Error("findAkunByUsername returned null for the just-created account");
  const passwordOk = await bcrypt.compare("correctpassword1", row.passwordHash);
  console.log("Correct password matches:", passwordOk, "— expect true");

  const wrongPasswordOk = await bcrypt.compare("wrongpassword", row.passwordHash);
  console.log("Wrong password matches:", wrongPasswordOk, "— expect false");

  const permissions = row.isSuperAdmin ? fullPermissionMap() : await getPermissionMapForPeran(row.peranId!);
  console.log("Non-superadmin permission map (fresh role, no izin set):", permissions, "— expect {}");

  await recordSuccessfulLogin(row.id, "127.0.0.1");
  const rowAfterLogin = await findAkunByUsername("verify_login_test_akun");
  console.log("failedLoginCount reset after success:", rowAfterLogin?.failedLoginCount === 0);

  await recordFailedLogin(row.id, 0);
  const rowAfterOneFail = await findAkunByUsername("verify_login_test_akun");
  console.log("failedLoginCount after 1 failure:", rowAfterOneFail?.failedLoginCount, "— expect 1");
  console.log("Not locked after 1 failure:", rowAfterOneFail?.lockedUntil === null);

  // Now test a real migrated MKEsindo account's accountScope resolution.
  const anyMkesindoAkun = (await import("../src/lib/queries/akun")).listAkun;
  const allAkun = await anyMkesindoAkun();
  const migratedUser = allAkun.find((a) => a.perusahaanKode === "mkesindo" && a.username !== "verify_login_test_akun");
  if (migratedUser) {
    const migratedRow = await findAkunByUsername(migratedUser.username);
    console.log(
      `Migrated account "${migratedUser.username}" accountScope resolves to:`,
      migratedRow?.perusahaanKode,
      "— expect 'mkesindo'"
    );
  }

  await deleteAkun(row.id);
  await deletePeran(testRole.id);

  if (!passwordOk || wrongPasswordOk || Object.keys(permissions).length !== 0 || rowAfterLogin?.failedLoginCount !== 0 || rowAfterOneFail?.failedLoginCount !== 1) {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/verify-auth-login.ts`
Expected output ends with `PASS`, and the migrated-account line (if a real MKEsindo user exists beyond the test one) shows `'mkesindo'`. Then delete the script.

- [ ] **Step 3: Type-check, lint, and build**

Run: `npx tsc --noEmit` — expect errors now confined only to Tasks 4-5's not-yet-touched files (`src/app/grup/akun/*`, `src/app/grup/akun/peran/*`, `src/components/dashboard/akun-list.tsx`, `akun-direktori-list.tsx`, `peran-editor.tsx`).
Run: `npx eslint src/lib/auth.ts` — expect no errors.

- [ ] **Step 4: Note the residual verification gap**

Per this session's standing rule, no browser-login automation is performed. Step 2's script proves `authorize()`'s exact logic (password check, lockout, permission resolution, accountScope derivation) works correctly against real data — it does not prove the full NextAuth HTTP round-trip. **Tell the user** that a real login is the recommended last-mile check once this whole plan is done — this is stated once at the end (Task 6), not repeated per-task.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts
git commit -m "Collapse authorize() to a single Postgres lookup, remove MSSQL fallback"
```

---

### Task 4: Merge `/grup/akun` + `/grup/akun/direktori` into one page with a PT filter

**Files:**
- Modify: `src/app/grup/akun/page.tsx`, `src/app/grup/akun/actions.ts`
- Create (replaces): `src/components/dashboard/akun-list.tsx`
- Delete: `src/app/grup/akun/direktori/page.tsx`, `src/app/grup/akun/direktori/actions.ts`, `src/components/dashboard/akun-direktori-list.tsx`

**Interfaces:**
- Consumes: `AkunRow`, `PerusahaanDirektoriOption`, `PeranRow`, `CreateAkunInput`, `UpdateAkunInput`, `listAkun`, `listPerusahaanDirektori`, `listAllPeran`, `createAkun`, `updateAkun`, `resetAkunPassword`, `deleteAkun`, `countActiveSuperAdmins` from `@/lib/queries/akun` (Task 2). `requireGrupAccess` from `@/lib/require-access` (unchanged).

- [ ] **Step 1: Delete the retired Direktori route and component**

```bash
rm src/app/grup/akun/direktori/page.tsx src/app/grup/akun/direktori/actions.ts
rmdir src/app/grup/akun/direktori 2>/dev/null || true
rm src/components/dashboard/akun-direktori-list.tsx
```

- [ ] **Step 2: Rewrite `src/app/grup/akun/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import {
  createAkun,
  updateAkun,
  deleteAkun,
  resetAkunPassword,
  countActiveSuperAdmins,
  listAllPeran,
  listAkun,
  type CreateAkunInput,
  type UpdateAkunInput,
} from "@/lib/queries/akun";
import { getPabrikLocation, setPabrikLocation } from "@/lib/queries/pabrik-location";
import { getSiteSettings, setSiteSettings, type SiteSettings } from "@/lib/queries/site-settings";
import { getDocTemplate, saveDocTemplate, type DocTemplate, type DocType } from "@/lib/queries/doc-template";

// Enforces the invariant from the design spec: an account is either
// cross-company Direktur (both null) or PT-scoped with a role in that PT
// (both set) — never a mismatched combination.
function assertScopeConsistent(perusahaanId: number | null, peranId: number | null) {
  if ((perusahaanId == null) !== (peranId == null)) {
    throw new Error("Akun harus terhubung ke Perusahaan DAN Peran sekaligus, atau menjadi akun Direktur (tanpa keduanya).");
  }
}

export async function createAkunAction(input: CreateAkunInput) {
  await requireGrupAccess();
  if (!input.nama.trim() || !input.username.trim() || input.password.length < 6) {
    throw new Error("Nama, username wajib diisi dan password minimal 6 karakter.");
  }
  assertScopeConsistent(input.perusahaanId, input.peranId);
  try {
    await createAkun(input);
  } catch (err) {
    if (err instanceof Error && /username_key/i.test(err.message)) {
      throw new Error("Username sudah digunakan, pilih username lain.");
    }
    throw err;
  }
  revalidatePath("/grup/akun");
}

export async function updateAkunAction(input: UpdateAkunInput) {
  await requireGrupAccess();
  if (!input.nama.trim()) throw new Error("Nama wajib diisi.");
  assertScopeConsistent(input.perusahaanId, input.peranId);

  if (input.perusahaanId != null && input.peranId != null) {
    const peranList = await listAllPeran();
    const newPeranIsSuperAdmin = peranList.find((p) => p.id === input.peranId)?.isSuperAdmin ?? false;
    if (!input.isActive || !newPeranIsSuperAdmin) {
      const remaining = await countActiveSuperAdmins(input.perusahaanId, input.id);
      if (remaining === 0) {
        throw new Error(
          "Tidak bisa menonaktifkan atau mengubah peran akun ini — minimal harus ada satu Super Administrator aktif di PT tersebut."
        );
      }
    }
  }

  await updateAkun(input);
  revalidatePath("/grup/akun");
}

export async function resetAkunPasswordAction(id: number, newPassword: string) {
  await requireGrupAccess();
  if (newPassword.length < 6) throw new Error("Password minimal 6 karakter.");
  await resetAkunPassword(id, newPassword);
  revalidatePath("/grup/akun");
}

export async function deleteAkunAction(id: number) {
  const session = await requireGrupAccess();
  if (Number(session.user.id) === id) {
    throw new Error("Tidak bisa menghapus akun Anda sendiri yang sedang digunakan untuk login.");
  }
  // Only PT-scoped accounts have the "last active superadmin" guard —
  // Direktur accounts (perusahaanId null) skip it entirely.
  const target = (await listAkun()).find((a) => a.id === id);
  if (target?.perusahaanId != null) {
    const remaining = await countActiveSuperAdmins(target.perusahaanId, id);
    if (remaining === 0) {
      throw new Error("Tidak bisa menghapus akun ini — minimal harus ada satu Super Administrator aktif di PT tersebut.");
    }
  }
  await deleteAkun(id);
  revalidatePath("/grup/akun");
}

export async function getPabrikLocationAction() {
  await requireGrupAccess();
  return getPabrikLocation();
}

export async function setPabrikLocationAction(input: { latitude: number; longitude: number; alamat: string | null }): Promise<void> {
  await requireGrupAccess();
  await setPabrikLocation(input);
  revalidatePath("/grup/akun");
}

export async function getSiteSettingsAction() {
  await requireGrupAccess();
  return getSiteSettings();
}

export async function setSiteSettingsAction(input: SiteSettings): Promise<void> {
  await requireGrupAccess();
  if (!input.title.trim()) throw new Error("Title tidak boleh kosong.");
  await setSiteSettings(input);
  revalidatePath("/grup/akun");
  revalidatePath("/", "layout");
}

export async function getDocTemplateAction(docType: DocType): Promise<DocTemplate> {
  await requireGrupAccess();
  return getDocTemplate(docType);
}

export async function saveDocTemplateAction(input: DocTemplate): Promise<void> {
  await requireGrupAccess();
  if (!input.headerTitle.trim()) throw new Error("Judul kop surat tidak boleh kosong.");
  await saveDocTemplate(input);
  revalidatePath("/grup/akun");
}
```

- [ ] **Step 3: Rewrite `src/app/grup/akun/page.tsx`**

```tsx
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireGrupAccess } from "@/lib/require-access";
import { listAkun, listPerusahaanDirektori, listAllPeran } from "@/lib/queries/akun";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { getSiteSettings } from "@/lib/queries/site-settings";
import { getDocTemplate } from "@/lib/queries/doc-template";
import { AkunList } from "@/components/dashboard/akun-list";
import { PabrikLocationSettings } from "@/components/dashboard/pabrik-location-settings";
import { SiteSettingsPanel } from "@/components/dashboard/site-settings-panel";
import { DocTemplatePanel } from "@/components/dashboard/doc-template-panel";
import { Button } from "@/components/ui/button";

export default async function AkunPage() {
  await requireGrupAccess();
  const [akunList, perusahaanList, peranList, pabrikLocation, siteSettings, docTemplate] = await Promise.all([
    listAkun(),
    listPerusahaanDirektori(),
    listAllPeran(),
    getPabrikLocation(),
    getSiteSettings(),
    getDocTemplate("DeliveryOrder"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Akun</h1>
        <Button variant="outline" render={<Link href="/grup/akun/peran" />}>
          <ShieldCheck className="size-4" />
          Peran &amp; Otoritas
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Kelola seluruh akun untuk setiap PT, termasuk akun Direktur PMP Group — hanya Super Administrator/Direktur
        yang dapat melihat dan mengatur halaman ini.
      </p>
      <AkunList akunList={akunList} perusahaanList={perusahaanList} peranList={peranList} />
      <PabrikLocationSettings initial={pabrikLocation} />
      <SiteSettingsPanel initial={siteSettings} />
      <DocTemplatePanel initial={docTemplate} />
    </div>
  );
}
```

- [ ] **Step 4: Write the merged `src/components/dashboard/akun-list.tsx`**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Pencil, KeyRound, Trash2, Phone, Mail, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { AkunRow, PerusahaanDirektoriOption, PeranRow, CreateAkunInput, UpdateAkunInput } from "@/lib/queries/akun";
import { createAkunAction, updateAkunAction, resetAkunPasswordAction, deleteAkunAction } from "@/app/grup/akun/actions";

const DIREKTUR_FILTER = "direktur";
const ALL_FILTER = "all";

function scopeLabel(a: Pick<AkunRow, "perusahaanNama">): string {
  return a.perusahaanNama ?? "Direktur (PMP Group)";
}

// Shared by the create and edit forms: PT dropdown, then a Peran dropdown
// filtered to that PT's own roles, or hidden entirely for "Direktur".
function ScopeFields({
  perusahaanList,
  peranList,
  perusahaanId,
  peranId,
  onPerusahaanChange,
  onPeranChange,
}: {
  perusahaanList: PerusahaanDirektoriOption[];
  peranList: PeranRow[];
  perusahaanId: number | null;
  peranId: number | null;
  onPerusahaanChange: (id: number | null) => void;
  onPeranChange: (id: number | null) => void;
}) {
  const peranOptions = peranList.filter((p) => p.perusahaanId === perusahaanId);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label>Perusahaan</Label>
        <Select
          value={perusahaanId != null ? String(perusahaanId) : DIREKTUR_FILTER}
          onValueChange={(v) => {
            const next = v === DIREKTUR_FILTER ? null : Number(v);
            onPerusahaanChange(next);
            onPeranChange(null);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {() => (perusahaanId == null ? "Direktur (PMP Group)" : perusahaanList.find((p) => p.id === perusahaanId)?.nama ?? "")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DIREKTUR_FILTER}>Direktur (PMP Group)</SelectItem>
            {perusahaanList.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {perusahaanId != null && (
        <div className="flex flex-col gap-1.5">
          <Label>Peran</Label>
          <Select value={peranId != null ? String(peranId) : ""} onValueChange={(v) => onPeranChange(v ? Number(v) : null)}>
            <SelectTrigger className="w-full">
              <SelectValue>{() => peranOptions.find((p) => p.id === peranId)?.nama ?? "Pilih peran"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {peranOptions.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {peranOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">Belum ada peran untuk PT ini — buat dulu di halaman Peran &amp; Otoritas.</p>
          )}
        </div>
      )}
    </>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  perusahaanList,
  peranList,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  perusahaanList: PerusahaanDirektoriOption[];
  peranList: PeranRow[];
  onSubmit: (input: CreateAkunInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const [perusahaanId, setPerusahaanId] = useState<number | null>(null);
  const [peranId, setPeranId] = useState<number | null>(null);

  function handleSubmit(formData: FormData) {
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
      email: String(formData.get("email") ?? "") || null,
      nomorTelepon: String(formData.get("nomorTelepon") ?? "") || null,
      perusahaanId,
      peranId,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Akun</DialogTitle>
          <DialogDescription>Buat akun login baru untuk PT mana pun, atau akun Direktur lintas-PT.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama</Label>
            <Input id="nama" name="nama" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" name="username" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" minLength={6} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nomorTelepon">Nomor Telepon</Label>
            <Input id="nomorTelepon" name="nomorTelepon" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <ScopeFields
            perusahaanList={perusahaanList}
            peranList={peranList}
            perusahaanId={perusahaanId}
            peranId={peranId}
            onPerusahaanChange={setPerusahaanId}
            onPeranChange={setPeranId}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || (perusahaanId != null && peranId == null)} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  akun,
  perusahaanList,
  peranList,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  akun: AkunRow;
  perusahaanList: PerusahaanDirektoriOption[];
  peranList: PeranRow[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: UpdateAkunInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const [perusahaanId, setPerusahaanId] = useState<number | null>(akun.perusahaanId);
  const [peranId, setPeranId] = useState<number | null>(akun.peranId);
  const [status, setStatus] = useState(akun.isActive ? "active" : "inactive");

  function handleSubmit(formData: FormData) {
    onSubmit({
      id: akun.id,
      nama: String(formData.get("nama") ?? ""),
      email: String(formData.get("email") ?? "") || null,
      nomorTelepon: String(formData.get("nomorTelepon") ?? "") || null,
      perusahaanId,
      peranId,
      isActive: status === "active",
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Akun &mdash; {akun.nama}</DialogTitle>
          <DialogDescription>Username &ldquo;{akun.username}&rdquo; tidak dapat diubah.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama</Label>
            <Input id="nama" name="nama" defaultValue={akun.nama} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nomorTelepon">Nomor Telepon</Label>
            <Input id="nomorTelepon" name="nomorTelepon" defaultValue={akun.nomorTelepon ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={akun.email ?? ""} />
          </div>
          <ScopeFields
            perusahaanList={perusahaanList}
            peranList={peranList}
            perusahaanId={perusahaanId}
            peranId={peranId}
            onPerusahaanChange={setPerusahaanId}
            onPeranChange={setPeranId}
          />
          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v ?? "active")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => (v === "active" ? "Aktif" : "Nonaktif")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || (perusahaanId != null && peranId == null)} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  akun,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  akun: AkunRow;
  onOpenChange: (open: boolean) => void;
  onSubmit: (id: number, password: string) => void;
  pending: boolean;
  error: string | null;
}) {
  function handleSubmit(formData: FormData) {
    onSubmit(akun.id, String(formData.get("password") ?? ""));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password &mdash; {akun.nama}</DialogTitle>
          <DialogDescription>Password baru berlaku langsung untuk login berikutnya.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password Baru</Label>
            <Input id="password" name="password" type="password" minLength={6} required />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AkunList({
  akunList,
  perusahaanList,
  peranList,
}: {
  akunList: AkunRow[];
  perusahaanList: PerusahaanDirektoriOption[];
  peranList: PeranRow[];
}) {
  const [filter, setFilter] = useState<string>(ALL_FILTER);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AkunRow | null>(null);
  const [resetting, setResetting] = useState<AkunRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (filter === ALL_FILTER) return akunList;
    if (filter === DIREKTUR_FILTER) return akunList.filter((a) => a.perusahaanId == null);
    return akunList.filter((a) => a.perusahaanKode === filter);
  }, [akunList, filter]);

  function handleCreate(input: CreateAkunInput) {
    setError(null);
    startTransition(async () => {
      try {
        await createAkunAction(input);
        setCreating(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan akun.");
      }
    });
  }

  function handleUpdate(input: UpdateAkunInput) {
    setError(null);
    startTransition(async () => {
      try {
        await updateAkunAction(input);
        setEditing(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan akun.");
      }
    });
  }

  function handleResetPassword(id: number, password: string) {
    setError(null);
    startTransition(async () => {
      try {
        await resetAkunPasswordAction(id, password);
        setResetting(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal reset password.");
      }
    });
  }

  function handleDelete(akun: AkunRow) {
    if (!confirm(`Hapus akun "${akun.nama}" (@${akun.username})? Tindakan ini tidak dapat dibatalkan.`)) return;
    startTransition(async () => {
      try {
        await deleteAkunAction(akun.id);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Gagal menghapus akun.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">{filtered.length} akun.</p>
          <Select value={filter} onValueChange={(v) => setFilter(v ?? ALL_FILTER)}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue>
                {() => {
                  if (filter === ALL_FILTER) return "Semua PT";
                  if (filter === DIREKTUR_FILTER) return "Direktur (PMP Group)";
                  return perusahaanList.find((p) => p.kode === filter)?.nama ?? filter;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>Semua PT</SelectItem>
              <SelectItem value={DIREKTUR_FILTER}>Direktur (PMP Group)</SelectItem>
              {perusahaanList.map((p) => (
                <SelectItem key={p.kode} value={p.kode}>
                  {p.nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => {
            setError(null);
            setCreating(true);
          }}
        >
          <Plus className="size-4" />
          Tambah Akun
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((a) => (
          <Card key={a.id} className="py-3.5">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.nama}</p>
                  <p className="font-data text-xs text-muted-foreground">@{a.username}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setError(null);
                      setEditing(a);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setError(null);
                      setResetting(a);
                    }}
                  >
                    <KeyRound className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={() => handleDelete(a)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={a.peranNama === "Super Administrator" ? "default" : "outline"} className="h-5 px-1.5 text-[10px]">
                  {a.peranNama ?? "Direktur"}
                </Badge>
                <Badge variant={a.isActive ? "outline" : "destructive"} className="h-5 px-1.5 text-[10px]">
                  {a.isActive ? "Aktif" : "Nonaktif"}
                </Badge>
              </div>

              <div className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-3" /> {scopeLabel(a)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3" /> {a.nomorTelepon || "-"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3" /> {a.email || "-"}
                </span>
                <span>Login terakhir: {a.lastLoginAt ? formatDate(a.lastLoginAt) : "-"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada akun untuk filter ini.</p>
        )}
      </div>

      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        perusahaanList={perusahaanList}
        peranList={peranList}
        onSubmit={handleCreate}
        pending={pending}
        error={error}
      />
      {editing && (
        <EditDialog
          key={editing.id}
          akun={editing}
          perusahaanList={perusahaanList}
          peranList={peranList}
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={handleUpdate}
          pending={pending}
          error={error}
        />
      )}
      {resetting && (
        <ResetPasswordDialog
          akun={resetting}
          onOpenChange={(open) => !open && setResetting(null)}
          onSubmit={handleResetPassword}
          pending={pending}
          error={error}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Type-check, lint, and build**

Run: `npx tsc --noEmit` — expect errors now confined only to Task 5's not-yet-touched files (`src/app/grup/akun/peran/*`, `src/components/dashboard/peran-editor.tsx`).
Run: `npx eslint "src/app/grup/akun/actions.ts" "src/app/grup/akun/page.tsx" src/components/dashboard/akun-list.tsx` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/grup/akun/actions.ts" "src/app/grup/akun/page.tsx" src/components/dashboard/akun-list.tsx
git rm -r src/app/grup/akun/direktori src/components/dashboard/akun-direktori-list.tsx
git commit -m "Merge /grup/akun/direktori into /grup/akun with a PT filter"
```

---

### Task 5: PT-scope the Peran editor (`/grup/akun/peran`)

**Files:**
- Modify: `src/app/grup/akun/peran/page.tsx`, `src/app/grup/akun/peran/actions.ts`, `src/components/dashboard/peran-editor.tsx`

**Interfaces:**
- Consumes: `PeranRow`, `PeranIzinRow`, `PerusahaanDirektoriOption`, `listAllPeran`, `getAllPeranIzin`, `listPerusahaanDirektori`, `createPeran`, `deletePeran`, `setPeranIzin` from `@/lib/queries/akun` (Task 2).

- [ ] **Step 1: Rewrite `src/app/grup/akun/peran/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { createPeran, deletePeran, setPeranIzin, listAllPeran } from "@/lib/queries/akun";
import type { ModuleKey } from "@/lib/permissions";

export async function createPeranAction(perusahaanId: number, nama: string) {
  await requireGrupAccess();
  if (!nama.trim()) throw new Error("Nama peran wajib diisi.");
  await createPeran(perusahaanId, nama.trim());
  revalidatePath("/grup/akun/peran");
}

export async function deletePeranAction(peranId: number) {
  await requireGrupAccess();
  const peranList = await listAllPeran();
  const peran = peranList.find((p) => p.id === peranId);
  if (!peran) return;
  if (peran.isSuperAdmin) throw new Error("Peran Super Administrator tidak dapat dihapus.");
  if (peran.akunCount > 0) throw new Error("Peran masih dipakai oleh akun aktif, pindahkan akun tersebut dahulu.");
  await deletePeran(peranId);
  revalidatePath("/grup/akun/peran");
}

export async function setPeranIzinAction(input: { peranId: number; moduleKey: ModuleKey; canView: boolean; canEdit: boolean }) {
  await requireGrupAccess();
  await setPeranIzin(input);
  revalidatePath("/grup/akun/peran");
}
```

- [ ] **Step 2: Rewrite `src/app/grup/akun/peran/page.tsx`**

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireGrupAccess } from "@/lib/require-access";
import { listAllPeran, getAllPeranIzin, listPerusahaanDirektori } from "@/lib/queries/akun";
import { PeranEditor } from "@/components/dashboard/peran-editor";
import { Button } from "@/components/ui/button";

export default async function PeranPage() {
  await requireGrupAccess();
  const [peranList, izinList, perusahaanList] = await Promise.all([listAllPeran(), getAllPeranIzin(), listPerusahaanDirektori()]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" render={<Link href="/grup/akun" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-xl font-semibold">Peran &amp; Otoritas</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Peran sepenuhnya terpisah per PT — pilih PT untuk mengatur peran dan modul apa saja yang bisa dilihat/diubah
        oleh tiap peran. Super Administrator selalu memiliki akses penuh dan tidak bisa diubah.
      </p>
      <PeranEditor peranList={peranList} izinList={izinList} perusahaanList={perusahaanList} />
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/components/dashboard/peran-editor.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULE_KEYS, MODULE_LABEL, type ModuleKey, type PermissionMap } from "@/lib/permissions";
import type { PeranRow, PeranIzinRow, PerusahaanDirektoriOption } from "@/lib/queries/akun";
import { createPeranAction, deletePeranAction, setPeranIzinAction } from "@/app/grup/akun/peran/actions";

function buildMap(izinList: PeranIzinRow[], peranId: number): PermissionMap {
  const map: PermissionMap = {};
  for (const key of MODULE_KEYS) {
    const row = izinList.find((r) => r.peranId === peranId && r.moduleKey === key);
    map[key] = { canView: row?.canView ?? false, canEdit: row?.canEdit ?? false };
  }
  return map;
}

function RoleCard({ peran, initialMap }: { peran: PeranRow; initialMap: PermissionMap }) {
  const [map, setMap] = useState(initialMap);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function toggle(moduleKey: ModuleKey, field: "canView" | "canEdit") {
    setMap((prev) => {
      const current = prev[moduleKey] ?? { canView: false, canEdit: false };
      const next = { ...current, [field]: !current[field] };
      if (field === "canEdit" && next.canEdit) next.canView = true;
      if (field === "canView" && !next.canView) next.canEdit = false;
      return { ...prev, [moduleKey]: next };
    });
    setDirty(true);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await Promise.all(
          MODULE_KEYS.map((key) =>
            setPeranIzinAction({
              peranId: peran.id,
              moduleKey: key,
              canView: map[key]?.canView ?? false,
              canEdit: map[key]?.canEdit ?? false,
            })
          )
        );
        setDirty(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan otoritas.");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Hapus peran "${peran.nama}"?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deletePeranAction(peran.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menghapus peran.");
      }
    });
  }

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="font-display text-sm">
          {peran.nama} <span className="font-normal text-muted-foreground">({peran.akunCount} akun)</span>
        </CardTitle>
        <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={handleDelete}>
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="p-1.5 text-left font-medium">Modul</th>
                <th className="p-1.5 text-center font-medium">Lihat</th>
                <th className="p-1.5 text-center font-medium">Ubah</th>
              </tr>
            </thead>
            <tbody>
              {MODULE_KEYS.map((key) => (
                <tr key={key} className="border-t border-border">
                  <td className="p-1.5">{MODULE_LABEL[key]}</td>
                  <td className="p-1.5 text-center">
                    <input type="checkbox" className="accent-primary" checked={map[key]?.canView ?? false} onChange={() => toggle(key, "canView")} />
                  </td>
                  <td className="p-1.5 text-center">
                    <input type="checkbox" className="accent-primary" checked={map[key]?.canEdit ?? false} onChange={() => toggle(key, "canEdit")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-fit" disabled={pending || !dirty} onClick={handleSave}>
          {pending ? "Menyimpan..." : "Simpan Otoritas"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CreatePeranDialog({
  open,
  onOpenChange,
  perusahaanId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  perusahaanId: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createPeranAction(perusahaanId, String(formData.get("nama") ?? ""));
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menambah peran.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tambah Peran</DialogTitle>
          <DialogDescription>Peran baru dimulai tanpa akses ke modul apa pun.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama Peran</Label>
            <Input id="nama" name="nama" required />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PeranEditor({
  peranList,
  izinList,
  perusahaanList,
}: {
  peranList: PeranRow[];
  izinList: PeranIzinRow[];
  perusahaanList: PerusahaanDirektoriOption[];
}) {
  const [perusahaanId, setPerusahaanId] = useState<number | null>(perusahaanList[0]?.id ?? null);
  const [creating, setCreating] = useState(false);

  const scoped = peranList.filter((p) => p.perusahaanId === perusahaanId);
  const superAdminRole = scoped.find((p) => p.isSuperAdmin);
  const otherRoles = scoped.filter((p) => !p.isSuperAdmin);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Perusahaan</Label>
        <Select value={perusahaanId != null ? String(perusahaanId) : ""} onValueChange={(v) => setPerusahaanId(v ? Number(v) : null)}>
          <SelectTrigger className="w-64">
            <SelectValue>{() => perusahaanList.find((p) => p.id === perusahaanId)?.nama ?? "Pilih PT"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {perusahaanList.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {superAdminRole && (
        <Card size="sm" className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 py-1">
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{superAdminRole.nama}</span> ({superAdminRole.akunCount} akun) selalu
              memiliki akses penuh (lihat &amp; ubah) ke seluruh modul, termasuk Akun &mdash; tidak dapat diatur di sini.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{otherRoles.length} peran lain untuk PT ini.</p>
        <Button disabled={perusahaanId == null} onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Tambah Peran
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        {otherRoles.map((peran) => (
          <RoleCard key={peran.id} peran={peran} initialMap={buildMap(izinList, peran.id)} />
        ))}
        {otherRoles.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada peran lain untuk PT ini.</p>
        )}
      </div>

      {perusahaanId != null && <CreatePeranDialog open={creating} onOpenChange={setCreating} perusahaanId={perusahaanId} />}
    </div>
  );
}
```

- [ ] **Step 4: Type-check, lint, and build**

Run: `npx tsc --noEmit` — expect **zero errors project-wide** now (this is the task that clears every remaining error left over since Task 2 deleted `akun-direktori.ts`).
Run: `npx eslint "src/app/grup/akun/peran/actions.ts" "src/app/grup/akun/peran/page.tsx" src/components/dashboard/peran-editor.tsx` — expect no errors.
Run: `npx next build` — expect a clean build; confirm `/grup/akun` and `/grup/akun/peran` are present in the route table and `/grup/akun/direktori` is **gone**.

- [ ] **Step 5: Commit**

```bash
git add "src/app/grup/akun/peran/actions.ts" "src/app/grup/akun/peran/page.tsx" src/components/dashboard/peran-editor.tsx
git commit -m "PT-scope the Peran & Otoritas editor"
```

---

### Task 6: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full type-check, lint, and production build**

Run: `npx tsc --noEmit` — expect zero errors project-wide.
Run: `npx eslint .` — expect zero errors (only pre-existing unrelated warnings, e.g. android build artifacts — confirm no *new* ones beyond the known baseline).
Run: `npx next build` — expect a clean build; confirm `/grup/akun`, `/grup/akun/peran` present, `/grup/akun/direktori` absent from the route table.

- [ ] **Step 2: Direct-script regression check of the full login path**

Create `scripts/verify-final-akun.ts`:
```ts
import "dotenv/config";
import { findAkunByUsername, listAkun, listAllPeran } from "../src/lib/queries/akun";

async function main() {
  const allAkun = await listAkun();
  const mkesindoAccounts = allAkun.filter((a) => a.perusahaanKode === "mkesindo");
  const direkturAccounts = allAkun.filter((a) => a.perusahaanId == null);
  const pmputraAccounts = allAkun.filter((a) => a.perusahaanKode === "pmputra");
  console.log("MKEsindo accounts:", mkesindoAccounts.length);
  console.log("Direktur accounts:", direkturAccounts.length);
  console.log("PMPutra accounts:", pmputraAccounts.length);

  if (mkesindoAccounts.length === 0) {
    console.error("FAIL: no MKEsindo accounts found after migration — something is wrong.");
    process.exit(1);
  }

  // Spot-check one real migrated account resolves through findAkunByUsername
  // exactly like authorize() will use it.
  const sample = mkesindoAccounts[0];
  const authRow = await findAkunByUsername(sample.username);
  console.log(`Sample account "${sample.username}" resolves via findAkunByUsername:`, {
    nama: authRow?.nama,
    perusahaanKode: authRow?.perusahaanKode,
    isSuperAdmin: authRow?.isSuperAdmin,
    isActive: authRow?.isActive,
  });

  const allPeran = await listAllPeran();
  console.log("Total peran across all PTs:", allPeran.length);

  if (!authRow || authRow.perusahaanKode !== "mkesindo") {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/verify-final-akun.ts`
Expected: prints account counts (MKEsindo count should match Task 1's migrated total), sample account resolves correctly, ends with `PASS`. Then delete the script.

- [ ] **Step 3: Confirm no leftover throwaway scripts**

Run: `git status --short`
Expected: no untracked files under `scripts/` other than the permanently-kept `scripts/migrate-akun-to-postgres.ts` (already committed in Task 1).

- [ ] **Step 4: Tell the user the residual manual check**

A real login by the user, using one real migrated MKEsindo account's actual credentials, plus a look at `/grup/akun` and `/grup/akun/peran` to confirm the merged UI renders correctly, is the one check this plan cannot perform itself (standing no-browser-login rule). State this clearly once the plan is otherwise complete.

- [ ] **Step 5: Remind the user about the deferred MSSQL cleanup**

Per the design spec's explicit decision, emptying `DashboardUser.PasswordHash` (and related MSSQL tables) is **not part of this plan's execution** — it happens only after the user explicitly confirms real logins are working. Do not do this automatically even if every automated check in this plan passes.

- [ ] **Step 6: Commit**

Nothing to commit for this task itself (verification-only) beyond what Task 1-5 already committed. If Step 1 found and required any fixes, commit those under their own descriptive message before considering the plan complete.
