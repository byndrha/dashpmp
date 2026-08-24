# Print Management (Antrian Cetak + Format SI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/mkesindo/delivery/cetak` page with a full print-queue history view (retry/cancel/reorder) and a toggle-based settings panel for what prints on the SI Awal thermal receipt.

**Architecture:** Extend the existing `DashboardPrintQueue` table with a `SortOrder` column and a `'Dibatalkan'` status value; add a new single-row `DashboardPrintFormatSettings` table (same pattern as `DashboardSiteSettings`). New query functions and server actions layer on top of the existing print-queue/poller infrastructure — no existing enqueue/print code path changes except `receipt-builder.ts` gaining a required settings parameter.

**Tech Stack:** Next.js server actions, MSSQL (`mssql` package via `getPool()`/`sql` from `@/lib/db`), React client components, `@dnd-kit/core`/`@dnd-kit/sortable` (already a dependency), shadcn-style UI primitives already in `src/components/ui/`.

**Spec:** `docs/superpowers/specs/2026-08-24-print-management-design.md`

## Global Constraints

- Every new/modified server action in `src/app/mkesindo/(dashboard)/delivery/actions.ts` calls `await requireModuleAccess("delivery")` as its first line inside `runAction(async () => { ... })` — identical to every existing action in that file. No extra role restriction anywhere in this plan (confirmed decision: Format SI tab uses the same gate as Antrian Cetak).
- **No test framework exists in this repository** (`package.json` has no `test` script, no Jest/Vitest/anything). Every task's verification step is `npx tsc --noEmit` (whole-project, must stay clean) + `npx eslint <changed files>` (must stay clean) — this matches how every prior feature in this codebase (including the thermal-print base feature) was actually verified. For any task that adds or changes a DB-touching function, also run a one-off `npx tsx` smoke script (written to `scripts/`, or run inline via `node -e`/`npx tsx -e` if it's truly throwaway) against the live dev DB to confirm the SQL is correct — do not skip this just because there's no formal test runner.
- MSSQL columns added by migration scripts must use the idempotent `IF NOT EXISTS (...)` guard pattern already established in `scripts/add-print-queue-fail-count-column.ts` and `scripts/create-print-queue-table.ts` — every migration script in this plan must be safe to re-run.
- Dates crossing a server action boundary in this codebase are passed as plain `Date` objects (not manually converted to ISO strings) — e.g. `DriverStopRow`/`JadwalCard` fields in `pengiriman-jadwal.ts` are typed `Date` and consumed directly by client components. Follow that convention for every new date-typed field in this plan; do not add `.toISOString()` conversions that aren't already the codebase's practice.
- Commit after each task, using the codebase's existing commit-message style (`feat: ...` / `fix: ...` short imperative summary).

---

### Task 1: Schema migrations + query layer

**Files:**
- Create: `scripts/add-print-queue-order-column.ts`
- Create: `scripts/create-print-format-settings-table.ts`
- Create: `src/lib/queries/print-format-settings.ts`
- Modify: `src/lib/queries/print-queue.ts`

**Interfaces:**
- Produces: `PrintFormatSettings` interface + `getPrintFormatSettings(): Promise<PrintFormatSettings>` + `setPrintFormatSettings(input: PrintFormatSettings): Promise<void>` (new file, `src/lib/queries/print-format-settings.ts`) — consumed by Task 2 (receipt-builder caller) and Task 3 (server actions).
- Produces: `PrintQueueHistoryRow` interface + `getPrintQueueHistory(filters)`, `cancelPrintQueueJob(printQueueId): Promise<boolean>`, `reorderPendingPrintQueue(orderedIds: number[]): Promise<void>`, `retryPrintQueueJob(printQueueId): Promise<void>` (added to existing `src/lib/queries/print-queue.ts`) — consumed by Task 3 (server actions).
- Modifies: `getPendingPrintQueue`'s `ORDER BY` clause only (behavior-preserving for untouched rows — `SortOrder` starts `NULL` for everything, and `COALESCE(SortOrder, PrintQueueID)` equals the old `PrintQueueID`-based tie-break in that case).

- [ ] **Step 1: Write the two migration scripts**

`scripts/add-print-queue-order-column.ts`:

```typescript
// One-off schema migration adding SortOrder to DashboardPrintQueue — lets
// the print-management page's drag-and-drop reorder (Task 5) override the
// default CreatedAt/PrintQueueID FIFO order for still-Pending rows.
// Idempotent, safe to re-run.
// Usage: npx tsx scripts/add-print-queue-order-column.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DashboardPrintQueue') AND name = 'SortOrder')
    ALTER TABLE DashboardPrintQueue ADD SortOrder INT NULL
  `);

  console.log("DashboardPrintQueue.SortOrder ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`scripts/create-print-format-settings-table.ts`:

```typescript
// One-off schema creation for the SI Awal receipt format toggles
// (DashboardPrintFormatSettings) — single-row settings table, same pattern
// as DashboardSiteSettings. Idempotent, safe to re-run.
// Usage: npx tsx scripts/create-print-format-settings-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPrintFormatSettings' AND xtype='U')
    CREATE TABLE DashboardPrintFormatSettings (
      ID                INT IDENTITY PRIMARY KEY,
      ShowMitraAddress  BIT NOT NULL DEFAULT 1,
      ShowDriverName    BIT NOT NULL DEFAULT 1,
      ShowBankTransfer  BIT NOT NULL DEFAULT 1,
      ShowQrCode        BIT NOT NULL DEFAULT 1,
      ShowDisclaimer    BIT NOT NULL DEFAULT 1,
      UpdatedAt         DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM DashboardPrintFormatSettings)
    INSERT INTO DashboardPrintFormatSettings DEFAULT VALUES
  `);

  console.log("DashboardPrintFormatSettings ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run both migrations against the dev DB**

```bash
npx tsx scripts/add-print-queue-order-column.ts
npx tsx scripts/create-print-format-settings-table.ts
```

Expected: both print their "ready" line and exit 0. Re-run both a second time to confirm idempotency (still exits 0, no error).

- [ ] **Step 3: Create `src/lib/queries/print-format-settings.ts`**

```typescript
import { getPool, sql } from "@/lib/db";

export interface PrintFormatSettings {
  showMitraAddress: boolean;
  showDriverName: boolean;
  showBankTransfer: boolean;
  showQrCode: boolean;
  showDisclaimer: boolean;
}

// Only used if the seeded row is ever somehow missing (should never happen —
// the migration that created DashboardPrintFormatSettings always inserts
// exactly one row) — same defensive-fallback shape as site-settings.ts.
const PRINT_FORMAT_SETTINGS_FALLBACK: PrintFormatSettings = {
  showMitraAddress: true,
  showDriverName: true,
  showBankTransfer: true,
  showQrCode: true,
  showDisclaimer: true,
};

export async function getPrintFormatSettings(): Promise<PrintFormatSettings> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 ShowMitraAddress, ShowDriverName, ShowBankTransfer, ShowQrCode, ShowDisclaimer
    FROM DashboardPrintFormatSettings ORDER BY ID
  `);
  const row = result.recordset[0] as
    | {
        ShowMitraAddress: boolean;
        ShowDriverName: boolean;
        ShowBankTransfer: boolean;
        ShowQrCode: boolean;
        ShowDisclaimer: boolean;
      }
    | undefined;
  if (!row) return PRINT_FORMAT_SETTINGS_FALLBACK;
  return {
    showMitraAddress: row.ShowMitraAddress,
    showDriverName: row.ShowDriverName,
    showBankTransfer: row.ShowBankTransfer,
    showQrCode: row.ShowQrCode,
    showDisclaimer: row.ShowDisclaimer,
  };
}

export async function setPrintFormatSettings(input: PrintFormatSettings): Promise<void> {
  const pool = await getPool();
  const existing = await pool.request().query(`SELECT TOP 1 ID FROM DashboardPrintFormatSettings ORDER BY ID`);
  const id = (existing.recordset[0] as { ID: number } | undefined)?.ID;

  const request = pool
    .request()
    .input("showMitraAddress", sql.Bit, input.showMitraAddress)
    .input("showDriverName", sql.Bit, input.showDriverName)
    .input("showBankTransfer", sql.Bit, input.showBankTransfer)
    .input("showQrCode", sql.Bit, input.showQrCode)
    .input("showDisclaimer", sql.Bit, input.showDisclaimer);

  if (id != null) {
    await request.input("id", sql.Int, id).query(`
      UPDATE DashboardPrintFormatSettings
      SET ShowMitraAddress = @showMitraAddress, ShowDriverName = @showDriverName,
          ShowBankTransfer = @showBankTransfer, ShowQrCode = @showQrCode,
          ShowDisclaimer = @showDisclaimer, UpdatedAt = GETDATE()
      WHERE ID = @id
    `);
  } else {
    // Defensive only — the migration always seeds one row, so this branch
    // shouldn't run in practice.
    await request.query(`
      INSERT INTO DashboardPrintFormatSettings (ShowMitraAddress, ShowDriverName, ShowBankTransfer, ShowQrCode, ShowDisclaimer)
      VALUES (@showMitraAddress, @showDriverName, @showBankTransfer, @showQrCode, @showDisclaimer)
    `);
  }
}
```

- [ ] **Step 4: Extend `src/lib/queries/print-queue.ts`**

Add near the top, alongside the existing `PendingPrintJob` interface:

```typescript
export interface PrintQueueHistoryRow {
  printQueueId: number;
  salesInvoiceId: string;
  voucherNo: string | null;
  mitraName: string | null;
  armadaNama: string | null;
  vehicleNo: string | null;
  jadwalId: number;
  jamJadwal: Date | null;
  status: "Pending" | "Printing" | "Dicetak" | "Error" | "Dibatalkan";
  isManual: boolean;
  failCount: number;
  sortOrder: number | null;
  createdAt: Date;
  printedAt: Date | null;
}
```

Change `getPendingPrintQueue`'s query body from `ORDER BY CreatedAt, PrintQueueID` to `ORDER BY COALESCE(SortOrder, PrintQueueID)` (update the SELECT to include `SortOrder` too, even though the returned `PendingPrintJob` shape doesn't expose it — it's only needed inside the SQL `ORDER BY`, so pulling it into the SELECT list is required for the `COALESCE` to reference it):

```typescript
export async function getPendingPrintQueue(): Promise<PendingPrintJob[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PrintQueueID, SalesInvoiceID, JadwalID, SortOrder
    FROM DashboardPrintQueue
    WHERE Status = 'Pending'
    ORDER BY COALESCE(SortOrder, PrintQueueID)
  `);
  return (result.recordset as { PrintQueueID: number; SalesInvoiceID: string; JadwalID: number }[]).map((r) => ({
    printQueueId: r.PrintQueueID,
    salesInvoiceId: r.SalesInvoiceID,
    jadwalId: r.JadwalID,
  }));
}
```

Append at the end of the file:

```typescript
export async function getPrintQueueHistory(filters: {
  dateFrom: string; // ISO date (YYYY-MM-DD), inclusive
  dateTo: string;   // ISO date (YYYY-MM-DD), inclusive
  status?: PrintQueueHistoryRow["status"];
}): Promise<PrintQueueHistoryRow[]> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("dateFrom", sql.Date, filters.dateFrom)
    .input("dateTo", sql.Date, filters.dateTo);
  if (filters.status) request.input("status", sql.VarChar(20), filters.status);

  const result = await request.query(`
    SELECT pq.PrintQueueID, pq.SalesInvoiceID, si.VoucherNo, bp.Name AS MitraName,
           a.Nama AS ArmadaNama, ed.VehicleNo, pq.JadwalID, jad.JamJadwal,
           pq.Status, pq.IsManual, pq.FailCount, pq.SortOrder, pq.CreatedAt, pq.PrintedAt
    FROM DashboardPrintQueue pq
    LEFT JOIN SalesInvoice si ON si.SalesInvoiceID = pq.SalesInvoiceID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
    LEFT JOIN DashboardPengirimanJadwal jad ON jad.JadwalID = pq.JadwalID
    LEFT JOIN DashboardArmada a ON a.ArmadaID = jad.ArmadaID
    LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
    WHERE pq.CreatedAt >= @dateFrom AND pq.CreatedAt < DATEADD(DAY, 1, @dateTo)
      ${filters.status ? "AND pq.Status = @status" : ""}
    ORDER BY pq.CreatedAt DESC, pq.PrintQueueID DESC
  `);

  return (
    result.recordset as {
      PrintQueueID: number;
      SalesInvoiceID: string;
      VoucherNo: string | null;
      MitraName: string | null;
      ArmadaNama: string | null;
      VehicleNo: string | null;
      JadwalID: number;
      JamJadwal: Date | null;
      Status: PrintQueueHistoryRow["status"];
      IsManual: boolean;
      FailCount: number;
      SortOrder: number | null;
      CreatedAt: Date;
      PrintedAt: Date | null;
    }[]
  ).map((r) => ({
    printQueueId: r.PrintQueueID,
    salesInvoiceId: r.SalesInvoiceID,
    voucherNo: r.VoucherNo,
    mitraName: r.MitraName,
    armadaNama: r.ArmadaNama,
    vehicleNo: r.VehicleNo,
    jadwalId: r.JadwalID,
    jamJadwal: r.JamJadwal,
    status: r.Status,
    isManual: r.IsManual,
    failCount: r.FailCount,
    sortOrder: r.SortOrder,
    createdAt: r.CreatedAt,
    printedAt: r.PrintedAt,
  }));
}

// Only transitions a row that is still 'Pending' — mirrors claimPrintQueueJob's
// own atomic UPDATE ... WHERE Status = 'Pending' pattern. Returns false if the
// row had already left Pending (already printing/printed/errored/cancelled)
// by the time this ran.
export async function cancelPrintQueueJob(printQueueId: number): Promise<boolean> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, printQueueId)
    .query(`UPDATE DashboardPrintQueue SET Status = 'Dibatalkan' WHERE PrintQueueID = @id AND Status = 'Pending'`);
  return result.rowsAffected[0] > 0;
}

// Re-sequences every row named in orderedIds to 10, 20, 30, ... in that
// order — but only touches a row while it's still Pending (the WHERE guard
// on each UPDATE), so a row that left Pending in the race between the
// client reading the list and submitting the reorder is silently skipped,
// not an error. Individual per-row UPDATEs rather than a single batched
// statement — the queue is small (a handful of Pending rows at a time) and
// this keeps the "skip if no longer Pending" logic simple.
export async function reorderPendingPrintQueue(orderedIds: number[]): Promise<void> {
  const pool = await getPool();
  for (let i = 0; i < orderedIds.length; i++) {
    await pool
      .request()
      .input("id", sql.Int, orderedIds[i])
      .input("sortOrder", sql.Int, (i + 1) * 10)
      .query(`UPDATE DashboardPrintQueue SET SortOrder = @sortOrder WHERE PrintQueueID = @id AND Status = 'Pending'`);
  }
}

// Looks up the given row's SalesInvoiceID/JadwalID and enqueues a brand new
// Pending job (IsManual = true) — the given row itself is never touched, so
// DashboardPrintQueue stays an honest append-only audit log (a Dicetak row
// stays Dicetak forever). Reuses enqueuePrintJob, the same insert path the
// automatic Selesai Muat batch and the per-stop manual reprint icon already
// use — one insert path, not two.
export async function retryPrintQueueJob(printQueueId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, printQueueId)
    .query(`SELECT SalesInvoiceID, JadwalID FROM DashboardPrintQueue WHERE PrintQueueID = @id`);
  const row = result.recordset[0] as { SalesInvoiceID: string; JadwalID: number } | undefined;
  if (!row) throw new AppError("Job cetak ini tidak ditemukan.");
  await enqueuePrintJob(pool, row.SalesInvoiceID, row.JadwalID, true);
}
```

- [ ] **Step 5: Smoke-test against the live dev DB**

```bash
npx tsx -e "
import 'dotenv/config';
import { getPrintFormatSettings } from './src/lib/queries/print-format-settings';
import { getPrintQueueHistory } from './src/lib/queries/print-queue';
(async () => {
  console.log(await getPrintFormatSettings());
  console.log((await getPrintQueueHistory({ dateFrom: '2026-08-01', dateTo: '2026-08-24' })).slice(0, 3));
  process.exit(0);
})();
"
```

Expected: prints the default `PrintFormatSettings` object (all `true`), then up to 3 `PrintQueueHistoryRow` objects with real `voucherNo`/`mitraName`/`armadaNama` values (not `null` for rows that have a real linked SalesInvoice/Jadwal).

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/lib/queries/print-format-settings.ts src/lib/queries/print-queue.ts scripts/add-print-queue-order-column.ts scripts/create-print-format-settings-table.ts
git add scripts/add-print-queue-order-column.ts scripts/create-print-format-settings-table.ts src/lib/queries/print-format-settings.ts src/lib/queries/print-queue.ts
git commit -m "feat: print-queue history/cancel/reorder + print format settings query layer"
```

Both commands must exit clean (no output / no errors) before committing.

---

### Task 2: `receipt-builder.ts` settings-aware + poller call site

**Files:**
- Modify: `src/lib/thermal-printer/receipt-builder.ts`
- Modify: `src/components/dashboard/print-queue-poller.tsx`

**Interfaces:**
- Consumes: `PrintFormatSettings` from `@/lib/queries/print-format-settings` (Task 1). `getPrintFormatSettingsAction` does not exist yet at this point in the plan — Task 2 imports the query function `getPrintFormatSettings` is NOT usable from a client component directly (client components can only call server actions, not query functions). **Resolve this by having Task 2 add a minimal, self-contained action-import**: since `getPrintFormatSettingsAction` is defined in Task 3, and Task 2 runs before Task 3 in this plan's order, swap the task order in execution — run Task 3 (server actions) before Task 2, OR (simpler, no reordering needed) have this task's poller change import `getPrintFormatSettingsAction` from `@/app/mkesindo/(dashboard)/delivery/actions` by name now; the import will be a compile error until Task 3 adds it, so **execute Task 3 before Task 2** despite the numbering — the ledger/todo list should reflect actual execution order 1, 3, 2, 4, 5, 6. (Numbering kept as originally designed for readability; only the execution order swaps.)
- Produces: `buildReceiptBytes(data: ThermalReceiptData, settings: PrintFormatSettings): Uint8Array` (settings is now a required second parameter — the sole existing call site, in `print-queue-poller.tsx`, is updated in this same task, so there is no intermediate broken state within the task).

- [ ] **Step 1: Update `buildReceiptBytes` in `src/lib/thermal-printer/receipt-builder.ts`**

Add the import and change the function signature + body:

```typescript
import type { PrintFormatSettings } from "@/lib/queries/print-format-settings";
```

Replace the function body (keep everything else — `THERMAL_PAPER_COLUMNS_58MM`, the header block through `.rule()` before the line-items loop, and the line-items loop + total block are unconditional and untouched):

```typescript
export function buildReceiptBytes(data: ThermalReceiptData, settings: PrintFormatSettings): Uint8Array {
  const encoder = new EscPosEncoder({ columns: THERMAL_PAPER_COLUMNS_58MM });
  encoder
    .initialize()
    .align("center")
    .bold(true)
    .line("SI AWAL")
    .bold(false)
    .line(data.voucherNo)
    .line(`${formatDate(data.transDate)} ${formatTime(data.transDate)}`)
    .align("left")
    .newline()
    .line(`Mitra: ${data.mitraName}`);

  if (data.mitraAddress && settings.showMitraAddress) encoder.line(data.mitraAddress);

  encoder.line(`Armada: ${data.armadaNama}${data.vehicleNo ? ` (${data.vehicleNo})` : ""}`);
  if (settings.showDriverName) encoder.line(`Driver: ${data.driverName ?? "-"}`);

  encoder.newline().rule();

  for (const line of data.lines) {
    encoder.line(`${line.name} x${line.qty}`).align("right").line(formatRupiah(line.amount)).align("left");
  }

  encoder
    .rule()
    .bold(true)
    .align("right")
    .line(`TOTAL: ${formatRupiah(data.total)}`)
    .bold(false)
    .align("left")
    .newline();

  if (data.bankTransfer && settings.showBankTransfer) {
    encoder
      .line("Transfer ke:")
      .line(`${data.bankTransfer.bankNama} ${data.bankTransfer.nomorRekening}`)
      .line(`a.n. ${data.bankTransfer.atasNama}`)
      .newline();
  }

  if (settings.showQrCode) {
    encoder
      .align("center")
      .line("Scan untuk lihat tagihan & bayar QRIS:")
      .qrcode(data.invoiceUrl, { size: 6 })
      .newline()
      .align("left");
  }

  if (settings.showDisclaimer) {
    encoder
      .align("center")
      .line("SI Awal - nominal dapat berubah")
      .line("sesuai kondisi pengiriman di lapangan")
      .newline();
  }

  encoder.cut();

  return encoder.encode();
}
```

(Note: the original always ended `.align("center")` before the QR block and stayed centered through the disclaimer; since either block can now be independently absent, each conditional block sets its own `align("center")`/`align("left")` around itself so the output is correct in every combination of toggles, not just all-on.)

- [ ] **Step 2: Update the poller's call site in `src/components/dashboard/print-queue-poller.tsx`**

Add the import:

```typescript
import { getPrintFormatSettingsAction } from "@/app/mkesindo/(dashboard)/delivery/actions";
```

Inside `drainQueue`, right after the `if (!conn) { ... return; }` disconnected-guard block and before the `for` loop, fetch settings once for the whole batch:

```typescript
const settingsResult = await getPrintFormatSettingsAction();
if (!settingsResult.success) {
  toast.error(`Gagal ambil pengaturan format cetak: ${settingsResult.error}`);
  return;
}
const formatSettings = settingsResult.data;

for (let i = 0; i < jobsResult.data.length; i++) {
```

And change the existing send call from `buildReceiptBytes(dataResult.data)` to `buildReceiptBytes(dataResult.data, formatSettings)`.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/lib/thermal-printer/receipt-builder.ts src/components/dashboard/print-queue-poller.tsx
git add src/lib/thermal-printer/receipt-builder.ts src/components/dashboard/print-queue-poller.tsx
git commit -m "feat: receipt-builder respects print format settings toggles"
```

---

### Task 3: Server actions

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: everything Task 1 produces (`print-queue.ts`'s new exports, `print-format-settings.ts`'s exports).
- Produces: `getPrintQueueHistoryAction`, `cancelPrintQueueJobAction`, `reorderPendingPrintQueueAction`, `retryPrintQueueJobAction`, `getPrintFormatSettingsAction`, `setPrintFormatSettingsAction` — consumed by Task 2 (poller, `getPrintFormatSettingsAction` only) and Tasks 5/6 (the new page/components, all six).

**Execution order note:** run this task immediately after Task 1 and before Task 2 (see Task 2's Interfaces note) — `print-queue-poller.tsx` imports `getPrintFormatSettingsAction` from this file's exports.

- [ ] **Step 1: Extend the imports block in `src/app/mkesindo/(dashboard)/delivery/actions.ts`**

Change the existing print-queue import block from:

```typescript
import {
  getPendingPrintQueue,
  markPrintQueueDone,
  enqueueManualReprint,
  claimPrintQueueJob,
  incrementPrintQueueFailCount,
  markPrintQueueError,
  revertPrintQueueJobToPending,
  type PendingPrintJob,
} from "@/lib/queries/print-queue";
```

to:

```typescript
import {
  getPendingPrintQueue,
  markPrintQueueDone,
  enqueueManualReprint,
  claimPrintQueueJob,
  incrementPrintQueueFailCount,
  markPrintQueueError,
  revertPrintQueueJobToPending,
  getPrintQueueHistory,
  cancelPrintQueueJob,
  reorderPendingPrintQueue,
  retryPrintQueueJob,
  type PendingPrintJob,
  type PrintQueueHistoryRow,
} from "@/lib/queries/print-queue";
import {
  getPrintFormatSettings,
  setPrintFormatSettings,
  type PrintFormatSettings,
} from "@/lib/queries/print-format-settings";
```

- [ ] **Step 2: Append the six new actions**, right after the existing `revertPrintQueueJobToPendingAction` (end of that function's closing `});`):

```typescript
export async function getPrintQueueHistoryAction(filters: {
  dateFrom: string;
  dateTo: string;
  status?: PrintQueueHistoryRow["status"];
}): Promise<ActionResult<PrintQueueHistoryRow[]>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    return getPrintQueueHistory(filters);
  });
}

export async function cancelPrintQueueJobAction(printQueueId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    const cancelled = await cancelPrintQueueJob(printQueueId);
    if (!cancelled) throw new AppError("Job ini sudah tidak bisa dibatalkan (statusnya sudah berubah).");
  });
}

export async function reorderPendingPrintQueueAction(orderedIds: number[]): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    await reorderPendingPrintQueue(orderedIds);
  });
}

export async function retryPrintQueueJobAction(printQueueId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    await retryPrintQueueJob(printQueueId);
  });
}

export async function getPrintFormatSettingsAction(): Promise<ActionResult<PrintFormatSettings>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    return getPrintFormatSettings();
  });
}

export async function setPrintFormatSettingsAction(input: PrintFormatSettings): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    await setPrintFormatSettings(input);
  });
}
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/app/mkesindo/\(dashboard\)/delivery/actions.ts
git add "src/app/mkesindo/(dashboard)/delivery/actions.ts"
git commit -m "feat: server actions for print queue history/cancel/reorder/retry and format settings"
```

---

### Task 4: New route page + nav link

**Files:**
- Create: `src/app/mkesindo/(dashboard)/delivery/cetak/page.tsx`
- Modify: `src/app/mkesindo/(dashboard)/delivery/page.tsx`

**Interfaces:**
- Consumes: `getPrintQueueHistory`/`getPrintFormatSettings` (query layer, Task 1) directly (server component, not via actions — same pattern `delivery/page.tsx` itself already uses for its own initial data), `getBusinessDateISO` from `@/lib/business-date`.
- Produces: the `/mkesindo/delivery/cetak` route. `<PrintManagementView />` is referenced here but implemented in Tasks 5/6 — this task creates `page.tsx` importing a component that doesn't exist yet, which will not compile until Task 5 lands. **Execution order: do Task 5 (and its Format SI half, Task 6) before wiring this page's import**, OR write this task's `page.tsx` last, after Task 6. Simplest: execute this task's Step 1 (page.tsx) LAST, after Task 6 — steps below assume that order (the button-link Step 2 has no such dependency and can run any time after Task 1).

- [ ] **Step 1 (do this after Task 6 is complete): Create `src/app/mkesindo/(dashboard)/delivery/cetak/page.tsx`**

```typescript
import { requireModuleAccess } from "@/lib/require-access";
import { getPrintQueueHistory } from "@/lib/queries/print-queue";
import { getPrintFormatSettings } from "@/lib/queries/print-format-settings";
import { getBusinessDateISO } from "@/lib/business-date";
import { PrintManagementView } from "@/components/dashboard/print-management-view";

export default async function PrintManagementPage() {
  await requireModuleAccess("delivery");
  const todayISO = getBusinessDateISO();

  const [history, settings] = await Promise.all([
    getPrintQueueHistory({ dateFrom: todayISO, dateTo: todayISO }),
    getPrintFormatSettings(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Manajemen Cetak</h1>
      <PrintManagementView initialHistory={history} initialSettings={settings} businessDate={todayISO} />
    </div>
  );
}
```

- [ ] **Step 2 (can run any time after Task 1): Add the "Manajemen Cetak" button to `src/app/mkesindo/(dashboard)/delivery/page.tsx`**

Add the import:

```typescript
import Link from "next/link";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
```

Change the header block from:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pengiriman</h1>
        <FilterBar wilayahList={wilayahList} showDateRange={false} />
      </div>
```

to:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pengiriman</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" render={<Link href="/mkesindo/delivery/cetak" />}>
            <Printer className="size-3.5" /> Manajemen Cetak
          </Button>
          <FilterBar wilayahList={wilayahList} showDateRange={false} />
        </div>
      </div>
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npx eslint "src/app/mkesindo/(dashboard)/delivery/cetak/page.tsx" "src/app/mkesindo/(dashboard)/delivery/page.tsx"
git add "src/app/mkesindo/(dashboard)/delivery/cetak/page.tsx" "src/app/mkesindo/(dashboard)/delivery/page.tsx"
git commit -m "feat: /mkesindo/delivery/cetak route + nav button"
```

---

### Task 5: `PrintManagementView` — Antrian Cetak tab

**Files:**
- Create: `src/components/dashboard/print-management-view.tsx`

**Interfaces:**
- Consumes: `PrintQueueHistoryRow`/`PrintFormatSettings` types (Task 1), `getPrintQueueHistoryAction`/`cancelPrintQueueJobAction`/`reorderPendingPrintQueueAction`/`retryPrintQueueJobAction` (Task 3), `triggerPrintQueuePollNow`/`PrintQueuePoller` (existing, `@/components/dashboard/print-queue-poller`), `formatDate`/`formatTime` (existing, `@/lib/format`).
- Produces: `PrintManagementView` component with props `{ initialHistory: PrintQueueHistoryRow[]; initialSettings: PrintFormatSettings; businessDate: string }` — the outer component and this task's "Antrian Cetak" tab content. Task 6 adds the "Format SI" tab to this same file (the `initialSettings`/`businessDate` props exist already at this task's end but are unused until Task 6 — expect an eslint `no-unused-vars` on `initialSettings` until then, resolved by Task 6, not a blocker for this task's own commit as long as it's prefixed or the destructure is deferred; simplest: destructure only `initialHistory` in this task's `PrintManagementView` signature, and Task 6 adds `initialSettings`/`businessDate` to the destructure when it adds the second tab).

- [ ] **Step 1: Create the file with the tab shell + Antrian Cetak content**

```typescript
"use client";

import { useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { GripVertical, Printer as PrinterIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PrintQueuePoller, triggerPrintQueuePollNow } from "@/components/dashboard/print-queue-poller";
import {
  getPrintQueueHistoryAction,
  cancelPrintQueueJobAction,
  reorderPendingPrintQueueAction,
  retryPrintQueueJobAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { PrintQueueHistoryRow } from "@/lib/queries/print-queue";

const STATUS_BADGE_CLASS: Record<PrintQueueHistoryRow["status"], string> = {
  Pending: "border-border text-muted-foreground",
  Printing: "border-blue-500/30 text-blue-600",
  Dicetak: "border-green-600/30 text-green-600",
  Error: "border-destructive/30 text-destructive",
  Dibatalkan: "border-border text-muted-foreground line-through",
};

function StatusBadge({ status }: { status: PrintQueueHistoryRow["status"] }) {
  return (
    <Badge variant="outline" className={STATUS_BADGE_CLASS[status]}>
      {status}
    </Badge>
  );
}

function SortableHistoryRow({
  row,
  onRetry,
  onCancel,
  busy,
}: {
  row: PrintQueueHistoryRow;
  onRetry: (id: number) => void;
  onCancel: (id: number) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.printQueueId,
    disabled: row.status !== "Pending",
  });

  // Plain <tr>, not the <TableRow> wrapper — ui/table.tsx's TableRow is a
  // bare function component around <tr {...props} />, and its prop type
  // (React.ComponentProps<"tr">) isn't guaranteed to forward `ref` the way
  // an intrinsic element does. dnd-kit's setNodeRef MUST attach to the real
  // DOM node to measure drag transforms, so this row uses the exact same
  // "native element + ref={setNodeRef}" pattern route-validation-dialog.tsx's
  // own SortableStopRow already uses (there on a <div>, here on a <tr>).
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("border-b transition-colors hover:bg-muted/50", isDragging && "z-10 bg-muted/50 opacity-70 shadow-lg")}
    >
      <TableCell className="w-6">
        {row.status === "Pending" && (
          <button type="button" {...attributes} {...listeners} className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
            <GripVertical className="size-4" />
          </button>
        )}
      </TableCell>
      <TableCell>{row.voucherNo ?? "-"}</TableCell>
      <TableCell>{row.mitraName ?? "-"}</TableCell>
      <TableCell>
        {row.armadaNama ?? "-"}
        {row.vehicleNo ? ` (${row.vehicleNo})` : ""}
      </TableCell>
      <TableCell>{row.jamJadwal ? formatDate(row.jamJadwal) : "-"}</TableCell>
      <TableCell>
        <StatusBadge status={row.status} />
      </TableCell>
      <TableCell>
        <Badge variant="outline">{row.isManual ? "Manual" : "Otomatis"}</Badge>
      </TableCell>
      <TableCell>{row.failCount > 0 ? row.failCount : ""}</TableCell>
      <TableCell>{formatDate(row.createdAt)} {formatTime(row.createdAt)}</TableCell>
      <TableCell>{row.printedAt ? `${formatDate(row.printedAt)} ${formatTime(row.printedAt)}` : "-"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Cetak ulang"
            onClick={() => onRetry(row.printQueueId)}
            disabled={busy}
            className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-border disabled:cursor-default disabled:opacity-50"
          >
            <PrinterIcon className="size-3.5" />
          </button>
          {row.status === "Pending" && (
            <button
              type="button"
              title="Batalkan"
              onClick={() => onCancel(row.printQueueId)}
              disabled={busy}
              className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-destructive/30 hover:text-destructive disabled:cursor-default disabled:opacity-50"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </TableCell>
    </tr>
  );
}

export function PrintManagementView({ initialHistory }: { initialHistory: PrintQueueHistoryRow[] }) {
  const [history, setHistory] = useState(initialHistory);
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState<PrintQueueHistoryRow["status"] | "all">("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function refetch() {
    const result = await getPrintQueueHistoryAction({
      dateFrom,
      dateTo,
      status: statusFilter === "all" ? undefined : statusFilter,
    });
    if (result.success) setHistory(result.data);
    else toast.error(result.error);
  }

  function handleFilterChange() {
    startTransition(refetch);
  }

  function handleRetry(printQueueId: number) {
    setBusyId(printQueueId);
    startTransition(async () => {
      const result = await retryPrintQueueJobAction(printQueueId);
      setBusyId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("SI ditambahkan ke antrian cetak.");
      triggerPrintQueuePollNow();
      await refetch();
    });
  }

  function handleCancel(printQueueId: number) {
    if (!confirm("Batalkan cetak SI ini?")) return;
    setBusyId(printQueueId);
    startTransition(async () => {
      const result = await cancelPrintQueueJobAction(printQueueId);
      setBusyId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      await refetch();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const pendingRows = history.filter((r) => r.status === "Pending");
    const oldIndex = pendingRows.findIndex((r) => r.printQueueId === active.id);
    const newIndex = pendingRows.findIndex((r) => r.printQueueId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(pendingRows, oldIndex, newIndex);

    // Splice the reordered Pending rows back into their original positions
    // within the full history list — Pending rows are always contiguous at
    // the top of a newest-first list only by coincidence, so rebuild by
    // index rather than assuming that.
    let cursor = 0;
    const next = history.map((r) => (r.status === "Pending" ? reordered[cursor++] : r));
    setHistory(next);

    startTransition(async () => {
      const result = await reorderPendingPrintQueueAction(reordered.map((r) => r.printQueueId));
      if (!result.success) {
        toast.error(result.error);
        await refetch();
      }
    });
  }

  const pendingIds = history.filter((r) => r.status === "Pending").map((r) => r.printQueueId);

  return (
    <Tabs defaultValue="antrian">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="antrian">Antrian Cetak</TabsTrigger>
          <TabsTrigger value="format">Format SI</TabsTrigger>
        </TabsList>
        <PrintQueuePoller />
      </div>

      <TabsContent value="antrian" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              handleFilterChange();
            }}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          />
          <span className="text-muted-foreground">s/d</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              handleFilterChange();
            }}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as PrintQueueHistoryRow["status"] | "all");
              handleFilterChange();
            }}
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Printing">Printing</SelectItem>
              <SelectItem value="Dicetak">Dicetak</SelectItem>
              <SelectItem value="Error">Error</SelectItem>
              <SelectItem value="Dibatalkan">Dibatalkan</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead>No. SI</TableHead>
                <TableHead>Mitra</TableHead>
                <TableHead>Armada</TableHead>
                <TableHead>Tgl Jadwal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Gagal</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>Dicetak</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={pendingIds} strategy={verticalListSortingStrategy}>
                  {history.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground">
                        Tidak ada job cetak pada rentang ini.
                      </TableCell>
                    </TableRow>
                  ) : (
                    history.map((row) => (
                      <SortableHistoryRow
                        key={row.printQueueId}
                        row={row}
                        onRetry={handleRetry}
                        onCancel={handleCancel}
                        busy={busyId === row.printQueueId}
                      />
                    ))
                  )}
                </SortableContext>
              </DndContext>
            </TableBody>
          </Table>
        </div>
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
```

Expected: errors ONLY about `initialSettings`/`businessDate` not existing yet on the page.tsx call site created in Task 4 (if Task 4 was already done) — if Task 4 hasn't run yet, this should be otherwise clean aside from `page.tsx` not existing to reference this component at all, which is fine. Do not fix those cross-task errors here; they resolve once Task 6 adds the second prop destructure and Task 4's `page.tsx` (created last, per its own note) passes both props.

```bash
npx eslint src/components/dashboard/print-management-view.tsx
```

Expected: clean (this file is self-contained; it doesn't yet reference the not-yet-existing `page.tsx`).

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/print-management-view.tsx
git commit -m "feat: print management view - Antrian Cetak tab"
```

---

### Task 6: `PrintManagementView` — Format SI tab

**Files:**
- Modify: `src/components/dashboard/print-management-view.tsx`

**Interfaces:**
- Consumes: `PrintFormatSettings` (Task 1), `getPrintFormatSettingsAction`/`setPrintFormatSettingsAction` (Task 3).
- Produces: completes `PrintManagementView`'s public signature to `{ initialHistory: PrintQueueHistoryRow[]; initialSettings: PrintFormatSettings; businessDate: string }` (the `businessDate` prop is accepted for API-completeness/future use — e.g. a future "reset to today" control — but not read by any logic in this task; expect it to be unused within the component body, which is fine and not an eslint violation since unused destructured/renamed props aren't flagged the way unused local variables are — confirm this compiles clean in Step 3 regardless).

- [ ] **Step 1: Add the sample-receipt preview builder and the Format SI tab**

Add near the top of the file, after the existing imports. Note only `setPrintFormatSettingsAction` is needed here — `getPrintFormatSettingsAction` is not called from this component, since `initialSettings` already arrives as a prop from the server component built in Task 4:

```typescript
import { setPrintFormatSettingsAction } from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { PrintFormatSettings } from "@/lib/queries/print-format-settings";
```

Add this pure function above `PrintManagementView` (builds a plain-text 32-column mock, not real ESC/POS bytes — purely visual):

```typescript
const PREVIEW_COLUMNS = 32;

function center(text: string): string {
  const pad = Math.max(0, Math.floor((PREVIEW_COLUMNS - text.length) / 2));
  return " ".repeat(pad) + text;
}

function padRight(text: string, amount: string): string {
  const gap = Math.max(1, PREVIEW_COLUMNS - text.length - amount.length);
  return text + " ".repeat(gap) + amount;
}

function buildReceiptPreviewText(settings: PrintFormatSettings): string {
  const lines: string[] = [];
  lines.push(center("SI AWAL"));
  lines.push(center("MKE/SI/000001/2026-08"));
  lines.push(center("24-08-2026 10:00"));
  lines.push("");
  lines.push("Mitra: Toko Contoh");
  if (settings.showMitraAddress) lines.push("Jl. Contoh No. 1, Ponorogo");
  lines.push("Armada: Truk 1 (AE 1234 SH)");
  if (settings.showDriverName) lines.push("Driver: Budi");
  lines.push("");
  lines.push("-".repeat(PREVIEW_COLUMNS));
  lines.push("Es Kristal 10KG x10");
  lines.push(padRight("", "Rp250.000"));
  lines.push("-".repeat(PREVIEW_COLUMNS));
  lines.push(padRight("TOTAL:", "Rp250.000"));
  lines.push("");
  if (settings.showBankTransfer) {
    lines.push("Transfer ke:");
    lines.push("BCA 1234567890");
    lines.push("a.n. PT Mitra Kelola Esindo");
    lines.push("");
  }
  if (settings.showQrCode) {
    lines.push(center("Scan untuk lihat tagihan"));
    lines.push(center("& bayar QRIS:"));
    lines.push(center("[ QR CODE ]"));
    lines.push("");
  }
  if (settings.showDisclaimer) {
    lines.push(center("SI Awal - nominal dapat"));
    lines.push(center("berubah sesuai kondisi"));
    lines.push(center("pengiriman di lapangan"));
  }
  return lines.join("\n");
}
```

Change the component signature and add settings state:

```typescript
export function PrintManagementView({
  initialHistory,
  initialSettings,
}: {
  initialHistory: PrintQueueHistoryRow[];
  initialSettings: PrintFormatSettings;
  businessDate: string;
}) {
  const [history, setHistory] = useState(initialHistory);
  const [settings, setSettings] = useState(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
```

(keep every other existing `useState`/`useTransition`/`sensors` line as-is, just adding the two new lines above alongside them)

Add a save handler alongside the other handler functions:

```typescript
  function handleSaveSettings() {
    setSavingSettings(true);
    startTransition(async () => {
      const result = await setPrintFormatSettingsAction(settings);
      setSavingSettings(false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Pengaturan format SI disimpan.");
    });
  }

  function toggleSetting(key: keyof PrintFormatSettings) {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  }
```

Add the second `<TabsContent>` right after the existing `</TabsContent>` that closes `value="antrian"`, before the closing `</Tabs>`:

```tsx
      <TabsContent value="format" className="flex flex-col gap-4 lg:flex-row">
        <div className="flex flex-1 flex-col gap-3 rounded-lg border p-4">
          {(
            [
              ["showMitraAddress", "Alamat mitra"],
              ["showDriverName", "Nama driver"],
              ["showBankTransfer", "Blok transfer bank"],
              ["showQrCode", "QR code tagihan"],
              ["showDisclaimer", "Baris disclaimer nominal"],
            ] as [keyof PrintFormatSettings, string][]
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settings[key]} onChange={() => toggleSetting(key)} className="size-4" />
              {label}
            </label>
          ))}
          <Button onClick={handleSaveSettings} disabled={savingSettings} className="mt-2 w-fit">
            Simpan Pengaturan
          </Button>
        </div>
        <div className="flex-1 rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs text-muted-foreground">Pratinjau (58mm, 32 kolom)</p>
          <pre className="mx-auto w-fit whitespace-pre bg-white p-3 font-mono text-xs text-black shadow">
            {buildReceiptPreviewText(settings)}
          </pre>
        </div>
      </TabsContent>
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npx eslint src/components/dashboard/print-management-view.tsx
```

Both must be clean now (this task completes the component's props to match what Task 4's `page.tsx` passes).

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/print-management-view.tsx
git commit -m "feat: print management view - Format SI tab with live preview"
```

---

## Execution order summary

Because of the cross-task import dependencies noted above, execute in this order regardless of task numbering: **Task 1 → Task 3 → Task 2 → Task 5 → Task 6 → Task 4**. Task 4's Step 2 (the nav button) has no such dependency and may run any time after Task 1, but keeping it last alongside Step 1 is simplest for one coherent final commit that makes the whole feature reachable.

## Final verification (after all tasks)

```bash
npx tsc --noEmit
npx eslint src
```

Both clean. Then manually exercise the feature: open `/mkesindo/delivery`, click "Manajemen Cetak", confirm the Antrian Cetak tab lists today's print jobs (compare against a known real SalesInvoice/Jadwal from earlier testing), try Cetak Ulang / Batalkan / drag-reorder on a Pending row, then switch to Format SI, toggle each checkbox and confirm the preview updates, save, and confirm a subsequent real print (via the connected printer) reflects the saved toggles.
