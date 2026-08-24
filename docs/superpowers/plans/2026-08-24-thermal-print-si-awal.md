# Thermal-printed SI Awal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stop's SalesInvoice created by `selesaiMuat()` (from either produksi-app or desktop's own "Selesai Muat") is automatically printed as a thermal "SI Awal" receipt on `/mkesindo/delivery`'s connected printer, with a 5-second gap between each stop, plus a manual per-stop reprint icon — using Web Bluetooth/WebUSB directly from the browser (Android Chrome + desktop Chromium only).

**Architecture:** `selesaiMuat()` enqueues one `DashboardPrintQueue` row per newly-created SalesInvoice (the single shared enqueue point for both produksi-app and desktop triggers). A poller mounted at the top of `/mkesindo/delivery` drains that queue sequentially — 5s gap between prints — through a Web Bluetooth/WebUSB connection held in that browser tab. Receipt content is built fresh from SalesInvoice/Delivery/Mitra data (not a reuse of the public invoice HTML page) via `esc-pos-encoder`, and includes a native ESC/POS QR code linking to the existing public invoice page (`/mkesindo/invoice/{token}`) instead of a printed static QRIS image, plus bank-transfer text sourced from new fields on the existing Metode Pembayaran system.

**Tech Stack:** Next.js server actions, `mssql` (MKEsindo ERP DB) for the print queue, Postgres (`pg`) for the Metode Pembayaran bank fields, `esc-pos-encoder` (new npm dependency) for ESC/POS byte generation, Web Bluetooth API (`navigator.bluetooth`) and WebUSB API (`navigator.usb`) for printer connectivity.

**Spec:** `docs/superpowers/specs/2026-08-24-thermal-print-si-awal-design.md`

## Global Constraints

- Android Chrome and desktop Chromium (Windows/Mac/Linux) only — no iOS/Safari support, no local bridge software (QZ Tray or equivalent) anywhere in this plan.
- `selesaiMuat()` (`src/lib/queries/pengiriman-jadwal.ts`) is the **single** enqueue point for automatic print jobs — never enqueue from `produksiStartMuat`/`produksiSelesaiMuatAction`/`selesaiMuatAction` wrappers directly. This is what makes produksi-app and desktop triggers stay in sync with zero duplicated logic.
- The 5-second gap applies strictly between consecutive **successful** prints within one drain cycle. A send failure stops that cycle immediately (does not mark the row `'Dicetak'`, does not advance to the next row) — the next poll tick retries the same row.
- No automatic reprint when a delivered stop's SalesInvoice amount later changes via `confirmStopDelivery`'s retur adjustment. The manual reprint icon is the only path to an updated printout.
- The printer connection is a per-browser/per-device authorization — reconnect silently on page load via `navigator.bluetooth.getDevices()`/`navigator.usb.getDevices()` (previously-authorized devices only, no new permission prompt); a first-time connection always requires an explicit user-gesture click (browser security requirement).
- `DashboardPrintQueue` rows are never enqueued for a stop whose `selesaiMuat()` branch hit the merged-external-DO `continue` case (no new SalesInvoice created there — nothing to print).

---

### Task 1: MSSQL schema — `DashboardPrintQueue`

**Files:**
- Create: `scripts/create-print-queue-table.ts`

**Interfaces:**
- Produces: one new table, read/written by every later task.

- [ ] **Step 1: Write the migration script**

Mirrors `scripts/create-driver-status-tables.ts`'s exact shape (this app's own `getPool()`, MSSQL's `IF NOT EXISTS (SELECT * FROM sysobjects ...)` idiom).

```typescript
// One-off schema creation for the thermal-print job queue
// (DashboardPrintQueue) — idempotent, safe to re-run.
// Usage: npx tsx scripts/create-print-queue-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPrintQueue' AND xtype='U')
    CREATE TABLE DashboardPrintQueue (
      PrintQueueID    INT IDENTITY PRIMARY KEY,
      SalesInvoiceID  VARCHAR(16) NOT NULL,
      JadwalID        INT NOT NULL,
      IsManual        BIT NOT NULL DEFAULT 0,
      Status          VARCHAR(20) NOT NULL DEFAULT 'Pending',
      CreatedAt       DATETIME NOT NULL DEFAULT GETDATE(),
      PrintedAt       DATETIME NULL
    )
  `);

  console.log("DashboardPrintQueue ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/create-print-queue-table.ts`
Expected: `DashboardPrintQueue ready.`

- [ ] **Step 3: Verify and re-run for idempotency**

Write a throwaway script querying `SELECT TOP 1 * FROM DashboardPrintQueue` via `getPool()` — must succeed without "invalid object name". Delete the throwaway script afterward. Re-run the real migration script once more — expect it to succeed silently.

- [ ] **Step 4: Commit**

```bash
git add scripts/create-print-queue-table.ts
git commit -m "feat: add DashboardPrintQueue table for thermal SI Awal printing"
```

---

### Task 2: Postgres schema — Metode Pembayaran bank-transfer fields

**Files:**
- Create: `scripts/add-metode-pembayaran-rekening-columns.ts`

**Interfaces:**
- Produces: three new nullable columns on `metode_pembayaran`, read/written by Task 6 and Task 14.

- [ ] **Step 1: Write the migration script**

```typescript
// One-off column addition: bank-transfer detail fields on
// metode_pembayaran, relevant when metode = 'TRANSFER'. Idempotent.
// Usage: npx tsx scripts/add-metode-pembayaran-rekening-columns.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pool = getPgPool();
  await pool.query(`
    ALTER TABLE metode_pembayaran
      ADD COLUMN IF NOT EXISTS bank_nama VARCHAR,
      ADD COLUMN IF NOT EXISTS nomor_rekening VARCHAR,
      ADD COLUMN IF NOT EXISTS atas_nama VARCHAR
  `);
  console.log("metode_pembayaran bank-transfer columns ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/add-metode-pembayaran-rekening-columns.ts`
Expected: `metode_pembayaran bank-transfer columns ready.`

- [ ] **Step 3: Verify and re-run for idempotency**

Write a throwaway script: `SELECT bank_nama, nomor_rekening, atas_nama FROM metode_pembayaran LIMIT 1` via `getPgPool()` — must succeed (even against an empty table) without "column does not exist". Delete the throwaway script. Re-run the real migration once more — expect silent success (Postgres's `ADD COLUMN IF NOT EXISTS` is a true no-op on the second run).

- [ ] **Step 4: Commit**

```bash
git add scripts/add-metode-pembayaran-rekening-columns.ts
git commit -m "feat: add bank-transfer detail columns to metode_pembayaran"
```

---

### Task 3: Query layer — print queue

**Files:**
- Create: `src/lib/queries/print-queue.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `enqueuePrintJob(pool: PoolOrTransaction, salesInvoiceId: string, jadwalId: number, isManual: boolean): Promise<void>`
  - `interface PendingPrintJob { printQueueId: number; salesInvoiceId: string; jadwalId: number }`
  - `getPendingPrintQueue(): Promise<PendingPrintJob[]>`
  - `markPrintQueueDone(printQueueId: number): Promise<void>`
  - `enqueueManualReprint(jadwalDetailId: number): Promise<void>` (throws `AppError` if the stop has no SalesInvoice yet)

- [ ] **Step 1: Write the file**

```typescript
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

// Widened type so this can be called from inside selesaiMuat()'s own
// sql.Transaction (Task 4) as well as standalone — same PoolOrTransaction
// pattern already established in pengiriman-jadwal.ts for its own
// transaction-spanning helpers.
type PoolOrTransaction = sql.ConnectionPool | sql.Transaction;

// Never enqueued for a stop that hit selesaiMuat()'s merged-external-DO
// `continue` branch — that branch creates no new SalesInvoice, so callers
// simply never invoke this for it (see Task 4).
export async function enqueuePrintJob(
  pool: PoolOrTransaction,
  salesInvoiceId: string,
  jadwalId: number,
  isManual: boolean
): Promise<void> {
  await pool
    .request()
    .input("salesInvoiceId", sql.VarChar(16), salesInvoiceId)
    .input("jadwalId", sql.Int, jadwalId)
    .input("isManual", sql.Bit, isManual)
    .query(
      `INSERT INTO DashboardPrintQueue (SalesInvoiceID, JadwalID, IsManual) VALUES (@salesInvoiceId, @jadwalId, @isManual)`
    );
}

export interface PendingPrintJob {
  printQueueId: number;
  salesInvoiceId: string;
  jadwalId: number;
}

// Oldest first — a batch enqueued together (one Selesai Muat with several
// stops) prints in the same order the stops were created.
export async function getPendingPrintQueue(): Promise<PendingPrintJob[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PrintQueueID, SalesInvoiceID, JadwalID
    FROM DashboardPrintQueue
    WHERE Status = 'Pending'
    ORDER BY CreatedAt
  `);
  return (result.recordset as { PrintQueueID: number; SalesInvoiceID: string; JadwalID: number }[]).map((r) => ({
    printQueueId: r.PrintQueueID,
    salesInvoiceId: r.SalesInvoiceID,
    jadwalId: r.JadwalID,
  }));
}

export async function markPrintQueueDone(printQueueId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, printQueueId)
    .query(`UPDATE DashboardPrintQueue SET Status = 'Dicetak', PrintedAt = GETDATE() WHERE PrintQueueID = @id`);
}

// The manual "Cetak" icon's entry point — looks up the stop's own
// SalesInvoiceID/JadwalID server-side rather than trusting a client-supplied
// SalesInvoiceID, then enqueues exactly like the automatic path (IsManual=1
// is the only difference), so there is one drain code path, not two.
export async function enqueueManualReprint(jadwalDetailId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .query(
      `SELECT SalesInvoiceID, JadwalID FROM DashboardPengirimanJadwalDetail WHERE JadwalDetailID = @id AND IsDeleted = 0`
    );
  const row = result.recordset[0] as { SalesInvoiceID: string | null; JadwalID: number } | undefined;
  if (!row) throw new AppError("Tujuan ini tidak ditemukan.");
  if (!row.SalesInvoiceID) throw new AppError("SI untuk tujuan ini belum terbit — jalankan Selesai Muat terlebih dahulu.");
  await enqueuePrintJob(pool, row.SalesInvoiceID.replace(/'/g, "").trim(), row.JadwalID, true);
}
```

Note the `.replace(/'/g, "").trim()` on `SalesInvoiceID` here mirrors the exact same literal-quote-character quirk `invoice-public.ts`'s `getInvoiceByToken` already works around for `DeliveryOrderID` — confirm live whether `DashboardPengirimanJadwalDetail.SalesInvoiceID` has the same quoting quirk before removing this defensive strip (if it turns out clean, the `.replace()` is a harmless no-op either way).

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/lib/queries/print-queue.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/print-queue.ts
git commit -m "feat: add print queue query layer"
```

---

### Task 4: Wire enqueue into `selesaiMuat()`

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Consumes: `enqueuePrintJob` (Task 3).

- [ ] **Step 1: Read the current per-detail loop**

Read `src/lib/queries/pengiriman-jadwal.ts` around the `for (const detail of detailRows)` loop inside `selesaiMuat()` (currently ends around the line that does `invoiceTokens.push({ jadwalDetailId: detail.JadwalDetailID, invoiceToken: encodeInvoiceToken(salesInvoiceId) });`, right before the loop's closing brace) — this exact line marks a *newly created* SalesInvoice, which is the only case that should enqueue a print job. The merged-external-DO branch above it (`if (detail.DeliveryOrderID) { ...; continue; }`) already `continue`s past this point, so it naturally never reaches the new enqueue call either — no extra guard needed.

- [ ] **Step 2: Add the import and the enqueue call**

```typescript
// Add to the existing import block at the top of the file:
import { enqueuePrintJob } from "@/lib/queries/print-queue";
```

Immediately after the existing line inside the loop:

```typescript
      invoiceTokens.push({ jadwalDetailId: detail.JadwalDetailID, invoiceToken: encodeInvoiceToken(salesInvoiceId) });
```

add:

```typescript
      // Single shared enqueue point for BOTH produksi-app's and desktop's
      // Selesai Muat — see Global Constraints in the thermal-print plan.
      // transaction (not pool) so this insert commits/rolls back atomically
      // with the SalesInvoice it belongs to.
      await enqueuePrintJob(transaction, salesInvoiceId, jadwalId, false);
```

`transaction` and `jadwalId` are already in scope inside this function (the same `sql.Transaction` and parameter `selesaiMuat(jadwalId: number)` this loop already runs under).

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/lib/queries/pengiriman-jadwal.ts`.

- [ ] **Step 4: Manual smoke test**

Using a real Draft Jadwal with a Driver already assigned and a fully geocoded route (see `assertJadwalReadyForMuat` from the earlier produksi-app fix), call `selesaiMuat(jadwalId)` directly via a throwaway script. Confirm via a direct query that `DashboardPrintQueue` now has one `'Pending'` row per stop that got a new SalesInvoice, with matching `JadwalID`. Clean up: this is a real Selesai Muat transition (not reversible via a simple DELETE) — only run this against a test/disposable Jadwal, and coordinate with the user before running it against anything real. Delete the throwaway script afterward.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "feat: enqueue a print job for every SI selesaiMuat creates"
```

---

### Task 5: Query layer — thermal receipt data

**Files:**
- Create: `src/lib/queries/thermal-receipt.ts`

**Interfaces:**
- Consumes: `getMkesindoPerusahaanId` (`@/lib/queries/perusahaan`), `listActiveMetodePembayaran` (`@/lib/queries/metode-pembayaran`, extended in Task 6), `encodeInvoiceToken` (`@/lib/queries/invoice-public`).
- Produces:
  - `interface ThermalReceiptLine { name: string; qty: number; amount: number }`
  - `interface ThermalReceiptBankTransfer { bankNama: string; nomorRekening: string; atasNama: string }`
  - `interface ThermalReceiptData { mitraName: string; mitraAddress: string | null; voucherNo: string; transDate: string; armadaNama: string; vehicleNo: string | null; driverName: string | null; lines: ThermalReceiptLine[]; total: number; invoiceUrl: string; bankTransfer: ThermalReceiptBankTransfer | null }`
  - `getThermalReceiptData(salesInvoiceId: string): Promise<ThermalReceiptData>`

- [ ] **Step 1: Write the file**

```typescript
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";
import { listActiveMetodePembayaran } from "@/lib/queries/metode-pembayaran";
import { encodeInvoiceToken } from "@/lib/queries/invoice-public";

export interface ThermalReceiptLine {
  name: string;
  qty: number;
  amount: number;
}

export interface ThermalReceiptBankTransfer {
  bankNama: string;
  nomorRekening: string;
  atasNama: string;
}

export interface ThermalReceiptData {
  mitraName: string;
  mitraAddress: string | null;
  voucherNo: string;
  transDate: string;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  lines: ThermalReceiptLine[];
  total: number;
  // Absolute URL to the existing public invoice page — printed as a native
  // ESC/POS QR code rather than a rasterized image, so the printer never
  // needs to render a bitmap. See the design spec's own reasoning: a
  // printed-at-departure static QRIS amount would go stale the moment
  // retur/non-delivery adjusts the real Netto after departure, but this
  // link always resolves to the live page.
  invoiceUrl: string;
  // Null when no active TRANSFER method with bank details is configured —
  // the receipt builder (Task 9) simply omits that block in that case.
  bankTransfer: ThermalReceiptBankTransfer | null;
}

// Deliberately its own query, not a reuse of invoice-public.ts's
// getInvoiceByToken — a thermal receipt is a different document (adds
// Armada/plat/Driver, omits "Tagihan Lain yang Masih Berjalan" entirely,
// never fetches it) even though both read from the same underlying tables.
export async function getThermalReceiptData(salesInvoiceId: string): Promise<ThermalReceiptData> {
  const pool = await getPool();

  const headerResult = await pool
    .request()
    .input("id", sql.VarChar(16), salesInvoiceId).query(`
      SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate, si.Netto, si.DeliveryOrderID,
             bp.Name AS MitraName, bp.Address AS MitraAddress
      FROM SalesInvoice si
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
      WHERE si.SalesInvoiceID = @id AND si.IsDeleted = 0
    `);
  const header = headerResult.recordset[0] as
    | {
        SalesInvoiceID: string;
        VoucherNo: string;
        TransDate: Date;
        Netto: number;
        DeliveryOrderID: string | null;
        MitraName: string;
        MitraAddress: string | null;
      }
    | undefined;
  if (!header) throw new AppError("SalesInvoice tidak ditemukan.");

  // Same literal-quote-character quirk as invoice-public.ts's
  // getInvoiceByToken — SalesInvoice.DeliveryOrderID is stored wrapped in
  // single quotes (e.g. "'01185115'").
  const deliveryOrderId = header.DeliveryOrderID ? header.DeliveryOrderID.replace(/'/g, "").trim() || null : null;

  const linesResult = await pool
    .request()
    .input("id", sql.VarChar(16), salesInvoiceId)
    .query(`SELECT Name, Qty, Amount FROM SalesInvoiceDetail WHERE SalesInvoiceID = @id ORDER BY SalesInvoiceDetailID`);
  const lines = (linesResult.recordset as { Name: string; Qty: number; Amount: number }[]).map((l) => ({
    name: l.Name,
    qty: l.Qty,
    amount: l.Amount,
  }));

  let armadaNama = "";
  let vehicleNo: string | null = null;
  let driverName: string | null = null;
  if (deliveryOrderId) {
    const deliveryResult = await pool
      .request()
      .input("doId", sql.VarChar(16), deliveryOrderId).query(`
        SELECT a.Nama AS ArmadaNama, do_.VehicleNo, sm.Name AS DriverName
        FROM DeliveryOrder do_
        LEFT JOIN DashboardPengirimanJadwalDetail jadd ON jadd.DeliveryOrderID = do_.DeliveryOrderID AND jadd.IsDeleted = 0
        LEFT JOIN DashboardPengirimanJadwal jad ON jad.JadwalID = jadd.JadwalID
        LEFT JOIN DashboardArmada a ON a.ArmadaID = jad.ArmadaID
        LEFT JOIN Salesman sm ON sm.SalesmanID = jad.SalesmanID
        WHERE do_.DeliveryOrderID = @doId AND do_.IsDeleted = 0
      `);
    const deliveryRow = deliveryResult.recordset[0] as
      | { ArmadaNama: string | null; VehicleNo: string | null; DriverName: string | null }
      | undefined;
    armadaNama = deliveryRow?.ArmadaNama ?? "";
    vehicleNo = deliveryRow?.VehicleNo ?? null;
    driverName = deliveryRow?.DriverName ?? null;
  }

  const perusahaanId = await getMkesindoPerusahaanId();
  const transferMethods = await listActiveMetodePembayaran(perusahaanId, "publik");
  const transferRow = transferMethods.find((m) => m.metode === "TRANSFER" && m.nomorRekening);
  const bankTransfer: ThermalReceiptBankTransfer | null = transferRow
    ? {
        bankNama: transferRow.bankNama ?? "",
        nomorRekening: transferRow.nomorRekening ?? "",
        atasNama: transferRow.atasNama ?? "",
      }
    : null;

  return {
    mitraName: header.MitraName,
    mitraAddress: header.MitraAddress,
    voucherNo: header.VoucherNo,
    transDate: header.TransDate.toISOString(),
    armadaNama,
    vehicleNo,
    driverName,
    lines,
    total: header.Netto,
    invoiceUrl: `${process.env.NEXTAUTH_URL ?? ""}/mkesindo/invoice/${encodeInvoiceToken(salesInvoiceId)}`,
    bankTransfer,
  };
}
```

Read `src/lib/queries/perusahaan.ts` first to confirm `getMkesindoPerusahaanId`'s exact export name/signature, and check an existing server-side usage of `process.env.NEXTAUTH_URL` (or whichever env var already holds this app's own base URL — grep `NEXTAUTH_URL` or `NEXT_PUBLIC_APP_URL` across the codebase) so `invoiceUrl` resolves to a real absolute URL a phone can actually open when scanned, not a relative path.

- [ ] **Step 2: Extend `MetodePembayaranRow`'s bank fields (depends on Task 6)**

This file's `transferRow.bankNama`/`nomorRekening`/`atasNama` references require Task 6's `MetodePembayaranRow` extension to already exist — if working through tasks in order, Task 6 must land before this compiles cleanly. (If executed out of order, this step will show a type error on those three fields until Task 6 is done.)

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/lib/queries/thermal-receipt.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/thermal-receipt.ts
git commit -m "feat: add thermal receipt data query"
```

---

### Task 6: Extend Metode Pembayaran with bank-transfer fields

**Files:**
- Modify: `src/lib/queries/metode-pembayaran.ts`

**Interfaces:**
- Produces: `MetodePembayaranRow` gains `bankNama: string | null`, `nomorRekening: string | null`, `atasNama: string | null`. `UpsertMetodePembayaranInput` gains the same three (optional on input, defaulting to `null`).

- [ ] **Step 1: Extend the row interface and mapper**

```typescript
// MetodePembayaranRow — add after qrisStatisImagePath:
  qrisStatisImagePath: string | null;
  // Only meaningful when metode === "TRANSFER" — null for TUNAI/QRIS rows.
  bankNama: string | null;
  nomorRekening: string | null;
  atasNama: string | null;
  urutan: number;
  isActive: boolean;
```

```typescript
// MetodePembayaranDbRow — add after qris_statis_image_path:
  qris_statis_image_path: string | null;
  bank_nama: string | null;
  nomor_rekening: string | null;
  atas_nama: string | null;
  urutan: number;
  is_active: boolean;
```

```typescript
// mapRow() — add after qrisStatisImagePath:
    qrisStatisImagePath: r.qris_statis_image_path,
    bankNama: r.bank_nama,
    nomorRekening: r.nomor_rekening,
    atasNama: r.atas_nama,
    urutan: r.urutan,
    isActive: r.is_active,
```

```typescript
// SELECT_COLUMNS — append the three new columns:
const SELECT_COLUMNS = `id, perusahaan_id, kode, metode, jenis, coa_id, konteks, wajib_catatan, catatan, qris_statis_image_path, bank_nama, nomor_rekening, atas_nama, urutan, is_active`;
```

- [ ] **Step 2: Extend `UpsertMetodePembayaranInput` and `upsertMetodePembayaran`**

```typescript
// UpsertMetodePembayaranInput — add after catatan:
  catatan: string | null;
  bankNama: string | null;
  nomorRekening: string | null;
  atasNama: string | null;
  urutan: number;
```

Update `upsertMetodePembayaran`'s two SQL statements (UPDATE and INSERT) to include the three new columns/params, following the exact same positional-parameter style already used there:

```typescript
export async function upsertMetodePembayaran(input: UpsertMetodePembayaranInput): Promise<number> {
  if (input.jenis === "qris_dinamis" && input.isActive) {
    const hasCreds = await hasSnapBiKredensial(input.perusahaanId);
    if (!hasCreds) {
      throw new AppError("QRIS Dinamis tidak bisa diaktifkan sebelum kredensial Snap BI PT ini diisi lengkap.");
    }
  }

  const pool = getPgPool();
  if (input.id) {
    await pool.query(
      `UPDATE metode_pembayaran SET
         kode = $1, metode = $2, jenis = $3, coa_id = $4, konteks = $5,
         wajib_catatan = $6, catatan = $7, bank_nama = $8, nomor_rekening = $9, atas_nama = $10,
         urutan = $11, is_active = $12, updated_at = now()
       WHERE id = $13 AND perusahaan_id = $14`,
      [
        input.kode, input.metode, input.jenis, input.coaId, input.konteks,
        input.wajibCatatan, input.catatan, input.bankNama, input.nomorRekening, input.atasNama,
        input.urutan, input.isActive, input.id, input.perusahaanId,
      ]
    );
    return input.id;
  }

  const result = await pool.query<{ id: number }>(
    `INSERT INTO metode_pembayaran
       (perusahaan_id, kode, metode, jenis, coa_id, konteks, wajib_catatan, catatan, bank_nama, nomor_rekening, atas_nama, urutan, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      input.perusahaanId, input.kode, input.metode, input.jenis, input.coaId, input.konteks,
      input.wajibCatatan, input.catatan, input.bankNama, input.nomorRekening, input.atasNama,
      input.urutan, input.isActive,
    ]
  );
  return result.rows[0].id;
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) — expect a pre-existing-caller error at `payment-method-dialog.tsx`'s `emptyRowForm`/`rowToFormInput` (Task 14 fixes those) and NOT anywhere else. Run `npx eslint src/lib/queries/metode-pembayaran.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/metode-pembayaran.ts
git commit -m "feat: add bank-transfer fields to Metode Pembayaran"
```

---

### Task 7: Delivery server actions

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: `getPendingPrintQueue`, `markPrintQueueDone`, `enqueueManualReprint` (Task 3), `getThermalReceiptData` (Task 5).
- Produces: `getPendingPrintQueueAction()`, `markPrintQueueDoneAction(printQueueId)`, `enqueueManualReprintAction(jadwalDetailId)`, `getThermalReceiptDataAction(salesInvoiceId)`.

- [ ] **Step 1: Read the existing import block and requireXxx guard already used in this file**

Run: `grep -n "^import\|requireGrupAccess\|export async function" "src/app/mkesindo/(dashboard)/delivery/actions.ts" | head -40` to confirm this file's existing access-check convention (this is the authenticated desktop dashboard's own actions file — every action here already runs behind whatever layout-level auth guard `/mkesindo/(dashboard)` enforces, so no extra per-action role check is needed for these four, matching the file's existing read/write actions like `selesaiMuatAction` itself).

- [ ] **Step 2: Add the four actions**

```typescript
import { getPendingPrintQueue, markPrintQueueDone, enqueueManualReprint, type PendingPrintJob } from "@/lib/queries/print-queue";
import { getThermalReceiptData, type ThermalReceiptData } from "@/lib/queries/thermal-receipt";

export async function getPendingPrintQueueAction(): Promise<ActionResult<PendingPrintJob[]>> {
  return runAction(async () => {
    return getPendingPrintQueue();
  });
}

export async function markPrintQueueDoneAction(printQueueId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await markPrintQueueDone(printQueueId);
  });
}

export async function enqueueManualReprintAction(jadwalDetailId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await enqueueManualReprint(jadwalDetailId);
  });
}

export async function getThermalReceiptDataAction(salesInvoiceId: string): Promise<ActionResult<ThermalReceiptData>> {
  return runAction(async () => {
    return getThermalReceiptData(salesInvoiceId);
  });
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint "src/app/mkesindo/(dashboard)/delivery/actions.ts"`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/delivery/actions.ts"
git commit -m "feat: add print-queue and thermal-receipt server actions"
```

---

### Task 8: Install `esc-pos-encoder` + printer connection module

**Files:**
- Modify: `package.json` (new dependency)
- Create: `src/lib/thermal-printer/connection.ts`

**Interfaces:**
- Produces:
  - `interface ThermalPrinterConnection { send(bytes: Uint8Array): Promise<void>; disconnect(): void }`
  - `connectViaBluetooth(): Promise<ThermalPrinterConnection>`
  - `connectViaUsb(): Promise<ThermalPrinterConnection>`
  - `reconnectPersisted(): Promise<ThermalPrinterConnection | null>`

- [ ] **Step 1: Install the dependency**

Run: `npm install esc-pos-encoder`
Expected: `package.json`'s `dependencies` gains `esc-pos-encoder`.

- [ ] **Step 2: Write the connection module**

```typescript
"use client";

// Browser-only module (navigator.bluetooth / navigator.usb) — never
// imported from a Server Component or server action. Both transports are
// normalized behind ThermalPrinterConnection so callers (the poller, the
// manual reprint flow) never branch on which one is active.
export interface ThermalPrinterConnection {
  send(bytes: Uint8Array): Promise<void>;
  disconnect(): void;
}

// Iware C5813 and most ESC/POS clones expose a single "Serial Port
// Profile"-style GATT service for raw byte writes — this UUID is the
// widely-used generic serial service most budget thermal printers (Iware,
// Goojprt, and rebadged clones of the same reference design) ship with.
// Confirmed against the printer live before shipping this to production —
// if pairing succeeds but no matching service/characteristic is found,
// surface a clear "printer tidak dikenali" error rather than a silent hang.
const PRINTER_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const PRINTER_CHARACTERISTIC_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

// Bluetooth writes are chunked — most GATT characteristics cap a single
// writeValue at 20 bytes (BLE's default ATT MTU), so a full receipt (easily
// several hundred bytes) must be split and sent sequentially, awaiting each
// write before starting the next (a GATT characteristic has no internal
// queue — firing writes concurrently silently drops all but the last one).
const BLE_CHUNK_SIZE = 20;

export async function connectViaBluetooth(): Promise<ThermalPrinterConnection> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [PRINTER_SERVICE_UUID] }],
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error("Gagal membuka koneksi GATT ke printer.");
  const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

  return {
    async send(bytes: Uint8Array) {
      for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK_SIZE) {
        await characteristic.writeValueWithoutResponse(bytes.slice(offset, offset + BLE_CHUNK_SIZE));
      }
    },
    disconnect() {
      device.gatt?.disconnect();
    },
  };
}

export async function connectViaUsb(): Promise<ThermalPrinterConnection> {
  const device = await navigator.usb.requestDevice({ filters: [] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const iface = device.configuration!.interfaces[0];
  await device.claimInterface(iface.interfaceNumber);
  // The OUT endpoint is whichever bulk-transfer endpoint isn't the IN
  // direction — thermal printers expose exactly one of each on their
  // printer-class interface.
  const outEndpoint = iface.alternate.endpoints.find((e) => e.direction === "out");
  if (!outEndpoint) throw new Error("Printer USB ini tidak punya endpoint OUT yang dikenali.");

  return {
    async send(bytes: Uint8Array) {
      await device.transferOut(outEndpoint.endpointNumber, bytes);
    },
    disconnect() {
      device.close();
    },
  };
}

// Called on every /mkesindo/delivery page load — restores a previously-
// authorized device with NO new permission prompt (browser requirement:
// only a real user gesture, e.g. the explicit "Hubungkan Printer" click,
// can trigger requestDevice's picker). Returns null if nothing was ever
// authorized, or if the previously-authorized device isn't reachable right
// now (powered off, out of range) — the caller falls back to showing the
// "Hubungkan Printer" control either way.
export async function reconnectPersisted(): Promise<ThermalPrinterConnection | null> {
  try {
    const bleDevices = await navigator.bluetooth.getDevices();
    for (const device of bleDevices) {
      try {
        const server = await device.gatt?.connect();
        if (!server) continue;
        const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
        const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);
        return {
          async send(bytes: Uint8Array) {
            for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK_SIZE) {
              await characteristic.writeValueWithoutResponse(bytes.slice(offset, offset + BLE_CHUNK_SIZE));
            }
          },
          disconnect() {
            device.gatt?.disconnect();
          },
        };
      } catch {
        continue;
      }
    }
  } catch {
    // navigator.bluetooth.getDevices() itself can throw if the permission
    // backend isn't available (e.g. desktop Chrome with the flag disabled)
    // — fall through to the USB attempt below rather than surfacing this.
  }

  try {
    const usbDevices = await navigator.usb.getDevices();
    const device = usbDevices[0];
    if (!device) return null;
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    const iface = device.configuration!.interfaces[0];
    await device.claimInterface(iface.interfaceNumber);
    const outEndpoint = iface.alternate.endpoints.find((e) => e.direction === "out");
    if (!outEndpoint) return null;
    return {
      async send(bytes: Uint8Array) {
        await device.transferOut(outEndpoint.endpointNumber, bytes);
      },
      disconnect() {
        device.close();
      },
    };
  } catch {
    return null;
  }
}
```

**Live verification is required before Task 11 ships** — the exact `PRINTER_SERVICE_UUID`/`PRINTER_CHARACTERISTIC_UUID` values above are a starting assumption for a generic ESC/POS BLE printer, not confirmed against the real Iware C5813 yet. Before relying on this in Task 11's poller, pair the real printer once via a throwaway HTML test page (`navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [...] })`, then log `server.getPrimaryServices()`) and correct the two UUID constants above to match what the real device actually reports. Delete the throwaway test page afterward.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) — Web Bluetooth/WebUSB types (`navigator.bluetooth`, `navigator.usb`) require the `@types/web-bluetooth` and `@types/w3c-web-usb` ambient type packages; if TypeScript reports `Property 'bluetooth' does not exist on type 'Navigator'` or similar, run `npm install --save-dev @types/web-bluetooth @types/w3c-web-usb` first, then re-run the type-check. Run `npx eslint src/lib/thermal-printer/connection.ts`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/thermal-printer/connection.ts
git commit -m "feat: add Web Bluetooth/WebUSB thermal printer connection module"
```

---

### Task 9: Receipt byte builder

**Files:**
- Create: `src/lib/thermal-printer/receipt-builder.ts`

**Interfaces:**
- Consumes: `ThermalReceiptData` (Task 5), `esc-pos-encoder` (Task 8).
- Produces: `buildReceiptBytes(data: ThermalReceiptData): Uint8Array`

- [ ] **Step 1: Write the file**

```typescript
"use client";

import EscPosEncoder from "esc-pos-encoder";
import { formatDate, formatTime, formatRupiah } from "@/lib/format";
import type { ThermalReceiptData } from "@/lib/queries/thermal-receipt";

// esc-pos-encoder's own README documents this exact chained-builder shape
// (initialize/align/bold/line/qrcode/cut) — no manual byte-level ESC/POS
// command construction happens here.
export function buildReceiptBytes(data: ThermalReceiptData): Uint8Array {
  const encoder = new EscPosEncoder();
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

  if (data.mitraAddress) encoder.line(data.mitraAddress);

  encoder
    .line(`Armada: ${data.armadaNama}${data.vehicleNo ? ` (${data.vehicleNo})` : ""}`)
    .line(`Driver: ${data.driverName ?? "-"}`)
    .newline()
    .rule();

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

  if (data.bankTransfer) {
    encoder
      .line("Transfer ke:")
      .line(`${data.bankTransfer.bankNama} ${data.bankTransfer.nomorRekening}`)
      .line(`a.n. ${data.bankTransfer.atasNama}`)
      .newline();
  }

  encoder
    .align("center")
    .line("Scan untuk lihat tagihan & bayar QRIS:")
    .qrcode(data.invoiceUrl, { size: 6 })
    .newline()
    .line("SI Awal - nominal dapat berubah")
    .line("sesuai kondisi pengiriman di lapangan")
    .newline()
    .cut();

  return encoder.encode();
}
```

Read `esc-pos-encoder`'s actual installed API (its README/type declarations under `node_modules/esc-pos-encoder`) before finalizing this file — the method names/chaining shape above (`rule()`, `qrcode(text, { size })`, `cut()`) reflect the library's documented API as of this plan's writing, but confirm exact option shapes (e.g. `qrcode`'s second-argument keys) against the installed version rather than assuming.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/lib/thermal-printer/receipt-builder.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/thermal-printer/receipt-builder.ts
git commit -m "feat: add ESC/POS receipt byte builder"
```

---

### Task 10: Printer connection React hook

**Files:**
- Create: `src/lib/thermal-printer/use-printer-connection.ts`

**Interfaces:**
- Consumes: `connectViaBluetooth`, `connectViaUsb`, `reconnectPersisted`, `ThermalPrinterConnection` (Task 8).
- Produces: `usePrinterConnection(): { status: "disconnected" | "connecting" | "connected"; connection: ThermalPrinterConnection | null; connectBluetooth: () => Promise<void>; connectUsb: () => Promise<void>; disconnect: () => void }`

- [ ] **Step 1: Write the hook**

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectViaBluetooth, connectViaUsb, reconnectPersisted, type ThermalPrinterConnection } from "./connection";

export type PrinterStatus = "disconnected" | "connecting" | "connected";

export function usePrinterConnection() {
  const [status, setStatus] = useState<PrinterStatus>("disconnected");
  const connectionRef = useRef<ThermalPrinterConnection | null>(null);

  // Silent restore on mount — see reconnectPersisted's own doc comment for
  // why this can never itself trigger a permission prompt.
  useEffect(() => {
    let cancelled = false;
    reconnectPersisted().then((conn) => {
      if (cancelled || !conn) return;
      connectionRef.current = conn;
      setStatus("connected");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectBluetooth = useCallback(async () => {
    setStatus("connecting");
    try {
      connectionRef.current = await connectViaBluetooth();
      setStatus("connected");
    } catch {
      setStatus("disconnected");
    }
  }, []);

  const connectUsb = useCallback(async () => {
    setStatus("connecting");
    try {
      connectionRef.current = await connectViaUsb();
      setStatus("connected");
    } catch {
      setStatus("disconnected");
    }
  }, []);

  const disconnect = useCallback(() => {
    connectionRef.current?.disconnect();
    connectionRef.current = null;
    setStatus("disconnected");
  }, []);

  return { status, connection: connectionRef.current, connectBluetooth, connectUsb, disconnect };
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/lib/thermal-printer/use-printer-connection.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/thermal-printer/use-printer-connection.ts
git commit -m "feat: add usePrinterConnection hook"
```

---

### Task 11: Print queue poller component

**Files:**
- Create: `src/components/dashboard/print-queue-poller.tsx`

**Interfaces:**
- Consumes: `usePrinterConnection` (Task 10), `buildReceiptBytes` (Task 9), `getPendingPrintQueueAction`, `markPrintQueueDoneAction`, `getThermalReceiptDataAction` (Task 7).

- [ ] **Step 1: Write the component**

```typescript
"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Printer, Usb, Bluetooth } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrinterConnection } from "@/lib/thermal-printer/use-printer-connection";
import { buildReceiptBytes } from "@/lib/thermal-printer/receipt-builder";
import {
  getPendingPrintQueueAction,
  markPrintQueueDoneAction,
  getThermalReceiptDataAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";

const POLL_INTERVAL_MS = 4000;
const PRINT_GAP_MS = 5000;

// Mounted once, at the top of /mkesindo/delivery — NOT inside
// RouteValidationDialog — so it keeps draining the queue regardless of
// which Jadwal's dialog is open or closed, and regardless of whether the
// Selesai Muat that created a job happened on THIS page or on produksi-app.
export function PrintQueuePoller() {
  const { status, connection, connectBluetooth, connectUsb } = usePrinterConnection();
  const draining = useRef(false);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  useEffect(() => {
    const interval = setInterval(async () => {
      if (draining.current) return;
      const conn = connectionRef.current;
      if (!conn) return;

      const jobsResult = await getPendingPrintQueueAction();
      if (!jobsResult.success || jobsResult.data.length === 0) return;

      draining.current = true;
      try {
        for (const job of jobsResult.data) {
          const dataResult = await getThermalReceiptDataAction(job.salesInvoiceId);
          if (!dataResult.success) {
            toast.error(`Gagal ambil data SI untuk struk: ${dataResult.error}`);
            break;
          }
          try {
            await conn.send(buildReceiptBytes(dataResult.data));
          } catch (err) {
            toast.error(`Cetak gagal — periksa printer (kertas/koneksi). ${err instanceof Error ? err.message : ""}`);
            break;
          }
          await markPrintQueueDoneAction(job.printQueueId);
          await new Promise((resolve) => setTimeout(resolve, PRINT_GAP_MS));
        }
      } finally {
        draining.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (status === "connected") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Printer className="size-3.5 text-primary" /> Printer tersambung
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <p className="text-xs text-muted-foreground">Printer belum tersambung</p>
      <Button size="sm" variant="outline" className="gap-1.5" disabled={status === "connecting"} onClick={connectBluetooth}>
        <Bluetooth className="size-3.5" /> Bluetooth
      </Button>
      <Button size="sm" variant="outline" className="gap-1.5" disabled={status === "connecting"} onClick={connectUsb}>
        <Usb className="size-3.5" /> USB
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/components/dashboard/print-queue-poller.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/print-queue-poller.tsx
git commit -m "feat: add print queue poller with 5s inter-print gap"
```

---

### Task 12: Mount the poller on `/mkesindo/delivery`

**Files:**
- Modify: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- Consumes: `PrintQueuePoller` (Task 11).

- [ ] **Step 1: Read the board's top-level header JSX**

Read `src/components/dashboard/pengiriman-board.tsx`'s outermost returned JSX (the board's own header row, likely near the top of the main exported component, alongside the date picker/navigation controls already there) to find a natural spot for a small always-visible printer-status control.

- [ ] **Step 2: Mount it**

Add the import:

```typescript
import { PrintQueuePoller } from "@/components/dashboard/print-queue-poller";
```

Render `<PrintQueuePoller />` once, in the board's header row (not per-armada-row, not inside any dialog) — exact placement is a one-line JSX insertion once Step 1's header structure is confirmed.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/components/dashboard/pengiriman-board.tsx`.

- [ ] **Step 4: Live verification**

If a dev server + authenticated session with `/mkesindo/delivery` access is available: load the page, confirm the "Printer belum tersambung" control renders with Bluetooth/USB buttons. Clicking either without a real printer nearby is expected to show the browser's own device picker (which can be cancelled) — full connect-and-print verification needs the real Iware C5813 present, which may not be available in this environment; if so, static analysis plus the picker-appears check is sufficient, say so explicitly.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx
git commit -m "feat: mount print queue poller on Papan Pengiriman"
```

---

### Task 13: Replace bulk print-select UI with a per-stop manual reprint icon

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`

**Interfaces:**
- Consumes: `enqueueManualReprintAction` (Task 7).

- [ ] **Step 1: Remove `printSelected` state, `togglePrint`, `handlePrintSelected`**

Delete these three (read the file first to get their exact current line ranges, since Task 4-12's changes elsewhere in the codebase don't touch this file and line numbers here should still match what was read during this plan's own investigation):

```typescript
  const [printSelected, setPrintSelected] = useState<Set<number>>(new Set());
  const [printError, setPrintError] = useState<string | null>(null);

  function togglePrint(jadwalDetailId: number) { ... }

  function handlePrintSelected() { ... }
```

Also remove the now-unused `printError` state and its rendering (if any) — grep this file for `printError` to confirm every usage site before deleting.

- [ ] **Step 2: Remove the `window.open` loop inside `doSaveDriverTimeThenSelesaiMuat`**

Delete:

```typescript
      // The DO/SI documents were genuinely created regardless of which
      // Jadwal this dialog has since moved on to show — auto-opening their
      // invoices is a real consequence of a real action, not display state
      // tied to this dialog, so it's deliberately not gated on jadwalIdRef.
      for (const t of selesaiMuatResult.data) {
        if (printSelected.has(t.jadwalDetailId)) {
          window.open(`/mkesindo/invoice/${t.invoiceToken}`, "_blank");
        }
      }
```

Printing after Selesai Muat is now entirely the print queue's job (Task 4 + Task 11) — this handler needs no printing-related code left at all.

- [ ] **Step 3: Remove `printChecked`/`onTogglePrint` from `SortableStopRow`, add a reprint icon instead**

Read the `SortableStopRow` component's prop list and its per-row action buttons (the same button cluster that currently renders the print-toggle button at the lines using `printChecked ? "Batal tandai untuk dicetak" : "Tandai untuk dicetak"`). Replace that toggle button with:

```tsx
{detail.SalesInvoiceID && (
  <button
    type="button"
    title="Cetak ulang SI"
    onClick={() => onReprint(detail.JadwalDetailID)}
    className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-border"
  >
    <Printer className="size-3.5" />
  </button>
)}
```

Update `SortableStopRow`'s props type: remove `printChecked: boolean; onTogglePrint: (jadwalDetailId: number) => void;`, add `onReprint: (jadwalDetailId: number) => void;`. `detail.SalesInvoiceID` needs to already be present on the row type consumed here — check `DriverStopRow`/`JadwalDetailRow` (`pengiriman-jadwal.ts`) for whether `SalesInvoiceID` is already selected; if not already there, this is a pre-existing gap outside this plan's scope — fall back to gating the icon on `detail.InvoiceToken != null` instead (already confirmed present and already implies a SalesInvoiceID exists server-side).

- [ ] **Step 4: Add the reprint handler and wire it into the row**

In the main dialog component, add:

```typescript
const [reprintPending, setReprintPending] = useState<number | null>(null);

function handleReprint(jadwalDetailId: number) {
  setReprintPending(jadwalDetailId);
  startTransition(async () => {
    const result = await enqueueManualReprintAction(jadwalDetailId);
    setReprintPending(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("SI ditambahkan ke antrian cetak.");
  });
}
```

Import `enqueueManualReprintAction` from `@/app/mkesindo/(dashboard)/delivery/actions` (add to the existing import list from that module in this file, don't add a second import line). Pass `onReprint={handleReprint}` to `SortableStopRow` at its call site (replacing the removed `printChecked`/`onTogglePrint` props there).

- [ ] **Step 5: Remove the "Cetak SI Terpilih" button**

Delete:

```tsx
            {printSelected.size > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5" data-capture-hide="true" onClick={handlePrintSelected}>
                <Printer className="size-3.5" />
                Cetak SI Terpilih ({printSelected.size})
              </Button>
            )}
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) — expect zero errors; every removed identifier (`printSelected`, `togglePrint`, `handlePrintSelected`, `printChecked`, `onTogglePrint`, `printError`) must have no remaining references anywhere in this file. Run `npx eslint src/components/dashboard/route-validation-dialog.tsx`.

- [ ] **Step 7: Live verification**

If a dev server + authenticated session is available: open Validasi Rute on a Jadwal with at least one stop that already has a SalesInvoice (a previously-completed Selesai Muat), confirm the printer icon renders next to it and NOT next to a stop with no SalesInvoice yet, click it, confirm a success toast appears and a new `'Pending'` row lands in `DashboardPrintQueue` (verify via a direct query). If not possible, static analysis is fine — say so explicitly.

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx
git commit -m "feat: replace bulk print-select with per-stop manual reprint icon"
```

---

### Task 14: Metode Pembayaran admin UI — bank-transfer fields

**Files:**
- Modify: `src/components/dashboard/payment-method-dialog.tsx`

**Interfaces:**
- Consumes: `MetodePembayaranRow`/`UpsertMetodePembayaranInput`'s new fields (Task 6).

- [ ] **Step 1: Update `emptyRowForm` and `rowToFormInput`**

```typescript
function emptyRowForm(perusahaanId: number, nextUrutan: number): UpsertMetodePembayaranInput {
  return {
    perusahaanId,
    kode: "",
    metode: "TUNAI",
    jenis: "manual",
    coaId: "",
    konteks: [],
    wajibCatatan: false,
    catatan: null,
    bankNama: null,
    nomorRekening: null,
    atasNama: null,
    urutan: nextUrutan,
    isActive: true,
  };
}

function rowToFormInput(row: MetodePembayaranRow): UpsertMetodePembayaranInput {
  return {
    id: row.id,
    perusahaanId: row.perusahaanId,
    kode: row.kode,
    metode: row.metode,
    jenis: row.jenis,
    coaId: row.coaId,
    konteks: row.konteks,
    wajibCatatan: row.wajibCatatan,
    catatan: row.catatan,
    bankNama: row.bankNama,
    nomorRekening: row.nomorRekening,
    atasNama: row.atasNama,
    urutan: row.urutan,
    isActive: row.isActive,
  };
}
```

- [ ] **Step 2: Add the fields to `MetodeForm`, conditional on `metode === "TRANSFER"`**

Mirrors the existing `editingRow.jenis === "qris_static"` conditional block's placement (right after the Catatan textarea, before the error/footer):

```tsx
{form.metode === "TRANSFER" && (
  <div className="grid grid-cols-3 gap-3">
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="mp-bank-nama">Nama Bank</Label>
      <Input
        id="mp-bank-nama"
        value={form.bankNama ?? ""}
        onChange={(e) => onChange({ ...form, bankNama: e.target.value || null })}
        placeholder="mis. Mandiri"
      />
    </div>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="mp-nomor-rekening">Nomor Rekening</Label>
      <Input
        id="mp-nomor-rekening"
        value={form.nomorRekening ?? ""}
        onChange={(e) => onChange({ ...form, nomorRekening: e.target.value || null })}
      />
    </div>
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="mp-atas-nama">Atas Nama</Label>
      <Input
        id="mp-atas-nama"
        value={form.atasNama ?? ""}
        onChange={(e) => onChange({ ...form, atasNama: e.target.value || null })}
      />
    </div>
  </div>
)}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) — this should clear the pre-existing errors Task 6 introduced at this file. Run `npx eslint src/components/dashboard/payment-method-dialog.tsx`.

- [ ] **Step 4: Live verification**

If a dev server + authenticated session with `/grup/perusahaan` access is available: open Kelola Pembayaran for a PT, add/edit a metode with Metode = TRANSFER, confirm the three new fields appear, fill and save, confirm they persist on reopen. If not possible, static analysis is fine — say so explicitly.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/payment-method-dialog.tsx
git commit -m "feat: add bank-transfer fields to Metode Pembayaran admin form"
```
