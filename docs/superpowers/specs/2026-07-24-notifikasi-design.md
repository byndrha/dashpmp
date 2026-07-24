# Notifikasi (Notification System) — Design Spec

**Date:** 2026-07-24
**Status:** Approved by user, ready for implementation planning

## Goal

Give logged-in users a live notification bell (in the persistent dashboard header) that alerts them to three kinds of events as they happen elsewhere in the system:

1. **Pengajuan Mitra Baru** — a new mitra-partner submission was created.
2. **SO Baru** — a new Sales Order was placed in the ERP.
3. **SI Terbayar via SP** — a Sales Invoice just became fully paid because a new Sales Payment (SP) was applied to it.

## Why this shape

There is no existing real-time or polling infrastructure in this codebase (confirmed by full-codebase search): the only "freshness" mechanisms today are `revalidatePath` after a user's own mutation, and a manual pull-to-refresh gesture. The three source tables (`DashboardMitraPengajuan`, ERP `SalesOrder`, ERP `SalesPayment`) have no change-notification mechanism of their own (no triggers, no CDC) and this app has no access/reason to add one to the shared ERP database. The app *is* a genuine long-running Node server (Docker on Coolify, `output: "standalone"`), not serverless — so a persistent SSE connection and an in-process background interval are both architecturally sound, unlike on a serverless platform.

**Consequence:** detection of "what's new" is necessarily a periodic backend scan (there's nothing to subscribe to), but delivery to an already-open browser tab is genuine push via Server-Sent Events (per user's explicit choice) — not a client-side polling loop. The backend scans every 20 seconds; browsers get pushed the result instantly over the open SSE connection.

## Data model (new tables, this app's own `Dashboard*` schema — not the ERP)

```sql
CREATE TABLE DashboardNotification (
  NotificationID INT IDENTITY PRIMARY KEY,
  Type VARCHAR(32) NOT NULL,            -- 'PengajuanMitraBaru' | 'SOBaru' | 'SITerbayar'
  TargetModuleKey VARCHAR(32) NOT NULL, -- ModuleKey this notification is gated by (permissions.ts)
  Title VARCHAR(200) NOT NULL,
  Message VARCHAR(400) NOT NULL,
  LinkUrl VARCHAR(200) NOT NULL,
  SourceType VARCHAR(32) NOT NULL,      -- same domain as Type, used for scan bookkeeping
  SourceID VARCHAR(64) NOT NULL,        -- the source row's own ID (PengajuanID / SalesOrderID / "SalesPaymentID:SalesInvoiceID")
  CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
  CONSTRAINT UQ_DashboardNotification_Source UNIQUE (SourceType, SourceID)
);

CREATE TABLE DashboardNotificationRead (
  NotificationID INT NOT NULL REFERENCES DashboardNotification(NotificationID),
  UserID INT NOT NULL REFERENCES DashboardUser(UserID),
  ReadAt DATETIME NOT NULL DEFAULT GETDATE(),
  PRIMARY KEY (NotificationID, UserID)
);

CREATE TABLE DashboardNotificationScanState (
  SourceType VARCHAR(32) NOT NULL PRIMARY KEY,
  LastScannedAt DATETIME NOT NULL
);
```

- `UQ_DashboardNotification_Source` is the dedup guard: a scan that somehow re-examines a row it already turned into a notification (e.g. a timestamp tie at the scan-window boundary) fails the insert instead of creating a duplicate — the scanner catches the unique-violation and moves on, same "expected, not exceptional" handling this codebase already uses for the DO-publish race guard.
- `DashboardNotificationScanState` is seeded with one row per source type at `NOW()` **the moment this feature is deployed** — this is what makes "only since the feature is active" true; there is no backfill step and no code path that scans further back than that seed row on first run.
- No `IsDeleted`/soft-delete on `DashboardNotification` — the 30-day retention window is enforced purely as a read-time filter (`CreatedAt > DATEADD(DAY, -30, GETDATE())`), not a background pruning job. A pruning job can be added later without any schema change if the table grows large enough to matter.

## Backend scanner

`src/lib/notifications/scanner.ts` — one function, `runScan()`, called every 20 seconds by a `setInterval` registered once via `instrumentation.ts`'s `register()` hook (the Next.js-supported place to start a background process exactly once when the server boots, avoiding the double-registration Turbopack/dev-mode HMR would otherwise cause with a lazy per-request start).

Each tick, for each of the 3 source types independently:

1. Read `LastScannedAt` from `DashboardNotificationScanState`.
2. Query the source table for rows strictly newer than that timestamp, up to "now" captured at the start of the tick.
3. For each new row, build a `DashboardNotification` insert (see per-source queries below) and insert it (ignoring unique-violation dedup failures).
4. Advance `LastScannedAt` to the "now" captured in step 2 (not to the max row timestamp found — this way a tick that finds zero rows still correctly moves the watermark forward, and a slow-arriving row with an earlier timestamp than "now" is never silently skipped by an over-eager watermark).
5. For every notification actually inserted, publish it on the shared in-process event bus (`src/lib/notifications/event-bus.ts`, a `globalThis`-guarded singleton `EventEmitter`, same singleton-guard idiom this app would need for the interval itself).

**Per-source queries:**

- **Pengajuan Mitra Baru** — `SELECT PengajuanID, NamaCalon, CreatedAt FROM DashboardMitraPengajuan WHERE CreatedAt > @last AND CreatedAt <= @now`. `Title = "Pengajuan Mitra Baru"`, `Message = NamaCalon`, `LinkUrl = "/pemasaran"`, `TargetModuleKey = "pemasaran"`, `SourceID = PengajuanID`.
- **SO Baru** — `SELECT so.SalesOrderID, so.VoucherNo, so.TransDate, bp.Name FROM SalesOrder so LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID WHERE so.IsDeleted = 0 AND so.TransDate > @last AND so.TransDate <= @now`. `Title = "SO Baru"`, `Message = "{Name} · {VoucherNo}"`, `LinkUrl = "/transaksi"`, `TargetModuleKey = "transaksi"`, `SourceID = SalesOrderID`.
- **SI Terbayar via SP** — new `SalesPayment` rows drive this (a payment event, not a poll of invoice balances, so a partial payment that doesn't yet fully cover an invoice correctly produces no notification): `SELECT sp.SalesPaymentID, sp.VoucherNo AS SPVoucherNo, spd.SalesInvoiceID, si.VoucherNo AS SIVoucherNo, si.Netto, si.Paid, bp.Name FROM SalesPayment sp JOIN SalesPaymentDetail spd ON spd.SalesPaymentID = sp.SalesPaymentID AND spd.IsDeleted = 0 JOIN SalesInvoice si ON si.SalesInvoiceID = spd.SalesInvoiceID AND si.IsDeleted = 0 LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID WHERE sp.IsDeleted = 0 AND sp.TransDate > @last AND sp.TransDate <= @now AND si.Netto > 0 AND si.Paid >= si.Netto`. One notification per **invoice** (a single payment can cover several invoices — each becoming its own notification), `Title = "SI Terbayar"`, `Message = "{Name} · {SIVoucherNo} lunas via {SPVoucherNo}"`, `LinkUrl = "/transaksi"`, `TargetModuleKey = "transaksi"`, `SourceID = "{SalesPaymentID}:{SalesInvoiceID}"`.

## SSE endpoint

`src/app/api/notifications/stream/route.ts`, `GET`, `export const dynamic = "force-dynamic"`. On connect: `auth()` to get the session (reject with 401 if absent); open a `ReadableStream` that subscribes to the event bus; for every published notification, check `canView(session.user.permissions, notification.TargetModuleKey)` and — only if true — write it as an SSE `data:` frame to this connection. Unsubscribe from the event bus in the stream's `cancel()` callback (fires on client disconnect) so closed tabs don't leak listeners.

`EventSource` on the client reconnects automatically on drop (native browser behavior) — no custom reconnect logic needed. If the SSE connection can't be established at all (e.g. a restrictive proxy), the bell still shows whatever was fetched on initial page load; it just won't update live until the next navigation. This is graceful degradation, not a hard failure — matches how `revalidatePath`/full-page-navigation freshness already works everywhere else in this app.

## Frontend

- `NotificationBell` (`src/components/dashboard/notification-bell.tsx`), rendered in `src/app/(dashboard)/layout.tsx`'s header, between `AppearanceMenu` and `UserMenu` — visible on every dashboard page. Only rendered at all if the session has `canView` on at least one of `pemasaran`/`transaksi` (otherwise there is nothing this user could ever receive).
- Initial data via a server action `getNotificationsAction()`: returns the current user's notifications from the last 30 days, filtered to `TargetModuleKey`s the session can view, newest first, each annotated with whether a `DashboardNotificationRead` row exists for this user.
- Badge shows the unread count. Clicking the bell opens a dropdown/panel listing the (already-fetched + any since arrived via SSE) notifications.
- Clicking a notification row: calls `markNotificationReadAction(notificationId)` (upserts into `DashboardNotificationRead`) and navigates to `LinkUrl` via `router.push`.
- New SSE messages are prepended to the in-memory list and increment the badge — no re-fetch needed for the live-update path.

## Out of scope for this version

- No mute/preference controls per notification type — every eligible user sees every type they have module access to.
- No native browser push notifications (only in-tab SSE) and no email/SMS channel.
- No admin UI for managing notification types or manually re-triggering a scan.
- No background pruning job for rows older than 30 days — the read-time filter is sufficient at this data volume; a cleanup job can be added later without a schema change if needed.
