# Notifikasi (Notification System) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live notification bell to the dashboard header that alerts users to new Pengajuan Mitra, new Sales Orders, and Sales Invoices that just became fully paid via a Sales Payment — pushed over Server-Sent Events to any open tab, gated by the same per-module permission grid the rest of the app already uses.

**Architecture:** A background scanner (started once at server boot via `instrumentation.ts`) polls the three source tables every 20 seconds using a per-source watermark, inserts any new events into a `DashboardNotification` table (deduplicated via a unique `(SourceType, SourceID)` constraint), and publishes each newly-inserted row on an in-process `EventEmitter`. A Server-Sent-Events route subscribes to that emitter and streams matching events (filtered by the connected user's module permissions) to the browser. The client-side bell fetches the last 30 days of notifications on mount and appends anything that arrives live over the open `EventSource` connection.

**Tech Stack:** Next.js 16 Route Handlers (`ReadableStream` for SSE), raw `mssql` (no ORM, matching the rest of this codebase), Node's built-in `EventEmitter`, `@base-ui/react/popover` (already in use elsewhere as `src/components/ui/popover.tsx`).

## Global Constraints

- No ORM — raw parameterized SQL via `mssql` (`getPool()`/`sql` from `@/lib/db`), matching every other query file in `src/lib/queries/`.
- The scan watermark (`DashboardNotificationScanState.LastScannedAt`) must be seeded to `GETDATE()` at migration time for all three source types — this is what guarantees no historical backlog gets surfaced as notifications (the SO-availability-window fix earlier in this project found 3,411 stale rows from a similarly unbounded historical filter; this feature must not repeat that mistake).
- `DashboardNotification` rows are deduplicated via `UNIQUE (SourceType, SourceID)` — every insert path must tolerate and swallow a unique-violation (SQL Server error number `2627` or `2601`) as an expected "already recorded" outcome, not a crash.
- Notifications older than 30 days are excluded by a read-time filter (`CreatedAt > DATEADD(DAY, -30, GETDATE())`) — no background pruning job in this version.
- Every notification is gated by `TargetModuleKey` against the viewing user's `PermissionMap` via `canView()` from `@/lib/permissions` — both when the SSE route decides whether to forward a live event, and when the initial-load query decides what to return. `TargetModuleKey` values used by this feature: `"pemasaran"` (Pengajuan Mitra Baru) and `"transaksi"` (SO Baru, SI Terbayar).
- Scan windows compare raw server-clock `DATETIME` values directly (`since < X <= until`) — do **not** apply the `DATEADD(HOUR, -7, ...)` WIB-shift used elsewhere in this codebase for calendar-day business-date filters. That shift exists for "which calendar day does this belong to" queries; this is a continuous forward-only cursor scan, a different problem, and applying the shift here would be a bug.
- `NotificationType` values: `"PengajuanMitraBaru" | "SOBaru" | "SITerbayar"` — used verbatim as both the `Type` and `SourceType` column values (they're the same taxonomy in this design).

---

### Task 0: DDL migration — executed directly, not delegated

**Do not dispatch this task to a subagent.** Run this SQL directly (via the SQL execution tool already available in this session) against the live database, exactly as Task 0 of the prior SO→DO plan was handled.

```sql
CREATE TABLE DashboardNotification (
  NotificationID INT IDENTITY PRIMARY KEY,
  Type VARCHAR(32) NOT NULL,
  TargetModuleKey VARCHAR(32) NOT NULL,
  Title VARCHAR(200) NOT NULL,
  Message VARCHAR(400) NOT NULL,
  LinkUrl VARCHAR(200) NOT NULL,
  SourceType VARCHAR(32) NOT NULL,
  SourceID VARCHAR(64) NOT NULL,
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

INSERT INTO DashboardNotificationScanState (SourceType, LastScannedAt) VALUES
  ('PengajuanMitraBaru', GETDATE()),
  ('SOBaru', GETDATE()),
  ('SITerbayar', GETDATE());
```

- [ ] **Step 1:** Run the DDL above.
- [ ] **Step 2:** Verify: `SELECT * FROM DashboardNotificationScanState` returns exactly 3 rows, each with a `LastScannedAt` close to the current time.

---

### Task 1: Notification query layer

**Files:**
- Create: `src/lib/queries/notifications.ts`

**Interfaces:**
- Consumes: `getPool`, `sql` from `@/lib/db`; `canView`, `type ModuleKey`, `type PermissionMap` from `@/lib/permissions`.
- Produces: `type NotificationType`, `interface NotificationEvent`, `interface NotificationRow`, `insertNotification(input): Promise<NotificationEvent | null>`, `getScanState(sourceType): Promise<Date>`, `advanceScanState(sourceType, to: Date): Promise<void>`, `scanPengajuanMitraBaru(since, until): Promise<NewNotificationInput[]>`, `scanSOBaru(since, until): Promise<NewNotificationInput[]>`, `scanSITerbayar(since, until): Promise<NewNotificationInput[]>`, `getNotificationsForUser(userId, permissions: PermissionMap): Promise<NotificationRow[]>`, `markNotificationRead(notificationId, userId): Promise<void>` — all consumed by Task 2 (scanner), Task 3 (SSE route), Task 4 (server actions).

- [ ] **Step 1: Write `src/lib/queries/notifications.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import { canView, type ModuleKey, type PermissionMap } from "@/lib/permissions";

export type NotificationType = "PengajuanMitraBaru" | "SOBaru" | "SITerbayar";

export interface NewNotificationInput {
  type: NotificationType;
  targetModuleKey: ModuleKey;
  title: string;
  message: string;
  linkUrl: string;
  sourceType: NotificationType;
  sourceId: string;
}

// Shape published on the event bus and streamed over SSE — same fields as
// NotificationRow minus IsRead, since a freshly-inserted notification is by
// definition unread for everyone.
export interface NotificationEvent {
  NotificationID: number;
  Type: NotificationType;
  TargetModuleKey: ModuleKey;
  Title: string;
  Message: string;
  LinkUrl: string;
  CreatedAt: string;
}

export interface NotificationRow extends NotificationEvent {
  IsRead: boolean;
}

// SQL Server's number for a UNIQUE CONSTRAINT/INDEX violation — the
// UQ_DashboardNotification_Source dedup guard raises this when a scan tick
// re-examines a (SourceType, SourceID) pair it already turned into a
// notification (e.g. a timestamp tie at a scan-window boundary). Expected,
// not exceptional: swallow it rather than let it surface as a scan failure.
const SQL_UNIQUE_VIOLATION_NUMBERS = new Set([2627, 2601]);

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "number" in err &&
    SQL_UNIQUE_VIOLATION_NUMBERS.has((err as { number: number }).number)
  );
}

// Inserts a new notification row, returning the created event (for
// publishing on the event bus) or null if this (sourceType, sourceId) pair
// was already recorded — a no-op, not an error.
export async function insertNotification(input: NewNotificationInput): Promise<NotificationEvent | null> {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input("type", sql.VarChar(32), input.type)
      .input("targetModuleKey", sql.VarChar(32), input.targetModuleKey)
      .input("title", sql.VarChar(200), input.title)
      .input("message", sql.VarChar(400), input.message)
      .input("linkUrl", sql.VarChar(200), input.linkUrl)
      .input("sourceType", sql.VarChar(32), input.sourceType)
      .input("sourceId", sql.VarChar(64), input.sourceId).query(`
        INSERT INTO DashboardNotification (Type, TargetModuleKey, Title, Message, LinkUrl, SourceType, SourceID)
        OUTPUT inserted.NotificationID, inserted.CreatedAt
        VALUES (@type, @targetModuleKey, @title, @message, @linkUrl, @sourceType, @sourceId)
      `);
    const row = result.recordset[0] as { NotificationID: number; CreatedAt: Date };
    return {
      NotificationID: row.NotificationID,
      Type: input.type,
      TargetModuleKey: input.targetModuleKey,
      Title: input.title,
      Message: input.message,
      LinkUrl: input.linkUrl,
      CreatedAt: row.CreatedAt.toISOString(),
    };
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function getScanState(sourceType: NotificationType): Promise<Date> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sourceType", sql.VarChar(32), sourceType)
    .query(`SELECT LastScannedAt FROM DashboardNotificationScanState WHERE SourceType = @sourceType`);
  const row = result.recordset[0] as { LastScannedAt: Date } | undefined;
  if (!row) throw new Error(`No scan state seeded for source type ${sourceType} — run the Task 0 migration.`);
  return row.LastScannedAt;
}

export async function advanceScanState(sourceType: NotificationType, to: Date): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("sourceType", sql.VarChar(32), sourceType)
    .input("to", sql.DateTime, to)
    .query(`UPDATE DashboardNotificationScanState SET LastScannedAt = @to WHERE SourceType = @sourceType`);
}

export async function scanPengajuanMitraBaru(since: Date, until: Date): Promise<NewNotificationInput[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("since", sql.DateTime, since)
    .input("until", sql.DateTime, until).query(`
      SELECT PengajuanID, NamaCalon
      FROM DashboardMitraPengajuan
      WHERE CreatedAt > @since AND CreatedAt <= @until
    `);
  return (result.recordset as { PengajuanID: number; NamaCalon: string }[]).map((row) => ({
    type: "PengajuanMitraBaru",
    targetModuleKey: "pemasaran",
    title: "Pengajuan Mitra Baru",
    message: row.NamaCalon,
    linkUrl: "/pemasaran",
    sourceType: "PengajuanMitraBaru",
    sourceId: String(row.PengajuanID),
  }));
}

export async function scanSOBaru(since: Date, until: Date): Promise<NewNotificationInput[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("since", sql.DateTime, since)
    .input("until", sql.DateTime, until).query(`
      SELECT so.SalesOrderID, so.VoucherNo, bp.Name
      FROM SalesOrder so
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      WHERE so.IsDeleted = 0 AND so.TransDate > @since AND so.TransDate <= @until
    `);
  return (result.recordset as { SalesOrderID: string; VoucherNo: string; Name: string | null }[]).map((row) => ({
    type: "SOBaru",
    targetModuleKey: "transaksi",
    title: "SO Baru",
    message: `${row.Name ?? "Tanpa Nama"} · ${row.VoucherNo}`,
    linkUrl: "/transaksi",
    sourceType: "SOBaru",
    sourceId: row.SalesOrderID,
  }));
}

export async function scanSITerbayar(since: Date, until: Date): Promise<NewNotificationInput[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("since", sql.DateTime, since)
    .input("until", sql.DateTime, until).query(`
      SELECT sp.SalesPaymentID, sp.VoucherNo AS SPVoucherNo, si.SalesInvoiceID, si.VoucherNo AS SIVoucherNo, bp.Name
      FROM SalesPayment sp
      JOIN SalesPaymentDetail spd ON spd.SalesPaymentID = sp.SalesPaymentID AND spd.IsDeleted = 0
      JOIN SalesInvoice si ON si.SalesInvoiceID = spd.SalesInvoiceID AND si.IsDeleted = 0
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
      WHERE sp.IsDeleted = 0 AND sp.TransDate > @since AND sp.TransDate <= @until
        AND si.Netto > 0 AND si.Paid >= si.Netto
    `);
  return (
    result.recordset as {
      SalesPaymentID: string;
      SPVoucherNo: string;
      SalesInvoiceID: string;
      SIVoucherNo: string;
      Name: string | null;
    }[]
  ).map((row) => ({
    type: "SITerbayar",
    targetModuleKey: "transaksi",
    title: "SI Terbayar",
    message: `${row.Name ?? "Tanpa Nama"} · ${row.SIVoucherNo} lunas via ${row.SPVoucherNo}`,
    linkUrl: "/transaksi",
    sourceType: "SITerbayar",
    sourceId: `${row.SalesPaymentID}:${row.SalesInvoiceID}`,
  }));
}

// permissions filtering happens here (in JS, on the already-fetched rows)
// rather than in the SQL WHERE clause — PermissionMap is a JWT-derived
// object with no DB-side representation to join against, the same reason
// canView() is applied in JS everywhere else it's used in this codebase.
export async function getNotificationsForUser(userId: number, permissions: PermissionMap): Promise<NotificationRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("userId", sql.Int, userId).query(`
      SELECT n.NotificationID, n.Type, n.TargetModuleKey, n.Title, n.Message, n.LinkUrl, n.CreatedAt,
             CASE WHEN r.UserID IS NOT NULL THEN 1 ELSE 0 END AS IsRead
      FROM DashboardNotification n
      LEFT JOIN DashboardNotificationRead r ON r.NotificationID = n.NotificationID AND r.UserID = @userId
      WHERE n.CreatedAt > DATEADD(DAY, -30, GETDATE())
      ORDER BY n.CreatedAt DESC
    `);
  return (
    result.recordset as {
      NotificationID: number;
      Type: NotificationType;
      TargetModuleKey: ModuleKey;
      Title: string;
      Message: string;
      LinkUrl: string;
      CreatedAt: Date;
      IsRead: number;
    }[]
  )
    .filter((row) => canView(permissions, row.TargetModuleKey))
    .map((row) => ({
      NotificationID: row.NotificationID,
      Type: row.Type,
      TargetModuleKey: row.TargetModuleKey,
      Title: row.Title,
      Message: row.Message,
      LinkUrl: row.LinkUrl,
      CreatedAt: row.CreatedAt.toISOString(),
      IsRead: row.IsRead === 1,
    }));
}

export async function markNotificationRead(notificationId: number, userId: number): Promise<void> {
  const pool = await getPool();
  try {
    await pool
      .request()
      .input("notificationId", sql.Int, notificationId)
      .input("userId", sql.Int, userId)
      .query(`INSERT INTO DashboardNotificationRead (NotificationID, UserID) VALUES (@notificationId, @userId)`);
  } catch (err) {
    // Already marked read (PK violation on a repeat click) — a no-op, not
    // an error, same dedup discipline as insertNotification above.
    if (!isUniqueViolation(err)) throw err;
  }
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/notifications.ts
git commit -m "Add notification query layer: scan sources, insert/read, per-user read state"
```

---

### Task 2: Event bus, scanner, and startup hook

**Files:**
- Create: `src/lib/notifications/event-bus.ts`
- Create: `src/lib/notifications/scanner.ts`
- Create: `src/instrumentation.ts`

**Interfaces:**
- Consumes: everything Task 1 produces (`getScanState`, `advanceScanState`, `scanPengajuanMitraBaru`, `scanSOBaru`, `scanSITerbayar`, `insertNotification`, `type NotificationEvent`, `type NotificationType`).
- Produces: `notificationEventBus: EventEmitter`, `NOTIFICATION_EVENT: string` (from `event-bus.ts`) and `startNotificationScanner(): void` (from `scanner.ts`) — consumed by Task 3 (SSE route subscribes to the bus) and this task's own `instrumentation.ts` (calls `startNotificationScanner`).

- [ ] **Step 1: Write `src/lib/notifications/event-bus.ts`**

```ts
import { EventEmitter } from "events";

// globalThis-guarded singleton — Next.js dev mode (Turbopack HMR) can
// re-evaluate this module multiple times within the same running process;
// without the guard each re-evaluation would create a fresh EventEmitter
// that the SSE route and the scanner would disagree about.
declare global {
  // eslint-disable-next-line no-var
  var __notificationEventBus: EventEmitter | undefined;
}

export const notificationEventBus: EventEmitter = globalThis.__notificationEventBus ?? new EventEmitter();
globalThis.__notificationEventBus = notificationEventBus;

// EventEmitter's default max-listener warning (10) is tuned for typical
// single-purpose emitters — this one gets one listener per open SSE
// connection, i.e. one per logged-in browser tab, which can reasonably
// exceed 10 on a shared dashboard.
notificationEventBus.setMaxListeners(200);

export const NOTIFICATION_EVENT = "notification";
```

- [ ] **Step 2: Write `src/lib/notifications/scanner.ts`**

```ts
import { notificationEventBus, NOTIFICATION_EVENT } from "@/lib/notifications/event-bus";
import {
  getScanState,
  advanceScanState,
  scanPengajuanMitraBaru,
  scanSOBaru,
  scanSITerbayar,
  insertNotification,
  type NotificationType,
  type NewNotificationInput,
} from "@/lib/queries/notifications";

const SCAN_INTERVAL_MS = 20_000;

const SOURCES: { sourceType: NotificationType; scan: (since: Date, until: Date) => Promise<NewNotificationInput[]> }[] = [
  { sourceType: "PengajuanMitraBaru", scan: scanPengajuanMitraBaru },
  { sourceType: "SOBaru", scan: scanSOBaru },
  { sourceType: "SITerbayar", scan: scanSITerbayar },
];

async function runScan(): Promise<void> {
  const until = new Date();
  for (const source of SOURCES) {
    try {
      const since = await getScanState(source.sourceType);
      const candidates = await source.scan(since, until);
      for (const candidate of candidates) {
        const event = await insertNotification(candidate);
        if (event) {
          notificationEventBus.emit(NOTIFICATION_EVENT, event);
        }
      }
      // Advances to `until` (the moment this tick started) regardless of
      // whether any candidates were found — a quiet tick still needs to
      // move the watermark forward, and using `until` rather than "the max
      // timestamp found" means a tick that finds nothing never leaves the
      // watermark stuck in the past.
      await advanceScanState(source.sourceType, until);
    } catch (err) {
      // One source failing (e.g. a transient DB blip) must not stop the
      // others from advancing and must not crash the interval — it just
      // retries from the same watermark on the next tick.
      console.error(`Notification scan failed for ${source.sourceType}:`, err);
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __notificationScannerStarted: boolean | undefined;
}

// Idempotent — safe to call more than once (instrumentation.ts calls it
// exactly once per server start, but the guard protects against dev-mode
// re-registration too).
export function startNotificationScanner(): void {
  if (globalThis.__notificationScannerStarted) return;
  globalThis.__notificationScannerStarted = true;
  setInterval(runScan, SCAN_INTERVAL_MS);
}
```

- [ ] **Step 3: Write `src/instrumentation.ts`**

```ts
// Next.js calls register() exactly once when the server process starts —
// the supported place to kick off a background process, as opposed to
// starting it lazily on first request (which would race multiple
// concurrent first-requests into starting it more than once).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNotificationScanner } = await import("@/lib/notifications/scanner");
    startNotificationScanner();
  }
}
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/event-bus.ts src/lib/notifications/scanner.ts src/instrumentation.ts
git commit -m "Add notification scanner (20s watermark scan) and event bus, wired via instrumentation.ts"
```

---

### Task 3: SSE stream route

**Files:**
- Create: `src/app/api/notifications/stream/route.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth`; `canView` from `@/lib/permissions`; `notificationEventBus`, `NOTIFICATION_EVENT` from `@/lib/notifications/event-bus`; `type NotificationEvent` from `@/lib/queries/notifications`.
- Produces: `GET` handler streaming `text/event-stream` — consumed by Task 5's `NotificationBell` via a browser `EventSource("/api/notifications/stream")`.

- [ ] **Step 1: Write `src/app/api/notifications/stream/route.ts`**

```ts
import { auth } from "@/lib/auth";
import { canView } from "@/lib/permissions";
import { notificationEventBus, NOTIFICATION_EVENT } from "@/lib/notifications/event-bus";
import type { NotificationEvent } from "@/lib/queries/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const permissions = session.user.permissions ?? {};

  const encoder = new TextEncoder();
  let listener: ((event: NotificationEvent) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      listener = (event: NotificationEvent) => {
        if (!canView(permissions, event.TargetModuleKey)) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      notificationEventBus.on(NOTIFICATION_EVENT, listener);
      // A comment-only SSE line (ignored by EventSource's message parser)
      // sent immediately on connect — keeps idle proxies that time out a
      // response with no bytes from closing the connection prematurely,
      // and gives the client an immediate signal the stream is live.
      controller.enqueue(encoder.encode(": connected\n\n"));
    },
    cancel() {
      // Fires when the client disconnects (tab closed, navigated away,
      // EventSource.close()) — without this every past connection's
      // listener would stay registered on the shared emitter forever.
      if (listener) notificationEventBus.off(NOTIFICATION_EVENT, listener);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/notifications/stream/route.ts
git commit -m "Add SSE route streaming permission-filtered notifications to connected clients"
```

---

### Task 4: Server actions

**Files:**
- Create: `src/app/(dashboard)/notification-actions.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth`; `getNotificationsForUser`, `markNotificationRead`, `type NotificationRow` from `@/lib/queries/notifications`.
- Produces: `getNotificationsAction(): Promise<NotificationRow[]>`, `markNotificationReadAction(notificationId: number): Promise<void>` — consumed by Task 5's `NotificationBell`.

- [ ] **Step 1: Write `src/app/(dashboard)/notification-actions.ts`**

```ts
"use server";

import { auth } from "@/lib/auth";
import { getNotificationsForUser, markNotificationRead, type NotificationRow } from "@/lib/queries/notifications";

export async function getNotificationsAction(): Promise<NotificationRow[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  return getNotificationsForUser(Number(session.user.id), session.user.permissions ?? {});
}

export async function markNotificationReadAction(notificationId: number): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  await markNotificationRead(notificationId, Number(session.user.id));
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/notification-actions.ts"
git commit -m "Add getNotificationsAction/markNotificationReadAction server actions"
```

---

### Task 5: NotificationBell UI, wired into the dashboard header

**Files:**
- Create: `src/components/dashboard/notification-bell.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `getNotificationsAction`, `markNotificationReadAction` from `@/app/(dashboard)/notification-actions` (Task 4); `type NotificationRow` from `@/lib/queries/notifications` (Task 1); the `/api/notifications/stream` SSE endpoint (Task 3); `canView` from `@/lib/permissions` (to decide whether to render the bell at all, using the `permissions`/`isSuperAdmin` already available in `layout.tsx`); `formatRelativeTime` from `@/lib/format`; `Popover`/`PopoverTrigger`/`PopoverContent` from `@/components/ui/popover`; `Button` from `@/components/ui/button`; `Badge` from `@/components/ui/badge`.
- Produces: `<NotificationBell />` — a self-contained client component, no props needed (it reads its own session-scoped data via the server actions).

- [ ] **Step 1: Write `src/components/dashboard/notification-bell.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationEvent, NotificationRow } from "@/lib/queries/notifications";
import { getNotificationsAction, markNotificationReadAction } from "@/app/(dashboard)/notification-actions";

export function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // The SSE connection is deliberately opened only AFTER the initial
    // fetch resolves and its rows are in state — opening both in parallel
    // (two independent effects) would race: an event arriving while the
    // fetch is still in flight could get overwritten the moment the fetch
    // finally resolves and unconditionally replaces the whole list.
    // Sequencing them removes the race instead of trying to merge around it.
    let cancelled = false;
    let source: EventSource | null = null;

    getNotificationsAction().then((rows) => {
      if (cancelled) return;
      setNotifications(rows);
      source = new EventSource("/api/notifications/stream");
      source.onmessage = (e) => {
        // The ": connected\n\n" keepalive comment never fires onmessage (it
        // has no "data:" line), so every message here is a genuine
        // NotificationEvent — no need to distinguish message types.
        const event = JSON.parse(e.data) as NotificationEvent;
        setNotifications((prev) => {
          if (prev.some((n) => n.NotificationID === event.NotificationID)) return prev;
          return [{ ...event, IsRead: false }, ...prev];
        });
      };
    });

    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.IsRead).length;

  function handleClick(notification: NotificationRow) {
    setNotifications((prev) =>
      prev.map((n) => (n.NotificationID === notification.NotificationID ? { ...n, IsRead: true } : n))
    );
    markNotificationReadAction(notification.NotificationID);
    setOpen(false);
    router.push(notification.LinkUrl);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="relative" />}>
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 gap-0 p-0" align="end">
        <div className="flex max-h-96 flex-col divide-y overflow-y-auto">
          {notifications.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">Tidak ada notifikasi.</p>
          )}
          {notifications.map((n) => (
            <button
              key={n.NotificationID}
              type="button"
              onClick={() => handleClick(n)}
              className={cn(
                "flex flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted",
                !n.IsRead && "bg-primary/5"
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {!n.IsRead && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                {n.Title}
              </span>
              <span className="text-xs text-muted-foreground">{n.Message}</span>
              <span className="text-[10px] text-muted-foreground">{formatRelativeTime(n.CreatedAt)}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Wire into `src/app/(dashboard)/layout.tsx`**

Add the import:

```ts
import { NotificationBell } from "@/components/dashboard/notification-bell";
```

Change the header's right-hand button group from:

```tsx
          <div className="flex items-center gap-1">
            <AppearanceMenu />
            <UserMenu name={session?.user?.name ?? session?.user?.username ?? "User"} profile={profile} />
          </div>
```

to:

```tsx
          <div className="flex items-center gap-1">
            <NotificationBell />
            <AppearanceMenu />
            <UserMenu name={session?.user?.name ?? session?.user?.username ?? "User"} profile={profile} />
          </div>
```

`NotificationBell` always renders (it fetches its own data via `getNotificationsAction`, which already returns `[]` for a session with no matching module permissions — an always-empty, harmless bell rather than conditionally hiding it, keeping this server component simple).

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: clean, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/notification-bell.tsx "src/app/(dashboard)/layout.tsx"
git commit -m "Add NotificationBell to the dashboard header, live via SSE"
```

---

### Task 6: Final verification pass — executed directly, not delegated

**Do not dispatch this task to a subagent.** This requires live DB writes + a live browser session, matching how prior live-verification passes in this project were done directly by the controller.

- [ ] **Step 1:** Confirm the dev server picked up `instrumentation.ts` (check server logs / confirm no startup error) and that the scanner is running (no direct log needed — verified indirectly by Step 3 below).
- [ ] **Step 2:** Log into the dashboard in the browser, open dev tools' Network tab, confirm a pending `GET /api/notifications/stream` request with `Content-Type: text/event-stream` stays open (not completed).
- [ ] **Step 3:** Insert one test row into `DashboardMitraPengajuan` (or wait for a genuine new one) with `CreatedAt = GETDATE()`. Within ~20-25 seconds, confirm: (a) a `DashboardNotification` row was created for it, (b) the SSE connection received the event (visible in Network tab's EventStream view or via the bell's badge incrementing without a page reload).
- [ ] **Step 4:** Click the bell, confirm the new notification appears at the top of the list, unread-styled.
- [ ] **Step 5:** Click the notification row, confirm: navigation to `/pemasaran`, the bell's unread count decrements, and `SELECT * FROM DashboardNotificationRead` shows a new row for this user + notification.
- [ ] **Step 6:** Repeat Steps 3-5's insert-and-observe check for one SO-Baru case (insert/observe a real or test `SalesOrder` row) and, if a test Sales Payment can be safely created without touching real financial records, one SI-Terbayar case — otherwise reason through the SI-Terbayar query against existing live data (find an invoice that's already `Paid >= Netto` with a recent `SalesPayment.TransDate`, confirm it would have produced a notification had the scan window covered it) instead of writing new financial rows.
- [ ] **Step 7:** Log in as (or simulate a permission set for) a user without `pemasaran`/`transaksi` view access, confirm their bell shows no Pengajuan/SO/SI notifications even after Steps 3-6's rows exist.
- [ ] **Step 8:** Clean up any test rows inserted in Steps 3/6 (`DashboardMitraPengajuan`, and their resulting `DashboardNotification`/`DashboardNotificationRead` rows) so no synthetic data is left in the live database — mirroring the cleanup discipline already established earlier in this project for live-tested Jadwal/DeliveryOrder rows.
- [ ] **Step 9:** Run `npx tsc --noEmit` and `npx eslint` across all files touched by Tasks 1-5 one final time.
