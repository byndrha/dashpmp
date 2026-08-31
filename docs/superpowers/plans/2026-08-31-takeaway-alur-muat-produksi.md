# TakeAway: Alur Mulai Muat/Selesai Muat di Produksi-App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure TakeAway order fulfillment so DeliveryOrder/SalesInvoice/print-job creation happens at a new "Selesai Muat" step performed by Kepala Produksi in `/mkesindo/produksi-app`, instead of instantly when the order is created — mirroring the existing non-TakeAway Mulai Muat/Selesai Muat flow — and feeding TakeAway quantities into the production report.

**Architecture:** A new standalone table (`DashboardTakeAwayMuatan`) and query module track one row per TakeAway SalesOrder through Draft → Mulai Muat → Selesai Muat, completely separate from the armada-based `DashboardPengirimanJadwal`/`selesaiMuat()` machinery (no driver/route/capacity validation applies to a walk-in pickup). The DeliveryOrder/SalesInvoice-creation SQL that used to run at order-creation time in `takeaway.ts` moves, unchanged, into a new `takeAwaySelesaiMuat` function that fires when Kepala Produksi taps "Selesai Muat". A new UI component (`TakeAwayMuatanList`) sits alongside the existing `KartuPengirimanList`/`WarehouseView` in produksi-app's "Stok Es" tab.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript, MSSQL (`mssql` package, raw parameterized SQL — no ORM), React 19 client components.

**Spec:** `docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md`

## Global Constraints

- Do **not** touch `src/components/produksi-app/warehouse-view.tsx` — standing constraint, it's the product owner's own separate work-in-progress.
- Do **not** touch `DashboardPengirimanJadwal`, `selesaiMuat()`, `produksiSelesaiMuat()`, or `KartuPengirimanList` — TakeAway gets its own table/flow, never reuses the armada-based Jadwal machinery.
- `JamMulaiMuat`/`JamSelesaiMuat`-style columns are stamped with plain `GETDATE()` (true-UTC in this codebase's convention) — never `getNaiveWibTransDate()`, which is reserved for `TransDate`-family columns (SalesOrder/DeliveryOrder/SalesInvoice.TransDate).
- Qty confirmed at Selesai Muat always equals the qty originally ordered (`QtyDipesan`) — no free-text/partial-fulfillment qty field.
- No new roles/permissions — gate every new server action with `requireProduksiView()`, exactly like every other produksi-app action in `src/app/mkesindo/produksi/actions.ts`.
- This repo has no automated test suite (`npm run lint` and `next build`/`tsc --noEmit` are the only scripted checks) — "testing" a task means: type-check, a temporary `npx tsx` scratch script against the real dev/production MSSQL database (delete the script when done, per this repo's established convention), and/or manual click-through in the browser for UI tasks. Every DB write this app makes is against the live database — there is no separate staging environment.

---

### Task 1: Create `DashboardTakeAwayMuatan` table

**Files:**
- Create: `scripts/create-takeaway-muatan-table.ts`

**Interfaces:**
- Produces: the `DashboardTakeAwayMuatan` table, columns `TakeAwayMuatanID, SalesOrderID, Variant, QtyDipesan, JamMulaiMuat, JamSelesaiMuat, QtyDimuat, DicatatOlehAkunID, DeliveryOrderID, SalesInvoiceID, IsDeleted, CreatedDate` — every later task in this plan depends on this exact column set existing.

- [ ] **Step 1: Write the table-creation script**

```ts
// One-off schema creation for TakeAway loading tracking
// (DashboardTakeAwayMuatan) — idempotent, safe to re-run.
// Usage: npx tsx scripts/create-takeaway-muatan-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardTakeAwayMuatan' AND xtype='U')
    CREATE TABLE DashboardTakeAwayMuatan (
      TakeAwayMuatanID  INT IDENTITY PRIMARY KEY,
      SalesOrderID      VARCHAR(16) NOT NULL UNIQUE,
      Variant           VARCHAR(8) NOT NULL,
      QtyDipesan        INT NOT NULL,
      JamMulaiMuat      DATETIME NULL,
      JamSelesaiMuat    DATETIME NULL,
      QtyDimuat         INT NULL,
      DicatatOlehAkunID INT NULL,
      DeliveryOrderID   VARCHAR(16) NULL,
      SalesInvoiceID    VARCHAR(16) NULL,
      IsDeleted         BIT NOT NULL DEFAULT 0,
      CreatedDate       DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  console.log("DashboardTakeAwayMuatan ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script against the live database**

```bash
npx tsx scripts/create-takeaway-muatan-table.ts
```

Expected output: `DashboardTakeAwayMuatan ready.` This creates a brand-new, additive table — no existing table or data is touched.

- [ ] **Step 3: Verify the table exists with a throwaway check script**

Create `scripts/scratch-verify-takeaway-table.ts`:

```ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardTakeAwayMuatan'
    ORDER BY ORDINAL_POSITION
  `);
  console.table(result.recordset);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/scratch-verify-takeaway-table.ts`
Expected: a table listing all 12 columns from Step 1 with the right nullability (`SalesOrderID`/`Variant`/`QtyDipesan`/`IsDeleted`/`CreatedDate` NOT NULL, the rest NULL).

Then delete the scratch script — it's a one-off check, not part of the codebase:

```bash
rm scripts/scratch-verify-takeaway-table.ts
```

- [ ] **Step 4: Commit**

```bash
git add scripts/create-takeaway-muatan-table.ts
git commit -m "feat: add DashboardTakeAwayMuatan table for TakeAway loading tracking"
```

---

### Task 2: New query module `takeaway-muatan.ts` — base CRUD

**Files:**
- Create: `src/lib/queries/takeaway-muatan.ts`

**Interfaces:**
- Consumes: `getPool, sql` from `@/lib/db`; `AppError` from `@/lib/action-result`; `KantongVariant` type from `@/lib/queries/sales-order` (already `"10kg" | "5kg"`, see `src/lib/queries/sales-order.ts:133`).
- Produces (used by later tasks):
  - `TakeAwayMuatanPendingRow { takeAwayMuatanId: number; salesOrderId: string; customerName: string; variant: KantongVariant; qtyDipesan: number; jamMulaiMuat: Date | null }`
  - `TakeAwayMuatanSelesaiRow { takeAwayMuatanId: number; salesOrderId: string; customerName: string; variant: KantongVariant; qtyDimuat: number; jamSelesaiMuat: Date }`
  - `createTakeAwayMuatanDraft(salesOrderId: string, variant: KantongVariant, qtyDipesan: number): Promise<void>` — Task 3 calls this from `createTakeAwayPemesanan`.
  - `getTakeAwayMuatanPending(): Promise<TakeAwayMuatanPendingRow[]>` — Task 5/8 call this.
  - `getTakeAwayMuatanSelesaiRecent(): Promise<TakeAwayMuatanSelesaiRow[]>` — Task 5/8 call this.
  - `takeAwayMulaiMuat(takeAwayMuatanId: number): Promise<void>` — Task 5 calls this.
  - `softDeleteTakeAwayMuatanForSalesOrder(salesOrderId: string): Promise<void>` — Task 4 calls this.

- [ ] **Step 1: Write the file**

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import type { KantongVariant } from "@/lib/queries/sales-order";

export interface TakeAwayMuatanPendingRow {
  takeAwayMuatanId: number;
  salesOrderId: string;
  customerName: string;
  variant: KantongVariant;
  qtyDipesan: number;
  jamMulaiMuat: Date | null;
}

export interface TakeAwayMuatanSelesaiRow {
  takeAwayMuatanId: number;
  salesOrderId: string;
  customerName: string;
  variant: KantongVariant;
  qtyDimuat: number;
  jamSelesaiMuat: Date;
}

// Called from createTakeAwayPemesanan (takeaway.ts) right after the
// SalesOrder itself is created — one Draft row per TakeAway order,
// JamMulaiMuat/JamSelesaiMuat/QtyDimuat all NULL until produksi-app acts
// on it. See docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md.
export async function createTakeAwayMuatanDraft(
  salesOrderId: string,
  variant: KantongVariant,
  qtyDipesan: number
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("variant", sql.VarChar(8), variant)
    .input("qty", sql.Int, qtyDipesan)
    .query(`INSERT INTO DashboardTakeAwayMuatan (SalesOrderID, Variant, QtyDipesan) VALUES (@soId, @variant, @qty)`);
}

// Menunggu diproses ("Draft") + sedang dimuat (JamMulaiMuat sudah diisi,
// JamSelesaiMuat belum) digabung satu daftar — sama seperti
// getAllDraftJadwalForProduksi (produksi-muatan.ts) menampilkan Draft apa
// pun status JamMulaiMuat-nya. Oldest-first: ini antrian walk-in, bukan
// jadwal jauh ke depan seperti Jadwal bertruk, jadi first-come-first-served.
// LEFT JOIN (bukan INNER) supaya baris tetap tampil walau BusinessPartner-nya
// pernah dihapus setelah order dibuat.
export async function getTakeAwayMuatanPending(): Promise<TakeAwayMuatanPendingRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT tam.TakeAwayMuatanID, tam.SalesOrderID, ISNULL(bp.Name, 'Tidak diketahui') AS CustomerName,
           tam.Variant, tam.QtyDipesan, tam.JamMulaiMuat
    FROM DashboardTakeAwayMuatan tam
    LEFT JOIN SalesOrder so ON so.SalesOrderID = tam.SalesOrderID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    WHERE tam.IsDeleted = 0 AND tam.JamSelesaiMuat IS NULL
    ORDER BY tam.CreatedDate ASC
  `);
  return (
    result.recordset as {
      TakeAwayMuatanID: number;
      SalesOrderID: string;
      CustomerName: string;
      Variant: KantongVariant;
      QtyDipesan: number;
      JamMulaiMuat: Date | null;
    }[]
  ).map((r) => ({
    takeAwayMuatanId: r.TakeAwayMuatanID,
    salesOrderId: r.SalesOrderID,
    customerName: r.CustomerName,
    variant: r.Variant,
    qtyDipesan: r.QtyDipesan,
    jamMulaiMuat: r.JamMulaiMuat,
  }));
}

// Sudah Selesai Muat — 50 terbaru, sekadar agar operator melihat apa yang
// baru saja diselesaikan tanpa pindah tab (pola sama seperti
// fetchRecentSelesaiMuatJadwalForProduksi di produksi-muatan.ts).
export async function getTakeAwayMuatanSelesaiRecent(): Promise<TakeAwayMuatanSelesaiRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP (50) tam.TakeAwayMuatanID, tam.SalesOrderID, ISNULL(bp.Name, 'Tidak diketahui') AS CustomerName,
           tam.Variant, tam.QtyDimuat, tam.JamSelesaiMuat
    FROM DashboardTakeAwayMuatan tam
    LEFT JOIN SalesOrder so ON so.SalesOrderID = tam.SalesOrderID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    WHERE tam.IsDeleted = 0 AND tam.JamSelesaiMuat IS NOT NULL
    ORDER BY tam.JamSelesaiMuat DESC
  `);
  return (
    result.recordset as {
      TakeAwayMuatanID: number;
      SalesOrderID: string;
      CustomerName: string;
      Variant: KantongVariant;
      QtyDimuat: number;
      JamSelesaiMuat: Date;
    }[]
  ).map((r) => ({
    takeAwayMuatanId: r.TakeAwayMuatanID,
    salesOrderId: r.SalesOrderID,
    customerName: r.CustomerName,
    variant: r.Variant,
    qtyDimuat: r.QtyDimuat,
    jamSelesaiMuat: r.JamSelesaiMuat,
  }));
}

// Atomic claim — the guard is the WHERE clause itself (JamMulaiMuat IS
// NULL), not a separate SELECT-then-UPDATE, so two concurrent taps on the
// same card can't both succeed. Mirrors startMuat()'s own
// UPDATE ... WHERE Status = 'Draft' pattern in pengiriman-jadwal.ts.
export async function takeAwayMulaiMuat(takeAwayMuatanId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, takeAwayMuatanId)
    .query(
      `UPDATE DashboardTakeAwayMuatan SET JamMulaiMuat = GETDATE() WHERE TakeAwayMuatanID = @id AND IsDeleted = 0 AND JamMulaiMuat IS NULL`
    );
  if (result.rowsAffected[0] === 0) {
    throw new AppError("Order TakeAway ini sudah tidak tersedia atau sudah dimulai.");
  }
}

// Dipanggil dari deletePemesanan (pemesanan.ts, Task 4) saat SO TakeAway
// dibatalkan sebelum Mulai Muat — mencegah baris ini terus muncul di daftar
// menunggu produksi-app padahal SO-nya sudah dihapus. Aman dipanggil untuk
// SO non-TakeAway juga: tidak ada baris yang cocok, tidak melakukan apa-apa.
export async function softDeleteTakeAwayMuatanForSalesOrder(salesOrderId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`UPDATE DashboardTakeAwayMuatan SET IsDeleted = 1 WHERE SalesOrderID = @soId`);
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors from `src/lib/queries/takeaway-muatan.ts`.

- [ ] **Step 3: Verify against the real database with a scratch script**

Create `scripts/scratch-verify-takeaway-muatan-crud.ts` — uses a real existing TakeAway SalesOrderID so the `LEFT JOIN` has something to resolve. Find one first:

```ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";
import {
  createTakeAwayMuatanDraft,
  getTakeAwayMuatanPending,
  takeAwayMulaiMuat,
  softDeleteTakeAwayMuatanForSalesOrder,
} from "../src/lib/queries/takeaway-muatan";

async function main() {
  const pool = await getPool();
  const soResult = await pool.request().query(`
    SELECT TOP 1 SalesOrderID FROM SalesOrder WHERE SalesmanID = '0127' AND IsDeleted = 0 ORDER BY TransDate DESC
  `);
  const soId = (soResult.recordset[0] as { SalesOrderID: string } | undefined)?.SalesOrderID;
  if (!soId) throw new Error("No existing TakeAway SalesOrder found to test against.");
  console.log("Using real TakeAway SalesOrderID:", soId);

  // Use a fake, obviously-test SalesOrderID for the actual insert so we
  // never collide with the real order's row — only need the join to
  // resolve for display, so borrow a real BusinessPartner via a second
  // fake SO id string is not possible (SalesOrderID must exist for the
  // LEFT JOIN to show a name) — so we test lifecycle against the real
  // soId's row directly, and clean it up at the end.
  await createTakeAwayMuatanDraft(soId, "5kg", 3);
  const pending = await getTakeAwayMuatanPending();
  const row = pending.find((r) => r.salesOrderId === soId);
  console.log("Found in pending list:", row);
  if (!row) throw new Error("FAIL: row not found in getTakeAwayMuatanPending()");

  await takeAwayMulaiMuat(row.takeAwayMuatanId);
  const pendingAfterMulai = await getTakeAwayMuatanPending();
  const rowAfterMulai = pendingAfterMulai.find((r) => r.takeAwayMuatanId === row.takeAwayMuatanId);
  console.log("After Mulai Muat:", rowAfterMulai);
  if (!rowAfterMulai?.jamMulaiMuat) throw new Error("FAIL: JamMulaiMuat not stamped");

  const secondClaim = await takeAwayMulaiMuat(row.takeAwayMuatanId).then(
    () => "did not throw",
    (err) => err.message
  );
  console.log("Second Mulai Muat attempt (should reject):", secondClaim);

  await softDeleteTakeAwayMuatanForSalesOrder(soId);
  const pendingAfterDelete = await getTakeAwayMuatanPending();
  console.log(
    "Still in pending list after soft-delete (should be false):",
    pendingAfterDelete.some((r) => r.takeAwayMuatanId === row.takeAwayMuatanId)
  );

  // Real cleanup — hard-delete the test row from the brand-new table so no
  // trace of this test remains (safe: this table only exists as of Task 1
  // in this plan, nothing else references it yet).
  await pool
    .request()
    .input("id", sql.Int, row.takeAwayMuatanId)
    .query(`DELETE FROM DashboardTakeAwayMuatan WHERE TakeAwayMuatanID = @id`);

  console.log("OK — cleaned up.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/scratch-verify-takeaway-muatan-crud.ts`
Expected: "Found in pending list" shows the row with `qtyDipesan: 3, variant: '5kg'`; "After Mulai Muat" shows a non-null `jamMulaiMuat`; the second Mulai Muat attempt logs an error message (not "did not throw"); "Still in pending list after soft-delete" logs `false`; ends with "OK — cleaned up."

Then delete the scratch script:

```bash
rm scripts/scratch-verify-takeaway-muatan-crud.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/takeaway-muatan.ts
git commit -m "feat: add takeaway-muatan query module (draft/pending/mulai-muat CRUD)"
```

---

### Task 3: Move DeliveryOrder/SalesInvoice creation to Selesai Muat

This is the core behavior change: `createTakeAwayPemesanan` stops creating documents immediately, and a new `takeAwaySelesaiMuat` creates them instead. Every caller of the changed `CreateTakeAwayResult` shape must be fixed in this same task, or the tree won't build in between commits.

**Files:**
- Modify: `src/lib/queries/takeaway.ts` (trim to SO + Draft-row creation only)
- Modify: `src/lib/queries/takeaway-muatan.ts` (add `takeAwaySelesaiMuat` + the moved DO/SI-creation helpers/constants)
- Modify: `src/app/mkesindo/(dashboard)/pemesanan/actions.ts` (remove the now-invalid `enqueuePrintJob` call)
- Modify: `src/components/dashboard/pemesanan-form-dialog.tsx` (fix the success toast/print-poll trigger, which assumed immediate printing)
- Modify: `src/lib/queries/pengiriman-jadwal.ts` (two comments reference `takeaway.ts`'s SalesInvoice shape by file name — update to point at the new file so the comment stays accurate)

**Interfaces:**
- Consumes: `TAKEAWAY_SALESMAN_ID` (moves here, re-exported for `takeaway.ts` to import), the DB access pattern from Task 2.
- Produces:
  - `TAKEAWAY_SALESMAN_ID` (exported constant, `"0127"`) — `takeaway.ts` (Task 3) imports this.
  - `TakeAwaySelesaiMuatResult { deliveryOrderId: string; salesInvoiceId: string }`
  - `takeAwaySelesaiMuat(takeAwayMuatanId: number, dicatatOlehAkunId: number): Promise<TakeAwaySelesaiMuatResult>` — Task 5's `takeAwaySelesaiMuatAction` calls this.
  - `CreateTakeAwayInput` unchanged; `CreateTakeAwayResult` becomes `{ salesOrderId: string }` (no longer `deliveryOrderId`/`salesInvoiceId`).

- [ ] **Step 1: Add the moved DO/SI-creation code + `takeAwaySelesaiMuat` to `takeaway-muatan.ts`**

Append to `src/lib/queries/takeaway-muatan.ts` (after the existing content from Task 2):

```ts
// '0127' ("Ambil Sendiri") — same code PARTNER_TYPE_CASE (aging.ts) already
// treats as the TakeAway classification. Moved here from takeaway.ts along
// with the DO/SI-creation code below (docs/superpowers/specs/
// 2026-08-31-takeaway-alur-muat-produksi-design.md) — takeaway.ts still
// needs this value to pass to createSalesOrderManual, so it's exported.
export const TAKEAWAY_SALESMAN_ID = "0127";
const BRANCH_ID = "011";
const DEPARTMENT_ID = "0110";
const DOC_SUFFIX = "003/001";

async function nextDeliveryOrderId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderID AS INT)) AS MaxID FROM DeliveryOrder`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDeliveryOrderDetailId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderDetailID AS INT)) AS MaxID FROM DeliveryOrderDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDOVoucherSeq(pool: sql.ConnectionPool, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/DO/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM DeliveryOrder WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

async function nextSalesInvoiceId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesInvoiceID AS INT)) AS MaxID FROM SalesInvoice`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSalesInvoiceDetailId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesInvoiceDetailID AS INT)) AS MaxID FROM SalesInvoiceDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSIVoucherSeq(pool: sql.ConnectionPool, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/SI/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM SalesInvoice WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

export interface TakeAwaySelesaiMuatResult {
  deliveryOrderId: string;
  salesInvoiceId: string;
}

// The "Selesai Muat" step for TakeAway: creates the real
// DeliveryOrder+DeliveryOrderDetail+SalesInvoice+SalesInvoiceDetail
// documents (this SQL is unchanged from what used to run immediately in
// createTakeAwayPemesanan — only the timing moved, per
// docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md),
// then records the result on the DashboardTakeAwayMuatan row. Caller
// (takeAwaySelesaiMuatAction) enqueues the print job afterward — this
// function only creates documents, matching how selesaiMuat() in
// pengiriman-jadwal.ts doesn't enqueue prints itself either.
export async function takeAwaySelesaiMuat(
  takeAwayMuatanId: number,
  dicatatOlehAkunId: number
): Promise<TakeAwaySelesaiMuatResult> {
  const pool = await getPool();

  const muatanResult = await pool
    .request()
    .input("id", sql.Int, takeAwayMuatanId)
    .query(
      `SELECT SalesOrderID, JamMulaiMuat, JamSelesaiMuat FROM DashboardTakeAwayMuatan WHERE TakeAwayMuatanID = @id AND IsDeleted = 0`
    );
  const muatan = muatanResult.recordset[0] as
    | { SalesOrderID: string; JamMulaiMuat: Date | null; JamSelesaiMuat: Date | null }
    | undefined;
  if (!muatan) throw new AppError("Order TakeAway ini tidak ditemukan.");
  if (!muatan.JamMulaiMuat) throw new AppError("Mulai Muat belum dilakukan untuk order ini.");
  if (muatan.JamSelesaiMuat) throw new AppError("Order TakeAway ini sudah selesai dimuat.");

  const salesOrderId = muatan.SalesOrderID;
  let deliveryOrderId: string | null = null;
  let salesInvoiceId: string | null = null;

  try {
    const soResult = await pool
      .request()
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`SELECT BusinessPartnerID, DueDate, TermOfPaymentID FROM SalesOrder WHERE SalesOrderID = @soId`);
    const so = soResult.recordset[0] as { BusinessPartnerID: string; DueDate: Date; TermOfPaymentID: string } | undefined;
    if (!so) throw new AppError("Sales Order tidak ditemukan.");

    const sodResult = await pool
      .request()
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`SELECT SalesOrderDetailID, ItemID, Name, Qty, Unit, Price, Amount FROM SalesOrderDetail WHERE SalesOrderID = @soId`);
    const soDetails = sodResult.recordset as {
      SalesOrderDetailID: string;
      ItemID: string;
      Name: string;
      Qty: number;
      Unit: string;
      Price: number;
      Amount: number;
    }[];
    const totalAmount = soDetails.reduce((sum, d) => sum + d.Amount, 0);

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    deliveryOrderId = await nextDeliveryOrderId(pool);
    const doVoucherSeq = await nextDOVoucherSeq(pool, yearMonth);
    const doVoucherNo = `MKE/DO/${doVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
    await pool
      .request()
      .input("id", sql.VarChar(16), deliveryOrderId)
      .input("voucherNo", sql.VarChar(128), doVoucherNo)
      .input("branchId", sql.VarChar(16), BRANCH_ID)
      .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
      .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
      .input("soId", sql.VarChar(16), salesOrderId)
      .input("salesmanId", sql.VarChar(16), TAKEAWAY_SALESMAN_ID)
      .input("transDate", sql.DateTime, getNaiveWibTransDate())
      .input("dueDate", sql.DateTime, so.DueDate).query(`
        INSERT INTO DeliveryOrder
          (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
           IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
           BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
           ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
        VALUES
          (@id, @voucherNo, @transDate, @branchId, @departmentId, @bpId, '', @soId,
           0, '', '', '', 0, GETDATE(), '', NULL,
           NULL, 0, '', 1, 1, @salesmanId, 0,
           '', @dueDate, '', '', NULL)
      `);

    for (const sod of soDetails) {
      const detailId = await nextDeliveryOrderDetailId(pool);
      await pool
        .request()
        .input("id", sql.VarChar(16), detailId)
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .input("itemId", sql.VarChar(160), sod.ItemID)
        .input("name", sql.VarChar(160), sod.Name)
        .input("qty", sql.Decimal(23, 4), sod.Qty)
        .input("unit", sql.VarChar(8), sod.Unit)
        .input("price", sql.Decimal(23, 4), sod.Price)
        .input("amount", sql.Decimal(23, 4), sod.Amount)
        .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID).query(`
          INSERT INTO DeliveryOrderDetail
            (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue,
             DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
          VALUES
            (@id, @doId, @itemId, @qty, @unit, @qty, 1, @price, 0, NULL,
             0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
        `);
    }

    salesInvoiceId = await nextSalesInvoiceId(pool);
    const siVoucherSeq = await nextSIVoucherSeq(pool, yearMonth);
    const siVoucherNo = `MKE/SI/${siVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
    await pool
      .request()
      .input("id", sql.VarChar(16), salesInvoiceId)
      .input("voucherNo", sql.VarChar(128), siVoucherNo)
      .input("dueDate", sql.DateTime, so.DueDate)
      .input("termOfPaymentId", sql.VarChar(16), so.TermOfPaymentID)
      .input("soId", sql.VarChar(16), salesOrderId)
      .input("doId", sql.VarChar(16), `'${deliveryOrderId}'`)
      .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
      .input("branchId", sql.VarChar(16), BRANCH_ID)
      .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
      .input("amount", sql.Decimal(23, 4), totalAmount)
      .input("transDate", sql.DateTime, getNaiveWibTransDate())
      .input("salesmanId", sql.VarChar(16), TAKEAWAY_SALESMAN_ID).query(`
        INSERT INTO SalesInvoice
          (SalesInvoiceID, VoucherNo, ReferenceNo, TaxNo, TransDate, DueDate, Notes, TermOfPaymentID,
           SalesOrderID, DeliveryOrderID, SalesDepositID, BusinessPartnerID, BranchID, DepartmentID,
           Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, BankID, Paid, Deposit, PaidDate,
           IsClosed, IsDeleted, ModifiedDate, Rate, CurrencyID, IsAccountReceiveable, StatusForm,
           SalesmanID, ServiceTax, ServiceTaxValue, Visitor, IsTX, PromotionID, IsPerforma,
           DiscRpBefore, ProjectID, IsExported, BillOfQuantityID)
        VALUES
          (@id, @voucherNo, '', '', @transDate, @dueDate, '', @termOfPaymentId,
           @soId, @doId, '', @bpId, @branchId, @departmentId,
           @amount, 0, 0, 0, 0, 0, @amount, '', 0, 0, NULL,
           0, 0, GETDATE(), 1, '', 0, 1,
           @salesmanId, 0, 0, 0, 0, '', 0,
           0, '', 0, '')
      `);

    for (const sod of soDetails) {
      const detailId = await nextSalesInvoiceDetailId(pool);
      await pool
        .request()
        .input("id", sql.VarChar(16), detailId)
        .input("siId", sql.VarChar(16), salesInvoiceId)
        .input("itemId", sql.VarChar(160), sod.ItemID)
        .input("name", sql.VarChar(160), sod.Name)
        .input("qty", sql.Decimal(23, 4), sod.Qty)
        .input("unit", sql.VarChar(8), sod.Unit)
        .input("price", sql.Decimal(23, 4), sod.Price)
        .input("amount", sql.Decimal(23, 4), sod.Amount).query(`
          INSERT INTO SalesInvoiceDetail
            (SalesInvoiceDetailID, SalesInvoiceID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue,
             DiscRp, Amount, Name, Value, Netto, Description, WaiterName, Cashback, Total)
          VALUES
            (@id, @siId, @itemId, @qty, @unit, 1, 1, @price, 0, 0,
             0, @amount, @name, @amount, @amount, '', '', 0, NULL)
        `);
    }

    await pool
      .request()
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`UPDATE SalesOrder SET IsClosed = 1, IsInvoiced = 1, ModifiedDate = GETDATE() WHERE SalesOrderID = @soId`);
    await pool
      .request()
      .input("doId", sql.VarChar(16), deliveryOrderId)
      .query(`UPDATE DeliveryOrder SET IsClosed = 1, IsInvoiced = 1, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);

    await pool
      .request()
      .input("id", sql.Int, takeAwayMuatanId)
      .input("akunId", sql.Int, dicatatOlehAkunId)
      .input("doId", sql.VarChar(16), deliveryOrderId)
      .input("siId", sql.VarChar(16), salesInvoiceId).query(`
        UPDATE DashboardTakeAwayMuatan
        SET JamSelesaiMuat = GETDATE(), QtyDimuat = QtyDipesan, DicatatOlehAkunID = @akunId,
            DeliveryOrderID = @doId, SalesInvoiceID = @siId
        WHERE TakeAwayMuatanID = @id
      `);

    return { deliveryOrderId, salesInvoiceId };
  } catch (err) {
    if (salesInvoiceId) {
      await pool
        .request()
        .input("id", sql.VarChar(16), salesInvoiceId)
        .query(`UPDATE SalesInvoice SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE SalesInvoiceID = @id`);
      await pool
        .request()
        .input("siId", sql.VarChar(16), salesInvoiceId)
        .query(`DELETE FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId`);
    }
    if (deliveryOrderId) {
      await pool
        .request()
        .input("id", sql.VarChar(16), deliveryOrderId)
        .query(`UPDATE DeliveryOrder SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @id`);
      await pool
        .request()
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .query(`DELETE FROM DeliveryOrderDetail WHERE DeliveryOrderID = @doId`);
    }
    throw err;
  }
}
```

Also update the file's import line to add `getNaiveWibTransDate`:

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { getNaiveWibTransDate } from "@/lib/business-date";
import type { KantongVariant } from "@/lib/queries/sales-order";
```

- [ ] **Step 2: Trim `takeaway.ts`**

Replace the entire contents of `src/lib/queries/takeaway.ts` with:

```ts
import { createSalesOrderManual, softDeleteSalesOrder, type KantongVariant } from "@/lib/queries/sales-order";
import { createTakeAwayMuatanDraft, TAKEAWAY_SALESMAN_ID } from "@/lib/queries/takeaway-muatan";

export interface CreateTakeAwayInput {
  businessPartnerId: string;
  variant: KantongVariant;
  qtyKantong: number;
  bonusQty: number;
  deliveryDateTime: Date;
}

export interface CreateTakeAwayResult {
  salesOrderId: string;
}

// TakeAway ("Ambil Sendiri") skips the whole Jadwal/Armada flow entirely.
// As of docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md
// it no longer creates DeliveryOrder/SalesInvoice immediately either — only
// the SalesOrder + a Draft DashboardTakeAwayMuatan row are created here. The
// real DO/SI documents are created later, at "Selesai Muat" time in
// produksi-app (see takeAwaySelesaiMuat in takeaway-muatan.ts), mirroring
// how non-TakeAway deliveries only get their documents at Selesai Muat.
export async function createTakeAwayPemesanan(input: CreateTakeAwayInput): Promise<CreateTakeAwayResult> {
  const salesOrderId = await createSalesOrderManual({
    businessPartnerId: input.businessPartnerId,
    variant: input.variant,
    qtyKantong: input.qtyKantong,
    bonusQty: input.bonusQty,
    deliveryDateTime: input.deliveryDateTime,
    salesmanId: TAKEAWAY_SALESMAN_ID,
  });

  try {
    await createTakeAwayMuatanDraft(salesOrderId, input.variant, input.qtyKantong);
  } catch (err) {
    await softDeleteSalesOrder(salesOrderId);
    throw err;
  }

  return { salesOrderId };
}
```

- [ ] **Step 3: Fix `createTakeAwayPemesananAction` in `pemesanan/actions.ts`**

In `src/app/mkesindo/(dashboard)/pemesanan/actions.ts`, remove the now-unused imports and fix the action:

Change:
```ts
import { enqueuePrintJob } from "@/lib/queries/print-queue";
import { getPool } from "@/lib/db";
import { runAction, type ActionResult } from "@/lib/action-result";
```
to:
```ts
import { runAction, type ActionResult } from "@/lib/action-result";
```

Change:
```ts
export async function createTakeAwayPemesananAction(input: CreateTakeAwayInput): Promise<ActionResult<CreateTakeAwayResult>> {
  return runAction(async () => {
    const result = await createTakeAwayPemesanan(input);
    const pool = await getPool();
    await enqueuePrintJob(pool, result.salesInvoiceId, null, false);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}
```
to:
```ts
export async function createTakeAwayPemesananAction(input: CreateTakeAwayInput): Promise<ActionResult<CreateTakeAwayResult>> {
  return runAction(async () => {
    const result = await createTakeAwayPemesanan(input);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
    revalidatePath("/mkesindo/produksi-app");
    return result;
  });
}
```

- [ ] **Step 4: Fix the success handling in `pemesanan-form-dialog.tsx`**

In `src/components/dashboard/pemesanan-form-dialog.tsx`, remove the now-unused import:

Change:
```ts
import { triggerPrintQueuePollNow } from "@/components/dashboard/print-queue-poller";
```
Delete this line entirely (it has no other use in the file).

Change the TakeAway success branch:
```ts
        if (!result.success) {
          setError(result.error);
          return;
        }
        toast.success("SI ditambahkan ke antrian cetak.");
        triggerPrintQueuePollNow();
        handleOpenChange(false);
```
to:
```ts
        if (!result.success) {
          setError(result.error);
          return;
        }
        toast.success("Pesanan TakeAway dibuat — menunggu diproses produksi.");
        handleOpenChange(false);
```

- [ ] **Step 5: Update the two stale file-name references in `pengiriman-jadwal.ts`**

In `src/lib/queries/pengiriman-jadwal.ts`, these two comments reference `takeaway.ts` for the SalesInvoice column shape — the shape itself didn't change, but it no longer lives in that file. Update both:

Around line 1945, change:
```ts
// Same numbering shape as nextDOVoucherSeq, MKE/SI/ prefix (matches the real
// SalesInvoice VoucherNo pattern already seen in takeaway.ts's own
// createTakeAwayPemesanan, e.g. "MKE/SI/000123/2026-08/003/001").
```
to:
```ts
// Same numbering shape as nextDOVoucherSeq, MKE/SI/ prefix (matches the real
// SalesInvoice VoucherNo pattern already seen in takeaway-muatan.ts's own
// takeAwaySelesaiMuat, e.g. "MKE/SI/000123/2026-08/003/001").
```

Around line 2003, change:
```ts
// becomes real DeliveryOrder AND SalesInvoice documents (reusing
// createTakeAwayPemesanan's exact SalesInvoice column/value shape from
// takeaway.ts) so a Surat SI can be printed and handed to the driver before
```
to:
```ts
// becomes real DeliveryOrder AND SalesInvoice documents (reusing
// takeAwaySelesaiMuat's exact SalesInvoice column/value shape from
// takeaway-muatan.ts) so a Surat SI can be printed and handed to the driver before
```

Around line 2015, change:
```ts
// from createTakeAwayPemesanan's (takeaway.ts) compensating-cleanup-only
```
to:
```ts
// from takeAwaySelesaiMuat's (takeaway-muatan.ts) compensating-cleanup-only
```

Around line 2115, change:
```ts
  // both. This function never flipped them — createTakeAwayPemesanan
  // (takeaway.ts) already does this correctly for its own chain, and this
```
to:
```ts
  // both. This function never flipped them — takeAwaySelesaiMuat
  // (takeaway-muatan.ts) already does this correctly for its own chain, and this
```

- [ ] **Step 6: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: no errors. This confirms every consumer of the changed `CreateTakeAwayResult` shape was fixed.

- [ ] **Step 7: Verify end-to-end with a scratch script**

Create `scripts/scratch-verify-takeaway-selesai-muat.ts`:

```ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";
import { createTakeAwayPemesanan } from "../src/lib/queries/takeaway";
import { getTakeAwayMuatanPending, takeAwayMulaiMuat, takeAwaySelesaiMuat } from "../src/lib/queries/takeaway-muatan";

const TEST_BUSINESS_PARTNER_ID = "01109"; // "Direct Customer" — the real historical TakeAway BP, see takeaway.ts's old comment.
const TEST_AKUN_ID = 1; // any existing akun id in DashboardAkun works — only used as DicatatOlehAkunID.

async function main() {
  const pool = await getPool();

  const result = await createTakeAwayPemesanan({
    businessPartnerId: TEST_BUSINESS_PARTNER_ID,
    variant: "5kg",
    qtyKantong: 2,
    bonusQty: 0,
    deliveryDateTime: new Date(),
  });
  console.log("Created SO:", result.salesOrderId);

  const doCheck = await pool
    .request()
    .input("soId", sql.VarChar(16), result.salesOrderId)
    .query(`SELECT COUNT(*) AS Cnt FROM DeliveryOrder WHERE SalesOrderID = @soId`);
  console.log("DeliveryOrder count immediately after creation (should be 0):", (doCheck.recordset[0] as { Cnt: number }).Cnt);

  const pending = await getTakeAwayMuatanPending();
  const row = pending.find((r) => r.salesOrderId === result.salesOrderId);
  if (!row) throw new Error("FAIL: not in pending list");
  console.log("Pending row:", row);

  await takeAwayMulaiMuat(row.takeAwayMuatanId);
  const selesaiResult = await takeAwaySelesaiMuat(row.takeAwayMuatanId, TEST_AKUN_ID);
  console.log("Selesai Muat result:", selesaiResult);

  const doCheckAfter = await pool
    .request()
    .input("doId", sql.VarChar(16), selesaiResult.deliveryOrderId)
    .query(`SELECT TransDate, IsClosed, IsInvoiced FROM DeliveryOrder WHERE DeliveryOrderID = @doId`);
  console.log("DeliveryOrder after Selesai Muat:", doCheckAfter.recordset[0]);

  const siCheckAfter = await pool
    .request()
    .input("siId", sql.VarChar(16), selesaiResult.salesInvoiceId)
    .query(`SELECT TransDate, Amount FROM SalesInvoice WHERE SalesInvoiceID = @siId`);
  console.log("SalesInvoice after Selesai Muat:", siCheckAfter.recordset[0]);

  console.log("Done. This created a REAL SalesOrder/DeliveryOrder/SalesInvoice in the live database — this is expected and matches how TakeAway has always been tested this session (no staging environment exists).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Before running, check that `TEST_AKUN_ID = 1` is a real row in the Postgres `akun` table (any existing account id works, it's only stored as `DicatatOlehAkunID`) — adjust the constant if not.

Run: `npx tsx scripts/scratch-verify-takeaway-selesai-muat.ts`
Expected: "DeliveryOrder count immediately after creation (should be 0): 0"; the pending row shows `qtyDipesan: 2, variant: '5kg'`; "Selesai Muat result" shows real `deliveryOrderId`/`salesInvoiceId`; the DO/SI rows both show a `TransDate` and `IsClosed`/`IsInvoiced` = 1 (DO) / correct `Amount` (SI).

Then delete the scratch script:

```bash
rm scripts/scratch-verify-takeaway-selesai-muat.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/takeaway.ts src/lib/queries/takeaway-muatan.ts "src/app/mkesindo/(dashboard)/pemesanan/actions.ts" src/components/dashboard/pemesanan-form-dialog.tsx src/lib/queries/pengiriman-jadwal.ts
git commit -m "feat: defer TakeAway DO/SI/print creation to a new Selesai Muat step"
```

---

### Task 4: Cascade TakeAway cancellation

**Files:**
- Modify: `src/lib/queries/pemesanan.ts`

**Interfaces:**
- Consumes: `softDeleteTakeAwayMuatanForSalesOrder` from `@/lib/queries/takeaway-muatan` (Task 2).

- [ ] **Step 1: Wire the cascade into `deletePemesanan`**

In `src/lib/queries/pemesanan.ts`, add the import:

```ts
import { softDeleteTakeAwayMuatanForSalesOrder } from "@/lib/queries/takeaway-muatan";
```

Change `deletePemesanan` (currently):
```ts
export async function deletePemesanan(salesOrderId: string): Promise<void> {
  const pool = await getPool();
  const doCheck = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`SELECT COUNT(*) AS Cnt FROM DeliveryOrder WHERE SalesOrderID = @soId AND IsDeleted = 0`);
  if ((doCheck.recordset[0] as { Cnt: number }).Cnt > 0) {
    throw new AppError("Pesanan ini sudah terkirim (DO sudah terbit) — tidak bisa dihapus.");
  }

  const current = await getCurrentAssignment(salesOrderId);
  if (current) {
    await removeSalesOrderFromJadwal(current.jadwalId, salesOrderId);
  }
  await softDeleteSalesOrder(salesOrderId);
}
```
to:
```ts
export async function deletePemesanan(salesOrderId: string): Promise<void> {
  const pool = await getPool();
  const doCheck = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`SELECT COUNT(*) AS Cnt FROM DeliveryOrder WHERE SalesOrderID = @soId AND IsDeleted = 0`);
  if ((doCheck.recordset[0] as { Cnt: number }).Cnt > 0) {
    throw new AppError("Pesanan ini sudah terkirim (DO sudah terbit) — tidak bisa dihapus.");
  }

  const current = await getCurrentAssignment(salesOrderId);
  if (current) {
    await removeSalesOrderFromJadwal(current.jadwalId, salesOrderId);
  }
  // No-op for a non-TakeAway SO (no matching row) — see
  // softDeleteTakeAwayMuatanForSalesOrder's own comment.
  await softDeleteTakeAwayMuatanForSalesOrder(salesOrderId);
  await softDeleteSalesOrder(salesOrderId);
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Verify with a scratch script**

Create `scripts/scratch-verify-takeaway-cancel.ts`:

```ts
import "dotenv/config";
import { createTakeAwayPemesanan } from "../src/lib/queries/takeaway";
import { deletePemesanan } from "../src/lib/queries/pemesanan";
import { getTakeAwayMuatanPending } from "../src/lib/queries/takeaway-muatan";

const TEST_BUSINESS_PARTNER_ID = "01109";

async function main() {
  const result = await createTakeAwayPemesanan({
    businessPartnerId: TEST_BUSINESS_PARTNER_ID,
    variant: "5kg",
    qtyKantong: 1,
    bonusQty: 0,
    deliveryDateTime: new Date(),
  });
  console.log("Created SO:", result.salesOrderId);

  const beforeDelete = await getTakeAwayMuatanPending();
  console.log("In pending list before cancel:", beforeDelete.some((r) => r.salesOrderId === result.salesOrderId));

  await deletePemesanan(result.salesOrderId);

  const afterDelete = await getTakeAwayMuatanPending();
  console.log("In pending list after cancel (should be false):", afterDelete.some((r) => r.salesOrderId === result.salesOrderId));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/scratch-verify-takeaway-cancel.ts`
Expected: "In pending list before cancel: true", "In pending list after cancel (should be false): false".

Then delete the scratch script:

```bash
rm scripts/scratch-verify-takeaway-cancel.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/pemesanan.ts
git commit -m "fix: cascade-cancel DashboardTakeAwayMuatan when a TakeAway SO is deleted"
```

---

### Task 5: Server actions for produksi-app

**Files:**
- Modify: `src/app/mkesindo/produksi/actions.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-3 (`getTakeAwayMuatanPending`, `getTakeAwayMuatanSelesaiRecent`, `takeAwayMulaiMuat`, `takeAwaySelesaiMuat`, their row types), `enqueuePrintJob` from `@/lib/queries/print-queue` (existing), `getPool` from `@/lib/db` (existing).
- Produces (Tasks 7-8 consume these):
  - `getTakeAwayMuatanPendingAction(): Promise<ActionResult<TakeAwayMuatanPendingRow[]>>`
  - `getTakeAwayMuatanSelesaiAction(): Promise<ActionResult<TakeAwayMuatanSelesaiRow[]>>`
  - `takeAwayMulaiMuatAction(takeAwayMuatanId: number): Promise<ActionResult<void>>`
  - `takeAwaySelesaiMuatAction(takeAwayMuatanId: number): Promise<ActionResult<void>>`

- [ ] **Step 1: Add imports**

In `src/app/mkesindo/produksi/actions.ts`, add:

```ts
import { getPool } from "@/lib/db";
import { enqueuePrintJob } from "@/lib/queries/print-queue";
import {
  getTakeAwayMuatanPending,
  getTakeAwayMuatanSelesaiRecent,
  takeAwayMulaiMuat,
  takeAwaySelesaiMuat,
  type TakeAwayMuatanPendingRow,
  type TakeAwayMuatanSelesaiRow,
} from "@/lib/queries/takeaway-muatan";
```

- [ ] **Step 2: Add the four actions**

Append to `src/app/mkesindo/produksi/actions.ts`:

```ts
export async function getTakeAwayMuatanPendingAction(): Promise<ActionResult<TakeAwayMuatanPendingRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getTakeAwayMuatanPending();
  });
}

export async function getTakeAwayMuatanSelesaiAction(): Promise<ActionResult<TakeAwayMuatanSelesaiRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getTakeAwayMuatanSelesaiRecent();
  });
}

export async function takeAwayMulaiMuatAction(takeAwayMuatanId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    await takeAwayMulaiMuat(takeAwayMuatanId);
    revalidatePath("/mkesindo/produksi-app");
  });
}

// Menyelesaikan muat: membuat DeliveryOrder+SalesInvoice yang sebenarnya
// (ditunda dari saat order dibuat sampai di sini — lihat takeAwaySelesaiMuat
// di takeaway-muatan.ts), lalu mengantre SI untuk dicetak — persis seperti
// enqueuePrintJob yang dulu dipanggil langsung dari createTakeAwayPemesananAction.
export async function takeAwaySelesaiMuatAction(takeAwayMuatanId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const result = await takeAwaySelesaiMuat(takeAwayMuatanId, Number(session.user.id));
    const pool = await getPool();
    await enqueuePrintJob(pool, result.salesInvoiceId, null, false);
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
    revalidatePath("/mkesindo/laporan");
  });
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/mkesindo/produksi/actions.ts
git commit -m "feat: add produksi-app server actions for TakeAway Mulai Muat/Selesai Muat"
```

---

### Task 6: Extend `getQtyRecapForShift` with TakeAway quantities

**Files:**
- Modify: `src/lib/queries/aktivitas-produksi.ts:312-350`

**Interfaces:**
- Consumes: `DashboardTakeAwayMuatan` table (Task 1). No new imports needed — `getPool`, `sql`, `naiveWibToUtcInstant`, `getShiftWindow` are already imported in this file.
- Produces: `getQtyRecapForShift`'s return shape (`QtyRecap`) is unchanged — TakeAway quantities are folded into the existing `total10KG`/`total5KG`/`totalKantongEkivalen` fields, not added as new fields.

- [ ] **Step 1: Rewrite the function**

Replace `getQtyRecapForShift` (lines 312-350) with:

```ts
export async function getQtyRecapForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<QtyRecap> {
  const pool = await getPool();

  const perMesinResult = await pool
    .request()
    .input("tanggalLabel", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift)
    .query(`
      SELECT b.MesinID, m.Nama AS MesinNama, SUM(b.Qty10KG) AS Qty10KG
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0 AND b.TanggalLabel = @tanggalLabel AND b.Shift = @shift
      GROUP BY b.MesinID, m.Nama
      ORDER BY m.Nama
    `);
  const perMesin = (perMesinResult.recordset as { MesinID: number; MesinNama: string; Qty10KG: number }[]).map((r) => ({
    mesinId: r.MesinID,
    mesinNama: r.MesinNama,
    qty10KG: r.Qty10KG,
  }));
  const total10KGBatch = perMesin.reduce((sum, r) => sum + r.qty10KG, 0);

  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const window = getShiftWindow(businessDate, shift, "work");
  const startUtc = naiveWibToUtcInstant(window.start);
  const endUtc = naiveWibToUtcInstant(window.end);
  const qty5Result = await pool
    .request()
    .input("start", sql.DateTime, startUtc)
    .input("end", sql.DateTime, endUtc)
    .query(`
      SELECT ISNULL(SUM(Qty5KGDimuat), 0) AS Total
      FROM DashboardPengirimanJadwal
      WHERE IsDeleted = 0 AND JamSelesaiMuat IS NOT NULL AND JamSelesaiMuat BETWEEN @start AND @end
    `);
  const total5KGJadwal = (qty5Result.recordset[0] as { Total: number }).Total;

  // TakeAway 10kg/5kg — dicatat manual tanpa FIFO (sama seperti Qty5KGDimuat
  // di atas), diselesaikan lewat Selesai Muat produksi-app milik TakeAway
  // sendiri (JamSelesaiMuat true-UTC, window shift yang sama dipakai ulang).
  // Digabung ke total yang sudah ada, bukan kategori laporan terpisah — lihat
  // docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md.
  const takeAwayResult = await pool
    .request()
    .input("start", sql.DateTime, startUtc)
    .input("end", sql.DateTime, endUtc)
    .query(`
      SELECT Variant, ISNULL(SUM(QtyDimuat), 0) AS Total
      FROM DashboardTakeAwayMuatan
      WHERE IsDeleted = 0 AND JamSelesaiMuat IS NOT NULL AND JamSelesaiMuat BETWEEN @start AND @end
      GROUP BY Variant
    `);
  const takeAwayRows = takeAwayResult.recordset as { Variant: string; Total: number }[];
  const takeAway10KG = takeAwayRows.find((r) => r.Variant === "10kg")?.Total ?? 0;
  const takeAway5KG = takeAwayRows.find((r) => r.Variant === "5kg")?.Total ?? 0;

  const total10KG = total10KGBatch + takeAway10KG;
  const total5KG = total5KGJadwal + takeAway5KG;

  return { perMesin, total10KG, total5KG, totalKantongEkivalen: total10KG + total5KG / 2 };
}
```

Also update the comment block directly above the function (currently describing only the 10KG/5KG-from-Jadwal sources) to mention TakeAway:

Change:
```ts
// 10KG: grouped by DashboardProduksiBatch's OWN MesinID/TanggalLabel/
// Shift columns (copied from Kualitas at insert time — see createBatch
// in produksi-warehouse.ts) — NOT via a join to DashboardProduksiKualitas,
// since KualitasID is nullable on older batches and Batch already
// carries everything needed directly.
// 5KG: summed from Qty5KGDimuat across Jadwal whose JamSelesaiMuat falls
// in this shift's window — true-UTC column, so the naive-WIB shift
// window is converted via naiveWibToUtcInstant() before the SQL
// comparison. Total only, no per-machine breakdown (no machine link
// exists on this data at all).
```
to:
```ts
// 10KG: grouped by DashboardProduksiBatch's OWN MesinID/TanggalLabel/
// Shift columns (copied from Kualitas at insert time — see createBatch
// in produksi-warehouse.ts) — NOT via a join to DashboardProduksiKualitas,
// since KualitasID is nullable on older batches and Batch already
// carries everything needed directly.
// 5KG: summed from Qty5KGDimuat across Jadwal whose JamSelesaiMuat falls
// in this shift's window — true-UTC column, so the naive-WIB shift
// window is converted via naiveWibToUtcInstant() before the SQL
// comparison. Total only, no per-machine breakdown (no machine link
// exists on this data at all).
// TakeAway 10KG/5KG: same JamSelesaiMuat-in-shift-window pattern, from
// DashboardTakeAwayMuatan (its own manual, non-FIFO qty, see
// takeaway-muatan.ts) — folded into total10KG/total5KG below rather than
// broken out separately.
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Verify with a scratch script**

Create `scripts/scratch-verify-qty-recap-takeaway.ts` — creates a TakeAway order, runs it through Mulai Muat/Selesai Muat, then checks the current shift's recap includes it:

```ts
import "dotenv/config";
import { createTakeAwayPemesanan } from "../src/lib/queries/takeaway";
import { takeAwayMulaiMuat, takeAwaySelesaiMuat, getTakeAwayMuatanPending } from "../src/lib/queries/takeaway-muatan";
import { getQtyRecapForShift } from "../src/lib/queries/aktivitas-produksi";
import { getCurrentShift } from "../src/lib/queries/aktivitas-produksi";

const TEST_BUSINESS_PARTNER_ID = "01109";
const TEST_AKUN_ID = 1;

async function main() {
  const { tanggalUsaha, shift } = getCurrentShift();
  const before = await getQtyRecapForShift(tanggalUsaha, shift);
  console.log("total10KG before:", before.total10KG, "total5KG before:", before.total5KG);

  const result = await createTakeAwayPemesanan({
    businessPartnerId: TEST_BUSINESS_PARTNER_ID,
    variant: "10kg",
    qtyKantong: 4,
    bonusQty: 0,
    deliveryDateTime: new Date(),
  });
  const pending = await getTakeAwayMuatanPending();
  const row = pending.find((r) => r.salesOrderId === result.salesOrderId)!;
  await takeAwayMulaiMuat(row.takeAwayMuatanId);
  await takeAwaySelesaiMuat(row.takeAwayMuatanId, TEST_AKUN_ID);

  const after = await getQtyRecapForShift(tanggalUsaha, shift);
  console.log("total10KG after (should be +4):", after.total10KG, "total5KG after (unchanged):", after.total5KG);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/scratch-verify-qty-recap-takeaway.ts`
Expected: `total10KG after` is exactly 4 more than `total10KG before`; `total5KG after` equals `total5KG before`.

Then delete the scratch script:

```bash
rm scripts/scratch-verify-qty-recap-takeaway.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/aktivitas-produksi.ts
git commit -m "feat: fold TakeAway quantities into the production report's qty recap"
```

---

### Task 7: `TakeAwayMuatanList` UI component

**Files:**
- Create: `src/components/produksi-app/takeaway-muatan-list.tsx`

**Interfaces:**
- Consumes: `takeAwayMulaiMuatAction`, `takeAwaySelesaiMuatAction` from `@/app/mkesindo/produksi/actions` (Task 5); `TakeAwayMuatanPendingRow`, `TakeAwayMuatanSelesaiRow` from `@/lib/queries/takeaway-muatan` (Task 2); `ActionResult` from `@/lib/action-result`.
- Produces: `TakeAwayMuatanList({ initialPending, fetchSelesaiList, onAfterMuat })` component — Task 8 renders this.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { takeAwayMulaiMuatAction, takeAwaySelesaiMuatAction } from "@/app/mkesindo/produksi/actions";
import type { ActionResult } from "@/lib/action-result";
import type { TakeAwayMuatanPendingRow, TakeAwayMuatanSelesaiRow } from "@/lib/queries/takeaway-muatan";

const VARIANT_LABEL: Record<string, string> = { "5kg": "kantong 5kg", "10kg": "kantong 10kg" };

export function TakeAwayMuatanList({
  initialPending,
  fetchSelesaiList,
  onAfterMuat,
}: {
  initialPending: TakeAwayMuatanPendingRow[];
  fetchSelesaiList: () => Promise<ActionResult<TakeAwayMuatanSelesaiRow[]>>;
  onAfterMuat: () => void;
}) {
  const [pendingList, setPendingList] = useState(initialPending);
  const [selected, setSelected] = useState<TakeAwayMuatanPendingRow | null>(null);
  const [selesaiList, setSelesaiList] = useState<TakeAwayMuatanSelesaiRow[] | null>(null);

  function refreshSelesaiList() {
    fetchSelesaiList().then((result) => {
      if (result.success) setSelesaiList(result.data);
    });
  }

  useEffect(() => {
    refreshSelesaiList();
    // Only ever meant to fire once on mount — fetchSelesaiList is a stable
    // action reference for this component instance's whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDone(takeAwayMuatanId: number) {
    setPendingList((prev) => prev.filter((r) => r.takeAwayMuatanId !== takeAwayMuatanId));
    setSelected(null);
    refreshSelesaiList();
    onAfterMuat();
  }

  function handleMulaiMuatDone(takeAwayMuatanId: number) {
    const stamped = new Date();
    setPendingList((prev) => prev.map((r) => (r.takeAwayMuatanId === takeAwayMuatanId ? { ...r, jamMulaiMuat: stamped } : r)));
    setSelected((prev) => (prev && prev.takeAwayMuatanId === takeAwayMuatanId ? { ...prev, jamMulaiMuat: stamped } : prev));
  }

  if (selected) {
    return (
      <IsiMuatanScreen
        row={selected}
        onBack={() => setSelected(null)}
        onMulaiMuatDone={handleMulaiMuatDone}
        onDone={() => handleDone(selected.takeAwayMuatanId)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-sm font-medium text-muted-foreground">TakeAway — Menunggu/Sedang Dimuat</p>
      {pendingList.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">Tidak ada order TakeAway yang menunggu diproses.</p>
      ) : (
        pendingList.map((row) => (
          <button
            key={row.takeAwayMuatanId}
            type="button"
            onClick={() => setSelected(row)}
            className="relative rounded-lg border border-border p-3 text-left"
          >
            <p className="font-semibold">{row.customerName}</p>
            <p className="mt-1 text-sm">
              {row.qtyDipesan} {VARIANT_LABEL[row.variant] ?? row.variant}
            </p>
            {row.jamMulaiMuat != null && (
              <span className="absolute right-3 top-3 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">
                Sedang dimuat
              </span>
            )}
          </button>
        ))
      )}

      {selesaiList != null && selesaiList.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">TakeAway — Baru Selesai</p>
          {selesaiList.map((row) => (
            <div key={row.takeAwayMuatanId} className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="font-medium">{row.customerName}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(row.jamSelesaiMuat).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" • "}
                {new Date(row.jamSelesaiMuat).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {row.qtyDimuat} {VARIANT_LABEL[row.variant] ?? row.variant}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Step 1/2 gate: a row already resumed after backing out mid-flow skips
// straight to the confirmation screen (row.jamMulaiMuat is already set), a
// fresh one shows the explicit "Mulai Muat" screen first — same pattern as
// IsiMuatanScreen in kartu-pengiriman-list.tsx.
function IsiMuatanScreen({
  row,
  onBack,
  onMulaiMuatDone,
  onDone,
}: {
  row: TakeAwayMuatanPendingRow;
  onBack: () => void;
  onMulaiMuatDone: (takeAwayMuatanId: number) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"mulai" | "konfirmasi">(row.jamMulaiMuat != null ? "konfirmasi" : "mulai");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (step === "mulai") {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Button variant="outline" size="sm" onClick={onBack} className="w-fit">
          Kembali
        </Button>
        <p className="font-semibold">{row.customerName}</p>
        <p className="text-sm">
          {row.qtyDipesan} {VARIANT_LABEL[row.variant] ?? row.variant}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await takeAwayMulaiMuatAction(row.takeAwayMuatanId);
              if (!result.success) {
                setError(result.error);
                return;
              }
              onMulaiMuatDone(row.takeAwayMuatanId);
              setStep("konfirmasi");
            });
          }}
        >
          {pending ? "Memproses..." : "Mulai Muat"}
        </Button>
      </div>
    );
  }

  return <KonfirmasiScreen row={row} onBack={onBack} onDone={onDone} />;
}

function KonfirmasiScreen({
  row,
  onBack,
  onDone,
}: {
  row: TakeAwayMuatanPendingRow;
  onBack: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSelesai() {
    startTransition(async () => {
      const result = await takeAwaySelesaiMuatAction(row.takeAwayMuatanId);
      if (!result.success) {
        setConfirmOpen(false);
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <Button variant="outline" size="sm" onClick={onBack} className="w-fit">
        Kembali
      </Button>
      <p className="font-semibold">{row.customerName}</p>
      <p className="text-sm">
        Qty dimuat: {row.qtyDipesan} {VARIANT_LABEL[row.variant] ?? row.variant} (sesuai pesanan)
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending} onClick={() => setConfirmOpen(true)}>
        Selesai Muat
      </Button>

      <Dialog open={confirmOpen} onOpenChange={(open) => !open && !pending && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Muat — {row.customerName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Surat Jalan/Invoice akan diterbitkan dan masuk antrian cetak untuk {row.qtyDipesan}{" "}
            {VARIANT_LABEL[row.variant] ?? row.variant}.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setConfirmOpen(false)}>
              Tidak
            </Button>
            <Button disabled={pending} onClick={handleSelesai}>
              {pending ? "Memproses..." : "Ya, Selesai Muat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi-app/takeaway-muatan-list.tsx
git commit -m "feat: add TakeAwayMuatanList component for produksi-app"
```

---

### Task 8: Wire `TakeAwayMuatanList` into produksi-app's Stok Es tab

**Files:**
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx`
- Modify: `src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx`

**Interfaces:**
- Consumes: `TakeAwayMuatanList` (Task 7), `getTakeAwayMuatanPendingAction`/`getTakeAwayMuatanSelesaiAction` (Task 5), `getTakeAwayMuatanPending` (Task 2, called server-side in `page.tsx`), `TakeAwayMuatanPendingRow` type (Task 2).

- [ ] **Step 1: Add the new prop, state, and fetch logic to `produksi-tab-shell.tsx`**

Add to the imports block:
```ts
import { TakeAwayMuatanList } from "@/components/produksi-app/takeaway-muatan-list";
```
and add to the existing `import { ... } from "@/app/mkesindo/produksi/actions";` block:
```ts
  getTakeAwayMuatanPendingAction,
  getTakeAwayMuatanSelesaiAction,
```
and add a new type import:
```ts
import type { TakeAwayMuatanPendingRow } from "@/lib/queries/takeaway-muatan";
```

Add to the component's props type:
```ts
  initialTakeAwayPending?: TakeAwayMuatanPendingRow[];
```
(insert alongside `initialWarehouse`/`initialMesin`)

Add to the destructured props and state:
```ts
  initialTakeAwayPending,
```
```ts
  const [takeAwayPending, setTakeAwayPending] = useState<TakeAwayMuatanPendingRow[] | null>(initialTakeAwayPending ?? null);
```

Add a refresh function next to `refreshWarehouse`:
```ts
  function refreshTakeAway() {
    setTakeAwayPending(null);
  }
```

In the `useEffect`'s load function, after the existing `if (activeTab === "warehouse" && mesin === null) { ... }` block (and before the `kualitas` blocks), add:
```ts
      if (activeTab === "warehouse" && takeAwayPending === null) {
        setLoadingTab("warehouse");
        const result = await getTakeAwayMuatanPendingAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setTakeAwayPending(result.data);
        setLoadingTab(null);
      }
```

Add `takeAwayPending` to the `useEffect`'s dependency array:
```ts
  }, [activeTab, kartuPengiriman, riwayat, warehouse, mesin, takeAwayPending, kualitas, bahanBaku, aktivitasProduksi]);
```

- [ ] **Step 2: Render `TakeAwayMuatanList` alongside `WarehouseView`**

Change:
```tsx
        {visited.has("warehouse") && warehouse && mesin && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "warehouse" && "hidden")}>
            <WarehouseView posisi={warehouse} onAfterTambah={refreshWarehouse} />
          </div>
        )}
```
to:
```tsx
        {visited.has("warehouse") && warehouse && mesin && takeAwayPending && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "warehouse" && "hidden")}>
            <WarehouseView posisi={warehouse} onAfterTambah={refreshWarehouse} />
            <TakeAwayMuatanList
              initialPending={takeAwayPending}
              fetchSelesaiList={getTakeAwayMuatanSelesaiAction}
              onAfterMuat={refreshTakeAway}
            />
          </div>
        )}
```

- [ ] **Step 3: Fetch initial data server-side in `warehouse/page.tsx`**

Replace the contents of `src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx`:

```tsx
import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getUserById } from "@/lib/queries/akun";
import { getTakeAwayMuatanPending } from "@/lib/queries/takeaway-muatan";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Stok Es" };

export default async function ProduksiAppWarehousePage() {
  const session = await requireProduksi();
  const [posisi, mesinList, profile, takeAwayPending] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getUserById(Number(session.user.id)),
    getTakeAwayMuatanPending(),
  ]);

  return (
    <ProduksiTabShell
      initialTab="warehouse"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialWarehouse={posisi}
      initialMesin={mesinList}
      initialTakeAwayPending={takeAwayPending}
    />
  );
}
```

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx"
git commit -m "feat: show TakeAwayMuatanList in produksi-app's Stok Es tab"
```

---

### Task 9: End-to-end manual verification

This app has no automated test suite and no staging environment — this task verifies the full feature by actually using it, the same way every other produksi-app feature in this codebase has been verified this session.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server and open produksi-app**

Use the project's preview tooling to start the `dev` script and navigate to `/mkesindo/pemesanan`, logged in as an account with module access to Pemesanan.

- [ ] **Step 2: Create a real TakeAway order**

In the "Buat Pesanan" dialog, check TakeAway, pick a real Mitra, choose a small qty (e.g. 1 kantong 5kg), submit. Confirm the toast now reads "Pesanan TakeAway dibuat — menunggu diproses produksi." (not the old "SI ditambahkan ke antrian cetak.").

- [ ] **Step 3: Confirm nothing printed yet**

Check the print-queue view (wherever `DashboardPrintQueue` history is shown in this app, e.g. an admin print-management page) — confirm no new Pending/Dicetak row appeared for this order yet.

- [ ] **Step 4: Process it in produksi-app**

Log in as (or switch to) an account with `isProduksi = true`. Open `/mkesindo/produksi-app/warehouse` ("Stok Es" tab). Confirm the new order appears under "TakeAway — Menunggu/Sedang Dimuat" with the right customer name and qty. Tap it, tap "Mulai Muat", confirm it moves to the qty-confirmation screen showing the same qty "(sesuai pesanan)". Tap "Selesai Muat", confirm in the dialog, confirm.

- [ ] **Step 5: Confirm the order completed correctly**

Confirm the card now appears under "TakeAway — Baru Selesai" with the completion time and qty. Check the print-queue view again — confirm a new row now exists for this order's SalesInvoiceID with `JadwalID` null. Check `/mkesindo/delivery` or the SO/DO/SI admin views — confirm the DeliveryOrder and SalesInvoice now exist for this SalesOrder, with `IsClosed`/`IsInvoiced` = 1.

- [ ] **Step 6: Confirm the production report picked it up**

Open `/mkesindo/produksi-app/aktivitas-produksi` (or the desktop `/mkesindo/laporan` equivalent) for the current shift. Confirm the kantong-ekivalen total increased by the expected amount for the variant used (full amount for 10kg, half for 5kg).

- [ ] **Step 7: Confirm cancellation still works for a not-yet-started order**

Create a second small TakeAway order, do NOT process it in produksi-app, and cancel/delete it from wherever `/mkesindo/pemesanan`'s pesanan list offers a delete action for an open SO. Confirm it disappears from produksi-app's "Menunggu/Sedang Dimuat" list too.

- [ ] **Step 8: Report results**

No commit for this task — it's verification only. If any step fails, return to the relevant earlier task, fix the root cause, and re-run this task's steps from the top.
