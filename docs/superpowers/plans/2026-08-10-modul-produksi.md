# Modul Produksi (Es Kristal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Produksi role (`peran.is_produksi`) plus its two confined route trees — `/mkesindo/produksi` (desktop, view-only warehouse/mesin/riwayat) and `/mkesindo/produksi-app` (mobile, 4-tab action app) — and the additive `produksiMulaiMuatAction` that lets Produksi staff consume pallet stock to trigger the existing, unmodified "Mulai Muat" step on a Kartu Pengiriman (Jadwal).

**Architecture:** Mirrors the `driver-app`/`satpam-app` precedent exactly — a new `peran.is_produksi` boolean flag (Postgres) threaded through `auth.ts`/`next-auth.d.ts`, a `requireProduksi()` guard, and two brand-new route trees living as siblings of the `(dashboard)` route group (never nested under it), each with their own minimal layout. Four new MSSQL tables (`DashboardProduksiMesin`, `DashboardProduksiPalletPosisi`, `DashboardProduksiBatch`, `DashboardProduksiMuatanDetail`) hold the warehouse/pallet/batch data. A new `produksiMulaiMuatAction` records pallet consumption in its own SQL transaction, then calls the existing `startMuat()` (from `pengiriman-jadwal.ts`) unmodified — the only change to existing delivery code is removing the "Mulai Muat" trigger button from the desktop Papan Pengiriman dialog.

**Tech Stack:** Next.js 16 (App Router, Server Actions), MSSQL (`mssql` via `src/lib/db.ts`), Postgres (`pg` via `src/lib/pg.ts`), NextAuth (JWT sessions), shadcn/base-ui components, Tailwind.

## Global Constraints

- Every new Server Action that can throw a business-validation error MUST be wrapped in `runAction()` (`src/lib/action-result.ts`) and throw `AppError`, not a plain `Error` — no exceptions.
- All Indonesian-language user-facing strings (labels, error messages) — no English UI text.
- No test runner exists in this project. Every task's verification is `npx tsc --noEmit` (zero errors touching changed files) + `npx eslint <changed files>`, plus a live browser check where noted.
- Everything happens directly on the `main` branch. No worktree.
- MSSQL DDL tasks are **controller-run**: executed directly via the `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_ddl` tool by whoever is executing this plan, before dispatching the task that depends on it — never delegated to an implementer subagent. No `FOREIGN KEY`/`REFERENCES` clauses and no `CREATE INDEX` beyond a named `UNIQUE` constraint where a 1:1 relationship needs enforcing — matches every existing custom `Dashboard*` table in this codebase.
- Money/quantity values from MSSQL columns arrive as plain JS `number` via the `mssql` driver — no `Decimal.js` or string-based handling.
- No `react-hook-form`/`zod` anywhere in this codebase — every form uses controlled `<input>`/shadcn `<Select>`/`<Input>` + `useState` + `useTransition`/`startTransition` + `ActionResult<T>`. New Produksi UI follows this exact convention.
- Stock quantities are tracked as separate 10kg/5kg bag counts (`Qty10KG`/`Qty5KG`), never normalized into the board's blended "kantong" unit (`JADWAL_KANTONG_EXPR`) — fulfillment is validated size-for-size against what a Jadwal needs (`JADWAL_KANTONG_10KG_EXPR`/`JADWAL_KANTONG_5KG_EXPR`, reused verbatim from `pengiriman-jadwal.ts`).
- `/mkesindo/produksi` and `/mkesindo/produksi-app` are **not** part of `NAV_ITEMS`/`ModuleKey`/`PermissionMap` — gated purely by `session.user.isProduksi`, mirroring `isDriver`/`isSatpam` exactly, including no `isSuperAdmin` bypass inside `requireProduksi()` itself (consistent with `requireDriver()`/`requireSatpam()`).
- Both new route trees live as **siblings** of the `(dashboard)` route group (like `driver-app`/`satpam-app`), never nested under it — this is the specific architecture that caused the ERR_TOO_MANY_REDIRECTS production incident when violated previously (see `docs/superpowers/specs/2026-08-08-restrukturisasi-rute-mkesindo-design.md`).
- The Panel 3 Mesin's inline edit dialog inside `/mkesindo/produksi` is reachable by any Produksi account, not a separate superadmin-gated screen — Produksi is the only role with access to this dashboard at all in this design, so the spec's "diisi/diubah oleh admin" is read as "managed by whoever holds the Produksi role."

---

## Task 1: Postgres migration — `peran.is_produksi`

**Files:**
- Create: `scripts/migrate-produksi-app.ts`

**Interfaces:**
- Produces: Postgres column `peran.is_produksi BOOLEAN NOT NULL DEFAULT false`, consumed by Task 2.

- [ ] **Step 1: Write the migration script**

```ts
// Idempotent setup for the Produksi module's Postgres column: peran.is_produksi
// (role-level access flag, mirrors peran.is_driver / peran.is_satpam). Safe to
// re-run.
//
// Usage: npx tsx scripts/migrate-produksi-app.ts
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const client = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: process.env.DIRECTORY_DB_NAME,
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    await client.query(`ALTER TABLE peran ADD COLUMN IF NOT EXISTS is_produksi BOOLEAN NOT NULL DEFAULT false`);
    console.log("peran.is_produksi ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the migration**

Run: `npx tsx scripts/migrate-produksi-app.ts`
Expected: prints "peran.is_produksi ready." with no error. Re-run it once more to confirm idempotency (must also succeed with no error).

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-produksi-app.ts
git commit -m "Add Postgres migration for peran.is_produksi"
```

---

## Task 2: `akun.ts` query-layer wiring for `isProduksi` + `getAkunNamaMap`

**Files:**
- Modify: `src/lib/queries/akun.ts`

**Interfaces:**
- Consumes: `peran.is_produksi` column from Task 1.
- Produces: `AkunAuthRow.isProduksi: boolean` (consumed by Task 3); `PeranRow.isProduksi: boolean`, `setPeranProduksi(peranId: number, isProduksi: boolean): Promise<void>` (consumed by Task 4); `getAkunNamaMap(akunIds: number[]): Promise<Map<number, string>>` (consumed by Task 10).

- [ ] **Step 1: Extend `AkunAuthRow` and `findAkunByUsername`**

In `src/lib/queries/akun.ts`, extend the interface (near line 11-24):

```ts
export interface AkunAuthRow {
  id: number;
  username: string;
  passwordHash: string;
  nama: string;
  peranId: number | null;
  perusahaanId: number | null;
  perusahaanKode: string | null;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  isProduksi: boolean;
  salesmanId: string | null;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}
```

Update the query and mapping (near line 28-61):

```ts
export async function findAkunByUsername(username: string): Promise<AkunAuthRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT a.id, a.username, a.password_hash, a.nama, a.peran_id, a.perusahaan_id, p.kode AS perusahaan_kode,
            COALESCE(r.is_super_admin, false) AS is_super_admin,
            COALESCE(r.is_satpam, false) AS is_satpam,
            COALESCE(r.is_driver, false) AS is_driver,
            COALESCE(r.is_produksi, false) AS is_produksi,
            a.salesman_id,
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
    isSatpam: row.is_satpam,
    isDriver: row.is_driver,
    isProduksi: row.is_produksi,
    salesmanId: row.salesman_id,
    isActive: row.is_active,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
  };
}
```

- [ ] **Step 2: Extend `PeranRow`, `listAllPeran`, add `setPeranProduksi`**

Extend the interface (currently at line 289-297):

```ts
export interface PeranRow {
  id: number;
  perusahaanId: number;
  nama: string;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  isProduksi: boolean;
  akunCount: number;
}
```

Update `listAllPeran` (currently at line 299-316):

```ts
export async function listAllPeran(): Promise<PeranRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT r.id, r.perusahaan_id, r.nama, r.is_super_admin, r.is_satpam, r.is_driver, r.is_produksi,
           (SELECT count(*) FROM akun a WHERE a.peran_id = r.id) AS akun_count
    FROM peran r
    ORDER BY r.perusahaan_id, r.is_super_admin DESC, r.nama
  `);
  return result.rows.map((row) => ({
    id: row.id,
    perusahaanId: row.perusahaan_id,
    nama: row.nama,
    isSuperAdmin: row.is_super_admin,
    isSatpam: row.is_satpam,
    isDriver: row.is_driver,
    isProduksi: row.is_produksi,
    akunCount: Number(row.akun_count),
  }));
}
```

Add `setPeranProduksi` immediately after `setPeranDriver` (currently ending at line 370):

```ts
export async function setPeranProduksi(peranId: number, isProduksi: boolean): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE peran SET is_produksi = $1 WHERE id = $2`, [isProduksi, peranId]);
}
```

- [ ] **Step 3: Add `getAkunNamaMap`**

Add at the end of the file — used later by the Riwayat Produksi display to resolve `DicatatOlehAkunID` (a Postgres `akun.id`, stored as a plain `INT` column in the MSSQL Produksi tables since there is no ERP-side identity for Produksi staff, unlike Driver's `Salesman` link) into a display name:

```ts
export async function getAkunNamaMap(akunIds: number[]): Promise<Map<number, string>> {
  const uniqueIds = [...new Set(akunIds)];
  if (uniqueIds.length === 0) return new Map();
  const pool = getPgPool();
  const result = await pool.query(`SELECT id, nama FROM akun WHERE id = ANY($1::int[])`, [uniqueIds]);
  return new Map(result.rows.map((row) => [row.id as number, row.nama as string]));
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors from `src/lib/queries/akun.ts` (existing unrelated errors elsewhere, if any, are out of scope).
Run: `npx eslint src/lib/queries/akun.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/akun.ts
git commit -m "Add isProduksi/getAkunNamaMap to akun query layer"
```

---

## Task 3: `auth.ts` + `auth.config.ts` + `next-auth.d.ts` session wiring

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/types/next-auth.d.ts`

**Interfaces:**
- Consumes: `AkunAuthRow.isProduksi` from Task 2.
- Produces: `session.user.isProduksi: boolean` available everywhere `auth()` is called, consumed by Task 4 (`requireProduksi`) and Task 5 (dashboard layout guard).

- [ ] **Step 1: Extend `next-auth.d.ts`**

In `src/types/next-auth.d.ts`, add `isProduksi: boolean` next to every existing `isDriver: boolean` line, in all three `declare module` blocks (`Session.user`, `User`, `JWT`):

```ts
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      roleId: number;
      isSuperAdmin: boolean;
      isSatpam: boolean;
      isDriver: boolean;
      isProduksi: boolean;
      salesmanId: string | null;
      permissions: PermissionMap;
      accountScope: AccountScope;
      perusahaanId: number | null;
      sessionId: string;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    roleId: number;
    isSuperAdmin: boolean;
    isSatpam: boolean;
    isDriver: boolean;
    isProduksi: boolean;
    salesmanId: string | null;
    permissions: PermissionMap;
    accountScope: AccountScope;
    perusahaanId: number | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    roleId: number;
    isSuperAdmin: boolean;
    isSatpam: boolean;
    isDriver: boolean;
    isProduksi: boolean;
    salesmanId: string | null;
    permissions: PermissionMap;
    accountScope: AccountScope;
    perusahaanId: number | null;
    sessionId: string;
  }
}
```

- [ ] **Step 2: Extend `auth.ts`**

In `src/lib/auth.ts`, extend `AuthorizedUser`:

```ts
interface AuthorizedUser {
  id: string;
  name: string;
  username: string;
  roleId: number;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  isProduksi: boolean;
  salesmanId: string | null;
  permissions: ReturnType<typeof fullPermissionMap>;
  accountScope: AccountScope;
  perusahaanId: number | null;
  sessionId: string;
}
```

Add `isProduksi: row.isProduksi` to the `user` object built inside `Credentials.authorize()` (next to the existing `isDriver: row.isDriver` line), and add `token.isProduksi = u.isProduksi;` to the `jwt()` callback's `if (user)` branch (next to the existing `token.isDriver = u.isDriver;` line).

Also extend `src/lib/auth.config.ts`'s `session()` callback with `session.user.isProduksi = token.isProduksi as boolean;` next to the existing `session.user.isDriver = ...` line.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors — this step is exactly where a mismatched field name across the three files would surface as a type error.
Run: `npx eslint src/lib/auth.ts src/lib/auth.config.ts src/types/next-auth.d.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.config.ts src/types/next-auth.d.ts
git commit -m "Wire isProduksi through auth session/JWT"
```

---

## Task 4: `requireProduksi()` guard + Peran editor toggle

**Files:**
- Modify: `src/lib/require-access.ts`
- Modify: `src/app/grup/akun/peran/actions.ts`
- Modify: `src/components/dashboard/peran-editor.tsx`

**Interfaces:**
- Consumes: `session.user.isProduksi` from Task 3; `setPeranProduksi` from Task 2.
- Produces: `requireProduksi(): Promise<Session>` (consumed by every Produksi page/action from Task 10 onward); `setPeranProduksiAction(peranId: number, isProduksi: boolean): Promise<ActionResult<void>>`.

- [ ] **Step 1: Add `requireProduksi()`**

In `src/lib/require-access.ts`, add at the end of the file, mirroring `requireDriver()` exactly:

```ts
export async function requireProduksi() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isProduksi) redirect("/akses-ditolak");
  return session;
}
```

- [ ] **Step 2: Add `setPeranProduksiAction`**

In `src/app/grup/akun/peran/actions.ts`, add the import (`setPeranProduksi` alongside the existing `setPeranSatpam, setPeranDriver` import) and the action itself, mirroring `setPeranDriverAction`:

```ts
export async function setPeranProduksiAction(peranId: number, isProduksi: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setPeranProduksi(peranId, isProduksi);
    revalidatePath("/grup/akun/peran");
  });
}
```

- [ ] **Step 3: Add the Produksi toggle to the Peran editor**

In `src/components/dashboard/peran-editor.tsx`:

- Add `setPeranProduksiAction` to the existing import from `@/app/grup/akun/peran/actions` (alongside `setPeranSatpamAction, setPeranDriverAction`).
- Add state next to the existing `isDriver` state (line 33): `const [isProduksi, setIsProduksiState] = useState(peran.isProduksi);`
- Add a toggle handler next to `toggleDriver`:

```ts
function toggleProduksi() {
  setIsProduksiState((prev) => !prev);
  setDirty(true);
}
```

- Add `setPeranProduksiAction(peran.id, isProduksi),` to the `Promise.all` array inside `handleSave` (alongside the existing `setPeranDriverAction(peran.id, isDriver),` line).
- Add a third checkbox block immediately after the existing Driver checkbox block (line 139's surrounding `<label>`):

```tsx
<label className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
  <input type="checkbox" className="accent-primary" checked={isProduksi} onChange={toggleProduksi} />
  <span>
    Peran Khusus: Produksi
    <span className="block text-muted-foreground">
      Akun dengan peran ini diarahkan ke Modul Produksi (peta warehouse, mesin, riwayat) dan Aplikasi Produksi
      (isi muatan, catat hasil produksi) setelah login.
    </span>
  </span>
</label>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx eslint src/lib/require-access.ts src/app/grup/akun/peran/actions.ts src/components/dashboard/peran-editor.tsx`
Expected: no errors.
Live check: sign in as a superadmin account, open `/grup/akun/peran`, confirm the new "Peran Khusus: Produksi" checkbox appears on every role card, toggling it and clicking Simpan succeeds with no error, and the value persists after a page reload.

- [ ] **Step 5: Commit**

```bash
git add src/lib/require-access.ts src/app/grup/akun/peran/actions.ts src/components/dashboard/peran-editor.tsx
git commit -m "Add requireProduksi guard and Peran editor Produksi toggle"
```

---

## Task 5: `(dashboard)/layout.tsx` redirect guard for `isProduksi` accounts

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `session.user.isProduksi` from Task 3.

- [ ] **Step 1: Add the guard**

In `src/app/mkesindo/(dashboard)/layout.tsx`, add a third role-confinement block immediately after the existing `isDriver` block (currently lines 43-55), before the pmputra check:

```tsx
// Same reasoning as Satpam/Driver above. isProduksi accounts land on
// /mkesindo/produksi (view-only warehouse/mesin/riwayat), not
// /mkesindo/produksi-app (the mobile action app) — the two are siblings a
// Produksi account can freely move between (see
// docs/superpowers/specs/2026-08-10-modul-produksi-design.md), so this
// redirect only needs to get them OFF the regular (dashboard) tree, not
// force them into any one specific destination. The prefix check below
// also matches "/mkesindo/produksi-app" (it starts with the same string),
// which is harmless here since produksi-app is a route-tree sibling of
// (dashboard) and never executes this guard in the first place — it's
// listed for clarity, not because it changes behavior.
if (!session?.user?.isSuperAdmin && session?.user?.isProduksi && !pathname.startsWith("/mkesindo/produksi")) {
  redirect("/mkesindo/produksi");
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx eslint "src/app/mkesindo/(dashboard)/layout.tsx"`
Expected: no errors.

This task's live check is deferred to Task 14 (once `/mkesindo/produksi` actually exists to redirect to — redirecting to a not-yet-built route would 404).

- [ ] **Step 3: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/layout.tsx"
git commit -m "Confine isProduksi accounts to /mkesindo/produksi"
```

---

## Task 6: MSSQL DDL — Produksi tables (controller-run)

**Files:** None (database-only task, executed directly via `sql_execute_ddl` before Task 7 is dispatched — no implementer subagent for this task).

**Interfaces:**
- Produces: tables `DashboardProduksiMesin`, `DashboardProduksiPalletPosisi`, `DashboardProduksiBatch`, `DashboardProduksiMuatanDetail`, seeded with 3 placeholder Mesin rows and the 12 fixed pallet positions — consumed by every query in Tasks 7-9.

- [ ] **Step 1: Run the DDL**

Execute directly (controller-run, not dispatched) via `sql_execute_ddl`:

```sql
CREATE TABLE DashboardProduksiMesin (
  MesinID INT IDENTITY(1,1) PRIMARY KEY,
  Nama VARCHAR(100) NOT NULL,
  KapasitasProduksiPerHari INT NOT NULL DEFAULT 0,
  KonsumsiListrikKWh DECIMAL(10,2) NOT NULL DEFAULT 0,
  LamaProduksiMenit INT NOT NULL DEFAULT 0,
  LamaPengemasanMenit INT NOT NULL DEFAULT 0,
  IsDeleted BIT NOT NULL DEFAULT 0,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE DashboardProduksiPalletPosisi (
  PosisiID INT IDENTITY(1,1) PRIMARY KEY,
  Kode VARCHAR(4) NOT NULL,
  BatchIDAktif INT NULL,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE(),
  CONSTRAINT UQ_DashboardProduksiPalletPosisi_Kode UNIQUE (Kode)
);

CREATE TABLE DashboardProduksiBatch (
  BatchID INT IDENTITY(1,1) PRIMARY KEY,
  MesinID INT NOT NULL,
  PosisiID INT NOT NULL,
  TanggalProduksi DATETIME NOT NULL DEFAULT GETDATE(),
  Qty10KG INT NOT NULL DEFAULT 0,
  Qty5KG INT NOT NULL DEFAULT 0,
  SisaQty10KG INT NOT NULL DEFAULT 0,
  SisaQty5KG INT NOT NULL DEFAULT 0,
  DicatatOlehAkunID INT NOT NULL,
  IsDeleted BIT NOT NULL DEFAULT 0,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()
);

CREATE TABLE DashboardProduksiMuatanDetail (
  MuatanDetailID INT IDENTITY(1,1) PRIMARY KEY,
  JadwalID INT NOT NULL,
  BatchID INT NOT NULL,
  Qty10KGDiambil INT NOT NULL DEFAULT 0,
  Qty5KGDiambil INT NOT NULL DEFAULT 0,
  DicatatOlehAkunID INT NOT NULL,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()
);

INSERT INTO DashboardProduksiPalletPosisi (Kode) VALUES
('1A'), ('1B'), ('1C'), ('1D'),
('2A'), ('2B'), ('2C'), ('2D'),
('3A'), ('3B'), ('3C'), ('3D');

INSERT INTO DashboardProduksiMesin (Nama) VALUES
('Mesin 1'), ('Mesin 2'), ('Mesin 3');
```

- [ ] **Step 2: Verify**

Query `sql_get_table_info` for all 4 table names and confirm columns match exactly what's listed above. Then run `SELECT Kode FROM DashboardProduksiPalletPosisi ORDER BY Kode` and confirm all 12 codes (`1A`-`3D`) are present, and `SELECT Nama FROM DashboardProduksiMesin` returns exactly 3 rows. Note for whoever edits Mesin data later: the 3 seeded rows have placeholder `0` values for capacity/consumption/duration — these must be corrected via the `/mkesindo/produksi` dashboard's Panel Mesin edit dialog (Task 12) once real specs are available.

- [ ] **Step 3: Record in the SDD ledger**

No git commit for this task (no files changed) — record completion in the SDD progress ledger only, noting the DDL ran successfully and was verified.

---

## Task 7: `produksi-mesin.ts` query module

**Files:**
- Create: `src/lib/queries/produksi-mesin.ts`

**Interfaces:**
- Consumes: `DashboardProduksiMesin` table from Task 6.
- Produces: `MesinRow`, `getMesinList(): Promise<MesinRow[]>`, `UpdateMesinInput`, `updateMesin(input: UpdateMesinInput): Promise<void>` — consumed by Task 10.

- [ ] **Step 1: Write the query module**

```ts
import { getPool, sql } from "@/lib/db";

export interface MesinRow {
  MesinID: number;
  Nama: string;
  KapasitasProduksiPerHari: number;
  KonsumsiListrikKWh: number;
  LamaProduksiMenit: number;
  LamaPengemasanMenit: number;
}

export async function getMesinList(): Promise<MesinRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT MesinID, Nama, KapasitasProduksiPerHari, KonsumsiListrikKWh, LamaProduksiMenit, LamaPengemasanMenit
    FROM DashboardProduksiMesin
    WHERE IsDeleted = 0
    ORDER BY MesinID
  `);
  return result.recordset;
}

export interface UpdateMesinInput {
  mesinId: number;
  nama: string;
  kapasitasProduksiPerHari: number;
  konsumsiListrikKWh: number;
  lamaProduksiMenit: number;
  lamaPengemasanMenit: number;
}

export async function updateMesin(input: UpdateMesinInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("mesinId", sql.Int, input.mesinId)
    .input("nama", sql.VarChar(100), input.nama)
    .input("kapasitas", sql.Int, input.kapasitasProduksiPerHari)
    .input("listrik", sql.Decimal(10, 2), input.konsumsiListrikKWh)
    .input("lamaProduksi", sql.Int, input.lamaProduksiMenit)
    .input("lamaKemas", sql.Int, input.lamaPengemasanMenit)
    .query(`
      UPDATE DashboardProduksiMesin
      SET Nama = @nama, KapasitasProduksiPerHari = @kapasitas, KonsumsiListrikKWh = @listrik,
          LamaProduksiMenit = @lamaProduksi, LamaPengemasanMenit = @lamaKemas, ModifiedDate = GETDATE()
      WHERE MesinID = @mesinId AND IsDeleted = 0
    `);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx eslint src/lib/queries/produksi-mesin.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/produksi-mesin.ts
git commit -m "Add produksi-mesin query module"
```

---

## Task 8: `produksi-warehouse.ts` query module

**Files:**
- Create: `src/lib/queries/produksi-warehouse.ts`

**Interfaces:**
- Consumes: `DashboardProduksiPalletPosisi`, `DashboardProduksiBatch`, `DashboardProduksiMesin` tables from Task 6; `AppError` from `@/lib/action-result`.
- Produces: `PalletPosisiRow`, `getWarehouseMap(): Promise<PalletPosisiRow[]>`, `RiwayatProduksiRow`, `getRiwayatProduksi(limit?: number): Promise<RiwayatProduksiRow[]>`, `CreateBatchInput`, `createBatch(input: CreateBatchInput): Promise<number>` — consumed by Task 10.

- [ ] **Step 1: Write the query module**

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface PalletPosisiRow {
  PosisiID: number;
  Kode: string;
  BatchIDAktif: number | null;
  MesinNama: string | null;
  TanggalProduksi: Date | null;
  SisaQty10KG: number | null;
  SisaQty5KG: number | null;
}

export async function getWarehouseMap(): Promise<PalletPosisiRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.PosisiID, p.Kode, p.BatchIDAktif, m.Nama AS MesinNama, b.TanggalProduksi, b.SisaQty10KG, b.SisaQty5KG
    FROM DashboardProduksiPalletPosisi p
    LEFT JOIN DashboardProduksiBatch b ON b.BatchID = p.BatchIDAktif AND b.IsDeleted = 0
    LEFT JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
    ORDER BY p.Kode
  `);
  return result.recordset;
}

export interface RiwayatProduksiRow {
  BatchID: number;
  Kode: string;
  MesinNama: string;
  TanggalProduksi: Date;
  Qty10KG: number;
  Qty5KG: number;
  SisaQty10KG: number;
  SisaQty5KG: number;
  DicatatOlehAkunID: number;
}

export async function getRiwayatProduksi(limit = 50): Promise<RiwayatProduksiRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) b.BatchID, p.Kode, m.Nama AS MesinNama, b.TanggalProduksi,
             b.Qty10KG, b.Qty5KG, b.SisaQty10KG, b.SisaQty5KG, b.DicatatOlehAkunID
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0
      ORDER BY b.TanggalProduksi DESC
    `);
  return result.recordset;
}

export interface CreateBatchInput {
  mesinId: number;
  posisiId: number;
  qty10KG: number;
  qty5KG: number;
  dicatatOlehAkunId: number;
}

// A pallet position holds exactly one batch until it's fully consumed
// (BatchIDAktif is cleared only when both Sisa columns hit 0 — see
// produksi-muatan.ts's produksiMulaiMuat) — this function enforces that
// "one pallet = one batch at a time" rule at creation time.
export async function createBatch(input: CreateBatchInput): Promise<number> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const posisiCheck = await new sql.Request(transaction)
      .input("posisiId", sql.Int, input.posisiId)
      .query(`SELECT BatchIDAktif FROM DashboardProduksiPalletPosisi WHERE PosisiID = @posisiId`);
    const posisi = posisiCheck.recordset[0];
    if (!posisi) throw new AppError("Posisi pallet tidak ditemukan.");
    if (posisi.BatchIDAktif != null) throw new AppError("Posisi pallet ini sudah terisi batch lain.");

    const insertResult = await new sql.Request(transaction)
      .input("mesinId", sql.Int, input.mesinId)
      .input("posisiId", sql.Int, input.posisiId)
      .input("qty10", sql.Int, input.qty10KG)
      .input("qty5", sql.Int, input.qty5KG)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .query(`
        INSERT INTO DashboardProduksiBatch (MesinID, PosisiID, TanggalProduksi, Qty10KG, Qty5KG, SisaQty10KG, SisaQty5KG, DicatatOlehAkunID)
        OUTPUT INSERTED.BatchID
        VALUES (@mesinId, @posisiId, GETDATE(), @qty10, @qty5, @qty10, @qty5, @akunId)
      `);
    const batchId = insertResult.recordset[0].BatchID as number;

    await new sql.Request(transaction)
      .input("posisiId", sql.Int, input.posisiId)
      .input("batchId", sql.Int, batchId)
      .query(`UPDATE DashboardProduksiPalletPosisi SET BatchIDAktif = @batchId, ModifiedDate = GETDATE() WHERE PosisiID = @posisiId`);

    await transaction.commit();
    return batchId;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx eslint src/lib/queries/produksi-warehouse.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/produksi-warehouse.ts
git commit -m "Add produksi-warehouse query module"
```

---

## Task 9: `produksi-muatan.ts` query module

**Files:**
- Create: `src/lib/queries/produksi-muatan.ts`

**Interfaces:**
- Consumes: `DashboardProduksiBatch`, `DashboardProduksiPalletPosisi`, `DashboardProduksiMuatanDetail` tables from Task 6; `JADWAL_KANTONG_10KG_EXPR`, `JADWAL_KANTONG_5KG_EXPR`, `startMuat` from `@/lib/queries/pengiriman-jadwal`; `AppError` from `@/lib/action-result`.
- Produces: `DraftJadwalForProduksi`, `getDraftJadwalForProduksi(businessDate: string): Promise<DraftJadwalForProduksi[]>`, `MuatanAlokasi`, `ProduksiMulaiMuatInput`, `produksiMulaiMuat(input: ProduksiMulaiMuatInput): Promise<void>` — consumed by Task 10.

- [ ] **Step 1: Write the query module**

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import {
  startMuat,
  JADWAL_KANTONG_10KG_EXPR,
  JADWAL_KANTONG_5KG_EXPR,
} from "@/lib/queries/pengiriman-jadwal";

export interface DraftJadwalForProduksi {
  JadwalID: number;
  ArmadaNama: string;
  JamJadwal: Date;
  Qty10KGDibutuhkan: number;
  Qty5KGDibutuhkan: number;
}

// Only rows still awaiting "Mulai Muat" (JamMulaiMuat IS NULL) — once
// produksiMulaiMuat below runs, the row disappears from this list. Rows
// already muat-started but not yet "Selesai Muat" stay entirely on the
// desktop Papan Pengiriman flow, unchanged (see Task 21).
export async function getDraftJadwalForProduksi(businessDate: string): Promise<DraftJadwalForProduksi[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate)
    .query(`
      SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal,
             ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KGDibutuhkan,
             ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KGDibutuhkan
      FROM DashboardPengirimanJadwal j
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE j.IsDeleted = 0 AND j.Status = 'Draft' AND j.JamMulaiMuat IS NULL
        AND j.JamJadwal >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
        AND j.JamJadwal <  DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
      GROUP BY j.JadwalID, a.Nama, j.JamJadwal
      ORDER BY j.JamJadwal
    `);
  return result.recordset;
}

export interface MuatanAlokasi {
  batchId: number;
  qty10KG: number;
  qty5KG: number;
}

export interface ProduksiMulaiMuatInput {
  jadwalId: number;
  alokasi: MuatanAlokasi[];
  dicatatOlehAkunId: number;
}

export async function produksiMulaiMuat(input: ProduksiMulaiMuatInput): Promise<void> {
  if (input.alokasi.length === 0) {
    throw new AppError("Pilih minimal satu pallet untuk mengisi muatan.");
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const item of input.alokasi) {
      const batchResult = await new sql.Request(transaction)
        .input("batchId", sql.Int, item.batchId)
        .query(`SELECT PosisiID, SisaQty10KG, SisaQty5KG FROM DashboardProduksiBatch WHERE BatchID = @batchId AND IsDeleted = 0`);
      const batch = batchResult.recordset[0];
      if (!batch) throw new AppError("Batch pallet tidak ditemukan.");
      if (item.qty10KG > batch.SisaQty10KG || item.qty5KG > batch.SisaQty5KG) {
        throw new AppError("Jumlah yang diambil melebihi sisa stok pallet ini.");
      }

      await new sql.Request(transaction)
        .input("jadwalId", sql.Int, input.jadwalId)
        .input("batchId", sql.Int, item.batchId)
        .input("qty10", sql.Int, item.qty10KG)
        .input("qty5", sql.Int, item.qty5KG)
        .input("akunId", sql.Int, input.dicatatOlehAkunId)
        .query(`
          INSERT INTO DashboardProduksiMuatanDetail (JadwalID, BatchID, Qty10KGDiambil, Qty5KGDiambil, DicatatOlehAkunID)
          VALUES (@jadwalId, @batchId, @qty10, @qty5, @akunId)
        `);

      const newSisa10 = batch.SisaQty10KG - item.qty10KG;
      const newSisa5 = batch.SisaQty5KG - item.qty5KG;
      await new sql.Request(transaction)
        .input("batchId", sql.Int, item.batchId)
        .input("sisa10", sql.Int, newSisa10)
        .input("sisa5", sql.Int, newSisa5)
        .query(`UPDATE DashboardProduksiBatch SET SisaQty10KG = @sisa10, SisaQty5KG = @sisa5, ModifiedDate = GETDATE() WHERE BatchID = @batchId`);

      if (newSisa10 === 0 && newSisa5 === 0) {
        await new sql.Request(transaction)
          .input("posisiId", sql.Int, batch.PosisiID)
          .query(`UPDATE DashboardProduksiPalletPosisi SET BatchIDAktif = NULL, ModifiedDate = GETDATE() WHERE PosisiID = @posisiId`);
      }
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  // startMuat is the existing, unmodified delivery-flow function
  // (src/lib/queries/pengiriman-jadwal.ts) — deliberately called AFTER the
  // pallet-consumption transaction above commits, not inside it, because
  // startMuat opens its own pool.request() and does not accept an external
  // sql.Transaction. Threading a transaction parameter through it would mean
  // modifying its signature, which this design explicitly avoids to protect
  // the delivery flow's own hard-won correctness (Selesai Muat/Berangkat
  // split, ArmadaConflict work) from regression. startMuat's own body is a
  // single trivial UPDATE stamping JamMulaiMuat with no business validation,
  // so the residual risk of it failing after pallet consumption has already
  // committed is accepted as negligible.
  await startMuat(input.jadwalId);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. If `JADWAL_KANTONG_10KG_EXPR`/`JADWAL_KANTONG_5KG_EXPR`/`startMuat` are not exported from `pengiriman-jadwal.ts`, add `export` to their declarations there (they exist in that file per Task research, but confirm export visibility before assuming).
Run: `npx eslint src/lib/queries/produksi-muatan.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/produksi-muatan.ts
git commit -m "Add produksi-muatan query module wrapping startMuat"
```

---

## Task 10: Server actions — `src/app/mkesindo/produksi/actions.ts`

**Files:**
- Create: `src/app/mkesindo/produksi/actions.ts`

**Interfaces:**
- Consumes: `requireProduksi` (Task 4); `getMesinList`/`updateMesin` (Task 7); `getWarehouseMap`/`getRiwayatProduksi`/`createBatch` (Task 8); `getDraftJadwalForProduksi`/`produksiMulaiMuat` (Task 9); `getAkunNamaMap` (Task 2); `getBusinessDateISO` from `@/lib/business-date`.
- Produces: `getMesinListAction`, `updateMesinAction`, `getWarehouseMapAction`, `RiwayatProduksiRowWithNama`, `getRiwayatProduksiAction`, `createBatchAction`, `getDraftJadwalForProduksiAction`, `produksiMulaiMuatAction` — consumed by every UI component from Task 11 onward.

- [ ] **Step 1: Write the actions file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireProduksi } from "@/lib/require-access";
import { getMesinList, updateMesin, type MesinRow, type UpdateMesinInput } from "@/lib/queries/produksi-mesin";
import {
  getWarehouseMap,
  getRiwayatProduksi,
  createBatch,
  type PalletPosisiRow,
  type RiwayatProduksiRow,
  type CreateBatchInput,
} from "@/lib/queries/produksi-warehouse";
import {
  getDraftJadwalForProduksi,
  produksiMulaiMuat,
  type DraftJadwalForProduksi,
  type ProduksiMulaiMuatInput,
} from "@/lib/queries/produksi-muatan";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { getBusinessDateISO } from "@/lib/business-date";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getMesinListAction(): Promise<ActionResult<MesinRow[]>> {
  return runAction(async () => {
    await requireProduksi();
    return getMesinList();
  });
}

export async function updateMesinAction(input: UpdateMesinInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksi();
    if (!input.nama.trim()) throw new AppError("Nama mesin tidak boleh kosong.");
    if (input.kapasitasProduksiPerHari <= 0) throw new AppError("Kapasitas produksi harus lebih dari 0.");
    await updateMesin(input);
    revalidatePath("/mkesindo/produksi");
  });
}

export async function getWarehouseMapAction(): Promise<ActionResult<PalletPosisiRow[]>> {
  return runAction(async () => {
    await requireProduksi();
    return getWarehouseMap();
  });
}

export interface RiwayatProduksiRowWithNama extends RiwayatProduksiRow {
  DicatatOlehNama: string;
}

export async function getRiwayatProduksiAction(): Promise<ActionResult<RiwayatProduksiRowWithNama[]>> {
  return runAction(async () => {
    await requireProduksi();
    const rows = await getRiwayatProduksi();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}

export async function createBatchAction(
  input: Omit<CreateBatchInput, "dicatatOlehAkunId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksi();
    if (input.qty10KG <= 0 && input.qty5KG <= 0) {
      throw new AppError("Isi jumlah kantong 10kg atau 5kg minimal satu.");
    }
    const batchId = await createBatch({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    return batchId;
  });
}

export async function getDraftJadwalForProduksiAction(): Promise<ActionResult<DraftJadwalForProduksi[]>> {
  return runAction(async () => {
    await requireProduksi();
    return getDraftJadwalForProduksi(getBusinessDateISO());
  });
}

export async function produksiMulaiMuatAction(
  input: Omit<ProduksiMulaiMuatInput, "dicatatOlehAkunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksi();
    const totalQty10 = input.alokasi.reduce((sum, a) => sum + a.qty10KG, 0);
    const totalQty5 = input.alokasi.reduce((sum, a) => sum + a.qty5KG, 0);
    const jadwalList = await getDraftJadwalForProduksi(getBusinessDateISO());
    const jadwal = jadwalList.find((j) => j.JadwalID === input.jadwalId);
    if (!jadwal) throw new AppError("Kartu Pengiriman ini sudah tidak tersedia untuk diisi.");
    if (totalQty10 < jadwal.Qty10KGDibutuhkan || totalQty5 < jadwal.Qty5KGDibutuhkan) {
      throw new AppError("Jumlah yang dialokasikan belum mencukupi kebutuhan Kartu Pengiriman ini.");
    }
    await produksiMulaiMuat({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/delivery");
  });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx eslint src/app/mkesindo/produksi/actions.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/mkesindo/produksi/actions.ts
git commit -m "Add Produksi server actions"
```

---

## Task 11: `PetaWarehouse` shared component

**Files:**
- Create: `src/components/produksi/peta-warehouse.tsx`

**Interfaces:**
- Consumes: `PalletPosisiRow` from Task 8.
- Produces: `PetaWarehouse({ posisi }: { posisi: PalletPosisiRow[] })` — consumed by Task 12 (dashboard page) and Task 18 (produksi-app Warehouse tab).

- [ ] **Step 1: Write the component**

Implements the confirmed warehouse denah: 3 "Jendela" blocks stacked vertically, each with a top pallet row (C, A) and bottom pallet row (D, B), a "Jalan" strip at the bottom, and a "Pintu Geser" strip at the very bottom. Cell color signals stock age for FIFO guidance (red = oldest, amber = mid, green = new, gray = empty).

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

const JENDELA_LAYOUT: { jendela: number; atas: [string, string]; bawah: [string, string] }[] = [
  { jendela: 1, atas: ["1C", "1A"], bawah: ["1D", "1B"] },
  { jendela: 2, atas: ["2C", "2A"], bawah: ["2D", "2B"] },
  { jendela: 3, atas: ["3C", "3A"], bawah: ["3D", "3B"] },
];

function ageClass(tanggalProduksi: Date | string | null): string {
  if (!tanggalProduksi) return "bg-muted text-muted-foreground";
  const ageDays = (Date.now() - new Date(tanggalProduksi).getTime()) / 86400000;
  if (ageDays >= 3) return "bg-red-600 text-white";
  if (ageDays >= 1) return "bg-amber-500 text-white";
  return "bg-emerald-600 text-white";
}

export function PetaWarehouse({ posisi }: { posisi: PalletPosisiRow[] }) {
  const [selected, setSelected] = useState<PalletPosisiRow | null>(null);
  const byKode = new Map(posisi.map((p) => [p.Kode, p]));

  function Cell({ kode }: { kode: string }) {
    const row = byKode.get(kode);
    return (
      <button
        type="button"
        onClick={() => row && setSelected(row)}
        className={cn(
          "flex h-14 flex-1 items-center justify-center rounded-md text-xs font-semibold",
          row ? ageClass(row.TanggalProduksi) : "bg-muted text-muted-foreground"
        )}
      >
        {kode}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mx-auto flex max-w-xs flex-col gap-1">
        {JENDELA_LAYOUT.map(({ jendela, atas, bawah }) => (
          <div key={jendela} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <Cell kode={atas[0]} />
              <Cell kode={atas[1]} />
            </div>
            <div className="flex items-center gap-2 text-center text-[11px] text-muted-foreground">
              <span className="flex-1 border-t border-dashed border-border" />
              <span>Jalan &amp; Jendela {jendela}</span>
              <span className="flex-1 border-t border-dashed border-border" />
            </div>
            <div className="flex gap-2">
              <Cell kode={bawah[0]} />
              <Cell kode={bawah[1]} />
            </div>
          </div>
        ))}
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Jalan</p>
        <p className="rounded-md bg-muted py-1 text-center text-xs font-medium">Pintu Geser</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-[11px]">
        <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-red-600" /> Paling lama</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-amber-500" /> Menengah</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-emerald-600" /> Baru</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-muted" /> Kosong</span>
      </div>

      {selected && (
        <div className="mt-4 rounded-md border border-border p-3 text-sm">
          <p className="font-semibold">Pallet {selected.Kode}</p>
          <p className="text-muted-foreground">Mesin: {selected.MesinNama ?? "-"}</p>
          <p className="text-muted-foreground">
            Sisa: {selected.SisaQty10KG ?? 0} kantong 10kg, {selected.SisaQty5KG ?? 0} kantong 5kg
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx eslint src/components/produksi/peta-warehouse.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi/peta-warehouse.tsx
git commit -m "Add shared PetaWarehouse component"
```

---

## Task 12: `PanelMesin` dashboard component

**Files:**
- Create: `src/components/produksi/panel-mesin.tsx`

**Interfaces:**
- Consumes: `MesinRow` from Task 7; `updateMesinAction` from Task 10.
- Produces: `PanelMesin({ mesinList }: { mesinList: MesinRow[] })` — consumed by Task 14.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { updateMesinAction } from "@/app/mkesindo/produksi/actions";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

export function PanelMesin({ mesinList }: { mesinList: MesinRow[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {mesinList.map((mesin) => (
        <MesinCard key={mesin.MesinID} mesin={mesin} />
      ))}
    </div>
  );
}

function MesinCard({ mesin }: { mesin: MesinRow }) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState(mesin.Nama);
  const [kapasitas, setKapasitas] = useState(String(mesin.KapasitasProduksiPerHari));
  const [listrik, setListrik] = useState(String(mesin.KonsumsiListrikKWh));
  const [lamaProduksi, setLamaProduksi] = useState(String(mesin.LamaProduksiMenit));
  const [lamaKemas, setLamaKemas] = useState(String(mesin.LamaPengemasanMenit));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateMesinAction({
        mesinId: mesin.MesinID,
        nama,
        kapasitasProduksiPerHari: Number(kapasitas),
        konsumsiListrikKWh: Number(listrik),
        lamaProduksiMenit: Number(lamaProduksi),
        lamaPengemasanMenit: Number(lamaKemas),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="rounded-lg border border-border p-3 text-left text-sm hover:bg-muted/50">
        <p className="font-semibold">{mesin.Nama}</p>
        <p className="text-xs text-muted-foreground">Kapasitas: {mesin.KapasitasProduksiPerHari} kantong/hari</p>
        <p className="text-xs text-muted-foreground">Listrik: {mesin.KonsumsiListrikKWh} kWh</p>
        <p className="text-xs text-muted-foreground">Produksi: {mesin.LamaProduksiMenit} menit</p>
        <p className="text-xs text-muted-foreground">Kemas: {mesin.LamaPengemasanMenit} menit</p>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah Data Mesin</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Nama</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} />
          </div>
          <div>
            <Label>Kapasitas Produksi (kantong/hari)</Label>
            <Input type="number" value={kapasitas} onChange={(e) => setKapasitas(e.target.value)} />
          </div>
          <div>
            <Label>Konsumsi Listrik (kWh)</Label>
            <Input type="number" value={listrik} onChange={(e) => setListrik(e.target.value)} />
          </div>
          <div>
            <Label>Lama Produksi (menit)</Label>
            <Input type="number" value={lamaProduksi} onChange={(e) => setLamaProduksi(e.target.value)} />
          </div>
          <div>
            <Label>Lama Pengemasan (menit)</Label>
            <Input type="number" value={lamaKemas} onChange={(e) => setLamaKemas(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx eslint src/components/produksi/panel-mesin.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi/panel-mesin.tsx
git commit -m "Add PanelMesin dashboard component"
```

---

## Task 13: `RiwayatProduksi` dashboard component

**Files:**
- Create: `src/components/produksi/riwayat-produksi.tsx`

**Interfaces:**
- Consumes: `RiwayatProduksiRowWithNama` from Task 10.
- Produces: `RiwayatProduksi({ riwayat }: { riwayat: RiwayatProduksiRowWithNama[] })` — consumed by Task 14.

- [ ] **Step 1: Write the component**

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RiwayatProduksiRowWithNama } from "@/app/mkesindo/produksi/actions";

export function RiwayatProduksi({ riwayat }: { riwayat: RiwayatProduksiRowWithNama[] }) {
  if (riwayat.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada riwayat produksi.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tanggal</TableHead>
            <TableHead>Mesin</TableHead>
            <TableHead>Pallet</TableHead>
            <TableHead>Jumlah Awal</TableHead>
            <TableHead>Sisa</TableHead>
            <TableHead>Dicatat Oleh</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {riwayat.map((r) => (
            <TableRow key={r.BatchID}>
              <TableCell>{new Date(r.TanggalProduksi).toLocaleDateString("id-ID")}</TableCell>
              <TableCell>{r.MesinNama}</TableCell>
              <TableCell>{r.Kode}</TableCell>
              <TableCell>
                {r.Qty10KG} kantong 10kg, {r.Qty5KG} kantong 5kg
              </TableCell>
              <TableCell>
                {r.SisaQty10KG} kantong 10kg, {r.SisaQty5KG} kantong 5kg
              </TableCell>
              <TableCell>{r.DicatatOlehNama}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx eslint src/components/produksi/riwayat-produksi.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi/riwayat-produksi.tsx
git commit -m "Add RiwayatProduksi dashboard component"
```

---

## Task 14: `/mkesindo/produksi` layout + page assembly

**Files:**
- Create: `src/components/produksi/produksi-header.tsx`
- Create: `src/app/mkesindo/produksi/layout.tsx`
- Create: `src/app/mkesindo/produksi/page.tsx`

**Interfaces:**
- Consumes: `requireProduksi` (Task 4); `getWarehouseMap`, `getRiwayatProduksi` behavior via `getRiwayatProduksiAction` (Task 10 provides the name-resolved version — page uses the direct query functions for its own server-side fetch, matching the driver-app page pattern of fetching directly rather than through the action layer for the initial render); `PetaWarehouse` (Task 11); `PanelMesin` (Task 12); `RiwayatProduksi` (Task 13); `getMesinList` (Task 7); `getAkunNamaMap` (Task 2).

- [ ] **Step 1: Write the header component**

```tsx
"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function ProduksiHeader({ userName }: { userName: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background px-4">
      <div>
        <p className="text-sm font-semibold">Modul Produksi</p>
        <p className="text-xs text-muted-foreground">{userName}</p>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => signOut({ callbackUrl: "/login" })}>
        <LogOut className="size-4" />
      </Button>
    </header>
  );
}
```

- [ ] **Step 2: Write the layout**

`/mkesindo/produksi` lives outside `(dashboard)` — this file has no sidebar chrome, just the access guard, mirroring `driver-app/(tabs)/layout.tsx`:

```tsx
import { requireProduksi } from "@/lib/require-access";

export default async function ProduksiLayout({ children }: { children: React.ReactNode }) {
  await requireProduksi();
  return children;
}
```

- [ ] **Step 3: Write the page**

```tsx
import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap, getRiwayatProduksi } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { ProduksiHeader } from "@/components/produksi/produksi-header";
import { PetaWarehouse } from "@/components/produksi/peta-warehouse";
import { PanelMesin } from "@/components/produksi/panel-mesin";
import { RiwayatProduksi } from "@/components/produksi/riwayat-produksi";

export default async function ProduksiPage() {
  const session = await requireProduksi();
  const [posisi, mesinList, riwayatRaw] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getRiwayatProduksi(),
  ]);
  const namaMap = await getAkunNamaMap(riwayatRaw.map((r) => r.DicatatOlehAkunID));
  const riwayat = riwayatRaw.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <ProduksiHeader userName={session.user.name ?? session.user.username} />
      <main className="flex flex-1 flex-col gap-6 p-4">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Peta Warehouse</h2>
          <PetaWarehouse posisi={posisi} />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Mesin Produksi</h2>
          <PanelMesin mesinList={mesinList} />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Riwayat Produksi</h2>
          <RiwayatProduksi riwayat={riwayat} />
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npx eslint src/components/produksi/produksi-header.tsx src/app/mkesindo/produksi/layout.tsx src/app/mkesindo/produksi/page.tsx`
Expected: no errors.
Live check: with a test account that has `isProduksi = true` (toggle it via `/grup/akun/peran` from Task 4), log in and confirm landing directly on `/mkesindo/produksi` showing the warehouse map (12 gray "kosong" cells initially), the 3 seeded Mesin cards, and an empty Riwayat Produksi table. Also confirm this same account visiting `/mkesindo/pnl` (or any other `(dashboard)` route) gets redirected back to `/mkesindo/produksi` — this exercises Task 5's guard for the first time.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi/produksi-header.tsx src/app/mkesindo/produksi/layout.tsx src/app/mkesindo/produksi/page.tsx
git commit -m "Add /mkesindo/produksi dashboard page"
```

---

## Task 15: produksi-app tab shell + bottom nav

**Files:**
- Create: `src/components/produksi-app/bottom-nav.tsx`
- Create: `src/components/produksi-app/produksi-tab-shell.tsx`
- Create: `src/app/mkesindo/produksi-app/(tabs)/layout.tsx`

**Interfaces:**
- Consumes: `requireProduksi` (Task 4); `getDraftJadwalForProduksiAction`, `getWarehouseMapAction`, `getMesinListAction` (Task 10).
- Produces: `ProduksiTabKey`, `ProduksiTabShell` — consumed by Tasks 16-19; `ProduksiBottomNav`.

- [ ] **Step 1: Write the bottom nav**

```tsx
"use client";

import { ClipboardList, PackagePlus, Warehouse, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProduksiTabKey } from "./produksi-tab-shell";

const TABS: { key: ProduksiTabKey; label: string; icon: typeof ClipboardList }[] = [
  { key: "kartu-pengiriman", label: "Kartu Pengiriman", icon: ClipboardList },
  { key: "produksi-baru", label: "Produksi Baru", icon: PackagePlus },
  { key: "warehouse", label: "Warehouse", icon: Warehouse },
  { key: "profil", label: "Profil", icon: User },
];

export function ProduksiBottomNav({
  activeTab,
  onChange,
}: {
  activeTab: ProduksiTabKey;
  onChange: (tab: ProduksiTabKey) => void;
}) {
  return (
    <nav className="flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write the tab shell**

Mirrors `DriverTabShell`'s keep-alive pattern (per-tab state, `visited` set, `hidden` CSS toggle instead of unmount, `history.replaceState` for URL cosmetics). Component bodies for `KartuPengirimanList`, `ProduksiBaruForm`, `WarehouseView`, `ProfilView` are added in Tasks 16-19 — this task only wires the shell around them, so it imports files that do not exist yet; that's expected and resolved once Tasks 16-19 land (all in the same overall plan, executed in order).

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { KartuPengirimanList } from "@/components/produksi-app/kartu-pengiriman-list";
import { ProduksiBaruForm } from "@/components/produksi-app/produksi-baru-form";
import { WarehouseView } from "@/components/produksi-app/warehouse-view";
import { ProfilView } from "@/components/produksi-app/profil-view";
import { ProduksiBottomNav } from "@/components/produksi-app/bottom-nav";
import {
  getDraftJadwalForProduksiAction,
  getWarehouseMapAction,
  getMesinListAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

export type ProduksiTabKey = "kartu-pengiriman" | "produksi-baru" | "warehouse" | "profil";

const TAB_PATHS: Record<ProduksiTabKey, string> = {
  "kartu-pengiriman": "/mkesindo/produksi-app",
  "produksi-baru": "/mkesindo/produksi-app/produksi-baru",
  warehouse: "/mkesindo/produksi-app/warehouse",
  profil: "/mkesindo/produksi-app/profil",
};

export function ProduksiTabShell({
  initialTab,
  userName,
  initialKartuPengiriman,
  initialWarehouse,
  initialMesin,
}: {
  initialTab: ProduksiTabKey;
  userName: string;
  initialKartuPengiriman?: DraftJadwalForProduksi[];
  initialWarehouse?: PalletPosisiRow[];
  initialMesin?: MesinRow[];
}) {
  const [activeTab, setActiveTab] = useState<ProduksiTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<ProduksiTabKey>>(() => new Set([initialTab]));

  const [kartuPengiriman, setKartuPengiriman] = useState<DraftJadwalForProduksi[] | null>(initialKartuPengiriman ?? null);
  const [warehouse, setWarehouse] = useState<PalletPosisiRow[] | null>(initialWarehouse ?? null);
  const [mesin, setMesin] = useState<MesinRow[] | null>(initialMesin ?? null);

  const [loadingTab, setLoadingTab] = useState<ProduksiTabKey | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  function handleChangeTab(tab: ProduksiTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  function refreshKartuPengiriman() {
    setKartuPengiriman(null);
  }

  function refreshWarehouse() {
    setWarehouse(null);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTabError(null);
      if (activeTab === "kartu-pengiriman" && kartuPengiriman === null) {
        setLoadingTab("kartu-pengiriman");
        const result = await getDraftJadwalForProduksiAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setKartuPengiriman(result.data);
        setLoadingTab(null);
        return;
      }
      if ((activeTab === "produksi-baru" || activeTab === "warehouse") && warehouse === null) {
        setLoadingTab(activeTab);
        const result = await getWarehouseMapAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setWarehouse(result.data);
        setLoadingTab(null);
      }
      if (activeTab === "produksi-baru" && mesin === null) {
        setLoadingTab("produksi-baru");
        const result = await getMesinListAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setMesin(result.data);
        setLoadingTab(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        {loadingTab && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {tabError && (
          <p className="absolute inset-x-4 top-4 z-10 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {tabError}
          </p>
        )}
        {visited.has("kartu-pengiriman") && kartuPengiriman && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "kartu-pengiriman" && "hidden")}>
            <KartuPengirimanList initialJadwal={kartuPengiriman} onAfterMuat={refreshKartuPengiriman} />
          </div>
        )}
        {visited.has("produksi-baru") && warehouse && mesin && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "produksi-baru" && "hidden")}>
            <ProduksiBaruForm mesinList={mesin} posisi={warehouse} onAfterSimpan={refreshWarehouse} />
          </div>
        )}
        {visited.has("warehouse") && warehouse && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "warehouse" && "hidden")}>
            <WarehouseView posisi={warehouse} />
          </div>
        )}
        {visited.has("profil") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "profil" && "hidden")}>
            <ProfilView userName={userName} />
          </div>
        )}
      </div>
      <ProduksiBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
```

- [ ] **Step 3: Write the tabs layout**

```tsx
import { requireProduksi } from "@/lib/require-access";

export default async function ProduksiAppTabsLayout({ children }: { children: React.ReactNode }) {
  await requireProduksi();
  return children;
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expected to FAIL at this point with "Cannot find module '@/components/produksi-app/kartu-pengiriman-list'" (and 3 similar errors) since those files don't exist yet. This is expected; confirm the failures are ONLY these 4 missing-module errors and nothing else, then proceed — Tasks 16-19 resolve them.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi-app/bottom-nav.tsx src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/layout.tsx"
git commit -m "Add produksi-app tab shell skeleton"
```

---

## Task 16: Tab "Kartu Pengiriman" — list + Isi Muatan allocation screen

**Files:**
- Create: `src/components/produksi-app/kartu-pengiriman-list.tsx`
- Create: `src/app/mkesindo/produksi-app/(tabs)/page.tsx`

**Interfaces:**
- Consumes: `DraftJadwalForProduksi` (Task 9); `getWarehouseMapAction`, `produksiMulaiMuatAction` (Task 10); `ProduksiTabShell` (Task 15).
- Produces: `KartuPengirimanList({ initialJadwal, onAfterMuat }: { initialJadwal: DraftJadwalForProduksi[]; onAfterMuat: () => void })` — consumed by Task 15's shell.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWarehouseMapAction, produksiMulaiMuatAction } from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

export function KartuPengirimanList({
  initialJadwal,
  onAfterMuat,
}: {
  initialJadwal: DraftJadwalForProduksi[];
  onAfterMuat: () => void;
}) {
  const [jadwalList, setJadwalList] = useState(initialJadwal);
  const [selected, setSelected] = useState<DraftJadwalForProduksi | null>(null);

  function handleDone(jadwalId: number) {
    setJadwalList((prev) => prev.filter((j) => j.JadwalID !== jadwalId));
    setSelected(null);
    onAfterMuat();
  }

  if (selected) {
    return (
      <IsiMuatanScreen
        jadwal={selected}
        onBack={() => setSelected(null)}
        onDone={() => handleDone(selected.JadwalID)}
      />
    );
  }

  if (jadwalList.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-muted-foreground">
        Tidak ada Kartu Pengiriman yang perlu diisi muatan saat ini.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {jadwalList.map((jadwal) => (
        <button
          key={jadwal.JadwalID}
          type="button"
          onClick={() => setSelected(jadwal)}
          className="rounded-lg border border-border p-3 text-left"
        >
          <p className="font-semibold">{jadwal.ArmadaNama}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="mt-1 text-sm">
            Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
          </p>
        </button>
      ))}
    </div>
  );
}

function IsiMuatanScreen({
  jadwal,
  onBack,
  onDone,
}: {
  jadwal: DraftJadwalForProduksi;
  onBack: () => void;
  onDone: () => void;
}) {
  const [posisi, setPosisi] = useState<PalletPosisiRow[] | null>(null);
  const [alokasi, setAlokasi] = useState<Record<number, { qty10: number; qty5: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getWarehouseMapAction().then((result) => {
      if (result.success) {
        setPosisi(
          result.data
            .filter((p) => p.BatchIDAktif != null)
            .sort((a, b) => new Date(a.TanggalProduksi ?? 0).getTime() - new Date(b.TanggalProduksi ?? 0).getTime())
        );
      }
    });
  }, []);

  const totalQty10 = Object.values(alokasi).reduce((sum, a) => sum + a.qty10, 0);
  const totalQty5 = Object.values(alokasi).reduce((sum, a) => sum + a.qty5, 0);
  const cukup = totalQty10 >= jadwal.Qty10KGDibutuhkan && totalQty5 >= jadwal.Qty5KGDibutuhkan;

  function setAmbil(posisiId: number, field: "qty10" | "qty5", value: number, max: number) {
    setAlokasi((prev) => ({
      ...prev,
      [posisiId]: {
        qty10: prev[posisiId]?.qty10 ?? 0,
        qty5: prev[posisiId]?.qty5 ?? 0,
        [field]: Math.min(Math.max(0, value), max),
      },
    }));
  }

  function handleAmbilSemua(row: PalletPosisiRow) {
    setAlokasi((prev) => ({ ...prev, [row.PosisiID]: { qty10: row.SisaQty10KG ?? 0, qty5: row.SisaQty5KG ?? 0 } }));
  }

  function handleSubmit() {
    setError(null);
    if (!posisi) return;
    const alokasiList = posisi
      .filter((row) => alokasi[row.PosisiID] && (alokasi[row.PosisiID].qty10 > 0 || alokasi[row.PosisiID].qty5 > 0))
      .map((row) => ({
        batchId: row.BatchIDAktif as number,
        qty10KG: alokasi[row.PosisiID].qty10,
        qty5KG: alokasi[row.PosisiID].qty5,
      }));
    startTransition(async () => {
      const result = await produksiMulaiMuatAction({ jadwalId: jadwal.JadwalID, alokasi: alokasiList });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <Button variant="outline" size="sm" onClick={onBack} className="w-fit">
        Kembali
      </Button>
      <p className="font-semibold">{jadwal.ArmadaNama}</p>
      <p className="text-sm text-muted-foreground">
        Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
      </p>
      <p className="text-sm">
        Sudah dialokasikan: {totalQty10} kantong 10kg, {totalQty5} kantong 5kg
      </p>

      {posisi === null ? (
        <p className="text-sm text-muted-foreground">Memuat data pallet...</p>
      ) : (
        <div className="flex flex-col gap-2">
          {posisi.map((row, index) => (
            <div
              key={row.PosisiID}
              className={index === 0 ? "rounded-lg border-2 border-amber-500 p-3" : "rounded-lg border border-border p-3"}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  Pallet {row.Kode}
                  {index === 0 && <span className="ml-2 text-xs text-amber-600">Paling lama — ambil dulu</span>}
                </p>
                <Button size="sm" variant="outline" onClick={() => handleAmbilSemua(row)}>
                  Ambil semua sisa
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Sisa: {row.SisaQty10KG} kantong 10kg, {row.SisaQty5KG} kantong 5kg
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  type="number"
                  placeholder="Qty 10kg"
                  value={alokasi[row.PosisiID]?.qty10 ?? ""}
                  onChange={(e) => setAmbil(row.PosisiID, "qty10", Number(e.target.value), row.SisaQty10KG ?? 0)}
                />
                <Input
                  type="number"
                  placeholder="Qty 5kg"
                  value={alokasi[row.PosisiID]?.qty5 ?? ""}
                  onChange={(e) => setAmbil(row.PosisiID, "qty5", Number(e.target.value), row.SisaQty5KG ?? 0)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={!cukup || pending} onClick={handleSubmit}>
        {pending ? "Memproses..." : "Konfirmasi Isi Muatan"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Write the default tab page**

```tsx
import { requireProduksi } from "@/lib/require-access";
import { getDraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import { getBusinessDateISO } from "@/lib/business-date";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppKartuPengirimanPage() {
  const session = await requireProduksi();
  const jadwal = await getDraftJadwalForProduksi(getBusinessDateISO());

  return (
    <ProduksiTabShell
      initialTab="kartu-pengiriman"
      userName={session.user.name ?? session.user.username}
      initialKartuPengiriman={jadwal}
    />
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: the "Cannot find module '@/components/produksi-app/kartu-pengiriman-list'" error from Task 15 is now gone; the other 3 missing-module errors (produksi-baru-form, warehouse-view, profil-view) still remain — expected until Tasks 17-19 land.
Run: `npx eslint src/components/produksi-app/kartu-pengiriman-list.tsx "src/app/mkesindo/produksi-app/(tabs)/page.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi-app/kartu-pengiriman-list.tsx "src/app/mkesindo/produksi-app/(tabs)/page.tsx"
git commit -m "Add Kartu Pengiriman tab with Isi Muatan allocation screen"
```

---

## Task 17: Tab "Produksi Baru" — record new production form

**Files:**
- Create: `src/components/produksi-app/produksi-baru-form.tsx`
- Create: `src/app/mkesindo/produksi-app/(tabs)/produksi-baru/page.tsx`

**Interfaces:**
- Consumes: `MesinRow` (Task 7); `PalletPosisiRow` (Task 8); `createBatchAction` (Task 10); `ProduksiTabShell` (Task 15).
- Produces: `ProduksiBaruForm({ mesinList, posisi, onAfterSimpan }: {...})` — consumed by Task 15's shell.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createBatchAction } from "@/app/mkesindo/produksi/actions";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

export function ProduksiBaruForm({
  mesinList,
  posisi,
  onAfterSimpan,
}: {
  mesinList: MesinRow[];
  posisi: PalletPosisiRow[];
  onAfterSimpan: () => void;
}) {
  const [mesinId, setMesinId] = useState<string>("");
  const [posisiId, setPosisiId] = useState<string>("");
  const [qty10, setQty10] = useState("");
  const [qty5, setQty5] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  const posisiKosong = posisi.filter((p) => p.BatchIDAktif == null);

  function handleSubmit() {
    setError(null);
    setSuccess(false);
    if (!mesinId) {
      setError("Pilih mesin yang dipakai.");
      return;
    }
    if (!posisiId) {
      setError("Pilih posisi pallet.");
      return;
    }
    startTransition(async () => {
      const result = await createBatchAction({
        mesinId: Number(mesinId),
        posisiId: Number(posisiId),
        qty10KG: Number(qty10) || 0,
        qty5KG: Number(qty5) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      setQty10("");
      setQty5("");
      setPosisiId("");
      onAfterSimpan();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <Label>Mesin yang Dipakai</Label>
        <Select value={mesinId} onValueChange={setMesinId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pilih mesin" />
          </SelectTrigger>
          <SelectContent>
            {mesinList.map((m) => (
              <SelectItem key={m.MesinID} value={String(m.MesinID)}>
                {m.Nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Jumlah Kantong 10kg</Label>
        <Input type="number" value={qty10} onChange={(e) => setQty10(e.target.value)} />
      </div>
      <div>
        <Label>Jumlah Kantong 5kg</Label>
        <Input type="number" value={qty5} onChange={(e) => setQty5(e.target.value)} />
      </div>

      <div>
        <Label>Posisi Pallet Kosong</Label>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {posisiKosong.map((p) => (
            <button
              key={p.PosisiID}
              type="button"
              onClick={() => setPosisiId(String(p.PosisiID))}
              className={
                String(p.PosisiID) === posisiId
                  ? "rounded-md border-2 border-primary bg-primary/10 py-2 text-sm font-semibold"
                  : "rounded-md border border-border py-2 text-sm"
              }
            >
              {p.Kode}
            </button>
          ))}
        </div>
        {posisiKosong.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">Tidak ada posisi pallet kosong saat ini.</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-emerald-600">Produksi baru berhasil dicatat.</p>}
      <Button disabled={pending} onClick={handleSubmit}>
        {pending ? "Menyimpan..." : "Simpan"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Write the tab page**

```tsx
import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppProduksiBaruPage() {
  const session = await requireProduksi();
  const [posisi, mesinList] = await Promise.all([getWarehouseMap(), getMesinList()]);

  return (
    <ProduksiTabShell
      initialTab="produksi-baru"
      userName={session.user.name ?? session.user.username}
      initialWarehouse={posisi}
      initialMesin={mesinList}
    />
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: 2 remaining missing-module errors (warehouse-view, profil-view).
Run: `npx eslint src/components/produksi-app/produksi-baru-form.tsx "src/app/mkesindo/produksi-app/(tabs)/produksi-baru/page.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi-app/produksi-baru-form.tsx "src/app/mkesindo/produksi-app/(tabs)/produksi-baru/page.tsx"
git commit -m "Add Produksi Baru tab form"
```

---

## Task 18: Tab "Warehouse" — mobile read-only map

**Files:**
- Create: `src/components/produksi-app/warehouse-view.tsx`
- Create: `src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx`

**Interfaces:**
- Consumes: `PetaWarehouse` (Task 11); `PalletPosisiRow` (Task 8); `ProduksiTabShell` (Task 15).
- Produces: `WarehouseView({ posisi }: { posisi: PalletPosisiRow[] })` — consumed by Task 15's shell.

- [ ] **Step 1: Write the component**

```tsx
import { PetaWarehouse } from "@/components/produksi/peta-warehouse";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

export function WarehouseView({ posisi }: { posisi: PalletPosisiRow[] }) {
  return (
    <div className="p-4">
      <PetaWarehouse posisi={posisi} />
    </div>
  );
}
```

- [ ] **Step 2: Write the tab page**

```tsx
import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppWarehousePage() {
  const session = await requireProduksi();
  const posisi = await getWarehouseMap();

  return (
    <ProduksiTabShell
      initialTab="warehouse"
      userName={session.user.name ?? session.user.username}
      initialWarehouse={posisi}
    />
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: 1 remaining missing-module error (profil-view).
Run: `npx eslint src/components/produksi-app/warehouse-view.tsx "src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi-app/warehouse-view.tsx "src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx"
git commit -m "Add Warehouse tab (mobile read-only map)"
```

---

## Task 19: Tab "Profil"

**Files:**
- Create: `src/components/produksi-app/profil-view.tsx`
- Create: `src/app/mkesindo/produksi-app/(tabs)/profil/page.tsx`

**Interfaces:**
- Consumes: `ProduksiTabShell` (Task 15).
- Produces: `ProfilView({ userName }: { userName: string })` — consumed by Task 15's shell. This is the last of the 4 tab components, so after this task `npx tsc --noEmit` must be fully clean for the produksi-app tree.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function ProfilView({ userName }: { userName: string }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-sm text-muted-foreground">Masuk sebagai</p>
        <p className="text-lg font-semibold">{userName}</p>
      </div>
      <Button variant="outline" onClick={() => signOut({ callbackUrl: "/login" })}>
        <LogOut className="size-4" />
        Keluar
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Write the tab page**

```tsx
import { requireProduksi } from "@/lib/require-access";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppProfilPage() {
  const session = await requireProduksi();
  return <ProduksiTabShell initialTab="profil" userName={session.user.name ?? session.user.username} />;
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors anywhere in the repo (all 4 produksi-app tab components now exist).
Run: `npx eslint src/components/produksi-app/profil-view.tsx "src/app/mkesindo/produksi-app/(tabs)/profil/page.tsx"`
Expected: no errors.
Live check: with the same `isProduksi = true` test account, navigate to `/mkesindo/produksi-app`, confirm all 4 bottom-nav tabs render and switch instantly without a full page reload (keep-alive behavior), the Kartu Pengiriman tab lists any Draft Jadwal without `JamMulaiMuat` for today, Produksi Baru successfully creates a batch into an empty pallet position (confirm it then shows as colored/occupied on the Warehouse tab and the dashboard's Peta Warehouse), and Profil's Keluar button logs out to `/login`.

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi-app/profil-view.tsx "src/app/mkesindo/produksi-app/(tabs)/profil/page.tsx"
git commit -m "Add Profil tab, complete produksi-app tab shell"
```

---

## Task 20: Remove "Mulai Muat" trigger from Papan Pengiriman

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`

**Interfaces:**
- Consumes: none new. Removes the desktop-side call site of `startMuatAction`, now exclusively triggered via `produksiMulaiMuatAction` (Task 10) from produksi-app.

- [ ] **Step 1: Replace the "Mulai Muat" button with a passive status line**

In `src/components/dashboard/route-validation-dialog.tsx`, find the `isDraft` action block (the one containing `Batalkan Draft` and the `jadwal?.JamMulaiMuat == null ? ... : ...` conditional). Replace the "Mulai Muat" branch:

```tsx
{isDraft ? (
  <div className="flex gap-2">
    <Button size="sm" variant="outline" disabled={pending} onClick={handleDeleteDraft}>
      Batalkan Draft
    </Button>
    {jadwal?.JamMulaiMuat == null ? (
      <p className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
        Menunggu Isi Muatan dari Produksi
      </p>
    ) : (
      <Button size="sm" className="flex-1" disabled={!canSelesaiMuat || pending} onClick={handleSelesaiMuat}>
        {pending ? "Memproses..." : "Selesai Muat"}
      </Button>
    )}
  </div>
) : (
  /* ...unchanged... */
)}
```

- [ ] **Step 2: Remove the now-dead `handleMuat` function and its import**

Delete the `handleMuat` function (the `startTransition(async () => { const result = await startMuatAction(targetId); ... })` block). Then check whether `startMuatAction` is still imported/used anywhere else in this file (`grep -n "startMuatAction" src/components/dashboard/route-validation-dialog.tsx`) — if `handleMuat` was its only use, remove `startMuatAction` from the import statement at the top of the file too.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (an unused-import removal reducing, not adding, references).
Run: `npx eslint src/components/dashboard/route-validation-dialog.tsx`
Expected: no errors, specifically no "unused variable" warning for `handleMuat` or `startMuatAction`.
Live check: open Papan Pengiriman (`/mkesindo/delivery`), open Validasi Rute on a Draft Jadwal with `JamMulaiMuat` still null, confirm "Mulai Muat" no longer appears and "Menunggu Isi Muatan dari Produksi" shows instead. Then, using the produksi-app test account from Task 19, run "Isi Muatan" on that same Jadwal, and confirm back on the desktop dialog (after a refresh) that "Selesai Muat" now appears in its place — proving the two flows are correctly connected end-to-end.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx
git commit -m "Remove Mulai Muat trigger from Papan Pengiriman, now exclusive to produksi-app"
```

---

## Task 21: Full verification pass

**Files:** None (verification only).

- [ ] **Step 1: Full typecheck and lint**

Run: `npx tsc --noEmit`
Expected: zero errors across the whole repo.
Run: `npx eslint .`
Expected: no new errors/warnings beyond this repo's existing baseline (4 errors, 37 warnings per the last known-clean baseline — confirm the count hasn't grown because of this plan's changes).

- [ ] **Step 2: End-to-end live walkthrough**

Using a fresh `isProduksi = true` test account (created or toggled via `/grup/akun/peran`):

1. Log in → confirm landing on `/mkesindo/produksi` directly (not `/mkesindo` or `/login`).
2. On `/mkesindo/produksi`: confirm Peta Warehouse, Panel Mesin (3 cards, editable via dialog — edit one and confirm it persists after reload), and Riwayat Produksi render without error.
3. Visit `/mkesindo/produksi-app`: confirm all 4 tabs switch instantly (keep-alive, no full reload).
4. On Produksi Baru: create a new batch into an empty pallet position with a nonzero Qty10KG/Qty5KG; confirm success message, and confirm the pallet now shows occupied (green, "new") on both the Warehouse tab and the dashboard's Peta Warehouse.
5. On Kartu Pengiriman: confirm a Draft Jadwal with no `JamMulaiMuat` appears with its correct required Qty10KG/Qty5KG (cross-check against the same Jadwal's totals on the desktop Papan Pengiriman); open it, allocate from the just-created pallet, confirm "Konfirmasi Isi Muatan" is disabled until the allocation meets the requirement, then submit successfully; confirm the card disappears from the list afterward and the pallet's Sisa decreases (or the position empties if fully consumed) on the Warehouse tab.
6. Back on desktop Papan Pengiriman: confirm that same Jadwal now shows "Selesai Muat" available (not "Mulai Muat", which no longer exists anywhere in the UI) and that clicking through Selesai Muat still works exactly as before this plan.
7. Confirm an account WITHOUT `isProduksi` cannot reach `/mkesindo/produksi` or `/mkesindo/produksi-app` (redirected to `/akses-ditolak`), and an `isProduksi` account cannot reach other `/mkesindo/*` dashboard routes (redirected back to `/mkesindo/produksi`).

- [ ] **Step 3: Commit (if any fixes were needed)**

If Steps 1-2 required fixes, commit them with a message describing what was fixed. If everything passed clean, no commit is needed for this task.
