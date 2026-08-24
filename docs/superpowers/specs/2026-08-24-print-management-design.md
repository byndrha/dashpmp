# Print Management (Antrian Cetak + Format SI)

## Context

The thermal SI Awal printing feature (`docs/superpowers/specs/2026-08-24-thermal-print-si-awal-design.md`) shipped with a `DashboardPrintQueue` table and a `PrintQueuePoller` component mounted on `/mkesindo/delivery`, but no UI ever surfaces the queue itself — Operasional staff have no way to see what's pending, what failed, or reprint/cancel a specific job without going through the per-stop manual reprint icon inside a Jadwal's route-validation dialog. There is also no way to change what's printed on the SI Awal receipt without editing `receipt-builder.ts` and redeploying — every element (mitra address, driver name, bank transfer block, QR code, disclaimer) is unconditionally printed.

This design adds a dedicated print-management page covering both gaps: a full history/queue view with retry/cancel/reorder, and a settings panel to toggle which receipt elements print.

## Decisions made during brainstorming

- **New standalone page, `/mkesindo/delivery/cetak`** — not a tab folded into the already-crowded Papan Pengiriman board. Reached via a "Manajemen Cetak" button in the `/mkesindo/delivery` header, next to `FilterBar`. Access gate is identical to `/mkesindo/delivery` (`requireModuleAccess("delivery")`) for both tabs — no extra role restriction on the Format SI tab, since it only toggles receipt content, not financial data.
- **The page mounts its own `PrintQueuePoller`** — reused unchanged from `/mkesindo/delivery`. `claimPrintQueueJob`'s atomic claim (existing) already makes two pollers draining the same queue from two open tabs safe, so this is not a new race — it's the exact scenario that guard was built for. This means "Cetak Ulang" from this page can print immediately if it's open on the machine with the printer connected, without needing to also have `/mkesindo/delivery` open.
- **Retry never mutates a historical row — it always enqueues a new one.** Keeps `DashboardPrintQueue` an honest append-only audit log (a Dicetak row stays Dicetak forever), and reuses the exact same `enqueuePrintJob` code path the automatic and manual-icon flows already use — one insert path, not two.
- **Cancel is a status transition, not a delete.** `'Dibatalkan'` is a new terminal `Status` value, consistent with `'Error'` — excluded from `getPendingPrintQueue`'s `WHERE Status = 'Pending'` automatically, but stays visible in the history view. Only legal from `'Pending'` (atomic `UPDATE ... WHERE Status = 'Pending'`, mirroring `claimPrintQueueJob`'s own pattern) — a row already `Printing`/`Dicetak` can't be cancelled out from under an in-flight print.
- **Reorder only applies to `Pending` rows** and needs an explicit sort column — `CreatedAt`/`PrintQueueID` ordering (the current tie-break scheme) has no room for a manual override. Add `SortOrder INT NULL`; `getPendingPrintQueue` orders by `COALESCE(SortOrder, PrintQueueID)` instead of `CreatedAt, PrintQueueID` (equivalent for untouched rows, since `PrintQueueID` is already monotonic with `CreatedAt`). A reorder action re-sequences every currently-Pending row's `SortOrder` together (10, 20, 30, …) so the gaps leave room for a future manual reprint to insert without renumbering everything.
- **Format toggles are boolean show/hide only** — no free-text template editing. Layout stays exactly as `receipt-builder.ts` already writes it; each toggle just wraps an existing block in an `if`. This can't produce a malformed receipt (unlike a free-form template), matching the "aman, tidak bisa merusak layout" requirement from brainstorming.
- **Settings are fetched once per `drainQueue()` batch, not once per job.** Fresh enough (every ~4s poll tick, or immediately on a manual trigger) without adding a round-trip per individual print inside a multi-stop batch.
- **A live monospace preview accompanies the toggles** — real 32-column-wide text mirroring what `receipt-builder.ts` would actually produce for a representative sample receipt, entirely client-side (no server round-trip per toggle flip).

## Data model

### `DashboardPrintQueue` — add `SortOrder`, new `Status` value

```sql
ALTER TABLE DashboardPrintQueue ADD SortOrder INT NULL
```

No change to existing `Status` semantics beyond documenting the additional legal value: `'Pending' | 'Printing' | 'Dicetak' | 'Error' | 'Dibatalkan'`. `SortOrder` stays `NULL` for every row until the first reorder action touches it; `getPendingPrintQueue`'s `ORDER BY` becomes `COALESCE(SortOrder, PrintQueueID)`.

### New MSSQL table: `DashboardPrintFormatSettings`

Single-row settings table, same shape as `DashboardSiteSettings`:

```sql
CREATE TABLE DashboardPrintFormatSettings (
  ID                INT IDENTITY PRIMARY KEY,
  ShowMitraAddress  BIT NOT NULL DEFAULT 1,
  ShowDriverName    BIT NOT NULL DEFAULT 1,
  ShowBankTransfer  BIT NOT NULL DEFAULT 1,
  ShowQrCode        BIT NOT NULL DEFAULT 1,
  ShowDisclaimer    BIT NOT NULL DEFAULT 1,
  UpdatedAt         DATETIME NOT NULL DEFAULT GETDATE()
)

INSERT INTO DashboardPrintFormatSettings DEFAULT VALUES
```

## 1. Query layer

### `src/lib/queries/print-queue.ts` — extend

```typescript
export interface PrintQueueHistoryRow {
  printQueueId: number;
  salesInvoiceId: string;
  voucherNo: string;
  mitraName: string;
  armadaNama: string | null;
  vehicleNo: string | null;
  jadwalId: number;
  jadwalDate: string; // Jadwal's TglPengiriman, ISO date
  status: "Pending" | "Printing" | "Dicetak" | "Error" | "Dibatalkan";
  isManual: boolean;
  failCount: number;
  sortOrder: number | null;
  createdAt: Date;
  printedAt: Date | null;
}

export async function getPrintQueueHistory(filters: {
  dateFrom: string; // ISO date, inclusive, filters on CreatedAt
  dateTo: string;   // ISO date, inclusive
  status?: PrintQueueHistoryRow["status"];
}): Promise<PrintQueueHistoryRow[]>;
```

Joins `DashboardPrintQueue pq` → `SalesInvoice si` (`pq.SalesInvoiceID = si.SalesInvoiceID`) → `BusinessPartner bp` (`si.BusinessPartnerID = bp.BusinessPartnerID`) for `voucherNo`/`mitraName`, and `pq.JadwalID` → `DashboardPengirimanJadwal jad` → `DashboardArmada a` for `armadaNama`/`vehicleNo`/`jadwalDate` (same join shape `getThermalReceiptData` already uses for armada/driver info, minus the driver join — not needed in the list view). `ORDER BY pq.CreatedAt DESC, pq.PrintQueueID DESC` (newest first — this is a history view, opposite of the poller's oldest-first drain order).

```typescript
// Only transitions a row that is still 'Pending' — mirrors claimPrintQueueJob's
// own atomic UPDATE ... WHERE Status = 'Pending' pattern. Returns false if the
// row had already left Pending (already printing/printed/errored) by the time
// this ran, so the caller can surface "job ini sudah tidak bisa dibatalkan."
export async function cancelPrintQueueJob(printQueueId: number): Promise<boolean>;

// Re-sequences every currently-Pending row's SortOrder to 10, 20, 30, ... in
// the given order. Rows not in `orderedIds` (e.g. one that left Pending in the
// race between the client reading the list and submitting the reorder) are
// left untouched — silently ignored, not an error.
export async function reorderPendingPrintQueue(orderedIds: number[]): Promise<void>;

// Looks up SalesInvoiceID/JadwalID from the given row and enqueues a brand
// new Pending job (IsManual = true) — the given row itself is never touched.
// Throws AppError if the row no longer exists.
export async function retryPrintQueueJob(printQueueId: number): Promise<void>;
```

### `src/lib/queries/print-format-settings.ts` — new file

```typescript
export interface PrintFormatSettings {
  showMitraAddress: boolean;
  showDriverName: boolean;
  showBankTransfer: boolean;
  showQrCode: boolean;
  showDisclaimer: boolean;
}

const PRINT_FORMAT_SETTINGS_FALLBACK: PrintFormatSettings = {
  showMitraAddress: true,
  showDriverName: true,
  showBankTransfer: true,
  showQrCode: true,
  showDisclaimer: true,
};

export async function getPrintFormatSettings(): Promise<PrintFormatSettings>; // TOP 1 ... ORDER BY ID, falls back to PRINT_FORMAT_SETTINGS_FALLBACK if the seeded row is ever somehow missing
export async function setPrintFormatSettings(input: PrintFormatSettings): Promise<void>; // UPDATE the single existing row (defensive INSERT fallback if missing), same shape as setSiteSettings
```

Exact mirror of `site-settings.ts`'s `getSiteSettings`/`setSiteSettings` shape (see that file for the reference implementation — `TOP 1 ... ORDER BY ID`, defensive INSERT-if-missing branch in the setter).

## 2. `receipt-builder.ts` — settings-aware

```typescript
export function buildReceiptBytes(data: ThermalReceiptData, settings: PrintFormatSettings): Uint8Array;
```

Each existing block gets wrapped in its corresponding toggle, no other structural change:
- `if (data.mitraAddress && settings.showMitraAddress) encoder.line(data.mitraAddress);`
- `if (settings.showDriverName) encoder.line(\`Driver: ${data.driverName ?? "-"}\`);` (folded out of the always-on `armadaNama`/`vehicleNo` line, which stays unconditional — vehicle identity isn't a toggle)
- `if (data.bankTransfer && settings.showBankTransfer) { ...existing block... }`
- `if (settings.showQrCode) { ...existing qrcode block... }`
- `if (settings.showDisclaimer) { ...existing two disclaimer lines... }`

`settings` is a required parameter (no default) — every caller must now pass it explicitly, so a caller that forgets can't silently print with stale/wrong defaults.

## 3. Callers of `buildReceiptBytes` — both need settings threaded in

- **`print-queue-poller.tsx`'s `drainQueue`**: fetch `getPrintFormatSettingsAction()` once, right after confirming `jobsResult.data.length > 0` and before the per-job loop, then pass the same `settings` value to every `buildReceiptBytes(dataResult.data, settings)` call in that batch.
- Nothing else calls `buildReceiptBytes` today (confirmed: sole call site is the poller).

## 4. Server actions (`src/app/mkesindo/(dashboard)/delivery/actions.ts`)

All gated with `requireModuleAccess("delivery")` first, matching every other action in this file:

```typescript
export async function getPrintQueueHistoryAction(filters: {
  dateFrom: string;
  dateTo: string;
  status?: PrintQueueHistoryRow["status"];
}): Promise<ActionResult<PrintQueueHistoryRow[]>>;

export async function cancelPrintQueueJobAction(printQueueId: number): Promise<ActionResult<void>>;
// AppError("Job ini sudah tidak bisa dibatalkan (statusnya sudah berubah).") if cancelPrintQueueJob returns false

export async function reorderPendingPrintQueueAction(orderedIds: number[]): Promise<ActionResult<void>>;

export async function retryPrintQueueJobAction(printQueueId: number): Promise<ActionResult<void>>;

export async function getPrintFormatSettingsAction(): Promise<ActionResult<PrintFormatSettings>>;
export async function setPrintFormatSettingsAction(input: PrintFormatSettings): Promise<ActionResult<void>>;
```

## 5. Pages and components

### `src/app/mkesindo/(dashboard)/delivery/cetak/page.tsx` — new

Server component: `requireModuleAccess("delivery")`, fetch today's `getPrintQueueHistory({ dateFrom: todayISO, dateTo: todayISO })` (business-date bound, same `getBusinessDateISO()` helper `/mkesindo/delivery` already uses) and `getPrintFormatSettings()`, render `<PrintManagementView initialHistory={...} initialSettings={...} businessDate={todayISO} />`.

### `src/components/dashboard/print-management-view.tsx` — new

Client component, two tabs (reusing the existing `Tabs`/`TabsList`/`TabsContent` primitives `pengiriman-tabs.tsx` already uses):

**Header (both tabs):** mounts `<PrintQueuePoller />` — same connect Bluetooth/USB controls and "Printer tersambung" badge as `/mkesindo/delivery`.

**Tab "Antrian Cetak":**
- Date range filter (default: today only) + status filter dropdown, calling `getPrintQueueHistoryAction` on change.
- Table: No. SI, Mitra, Armada (nama + plat), Tanggal Jadwal, Status (colored badge — Pending=slate, Printing=blue, Dicetak=green, Error=red, Dibatalkan=neutral strikethrough-style), Manual/Otomatis badge, Gagal (FailCount, only shown if > 0), Dibuat, Dicetak.
- Row actions: "Cetak Ulang" (any status) → `retryPrintQueueJobAction`, toast + `triggerPrintQueuePollNow()` on success, same pattern `route-validation-dialog.tsx`'s `handleReprint` already established. "Batalkan" (Pending only) → a plain `confirm("Batalkan cetak SI ini?")` guard (the codebase's established pattern for destructive-ish actions — see `mitra-list.tsx`'s `handleDelete`/`handleToggleActive`, no `AlertDialog` component exists in this project) before calling `cancelPrintQueueJobAction`.
- Drag-and-drop reorder (`@dnd-kit/sortable`, already a project dependency per `route-validation-dialog.tsx`'s stop-list reordering) — enabled only among the currently-Pending rows; on drop, calls `reorderPendingPrintQueueAction` with the new full ordering of Pending row IDs.

**Tab "Format SI":**
- 5 labeled `<input type="checkbox">` toggles (Alamat mitra, Nama driver, Blok transfer bank, QR code tagihan, Baris disclaimer) — the codebase's established checkbox pattern (see `payment-method-dialog.tsx`, `peran-editor.tsx`); no shadcn `Switch` component exists in this project.
- Live preview: a `<pre>`-rendered monospace box, fixed-width to emulate 32 columns, built from a small pure client-side function (`buildReceiptPreviewText(settings): string` — plain text, not ESC/POS bytes) fed by one representative hardcoded sample receipt (fake mitra/armada/line-items), re-rendered on every toggle flip with no server round-trip.
- "Simpan Pengaturan" button → `setPrintFormatSettingsAction`, toast on success/error.

### `/mkesindo/delivery/page.tsx` — one-line addition

Add a "Manajemen Cetak" `<Link>` button (Printer icon) next to `FilterBar` in the header row, pointing at `/mkesindo/delivery/cetak`.

## Out of scope

- Free-text/template editing of receipt content (rejected during brainstorming — toggle-only, see Decisions).
- Any change to the automatic Selesai Muat enqueue path or the manual per-stop reprint icon in `route-validation-dialog.tsx` — both keep calling `enqueuePrintJob`/`enqueueManualReprint` exactly as today; this design only adds a second, more complete surface for viewing/acting on the same underlying queue.
- Retrying an `Error` job past its original 3-attempt `FailCount` cap does **not** reset that row's `FailCount` — it's a new row starting at 0, so it gets its own fresh 3 attempts independent of the original's history.
