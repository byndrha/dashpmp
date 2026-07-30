# Wire perusahaan_koneksi (Postgres) as the live source for per-PT MSSQL connections

## Context

Two things exist today but aren't connected to each other:

- `perusahaan_koneksi` (Postgres, `pmp_directory` DB) — already has correct rows for PT
  Prima Maesa Putra (`utama` → `FINAC_ES_PO`, `logistik` → `FINAC_LOGISTIC_PO`, both on
  `pmp-db.mixtra.co.id:49232`), seeded by `scripts/migrate-directory-db.ts`. No row exists
  yet for PT Mitra Kelola Esindo.
- The "Kredensial Database" fields on `/grup/perusahaan`'s edit dialog (`DashboardPerusahaan.DbServer`
  / `DbPort` / `DbName` / `DbUser` / `DbPasswordEncrypted`, MSSQL) — the user already filled these
  in for PT Mitra Kelola Esindo, but **no code anywhere reads them back** (`decryptSecret()` is
  never called). They're inert.

Meanwhile the actual live MSSQL connection every page in the MKEsindo dashboard depends on
(`getPool()` in `src/lib/db.ts`, imported by 52 files) is hardcoded to static env vars
(`DB_SERVER`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`).

Goal: make `perusahaan_koneksi` the one real, live-wired source of DB connection info, replacing
both the inert `DashboardPerusahaan` credential fields and (for MKEsindo) the static env vars.

## Decisions made during brainstorming

- **No env-var fallback.** `getPool()` resolves its config from `perusahaan_koneksi` only. If that
  lookup fails, `getPool()` fails loudly — no silent fallback to `DB_*` env vars. This is a
  deliberate risk the user accepted: simpler mental model (one source of truth), at the cost of
  making the whole MKEsindo dashboard depend on the Postgres directory DB being reachable. `DB_*`
  env vars stay in `.env`/deploy config but `db.ts` stops reading them.
- **Resolve once, cache like today.** Same singleton pattern `getPool()` already uses
  (`global._mssqlPool`, created on first call, reused for the process lifetime). A credential
  change in `perusahaan_koneksi` takes effect on next app restart/redeploy, not live — identical
  to how changing `DB_*` env vars behaves today. No hot-reload, no TTL, no background refresh.
- **Explicit `Kode` link column**, not an implicit Jenis-Bisnis-based mapping. `DashboardPerusahaan`
  (MSSQL, the `/grup/perusahaan` registry) and `perusahaan` (Postgres, keyed by `kode` — used by
  `akun_direktori`/`perusahaan_koneksi`) are two separate tables that were never linked. Add a
  nullable `Kode VARCHAR(32)` column to `DashboardPerusahaan`, backfilled for the two existing rows
  (`mkesindo` / `pmputra`), editable via a dropdown in the admin UI (sourced from Postgres
  `perusahaan`) rather than inferred from Jenis Bisnis — future-proof against, e.g., a second Es
  Kristal PT.
- **UI connection-block count follows Jenis Bisnis**: Es Kristal → 1 block (label `utama`), Es Balok
  → 2 blocks (labels `utama` + `logistik`). Not a generic add/remove list — the locked
  `PERUSAHAAN_JENIS_BISNIS` enum already dictates this shape.
- **PMPutra gets a connection-opener too**, even though no PMPutra page queries anything yet — built
  now so it's ready when that module is built later, per explicit user request.
- Old `DashboardPerusahaan` credential columns (`DbServer`/`DbPort`/`DbName`/`DbUser`/
  `DbPasswordEncrypted`) are left in place (unused, harmless) — no destructive column drop. The
  already-filled-in MKEsindo values there are simply superseded, not migrated (user will re-enter
  via the new UI, which is a small amount of re-entry the user has already agreed to).

## Data model changes

**MSSQL — `DashboardPerusahaan`** (one-off DDL script, run once via `npx tsx`, then discarded, same
convention as the original table's creation):

```sql
ALTER TABLE DashboardPerusahaan ADD Kode VARCHAR(32) NULL;
UPDATE DashboardPerusahaan SET Kode = 'mkesindo' WHERE Nama = 'PT Mitra Kelola Esindo';
UPDATE DashboardPerusahaan SET Kode = 'pmputra' WHERE Nama = 'PT Prima Maesa Putra';
```

`PerusahaanRow`/`PerusahaanInput` (`src/lib/queries/perusahaan.ts`) gain `kode: string | null`.

**Postgres — `perusahaan_koneksi`**: no schema change needed, table already fits (see
`scripts/migrate-directory-db.ts`). One new row seeded for `mkesindo`/`utama` using the credentials
the user already provided in chat (host `130.185.249.74`, port `1433`, db `MKEsindo`, user `sa`,
same password as the existing `DB_PASSWORD` env var) — via a one-off script, since the new admin UI
doesn't exist until this plan is implemented.

## Connection resolution

New Postgres query module `src/lib/queries/perusahaan-koneksi.ts`:

- `resolveKoneksi(kode: string, label: string): Promise<{host, port, dbName, dbUser, dbPassword} | null>`
  — joins `perusahaan` + `perusahaan_koneksi`, decrypts the password with the existing
  `decryptSecret()`. Used by the two pool modules below.
- `listKoneksiForPerusahaan(perusahaanKode: string): Promise<KoneksiRow[]>` — for the admin UI,
  password never returned (mirrors `HasDbPassword`-style masking already used for
  `DashboardPerusahaan`).
- `upsertKoneksi(input)`, `deleteKoneksi(id)` — admin UI CRUD, encrypts on write.

**`src/lib/db.ts`** (MKEsindo, used by 52 existing files — interface unchanged, `getPool(): Promise<sql.ConnectionPool>`, no caller needs to change):

```ts
export function getPool(): Promise<sql.ConnectionPool> {
  if (!global._mssqlPool) {
    global._mssqlPool = resolveKoneksi("mkesindo", "utama")
      .then((cfg) => {
        if (!cfg) throw new Error('No perusahaan_koneksi row for kode="mkesindo" label="utama"');
        return new sql.ConnectionPool({ server: cfg.host, port: cfg.port, database: cfg.dbName, user: cfg.dbUser, password: cfg.dbPassword, options: {...} }).connect();
      })
      .catch((err) => { global._mssqlPool = undefined; throw err; });
  }
  return global._mssqlPool;
}
```

Same `options.encrypt`/`trustServerCertificate`/pool-size/timeout constants as today (these aren't
credentials, no reason to move them to Postgres).

**New `src/lib/db-pmputra.ts`** — same singleton-per-label pattern, keyed in a `Map<"utama"|"logistik", Promise<sql.ConnectionPool>>`:

```ts
export function getPmputraPool(label: "utama" | "logistik"): Promise<sql.ConnectionPool> { ... }
```

Not called by any page yet — exists so the future PMPutra module can use it directly.

## Admin UI changes

`PerusahaanFormDialog` (`src/components/dashboard/perusahaan-form-dialog.tsx`):

- Remove the "Kredensial Database" fieldset entirely (dead fields).
- Add "Tautan & Koneksi Database" section:
  - Dropdown "Tautan ke Perusahaan (Postgres)" — options from `listPerusahaanDirektori()`
    (already exists, `src/lib/queries/akun-direktori.ts`), bound to the new `kode` field.
  - If linked and `jenisBisnis === "Es Kristal"`: one connection block, label fixed to `utama`
    (host/port/db name/user/password fields).
  - If linked and `jenisBisnis === "Es Balok"`: two connection blocks, labels fixed to `utama` and
    `logistik`.
  - If not linked: connection blocks hidden, hint text explaining a link is required first.
  - Password fields follow the existing write-only convention (blank = keep current on edit).
- New server actions in `src/app/grup/perusahaan/actions.ts`: `upsertKoneksiAction`,
  `deleteKoneksiAction` (thin wrappers over the new query module, `requireGrupAccess()`-gated like
  the rest of that file).

## Non-goals (explicitly out of scope)

- No PMPutra query/page work — `getPmputraPool()` exists unused until that module is built later.
- No live credential hot-reload — restart required, matching today's env-var behavior.
- No removal of `DB_*` env vars from `.env`/deploy config, and no destructive DB migration on the
  old unused `DashboardPerusahaan` credential columns.
- No change to `akun_direktori`/`auth.ts` — unrelated to this task.

## Risks

- `getPool()` (MKEsindo, 52 files, live production) now hard-depends on the Postgres directory DB
  being reachable at process start — a Postgres outage takes the whole MKEsindo dashboard down, not
  just login (unlike today's auth.ts fallback fix). Accepted explicitly by the user.
- Migrating MKEsindo's live credential source is a change to code every single page depends on —
  needs careful verification (real login + a few real page loads) before considering this done,
  not just a clean `npm run build`.

## Files touched (implementation plan will detail exact steps)

- New: `src/lib/queries/perusahaan-koneksi.ts`, `src/lib/db-pmputra.ts`
- Modified: `src/lib/db.ts`, `src/lib/queries/perusahaan.ts`, `src/app/grup/perusahaan/actions.ts`,
  `src/components/dashboard/perusahaan-form-dialog.tsx`
- One-off scripts (run then deleted, per project convention): DDL for `Kode` column + backfill,
  seed for MKEsindo's `perusahaan_koneksi` row.
