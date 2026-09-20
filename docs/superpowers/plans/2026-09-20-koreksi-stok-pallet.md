# Koreksi Stok Pallet Cold Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bangun fitur admin-only "Koreksi Stok Pallet" di `/mkesindo/produksi` untuk memperbaiki stok baseline (pallet lama belum tercatat sistem) dan koreksi opname (selisih fisik vs sistem), dengan jejak audit penuh.

**Architecture:** Satu tabel audit baru (`DashboardKoreksiStokPallet`, dibedakan lewat kolom `Jenis`) menampung 3 jenis event koreksi: perbaikan qty/hapus pada mekanisme yang sudah ada (`updateBatchQty`/`deleteBatch`, sekarang digerbangi admin-only + wajib alasan), penambahan pallet baseline baru tanpa `KualitasID`, dan koreksi langsung ke snapshot historis (`DashboardLaporanShiftStokEsSnapshot`). Panel Korelasi Produksi-Penjualan tidak disentuh sama sekali — ia sudah selalu membaca `SisaQty10KG`/snapshot asli, jadi koreksi otomatis mengalir ke sana.

**Tech Stack:** Next.js 16 App Router, TypeScript, `mssql` driver, SQL Server (via `getPool()`, database "utama" MKEsindo).

**Spec:** docs/superpowers/specs/2026-09-20-koreksi-stok-pallet-design.md

## Global Constraints

- Semua UI dan pesan error berbahasa Indonesia.
- Keempat aksi (koreksi qty, hapus, baseline, koreksi snapshot) WAJIB `requireProduksiAdmin()` — bukan `requireProduksiView()`. Ini perbaikan celah akses yang sudah ada pada `updateBatchQtyAction`/`deleteBatchAction`, bukan sekadar gate baru.
- Setiap aksi koreksi WAJIB mengisi `Alasan` (tidak boleh kosong/whitespace) dan menulis satu baris `DashboardKoreksiStokPallet` DALAM TRANSAKSI YANG SAMA dengan perubahan datanya.
- Koreksi berlaku LANGSUNG begitu disubmit (tidak ada alur approval berlapis).
- `KualitasID` pada Batch baseline SELALU `NULL`.
- Koreksi snapshot historis HANYA lewat UPDATE langsung ke baris yang sudah ada — TIDAK PERNAH soft-delete + insert ulang (lihat WARNING di `catatSnapshotJikaBelumAda`, `laporan-shift-stok-es-snapshot.ts`).
- Tidak ada framework migrasi — tabel baru lewat script `scripts/_scratch_*.ts` sekali jalan (via `npx tsx --env-file=.env`), dijalankan lalu dihapus, tidak pernah di-commit.
- Tidak ada test suite otomatis — setiap task diverifikasi via `npx tsc --noEmit`, `npx eslint`, script scratch DB terhadap data live.
- Panel Korelasi Produksi-Penjualan (`produksi-korelasi-penjualan.ts`) TIDAK diubah kodenya sama sekali di plan ini.

## Review Focus

- Akun tanpa akses admin (`isProduksi=true` tapi tanpa permission modul "produksi") memanggil salah satu dari 4 aksi baru/diubah — orang wajar mengharapkan ini DITOLAK, bukan berhasil diam-diam karena lupa mengganti gate dari `requireProduksiView`.
- `Alasan` dikirim kosong/hanya spasi — orang wajar mengharapkan aksi DITOLAK dengan pesan jelas, bukan tersimpan sebagai baris audit kosong yang tidak berguna.
- Baseline yang membuat total `SisaQty10KG` di satu posisi melebihi `KAPASITAS_PALLET_10KG` — orang wajar mengharapkan ini DITOLAK (sama seperti `createBatch`/`updateBatchQty` yang sudah ada), bukan pallet fisik "meluap" secara sistem.
- Koreksi snapshot untuk `(TanggalUsaha, Shift)` yang BELUM PERNAH punya snapshot — orang wajar mengharapkan pesan jelas ("belum ada snapshot"), bukan crash SQL mentah atau (lebih parah) diam-diam INSERT baris baru yang nanti bentrok `UQ_LaporanShiftStokEsSnapshot`.
- Perubahan data berhasil tapi baris audit gagal tercatat (atau sebaliknya) akibat urutan operasi yang salah dalam transaksi — orang wajar mengharapkan keduanya SELALU sinkron (all-or-nothing), karena itulah tujuan utama fitur audit ini.

---

### Task 1: Skema `DashboardKoreksiStokPallet`

**Files:**
- Scratch (dibuat lalu dihapus, TIDAK di-commit): `scripts/_scratch_koreksi_stok_pallet_schema.ts`

**Interfaces:**
- Produces: tabel `DashboardKoreksiStokPallet(KoreksiID INT IDENTITY PK, Jenis VARCHAR(20), BatchID INT NULL, TanggalUsaha DATE NULL, Shift TINYINT NULL, QtyLama INT NULL, QtyBaru INT NOT NULL, Alasan NVARCHAR(500) NOT NULL, DicatatOlehAkunID INT NOT NULL, CreatedDate DATETIME DEFAULT GETDATE())` di database MSSQL "utama" MKEsindo — dipakai Task 2 (Jenis='KOREKSI'), Task 3 (Jenis='BASELINE'), Task 4 (Jenis='SNAPSHOT').

- [ ] **Step 1: Tulis & jalankan script skema**

Buat `scripts/_scratch_koreksi_stok_pallet_schema.ts`:

```typescript
import { getPool } from "@/lib/db";

async function main() {
  const pool = await getPool();
  await pool.request().query(`
    CREATE TABLE DashboardKoreksiStokPallet (
      KoreksiID INT IDENTITY PRIMARY KEY,
      Jenis VARCHAR(20) NOT NULL,
      BatchID INT NULL,
      TanggalUsaha DATE NULL,
      Shift TINYINT NULL,
      QtyLama INT NULL,
      QtyBaru INT NOT NULL,
      Alasan NVARCHAR(500) NOT NULL,
      DicatatOlehAkunID INT NOT NULL,
      CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log("DashboardKoreksiStokPallet created.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx --env-file=.env scripts/_scratch_koreksi_stok_pallet_schema.ts`
Expected: output `DashboardKoreksiStokPallet created.`, exit code 0.

- [ ] **Step 2: Verifikasi skema live**

Jalankan query verifikasi (bisa ditambahkan sementara ke script yang sama sebelum dihapus):

```sql
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'DashboardKoreksiStokPallet' ORDER BY ORDINAL_POSITION
```

Expected: 9 kolom sesuai definisi di atas, `KoreksiID`/`Jenis`/`QtyBaru`/`Alasan`/`DicatatOlehAkunID`/`CreatedDate` = `IS_NULLABLE='NO'`, `BatchID`/`TanggalUsaha`/`Shift`/`QtyLama` = `IS_NULLABLE='YES'`.

- [ ] **Step 3: Hapus script scratch**

```bash
rm scripts/_scratch_koreksi_stok_pallet_schema.ts
```

Tidak ada commit untuk task ini — konsisten dengan konvensi repo ini untuk setiap perubahan skema.

---

### Task 2: Perbaiki & lengkapi mekanisme koreksi yang sudah ada (Bagian 1)

**Files:**
- Modify: `src/lib/queries/produksi-warehouse.ts:334-455` (`UpdateBatchQtyInput`, `updateBatchQty`, `deleteBatch`)
- Modify: `src/app/mkesindo/produksi/actions.ts:193-217` (`updateBatchQtyAction`, `deleteBatchAction`)
- Modify: `src/components/produksi/riwayat-posisi-list-desktop.tsx` (`BatchRow`)

**Interfaces:**
- Consumes: tabel `DashboardKoreksiStokPallet` (Task 1).
- Produces: `updateBatchQty(input: UpdateBatchQtyInput)` dengan `UpdateBatchQtyInput` bertambah `alasan: string; dicatatOlehAkunId: number`. `deleteBatch(input: DeleteBatchInput)` — signature BERUBAH dari `deleteBatch(batchId: number)` menjadi menerima satu object `{ batchId, alasan, dicatatOlehAkunId }`. `updateBatchQtyAction(batchId, qty10KG, alasan)` dan `deleteBatchAction(batchId, alasan)` — kedua action bertambah parameter `alasan: string`.

- [ ] **Step 1: `updateBatchQty` — tambah audit trail**

Di `src/lib/queries/produksi-warehouse.ts`, ubah interface (baris 334-337):

```typescript
export interface UpdateBatchQtyInput {
  batchId: number;
  qty10KG: number;
  alasan: string;
  dicatatOlehAkunId: number;
}
```

Di dalam `updateBatchQty` (baris 348-425), TEPAT SEBELUM `await transaction.commit();` (baris 420), tambahkan INSERT audit:

```typescript
    await new sql.Request(transaction)
      .input("batchId", sql.Int, input.batchId)
      .input("qtyLama", sql.Int, batch.Qty10KG)
      .input("qtyBaru", sql.Int, input.qty10KG)
      .input("alasan", sql.NVarChar(500), input.alasan)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .query(`
        INSERT INTO DashboardKoreksiStokPallet (Jenis, BatchID, QtyLama, QtyBaru, Alasan, DicatatOlehAkunID)
        VALUES ('KOREKSI', @batchId, @qtyLama, @qtyBaru, @alasan, @akunId)
      `);

    await transaction.commit();
```

(`batch.Qty10KG` di sini adalah nilai LAMA yang sudah dibaca di baris 358-360, sebelum UPDATE baris 373-379 mengubahnya — jangan baca ulang setelah UPDATE.) Baris-baris lain di fungsi ini (klaim posisi, UPDATE Batch, cek kapasitas, cek plafon Kualitas, catch/rollback) TIDAK berubah.

- [ ] **Step 2: `deleteBatch` — bungkus transaksi + audit trail**

Ganti seluruh fungsi `deleteBatch` (baris 434-455) dari:

```typescript
export async function deleteBatch(batchId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("batchId", sql.Int, batchId)
    .query(`
      UPDATE DashboardProduksiBatch
      SET IsDeleted = 1, ModifiedDate = GETDATE()
      OUTPUT INSERTED.BatchID
      WHERE BatchID = @batchId AND IsDeleted = 0 AND SisaQty10KG = Qty10KG
    `);
  if (result.recordset.length === 0) {
    const check = await pool
      .request()
      .input("batchId", sql.Int, batchId)
      .query(`SELECT IsDeleted, Qty10KG, SisaQty10KG FROM DashboardProduksiBatch WHERE BatchID = @batchId`);
    const row = check.recordset[0] as { IsDeleted: boolean; Qty10KG: number; SisaQty10KG: number } | undefined;
    if (!row || row.IsDeleted) throw new AppError("Input stok ini tidak ditemukan.");
    const terpakai = row.Qty10KG - row.SisaQty10KG;
    throw new AppError(`Tidak bisa dihapus, sudah ada ${terpakai} kantong yang terpakai.`);
  }
}
```

jadi:

```typescript
export interface DeleteBatchInput {
  batchId: number;
  alasan: string;
  dicatatOlehAkunId: number;
}

export async function deleteBatch(input: DeleteBatchInput): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input("batchId", sql.Int, input.batchId)
      .query(`
        UPDATE DashboardProduksiBatch
        SET IsDeleted = 1, ModifiedDate = GETDATE()
        OUTPUT INSERTED.BatchID, INSERTED.Qty10KG
        WHERE BatchID = @batchId AND IsDeleted = 0 AND SisaQty10KG = Qty10KG
      `);
    if (result.recordset.length === 0) {
      const check = await new sql.Request(transaction)
        .input("batchId", sql.Int, input.batchId)
        .query(`SELECT IsDeleted, Qty10KG, SisaQty10KG FROM DashboardProduksiBatch WHERE BatchID = @batchId`);
      const row = check.recordset[0] as { IsDeleted: boolean; Qty10KG: number; SisaQty10KG: number } | undefined;
      if (!row || row.IsDeleted) throw new AppError("Input stok ini tidak ditemukan.");
      const terpakai = row.Qty10KG - row.SisaQty10KG;
      throw new AppError(`Tidak bisa dihapus, sudah ada ${terpakai} kantong yang terpakai.`);
    }

    const deleted = result.recordset[0] as { BatchID: number; Qty10KG: number };
    await new sql.Request(transaction)
      .input("batchId", sql.Int, input.batchId)
      .input("qtyLama", sql.Int, deleted.Qty10KG)
      .input("alasan", sql.NVarChar(500), input.alasan)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .query(`
        INSERT INTO DashboardKoreksiStokPallet (Jenis, BatchID, QtyLama, QtyBaru, Alasan, DicatatOlehAkunID)
        VALUES ('KOREKSI', @batchId, @qtyLama, 0, @alasan, @akunId)
      `);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

(`OUTPUT INSERTED.Qty10KG` ditambahkan ke UPDATE supaya QtyLama bisa dibaca dari hasil UPDATE itu sendiri, tanpa SELECT terpisah sebelumnya yang bisa balapan dengan transaksi lain.)

- [ ] **Step 3: Perbaiki gate akses & wire `alasan` di `actions.ts`**

Ganti `updateBatchQtyAction`/`deleteBatchAction` (`src/app/mkesindo/produksi/actions.ts:193-217`) dari:

```typescript
export async function updateBatchQtyAction(batchId: number, qty10KG: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!qty10KG || qty10KG <= 0) throw new AppError("Isi jumlah kantong 10kg.");
    await updateBatchQty({ batchId, qty10KG });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function deleteBatchAction(batchId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    await deleteBatch(batchId);
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}
```

jadi:

```typescript
export async function updateBatchQtyAction(batchId: number, qty10KG: number, alasan: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiAdmin();
    if (!qty10KG || qty10KG <= 0) throw new AppError("Isi jumlah kantong 10kg.");
    if (!alasan.trim()) throw new AppError("Isi alasan koreksi.");
    await updateBatchQty({ batchId, qty10KG, alasan: alasan.trim(), dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function deleteBatchAction(batchId: number, alasan: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiAdmin();
    if (!alasan.trim()) throw new AppError("Isi alasan penghapusan.");
    await deleteBatch({ batchId, alasan: alasan.trim(), dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}
```

(`requireProduksiAdmin` sudah diimpor di baris 4 file ini, tidak perlu import baru.)

- [ ] **Step 4: Tambah field Alasan di UI**

Di `src/components/produksi/riwayat-posisi-list-desktop.tsx`, `BatchRow`: tambah state `alasan` (default `""`), reset ke `""` setiap kali `setEditing(true)` dipanggil (baris ~82-86). Tambah `Input` teks di bawah field Qty yang sudah ada di blok `editing` (baris 103-119):

```tsx
      {editing && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={terpakai}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-7 w-24 text-xs"
            />
            <Button size="sm" className="h-7 px-2 text-xs" disabled={pending || !alasan.trim()} onClick={handleSimpan}>
              Simpan
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={pending} onClick={() => setEditing(false)}>
              Batal
            </Button>
          </div>
          <Input
            type="text"
            placeholder="Alasan koreksi (wajib)"
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      )}
```

Ubah `handleSimpan` (baris 35-46) supaya mengirim `alasan`:

```typescript
  function handleSimpan() {
    setError(null);
    startTransition(async () => {
      const result = await updateBatchQtyAction(row.BatchID, Number(qty) || 0, alasan.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setEditing(false);
      onChanged();
    });
  }
```

Ubah `handleHapus` (baris 48-59) dari `confirm(...)` polos jadi `prompt(...)` meminta alasan:

```typescript
  function handleHapus() {
    const alasanHapus = prompt(`Hapus input ${row.Qty10KG} kantong dari ${row.MesinNama} ini? Tindakan ini tidak bisa dibatalkan. Isi alasan penghapusan:`);
    if (!alasanHapus || !alasanHapus.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteBatchAction(row.BatchID, alasanHapus.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }
```

- [ ] **Step 5: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/produksi-warehouse.ts src/app/mkesindo/produksi/actions.ts src/components/produksi/riwayat-posisi-list-desktop.tsx`
Expected: tidak ada error.

- [ ] **Step 6: Verifikasi lewat script scratch**

Tulis script scratch yang:
1. Memanggil `updateBatchQty` langsung terhadap satu `BatchID` nyata dengan `alasan` kosong string `""` -- HARUS ditolak sebelum sampai ke fungsi ini kalau lewat action (action-level validation), tapi karena ini memanggil fungsi query langsung (bukan action), fungsi query sendiri TIDAK wajib validasi alasan-kosong (itu tanggung jawab action layer) -- jadi untuk verifikasi alasan-kosong, panggil `updateBatchQtyAction`/`deleteBatchAction` (bukan fungsi query-nya) via import langsung dari `actions.ts`, dengan `alasan=""` -- pastikan `result.success === false` dan pesannya "Isi alasan koreksi."/"Isi alasan penghapusan.".
2. Panggil `updateBatchQty` dengan qty & alasan valid terhadap satu BatchID nyata (qty kecil, tidak mengubah signifikan) di dalam transaksi manual yang di-ROLLBACK (jangan pakai fungsi asli yang buka transaksi sendiri untuk ini -- cukup baca `Qty10KG` batch itu SEBELUM dan SESUDAH memanggil fungsi asli lalu bandingkan, lalu panggil `updateBatchQty` lagi dengan qty ASLI + alasan "revert verifikasi" untuk mengembalikan seperti semula, karena fungsi ini membuka transaksinya sendiri dan tidak menerima transaksi eksternal). Verifikasi baris `DashboardKoreksiStokPallet` baru muncul dengan `QtyLama`/`QtyBaru` yang benar untuk KEDUA pemanggilan (yang mengubah dan yang me-revert).
3. Verifikasi bahwa memanggil `updateBatchQtyAction`/`deleteBatchAction` sebagai akun BUKAN admin (kalau ada akun uji `isProduksi=true` tanpa permission "produksi" yang bisa dipakai untuk simulasi -- kalau tidak ada cara mudah menyimulasikan session berbeda dari scratch script, verifikasi ini CUKUP lewat pembacaan kode `requireProduksiAdmin` untuk memastikan gate-nya benar diterapkan, dan laporkan keterbatasan ini di report).

Hapus script setelah selesai.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/produksi-warehouse.ts src/app/mkesindo/produksi/actions.ts src/components/produksi/riwayat-posisi-list-desktop.tsx
git commit -m "fix: gerbang admin-only dan wajib alasan pada koreksi stok pallet"
```

---

### Task 3: Baseline — pallet baru tanpa KualitasID (Bagian 2)

**Files:**
- Modify: `src/lib/queries/produksi-warehouse.ts` (fungsi baru `createBatchBaseline`)
- Modify: `src/app/mkesindo/produksi/actions.ts` (action baru `createBatchBaselineAction`)
- Modify: `src/components/produksi/peta-warehouse-desktop.tsx` (tombol + form "Tambah Stok Awal" di panel Info Pallet yang sudah ada)
- Modify: `src/app/mkesindo/(dashboard)/produksi/page.tsx:62` (teruskan `mesinList` sebagai prop baru ke `PetaWarehouseDesktop`)

**Interfaces:**
- Consumes: tabel `DashboardKoreksiStokPallet` (Task 1), `KAPASITAS_PALLET_10KG` (`@/lib/produksi-warehouse-constants`, sudah ada), `MesinRow` (`@/lib/queries/produksi-mesin`, sudah ada).
- Produces: `createBatchBaseline(input: CreateBatchBaselineInput): Promise<number>` (return `BatchID` baru), `createBatchBaselineAction(input): Promise<ActionResult<number>>`.

**Catatan penting dari investigasi:** klik SATU posisi pallet manapun di Peta Cold Storage (`peta-warehouse-desktop.tsx`, handler `onClick={(r) => r && setSelectedPosisiId(r.PosisiID)}`) SUDAH membuka panel "Info Pallet" yang sama, baik posisi itu kosong (`JumlahBatchAktif: 0`) MAUPUN terisi -- `getWarehouseMap()` mengembalikan satu baris untuk SETIAP posisi (42 total), bukan `undefined` untuk yang kosong. Jadi "Tambah Stok Awal" TIDAK perlu cabang klik baru terpisah -- cukup tombol tambahan di dalam panel Info Pallet yang sudah ada.

- [ ] **Step 1: Tambah `createBatchBaseline`**

Di `src/lib/queries/produksi-warehouse.ts`, tambahkan setelah fungsi `createBatch` yang sudah ada:

```typescript
export interface CreateBatchBaselineInput {
  posisiId: number;
  mesinId: number;
  qty10KG: number;
  alasan: string;
  dicatatOlehAkunId: number;
}

// Pallet baseline -- stok fisik yang sudah ada di gudang SEBELUM sistem ini
// melacak stok, tidak pernah tercatat lewat Cek Kualitas -> Tambah Produksi
// normal. KualitasID sengaja NULL (data produksi aslinya memang tidak
// pernah tercatat) -- kolom ini sudah nullable di skema live. mesinId tetap
// wajib diisi (kolom NOT NULL) murni formalitas administratif, admin
// memilih salah satu Mesin yang ada, BUKAN klaim bahwa stok ini benar dari
// mesin tersebut. Locking/cek kapasitas mengikuti pola createBatch persis.
export async function createBatchBaseline(input: CreateBatchBaselineInput): Promise<number> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input("posisiId", sql.Int, input.posisiId)
      .query(`SELECT PosisiID FROM DashboardProduksiPalletPosisi WITH (UPDLOCK, HOLDLOCK) WHERE PosisiID = @posisiId`);

    const { businessDate, shift } = getReportShift("work");
    const tanggalLabel = businessDate.toISOString().slice(0, 10);

    const insertResult = await new sql.Request(transaction)
      .input("mesinId", sql.Int, input.mesinId)
      .input("posisiId", sql.Int, input.posisiId)
      .input("qty10", sql.Int, input.qty10KG)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .input("tanggalLabel", sql.Date, tanggalLabel)
      .input("shift", sql.TinyInt, shift)
      .query(`
        INSERT INTO DashboardProduksiBatch (MesinID, PosisiID, TanggalProduksi, Qty10KG, SisaQty10KG, DicatatOlehAkunID, TanggalLabel, Shift, JamPanen, KualitasID)
        OUTPUT INSERTED.BatchID
        VALUES (@mesinId, @posisiId, GETDATE(), @qty10, @qty10, @akunId, @tanggalLabel, @shift, NULL, NULL)
      `);
    const batchId = insertResult.recordset[0].BatchID as number;

    const capacityCheck = await new sql.Request(transaction)
      .input("posisiId", sql.Int, input.posisiId)
      .query(`
        SELECT ISNULL(SUM(SisaQty10KG), 0) AS TotalSisa
        FROM DashboardProduksiBatch
        WHERE PosisiID = @posisiId AND IsDeleted = 0 AND SisaQty10KG > 0
      `);
    const totalSisa = capacityCheck.recordset[0].TotalSisa as number;
    if (totalSisa > KAPASITAS_PALLET_10KG) {
      throw new AppError(`Kapasitas pallet ini penuh -- total jadi ${totalSisa}/${KAPASITAS_PALLET_10KG} kantong 10kg.`);
    }

    await new sql.Request(transaction)
      .input("batchId", sql.Int, batchId)
      .input("qtyBaru", sql.Int, input.qty10KG)
      .input("alasan", sql.NVarChar(500), input.alasan)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .query(`
        INSERT INTO DashboardKoreksiStokPallet (Jenis, BatchID, QtyBaru, Alasan, DicatatOlehAkunID)
        VALUES ('BASELINE', @batchId, @qtyBaru, @alasan, @akunId)
      `);

    await transaction.commit();
    return batchId;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

Tambahkan import `getReportShift` dari `@/lib/report-shift` di bagian atas file (belum diimpor sebelumnya di file ini).

- [ ] **Step 2: Tambah action**

Di `src/app/mkesindo/produksi/actions.ts`, tambahkan setelah `deleteBatchAction`:

```typescript
export async function createBatchBaselineAction(
  posisiId: number,
  mesinId: number,
  qty10KG: number,
  alasan: string
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiAdmin();
    if (!qty10KG || qty10KG <= 0) throw new AppError("Isi jumlah kantong 10kg.");
    if (!alasan.trim()) throw new AppError("Isi alasan penambahan stok awal.");
    const batchId = await createBatchBaseline({
      posisiId,
      mesinId,
      qty10KG,
      alasan: alasan.trim(),
      dicatatOlehAkunId: Number(session.user.id),
    });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    return batchId;
  });
}
```

Tambahkan `createBatchBaseline`, `type CreateBatchBaselineInput` ke import dari `@/lib/queries/produksi-warehouse` di baris 6-18 file ini.

- [ ] **Step 3: Tambah UI di panel Info Pallet**

Di `src/components/produksi/peta-warehouse-desktop.tsx`, tambahkan prop baru `mesinList: MesinRow[]` ke `PetaWarehouseDesktop`:

```typescript
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import { createBatchBaselineAction } from "@/app/mkesindo/produksi/actions";

export function PetaWarehouseDesktop({ posisi, mesinList }: { posisi: PalletPosisiRow[]; mesinList: MesinRow[] }) {
```

Tambahkan state form baru di dalam komponen (dekat `selectedPosisiId`):

```typescript
  const [showBaselineForm, setShowBaselineForm] = useState(false);
  const [baselineMesinId, setBaselineMesinId] = useState<number | "">("");
  const [baselineQty, setBaselineQty] = useState("");
  const [baselineAlasan, setBaselineAlasan] = useState("");
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [baselinePending, startBaselineTransition] = useTransition();

  function handleTambahBaseline() {
    if (!selected) return;
    setBaselineError(null);
    startBaselineTransition(async () => {
      const result = await createBatchBaselineAction(
        selected.PosisiID,
        Number(baselineMesinId),
        Number(baselineQty) || 0,
        baselineAlasan.trim()
      );
      if (!result.success) {
        setBaselineError(result.error);
        return;
      }
      setShowBaselineForm(false);
      setBaselineMesinId("");
      setBaselineQty("");
      setBaselineAlasan("");
    });
  }
```

Tambahkan import `useTransition` ke baris `import { useEffect, useRef, useState } from "react";` yang sudah ada, jadi `import { useEffect, useRef, useState, useTransition } from "react";`.

Di dalam blok `{selected && (...)}` (sekitar baris 158-179), TEPAT SEBELUM `</div>` penutup panel (setelah blok ringkasan "Terisi X/120..."), tambahkan:

```tsx
            {!showBaselineForm ? (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowBaselineForm(true)}>
                + Tambah Stok Awal
              </Button>
            ) : (
              <div className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
                <p className="text-xs font-semibold">Tambah Stok Awal</p>
                <select
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                  value={baselineMesinId}
                  onChange={(e) => setBaselineMesinId(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  <option value="">Pilih Mesin</option>
                  {mesinList.map((m) => (
                    <option key={m.MesinID} value={m.MesinID}>
                      {m.Nama}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  placeholder="Qty 10kg"
                  value={baselineQty}
                  onChange={(e) => setBaselineQty(e.target.value)}
                  className="h-7 text-xs"
                />
                <Input
                  type="text"
                  placeholder="Alasan (wajib)"
                  value={baselineAlasan}
                  onChange={(e) => setBaselineAlasan(e.target.value)}
                  className="h-7 text-xs"
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    disabled={baselinePending || !baselineMesinId || !baselineQty || !baselineAlasan.trim()}
                    onClick={handleTambahBaseline}
                  >
                    Simpan
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowBaselineForm(false)}>
                    Batal
                  </Button>
                </div>
                {baselineError && <p className="text-[11px] text-destructive">{baselineError}</p>}
              </div>
            )}
```

Tambahkan import `Input` dari `@/components/ui/input` (belum diimpor sebelumnya di file ini).

- [ ] **Step 4: Teruskan `mesinList` dari page.tsx**

Di `src/app/mkesindo/(dashboard)/produksi/page.tsx:62`, ubah:

```tsx
          <PetaWarehouseDesktop posisi={posisi} />
```

jadi:

```tsx
          <PetaWarehouseDesktop posisi={posisi} mesinList={mesinList} />
```

(`mesinList` sudah di-fetch di baris 25 file ini untuk `PanelMesin`, tidak perlu query baru.)

- [ ] **Step 5: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/produksi-warehouse.ts src/app/mkesindo/produksi/actions.ts src/components/produksi/peta-warehouse-desktop.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"`
Expected: tidak ada error.

- [ ] **Step 6: Verifikasi lewat script scratch**

1. Panggil `createBatchBaselineAction` (bukan fungsi query langsung -- ini untuk menguji validasi di level action) dengan `alasan=""` -- harus `result.success === false` dengan pesan "Isi alasan penambahan stok awal.", dan pastikan TIDAK ADA baris `DashboardProduksiBatch`/`DashboardKoreksiStokPallet` baru tercipta.
2. Panggil `createBatchBaseline` langsung terhadap satu `PosisiID` nyata yang saat ini KOSONG (`JumlahBatchAktif: 0` dari `getWarehouseMap()`), dengan `mesinId` nyata dan `qty10KG` kecil (mis. 5). Verifikasi: Batch baru tercipta dengan `KualitasID = NULL`, `SisaQty10KG = Qty10KG = 5`. Verifikasi baris `DashboardKoreksiStokPallet` (Jenis='BASELINE') tercipta dengan `QtyBaru=5`, `QtyLama=NULL`.
3. Verifikasi kapasitas: panggil `createBatchBaseline` dengan `qty10KG` yang MELEBIHI sisa kapasitas posisi itu (mis. `KAPASITAS_PALLET_10KG + 1` kalau posisi masih kosong) -- harus `AppError` "Kapasitas pallet ini penuh...", dan `DashboardProduksiBatch` yang baru tadi TIDAK boleh ada (rollback total, verifikasi lewat query terpisah SEBELUM dan SESUDAH).
4. Hapus (soft-delete manual lewat query langsung, BUKAN via `deleteBatch` karena `deleteBatch` sekarang butuh transaksi/alasan) Batch hasil verifikasi #2 setelah selesai, supaya tidak meninggalkan data uji permanen di posisi yang dipakai -- KECUALI kalau posisi itu memang cocok dipakai sebagai baseline nyata sungguhan (tanyakan dulu ke user sebelum memutuskan, jangan asumsikan sendiri).

Hapus script setelah selesai.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/produksi-warehouse.ts src/app/mkesindo/produksi/actions.ts src/components/produksi/peta-warehouse-desktop.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"
git commit -m "feat: tambah stok awal (baseline) pallet tanpa KualitasID"
```

---

### Task 4: Koreksi snapshot historis (Bagian 3)

**Files:**
- Modify: `src/lib/queries/laporan-shift-stok-es-snapshot.ts` (fungsi baru `koreksiSnapshotStokEs`)
- Modify: `src/app/mkesindo/produksi/actions.ts` (action baru `koreksiSnapshotStokEsAction`, `getSnapshotStokEsAction`)
- Create: `src/components/produksi/koreksi-snapshot-dialog.tsx`
- Modify: `src/app/mkesindo/(dashboard)/produksi/page.tsx` (render tombol pemicu dialog baru)

**Interfaces:**
- Consumes: tabel `DashboardKoreksiStokPallet` (Task 1), `getSnapshotStokEs` (sudah ada, `laporan-shift-stok-es-snapshot.ts`).
- Produces: `koreksiSnapshotStokEs(tanggalUsaha, shift, qtyBaru, alasan, dicatatOlehAkunId): Promise<void>`, `koreksiSnapshotStokEsAction(...): Promise<ActionResult<void>>`, `getSnapshotStokEsAction(tanggalUsaha, shift): Promise<ActionResult<number | null>>`.

- [ ] **Step 1: Tambah `koreksiSnapshotStokEs`**

Di `src/lib/queries/laporan-shift-stok-es-snapshot.ts`, tambahkan setelah `getSnapshotStokEs`:

```typescript
// Perbaikan angka snapshot shift yang SUDAH final (bukan shift berjalan).
// WAJIB UPDATE langsung baris yang sudah ada -- lihat WARNING di
// catatSnapshotJikaBelumAda di atas: soft-delete+insert ulang akan bentrok
// UQ_LaporanShiftStokEsSnapshot yang tidak difilter IsDeleted.
export async function koreksiSnapshotStokEs(
  tanggalUsaha: string,
  shift: ShiftNumber,
  qtyBaru: number,
  alasan: string,
  dicatatOlehAkunId: number
): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const existing = await new sql.Request(transaction)
      .input("t", sql.Date, tanggalUsaha)
      .input("s", sql.TinyInt, shift)
      .query(
        `SELECT TotalSisaQty10KG FROM DashboardLaporanShiftStokEsSnapshot WITH (UPDLOCK, HOLDLOCK) WHERE TanggalUsaha = @t AND Shift = @s AND IsDeleted = 0`
      );
    const row = existing.recordset[0] as { TotalSisaQty10KG: number } | undefined;
    if (!row) throw new AppError("Belum ada snapshot untuk shift ini -- tidak bisa dikoreksi.");

    await new sql.Request(transaction)
      .input("t", sql.Date, tanggalUsaha)
      .input("s", sql.TinyInt, shift)
      .input("total", sql.Decimal(18, 2), qtyBaru)
      .query(
        `UPDATE DashboardLaporanShiftStokEsSnapshot SET TotalSisaQty10KG = @total WHERE TanggalUsaha = @t AND Shift = @s AND IsDeleted = 0`
      );

    await new sql.Request(transaction)
      .input("t", sql.Date, tanggalUsaha)
      .input("s", sql.TinyInt, shift)
      .input("qtyLama", sql.Int, row.TotalSisaQty10KG)
      .input("qtyBaru", sql.Int, qtyBaru)
      .input("alasan", sql.NVarChar(500), alasan)
      .input("akunId", sql.Int, dicatatOlehAkunId)
      .query(`
        INSERT INTO DashboardKoreksiStokPallet (Jenis, TanggalUsaha, Shift, QtyLama, QtyBaru, Alasan, DicatatOlehAkunID)
        VALUES ('SNAPSHOT', @t, @s, @qtyLama, @qtyBaru, @alasan, @akunId)
      `);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

Tambahkan import `AppError` dari `@/lib/action-result` di bagian atas file (belum diimpor sebelumnya di file ini).

- [ ] **Step 2: Tambah action**

Di `src/app/mkesindo/produksi/actions.ts`, tambahkan setelah `createBatchBaselineAction`:

```typescript
export async function getSnapshotStokEsAction(tanggalUsaha: string, shift: ShiftNumber): Promise<ActionResult<number | null>> {
  return runAction(async () => {
    await requireProduksiAdmin();
    return getSnapshotStokEs(tanggalUsaha, shift);
  });
}

export async function koreksiSnapshotStokEsAction(
  tanggalUsaha: string,
  shift: ShiftNumber,
  qtyBaru: number,
  alasan: string
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiAdmin();
    if (qtyBaru < 0) throw new AppError("Qty tidak boleh negatif.");
    if (!alasan.trim()) throw new AppError("Isi alasan koreksi.");
    await koreksiSnapshotStokEs(tanggalUsaha, shift, qtyBaru, alasan.trim(), Number(session.user.id));
    revalidatePath("/mkesindo/produksi");
  });
}
```

Tambahkan import `getSnapshotStokEs`, `koreksiSnapshotStokEs`, `type ShiftNumber` (dari `@/lib/report-shift`, kemungkinan sudah diimpor entah dari mana di file ini -- cek dulu sebelum menambah import duplikat) dari `@/lib/queries/laporan-shift-stok-es-snapshot` ke bagian atas `actions.ts`.

- [ ] **Step 3: Komponen dialog baru**

Buat `src/components/produksi/koreksi-snapshot-dialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { getSnapshotStokEsAction, koreksiSnapshotStokEsAction } from "@/app/mkesindo/produksi/actions";
import type { ShiftNumber } from "@/lib/report-shift";

export function KoreksiSnapshotDialog() {
  const [open, setOpen] = useState(false);
  const [tanggalUsaha, setTanggalUsaha] = useState("");
  const [shift, setShift] = useState<ShiftNumber | "">("");
  const [angkaLama, setAngkaLama] = useState<number | null | undefined>(undefined);
  const [qtyBaru, setQtyBaru] = useState("");
  const [alasan, setAlasan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCekSnapshot() {
    if (!tanggalUsaha || !shift) return;
    setError(null);
    startTransition(async () => {
      const result = await getSnapshotStokEsAction(tanggalUsaha, shift as ShiftNumber);
      if (!result.success) {
        setError(result.error);
        setAngkaLama(undefined);
        return;
      }
      setAngkaLama(result.data);
    });
  }

  function handleSimpan() {
    if (!tanggalUsaha || !shift) return;
    setError(null);
    startTransition(async () => {
      const result = await koreksiSnapshotStokEsAction(tanggalUsaha, shift as ShiftNumber, Number(qtyBaru) || 0, alasan.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setTanggalUsaha("");
      setShift("");
      setAngkaLama(undefined);
      setQtyBaru("");
      setAlasan("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="h-7 text-xs" />}>Koreksi Riwayat Stok</DialogTrigger>
      <DialogContent className="flex max-w-sm flex-col gap-3">
        <p className="text-sm font-semibold">Koreksi Snapshot Stok Es Historis</p>
        <Input type="date" value={tanggalUsaha} onChange={(e) => setTanggalUsaha(e.target.value)} className="h-8 text-xs" />
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={shift}
          onChange={(e) => setShift(e.target.value === "" ? "" : (Number(e.target.value) as ShiftNumber))}
        >
          <option value="">Pilih Shift</option>
          <option value={1}>Shift 1</option>
          <option value={2}>Shift 2</option>
          <option value={3}>Shift 3</option>
        </select>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pending || !tanggalUsaha || !shift} onClick={handleCekSnapshot}>
          Cek Angka Saat Ini
        </Button>
        {angkaLama !== undefined && (
          <p className="text-xs text-muted-foreground">
            {angkaLama === null ? "Belum ada snapshot untuk shift ini." : `Angka saat ini: ${angkaLama} kantong 10kg.`}
          </p>
        )}
        <Input type="number" placeholder="Qty baru" value={qtyBaru} onChange={(e) => setQtyBaru(e.target.value)} className="h-8 text-xs" />
        <Input type="text" placeholder="Alasan (wajib)" value={alasan} onChange={(e) => setAlasan(e.target.value)} className="h-8 text-xs" />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" disabled={pending || !tanggalUsaha || !shift || !qtyBaru || !alasan.trim() || angkaLama == null} onClick={handleSimpan}>
          Simpan Koreksi
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

(`angkaLama == null` sengaja mencakup `undefined` DAN `null` -- tombol Simpan nonaktif kalau belum pernah cek angka lama ATAU kalau hasil cek menunjukkan belum ada snapshot sama sekali, karena `koreksiSnapshotStokEs` akan menolak kasus itu.)

- [ ] **Step 4: Render tombol pemicu**

Di `src/app/mkesindo/(dashboard)/produksi/page.tsx`, tambah import `KoreksiSnapshotDialog` dan render di dekat `PetaWarehouseDesktop` (di dalam `<div className="relative mb-16 min-w-0">` yang sudah ada, sebagai sibling baru, atau di header section manapun yang masuk akal secara visual -- letakkan sebagai baris kecil TEPAT SEBELUM `<PetaWarehouseDesktop ... />`):

```tsx
import { KoreksiSnapshotDialog } from "@/components/produksi/koreksi-snapshot-dialog";
```

```tsx
        <div className="relative mb-16 min-w-0">
          <div className="mb-2 flex justify-end">
            <KoreksiSnapshotDialog />
          </div>
          <PetaWarehouseDesktop posisi={posisi} mesinList={mesinList} />
          <div className="absolute inset-x-4 bottom-0 z-10 translate-y-1/2">
            <PanelMesin mesinList={mesinList} />
          </div>
        </div>
```

- [ ] **Step 5: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/laporan-shift-stok-es-snapshot.ts src/app/mkesindo/produksi/actions.ts src/components/produksi/koreksi-snapshot-dialog.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"`
Expected: tidak ada error.

- [ ] **Step 6: Verifikasi lewat script scratch**

1. Panggil `koreksiSnapshotStokEsAction` (bukan fungsi query langsung) dengan `alasan=""` -- harus `result.success === false` dengan pesan "Isi alasan koreksi.", dan pastikan TIDAK ADA baris `DashboardLaporanShiftStokEsSnapshot`/`DashboardKoreksiStokPallet` yang berubah/tercipta.
2. Cari (query manual) satu `(TanggalUsaha, Shift)` yang SUDAH punya baris di `DashboardLaporanShiftStokEsSnapshot` (`IsDeleted=0`). Panggil `koreksiSnapshotStokEs` untuk shift itu dengan `qtyBaru` SAMA PERSIS dengan angka lamanya (no-op secara nilai, tapi tetap harus menulis baris audit) -- verifikasi baris `DashboardKoreksiStokPallet` (Jenis='SNAPSHOT') tercipta dengan `QtyLama = QtyBaru`, DAN verifikasi lewat query `SELECT COUNT(*) FROM DashboardLaporanShiftStokEsSnapshot WHERE TanggalUsaha=... AND Shift=...` masih PERSIS 1 baris (bukan 2 -- membuktikan ini UPDATE, bukan INSERT baru).
3. Cari `(TanggalUsaha, Shift)` yang BELUM punya snapshot sama sekali (misal shift yang sedang berjalan saat ini). Panggil `koreksiSnapshotStokEs` untuk itu -- harus `AppError("Belum ada snapshot untuk shift ini -- tidak bisa dikoreksi.")`, dan pastikan TIDAK ADA baris baru tercipta di `DashboardLaporanShiftStokEsSnapshot` maupun `DashboardKoreksiStokPallet` (verifikasi query sebelum/sesudah).
4. Karena verifikasi #2 di atas mengubah data nyata (meski nilainya sama), catat di report bahwa ini WAJAR dan disengaja (verifikasi no-op yang tetap real, konsisten dengan pola verifikasi proyek-proyek sebelumnya di sesi ini) -- BUKAN kesalahan.

Hapus script setelah selesai.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/laporan-shift-stok-es-snapshot.ts src/app/mkesindo/produksi/actions.ts src/components/produksi/koreksi-snapshot-dialog.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"
git commit -m "feat: koreksi snapshot stok es historis"
```
