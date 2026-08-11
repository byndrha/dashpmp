# Modul Keuangan PT Putra Maesa Persada (pmpersada) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete Keuangan (Finance) module for a new PT, PT Putra Maesa Persada (kode `pmpersada`, Es Balok), mirroring PT Prima Maesa Putra's (pmputra) already-live Keuangan module exactly — P&L, BEP, Balance Sheet, Cash Flow, Cash Flow Harian, HPP Bersih, Detail COA + Anggaran + Cost Behavior — reading from pmpersada's own two ERP databases (utama = `FINAC_ES_TB`, logistik = `FINAC_PMP_LOGISTIC`), plus the full 9-module placeholder shell (`/pmpersada/[modul]`) pmputra already has.

**Architecture:** Same architecture as pmputra: a dedicated route tree (`src/app/pmpersada/`), its own guard (`requirePmpersada()`), its own `AccountScope`/`PT_ROUTES` entry, and 6 query files (`*-pmpersada.ts`) whose SQL is structurally identical to the `*-pmputra.ts` originals (verified identical `GeneralLedger`/`ChartOfAccount`/`PMP_Pemesanan` schema) but with pmpersada's own account-category classification and HPP Bersih account list. The one shared-code change is generalizing `db-pmputra.ts` (hardcoded to `kode="pmputra"`) into `db-company.ts`'s `getCompanyPool(kode, label)`, used by both PTs' query files — every other file is new, PT-specific, and never shared.

**Tech Stack:** Next.js 16 (App Router, Server Actions), MSSQL (`mssql`) for both this app's own DB and every PT's ERP databases, Postgres (`pg`) for the `perusahaan`/`perusahaan_koneksi` directory, NextAuth (JWT sessions).

## Global Constraints

- All Indonesian-language user-facing strings — no English UI text.
- No test runner exists in this project. Every task's verification is `npx tsc --noEmit` (zero errors touching changed files) + `npx eslint <changed files>`, plus a live check where noted.
- Everything happens directly on the `main` branch. No worktree.
- **Task 1 (Postgres + MSSQL registry setup) and Task 2 (DDL on pmpersada's live ERP databases) are controller-run**: executed directly by whoever is executing this plan (via `npx tsx <script>` for Task 1, via the `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_ddl`-equivalent direct connection for Task 2 — pmpersada's databases are NOT the MCP tool's bound database, so Task 2's DDL must run through a short one-off `npx tsx` script using `getCompanyPool`, not the MCP tool), never delegated to an implementer subagent. Both scripts are deleted after a successful run — they are one-off setup, not permanent app code.
- Task 2's DDL touches PT Putra Maesa Persada's own live production ERP databases (their accounting system, not our app's database) — only additive (`ALTER TABLE ... ADD` a nullable column, `CREATE TABLE` new tables), never touches existing columns/tables/data.
- `db-pmputra.ts` is deleted, replaced by `db-company.ts`. The only edits to already-working pmputra code are the 5 query files' import line and call-site renaming described in Task 3 — no SQL, business logic, or exported type shape changes to any pmputra file.
- Every new/changed pmputra query-file call site must end up calling `getCompanyPool("pmputra", label)` — never leave a stray `getPmputraPool` reference (the file is deleted, so any miss is a compile error, not a silent bug).
- Account category classification (`pmpersadaKategoriCase`) and the HPP Bersih account list are user-confirmed against live data — use the exact account numbers in this plan verbatim, do not re-derive or "improve" them.
- `PMP_Budget`/`PMP_CashFlowDaily`/`PMP_CashFlowExpense` only exist (after Task 2) in pmpersada's **utama** database (`FINAC_ES_TB`) — never logistik, matching pmputra's own exact asymmetry (its `setCOABudgetPmputra` already rejects `label === "logistik"` for this reason; the pmpersada equivalent must do the same).

---

## Task 1: Perusahaan setup (Postgres directory + MSSQL registry) — controller-run

**Files:**
- Create (temporary, deleted after run): `scripts/migrate-pmpersada-perusahaan.ts`

**Interfaces:**
- Produces: Postgres `perusahaan` row (`kode='pmpersada'`), two `perusahaan_koneksi` rows (`utama`→`FINAC_ES_TB`, `logistik`→`FINAC_PMP_LOGISTIC`), one MSSQL `DashboardPerusahaan` registry row (`Kode='pmpersada'`) — consumed by every later task's `getCompanyPool("pmpersada", label)` calls and by the PT Switcher/`/grup/perusahaan` UI.

- [ ] **Step 1: Write the setup script**

There is no admin UI in this app for creating a brand-new Postgres `perusahaan` row (verified: the only writer of that table across the whole codebase is this class of one-off script; `/grup/perusahaan`'s `upsertKoneksi` only manages `perusahaan_koneksi` rows for a `perusahaan_id` that already exists). Write `scripts/migrate-pmpersada-perusahaan.ts`:

```ts
// One-off setup for PT Putra Maesa Persada (pmpersada) as a new PT: a
// Postgres `perusahaan` row, its two `perusahaan_koneksi` rows (credentials
// copied from pmputra's existing rows -- same server, only db_name
// differs), and an MSSQL DashboardPerusahaan registry row so it shows up in
// the PT Switcher and /grup/perusahaan. Safe to re-run (guards every insert
// with an existence check). Deleted after use, not committed.
//
// Usage: npx tsx scripts/migrate-pmpersada-perusahaan.ts
import "dotenv/config";
import { Client } from "pg";
import { createPerusahaan, listPerusahaan } from "@/lib/queries/perusahaan";

async function main() {
  const pg = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: process.env.DIRECTORY_DB_NAME,
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await pg.connect();
  try {
    const existing = await pg.query(`SELECT id FROM perusahaan WHERE kode = 'pmpersada'`);
    let perusahaanId: number;
    if (existing.rows[0]) {
      perusahaanId = existing.rows[0].id;
      console.log(`perusahaan "pmpersada" already exists (id=${perusahaanId}), reusing.`);
    } else {
      const inserted = await pg.query(
        `INSERT INTO perusahaan (kode, nama, jenis_bisnis) VALUES ('pmpersada', 'PT Putra Maesa Persada', 'Es Balok') RETURNING id`
      );
      perusahaanId = inserted.rows[0].id;
      console.log(`Created perusahaan "pmpersada" (id=${perusahaanId}).`);
    }

    const pmputra = await pg.query(`SELECT id FROM perusahaan WHERE kode = 'pmputra'`);
    if (!pmputra.rows[0]) throw new Error(`perusahaan "pmputra" not found -- cannot copy its koneksi rows.`);
    const pmputraId = pmputra.rows[0].id;

    const koneksiTargets: { label: string; dbName: string }[] = [
      { label: "utama", dbName: "FINAC_ES_TB" },
      { label: "logistik", dbName: "FINAC_PMP_LOGISTIC" },
    ];
    for (const target of koneksiTargets) {
      const already = await pg.query(
        `SELECT id FROM perusahaan_koneksi WHERE perusahaan_id = $1 AND label = $2`,
        [perusahaanId, target.label]
      );
      if (already.rows[0]) {
        console.log(`perusahaan_koneksi "${target.label}" already exists for pmpersada, skipping.`);
        continue;
      }
      const source = await pg.query(
        `SELECT host, port, db_user, db_password_encrypted FROM perusahaan_koneksi WHERE perusahaan_id = $1 AND label = $2`,
        [pmputraId, target.label]
      );
      if (!source.rows[0]) throw new Error(`pmputra has no "${target.label}" koneksi to copy from.`);
      const { host, port, db_user, db_password_encrypted } = source.rows[0];
      await pg.query(
        `INSERT INTO perusahaan_koneksi (perusahaan_id, label, db_engine, host, port, db_name, db_user, db_password_encrypted)
         VALUES ($1, $2, 'mssql', $3, $4, $5, $6, $7)`,
        [perusahaanId, target.label, host, port, target.dbName, db_user, db_password_encrypted]
      );
      console.log(`Created perusahaan_koneksi "${target.label}" -> ${target.dbName} for pmpersada.`);
    }
  } finally {
    await pg.end();
  }

  // MSSQL registry row -- reuses the app's own createPerusahaan(), which
  // resolves its MSSQL connection via getPool() (Postgres kode="mkesindo"),
  // not raw env vars, so no separate MSSQL connection config is needed here.
  const rows = await listPerusahaan();
  if (rows.some((r) => r.Kode === "pmpersada")) {
    console.log(`DashboardPerusahaan row for "pmpersada" already exists, skipping.`);
  } else {
    const id = await createPerusahaan({
      nama: "PT Putra Maesa Persada",
      jenisBisnis: "Es Balok",
      wilayah: null,
      pabrikLatitude: null,
      pabrikLongitude: null,
      pabrikAlamat: null,
      status: "AktifPenuh",
      standaloneUrl: null,
      kode: "pmpersada",
      dbServer: null,
      dbPort: null,
      dbName: null,
      dbUser: null,
      dbPassword: null,
      catatan: null,
    });
    console.log(`Created DashboardPerusahaan row for "pmpersada" (PerusahaanID=${id}).`);
  }

  console.log("pmpersada perusahaan setup complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 2: Run the script**

Run: `npx tsx scripts/migrate-pmpersada-perusahaan.ts`
Expected: prints creation messages for the `perusahaan` row, both `perusahaan_koneksi` rows, and the `DashboardPerusahaan` row, ending with "pmpersada perusahaan setup complete." with no error. Re-run once more to confirm idempotency (must print the "already exists, skipping/reusing" messages and still succeed).

- [ ] **Step 3: Verify**

Query Postgres directly (or via a throwaway `npx tsx` one-liner) to confirm: `SELECT kode, nama FROM perusahaan WHERE kode = 'pmpersada'` returns one row; `SELECT label, db_name FROM perusahaan_koneksi pk JOIN perusahaan p ON p.id = pk.perusahaan_id WHERE p.kode = 'pmpersada'` returns `utama`/`FINAC_ES_TB` and `logistik`/`FINAC_PMP_LOGISTIC`.

- [ ] **Step 4: Delete the script (not committed)**

```bash
rm scripts/migrate-pmpersada-perusahaan.ts
```

No commit for this task — it's a one-off data setup with no permanent code artifact.

---

## Task 2: DDL on pmpersada's live ERP databases — controller-run

**Files:**
- Create (temporary, deleted after run): `scripts/migrate-pmpersada-ddl.ts`

**Interfaces:**
- Consumes: `perusahaan_koneksi` rows from Task 1 (so `resolveKoneksi("pmpersada", label)` resolves).
- Produces: `ChartOfAccount.CostBehavior` column (both databases) and `PMP_Budget`/`PMP_CashFlowDaily`/`PMP_CashFlowExpense` tables (utama only) — consumed by Task 8 (Cash Flow Harian) and Task 9 (Anggaran/Cost Behavior).

- [ ] **Step 1: Write the DDL script**

pmpersada's databases aren't the MCP SQL tool's bound database (that tool is bound to MKEsindo's own DB only), so this DDL runs through the app's own connection-resolution code in a one-off script:

```ts
// One-off DDL for PT Putra Maesa Persada's two live ERP databases -- adds
// the CostBehavior column (BEP feature) and the 3 custom tables Cash Flow
// Harian / Anggaran depend on, none of which exist yet (verified against
// live schema). Schema copied exactly from PMPutra's already-live
// equivalents. Deleted after use, not committed.
//
// Self-contained connection helper (not imported from @/lib/db-company,
// since Task 2 -- which creates that file -- hasn't necessarily run yet
// when this controller-run script executes; duplicating ~15 lines in a
// throwaway script beats introducing a forward dependency between two
// controller-run tasks).
//
// Usage: npx tsx scripts/migrate-pmpersada-ddl.ts
import "dotenv/config";
import sql from "mssql";
import { resolveKoneksi } from "@/lib/queries/perusahaan-koneksi";

async function getPmpersadaPool(label: "utama" | "logistik"): Promise<sql.ConnectionPool> {
  const cfg = await resolveKoneksi("pmpersada", label);
  if (!cfg) throw new Error(`No perusahaan_koneksi row for kode="pmpersada" label="${label}" -- run Task 1 first.`);
  return new sql.ConnectionPool({
    server: cfg.host,
    port: cfg.port,
    database: cfg.dbName,
    user: cfg.dbUser,
    password: cfg.dbPassword,
    options: { encrypt: true, trustServerCertificate: true },
    connectionTimeout: 15000,
    requestTimeout: 40000,
  }).connect();
}

async function columnExists(pool: sql.ConnectionPool, table: string, column: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("table", table)
    .input("column", column)
    .query(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table AND COLUMN_NAME = @column`);
  return result.recordset.length > 0;
}

async function tableExists(pool: sql.ConnectionPool, table: string): Promise<boolean> {
  const result = await pool.request().input("table", table).query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @table`
  );
  return result.recordset.length > 0;
}

async function main() {
  for (const label of ["utama", "logistik"] as const) {
    const pool = await getPmpersadaPool(label);
    if (await columnExists(pool, "ChartOfAccount", "CostBehavior")) {
      console.log(`${label}: CostBehavior already exists, skipping.`);
    } else {
      await pool.request().query(`ALTER TABLE ChartOfAccount ADD CostBehavior VARCHAR(16) NULL`);
      console.log(`${label}: added ChartOfAccount.CostBehavior.`);
    }
  }

  const utama = await getPmpersadaPool("utama");

  if (await tableExists(utama, "PMP_Budget")) {
    console.log("utama: PMP_Budget already exists, skipping.");
  } else {
    await utama.request().query(`
      CREATE TABLE PMP_Budget (
        ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ChartOfAccountID VARCHAR(16) NOT NULL,
        BudgetYear INT NOT NULL,
        BudgetMonth INT NOT NULL,
        Amount DECIMAL(23,4) NOT NULL,
        CreatedByUserID VARCHAR(16) NOT NULL,
        UpdatedAt DATETIME NOT NULL DEFAULT (GETDATE()),
        CONSTRAINT UQ_PMP_Budget_Akun_Periode UNIQUE (ChartOfAccountID, BudgetYear, BudgetMonth)
      )
    `);
    console.log("utama: created PMP_Budget.");
  }

  if (await tableExists(utama, "PMP_CashFlowDaily")) {
    console.log("utama: PMP_CashFlowDaily already exists, skipping.");
  } else {
    await utama.request().query(`
      CREATE TABLE PMP_CashFlowDaily (
        BusinessDate DATE NOT NULL PRIMARY KEY,
        KasDiTangan DECIMAL(23,2) NOT NULL,
        PengeluaranKasDiTangan DECIMAL(23,2) NOT NULL,
        UpdatedByUserID VARCHAR(16) NOT NULL,
        UpdatedAt DATETIME NOT NULL DEFAULT (GETDATE())
      )
    `);
    console.log("utama: created PMP_CashFlowDaily.");
  }

  if (await tableExists(utama, "PMP_CashFlowExpense")) {
    console.log("utama: PMP_CashFlowExpense already exists, skipping.");
  } else {
    await utama.request().query(`
      CREATE TABLE PMP_CashFlowExpense (
        ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BusinessDate DATE NOT NULL,
        Deskripsi VARCHAR(256) NOT NULL,
        Nominal DECIMAL(23,2) NOT NULL,
        CreatedByUserID VARCHAR(16) NOT NULL,
        CreatedAt DATETIME NOT NULL DEFAULT (GETDATE())
      )
    `);
    console.log("utama: created PMP_CashFlowExpense.");
  }

  console.log("pmpersada DDL complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

- [ ] **Step 2: Run the script**

Run: `npx tsx scripts/migrate-pmpersada-ddl.ts`
Expected: prints one line per database/table confirming creation, ending with "pmpersada DDL complete." with no error. Re-run once more to confirm idempotency.

- [ ] **Step 3: Verify**

Confirm via a throwaway query (or the same script's own idempotency check re-run) that `ChartOfAccount.CostBehavior` exists in both `FINAC_ES_TB` and `FINAC_PMP_LOGISTIC`, and `PMP_Budget`/`PMP_CashFlowDaily`/`PMP_CashFlowExpense` exist in `FINAC_ES_TB`.

- [ ] **Step 4: Delete the script (not committed)**

```bash
rm scripts/migrate-pmpersada-ddl.ts
```

No commit for this task.

---

## Task 3: `db-company.ts` — generalize the connection-pool layer

**Files:**
- Create: `src/lib/db-company.ts`
- Delete: `src/lib/db-pmputra.ts`
- Modify: `src/lib/queries/pnl-pmputra.ts`, `src/lib/queries/balance-sheet-pmputra.ts`, `src/lib/queries/cash-flow-pmputra.ts`, `src/lib/queries/cash-flow-harian-pmputra.ts`, `src/lib/queries/keuangan-detail-pmputra.ts`

**Interfaces:**
- Produces: `getCompanyPool(kode: string, label: CompanyKoneksiLabel): Promise<sql.ConnectionPool>`, `type CompanyKoneksiLabel = "utama" | "logistik"` — consumed by every pmputra query file (this task) and every new pmpersada query file (Tasks 6-9).

- [ ] **Step 1: Create `src/lib/db-company.ts`**

```ts
import sql from "mssql";
import { resolveKoneksi } from "@/lib/queries/perusahaan-koneksi";

export type CompanyKoneksiLabel = "utama" | "logistik";

// Per-(kode,label) connection pool, shared by every PT that wires its own
// ERP databases through perusahaan_koneksi (pmputra, pmpersada, and any
// future PT) -- generalized out of the original db-pmputra.ts, which
// hardcoded kode="pmputra". Same resolve-via-Postgres pattern as db.ts.
declare global {
  var _companyPools: Map<string, Promise<sql.ConnectionPool>> | undefined;
}

export function getCompanyPool(kode: string, label: CompanyKoneksiLabel): Promise<sql.ConnectionPool> {
  if (!global._companyPools) global._companyPools = new Map();
  const cacheKey = `${kode}:${label}`;
  const cached = global._companyPools.get(cacheKey);
  if (cached) return cached;

  const promise = resolveKoneksi(kode, label)
    .then((cfg) => {
      if (!cfg) {
        throw new Error(`No perusahaan_koneksi row for kode="${kode}" label="${label}"`);
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
      global._companyPools?.delete(cacheKey);
      throw err;
    });

  global._companyPools.set(cacheKey, promise);
  return promise;
}
```

- [ ] **Step 2: Delete `src/lib/db-pmputra.ts`**

```bash
rm src/lib/db-pmputra.ts
```

- [ ] **Step 3: Update the 5 pmputra query files**

In each of these 5 files, apply the exact same two-part mechanical change — nothing else in any of these files changes (no SQL, no business logic, no exported type):

1. Replace the import line:
   ```ts
   import { getPmputraPool, type PmputraKoneksiLabel } from "@/lib/db-pmputra";
   ```
   with:
   ```ts
   import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
   ```

2. Replace every use of the type name `PmputraKoneksiLabel` in that file with `CompanyKoneksiLabel`, and replace every call `getPmputraPool(X)` with `getCompanyPool("pmputra", X)` — where `X` is whatever expression was already there (a `label` parameter, or a literal `"utama"`/`"logistik"`).

Exact call-site count per file (so you can confirm you got them all — grep the file for `getPmputraPool` after editing, it must return zero matches):

- `pnl-pmputra.ts`: 2 call sites (inside `getPnLTotalsForLabel`, `getBEPTotalsForLabel`), 1 type usage (function parameter of both).
- `balance-sheet-pmputra.ts`: 1 call site (inside `getBalanceSheetRowsForLabel`), 1 type usage.
- `cash-flow-pmputra.ts`: 1 call site (inside `getCashFlowForLabel`), 1 type usage.
- `cash-flow-harian-pmputra.ts`: 6 call sites (`getPendapatanOperasionalForLabel`, `getCashFlowHarianHistoryPmputra`, `getCashFlowHarianPmputra` — 2 calls inside via `Promise.all` plus the `pool` used later in the same function is one of those 2 — re-read the function: it's `getPendapatanOperasionalForLabel("utama", ...)`, `getPendapatanOperasionalForLabel("logistik", ...)` inside `Promise.all`, plus `pool` itself which is `await getPmputraPool("utama")` at the top of `getCashFlowHarianPmputra` — so 3 in that function alone including the 2 inside `getPendapatanOperasionalForLabel` calls elsewhere; plus `saveCashFlowDailyFiguresPmputra`, `addCashFlowExpensePmputra`, `deleteCashFlowExpensePmputra` — 1 each), 1 type usage (in `getPendapatanOperasionalForLabel`'s parameter).
- `keuangan-detail-pmputra.ts`: 4 call sites (`getCOADetailRowsForLabel`, `setCOABudgetPmputra`, `listCostBehaviorRowsForLabel`, `setCostBehaviorPmputra`), 2 type usages (`getCOADetailRowsForLabel`'s and `listCostBehaviorRowsForLabel`'s parameters, and `parseLabeledId`'s return type).

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors — this is the strongest signal every `getPmputraPool`/`PmputraKoneksiLabel` reference was actually replaced, since the deleted `db-pmputra.ts` means any miss is a compile error, not silent.

Run: `npx eslint src/lib/db-company.ts src/lib/queries/pnl-pmputra.ts src/lib/queries/balance-sheet-pmputra.ts src/lib/queries/cash-flow-pmputra.ts src/lib/queries/cash-flow-harian-pmputra.ts src/lib/queries/keuangan-detail-pmputra.ts`
Expected: no errors.

- [ ] **Step 5: Regression-check pmputra's own Keuangan page still works**

This step has no code changes — it's a live-browser check. Open `/pmputra/keuangan` as an account with `accountScope="pmputra"` or cross-PT authority, and confirm all figures (P&L, Balance Sheet, Cash Flow, HPP Bersih, Detail COA) still show the same real numbers as before this task (compare against numbers already visible in the app, or re-run if a baseline screenshot isn't available) — this task is a pure refactor, pmputra's data must be byte-identical to before.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db-company.ts src/lib/queries/pnl-pmputra.ts src/lib/queries/balance-sheet-pmputra.ts src/lib/queries/cash-flow-pmputra.ts src/lib/queries/cash-flow-harian-pmputra.ts src/lib/queries/keuangan-detail-pmputra.ts
git rm src/lib/db-pmputra.ts
git commit -m "refactor: generalize db-pmputra.ts into db-company.ts for multi-PT reuse"
```

---

## Task 4: `AccountScope` + `PT_ROUTES` + `PtSwitcherLocation` + middleware confinement

**Files:**
- Modify: `src/types/next-auth.d.ts:7`, `src/lib/auth.config.ts:4`, `src/lib/auth.ts:16`, `src/lib/pt-routes.ts`, `src/components/dashboard/pt-switcher.tsx:15`, `middleware.ts:107-109`

**Interfaces:**
- Produces: `AccountScope` including `"pmpersada"`, `PT_ROUTES.pmpersada = "/pmpersada"` — consumed by every later task's guard/redirect logic.

- [ ] **Step 1: Add `"pmpersada"` to `AccountScope`**

In all 3 files (`src/types/next-auth.d.ts:7`, `src/lib/auth.config.ts:4`, `src/lib/auth.ts:16`), change:

```ts
type AccountScope = "mkesindo" | "direktur" | "pmputra";
```

to:

```ts
type AccountScope = "mkesindo" | "direktur" | "pmputra" | "pmpersada";
```

- [ ] **Step 2: Add the PT_ROUTES entry**

In `src/lib/pt-routes.ts`, change:

```ts
export const PT_ROUTES: Record<string, string> = {
  mkesindo: "/mkesindo",
  pmputra: "/pmputra",
};
```

to:

```ts
export const PT_ROUTES: Record<string, string> = {
  mkesindo: "/mkesindo",
  pmputra: "/pmputra",
  pmpersada: "/pmpersada",
};
```

- [ ] **Step 3: Add `"pmpersada"` to `PtSwitcherLocation`**

In `src/components/dashboard/pt-switcher.tsx:15`, change:

```ts
export type PtSwitcherLocation = "mkesindo" | "pmputra" | "grup";
```

to:

```ts
export type PtSwitcherLocation = "mkesindo" | "pmputra" | "pmpersada" | "grup";
```

- [ ] **Step 4: Add the middleware confinement branch**

In `middleware.ts`, immediately after the existing `pmputra` branch (lines 107-109), add:

```ts
  if (scope === "pmputra" && !path.startsWith("/pmputra")) {
    return NextResponse.redirect(new URL("/pmputra", req.nextUrl));
  }
  if (scope === "pmpersada" && !path.startsWith("/pmpersada")) {
    return NextResponse.redirect(new URL("/pmpersada", req.nextUrl));
  }
  if (scope === "mkesindo" && !path.startsWith("/mkesindo")) {
    return NextResponse.redirect(new URL("/mkesindo", req.nextUrl));
  }
```

(i.e. insert the new `pmpersada` block between the existing `pmputra` and `mkesindo` blocks — order among these 3 doesn't matter functionally since a session only ever has one scope, but keeping same-shape blocks adjacent keeps the file readable.)

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/types/next-auth.d.ts src/lib/auth.config.ts src/lib/auth.ts src/lib/pt-routes.ts src/components/dashboard/pt-switcher.tsx middleware.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/next-auth.d.ts src/lib/auth.config.ts src/lib/auth.ts src/lib/pt-routes.ts src/components/dashboard/pt-switcher.tsx middleware.ts
git commit -m "feat: add pmpersada AccountScope, PT_ROUTES entry, and middleware confinement"
```

---

## Task 5: `requirePmpersada()` guard + `pmpersada-modules.ts`

**Files:**
- Modify: `src/lib/require-access.ts` (append after `requirePmputra()`)
- Create: `src/lib/pmpersada-modules.ts`

**Interfaces:**
- Produces: `requirePmpersada(): Promise<Session>`, `PMPERSADA_MODULES: Record<string, string>` — consumed by Task 10 (route tree) and Task 11 (sidebar).

- [ ] **Step 1: Add `requirePmpersada()`**

In `src/lib/require-access.ts`, append after the existing `requirePmputra()` function:

```ts

export async function requirePmpersada() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.accountScope !== "pmpersada" && !canAccessAllPT(session.user)) redirect("/akses-ditolak");
  return session;
}
```

- [ ] **Step 2: Create `src/lib/pmpersada-modules.ts`**

```ts
// Single source of truth for the /pmpersada module-shell labels, shared by
// the sidebar nav and the [modul] placeholder page. Identical shape to
// pmputra-modules.ts -- PMPersada gets the same 9-module shell PMPutra has.
export const PMPERSADA_MODULES: Record<string, string> = {
  keuangan: "Keuangan",
  piutang: "Piutang",
  penjualan: "Penjualan",
  transaksi: "Transaksi",
  listrik: "Biaya Listrik",
  pengiriman: "Pengiriman",
  pemesanan: "Pemesanan",
  mitra: "Mitra",
  pemasaran: "Pemasaran",
};
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/require-access.ts src/lib/pmpersada-modules.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/require-access.ts src/lib/pmpersada-modules.ts
git commit -m "feat: add requirePmpersada guard and PMPERSADA_MODULES shell list"
```

---

## Task 6: `pnl-pmpersada.ts` (P&L + BEP)

**Files:**
- Create: `src/lib/queries/pnl-pmpersada.ts`

**Interfaces:**
- Consumes: `getCompanyPool` (Task 3), `PnLSummary`/`BEPSummary` types (from `@/lib/queries/pnl`, unchanged).
- Produces: `pmpersadaKategoriCase(label)`, `getPnLPmpersada(filter): Promise<PnLSummary>`, `getBEPPmpersada(filter): Promise<BEPSummary>` — consumed by Task 12 (Keuangan page) and Task 9 (`keuangan-detail-pmpersada.ts` imports `pmpersadaKategoriCase`).

- [ ] **Step 1: Create the file**

Mirrors `pnl-pmputra.ts` exactly in structure; only the category-CASE account numbers and the pool call differ (confirmed against live ChartOfAccount data, user-confirmed classification — see plan Global Constraints):

```ts
// src/lib/queries/pnl-pmpersada.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import type { BEPSummary, PnLSummary } from "@/lib/queries/pnl";
import type { DateRangeFilter } from "@/types/dashboard";

// Per-database category classification — derived from real PMPersada
// ChartOfAccount data (utama + logistik), user-confirmed 2026-08-11. Do NOT
// copy pnl.ts's or pnl-pmputra.ts's category CASE verbatim; PMPersada's own
// account numbers are not the same as either.
//
// utama (FINAC_ES_TB):
//   BiayaTetap = Gaji (6101.01), BPJS Kesehatan (6101.03), BPJS
//     Ketenagakerjaan (6101.04), Sewa (6103).
//   Adjustment = Beban Pajak Lainnya (6605).
// logistik (FINAC_PMP_LOGISTIC):
//   BiayaTetap = Gaji (6101.01), Sewa (6103) — logistik has no BPJS
//     sub-accounts under 6101.xx to include.
//   Adjustment = Beban Pajak Lainnya (6605).
// Other tax accounts (PPh 21/23/29/4(2) — 6601-6604, Beban Pajak
// Penghasilan — 6606, Beban Pajak PBB — 6607) fall through to the default
// prefix-6 BebanOperasional bucket, same as every other pattern here — only
// the single "Lainnya" catch-all tax account is Adjustment.
export function pmpersadaKategoriCase(label: CompanyKoneksiLabel): string {
  const biayaTetapAccounts = label === "utama" ? "'6101.01','6101.03','6101.04','6103'" : "'6101.01','6103'";
  return `
    CASE
        WHEN LEFT(coa.AccountNo,1) = '4' THEN 'Pendapatan'
        WHEN LEFT(coa.AccountNo,1) = '5' THEN 'HPP'
        WHEN coa.AccountNo = '6605' THEN 'Adjustment'
        WHEN coa.AccountNo IN (${biayaTetapAccounts}) THEN 'BiayaTetap'
        WHEN LEFT(coa.AccountNo,1) = '6' THEN 'BebanOperasional'
        WHEN LEFT(coa.AccountNo,1) = '7' THEN 'PenghasilanLainnya'
        WHEN LEFT(coa.AccountNo,1) = '8' THEN 'BebanLainnya'
    END
  `;
}

interface RawCategoryTotal {
  Kategori: string;
  TotalDebit: number;
  TotalCredit: number;
}

interface PnLCategoryTotals {
  Pendapatan: { debit: number; credit: number };
  HPP: { debit: number; credit: number };
  BiayaTetap: { debit: number; credit: number };
  BebanOperasional: { debit: number; credit: number };
  PenghasilanLainnya: { debit: number; credit: number };
  Adjustment: { debit: number; credit: number };
  BebanLainnya: { debit: number; credit: number };
}

function emptyTotals(): PnLCategoryTotals {
  return {
    Pendapatan: { debit: 0, credit: 0 },
    HPP: { debit: 0, credit: 0 },
    BiayaTetap: { debit: 0, credit: 0 },
    BebanOperasional: { debit: 0, credit: 0 },
    PenghasilanLainnya: { debit: 0, credit: 0 },
    Adjustment: { debit: 0, credit: 0 },
    BebanLainnya: { debit: 0, credit: 0 },
  };
}

async function getPnLTotalsForLabel(label: CompanyKoneksiLabel, filter: DateRangeFilter): Promise<PnLCategoryTotals> {
  const pool = await getCompanyPool("pmpersada", label);
  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
      SELECT
          ${pmpersadaKategoriCase(label)} AS Kategori,
          SUM(gl.Debit)  AS TotalDebit,
          SUM(gl.Credit) AS TotalCredit
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE gl.TransDate >= @startDate
        AND gl.TransDate <  @endDate
        AND LEFT(coa.AccountNo,1) IN ('4','5','6','7','8')
      GROUP BY ${pmpersadaKategoriCase(label)}
    `);

  const totals = emptyTotals();
  for (const r of result.recordset as RawCategoryTotal[]) {
    if (r.Kategori in totals) {
      totals[r.Kategori as keyof PnLCategoryTotals] = { debit: r.TotalDebit, credit: r.TotalCredit };
    }
  }
  return totals;
}

function sumTotals(a: PnLCategoryTotals, b: PnLCategoryTotals): PnLCategoryTotals {
  const out = emptyTotals();
  for (const key of Object.keys(out) as (keyof PnLCategoryTotals)[]) {
    out[key] = { debit: a[key].debit + b[key].debit, credit: a[key].credit + b[key].credit };
  }
  return out;
}

export async function getPnLPmpersada(filter: DateRangeFilter): Promise<PnLSummary> {
  const [utama, logistik] = await Promise.all([
    getPnLTotalsForLabel("utama", filter),
    getPnLTotalsForLabel("logistik", filter),
  ]);
  const t = sumTotals(utama, logistik);

  const pendapatan = t.Pendapatan.credit - t.Pendapatan.debit;
  const hpp = t.HPP.debit - t.HPP.credit;
  const labaKotor = pendapatan - hpp;
  const biayaTetap = t.BiayaTetap.debit - t.BiayaTetap.credit;
  const bebanOperasional = t.BebanOperasional.debit - t.BebanOperasional.credit;
  const labaOperasional = labaKotor - biayaTetap - bebanOperasional;
  const penghasilanLainnya = t.PenghasilanLainnya.credit - t.PenghasilanLainnya.debit;
  const adjustment = t.Adjustment.debit - t.Adjustment.credit;
  const bebanLainnya = t.BebanLainnya.debit - t.BebanLainnya.credit;
  const labaBersih = labaOperasional + penghasilanLainnya - adjustment - bebanLainnya;

  return {
    Pendapatan: pendapatan,
    HPP: hpp,
    LabaKotor: labaKotor,
    BiayaTetap: biayaTetap,
    BebanOperasional: bebanOperasional,
    LabaOperasional: labaOperasional,
    PenghasilanLainnya: penghasilanLainnya,
    Adjustment: adjustment,
    BebanLainnya: bebanLainnya,
    LabaBersih: labaBersih,
  };
}

interface RawBEPTotal {
  Kategori: string;
  TotalDebit: number;
  TotalCredit: number;
}

async function getBEPTotalsForLabel(
  label: CompanyKoneksiLabel,
  filter: DateRangeFilter
): Promise<Map<string, { debit: number; credit: number }>> {
  const pool = await getCompanyPool("pmpersada", label);
  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
      SELECT
          CASE
              WHEN LEFT(coa.AccountNo,1) = '4' THEN 'REVENUE'
              WHEN LEFT(coa.AccountNo,1) = '5' THEN 'VARIABLE'
              ELSE coa.CostBehavior
          END AS Kategori,
          SUM(gl.Debit)  AS TotalDebit,
          SUM(gl.Credit) AS TotalCredit
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE gl.TransDate >= @startDate
        AND gl.TransDate <  @endDate
        AND (
              LEFT(coa.AccountNo,1) IN ('4','5')
              OR (LEFT(coa.AccountNo,1) = '6' AND coa.CostBehavior IS NOT NULL)
            )
      GROUP BY CASE
              WHEN LEFT(coa.AccountNo,1) = '4' THEN 'REVENUE'
              WHEN LEFT(coa.AccountNo,1) = '5' THEN 'VARIABLE'
              ELSE coa.CostBehavior
          END
    `);

  const map = new Map<string, { debit: number; credit: number }>();
  for (const r of result.recordset as RawBEPTotal[]) {
    map.set(r.Kategori, { debit: r.TotalDebit, credit: r.TotalCredit });
  }
  return map;
}

export async function getBEPPmpersada(filter: DateRangeFilter): Promise<BEPSummary> {
  const [utama, logistik] = await Promise.all([
    getBEPTotalsForLabel("utama", filter),
    getBEPTotalsForLabel("logistik", filter),
  ]);

  function combined(key: string): { debit: number; credit: number } {
    const a = utama.get(key) ?? { debit: 0, credit: 0 };
    const b = logistik.get(key) ?? { debit: 0, credit: 0 };
    return { debit: a.debit + b.debit, credit: a.credit + b.credit };
  }

  const revenue = combined("REVENUE").credit - combined("REVENUE").debit;
  const variableCost = combined("VARIABLE").debit - combined("VARIABLE").credit;
  const fixedCost = combined("FIXED").debit - combined("FIXED").credit;
  const mixedCost = combined("MIXED").debit - combined("MIXED").credit;

  const marginKontribusiPct = revenue !== 0 ? 1 - variableCost / revenue : 0;
  const bepPerBulan = marginKontribusiPct !== 0 ? fixedCost / marginKontribusiPct : 0;

  return {
    Revenue: revenue,
    VariableCost: variableCost,
    FixedCost: fixedCost,
    MixedCost: mixedCost,
    MarginKontribusiPct: marginKontribusiPct,
    BEPPerBulan: bepPerBulan,
  };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/pnl-pmpersada.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/pnl-pmpersada.ts
git commit -m "feat: add pnl-pmpersada.ts (P&L + BEP query layer)"
```

---

## Task 7: `balance-sheet-pmpersada.ts`

**Files:**
- Create: `src/lib/queries/balance-sheet-pmpersada.ts`

**Interfaces:**
- Consumes: `getCompanyPool` (Task 3), `BALANCE_SHEET_KATEGORI_CASE`/`BalanceSheetKategori`/`BalanceSheetRow` (from `@/lib/queries/balance-sheet`, unchanged — prefix-based 1/2/3 classification, verified to apply unchanged to PMPersada's chart).
- Produces: `getBalanceSheetPmpersada(filter): Promise<BalanceSheetRow[]>` — consumed by Task 12.

- [ ] **Step 1: Create the file**

Identical structure to `balance-sheet-pmputra.ts`, only the pool call changes:

```ts
// src/lib/queries/balance-sheet-pmpersada.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import { BALANCE_SHEET_KATEGORI_CASE, type BalanceSheetKategori, type BalanceSheetRow } from "@/lib/queries/balance-sheet";
import type { DateRangeFilter } from "@/types/dashboard";

const DEBIT_NORMAL: BalanceSheetKategori[] = ["AsetLancar", "AsetTetap"];

async function getBalanceSheetRowsForLabel(
  label: CompanyKoneksiLabel,
  filter: DateRangeFilter
): Promise<Omit<BalanceSheetRow, "SaldoPercent">[]> {
  const pool = await getCompanyPool("pmpersada", label);
  const result = await pool
    .request()
    .input("cutoff", sql.Date, filter.endDate)
    .query(`
      SELECT
          coa.ChartOfAccountID,
          coa.AccountNo,
          coa.Description AS AccountName,
          ${BALANCE_SHEET_KATEGORI_CASE} AS Kategori,
          ISNULL(SUM(gl.Debit), 0)  AS TotalDebit,
          ISNULL(SUM(gl.Credit), 0) AS TotalCredit
      FROM ChartOfAccount coa
      JOIN GeneralLedger gl
          ON gl.ChartOfAccountID = coa.ChartOfAccountID
          AND gl.TransDate < @cutoff
      WHERE ISNULL(coa.IsDeleted, 0) = 0
        AND coa.IsChildest = 1
        AND LEFT(coa.AccountNo, 1) IN ('1','2','3')
      GROUP BY coa.ChartOfAccountID, coa.AccountNo, coa.Description
      HAVING SUM(gl.Debit) <> 0 OR SUM(gl.Credit) <> 0
      ORDER BY coa.AccountNo
    `);

  const rows = result.recordset as {
    ChartOfAccountID: string;
    AccountNo: string;
    AccountName: string;
    Kategori: BalanceSheetKategori;
    TotalDebit: number;
    TotalCredit: number;
  }[];

  return rows.map((r) => ({
    ChartOfAccountID: `${label}:${r.ChartOfAccountID}`,
    AccountNo: r.AccountNo,
    AccountName: r.AccountName,
    Kategori: r.Kategori,
    Saldo: DEBIT_NORMAL.includes(r.Kategori) ? r.TotalDebit - r.TotalCredit : r.TotalCredit - r.TotalDebit,
  }));
}

export async function getBalanceSheetPmpersada(filter: DateRangeFilter): Promise<BalanceSheetRow[]> {
  const [utama, logistik] = await Promise.all([
    getBalanceSheetRowsForLabel("utama", filter),
    getBalanceSheetRowsForLabel("logistik", filter),
  ]);
  const combined = [...utama, ...logistik];

  const totalByKategori = new Map<BalanceSheetKategori, number>();
  for (const r of combined) {
    totalByKategori.set(r.Kategori, (totalByKategori.get(r.Kategori) ?? 0) + Math.abs(r.Saldo));
  }

  return combined
    .map((r) => ({
      ...r,
      SaldoPercent: totalByKategori.get(r.Kategori) ? (Math.abs(r.Saldo) / totalByKategori.get(r.Kategori)!) * 100 : 0,
    }))
    .sort((a, b) => a.AccountNo.localeCompare(b.AccountNo));
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/balance-sheet-pmpersada.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/balance-sheet-pmpersada.ts
git commit -m "feat: add balance-sheet-pmpersada.ts"
```

---

## Task 8: `cash-flow-pmpersada.ts` + `cash-flow-harian-pmpersada.ts`

**Files:**
- Create: `src/lib/queries/cash-flow-pmpersada.ts`, `src/lib/queries/cash-flow-harian-pmpersada.ts`

**Interfaces:**
- Consumes: `getCompanyPool` (Task 3), `CashFlowSummary`/`CashFlowTypeRow` (from `@/lib/queries/cash-flow`), `CashFlowHarian`/`CashFlowHarianHistoryRow` (from `@/lib/queries/cash-flow-harian`) — all unchanged.
- Consumes: `PMP_CashFlowDaily`/`PMP_CashFlowExpense` tables in `FINAC_ES_TB` from Task 2.
- Produces: `getCashFlowPmpersada`, `getCashFlowHarianHistoryPmpersada`, `getCashFlowHarianPmpersada`, `saveCashFlowDailyFiguresPmpersada`, `addCashFlowExpensePmpersada`, `deleteCashFlowExpensePmpersada` — consumed by Task 12 (page + actions).

- [ ] **Step 1: Create `src/lib/queries/cash-flow-pmpersada.ts`**

Identical structure to `cash-flow-pmputra.ts` (same `KAS_BANK_FILTER`/`KAS_DI_TANGAN_FILTER`/`TYPE_LABEL` — verified same account-prefix scheme and same `GeneralLedger.Type` values in PMPersada's data), only the pool call changes:

```ts
// src/lib/queries/cash-flow-pmpersada.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import type { CashFlowSummary, CashFlowTypeRow } from "@/lib/queries/cash-flow";
import type { DateRangeFilter } from "@/types/dashboard";

const KAS_BANK_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,2) IN ('11','12') AND ISNULL(coa.IsDeleted,0) = 0`;
const KAS_DI_TANGAN_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,4) = '1101' AND ISNULL(coa.IsDeleted,0) = 0`;

const TYPE_LABEL: Record<string, string> = {
  SALESPAYMENT: "Pembayaran dari Pelanggan",
  SALESDEPOSIT: "Uang Muka Penjualan",
  SALESCREDIT: "Kredit Penjualan",
  SALESRETURN: "Retur Penjualan",
  EXPENSE: "Beban Operasional",
  PURCHASEPAYMENT: "Pembayaran ke Supplier",
  VOUCHER: "Voucher / Transfer Lainnya",
};
function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

interface RawCashFlowResult {
  pendapatan: number;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
  pemasukan: { type: string; amount: number }[];
  pengeluaran: { type: string; amount: number }[];
}

async function getCashFlowForLabel(label: CompanyKoneksiLabel, filter: DateRangeFilter): Promise<RawCashFlowResult> {
  const pool = await getCompanyPool("pmpersada", label);
  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate)
    .query(`
      SELECT ISNULL(SUM(gl.Debit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.Type = 'SALESPAYMENT'
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate;

      SELECT ISNULL(SUM(gl.Debit), 0) - ISNULL(SUM(gl.Credit), 0) AS Saldo
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_DI_TANGAN_FILTER}
        AND gl.TransDate < @endDate;

      SELECT ISNULL(SUM(gl.Credit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_DI_TANGAN_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate;

      SELECT gl.Type, ISNULL(SUM(gl.Debit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate
      GROUP BY gl.Type
      HAVING SUM(gl.Debit) <> 0;

      SELECT gl.Type, ISNULL(SUM(gl.Credit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.TransDate >= @startDate AND gl.TransDate < @endDate
      GROUP BY gl.Type
      HAVING SUM(gl.Credit) <> 0;
    `);

  const [pendapatanRs, kasDiTanganRs, pengeluaranKasDiTanganRs, pemasukanRs, pengeluaranRs] =
    result.recordsets as unknown as [
      { Total: number }[],
      { Saldo: number }[],
      { Total: number }[],
      { Type: string; Total: number }[],
      { Type: string; Total: number }[],
    ];

  return {
    pendapatan: pendapatanRs[0]?.Total ?? 0,
    kasDiTangan: kasDiTanganRs[0]?.Saldo ?? 0,
    pengeluaranKasDiTangan: pengeluaranKasDiTanganRs[0]?.Total ?? 0,
    pemasukan: pemasukanRs.map((r) => ({ type: r.Type, amount: r.Total })),
    pengeluaran: pengeluaranRs.map((r) => ({ type: r.Type, amount: r.Total })),
  };
}

function mergeTypeRows(a: { type: string; amount: number }[], b: { type: string; amount: number }[]): CashFlowTypeRow[] {
  const map = new Map<string, number>();
  for (const r of [...a, ...b]) map.set(r.type, (map.get(r.type) ?? 0) + r.amount);
  return [...map.entries()]
    .map(([type, amount]) => ({ type, label: typeLabel(type), amount }))
    .sort((x, y) => y.amount - x.amount);
}

export async function getCashFlowPmpersada(filter: DateRangeFilter): Promise<CashFlowSummary> {
  const [utama, logistik] = await Promise.all([
    getCashFlowForLabel("utama", filter),
    getCashFlowForLabel("logistik", filter),
  ]);

  const pemasukan = mergeTypeRows(utama.pemasukan, logistik.pemasukan);
  const pengeluaran = mergeTypeRows(utama.pengeluaran, logistik.pengeluaran);

  return {
    pendapatanOperasional: utama.pendapatan + logistik.pendapatan,
    kasDiTangan: utama.kasDiTangan + logistik.kasDiTangan,
    pengeluaranKasDiTangan: utama.pengeluaranKasDiTangan + logistik.pengeluaranKasDiTangan,
    totalPemasukan: pemasukan.reduce((s, r) => s + r.amount, 0),
    totalPengeluaran: pengeluaran.reduce((s, r) => s + r.amount, 0),
    pemasukan,
    pengeluaran,
  };
}
```

- [ ] **Step 2: Create `src/lib/queries/cash-flow-harian-pmpersada.ts`**

Identical structure to `cash-flow-harian-pmputra.ts` (the `PMP_CashFlowDaily`/`PMP_CashFlowExpense` tables it reads/writes now exist in `FINAC_ES_TB` per Task 2), only the pool call changes:

```ts
// src/lib/queries/cash-flow-harian-pmpersada.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import type { CashFlowHarian, CashFlowHarianHistoryRow } from "@/lib/queries/cash-flow-harian";

const KAS_BANK_FILTER = `coa.IsChildest = 1 AND LEFT(coa.AccountNo,2) IN ('11','12') AND ISNULL(coa.IsDeleted,0) = 0`;

function nextDayISO(dateISO: string): string {
  const d = new Date(dateISO);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString().slice(0, 10);
}

async function getPendapatanOperasionalForLabel(label: CompanyKoneksiLabel, businessDate: string): Promise<number> {
  const pool = await getCompanyPool("pmpersada", label);
  const result = await pool
    .request()
    .input("date", sql.Date, businessDate)
    .input("nextDate", sql.Date, nextDayISO(businessDate))
    .query(`
      SELECT ISNULL(SUM(gl.Debit), 0) AS Total
      FROM GeneralLedger gl
      JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE ${KAS_BANK_FILTER}
        AND gl.Type = 'SALESPAYMENT'
        AND gl.TransDate >= @date AND gl.TransDate < @nextDate;
    `);
  const rs = result.recordset as { Total: number }[];
  return rs[0]?.Total ?? 0;
}

export async function getCashFlowHarianHistoryPmpersada(limit = 60): Promise<CashFlowHarianHistoryRow[]> {
  const pool = await getCompanyPool("pmpersada", "utama");
  const result = await pool.request().input("limit", sql.Int, limit).query(`
    SELECT TOP (@limit)
        d.BusinessDate,
        cf.KasDiTangan,
        cf.PengeluaranKasDiTangan,
        ISNULL(e.TotalPengeluaran, 0) AS TotalPengeluaranKas,
        ISNULL(e.ItemCount, 0) AS ItemCount
    FROM (
        SELECT BusinessDate FROM PMP_CashFlowDaily
        UNION
        SELECT BusinessDate FROM PMP_CashFlowExpense
    ) d
    LEFT JOIN PMP_CashFlowDaily cf ON cf.BusinessDate = d.BusinessDate
    LEFT JOIN (
        SELECT BusinessDate, SUM(Nominal) AS TotalPengeluaran, COUNT(*) AS ItemCount
        FROM PMP_CashFlowExpense
        GROUP BY BusinessDate
    ) e ON e.BusinessDate = d.BusinessDate
    ORDER BY d.BusinessDate DESC
  `);

  return (
    result.recordset as {
      BusinessDate: string;
      KasDiTangan: number | null;
      PengeluaranKasDiTangan: number | null;
      TotalPengeluaranKas: number;
      ItemCount: number;
    }[]
  ).map((r) => ({
    businessDate: new Date(r.BusinessDate).toISOString().slice(0, 10),
    kasDiTangan: r.KasDiTangan,
    pengeluaranKasDiTangan: r.PengeluaranKasDiTangan,
    totalPengeluaranKas: r.TotalPengeluaranKas,
    itemCount: r.ItemCount,
  }));
}

export async function getCashFlowHarianPmpersada(businessDate: string): Promise<CashFlowHarian> {
  const pool = await getCompanyPool("pmpersada", "utama");
  const [pendapatanUtama, pendapatanLogistik, result] = await Promise.all([
    getPendapatanOperasionalForLabel("utama", businessDate),
    getPendapatanOperasionalForLabel("logistik", businessDate),
    pool
      .request()
      .input("date", sql.Date, businessDate)
      .query(`
      SELECT KasDiTangan, PengeluaranKasDiTangan, UpdatedAt
      FROM PMP_CashFlowDaily
      WHERE BusinessDate = @date;

      SELECT ID, Deskripsi, Nominal
      FROM PMP_CashFlowExpense
      WHERE BusinessDate = @date
      ORDER BY CreatedAt ASC;
    `),
  ]);

  const [dailyRs, expenseRs] = result.recordsets as unknown as [
    { KasDiTangan: number; PengeluaranKasDiTangan: number; UpdatedAt: string }[],
    { ID: number; Deskripsi: string; Nominal: number }[],
  ];

  const daily = dailyRs[0];
  const daftarPengeluaranKas = expenseRs.map((r) => ({ id: r.ID, deskripsi: r.Deskripsi, nominal: r.Nominal }));

  return {
    businessDate,
    pendapatanOperasional: pendapatanUtama + pendapatanLogistik,
    kasDiTangan: daily?.KasDiTangan ?? null,
    pengeluaranKasDiTangan: daily?.PengeluaranKasDiTangan ?? null,
    updatedAt: daily?.UpdatedAt ?? null,
    daftarPengeluaranKas,
    totalPengeluaranKas: daftarPengeluaranKas.reduce((s, r) => s + r.nominal, 0),
  };
}

export async function saveCashFlowDailyFiguresPmpersada(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
  userId: string;
}): Promise<void> {
  const pool = await getCompanyPool("pmpersada", "utama");
  await pool
    .request()
    .input("date", sql.Date, input.businessDate)
    .input("kas", sql.Decimal(23, 2), input.kasDiTangan)
    .input("peng", sql.Decimal(23, 2), input.pengeluaranKasDiTangan)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE PMP_CashFlowDaily AS target
      USING (SELECT @date AS BusinessDate) AS src
      ON target.BusinessDate = src.BusinessDate
      WHEN MATCHED THEN
        UPDATE SET KasDiTangan = @kas, PengeluaranKasDiTangan = @peng,
                   UpdatedByUserID = @userId, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessDate, KasDiTangan, PengeluaranKasDiTangan, UpdatedByUserID)
        VALUES (@date, @kas, @peng, @userId);
    `);
}

export async function addCashFlowExpensePmpersada(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
  userId: string;
}): Promise<void> {
  const pool = await getCompanyPool("pmpersada", "utama");
  await pool
    .request()
    .input("date", sql.Date, input.businessDate)
    .input("deskripsi", sql.VarChar(256), input.deskripsi)
    .input("nominal", sql.Decimal(23, 2), input.nominal)
    .input("userId", sql.VarChar(16), input.userId).query(`
      INSERT INTO PMP_CashFlowExpense (BusinessDate, Deskripsi, Nominal, CreatedByUserID)
      VALUES (@date, @deskripsi, @nominal, @userId)
    `);
}

export async function deleteCashFlowExpensePmpersada(id: number): Promise<void> {
  const pool = await getCompanyPool("pmpersada", "utama");
  await pool.request().input("id", sql.Int, id).query(`DELETE FROM PMP_CashFlowExpense WHERE ID = @id`);
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/cash-flow-pmpersada.ts src/lib/queries/cash-flow-harian-pmpersada.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/cash-flow-pmpersada.ts src/lib/queries/cash-flow-harian-pmpersada.ts
git commit -m "feat: add cash-flow-pmpersada.ts and cash-flow-harian-pmpersada.ts"
```

---

## Task 9: `keuangan-detail-pmpersada.ts` (Detail COA + Anggaran + Cost Behavior)

**Files:**
- Create: `src/lib/queries/keuangan-detail-pmpersada.ts`

**Interfaces:**
- Consumes: `getCompanyPool` (Task 3), `pmpersadaKategoriCase` (Task 6), `COADetailRow`/`COAKategori` (from `@/lib/queries/keuangan-detail`, unchanged), `PMP_Budget` table in `FINAC_ES_TB` (Task 2), `ChartOfAccount.CostBehavior` column (Task 2).
- Produces: `getCOADetailPmpersada`, `setCOABudgetPmpersada`, `listChartOfAccountForCostBehaviorPmpersada`, `setCostBehaviorPmpersada` — consumed by Task 12.

- [ ] **Step 1: Create the file**

Identical structure to `keuangan-detail-pmputra.ts`, only the pool call and the `pmpersadaKategoriCase` import change:

```ts
// src/lib/queries/keuangan-detail-pmpersada.ts
import { getDaysInMonth } from "date-fns";
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import { pmpersadaKategoriCase } from "@/lib/queries/pnl-pmpersada";
import type { COADetailRow, COAKategori } from "@/lib/queries/keuangan-detail";
import type { DateRangeFilter } from "@/types/dashboard";
import { AppError } from "@/lib/action-result";

const CREDIT_NORMAL: COAKategori[] = ["Pendapatan", "PenghasilanLainnya"];

function realisasiSign(kategori: COAKategori, debit: number, credit: number): number {
  return CREDIT_NORMAL.includes(kategori) ? credit - debit : debit - credit;
}

function parseLabeledId(labeledId: string): { label: CompanyKoneksiLabel; id: string } {
  const idx = labeledId.indexOf(":");
  const label = idx === -1 ? "" : labeledId.slice(0, idx);
  const id = idx === -1 ? "" : labeledId.slice(idx + 1);
  if (label !== "utama" && label !== "logistik") {
    throw new AppError(`ChartOfAccountID tidak valid (tidak diawali label database): "${labeledId}"`);
  }
  return { label, id };
}

async function getCOADetailRowsForLabel(
  label: CompanyKoneksiLabel,
  filter: DateRangeFilter,
  budgetYear: number,
  budgetMonth: number
): Promise<
  {
    ChartOfAccountID: string;
    AccountNo: string;
    AccountName: string;
    Kategori: COAKategori;
    TotalDebit: number;
    TotalCredit: number;
    BudgetAmount: number | null;
  }[]
> {
  const pool = await getCompanyPool("pmpersada", label);
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);

  // PMP_Budget only exists in the `utama` (FINAC_ES_TB) database (Task 2) —
  // same manual-entry-table exception as pmputra's own PMP_Budget/utama
  // asymmetry. `logistik` has no such table, so its rows always report
  // BudgetAmount: null rather than attempting a cross-database join.
  const budgetJoin =
    label === "utama"
      ? `LEFT JOIN PMP_Budget b
           ON b.ChartOfAccountID = coa.ChartOfAccountID
           AND b.BudgetYear = @budgetYear
           AND b.BudgetMonth = @budgetMonth`
      : "";
  const budgetSelect = label === "utama" ? "b.Amount AS BudgetAmount" : "CAST(NULL AS DECIMAL(23,4)) AS BudgetAmount";
  const budgetGroupBy = label === "utama" ? ", b.Amount" : "";

  if (label === "utama") {
    request.input("budgetYear", sql.Int, budgetYear).input("budgetMonth", sql.Int, budgetMonth);
  }

  const result = await request.query(`
    SELECT
        coa.ChartOfAccountID,
        coa.AccountNo,
        coa.Description AS AccountName,
        ${pmpersadaKategoriCase(label)} AS Kategori,
        ISNULL(SUM(gl.Debit), 0)  AS TotalDebit,
        ISNULL(SUM(gl.Credit), 0) AS TotalCredit,
        ${budgetSelect}
    FROM ChartOfAccount coa
    JOIN GeneralLedger gl
        ON gl.ChartOfAccountID = coa.ChartOfAccountID
        AND gl.TransDate >= @startDate
        AND gl.TransDate <  @endDate
    ${budgetJoin}
    WHERE ISNULL(coa.IsDeleted, 0) = 0
      AND coa.IsChildest = 1
      AND LEFT(coa.AccountNo, 1) IN ('4','5','6','7','8')
    GROUP BY coa.ChartOfAccountID, coa.AccountNo, coa.Description${budgetGroupBy}
    HAVING SUM(gl.Debit) <> 0 OR SUM(gl.Credit) <> 0
    ORDER BY coa.AccountNo
  `);

  const rows = result.recordset as {
    ChartOfAccountID: string;
    AccountNo: string;
    AccountName: string;
    Kategori: COAKategori;
    TotalDebit: number;
    TotalCredit: number;
    BudgetAmount: number | null;
  }[];

  return rows.map((r) => ({ ...r, ChartOfAccountID: `${label}:${r.ChartOfAccountID}` }));
}

export async function getCOADetailPmpersada(filter: DateRangeFilter): Promise<COADetailRow[]> {
  const start = new Date(filter.startDate);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + 1;

  const [utama, logistik] = await Promise.all([
    getCOADetailRowsForLabel("utama", filter, year, month),
    getCOADetailRowsForLabel("logistik", filter, year, month),
  ]);
  const rows = [...utama, ...logistik];

  const withRealisasi = rows.map((r) => ({ ...r, Realisasi: realisasiSign(r.Kategori, r.TotalDebit, r.TotalCredit) }));

  const totalByKategori = new Map<COAKategori, number>();
  for (const r of withRealisasi) {
    totalByKategori.set(r.Kategori, (totalByKategori.get(r.Kategori) ?? 0) + Math.abs(r.Realisasi));
  }

  const now = new Date();
  const end = new Date(filter.endDate);
  const periodEnd = end < now ? end : now;
  const elapsedDays = Math.max(1, Math.round((periodEnd.getTime() - start.getTime()) / 86400000));
  const daysInMonth = getDaysInMonth(start);

  return withRealisasi
    .map((r) => ({
      ChartOfAccountID: r.ChartOfAccountID,
      AccountNo: r.AccountNo,
      AccountName: r.AccountName,
      Kategori: r.Kategori,
      Realisasi: r.Realisasi,
      RealisasiPercent: totalByKategori.get(r.Kategori) ? (Math.abs(r.Realisasi) / totalByKategori.get(r.Kategori)!) * 100 : 0,
      BudgetAmount: r.BudgetAmount,
      BudgetPercent: r.BudgetAmount ? (r.Realisasi / r.BudgetAmount) * 100 : null,
      ProyeksiAkhirBulan: (r.Realisasi / elapsedDays) * daysInMonth,
    }))
    .sort((a, b) => a.AccountNo.localeCompare(b.AccountNo));
}

export async function setCOABudgetPmpersada(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
  userId: string;
}): Promise<void> {
  const { label, id } = parseLabeledId(input.chartOfAccountId);
  if (label === "logistik") {
    throw new AppError(
      "Budget tidak dapat diatur untuk akun logistik — tabel Budget hanya ada di database utama."
    );
  }

  const pool = await getCompanyPool("pmpersada", "utama");
  await pool
    .request()
    .input("coaId", sql.VarChar(16), id)
    .input("year", sql.Int, input.year)
    .input("month", sql.Int, input.month)
    .input("amount", sql.Decimal(23, 4), input.amount)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE PMP_Budget AS target
      USING (SELECT @coaId AS ChartOfAccountID, @year AS BudgetYear, @month AS BudgetMonth) AS src
      ON target.ChartOfAccountID = src.ChartOfAccountID
         AND target.BudgetYear = src.BudgetYear
         AND target.BudgetMonth = src.BudgetMonth
      WHEN MATCHED THEN
        UPDATE SET Amount = @amount, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (ChartOfAccountID, BudgetYear, BudgetMonth, Amount, CreatedByUserID)
        VALUES (@coaId, @year, @month, @amount, @userId);
    `);
}

export interface CostBehaviorRow {
  ChartOfAccountID: string;
  AccountNo: string;
  AccountName: string;
  CostBehavior: "FIXED" | "VARIABLE" | "MIXED" | null;
}

async function listCostBehaviorRowsForLabel(label: CompanyKoneksiLabel): Promise<CostBehaviorRow[]> {
  const pool = await getCompanyPool("pmpersada", label);
  const result = await pool.request().query(`
    SELECT ChartOfAccountID, AccountNo, Description AS AccountName, CostBehavior
    FROM ChartOfAccount
    WHERE ISNULL(IsDeleted, 0) = 0 AND IsChildest = 1 AND LEFT(AccountNo, 1) = '6'
    ORDER BY AccountNo
  `);
  return (result.recordset as CostBehaviorRow[]).map((r) => ({
    ...r,
    ChartOfAccountID: `${label}:${r.ChartOfAccountID}`,
  }));
}

export async function listChartOfAccountForCostBehaviorPmpersada(): Promise<CostBehaviorRow[]> {
  const [utama, logistik] = await Promise.all([
    listCostBehaviorRowsForLabel("utama"),
    listCostBehaviorRowsForLabel("logistik"),
  ]);
  return [...utama, ...logistik].sort((a, b) => a.AccountNo.localeCompare(b.AccountNo));
}

export async function setCostBehaviorPmpersada(
  chartOfAccountId: string,
  costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null
): Promise<void> {
  const { label, id } = parseLabeledId(chartOfAccountId);
  const pool = await getCompanyPool("pmpersada", label);
  await pool
    .request()
    .input("id", sql.VarChar(16), id)
    .input("cb", sql.VarChar(16), costBehavior)
    .query(`UPDATE ChartOfAccount SET CostBehavior = @cb WHERE ChartOfAccountID = @id`);
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/keuangan-detail-pmpersada.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/keuangan-detail-pmpersada.ts
git commit -m "feat: add keuangan-detail-pmpersada.ts"
```

---

## Task 10: `hpp-bersih-pmpersada.ts`

**Files:**
- Create: `src/lib/queries/hpp-bersih-pmpersada.ts`

**Interfaces:**
- Consumes: `getCompanyPool` (Task 3), `HPPBersihAccountRow`/`HPPBersihData` (from `@/lib/queries/hpp-bersih`, unchanged), `PMP_Pemesanan` table (already exists in both PMPersada databases, verified).
- Produces: `getHPPBersihPmpersada(year): Promise<HPPBersihData>` — consumed by Task 12.

- [ ] **Step 1: Create the file**

Identical structure to `hpp-bersih-pmputra.ts`; only the pool call and the account list change (5 utama accounts, 6 logistik accounts, user-confirmed against live data — no Amoniak account exists for PMPersada, unlike PMPutra):

```ts
// src/lib/queries/hpp-bersih-pmpersada.ts
import { sql } from "@/lib/db";
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import type { HPPBersihAccountRow, HPPBersihData } from "@/lib/queries/hpp-bersih";

// User-provided, verified against real ChartOfAccount rows in both
// databases, confirmed 2026-08-11. PMPersada has no Amoniak account
// (unlike PMPutra) -- 5 utama accounts instead of 6.
const HPP_BERSIH_ACCOUNTS: { label: CompanyKoneksiLabel; accountNo: string; displayName: string }[] = [
  { label: "utama", accountNo: "6105", displayName: "Listrik" },
  { label: "utama", accountNo: "6114", displayName: "Garam" },
  { label: "utama", accountNo: "6115", displayName: "Air" },
  { label: "utama", accountNo: "6103", displayName: "Sewa" },
  { label: "utama", accountNo: "6116", displayName: "Oli" },
  { label: "logistik", accountNo: "6122.01", displayName: "BBM Es" },
  { label: "logistik", accountNo: "6115", displayName: "Sparepart" },
  { label: "logistik", accountNo: "6121", displayName: "Oli" },
  { label: "logistik", accountNo: "6114", displayName: "Vulkanisir" },
  { label: "logistik", accountNo: "6119", displayName: "Pembelian Ban" },
  { label: "logistik", accountNo: "6103", displayName: "Sewa" },
];

async function getMonthlyNominalForLabel(
  label: CompanyKoneksiLabel,
  accountNos: string[],
  yearStart: Date,
  yearEnd: Date
): Promise<Map<string, number[]>> {
  const pool = await getCompanyPool("pmpersada", label);
  const request = pool.request().input("yearStart", sql.Date, yearStart).input("yearEnd", sql.Date, yearEnd);
  const inClause = accountNos
    .map((no, i) => {
      request.input(`no${i}`, sql.VarChar(16), no);
      return `@no${i}`;
    })
    .join(", ");

  const result = await request.query(`
    SELECT coa.AccountNo, MONTH(gl.TransDate) AS Mo,
           SUM(gl.Debit) AS TotalDebit, SUM(gl.Credit) AS TotalCredit
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo IN (${inClause})
      AND gl.TransDate >= @yearStart AND gl.TransDate < @yearEnd
    GROUP BY coa.AccountNo, MONTH(gl.TransDate)
  `);

  const byAccount = new Map<string, number[]>();
  for (const no of accountNos) byAccount.set(no, new Array(12).fill(0));
  for (const r of result.recordset as { AccountNo: string; Mo: number; TotalDebit: number; TotalCredit: number }[]) {
    const arr = byAccount.get(r.AccountNo);
    if (arr) arr[r.Mo - 1] += r.TotalDebit - r.TotalCredit;
  }
  return byAccount;
}

async function getMonthlyBalokRealisasi(yearStart: Date, yearEnd: Date): Promise<number[]> {
  const pool = await getCompanyPool("pmpersada", "utama");
  const result = await pool
    .request()
    .input("yearStart", sql.Date, yearStart)
    .input("yearEnd", sql.Date, yearEnd)
    .query(`
      SELECT MONTH(Tanggal) AS Mo,
             SUM(ISNULL(BalokKecilRealisasi,0) + ISNULL(BalokBesarRealisasi,0)) AS Qty
      FROM PMP_Pemesanan
      WHERE Status = '3' AND ISNULL(IsVoid,0) = 0 AND ISNULL(IsDeleted,0) = 0
        AND Tanggal >= @yearStart AND Tanggal < @yearEnd
      GROUP BY MONTH(Tanggal)
    `);
  const totals = new Array(12).fill(0);
  for (const r of result.recordset as { Mo: number; Qty: number }[]) totals[r.Mo - 1] = r.Qty;
  return totals;
}

export async function getHPPBersihPmpersada(year: number): Promise<HPPBersihData> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const utamaAccounts = HPP_BERSIH_ACCOUNTS.filter((a) => a.label === "utama").map((a) => a.accountNo);
  const logistikAccounts = HPP_BERSIH_ACCOUNTS.filter((a) => a.label === "logistik").map((a) => a.accountNo);

  const [utamaNominal, logistikNominal, totalBalokTerjual] = await Promise.all([
    getMonthlyNominalForLabel("utama", utamaAccounts, yearStart, yearEnd),
    getMonthlyNominalForLabel("logistik", logistikAccounts, yearStart, yearEnd),
    getMonthlyBalokRealisasi(yearStart, yearEnd),
  ]);

  const accounts: HPPBersihAccountRow[] = HPP_BERSIH_ACCOUNTS.map((a) => {
    const monthlyNominal =
      (a.label === "utama" ? utamaNominal.get(a.accountNo) : logistikNominal.get(a.accountNo)) ??
      new Array(12).fill(0);
    const monthlyRatio = monthlyNominal.map((nominal, i) => (totalBalokTerjual[i] ? nominal / totalBalokTerjual[i] : 0));
    return { AccountNo: `${a.label}:${a.accountNo}`, AccountName: a.displayName, MonthlyNominal: monthlyNominal, MonthlyRatio: monthlyRatio };
  });

  const totalHPPBersih = new Array(12).fill(0);
  for (const acc of accounts) {
    for (let i = 0; i < 12; i++) totalHPPBersih[i] += acc.MonthlyRatio[i];
  }

  return { year, accounts, totalKantongPenjualan: totalBalokTerjual, totalHPPBersih };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/queries/hpp-bersih-pmpersada.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/hpp-bersih-pmpersada.ts
git commit -m "feat: add hpp-bersih-pmpersada.ts"
```

---

## Task 11: `PmpersadaSidebar` component

**Files:**
- Create: `src/components/dashboard/pmpersada-sidebar.tsx`

**Interfaces:**
- Consumes: `PMPERSADA_MODULES` (Task 5), `PT_ROUTES` (Task 4, via `PTSwitcher`), `PerusahaanSwitcherEntry` (unchanged).
- Produces: `PmpersadaSidebar({ canSwitchPt, perusahaanList })` component — consumed by Task 12 (layout).

- [ ] **Step 1: Create the file**

Identical structure to `pmputra-sidebar.tsx`; PT name/badge/`current` change, and (per spec) the "Ponorogo" city sub-label is **omitted** (PMPersada's city/region is unknown — do not fabricate a value):

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, LineChart, Receipt, ShoppingCart, ArrowLeftRight, Zap, Truck, ClipboardList, Users, Megaphone } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { PTSwitcher } from "@/components/dashboard/pt-switcher";
import { PMPERSADA_MODULES } from "@/lib/pmpersada-modules";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

const MODULE_ICONS: Record<string, typeof LineChart> = {
  keuangan: LineChart,
  piutang: Receipt,
  penjualan: ShoppingCart,
  transaksi: ArrowLeftRight,
  listrik: Zap,
  pengiriman: Truck,
  pemesanan: ClipboardList,
  mitra: Users,
  pemasaran: Megaphone,
};
const NAV_ITEMS = Object.entries(PMPERSADA_MODULES).map(([slug, label]) => ({ slug, label, icon: MODULE_ICONS[slug] }));

export function PmpersadaSidebar({
  canSwitchPt,
  perusahaanList,
}: {
  canSwitchPt: boolean;
  perusahaanList: PerusahaanSwitcherEntry[];
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  function closeOnMobile() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        <div className="flex items-center gap-2 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand asset, no next/image usage elsewhere in this codebase */}
          <img
            src="/brand/logo-pmp-group.png"
            alt="PMP Group"
            className="h-7 w-auto max-w-none shrink-0 dark:brightness-0 dark:invert"
          />
          <div className="flex min-w-0 flex-col gap-0.5 truncate group-data-[collapsible=icon]:hidden">
            <div className="flex items-center gap-1.5">
              <p className="font-display font-semibold leading-tight">PT Putra Maesa Persada</p>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                Es Balok
              </Badge>
            </div>
          </div>
        </div>
        {canSwitchPt && (
          <div className="px-2 group-data-[collapsible=icon]:px-0">
            {/* Only an account with cross-PT authority sees this — see PTSwitcher. */}
            <PTSwitcher list={perusahaanList} current="pmpersada" />
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Modul</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/pmpersada" onClick={closeOnMobile} />} isActive={pathname === "/pmpersada"} tooltip="Beranda">
                  <LayoutGrid className="shrink-0" />
                  <span>Beranda</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.slug}>
                  <SidebarMenuButton
                    render={<Link href={`/pmpersada/${item.slug}`} onClick={closeOnMobile} />}
                    isActive={pathname === `/pmpersada/${item.slug}`}
                    tooltip={item.label}
                  >
                    <item.icon className="shrink-0" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/dashboard/pmpersada-sidebar.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pmpersada-sidebar.tsx
git commit -m "feat: add PmpersadaSidebar component"
```

---

## Task 12: Route tree `/pmpersada` (layout, beranda, module shell, Keuangan page + actions)

**Files:**
- Create: `src/app/pmpersada/layout.tsx`, `src/app/pmpersada/page.tsx`, `src/app/pmpersada/[modul]/page.tsx`, `src/app/pmpersada/keuangan/page.tsx`, `src/app/pmpersada/keuangan/actions.ts`

**Interfaces:**
- Consumes: `requirePmpersada` (Task 5), `PmpersadaSidebar` (Task 11), `PMPERSADA_MODULES` (Task 5), all 6 `*-pmpersada.ts` query functions (Tasks 6-10).

- [ ] **Step 1: Create `src/app/pmpersada/layout.tsx`**

```tsx
import { requirePmpersada, canAccessAllPT } from "@/lib/require-access";
import { listPerusahaanForSwitcher } from "@/lib/queries/perusahaan";
import { PmpersadaSidebar } from "@/components/dashboard/pmpersada-sidebar";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export default async function PmpersadaLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePmpersada();
  const perusahaanList = await listPerusahaanForSwitcher();
  const canSwitchPt = canAccessAllPT(session.user);

  return (
    <SidebarProvider>
      <PmpersadaSidebar canSwitchPt={canSwitchPt} perusahaanList={perusahaanList} />
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <span className="font-medium">PT Putra Maesa Persada</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{session?.user?.name ?? session?.user?.username}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="@container/dashboard-main flex flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 2: Create `src/app/pmpersada/page.tsx`**

```tsx
import { Building2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function PmpersadaHomePage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">PT Putra Maesa Persada</h1>
        <p className="text-sm text-muted-foreground">Es Balok</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            <CardTitle>Integrasi database belum dihubungkan</CardTitle>
          </div>
          <CardDescription>
            Modul di sisi kiri sudah disiapkan mengikuti struktur dashboard PT Mitra Kelola Esindo, tapi datanya
            belum tersambung ke database PT Putra Maesa Persada (FINAC_ES_TB / FINAC_PMP_LOGISTIC). Pilih modul di
            sidebar untuk melihat status masing-masing.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/pmpersada/[modul]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PMPERSADA_MODULES } from "@/lib/pmpersada-modules";

export default async function PmpersadaModulePage({ params }: { params: Promise<{ modul: string }> }) {
  const { modul } = await params;
  const label = PMPERSADA_MODULES[modul];
  if (!label) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">{label}</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <PackageSearch className="size-4 text-muted-foreground" />
            <CardTitle>Belum ada data</CardTitle>
          </div>
          <CardDescription>
            Modul {label} belum tersambung ke database PT Putra Maesa Persada. Halaman ini akan diisi setelah
            integrasi FINAC_ES_TB / FINAC_PMP_LOGISTIC dikerjakan.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
```

Note: `keuangan` is a key in `PMPERSADA_MODULES` too (needed by the sidebar's generic `NAV_ITEMS` mapping and by `[modul]/page.tsx`'s lookup), but Next.js's file-system routing always prefers the more specific static route `src/app/pmpersada/keuangan/page.tsx` (Step 4 below) over the dynamic `[modul]/page.tsx` catch-all for that exact path — so `/pmpersada/keuangan` never actually reaches this placeholder, exactly mirroring how pmputra's `/pmputra/keuangan` behaves today.

- [ ] **Step 4: Create `src/app/pmpersada/keuangan/page.tsx`**

```tsx
// src/app/pmpersada/keuangan/page.tsx
import { Wallet, TrendingUp, Landmark, PiggyBank } from "lucide-react";
import { getPnLPmpersada, getBEPPmpersada } from "@/lib/queries/pnl-pmpersada";
import {
  getCOADetailPmpersada,
  listChartOfAccountForCostBehaviorPmpersada,
} from "@/lib/queries/keuangan-detail-pmpersada";
import { getBalanceSheetPmpersada } from "@/lib/queries/balance-sheet-pmpersada";
import { getCashFlowPmpersada } from "@/lib/queries/cash-flow-pmpersada";
import { getCashFlowHarianPmpersada, getCashFlowHarianHistoryPmpersada } from "@/lib/queries/cash-flow-harian-pmpersada";
import { getHPPBersihPmpersada } from "@/lib/queries/hpp-bersih-pmpersada";
import { getBusinessDateISO } from "@/lib/business-date";
import { requirePmpersada } from "@/lib/require-access";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { SimpleBarChart } from "@/components/charts/simple-bar-chart";
import { COADetailTable } from "@/components/dashboard/coa-detail-table";
import { BalanceSheetTable } from "@/components/dashboard/balance-sheet-table";
import { CashFlowPanel } from "@/components/dashboard/cash-flow-panel";
import { CashFlowHarianPanel } from "@/components/dashboard/cash-flow-harian-panel";
import { CashFlowHarianHistoryPanel } from "@/components/dashboard/cash-flow-harian-history-panel";
import { HPPBersihPanel } from "@/components/dashboard/hpp-bersih-panel";
import { CostBehaviorEditor } from "@/components/dashboard/cost-behavior-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah, formatPercent, formatDate } from "@/lib/format";
import {
  saveCOABudgetPmpersadaAction,
  saveCashFlowDailyFiguresPmpersadaAction,
  addCashFlowExpensePmpersadaAction,
  deleteCashFlowExpensePmpersadaAction,
  getHPPBersihPmpersadaAction,
  setCostBehaviorPmpersadaAction,
} from "@/app/pmpersada/keuangan/actions";

export default async function PmpersadaKeuanganPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  await requirePmpersada();
  const params = await searchParams;
  const filter = resolveFilter(params);
  const cfDate = params.cfDate ?? getBusinessDateISO();

  const [pnl, bep, coaDetail, costBehaviorRows, balanceSheet, cashFlow, cashFlowHarian, cashFlowHarianHistory, hppBersih] =
    await Promise.all([
      getPnLPmpersada(filter),
      getBEPPmpersada(filter),
      getCOADetailPmpersada(filter),
      listChartOfAccountForCostBehaviorPmpersada(),
      getBalanceSheetPmpersada(filter),
      getCashFlowPmpersada(filter),
      getCashFlowHarianPmpersada(cfDate),
      getCashFlowHarianHistoryPmpersada(),
      getHPPBersihPmpersada(new Date().getUTCFullYear()),
    ]);

  const periodStart = new Date(filter.startDate);
  const endDateUTC = new Date(filter.endDate);
  const balanceSheetCutoff = new Date(
    Date.UTC(endDateUTC.getUTCFullYear(), endDateUTC.getUTCMonth(), endDateUTC.getUTCDate() - 1)
  );

  const compositionData = [
    { name: "HPP", value: pnl.HPP },
    { name: "Biaya Tetap", value: pnl.BiayaTetap },
    { name: "Beban Operasional", value: pnl.BebanOperasional },
    { name: "Laba Bersih", value: Math.max(pnl.LabaBersih, 0) },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Keuangan</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <FilterBar />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pendapatan" value={formatRupiah(pnl.Pendapatan)} icon={Wallet} />
        <KpiCard label="Laba Kotor" value={formatRupiah(pnl.LabaKotor)} icon={TrendingUp} />
        <KpiCard
          label="Laba Operasional"
          value={formatRupiah(pnl.LabaOperasional)}
          icon={Landmark}
          tone={pnl.LabaOperasional >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          label="Laba Bersih"
          value={formatRupiah(pnl.LabaBersih)}
          icon={PiggyBank}
          tone={pnl.LabaBersih >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <div className="flex flex-col gap-4 @4xl:col-span-3">
          <CashFlowPanel data={cashFlow} asOfLabel={formatDate(balanceSheetCutoff)} />
          <CashFlowHarianPanel
            key={cashFlowHarian.businessDate}
            data={cashFlowHarian}
            onSaveFigures={saveCashFlowDailyFiguresPmpersadaAction}
            onAddExpense={addCashFlowExpensePmpersadaAction}
            onDeleteExpense={deleteCashFlowExpensePmpersadaAction}
          />
          <CashFlowHarianHistoryPanel rows={cashFlowHarianHistory} activeDate={cfDate} />
        </div>

        <div className="flex flex-col gap-4 @4xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Rincian P&amp;L</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Pendapatan" value={pnl.Pendapatan} />
              <Row label="HPP" value={-pnl.HPP} />
              <Row label="Laba Kotor" value={pnl.LabaKotor} bold />
              <Row label="Biaya Tetap" value={-pnl.BiayaTetap} />
              <Row label="Beban Operasional" value={-pnl.BebanOperasional} />
              <Row label="Laba Operasional" value={pnl.LabaOperasional} bold />
              <Row label="Penghasilan Lainnya" value={pnl.PenghasilanLainnya} />
              <Row label="Adjustment" value={-pnl.Adjustment} />
              <Row label="Beban Lainnya" value={-pnl.BebanLainnya} />
              <Row label="Laba Bersih" value={pnl.LabaBersih} bold />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Komposisi Biaya vs Laba</CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleBarChart data={compositionData} height={200} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <div className="@4xl:col-span-3 @4xl:border-r @4xl:border-border @4xl:pr-4">
          <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">
            Detail per Akun (COA) &mdash; APBP vs Realisasi
          </h2>
          <COADetailTable
            rows={coaDetail}
            year={periodStart.getUTCFullYear()}
            month={periodStart.getUTCMonth() + 1}
            onSaveBudget={saveCOABudgetPmpersadaAction}
          />
        </div>
        <div className="@4xl:col-span-2">
          <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">
            Detail Balance Sheet &mdash; per {formatDate(balanceSheetCutoff)}
          </h2>
          <BalanceSheetTable rows={balanceSheet} />
        </div>
      </div>

      <hr className="border-border" />

      <CostBehaviorEditor rows={costBehaviorRows} onSetCostBehavior={setCostBehaviorPmpersadaAction} />

      <Card>
        <CardHeader>
          <CardTitle>Break-Even Point (BEP)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Revenue" value={formatRupiah(bep.Revenue)} />
            <Stat label="Biaya Variabel" value={formatRupiah(bep.VariableCost)} />
            <Stat label="Biaya Tetap" value={formatRupiah(bep.FixedCost)} />
            <Stat label="Margin Kontribusi" value={formatPercent(bep.MarginKontribusiPct)} />
            <Stat label="BEP / Bulan" value={formatRupiah(bep.BEPPerBulan)} />
          </div>
          <div className="rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Rumus Perhitungan BEP:</p>
            <p className="mt-1 font-data">Margin Kontribusi = 1 &minus; (Biaya Variabel &divide; Revenue)</p>
            <p className="font-data">BEP per Bulan = Biaya Tetap &divide; Margin Kontribusi</p>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Akun bertanda &quot;Campuran (Mixed)&quot; sebesar {formatRupiah(bep.MixedCost)} sengaja tidak dimasukkan ke
        perhitungan BEP di atas.
      </p>

      <HPPBersihPanel
        initialData={hppBersih}
        onNavigateYear={getHPPBersihPmpersadaAction}
        unitLabel="Balok"
        formulaAccountsLabel="Listrik, Garam, Air, Sewa, Oli (FINAC_ES_TB) + BBM Es, Sparepart, Oli, Vulkanisir, Pembelian Ban, Sewa (FINAC_PMP_LOGISTIC)"
      />
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold border-t pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatRupiah(value)}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/app/pmpersada/keuangan/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmpersada } from "@/lib/require-access";
import { setCOABudgetPmpersada, setCostBehaviorPmpersada } from "@/lib/queries/keuangan-detail-pmpersada";
import {
  saveCashFlowDailyFiguresPmpersada,
  addCashFlowExpensePmpersada,
  deleteCashFlowExpensePmpersada,
} from "@/lib/queries/cash-flow-harian-pmpersada";
import { getHPPBersihPmpersada } from "@/lib/queries/hpp-bersih-pmpersada";
import type { HPPBersihData } from "@/lib/queries/hpp-bersih";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function saveCOABudgetPmpersadaAction(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    await setCOABudgetPmpersada({ ...input, userId: session.user.id });
    revalidatePath("/pmpersada/keuangan");
  });
}

export async function saveCashFlowDailyFiguresPmpersadaAction(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    await saveCashFlowDailyFiguresPmpersada({ ...input, userId: session.user.id });
    revalidatePath("/pmpersada/keuangan");
  });
}

export async function addCashFlowExpensePmpersadaAction(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    if (!input.deskripsi.trim() || !(input.nominal > 0)) throw new AppError("Data tidak valid");
    await addCashFlowExpensePmpersada({ ...input, userId: session.user.id });
    revalidatePath("/pmpersada/keuangan");
  });
}

export async function deleteCashFlowExpensePmpersadaAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePmpersada();
    await deleteCashFlowExpensePmpersada(id);
    revalidatePath("/pmpersada/keuangan");
  });
}

export async function getHPPBersihPmpersadaAction(year: number): Promise<ActionResult<HPPBersihData>> {
  return runAction(async () => {
    await requirePmpersada();
    return getHPPBersihPmpersada(year);
  });
}

export async function setCostBehaviorPmpersadaAction(
  chartOfAccountId: string,
  costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePmpersada();
    await setCostBehaviorPmpersada(chartOfAccountId, costBehavior);
    revalidatePath("/pmpersada/keuangan");
  });
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/pmpersada/layout.tsx src/app/pmpersada/page.tsx "src/app/pmpersada/[modul]/page.tsx" src/app/pmpersada/keuangan/page.tsx src/app/pmpersada/keuangan/actions.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/pmpersada
git commit -m "feat: add /pmpersada route tree (layout, beranda, module shell, Keuangan page)"
```

---

## Task 13: Full verification pass

**Files:**
- None (verification only).

- [ ] **Step 1: Full typecheck and lint**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npm run lint`
Expected: zero errors (or only pre-existing errors/warnings unrelated to this plan's files — confirm any such finding is not in a file this plan touched before treating it as acceptable).

- [ ] **Step 2: Live browser check — access & navigation**

Create a test account with `accountScope='pmpersada'` (via `/grup/akun` — PMPersada should now appear in the Perusahaan dropdown, per Task 1). Log in:
- Confirm landing on `/pmpersada`, sidebar shows "PT Putra Maesa Persada" / "Es Balok" badge and 9 module entries (Beranda + 9 from `PMPERSADA_MODULES`).
- Click each of the 8 non-Keuangan modules, confirm each shows the "Belum ada data... FINAC_ES_TB / FINAC_PMP_LOGISTIC" placeholder.
- Navigate to any other `/mkesindo/*` or `/pmputra/*` URL directly — confirm it redirects back to `/pmpersada` (middleware confinement).

As a superadmin or `direktur`-scope account: confirm PMPersada now appears in the PT Switcher dropdown and navigating to it works; confirm `/grup/perusahaan` lists PMPersada with its `utama`/`logistik` connections.

- [ ] **Step 3: Live browser check — Keuangan data**

Open `/pmpersada/keuangan`:
- Confirm P&L KPI tiles, Rincian P&L, Komposisi Biaya vs Laba, Balance Sheet, Cash Flow, Detail COA, BEP, and HPP Bersih all render with real numbers (not zeros/errors) — cross-check a few figures against a manual query if possible (e.g. current month `Pendapatan` should roughly match `SUM` of prefix-4 accounts across both databases).
- Confirm `LabaKotor < Pendapatan` at least in some period (proves prefix-5 HPP accounts are actually being read, unlike pmputra where they're always 0).
- Test Cash Flow Harian: enter a Kas di Tangan figure, add an expense line, delete it — confirm it persists across a page reload (proves `PMP_CashFlowDaily`/`PMP_CashFlowExpense` from Task 2 work).
- Test Anggaran: set a budget figure on one COA row, confirm `BudgetPercent` appears next reload (proves `PMP_Budget` from Task 2 works). Attempt to set a budget on a `logistik`-labeled row — confirm it's rejected with the "tabel Budget hanya ada di database utama" error.
- Test Cost Behavior: tag one prefix-6 account as FIXED, confirm BEP's `FixedCost` changes accordingly on next reload (proves `ChartOfAccount.CostBehavior` from Task 2 works).

- [ ] **Step 4: Regression check — pmputra unaffected**

Re-open `/pmputra/keuangan` (already covered in Task 3's Step 5, but re-confirm here as part of the full pass): all figures identical to before this plan, all 4 pmputra Keuangan interactions (budget, cost behavior, cash flow harian daily figures, cash flow harian expense) still work.

- [ ] **Step 5: Report results**

Summarize pass/fail for each check above. If any check fails, use systematic-debugging to find the root cause before patching — do not layer a fix on top of a guess.
