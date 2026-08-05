# Manajemen Sesi Login — Design Spec

**Company:** PT Mitra Kelola Esindo / PMP Group (holding). **Module:** new Superadmin-only page under `/grup`.

## Goal

A Superadmin-only page that lists every currently active login session across the whole system (every account type — MKEsindo, Direktur, PMPutra, all now unified in the single Postgres `akun` table), with device/IP/login-time/last-active info per session, and a "Logout" action that force-invalidates a single session — kicking that specific device out immediately, on its very next request, without touching that user's other sessions or waiting for token expiry.

## Non-goals

- **Not self-service.** Per the user's explicit choice, this is Superadmin-only, managed centrally via the PMP Group holding-company admin area — not a per-user "my devices" page. A regular user cannot see or manage their own sessions.
- **Not a full audit-log/security-history feature.** This tracks only *currently active* sessions (rows without `revoked_at` set) for the purpose of killing one — it is not a historical login-audit trail. `recordSuccessfulLogin`'s existing failed/successful-login counters in the `akun` table already cover basic login history; this spec doesn't touch or extend that.
- **No user-agent parsing library.** Device info is shown as the raw `User-Agent` string captured at login — no new dependency for pretty device/browser name extraction, in keeping with YAGNI.
- **No change to session *duration*/expiry policy.** This spec adds the ability to revoke a session early; it does not change how long a session normally lasts before natural expiry.

## Architecture

**New Postgres table**, `akun_sesi` (one row per login, not per request):

```sql
CREATE TABLE akun_sesi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  akun_id INTEGER NOT NULL REFERENCES akun(id),
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX akun_sesi_akun_id_idx ON akun_sesi (akun_id) WHERE revoked_at IS NULL;
```

**Session creation:** in `src/lib/auth.ts`'s `authorize()` callback, right after a successful login (same place `recordSuccessfulLogin` already runs, which already captures the request's IP), insert one new `akun_sesi` row and carry its `id` forward as part of the `AuthorizedUser` object returned to NextAuth.

**JWT carries the session id:** in the `jwt` callback, the existing `if (user)` block (which only runs once, on the initial sign-in — never on a token refresh) additionally sets `token.sessionId = user.sessionId`. This means a single login keeps the same `sessionId` for its whole lifetime, even as NextAuth periodically re-signs/refreshes the JWT — a refresh must never mint a new session row.

**Revocation check on every request:** the same `jwt` callback, UNCONDITIONALLY (moved outside the `if (user)` guard so it runs on every single invocation, not just at sign-in), looks up `token.sessionId` in `akun_sesi`. If the row is missing or `revoked_at` is set, the callback returns `null` instead of the token.

This return value is not a guess — confirmed directly by reading `node_modules/@auth/core/lib/actions/session.js`: when `callbacks.jwt` returns `null`, the surrounding code (`if (token !== null) { ...build session, refresh cookie... }`) skips building a session entirely and skips refreshing the session cookie. Since `auth()` — the same function `proxy.ts`'s middleware and every `requireXXX` guard already calls — is built on this same core session-checking path, a revoked session's very next request (whether that's the middleware's own auth check or any page load) sees `isLoggedIn === false` and is redirected to `/login`, exactly like a normal logged-out visitor. No polling, no client-side timer, no waiting for expiry — the next request is the enforcement point.

**`last_seen_at` throttling:** updating this column on every single request would double the write load for zero real benefit (nobody needs second-level precision on "last active"). The same `jwt` callback updates `last_seen_at` only if the stored value is more than 5 minutes old — cheap enough to check inline (it's the same row already being read for the revocation check), and keeps the admin page's "last active" column reasonably fresh without hammering the database on every navigation.

**Performance trade-off, explicitly accepted:** this adds one Postgres query to every authenticated request in the entire app (via the `jwt` callback, which runs on every `auth()` call, including `proxy.ts`'s middleware). For an internal company dashboard at this scale, the trade-off favors correctness (instant revocation) over shaving one query per request — this was discussed directly with the user during design, not defaulted to silently.

## Page: `/grup/akun/sesi`

Follows the exact same pattern as the existing `/grup/akun/peran` sibling page — same `requireGrupAccess()` guard, linked from `/grup/akun`'s header via a new button next to the existing "Peran & Otoritas" one.

**Data:** a new query, `listActiveSesi(): Promise<AkunSesiRow[]>` in `src/lib/queries/akun.ts` (alongside the existing `findAkunByUsername`/`recordSuccessfulLogin`/etc.), joining `akun_sesi` (where `revoked_at IS NULL`) with `akun` for the display name/username, ordered by `last_seen_at` descending (most recently active first):

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
```

**UI:** a table/list, one row per active session — account name + username, raw User-Agent string (truncated with a tooltip/expand for the full value), IP address, "Login sejak" (createdAt, relative or formatted time), "Terakhir aktif" (lastSeenAt), and a "Logout" button per row. Clicking Logout calls a new server action, `revokeSesiAction(sesiId: string)`, which sets `revoked_at = now()` on that row and revalidates the page — the row disappears from the list (or moves to a "baru saja di-logout" transient state) since the query only returns non-revoked rows.

No self-revoke special-casing needed: if a Superadmin revokes their own current session, their own next request (including the page reload after clicking Logout) will itself hit the revocation check and correctly bounce them to `/login` — this falls naturally out of the same mechanism, not a special case to code for separately.

## Files

- Modify: `src/lib/auth.ts` (session creation on login, `sessionId` JWT claim, unconditional revocation check + throttled `last_seen_at` update in the `jwt` callback)
- Create (DDL): `akun_sesi` table in Postgres — via a one-off migration script run directly against the Postgres directory DB (same pattern already used for prior Postgres schema changes in this project), not a Next.js migration framework (none exists in this project)
- Modify: `src/lib/queries/akun.ts` (add `listActiveSesi(): Promise<AkunSesiRow[]>`, `createAkunSesi(akunId: number, userAgent: string | null, ipAddress: string | null): Promise<string>` returning the new session's UUID, `revokeAkunSesi(sesiId: string): Promise<void>`, `checkAkunSesi(sesiId: string): Promise<{ valid: boolean }>` used by the `jwt` callback's revocation check, `touchAkunSesiLastSeen(sesiId: string): Promise<void>` for the throttled update)
- Create: `src/app/grup/akun/sesi/page.tsx`
- Create: `src/components/dashboard/akun-sesi-list.tsx` (or similar — table UI + revoke action wiring)
- Create: `src/app/grup/akun/sesi/actions.ts` (`revokeSesiAction`)
- Modify: `src/app/grup/akun/page.tsx` (add the "Sesi Login" header button linking to the new page, mirroring the existing "Peran & Otoritas" button)

## Open risks, explicitly accepted

- One extra Postgres query per authenticated request app-wide — accepted trade-off for instant, accurate revocation (see Architecture section above).
- No user-agent parsing means the admin sees a raw string rather than a friendly "Chrome on Windows" / "Aplikasi Android" label — acceptable for a first version; a parsing library can be added later without changing the schema or revocation mechanism.
- The `akun_sesi` table only starts recording sessions created *after* this feature ships — anyone already logged in via an older JWT (issued before this change) has no `sessionId` claim at all, so the revocation-check query would find no matching row and, per the "missing or revoked" rule, treat it as invalid — meaning **every currently logged-in user across the whole app gets force-logged-out once this ships** (their next request fails the lookup and returns `null`). This is a real, one-time disruptive side effect of deploying this change, not a bug — worth flagging to the user before merge so it isn't a surprise, but not something to design around (there's no clean way to "grandfather in" pre-existing sessions that were never assigned a session id).
