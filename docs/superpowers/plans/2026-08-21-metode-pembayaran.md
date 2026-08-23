# Configurable Per-Company Payment Methods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded, COA-only `PAYMENT_CHANNELS` list with a per-company `metode_pembayaran` table (Tunai/QRIS/Transfer, each with its own COA, mandatory-note rule, and which surfaces may offer it), consumed by one shared UI component across driver-app, kasir (Pelunasan), and the public invoice page, managed from a new admin screen.

**Architecture:** Two new Postgres tables (`metode_pembayaran`, `metode_pembayaran_snap_bi_kredensial`) plus one new MSSQL bridge table (`DashboardSalesPaymentMetode`) that records which exact channel a `SalesPayment` used (needed because `ChartOfAccountID` alone is now ambiguous between Transfer and QRIS Statis sharing a bank account). A shared `QrPaymentPanel` React component reads active rows for a `(perusahaanId, konteks)` pair and renders the right tabs/sub-choices/validation; `recordPayment()` and the driver-app payment action both resolve a channel by its `kode` instead of taking a raw COA id.

**Tech Stack:** Next.js server actions, `pg` (Postgres, `perusahaan`/directory DB), `mssql` (MKEsindo ERP DB), existing `encryptSecret`/`decryptSecret` (AES), existing per-company Google Drive upload (`uploadFile()`).

**Spec:** `docs/superpowers/specs/2026-08-21-metode-pembayaran-design.md`

## Global Constraints

- `wajib_catatan` is validated server-side inside the payment-recording function itself — never trusted from the client alone.
- `metode_pembayaran` rows are soft-deactivated (`is_active = false`) only, never hard-deleted — `DashboardSalesPaymentMetode.MetodeKode` references a `kode` by value.
- `UNIQUE (perusahaan_id, kode)` on `metode_pembayaran`, plus a partial unique index allowing at most one active `jenis = 'qris_dinamis'` row per company.
- A row cannot be set `jenis = 'qris_dinamis', is_active = true` unless that company already has a complete `metode_pembayaran_snap_bi_kredensial` row — enforced in the upsert function, not just hidden in the UI.
- QRIS Statis images are JPEG/PNG/WEBP only (5MB cap), stored via the existing per-company Google Drive integration (`uploadFile()` in `src/lib/storage/google-drive.ts`) — never SVG.
- `coa_id` on a `metode_pembayaran` row is always picked from that company's real `ChartOfAccount` (MSSQL) via a combobox, never typed freely.
- All new Postgres queries go through `getPgPool()` (`src/lib/pg.ts`), matching every other `perusahaan_*` query file. All new MSSQL queries go through `getPool()` (`src/lib/db.ts`), matching every other dashboard query.

---

### Task 1: Postgres schema — `metode_pembayaran` + `metode_pembayaran_snap_bi_kredensial`

**Files:**
- Create: `scripts/create-metode-pembayaran-tables.ts`

**Interfaces:**
- Produces: two Postgres tables later tasks read/write via `getPgPool()`.

- [ ] **Step 1: Write the migration script**

Mirrors `scripts/create-gdrive-koneksi-table.ts`'s exact shape (raw `pg` `Client` against the directory DB, idempotent `CREATE TABLE IF NOT EXISTS`), but this table lives in the same Postgres database the rest of the app already uses via `getPgPool()` — so use that instead of a raw `Client`, matching `scripts/migrate-akun-lokasi.ts`'s convention for tables in that same database.

```typescript
// One-off table creation for metode_pembayaran + metode_pembayaran_snap_bi_kredensial.
// Idempotent — safe to re-run. Usage: npx tsx scripts/create-metode-pembayaran-tables.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pool = getPgPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metode_pembayaran (
      id SERIAL PRIMARY KEY,
      perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
      kode VARCHAR(64) NOT NULL,
      metode VARCHAR(16) NOT NULL CHECK (metode IN ('TUNAI', 'QRIS', 'TRANSFER')),
      jenis VARCHAR(16) NOT NULL CHECK (jenis IN ('manual', 'qris_static', 'qris_dinamis')),
      coa_id VARCHAR(16) NOT NULL,
      konteks TEXT[] NOT NULL,
      wajib_catatan BOOLEAN NOT NULL DEFAULT false,
      catatan TEXT,
      qris_statis_image_path TEXT,
      urutan INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (perusahaan_id, kode)
    )
  `);

  // Partial unique index: at most one ACTIVE qris_dinamis row per company —
  // matches Bank Mandiri's own one-merchant-account-per-PT reality.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS metode_pembayaran_one_qris_dinamis_per_pt
    ON metode_pembayaran (perusahaan_id)
    WHERE jenis = 'qris_dinamis' AND is_active
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metode_pembayaran_snap_bi_kredensial (
      perusahaan_id INTEGER PRIMARY KEY REFERENCES perusahaan(id) ON DELETE CASCADE,
      client_id VARCHAR(255) NOT NULL,
      client_secret_encrypted VARCHAR(512) NOT NULL,
      merchant_id VARCHAR(128) NOT NULL,
      partner_id VARCHAR(128) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  console.log("metode_pembayaran + metode_pembayaran_snap_bi_kredensial ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the real directory DB**

Run: `npx tsx scripts/create-metode-pembayaran-tables.ts`
Expected output: `metode_pembayaran + metode_pembayaran_snap_bi_kredensial ready.`

- [ ] **Step 3: Verify both tables exist with a read-only check**

Run a one-off check (delete after): create `scripts/_verify-metode-tables.ts` with
```typescript
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";
async function main() {
  const pool = getPgPool();
  const r = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('metode_pembayaran', 'metode_pembayaran_snap_bi_kredensial')`);
  console.log(r.rows);
  process.exit(0);
}
main();
```
Run: `npx tsx scripts/_verify-metode-tables.ts` — expect both table names printed. Delete `scripts/_verify-metode-tables.ts` afterward (diagnostic only, not committed).

- [ ] **Step 4: Commit**

```bash
git add scripts/create-metode-pembayaran-tables.ts
git commit -m "feat: add metode_pembayaran + snap_bi_kredensial Postgres tables"
```

---

### Task 2: MSSQL schema — `DashboardSalesPaymentMetode`

**Files:**
- Create: `scripts/create-dashboard-sales-payment-metode-table.ts`

**Interfaces:**
- Produces: one MSSQL table, `DashboardSalesPaymentMetode(SalesPaymentID, MetodeKode, Catatan, CreatedDate)`, that Task 5's `recordPayment()`/driver-app payment writes insert into.

- [ ] **Step 1: Write the migration script**

MSSQL has no `CREATE TABLE IF NOT EXISTS` — use the `IF NOT EXISTS (SELECT * FROM sysobjects ...)` idiom, and reuse this app's own `getPool()` (same pattern as `scripts/seed-dashboard-auth.ts`).

```typescript
// One-off table creation for DashboardSalesPaymentMetode (MKEsindo MSSQL).
// Idempotent — safe to re-run. Usage: npx tsx scripts/create-dashboard-sales-payment-metode-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSalesPaymentMetode' AND xtype='U')
    CREATE TABLE DashboardSalesPaymentMetode (
      SalesPaymentID   VARCHAR(16)  NOT NULL PRIMARY KEY,
      MetodeKode       VARCHAR(64)  NOT NULL,
      Catatan          VARCHAR(500) NULL,
      CreatedDate      DATETIME     NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log("DashboardSalesPaymentMetode ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/create-dashboard-sales-payment-metode-table.ts`
Expected output: `DashboardSalesPaymentMetode ready.`

- [ ] **Step 3: Verify**

Run a throwaway check querying `SELECT TOP 1 * FROM DashboardSalesPaymentMetode` via `getPool()` in a `_tmp` script the same way Task 1 verified — expect it to succeed with zero rows (not throw "invalid object name"). Delete the throwaway script afterward.

- [ ] **Step 4: Commit**

```bash
git add scripts/create-dashboard-sales-payment-metode-table.ts
git commit -m "feat: add DashboardSalesPaymentMetode MSSQL bridge table"
```

---

### Task 3: Postgres query layer — `metode-pembayaran.ts`

**Files:**
- Create: `src/lib/queries/metode-pembayaran.ts`

**Interfaces:**
- Consumes: `getPgPool()` (`src/lib/pg.ts`), `encryptSecret`/`decryptSecret` (`src/lib/crypto-secret.ts`).
- Produces:
  - `type Konteks = "driver" | "kasir" | "publik"`
  - `interface MetodePembayaranRow { id: number; perusahaanId: number; kode: string; metode: "TUNAI" | "QRIS" | "TRANSFER"; jenis: "manual" | "qris_static" | "qris_dinamis"; coaId: string; konteks: Konteks[]; wajibCatatan: boolean; catatan: string | null; qrisStatisImagePath: string | null; urutan: number; isActive: boolean; }`
  - `listMetodePembayaran(perusahaanId: number): Promise<MetodePembayaranRow[]>` — every row (active and inactive), for the admin dialog.
  - `listActiveMetodePembayaran(perusahaanId: number, konteks: Konteks): Promise<MetodePembayaranRow[]>` — only `is_active = true` rows whose `konteks` array contains the given konteks, for `QrPaymentPanel`.
  - `getMetodePembayaranByKode(perusahaanId: number, kode: string): Promise<MetodePembayaranRow | null>` — for server-side resolution inside `recordPayment()`/driver-app payment.
  - `getMetodePembayaranById(id: number): Promise<(MetodePembayaranRow & { perusahaanKode: string }) | null>` — for the admin image-upload action (Task 8), which only has the row's numeric `id` and needs both its `perusahaanId` (ownership check) and the human-readable `perusahaanKode` `uploadFile()` requires.
  - `interface UpsertMetodePembayaranInput { id?: number; perusahaanId: number; kode: string; metode: MetodePembayaranRow["metode"]; jenis: MetodePembayaranRow["jenis"]; coaId: string; konteks: Konteks[]; wajibCatatan: boolean; catatan: string | null; urutan: number; isActive: boolean; }`
  - `upsertMetodePembayaran(input: UpsertMetodePembayaranInput): Promise<number>` — returns the row id. Throws `AppError` if `jenis === 'qris_dinamis' && isActive` and no Snap BI credential row exists for `perusahaanId`.
  - `setQrisStatisImagePath(id: number, path: string): Promise<void>`
  - `interface SnapBiKredensial { clientId: string; merchantId: string; partnerId: string; }` (never exposes the decrypted secret to callers that don't need it)
  - `getSnapBiKredensial(perusahaanId: number): Promise<(SnapBiKredensial & { clientSecret: string }) | null>` — decrypted, for the (future, Task-10-deferred) Snap BI call itself.
  - `hasSnapBiKredensial(perusahaanId: number): Promise<boolean>` — used by `upsertMetodePembayaran`'s guard.
  - `interface UpsertSnapBiKredensialInput { perusahaanId: number; clientId: string; clientSecret: string; merchantId: string; partnerId: string; }`
  - `upsertSnapBiKredensial(input: UpsertSnapBiKredensialInput): Promise<void>`

- [ ] **Step 1: Write the file**

```typescript
import { getPgPool } from "@/lib/pg";
import { encryptSecret, decryptSecret } from "@/lib/crypto-secret";
import { AppError } from "@/lib/action-result";

export type Konteks = "driver" | "kasir" | "publik";

export interface MetodePembayaranRow {
  id: number;
  perusahaanId: number;
  kode: string;
  metode: "TUNAI" | "QRIS" | "TRANSFER";
  jenis: "manual" | "qris_static" | "qris_dinamis";
  coaId: string;
  konteks: Konteks[];
  wajibCatatan: boolean;
  catatan: string | null;
  qrisStatisImagePath: string | null;
  urutan: number;
  isActive: boolean;
}

interface MetodePembayaranDbRow {
  id: number;
  perusahaan_id: number;
  kode: string;
  metode: string;
  jenis: string;
  coa_id: string;
  konteks: string[];
  wajib_catatan: boolean;
  catatan: string | null;
  qris_statis_image_path: string | null;
  urutan: number;
  is_active: boolean;
}

function mapRow(r: MetodePembayaranDbRow): MetodePembayaranRow {
  return {
    id: r.id,
    perusahaanId: r.perusahaan_id,
    kode: r.kode,
    metode: r.metode as MetodePembayaranRow["metode"],
    jenis: r.jenis as MetodePembayaranRow["jenis"],
    coaId: r.coa_id,
    konteks: r.konteks as Konteks[],
    wajibCatatan: r.wajib_catatan,
    catatan: r.catatan,
    qrisStatisImagePath: r.qris_statis_image_path,
    urutan: r.urutan,
    isActive: r.is_active,
  };
}

const SELECT_COLUMNS = `id, perusahaan_id, kode, metode, jenis, coa_id, konteks, wajib_catatan, catatan, qris_statis_image_path, urutan, is_active`;

export async function listMetodePembayaran(perusahaanId: number): Promise<MetodePembayaranRow[]> {
  const pool = getPgPool();
  const result = await pool.query<MetodePembayaranDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM metode_pembayaran WHERE perusahaan_id = $1 ORDER BY urutan, kode`,
    [perusahaanId]
  );
  return result.rows.map(mapRow);
}

// Active rows for one surface — QrPaymentPanel's only read path. `= ANY`
// against a text[] column is Postgres's "array contains this element" test.
export async function listActiveMetodePembayaran(perusahaanId: number, konteks: Konteks): Promise<MetodePembayaranRow[]> {
  const pool = getPgPool();
  const result = await pool.query<MetodePembayaranDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM metode_pembayaran
     WHERE perusahaan_id = $1 AND is_active AND $2 = ANY(konteks)
     ORDER BY urutan, kode`,
    [perusahaanId, konteks]
  );
  return result.rows.map(mapRow);
}

export async function getMetodePembayaranByKode(perusahaanId: number, kode: string): Promise<MetodePembayaranRow | null> {
  const pool = getPgPool();
  const result = await pool.query<MetodePembayaranDbRow>(
    `SELECT ${SELECT_COLUMNS} FROM metode_pembayaran WHERE perusahaan_id = $1 AND kode = $2`,
    [perusahaanId, kode]
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

// Joins in perusahaan.kode — uploadFile() (Google Drive storage) is keyed by
// that human-readable code, not the numeric perusahaan_id this table itself
// uses, so the QRIS-image upload action (Task 8) needs both from one lookup.
export async function getMetodePembayaranById(id: number): Promise<(MetodePembayaranRow & { perusahaanKode: string }) | null> {
  const pool = getPgPool();
  const result = await pool.query<MetodePembayaranDbRow & { perusahaan_kode: string }>(
    `SELECT mp.id, mp.perusahaan_id, mp.kode, mp.metode, mp.jenis, mp.coa_id, mp.konteks, mp.wajib_catatan,
            mp.catatan, mp.qris_statis_image_path, mp.urutan, mp.is_active, p.kode AS perusahaan_kode
     FROM metode_pembayaran mp
     JOIN perusahaan p ON p.id = mp.perusahaan_id
     WHERE mp.id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...mapRow(row), perusahaanKode: row.perusahaan_kode };
}

export async function hasSnapBiKredensial(perusahaanId: number): Promise<boolean> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT 1 FROM metode_pembayaran_snap_bi_kredensial WHERE perusahaan_id = $1`, [perusahaanId]);
  return result.rowCount! > 0;
}

export interface UpsertMetodePembayaranInput {
  id?: number;
  perusahaanId: number;
  kode: string;
  metode: MetodePembayaranRow["metode"];
  jenis: MetodePembayaranRow["jenis"];
  coaId: string;
  konteks: Konteks[];
  wajibCatatan: boolean;
  catatan: string | null;
  urutan: number;
  isActive: boolean;
}

export async function upsertMetodePembayaran(input: UpsertMetodePembayaranInput): Promise<number> {
  if (input.jenis === "qris_dinamis" && input.isActive) {
    const hasCreds = await hasSnapBiKredensial(input.perusahaanId);
    if (!hasCreds) {
      throw new AppError("QRIS Dinamis tidak bisa diaktifkan sebelum kredensial Snap BI PT ini diisi lengkap.");
    }
  }

  const pool = getPgPool();
  if (input.id) {
    await pool.query(
      `UPDATE metode_pembayaran SET
         kode = $1, metode = $2, jenis = $3, coa_id = $4, konteks = $5,
         wajib_catatan = $6, catatan = $7, urutan = $8, is_active = $9, updated_at = now()
       WHERE id = $10 AND perusahaan_id = $11`,
      [
        input.kode, input.metode, input.jenis, input.coaId, input.konteks,
        input.wajibCatatan, input.catatan, input.urutan, input.isActive, input.id, input.perusahaanId,
      ]
    );
    return input.id;
  }

  const result = await pool.query<{ id: number }>(
    `INSERT INTO metode_pembayaran
       (perusahaan_id, kode, metode, jenis, coa_id, konteks, wajib_catatan, catatan, urutan, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.perusahaanId, input.kode, input.metode, input.jenis, input.coaId, input.konteks,
      input.wajibCatatan, input.catatan, input.urutan, input.isActive,
    ]
  );
  return result.rows[0].id;
}

export async function setQrisStatisImagePath(id: number, path: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE metode_pembayaran SET qris_statis_image_path = $1, updated_at = now() WHERE id = $2`, [path, id]);
}

export interface SnapBiKredensial {
  clientId: string;
  merchantId: string;
  partnerId: string;
}

export async function getSnapBiKredensial(perusahaanId: number): Promise<(SnapBiKredensial & { clientSecret: string }) | null> {
  const pool = getPgPool();
  const result = await pool.query<{ client_id: string; client_secret_encrypted: string; merchant_id: string; partner_id: string }>(
    `SELECT client_id, client_secret_encrypted, merchant_id, partner_id FROM metode_pembayaran_snap_bi_kredensial WHERE perusahaan_id = $1`,
    [perusahaanId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    clientId: row.client_id,
    clientSecret: decryptSecret(row.client_secret_encrypted),
    merchantId: row.merchant_id,
    partnerId: row.partner_id,
  };
}

export interface UpsertSnapBiKredensialInput {
  perusahaanId: number;
  clientId: string;
  clientSecret: string;
  merchantId: string;
  partnerId: string;
}

export async function upsertSnapBiKredensial(input: UpsertSnapBiKredensialInput): Promise<void> {
  const pool = getPgPool();
  const encrypted = encryptSecret(input.clientSecret);
  await pool.query(
    `INSERT INTO metode_pembayaran_snap_bi_kredensial (perusahaan_id, client_id, client_secret_encrypted, merchant_id, partner_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (perusahaan_id) DO UPDATE
     SET client_id = EXCLUDED.client_id, client_secret_encrypted = EXCLUDED.client_secret_encrypted,
         merchant_id = EXCLUDED.merchant_id, partner_id = EXCLUDED.partner_id, updated_at = now()`,
    [input.perusahaanId, input.clientId, encrypted, input.merchantId, input.partnerId]
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` (filter out `.next/` noise). Expected: no errors from this file.

- [ ] **Step 3: Manual smoke test**

Write a throwaway `scripts/_tmp-smoke-metode.ts` that calls `upsertMetodePembayaran` with a real MKEsindo `perusahaanId` (look it up via `SELECT id FROM perusahaan WHERE kode='mkesindo'`) and `kode: 'test-smoke'`, then `listMetodePembayaran`, prints the result, then deletes the row (`DELETE FROM metode_pembayaran WHERE kode='test-smoke'`) so nothing test-only is left behind. Run: `npx tsx scripts/_tmp-smoke-metode.ts`. Expected: the row appears in the list with correct field mapping, then is cleaned up. Delete the throwaway script afterward.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/metode-pembayaran.ts
git commit -m "feat: add metode_pembayaran Postgres query layer"
```

---

### Task 4: Seed MKEsindo's 5 confirmed rows

**Files:**
- Create: `scripts/seed-metode-pembayaran-mkesindo.ts`

**Interfaces:**
- Consumes: `upsertMetodePembayaran` (Task 3).

- [ ] **Step 1: Write the seed script**

Uses the exact 5-row table from the design spec. `coaId` values are the same 3 real `ChartOfAccountID`s `PAYMENT_CHANNELS` already used (`014`, `013`, `01000096`) — confirmed production values, not guesses.

```typescript
// One-off seed for MKEsindo's initial metode_pembayaran rows.
// Safe to re-run — upsertMetodePembayaran creates by kode if it doesn't
// already exist for this perusahaan_id (no explicit `id`, so INSERT path).
// Usage: npx tsx scripts/seed-metode-pembayaran-mkesindo.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";
import { upsertMetodePembayaran, listMetodePembayaran, type Konteks } from "../src/lib/queries/metode-pembayaran";

async function main() {
  const pool = getPgPool();
  const perusahaan = await pool.query<{ id: number }>(`SELECT id FROM perusahaan WHERE kode = 'mkesindo'`);
  const perusahaanId = perusahaan.rows[0]?.id;
  if (!perusahaanId) throw new Error("perusahaan kode='mkesindo' tidak ditemukan.");

  const existing = await listMetodePembayaran(perusahaanId);
  const existingKodes = new Set(existing.map((r) => r.kode));

  const seeds: {
    kode: string;
    metode: "TUNAI" | "QRIS" | "TRANSFER";
    jenis: "manual" | "qris_static" | "qris_dinamis";
    coaId: string;
    konteks: Konteks[];
    wajibCatatan: boolean;
  }[] = [
    { kode: "tunai-kecil", metode: "TUNAI", jenis: "manual", coaId: "014", konteks: ["driver", "kasir"], wajibCatatan: false },
    { kode: "tunai-besar", metode: "TUNAI", jenis: "manual", coaId: "013", konteks: ["kasir"], wajibCatatan: false },
    { kode: "transfer", metode: "TRANSFER", jenis: "manual", coaId: "01000096", konteks: ["driver", "kasir"], wajibCatatan: true },
    { kode: "qris-statis", metode: "QRIS", jenis: "qris_static", coaId: "01000096", konteks: ["driver", "kasir", "publik"], wajibCatatan: true },
    { kode: "qris-dinamis", metode: "QRIS", jenis: "qris_dinamis", coaId: "01000096", konteks: ["driver", "kasir", "publik"], wajibCatatan: false },
  ];

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    if (existingKodes.has(s.kode)) {
      console.log(`skip (already exists): ${s.kode}`);
      continue;
    }
    // qris-dinamis starts inactive — MKEsindo has no Snap BI credentials yet
    // (upsertMetodePembayaran would reject isActive:true here anyway).
    const isActive = s.jenis !== "qris_dinamis";
    await upsertMetodePembayaran({ perusahaanId, ...s, catatan: null, urutan: i, isActive });
    console.log(`seeded: ${s.kode}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/seed-metode-pembayaran-mkesindo.ts`
Expected: 4 rows print `seeded: ...` (tunai-kecil, tunai-besar, transfer, qris-statis) and `qris-dinamis` seeds as inactive (no Snap BI credentials exist yet, matching the design's "invisible until configured" rule).

- [ ] **Step 3: Verify against the real table**

Re-run the same script — expected every row now prints `skip (already exists): ...`, confirming idempotency.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-metode-pembayaran-mkesindo.ts
git commit -m "feat: seed MKEsindo's initial metode_pembayaran rows"
```

---

### Task 5: COA picker query + update payment-recording to resolve by `kode`

**Files:**
- Create: `src/lib/queries/chart-of-account.ts`
- Modify: `src/lib/pelunasan-types.ts`
- Modify: `src/lib/queries/pelunasan.ts`

**Interfaces:**
- Produces: `interface ChartOfAccountOption { id: string; name: string }`, `getChartOfAccountOptions(): Promise<ChartOfAccountOption[]>` (MSSQL, for the admin COA combobox — Task 7).
- Consumes: `getMetodePembayaranByKode` (Task 3).
- Produces: `RecordPaymentInput` now takes `metodePembayaranKode: string` instead of `chartOfAccountId: PaymentChannelId`; `recordPayment()` resolves the COA and validates `wajibCatatan` itself.

- [ ] **Step 1: Write the COA options query**

```typescript
// src/lib/queries/chart-of-account.ts
import { getPool, sql } from "@/lib/db";

export interface ChartOfAccountOption {
  id: string;
  name: string;
}

// Feeds the admin "Kelola Pembayaran" dialog's coa_id combobox — real MSSQL
// accounts only, never typed freely.
export async function getChartOfAccountOptions(): Promise<ChartOfAccountOption[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ChartOfAccountID, Name FROM ChartOfAccount WHERE ISNULL(IsDeleted, 0) = 0 ORDER BY ChartOfAccountID
  `);
  return (result.recordset as { ChartOfAccountID: string; Name: string }[]).map((r) => ({ id: r.ChartOfAccountID, name: r.Name }));
}
```

(No `sql` import is actually needed here since there's no parameterized input — remove the unused `sql` import if `tsc`/`eslint` flags it.)

- [ ] **Step 2: Update `pelunasan-types.ts`**

Replace the hardcoded channel union with the new `kode`-based shape.

```typescript
// src/lib/pelunasan-types.ts — replace the whole file's channel section
export interface PaymentAllocationInput {
  salesInvoiceId: string;
  amount: number;
}

export interface RecordPaymentInput {
  businessPartnerId: string;
  perusahaanId: number;
  metodePembayaranKode: string;
  allocations: PaymentAllocationInput[];
  notes?: string;
}

export interface RecordPaymentResult {
  salesPaymentId: string;
  voucherNo: string;
  totalAmount: number;
  totalDeposit: number;
}
```

Delete `PAYMENT_CHANNELS` and `PaymentChannelId` entirely — every remaining reference is fixed in Tasks 6, 9, and 10.

- [ ] **Step 3: Update `recordPayment()`**

Insert the resolution + validation at the top of the function, and write the bridge-table row after the existing `SalesPaymentDetail` loop, inside the same sequence of calls (this function doesn't wrap its writes in an explicit `sql.Transaction` today — match that existing style, don't introduce a new pattern here).

```typescript
// src/lib/queries/pelunasan.ts — add these imports
import { getMetodePembayaranByKode } from "@/lib/queries/metode-pembayaran";

// Inside recordPayment(), right after the `allocations` empty-check and
// before `const pool = await getPool();`:
const metode = await getMetodePembayaranByKode(input.perusahaanId, input.metodePembayaranKode);
if (!metode || !metode.isActive) {
  throw new AppError("Metode pembayaran tidak ditemukan atau sudah tidak aktif.");
}
if (metode.wajibCatatan && !input.notes?.trim()) {
  throw new AppError("Catatan wajib diisi untuk metode pembayaran ini.");
}
```

Change the `SalesPayment` INSERT's `chartOfAccountId`/`coaId` input to `metode.coaId` instead of `input.chartOfAccountId`. After the existing `for (const alloc of allocations) { ... }` loop finishes (all `SalesPaymentDetail` rows inserted), add:

```typescript
await pool
  .request()
  .input("spId", sql.VarChar(16), salesPaymentId)
  .input("metodeKode", sql.VarChar(64), input.metodePembayaranKode)
  .input("catatan", sql.VarChar(500), input.notes ?? null)
  .query(`INSERT INTO DashboardSalesPaymentMetode (SalesPaymentID, MetodeKode, Catatan) VALUES (@spId, @metodeKode, @catatan)`);
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) — expect errors at every call site that still passes `chartOfAccountId` (Task 6's driver-app action, Task 9's driver-app `PembayaranStep`, and Task 10's kasir `PelunasanDialog`/`recordPaymentAction` fix those; this step just confirms the compiler has found them all — do not fix them here, that would step outside this task's scope).
Run: `npx eslint src/lib/pelunasan-types.ts src/lib/queries/pelunasan.ts src/lib/queries/chart-of-account.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/chart-of-account.ts src/lib/pelunasan-types.ts src/lib/queries/pelunasan.ts
git commit -m "feat: resolve payment recording through metode_pembayaran instead of a hardcoded COA list"
```

---

### Task 6: Driver-app payment action — same `kode`-based resolution

**Files:**
- Modify: `src/app/mkesindo/driver-app/actions.ts` (locate `recordDriverPaymentAction` and its underlying call)

**Interfaces:**
- Consumes: updated `RecordPaymentInput` (Task 5).

- [ ] **Step 1: Read the current action**

Run: `grep -n "recordDriverPaymentAction" -A 15 src/app/mkesindo/driver-app/actions.ts` to see its exact current signature and how it derives `businessPartnerId`/session before editing — it currently calls `recordPayment` with a hardcoded `chartOfAccountId: "014"` sourced from `pembayaran-step.tsx`'s `handleTunai`.

- [ ] **Step 2: Update its input type and pass-through**

Change `recordDriverPaymentAction`'s parameter type to accept `metodePembayaranKode: string` instead of `chartOfAccountId`, and pass the driver's own `session.user.perusahaanId` through as `perusahaanId` when calling `recordPayment()` — mirror however this file already resolves the session (it already gates via `requireDriver()`/`auth()` elsewhere in this file, per the upload route's own `requireDriver()` pattern).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` — expected: the only remaining error is `pembayaran-step.tsx`'s call site, fixed in Task 8.

- [ ] **Step 4: Commit**

```bash
git add src/app/mkesindo/driver-app/actions.ts
git commit -m "feat: driver-app payment action resolves channel by metode_pembayaran kode"
```

---

### Task 7: Shared `QrPaymentPanel` component

**Files:**
- Create: `src/components/dashboard/qr-payment-panel.tsx`
- Create: `src/app/mkesindo/actions/metode-pembayaran.ts` (a shared, route-agnostic server action file all three surfaces import from — driver-app, kasir, and the public invoice page live under different route groups, so this can't live inside any one of their own `actions.ts` files)

**Interfaces:**
- Consumes: `listActiveMetodePembayaran` (Task 3).
- Produces: `getActiveMetodePembayaranAction(perusahaanId: number, konteks: Konteks): Promise<MetodePembayaranRow[]>` (read-only, no auth gate beyond what's already implicit — this only exposes which payment channels exist, not any sensitive data); `<QrPaymentPanel perusahaanId={number} konteks={Konteks} amount={number} onSubmit?={(input: { metodeKode: string; catatan: string | null }) => Promise<void>} />`.

- [ ] **Step 1: Write the shared action**

```typescript
// src/app/mkesindo/actions/metode-pembayaran.ts
"use server";

import { listActiveMetodePembayaran, type Konteks, type MetodePembayaranRow } from "@/lib/queries/metode-pembayaran";

export async function getActiveMetodePembayaranAction(perusahaanId: number, konteks: Konteks): Promise<MetodePembayaranRow[]> {
  return listActiveMetodePembayaran(perusahaanId, konteks);
}
```

- [ ] **Step 2: Write `QrPaymentPanel`**

```typescript
"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getActiveMetodePembayaranAction } from "@/app/mkesindo/actions/metode-pembayaran";
import type { Konteks, MetodePembayaranRow } from "@/lib/queries/metode-pembayaran";
import { formatRupiah } from "@/lib/format";

export function QrPaymentPanel({
  perusahaanId,
  konteks,
  amount,
  onSubmit,
}: {
  perusahaanId: number;
  konteks: Konteks;
  amount: number;
  // Omit for konteks="publik" — that surface is read-only, no form.
  onSubmit?: (input: { metodeKode: string; catatan: string | null }) => Promise<void>;
}) {
  const [rows, setRows] = useState<MetodePembayaranRow[] | null>(null);
  const [selectedMetode, setSelectedMetode] = useState<MetodePembayaranRow["metode"] | null>(null);
  const [selectedKode, setSelectedKode] = useState<string | null>(null);
  const [catatan, setCatatan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getActiveMetodePembayaranAction(perusahaanId, konteks).then((data) => {
      if (cancelled) return;
      setRows(data);
      const firstMetode = data[0]?.metode ?? null;
      setSelectedMetode(firstMetode);
      const firstRow = data.find((r) => r.metode === firstMetode) ?? null;
      setSelectedKode(firstRow?.kode ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [perusahaanId, konteks]);

  const metodeOptions = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.metode))), [rows]);
  const jenisOptionsForSelectedMetode = useMemo(
    () => (rows ?? []).filter((r) => r.metode === selectedMetode),
    [rows, selectedMetode]
  );
  const selectedRow = (rows ?? []).find((r) => r.kode === selectedKode) ?? null;

  if (rows === null) return <p className="text-sm text-muted-foreground">Memuat metode pembayaran...</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Belum ada metode pembayaran tersedia.</p>;

  async function handleSubmit() {
    if (!selectedRow || !onSubmit) return;
    if (selectedRow.wajibCatatan && !catatan.trim()) {
      setError("Catatan wajib diisi untuk metode ini.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ metodeKode: selectedRow.kode, catatan: catatan.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan pembayaran.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={selectedMetode ?? undefined}
        onValueChange={(v) => {
          setSelectedMetode(v as MetodePembayaranRow["metode"]);
          const first = (rows ?? []).find((r) => r.metode === v);
          setSelectedKode(first?.kode ?? null);
        }}
      >
        <TabsList>
          {metodeOptions.map((m) => (
            <TabsTrigger key={m} value={m}>
              {m}
            </TabsTrigger>
          ))}
        </TabsList>
        {metodeOptions.map((m) => (
          <TabsContent key={m} value={m} className="flex flex-col gap-3 pt-3">
            {jenisOptionsForSelectedMetode.length > 1 && (
              <div className="flex gap-2">
                {jenisOptionsForSelectedMetode.map((r) => (
                  <Button
                    key={r.kode}
                    type="button"
                    size="sm"
                    variant={selectedKode === r.kode ? "default" : "outline"}
                    onClick={() => setSelectedKode(r.kode)}
                  >
                    {r.jenis === "qris_static" ? "QRIS Statis" : r.jenis === "qris_dinamis" ? "QRIS Dinamis" : r.kode}
                  </Button>
                ))}
              </div>
            )}

            {selectedRow?.jenis === "qris_static" && selectedRow.qrisStatisImagePath && (
              // eslint-disable-next-line @next/next/no-img-element -- served via Google Drive proxy path, not a static build asset
              <img src={selectedRow.qrisStatisImagePath} alt="QRIS" className="mx-auto h-56 w-56 object-contain" />
            )}
            {selectedRow?.jenis === "qris_dinamis" && (
              <p className="text-sm text-muted-foreground">QR Dinamis untuk {formatRupiah(amount)} akan tampil di sini.</p>
            )}

            {onSubmit && selectedRow && (
              <>
                {selectedRow.wajibCatatan && (
                  <textarea
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                    rows={2}
                    placeholder="Catatan (wajib) — mis. nomor referensi transfer"
                    value={catatan}
                    onChange={(e) => setCatatan(e.target.value)}
                  />
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Menyimpan..." : "Konfirmasi Pembayaran"}
                </Button>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Verify `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` exist**

Run: `ls src/components/ui/tabs.tsx` (this codebase's shadcn/ui setup — confirm the import path matches; if the component doesn't exist yet, check `src/components/ui/` for the actual name before assuming `tabs.tsx`).

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/components/dashboard/qr-payment-panel.tsx src/app/mkesindo/actions/metode-pembayaran.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/qr-payment-panel.tsx src/app/mkesindo/actions/metode-pembayaran.ts
git commit -m "feat: add shared QrPaymentPanel component"
```

---

### Task 8: Admin `PaymentMethodDialog` on `/grup/perusahaan`

**Files:**
- Create: `src/components/dashboard/payment-method-dialog.tsx`
- Modify: `src/app/grup/perusahaan/actions.ts` (or wherever `upsertKoneksiAction` etc. live for this route — check `src/components/dashboard/perusahaan-list.tsx`'s existing import to find the exact actions file path)
- Modify: `src/components/dashboard/perusahaan-list.tsx` (add the "Kelola Pembayaran" trigger button + render `PaymentMethodDialog`)
- Modify: `src/app/grup/perusahaan/page.tsx` (pass through whatever new server-fetched data the dialog needs, e.g. `getChartOfAccountOptions()` if fetched once at page level rather than per-dialog-open)

**Interfaces:**
- Consumes: `listMetodePembayaran`, `upsertMetodePembayaran`, `getMetodePembayaranById`, `setQrisStatisImagePath`, `getSnapBiKredensial` (client-safe subset only — never send `clientSecret` to the browser), `upsertSnapBiKredensial` (Task 3), `getChartOfAccountOptions` (Task 5), `uploadFile` (`src/lib/storage/google-drive.ts`, already used by driver-app/satpam uploads).
- Produces: `listMetodePembayaranAction`, `upsertMetodePembayaranAction`, `uploadQrisStatisImageAction`, `getSnapBiKredensialStatusAction` (returns only `{ configured: boolean; clientId: string; merchantId: string; partnerId: string } | null` — no secret), `upsertSnapBiKredensialAction`.

- [ ] **Step 1: Find the exact actions file and gate pattern**

Run: `grep -n "requireGrupAccess\|upsertKoneksiAction" src/app/grup/perusahaan/actions.ts` (or wherever `perusahaan-list.tsx` imports `upsertKoneksiAction` from) to confirm the exact file path and the exact gate function name/import before adding new actions — don't guess the path.

- [ ] **Step 2: Add the new actions**, gated identically to the existing Koneksi actions in that file:

```typescript
export async function listMetodePembayaranAction(perusahaanId: number): Promise<ActionResult<MetodePembayaranRow[]>> {
  return runAction(async () => {
    await requireGrupAccess();
    return listMetodePembayaran(perusahaanId);
  });
}

export async function upsertMetodePembayaranAction(input: UpsertMetodePembayaranInput): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireGrupAccess();
    const id = await upsertMetodePembayaran(input);
    revalidatePath("/grup/perusahaan");
    return id;
  });
}

export async function uploadQrisStatisImageAction(formData: FormData): Promise<ActionResult<string>> {
  return runAction(async () => {
    await requireGrupAccess();
    const file = formData.get("file");
    const metodeIdRaw = formData.get("metodeId");
    if (!(file instanceof File)) throw new AppError("File tidak ditemukan.");
    if (typeof metodeIdRaw !== "string" || !metodeIdRaw.trim()) throw new AppError("metodeId wajib diisi.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new AppError("Format file harus JPG, PNG, atau WEBP.");
    if (file.size > 5 * 1024 * 1024) throw new AppError("Ukuran file maksimal 5MB.");

    const metodeId = Number(metodeIdRaw);
    const metode = await getMetodePembayaranById(metodeId);
    if (!metode) throw new AppError("Metode pembayaran tidak ditemukan.");
    if (metode.jenis !== "qris_static") throw new AppError("Upload gambar hanya berlaku untuk metode QRIS Statis.");

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const bytes = await file.arrayBuffer();
    const uploaded = await uploadFile(metode.perusahaanKode, ["metode-pembayaran"], `${metode.kode}.${ext}`, Buffer.from(bytes), file.type);
    await setQrisStatisImagePath(metodeId, uploaded.publicPath);
    return uploaded.publicPath;
  });
}

export async function getSnapBiKredensialStatusAction(perusahaanId: number): Promise<ActionResult<{ configured: boolean; clientId: string; merchantId: string; partnerId: string } | null>> {
  return runAction(async () => {
    await requireGrupAccess();
    const cred = await getSnapBiKredensial(perusahaanId);
    if (!cred) return null;
    return { configured: true, clientId: cred.clientId, merchantId: cred.merchantId, partnerId: cred.partnerId };
  });
}

export async function upsertSnapBiKredensialAction(input: UpsertSnapBiKredensialInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await upsertSnapBiKredensial(input);
    revalidatePath("/grup/perusahaan");
  });
}
```

- [ ] **Step 3: Write `PaymentMethodDialog`**

A table of `listMetodePembayaranAction` rows (kode/metode/jenis/coaId/konteks/wajibCatatan/isActive columns), an "add row" form (metode/jenis selects, `coaId` combobox populated from a `chartOfAccountOptions` prop passed in from `page.tsx`, konteks checkboxes for driver/kasir/publik, wajib_catatan checkbox), an active/inactive toggle per row (calls `upsertMetodePembayaranAction` with the row's other fields unchanged plus flipped `isActive`), an image-upload field that only renders when a row being edited has `jenis === 'qris_static'`, and a separate "Kredensial Snap BI" form block (client_id/client_secret/merchant_id/partner_id text inputs, submit calls `upsertSnapBiKredentialAction`) shown once regardless of how many `qris_dinamis` rows exist (there can only ever be one, per the design). Follow `PerusahaanFormDialog`'s existing prop/dialog-open conventions in `perusahaan-list.tsx` for consistency (`open`/`onOpenChange`, `perusahaanId` prop).

- [ ] **Step 4: Wire the trigger button**

In `perusahaan-list.tsx`, add a "Kelola Pembayaran" button per row (same row as the existing edit/delete icon buttons), opening `PaymentMethodDialog` with that row's `perusahaanId`.

- [ ] **Step 5: Fetch `chartOfAccountOptions` once at the page level**

In `src/app/grup/perusahaan/page.tsx`, add `getChartOfAccountOptions()` to the existing `Promise.all([...])` and pass it down through `PerusahaanList` to `PaymentMethodDialog`.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint` on every file touched this task.

- [ ] **Step 7: Live verification**

Start the dev server, log in as an account with grup access, open `/grup/perusahaan`, click "Kelola Pembayaran" on MKEsindo's row — confirm the 5 seeded rows (Task 4) render correctly, add/edit a row, toggle one inactive and back, and confirm attempting to activate `qris-dinamis` without Snap BI credentials shows the server's `AppError` message.

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboard/payment-method-dialog.tsx src/app/grup/perusahaan/
git commit -m "feat: add admin Kelola Pembayaran dialog for metode_pembayaran"
```

---

### Task 9: Wire driver-app `PembayaranStep`

**Files:**
- Modify: `src/components/driver-app/steps/pembayaran-step.tsx`

**Interfaces:**
- Consumes: `<QrPaymentPanel />` (Task 7), updated `recordDriverPaymentAction` (Task 6).

- [ ] **Step 1: Replace the hardcoded Tunai/disabled-buttons body**

`PembayaranStep` needs `perusahaanId` — add it as a new required prop, threaded from `stop-flow.tsx` down from wherever the driver's own `session.user.perusahaanId` is already available at that layer (check `stop-flow.tsx`'s existing props for a session-derived value first; if none is threaded yet, add it as a new prop on `StopFlow` too, sourced from its own caller).

```typescript
"use client";

import { useEffect, useState } from "react";
import { formatRupiah } from "@/lib/format";
import { getInvoiceOutstandingAction, recordDriverPaymentAction } from "@/app/mkesindo/driver-app/actions";
import { QrPaymentPanel } from "@/components/dashboard/qr-payment-panel";

export function PembayaranStep({
  salesInvoiceId,
  businessPartnerId,
  perusahaanId,
  onDone,
}: {
  salesInvoiceId: string;
  businessPartnerId: string;
  perusahaanId: number;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

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
  }, [businessPartnerId, salesInvoiceId, retryToken]);

  async function handleSubmit(input: { metodeKode: string; catatan: string | null }) {
    if (amount == null) return;
    const result = await recordDriverPaymentAction({
      businessPartnerId,
      perusahaanId,
      metodePembayaranKode: input.metodeKode,
      notes: input.catatan ?? undefined,
      allocations: [{ salesInvoiceId, amount }],
    });
    if (!result.success) throw new Error(result.error);
    onDone();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-lg font-semibold">Pembayaran</h1>

      <div className="rounded-lg border border-border p-4 text-center">
        <p className="text-xs uppercase text-muted-foreground">Total Pembayaran</p>
        <p className="text-2xl font-semibold">{loading ? "Memuat..." : amount != null ? formatRupiah(amount) : "-"}</p>
      </div>

      {error && amount == null && !loading ? (
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => {
            setLoading(true);
            setError(null);
            setRetryToken((t) => t + 1);
          }}
        >
          Coba Lagi
        </button>
      ) : (
        amount != null && <QrPaymentPanel perusahaanId={perusahaanId} konteks="driver" amount={amount} onSubmit={handleSubmit} />
      )}
      {error && amount != null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Thread `perusahaanId` through `stop-flow.tsx`'s `PembayaranStep` usage**

Add `perusahaanId` to `StopFlow`'s own props (sourced from the driver-app page that renders `StopFlow`, which already has `session.user.perusahaanId` available server-side), pass it to `<PembayaranStep perusahaanId={perusahaanId} ... />`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` (filter `.next/`) — expected zero errors across the whole project now (this was the last remaining `chartOfAccountId`/`PAYMENT_CHANNELS` call site outside kasir's dialog).

- [ ] **Step 4: Live verification**

Using a test delivery (e.g. mitra "Tester"), walk driver-app through Konfir Kirim → Konfir Terima (without "Tanpa Pembayaran") → confirm the Pembayaran screen now shows Tunai/Transfer/QRIS Statis tabs instead of the old two-disabled-buttons layout, and that submitting Tunai still completes the flow exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/driver-app/steps/pembayaran-step.tsx src/components/driver-app/stop-flow.tsx
git commit -m "feat: driver-app Pembayaran screen uses QrPaymentPanel"
```

---

### Task 10: Wire kasir `PelunasanDialog` and retire the old hardcoded list

**Files:**
- Modify: `src/components/dashboard/pelunasan-dialog.tsx`
- Modify: `src/app/mkesindo/(dashboard)/aging/actions.ts` (`recordPaymentAction` — update its input type pass-through)
- Modify: wherever `PelunasanDialog` is rendered (`aging-table.tsx`) — thread `perusahaanId` down, same as Task 9 did for driver-app

**Interfaces:**
- Consumes: `<QrPaymentPanel />` (Task 7), updated `recordPayment()`/`recordPaymentAction` (Task 5).

- [ ] **Step 1: Replace the `Select`/`PAYMENT_CHANNELS` block**

Remove the `channel`/`PAYMENT_CHANNELS`/`Select` code in `pelunasan-dialog.tsx`; replace `handleSubmit`'s `recordPaymentAction` call site to take `metodePembayaranKode` from a new `<QrPaymentPanel perusahaanId={perusahaanId} konteks="kasir" amount={totalDibayar} onSubmit={...} />` rendered in place of the old channel picker — note this dialog's existing flow picks invoices/amounts FIRST, then a channel; keep that order by rendering `QrPaymentPanel` last, with its own "Konfirmasi Pembayaran" button replacing this dialog's existing separate `DialogFooter` submit button (fold the two into one — `QrPaymentPanel`'s `onSubmit` should perform the exact same `recordPaymentAction` call `handleSubmit` does today, including the existing success/error toast handling).

- [ ] **Step 2: Thread `perusahaanId` into `PelunasanDialog`'s props**

Add `perusahaanId: number` to `PelunasanDialog`'s prop type; update `aging-table.tsx` (its caller) to pass it through from whatever session/page-level value is already available there (check `aging/page.tsx` for how it resolves the current company, mirroring the same source Task 8's `page.tsx` used, or the logged-in kasir's own `session.user.perusahaanId`).

- [ ] **Step 3: Update `recordPaymentAction`**

In `src/app/mkesindo/(dashboard)/aging/actions.ts`, update `recordPaymentAction`'s parameter type to match the new `RecordPaymentInput` shape (`perusahaanId`, `metodePembayaranKode` instead of `chartOfAccountId`) — it likely already just passes its input straight through to `recordPayment()`, so this may be a type-only change.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) — expect zero remaining errors project-wide. Run `npx eslint` on every file touched this task.

- [ ] **Step 5: Live verification**

Log in as a kasir-capable account, open Piutang → Invoice Outstanding, click "Bayar" on a real mitra with outstanding invoices, select an invoice, confirm the new `QrPaymentPanel` renders Tunai Kecil/Tunai Besar/Transfer/QRIS tabs (Kas Besar should appear here even though it doesn't on driver-app), submit a small real Tunai payment on a test mitra if available, confirm the existing toast/deposit-warning behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/pelunasan-dialog.tsx src/app/mkesindo/\(dashboard\)/aging/
git commit -m "feat: kasir Pelunasan dialog uses QrPaymentPanel, retire PAYMENT_CHANNELS"
```

---

### Task 11: Wire the public invoice page

**Files:**
- Modify: `src/app/mkesindo/invoice/[token]/page.tsx`
- Create (if not already resolvable another way): a small helper to resolve MKEsindo's `perusahaan_id` by `kode` — check first whether `getMkesindoPerusahaanId()`-shaped helper already exists anywhere in `src/lib/queries/perusahaan*.ts` before adding a new one; if not, add it to `src/lib/queries/perusahaan.ts`.

**Interfaces:**
- Consumes: `<QrPaymentPanel />` (Task 7), read-only (no `onSubmit`).

- [ ] **Step 1: Resolve `perusahaanId` for this unauthenticated route**

This page has no session (public link) — mirror `src/lib/db.ts`'s own `resolveKoneksi("mkesindo", "utama")` directness: add (or reuse) a one-line lookup, e.g. `SELECT id FROM perusahaan WHERE kode = 'mkesindo'`, called once in `PublicInvoicePage` alongside `getInvoiceByToken(token)`.

- [ ] **Step 2: Replace the placeholder box**

```typescript
// Replace the "QRIS segera hadir" black box (page.tsx:83-88) with:
<QrPaymentPanel perusahaanId={perusahaanId} konteks="publik" amount={invoice.Netto} />
```

No `onSubmit` prop — `QrPaymentPanel` already renders read-only when it's omitted (Task 7's implementation branches on `onSubmit`'s presence for the submit button/catatan field).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit` (filter `.next/`) — expect zero errors project-wide; this was the last of the four surfaces.

- [ ] **Step 4: Live verification**

Open a real (or test) unpaid invoice's public link (`/mkesindo/invoice/[token]`) in an incognito/unauthenticated browser context — confirm the QRIS Statis image renders where the old placeholder box was, and that Tunai/Transfer tabs do NOT appear (their `konteks` arrays don't include `publik`).

- [ ] **Step 5: Commit**

```bash
git add src/app/mkesindo/invoice/
git commit -m "feat: public invoice page shows real QRIS via QrPaymentPanel"
```

---

## Explicitly out of scope for this plan

The actual Snap BI generate-QR / poll-status API integration (Bagian 1/4 of the spec's "QRIS Dinamis" path) is **not** implemented by this plan — `jenis = 'qris_dinamis'` stays inactive/invisible everywhere until a company's Snap BI credentials are configured (Task 8 lets an admin enter them, but nothing yet calls out to Bank Mandiri with them). That integration is its own follow-up plan once real merchant credentials exist for at least one company, per the spec's own "Known risk / explicit gap" section.
