# Wire perusahaan_koneksi as Live DB Connection Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `perusahaan_koneksi` (Postgres, `pmp_directory` DB) the one real, live-wired source of MSSQL connection info — replacing both the inert `DashboardPerusahaan` credential fields and MKEsindo's static `DB_*` env vars — and give the `/grup/perusahaan` admin UI a working way to manage those connections.

**Architecture:** A new Postgres query module (`src/lib/queries/perusahaan-koneksi.ts`) resolves `(kode, label) -> {host, port, dbName, dbUser, dbPassword}` by joining `perusahaan` + `perusahaan_koneksi` and decrypting the stored password. `src/lib/db.ts`'s `getPool()` (52 existing call sites, interface unchanged) now builds its MSSQL config from `resolveKoneksi("mkesindo", "utama")` instead of `process.env.DB_*`, with **no env-var fallback** — a deliberate, user-accepted risk. A parallel `src/lib/db-pmputra.ts` exposes `getPmputraPool(label)` for PT Prima Maesa Putra's two databases, unused by any page yet. `DashboardPerusahaan` (MSSQL) gains a `Kode` column linking it to Postgres `perusahaan.kode`, and the `/grup/perusahaan` admin dialog gets a new "Tautan & Koneksi Database" section replacing the old dead "Kredensial Database" fieldset.

**Tech Stack:** Next.js 16 App Router, Server Actions, raw parameterized `mssql` queries via `@/lib/db`, raw parameterized `pg` queries via `@/lib/pg`, Node `crypto` (AES-256-GCM, `@/lib/crypto-secret.ts`) for credential encryption.

## Global Constraints

- Direct-to-`main` workflow, no feature branch — explicit prior user consent, same as every prior plan this session.
- Push only on explicit user request — commit locally after each task, do not push until asked.
- No automated test runner in this project (no `test` script, no `jest`/`vitest`). Every "test" step below is either a one-off `npx tsx` verification script (written, run, confirmed, then **deleted** — never committed) or `npx tsc --noEmit` + `npx eslint <files>` + `npx next build`, matching this codebase's established convention.
- All new DB-facing code uses parameterized queries — MSSQL via `.input(name, sql.Type, value)`, Postgres via `$1, $2, ...` positional placeholders — never string-interpolate a value into SQL.
- **No env-var fallback in `getPool()`.** If `resolveKoneksi("mkesindo", "utama")` fails or returns null, `getPool()` must throw loudly, not silently fall back to `DB_*` env vars. This is the spec's explicit, user-accepted trade-off (see `docs/superpowers/specs/2026-07-30-perusahaan-db-koneksi-design.md`, "Decisions made during brainstorming").
- `DB_*` env vars stay in `.env`/`.env.example` (still used for `DB_ENCRYPT`/`DB_TRUST_SERVER_CERTIFICATE`, which are connection *options*, not credentials) — `db.ts` just stops reading `DB_SERVER`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`.
- Old `DashboardPerusahaan` credential columns (`DbServer`/`DbPort`/`DbName`/`DbUser`/`DbPasswordEncrypted`) are left in place, unused — no destructive column drop, no change to `src/lib/queries/perusahaan.ts`'s existing fields beyond adding `Kode`/`kode`.
- **Standing rule: never log into the app via browser automation**, even for verification. Task 4 (the highest-risk task, since it changes how the live MKEsindo connection resolves) is verified by a direct Node script calling the real `getPool()` export, not by loading a page through an authenticated browser session — flag in that task's own verification step that a real human login afterward is the last mile this plan cannot cover itself.

---

### Task 0: MSSQL DDL — `Kode` column on `DashboardPerusahaan` (controller-run)

**Files:** none (DDL run directly against the live `MKEsindo` database)

- [ ] **Step 1: Run this DDL**

```sql
ALTER TABLE DashboardPerusahaan ADD Kode VARCHAR(32) NULL;
UPDATE DashboardPerusahaan SET Kode = 'mkesindo' WHERE Nama = 'PT Mitra Kelola Esindo';
UPDATE DashboardPerusahaan SET Kode = 'pmputra' WHERE Nama = 'PT Prima Maesa Putra';
```

- [ ] **Step 2: Verify**

Run:
```sql
SELECT PerusahaanID, Nama, Kode FROM DashboardPerusahaan ORDER BY PerusahaanID;
```
Expected: the `PT Mitra Kelola Esindo` row has `Kode = 'mkesindo'`, the `PT Prima Maesa Putra` row has `Kode = 'pmputra'`, any other rows (e.g. test rows left over from a prior plan) have `Kode = NULL`.

---

### Task 1: `src/lib/queries/perusahaan.ts` — add `Kode`/`kode`

**Files:**
- Modify: `src/lib/queries/perusahaan.ts`

**Interfaces:**
- Produces: `PerusahaanRow.Kode: string | null`, `PerusahaanInput.kode: string | null` — consumed by Task 6.

- [ ] **Step 1: Replace the whole file**

```ts
import { getPool, sql } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto-secret";
import { PERUSAHAAN_STATUSES, type PerusahaanStatus } from "@/lib/perusahaan-status";

export { PERUSAHAAN_STATUSES, type PerusahaanStatus };

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
  Kode: string | null;
  DbServer: string | null;
  DbPort: number | null;
  DbName: string | null;
  DbUser: string | null;
  HasDbPassword: boolean;
  Catatan: string | null;
}

export interface PerusahaanInput {
  nama: string;
  jenisBisnis: string | null;
  wilayah: string | null;
  pabrikLatitude: number | null;
  pabrikLongitude: number | null;
  pabrikAlamat: string | null;
  status: PerusahaanStatus;
  standaloneUrl: string | null;
  // Links this MSSQL registry row to Postgres perusahaan.kode ('mkesindo' |
  // 'pmputra') — see docs/superpowers/specs/2026-07-30-perusahaan-db-koneksi-design.md.
  // null means "not linked yet" (e.g. a brand-new Draft PT).
  kode: string | null;
  dbServer: string | null;
  dbPort: number | null;
  dbName: string | null;
  dbUser: string | null;
  // On create: used as-is (blank means no password set). On update: blank
  // means "keep the existing stored credential" — only a non-blank value
  // triggers re-encryption and overwrite.
  dbPassword: string | null;
  catatan: string | null;
}

export interface PerusahaanSwitcherEntry {
  PerusahaanID: number;
  Nama: string;
  Status: PerusahaanStatus;
  StandaloneUrl: string | null;
}

export async function listPerusahaan(): Promise<PerusahaanRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PerusahaanID, Nama, JenisBisnis, Wilayah, PabrikLatitude, PabrikLongitude, PabrikAlamat,
           Status, StandaloneUrl, Kode, DbServer, DbPort, DbName, DbUser,
           CASE WHEN DbPasswordEncrypted IS NULL THEN 0 ELSE 1 END AS HasDbPassword,
           Catatan
    FROM DashboardPerusahaan
    WHERE IsDeleted = 0
    ORDER BY Nama
  `);
  return (result.recordset as (Omit<PerusahaanRow, "HasDbPassword"> & { HasDbPassword: number })[]).map((r) => ({
    ...r,
    HasDbPassword: r.HasDbPassword === 1,
  }));
}

export async function listPerusahaanForSwitcher(): Promise<PerusahaanSwitcherEntry[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PerusahaanID, Nama, Status, StandaloneUrl
    FROM DashboardPerusahaan
    WHERE IsDeleted = 0 AND Status <> 'Draft'
    ORDER BY Status DESC, Nama
  `);
  return result.recordset;
}

export async function createPerusahaan(input: PerusahaanInput): Promise<number> {
  const pool = await getPool();
  const encryptedPassword = input.dbPassword ? encryptSecret(input.dbPassword) : null;
  const result = await pool
    .request()
    .input("nama", sql.VarChar(128), input.nama)
    .input("jenisBisnis", sql.VarChar(128), input.jenisBisnis)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("pabrikLatitude", sql.Decimal(10, 7), input.pabrikLatitude)
    .input("pabrikLongitude", sql.Decimal(10, 7), input.pabrikLongitude)
    .input("pabrikAlamat", sql.VarChar(512), input.pabrikAlamat)
    .input("status", sql.VarChar(20), input.status)
    .input("standaloneUrl", sql.VarChar(512), input.standaloneUrl)
    .input("kode", sql.VarChar(32), input.kode)
    .input("dbServer", sql.VarChar(256), input.dbServer)
    .input("dbPort", sql.Int, input.dbPort)
    .input("dbName", sql.VarChar(128), input.dbName)
    .input("dbUser", sql.VarChar(128), input.dbUser)
    .input("dbPasswordEncrypted", sql.VarChar(512), encryptedPassword)
    .input("catatan", sql.VarChar(1024), input.catatan).query(`
      INSERT INTO DashboardPerusahaan
        (Nama, JenisBisnis, Wilayah, PabrikLatitude, PabrikLongitude, PabrikAlamat, Status, StandaloneUrl,
         Kode, DbServer, DbPort, DbName, DbUser, DbPasswordEncrypted, Catatan, IsDeleted, CreatedAt, UpdatedAt)
      OUTPUT inserted.PerusahaanID
      VALUES
        (@nama, @jenisBisnis, @wilayah, @pabrikLatitude, @pabrikLongitude, @pabrikAlamat, @status, @standaloneUrl,
         @kode, @dbServer, @dbPort, @dbName, @dbUser, @dbPasswordEncrypted, @catatan, 0, GETDATE(), GETDATE())
    `);
  return (result.recordset[0] as { PerusahaanID: number }).PerusahaanID;
}

export async function updatePerusahaan(id: number, input: PerusahaanInput): Promise<void> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("id", sql.Int, id)
    .input("nama", sql.VarChar(128), input.nama)
    .input("jenisBisnis", sql.VarChar(128), input.jenisBisnis)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("pabrikLatitude", sql.Decimal(10, 7), input.pabrikLatitude)
    .input("pabrikLongitude", sql.Decimal(10, 7), input.pabrikLongitude)
    .input("pabrikAlamat", sql.VarChar(512), input.pabrikAlamat)
    .input("status", sql.VarChar(20), input.status)
    .input("standaloneUrl", sql.VarChar(512), input.standaloneUrl)
    .input("kode", sql.VarChar(32), input.kode)
    .input("dbServer", sql.VarChar(256), input.dbServer)
    .input("dbPort", sql.Int, input.dbPort)
    .input("dbName", sql.VarChar(128), input.dbName)
    .input("dbUser", sql.VarChar(128), input.dbUser)
    .input("catatan", sql.VarChar(1024), input.catatan);

  // Blank dbPassword means "keep existing" — the UPDATE statement itself
  // omits DbPasswordEncrypted in that case, so the stored value is
  // untouched. Two separate query strings (not a runtime-built one) keeps
  // this parameterized and readable.
  if (input.dbPassword) {
    await request.input("dbPasswordEncrypted", sql.VarChar(512), encryptSecret(input.dbPassword)).query(`
      UPDATE DashboardPerusahaan SET
        Nama = @nama, JenisBisnis = @jenisBisnis, Wilayah = @wilayah,
        PabrikLatitude = @pabrikLatitude, PabrikLongitude = @pabrikLongitude, PabrikAlamat = @pabrikAlamat,
        Status = @status, StandaloneUrl = @standaloneUrl, Kode = @kode,
        DbServer = @dbServer, DbPort = @dbPort, DbName = @dbName, DbUser = @dbUser,
        DbPasswordEncrypted = @dbPasswordEncrypted, Catatan = @catatan, UpdatedAt = GETDATE()
      WHERE PerusahaanID = @id
    `);
  } else {
    await request.query(`
      UPDATE DashboardPerusahaan SET
        Nama = @nama, JenisBisnis = @jenisBisnis, Wilayah = @wilayah,
        PabrikLatitude = @pabrikLatitude, PabrikLongitude = @pabrikLongitude, PabrikAlamat = @pabrikAlamat,
        Status = @status, StandaloneUrl = @standaloneUrl, Kode = @kode,
        DbServer = @dbServer, DbPort = @dbPort, DbName = @dbName, DbUser = @dbUser,
        Catatan = @catatan, UpdatedAt = GETDATE()
      WHERE PerusahaanID = @id
    `);
  }
}

export async function softDeletePerusahaan(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE DashboardPerusahaan SET IsDeleted = 1, UpdatedAt = GETDATE() WHERE PerusahaanID = @id`);
}
```

- [ ] **Step 2: Verify with a one-off script against the live database**

Create `scripts/verify-perusahaan-kode.ts`:
```ts
import "dotenv/config";
import { listPerusahaan, updatePerusahaan } from "../src/lib/queries/perusahaan";

async function main() {
  const rows = await listPerusahaan();
  const mke = rows.find((r) => r.Nama === "PT Mitra Kelola Esindo");
  const pmp = rows.find((r) => r.Nama === "PT Prima Maesa Putra");
  console.log("MKEsindo Kode:", mke?.Kode, "— expect 'mkesindo'");
  console.log("PMPutra Kode:", pmp?.Kode, "— expect 'pmputra'");

  if (!mke) throw new Error("MKEsindo row not found");
  await updatePerusahaan(mke.PerusahaanID, {
    nama: mke.Nama,
    jenisBisnis: mke.JenisBisnis,
    wilayah: mke.Wilayah,
    pabrikLatitude: mke.PabrikLatitude,
    pabrikLongitude: mke.PabrikLongitude,
    pabrikAlamat: mke.PabrikAlamat,
    status: mke.Status,
    standaloneUrl: mke.StandaloneUrl,
    kode: mke.Kode,
    dbServer: mke.DbServer,
    dbPort: mke.DbPort,
    dbName: mke.DbName,
    dbUser: mke.DbUser,
    dbPassword: null,
    catatan: mke.Catatan,
  });
  const after = await listPerusahaan();
  const mkeAfter = after.find((r) => r.PerusahaanID === mke.PerusahaanID);
  console.log("Kode survives a no-password update:", mkeAfter?.Kode === "mkesindo");

  if (mke?.Kode !== "mkesindo" || pmp?.Kode !== "pmputra" || mkeAfter?.Kode !== "mkesindo") {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/verify-perusahaan-kode.ts`
Expected output ends with `PASS`. Then delete the script.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` — expect no errors (note: `perusahaan-form-dialog.tsx`/`perusahaan-list.tsx` will show errors until Task 6 — acceptable mid-plan state, confirm the errors are confined to those two files and Task 0-not-yet-run type issues, not `perusahaan.ts` itself).
Run: `npx eslint src/lib/queries/perusahaan.ts` — expect no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/perusahaan.ts
git commit -m "Add Kode column support to perusahaan.ts (links MSSQL registry to Postgres perusahaan)"
```

---

### Task 2: `src/lib/queries/perusahaan-koneksi.ts` — Postgres query module

**Files:**
- Create: `src/lib/queries/perusahaan-koneksi.ts`

**Interfaces:**
- Consumes: `getPgPool` from `@/lib/pg`, `encryptSecret`/`decryptSecret` from `@/lib/crypto-secret`.
- Produces: `ResolvedKoneksi`, `resolveKoneksi(kode, label)` (used by Task 4, Task 5), `KoneksiRow`, `listAllKoneksi()`, `UpsertKoneksiInput`, `upsertKoneksi(input)`, `deleteKoneksi(id)` (used by Task 6).

- [ ] **Step 1: Write the file**

```ts
import { getPgPool } from "@/lib/pg";
import { encryptSecret, decryptSecret } from "@/lib/crypto-secret";

export interface ResolvedKoneksi {
  host: string;
  port: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

// Runtime resolution path — db.ts and db-pmputra.ts only know static `kode`
// constants ("mkesindo" / "pmputra"), not a Postgres perusahaan.id, so this
// resolves by the human-readable pair instead of a foreign key. See
// docs/superpowers/specs/2026-07-30-perusahaan-db-koneksi-design.md.
export async function resolveKoneksi(kode: string, label: string): Promise<ResolvedKoneksi | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT pk.host, pk.port, pk.db_name, pk.db_user, pk.db_password_encrypted
     FROM perusahaan_koneksi pk
     JOIN perusahaan p ON p.id = pk.perusahaan_id
     WHERE p.kode = $1 AND pk.label = $2`,
    [kode, label]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    dbName: row.db_name,
    dbUser: row.db_user,
    dbPassword: decryptSecret(row.db_password_encrypted),
  };
}

export interface KoneksiRow {
  id: number;
  perusahaanId: number;
  label: string;
  host: string;
  port: number;
  dbName: string;
  dbUser: string;
}

// Feeds the admin UI (Task 6) — small table (a handful of rows total across
// all companies), so no per-company filtering needed server-side; the
// dialog filters client-side by the currently linked perusahaanId.
export async function listAllKoneksi(): Promise<KoneksiRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, perusahaan_id, label, host, port, db_name, db_user FROM perusahaan_koneksi ORDER BY perusahaan_id, label`
  );
  return result.rows.map((r) => ({
    id: r.id,
    perusahaanId: r.perusahaan_id,
    label: r.label,
    host: r.host,
    port: r.port,
    dbName: r.db_name,
    dbUser: r.db_user,
  }));
}

export interface UpsertKoneksiInput {
  perusahaanId: number;
  label: string;
  host: string;
  port: number;
  dbName: string;
  dbUser: string;
  // On create: required (the DB column is NOT NULL). On update: blank means
  // "keep the existing stored credential" — same write-only convention as
  // perusahaan.ts's dbPassword.
  dbPassword: string | null;
}

export async function upsertKoneksi(input: UpsertKoneksiInput): Promise<void> {
  const pool = getPgPool();
  if (input.dbPassword) {
    const encrypted = encryptSecret(input.dbPassword);
    await pool.query(
      `INSERT INTO perusahaan_koneksi (perusahaan_id, label, db_engine, host, port, db_name, db_user, db_password_encrypted)
       VALUES ($1, $2, 'mssql', $3, $4, $5, $6, $7)
       ON CONFLICT (perusahaan_id, label) DO UPDATE
       SET host = EXCLUDED.host, port = EXCLUDED.port, db_name = EXCLUDED.db_name,
           db_user = EXCLUDED.db_user, db_password_encrypted = EXCLUDED.db_password_encrypted,
           updated_at = now()`,
      [input.perusahaanId, input.label, input.host, input.port, input.dbName, input.dbUser, encrypted]
    );
    return;
  }
  const result = await pool.query(
    `UPDATE perusahaan_koneksi SET host = $1, port = $2, db_name = $3, db_user = $4, updated_at = now()
     WHERE perusahaan_id = $5 AND label = $6`,
    [input.host, input.port, input.dbName, input.dbUser, input.perusahaanId, input.label]
  );
  if (result.rowCount === 0) {
    throw new Error(`Koneksi "${input.label}" belum ada — password wajib diisi untuk membuat koneksi baru.`);
  }
}

export async function deleteKoneksi(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM perusahaan_koneksi WHERE id = $1`, [id]);
}
```

- [ ] **Step 2: Verify with a one-off script against the live Postgres database**

Create `scripts/verify-perusahaan-koneksi.ts`:
```ts
import "dotenv/config";
import { resolveKoneksi, listAllKoneksi, upsertKoneksi, deleteKoneksi } from "../src/lib/queries/perusahaan-koneksi";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pmputraUtama = await resolveKoneksi("pmputra", "utama");
  console.log("pmputra/utama resolves:", pmputraUtama?.dbName, "— expect 'FINAC_ES_PO'");
  const pmputraLogistik = await resolveKoneksi("pmputra", "logistik");
  console.log("pmputra/logistik resolves:", pmputraLogistik?.dbName, "— expect 'FINAC_LOGISTIC_PO'");
  const missing = await resolveKoneksi("mkesindo", "utama");
  console.log("mkesindo/utama before seeding (Task 3 not run yet):", missing, "— expect null");

  const pmputraRow = await getPgPool().query(`SELECT id FROM perusahaan WHERE kode = 'pmputra'`);
  const pmputraId = pmputraRow.rows[0].id as number;

  await upsertKoneksi({
    perusahaanId: pmputraId,
    label: "verify-test",
    host: "1.2.3.4",
    port: 1433,
    dbName: "TestDB",
    dbUser: "sa",
    dbPassword: "hunter2",
  });
  const all = await listAllKoneksi();
  const created = all.find((k) => k.label === "verify-test");
  console.log("Created test koneksi found in listAllKoneksi:", !!created);

  await upsertKoneksi({
    perusahaanId: pmputraId,
    label: "verify-test",
    host: "5.6.7.8",
    port: 1433,
    dbName: "TestDB",
    dbUser: "sa",
    dbPassword: null, // blank — must keep existing password, only update host
  });
  const resolved = await resolveKoneksi("pmputra", "verify-test");
  console.log("Host updated:", resolved?.host === "5.6.7.8");
  console.log("Password preserved after blank-password update:", resolved?.dbPassword === "hunter2");

  if (created) await deleteKoneksi(created.id);
  const afterDelete = await listAllKoneksi();
  console.log("Test koneksi gone after delete:", !afterDelete.some((k) => k.label === "verify-test"));

  if (
    pmputraUtama?.dbName !== "FINAC_ES_PO" ||
    pmputraLogistik?.dbName !== "FINAC_LOGISTIC_PO" ||
    missing !== null ||
    !created ||
    resolved?.host !== "5.6.7.8" ||
    resolved?.dbPassword !== "hunter2"
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

Run: `npx tsx scripts/verify-perusahaan-koneksi.ts`
Expected output ends with `PASS`. Then delete the script.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` — expect no new errors beyond the pre-existing Task-6-not-done ones.
Run: `npx eslint src/lib/queries/perusahaan-koneksi.ts` — expect no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/perusahaan-koneksi.ts
git commit -m "Add perusahaan-koneksi.ts query layer (resolve/list/upsert/delete)"
```

---

### Task 3: Seed MKEsindo's `perusahaan_koneksi` row (one-off, controller-run)

**Files:** none permanent — a throwaway script, deleted after use.

**Interfaces:**
- Consumes: `upsertKoneksi` from Task 2.

- [ ] **Step 1: Create and run the seed script**

Create `scripts/seed-mkesindo-koneksi.ts`:
```ts
import "dotenv/config";
import { upsertKoneksi, resolveKoneksi } from "../src/lib/queries/perusahaan-koneksi";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const row = await getPgPool().query(`SELECT id FROM perusahaan WHERE kode = 'mkesindo'`);
  const perusahaanId = row.rows[0].id as number;

  await upsertKoneksi({
    perusahaanId,
    label: "utama",
    host: process.env.DB_SERVER!,
    port: Number(process.env.DB_PORT || 1433),
    dbName: process.env.DB_NAME!,
    dbUser: process.env.DB_USER!,
    dbPassword: process.env.DB_PASSWORD!,
  });

  const resolved = await resolveKoneksi("mkesindo", "utama");
  console.log("mkesindo/utama resolved:", { host: resolved?.host, port: resolved?.port, dbName: resolved?.dbName, dbUser: resolved?.dbUser });
  if (resolved?.host !== process.env.DB_SERVER || resolved?.dbPassword !== process.env.DB_PASSWORD) {
    console.error("FAIL — resolved values don't match the source env vars");
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

Run: `npx tsx scripts/seed-mkesindo-koneksi.ts`
Expected: prints the resolved host/port/dbName/dbUser matching the current `.env` `DB_*` values, ends with `PASS`.

- [ ] **Step 2: Delete the script**

This is a one-off seed, not a repeatable migration (unlike `scripts/migrate-directory-db.ts`, which stays because it's idempotent and covers 2 companies) — delete it after the row is confirmed seeded.

- [ ] **Step 3: Commit**

Nothing to commit (no file changes — this task only wrote data). Skip straight to Task 4.

---

### Task 4: Rewrite `src/lib/db.ts` to resolve via `perusahaan_koneksi` — HIGH RISK

**Files:**
- Modify: `src/lib/db.ts`

**Interfaces:**
- Consumes: `resolveKoneksi` from Task 2 (`@/lib/queries/perusahaan-koneksi`).
- Produces: `getPool(): Promise<sql.ConnectionPool>` — **signature unchanged**, every one of the 52 existing callers needs zero changes.

This is the highest-risk task in this plan: every existing query file in the app depends on `getPool()`. Do not skip Step 2's live verification.

- [ ] **Step 1: Replace the whole file**

```ts
import sql from "mssql";
import { resolveKoneksi } from "@/lib/queries/perusahaan-koneksi";

// MKEsindo's live MSSQL connection now resolves through the Postgres
// "directory" DB (perusahaan_koneksi, kode="mkesindo" label="utama")
// instead of static DB_* env vars — see docs/superpowers/specs/
// 2026-07-30-perusahaan-db-koneksi-design.md. Deliberately NO env-var
// fallback: if the directory lookup fails, this throws, and so does every
// page that calls getPool(). Accepted risk, not an oversight.
declare global {
  var _mssqlPool: Promise<sql.ConnectionPool> | undefined;
}

export function getPool(): Promise<sql.ConnectionPool> {
  if (!global._mssqlPool) {
    global._mssqlPool = resolveKoneksi("mkesindo", "utama")
      .then((cfg) => {
        if (!cfg) {
          throw new Error(
            'No perusahaan_koneksi row for kode="mkesindo" label="utama" — run scripts/seed-mkesindo-koneksi.ts (see docs/superpowers/plans/2026-07-30-perusahaan-db-koneksi.md Task 3)'
          );
        }
        const config: sql.config = {
          server: cfg.host,
          port: cfg.port,
          database: cfg.dbName,
          user: cfg.dbUser,
          password: cfg.dbPassword,
          options: {
            encrypt: process.env.DB_ENCRYPT !== "false",
            trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true",
          },
          // Same tuning as before this change — see the removed comment's
          // rationale, unchanged: ~5s cold TLS handshake on this host,
          // min:2 keeps warm connections alive for concurrent bursts.
          connectionTimeout: 15000,
          requestTimeout: 40000,
          pool: { max: 10, min: 2, idleTimeoutMillis: 600000 },
        };
        return new sql.ConnectionPool(config).connect();
      })
      .catch((err) => {
        // Don't cache a failed resolution/connection attempt — otherwise
        // every request for the rest of the process's lifetime reuses the
        // same rejected promise and never retries.
        global._mssqlPool = undefined;
        throw err;
      });
  }
  return global._mssqlPool;
}

export { sql };
```

- [ ] **Step 2: Live-verify the new `getPool()` end-to-end, BEFORE trusting this change**

Create `scripts/verify-db-via-koneksi.ts`:
```ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const result = await pool.request().query("SELECT 1 AS x, DB_NAME() AS dbName, @@SERVERNAME AS serverName");
  console.log("Query result:", result.recordset[0]);
  const ok = result.recordset[0]?.x === 1 && result.recordset[0]?.dbName === process.env.DB_NAME;
  console.log(ok ? "PASS" : "FAIL");
  await sql.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
```

Run: `npx tsx scripts/verify-db-via-koneksi.ts`
Expected: prints `{ x: 1, dbName: 'MKEsindo', serverName: '...' }`, ends with `PASS`. This proves `getPool()` now genuinely resolves through Postgres and opens a real, working MSSQL connection — not just that it type-checks.

Then delete the script.

- [ ] **Step 3: Type-check, lint, and build**

Run: `npx tsc --noEmit` — expect no new errors introduced by this task itself (the `Kode`-related errors in `perusahaan-form-dialog.tsx`/`perusahaan-list.tsx` from Task 1 are still expected here — `db.ts` doesn't touch those files, they're only resolved in Task 6).
Run: `npx eslint src/lib/db.ts` — expect no errors.
Run: `npx next build` — expect a clean build. A clean build does **not** prove `getPool()` works at runtime (Next.js doesn't execute server-side data fetching during a static build for dynamic routes) — Step 2's script is the real proof, this step only catches syntax/type regressions.

- [ ] **Step 4: Note the residual verification gap**

This plan cannot verify a real authenticated page load (standing rule: no browser login automation). Step 2's script proves the connection layer works; it does not prove every one of the 52 existing query files still behaves correctly under a real request. **Tell the user explicitly**, once this task is committed, that one real login + a look at a couple of pages (e.g. `/`, `/delivery`) is the recommended last-mile check before considering this fully safe — this plan cannot perform that check itself.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts
git commit -m "Resolve MKEsindo's MSSQL connection via perusahaan_koneksi instead of static env vars"
```

---

### Task 5: `src/lib/db-pmputra.ts` — PMPutra connection opener (unused for now)

**Files:**
- Create: `src/lib/db-pmputra.ts`

**Interfaces:**
- Consumes: `resolveKoneksi` from Task 2.
- Produces: `getPmputraPool(label: "utama" | "logistik"): Promise<sql.ConnectionPool>` — not called anywhere yet, exists for the future PMPutra module per the spec's explicit "PMPutra gets a connection-opener too... built now so it's ready" decision.

- [ ] **Step 1: Write the file**

```ts
import sql from "mssql";
import { resolveKoneksi } from "@/lib/queries/perusahaan-koneksi";

export type PmputraKoneksiLabel = "utama" | "logistik";

// PT Prima Maesa Putra's two databases (FINAC_ES_PO / FINAC_LOGISTIC_PO) —
// same resolve-via-Postgres pattern as db.ts, but keyed per label since
// there are two of them. Not called by any page yet — see
// docs/superpowers/specs/2026-07-30-perusahaan-db-koneksi-design.md's
// "PMPutra gets a connection-opener too" decision.
declare global {
  var _pmputraPools: Map<PmputraKoneksiLabel, Promise<sql.ConnectionPool>> | undefined;
}

export function getPmputraPool(label: PmputraKoneksiLabel): Promise<sql.ConnectionPool> {
  if (!global._pmputraPools) global._pmputraPools = new Map();
  const cached = global._pmputraPools.get(label);
  if (cached) return cached;

  const promise = resolveKoneksi("pmputra", label)
    .then((cfg) => {
      if (!cfg) {
        throw new Error(`No perusahaan_koneksi row for kode="pmputra" label="${label}"`);
      }
      const config: sql.config = {
        server: cfg.host,
        port: cfg.port,
        database: cfg.dbName,
        user: cfg.dbUser,
        password: cfg.dbPassword,
        options: { encrypt: true, trustServerCertificate: true },
        connectionTimeout: 15000,
        requestTimeout: 40000,
        pool: { max: 5, min: 1, idleTimeoutMillis: 600000 },
      };
      return new sql.ConnectionPool(config).connect();
    })
    .catch((err) => {
      global._pmputraPools?.delete(label);
      throw err;
    });

  global._pmputraPools.set(label, promise);
  return promise;
}
```

- [ ] **Step 2: Verify with a one-off script**

Create `scripts/verify-db-pmputra.ts`:
```ts
import "dotenv/config";
import { getPmputraPool } from "../src/lib/db-pmputra";

async function main() {
  const utama = await getPmputraPool("utama");
  const utamaResult = await utama.request().query("SELECT DB_NAME() AS dbName");
  console.log("utama connects to:", utamaResult.recordset[0].dbName, "— expect FINAC_ES_PO");

  const logistik = await getPmputraPool("logistik");
  const logistikResult = await logistik.request().query("SELECT DB_NAME() AS dbName");
  console.log("logistik connects to:", logistikResult.recordset[0].dbName, "— expect FINAC_LOGISTIC_PO");

  const ok = utamaResult.recordset[0].dbName === "FINAC_ES_PO" && logistikResult.recordset[0].dbName === "FINAC_LOGISTIC_PO";
  console.log(ok ? "PASS" : "FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
```

Run: `npx tsx scripts/verify-db-pmputra.ts`
Expected output ends with `PASS`. Then delete the script.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` — expect no errors.
Run: `npx eslint src/lib/db-pmputra.ts` — expect no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db-pmputra.ts
git commit -m "Add getPmputraPool connection opener (unused, ready for future PMPutra module)"
```

---

### Task 6: Admin UI — link PT to Postgres + manage connections

**Files:**
- Modify: `src/components/dashboard/perusahaan-form-dialog.tsx`
- Modify: `src/components/dashboard/perusahaan-list.tsx`
- Modify: `src/app/grup/perusahaan/actions.ts`
- Modify: `src/app/grup/perusahaan/page.tsx`

**Interfaces:**
- Consumes: `listPerusahaanDirektori`, `PerusahaanDirektoriOption` from `@/lib/queries/akun-direktori` (already exists); `listAllKoneksi`, `upsertKoneksi`, `deleteKoneksi`, `KoneksiRow`, `UpsertKoneksiInput` from Task 2; `requireGrupAccess` from `@/lib/require-access` (already exists).
- Produces: `upsertKoneksiAction`, `deleteKoneksiAction` in `actions.ts`.

- [ ] **Step 1: Add server actions to `src/app/grup/perusahaan/actions.ts`**

Replace the whole file:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { createPerusahaan, updatePerusahaan, softDeletePerusahaan, type PerusahaanInput } from "@/lib/queries/perusahaan";
import { PERUSAHAAN_JENIS_BISNIS } from "@/lib/perusahaan-status";
import { upsertKoneksi, deleteKoneksi, type UpsertKoneksiInput } from "@/lib/queries/perusahaan-koneksi";

function assertValid(input: PerusahaanInput) {
  if (!input.nama.trim()) throw new Error("Nama PT wajib diisi.");
  if (input.status === "StandaloneHTML" && !input.standaloneUrl?.trim()) {
    throw new Error("URL Standalone wajib diisi untuk status Standalone HTML.");
  }
  // Locked enum — every module that branches on business type depends on
  // this never being an arbitrary string (see PERUSAHAAN_JENIS_BISNIS).
  if (!input.jenisBisnis || !(PERUSAHAAN_JENIS_BISNIS as readonly string[]).includes(input.jenisBisnis)) {
    throw new Error("Jenis Bisnis wajib dipilih (Es Kristal atau Es Balok).");
  }
}

export async function createPerusahaanAction(input: PerusahaanInput): Promise<void> {
  await requireGrupAccess();
  assertValid(input);
  await createPerusahaan(input);
  revalidatePath("/grup/perusahaan");
}

export async function updatePerusahaanAction(id: number, input: PerusahaanInput): Promise<void> {
  await requireGrupAccess();
  assertValid(input);
  await updatePerusahaan(id, input);
  revalidatePath("/grup/perusahaan");
}

export async function deletePerusahaanAction(id: number): Promise<void> {
  await requireGrupAccess();
  await softDeletePerusahaan(id);
  revalidatePath("/grup/perusahaan");
}

export async function upsertKoneksiAction(input: UpsertKoneksiInput): Promise<void> {
  await requireGrupAccess();
  if (!input.host.trim() || !input.dbName.trim() || !input.dbUser.trim()) {
    throw new Error("Host, Nama Database, dan Username wajib diisi untuk setiap koneksi.");
  }
  await upsertKoneksi(input);
  revalidatePath("/grup/perusahaan");
}

export async function deleteKoneksiAction(id: number): Promise<void> {
  await requireGrupAccess();
  await deleteKoneksi(id);
  revalidatePath("/grup/perusahaan");
}
```

- [ ] **Step 2: Rewrite `perusahaan-form-dialog.tsx`**

Replace the whole file:
```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import { PERUSAHAAN_STATUSES, type PerusahaanStatus, PERUSAHAAN_JENIS_BISNIS, type PerusahaanJenisBisnis } from "@/lib/perusahaan-status";
import type { PerusahaanRow, PerusahaanInput } from "@/lib/queries/perusahaan";
import type { PerusahaanDirektoriOption } from "@/lib/queries/akun-direktori";
import type { KoneksiRow, UpsertKoneksiInput } from "@/lib/queries/perusahaan-koneksi";

const STATUS_LABEL: Record<PerusahaanStatus, string> = {
  Draft: "Draft",
  StandaloneHTML: "Standalone HTML",
  AktifPenuh: "Aktif Penuh",
};

// Es Kristal companies have one MSSQL database; Es Balok companies (PT
// Prima Maesa Putra's shape) have two — see docs/superpowers/specs/
// 2026-07-30-perusahaan-db-koneksi-design.md, "UI connection-block count
// follows Jenis Bisnis" decision. Not a generic add/remove list.
const KONEKSI_LABELS_BY_JENIS: Record<PerusahaanJenisBisnis, string[]> = {
  "Es Kristal": ["utama"],
  "Es Balok": ["utama", "logistik"],
};

function emptyForm(): PerusahaanInput {
  return {
    nama: "",
    jenisBisnis: "Es Kristal",
    wilayah: null,
    pabrikLatitude: null,
    pabrikLongitude: null,
    pabrikAlamat: null,
    status: "Draft",
    standaloneUrl: null,
    kode: null,
    dbServer: null,
    dbPort: null,
    dbName: null,
    dbUser: null,
    dbPassword: null,
    catatan: null,
  };
}

function rowToForm(row: PerusahaanRow): PerusahaanInput {
  return {
    nama: row.Nama,
    jenisBisnis: row.JenisBisnis,
    wilayah: row.Wilayah,
    pabrikLatitude: row.PabrikLatitude,
    pabrikLongitude: row.PabrikLongitude,
    pabrikAlamat: row.PabrikAlamat,
    status: row.Status,
    standaloneUrl: row.StandaloneUrl,
    kode: row.Kode,
    dbServer: row.DbServer,
    dbPort: row.DbPort,
    dbName: row.DbName,
    dbUser: row.DbUser,
    dbPassword: null, // never pre-filled — write-only field
    catatan: row.Catatan,
  };
}

// `target`: "new" for the create dialog, a PerusahaanRow for edit, null to
// stay closed. `onSubmit` now also receives the connection blocks the user
// filled in (empty array if not linked to a Postgres perusahaan, or if the
// user left every block untouched).
export function PerusahaanFormDialog({
  target,
  perusahaanDirektoriOptions,
  existingKoneksi,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  target: PerusahaanRow | "new" | null;
  perusahaanDirektoriOptions: PerusahaanDirektoriOption[];
  existingKoneksi: KoneksiRow[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: PerusahaanInput, koneksiBlocks: UpsertKoneksiInput[]) => void;
  pending: boolean;
  error: string | null;
}) {
  const initial = target === "new" ? emptyForm() : target ? rowToForm(target) : emptyForm();
  const [status, setStatus] = useState<PerusahaanStatus>(initial.status);
  const [jenisBisnis, setJenisBisnis] = useState<PerusahaanJenisBisnis>(initial.jenisBisnis === "Es Balok" ? "Es Balok" : "Es Kristal");
  const [direktoriId, setDirektoriId] = useState<number | null>(
    perusahaanDirektoriOptions.find((o) => o.kode === initial.kode)?.id ?? null
  );
  const [location, setLocation] = useState<MitraLocationValue | null>(
    initial.pabrikLatitude != null && initial.pabrikLongitude != null
      ? { latitude: initial.pabrikLatitude, longitude: initial.pabrikLongitude, alamat: initial.pabrikAlamat }
      : null
  );

  const koneksiLabels = KONEKSI_LABELS_BY_JENIS[jenisBisnis];
  const linkedKoneksi = direktoriId != null ? existingKoneksi.filter((k) => k.perusahaanId === direktoriId) : [];

  function handleSubmit(formData: FormData) {
    const kode = perusahaanDirektoriOptions.find((o) => o.id === direktoriId)?.kode ?? null;

    const koneksiBlocks: UpsertKoneksiInput[] = [];
    if (direktoriId != null) {
      for (const label of koneksiLabels) {
        const host = String(formData.get(`koneksi_${label}_host`) ?? "").trim();
        if (!host) continue; // untouched block — nothing to save
        koneksiBlocks.push({
          perusahaanId: direktoriId,
          label,
          host,
          port: Number(formData.get(`koneksi_${label}_port`) ?? 1433),
          dbName: String(formData.get(`koneksi_${label}_dbName`) ?? ""),
          dbUser: String(formData.get(`koneksi_${label}_dbUser`) ?? ""),
          dbPassword: String(formData.get(`koneksi_${label}_dbPassword`) ?? "") || null,
        });
      }
    }

    onSubmit(
      {
        nama: String(formData.get("nama") ?? ""),
        jenisBisnis,
        wilayah: String(formData.get("wilayah") ?? "") || null,
        pabrikLatitude: location?.latitude ?? null,
        pabrikLongitude: location?.longitude ?? null,
        pabrikAlamat: location?.alamat ?? null,
        status,
        standaloneUrl: String(formData.get("standaloneUrl") ?? "") || null,
        kode,
        dbServer: initial.dbServer,
        dbPort: initial.dbPort,
        dbName: initial.dbName,
        dbUser: initial.dbUser,
        dbPassword: null,
        catatan: String(formData.get("catatan") ?? "") || null,
      },
      koneksiBlocks
    );
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target === "new" ? "Tambah PT" : `Ubah PT — ${initial.nama}`}</DialogTitle>
          <DialogDescription>
            Data registry perusahaan. Tautkan ke Perusahaan (Postgres) untuk mengatur koneksi database live.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama PT</Label>
            <Input id="nama" name="nama" defaultValue={initial.nama} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Jenis Bisnis</Label>
              <Select value={jenisBisnis} onValueChange={(v) => setJenisBisnis((v as PerusahaanJenisBisnis) ?? "Es Kristal")}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PERUSAHAAN_JENIS_BISNIS.map((jb) => (
                    <SelectItem key={jb} value={jb}>
                      {jb}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wilayah">Wilayah</Label>
              <Input id="wilayah" name="wilayah" placeholder="mis. Ponorogo" defaultValue={initial.wilayah ?? ""} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus((v as PerusahaanStatus) ?? "Draft")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => STATUS_LABEL[v as PerusahaanStatus]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PERUSAHAAN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {status === "StandaloneHTML" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="standaloneUrl">URL Standalone</Label>
              <Input
                id="standaloneUrl"
                name="standaloneUrl"
                placeholder="/static/nama-pt"
                defaultValue={initial.standaloneUrl ?? ""}
                required
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Lokasi Pabrik</Label>
            <MitraLocationField value={location} onChange={setLocation} wilayah={initial.wilayah} />
          </div>

          <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Tautan &amp; Koneksi Database</legend>
            <div className="flex flex-col gap-1.5">
              <Label>Tautan ke Perusahaan (Postgres)</Label>
              <Select
                value={direktoriId != null ? String(direktoriId) : "none"}
                onValueChange={(v) => setDirektoriId(v === "none" ? null : Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {() => perusahaanDirektoriOptions.find((o) => o.id === direktoriId)?.nama ?? "Belum ditautkan"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Belum ditautkan</SelectItem>
                  {perusahaanDirektoriOptions.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.nama}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {direktoriId == null && (
              <p className="text-xs text-muted-foreground">
                Tautkan ke salah satu Perusahaan di atas untuk mengatur koneksi database.
              </p>
            )}

            {direktoriId != null &&
              koneksiLabels.map((label) => {
                const existing = linkedKoneksi.find((k) => k.label === label);
                return (
                  <div key={label} className="flex flex-col gap-2 rounded-md border p-2.5">
                    <p className="text-xs font-medium capitalize">Koneksi {label}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`koneksi_${label}_host`}>
                          Host
                        </Label>
                        <Input
                          id={`koneksi_${label}_host`}
                          name={`koneksi_${label}_host`}
                          defaultValue={existing?.host ?? ""}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`koneksi_${label}_port`}>
                          Port
                        </Label>
                        <Input
                          id={`koneksi_${label}_port`}
                          name={`koneksi_${label}_port`}
                          type="number"
                          defaultValue={existing?.port ?? 1433}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`koneksi_${label}_dbName`}>
                          Nama Database
                        </Label>
                        <Input
                          id={`koneksi_${label}_dbName`}
                          name={`koneksi_${label}_dbName`}
                          defaultValue={existing?.dbName ?? ""}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`koneksi_${label}_dbUser`}>
                          Username
                        </Label>
                        <Input
                          id={`koneksi_${label}_dbUser`}
                          name={`koneksi_${label}_dbUser`}
                          defaultValue={existing?.dbUser ?? ""}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs" htmlFor={`koneksi_${label}_dbPassword`}>
                        Password
                      </Label>
                      <Input
                        id={`koneksi_${label}_dbPassword`}
                        name={`koneksi_${label}_dbPassword`}
                        type="password"
                        placeholder={existing ? "(tidak diubah, kosongkan untuk tetap pakai yang lama)" : "wajib diisi untuk koneksi baru"}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                );
              })}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catatan">Catatan</Label>
            <Textarea id="catatan" name="catatan" rows={2} defaultValue={initial.catatan ?? ""} />
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
```

- [ ] **Step 3: Wire the new props through `perusahaan-list.tsx`**

Replace the whole file:
```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, MapPin, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PerusahaanRow, PerusahaanStatus, PerusahaanInput } from "@/lib/queries/perusahaan";
import type { PerusahaanDirektoriOption } from "@/lib/queries/akun-direktori";
import type { KoneksiRow, UpsertKoneksiInput } from "@/lib/queries/perusahaan-koneksi";
import { PerusahaanFormDialog } from "@/components/dashboard/perusahaan-form-dialog";
import {
  createPerusahaanAction,
  updatePerusahaanAction,
  deletePerusahaanAction,
  upsertKoneksiAction,
} from "@/app/grup/perusahaan/actions";

const STATUS_BADGE: Record<PerusahaanStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  StandaloneHTML: "bg-warning/15 text-warning",
  AktifPenuh: "bg-primary/15 text-primary",
};

const STATUS_LABEL: Record<PerusahaanStatus, string> = {
  Draft: "Draft",
  StandaloneHTML: "Standalone HTML",
  AktifPenuh: "Aktif Penuh",
};

export function PerusahaanList({
  rows,
  perusahaanDirektoriOptions,
  koneksi,
}: {
  rows: PerusahaanRow[];
  perusahaanDirektoriOptions: PerusahaanDirektoriOption[];
  koneksi: KoneksiRow[];
}) {
  const [target, setTarget] = useState<PerusahaanRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(input: PerusahaanInput, koneksiBlocks: UpsertKoneksiInput[]) {
    setError(null);
    startTransition(async () => {
      try {
        if (target === "new") {
          await createPerusahaanAction(input);
        } else if (target) {
          await updatePerusahaanAction(target.PerusahaanID, input);
        }
        for (const block of koneksiBlocks) {
          await upsertKoneksiAction(block);
        }
        setTarget(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan PT.");
      }
    });
  }

  function handleDelete(row: PerusahaanRow) {
    if (!confirm(`Hapus PT "${row.Nama}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    startTransition(async () => {
      try {
        await deletePerusahaanAction(row.PerusahaanID);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Gagal menghapus PT.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.length} PT terdaftar.</p>
        <Button
          onClick={() => {
            setError(null);
            setTarget("new");
          }}
        >
          <Plus className="size-4" />
          Tambah PT
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <Card key={r.PerusahaanID} className="py-3.5">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                    {r.Nama}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.JenisBisnis ?? "-"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setError(null);
                      setTarget(r);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={() => handleDelete(r)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <span className={cn("w-fit rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_BADGE[r.Status])}>
                {STATUS_LABEL[r.Status]}
              </span>

              <div className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3" /> {r.Wilayah ?? "-"}
                </span>
                <span>Tautan Postgres: {r.Kode ?? "belum ditautkan"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada PT terdaftar.</p>
        )}
      </div>

      {/* Keyed on target identity — see the original comment this replaces:
          PerusahaanFormDialog's local useState hooks only read their initial
          value once on mount, so this key forces a remount when switching
          between PTs while the dialog stays conceptually "open". */}
      <PerusahaanFormDialog
        key={target === "new" ? "new" : target ? target.PerusahaanID : "closed"}
        target={target}
        perusahaanDirektoriOptions={perusahaanDirektoriOptions}
        existingKoneksi={koneksi}
        onOpenChange={(open) => !open && setTarget(null)}
        onSubmit={handleSubmit}
        pending={pending}
        error={error}
      />
    </div>
  );
}
```

- [ ] **Step 4: Fetch the new data in `page.tsx`**

Replace the whole file:
```tsx
import { requireGrupAccess } from "@/lib/require-access";
import { listPerusahaan } from "@/lib/queries/perusahaan";
import { listPerusahaanDirektori } from "@/lib/queries/akun-direktori";
import { listAllKoneksi } from "@/lib/queries/perusahaan-koneksi";
import { PerusahaanList } from "@/components/dashboard/perusahaan-list";

export default async function PerusahaanPage() {
  await requireGrupAccess();
  const [rows, perusahaanDirektoriOptions, koneksi] = await Promise.all([
    listPerusahaan(),
    listPerusahaanDirektori(),
    listAllKoneksi(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Perusahaan</h1>
      <p className="text-sm text-muted-foreground">
        Registry PT — tautkan ke Perusahaan (Postgres) untuk mengatur koneksi database yang benar-benar dipakai
        dashboard.
      </p>
      <PerusahaanList rows={rows} perusahaanDirektoriOptions={perusahaanDirektoriOptions} koneksi={koneksi} />
    </div>
  );
}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit` — expect zero errors project-wide now (this is the task that resolves every `Kode`/`kode`-related error left over from Task 1).
Run: `npx eslint src/components/dashboard/perusahaan-form-dialog.tsx src/components/dashboard/perusahaan-list.tsx "src/app/grup/perusahaan/actions.ts" "src/app/grup/perusahaan/page.tsx"` — expect no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/perusahaan-form-dialog.tsx src/components/dashboard/perusahaan-list.tsx "src/app/grup/perusahaan/actions.ts" "src/app/grup/perusahaan/page.tsx"
git commit -m "Add Tautan & Koneksi Database section to Perusahaan admin UI"
```

---

### Task 7: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full type-check, lint, and production build**

Run: `npx tsc --noEmit` — expect zero errors project-wide.
Run: `npx eslint .` — expect zero errors (pre-existing unrelated warnings, e.g. android build artifacts, are acceptable — confirm no *new* ones).
Run: `npx next build` — expect a clean build.

- [ ] **Step 2: Regression spot-check via direct script (not browser login)**

Re-run the Task 4 verification pattern one more time against the final committed state, to catch any regression introduced by Tasks 5-6:
```ts
// scripts/verify-final.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";
import { getPmputraPool } from "../src/lib/db-pmputra";

async function main() {
  const mke = await getPool();
  const mkeResult = await mke.request().query("SELECT DB_NAME() AS dbName");
  console.log("MKEsindo pool ->", mkeResult.recordset[0].dbName, "— expect MKEsindo (or your DB_NAME value)");

  const utama = await getPmputraPool("utama");
  const utamaResult = await utama.request().query("SELECT DB_NAME() AS dbName");
  console.log("PMPutra utama pool ->", utamaResult.recordset[0].dbName, "— expect FINAC_ES_PO");

  console.log("PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
```
Run: `npx tsx scripts/verify-final.ts`, confirm `PASS`, then delete the script.

- [ ] **Step 3: Confirm no leftover throwaway scripts**

Run: `git status --short`
Expected: no untracked files under `scripts/` (every one-off verification script from Tasks 1-3, 5, and this task must already be deleted, not committed).

- [ ] **Step 4: Tell the user the residual manual check**

Per Task 4 Step 4 — recommend the user does one real login + loads `/` and `/delivery` themselves, since this plan cannot do that step (standing rule against browser-login automation). This is the one piece of end-to-end confidence this plan cannot self-certify.

- [ ] **Step 5: Update the progress ledger**

Append a new section to `.superpowers/sdd/progress.md` (same format as every prior entry in this file) summarizing: all 7 tasks complete, `DashboardPerusahaan.Kode` added and backfilled, `perusahaan_koneksi` is now the live source for both MKEsindo's and (unused-for-now) PMPutra's MSSQL connections, admin UI updated. Note explicitly that live authenticated-browser verification of `getPool()`'s real callers was not performed (standing rule), only direct-script verification — flag this as the one remaining manual check for the user.

- [ ] **Step 6: Final commit**

```bash
git add .superpowers/sdd/progress.md
git commit -m "Update progress ledger for perusahaan_koneksi live-wiring plan"
```

Do not push — per this session's established convention, push only happens on explicit user request.
