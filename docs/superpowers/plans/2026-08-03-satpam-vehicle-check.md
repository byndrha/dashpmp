# Satpam Role & Vehicle Gate-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Satpam" role (MKEsindo-only, Pengiriman-module-only) that can record a
camera-verified vehicle inspection (6 photos + odometer + fuel level) each time a
Terbit Jadwal's vehicle leaves ("Cek Berangkat") and returns ("Cek Datang") through
the factory gate, inside the existing Validasi Rute dialog — with Cek Datang's
timestamp becoming the real "Kembali ke Pabrik" arrival time on the board.

**Architecture:** New MSSQL tables (`DashboardVehicleCheck` header +
`DashboardVehicleCheckPhoto` detail, one row per photo) alongside the existing
Pengiriman schema; a new Postgres `peran.is_satpam` boolean flag threaded through
the JWT session exactly like `isSuperAdmin` already is; a new query module
(`vehicle-check.ts`), one new upload route, two new server actions on the existing
`delivery/actions.ts`, and two new client components wired into the existing
`RouteValidationDialog`. The board's "Kembali ke Pabrik" marker gets one new
nullable field sourced from the new table, falling back to today's estimate when
absent — purely additive, no existing behavior changes when no check exists.

**Tech Stack:** Next.js Server Components/Actions, `mssql` (MKEsindo's own DB via
`getPool()`), `pg` (Postgres `peran` table via `getPgPool()`), NextAuth JWT
sessions, plain `<input type="file" capture>` for camera capture (no new
dependency).

## Global Constraints

- No test framework exists in this project — verification is `npx eslint <files>`,
  `npm run build`, and live checks against real data via throwaway `npx tsx`
  scripts (deleted after use) or the browser.
- This feature is MKEsindo-only — never touch `getPmputraPool`, any `*-pmputra.ts`
  file, or PT Prima Maesa Putra's schema/pages.
- All new MSSQL access goes through `getPool()` from `@/lib/db` (MKEsindo's
  connection) — this is existing-schema work, not a new company.
- All new Postgres access goes through `getPgPool()` from `@/lib/pg`, matching
  `akun.ts`'s existing convention exactly (parameterized `$1`/`$2`/... placeholders,
  not named params).
- A Satpam check is immutable once created: no update/delete action is ever built
  for `DashboardVehicleCheck`/`DashboardVehicleCheckPhoto` — the DB `UNIQUE
  (JadwalID, Tipe)` constraint is the real enforcement, application code never
  attempts a second insert for the same pair.
- `session.user.isSatpam` gates the create action — deliberately **not**
  bypassable by `isSuperAdmin`, unlike every other permission check in this app.
- Money/precision is not relevant to this plan — no financial values are involved.

---

## Task 0: DDL — `peran.is_satpam` column + 2 new MSSQL tables

**Files:**
- Create (temporary, deleted at the end of this task):
  `scripts/migrate-satpam-vehicle-check-schema.ts`

**Interfaces:**
- Produces (for later tasks): Postgres `peran.is_satpam` (`BOOLEAN NOT NULL DEFAULT
  false`); MSSQL `DashboardVehicleCheck(VehicleCheckID, JadwalID, Tipe,
  OdometerKM, FuelLevel, CheckedByUserID, CheckedAt)` and
  `DashboardVehicleCheckPhoto(VehicleCheckPhotoID, VehicleCheckID, JenisFoto,
  FilePath, CreatedAt)`.

- [ ] **Step 1: Write the DDL script**

```ts
// scripts/migrate-satpam-vehicle-check-schema.ts
// One-off DDL for the Satpam vehicle gate-check feature — adds peran.is_satpam
// (Postgres) and creates DashboardVehicleCheck / DashboardVehicleCheckPhoto
// (MKEsindo's MSSQL). Run once, then delete this file (same convention as
// every other one-off DDL script in this project).
//
// Usage: npx tsx scripts/migrate-satpam-vehicle-check-schema.ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";
import { getPgPool } from "../src/lib/pg";

async function migratePostgres() {
  const pool = getPgPool();
  const col = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'peran' AND column_name = 'is_satpam'
  `);
  if (col.rows.length === 0) {
    await pool.query(`ALTER TABLE peran ADD COLUMN is_satpam BOOLEAN NOT NULL DEFAULT false`);
    console.log("Added peran.is_satpam.");
  } else {
    console.log("peran.is_satpam already exists.");
  }
}

async function migrateMssql() {
  const pool = await getPool();

  const existing = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME IN ('DashboardVehicleCheck', 'DashboardVehicleCheckPhoto')
  `);
  const existingNames = new Set((existing.recordset as { TABLE_NAME: string }[]).map((r) => r.TABLE_NAME));

  if (!existingNames.has("DashboardVehicleCheck")) {
    await pool.request().query(`
      CREATE TABLE DashboardVehicleCheck (
        VehicleCheckID INT IDENTITY PRIMARY KEY,
        JadwalID INT NOT NULL REFERENCES DashboardPengirimanJadwal(JadwalID),
        Tipe VARCHAR(10) NOT NULL CHECK (Tipe IN ('BERANGKAT','DATANG')),
        OdometerKM INT NOT NULL,
        FuelLevel VARCHAR(4) NOT NULL,
        CheckedByUserID VARCHAR(16) NOT NULL,
        CheckedAt DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_VehicleCheck_JadwalTipe UNIQUE (JadwalID, Tipe)
      )
    `);
    console.log("Created DashboardVehicleCheck.");
  } else {
    console.log("DashboardVehicleCheck already exists.");
  }

  if (!existingNames.has("DashboardVehicleCheckPhoto")) {
    await pool.request().query(`
      CREATE TABLE DashboardVehicleCheckPhoto (
        VehicleCheckPhotoID INT IDENTITY PRIMARY KEY,
        VehicleCheckID INT NOT NULL REFERENCES DashboardVehicleCheck(VehicleCheckID),
        JenisFoto VARCHAR(16) NOT NULL CHECK (JenisFoto IN
          ('DEPAN','SAMPING_KANAN','SAMPING_KIRI','BELAKANG','BOX_MUATAN','KABIN')),
        FilePath VARCHAR(256) NOT NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_VehicleCheckPhoto_CheckJenis UNIQUE (VehicleCheckID, JenisFoto)
      )
    `);
    console.log("Created DashboardVehicleCheckPhoto.");
  } else {
    console.log("DashboardVehicleCheckPhoto already exists.");
  }
}

async function main() {
  await migratePostgres();
  await migrateMssql();
  process.exit(0);
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/migrate-satpam-vehicle-check-schema.ts`
Expected: "Added peran.is_satpam." (or "already exists"), "Created
DashboardVehicleCheck.", "Created DashboardVehicleCheckPhoto." (or "already
exists" for each), exit code 0.

- [ ] **Step 3: Verify against live data**

Run this ad hoc (paste into a throwaway script, then discard):
```ts
import "dotenv/config";
import { getPool } from "./src/lib/db";
import { getPgPool } from "./src/lib/pg";
const pool = await getPool();
const t = await pool.request().query(`
  SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_NAME IN ('DashboardVehicleCheck','DashboardVehicleCheckPhoto')
`);
console.log(t.recordset);
const pg = getPgPool();
const c = await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name='peran' AND column_name='is_satpam'`);
console.log(c.rows);
process.exit(0);
```
Expected: 2 table rows + 1 column row.

- [ ] **Step 4: Delete the script and commit**

```bash
rm scripts/migrate-satpam-vehicle-check-schema.ts
git status
```
Expected: nothing to commit for this task (schema changes live in the databases,
not git) — confirm working tree is clean before moving to Task 1.

---

## Task 1: Wire `isSatpam` through the auth session

**Files:**
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/queries/akun.ts` (`AkunAuthRow`, `findAkunByUsername`)

**Interfaces:**
- Produces: `session.user.isSatpam: boolean`, available in every server
  component/action/route after this task, exactly like `session.user.isSuperAdmin`
  already is.

- [ ] **Step 1: Add `isSatpam` to `AkunAuthRow` and `findAkunByUsername`**

In `src/lib/queries/akun.ts`, update the interface (currently lines 10-22):
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
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}
```

Update `findAkunByUsername` (currently lines 24-51) — add `is_satpam` to the SELECT
and the mapped return object:
```ts
export async function findAkunByUsername(username: string): Promise<AkunAuthRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT a.id, a.username, a.password_hash, a.nama, a.peran_id, a.perusahaan_id, p.kode AS perusahaan_kode,
            COALESCE(r.is_super_admin, false) AS is_super_admin,
            COALESCE(r.is_satpam, false) AS is_satpam,
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
    isActive: row.is_active,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
  };
}
```
(Only the SELECT columns and the returned object gain the two new
`is_satpam`/`isSatpam` lines — everything else in the function is unchanged.)

- [ ] **Step 2: Thread `isSatpam` through `auth.ts`**

In `src/lib/auth.ts`, update `AuthorizedUser` (currently lines 14-23):
```ts
interface AuthorizedUser {
  id: string;
  name: string;
  username: string;
  roleId: number;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  permissions: ReturnType<typeof fullPermissionMap>;
  accountScope: AccountScope;
  perusahaanId: number | null;
}
```

Update the `user` object construction inside `authorize()` (currently lines
69-78) — add one line:
```ts
        const user: AuthorizedUser = {
          id: String(row.id),
          name: row.nama,
          username: row.username,
          roleId: row.peranId ?? 0,
          isSuperAdmin: row.isSuperAdmin,
          isSatpam: row.isSatpam,
          permissions,
          accountScope: (row.perusahaanKode ?? "direktur") as AccountScope,
          perusahaanId: row.perusahaanId,
        };
```

Update the `jwt` callback (currently lines 84-96) — add one line inside the `if
(user)` block:
```ts
    async jwt({ token, user }) {
      if (user) {
        const u = user as AuthorizedUser;
        token.id = u.id;
        token.username = u.username;
        token.roleId = u.roleId;
        token.isSuperAdmin = u.isSuperAdmin;
        token.isSatpam = u.isSatpam;
        token.permissions = u.permissions;
        token.accountScope = u.accountScope;
        token.perusahaanId = u.perusahaanId;
      }
      return token;
    },
```

Update the `session` callback (currently lines 97-109) — add one line inside the
`if (session.user)` block:
```ts
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.roleId = token.roleId as number;
        session.user.isSuperAdmin = token.isSuperAdmin as boolean;
        session.user.isSatpam = token.isSatpam as boolean;
        session.user.permissions = token.permissions as ReturnType<typeof fullPermissionMap>;
        session.user.accountScope = token.accountScope as AccountScope;
        session.user.perusahaanId = token.perusahaanId as number | null;
      }
      return session;
    },
```

- [ ] **Step 3: Extend the NextAuth type declarations**

In `src/types/next-auth.d.ts`, add `isSatpam: boolean;` to all three interfaces
(`Session.user`, `User`, `JWT` — currently lines 9-42):
```ts
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      roleId: number;
      isSuperAdmin: boolean;
      isSatpam: boolean;
      permissions: PermissionMap;
      accountScope: AccountScope;
      perusahaanId: number | null;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    roleId: number;
    isSuperAdmin: boolean;
    isSatpam: boolean;
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
    permissions: PermissionMap;
    accountScope: AccountScope;
    perusahaanId: number | null;
  }
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx eslint src/lib/queries/akun.ts src/lib/auth.ts src/types/next-auth.d.ts`
Expected: no output (clean).
Run: `npx tsc --noEmit`
Expected: 0 errors (this is the strongest check here — a missing `isSatpam` on any
of the 3 interfaces or the 2 callbacks would surface as a type error somewhere in
this 3-file chain).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/akun.ts src/lib/auth.ts src/types/next-auth.d.ts
git commit -m "Thread isSatpam through the auth session, mirroring isSuperAdmin"
```

---

## Task 2: Peran editor — `is_satpam` toggle

**Files:**
- Modify: `src/lib/queries/akun.ts` (`PeranRow`, `listAllPeran`, new
  `setPeranSatpam`)
- Modify: `src/app/grup/akun/peran/actions.ts` (new `setPeranSatpamAction`)
- Modify: `src/components/dashboard/peran-editor.tsx`

**Interfaces:**
- Consumes: `requireGrupAccess` from `src/lib/require-access.ts` (already used by
  every other action in `peran/actions.ts`).
- Produces: `setPeranSatpam(peranId: number, isSatpam: boolean): Promise<void>`,
  `setPeranSatpamAction(peranId: number, isSatpam: boolean): Promise<void>`.

- [ ] **Step 1: Add `isSatpam` to `PeranRow` and `listAllPeran`**

In `src/lib/queries/akun.ts`, update `PeranRow` (currently lines 274-280):
```ts
export interface PeranRow {
  id: number;
  perusahaanId: number;
  nama: string;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  akunCount: number;
}
```

Update `listAllPeran` (currently lines 282-297):
```ts
export async function listAllPeran(): Promise<PeranRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT r.id, r.perusahaan_id, r.nama, r.is_super_admin, r.is_satpam,
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
    akunCount: Number(row.akun_count),
  }));
}
```

- [ ] **Step 2: Add `setPeranSatpam`**

Append to `src/lib/queries/akun.ts`, right after `setPeranIzin` (find it via `grep
-n "export async function setPeranIzin" src/lib/queries/akun.ts` if the line
number has drifted):
```ts
export async function setPeranSatpam(peranId: number, isSatpam: boolean): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE peran SET is_satpam = $1 WHERE id = $2`, [isSatpam, peranId]);
}
```

- [ ] **Step 3: Add the server action**

In `src/app/grup/akun/peran/actions.ts`, add the import and the new action:
```ts
import { createPeran, deletePeran, setPeranIzin, setPeranSatpam, listAllPeran } from "@/lib/queries/akun";
```
```ts
export async function setPeranSatpamAction(peranId: number, isSatpam: boolean) {
  await requireGrupAccess();
  await setPeranSatpam(peranId, isSatpam);
  revalidatePath("/grup/akun/peran");
}
```

- [ ] **Step 4: Add the checkbox to `RoleCard`**

In `src/components/dashboard/peran-editor.tsx`:

Add the import:
```ts
import { createPeranAction, deletePeranAction, setPeranIzinAction, setPeranSatpamAction } from "@/app/grup/akun/peran/actions";
```

`RoleCard` (currently lines 24-116) gains local `isSatpam` state, includes it in
the dirty-tracking save flow, and renders one checkbox. Replace the function:
```tsx
function RoleCard({ peran, initialMap }: { peran: PeranRow; initialMap: PermissionMap }) {
  const [map, setMap] = useState(initialMap);
  const [isSatpam, setIsSatpam] = useState(peran.isSatpam);
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

  function toggleSatpam() {
    setIsSatpam((prev) => !prev);
    setDirty(true);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await Promise.all([
          ...MODULE_KEYS.map((key) =>
            setPeranIzinAction({
              peranId: peran.id,
              moduleKey: key,
              canView: map[key]?.canView ?? false,
              canEdit: map[key]?.canEdit ?? false,
            })
          ),
          setPeranSatpamAction(peran.id, isSatpam),
        ]);
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
        <label className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
          <input type="checkbox" className="accent-primary" checked={isSatpam} onChange={toggleSatpam} />
          <span>
            Peran Khusus: Satpam
            <span className="block text-muted-foreground">
              Hanya akun dengan peran ini yang bisa mengisi Cek Berangkat/Cek Datang di Validasi Rute.
            </span>
          </span>
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-fit" disabled={pending || !dirty} onClick={handleSave}>
          {pending ? "Menyimpan..." : "Simpan Otoritas"}
        </Button>
      </CardContent>
    </Card>
  );
}
```
(Everything outside `RoleCard` in this file — `buildMap`, `CreatePeranDialog`,
`PeranEditor` — is unchanged.)

- [ ] **Step 5: Typecheck, lint, build**

```bash
npx eslint src/lib/queries/akun.ts "src/app/grup/akun/peran/actions.ts" src/components/dashboard/peran-editor.tsx
npm run build
```
Expected: both clean.

- [ ] **Step 6: Manually verify**

Start the dev server, log in as a Direktur/superadmin, go to `/grup/akun/peran`,
create a test role "Satpam Test", enable only the Pengiriman module's "Lihat"
checkbox and the new "Peran Khusus: Satpam" checkbox, click "Simpan Otoritas".
Reload the page and confirm both the module grid and the Satpam checkbox still
show as saved (not reset to unchecked).

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/akun.ts "src/app/grup/akun/peran/actions.ts" src/components/dashboard/peran-editor.tsx
git commit -m "Add is_satpam toggle to the Peran editor"
```

---

## Task 3: Query layer — `vehicle-check.ts`

**Files:**
- Create: `src/lib/queries/vehicle-check.ts`

**Interfaces:**
- Consumes: `getPool`, `sql` from `@/lib/db`.
- Produces: `VehicleCheckTipe` (`"BERANGKAT" | "DATANG"`), `FuelLevel` (`"E" |
  "1/4" | "1/2" | "3/4" | "F"`), `JenisFotoKendaraan` (the 6-value union),
  `VehicleCheckPhoto { jenisFoto: JenisFotoKendaraan; filePath: string }`,
  `VehicleCheckRow { vehicleCheckId: number; jadwalId: number; tipe:
  VehicleCheckTipe; odometerKM: number; fuelLevel: FuelLevel; checkedByUserId:
  string; checkedAt: string; photos: VehicleCheckPhoto[] }`,
  `getVehicleChecksForJadwal(jadwalId: number): Promise<VehicleCheckRow[]>`,
  `createVehicleCheck(input: { jadwalId: number; tipe: VehicleCheckTipe;
  odometerKM: number; fuelLevel: FuelLevel; userId: string; photos:
  VehicleCheckPhoto[] }): Promise<void>`, `getJamKembaliAktualMap(jadwalIds:
  number[]): Promise<Map<number, string>>`.

- [ ] **Step 1: Write the query module**

```ts
// src/lib/queries/vehicle-check.ts
import { getPool, sql } from "@/lib/db";

export type VehicleCheckTipe = "BERANGKAT" | "DATANG";
export type FuelLevel = "E" | "1/4" | "1/2" | "3/4" | "F";
export type JenisFotoKendaraan =
  | "DEPAN"
  | "SAMPING_KANAN"
  | "SAMPING_KIRI"
  | "BELAKANG"
  | "BOX_MUATAN"
  | "KABIN";

export const JENIS_FOTO_LIST: JenisFotoKendaraan[] = [
  "DEPAN",
  "SAMPING_KANAN",
  "SAMPING_KIRI",
  "BELAKANG",
  "BOX_MUATAN",
  "KABIN",
];

export const JENIS_FOTO_LABEL: Record<JenisFotoKendaraan, string> = {
  DEPAN: "Depan",
  SAMPING_KANAN: "Samping Kanan",
  SAMPING_KIRI: "Samping Kiri",
  BELAKANG: "Belakang",
  BOX_MUATAN: "Box Muatan",
  KABIN: "Kabin (Area Speedometer)",
};

export interface VehicleCheckPhoto {
  jenisFoto: JenisFotoKendaraan;
  filePath: string;
}

export interface VehicleCheckRow {
  vehicleCheckId: number;
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelLevel: FuelLevel;
  checkedByUserId: string;
  checkedAt: string;
  photos: VehicleCheckPhoto[];
}

export async function getVehicleChecksForJadwal(jadwalId: number): Promise<VehicleCheckRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`
      SELECT vc.VehicleCheckID, vc.JadwalID, vc.Tipe, vc.OdometerKM, vc.FuelLevel,
             vc.CheckedByUserID, vc.CheckedAt,
             p.JenisFoto, p.FilePath
      FROM DashboardVehicleCheck vc
      LEFT JOIN DashboardVehicleCheckPhoto p ON p.VehicleCheckID = vc.VehicleCheckID
      WHERE vc.JadwalID = @jadwalId
      ORDER BY vc.Tipe, p.JenisFoto
    `);

  const rows = result.recordset as {
    VehicleCheckID: number;
    JadwalID: number;
    Tipe: VehicleCheckTipe;
    OdometerKM: number;
    FuelLevel: FuelLevel;
    CheckedByUserID: string;
    CheckedAt: Date;
    JenisFoto: JenisFotoKendaraan | null;
    FilePath: string | null;
  }[];

  const byId = new Map<number, VehicleCheckRow>();
  for (const r of rows) {
    let entry = byId.get(r.VehicleCheckID);
    if (!entry) {
      entry = {
        vehicleCheckId: r.VehicleCheckID,
        jadwalId: r.JadwalID,
        tipe: r.Tipe,
        odometerKM: r.OdometerKM,
        fuelLevel: r.FuelLevel,
        checkedByUserId: r.CheckedByUserID,
        checkedAt: r.CheckedAt.toISOString(),
        photos: [],
      };
      byId.set(r.VehicleCheckID, entry);
    }
    if (r.JenisFoto && r.FilePath) {
      entry.photos.push({ jenisFoto: r.JenisFoto, filePath: r.FilePath });
    }
  }
  return [...byId.values()];
}

export async function createVehicleCheck(input: {
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelLevel: FuelLevel;
  userId: string;
  photos: VehicleCheckPhoto[];
}): Promise<void> {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input("jadwalId", sql.Int, input.jadwalId)
    .input("tipe", sql.VarChar(10), input.tipe)
    .query(`SELECT VehicleCheckID FROM DashboardVehicleCheck WHERE JadwalID = @jadwalId AND Tipe = @tipe`);
  if (existing.recordset.length > 0) {
    throw new Error(
      input.tipe === "BERANGKAT"
        ? "Cek Berangkat untuk keberangkatan ini sudah pernah diisi."
        : "Cek Datang untuk keberangkatan ini sudah pernah diisi."
    );
  }

  const header = await pool
    .request()
    .input("jadwalId", sql.Int, input.jadwalId)
    .input("tipe", sql.VarChar(10), input.tipe)
    .input("odometerKM", sql.Int, input.odometerKM)
    .input("fuelLevel", sql.VarChar(4), input.fuelLevel)
    .input("userId", sql.VarChar(16), input.userId).query(`
      INSERT INTO DashboardVehicleCheck (JadwalID, Tipe, OdometerKM, FuelLevel, CheckedByUserID)
      OUTPUT INSERTED.VehicleCheckID
      VALUES (@jadwalId, @tipe, @odometerKM, @fuelLevel, @userId)
    `);
  const vehicleCheckId = (header.recordset[0] as { VehicleCheckID: number }).VehicleCheckID;

  for (const photo of input.photos) {
    await pool
      .request()
      .input("vehicleCheckId", sql.Int, vehicleCheckId)
      .input("jenisFoto", sql.VarChar(16), photo.jenisFoto)
      .input("filePath", sql.VarChar(256), photo.filePath).query(`
        INSERT INTO DashboardVehicleCheckPhoto (VehicleCheckID, JenisFoto, FilePath)
        VALUES (@vehicleCheckId, @jenisFoto, @filePath)
      `);
  }
}

// Bulk lookup for the Papan Pengiriman board — one DATANG CheckedAt per
// JadwalID, used to replace the estimated "Kembali ke Pabrik" marker with a
// real timestamp when a Satpam has actually recorded the vehicle's return.
export async function getJamKembaliAktualMap(jadwalIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (jadwalIds.length === 0) return map;

  const pool = await getPool();
  const request = pool.request();
  const inClause = jadwalIds.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const result = await request.query(`
    SELECT JadwalID, CheckedAt FROM DashboardVehicleCheck
    WHERE Tipe = 'DATANG' AND JadwalID IN (${inClause.join(", ")})
  `);
  for (const r of result.recordset as { JadwalID: number; CheckedAt: Date }[]) {
    map.set(r.JadwalID, r.CheckedAt.toISOString());
  }
  return map;
}
```

- [ ] **Step 2: Verify against live data**

Write a throwaway script, run it, then delete it. Use a real `JadwalID` from a
Terbit Jadwal you can find via `SELECT TOP 1 JadwalID FROM
DashboardPengirimanJadwal WHERE Status='Terbit'` (or query it inline):
```ts
// scratchpad_verify_vehicle_check.ts
import "dotenv/config";
import { getPool, sql } from "./src/lib/db";
import { createVehicleCheck, getVehicleChecksForJadwal, getJamKembaliAktualMap } from "./src/lib/queries/vehicle-check";

async function main() {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT TOP 1 JadwalID FROM DashboardPengirimanJadwal WHERE Status='Terbit'`);
  const jadwalId = (r.recordset[0] as { JadwalID: number } | undefined)?.JadwalID;
  if (!jadwalId) {
    console.log("No Terbit Jadwal found to test against — skipping.");
    process.exit(0);
  }
  console.log("Testing against JadwalID", jadwalId);

  await createVehicleCheck({
    jadwalId,
    tipe: "DATANG",
    odometerKM: 12345,
    fuelLevel: "3/4",
    userId: "test",
    photos: [
      { jenisFoto: "DEPAN", filePath: "/uploads/satpam-check/test/depan.jpg" },
      { jenisFoto: "SAMPING_KANAN", filePath: "/uploads/satpam-check/test/kanan.jpg" },
      { jenisFoto: "SAMPING_KIRI", filePath: "/uploads/satpam-check/test/kiri.jpg" },
      { jenisFoto: "BELAKANG", filePath: "/uploads/satpam-check/test/belakang.jpg" },
      { jenisFoto: "BOX_MUATAN", filePath: "/uploads/satpam-check/test/box.jpg" },
      { jenisFoto: "KABIN", filePath: "/uploads/satpam-check/test/kabin.jpg" },
    ],
  });

  const checks = await getVehicleChecksForJadwal(jadwalId);
  console.log("Checks:", JSON.stringify(checks, null, 1));

  const map = await getJamKembaliAktualMap([jadwalId]);
  console.log("JamKembaliAktual:", map.get(jadwalId));

  // Duplicate insert must throw
  try {
    await createVehicleCheck({
      jadwalId,
      tipe: "DATANG",
      odometerKM: 1,
      fuelLevel: "E",
      userId: "test",
      photos: [],
    });
    console.error("FAIL: duplicate insert did not throw");
  } catch (e) {
    console.log("OK: duplicate insert threw:", (e as Error).message);
  }

  // Clean up the test rows.
  const check = checks.find((c) => c.tipe === "DATANG");
  if (check) {
    await pool.request().input("id", sql.Int, check.vehicleCheckId).query(`
      DELETE FROM DashboardVehicleCheckPhoto WHERE VehicleCheckID = @id;
      DELETE FROM DashboardVehicleCheck WHERE VehicleCheckID = @id;
    `);
    console.log("Cleaned up test rows.");
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```
Run: `npx tsx scratchpad_verify_vehicle_check.ts`
Expected: `checks` contains 1 row with 6 photos, `JamKembaliAktual` prints a real
ISO timestamp, the duplicate-insert attempt throws with the expected Indonesian
message, and the cleanup log line prints (confirm afterward via a fresh
`getVehicleChecksForJadwal` call, or just trust the DELETE — either way, no test
row should remain).
Then: `rm scratchpad_verify_vehicle_check.ts`

- [ ] **Step 3: Typecheck and lint**

Run: `npx eslint src/lib/queries/vehicle-check.ts`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/vehicle-check.ts
git commit -m "Add vehicle-check query module (DashboardVehicleCheck/Photo)"
```

---

## Task 4: Upload endpoint — `/api/upload/satpam-check`

**Files:**
- Create: `src/app/api/upload/satpam-check/route.ts`

**Interfaces:**
- Consumes: `requireModuleAccess` from `@/lib/require-access`, `auth` from
  `@/lib/auth`.
- Produces: `POST /api/upload/satpam-check` — accepts `multipart/form-data` with
  fields `file`, `armadaId`, `jenisFoto`; returns `{ path: string }` on success.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/upload/satpam-check/route.ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireModuleAccess } from "@/lib/require-access";
import { auth } from "@/lib/auth";
import { JENIS_FOTO_LIST, type JenisFotoKendaraan } from "@/lib/queries/vehicle-check";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  await requireModuleAccess("delivery");

  // Evidentiary gate-check photos — checked independently of the page-level
  // module gate above, deliberately NOT bypassed by isSuperAdmin. See
  // docs/superpowers/specs/2026-08-03-satpam-vehicle-check-design.md.
  const session = await auth();
  if (!session?.user?.isSatpam) {
    return NextResponse.json({ error: "Hanya Satpam yang dapat mengunggah foto ini." }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const armadaId = formData.get("armadaId");
  const jenisFoto = formData.get("jenisFoto");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (typeof armadaId !== "string" || !armadaId.trim()) {
    return NextResponse.json({ error: "armadaId wajib diisi" }, { status: 400 });
  }
  if (typeof jenisFoto !== "string" || !JENIS_FOTO_LIST.includes(jenisFoto as JenisFotoKendaraan)) {
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
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("") + "-" + [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const fileName = `${stamp}-${jenisFoto}.${ext}`;
  const safeArmadaId = armadaId.replace(/[^a-zA-Z0-9_-]/g, "");
  const uploadDir = path.join(process.cwd(), "public", "uploads", "satpam-check", safeArmadaId);

  try {
    await mkdir(uploadDir, { recursive: true });
    const bytes = await file.arrayBuffer();
    await writeFile(path.join(uploadDir, fileName), Buffer.from(bytes));
  } catch {
    return NextResponse.json({ error: "Gagal menyimpan foto" }, { status: 500 });
  }

  return NextResponse.json({ path: `/uploads/satpam-check/${safeArmadaId}/${fileName}` });
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx eslint src/app/api/upload/satpam-check/route.ts`
Expected: no output (clean).
Run: `npm run build`
Expected: succeeds, new route appears in the build's route table.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/upload/satpam-check/route.ts
git commit -m "Add /api/upload/satpam-check upload endpoint"
```

---

## Task 5: Server actions — `getVehicleChecksForJadwalAction` / `createVehicleCheckAction`

**Files:**
- Modify: `src/app/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: `getVehicleChecksForJadwal`, `createVehicleCheck`,
  `VehicleCheckRow`, `VehicleCheckTipe`, `FuelLevel`, `VehicleCheckPhoto` from
  `@/lib/queries/vehicle-check`; `auth` from `@/lib/auth`.
- Produces: `getVehicleChecksForJadwalAction(jadwalId: number):
  Promise<VehicleCheckRow[]>`, `createVehicleCheckAction(input: { jadwalId:
  number; tipe: VehicleCheckTipe; odometerKM: number; fuelLevel: FuelLevel;
  photos: VehicleCheckPhoto[] }): Promise<void>`.

- [ ] **Step 1: Add the two actions**

Add the import at the top of `src/app/(dashboard)/delivery/actions.ts` (alongside
the existing imports):
```ts
import { auth } from "@/lib/auth";
import {
  getVehicleChecksForJadwal,
  createVehicleCheck,
  type VehicleCheckRow,
  type VehicleCheckTipe,
  type FuelLevel,
  type VehicleCheckPhoto,
} from "@/lib/queries/vehicle-check";
```

Append the two actions to the end of the file:
```ts
export async function getVehicleChecksForJadwalAction(jadwalId: number): Promise<VehicleCheckRow[]> {
  await requireModuleAccess("delivery");
  return getVehicleChecksForJadwal(jadwalId);
}

export async function createVehicleCheckAction(input: {
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelLevel: FuelLevel;
  photos: VehicleCheckPhoto[];
}): Promise<void> {
  const session = await requireModuleAccess("delivery");
  // Deliberately NOT bypassed by isSuperAdmin — see the design spec's "Deliberately
  // not bypassed by isSuperAdmin" note. A gate-check record is a physical-presence
  // claim, not a general permission.
  if (!session.user.isSatpam) {
    throw new Error("Hanya Satpam yang dapat mengisi Cek Berangkat/Cek Datang.");
  }
  if (input.photos.length !== 6) {
    throw new Error("Semua 6 foto kendaraan wajib diisi.");
  }
  if (!(input.odometerKM > 0)) {
    throw new Error("Odometer wajib diisi dengan angka yang valid.");
  }
  await createVehicleCheck({ ...input, userId: session.user.id });
  revalidatePath("/delivery");
}
```
(`requireModuleAccess("delivery")` already returns the `session` object — same
pattern as `requirePmputra()` elsewhere in this codebase — so no separate `auth()`
call is needed in `createVehicleCheckAction` for the session read; the `auth`
import above is unused if you follow this exact shape — **remove the unused `auth`
import** before committing, keeping only the `vehicle-check` import block.)

- [ ] **Step 2: Typecheck and lint**

Run: `npx eslint "src/app/(dashboard)/delivery/actions.ts"`
Expected: no output (clean) — this also catches the unused-import issue flagged
above if it wasn't already removed.
Run: `npm run build`
Expected: succeeds (confirms the imported `vehicle-check.ts` names/signatures match
exactly).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/delivery/actions.ts"
git commit -m "Add server actions for Satpam vehicle gate-check"
```

---

## Task 6: `CameraCaptureField` component

**Files:**
- Create: `src/components/dashboard/camera-capture-field.tsx`

**Interfaces:**
- Produces: `CameraCaptureField({ label, onCapture, disabled }: { label: string;
  onCapture: (file: File) => void; disabled?: boolean })` — a single
  camera-capture slot with thumbnail preview.

- [ ] **Step 1: Write the component**

```tsx
// src/components/dashboard/camera-capture-field.tsx
"use client";

import { useRef, useState } from "react";
import { Camera, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CameraCaptureField({
  label,
  onCapture,
  disabled,
}: {
  label: string;
  onCapture: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    onCapture(file);
    // Allow re-capturing the same slot (browsers won't fire `change` again for
    // an identical file path otherwise).
    e.target.value = "";
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors",
        previewUrl ? "border-primary bg-primary/5" : "border-dashed border-border",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={handleChange}
        className="hidden"
      />
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static asset next/image can optimize
        <img src={previewUrl} alt={label} className="h-16 w-full rounded object-cover" />
      ) : (
        <div className="flex h-16 w-full items-center justify-center rounded bg-muted/50">
          <Camera className="size-5 text-muted-foreground" />
        </div>
      )}
      <span className="flex items-center gap-1 text-center leading-tight">
        {previewUrl && <Check className="size-3 shrink-0 text-primary" />}
        {label}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint src/components/dashboard/camera-capture-field.tsx`
Expected: no output. (This component has no server dependency of its own to test
in isolation beyond compiling — full behavior verification happens in Task 8's
live browser check, once it's wired into the real page.)

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/camera-capture-field.tsx
git commit -m "Add CameraCaptureField component for Satpam photo capture"
```

---

## Task 7: `VehicleCheckPanel` component

**Files:**
- Create: `src/components/dashboard/vehicle-check-panel.tsx`

**Interfaces:**
- Consumes: `VehicleCheckRow`, `VehicleCheckTipe`, `FuelLevel`,
  `JENIS_FOTO_LIST`, `JENIS_FOTO_LABEL` from `@/lib/queries/vehicle-check`;
  `CameraCaptureField` from Task 6.
- Produces: `VehicleCheckPanel({ jadwalId, armadaId, isSatpam, onUploadPhoto,
  onSubmitCheck, checks }: { jadwalId: number; armadaId: number; isSatpam:
  boolean; onUploadPhoto: (file: File, jenisFoto: JenisFotoKendaraan) =>
  Promise<string>; onSubmitCheck: (input: { tipe: VehicleCheckTipe; odometerKM:
  number; fuelLevel: FuelLevel; photos: VehicleCheckPhoto[] }) => Promise<void>;
  checks: VehicleCheckRow[] })`.

- [ ] **Step 1: Write the component**

```tsx
// src/components/dashboard/vehicle-check-panel.tsx
"use client";

import { useState, useTransition } from "react";
import { Gauge, Fuel, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CameraCaptureField } from "@/components/dashboard/camera-capture-field";
import { formatTime } from "@/lib/format";
import {
  JENIS_FOTO_LIST,
  JENIS_FOTO_LABEL,
  type VehicleCheckRow,
  type VehicleCheckTipe,
  type FuelLevel,
  type VehicleCheckPhoto,
  type JenisFotoKendaraan,
} from "@/lib/queries/vehicle-check";

const FUEL_LEVELS: FuelLevel[] = ["E", "1/4", "1/2", "3/4", "F"];
const TIPE_LABEL: Record<VehicleCheckTipe, string> = { BERANGKAT: "Cek Berangkat", DATANG: "Cek Datang" };

function CheckSummary({ check }: { check: VehicleCheckRow }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">{TIPE_LABEL[check.tipe]}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3" />
          {formatTime(check.checkedAt)}
        </span>
      </div>
      <div className="flex gap-4 text-muted-foreground">
        <span className="flex items-center gap-1">
          <Gauge className="size-3" />
          {check.odometerKM.toLocaleString("id-ID")} KM
        </span>
        <span className="flex items-center gap-1">
          <Fuel className="size-3" />
          {check.fuelLevel}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {check.photos.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset
          <img key={p.jenisFoto} src={p.filePath} alt={JENIS_FOTO_LABEL[p.jenisFoto]} className="h-14 w-full rounded object-cover" />
        ))}
      </div>
    </div>
  );
}

function CheckForm({
  tipe,
  armadaId,
  onUploadPhoto,
  onSubmitCheck,
}: {
  tipe: VehicleCheckTipe;
  armadaId: number;
  onUploadPhoto: (file: File, jenisFoto: JenisFotoKendaraan) => Promise<string>;
  onSubmitCheck: (input: { tipe: VehicleCheckTipe; odometerKM: number; fuelLevel: FuelLevel; photos: VehicleCheckPhoto[] }) => Promise<void>;
}) {
  const [photos, setPhotos] = useState<Partial<Record<JenisFotoKendaraan, string>>>({});
  const [uploading, setUploading] = useState<JenisFotoKendaraan | null>(null);
  const [odometerKM, setOdometerKM] = useState("");
  const [fuelLevel, setFuelLevel] = useState<FuelLevel>("1/2");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleCapture(file: File, jenisFoto: JenisFotoKendaraan) {
    setError(null);
    setUploading(jenisFoto);
    try {
      const path = await onUploadPhoto(file, jenisFoto);
      setPhotos((prev) => ({ ...prev, [jenisFoto]: path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setUploading(null);
    }
  }

  const allPhotosReady = JENIS_FOTO_LIST.every((j) => photos[j] != null);
  const canSubmit = allPhotosReady && Number(odometerKM) > 0 && !pending;

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await onSubmitCheck({
          tipe,
          odometerKM: Number(odometerKM),
          fuelLevel,
          photos: JENIS_FOTO_LIST.map((jenisFoto) => ({ jenisFoto, filePath: photos[jenisFoto] as string })),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan cek kendaraan.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-xs font-medium">{TIPE_LABEL[tipe]}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {JENIS_FOTO_LIST.map((jenisFoto) => (
          <CameraCaptureField
            key={jenisFoto}
            label={JENIS_FOTO_LABEL[jenisFoto]}
            disabled={uploading != null || pending}
            onCapture={(file) => handleCapture(file, jenisFoto)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          placeholder="Odometer (KM)"
          className="w-40"
          value={odometerKM}
          onChange={(e) => setOdometerKM(e.target.value)}
        />
        <Select value={fuelLevel} onValueChange={(v) => v && setFuelLevel(v as FuelLevel)}>
          <SelectTrigger className="w-28">
            <SelectValue>{() => fuelLevel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FUEL_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          {pending ? "Menyimpan..." : `Simpan ${TIPE_LABEL[tipe]}`}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[10px] text-muted-foreground">
        Foto wajib diambil langsung dari kamera. Catatan: sebagian browser tetap menampilkan pintasan galeri di
        antarmuka kameranya sendiri — ini batasan platform, bukan sesuatu yang bisa diblokir sepenuhnya dari sisi
        web.
      </p>
    </div>
  );
}

export function VehicleCheckPanel({
  jadwalId,
  armadaId,
  isSatpam,
  onUploadPhoto,
  onSubmitCheck,
  checks,
}: {
  jadwalId: number;
  armadaId: number;
  isSatpam: boolean;
  onUploadPhoto: (file: File, jenisFoto: JenisFotoKendaraan) => Promise<string>;
  onSubmitCheck: (input: { tipe: VehicleCheckTipe; odometerKM: number; fuelLevel: FuelLevel; photos: VehicleCheckPhoto[] }) => Promise<void>;
  checks: VehicleCheckRow[];
}) {
  const berangkat = checks.find((c) => c.tipe === "BERANGKAT");
  const datang = checks.find((c) => c.tipe === "DATANG");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cek Keamanan Kendaraan</CardTitle>
        <CardDescription>Rekam kondisi kendaraan saat berangkat dan datang, khusus diisi oleh Satpam.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {berangkat ? <CheckSummary check={berangkat} /> : isSatpam ? (
          <CheckForm tipe="BERANGKAT" armadaId={armadaId} onUploadPhoto={onUploadPhoto} onSubmitCheck={onSubmitCheck} />
        ) : (
          <p className="text-xs text-muted-foreground">Belum ada Cek Berangkat.</p>
        )}

        {berangkat && (datang ? <CheckSummary check={datang} /> : isSatpam ? (
          <CheckForm tipe="DATANG" armadaId={armadaId} onUploadPhoto={onUploadPhoto} onSubmitCheck={onSubmitCheck} />
        ) : (
          <p className="text-xs text-muted-foreground">Belum ada Cek Datang.</p>
        ))}
      </CardContent>
    </Card>
  );
}
```

(`jadwalId` is accepted as a prop for interface clarity even though this component
doesn't use it directly — the caller, Task 8's `RouteValidationDialog` wiring, is
what threads it into `onUploadPhoto`/`onSubmitCheck`'s closures. `armadaId` is
passed to `CheckForm` for the same reason but isn't read inside it either in this
task — it exists so a future upload-progress UI keyed by armada doesn't need a
prop-shape change; if `npx eslint`'s `no-unused-vars` flags `armadaId` in
`CheckForm`'s destructured props, remove it from `CheckForm`'s own prop list and
stop passing it there specifically, keeping it only on `VehicleCheckPanel`'s own
signature per the Produces interface above.)

- [ ] **Step 2: Lint**

Run: `npx eslint src/components/dashboard/vehicle-check-panel.tsx`
Expected: no output. If `no-unused-vars` fires on `armadaId` inside `CheckForm`,
apply the fix described in the parenthetical above and re-run until clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/vehicle-check-panel.tsx
git commit -m "Add VehicleCheckPanel component (Cek Berangkat/Cek Datang UI)"
```

---

## Task 8: Wire `VehicleCheckPanel` into `RouteValidationDialog`

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`
- Modify: `src/components/dashboard/pengiriman-board.tsx` (pass 2 new props
  through to `RouteValidationDialog`)

**Interfaces:**
- Consumes: `VehicleCheckPanel` from Task 7; `getVehicleChecksForJadwalAction`,
  `createVehicleCheckAction` from Task 5; a client-side upload helper posting to
  `/api/upload/satpam-check`.
- Produces: `RouteValidationDialog` gains 2 new required props: `armadaId:
  number` (the open Jadwal's own ArmadaID — needed for the upload endpoint's
  `armadaId` form field) and `isSatpam: boolean` (the current session's flag,
  resolved server-side by the caller).

- [ ] **Step 1: Add state, fetch, and upload/submit handlers to `RouteValidationDialog`**

In `src/components/dashboard/route-validation-dialog.tsx`, add imports:
```ts
import { VehicleCheckPanel } from "@/components/dashboard/vehicle-check-panel";
import {
  getVehicleChecksForJadwalAction,
  createVehicleCheckAction,
} from "@/app/(dashboard)/delivery/actions";
import type {
  VehicleCheckRow,
  VehicleCheckTipe,
  FuelLevel,
  VehicleCheckPhoto,
  JenisFotoKendaraan,
} from "@/lib/queries/vehicle-check";
```

Extend the component's props (currently the destructured object starting at line
142) — add `armadaId` and `isSatpam` alongside the existing props:
```tsx
export function RouteValidationDialog({
  jadwal,
  businessDate,
  todayISO,
  drivers,
  armadaId,
  armadaNama,
  konsumsiBBM,
  kapasitasMaks,
  jenisBBM,
  biayaBBMPerLiter,
  isSatpam,
  onOpenChange,
  onDeleted,
  onEditSalesOrder,
}: {
  jadwal: JadwalCardData | null;
  businessDate: string;
  todayISO: string;
  drivers: DriverOption[];
  armadaId: number | null;
  armadaNama: string | null;
  konsumsiBBM: number | null;
  kapasitasMaks: number | null;
  jenisBBM: FuelType | null;
  biayaBBMPerLiter: number | null;
  isSatpam: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
  onEditSalesOrder: (detail: JadwalDetailRow) => void;
}) {
```
(Only `armadaId` and `isSatpam` are new — every other prop name/type is
unchanged. `armadaId` is nullable because the dialog can render with `jadwal ==
null`, same reasoning as `armadaNama` already being nullable.)

Add new state and effect alongside the existing `useState`/`useEffect` block
(near the `order`/`loading` state declared at the top of the function body):
```ts
  const [vehicleChecks, setVehicleChecks] = useState<VehicleCheckRow[]>([]);
```

Extend the existing `useEffect` that resets/fetches on `jadwalId` change (the one
currently starting `useEffect(() => { ... setAdding(false); ... }, [jadwalId]);`)
by adding one more fetch call inside it, right after the existing
`getJadwalDetailAction` call:
```ts
    if (jadwalId == null) {
      setOrder([]);
      setVehicleChecks([]);
      return;
    }
    setLoading(true);
    setError(null);
    getJadwalDetailAction(jadwalId)
      .then((rows) => {
        setOrder(rows);
      })
      .finally(() => setLoading(false));
    getVehicleChecksForJadwalAction(jadwalId).then(setVehicleChecks);
```
(This replaces the existing `if (jadwalId == null) { setOrder([]); return; }` /
`getJadwalDetailAction(...)` block with the same logic plus the two additions
shown above — `setVehicleChecks([])` on the null-guard branch, and the new
`getVehicleChecksForJadwalAction` call alongside the existing one. Nothing else in
this effect changes.)

Add the upload and submit handlers, near the other `handle*` functions:
```ts
  async function handleUploadVehiclePhoto(file: File, jenisFoto: JenisFotoKendaraan): Promise<string> {
    if (armadaId == null) throw new Error("Armada tidak diketahui.");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("armadaId", String(armadaId));
    formData.append("jenisFoto", jenisFoto);
    const res = await fetch("/api/upload/satpam-check", { method: "POST", body: formData });
    const data = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto.");
    return data.path;
  }

  async function handleSubmitVehicleCheck(input: {
    tipe: VehicleCheckTipe;
    odometerKM: number;
    fuelLevel: FuelLevel;
    photos: VehicleCheckPhoto[];
  }): Promise<void> {
    if (jadwalId == null) return;
    await createVehicleCheckAction({ jadwalId, ...input });
    const rows = await getVehicleChecksForJadwalAction(jadwalId);
    setVehicleChecks(rows);
  }
```

- [ ] **Step 2: Render `VehicleCheckPanel`**

Inside the JSX, right after the closing `</div>` of the `route`/fuel-info block
(the `{route && (...)}` block, just before the final `{error && ...}` line near
the bottom of the config panel `<div>`), add:
```tsx
            {!isDraft && jadwalId != null && armadaId != null && (
              <VehicleCheckPanel
                jadwalId={jadwalId}
                armadaId={armadaId}
                isSatpam={isSatpam}
                onUploadPhoto={handleUploadVehiclePhoto}
                onSubmitCheck={handleSubmitVehicleCheck}
                checks={vehicleChecks}
              />
            )}
```
(Gated on `!isDraft` per the design spec — only a Terbit Jadwal has a real
departure to check. Placed after the route/fuel info block so the dialog's visual
order reads: stop list → route/fuel stats → vehicle check, matching the natural
"plan the trip, then check the vehicle before/after it happens" flow.)

- [ ] **Step 3: Pass the 2 new props from the caller**

In `src/components/dashboard/pengiriman-board.tsx`, find the existing
`<RouteValidationDialog ...>` usage and add the two new props. Read the file
first to find the exact current prop list (`grep -n "<RouteValidationDialog"
src/components/dashboard/pengiriman-board.tsx`), then add:
```tsx
armadaId={armadaForOpenJadwal?.ArmadaID ?? null}
isSatpam={isSatpam}
```
next to the existing `armadaNama={...}` prop (reuse whatever variable the
existing `armadaNama` prop already resolves the open Jadwal's Armada from — the
armada lookup already exists for `konsumsiBBM`/`kapasitasMaks`/`jenisBBM`, per
those props' own comments in `route-validation-dialog.tsx`; `ArmadaID` is a field
on that same already-resolved `ArmadaRow`, no new query needed).

`isSatpam` needs a new prop on `PengirimanBoard` itself, threaded down from the
page. Find `PengirimanBoard`'s own prop destructuring at the top of the component
and add `isSatpam: boolean` to its props type, then pass it straight through to
`RouteValidationDialog` as shown above.

Finally, in `src/app/(dashboard)/delivery/page.tsx`, pass `isSatpam` into
`<PengirimanBoard>`:
```tsx
isSatpam={session.user.isSatpam}
```
(reusing whatever variable this page already holds its `session` object in —
check the existing `requireModuleAccess("delivery")` call's return value, which
is exactly this session object per every other page in this codebase using the
same pattern, e.g. `requirePmputra()`'s usage in `pmputra/keuangan/page.tsx`).

- [ ] **Step 4: Typecheck, lint, build**

```bash
npx eslint src/components/dashboard/route-validation-dialog.tsx src/components/dashboard/pengiriman-board.tsx "src/app/(dashboard)/delivery/page.tsx"
npm run build
```
Expected: both clean.

- [ ] **Step 5: Manually verify**

Start the dev server. Log in as a user with `isSatpam` enabled (use Task 2's test
role, or create a real "Satpam" role and a test account under it via
`/grup/akun`). Go to `/delivery`, open a Terbit Jadwal's Validasi Rute. Confirm:
- "Cek Keamanan Kendaraan" card appears with a "Cek Berangkat" form (6 camera
  slots, odometer, fuel select).
- Tapping a photo slot opens the device camera (or file picker on desktop — note
  in your report which environment you tested in).
- Submitting all 6 photos + odometer + fuel level succeeds, and the form is
  replaced by a read-only summary.
- A "Cek Datang" form now appears below it; submit it too.
- Reopen the same Jadwal's Validasi Rute — both checks show as read-only
  summaries, no forms.
- Log in as a NON-Satpam user with delivery access, open the same Jadwal — both
  checks show as read-only summaries (same as above), confirming the visibility
  decision.
- Attempting to call `createVehicleCheckAction` a third time for the same
  `(jadwalId, tipe)` pair (e.g. via a second browser tab open to the same dialog,
  if you can trigger a double-submit) is rejected with the "sudah pernah diisi"
  error, not a raw SQL error.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx src/components/dashboard/pengiriman-board.tsx "src/app/(dashboard)/delivery/page.tsx"
git commit -m "Wire VehicleCheckPanel into Validasi Rute (Satpam gate-check UI)"
```

---

## Task 9: Real "Kembali ke Pabrik" from Cek Datang

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts` (`JadwalCard`,
  `getPengirimanBoard`)
- Modify: `src/components/dashboard/pengiriman-board.tsx` (`autoSegments`)

**Interfaces:**
- Consumes: `getJamKembaliAktualMap` from `@/lib/queries/vehicle-check` (Task 3).
- Produces: `JadwalCard.JamKembaliAktual: string | null` (new field).

- [ ] **Step 1: Add `JamKembaliAktual` to `JadwalCard` and populate it**

In `src/lib/queries/pengiriman-jadwal.ts`, add the import:
```ts
import { getJamKembaliAktualMap } from "@/lib/queries/vehicle-check";
```

Add the new field to the `JadwalCard` interface (currently lines 42-73), right
after `DurasiMenit`:
```ts
  DurasiMenit: number | null;
  // The real vehicle-return timestamp from a Satpam's Cek Datang, when one
  // exists (see vehicle-check.ts) — null for any Jadwal without a recorded
  // arrival check yet, in which case the board falls back to the
  // JamAktualBerangkat + DurasiMenit estimate (unchanged legacy behavior).
  JamKembaliAktual: string | null;
```

In `getPengirimanBoard` (currently starting at line 89), after the existing
`Promise.all` that resolves `armada`/`jadwalResult`/`externalResult`/`pabrik`, map
the raw SQL rows into `JadwalCard[]` and merge in `JamKembaliAktual`. Find the
line where `jadwalResult.recordset` is currently cast/returned as `JadwalCard[]`
(search `jadwal: jadwalResult.recordset` or similar near the end of the
function) and change it to first build the plain rows, look up the
`JamKembaliAktual` map, then merge:
```ts
  const jadwalRows = jadwalResult.recordset as Omit<JadwalCard, "JamKembaliAktual">[];
  const jamKembaliMap = await getJamKembaliAktualMap(jadwalRows.map((j) => j.JadwalID));
  const jadwalWithKembali: JadwalCard[] = jadwalRows.map((j) => ({
    ...j,
    JamKembaliAktual: jamKembaliMap.get(j.JadwalID) ?? null,
  }));
```
Use `jadwalWithKembali` wherever the function currently returns its `jadwal:`
field in the final `{ armada, jadwal: ..., externalDeliveries }` object.

(Read the function's current tail before editing — the exact variable name
holding the mapped array may differ slightly from this description; the shape of
the change is: cast the raw recordset without `JamKembaliAktual`, fetch the map,
merge it in per row, use the merged array as the final `jadwal` return value.)

- [ ] **Step 2: Use the real timestamp in `autoSegments`**

In `src/components/dashboard/pengiriman-board.tsx`, replace the `if
(j.JamAktualBerangkat && j.DurasiMenit != null)` block inside `autoSegments`
(currently lines 822-833):
```ts
      if (j.JamAktualBerangkat && j.DurasiMenit != null) {
        const start = new Date(j.JamAktualBerangkat);
        const estimatedEnd = new Date(start.getTime() + j.DurasiMenit * 60_000);
        const end = j.JamKembaliAktual ? new Date(j.JamKembaliAktual) : estimatedEnd;
        segments.push({ key: `jalan-${j.JadwalID}`, jadwalId: j.JadwalID, label: "Dalam Perjalanan", start, end });
        segments.push({
          key: `kembali-${j.JadwalID}`,
          jadwalId: j.JadwalID,
          label: "Kembali ke Pabrik",
          start: end,
          end: new Date(end.getTime() + 15 * 60_000),
        });
      }
```
(Only the `end` computation changes — `estimatedEnd` replaces the old inline
`end` variable name, and the real `j.JamKembaliAktual` is preferred when present.
Everything else in this block, and the rest of `autoSegments`, is unchanged.)

- [ ] **Step 3: Typecheck, lint, build**

```bash
npx eslint src/lib/queries/pengiriman-jadwal.ts src/components/dashboard/pengiriman-board.tsx
npm run build
```
Expected: both clean.

- [ ] **Step 4: Verify against live data**

Reuse a throwaway script (delete after use) to confirm `getPengirimanBoard`
returns `JamKembaliAktual` correctly for the Jadwal you recorded a Cek Datang
against in Task 8's manual verification:
```ts
// scratchpad_verify_kembali.ts
import "dotenv/config";
import { getPengirimanBoard } from "./src/lib/queries/pengiriman-jadwal";
import { getBusinessDateISO } from "./src/lib/business-date";

async function main() {
  const board = await getPengirimanBoard(getBusinessDateISO());
  const withKembali = board.jadwal.filter((j) => j.JamKembaliAktual != null);
  console.log(`${withKembali.length} Jadwal with a real JamKembaliAktual today:`);
  console.log(withKembali.map((j) => ({ JadwalID: j.JadwalID, JamKembaliAktual: j.JamKembaliAktual })));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```
Run: `npx tsx scratchpad_verify_kembali.ts`
Expected: the Jadwal you Cek-Datang'd in Task 8 appears with a real
`JamKembaliAktual` value. Then `rm scratchpad_verify_kembali.ts`.

Also reload `/delivery` in the browser and confirm that Jadwal's "Kembali ke
Pabrik" marker on the timeline now sits at the real Cek Datang time rather than
the old 15-minutes-after-estimated-arrival position (compare against the
timestamp shown in the Validasi Rute dialog's Cek Datang summary from Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts src/components/dashboard/pengiriman-board.tsx
git commit -m "Use Satpam's Cek Datang as the real Kembali ke Pabrik arrival time"
```

---

## Task 10: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full build**

```bash
npm run build
```
Expected: clean, `/api/upload/satpam-check` listed as its own route.

- [ ] **Step 2: Full lint**

```bash
npx eslint src
```
Expected: no errors (pre-existing unrelated warnings from before this plan are
fine — do not fix them here).

- [ ] **Step 3: Full type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors project-wide.

- [ ] **Step 4: Live browser regression check**

Start the dev server. Log in as an MKEsindo superadmin (not Satpam):
- `/delivery` loads normally, board renders, no console errors.
- Open a Draft Jadwal's Validasi Rute — no "Cek Keamanan Kendaraan" card appears
  (gated on `!isDraft`), confirming no regression for the existing Draft flow.
- Open a Terbit Jadwal with no checks yet — card appears, shows "Belum ada Cek
  Berangkat." with no form (superadmin is not Satpam, per the deliberately
  non-bypassable design).
- `/grup/akun/peran` still works for every other role (module grid save/load
  unaffected by the new Satpam checkbox).

Log in as the Satpam test account again:
- Full round trip: Cek Berangkat → Cek Datang on a fresh Terbit Jadwal, confirm
  both submissions succeed, confirm the "Kembali ke Pabrik" marker updates live
  (may need a page reload, since this isn't wired through the SSE notification
  system).
- Confirm uploaded photos are actually reachable at their returned `/uploads/...`
  URL (open one directly in the browser).

- [ ] **Step 5: Confirm no leftover scratchpad scripts**

```bash
git status --short
```
Expected: clean (no untracked `scratchpad_*.ts` files left over from any task's
Step 2 verification).

- [ ] **Step 6: Final commit if any fixes were needed**

If Steps 1-5 surfaced any issues, fix them, re-run Steps 1-5, then:
```bash
git add -A
git commit -m "Fix issues found during Satpam vehicle-check verification pass"
```
