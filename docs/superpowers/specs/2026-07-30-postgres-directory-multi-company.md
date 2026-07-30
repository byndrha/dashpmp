# Postgres Directory DB + Multi-Company Login Routing

## Context

The app currently serves exactly one company (PT Mitra Kelola Esindo / "Es Kristal") off one MSSQL database, with one flat login system (`DashboardUser`/`DashboardRole` in that same MSSQL DB). The business is now standing up a second company, PT Prima Maesa Putra ("Es Balok"), with its own separate ERP data (two MSSQL databases: `FINAC_ES_PO` and `FINAC_LOGISTIC_PO`, host `pmp-db.mixtra.co.id`). A small central PostgreSQL database sits in front of both companies, holding just **Akun** (accounts) and **Perusahaan** (companies), so login routes people to the right place:

- **Akun Direktur** → cross-company "PMP Group" summary page (`/grup`)
- **Akun Finance MKEsindo** (every account that exists today) → today's dashboard, unchanged
- **Akun Finance PMPutra** → new PT Prima Maesa Putra page (`/pmputra`) — module skeleton only, reusing the look of the Es Kristal dashboard's own module shell (sidebar + module cards), no real PMPutra queries wired up yet

Postgres is provisioned on the user's VPS (Coolify, pgvector17 image) at `130.185.249.74:5432`, user `postgres` — **confirmed reachable from this environment, no SSL required** (`PostgreSQL 17.10`, live-tested). Only the default `postgres` database exists so far — `pmp_directory` must be created.

PMPutra's MSSQL credentials (host `pmp-db.mixtra.co.id`, port **49232** — not the MSSQL default 1433, confirmed by the user after an initial connectivity test against the wrong default port failed — user `pmp`, databases `FINAC_ES_PO`/`FINAC_LOGISTIC_PO`) are **confirmed reachable and working** from this environment (SQL Server 2022, both databases queried successfully). `perusahaan_koneksi`'s stored port has been corrected to 49232.

## Next.js version note (important correction)

This repo runs **Next.js 16**, which renamed Middleware to **Proxy**. The file must be `proxy.ts` (project root, alongside `src/`), exporting a `proxy` function (default or named export) — not `middleware.ts`/`export const middleware`. Functionally equivalent, same `config.matcher` convention. Confirmed via this repo's own vendored `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`. Every reference to "middleware" in the original plan text is replaced with "proxy" below.

## What stays untouched

- `DashboardUser` / `DashboardRole` / `DashboardRolePermission` (MSSQL) — zero migration. Every account that exists today keeps logging in exactly as today and keeps landing on the current dashboard.
- `src/lib/db.ts`, every existing query in `src/lib/queries/*` — untouched.
- The existing `/perusahaan` MSSQL registry page (`DashboardPerusahaan`, PT Switcher) — untouched. Reconciling the two "perusahaan" concepts is later cleanup.
- All existing per-page `requireModuleAccess`/`requireSuperAdmin` gates — untouched, kept as defense-in-depth.

## New Postgres schema (`pmp_directory` database)

```sql
CREATE TABLE perusahaan (
  id SERIAL PRIMARY KEY,
  kode VARCHAR(32) NOT NULL UNIQUE,        -- 'mkesindo' | 'pmputra'
  nama VARCHAR(128) NOT NULL,
  jenis_bisnis VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE perusahaan_koneksi (
  id SERIAL PRIMARY KEY,
  perusahaan_id INT NOT NULL REFERENCES perusahaan(id),
  label VARCHAR(64) NOT NULL,              -- e.g. 'utama', 'logistik'
  db_engine VARCHAR(16) NOT NULL DEFAULT 'mssql',
  host VARCHAR(256) NOT NULL,
  port INT NOT NULL DEFAULT 1433,
  db_name VARCHAR(128) NOT NULL,
  db_user VARCHAR(128) NOT NULL,
  db_password_encrypted VARCHAR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (perusahaan_id, label)
);

CREATE TABLE akun_direktori (
  id SERIAL PRIMARY KEY,
  username VARCHAR(128) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nama VARCHAR(128) NOT NULL,
  email VARCHAR(128),
  scope VARCHAR(16) NOT NULL,              -- 'direktur' | 'pmputra'
  perusahaan_id INT REFERENCES perusahaan(id),  -- NULL for direktur (cross-company)
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_login_ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Seed data: `perusahaan` gets 2 rows (`mkesindo` / PT Mitra Kelola Esindo, `pmputra` / PT Prima Maesa Putra). `perusahaan_koneksi` gets 2 rows under `pmputra` (`utama` → `FINAC_ES_PO`, `logistik` → `FINAC_LOGISTIC_PO`), password encrypted with the existing `encryptSecret()` (`src/lib/crypto-secret.ts`, AES-256-GCM keyed off `AUTH_SECRET`) — same helper already used for `DashboardPerusahaan`. **No `akun_direktori` rows are seeded with real passwords** — the superadmin creates the actual Direktur/PMPutra login(s) through the new admin screen (Phase 4), same as MKEsindo accounts today.

Migration script: `scripts/migrate-directory-db.ts` (idempotent — `CREATE DATABASE` if missing via a `postgres`-db connection first, then `CREATE TABLE IF NOT EXISTS` + `INSERT ... ON CONFLICT DO NOTHING` against `pmp_directory`), run once via `npx tsx`, kept in the repo.

## New dependency

`pg` + `@types/pg` — **already installed** (leftover from an interrupted earlier attempt at this same task; confirmed present in `package.json`/`package-lock.json`, nothing else from that attempt exists). New connection singleton `src/lib/pg.ts`, mirroring `src/lib/db.ts`'s `global`-cached pool pattern.

New env vars (`.env` and `.env.example`):
```
# PostgreSQL "directory" DB — Akun & Perusahaan (bridges MSSQL per company)
DIRECTORY_DB_HOST=130.185.249.74
DIRECTORY_DB_PORT=5432
DIRECTORY_DB_NAME=pmp_directory
DIRECTORY_DB_USER=postgres
DIRECTORY_DB_PASSWORD=<redacted — see .env, gitignored>
DIRECTORY_DB_SSL=false
```
(Confirmed empirically: `ssl:false` works against the real Coolify instance. Real credential values live only in `.env`, never in this doc or git history.)

## Auth rewrite (`src/lib/auth.ts`)

New query module `src/lib/queries/akun-direktori.ts` (Postgres): `findAkunDirektoriByUsername`, `recordFailedLogin`, `recordSuccessfulLogin` — mirrors the exact lockout logic already in `auth.ts` (5 attempts / 15 min) — plus `listAkunDirektori`/`createAkunDirektori`/`updateAkunDirektori`/`resetAkunDirektoriPassword`/`deleteAkunDirektori` for the admin screen.

`authorize()` becomes two-stage:
1. Look up `username` in `akun_direktori` (Postgres) first. If found: bcrypt-verify, apply lockout, return `{ id, name, username, accountScope: row.scope, perusahaanId: row.perusahaan_id, roleId: 0, isSuperAdmin: false, permissions: {} }`.
2. Not found → fall back to the **existing, unmodified** MSSQL `DashboardUser`/`DashboardRole` query exactly as today, return the same shape plus `accountScope: "mkesindo"`, `perusahaanId: null`.

`src/types/next-auth.d.ts`: add `accountScope: "mkesindo" | "direktur" | "pmputra"` and `perusahaanId: number | null` to `Session.user`, `User`, and `JWT` — additive only, every existing field (`username`, `roleId`, `isSuperAdmin`, `permissions`) stays exactly as-is.

## Routing (`proxy.ts`, new file at project root)

No proxy/middleware file exists today. Net-new, self-contained addition:

```ts
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  const scope = req.auth?.user?.accountScope;
  const path = req.nextUrl.pathname;
  if (!scope) return NextResponse.next(); // unauthenticated — let existing page-level guards/redirects handle it
  if (scope === "direktur" && !path.startsWith("/grup")) {
    return NextResponse.redirect(new URL("/grup", req.nextUrl));
  }
  if (scope === "pmputra" && !path.startsWith("/pmputra")) {
    return NextResponse.redirect(new URL("/pmputra", req.nextUrl));
  }
  if (scope === "mkesindo" && (path.startsWith("/grup") || path.startsWith("/pmputra"))) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|invoice|payment|.*\\.png$).*)"],
};
```

Skips `/login`, `/api/*`, static assets, and the existing public token routes (`/invoice/[token]`, `/payment/...` — confirmed exact public route prefixes during Phase 5). This means `src/app/login/page.tsx` needs **no changes** — it keeps pushing to `/` on success, and the proxy immediately bounces Direktur/PMPutra accounts to their real home on the very next navigation.

## New pages

- `src/app/grup/layout.tsx` + `page.tsx` — "PMP Group" summary for Direktur accounts. Own minimal header (not the MKEsindo `AppSidebar`). A card per company: MKEsindo's card reuses existing lightweight query functions (today's penjualan/pengiriman/piutang totals, already computed elsewhere for Beranda) for real numbers; PMPutra's card shows "Belum ada data — integrasi database belum dihubungkan." No drill-down into MKEsindo's full module set from here — flagged as a follow-up.
- `src/app/pmputra/layout.tsx` + `page.tsx` — PT Prima Maesa Putra skeleton. Per the user's explicit choice, this reuses the **same shell shape as the Es Kristal dashboard** — a `Sidebar`-based layout mirroring `AppSidebar`'s structure (own header showing "PT Prima Maesa Putra" instead of "PMP Group"/PTSwitcher, a module nav list matching today's Es Kristal modules as placeholders: Keuangan, Piutang, Penjualan, Pengiriman, etc.), where every page/card reads "Belum ada data" since `FINAC_ES_PO`/`FINAC_LOGISTIC_PO` aren't queried yet (explicitly deferred).

## Admin UI (`/akun/direktori`, new page, superadmin-only)

Gated by the existing `requireSuperAdmin()`. Mirrors the existing `/akun` page's list + create/edit dialog + reset-password + delete pattern, backed by `akun-direktori.ts` (Postgres) instead of `akun.ts` (MSSQL). Fields: nama, username, password, email, scope (Direktur / Finance PMPutra), perusahaan (only for PMPutra scope). Rejects a username that already exists in MSSQL `DashboardUser` (avoid silent shadowing, since Postgres is checked first in `authorize()`).

## Explicitly out of scope this pass

- Real PT Prima Maesa Putra modules/queries against `FINAC_ES_PO`/`FINAC_LOGISTIC_PO` — deferred by explicit user choice, even though connectivity is confirmed working.
- Migrating/retiring the old MSSQL `DashboardPerusahaan` registry page.
- Direktur drill-down into MKEsindo's full existing dashboard (only summary KPIs on `/grup`).
- Any change to how the existing ~65 query files connect to MKEsindo's MSSQL DB.

## Verification

- `npx tsc --noEmit`, `npx eslint`, `npm run build` after each phase.
- Phase 1: throwaway connectivity/seed-check script (delete after use) confirming `pmp_directory` + all 3 tables + seed rows exist as expected.
- PMPutra MSSQL connectivity: confirmed working (see above).
- No browser login test with real credentials (standing rule) — verify the routing logic by reading the code path.

## Execution order

1. `src/lib/pg.ts` connection singleton + env vars.
2. `scripts/migrate-directory-db.ts` (create DB + schema + seed), run + verify, keep in repo.
3. `akun-direktori.ts` query module.
4. Rewrite `auth.ts` (two-stage `authorize()`), extend `next-auth.d.ts`.
5. Add `proxy.ts` (confirm public route prefixes first).
6. Build `/grup` and `/pmputra` pages.
7. Build `/akun/direktori` admin screen + sidebar link.
8. tsc/eslint/build; report to user. Commit only when explicitly asked.
