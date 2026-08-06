# Aplikasi Driver (Standalone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone driver-facing mobile web app (`/driver-app`) covering the full delivery-confirmation journey — Tugas (task list) → Pengiriman (live route) → Konfir Kirim → Konfir Terima → Pembayaran → Berhasil — plus the backend data model changes (per-stop completion tracking, invoice/retur adjustment) that make a real "Selesai" Jadwal status possible for the first time.

**Architecture:** Mirrors the existing `satpam-app` standalone-route precedent exactly (own route tree outside `(dashboard)`, `peran`-level access flag + `require*()` guard, reused camera-capture hook). New MSSQL table `DashboardPengirimanStopDelivery`(+`Item`) tracks per-stop completion; a new transaction function in `pengiriman-jadwal.ts` adjusts `DeliveryOrderDetail`/`SalesInvoiceDetail`/`SalesInvoice` down and creates a `SalesReturn` document when a driver reports less than what was loaded. New Postgres columns `peran.is_driver` + `akun.salesman_id` link a login account to its real ERP `Salesman` identity.

**Tech Stack:** Next.js 16 (App Router, Server Actions), MSSQL (`mssql` package via `src/lib/db.ts`), Postgres (`pg` via `src/lib/pg.ts`), Leaflet/react-leaflet, OSRM routing (`src/lib/osrm.ts`), NextAuth (JWT sessions).

## Global Constraints

- Every new Server Action that can throw a business-validation error MUST be wrapped in `runAction()` (`src/lib/action-result.ts`) and throw `AppError`, not a plain `Error` — no exceptions to this rule anywhere in this plan.
- All Indonesian-language user-facing strings (labels, error messages) — no English UI text.
- No test runner exists in this project. Every task's verification is `npx tsc --noEmit` (must show zero errors touching changed files) + `npx eslint <changed files>` + either a live browser check or an explicit, documented static-code trace when login isn't reachable from the sandbox.
- Everything happens directly on the `main` branch. No worktree.
- MSSQL DDL tasks are **controller-run**: the plan author (not a dispatched implementer subagent) executes the DDL directly via the available SQL tool before dispatching the task that depends on it, exactly like the pattern used in `docs/superpowers/plans/2026-08-05-satpam-vehicle-check-carousel-revision.md`'s "Task 0". Postgres DDL tasks run via a checked-in idempotent migration script (`scripts/migrate-*.ts`), following `scripts/migrate-akun-lokasi.ts`'s exact shape.
- Money/quantity values from MSSQL `decimal` columns arrive as JS `number` via the `mssql` driver (already the pattern throughout `pengiriman-jadwal.ts`) — no `Decimal.js` or string-based money handling introduced.
- Retur is a downward-only adjustment: `qtyDiterima` must never exceed the original loaded `Qty` for that item. Every write path enforces this server-side, not just client-side.

---

## Task 1: Postgres migration — `peran.is_driver` + `akun.salesman_id`

**Files:**
- Create: `scripts/migrate-driver-app.ts`

**Interfaces:**
- Produces: Postgres columns `peran.is_driver BOOLEAN NOT NULL DEFAULT false` and `akun.salesman_id VARCHAR(16) NULL`, consumed by Task 2's query-layer changes.

- [ ] **Step 1: Write the migration script**

```ts
// Idempotent setup for the driver-app feature's Postgres columns:
// peran.is_driver (role-level access flag, mirrors peran.is_satpam) and
// akun.salesman_id (per-account link to the real ERP Salesman/driver
// identity — nullable, only meaningful for accounts whose peran has
// is_driver = true). Safe to re-run.
//
// Usage: npx tsx scripts/migrate-driver-app.ts
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
    await client.query(`ALTER TABLE peran ADD COLUMN IF NOT EXISTS is_driver BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE akun ADD COLUMN IF NOT EXISTS salesman_id VARCHAR(16)`);
    console.log("peran.is_driver + akun.salesman_id ready.");
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

Run: `npx tsx scripts/migrate-driver-app.ts`
Expected: prints "peran.is_driver + akun.salesman_id ready." with no error. Re-running it a second time must also succeed with no error (idempotency check).

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-driver-app.ts
git commit -m "Add Postgres migration for peran.is_driver + akun.salesman_id"
```

---

## Task 2: `akun.ts` query-layer wiring for `isDriver`/`salesmanId`

**Files:**
- Modify: `src/lib/queries/akun.ts`

**Interfaces:**
- Consumes: `peran.is_driver`, `akun.salesman_id` columns from Task 1.
- Produces: `AkunAuthRow.isDriver: boolean`, `AkunAuthRow.salesmanId: string | null` (consumed by Task 3's `auth.ts`); `PeranRow.isDriver: boolean` (consumed by Task 4's Peran editor and Task 5's Akun form); `setPeranDriver(peranId: number, isDriver: boolean): Promise<void>` (consumed by Task 4); `AkunRow.salesmanId: string | null`, `CreateAkunInput.salesmanId: string | null`, `UpdateAkunInput.salesmanId: string | null` (consumed by Task 5).

- [ ] **Step 1: Extend `findAkunByUsername` and `AkunAuthRow`**

In `src/lib/queries/akun.ts`, extend the interface (near line 11-24):

```ts
export interface AkunAuthRow {
  id: number;
  username: string;
  passwordHash: string;
  nama: string;
  peranId: number | null;
  perusahaanId: number | null;
  perusahaanKode: string | null; // null only for Direktur accounts
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  salesmanId: string | null;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}
```

Update the query and mapping (near line 26-55):

```ts
export async function findAkunByUsername(username: string): Promise<AkunAuthRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT a.id, a.username, a.password_hash, a.nama, a.peran_id, a.perusahaan_id, p.kode AS perusahaan_kode,
            COALESCE(r.is_super_admin, false) AS is_super_admin,
            COALESCE(r.is_satpam, false) AS is_satpam,
            COALESCE(r.is_driver, false) AS is_driver,
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
    salesmanId: row.salesman_id,
    isActive: row.is_active,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
  };
}
```

- [ ] **Step 2: Extend `PeranRow`, `listAllPeran`, add `setPeranDriver`**

Near line 279-303, extend the interface and query:

```ts
export interface PeranRow {
  id: number;
  perusahaanId: number;
  nama: string;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  akunCount: number;
}

export async function listAllPeran(): Promise<PeranRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT r.id, r.perusahaan_id, r.nama, r.is_super_admin, r.is_satpam, r.is_driver,
           count(a.id) AS akun_count
    FROM peran r
    LEFT JOIN akun a ON a.peran_id = r.id
    GROUP BY r.id, r.perusahaan_id, r.nama, r.is_super_admin, r.is_satpam, r.is_driver
    ORDER BY r.nama
  `);
  return result.rows.map((row) => ({
    id: row.id,
    perusahaanId: row.perusahaan_id,
    nama: row.nama,
    isSuperAdmin: row.is_super_admin,
    isSatpam: row.is_satpam,
    isDriver: row.is_driver,
    akunCount: Number(row.akun_count),
  }));
}
```

Note: keep the existing `GROUP BY`/join shape from the current file — only add `r.is_driver` to the selected columns, the `GROUP BY` clause, and the returned object. Read the current full `listAllPeran` query before editing so the `JOIN`/`GROUP BY` list you produce matches exactly (don't invent a join shape different from what's already there).

Add, right after `setPeranSatpam` (near line 349-352):

```ts
export async function setPeranDriver(peranId: number, isDriver: boolean): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE peran SET is_driver = $1 WHERE id = $2`, [isDriver, peranId]);
}
```

- [ ] **Step 3: Extend `AkunRow`, `listAkun`, `CreateAkunInput`/`createAkun`, `UpdateAkunInput`/`updateAkun`**

Extend `AkunRow` (near line 159-171) with `salesmanId: string | null`, and `listAkun`'s query/mapping (near line 173-199) to select/return `a.salesman_id`:

```ts
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
  salesmanId: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
}

export async function listAkun(): Promise<AkunRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT a.id, a.username, a.nama, a.email, a.nomor_telepon,
           a.perusahaan_id, p.nama AS perusahaan_nama, p.kode AS perusahaan_kode,
           a.peran_id, r.nama AS peran_nama, a.salesman_id,
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
    salesmanId: row.salesman_id,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
  }));
}
```

Extend `CreateAkunInput`/`createAkun` (near line 220-238):

```ts
export interface CreateAkunInput {
  nama: string;
  username: string;
  password: string;
  email: string | null;
  nomorTelepon: string | null;
  perusahaanId: number | null; // null = Direktur
  peranId: number | null; // null = Direktur
  salesmanId: string | null;
}

export async function createAkun(input: CreateAkunInput): Promise<void> {
  const pool = getPgPool();
  const passwordHash = await bcrypt.hash(input.password, 12);
  await pool.query(
    `INSERT INTO akun (username, password_hash, nama, email, nomor_telepon, perusahaan_id, peran_id, salesman_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.username, passwordHash, input.nama, input.email, input.nomorTelepon, input.perusahaanId, input.peranId, input.salesmanId]
  );
}
```

Extend `UpdateAkunInput`/`updateAkun` (near line 240-257):

```ts
export interface UpdateAkunInput {
  id: number;
  nama: string;
  email: string | null;
  nomorTelepon: string | null;
  perusahaanId: number | null;
  peranId: number | null;
  salesmanId: string | null;
  isActive: boolean;
}

export async function updateAkun(input: UpdateAkunInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE akun SET nama = $1, email = $2, nomor_telepon = $3, perusahaan_id = $4, peran_id = $5,
       salesman_id = $6, is_active = $7, updated_at = now()
     WHERE id = $8`,
    [input.nama, input.email, input.nomorTelepon, input.perusahaanId, input.peranId, input.salesmanId, input.isActive, input.id]
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: new errors only in files that call `createAkun`/`updateAkun`/`listAllPeran` without the new fields — these are `src/app/grup/akun/actions.ts`, `src/components/dashboard/akun-list.tsx`, `src/components/dashboard/peran-editor.tsx`, all fixed in Tasks 4-5. Confirm no errors inside `akun.ts` itself.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/akun.ts
git commit -m "Add isDriver/salesmanId to akun query layer"
```

---

## Task 3: `auth.ts` + `next-auth.d.ts` session wiring

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/types/next-auth.d.ts`

**Interfaces:**
- Consumes: `AkunAuthRow.isDriver`/`salesmanId` from Task 2.
- Produces: `session.user.isDriver: boolean`, `session.user.salesmanId: string | null`, consumed by Task 4's `requireDriver()` and every driver-app page/action.

- [ ] **Step 1: Extend `next-auth.d.ts`**

Add `isDriver: boolean;` and `salesmanId: string | null;` to the `Session.user`, `User`, and `JWT` interfaces in `src/types/next-auth.d.ts`, right next to the existing `isSatpam: boolean;` line in each of the three blocks.

- [ ] **Step 2: Extend `auth.ts`**

In `src/lib/auth.ts`:
- Add `isDriver: boolean;` and `salesmanId: string | null;` to the `AuthorizedUser` interface (next to `isSatpam: boolean;`).
- In `authorize()`, add to the returned `user` object: `isDriver: row.isDriver, salesmanId: row.salesmanId,` (next to `isSatpam: row.isSatpam,`).
- In the `jwt` callback's `if (user)` branch, add: `token.isDriver = u.isDriver; token.salesmanId = u.salesmanId;` (next to `token.isSatpam = u.isSatpam;`).
- In the `session` callback, add: `session.user.isDriver = token.isDriver as boolean; session.user.salesmanId = token.salesmanId as string | null;` (next to `session.user.isSatpam = token.isSatpam as boolean;`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors in `src/lib/auth.ts` and `src/types/next-auth.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts src/types/next-auth.d.ts
git commit -m "Wire isDriver/salesmanId into the session"
```

---

## Task 4: `requireDriver()` guard + Peran editor `is_driver` toggle

**Files:**
- Modify: `src/lib/require-access.ts`
- Modify: `src/app/grup/akun/peran/actions.ts`
- Modify: `src/components/dashboard/peran-editor.tsx`

**Interfaces:**
- Consumes: `session.user.isDriver` (Task 3), `setPeranDriver` (Task 2).
- Produces: `requireDriver(): Promise<Session>` (throws/redirects to `/akses-ditolak` if not a driver account), consumed by every driver-app page in Tasks 13-22.

- [ ] **Step 1: Add `requireDriver()`**

In `src/lib/require-access.ts`, add after `requireSatpam()`:

```ts
export async function requireDriver() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isDriver) redirect("/akses-ditolak");
  return session;
}
```

- [ ] **Step 2: Add `setPeranDriverAction`**

In `src/app/grup/akun/peran/actions.ts`, add after `setPeranSatpamAction`, and add `setPeranDriver` to the import from `@/lib/queries/akun`:

```ts
export async function setPeranDriverAction(peranId: number, isDriver: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setPeranDriver(peranId, isDriver);
    revalidatePath("/grup/akun/peran");
  });
}
```

- [ ] **Step 3: Add the toggle to `peran-editor.tsx`**

In `src/components/dashboard/peran-editor.tsx`:
- Import `setPeranDriverAction` alongside the existing action imports.
- In `RoleCard`, add `const [isDriver, setIsDriverState] = useState(peran.isDriver);` next to the existing `isSatpam` state, and a `toggleDriver()` function mirroring `toggleSatpam()`:

```ts
function toggleDriver() {
  setIsDriverState((prev) => !prev);
  setDirty(true);
}
```

- In `handleSave`, add `setPeranDriverAction(peran.id, isDriver)` to the `Promise.all` array alongside `setPeranSatpamAction(peran.id, isSatpam)`.
- In the JSX, add a second checkbox row right after the existing Satpam one:

```tsx
<label className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
  <input type="checkbox" className="accent-primary" checked={isDriver} onChange={toggleDriver} />
  <span>
    Peran Khusus: Driver
    <span className="block text-muted-foreground">
      Akun dengan peran ini diarahkan ke Aplikasi Driver setelah login, dan hanya melihat tugas milik dirinya
      sendiri (perlu ditautkan ke identitas Driver lewat halaman Akun).
    </span>
  </span>
</label>
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/require-access.ts src/app/grup/akun/peran/actions.ts src/components/dashboard/peran-editor.tsx`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/require-access.ts src/app/grup/akun/peran/actions.ts src/components/dashboard/peran-editor.tsx
git commit -m "Add requireDriver guard and is_driver Peran toggle"
```

---

## Task 5: Akun form — link an account to a Driver (Salesman)

**Files:**
- Modify: `src/app/grup/akun/page.tsx`
- Modify: `src/app/grup/akun/actions.ts`
- Modify: `src/components/dashboard/akun-list.tsx`

**Interfaces:**
- Consumes: `CreateAkunInput.salesmanId`/`UpdateAkunInput.salesmanId` (Task 2), `getDriverProfiles()` (existing, `src/lib/queries/driver-profile.ts`), `PeranRow.isDriver` (Task 2).
- Produces: nothing new consumed elsewhere — this is a leaf UI task.

- [ ] **Step 1: Fetch driver options on the Akun page**

In `src/app/grup/akun/page.tsx`, import `getDriverProfiles` from `@/lib/queries/driver-profile`, add it to the `Promise.all`, and pass `driverProfiles={driverProfiles}` to `<AkunList />`:

```tsx
import { getDriverProfiles } from "@/lib/queries/driver-profile";
// ...
const [akunList, perusahaanList, peranList, pabrikLocation, siteSettings, docTemplate, driverProfiles] = await Promise.all([
  listAkun(),
  listPerusahaanDirektori(),
  listAllPeran(),
  getPabrikLocation(),
  getSiteSettings(),
  getDocTemplate("DeliveryOrder"),
  getDriverProfiles(),
]);
// ...
<AkunList akunList={akunList} perusahaanList={perusahaanList} peranList={peranList} driverProfiles={driverProfiles} />
```

- [ ] **Step 2: Pass `salesmanId` through the actions**

`src/app/grup/akun/actions.ts` already forwards its whole `input` object to `createAkun`/`updateAkun` unchanged (see `createAkunAction`/`updateAkunAction`) — since `CreateAkunInput`/`UpdateAkunInput` now include `salesmanId` (Task 2), no code change is needed in this file. Skip to Step 3.

- [ ] **Step 3: Add the dropdown to `akun-list.tsx`**

In `src/components/dashboard/akun-list.tsx`:
- Import `type DriverProfileRow` from `@/lib/queries/driver-profile`.
- Add a new shared component, right after `ScopeFields`:

```tsx
function DriverLinkField({
  driverProfiles,
  peranList,
  peranId,
  salesmanId,
  onSalesmanIdChange,
}: {
  driverProfiles: DriverProfileRow[];
  peranList: PeranRow[];
  peranId: number | null;
  salesmanId: string | null;
  onSalesmanIdChange: (id: string | null) => void;
}) {
  const isDriverRole = peranId != null && (peranList.find((p) => p.id === peranId)?.isDriver ?? false);
  if (!isDriverRole) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Driver (Salesman)</Label>
      <Select value={salesmanId ?? ""} onValueChange={(v) => onSalesmanIdChange(v || null)}>
        <SelectTrigger className="w-full">
          <SelectValue>{() => driverProfiles.find((d) => d.SalesmanID === salesmanId)?.Name ?? "Pilih driver"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {driverProfiles.map((d) => (
            <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
              {d.Name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Wajib diisi agar akun ini dapat login ke Aplikasi Driver dan melihat tugas miliknya sendiri.
      </p>
    </div>
  );
}
```

- In `CreateDialog`: add `const [salesmanId, setSalesmanId] = useState<string | null>(null);`, pass `driverProfiles` down as a new prop, render `<DriverLinkField driverProfiles={driverProfiles} peranList={peranList} peranId={peranId} salesmanId={salesmanId} onSalesmanIdChange={setSalesmanId} />` right after `<ScopeFields .../>`, and include `salesmanId` in the object passed to `onSubmit`.
- In `EditDialog`: same pattern — `const [salesmanId, setSalesmanId] = useState<string | null>(akun.salesmanId);`, accept `driverProfiles` prop, render `<DriverLinkField .../>` after `<ScopeFields .../>`, include `salesmanId` in `onSubmit`'s payload.
- In the top-level `AkunList` component: accept `driverProfiles: DriverProfileRow[]` in its props type, and pass it through to both `<CreateDialog driverProfiles={driverProfiles} .../>` and `<EditDialog driverProfiles={driverProfiles} .../>`.
- On each account card, add a small extra line showing the linked driver when present: `{a.salesmanId && <span className="inline-flex items-center gap-1.5">Driver: {driverProfiles.find((d) => d.SalesmanID === a.salesmanId)?.Name ?? a.salesmanId}</span>}` inside the existing details block.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/app/grup/akun/page.tsx src/components/dashboard/akun-list.tsx`
Expected: zero errors.

- [ ] **Step 5: Manual verification**

If an authenticated `/grup/akun` session is reachable: open Edit on any account whose Peran has `is_driver` toggled on (from Task 4), confirm the "Driver (Salesman)" dropdown appears and saves correctly; confirm it's absent for a non-driver role. If login isn't reachable from the sandbox, trace the prop chain statically instead (`page.tsx` → `AkunList` → `EditDialog`/`CreateDialog` → `DriverLinkField`) and document that trace in the task report.

- [ ] **Step 6: Commit**

```bash
git add src/app/grup/akun/page.tsx src/components/dashboard/akun-list.tsx
git commit -m "Add Driver (Salesman) link field to the Akun form"
```

---

## Task 6: Login redirect for driver accounts

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`

**Interfaces:**
- Consumes: `session.user.isDriver` (Task 3).

- [ ] **Step 1: Add the redirect**

In `src/app/(dashboard)/page.tsx`'s `BerandaPage`, right after the existing Marketing redirect block:

```tsx
// Driver accounts always land on the standalone Aplikasi Driver instead of
// this dashboard's Beranda — mirrors the Marketing redirect immediately
// above, same reasoning (this page's KPIs aren't relevant to their work).
if (!session.user.isSuperAdmin && session.user.isDriver) {
  redirect("/driver-app");
}
```

Place it before the `businessToday`/data-fetching code so a driver account never triggers this page's (irrelevant, and potentially permission-gated) dashboard queries.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors in `src/app/(dashboard)/page.tsx`. Note `/driver-app` doesn't exist yet (created in Task 13) — this is expected and harmless, Next.js route redirects aren't statically checked.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/page.tsx"
git commit -m "Redirect driver accounts to /driver-app after login"
```

---

## Task 7: MSSQL DDL — per-stop delivery tables (controller-run)

**Files:** None (database-only task, executed directly via the SQL tool before Task 8 is dispatched — no implementer subagent for this task).

**Interfaces:**
- Produces: tables `DashboardPengirimanStopDelivery`, `DashboardPengirimanStopDeliveryItem`, consumed by every query in Tasks 9-10.

- [ ] **Step 1: Run the DDL**

Execute directly (controller-run, not dispatched):

```sql
CREATE TABLE DashboardPengirimanStopDelivery (
  StopDeliveryID INT IDENTITY(1,1) PRIMARY KEY,
  JadwalDetailID INT NOT NULL,
  JamTiba DATETIME NULL,
  JamSelesai DATETIME NULL,
  FotoBuktiPengirimanUrl VARCHAR(255) NULL,
  FotoBuktiMuatanUrl VARCHAR(255) NULL,
  TandaTanganUrl VARCHAR(255) NULL,
  TanpaPembayaran BIT NOT NULL DEFAULT 0,
  SalesReturnID VARCHAR(16) NULL,
  IsDeleted BIT NOT NULL DEFAULT 0,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE(),
  CONSTRAINT UQ_DashboardPengirimanStopDelivery_JadwalDetailID UNIQUE (JadwalDetailID)
);

CREATE TABLE DashboardPengirimanStopDeliveryItem (
  StopDeliveryItemID INT IDENTITY(1,1) PRIMARY KEY,
  StopDeliveryID INT NOT NULL,
  SalesOrderDetailID VARCHAR(16) NOT NULL,
  ItemID VARCHAR(160) NOT NULL,
  QtyDimuat DECIMAL(23,4) NOT NULL,
  QtyDiterima DECIMAL(23,4) NOT NULL,
  QtyRetur DECIMAL(23,4) NOT NULL,
  FotoReturUrl VARCHAR(255) NULL
);
```

- [ ] **Step 2: Verify**

Query `sql_get_table_info` for both table names and confirm the columns match exactly what's listed above, including `IS_PRIMARY_KEY` on the two ID columns and the `UQ_DashboardPengirimanStopDelivery_JadwalDetailID` unique constraint.

- [ ] **Step 3: Record in the SDD ledger**

No git commit for this task (no files changed) — record completion in the SDD progress ledger only, noting the DDL ran successfully and was verified.

---

## Task 8: `getDriverJadwalList` query — Tugas screen data

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Consumes: `DashboardPengirimanJadwal`, `DashboardPengirimanJadwalDetail`, `DashboardArmada`, `DashboardPengirimanStopDelivery` (Task 7).
- Produces: `DriverJadwalCard` type and `getDriverJadwalList(salesmanId: string, dateISO: string): Promise<DriverJadwalCard[]>`, consumed by Task 11's action wrapper and Task 14's Tugas screen.

- [ ] **Step 1: Add the type and query**

Add to `src/lib/queries/pengiriman-jadwal.ts`, near the existing `JadwalCard`/`getPengirimanBoard` code:

```ts
// Card status shown on the driver's own Tugas list — a 4th value not
// present in JadwalStatus itself ("Selesai") is derived here, never
// stored: true once every one of this Jadwal's stops has a
// DashboardPengirimanStopDelivery row with JamSelesai populated. See the
// design spec's "Perubahan Data Model" section for why this is computed
// rather than a new Jadwal.Status value.
export interface DriverJadwalCard {
  JadwalID: number;
  ArmadaNama: string;
  VehicleNo: string | null;
  JamJadwal: string | Date;
  Status: JadwalStatus;
  JamSelesaiMuat: string | Date | null;
  JamAktualBerangkat: string | Date | null;
  TotalStop: number;
  StopSelesai: number;
  TotalKantong: number;
  IsSelesai: boolean;
}

// businessDate here is a plain calendar date (JamJadwal's own DATE), not
// the 14:00-WIB-rollover "business date" used elsewhere on the Papan
// Pengiriman board — the driver picks a literal calendar date from a date
// picker on the Tugas screen, so no rollover translation applies.
//
// The StopAgg CTE pre-aggregates to exactly one row per JadwalDetailID
// BEFORE joining up to the Jadwal level — same reason getPengirimanBoard's
// own StopQty/StopDuration CTEs exist in this file: SalesOrderDetail is
// one-to-many per stop, so joining it directly at the Jadwal-grouped level
// would fan out and make COUNT(jd.JadwalDetailID)/SUM(...) count each stop
// once per its own SalesOrderDetail line instead of once per stop.
export async function getDriverJadwalList(salesmanId: string, dateISO: string): Promise<DriverJadwalCard[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("date", sql.Date, dateISO).query(`
      WITH StopAgg AS (
          SELECT jd.JadwalID, jd.JadwalDetailID,
                 ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Kantong,
                 CASE WHEN sd.JamSelesai IS NOT NULL THEN 1 ELSE 0 END AS IsSelesai
          FROM DashboardPengirimanJadwalDetail jd
          LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
          LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
          WHERE jd.IsDeleted = 0
          GROUP BY jd.JadwalID, jd.JadwalDetailID, sd.JamSelesai
      )
      SELECT
          j.JadwalID,
          a.Nama AS ArmadaNama,
          ed.VehicleNo,
          j.JamJadwal,
          j.Status,
          j.JamSelesaiMuat,
          j.JamAktualBerangkat,
          COUNT(sa.JadwalDetailID) AS TotalStop,
          SUM(sa.IsSelesai) AS StopSelesai,
          SUM(sa.Kantong) AS TotalKantong
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      JOIN StopAgg sa ON sa.JadwalID = j.JadwalID
      WHERE j.SalesmanID = @salesmanId AND j.IsDeleted = 0 AND CAST(j.JamJadwal AS DATE) = @date
      GROUP BY j.JadwalID, a.Nama, ed.VehicleNo, j.JamJadwal, j.Status, j.JamSelesaiMuat, j.JamAktualBerangkat
      ORDER BY j.JamJadwal
    `);
  return (result.recordset as Omit<DriverJadwalCard, "IsSelesai">[]).map((r) => ({
    ...r,
    IsSelesai: r.TotalStop > 0 && r.StopSelesai === r.TotalStop,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors in `src/lib/queries/pengiriman-jadwal.ts`.

- [ ] **Step 3: Verify against real data**

Using the SQL tool, run the equivalent `SELECT` manually against a known `SalesmanID`/date that has at least one Jadwal, and confirm `TotalStop`/`StopSelesai`/`TotalKantong` match hand-counted values from `DashboardPengirimanJadwalDetail`/`SalesOrderDetail` for that Jadwal.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "Add getDriverJadwalList query for the driver Tugas screen"
```

---

## Task 9: Per-stop queries — stop list, order items, arrival recording

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Consumes: `getJadwalDetail` (existing), `DashboardPengirimanStopDelivery` (Task 7).
- Produces: `DriverStopRow`, `getDriverJadwalStops(jadwalId: number): Promise<DriverStopRow[]>`; `StopOrderItem`, `getStopOrderItems(jadwalDetailId: number): Promise<StopOrderItem[]>`; `recordStopArrival(jadwalDetailId: number): Promise<number>` — all consumed by Task 11's actions and Tasks 18-19's UI.

- [ ] **Step 1: Add `DriverStopRow` + `getDriverJadwalStops`**

```ts
export interface DriverStopRow extends JadwalDetailRow {
  JamTiba: string | Date | null;
  JamSelesai: string | Date | null;
  // Needed by the driver-app's Pembayaran screen to call recordPayment()
  // (SalesPayment.BusinessPartnerID) — fetched here rather than making
  // that screen do its own extra round-trip.
  BusinessPartnerID: string;
}

// Merges getJadwalDetail's existing per-stop data (customer/qty/address —
// unchanged, still the read path for the dashboard's own Validasi Rute)
// with this stop's own completion timestamps and BusinessPartnerID, for
// the driver-app's Pengiriman/Konfir/Pembayaran screens.
export async function getDriverJadwalStops(jadwalId: number): Promise<DriverStopRow[]> {
  const pool = await getPool();
  const [stops, extraRows] = await Promise.all([
    getJadwalDetail(jadwalId),
    pool
      .request()
      .input("jadwalId", sql.Int, jadwalId).query(`
        SELECT jd.JadwalDetailID, sd.JamTiba, sd.JamSelesai, so.BusinessPartnerID
        FROM DashboardPengirimanJadwalDetail jd
        JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
        LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
        WHERE jd.JadwalID = @jadwalId AND jd.IsDeleted = 0
      `),
  ]);
  const extraByDetailId = new Map(
    (
      extraRows.recordset as { JadwalDetailID: number; JamTiba: Date | null; JamSelesai: Date | null; BusinessPartnerID: string }[]
    ).map((r) => [r.JadwalDetailID, r])
  );
  return stops.map((s) => ({
    ...s,
    JamTiba: extraByDetailId.get(s.JadwalDetailID)?.JamTiba ?? null,
    JamSelesai: extraByDetailId.get(s.JadwalDetailID)?.JamSelesai ?? null,
    BusinessPartnerID: extraByDetailId.get(s.JadwalDetailID)?.BusinessPartnerID ?? "",
  }));
}
```

- [ ] **Step 2: Add `StopOrderItem` + `getStopOrderItems`**

```ts
export interface StopOrderItem {
  SalesOrderDetailID: string;
  ItemID: string;
  Name: string;
  Qty: number;
  Price: number;
}

// Line-item breakdown for one stop (Layar "Konfir Kirim") — unlike
// JadwalDetailRow's aggregated Qty/Qty10KG/Qty5KG (used for card totals),
// this is one row per real SalesOrderDetail so the driver can adjust each
// item's received quantity independently.
export async function getStopOrderItems(jadwalDetailId: number): Promise<StopOrderItem[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalDetailId", sql.Int, jadwalDetailId).query(`
      SELECT sod.SalesOrderDetailID, sod.ItemID, sod.Name, sod.Qty, sod.Price
      FROM DashboardPengirimanJadwalDetail jd
      JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE jd.JadwalDetailID = @jadwalDetailId AND jd.IsDeleted = 0
      ORDER BY sod.Name
    `);
  return result.recordset;
}
```

- [ ] **Step 3: Add `recordStopArrival`**

```ts
// "Geser untuk Tiba" (Layar Pengiriman) — idempotent: calling this again
// for a stop that already has a row just returns the existing
// StopDeliveryID rather than erroring, so a duplicate tap or a retried
// request after a dropped connection can't fail loudly.
export async function recordStopArrival(jadwalDetailId: number): Promise<number> {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .query(`SELECT StopDeliveryID FROM DashboardPengirimanStopDelivery WHERE JadwalDetailID = @id`);
  const existingRow = existing.recordset[0] as { StopDeliveryID: number } | undefined;
  if (existingRow) return existingRow.StopDeliveryID;

  const result = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .query(
      `INSERT INTO DashboardPengirimanStopDelivery (JadwalDetailID, JamTiba) OUTPUT INSERTED.StopDeliveryID VALUES (@id, GETDATE())`
    );
  return (result.recordset[0] as { StopDeliveryID: number }).StopDeliveryID;
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors in `src/lib/queries/pengiriman-jadwal.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "Add per-stop queries: stop list, order items, arrival recording"
```

---

## Task 10: `confirmStopDelivery` transaction — retur + invoice adjustment

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Consumes: `DashboardPengirimanStopDelivery`/`Item` (Task 7), `SalesOrderDetail`/`DeliveryOrderDetail`/`SalesInvoiceDetail`/`SalesInvoice`/`SalesReturn`/`SalesReturnDetail` (ERP MSSQL tables, confirmed via direct schema inspection).
- Produces: `ConfirmStopDeliveryInput`, `confirmStopDelivery(input): Promise<{ stopDeliveryId: number; salesInvoiceId: string | null }>`, consumed by Task 11's action and Task 21's Konfir Terima screen.

This is the highest-risk task in the plan — it's the only one that mutates already-issued financial documents. Read `selesaiMuat` (same file, the function immediately preceding this new one) in full before writing this task; the transaction shape, `PoolOrTransaction` type, `nextDeliveryOrderId`-style ID helpers, and `DOC_SUFFIX`/`BRANCH_ID`/`DEPARTMENT_ID`/`yearMonth` constants are all reused as-is, not reinvented.

- [ ] **Step 1: Add the `SalesReturn` ID/voucher helpers**

Add right after `nextSIVoucherSeq` (reuses the exact same `PoolOrTransaction`/`DOC_SUFFIX` machinery already in the file):

```ts
async function nextSalesReturnId(pool: PoolOrTransaction): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesReturnID AS INT)) AS MaxID FROM SalesReturn`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSalesReturnDetailId(pool: PoolOrTransaction): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesReturnDetailID AS INT)) AS MaxID FROM SalesReturnDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

// Same numbering shape as nextDOVoucherSeq/nextSIVoucherSeq, MKE/SR/ prefix
// (SalesReturn is a real, pre-existing ERP document type — 9,567 historical
// rows confirmed via direct schema inspection — never written by this
// dashboard until now).
async function nextSRVoucherSeq(pool: PoolOrTransaction, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/SR/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM SalesReturn WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}
```

- [ ] **Step 2: Add `ConfirmStopDeliveryInput` and the transaction function**

```ts
export interface StopDeliveryItemInput {
  salesOrderDetailId: string;
  qtyDiterima: number;
  fotoReturUrl: string | null;
}

export interface ConfirmStopDeliveryInput {
  jadwalDetailId: number;
  items: StopDeliveryItemInput[];
  fotoBuktiPengirimanUrl: string;
  fotoBuktiMuatanUrl: string;
  tandaTanganUrl: string;
  tanpaPembayaran: boolean;
}

interface SalesOrderDetailForReturn {
  SalesOrderDetailID: string;
  ItemID: string;
  Name: string;
  Qty: number;
  Price: number;
}

// The core "retur" transaction (Layar Konfir Terima's "Konfirmasi
// Penerima"): downward-only adjustment of what was already invoiced at
// selesaiMuat, driven by what the driver actually confirms was received.
// See the design spec's "Retur & penyesuaian Invoice" section for why
// SalesInvoice.Amount/Netto (not just SalesInvoiceDetail) must be
// recomputed — vCustomerStatement (aging.ts, the basis for every
// Outstanding/Piutang figure in the app, including Pelunasan's
// recordPayment) reads SalesInvoice.Netto directly, not a live SUM.
export async function confirmStopDelivery(
  input: ConfirmStopDeliveryInput
): Promise<{ stopDeliveryId: number; salesInvoiceId: string | null }> {
  const pool = await getPool();

  const detailResult = await pool
    .request()
    .input("id", sql.Int, input.jadwalDetailId)
    .query(
      `SELECT JadwalID, SalesOrderID, DeliveryOrderID, SalesInvoiceID FROM DashboardPengirimanJadwalDetail WHERE JadwalDetailID = @id AND IsDeleted = 0`
    );
  const detailRow = detailResult.recordset[0] as
    | { JadwalID: number; SalesOrderID: string; DeliveryOrderID: string | null; SalesInvoiceID: string | null }
    | undefined;
  if (!detailRow) throw new AppError("Stop pengiriman tidak ditemukan.");
  if (!detailRow.DeliveryOrderID || !detailRow.SalesInvoiceID) {
    throw new AppError("Muat untuk stop ini belum diselesaikan, tidak bisa konfirmasi penerimaan.");
  }

  const existingStop = await pool
    .request()
    .input("id", sql.Int, input.jadwalDetailId)
    .query(`SELECT StopDeliveryID, JamSelesai FROM DashboardPengirimanStopDelivery WHERE JadwalDetailID = @id`);
  const existingStopRow = existingStop.recordset[0] as { StopDeliveryID: number; JamSelesai: Date | null } | undefined;
  if (!existingStopRow) throw new AppError("Belum ada catatan kedatangan untuk stop ini — geser 'Tiba' terlebih dahulu.");
  if (existingStopRow.JamSelesai) throw new AppError("Stop ini sudah dikonfirmasi selesai.");

  const headerResult = await pool
    .request()
    .input("jadwalId", sql.Int, detailRow.JadwalID)
    .query(`SELECT SalesmanID FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = headerResult.recordset[0] as { SalesmanID: string | null } | undefined;
  if (!headerRow) throw new AppError("Keberangkatan tidak ditemukan.");

  const soResult = await pool
    .request()
    .input("soId", sql.VarChar(16), detailRow.SalesOrderID)
    .query(`SELECT BusinessPartnerID FROM SalesOrder WHERE SalesOrderID = @soId`);
  const soRow = soResult.recordset[0] as { BusinessPartnerID: string } | undefined;
  if (!soRow) throw new AppError(`Sales Order ${detailRow.SalesOrderID} tidak ditemukan.`);

  const sodResult = await pool
    .request()
    .input("soId", sql.VarChar(16), detailRow.SalesOrderID)
    .query(`SELECT SalesOrderDetailID, ItemID, Name, Qty, Price FROM SalesOrderDetail WHERE SalesOrderID = @soId`);
  const soDetails = sodResult.recordset as SalesOrderDetailForReturn[];
  const soDetailById = new Map(soDetails.map((d) => [d.SalesOrderDetailID, d]));

  // Validate every input item against its real loaded quantity BEFORE
  // opening the transaction — retur can only ever reduce, never exceed,
  // what was actually loaded.
  for (const item of input.items) {
    const sod = soDetailById.get(item.salesOrderDetailId);
    if (!sod) throw new AppError(`Item pesanan ${item.salesOrderDetailId} tidak ditemukan pada Sales Order ini.`);
    if (item.qtyDiterima < 0) throw new AppError(`Kuantitas diterima untuk ${sod.Name} tidak boleh negatif.`);
    if (item.qtyDiterima > sod.Qty) {
      throw new AppError(`Kuantitas diterima untuk ${sod.Name} tidak boleh melebihi kuantitas yang dimuat (${sod.Qty}).`);
    }
  }

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const hasRetur = input.items.some((item) => item.qtyDiterima < (soDetailById.get(item.salesOrderDetailId)?.Qty ?? 0));

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // Atomically claim: only succeeds if JamSelesai is still NULL — guards
    // the same double-submit race selesaiMuat's own claim UPDATE guards
    // against.
    const claim = await new sql.Request(transaction)
      .input("id", sql.Int, input.jadwalDetailId)
      .input("foto1", sql.VarChar(255), input.fotoBuktiPengirimanUrl)
      .input("foto2", sql.VarChar(255), input.fotoBuktiMuatanUrl)
      .input("ttd", sql.VarChar(255), input.tandaTanganUrl)
      .input("tanpaBayar", sql.Bit, input.tanpaPembayaran).query(`
        UPDATE DashboardPengirimanStopDelivery
        SET JamSelesai = GETDATE(), FotoBuktiPengirimanUrl = @foto1, FotoBuktiMuatanUrl = @foto2,
            TandaTanganUrl = @ttd, TanpaPembayaran = @tanpaBayar, ModifiedDate = GETDATE()
        WHERE JadwalDetailID = @id AND JamSelesai IS NULL
      `);
    if (claim.rowsAffected[0] === 0) {
      throw new AppError("Stop ini sudah dikonfirmasi selesai atau sedang diproses.");
    }

    let salesReturnId: string | null = null;
    if (hasRetur) {
      salesReturnId = await nextSalesReturnId(transaction);
      const srVoucherSeq = await nextSRVoucherSeq(transaction, yearMonth);
      const srVoucherNo = `MKE/SR/${srVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
      const returAmount = input.items.reduce((sum, item) => {
        const sod = soDetailById.get(item.salesOrderDetailId)!;
        return sum + (sod.Qty - item.qtyDiterima) * sod.Price;
      }, 0);

      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), salesReturnId)
        .input("voucherNo", sql.VarChar(128), srVoucherNo)
        .input("soId", sql.VarChar(16), detailRow.SalesOrderID)
        .input("doId", sql.VarChar(16), detailRow.DeliveryOrderID)
        .input("bpId", sql.VarChar(16), soRow.BusinessPartnerID)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("amount", sql.Decimal(23, 4), returAmount)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID).query(`
          INSERT INTO SalesReturn
            (SalesReturnID, VoucherNo, TransDate, SalesOrderID, DeliveryOrderID, BusinessPartnerID, BranchID,
             DepartmentID, Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, Paid, Deposit, IsClosed,
             IsDeleted, ModifiedDate, SalesmanID, Rate, IsInvoiced)
          VALUES
            (@id, @voucherNo, GETDATE(), @soId, @doId, @bpId, @branchId,
             @departmentId, @amount, 0, 0, 0, 0, 0, @amount, 0, 0, 0,
             0, GETDATE(), @salesmanId, 1, 1)
        `);

      for (const item of input.items) {
        const sod = soDetailById.get(item.salesOrderDetailId)!;
        const qtyRetur = sod.Qty - item.qtyDiterima;
        if (qtyRetur <= 0) continue;
        const srDetailId = await nextSalesReturnDetailId(transaction);
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), srDetailId)
          .input("srId", sql.VarChar(16), salesReturnId)
          .input("itemId", sql.VarChar(160), sod.ItemID)
          .input("name", sql.VarChar(150), sod.Name)
          .input("qty", sql.Decimal(23, 4), qtyRetur)
          .input("price", sql.Decimal(23, 4), sod.Price)
          .input("amount", sql.Decimal(23, 4), qtyRetur * sod.Price)
          .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID).query(`
            INSERT INTO SalesReturnDetail
              (SalesReturnDetailID, SalesReturnID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue,
               DiscRp, Amount, Name, Value, Netto, Retur, SalesOrderDetailID)
            VALUES
              (@id, @srId, @itemId, @qty, 'PCS', 1, 1, @price, 0, 0,
               0, @amount, @name, @amount, @amount, @qty, @soDetailId)
          `);
      }

      await new sql.Request(transaction)
        .input("id", sql.Int, existingStopRow.StopDeliveryID)
        .input("srId", sql.VarChar(16), salesReturnId)
        .query(`UPDATE DashboardPengirimanStopDelivery SET SalesReturnID = @srId WHERE StopDeliveryID = @id`);
    }

    for (const item of input.items) {
      const sod = soDetailById.get(item.salesOrderDetailId)!;
      const qtyRetur = sod.Qty - item.qtyDiterima;
      const newAmount = item.qtyDiterima * sod.Price;

      await new sql.Request(transaction)
        .input("doId", sql.VarChar(16), detailRow.DeliveryOrderID)
        .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID)
        .input("delivered", sql.Decimal(23, 4), item.qtyDiterima)
        .query(
          `UPDATE DeliveryOrderDetail SET Delivered = @delivered WHERE DeliveryOrderID = @doId AND SalesOrderDetailID = @soDetailId`
        );

      await new sql.Request(transaction)
        .input("siId", sql.VarChar(16), detailRow.SalesInvoiceID)
        .input("itemId", sql.VarChar(160), sod.ItemID)
        .input("qty", sql.Decimal(23, 4), item.qtyDiterima)
        .input("amount", sql.Decimal(23, 4), newAmount)
        .input("retur", sql.Decimal(23, 4), qtyRetur)
        .query(
          `UPDATE SalesInvoiceDetail SET Qty = @qty, Amount = @amount, Netto = @amount, Value = @amount, Retur = @retur
           WHERE SalesInvoiceID = @siId AND ItemID = @itemId`
        );

      const stopItemId = await pool
        .request()
        .query(`SELECT ISNULL(MAX(StopDeliveryItemID), 0) + 1 AS NextID FROM DashboardPengirimanStopDeliveryItem`);
      await new sql.Request(transaction)
        .input("stopDeliveryId", sql.Int, existingStopRow.StopDeliveryID)
        .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID)
        .input("itemId", sql.VarChar(160), sod.ItemID)
        .input("qtyDimuat", sql.Decimal(23, 4), sod.Qty)
        .input("qtyDiterima", sql.Decimal(23, 4), item.qtyDiterima)
        .input("qtyRetur", sql.Decimal(23, 4), qtyRetur)
        .input("fotoRetur", sql.VarChar(255), item.fotoReturUrl).query(`
          INSERT INTO DashboardPengirimanStopDeliveryItem
            (StopDeliveryID, SalesOrderDetailID, ItemID, QtyDimuat, QtyDiterima, QtyRetur, FotoReturUrl)
          VALUES
            (@stopDeliveryId, @soDetailId, @itemId, @qtyDimuat, @qtyDiterima, @qtyRetur, @fotoRetur)
        `);
      void stopItemId; // ID not needed by callers — IDENTITY column assigns it
    }

    // Recompute the invoice header from its now-updated detail rows —
    // the step vCustomerStatement's Outstanding calculation depends on.
    const totalResult = await new sql.Request(transaction)
      .input("siId", sql.VarChar(16), detailRow.SalesInvoiceID)
      .query(`SELECT SUM(Amount) AS Total FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId`);
    const newTotal = (totalResult.recordset[0]?.Total as number | null) ?? 0;
    await new sql.Request(transaction)
      .input("siId", sql.VarChar(16), detailRow.SalesInvoiceID)
      .input("total", sql.Decimal(23, 4), newTotal)
      .query(`UPDATE SalesInvoice SET Amount = @total, Netto = @total WHERE SalesInvoiceID = @siId`);

    await transaction.commit();
    return { stopDeliveryId: existingStopRow.StopDeliveryID, salesInvoiceId: detailRow.SalesInvoiceID };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

Note on the `stopItemId`/`void stopItemId` line: that `SELECT MAX(...)+1` was left over from an earlier draft and computes a value nothing uses (`DashboardPengirimanStopDeliveryItem.StopDeliveryItemID` is `IDENTITY`, assigned automatically by the `INSERT` that follows) — **delete that `pool.request()...NextID` block and the `void stopItemId;` line entirely**, they must not appear in the final code. This note exists so the implementer removes dead code rather than transcribing it verbatim.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors in `src/lib/queries/pengiriman-jadwal.ts`.

- [ ] **Step 4: Verify the SalesReturn/SalesInvoice column list against the real schema**

Before considering this task done, re-run `sql_get_table_info` for `SalesReturn` and `SalesInvoice` and diff every column name used in the two `INSERT`/`UPDATE` statements above against the actual column list — this task was written from a schema snapshot and a transcription mistake here would silently corrupt financial data. Fix any mismatch found.

- [ ] **Step 5: Manual end-to-end verification against a disposable test row**

Using the SQL tool: pick one real `DashboardPengirimanJadwalDetail` row whose Jadwal is `Terbit` (has `DeliveryOrderID`/`SalesInvoiceID` set) and has no existing `DashboardPengirimanStopDelivery` row. Record its `SalesOrderDetail.Qty`/`Price` and the parent `SalesInvoice.Netto` beforehand. Call `recordStopArrival` then `confirmStopDelivery` with one item's `qtyDiterima` deliberately less than its loaded `Qty`. Confirm: `SalesReturn`+`SalesReturnDetail` rows now exist with the right `Amount`; `SalesInvoiceDetail.Qty`/`Retur` updated correctly; `SalesInvoice.Netto` dropped by exactly the retur amount; `DeliveryOrderDetail.Delivered` matches `qtyDiterima`. Then clean up: hard-delete the `SalesReturn`/`SalesReturnDetail`/`DashboardPengirimanStopDelivery`/`Item` rows created, and restore `SalesInvoiceDetail`/`SalesInvoice`/`DeliveryOrderDetail` to their original pre-test values. Document the before/after values in the task report.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "Add confirmStopDelivery transaction: retur + invoice adjustment"
```

---

## Task 11: `/api/upload/driver-app` photo/signature endpoint

**Files:**
- Create: `src/app/api/upload/driver-app/route.ts`

**Interfaces:**
- Consumes: `requireDriver()` (Task 4).
- Produces: `POST /api/upload/driver-app` accepting `multipart/form-data` with `file` + `jenisFoto`, returning `{ path: string }`, consumed by Tasks 19-21's client components.

- [ ] **Step 1: Write the endpoint**

```ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireDriver } from "@/lib/require-access";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
// jenisFoto identifies which slot a photo fills (bukti-pengiriman,
// bukti-muatan, tanda-tangan, or retur-<salesOrderDetailId> for a
// per-item retur photo) — unlike satpam-check's fixed JENIS_FOTO_LIST,
// this set is open-ended per stop item, so it's validated by shape
// (safe filename characters only) rather than membership in a fixed list.
const JENIS_FOTO_PATTERN = /^[a-zA-Z0-9-]{1,64}$/;

export async function POST(req: NextRequest) {
  await requireDriver();

  const formData = await req.formData();
  const file = formData.get("file");
  const jadwalDetailId = formData.get("jadwalDetailId");
  const jenisFoto = formData.get("jenisFoto");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (typeof jadwalDetailId !== "string" || !jadwalDetailId.trim()) {
    return NextResponse.json({ error: "jadwalDetailId wajib diisi" }, { status: 400 });
  }
  if (typeof jenisFoto !== "string" || !JENIS_FOTO_PATTERN.test(jenisFoto)) {
    return NextResponse.json({ error: "jenisFoto tidak valid" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Format file harus JPG, PNG, atau WEBP" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Ukuran file maksimal 5MB" }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const now = new Date();
  const stamp =
    [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("") +
    "-" +
    [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0")].join(
      ""
    );
  const fileName = `${stamp}-${jenisFoto}.${ext}`;
  const safeJadwalDetailId = jadwalDetailId.replace(/[^a-zA-Z0-9_-]/g, "");
  const uploadDir = path.join(process.cwd(), "public", "uploads", "driver-app", safeJadwalDetailId);

  try {
    await mkdir(uploadDir, { recursive: true });
    const bytes = await file.arrayBuffer();
    await writeFile(path.join(uploadDir, fileName), Buffer.from(bytes));
  } catch {
    return NextResponse.json({ error: "Gagal menyimpan foto" }, { status: 500 });
  }

  return NextResponse.json({ path: `/uploads/driver-app/${safeJadwalDetailId}/${fileName}` });
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/upload/driver-app/route.ts`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/upload/driver-app/route.ts
git commit -m "Add driver-app photo/signature upload endpoint"
```

---

## Task 12: Server actions — `src/app/driver-app/actions.ts`

**Files:**
- Create: `src/app/driver-app/actions.ts`

**Interfaces:**
- Consumes: `requireDriver()` (Task 4); `getDriverJadwalList`, `getDriverJadwalStops`, `getStopOrderItems`, `recordStopArrival`, `confirmStopDelivery` (Tasks 8-10); `getDriverProfiles` (existing); `recordPayment`, `PAYMENT_CHANNELS` (existing, `src/lib/queries/pelunasan.ts`); `checkArmadaConflict`-style read pattern is NOT used here (no conflict-check needed for read-only driver actions).
- Produces: every server action the driver-app UI (Tasks 13-22) calls, including `getInvoiceOutstandingAction(businessPartnerId, salesInvoiceId): Promise<ActionResult<number>>` (consumed by Task 22's Pembayaran screen).

- [ ] **Step 1: Write the actions file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireDriver } from "@/lib/require-access";
import {
  getDriverJadwalList,
  getDriverJadwalStops,
  getStopOrderItems,
  recordStopArrival,
  confirmStopDelivery,
  type DriverJadwalCard,
  type DriverStopRow,
  type StopOrderItem,
  type ConfirmStopDeliveryInput,
} from "@/lib/queries/pengiriman-jadwal";
import { getDriverProfiles, type DriverProfileRow } from "@/lib/queries/driver-profile";
import { getOutstandingInvoicesForMitra, recordPayment, type RecordPaymentInput, type RecordPaymentResult } from "@/lib/queries/pelunasan";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

async function requireOwnSalesmanId(): Promise<string> {
  const session = await requireDriver();
  if (!session.user.salesmanId) {
    throw new AppError("Akun ini belum ditautkan ke data Driver, hubungi Admin.");
  }
  return session.user.salesmanId;
}

export async function getDriverJadwalListAction(dateISO: string): Promise<ActionResult<DriverJadwalCard[]>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    return getDriverJadwalList(salesmanId, dateISO);
  });
}

export async function getDriverJadwalStopsAction(jadwalId: number): Promise<ActionResult<DriverStopRow[]>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    return getDriverJadwalStops(jadwalId);
  });
}

export async function getStopOrderItemsAction(jadwalDetailId: number): Promise<ActionResult<StopOrderItem[]>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    return getStopOrderItems(jadwalDetailId);
  });
}

export async function recordStopArrivalAction(jadwalDetailId: number): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    const id = await recordStopArrival(jadwalDetailId);
    revalidatePath("/driver-app");
    return id;
  });
}

export async function confirmStopDeliveryAction(
  input: ConfirmStopDeliveryInput
): Promise<ActionResult<{ stopDeliveryId: number; salesInvoiceId: string | null }>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    const result = await confirmStopDelivery(input);
    revalidatePath("/driver-app");
    return result;
  });
}

export async function getOwnDriverProfileAction(): Promise<ActionResult<DriverProfileRow | null>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    const all = await getDriverProfiles();
    return all.find((d) => d.SalesmanID === salesmanId) ?? null;
  });
}

export async function recordDriverPaymentAction(input: RecordPaymentInput): Promise<ActionResult<RecordPaymentResult>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    return recordPayment(input);
  });
}

// Real current Outstanding for one invoice (post-retur-adjustment, since
// confirmStopDelivery already updated SalesInvoice.Netto by the time this
// is called from the Pembayaran screen) — reuses the same
// vCustomerStatement-backed query the dashboard's own Pelunasan dialog
// uses, just narrowed to one SalesInvoiceID instead of listing every
// outstanding invoice for the mitra.
export async function getInvoiceOutstandingAction(
  businessPartnerId: string,
  salesInvoiceId: string
): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    const invoices = await getOutstandingInvoicesForMitra(businessPartnerId);
    const invoice = invoices.find((i) => i.SalesInvoiceID === salesInvoiceId);
    if (!invoice) throw new AppError("Invoice ini sudah lunas atau tidak ditemukan.");
    return invoice.Outstanding;
  });
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/app/driver-app/actions.ts`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/driver-app/actions.ts
git commit -m "Add driver-app server actions"
```

---

## Task 13: Driver-app shell — bottom-nav layout for the 4 tabs

**Files:**
- Create: `src/app/driver-app/(tabs)/layout.tsx`
- Create: `src/components/driver-app/bottom-nav.tsx`

**Interfaces:**
- Consumes: `requireDriver()` (Task 4).
- Produces: shared shell rendered by Tasks 14-17's tab pages. The `(tabs)` route group means these 4 pages share this layout while `src/app/driver-app/jadwal/[jadwalId]/page.tsx` (Task 18, outside the group) does not.

- [ ] **Step 1: Write the bottom nav component**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Map, History, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/driver-app", label: "Tugas", icon: ClipboardList },
  { href: "/driver-app/peta", label: "Peta", icon: Map },
  { href: "/driver-app/riwayat", label: "Riwayat", icon: History },
  { href: "/driver-app/profil", label: "Profil", icon: User },
] as const;

export function DriverBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = tab.href === "/driver-app" ? pathname === "/driver-app" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write the layout**

```tsx
import { requireDriver } from "@/lib/require-access";
import { DriverBottomNav } from "@/components/driver-app/bottom-nav";

export default async function DriverTabsLayout({ children }: { children: React.ReactNode }) {
  await requireDriver();
  return (
    <div className="flex min-h-dvh flex-col bg-background pb-16">
      <div className="flex-1">{children}</div>
      <DriverBottomNav />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/app/driver-app/\(tabs\)/layout.tsx src/components/driver-app/bottom-nav.tsx`
Expected: zero errors. (This won't fully build yet — the 4 tab pages don't exist until Tasks 14-17 — that's expected.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/driver-app/(tabs)/layout.tsx" src/components/driver-app/bottom-nav.tsx
git commit -m "Add driver-app bottom-nav shell layout"
```

---

## Task 14: Screen 1 — Tugas (Beranda Driver)

**Files:**
- Create: `src/app/driver-app/(tabs)/page.tsx`
- Create: `src/components/driver-app/tugas-list.tsx`

**Interfaces:**
- Consumes: `getDriverJadwalListAction` (Task 12).
- Produces: nothing consumed elsewhere — this is the app's home screen. Cards link to `/driver-app/jadwal/{JadwalID}` (Task 18).

- [ ] **Step 1: Write the page**

```tsx
import { requireDriver } from "@/lib/require-access";
import { getBusinessDateISO } from "@/lib/business-date";
import { getDriverJadwalList } from "@/lib/queries/pengiriman-jadwal";
import { TugasList } from "@/components/driver-app/tugas-list";

export default async function DriverTugasPage() {
  const session = await requireDriver();
  const todayISO = getBusinessDateISO();
  const salesmanId = session.user.salesmanId;
  const jadwal = salesmanId ? await getDriverJadwalList(salesmanId, todayISO) : [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-lg font-semibold">Beranda Driver</h1>
      {!salesmanId && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Akun ini belum ditautkan ke data Driver, hubungi Admin.
        </p>
      )}
      <TugasList initialJadwal={jadwal} initialDateISO={todayISO} />
    </div>
  );
}
```

- [ ] **Step 2: Write the client component**

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatTime } from "@/lib/format";
import type { DriverJadwalCard } from "@/lib/queries/pengiriman-jadwal";
import { getDriverJadwalListAction } from "@/app/driver-app/actions";

function statusLabel(j: DriverJadwalCard): { label: string; variant: "outline" | "default" | "secondary" } {
  if (j.IsSelesai) return { label: "Selesai", variant: "secondary" };
  if (j.JamAktualBerangkat) return { label: "Dalam Pengiriman", variant: "default" };
  if (j.JamSelesaiMuat) return { label: "Menunggu Keberangkatan", variant: "outline" };
  if (j.Status === "Draft") return { label: "Dijadwalkan", variant: "outline" };
  return { label: "Proses Muat", variant: "outline" };
}

export function TugasList({
  initialJadwal,
  initialDateISO,
}: {
  initialJadwal: DriverJadwalCard[];
  initialDateISO: string;
}) {
  const [jadwal, setJadwal] = useState(initialJadwal);
  const [dateISO, setDateISO] = useState(initialDateISO);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDateChange(next: string) {
    setDateISO(next);
    setError(null);
    startTransition(async () => {
      const result = await getDriverJadwalListAction(next);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setJadwal(result.data);
    });
  }

  const totalHariKerja = new Set(jadwal.map((j) => String(j.JamJadwal).slice(0, 10))).size;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Card size="sm">
          <CardContent className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-[10px] uppercase text-muted-foreground">Total Hari Kerja</span>
            <span className="text-lg font-semibold">{totalHariKerja} Hari</span>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-[10px] uppercase text-muted-foreground">Tugas Hari Ini</span>
            <span className="text-lg font-semibold">{jadwal.length}</span>
          </CardContent>
        </Card>
      </div>

      <Input type="date" value={dateISO} onChange={(e) => handleDateChange(e.target.value)} className="w-fit" />

      {error && <p className="text-sm text-destructive">{error}</p>}
      {pending && <p className="text-sm text-muted-foreground">Memuat...</p>}

      <div className="flex flex-col gap-3">
        {jadwal.map((j) => {
          const status = statusLabel(j);
          return (
            <Link key={j.JadwalID} href={`/driver-app/jadwal/${j.JadwalID}`}>
              <Card className="py-3">
                <CardContent className="flex flex-col gap-1.5 px-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{formatTime(j.JamJadwal)}</span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {j.ArmadaNama} {j.VehicleNo ? `• ${j.VehicleNo}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {j.StopSelesai}/{j.TotalStop} lokasi selesai &mdash; {j.TotalKantong} kantong
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {jadwal.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada tugas untuk tanggal ini.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/driver-app/(tabs)/page.tsx" src/components/driver-app/tugas-list.tsx`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/driver-app/(tabs)/page.tsx" src/components/driver-app/tugas-list.tsx
git commit -m "Add driver-app Tugas (Beranda) screen"
```

---

## Task 15: Tab Peta — all-of-today's routes overview

**Files:**
- Create: `src/app/driver-app/(tabs)/peta/page.tsx`
- Create: `src/components/driver-app/peta-overview-map.tsx`

**Interfaces:**
- Consumes: `getDriverJadwalStopsAction` (Task 12), `getMultiPointRoute` (existing, `src/lib/osrm.ts`), `getPabrikLocation` (existing).

- [ ] **Step 1: Write the page**

```tsx
import { requireDriver } from "@/lib/require-access";
import { getBusinessDateISO } from "@/lib/business-date";
import { getDriverJadwalList, getDriverJadwalStops } from "@/lib/queries/pengiriman-jadwal";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { PetaOverviewMap } from "@/components/driver-app/peta-overview-map";

export default async function DriverPetaPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const pabrik = await getPabrikLocation();

  if (!salesmanId) {
    return <p className="p-4 text-sm text-destructive">Akun ini belum ditautkan ke data Driver, hubungi Admin.</p>;
  }

  const todayISO = getBusinessDateISO();
  const jadwalList = await getDriverJadwalList(salesmanId, todayISO);
  const routes = await Promise.all(
    jadwalList.map(async (j) => ({
      jadwalId: j.JadwalID,
      stops: await getDriverJadwalStops(j.JadwalID),
    }))
  );

  return (
    <div className="flex h-dvh flex-col">
      <div className="p-4 pb-0">
        <h1 className="font-display text-lg font-semibold">Peta Hari Ini</h1>
      </div>
      <div className="flex-1 p-4">
        <PetaOverviewMap pabrik={{ lat: pabrik.latitude, lng: pabrik.longitude }} routes={routes} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the map component**

```tsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

const MapContent = dynamic(() => import("./peta-overview-map-content"), { ssr: false });

const ROUTE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

export function PetaOverviewMap({
  pabrik,
  routes,
}: {
  pabrik: { lat: number; lng: number };
  routes: { jadwalId: number; stops: DriverStopRow[] }[];
}) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const coloredRoutes = routes.map((r, i) => ({ ...r, color: ROUTE_COLORS[i % ROUTE_COLORS.length] }));

  return <MapContent pabrik={pabrik} routes={coloredRoutes} position={position} />;
}
```

- [ ] **Step 3: Write the Leaflet content component (separate file — `dynamic(..., { ssr: false })` requires the Leaflet-touching code in its own module)**

Create `src/components/driver-app/peta-overview-map-content.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

interface ColoredRoute {
  jadwalId: number;
  stops: DriverStopRow[];
  color: string;
}

export default function PetaOverviewMapContent({
  pabrik,
  routes,
  position,
}: {
  pabrik: { lat: number; lng: number };
  routes: ColoredRoute[];
  position: { lat: number; lng: number } | null;
}) {
  const [geometries, setGeometries] = useState<Map<number, MultiPointRoute>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        routes.map(async (r) => {
          const points = [pabrik, ...r.stops.filter((s) => s.Latitude != null && s.Longitude != null).map((s) => ({ lat: s.Latitude as number, lng: s.Longitude as number }))];
          if (points.length < 2) return null;
          try {
            const route = await getMultiPointRoute(points);
            return [r.jadwalId, route] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      setGeometries(new Map(entries.filter((e): e is readonly [number, MultiPointRoute] => e !== null)));
    })();
    return () => {
      cancelled = true;
    };
  }, [routes, pabrik]);

  return (
    <MapContainer center={[pabrik.lat, pabrik.lng]} zoom={12} className="h-full w-full rounded-lg">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {routes.map((r) => {
        const geometry = geometries.get(r.jadwalId);
        return (
          <div key={r.jadwalId}>
            {geometry && (
              <Polyline positions={geometry.geometry.map(([lng, lat]) => [lat, lng])} pathOptions={{ color: r.color, weight: 4 }} />
            )}
            {r.stops
              .filter((s) => s.Latitude != null && s.Longitude != null)
              .map((s) => (
                <Marker key={s.JadwalDetailID} position={[s.Latitude as number, s.Longitude as number]}>
                  <Popup>{s.CustomerName}</Popup>
                </Marker>
              ))}
          </div>
        );
      })}
      {position && <Marker position={[position.lat, position.lng]} />}
    </MapContainer>
  );
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/driver-app/(tabs)/peta/page.tsx" src/components/driver-app/peta-overview-map.tsx src/components/driver-app/peta-overview-map-content.tsx`
Expected: zero errors. `<div>` wrapping a Leaflet `Polyline`+`Marker` fragment above is only for the `key` prop — if `eslint` flags it, replace with `<Fragment key={r.jadwalId}>` from `"react"` instead (equivalent, avoids an extra DOM node inside `MapContainer`, which expects only Leaflet child components).

- [ ] **Step 5: Commit**

```bash
git add "src/app/driver-app/(tabs)/peta/page.tsx" src/components/driver-app/peta-overview-map.tsx src/components/driver-app/peta-overview-map-content.tsx
git commit -m "Add driver-app Peta tab: all-routes overview map"
```

---

## Task 16: Tab Riwayat

**Files:**
- Create: `src/app/driver-app/(tabs)/riwayat/page.tsx`
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Produces: `getDriverJadwalHistory(salesmanId: string, limit: number): Promise<DriverJadwalCard[]>` (reuses `DriverJadwalCard` from Task 8).

- [ ] **Step 1: Add the history query**

In `src/lib/queries/pengiriman-jadwal.ts`, right after `getDriverJadwalList`:

```ts
// Riwayat tab — every Selesai Jadwal for this driver, most recent first,
// capped since there's no pagination UI yet (a driver's realistic history
// depth is small enough that a flat cap is fine for v1). Same StopAgg
// pre-aggregation as getDriverJadwalList, for the same fan-out reason.
export async function getDriverJadwalHistory(salesmanId: string, limit = 50): Promise<DriverJadwalCard[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("limit", sql.Int, limit).query(`
      WITH StopAgg AS (
          SELECT jd.JadwalID, jd.JadwalDetailID,
                 ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Kantong,
                 CASE WHEN sd.JamSelesai IS NOT NULL THEN 1 ELSE 0 END AS IsSelesai
          FROM DashboardPengirimanJadwalDetail jd
          LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
          LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
          WHERE jd.IsDeleted = 0
          GROUP BY jd.JadwalID, jd.JadwalDetailID, sd.JamSelesai
      )
      SELECT TOP (@limit)
          j.JadwalID,
          a.Nama AS ArmadaNama,
          ed.VehicleNo,
          j.JamJadwal,
          j.Status,
          j.JamSelesaiMuat,
          j.JamAktualBerangkat,
          COUNT(sa.JadwalDetailID) AS TotalStop,
          SUM(sa.IsSelesai) AS StopSelesai,
          SUM(sa.Kantong) AS TotalKantong
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      JOIN StopAgg sa ON sa.JadwalID = j.JadwalID
      WHERE j.SalesmanID = @salesmanId AND j.IsDeleted = 0
      GROUP BY j.JadwalID, a.Nama, ed.VehicleNo, j.JamJadwal, j.Status, j.JamSelesaiMuat, j.JamAktualBerangkat
      HAVING COUNT(sa.JadwalDetailID) = SUM(sa.IsSelesai)
      ORDER BY j.JamJadwal DESC
    `);
  return (result.recordset as Omit<DriverJadwalCard, "IsSelesai">[]).map((r) => ({ ...r, IsSelesai: true }));
}
```

- [ ] **Step 2: Write the page**

```tsx
import { requireDriver } from "@/lib/require-access";
import { getDriverJadwalHistory } from "@/lib/queries/pengiriman-jadwal";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatTime } from "@/lib/format";

export default async function DriverRiwayatPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const history = salesmanId ? await getDriverJadwalHistory(salesmanId) : [];

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Riwayat</h1>
      {history.map((j) => (
        <Card key={j.JadwalID} className="py-3">
          <CardContent className="flex flex-col gap-1 px-4">
            <p className="text-sm font-medium">
              {formatDate(j.JamJadwal)} &mdash; {formatTime(j.JamJadwal)}
            </p>
            <p className="text-xs text-muted-foreground">
              {j.ArmadaNama} {j.VehicleNo ? `• ${j.VehicleNo}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {j.TotalStop} lokasi &mdash; {j.TotalKantong} kantong
            </p>
          </CardContent>
        </Card>
      ))}
      {history.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Belum ada riwayat pengiriman.</p>}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/driver-app/(tabs)/riwayat/page.tsx" src/lib/queries/pengiriman-jadwal.ts`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/driver-app/(tabs)/riwayat/page.tsx" src/lib/queries/pengiriman-jadwal.ts
git commit -m "Add driver-app Riwayat tab"
```

---

## Task 17: Tab Profil + logout

**Files:**
- Create: `src/app/driver-app/(tabs)/profil/page.tsx`
- Create: `src/components/driver-app/profil-logout-button.tsx`

**Interfaces:**
- Consumes: `getOwnDriverProfileAction` (Task 12).

- [ ] **Step 1: Write the logout button**

```tsx
"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function ProfilLogoutButton() {
  return (
    <Button variant="outline" className="w-full" onClick={() => signOut({ callbackUrl: "/login" })}>
      <LogOut className="size-4" />
      Keluar
    </Button>
  );
}
```

- [ ] **Step 2: Write the page**

```tsx
import { requireDriver } from "@/lib/require-access";
import { getDriverProfiles } from "@/lib/queries/driver-profile";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { ProfilLogoutButton } from "@/components/driver-app/profil-logout-button";

export default async function DriverProfilPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const profile = salesmanId ? (await getDriverProfiles()).find((d) => d.SalesmanID === salesmanId) ?? null : null;

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Profil</h1>
      <Card>
        <CardContent className="flex flex-col gap-2 px-4 py-3 text-sm">
          <p className="font-medium">{profile?.Name ?? session.user.name}</p>
          {profile ? (
            <>
              <p className="text-xs text-muted-foreground">Bergabung sejak: {profile.BergabungSejak ? formatDate(profile.BergabungSejak) : "-"}</p>
              <p className="text-xs text-muted-foreground">SIM: {profile.SimTypes.length > 0 ? profile.SimTypes.join(", ") : "-"}</p>
            </>
          ) : (
            <p className="text-xs text-destructive">Akun ini belum ditautkan ke data Driver, hubungi Admin.</p>
          )}
        </CardContent>
      </Card>
      <ProfilLogoutButton />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/driver-app/(tabs)/profil/page.tsx" src/components/driver-app/profil-logout-button.tsx`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/driver-app/(tabs)/profil/page.tsx" src/components/driver-app/profil-logout-button.tsx
git commit -m "Add driver-app Profil tab with logout"
```

---

## Task 18: Delivery flow shell — `jadwal/[jadwalId]` entry + step machine

**Files:**
- Create: `src/app/driver-app/jadwal/[jadwalId]/page.tsx`
- Create: `src/components/driver-app/stop-flow.tsx`

**Interfaces:**
- Consumes: `getDriverJadwalStopsAction` (Task 12).
- Produces: `StopFlow` client component owning step state (`"peta" | "konfirKirim" | "konfirTerima" | "pembayaran" | "berhasil"`) for the current active (first-incomplete) stop, rendered by Tasks 19-22's step components (each added as a case in this same file's switch).

- [ ] **Step 1: Write the page (ownership check + initial data fetch)**

This route sits OUTSIDE the `(tabs)` group, so it renders full-screen with no bottom nav — matching the mockups, where only the Tugas/Peta/Riwayat/Profil tabs show the nav bar.

```tsx
import { notFound } from "next/navigation";
import { requireDriver } from "@/lib/require-access";
import { getDriverJadwalStops } from "@/lib/queries/pengiriman-jadwal";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { StopFlow } from "@/components/driver-app/stop-flow";

export default async function DriverJadwalPage({ params }: { params: Promise<{ jadwalId: string }> }) {
  const { jadwalId } = await params;
  const session = await requireDriver();
  const id = Number(jadwalId);
  if (!Number.isInteger(id)) notFound();

  const stops = await getDriverJadwalStops(id);
  if (stops.length === 0) notFound();

  const pabrik = await getPabrikLocation();

  return (
    <StopFlow
      jadwalId={id}
      initialStops={stops}
      pabrik={{ lat: pabrik.latitude, lng: pabrik.longitude }}
      driverName={session.user.name ?? session.user.username}
    />
  );
}
```

Ownership note: `getDriverJadwalStops` doesn't itself filter by `SalesmanID` (it takes a `jadwalId` directly, mirroring `getJadwalDetail`'s existing shape) — this page deliberately does NOT add a `SalesmanID` cross-check here beyond `requireDriver()`'s login gate, matching this codebase's existing trust model for internal delivery data (the equivalent dashboard pages, e.g. `src/app/(dashboard)/delivery/page.tsx`, apply the same one-layer gate). If stricter per-driver enforcement is wanted later, it's a follow-up, not a gap introduced by this task.

- [ ] **Step 2: Write the step-machine shell**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import { PengirimanStep } from "@/components/driver-app/steps/pengiriman-step";
import { KonfirKirimStep } from "@/components/driver-app/steps/konfir-kirim-step";
import { KonfirTerimaStep } from "@/components/driver-app/steps/konfir-terima-step";
import { PembayaranStep } from "@/components/driver-app/steps/pembayaran-step";
import { BerhasilStep } from "@/components/driver-app/steps/berhasil-step";

type StepName = "peta" | "konfirKirim" | "konfirTerima" | "pembayaran" | "berhasil";

export interface KonfirKirimResult {
  items: { salesOrderDetailId: string; qtyDiterima: number; fotoReturUrl: string | null }[];
  fotoBuktiPengirimanUrl: string;
  fotoBuktiMuatanUrl: string;
  tanpaPembayaran: boolean;
}

export function StopFlow({
  jadwalId,
  initialStops,
  pabrik,
  driverName,
}: {
  jadwalId: number;
  initialStops: DriverStopRow[];
  pabrik: { lat: number; lng: number };
  driverName: string;
}) {
  const router = useRouter();
  const [stops, setStops] = useState(initialStops);
  const [step, setStep] = useState<StepName>("peta");
  const [konfirKirimResult, setKonfirKirimResult] = useState<KonfirKirimResult | null>(null);
  const [salesInvoiceId, setSalesInvoiceId] = useState<string | null>(null);

  const activeStop = stops.find((s) => s.JamSelesai == null) ?? null;

  if (!activeStop) {
    router.replace("/driver-app");
    return null;
  }

  function handleArrived() {
    setStep("konfirKirim");
  }

  function handleKonfirKirimNext(result: KonfirKirimResult) {
    setKonfirKirimResult(result);
    setStep("konfirTerima");
  }

  function handleKonfirmasiPenerima(invoiceId: string | null) {
    setSalesInvoiceId(invoiceId);
    if (konfirKirimResult?.tanpaPembayaran || !invoiceId) {
      setStep("berhasil");
      return;
    }
    setStep("pembayaran");
  }

  function handlePembayaranDone() {
    setStep("berhasil");
  }

  function handleBerhasilDone() {
    const remaining = stops.filter((s) => s.JadwalDetailID !== activeStop.JadwalDetailID);
    setStops(remaining.map((s) => (s.JadwalDetailID === activeStop.JadwalDetailID ? { ...s, JamSelesai: new Date().toISOString() } : s)));
    setStep("peta");
    setKonfirKirimResult(null);
    setSalesInvoiceId(null);
    // Re-derive whether any stop is left; if none, StopFlow's own
    // `activeStop == null` branch above redirects to /driver-app on the
    // next render.
    setStops((prev) => prev.map((s) => (s.JadwalDetailID === activeStop.JadwalDetailID ? { ...s, JamSelesai: new Date().toISOString() } : s)));
  }

  switch (step) {
    case "peta":
      return <PengirimanStep jadwalId={jadwalId} stop={activeStop} remainingCount={stops.length} pabrik={pabrik} driverName={driverName} onArrived={handleArrived} />;
    case "konfirKirim":
      return <KonfirKirimStep jadwalDetailId={activeStop.JadwalDetailID} onNext={handleKonfirKirimNext} />;
    case "konfirTerima":
      return (
        <KonfirTerimaStep
          jadwalDetailId={activeStop.JadwalDetailID}
          result={konfirKirimResult!}
          onConfirmed={handleKonfirmasiPenerima}
        />
      );
    case "pembayaran":
      return (
        <PembayaranStep
          salesInvoiceId={salesInvoiceId!}
          businessPartnerId={activeStop.BusinessPartnerID}
          onDone={handlePembayaranDone}
        />
      );
    case "berhasil":
      return <BerhasilStep salesInvoiceId={salesInvoiceId} onSelesai={handleBerhasilDone} />;
  }
}
```

Fix note: `handleBerhasilDone` above calls `setStops` twice with the same update — **delete the first `setStops(remaining.map(...))` line**, keep only the second `setStops((prev) => ...)` functional-updater call (it's the correct, race-safe form; the first line was a leftover duplicate from drafting and must not appear in the final code). This note exists so the implementer removes the duplicate rather than transcribing it.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY about the 5 not-yet-created step components under `src/components/driver-app/steps/` (created in Tasks 19-22, `berhasil-step` in Task 22) — confirm no other errors in `stop-flow.tsx`/`page.tsx` themselves.

- [ ] **Step 4: Commit**

```bash
git add "src/app/driver-app/jadwal/[jadwalId]/page.tsx" src/components/driver-app/stop-flow.tsx
git commit -m "Add driver-app delivery flow shell (step machine)"
```

---

## Task 19: Layar Pengiriman step — live map + swipe to arrive

**Files:**
- Create: `src/components/driver-app/steps/pengiriman-step.tsx`
- Create: `src/components/driver-app/steps/pengiriman-map-content.tsx`

**Interfaces:**
- Consumes: `recordStopArrivalAction` (Task 12), `getMultiPointRoute` (existing).
- Produces: `PengirimanStep` component, consumed by Task 18's `StopFlow` (already wired in Task 18's switch — this task fills in the component itself).

- [ ] **Step 1: Write `pengiriman-step.tsx`**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import { recordStopArrivalAction } from "@/app/driver-app/actions";

const PengirimanMapContent = dynamic(() => import("./pengiriman-map-content"), { ssr: false });

const FOREGROUND_PING_INTERVAL_MS = 20_000;

export function PengirimanStep({
  jadwalId,
  stop,
  remainingCount,
  pabrik,
  driverName,
  onArrived,
}: {
  jadwalId: number;
  stop: DriverStopRow;
  remainingCount: number;
  pabrik: { lat: number; lng: number };
  driverName: string;
  onArrived: () => void;
}) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Foreground-only, higher-frequency position sampling while this screen
  // is open — deliberately separate from the app-wide 90s background
  // ping (LocationTrackingBootstrap, native-only) so the live route/marker
  // on this screen updates responsively without changing that global
  // baseline for every other screen/account.
  useEffect(() => {
    if (!navigator.geolocation) return;
    function poll() {
      navigator.geolocation.getCurrentPosition(
        (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true }
      );
    }
    poll();
    const intervalId = setInterval(poll, FOREGROUND_PING_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  function handleArrived() {
    setError(null);
    startTransition(async () => {
      const result = await recordStopArrivalAction(stop.JadwalDetailID);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onArrived();
    });
  }

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <ArrowLeft className="size-5" />
        <div>
          <p className="text-sm font-medium">{driverName}</p>
          <p className="text-xs text-muted-foreground">Jadwal #{jadwalId}</p>
        </div>
      </div>
      <div className="flex-1">
        <PengirimanMapContent pabrik={pabrik} stop={stop} position={position} />
      </div>
      <div className="flex flex-col gap-2 border-t border-border p-4">
        <div>
          <p className="text-sm font-medium">{stop.CustomerName}</p>
          <p className="text-xs text-muted-foreground">
            {stop.Alamat ?? "-"} &mdash; {stop.Wilayah}
          </p>
          <p className="text-xs text-muted-foreground">{remainingCount} lokasi tersisa</p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={pending} onClick={handleArrived}>
          {pending ? "Memproses..." : "Geser untuk Tiba"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `pengiriman-map-content.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

export default function PengirimanMapContent({
  pabrik,
  stop,
  position,
}: {
  pabrik: { lat: number; lng: number };
  stop: DriverStopRow;
  position: { lat: number; lng: number } | null;
}) {
  const [route, setRoute] = useState<MultiPointRoute | null>(null);
  const origin = position ?? pabrik;

  useEffect(() => {
    if (stop.Latitude == null || stop.Longitude == null) return;
    let cancelled = false;
    getMultiPointRoute([origin, { lat: stop.Latitude, lng: stop.Longitude }])
      .then((r) => {
        if (!cancelled) setRoute(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetches on
    // every position change deliberately (that's the "live route" effect);
    // stop's own lat/lng never change within one stop's lifetime.
  }, [origin.lat, origin.lng]);

  if (stop.Latitude == null || stop.Longitude == null) {
    return <p className="p-4 text-sm text-muted-foreground">Lokasi tujuan belum tersedia.</p>;
  }

  return (
    <MapContainer center={[origin.lat, origin.lng]} zoom={13} className="h-full w-full">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[origin.lat, origin.lng]} />
      <Marker position={[stop.Latitude, stop.Longitude]} />
      {route && <Polyline positions={route.geometry.map(([lng, lat]) => [lat, lng])} pathOptions={{ color: "#16a34a", weight: 5 }} />}
    </MapContainer>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/components/driver-app/steps/pengiriman-step.tsx src/components/driver-app/steps/pengiriman-map-content.tsx`
Expected: zero new errors from these two files (the 4 other still-missing step components from Task 18 remain expected until their own tasks land).

- [ ] **Step 4: Commit**

```bash
git add src/components/driver-app/steps/pengiriman-step.tsx src/components/driver-app/steps/pengiriman-map-content.tsx
git commit -m "Add driver-app Layar Pengiriman: live map + geser untuk tiba"
```

---

## Task 20: Layar Konfir Kirim — photos + item qty/retur editor

**Files:**
- Create: `src/components/driver-app/steps/konfir-kirim-step.tsx`

**Interfaces:**
- Consumes: `getStopOrderItemsAction` (Task 12), `LiveCameraCaptureField` (existing).
- Produces: `KonfirKirimStep`, calling `onNext(result: KonfirKirimResult)` (type defined in Task 18) once the driver taps "Lanjut" — uploads photos via `/api/upload/driver-app` (Task 11) itself before calling `onNext`, so the parent only ever receives final URLs, not raw `File`s.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Minus, Plus } from "lucide-react";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
import { formatRupiah } from "@/lib/format";
import { getStopOrderItemsAction } from "@/app/driver-app/actions";
import type { KonfirKirimResult } from "@/components/driver-app/stop-flow";
import type { StopOrderItem } from "@/lib/queries/pengiriman-jadwal";

async function uploadDriverPhoto(jadwalDetailId: number, jenisFoto: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("jadwalDetailId", String(jadwalDetailId));
  formData.append("jenisFoto", jenisFoto);
  const res = await fetch("/api/upload/driver-app", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto");
  return data.path;
}

export function KonfirKirimStep({ jadwalDetailId, onNext }: { jadwalDetailId: number; onNext: (result: KonfirKirimResult) => void }) {
  const [items, setItems] = useState<StopOrderItem[]>([]);
  const [qtyDiterima, setQtyDiterima] = useState<Record<string, number>>({});
  const [returFotoFiles, setReturFotoFiles] = useState<Record<string, File>>({});
  const [fotoPengirimanFile, setFotoPengirimanFile] = useState<File | null>(null);
  const [fotoMuatanFile, setFotoMuatanFile] = useState<File | null>(null);
  const [tanpaPembayaran, setTanpaPembayaran] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStopOrderItemsAction(jadwalDetailId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setItems(result.data);
      setQtyDiterima(Object.fromEntries(result.data.map((item) => [item.SalesOrderDetailID, item.Qty])));
    });
    return () => {
      cancelled = true;
    };
  }, [jadwalDetailId]);

  const totalHarga = items.reduce((sum, item) => sum + (qtyDiterima[item.SalesOrderDetailID] ?? item.Qty) * item.Price, 0);

  function adjustQty(id: string, delta: number, max: number) {
    setQtyDiterima((prev) => {
      const next = Math.max(0, Math.min(max, (prev[id] ?? max) + delta));
      return { ...prev, [id]: next };
    });
  }

  async function handleSubmit() {
    if (!fotoPengirimanFile || !fotoMuatanFile) {
      setError("Foto bukti pengiriman dan bukti muatan wajib diisi.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const [fotoBuktiPengirimanUrl, fotoBuktiMuatanUrl] = await Promise.all([
        uploadDriverPhoto(jadwalDetailId, "bukti-pengiriman", fotoPengirimanFile),
        uploadDriverPhoto(jadwalDetailId, "bukti-muatan", fotoMuatanFile),
      ]);
      const resultItems = await Promise.all(
        items.map(async (item) => {
          const returFile = returFotoFiles[item.SalesOrderDetailID];
          const fotoReturUrl = returFile ? await uploadDriverPhoto(jadwalDetailId, `retur-${item.SalesOrderDetailID}`, returFile) : null;
          return {
            salesOrderDetailId: item.SalesOrderDetailID,
            qtyDiterima: qtyDiterima[item.SalesOrderDetailID] ?? item.Qty,
            fotoReturUrl,
          };
        })
      );
      onNext({ items: resultItems, fotoBuktiPengirimanUrl, fotoBuktiMuatanUrl, tanpaPembayaran });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Memuat...</p>;

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <h1 className="font-display text-lg font-semibold">Konfirmasi Pengiriman</h1>

      <div>
        <p className="mb-2 text-sm font-medium">Bukti Pengiriman</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="h-32">
            <LiveCameraCaptureField
              label="Bukti Pengiriman"
              photoUrl={fotoPengirimanFile ? URL.createObjectURL(fotoPengirimanFile) : null}
              size="main"
              active
              onCapture={setFotoPengirimanFile}
            />
          </div>
          <div className="h-32">
            <LiveCameraCaptureField
              label="Bukti Muatan"
              photoUrl={fotoMuatanFile ? URL.createObjectURL(fotoMuatanFile) : null}
              size="main"
              active
              onCapture={setFotoMuatanFile}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Konfirmasi Muatan</p>
        {items.map((item) => {
          const current = qtyDiterima[item.SalesOrderDetailID] ?? item.Qty;
          const retur = item.Qty - current;
          return (
            <div key={item.SalesOrderDetailID} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{item.Name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRupiah(item.Price)} &times; {item.Qty}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="icon" className="size-7" onClick={() => adjustQty(item.SalesOrderDetailID, -1, item.Qty)}>
                    <Minus className="size-3.5" />
                  </Button>
                  <span className="w-8 text-center text-sm">{current}</span>
                  <Button variant="outline" size="icon" className="size-7" onClick={() => adjustQty(item.SalesOrderDetailID, 1, item.Qty)}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>
              {retur > 0 && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-destructive/5 p-2">
                  <p className="text-xs text-destructive">Retur: {retur}</p>
                  <div className="h-14 w-14">
                    <LiveCameraCaptureField
                      label="Foto Retur"
                      photoUrl={returFotoFiles[item.SalesOrderDetailID] ? URL.createObjectURL(returFotoFiles[item.SalesOrderDetailID]) : null}
                      size="toggle"
                      active={false}
                      onCapture={(file) => setReturFotoFiles((prev) => ({ ...prev, [item.SalesOrderDetailID]: file }))}
                      onTogglePress={() => {}}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <span className="text-sm font-medium">Total Harga</span>
        <span className="text-sm font-semibold">{formatRupiah(totalHarga)}</span>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <p className="text-sm font-medium">Tanpa Pembayaran</p>
          <p className="text-xs text-muted-foreground">Lewati penagihan</p>
        </div>
        <Switch checked={tanpaPembayaran} onCheckedChange={setTanpaPembayaran} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button className="w-full" disabled={submitting} onClick={handleSubmit}>
        {submitting ? "Mengunggah..." : "Lanjut"}
      </Button>
    </div>
  );
}
```

Note: `LiveCameraCaptureField`'s `size="toggle"` mode (used above for the small per-item retur-photo tile) calls `onTogglePress` instead of opening its own live camera, per its existing implementation (Task reference: `src/components/dashboard/live-camera-capture-field.tsx`) — the empty `onTogglePress={() => {}}` above means tapping that tile currently does nothing extra beyond what `size="toggle"` already renders (a static placeholder). If a live capture is wanted for retur photos too (not just a placeholder), change that tile to `size="main"` with `active` instead — re-check the live component's actual toggle behavior before deciding, since this plan was written from the component's source without running it interactively.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/components/driver-app/steps/konfir-kirim-step.tsx`
Expected: zero new errors from this file. Check whether `Switch` exists at `@/components/ui/switch` (used elsewhere in this codebase, e.g. toggle fields in `route-validation-dialog.tsx`'s vehicle-check panel) — if the import path differs, fix it to match the actual existing component.

- [ ] **Step 3: Commit**

```bash
git add src/components/driver-app/steps/konfir-kirim-step.tsx
git commit -m "Add driver-app Layar Konfir Kirim: photos + item qty/retur editor"
```

---

## Task 21: Layar Konfir Terima — signature + confirm transaction

**Files:**
- Create: `src/components/driver-app/steps/konfir-terima-step.tsx`
- Create: `src/components/driver-app/signature-pad.tsx`

**Interfaces:**
- Consumes: `confirmStopDeliveryAction` (Task 12).
- Produces: `KonfirTerimaStep`, calling `onConfirmed(salesInvoiceId: string | null)` (Task 18's `StopFlow` prop).

- [ ] **Step 1: Write a minimal canvas-based signature pad**

```tsx
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function SignaturePad({ onCapture }: { onCapture: (file: File) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    const pos = getPos(e);
    ctx?.beginPath();
    ctx?.moveTo(pos.x, pos.y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const pos = getPos(e);
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawn(true);
  }

  function handlePointerUp() {
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    canvas.toBlob((blob) => {
      if (blob) onCapture(new File([blob], "tanda-tangan.png", { type: "image/png" }));
    }, "image/png");
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={320}
        height={160}
        className="w-full touch-none rounded-lg border border-dashed border-border bg-muted/30"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <Button variant="outline" size="sm" className="w-fit" onClick={handleClear}>
        Hapus
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Write the step component**

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/driver-app/signature-pad";
import { confirmStopDeliveryAction } from "@/app/driver-app/actions";
import type { KonfirKirimResult } from "@/components/driver-app/stop-flow";

async function uploadSignature(jadwalDetailId: number, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("jadwalDetailId", String(jadwalDetailId));
  formData.append("jenisFoto", "tanda-tangan");
  const res = await fetch("/api/upload/driver-app", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah tanda tangan");
  return data.path;
}

export function KonfirTerimaStep({
  jadwalDetailId,
  result,
  onConfirmed,
}: {
  jadwalDetailId: number;
  result: KonfirKirimResult;
  onConfirmed: (salesInvoiceId: string | null) => void;
}) {
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!signatureFile) {
      setError("Tanda tangan penerima wajib diisi.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const tandaTanganUrl = await uploadSignature(jadwalDetailId, signatureFile);
      const actionResult = await confirmStopDeliveryAction({
        jadwalDetailId,
        items: result.items,
        fotoBuktiPengirimanUrl: result.fotoBuktiPengirimanUrl,
        fotoBuktiMuatanUrl: result.fotoBuktiMuatanUrl,
        tandaTanganUrl,
        tanpaPembayaran: result.tanpaPembayaran,
      });
      if (!actionResult.success) {
        setError(actionResult.error);
        return;
      }
      onConfirmed(actionResult.data.salesInvoiceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah tanda tangan.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-background p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Tanda Tangan Penerima</h2>
        <X className="size-4 text-muted-foreground" />
      </div>
      <SignaturePad onCapture={setSignatureFile} />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Button className="mt-3 w-full" disabled={submitting} onClick={handleConfirm}>
        {submitting ? "Menyimpan..." : "Konfirmasi Penerima"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/components/driver-app/steps/konfir-terima-step.tsx src/components/driver-app/signature-pad.tsx`
Expected: zero new errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add src/components/driver-app/steps/konfir-terima-step.tsx src/components/driver-app/signature-pad.tsx
git commit -m "Add driver-app Layar Konfir Terima: signature + confirm transaction"
```

---

## Task 22: Layar Pembayaran + Layar Berhasil

**Files:**
- Create: `src/components/driver-app/steps/pembayaran-step.tsx`
- Create: `src/components/driver-app/steps/berhasil-step.tsx`

**Interfaces:**
- Consumes: `recordDriverPaymentAction`, `getInvoiceOutstandingAction` (Task 12).
- Produces: `PembayaranStep` calling `onDone()`, `BerhasilStep` calling `onSelesai()` — both already wired into Task 18's `StopFlow` switch.

- [ ] **Step 1: Write `pembayaran-step.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { getInvoiceOutstandingAction, recordDriverPaymentAction } from "@/app/driver-app/actions";

export function PembayaranStep({
  salesInvoiceId,
  businessPartnerId,
  onDone,
}: {
  salesInvoiceId: string;
  businessPartnerId: string;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInvoiceOutstandingAction(businessPartnerId, salesInvoiceId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setAmount(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [businessPartnerId, salesInvoiceId]);

  async function handleTunai() {
    if (amount == null) return;
    setError(null);
    setSubmitting(true);
    const result = await recordDriverPaymentAction({
      businessPartnerId,
      chartOfAccountId: "014",
      allocations: [{ salesInvoiceId, amount }],
    });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-lg font-semibold">Pembayaran</h1>

      <div className="rounded-lg border border-border p-4 text-center">
        <p className="text-xs uppercase text-muted-foreground">Total Pembayaran</p>
        <p className="text-2xl font-semibold">{loading ? "Memuat..." : amount != null ? formatRupiah(amount) : "-"}</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button variant="default">Tunai</Button>
        <Button variant="outline" disabled className="opacity-50">
          Dynamic QR
          <span className="block text-[10px]">Segera Hadir</span>
        </Button>
        <Button variant="outline" disabled className="opacity-50">
          QR Statis
          <span className="block text-[10px]">Segera Hadir</span>
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Konfirmasi telah menerima pembayaran tunai dari mitra untuk pengiriman ini.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={submitting || loading || amount == null} onClick={handleTunai}>
          {submitting ? "Menyimpan..." : "Selesaikan Pembayaran"}
        </Button>
      </div>
    </div>
  );
}
```

`getInvoiceOutstandingAction` throws `AppError("Invoice ini sudah lunas atau tidak ditemukan.")` when the invoice has no outstanding balance left (e.g. `confirmStopDelivery`'s retur adjustment brought `Netto` down to exactly what's already been paid, which can't happen on a fresh invoice but is a real edge case worth having a clear message for) — that message surfaces via `error` above rather than crashing the screen.

- [ ] **Step 2: Write `berhasil-step.tsx`**

```tsx
"use client";

import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatTime } from "@/lib/format";

export function BerhasilStep({ salesInvoiceId, onSelesai }: { salesInvoiceId: string | null; onSelesai: () => void }) {
  const now = new Date();
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <CheckCircle2 className="size-16 text-green-600" />
      <h1 className="font-display text-xl font-semibold">Pengiriman Berhasil</h1>
      <p className="text-sm text-muted-foreground">
        {salesInvoiceId ? "Transaksi untuk lokasi ini telah selesai." : "Pengiriman telah dikonfirmasi tanpa penagihan."}
      </p>
      <div className="w-full rounded-lg border border-border p-3 text-left text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Waktu</span>
          <span>
            {formatDate(now)}, {formatTime(now)}
          </span>
        </div>
      </div>
      <Button className="w-full" onClick={onSelesai}>
        Selesai &amp; Kembali ke Tugas
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/components/driver-app/steps/pembayaran-step.tsx src/components/driver-app/steps/berhasil-step.tsx`
Expected: zero new errors from these two files. At this point, `npx tsc --noEmit` for the WHOLE project should be clean (Task 18's shell now has all 5 step components it imports).

- [ ] **Step 4: Commit**

```bash
git add src/components/driver-app/steps/pembayaran-step.tsx src/components/driver-app/steps/berhasil-step.tsx
git commit -m "Add driver-app Layar Pembayaran (Tunai) + Layar Berhasil"
```

---

## Task 23: Full verification pass

**Files:** None (verification only — fixes go wherever the failure points).

**Interfaces:**
- Consumes: everything from Tasks 1-22.

- [ ] **Step 1: Full project typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors anywhere in the project, not just driver-app files — confirm no other module was broken by the `akun.ts`/`auth.ts`/`next-auth.d.ts` interface changes from Tasks 2-3 (every existing caller of `createAkun`/`updateAkun`/`listAllPeran` needs to compile with the new required fields).

- [ ] **Step 2: Full project lint**

Run: `npx eslint .`
Expected: zero errors. Pay particular attention to `react-hooks/refs` (a rule that has bitten this codebase before — see the ArmadaConflict/ErrHandling plans' final reviews) in the new `useState`/`useRef` combinations across `stop-flow.tsx` and the step components.

- [ ] **Step 3: Trace the full stop-completion state machine by hand**

Since there's no test runner, manually trace `stop-flow.tsx`'s state transitions against the spec's "Alur per Layar" section for at least these 3 paths, confirming each against the actual code (not just re-reading the plan):
1. Normal path with no retur, with payment: peta → konfirKirim → konfirTerima → pembayaran → berhasil → back to peta for the next stop (or `/driver-app` if that was the last one).
2. Retur path: konfirKirim with a reduced quantity → confirmStopDelivery creates a SalesReturn → konfirTerima → pembayaran uses the ALREADY-REDUCED invoice total, not the original.
3. "Tanpa Pembayaran" path: konfirKirim toggle on → konfirTerima → berhasil directly (pembayaran skipped).

- [ ] **Step 4: Manual/static verification of the driver-facing screens**

If an authenticated driver-app session is reachable from the sandbox: log in as a test driver account (created via Task 5's Akun form, linked to a real `SalesmanID` with at least one Draft/Terbit Jadwal scheduled today) and walk through the full journey once, screenshotting each screen. If login isn't reachable (the recurring constraint documented throughout this session), perform a careful static trace instead: for each of the 6 screens plus 4 tabs, confirm (a) the component actually renders the data its parent page fetched, (b) every server action call site checks `result.success` before touching `result.data`, (c) every `AppError` message shown to the user is in Indonesian and specific (never a fallback to the generic React RSC error text — the entire reason `runAction` exists). Document explicitly which form of verification was used.

- [ ] **Step 5: Re-verify Task 10's financial transaction against the live schema one more time**

Re-run `sql_get_table_info` for `SalesReturn`, `SalesReturnDetail`, `SalesInvoice`, `SalesInvoiceDetail`, `DeliveryOrderDetail` one final time and diff every column referenced in `confirmStopDelivery` against the current live schema — schemas can drift, and this function is the one place in the whole plan that writes to already-issued financial documents. Fix any mismatch immediately; do not defer.

- [ ] **Step 6: Final commit (if Steps 1-5 required any fixes)**

```bash
git add -A
git commit -m "Full verification pass for Aplikasi Driver"
```

If no fixes were needed, skip this step — there's nothing to commit.
