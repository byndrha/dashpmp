# Manajemen Sesi Login + Pelacak Lokasi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two independent features bundled into one plan since they were approved together: (1) a Superadmin page listing every active login session system-wide with a per-session force-logout action; (2) continuous background GPS location collection for every Android account, with a first live-position viewer for Marketing accounts inside the existing Pemasaran module.

**Architecture:** Part A (Tasks 1-5) adds a `akun_sesi` Postgres table, a `sessionId` JWT claim, and an unconditional per-request revocation check inside `src/lib/auth.ts`'s `jwt` callback — this callback runs through NextAuth's core `auth()` function, which every `requireXXX()` guard in this app already calls reliably (confirmed today: this mechanism does **not** depend on `proxy.ts`, which was separately found to be unreliable for some routes in this dev environment — see Global Constraints). Part B (Tasks 6-11) adds a `@capgo/background-geolocation`-backed client bootstrap mounted once at the root layout, a `akun_lokasi` Postgres table with self-cleaning 30-day retention, and a Leaflet-based live map reusing this project's existing multi-point map component pattern.

**Tech Stack:** Next.js 16 Server Components/Actions, NextAuth v5 (JWT strategy), Postgres via `pg` (the existing "directory" DB, `src/lib/pg.ts`), Capacitor 8 Android, `@capgo/background-geolocation` (already installed, v8.3.2), `react-leaflet`.

## Global Constraints

- All new Postgres DDL uses the established `scripts/migrate-*.ts` idiom in this repo: `CREATE TABLE IF NOT EXISTS` (idempotent, safe to re-run), a plain `pg` `Client` (not the pooled `getPgPool()` — that's for app runtime, not one-off scripts), `import "dotenv/config"` at the top, run via `npx tsx scripts/<name>.ts`.
- Every new Postgres query function goes through `getPgPool()` from `@/lib/pg`, with `$1`/`$2`-style parameterized queries — the same pattern already used throughout `src/lib/queries/akun.ts`.
- **`akun_sesi` deployment side effect, already disclosed to the user:** the moment Task 2 ships, every account with an existing session (issued before this change) fails the revocation check on its next request and is forced to log in again — their old JWTs have no `sessionId` claim. This is expected, not a bug to design around.
- **Do not add any Satpam-redirect-style logic to `src/proxy.ts` for these features.** `proxy.ts` was confirmed today to not reliably execute for every route in this dev environment (Next.js 16 renamed `middleware.ts` to `proxy.ts` with a different required export shape, and even after adapting to the correct shape, some routes still don't consistently invoke it). Every access guard in this plan must be a page/layout-level `requireXXX()`-style check (proven reliable throughout this app), never a `proxy.ts`-only check.
- Part B's location bootstrap must only run inside the native Android app (`Capacitor.isNativePlatform()`), never in a desktop/mobile browser tab.
- Part A and Part B share no files — they can be implemented and reviewed as fully independent task sequences within this one plan.

---

## Task 1: `akun_sesi` migration

**Files:**
- Create: `scripts/migrate-akun-sesi.ts`

**Interfaces:**
- Produces: Postgres table `akun_sesi(id UUID PK, akun_id INT FK->akun(id), user_agent TEXT, ip_address TEXT, created_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ NULL)` — Task 3's query functions read/write this table.

- [ ] **Step 1: Write the migration script**

```ts
// Idempotent setup for the akun_sesi table — one row per login, used to
// track and force-revoke individual active sessions. Safe to re-run.
//
// Usage: npx tsx scripts/migrate-akun-sesi.ts
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
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS akun_sesi (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        akun_id INTEGER NOT NULL REFERENCES akun(id),
        user_agent TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS akun_sesi_akun_id_idx ON akun_sesi (akun_id) WHERE revoked_at IS NULL
    `);
    console.log("akun_sesi table ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`gen_random_uuid()` needs the `pgcrypto` extension — `CREATE EXTENSION IF NOT EXISTS` is idempotent and safe even if it's already enabled (it is standard on most managed Postgres, but this makes the script self-sufficient rather than assuming it).

- [ ] **Step 2: Run it against the real directory DB**

Run: `npx tsx -r dotenv/config scripts/migrate-akun-sesi.ts` (this project's scripts need `-r dotenv/config` for `.env` to load correctly, despite the script's own `import "dotenv/config"` — confirmed necessary in this project's established one-off-script convention).

Expected output: `akun_sesi table ready.`

- [ ] **Step 3: Verify**

Write a throwaway script (or a `psql`-equivalent query via a quick `pg` one-off) confirming `akun_sesi` exists with the expected columns, and that `INSERT INTO akun_sesi (akun_id) VALUES ((SELECT id FROM akun LIMIT 1))` followed by a `SELECT`/`DELETE` round-trips correctly against a REAL `akun.id` (never a fabricated one — this project's established practice). Delete the test row afterward.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-akun-sesi.ts
git commit -m "Add akun_sesi migration for active session tracking"
```

---

## Task 2: Session creation, revocation check, and last-seen throttle in `auth.ts`

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/queries/akun.ts`
- Modify: `src/types/next-auth.d.ts`

**Interfaces:**
- Consumes: `akun_sesi` (Task 1).
- Produces:
  ```ts
  export async function createAkunSesi(akunId: number, userAgent: string | null, ipAddress: string | null): Promise<string> // returns new session UUID
  export async function checkAkunSesi(sesiId: string): Promise<boolean> // true = still valid (exists, not revoked)
  export async function touchAkunSesiLastSeen(sesiId: string): Promise<void> // no-op if last update was <5 min ago
  ```
  Task 4 (the sesi management page) consumes `listActiveSesi`/`revokeAkunSesi`, added in Task 3 — this task only adds the three functions the auth flow itself needs.

- [ ] **Step 1: Add the three query functions to `akun.ts`**

Add near the end of `src/lib/queries/akun.ts` (after the existing auth-related functions, following the same `getPgPool()` + parameterized-query pattern already used throughout this file):

```ts
// ---------- Sesi login aktif (consumed by auth.ts's jwt callback) ----------

export async function createAkunSesi(akunId: number, userAgent: string | null, ipAddress: string | null): Promise<string> {
  const pool = getPgPool();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO akun_sesi (akun_id, user_agent, ip_address) VALUES ($1, $2, $3) RETURNING id`,
    [akunId, userAgent, ipAddress]
  );
  return result.rows[0].id;
}

export async function checkAkunSesi(sesiId: string): Promise<boolean> {
  const pool = getPgPool();
  const result = await pool.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM akun_sesi WHERE id = $1`,
    [sesiId]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0].revoked_at === null;
}

export async function touchAkunSesiLastSeen(sesiId: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE akun_sesi SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - INTERVAL '5 minutes'`,
    [sesiId]
  );
}
```

The `WHERE last_seen_at < now() - INTERVAL '5 minutes'` clause is the throttle — the `UPDATE` is a no-op (matches zero rows) if the session was already touched within the last 5 minutes, so this is always safe to call on every request without extra branching in the caller.

- [ ] **Step 2: Add `sessionId` to the session/JWT type declarations**

In `src/types/next-auth.d.ts`, add `sessionId: string;` to both the `Session.user` interface and the `JWT` interface (next to the existing `isSatpam: boolean;` line in each block) — this is a plain type addition, no behavior change.

- [ ] **Step 3: Wire session creation and revocation into `auth.ts`**

In `src/lib/auth.ts`:

1. Add the import: `import { findAkunByUsername, recordFailedLogin, recordSuccessfulLogin, getPermissionMapForPeran, createAkunSesi, checkAkunSesi, touchAkunSesiLastSeen } from "@/lib/queries/akun";`

2. Add `sessionId: string;` to the local `AuthorizedUser` interface.

3. Inside `authorize()`, after the existing `await recordSuccessfulLogin(row.id, ip);` line, capture the User-Agent and create the session row:

```ts
        await recordSuccessfulLogin(row.id, ip);

        const userAgent = request?.headers?.get("user-agent") ?? null;
        const sessionId = await createAkunSesi(row.id, userAgent, ip);
```

Then add `sessionId,` to the `user: AuthorizedUser = { ... }` object literal being constructed right below it.

4. Replace the `jwt` callback entirely with:

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
        token.sessionId = u.sessionId;
        return token;
      }
      // Every subsequent call (no fresh `user` — just decoding an existing
      // token) is the revocation check: if this session was force-logged-out
      // from the sesi-login-aktif admin page, invalidate it immediately
      // rather than waiting for the JWT to naturally expire.
      if (typeof token.sessionId === "string") {
        const valid = await checkAkunSesi(token.sessionId);
        if (!valid) return null;
        await touchAkunSesiLastSeen(token.sessionId);
      }
      return token;
    },
```

Returning `null` from this callback is not a guess — confirmed directly against `@auth/core`'s actual source (`node_modules/@auth/core/lib/actions/session.js`): when the `jwt` callback returns `null`, session construction is skipped entirely and the session cookie isn't refreshed, so the very next request from that browser/device is treated as unauthenticated by every `requireXXX()` guard in this app.

5. In the `session` callback, add one line inside the existing `if (session.user) { ... }` block, alongside the other `session.user.X = token.X as ...` assignments:

```ts
        session.user.sessionId = token.sessionId as string;
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — expect 0 errors (this touches a shared auth type, so a project-wide check matters here).
Run: `npx eslint src/lib/auth.ts src/lib/queries/akun.ts src/types/next-auth.d.ts` — expect 0 errors.

- [ ] **Step 3: Live-verify against the real dev server**

Since this changes the login flow itself, verify end-to-end with a REAL account (this project's established practice — never fabricate test accounts): log in through the actual `/login` page (or, if no live credentials are available to the implementer, verify structurally by reading the diff plus confirming via a direct database query that a new `akun_sesi` row was created after a real login elsewhere in this session, if one occurs). At minimum, confirm via `npx tsc --noEmit` that the full callback chain type-checks, and confirm by direct SQL query that `akun_sesi` gets a new row on the next real login this project sees (even if that login happens in a later task's verification step).

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts src/lib/queries/akun.ts src/types/next-auth.d.ts
git commit -m "Add session tracking, revocation check, and last-seen throttle to auth flow"
```

---

## Task 3: `listActiveSesi` and `revokeAkunSesi` queries

**Files:**
- Modify: `src/lib/queries/akun.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AkunSesiRow {
    sesiId: string;
    akunId: number;
    nama: string;
    username: string;
    userAgent: string | null;
    ipAddress: string | null;
    createdAt: string;
    lastSeenAt: string;
  }
  export async function listActiveSesi(): Promise<AkunSesiRow[]>
  export async function revokeAkunSesi(sesiId: string): Promise<void>
  ```
  Task 4 consumes both directly.

- [ ] **Step 1: Add the two functions**

Add to `src/lib/queries/akun.ts`, right after the three functions from Task 2:

```ts
export interface AkunSesiRow {
  sesiId: string;
  akunId: number;
  nama: string;
  username: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export async function listActiveSesi(): Promise<AkunSesiRow[]> {
  const pool = getPgPool();
  const result = await pool.query<{
    id: string;
    akun_id: number;
    nama: string;
    username: string;
    user_agent: string | null;
    ip_address: string | null;
    created_at: Date;
    last_seen_at: Date;
  }>(
    `SELECT s.id, s.akun_id, a.nama, a.username, s.user_agent, s.ip_address, s.created_at, s.last_seen_at
     FROM akun_sesi s
     JOIN akun a ON a.id = s.akun_id
     WHERE s.revoked_at IS NULL
     ORDER BY s.last_seen_at DESC`
  );
  return result.rows.map((r) => ({
    sesiId: r.id,
    akunId: r.akun_id,
    nama: r.nama,
    username: r.username,
    userAgent: r.user_agent,
    ipAddress: r.ip_address,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
  }));
}

export async function revokeAkunSesi(sesiId: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE akun_sesi SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [sesiId]);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/akun.ts` — both clean.

- [ ] **Step 3: Live-verify against real data**

Using `npx tsx -r dotenv/config` (this project's established pattern for one-off DB scripts), call `listActiveSesi()` and confirm it returns real rows matching what's actually in `akun_sesi` (cross-check against a direct `SELECT` on the table). If at least one real row exists, call `revokeAkunSesi` on it, confirm `listActiveSesi()` no longer returns it, then leave it revoked (do not un-revoke — a revoked test session is a safe, real state, not something requiring cleanup, since Task 2's mechanism means that device would need to log in again regardless).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/akun.ts
git commit -m "Add listActiveSesi and revokeAkunSesi queries"
```

---

## Task 4: `/grup/akun/sesi` page

**Files:**
- Create: `src/app/grup/akun/sesi/page.tsx`
- Create: `src/app/grup/akun/sesi/actions.ts`
- Create: `src/components/dashboard/akun-sesi-list.tsx`

**Interfaces:**
- Consumes: `requireGrupAccess` (existing, `src/lib/require-access.ts`), `listActiveSesi`/`AkunSesiRow`/`revokeAkunSesi` (Task 3), `formatRelativeTime` (existing, `src/lib/format.ts`).

- [ ] **Step 1: Server action**

```ts
// src/app/grup/akun/sesi/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { revokeAkunSesi } from "@/lib/queries/akun";

export async function revokeSesiAction(sesiId: string): Promise<void> {
  await requireGrupAccess();
  await revokeAkunSesi(sesiId);
  revalidatePath("/grup/akun/sesi");
}
```

- [ ] **Step 2: Page (Server Component)**

```tsx
// src/app/grup/akun/sesi/page.tsx
import { requireGrupAccess } from "@/lib/require-access";
import { listActiveSesi } from "@/lib/queries/akun";
import { AkunSesiList } from "@/components/dashboard/akun-sesi-list";

export default async function AkunSesiPage() {
  await requireGrupAccess();
  const sesiList = await listActiveSesi();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Sesi Login Aktif</h1>
        <p className="text-sm text-muted-foreground">
          Daftar seluruh sesi login yang sedang aktif di seluruh sistem — hanya Super Administrator/Direktur yang
          dapat melihat dan mengatur halaman ini.
        </p>
      </div>
      <AkunSesiList sesiList={sesiList} />
    </div>
  );
}
```

- [ ] **Step 3: List component with revoke button**

```tsx
// src/components/dashboard/akun-sesi-list.tsx
"use client";

import { useState, useTransition } from "react";
import { LogOut, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import { revokeSesiAction } from "@/app/grup/akun/sesi/actions";
import type { AkunSesiRow } from "@/lib/queries/akun";

export function AkunSesiList({ sesiList }: { sesiList: AkunSesiRow[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRevoke(sesiId: string) {
    setPendingId(sesiId);
    startTransition(async () => {
      await revokeSesiAction(sesiId);
      setPendingId(null);
    });
  }

  if (sesiList.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Tidak ada sesi aktif.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {sesiList.map((s) => (
        <Card key={s.sesiId} className="flex flex-row items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <Monitor className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium">
                {s.nama} <span className="font-normal text-muted-foreground">({s.username})</span>
              </p>
              <p className="truncate text-xs text-muted-foreground" title={s.userAgent ?? undefined}>
                {s.userAgent ?? "Tidak diketahui"}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.ipAddress ?? "IP tidak diketahui"} &middot; Login {formatRelativeTime(s.createdAt)} &middot;
                Terakhir aktif {formatRelativeTime(s.lastSeenAt)}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending && pendingId === s.sesiId}
            onClick={() => handleRevoke(s.sesiId)}
          >
            <LogOut className="size-4" />
            Logout
          </Button>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`, `npx eslint src/app/grup/akun/sesi/page.tsx src/app/grup/akun/sesi/actions.ts src/components/dashboard/akun-sesi-list.tsx` — all clean.
Run: `npm run build` — succeeds.

- [ ] **Step 5: Live-verify**

Open `/grup/akun/sesi` as a Superadmin/Direktur session, confirm real active sessions render (cross-check row count/content against a direct `listActiveSesi()` call or DB query), click "Logout" on a real session, confirm it disappears from the list and the corresponding device is actually logged out on its next request (if a live second session is available to check; otherwise confirm via DB that `revoked_at` was set and via `checkAkunSesi` returning `false` for that id).

- [ ] **Step 6: Commit**

```bash
git add src/app/grup/akun/sesi/page.tsx src/app/grup/akun/sesi/actions.ts src/components/dashboard/akun-sesi-list.tsx
git commit -m "Add active session management page"
```

---

## Task 5: Link the sesi page from `/grup/akun`

**Files:**
- Modify: `src/app/grup/akun/page.tsx`

**Interfaces:**
- Consumes: nothing new — this is a one-line navigation addition mirroring the existing "Peran & Otoritas" button.

- [ ] **Step 1: Add the header button**

In `src/app/grup/akun/page.tsx`, add `Monitor` to the existing `lucide-react` import line (`import { ShieldCheck, Monitor } from "lucide-react";`), then add a second button next to the existing "Peran & Otoritas" one inside the `<div className="flex items-center justify-between gap-3">` header block:

```tsx
        <div className="flex items-center gap-2">
          <Button variant="outline" render={<Link href="/grup/akun/sesi" />}>
            <Monitor className="size-4" />
            Sesi Login Aktif
          </Button>
          <Button variant="outline" render={<Link href="/grup/akun/peran" />}>
            <ShieldCheck className="size-4" />
            Peran &amp; Otoritas
          </Button>
        </div>
```

This replaces the single existing `<Button variant="outline" render={<Link href="/grup/akun/peran" />}>...</Button>` — wrap both buttons in the new `<div className="flex items-center gap-2">` so they sit side by side.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`, `npx eslint src/app/grup/akun/page.tsx` — clean.

- [ ] **Step 3: Live-verify**

Open `/grup/akun`, confirm both buttons render side by side, confirm "Sesi Login Aktif" navigates to `/grup/akun/sesi`.

- [ ] **Step 4: Commit**

```bash
git add src/app/grup/akun/page.tsx
git commit -m "Link Sesi Login Aktif page from Akun management"
```

---

## Task 6: `akun_lokasi` migration

**Files:**
- Create: `scripts/migrate-akun-lokasi.ts`

**Interfaces:**
- Produces: Postgres table `akun_lokasi(id BIGSERIAL PK, akun_id INT FK->akun(id), latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, accuracy DOUBLE PRECISION NULL, recorded_at TIMESTAMPTZ)` — Task 8's query functions read/write this table.

- [ ] **Step 1: Write the migration script**

```ts
// Idempotent setup for the akun_lokasi table — one row per background
// location ping, per account. Safe to re-run.
//
// Usage: npx tsx scripts/migrate-akun-lokasi.ts
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS akun_lokasi (
        id BIGSERIAL PRIMARY KEY,
        akun_id INTEGER NOT NULL REFERENCES akun(id),
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        accuracy DOUBLE PRECISION,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS akun_lokasi_akun_id_recorded_at_idx ON akun_lokasi (akun_id, recorded_at DESC)
    `);
    console.log("akun_lokasi table ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx -r dotenv/config scripts/migrate-akun-lokasi.ts`. Expected output: `akun_lokasi table ready.`

- [ ] **Step 3: Verify**

Same pattern as Task 1 Step 3 — confirm the table/index exist, round-trip a test insert/delete against a real `akun.id`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-akun-lokasi.ts
git commit -m "Add akun_lokasi migration for background location history"
```

---

## Task 7: `akun-lokasi.ts` query module (record + retention + Marketing query)

**Files:**
- Create: `src/lib/queries/akun-lokasi.ts`

**Interfaces:**
- Consumes: `akun_lokasi` (Task 6), `MARKETING_ROLE_ID` (existing, `src/lib/roles.ts`).
- Produces:
  ```ts
  export interface MarketingPosition {
    akunId: number;
    nama: string;
    latitude: number;
    longitude: number;
    recordedAt: string;
  }
  export async function recordLokasi(akunId: number, latitude: number, longitude: number, accuracy: number | null): Promise<void>
  export async function getLatestMarketingPositions(): Promise<MarketingPosition[]>
  ```
  Task 9 (the record action) and Task 10 (the map component's data source) consume these directly.

- [ ] **Step 1: Write the module**

```ts
import { getPgPool } from "@/lib/pg";
import { MARKETING_ROLE_ID } from "@/lib/roles";

const RETENTION_DAYS = 30;

// One row per ping. Self-cleaning: every insert also deletes this same
// account's rows older than RETENTION_DAYS, so the table stays bounded
// without a cron job or scheduled task (this project has none of its own —
// continuous 1-2 minute pings from an active device are what keep this
// cleanup running).
export async function recordLokasi(
  akunId: number,
  latitude: number,
  longitude: number,
  accuracy: number | null
): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO akun_lokasi (akun_id, latitude, longitude, accuracy) VALUES ($1, $2, $3, $4)`,
    [akunId, latitude, longitude, accuracy]
  );
  await pool.query(
    `DELETE FROM akun_lokasi WHERE akun_id = $1 AND recorded_at < now() - INTERVAL '${RETENTION_DAYS} days'`,
    [akunId]
  );
}

export interface MarketingPosition {
  akunId: number;
  nama: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
}

// Latest position per Marketing account — DISTINCT ON is Postgres's
// idiomatic "one row per group, picked by ORDER BY" pattern.
export async function getLatestMarketingPositions(): Promise<MarketingPosition[]> {
  const pool = getPgPool();
  const result = await pool.query<{
    akun_id: number;
    nama: string;
    latitude: number;
    longitude: number;
    recorded_at: Date;
  }>(
    `SELECT DISTINCT ON (a.id) a.id AS akun_id, a.nama, al.latitude, al.longitude, al.recorded_at
     FROM akun a
     JOIN akun_lokasi al ON al.akun_id = a.id
     WHERE a.peran_id = $1
     ORDER BY a.id, al.recorded_at DESC`,
    [MARKETING_ROLE_ID]
  );
  return result.rows.map((r) => ({
    akunId: r.akun_id,
    nama: r.nama,
    latitude: r.latitude,
    longitude: r.longitude,
    recordedAt: r.recorded_at.toISOString(),
  }));
}
```

Before writing this file, confirm `MARKETING_ROLE_ID`'s real export path — it lives in `src/lib/roles.ts` (re-exported from `src/lib/queries/mitra-pengajuan.ts` for that file's own convenience) — import it from `@/lib/roles` directly here, not through `mitra-pengajuan.ts`, since this module has no other reason to depend on that file.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/akun-lokasi.ts` — both clean.

- [ ] **Step 3: Live-verify against real data**

Using `npx tsx -r dotenv/config`, call `recordLokasi` with a real `akun.id` (pick one belonging to a real Marketing-role account if one exists — check via `SELECT id, nama, peran_id FROM akun WHERE peran_id = <MARKETING_ROLE_ID> LIMIT 1` first) and a real-looking lat/lng (e.g. somewhere in the actual service area this company operates in, not `0,0`). Confirm `getLatestMarketingPositions()` then returns that account with the inserted coordinates. Insert a second, older-dated row for the same account (if easy to simulate) to confirm `DISTINCT ON` really picks the latest one, not an arbitrary one.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/akun-lokasi.ts
git commit -m "Add akun_lokasi query module (record with retention, Marketing positions)"
```

---

## Task 8: Location-record server action

**Files:**
- Create: `src/app/api/lokasi/actions.ts`

**Interfaces:**
- Consumes: `recordLokasi` (Task 7), `auth` (existing, `src/lib/auth.ts`).
- Produces: `export async function recordLokasiAction(input: { latitude: number; longitude: number; accuracy: number | null }): Promise<void>` — Task 9's bootstrap component calls this on every position update.

- [ ] **Step 1: Write the action**

```ts
"use server";

import { auth } from "@/lib/auth";
import { recordLokasi } from "@/lib/queries/akun-lokasi";

export async function recordLokasiAction(input: {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  await recordLokasi(Number(session.user.id), input.latitude, input.longitude, input.accuracy);
}
```

Deliberately no `requireXXX()` guard here — every logged-in account (every role) is meant to report its own location, per the spec's explicit "track everyone" scope. `auth()` returning a session is the only requirement; an unauthenticated caller is silently ignored rather than erroring, since a stray call after a session expires mid-background-tracking shouldn't surface as a user-visible error.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/app/api/lokasi/actions.ts` — both clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/lokasi/actions.ts
git commit -m "Add recordLokasiAction server action"
```

---

## Task 9: Location tracking bootstrap component

**Files:**
- Create: `src/components/location-tracking-bootstrap.tsx`
- Modify: `src/components/providers.tsx`

**Interfaces:**
- Consumes: `recordLokasiAction` (Task 8), `@capgo/background-geolocation`'s `BackgroundGeolocation.start`/`.stop` (already installed, v8.3.2 — real API confirmed by reading `node_modules/@capgo/background-geolocation/dist/esm/definitions.d.ts` directly), `Capacitor.isNativePlatform()` (`@capacitor/core`, already a dependency), `useSession` (`next-auth/react`).

- [ ] **Step 1: Write the bootstrap component**

The installed plugin's `start(options, callback)` has no built-in time-interval option (confirmed from its real type definitions — only `distanceFilter` (meters), `stale`, `backgroundTitle`/`backgroundMessage`, and `requestPermissions`) — the callback fires as often as the OS location provider produces updates. To honor the approved "every 1-2 minutes" ping rate without spamming the server on every callback firing, this component throttles client-side: it tracks the last successfully recorded timestamp and only calls the server action if at least 90 seconds have passed.

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
import { recordLokasiAction } from "@/app/api/lokasi/actions";

const MIN_PING_INTERVAL_MS = 90_000;

export function LocationTrackingBootstrap() {
  const { status } = useSession();
  const lastSentAtRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (status !== "authenticated") return;
    if (startedRef.current) return;
    startedRef.current = true;

    BackgroundGeolocation.start(
      {
        backgroundTitle: "PMP Group",
        backgroundMessage: "Melacak lokasi untuk keperluan operasional",
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      },
      (position, error) => {
        if (error || !position) return;
        const now = Date.now();
        if (now - lastSentAtRef.current < MIN_PING_INTERVAL_MS) return;
        lastSentAtRef.current = now;
        recordLokasiAction({
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
        }).catch(() => {
          // A single failed ping isn't user-facing — the next one 90s later
          // will succeed once whatever transient issue (e.g. no network)
          // clears. No retry/backoff needed given how frequent pings are.
        });
      }
    );

    return () => {
      BackgroundGeolocation.stop();
      startedRef.current = false;
    };
  }, [status]);

  return null;
}
```

- [ ] **Step 2: Mount it in `Providers`**

`src/components/providers.tsx` already establishes the exact precedent for this: it wraps `SessionProvider` around everything, and already mounts one no-visual-output, `Capacitor.isNativePlatform()`-gated client component this same way — `NativeStatusBarSync`, rendered directly inside `<PaletteProvider>` alongside `{children}`. Follow that exact pattern:

```tsx
"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { PaletteProvider } from "@/components/palette-provider";
import { NativeStatusBarSync } from "@/components/native-status-bar-sync";
import { LocationTrackingBootstrap } from "@/components/location-tracking-bootstrap";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <PaletteProvider>
          <NativeStatusBarSync />
          <LocationTrackingBootstrap />
          {children}
        </PaletteProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
```

This is the full new content of `providers.tsx` — only the two `LocationTrackingBootstrap`-related lines are additions; everything else is unchanged from the current file.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/components/location-tracking-bootstrap.tsx src/app/layout.tsx` — both clean.
Run: `npm run build` — succeeds.

- [ ] **Step 4: Verify as much as this environment allows, and say plainly what can't be checked**

`Capacitor.isNativePlatform()` returns `false` in every browser context, including this project's Browser-pane preview — so the actual `BackgroundGeolocation.start()` call cannot fire or be observed here at all, by design. What CAN be verified in this environment: confirm via `javascript_tool`/console that `Capacitor.isNativePlatform()` really does evaluate to `false` in the Browser pane (proving the gate correctly prevents any native call from being attempted outside the real app), and confirm the component renders without throwing (React DevTools/console showing no error from mounting it). Real end-to-end verification — the persistent notification appearing, location pings actually reaching `akun_lokasi` from a real device — requires a real Android build on a device/emulator, which this plan cannot execute. State this plainly rather than claim it passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/location-tracking-bootstrap.tsx src/app/layout.tsx
git commit -m "Add background location tracking bootstrap, mounted app-wide"
```

---

## Task 10: Marketing live-position map

**Files:**
- Create: `src/components/dashboard/marketing-location-map.tsx`
- Modify: `src/app/(dashboard)/pemasaran/page.tsx`

**Interfaces:**
- Consumes: `getLatestMarketingPositions`/`MarketingPosition` (Task 7), `formatRelativeTime` (existing, `src/lib/format.ts`), this project's existing Leaflet setup (`react-leaflet`'s `MapContainer`/`TileLayer`/`Marker`/`Popup`, `TILE_SOURCES`/`MapStyle` from `src/lib/map-styles.ts`, `MapStyleSwitcher`/`MapZoomControl`/`MapAttribution` from `src/components/dashboard/map-controls.tsx` — read `src/components/dashboard/mitra-locations-map.tsx` in full before writing this component, since it's the direct pattern to follow for a multi-pin Leaflet map in this codebase, including its exact marker-icon workaround for Next.js's bundler).

- [ ] **Step 1: Write the map component**

Follow `mitra-locations-map.tsx`'s structure closely: a `"use client"` component taking `positions: MarketingPosition[]` as a prop, rendering a `MapContainer` with one `Marker`+`Popup` per position (popup showing the account's `nama` and `formatRelativeTime(recordedAt)`), reusing the SAME marker-icon-URL workaround already established in that file (Leaflet's default icon paths break under Next.js's bundler — `mitra-locations-map.tsx` already solves this with a CDN-hosted `L.icon(...)`, copy that exact pattern rather than re-solving it). Auto-fit the map bounds to all markers on mount (check whether `mitra-locations-map.tsx` already does this via a `useMap()`-based helper component and reuse that same approach if so).

```tsx
"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { TILE_SOURCES } from "@/lib/map-styles";
import { formatRelativeTime } from "@/lib/format";
import type { MarketingPosition } from "@/lib/queries/akun-lokasi";

// Same CDN-hosted marker icon workaround as mitra-locations-map.tsx —
// Leaflet's default icon paths break under Next.js's bundler otherwise.
const marketingIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export function MarketingLocationMap({ positions }: { positions: MarketingPosition[] }) {
  if (positions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">
        Belum ada data posisi Marketing.
      </div>
    );
  }

  const center: [number, number] = [positions[0].latitude, positions[0].longitude];

  return (
    <div className="h-96 overflow-hidden rounded-lg border">
      <MapContainer center={center} zoom={11} className="h-full w-full">
        <TileLayer url={TILE_SOURCES.default.url} attribution={TILE_SOURCES.default.attribution} />
        {positions.map((p) => (
          <Marker key={p.akunId} position={[p.latitude, p.longitude]} icon={marketingIcon}>
            <Popup>
              <div className="text-sm">
                <p className="font-medium">{p.nama}</p>
                <p className="text-muted-foreground">Update {formatRelativeTime(p.recordedAt)}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
```

Before finalizing, read `src/lib/map-styles.ts`'s actual exported shape (`TILE_SOURCES`'s real keys/structure — the brief above assumes a `TILE_SOURCES.default.{url,attribution}` shape, but confirm this against the real file rather than trust this guess) and adjust the `TileLayer` props to match exactly. Also confirm `mitra-locations-map.tsx`'s actual bounds-fitting approach (if it has one) and add the equivalent here if it's a simple, established pattern — skip it only if it would require inventing new logic not already proven in this codebase.

- [ ] **Step 2: Wire into the Pemasaran page**

In `src/app/(dashboard)/pemasaran/page.tsx`, add the import `import { getLatestMarketingPositions } from "@/lib/queries/akun-lokasi";` and `import { MarketingLocationMap } from "@/components/dashboard/marketing-location-map";`, add `canManageWilayah ? getLatestMarketingPositions() : Promise.resolve([])` to the existing `Promise.all([...])` array (matching the same "only fetch what this session can see" pattern already used for `wilayahAssignments`/`marketingUsers` there), destructure the new result into a `marketingPositions` variable, and render `{canManageWilayah && <MarketingLocationMap positions={marketingPositions} />}` — placed near the existing `<MarketingWilayahPanel>` (same `canManageWilayah` gate, same section of the page).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`, `npx eslint src/components/dashboard/marketing-location-map.tsx "src/app/(dashboard)/pemasaran/page.tsx"` — both clean.
Run: `npm run build` — succeeds.

- [ ] **Step 4: Live-verify**

Open `/pemasaran` as a session with `canManageWilayah` (Supervisor/Accounting/Manager/Super Admin), confirm the map renders. If Task 7's live-verification step inserted a real test position for a real Marketing account, confirm that exact pin appears on this map with the right name and a sensible "update X yang lalu" label. Confirm a plain Marketing-role session does NOT see this panel (gated correctly).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/marketing-location-map.tsx "src/app/(dashboard)/pemasaran/page.tsx"
git commit -m "Add Marketing live-position map to Pemasaran module"
```

---

## Task 11: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Re-run static checks project-wide**

Run: `npx tsc --noEmit`, `npx eslint src`, `npm run build` — all clean.

- [ ] **Step 2: Confirm Part A and Part B are independent**

Confirm via `git diff --stat` over this plan's full commit range that Part A's files (`auth.ts`, `types/next-auth.d.ts`, `queries/akun.ts`, `grup/akun/**`) and Part B's files (`queries/akun-lokasi.ts`, `api/lokasi/**`, `components/location-tracking-bootstrap.tsx`, `components/providers.tsx`, `pemasaran/**`, `marketing-location-map.tsx`) don't overlap.

- [ ] **Step 3: Confirm no leftover scratch files**

Run: `git status --short` — must be clean.

- [ ] **Step 4: Report the real verification gaps plainly**

This plan cannot verify, in this environment: (a) a real device/emulator confirming the Android foreground service, persistent notification, and background callback delivery actually work (no Android SDK here); (b) a full authenticated click-through of both new pages by an implementer without live credentials for every relevant role (Superadmin for `/grup/akun/sesi`, a `canManageWilayah` role for the Pemasaran map). Both are pre-existing, disclosed limitations of this environment — state them clearly rather than omit them, matching every other native/credential-gated task this session.

- [ ] **Step 5: Remind the user that a real Android rebuild is needed**

Note in the final report: this plan adds a new native dependency (`@capgo/background-geolocation`) and changes `src/components/providers.tsx` — the APK must be rebuilt (`npx cap sync android` + a fresh Android Studio build) before background location tracking can work on a real device, the same rebuild requirement already true of the earlier offline-fallback and CAMERA-permission changes this session.
