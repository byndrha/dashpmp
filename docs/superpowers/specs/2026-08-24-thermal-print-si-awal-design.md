# Thermal-printed SI Awal on /mkesindo/delivery

## Context

`selesaiMuat()` (`src/lib/queries/pengiriman-jadwal.ts`) already creates a real `SalesInvoice` per stop the moment a Kartu Pengiriman finishes loading — before the armada actually departs. This design adds automatic thermal-printer output for those invoices at that exact moment, so the mitra/driver walks away with a paper "SI Awal" (preliminary invoice) before the truck leaves the yard. The printed amount is expected to drift from reality afterward (retur, non-delivery) — that's an accepted, explicit property of an SI Awal, not a bug to fix.

`selesaiMuat()` is called from two independent surfaces that can run on two different physical devices:
- **produksi-app** (the primary path — a warehouse/loading-dock operator's device)
- **Desktop `/mkesindo/delivery`'s own "Selesai Muat" button** (the fallback path)

The thermal printer (Iware C5813 — USB + Bluetooth only, no Wi-Fi/LAN) is physically connected to exactly one machine: whichever device the Operasional staff has `/mkesindo/delivery` open on. So a Selesai Muat triggered from produksi-app must still result in a print job executing on the *Operasional staff's* browser session, not on produksi-app's own device.

## Decisions made during brainstorming

- **Platform scope is Android Chrome + Desktop Chromium (Windows/Mac/Linux) only.** iOS/Safari (WebKit) has never implemented Web Bluetooth or WebUSB and cannot be worked around from a web app — supporting it would require a completely separate native iOS app (CoreBluetooth), which is out of scope. The Operasional print station must run one of the supported platforms, not an iPad.
- **No local bridge/agent software (e.g. QZ Tray).** Because the supported platforms (Android Chrome, desktop Chromium) both support Web Bluetooth and WebUSB natively, printing goes directly browser-to-printer. A bridge is unnecessary complexity for the platforms actually in scope.
- **Selesai Muat prints every stop's SI unconditionally** — no per-stop selection. The existing `printSelected` checkbox UI and "Cetak SI Terpilih (N)" button in `route-validation-dialog.tsx` (which currently just `window.open()`s the public invoice page per checked stop) are removed entirely.
- **Cross-device triggering is solved with a DB-backed print queue, not real-time push.** `selesaiMuat()` itself enqueues one row per newly-created SalesInvoice — since both produksi-app and desktop call the same shared function, this covers both triggers with zero duplicated logic. A poller running on `/mkesindo/delivery` (wherever the printer is actually connected) drains the queue. This matches the codebase's existing polling conventions (satpam-app's 30s board poll, driver GPS 10s poll) rather than introducing new realtime infrastructure (WebSocket/SSE).
- **5-second gap between each physical print within a batch** — enough time for the operator to tear off the previous receipt before the next one starts printing. This is a hard sequential delay in the poller's drain loop, not a poll interval.
- **A manual per-stop "Cetak" icon replaces the old bulk-select checkbox.** Clicked any time after Selesai Muat (e.g. a quantity was corrected right before Berangkat), it enqueues one more queue row for that stop's *current* SalesInvoice data — reusing the exact same queue+poller pipeline, so there is only one print code path, not two.
- **The receipt is a purpose-built thermal template, not a print of the existing public invoice page.** It reuses the same underlying invoice/delivery data `getInvoiceByToken` already gathers, but is not literally that HTML page — a thermal printer speaks ESC/POS, not HTML/CSS. Content also differs deliberately: adds ArmadaNama + plat + Driver, omits "Tagihan Lain yang Masih Berjalan" entirely (never fetched for this path), and always ends with an "SI Awal" disclaimer line.
- **QRIS is represented as a scannable link to the live public invoice page (`/mkesindo/invoice/{token}`), not a printed static QRIS image.** A statically-printed QRIS amount would go stale the moment retur/non-delivery adjusts the invoice's real Netto after departure; the public page always reflects the live amount. The printer's native QR-code command (`GS ( k`, supported by essentially every ESC/POS-compatible printer including budget clones) encodes that URL — no image rasterization needed.
- **Bank transfer details are printed as plain text, sourced from a new field on the existing Metode Pembayaran system** (not hardcoded, not a new standalone config) — `metode_pembayaran` gets `bank_nama`/`nomor_rekening`/`atas_nama` columns, relevant when `metode = 'TRANSFER'`, editable from the same admin screen that already manages QRIS.
- **No reprint after driver-confirmed adjustments.** Once departed, the SI Awal is final as printed — the manual reprint icon exists for pre-Berangkat corrections only (nothing technically prevents using it later, but that's not a designed workflow).
- **`esc-pos-encoder` (npm) builds the ESC/POS byte payload** — a small, dependency-free, browser-safe library purpose-built for exactly this Web Bluetooth/WebUSB thermal-printing scenario, instead of hand-rolling command bytes.

## Data model

### New MSSQL table: `DashboardPrintQueue`

```sql
CREATE TABLE DashboardPrintQueue (
  PrintQueueID    INT IDENTITY PRIMARY KEY,
  SalesInvoiceID  VARCHAR(16) NOT NULL,
  JadwalID        INT NOT NULL,
  IsManual        BIT NOT NULL DEFAULT 0,   -- 0 = automatic Selesai Muat batch, 1 = manual reprint icon
  Status          VARCHAR(20) NOT NULL DEFAULT 'Pending', -- 'Pending' | 'Dicetak'
  CreatedAt       DATETIME NOT NULL DEFAULT GETDATE(),
  PrintedAt       DATETIME NULL
)
```

No `'Gagal'` status: a send failure simply leaves the row `'Pending'` and stops that drain cycle early (see Poller below) — the next poll tick retries automatically once the printer issue (paper out, disconnected, etc.) is resolved. This also means the manual reprint icon and the automatic batch are indistinguishable to the poller except for `IsManual` (kept only for an eventual "Riwayat Cetak" audit view — not otherwise load-bearing in this design).

### `selesaiMuat()` enqueues on success

Inside `selesaiMuat()` (`pengiriman-jadwal.ts`), for every stop where a *new* SalesInvoice is actually created (i.e., every iteration of the per-detail loop that does NOT hit the `if (detail.DeliveryOrderID) { ...; continue; }` merged-external-DO branch — that branch never creates a new invoice, so nothing to print), insert one `DashboardPrintQueue` row with that `SalesInvoiceID` + the Jadwal's `JadwalID`, in the same transaction. This is the single enqueue point both produksi-app's and desktop's Selesai Muat share.

### Extended Postgres table: `metode_pembayaran`

Add nullable columns: `bank_nama VARCHAR`, `nomor_rekening VARCHAR`, `atas_nama VARCHAR`. Populated/relevant only when `metode = 'TRANSFER'` — `MetodePembayaranRow`/`UpsertMetodePembayaranInput` (`src/lib/queries/metode-pembayaran.ts`) and the existing Metode Pembayaran admin form both gain these three fields, shown conditionally when `metode === "TRANSFER"` (mirroring how `qrisStatisImagePath` is already conditional on `jenis === "qris_static"`).

## 1. Printer connection module (`src/lib/thermal-printer/`)

A small client-only module exposing one uniform connection type regardless of transport:

```typescript
interface ThermalPrinterConnection {
  send(bytes: Uint8Array): Promise<void>;
  disconnect(): void;
}

function connectViaBluetooth(): Promise<ThermalPrinterConnection>; // navigator.bluetooth.requestDevice + GATT write
function connectViaUsb(): Promise<ThermalPrinterConnection>;       // navigator.usb.requestDevice + transferOut
function reconnectPersisted(): Promise<ThermalPrinterConnection | null>; // navigator.bluetooth.getDevices() / navigator.usb.getDevices() — previously-authorized devices only, no new permission prompt
```

A React hook (`usePrinterConnection()`) wraps this with connection state (`disconnected | connecting | connected`) for both the poller and a small "Pengaturan Printer" control (connect via USB / connect via Bluetooth / disconnect) surfaced on `/mkesindo/delivery`.

## 2. Receipt content (`src/lib/queries/thermal-receipt.ts` + `src/lib/thermal-printer/receipt-builder.ts`)

`getThermalReceiptData(salesInvoiceId): Promise<ThermalReceiptData>` — a fresh, purpose-built query (not a reuse of `getInvoiceByToken`, though it shares the same underlying joins) gathering:
- Mitra name + address
- SI VoucherNo + TransDate
- ArmadaNama, plat (VehicleNo), Driver name
- Line items (name, qty, price, subtotal) + total (Netto)
- `invoiceToken` (`encodeInvoiceToken`, already exists) for the QR-to-public-page link
- The perusahaan's active `TRANSFER` Metode Pembayaran row (bank_nama/nomor_rekening/atas_nama), konteks `"publik"` — reused as-is, no new konteks value
- A fixed disclaimer string: "SI Awal — nominal dapat berubah sesuai kondisi pengiriman di lapangan"

`buildReceiptBytes(data: ThermalReceiptData): Uint8Array` (via `esc-pos-encoder`) renders this into the actual print job: header, mitra/SI/armada/driver block, item lines, total, QR code (native command, encoding the public invoice URL), bank transfer text block, disclaimer, cut.

## 3. The poller (`/mkesindo/delivery`)

A single always-mounted client component (top-level on the delivery page, not inside `RouteValidationDialog` — it must keep draining the queue no matter which Jadwal's dialog is open, or none):

- Every ~4 seconds, calls `getPendingPrintQueueAction()` (returns pending `DashboardPrintQueue` rows, oldest first).
- If the printer isn't connected, does nothing but keeps polling (jobs simply accumulate as `'Pending'`) — a persistent small banner invites the operator to connect.
- If connected and jobs exist, drains them **sequentially**, not in parallel: fetch that row's `ThermalReceiptData` → build bytes → `send()` → mark `'Dicetak'` with `PrintedAt` → wait 5000ms → next row.
- A send failure stops the current drain cycle immediately (does not mark that row `'Dicetak'`, does not advance to the next row) and surfaces a toast error — the next poll tick will retry the same still-`'Pending'` row.
- A ref-based in-flight guard prevents two overlapping poll ticks from both starting a drain cycle.

## 4. Manual reprint icon

In `route-validation-dialog.tsx`'s per-stop row rendering, a small printer icon appears next to any stop that already has a `SalesInvoiceID` (i.e., Selesai Muat has already run for it). Clicking it calls `enqueueManualReprintAction(salesInvoiceId, jadwalId)` — one more `DashboardPrintQueue` row (`IsManual = 1`), picked up by the same poller above. No separate print code path.

## 5. Removed: `printSelected` / "Cetak SI Terpilih"

`printSelected` state, its per-row checkbox, the "Cetak SI Terpilih (N)" button, and the `window.open(...)` loop inside `doSaveDriverTimeThenSelesaiMuat` (`route-validation-dialog.tsx`) are deleted — printing is now unconditional and queue-driven, nothing left for the Selesai Muat success handler itself to do about printing.

## Global constraints

- Android Chrome and desktop Chromium (Windows/Mac/Linux) only — no iOS/Safari support, no local bridge software.
- `selesaiMuat()` is the single enqueue point — never enqueue from `produksiStartMuat`/`produksiSelesaiMuatAction`/`selesaiMuatAction` wrappers directly, so produksi-app and desktop automatically stay in sync with zero duplicated logic.
- The 5-second gap is strictly between consecutive *successful* prints in one drain cycle — a failure stops the cycle rather than skipping ahead.
- No automatic reprint when a delivered stop's SalesInvoice amount later changes via `confirmStopDelivery`'s retur adjustment — the manual reprint icon is the only path to an updated printout, and only meaningfully useful before Berangkat.
- The printer connection is a per-browser/per-device authorization (`navigator.bluetooth`/`navigator.usb` permission persistence) — `reconnectPersisted()` runs on page load to silently restore a previously-authorized device without a new user-gesture prompt; a first-time connection always requires an explicit "Hubungkan Printer" click (browser security requirement, not something this design can skip).
