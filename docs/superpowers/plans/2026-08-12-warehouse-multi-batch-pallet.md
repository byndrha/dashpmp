# Warehouse Multi-Batch Pallet + 5KG Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single MKEsindo Produksi pallet position hold multiple simultaneously-active batches (capped at 120 kantong 10kg total per position), instead of the current "one batch per position until exhausted" rule — and decouple 5KG packaging entirely from pallet/batch stock tracking, since it's processed immediately without FIFO.

**Architecture:** `DashboardProduksiPalletPosisi.BatchIDAktif` (single nullable FK) stops being the source of truth for occupancy — every query and mutation instead derives "is this position occupied / how much room is left" from an aggregate over `DashboardProduksiBatch` rows referencing that `PosisiID` with `SisaQty10KG > 0`. `createBatch`'s atomic single-slot claim (`WHERE BatchIDAktif IS NULL`) is replaced by an atomic capacity check (`SUM(SisaQty10KG) <= 120`, row-locked). 5KG is dropped from `DashboardProduksiBatch`/`DashboardProduksiMuatanDetail` entirely and replaced by one `DashboardPengirimanJadwal.Qty5KGDimuat` figure per Kartu Pengiriman, set once during "Isi Muatan" alongside (not mixed into) the per-batch 10kg pallet allocation.

**Tech Stack:** Next.js 16 (App Router, Server Actions), MSSQL (`mssql` via `src/lib/db.ts`), shadcn/base-ui components, Tailwind.

## Global Constraints

- Every new Server Action that can throw a business-validation error MUST be wrapped in `runAction()` (`src/lib/action-result.ts`) and throw `AppError`, not a plain `Error` — no exceptions. Matches every existing action in `src/app/mkesindo/produksi/actions.ts`.
- All Indonesian-language user-facing strings (labels, error messages) — no English UI text.
- No test runner exists in this project. Every task's verification is `npx tsc --noEmit` (zero errors touching changed files) + `npx eslint <changed files>`, plus a live browser check where noted.
- Everything happens directly on the `main` branch. No worktree.
- MSSQL DDL tasks are **controller-run**: executed directly via the `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_ddl` tool by whoever is executing this plan, before dispatching the task that depends on it — never delegated to an implementer subagent. No `FOREIGN KEY`/`REFERENCES` clauses and no `CREATE INDEX` beyond a named `UNIQUE` constraint where a 1:1 relationship needs enforcing — matches every existing custom `Dashboard*` table in this codebase.
- Money/quantity values from MSSQL columns arrive as plain JS `number` via the `mssql` driver — no `Decimal.js` or string-based handling.
- No `react-hook-form`/`zod` anywhere in this codebase — every form uses controlled `<input>`/shadcn `<Select>`/`<Input>` + `useState` + `useTransition`/`startTransition` + `ActionResult<T>`. New/changed Produksi UI follows this exact convention.
- **120 is a hard cap**, not a soft warning: `SUM(SisaQty10KG)` across active batches at one position may never exceed 120. Enforced both client-side (immediate feedback) and server-side inside `createBatch`'s transaction (the real gate).
- This plan touches **only MKEsindo Produksi** (`/mkesindo/produksi`, `/mkesindo/produksi-app`) and the shared `DashboardPengirimanJadwal`/`DashboardProduksiMuatanDetail` tables it already writes to. It does **not** touch the separate PMPersada Produksi feature (Rek/Bak model) or `JADWAL_KANTONG_10KG_EXPR`/`JADWAL_KANTONG_5KG_EXPR` (customer-order-demand expressions in `src/lib/queries/pengiriman-jadwal.ts`) — those stay exactly as they are.
- `DashboardProduksiPalletPosisi.BatchIDAktif` is dropped, not left dangling unused — every task that touched it removes the read/write, and Task 0's DDL drops the column itself.

---

### Task 0: DDL migration (controller-run)

**Files:** None (direct MSSQL execution against the MKEsindo Produksi database via `sql_execute_ddl`).

- Produces: schema changes consumed by every query in Tasks 1-2.

- [ ] **Step 1: Pre-check for live data that would be lost**

Before dropping anything, run this query and inspect the result:

```sql
SELECT BatchID, PosisiID, Qty5KG, SisaQty5KG
FROM DashboardProduksiBatch
WHERE IsDeleted = 0 AND (Qty5KG > 0 OR SisaQty5KG > 0)
```

If this returns zero rows, proceed directly to Step 2. If it returns rows, STOP and report them to the user before continuing — those batches have 5KG stock recorded that this migration is about to make unreadable (the columns get dropped in Step 2). Do not drop the columns until the user has confirmed they're fine losing that historical 5KG figure (it's not "stock" in the new model, so there's nothing to migrate it *into* — this is purely a check for surprising data loss, not a blocker in the common case where 5KG on `DashboardProduksiBatch` was always 0 or unused going forward).

- [ ] **Step 2: Run the DDL**

Execute directly (controller-run), in this order — new column first, then drops:

```sql
ALTER TABLE DashboardPengirimanJadwal ADD Qty5KGDimuat INT NULL;

ALTER TABLE DashboardProduksiPalletPosisi DROP COLUMN BatchIDAktif;

ALTER TABLE DashboardProduksiBatch DROP COLUMN Qty5KG;
ALTER TABLE DashboardProduksiBatch DROP COLUMN SisaQty5KG;

ALTER TABLE DashboardProduksiMuatanDetail DROP COLUMN Qty5KGDiambil;
```

- [ ] **Step 3: Verify**

Run `SELECT TOP 1 * FROM DashboardProduksiPalletPosisi`, `SELECT TOP 1 * FROM DashboardProduksiBatch`, `SELECT TOP 1 * FROM DashboardProduksiMuatanDetail`, and `SELECT TOP 1 Qty5KGDimuat FROM DashboardPengirimanJadwal` — confirm the dropped columns are gone and `Qty5KGDimuat` exists. Report the four column lists back before moving to Task 1.

---

### Task 1: `produksi-warehouse.ts` query layer rewrite

**Files:**
- Modify: `src/lib/queries/produksi-warehouse.ts`

**Interfaces:**
- Consumes: Task 0's schema (no `BatchIDAktif`, no `Qty5KG`/`SisaQty5KG` on `DashboardProduksiBatch`).
- Produces: `PalletPosisiRow` (new shape, no `BatchIDAktif`/`MesinNama`/`TanggalProduksi`/`SisaQty5KG`/`Shift`), `RiwayatProduksiRow` (no `Qty5KG`/`SisaQty5KG`), `CreateBatchInput` (no `qty5KG`), `createBatch` (capacity check instead of single-slot claim), new `BatchAktifRow` + `getBatchAktifForAlokasi()` — consumed by Task 2 (none) and Task 3 (actions.ts), Task 4-8 (UI).

- [ ] **Step 1: Replace the whole file**

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

// Kapasitas gabungan per posisi pallet, dalam kantong 10kg (SUM SisaQty10KG
// semua batch aktif di posisi itu). Lihat produksi-warehouse-multi-batch
// design spec — satu posisi sekarang bisa menampung >1 batch, bukan lagi
// satu batch sampai habis.
export const KAPASITAS_PALLET_10KG = 120;

export interface PalletPosisiRow {
  PosisiID: number;
  Kode: string;
  JumlahBatchAktif: number;
  TotalSisaQty10KG: number;
  // Batch aktif TERTUA di posisi ini (berdasarkan TanggalLabel+JamPanen) —
  // dipakai warehouse-cell.tsx untuk warna panduan FIFO. null kalau posisi
  // kosong (JumlahBatchAktif = 0).
  TanggalLabelTertua: Date | null;
  JamPanenTertua: string | null;
}

// Filtered to Kode LIKE '[SUT]%' -- only the new 42-slot Ice Stock denah
// (codes S1A..U3D). The old 12 rows (Kode '1A'..'3D') are deliberately left
// in the table (never deleted, see plan's Global Constraints) so historical
// DashboardProduksiBatch rows recorded against them still resolve through
// getRiwayatProduksi()'s JOIN -- they're just never returned by this
// function, so the UI never shows them as available slots.
//
// One row per position, aggregated over every active batch (SisaQty10KG >
// 0) referencing it via PosisiID -- BatchIDAktif no longer exists (Task 0
// dropped it), occupancy/capacity is always derived here, never stored.
export async function getWarehouseMap(): Promise<PalletPosisiRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.PosisiID, p.Kode,
           ISNULL(agg.JumlahBatchAktif, 0) AS JumlahBatchAktif,
           ISNULL(agg.TotalSisaQty10KG, 0) AS TotalSisaQty10KG,
           oldest.TanggalLabel AS TanggalLabelTertua,
           oldest.JamPanen AS JamPanenTertua
    FROM DashboardProduksiPalletPosisi p
    OUTER APPLY (
      SELECT COUNT(*) AS JumlahBatchAktif, SUM(b.SisaQty10KG) AS TotalSisaQty10KG
      FROM DashboardProduksiBatch b
      WHERE b.PosisiID = p.PosisiID AND b.IsDeleted = 0 AND b.SisaQty10KG > 0
    ) agg
    OUTER APPLY (
      SELECT TOP 1 b2.TanggalLabel, b2.JamPanen
      FROM DashboardProduksiBatch b2
      WHERE b2.PosisiID = p.PosisiID AND b2.IsDeleted = 0 AND b2.SisaQty10KG > 0
      ORDER BY b2.TanggalLabel ASC, b2.JamPanen ASC
    ) oldest
    WHERE p.Kode LIKE '[SUT]%'
    ORDER BY p.Kode
  `);
  return result.recordset;
}

export interface RiwayatProduksiRow {
  BatchID: number;
  Kode: string;
  MesinNama: string;
  TanggalProduksi: Date;
  Qty10KG: number;
  SisaQty10KG: number;
  DicatatOlehAkunID: number;
  TanggalLabel: Date;
  Shift: 1 | 2 | 3;
  JamPanen: string;
}

export async function getRiwayatProduksi(limit = 50): Promise<RiwayatProduksiRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) b.BatchID, p.Kode, m.Nama AS MesinNama, b.TanggalProduksi,
             b.Qty10KG, b.SisaQty10KG, b.DicatatOlehAkunID,
             b.TanggalLabel, b.Shift, b.JamPanen
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0
      ORDER BY b.TanggalProduksi DESC
    `);
  return result.recordset;
}

// Riwayat scoped to one Pallete (PosisiID) — shown at the top of
// TambahProduksiDialog / the detail popup so the operator can see every
// batch (active or already-consumed) ever recorded at this exact slot,
// including ones stacked alongside a currently-active batch.
export async function getRiwayatProduksiForPosisi(posisiId: number, limit = 10): Promise<RiwayatProduksiRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("posisiId", sql.Int, posisiId)
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) b.BatchID, p.Kode, m.Nama AS MesinNama, b.TanggalProduksi,
             b.Qty10KG, b.SisaQty10KG, b.DicatatOlehAkunID,
             b.TanggalLabel, b.Shift, b.JamPanen
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0 AND b.PosisiID = @posisiId
      ORDER BY b.TanggalProduksi DESC
    `);
  return result.recordset;
}

// Satu baris per batch aktif (SisaQty10KG > 0) di SELURUH warehouse, diurut
// FIFO (tertua dulu) -- dipakai AlokasiScreen ("Isi Muatan") untuk
// menampilkan pilihan pallet per-batch, bukan per-posisi, supaya benar saat
// satu posisi punya >1 batch menumpuk.
export interface BatchAktifRow {
  BatchID: number;
  PosisiID: number;
  Kode: string;
  SisaQty10KG: number;
  TanggalLabel: Date;
  JamPanen: string;
}

export async function getBatchAktifForAlokasi(): Promise<BatchAktifRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT b.BatchID, b.PosisiID, p.Kode, b.SisaQty10KG, b.TanggalLabel, b.JamPanen
    FROM DashboardProduksiBatch b
    JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
    WHERE b.IsDeleted = 0 AND b.SisaQty10KG > 0
    ORDER BY b.TanggalLabel ASC, b.JamPanen ASC
  `);
  return result.recordset;
}

export interface CreateBatchInput {
  mesinId: number;
  posisiId: number;
  qty10KG: number;
  tanggalLabel: string;
  shift: 1 | 2 | 3;
  jamPanen: string;
  dicatatOlehAkunId: number;
}

// Satu posisi pallet sekarang bisa menampung banyak batch sekaligus, dibatasi
// kapasitas gabungan KAPASITAS_PALLET_10KG (120) kantong 10kg -- bukan lagi
// "satu batch sampai habis". Dipanggil baik untuk posisi kosong maupun yang
// sudah terisi (selama kapasitas masih ada).
export async function createBatch(input: CreateBatchInput): Promise<number> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Insert speculatively — aman karena satu transaksi dengan pengecekan
    // kapasitas di bawah: kalau kapasitas terlampaui, rollback membuang
    // baris ini juga, jadi tidak ada batch "orphan" yang pernah terlihat di
    // luar fungsi ini.
    const insertResult = await new sql.Request(transaction)
      .input("mesinId", sql.Int, input.mesinId)
      .input("posisiId", sql.Int, input.posisiId)
      .input("qty10", sql.Int, input.qty10KG)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .input("tanggalLabel", sql.Date, input.tanggalLabel)
      .input("shift", sql.TinyInt, input.shift)
      .input("jamPanen", sql.VarChar(5), input.jamPanen)
      .query(`
        INSERT INTO DashboardProduksiBatch (MesinID, PosisiID, TanggalProduksi, Qty10KG, SisaQty10KG, DicatatOlehAkunID, TanggalLabel, Shift, JamPanen)
        OUTPUT INSERTED.BatchID
        VALUES (@mesinId, @posisiId, GETDATE(), @qty10, @qty10, @akunId, @tanggalLabel, @shift, @jamPanen)
      `);
    const batchId = insertResult.recordset[0].BatchID as number;

    // Kapasitas: total SisaQty10KG semua batch aktif di posisi ini (baris
    // yang baru di-insert di atas sudah ikut terhitung) tidak boleh melebihi
    // 120. WITH (UPDLOCK, HOLDLOCK) mengunci baris yang cocok sampai
    // transaksi ini commit/rollback -- menutup race dua operator submit ke
    // posisi yang sama secara bersamaan, pola yang sama seperti klaim
    // BatchIDAktif IS NULL yang digantikannya.
    const capacityCheck = await new sql.Request(transaction)
      .input("posisiId", sql.Int, input.posisiId)
      .query(`
        SELECT ISNULL(SUM(SisaQty10KG), 0) AS TotalSisa
        FROM DashboardProduksiBatch WITH (UPDLOCK, HOLDLOCK)
        WHERE PosisiID = @posisiId AND IsDeleted = 0 AND SisaQty10KG > 0
      `);
    const totalSisa = capacityCheck.recordset[0].TotalSisa as number;
    if (totalSisa > 120) {
      const sebelumnya = totalSisa - input.qty10KG;
      throw new AppError(
        `Kapasitas pallet ini penuh -- sudah terisi ${sebelumnya}/120 kantong 10kg, sisa ruang hanya ${120 - sebelumnya}.`
      );
    }

    await transaction.commit();
    return batchId;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

- [ ] **Step 2: Typecheck this file in isolation**

Run: `npx tsc --noEmit 2>&1 | grep "produksi-warehouse.ts"`
Expected: no output from this file itself (downstream errors in `actions.ts`/UI files are expected at this point — Task 3-8's job — do not fix them here).

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/produksi-warehouse.ts
git commit -m "feat: multi-batch pallet capacity model in produksi-warehouse.ts"
```

---

### Task 2: `produksi-muatan.ts` query layer rewrite

**Files:**
- Modify: `src/lib/queries/produksi-muatan.ts`

**Interfaces:**
- Consumes: Task 0's schema (`DashboardPengirimanJadwal.Qty5KGDimuat`, no `Qty5KGDiambil` on `DashboardProduksiMuatanDetail`, no `Qty5KG`/`SisaQty5KG` on `DashboardProduksiBatch`).
- Produces: `MuatanAlokasi` (10kg-only), `ProduksiSelesaiMuatInput` (adds `qty5KGDimuat`), `produksiSelesaiMuat` (rewritten transaction) — consumed by Task 3 (actions.ts).

- [ ] **Step 1: Replace `MuatanAlokasi`/`ProduksiSelesaiMuatInput`/`produksiSelesaiMuat`**

Find this block (lines 108-208 in the current file) and replace it entirely:

```ts
export interface MuatanAlokasi {
  batchId: number;
  qty10KG: number;
}

export interface ProduksiSelesaiMuatInput {
  jadwalId: number;
  alokasi: MuatanAlokasi[];
  // Kantong 5kg tidak lagi dialokasikan per-pallet -- diproses langsung
  // tanpa FIFO, jadi cukup satu angka per Kartu Pengiriman, terpisah dari
  // alokasi 10kg di atas. Disimpan ke DashboardPengirimanJadwal.Qty5KGDimuat,
  // bukan DashboardProduksiMuatanDetail.
  qty5KGDimuat: number;
  dicatatOlehAkunId: number;
}

// Allocates pallet stock (10kg only) to the Jadwal, records the separate
// 5kg-loaded figure, then completes the real "Selesai Muat" transition
// (driver/route/capacity-validated, creates real DeliveryOrder + SalesInvoice
// documents) — the produksi-app equivalent of desktop's "Selesai Muat"
// button. Requires produksiStartMuat to already have been called for this
// jadwalId (enforced by the UI flow: the alokasi screen only ever opens
// after "Mulai Muat" succeeds), not re-checked here since selesaiMuat below
// doesn't need JamMulaiMuat itself.
export async function produksiSelesaiMuat(input: ProduksiSelesaiMuatInput): Promise<void> {
  if (input.alokasi.length === 0 && input.qty5KGDimuat <= 0) {
    throw new AppError("Pilih minimal satu pallet 10kg atau isi jumlah kantong 5kg yang dimuat.");
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const item of input.alokasi) {
      if (item.qty10KG < 0) {
        throw new AppError("Jumlah yang diambil tidak boleh negatif.");
      }

      await new sql.Request(transaction)
        .input("jadwalId", sql.Int, input.jadwalId)
        .input("batchId", sql.Int, item.batchId)
        .input("qty10", sql.Int, item.qty10KG)
        .input("akunId", sql.Int, input.dicatatOlehAkunId)
        .query(`
          INSERT INTO DashboardProduksiMuatanDetail (JadwalID, BatchID, Qty10KGDiambil, DicatatOlehAkunID)
          VALUES (@jadwalId, @batchId, @qty10, @akunId)
        `);

      // Atomic claim: the WHERE clause encodes both "batch exists" and
      // "enough stock remains" as one condition, so the row's exclusive
      // lock (held until commit/rollback, unlike a plain SELECT's shared
      // lock) prevents two concurrent allocations from both succeeding
      // against stock that can only cover one of them.
      const claim = await new sql.Request(transaction)
        .input("batchId", sql.Int, item.batchId)
        .input("qty10", sql.Int, item.qty10KG)
        .query(`
          UPDATE DashboardProduksiBatch
          SET SisaQty10KG = SisaQty10KG - @qty10, ModifiedDate = GETDATE()
          OUTPUT INSERTED.SisaQty10KG
          WHERE BatchID = @batchId AND SisaQty10KG >= @qty10
        `);
      if (claim.recordset.length === 0) {
        throw new AppError("Jumlah yang diambil melebihi sisa stok pallet ini.");
      }
      // Tidak ada lagi langkah "null-kan BatchIDAktif kalau sisa 0" --
      // kolom itu sudah dihapus (Task 0). Status "kosong" sekarang murni
      // hasil agregasi (lihat getWarehouseMap), tidak perlu ditulis ulang
      // di sini.
    }

    await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .input("qty5", sql.Int, input.qty5KGDimuat)
      .query(`UPDATE DashboardPengirimanJadwal SET Qty5KGDimuat = @qty5 WHERE JadwalID = @jadwalId`);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  // selesaiMuat is the existing, unmodified delivery-flow function
  // (src/lib/queries/pengiriman-jadwal.ts) — deliberately called AFTER the
  // pallet-consumption transaction above commits, not inside it, because
  // selesaiMuat opens its own pool.request()/sql.Transaction and does not
  // accept an external one. Unlike the old startMuat call this replaces,
  // selesaiMuat is NOT trivial — it validates driver/route/capacity and
  // creates real DeliveryOrder + SalesInvoice documents, so it can
  // genuinely reject (AppError) after pallet stock has already been
  // committed. Accepted trade-off, unchanged from before this task.
  return selesaiMuat(input.jadwalId);
}
```

- [ ] **Step 2: Typecheck this file in isolation**

Run: `npx tsc --noEmit 2>&1 | grep "produksi-muatan.ts"`
Expected: no output from this file itself.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/produksi-muatan.ts
git commit -m "feat: decouple 5KG from pallet stock in produksi-muatan.ts"
```

---

### Task 3: Server actions (`src/app/mkesindo/produksi/actions.ts`)

**Files:**
- Modify: `src/app/mkesindo/produksi/actions.ts`

**Interfaces:**
- Consumes: Task 1's `getBatchAktifForAlokasi`/`BatchAktifRow`/`CreateBatchInput`/`createBatch`, Task 2's `ProduksiSelesaiMuatInput`/`produksiSelesaiMuat`.
- Produces: `getBatchAktifForAlokasiAction` (new), updated `createBatchAction`/`produksiSelesaiMuatAction` — consumed by Task 4 (`createBatchAction`) and Task 8 (`getBatchAktifForAlokasiAction`, `produksiSelesaiMuatAction`).

- [ ] **Step 1: Update the `produksi-warehouse` import block**

Find (near the top of the file):

```ts
import {
  getWarehouseMap,
  getRiwayatProduksi,
  getRiwayatProduksiForPosisi,
  createBatch,
  type PalletPosisiRow,
  type RiwayatProduksiRow,
  type CreateBatchInput,
} from "@/lib/queries/produksi-warehouse";
```

Replace with:

```ts
import {
  getWarehouseMap,
  getRiwayatProduksi,
  getRiwayatProduksiForPosisi,
  createBatch,
  getBatchAktifForAlokasi,
  type PalletPosisiRow,
  type RiwayatProduksiRow,
  type CreateBatchInput,
  type BatchAktifRow,
} from "@/lib/queries/produksi-warehouse";
```

- [ ] **Step 2: Add `getBatchAktifForAlokasiAction`**

Add directly after `getWarehouseMapAction` (which stays unchanged):

```ts
export async function getBatchAktifForAlokasiAction(): Promise<ActionResult<BatchAktifRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getBatchAktifForAlokasi();
  });
}
```

- [ ] **Step 3: Update `createBatchAction`**

Find:

```ts
export async function createBatchAction(
  input: Omit<CreateBatchInput, "dicatatOlehAkunId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!input.jamPanen) {
      throw new AppError("Isi jam panen.");
    }
    if (input.qty10KG <= 0 && input.qty5KG <= 0) {
      throw new AppError("Isi jumlah kantong 10kg atau 5kg minimal satu.");
    }
    const batchId = await createBatch({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    return batchId;
  });
}
```

Replace with:

```ts
export async function createBatchAction(
  input: Omit<CreateBatchInput, "dicatatOlehAkunId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!input.jamPanen) {
      throw new AppError("Isi jam panen.");
    }
    if (input.qty10KG <= 0) {
      throw new AppError("Isi jumlah kantong 10kg.");
    }
    const batchId = await createBatch({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    return batchId;
  });
}
```

(Also added the missing `revalidatePath("/mkesindo/produksi-app")` — the mobile Warehouse tab reads the same `getWarehouseMapAction`, and previously relied on the caller's own `onSaved`/`onAfterTambah` client refresh; this makes server-side revalidation consistent with every other mutating action in this file.)

- [ ] **Step 4: Update `produksiSelesaiMuatAction`**

Find:

```ts
export async function produksiSelesaiMuatAction(
  input: Omit<ProduksiSelesaiMuatInput, "dicatatOlehAkunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const totalQty10 = input.alokasi.reduce((sum, a) => sum + a.qty10KG, 0);
    const totalQty5 = input.alokasi.reduce((sum, a) => sum + a.qty5KG, 0);
    const jadwalList = await getDraftJadwalForProduksi();
    const jadwal = jadwalList.find((j) => j.JadwalID === input.jadwalId);
    if (!jadwal) throw new AppError("Kartu Pengiriman ini sudah tidak tersedia untuk diisi.");
    if (totalQty10 < jadwal.Qty10KGDibutuhkan || totalQty5 < jadwal.Qty5KGDibutuhkan) {
      throw new AppError("Jumlah yang dialokasikan belum mencukupi kebutuhan Kartu Pengiriman ini.");
    }
    await produksiSelesaiMuat({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/delivery");
  });
}
```

Replace with:

```ts
export async function produksiSelesaiMuatAction(
  input: Omit<ProduksiSelesaiMuatInput, "dicatatOlehAkunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const totalQty10 = input.alokasi.reduce((sum, a) => sum + a.qty10KG, 0);
    const jadwalList = await getDraftJadwalForProduksi();
    const jadwal = jadwalList.find((j) => j.JadwalID === input.jadwalId);
    if (!jadwal) throw new AppError("Kartu Pengiriman ini sudah tidak tersedia untuk diisi.");
    if (totalQty10 < jadwal.Qty10KGDibutuhkan || input.qty5KGDimuat < jadwal.Qty5KGDibutuhkan) {
      throw new AppError("Jumlah yang dialokasikan belum mencukupi kebutuhan Kartu Pengiriman ini.");
    }
    await produksiSelesaiMuat({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/delivery");
  });
}
```

- [ ] **Step 5: Typecheck + lint this file in isolation**

Run: `npx tsc --noEmit 2>&1 | grep "produksi/actions.ts"`
Expected: no output from this file itself (UI callers in Tasks 4-8 still reference old shapes at this point — expected, not this task's job to fix).
Run: `npx eslint src/app/mkesindo/produksi/actions.ts`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/mkesindo/produksi/actions.ts
git commit -m "feat: wire multi-batch pallet + 5KG-decoupled actions"
```

---

### Task 4: `TambahProduksiDialog` + `RiwayatPosisiList` rewrite

**Files:**
- Modify: `src/components/produksi-app/tambah-produksi-dialog.tsx`

**Interfaces:**
- Consumes: Task 1's `PalletPosisiRow` (new shape), Task 3's `createBatchAction` (no `qty5KG`).
- Produces: `TambahProduksiDialog` reachable from any position (empty or filled, under capacity) with a capacity indicator — consumed by Task 5 (`WarehouseView`).

- [ ] **Step 1: Remove 5kg from `RiwayatPosisiList`'s line item**

Find:

```tsx
              {" — "}
              {r.MesinNama}
              {" — "}
              {r.Qty10KG}-{r.Qty5KG}
            </p>
```

Replace with:

```tsx
              {" — "}
              {r.MesinNama}
              {" — "}
              {r.Qty10KG} kantong 10kg
            </p>
```

- [ ] **Step 2: Remove `qty5` state, capacity-aware validation, and the 5KG input**

Find:

```tsx
  const [qty10, setQty10] = useState("");
  const [qty5, setQty5] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTanggalLabel(getBusinessDateISO());
    setShift("1");
    setMesinId("");
    setJamPanen("");
    setQty10("");
    setQty5("");
    setError(null);
  }

  function handleSubmit() {
    if (!posisi) return;
    setError(null);
    if (!mesinId) {
      setError("Pilih mesin yang dipakai.");
      return;
    }
    if (!jamPanen) {
      setError("Isi jam panen.");
      return;
    }
    if ((Number(qty10) || 0) <= 0 && (Number(qty5) || 0) <= 0) {
      setError("Isi jumlah kantong 10kg atau 5kg minimal satu.");
      return;
    }
    startTransition(async () => {
      const result = await createBatchAction({
        tanggalLabel,
        shift: Number(shift) as 1 | 2 | 3,
        mesinId: Number(mesinId),
        posisiId: posisi.PosisiID,
        jamPanen,
        qty10KG: Number(qty10) || 0,
        qty5KG: Number(qty5) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      reset();
      onSaved();
    });
  }
```

Replace with:

```tsx
  const [qty10, setQty10] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sisaKapasitas = posisi ? KAPASITAS_PALLET_10KG - posisi.TotalSisaQty10KG : KAPASITAS_PALLET_10KG;

  function reset() {
    setTanggalLabel(getBusinessDateISO());
    setShift("1");
    setMesinId("");
    setJamPanen("");
    setQty10("");
    setError(null);
  }

  function handleSubmit() {
    if (!posisi) return;
    setError(null);
    if (!mesinId) {
      setError("Pilih mesin yang dipakai.");
      return;
    }
    if (!jamPanen) {
      setError("Isi jam panen.");
      return;
    }
    const qty10Num = Number(qty10) || 0;
    if (qty10Num <= 0) {
      setError("Isi jumlah kantong 10kg.");
      return;
    }
    if (qty10Num > sisaKapasitas) {
      setError(`Melebihi sisa kapasitas pallet ini (sisa ${sisaKapasitas} kantong).`);
      return;
    }
    startTransition(async () => {
      const result = await createBatchAction({
        tanggalLabel,
        shift: Number(shift) as 1 | 2 | 3,
        mesinId: Number(mesinId),
        posisiId: posisi.PosisiID,
        jamPanen,
        qty10KG: qty10Num,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      reset();
      onSaved();
    });
  }
```

- [ ] **Step 3: Add the `KAPASITAS_PALLET_10KG` import**

Find:

```tsx
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
```

Replace with:

```tsx
import { KAPASITAS_PALLET_10KG } from "@/lib/queries/produksi-warehouse";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
```

- [ ] **Step 4: Show capacity in the dialog title area, and reduce the qty inputs to one field**

Find:

```tsx
          <DialogHeader>
            <DialogTitle>Tambah Produksi — Pallete {posisi?.Kode}</DialogTitle>
          </DialogHeader>
```

Replace with:

```tsx
          <DialogHeader>
            <DialogTitle>Tambah Produksi — Pallete {posisi?.Kode}</DialogTitle>
            {posisi && (
              <p className="text-xs text-muted-foreground">
                Terisi {posisi.TotalSisaQty10KG}/{KAPASITAS_PALLET_10KG} — sisa ruang {sisaKapasitas} kantong
              </p>
            )}
          </DialogHeader>
```

Then find (the two-column qty grid with 10KG/5KG side by side):

```tsx
          <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="relative">
              <Input
                type="number"
                value={qty10}
                onChange={(e) => setQty10(e.target.value)}
                className="pr-12"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
                10KG
              </span>
            </div>
          </div>

          <div>
            <div className="relative">
              <Input
                type="number"
                value={qty5}
                onChange={(e) => setQty5(e.target.value)}
                className="pr-12"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
                5KG
              </span>
            </div>
          </div>

          <div className="flex flex-col justify-end">
            <Button disabled={pending} onClick={handleSubmit}>
              {pending ? "..." : "Simpan"}
            </Button>
          </div>
        </div>
```

Replace with:

```tsx
          <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="relative">
              <Input
                type="number"
                value={qty10}
                onChange={(e) => setQty10(e.target.value)}
                className="pr-12"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
                10KG
              </span>
            </div>
          </div>

          <div className="flex flex-col justify-end">
            <Button disabled={pending} onClick={handleSubmit}>
              {pending ? "..." : "Simpan"}
            </Button>
          </div>
        </div>
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep "tambah-produksi-dialog.tsx"`
Expected: no output from this file itself.
Run: `npx eslint src/components/produksi-app/tambah-produksi-dialog.tsx`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi-app/tambah-produksi-dialog.tsx
git commit -m "feat: capacity-aware TambahProduksiDialog, remove 5KG field"
```

---

### Task 5: Mobile `WarehouseView` — unified detail+add popup

**Files:**
- Modify: `src/components/produksi-app/warehouse-view.tsx`

**Interfaces:**
- Consumes: Task 1's `PalletPosisiRow` (new shape), Task 4's `TambahProduksiDialog`/`RiwayatPosisiList`.
- Produces: every cell click (empty or filled) opens one detail popup showing riwayat + capacity + a conditional "+ Tambah Produksi" button.

- [ ] **Step 1: Simplify `handleCellClick` to always open the detail popup**

Find:

```tsx
  function handleCellClick(row: PalletPosisiRow | undefined) {
    if (!row) return;
    if (row.BatchIDAktif == null) {
      setDialogPosisi(row);
    } else {
      setDetailPosisi(row);
    }
  }
```

Replace with:

```tsx
  function handleCellClick(row: PalletPosisiRow | undefined) {
    if (!row) return;
    setDetailPosisi(row);
  }
```

- [ ] **Step 2: Rewrite the detail dialog body — capacity summary + conditional "+ Tambah Produksi" button, drop the single-batch Mesin/Tanggal block**

Find:

```tsx
      <Dialog open={detailPosisi != null} onOpenChange={(open) => !open && setDetailPosisi(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pallete {detailPosisi?.Kode}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {detailPosisi && <RiwayatPosisiList posisiId={detailPosisi.PosisiID} open={detailPosisi != null} />}
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="text-muted-foreground">Mesin: {detailPosisi?.MesinNama ?? "-"}</p>
              {detailPosisi?.TanggalLabel != null && (
                <p className="text-muted-foreground">
                  Tanggal &amp; Shift Produksi:{" "}
                  {new Date(detailPosisi.TanggalLabel).toLocaleDateString("id-ID", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                  {" — Shift "}
                  {detailPosisi.Shift}
                  {detailPosisi.JamPanen && ` — Jam Panen ${detailPosisi.JamPanen}`}
                </p>
              )}
              <p className="text-muted-foreground">
                Sisa: {detailPosisi?.SisaQty10KG ?? 0} kantong 10kg, {detailPosisi?.SisaQty5KG ?? 0} kantong 5kg
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TambahProduksiDialog
        open={dialogPosisi != null}
        onOpenChange={(open) => !open && setDialogPosisi(null)}
        posisi={dialogPosisi}
        mesinList={mesinList}
        onSaved={() => {
          setDialogPosisi(null);
          onAfterTambah();
        }}
      />
```

Replace with:

```tsx
      <Dialog open={detailPosisi != null} onOpenChange={(open) => !open && setDetailPosisi(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pallete {detailPosisi?.Kode}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {detailPosisi && <RiwayatPosisiList posisiId={detailPosisi.PosisiID} open={detailPosisi != null} />}
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="text-muted-foreground">
                Terisi {detailPosisi?.TotalSisaQty10KG ?? 0}/{KAPASITAS_PALLET_10KG} kantong 10kg
                {(detailPosisi?.JumlahBatchAktif ?? 0) > 1 && ` — ${detailPosisi?.JumlahBatchAktif} batch aktif`}
              </p>
            </div>
            {detailPosisi && detailPosisi.TotalSisaQty10KG < KAPASITAS_PALLET_10KG && (
              <Button
                onClick={() => {
                  setDialogPosisi(detailPosisi);
                  setDetailPosisi(null);
                }}
              >
                + Tambah Produksi
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <TambahProduksiDialog
        open={dialogPosisi != null}
        onOpenChange={(open) => !open && setDialogPosisi(null)}
        posisi={dialogPosisi}
        mesinList={mesinList}
        onSaved={() => {
          setDialogPosisi(null);
          onAfterTambah();
        }}
      />
```

- [ ] **Step 3: Update imports — add `Button` and `KAPASITAS_PALLET_10KG`**

Find:

```tsx
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import { TambahProduksiDialog, RiwayatPosisiList } from "@/components/produksi-app/tambah-produksi-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
```

Replace with:

```tsx
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import { TambahProduksiDialog, RiwayatPosisiList } from "@/components/produksi-app/tambah-produksi-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KAPASITAS_PALLET_10KG } from "@/lib/queries/produksi-warehouse";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
```

- [ ] **Step 4: Update the legend text**

Find:

```tsx
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-muted" /> Kosong — ketuk untuk tambah produksi
        </span>
```

Replace with:

```tsx
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-muted" /> Kosong — ketuk untuk detail &amp; tambah produksi
        </span>
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep "warehouse-view.tsx"`
Expected: no output from this file itself.
Run: `npx eslint src/components/produksi-app/warehouse-view.tsx`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi-app/warehouse-view.tsx
git commit -m "feat: unify mobile pallet click into one detail+add popup"
```

---

### Task 6: `warehouse-cell.tsx` + `PetaWarehouseDesktop` — aggregated display

**Files:**
- Modify: `src/components/produksi/warehouse-cell.tsx`
- Modify: `src/components/produksi/peta-warehouse-desktop.tsx`

**Interfaces:**
- Consumes: Task 1's `PalletPosisiRow` (new shape).
- Produces: cell shows aggregated Sisa + batch-count badge; desktop detail panel reuses `RiwayatPosisiList` instead of a single-batch field block.

- [ ] **Step 1: Rewrite `warehouse-cell.tsx`**

Replace the whole file:

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

// Age is measured from TanggalLabel + JamPanen (when the ice actually
// entered cold storage), not TanggalProduksi (when the form was submitted
// — could be minutes or hours after the real harvest moment). Falls back to
// 00:00 if JamPanen is somehow null on an old row, so age is never NaN.
export function ageClass(tanggalLabel: Date | string | null, jamPanen: string | null): string {
  if (!tanggalLabel) return "bg-muted text-muted-foreground";
  const dateOnly = new Date(tanggalLabel).toISOString().slice(0, 10);
  const harvestedAt = new Date(`${dateOnly}T${jamPanen || "00:00"}:00`);
  const ageDays = (Date.now() - harvestedAt.getTime()) / 86400000;
  if (ageDays >= 3) return "bg-red-600 text-white";
  if (ageDays >= 1) return "bg-amber-500 text-white";
  return "bg-emerald-600 text-white";
}

export function WarehouseCell({
  kode,
  row,
  onClick,
}: {
  kode: string;
  row: PalletPosisiRow | undefined;
  onClick?: (row: PalletPosisiRow | undefined) => void;
}) {
  const terisi = (row?.JumlahBatchAktif ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={() => onClick?.(row)}
      className={cn(
        "relative flex size-[55px] shrink-0 flex-col items-center justify-center rounded-md text-xs font-semibold leading-tight",
        terisi ? ageClass(row!.TanggalLabelTertua, row!.JamPanenTertua) : "bg-muted text-muted-foreground"
      )}
    >
      <span>{kode}</span>
      {terisi && <span className="text-[9px] font-normal opacity-90">{row!.TotalSisaQty10KG}</span>}
      {(row?.JumlahBatchAktif ?? 0) > 1 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-foreground px-1 text-[8px] font-bold text-background">
          ×{row!.JumlahBatchAktif}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Rewrite `peta-warehouse-desktop.tsx`'s selected-detail panel**

Find:

```tsx
      {selected && (
        <div className="mt-4 rounded-md border border-border p-3 text-sm">
          <p className="font-semibold">Pallet {selected.Kode}</p>
          <p className="text-muted-foreground">Mesin: {selected.MesinNama ?? "-"}</p>
          {selected.TanggalLabel != null && (
            <p className="text-muted-foreground">
              Tanggal &amp; Shift Produksi:{" "}
              {new Date(selected.TanggalLabel).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {" — Shift "}
              {selected.Shift}
              {selected.JamPanen && ` — Jam Panen ${selected.JamPanen}`}
            </p>
          )}
          <p className="text-muted-foreground">
            Sisa: {selected.SisaQty10KG ?? 0} kantong 10kg, {selected.SisaQty5KG ?? 0} kantong 5kg
          </p>
        </div>
      )}
```

Replace with:

```tsx
      {selected && (
        <div className="mt-4 flex flex-col gap-3">
          <RiwayatPosisiList posisiId={selected.PosisiID} open={selected != null} />
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-semibold">Pallet {selected.Kode}</p>
            <p className="text-muted-foreground">
              Terisi {selected.TotalSisaQty10KG}/{KAPASITAS_PALLET_10KG} kantong 10kg
              {selected.JumlahBatchAktif > 1 && ` — ${selected.JumlahBatchAktif} batch aktif`}
            </p>
          </div>
        </div>
      )}
```

(No action button here — `/mkesindo/produksi` desktop stays view-only by design, matching the original spec's "alur tambah-produksi selalu mobile-only" constraint.)

- [ ] **Step 3: Update `peta-warehouse-desktop.tsx` imports**

Find:

```tsx
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
```

Replace with:

```tsx
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import { RiwayatPosisiList } from "@/components/produksi-app/tambah-produksi-dialog";
import { KAPASITAS_PALLET_10KG } from "@/lib/queries/produksi-warehouse";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
```

(Reusing `RiwayatPosisiList` from the `produksi-app` folder in a desktop component mirrors the existing precedent of `RekDetailDialog` being reused cross-folder between PMPersada's desktop and mobile Produksi UIs — it's a plain client component with no mobile-specific assumptions.)

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep "warehouse-cell.tsx\|peta-warehouse-desktop.tsx"`
Expected: no output from these files themselves.
Run: `npx eslint src/components/produksi/warehouse-cell.tsx src/components/produksi/peta-warehouse-desktop.tsx`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi/warehouse-cell.tsx src/components/produksi/peta-warehouse-desktop.tsx
git commit -m "feat: aggregated pallet cell + desktop detail panel for multi-batch"
```

---

### Task 7: `riwayat-produksi.tsx` — drop 5KG columns

**Files:**
- Modify: `src/components/produksi/riwayat-produksi.tsx`

**Interfaces:**
- Consumes: Task 1's `RiwayatProduksiRow` (no `Qty5KG`/`SisaQty5KG`).

- [ ] **Step 1: Update the "Jumlah Awal"/"Sisa" cells**

Find:

```tsx
              <TableCell>
                {r.Qty10KG} kantong 10kg, {r.Qty5KG} kantong 5kg
              </TableCell>
              <TableCell>
                {r.SisaQty10KG} kantong 10kg, {r.SisaQty5KG} kantong 5kg
              </TableCell>
```

Replace with:

```tsx
              <TableCell>{r.Qty10KG} kantong 10kg</TableCell>
              <TableCell>{r.SisaQty10KG} kantong 10kg</TableCell>
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep "riwayat-produksi.tsx"`
Expected: no output from this file itself.
Run: `npx eslint src/components/produksi/riwayat-produksi.tsx`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi/riwayat-produksi.tsx
git commit -m "feat: drop 5KG columns from desktop Riwayat Produksi table"
```

---

### Task 8: `AlokasiScreen` (`kartu-pengiriman-list.tsx`) — per-batch list + top-level 5kg field

**Files:**
- Modify: `src/components/produksi-app/kartu-pengiriman-list.tsx`

**Interfaces:**
- Consumes: Task 1's `BatchAktifRow`, Task 3's `getBatchAktifForAlokasiAction`/`produksiSelesaiMuatAction`.

- [ ] **Step 1: Update imports**

Find:

```tsx
import {
  getWarehouseMapAction,
  produksiStartMuatAction,
  produksiSelesaiMuatAction,
  produksiSelesaiMuatManualAction,
  getJadwalDetailForProduksiAction,
  getSelesaiMuatJadwalForProduksiAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi, SelesaiMuatJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";
```

Replace with:

```tsx
import {
  getBatchAktifForAlokasiAction,
  produksiStartMuatAction,
  produksiSelesaiMuatAction,
  produksiSelesaiMuatManualAction,
  getJadwalDetailForProduksiAction,
  getSelesaiMuatJadwalForProduksiAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi, SelesaiMuatJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { BatchAktifRow } from "@/lib/queries/produksi-warehouse";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";
```

- [ ] **Step 2: Rewrite `AlokasiScreen`'s state, fetch, and derived totals**

Find:

```tsx
function AlokasiScreen({
  jadwal,
  onBack,
  onDone,
}: {
  jadwal: DraftJadwalForProduksi;
  onBack: () => void;
  onDone: () => void;
}) {
  const [posisi, setPosisi] = useState<PalletPosisiRow[] | null>(null);
  const [alokasi, setAlokasi] = useState<Record<number, { qty10: number; qty5: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [confirmDetail, setConfirmDetail] = useState<JadwalDetailRow[] | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    getWarehouseMapAction().then((result) => {
      if (result.success) {
        setPosisi(
          result.data
            .filter((p) => p.BatchIDAktif != null)
            .sort((a, b) => new Date(a.TanggalProduksi ?? 0).getTime() - new Date(b.TanggalProduksi ?? 0).getTime())
        );
      }
    });
  }, []);

  const totalQty10 = Object.values(alokasi).reduce((sum, a) => sum + a.qty10, 0);
  const totalQty5 = Object.values(alokasi).reduce((sum, a) => sum + a.qty5, 0);
  const cukup = totalQty10 >= jadwal.Qty10KGDibutuhkan && totalQty5 >= jadwal.Qty5KGDibutuhkan;

  function setAmbil(posisiId: number, field: "qty10" | "qty5", value: number, max: number) {
    setAlokasi((prev) => ({
      ...prev,
      [posisiId]: {
        qty10: prev[posisiId]?.qty10 ?? 0,
        qty5: prev[posisiId]?.qty5 ?? 0,
        [field]: Math.min(Math.max(0, value), max),
      },
    }));
  }

  function handleAmbilSemua(row: PalletPosisiRow) {
    setAlokasi((prev) => ({ ...prev, [row.PosisiID]: { qty10: row.SisaQty10KG ?? 0, qty5: row.SisaQty5KG ?? 0 } }));
  }

  function buildAlokasiList() {
    if (!posisi) return [];
    return posisi
      .filter((row) => alokasi[row.PosisiID] && (alokasi[row.PosisiID].qty10 > 0 || alokasi[row.PosisiID].qty5 > 0))
      .map((row) => ({
        batchId: row.BatchIDAktif as number,
        qty10KG: alokasi[row.PosisiID].qty10,
        qty5KG: alokasi[row.PosisiID].qty5,
      }));
  }
```

Replace with:

```tsx
function AlokasiScreen({
  jadwal,
  onBack,
  onDone,
}: {
  jadwal: DraftJadwalForProduksi;
  onBack: () => void;
  onDone: () => void;
}) {
  const [batchList, setBatchList] = useState<BatchAktifRow[] | null>(null);
  const [alokasi, setAlokasi] = useState<Record<number, number>>({});
  const [qty5Dimuat, setQty5Dimuat] = useState(() => String(jadwal.Qty5KGDibutuhkan));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [confirmDetail, setConfirmDetail] = useState<JadwalDetailRow[] | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    getBatchAktifForAlokasiAction().then((result) => {
      if (result.success) setBatchList(result.data);
    });
  }, []);

  const totalQty10 = Object.values(alokasi).reduce((sum, q) => sum + q, 0);
  const qty5Num = Number(qty5Dimuat) || 0;
  const cukup = totalQty10 >= jadwal.Qty10KGDibutuhkan && qty5Num >= jadwal.Qty5KGDibutuhkan;

  function setAmbil(batchId: number, value: number, max: number) {
    setAlokasi((prev) => ({ ...prev, [batchId]: Math.min(Math.max(0, value), max) }));
  }

  function handleAmbilSemua(row: BatchAktifRow) {
    setAlokasi((prev) => ({ ...prev, [row.BatchID]: row.SisaQty10KG }));
  }

  function buildAlokasiList() {
    if (!batchList) return [];
    return batchList
      .filter((row) => (alokasi[row.BatchID] ?? 0) > 0)
      .map((row) => ({ batchId: row.BatchID, qty10KG: alokasi[row.BatchID] }));
  }
```

- [ ] **Step 3: Update `handleConfirmYa` to pass `qty5KGDimuat`**

Find:

```tsx
  function handleConfirmYa() {
    const alokasiList = buildAlokasiList();
    startTransition(async () => {
      const result = await produksiSelesaiMuatAction({ jadwalId: jadwal.JadwalID, alokasi: alokasiList });
      if (!result.success) {
        setConfirmDetail(null);
        setError(result.error);
        return;
      }
      onDone();
    });
  }
```

Replace with:

```tsx
  function handleConfirmYa() {
    const alokasiList = buildAlokasiList();
    startTransition(async () => {
      const result = await produksiSelesaiMuatAction({
        jadwalId: jadwal.JadwalID,
        alokasi: alokasiList,
        qty5KGDimuat: qty5Num,
      });
      if (!result.success) {
        setConfirmDetail(null);
        setError(result.error);
        return;
      }
      onDone();
    });
  }
```

- [ ] **Step 4: Rewrite the render body — summary, top-level 5kg field, per-batch rows**

Find:

```tsx
      <p className="text-sm text-muted-foreground">
        Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
      </p>
      <p className="text-sm">
        Sudah dialokasikan: {totalQty10} kantong 10kg, {totalQty5} kantong 5kg
      </p>

      {posisi === null ? (
        <p className="text-sm text-muted-foreground">Memuat data pallet...</p>
      ) : (
        <div className="flex flex-col gap-2">
          {posisi.map((row, index) => (
            <div
              key={row.PosisiID}
              className={index === 0 ? "rounded-lg border-2 border-amber-500 p-3" : "rounded-lg border border-border p-3"}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  Pallet {row.Kode}
                  {index === 0 && <span className="ml-2 text-xs text-amber-600">Paling lama — ambil dulu</span>}
                </p>
                <Button size="sm" variant="outline" onClick={() => handleAmbilSemua(row)}>
                  Ambil semua sisa
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Sisa: {row.SisaQty10KG} kantong 10kg, {row.SisaQty5KG} kantong 5kg
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  type="number"
                  placeholder="Qty 10kg"
                  value={alokasi[row.PosisiID]?.qty10 ?? ""}
                  onChange={(e) => setAmbil(row.PosisiID, "qty10", Number(e.target.value), row.SisaQty10KG ?? 0)}
                />
                <Input
                  type="number"
                  placeholder="Qty 5kg"
                  value={alokasi[row.PosisiID]?.qty5 ?? ""}
                  onChange={(e) => setAmbil(row.PosisiID, "qty5", Number(e.target.value), row.SisaQty5KG ?? 0)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
```

Replace with:

```tsx
      <p className="text-sm text-muted-foreground">
        Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
      </p>
      <p className="text-sm">Sudah dialokasikan: {totalQty10} kantong 10kg</p>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Qty 5kg dimuat (tanpa pallet, langsung)</label>
        <Input type="number" value={qty5Dimuat} onChange={(e) => setQty5Dimuat(e.target.value)} className="mt-1" />
      </div>

      {batchList === null ? (
        <p className="text-sm text-muted-foreground">Memuat data pallet...</p>
      ) : (
        <div className="flex flex-col gap-2">
          {batchList.map((row, index) => (
            <div
              key={row.BatchID}
              className={index === 0 ? "rounded-lg border-2 border-amber-500 p-3" : "rounded-lg border border-border p-3"}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  Pallet {row.Kode}
                  {index === 0 && <span className="ml-2 text-xs text-amber-600">Paling lama — ambil dulu</span>}
                </p>
                <Button size="sm" variant="outline" onClick={() => handleAmbilSemua(row)}>
                  Ambil semua sisa
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Sisa: {row.SisaQty10KG} kantong 10kg</p>
              <div className="mt-2">
                <Input
                  type="number"
                  placeholder="Qty 10kg"
                  value={alokasi[row.BatchID] ?? ""}
                  onChange={(e) => setAmbil(row.BatchID, Number(e.target.value), row.SisaQty10KG)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep "kartu-pengiriman-list.tsx"`
Expected: 0 errors.
Run: `npx eslint src/components/produksi-app/kartu-pengiriman-list.tsx`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi-app/kartu-pengiriman-list.tsx
git commit -m "feat: per-batch alokasi list + top-level Qty 5kg dimuat field"
```

---

### Task 9: Full verification pass

**Files:** None (verification only — fix forward in the touched files above if something's found broken).

- [ ] **Step 1: Whole-project typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors project-wide.

- [ ] **Step 2: Whole-project lint on every file touched by this plan**

Run: `npx eslint src/lib/queries/produksi-warehouse.ts src/lib/queries/produksi-muatan.ts src/app/mkesindo/produksi/actions.ts src/components/produksi-app/tambah-produksi-dialog.tsx src/components/produksi-app/warehouse-view.tsx src/components/produksi/warehouse-cell.tsx src/components/produksi/peta-warehouse-desktop.tsx src/components/produksi/riwayat-produksi.tsx src/components/produksi-app/kartu-pengiriman-list.tsx`
Expected: 0 errors.

- [ ] **Step 3: Live browser verification — mobile, empty pallet**

Log in as a `Produksi`-role account, open `/mkesindo/produksi-app`, Stok Es tab. Click a position with `-` (kosong). Confirm the detail popup shows "Terisi 0/120", riwayat empty, and a "+ Tambah Produksi" button. Click it, fill Mesin/Jam Panen/Qty 10kg, submit. Confirm the cell now shows a color + the qty just entered, and the popup (reopened) shows 1 riwayat row and the correct Terisi total.

- [ ] **Step 4: Live browser verification — mobile, stacking a second batch on the same position**

Click the SAME position again. Confirm the detail popup now shows the updated capacity, still has a "+ Tambah Produksi" button (since under 120), and clicking it opens the form again (pre-filled default state, not the previous entry). Submit a second batch. Reopen the detail popup: confirm 2 riwayat rows now appear, `Terisi` reflects the sum of both, and the cell shows a "×2" badge and the summed Sisa number. Confirm the cell's color reflects the OLDER of the two batches (i.e. doesn't reset to "baru" just because a newer batch was added).

- [ ] **Step 5: Live browser verification — 120 cap enforcement**

On the same position (now holding 2 batches), attempt to add a third batch with a `Qty 10kg` large enough to push the total over 120. Confirm the client-side error fires before submission ("Melebihi sisa kapasitas..."). Then bypass the client check via `javascript_tool` (call the underlying action directly with an over-cap value, or temporarily allow the input) to confirm the SERVER also rejects with `AppError` — the client check alone must not be the only gate.

- [ ] **Step 6: Live browser verification — desktop `/mkesindo/produksi`**

Open `/mkesindo/produksi`, Peta Warehouse. Confirm the same multi-batch position shows the "×2" badge and summed Sisa. Click it: confirm the detail panel shows the same riwayat list (2 rows) and capacity line, with NO "+ Tambah Produksi" button (desktop stays view-only). Check the Riwayat Produksi tab: confirm both batches appear as separate rows, "Jumlah Awal"/"Sisa" columns show only 10kg (no "-0" or blank 5kg remnant).

- [ ] **Step 7: Live browser verification — Isi Muatan with a stacked position**

Find (or create, if none exists) a Kartu Pengiriman in Draft with `Qty10KGDibutuhkan` small enough to be satisfiable from the 2 batches at the test position above. Go through Mulai Muat → alokasi screen. Confirm the pallet list shows 2 SEPARATE rows for the same Kode (one per batch), correctly FIFO-ordered (older batch first, badge on it). Allocate from both, fill "Qty 5kg dimuat" with a value, confirm "Konfirmasi Isi Muatan" enables once both 10kg and 5kg requirements are met, and complete it. Confirm the Jadwal moves to "Sudah Selesai Muat" and the two batches' `SisaQty10KG` decremented correctly (re-check the warehouse map — the position's total should now be lower or the position empty if fully consumed).

- [ ] **Step 8: Regression check — satpam-app / driver-app kantong displays unaffected**

Open `/mkesindo/satpam-app` and (if reachable) driver-app for the same delivery used in Step 7. Confirm the 10kg/5kg kantong breakdown shown there is unchanged in format and still reflects the Jadwal's order-derived demand (`JADWAL_KANTONG_10KG_EXPR`/`JADWAL_KANTONG_5KG_EXPR`), not anything from the pallet/batch changes in this plan.

- [ ] **Step 9: Clean up test data**

Delete/reset any test batches, Jadwal allocations, and pallet positions touched during Steps 3-7 back to their prior state (or, if this ran against a position that was already empty before testing, reset it to empty again) — mirroring this codebase's established pattern of not leaving test artifacts in production-adjacent data after a verification pass.

- [ ] **Step 10: Final commit**

If Steps 1-9 required any fixes beyond what Tasks 0-8 already committed, commit them now with a clear message describing what verification caught. If nothing needed fixing, this step is a no-op — the plan is done as of Task 8's last commit.
