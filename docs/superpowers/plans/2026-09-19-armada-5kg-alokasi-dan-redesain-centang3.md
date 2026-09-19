# Alokasi FIFO Armada 5KG & Redesain Centang 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun alokasi FIFO nyata untuk muatan Armada varian 5KG (mirip TakeAway), dan meredesain query centang 3 ("Mulai Muat") di kalender Jadwal Tim Produksi supaya memvalidasi bukti pengurangan stok nyata, bukan sekadar keberadaan timestamp.

**Architecture:** Tabel audit trail baru `DashboardArmadaAlokasi` mencatat setiap kali Armada Selesai Muat mengambil kantong 5KG dari entri Kualitas yang belum terpakai (FIFO, terbaru dulu, tanpa fallback ke pallet). Fungsi baru `allocateArmadaStock5KG` (file baru, pola sama persis dengan `allocateTakeAwayStock` yang sudah ada) dipanggil di dalam transaksi `produksiSelesaiMuat` yang sudah ada. Query Sumber 1 `allocateTakeAwayStock` diperbarui supaya kedua konsumen (TakeAway & Armada) tidak rebutan stok Kualitas-5KG yang sama. Dua formula tampilan "sisa alokasi" yang sudah ada diperbarui supaya konsisten. Terakhir, `getValidasiBulan`'s query `muatan` (centang 3) diganti total: dari "ada timestamp JamSelesaiMuat" jadi "ada timestamp JamSelesaiMuat YANG PUNYA BUKTI ALOKASI nyata" digabung dari 3 sumber bukti (MuatanDetail untuk Armada-10KG, ArmadaAlokasi baru untuk Armada-5KG, TakeAwayAlokasi untuk TakeAway).

**Tech Stack:** Next.js 16 App Router, TypeScript, `mssql` driver, SQL Server (via `getPool()`, database "utama" MKEsindo).

**Spec:** docs/superpowers/specs/2026-09-19-armada-5kg-alokasi-dan-redesain-centang3-design.md

## Global Constraints

- Semua UI dan pesan error berbahasa Indonesia.
- `DashboardArmadaAlokasi` hanya pernah berisi KualitasID varian 5kg — tidak pernah 10kg.
- FIFO Armada-5KG: terbaru dulu (`ORDER BY TanggalLabel DESC, Waktu DESC`) — sama arah dengan Sumber 1 TakeAway, TIDAK BOLEH disamakan dengan arah FIFO Pallet/Batch (tertua dulu).
- Alokasi Armada-5KG terjadi di Selesai Muat (bukan Mulai Muat), di transaksi SQL yang sama dengan tulisan lain `produksiSelesaiMuat`.
- Stok 5KG tidak pernah fallback ke pallet — kalau kurang, Selesai Muat armada ditolak total (rollback), sama seperti perilaku TakeAway.
- `TOP 200` + `WITH (UPDLOCK, HOLDLOCK)` wajib pada query FIFO klaim-stok Armada-5KG (pelajaran dari insiden proyek sebelumnya) — TIDAK BOLEH dihilangkan/dikurangi.
- Tidak ada framework migrasi — skema baru lewat script `scripts/_scratch_*.ts` sekali jalan (via `npx tsx --env-file=.env`, flag `--env-file` WAJIB), dijalankan lalu dihapus, tidak pernah di-commit.
- Tidak ada test suite otomatis — setiap task diverifikasi via `npx tsc --noEmit`, `npx eslint <file berubah>`, dan script scratch DB terhadap data live (dihapus setelah dipakai).
- UI input Qty 5KG armada TIDAK berubah — tetap field angka bebas, alokasi FIFO sepenuhnya otomatis di server (tanpa picker manual).
- Ketiga query Bukti (Task 6) WAJIB memfilter `IsDeleted = 0` pada `DashboardPengirimanJadwal`/`DashboardTakeAwayMuatan` dan `IS NOT NULL` pada `JamSelesaiMuat` — proyek sebelumnya sempat melewatkan filter ini di percobaan pertama, jangan diulangi.

---

### Task 1: Skema `DashboardArmadaAlokasi`

**Files:**
- Scratch (dibuat lalu dihapus, TIDAK di-commit): `scripts/_scratch_armada_alokasi_schema.ts`

**Interfaces:**
- Produces: tabel `DashboardArmadaAlokasi(ArmadaAlokasiID INT IDENTITY PK, JadwalID INT, KualitasID INT, Qty INT, CreatedDate DATETIME)` di database MSSQL "utama" MKEsindo — dipakai Task 2 (INSERT), Task 4 (SELECT SUM), Task 5 (SELECT SUM), Task 6 (INNER JOIN).

- [ ] **Step 1: Tulis & jalankan script skema**

Buat `scripts/_scratch_armada_alokasi_schema.ts`:

```typescript
import { getPool } from "@/lib/db";

async function main() {
  const pool = await getPool();
  await pool.request().query(`
    CREATE TABLE DashboardArmadaAlokasi (
      ArmadaAlokasiID INT IDENTITY PRIMARY KEY,
      JadwalID INT NOT NULL,
      KualitasID INT NOT NULL,
      Qty INT NOT NULL,
      CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log("DashboardArmadaAlokasi created.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx --env-file=.env scripts/_scratch_armada_alokasi_schema.ts`
Expected: output `DashboardArmadaAlokasi created.`, exit code 0.

- [ ] **Step 2: Verifikasi skema live**

Tulis script scratch terpisah sementara (atau tambahkan sementara ke script Step 1 sebelum menghapusnya) yang menjalankan:

```sql
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'DashboardArmadaAlokasi' ORDER BY ORDINAL_POSITION
```

Expected: 4 kolom (`ArmadaAlokasiID` int, `JadwalID` int, `KualitasID` int, `Qty` int, `CreatedDate` datetime) — 5 baris total (termasuk PK).

- [ ] **Step 3: Hapus script scratch**

```bash
rm scripts/_scratch_armada_alokasi_schema.ts
```

Tidak ada commit untuk task ini — perubahan skema tidak pernah dicatat sebagai file kode, konsisten dengan konvensi repo ini (kolom `Variant` dan tabel `DashboardTakeAwayAlokasi` di proyek sebelumnya juga begitu).

---

### Task 2: Fungsi `allocateArmadaStock5KG`

**Files:**
- Create: `src/lib/queries/armada-alokasi.ts`

**Interfaces:**
- Consumes: tabel `DashboardArmadaAlokasi` (Task 1), `DashboardProduksiKualitas`, `DashboardTakeAwayAlokasi` (sudah ada).
- Produces: `allocateArmadaStock5KG(transaction: sql.Transaction, jadwalId: number, qtyDibutuhkan: number): Promise<void>` — dipakai Task 3.

- [ ] **Step 1: Tulis `armada-alokasi.ts`**

```typescript
// src/lib/queries/armada-alokasi.ts
import sql from "mssql";
import { AppError } from "@/lib/action-result";

// Mengalokasikan kantong 5KG yang dimuat Armada saat Selesai Muat, dari
// entri DashboardProduksiKualitas varian 5kg yang belum terpakai --
// TERBARU dulu, TIDAK ADA fallback ke pallet (5kg tidak pernah masuk
// pallet, aturan bisnis permanen). Pola sama persis dengan Sumber 1
// allocateTakeAwayStock (takeaway-alokasi.ts), termasuk cap TOP 200 +
// WITH (UPDLOCK, HOLDLOCK) yang menerapkan pelajaran insiden 2026-09-18
// (query FIFO tanpa batas pernah mengunci ribuan baris tabel produksi).
// Menulis jejak ke DashboardArmadaAlokasi untuk tiap entri Kualitas yang
// disentuh. Lihat spec docs/superpowers/specs/2026-09-19-armada-5kg-alokasi-dan-redesain-centang3-design.md
// Bagian 2.
export async function allocateArmadaStock5KG(transaction: sql.Transaction, jadwalId: number, qtyDibutuhkan: number): Promise<void> {
  let sisaDibutuhkan = qtyDibutuhkan;

  // Sisa per entri = Qty10KG (nama kolom historis, dipakai untuk qty kantong
  // apapun variannya -- lihat produksi-kualitas.ts) dikurangi yang sudah
  // dialokasikan ke TakeAway ATAU Armada lain, supaya kedua konsumen tidak
  // rebutan baris yang sama. Batch selalu 0 untuk 5kg (5kg tidak pernah
  // masuk pallet) tapi tetap disertakan supaya formula konsisten dengan
  // pola Sumber 1 TakeAway.
  const kualitasResult = await new sql.Request(transaction).query(`
    SELECT TOP 200 k.KualitasID, k.Qty10KG,
           k.Qty10KG
             - ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WITH (UPDLOCK, HOLDLOCK) WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0)
             - ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WITH (UPDLOCK, HOLDLOCK) WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
             - ISNULL((SELECT SUM(aa.Qty) FROM DashboardArmadaAlokasi aa WITH (UPDLOCK, HOLDLOCK) WHERE aa.KualitasID = k.KualitasID), 0)
             AS Sisa
    FROM DashboardProduksiKualitas k WITH (UPDLOCK, HOLDLOCK)
    WHERE k.Variant = '5kg' AND k.Qty10KG IS NOT NULL
    ORDER BY k.TanggalLabel DESC, k.Waktu DESC
  `);

  for (const row of kualitasResult.recordset as { KualitasID: number; Sisa: number }[]) {
    if (sisaDibutuhkan <= 0) break;
    const sisa = Math.max(0, row.Sisa);
    if (sisa <= 0) continue;
    const ambil = Math.min(sisa, sisaDibutuhkan);
    await new sql.Request(transaction)
      .input("jadwalId", sql.Int, jadwalId)
      .input("kualitasId", sql.Int, row.KualitasID)
      .input("qty", sql.Int, ambil).query(`
        INSERT INTO DashboardArmadaAlokasi (JadwalID, KualitasID, Qty)
        VALUES (@jadwalId, @kualitasId, @qty)
      `);
    sisaDibutuhkan -= ambil;
  }

  if (sisaDibutuhkan > 0) {
    throw new AppError("Stok 5kg tidak cukup untuk menyelesaikan Selesai Muat ini.");
  }
}
```

- [ ] **Step 2: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/armada-alokasi.ts`
Expected: tidak ada error.

- [ ] **Step 3: Verifikasi lewat script scratch**

Tulis `scripts/_scratch_verify_armada_alokasi.ts` yang membuka transaksi manual (`pool.transaction()` / `new sql.Transaction(pool)` + `.begin()`), memanggil `allocateArmadaStock5KG(transaction, <jadwalId nyata>, <qty kecil, mis. 1>)` terhadap satu `JadwalID` nyata yang ada di `DashboardPengirimanJadwal`, memverifikasi baris `DashboardArmadaAlokasi` baru tercipta dengan `KualitasID` yang benar-benar varian 5kg, LALU **`transaction.rollback()`** (jangan commit — ini murni verifikasi baca-tulis, bukan transaksi produksi nyata). Cetak hasil row yang diambil sebelum rollback. Hapus script setelah selesai.

Run: `npx tsx --env-file=.env scripts/_scratch_verify_armada_alokasi.ts`
Expected: baris `DashboardArmadaAlokasi` baru muncul di dalam transaksi (sebelum rollback), `KualitasID`-nya bervarian 5kg (cross-check manual lewat query terpisah).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/armada-alokasi.ts
git commit -m "feat: tambah fungsi FIFO alokasi stok Armada 5KG dari Kualitas"
```

---

### Task 3: Wire `allocateArmadaStock5KG` ke `produksiSelesaiMuat`

**Files:**
- Modify: `src/lib/queries/produksi-muatan.ts:148-221` (fungsi `produksiSelesaiMuat`)

**Interfaces:**
- Consumes: `allocateArmadaStock5KG(transaction, jadwalId, qtyDibutuhkan)` (Task 2).

- [ ] **Step 1: Tambah import**

Di `produksi-muatan.ts`, tambahkan import baru setelah baris import yang sudah ada (baris 11):

```typescript
import { allocateArmadaStock5KG } from "@/lib/queries/armada-alokasi";
```

- [ ] **Step 2: Panggil di awal transaksi, sebelum alokasi 10kg**

Fungsi `produksiSelesaiMuat` saat ini (baris 148-221) membuka transaksi lalu langsung masuk ke loop `for (const item of input.alokasi)` (baris 162). Tambahkan pemanggilan `allocateArmadaStock5KG` TEPAT SEBELUM loop itu, supaya kalau stok 5kg kurang, transaksi gagal cepat sebelum baris pallet 10kg manapun disentuh:

```typescript
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    if (input.qty5KGDimuat > 0) {
      await allocateArmadaStock5KG(transaction, input.jadwalId, input.qty5KGDimuat);
    }

    for (const item of input.alokasi) {
```

(Baris-baris di dalam loop `for` dan sesudahnya — insert `DashboardProduksiMuatanDetail`, klaim atomik `DashboardProduksiBatch`, UPDATE `Qty5KGDimuat`, `transaction.commit()`, `catch`/`rollback`, panggilan `selesaiMuat` di akhir — TIDAK berubah sama sekali.)

- [ ] **Step 3: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/produksi-muatan.ts`
Expected: tidak ada error.

- [ ] **Step 4: Verifikasi lewat script scratch**

Tulis script scratch yang memanggil `produksiSelesaiMuat` secara langsung (bukan lewat UI/action layer) terhadap satu `JadwalID` nyata berstatus siap Selesai Muat (`JamMulaiMuat` sudah terisi), dengan `input.qty5KGDimuat` sengaja diisi angka BESAR (jauh melebihi stok 5kg yang tersedia saat ini — cek dulu total sisa 5kg lewat query manual). Verifikasi: `AppError("Stok 5kg tidak cukup untuk menyelesaikan Selesai Muat ini.")` benar-benar terlempar, DAN pastikan lewat query terpisah bahwa TIDAK ADA baris baru masuk `DashboardArmadaAlokasi`/`DashboardProduksiMuatanDetail`/`DashboardProduksiBatch` berubah (transaksi benar-benar rollback total, tidak ada efek samping). **PENTING — pelajaran dari insiden proyek sebelumnya:** JANGAN uji dengan qty yang bisa memicu scan ribuan baris; cukup qty yang sedikit melebihi sisa nyata (mis. sisa + 1), bukan angka ekstrem seperti 999999999. Setelah verifikasi kegagalan, verifikasi jalur sukses secara TERPISAH dengan qty kecil dan wajar (mis. 1) terhadap `JadwalID` lain yang benar-benar siap, konfirmasi baris `DashboardArmadaAlokasi` tercipta dan Selesai Muat berhasil. Hapus script setelah selesai.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/produksi-muatan.ts
git commit -m "feat: alokasikan stok 5KG dari Kualitas saat Armada Selesai Muat"
```

---

### Task 4: Cegah dobel-pakai stok 5KG antara TakeAway & Armada

**Files:**
- Modify: `src/lib/queries/takeaway-alokasi.ts:35-44` (query Sumber 1 di `allocateTakeAwayStock`)

**Interfaces:**
- Consumes: tabel `DashboardArmadaAlokasi` (Task 1).

- [ ] **Step 1: Tambah pengurangan `DashboardArmadaAlokasi` ke formula Sisa**

Ganti query Sumber 1 di `allocateTakeAwayStock` (`takeaway-alokasi.ts:35-44`) dari:

```typescript
  const kualitasResult = await new sql.Request(transaction).input("variant", sql.VarChar(8), variant).query(`
    SELECT TOP 200 k.KualitasID, k.Qty10KG,
           k.Qty10KG
             - ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WITH (UPDLOCK, HOLDLOCK) WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0)
             - ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WITH (UPDLOCK, HOLDLOCK) WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
             AS Sisa
    FROM DashboardProduksiKualitas k WITH (UPDLOCK, HOLDLOCK)
    WHERE k.Variant = @variant AND k.Qty10KG IS NOT NULL
    ORDER BY k.TanggalLabel DESC, k.Waktu DESC
  `);
```

jadi:

```typescript
  const kualitasResult = await new sql.Request(transaction).input("variant", sql.VarChar(8), variant).query(`
    SELECT TOP 200 k.KualitasID, k.Qty10KG,
           k.Qty10KG
             - ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WITH (UPDLOCK, HOLDLOCK) WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0)
             - ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WITH (UPDLOCK, HOLDLOCK) WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
             - ISNULL((SELECT SUM(aa.Qty) FROM DashboardArmadaAlokasi aa WITH (UPDLOCK, HOLDLOCK) WHERE aa.KualitasID = k.KualitasID), 0)
             AS Sisa
    FROM DashboardProduksiKualitas k WITH (UPDLOCK, HOLDLOCK)
    WHERE k.Variant = @variant AND k.Qty10KG IS NOT NULL
    ORDER BY k.TanggalLabel DESC, k.Waktu DESC
  `);
```

(Satu baris baru ditambahkan: pengurangan `SUM(DashboardArmadaAlokasi.Qty)`. Baris lain, komentar di atas fungsi, dan Sumber 2/Batch di bawahnya TIDAK berubah.)

- [ ] **Step 2: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/takeaway-alokasi.ts`
Expected: tidak ada error.

- [ ] **Step 3: Verifikasi lewat script scratch**

Cari (atau buat via Task 2/3's scratch) satu entri Kualitas 5kg yang sudah punya baris `DashboardArmadaAlokasi`. Panggil `allocateTakeAwayStock` (di dalam transaksi manual yang di-rollback, sama seperti Task 2 Step 3) dengan `variant="5kg"` dan qty yang seharusnya PERSIS mengenai entri itu (mis. qty sama dengan sisa aslinya SEBELUM dikurangi Armada). Verifikasi: entri itu TIDAK diambil lagi (Sisa-nya sudah dikurangi ArmadaAlokasi, jadi fungsi harus lanjut ke entri Kualitas 5kg lain atau gagal dengan `AppError` kalau memang tidak ada entri lain yang cukup) — buktikan lewat log baris mana yang benar-benar diambil (`DashboardTakeAwayAlokasi` baru, kalau ada, harus punya `KualitasID` BEDA dari yang sudah dipakai Armada). Rollback transaksi, hapus script setelah selesai.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/takeaway-alokasi.ts
git commit -m "fix: cegah TakeAway dan Armada rebutan stok Kualitas 5KG yang sama"
```

---

### Task 5: Update formula tampilan "sisa alokasi"

**Files:**
- Modify: `src/lib/queries/produksi-kualitas.ts:54-59` (OUTER APPLY di `getKualitasRiwayat`)
- Modify: `src/lib/queries/produksi-riwayat-detail.ts:151-162,180-181` (`takeAwayByKualitasId` map dan `totalTeralokasi` di fungsi Riwayat Produksi)

**Interfaces:**
- Consumes: tabel `DashboardArmadaAlokasi` (Task 1).

- [ ] **Step 1: `produksi-kualitas.ts` — tambah pengurangan Armada**

Ganti OUTER APPLY di `getKualitasRiwayat` (`produksi-kualitas.ts:54-59`) dari:

```typescript
      OUTER APPLY (
        SELECT
          ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0) +
          ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
          AS TotalTeralokasi
      ) alok
```

jadi:

```typescript
      OUTER APPLY (
        SELECT
          ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0) +
          ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0) +
          ISNULL((SELECT SUM(aa.Qty) FROM DashboardArmadaAlokasi aa WHERE aa.KualitasID = k.KualitasID), 0)
          AS TotalTeralokasi
      ) alok
```

Perbarui juga komentar `SisaAlokasi` di interface `KualitasRow` (`produksi-kualitas.ts:29-34`) supaya menyebut Armada:

```typescript
  // Qty10KG minus SUM(DashboardProduksiBatch.Qty10KG) already allocated to
  // any pallete under this KualitasID (IsDeleted = 0), plus SUM(Qty) already
  // allocated to TakeAway (DashboardTakeAwayAlokasi, SumberTipe = 'KUALITAS')
  // and to Armada (DashboardArmadaAlokasi) -- null when Qty10KG itself is
  // null (no ceiling to compute against, e.g. legacy rows). Never negative
  // (floored at 0) even if over-allocated somehow slipped through before
  // this check existed.
  SisaAlokasi: number | null;
```

- [ ] **Step 2: `produksi-riwayat-detail.ts` — tambah map & pengurangan Armada**

Setelah blok `takeAwayByKualitasId` yang sudah ada (`produksi-riwayat-detail.ts:151-162`), tambahkan blok serupa untuk Armada:

```typescript
  const takeAwayByKualitasId = new Map<number, number>();
  if (kualitasIds.length > 0) {
    const takeAwayResult = await pool.request().query(`
      SELECT KualitasID, SUM(Qty) AS TotalQty
      FROM DashboardTakeAwayAlokasi
      WHERE SumberTipe = 'KUALITAS' AND KualitasID IN (${kualitasIds.join(",")})
      GROUP BY KualitasID
    `);
    for (const r of takeAwayResult.recordset as { KualitasID: number; TotalQty: number }[]) {
      takeAwayByKualitasId.set(r.KualitasID, r.TotalQty);
    }
  }

  const armadaByKualitasId = new Map<number, number>();
  if (kualitasIds.length > 0) {
    const armadaResult = await pool.request().query(`
      SELECT KualitasID, SUM(Qty) AS TotalQty
      FROM DashboardArmadaAlokasi
      WHERE KualitasID IN (${kualitasIds.join(",")})
      GROUP BY KualitasID
    `);
    for (const r of armadaResult.recordset as { KualitasID: number; TotalQty: number }[]) {
      armadaByKualitasId.set(r.KualitasID, r.TotalQty);
    }
  }
```

Lalu ubah `totalTeralokasi` (`produksi-riwayat-detail.ts:180-181`) dari:

```typescript
    const totalTeralokasi =
      alokasiPallet.reduce((sum, a) => sum + a.qty10KG, 0) + (takeAwayByKualitasId.get(r.KualitasID) ?? 0);
```

jadi:

```typescript
    const totalTeralokasi =
      alokasiPallet.reduce((sum, a) => sum + a.qty10KG, 0) +
      (takeAwayByKualitasId.get(r.KualitasID) ?? 0) +
      (armadaByKualitasId.get(r.KualitasID) ?? 0);
```

- [ ] **Step 3: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/produksi-kualitas.ts src/lib/queries/produksi-riwayat-detail.ts`
Expected: tidak ada error.

- [ ] **Step 4: Verifikasi lewat script scratch**

Panggil `getKualitasRiwayat()` dan (lewat fungsi Riwayat Produksi yang relevan di `produksi-riwayat-detail.ts`) untuk entri Kualitas 5kg yang sudah punya baris `DashboardArmadaAlokasi` dari Task 2/3's verifikasi (kalau baris itu sudah di-rollback sebelumnya dan tidak ada lagi data nyata, buat satu entri kecil baru via `allocateArmadaStock5KG` dalam transaksi yang di-COMMIT kali ini, qty sangat kecil seperti 1, agar ada data nyata untuk diverifikasi — catat KualitasID/JadwalID yang dipakai untuk referensi). Bandingkan `SisaAlokasi`/`sisaBelumDialokasikan` SEBELUM dan SESUDAH baris ArmadaAlokasi itu ada — harus turun tepat sebesar qty yang dialokasikan Armada. Hapus script setelah selesai.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/produksi-kualitas.ts src/lib/queries/produksi-riwayat-detail.ts
git commit -m "fix: sisa alokasi Kualitas ikut kurangi alokasi Armada 5KG"
```

---

### Task 6: Redesain query centang 3 (`muatan`) di `getValidasiBulan`

**Files:**
- Modify: `src/lib/queries/produksi-validasi-tim.ts` (seluruh isi)

**Interfaces:**
- Consumes: `DashboardProduksiMuatanDetail` (sudah ada), `DashboardArmadaAlokasi` (Task 1), `DashboardTakeAwayAlokasi` (sudah ada).
- Produces: `ValidasiShift`/`getValidasiBulan` — signature TIDAK berubah dari sebelumnya, hanya logika internal `muatan` yang berubah.

- [ ] **Step 1: Ganti seluruh isi `produksi-validasi-tim.ts`**

```typescript
import { getPool, sql } from "@/lib/db";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";

export interface ValidasiShiftItem {
  lengkap: boolean;
  detail: string;
}

export interface ValidasiShift {
  kualitas: ValidasiShiftItem;
  pallet: ValidasiShiftItem;
  muatan: ValidasiShiftItem;
}

const SHIFT_LIST: ShiftNumber[] = [1, 2, 3];

// 3 validasi per (TanggalUsaha, Shift) untuk SATU bulan kalender sekaligus
// -- dipakai 3 titik centang di kotak huruf Tim, jadwal-tim-bulanan.tsx.
// Bukan per-Tim (Kualitas/Batch/Pengiriman tidak menyimpan TimID), murni
// menandai KELENGKAPAN shift itu sendiri -- lihat spec Bagian 4 (proyek
// varian/TakeAway-FIFO) dan spec Bagian 4 (proyek alokasi Armada-5KG).
export async function getValidasiBulan(tahun: number, bulan: number): Promise<Record<string, ValidasiShift>> {
  const pool = await getPool();
  const awal = new Date(Date.UTC(tahun, bulan - 1, 1));
  const akhir = new Date(Date.UTC(tahun, bulan, 1));
  const start = naiveWibToUtcInstant(new Date(Date.UTC(tahun, bulan - 1, 0, 0, 0, 0)));
  const end = naiveWibToUtcInstant(new Date(Date.UTC(tahun, bulan, 2, 0, 0, 0)));

  const [mesinAktifResult, kualitasResult, sisaKualitasResult, armada10Result, armada5Result, takeAwayResult] = await Promise.all([
    pool.request().query(`SELECT MesinID FROM DashboardProduksiMesin WHERE Status = 'AKTIF'`),
    pool
      .request()
      .input("awal", sql.Date, awal)
      .input("akhir", sql.Date, akhir).query(`
        SELECT DISTINCT TanggalLabel, Shift, MesinID
        FROM DashboardProduksiKualitas
        WHERE TanggalLabel >= @awal AND TanggalLabel < @akhir
      `),
    pool
      .request()
      .input("awal", sql.Date, awal)
      .input("akhir", sql.Date, akhir).query(`
        SELECT k.TanggalLabel, k.Shift, k.KualitasID, k.Qty10KG,
               ISNULL((SELECT SUM(b.Qty10KG) FROM DashboardProduksiBatch b WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0), 0) +
               ISNULL((SELECT SUM(ta.Qty) FROM DashboardTakeAwayAlokasi ta WHERE ta.KualitasID = k.KualitasID AND ta.SumberTipe = 'KUALITAS'), 0)
               AS TotalTeralokasi
        FROM DashboardProduksiKualitas k
        WHERE k.TanggalLabel >= @awal AND k.TanggalLabel < @akhir AND k.Variant = '10kg' AND k.Qty10KG IS NOT NULL
      `),
    // Bukti A: Armada 10KG -- JamSelesaiMuat hanya dihitung kalau JadwalID
    // punya minimal satu baris DashboardProduksiMuatanDetail (baris itu
    // hanya tercipta kalau klaim atomik ke DashboardProduksiBatch berhasil
    // di produksiSelesaiMuat) -- menangkap celah "Selesai Muat armada tanpa
    // alokasi pallet nyata".
    pool
      .request()
      .input("start", sql.DateTime, start)
      .input("end", sql.DateTime, end).query(`
        SELECT DISTINCT j.JamSelesaiMuat
        FROM DashboardPengirimanJadwal j
        INNER JOIN DashboardProduksiMuatanDetail d ON d.JadwalID = j.JadwalID
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
      `),
    // Bukti B: Armada 5KG -- sama seperti Bukti A tapi lewat
    // DashboardArmadaAlokasi (baris itu hanya tercipta kalau
    // allocateArmadaStock5KG berhasil).
    pool
      .request()
      .input("start", sql.DateTime, start)
      .input("end", sql.DateTime, end).query(`
        SELECT DISTINCT j.JamSelesaiMuat
        FROM DashboardPengirimanJadwal j
        INNER JOIN DashboardArmadaAlokasi a ON a.JadwalID = j.JadwalID
        WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
      `),
    // Bukti C: TakeAway (10KG & 5KG) -- JamSelesaiMuat hanya dihitung kalau
    // TakeAwayMuatanID punya minimal satu baris DashboardTakeAwayAlokasi
    // (SumberTipe apa saja -- KUALITAS atau BATCH, keduanya bukti alokasi
    // nyata; untuk 5kg SumberTipe memang selalu KUALITAS by design).
    pool
      .request()
      .input("start", sql.DateTime, start)
      .input("end", sql.DateTime, end).query(`
        SELECT DISTINCT tam.JamSelesaiMuat
        FROM DashboardTakeAwayMuatan tam
        INNER JOIN DashboardTakeAwayAlokasi ta ON ta.TakeAwayMuatanID = tam.TakeAwayMuatanID
        WHERE tam.IsDeleted = 0 AND tam.JamSelesaiMuat IS NOT NULL AND tam.JamSelesaiMuat BETWEEN @start AND @end
      `),
  ]);

  const mesinAktifIds = new Set((mesinAktifResult.recordset as { MesinID: number }[]).map((r) => r.MesinID));

  // Centang 1: per (tanggal, shift) -> Set MesinID yang sudah dicek.
  const mesinDicekByShift = new Map<string, Set<number>>();
  for (const r of kualitasResult.recordset as { TanggalLabel: Date; Shift: ShiftNumber; MesinID: number }[]) {
    const key = `${r.TanggalLabel.toISOString().slice(0, 10)}|${r.Shift}`;
    if (!mesinDicekByShift.has(key)) mesinDicekByShift.set(key, new Set());
    mesinDicekByShift.get(key)!.add(r.MesinID);
  }

  // Centang 2: per (tanggal, shift) -> apakah ADA entri 10kg dengan sisa > 0.
  const adaSisaByShift = new Map<string, boolean>();
  const adaEntri10KGByShift = new Set<string>();
  for (const r of sisaKualitasResult.recordset as { TanggalLabel: Date; Shift: ShiftNumber; Qty10KG: number; TotalTeralokasi: number }[]) {
    const key = `${r.TanggalLabel.toISOString().slice(0, 10)}|${r.Shift}`;
    adaEntri10KGByShift.add(key);
    const sisa = Math.max(0, r.Qty10KG - r.TotalTeralokasi);
    if (sisa > 0) adaSisaByShift.set(key, true);
  }

  // Centang 3: gabungkan 3 bukti alokasi nyata (Armada 10KG, Armada 5KG,
  // TakeAway), cocokkan ke jendela shift tiap hari dalam bulan ini.
  const semuaJamSelesaiDenganBukti: Date[] = [
    ...(armada10Result.recordset as { JamSelesaiMuat: Date }[]).map((r) => r.JamSelesaiMuat),
    ...(armada5Result.recordset as { JamSelesaiMuat: Date }[]).map((r) => r.JamSelesaiMuat),
    ...(takeAwayResult.recordset as { JamSelesaiMuat: Date }[]).map((r) => r.JamSelesaiMuat),
  ];

  const hasil: Record<string, ValidasiShift> = {};
  const daysInMonth = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const tanggalUsaha = new Date(Date.UTC(tahun, bulan - 1, day)).toISOString().slice(0, 10);
    for (const shift of SHIFT_LIST) {
      const key = `${tanggalUsaha}|${shift}`;
      const mesinDicek = mesinDicekByShift.get(key) ?? new Set<number>();
      const mesinBelum = [...mesinAktifIds].filter((id) => !mesinDicek.has(id));

      const adaEntri10KG = adaEntri10KGByShift.has(key);
      const adaSisa = adaSisaByShift.get(key) ?? false;

      const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
      const window = getShiftWindow(businessDate, shift, "work");
      const startUtc = naiveWibToUtcInstant(window.start);
      const endUtc = naiveWibToUtcInstant(window.end);
      const adaMuatan = semuaJamSelesaiDenganBukti.some((t) => t >= startUtc && t <= endUtc);

      hasil[key] = {
        kualitas: {
          lengkap: mesinBelum.length === 0,
          detail:
            mesinBelum.length === 0
              ? "Semua mesin aktif sudah dicek."
              : `${mesinAktifIds.size - mesinBelum.length} dari ${mesinAktifIds.size} mesin sudah dicek.`,
        },
        pallet: {
          lengkap: !adaEntri10KG || !adaSisa,
          detail: !adaEntri10KG ? "Belum ada hasil panen 10KG." : adaSisa ? "Masih ada sisa belum dipallet." : "Semua sudah masuk pallet.",
        },
        muatan: {
          lengkap: adaMuatan,
          detail: adaMuatan
            ? "Sudah ada Selesai Muat dengan bukti alokasi stok pada shift ini."
            : "Belum ada Selesai Muat dengan bukti alokasi stok pada shift ini.",
        },
      };
    }
  }
  return hasil;
}
```

(Perubahan dari versi sebelumnya: `pengirimanResult`/`takeAwayResult` [2 query] diganti `armada10Result`/`armada5Result`/`takeAwayResult` [3 query, masing-masing pakai INNER JOIN ke tabel bukti alokasi]; `semuaJamSelesai` diganti nama jadi `semuaJamSelesaiDenganBukti` dengan sumber baru; teks `detail` pada `muatan` sedikit diperjelas. Centang 1 dan Centang 2 TIDAK berubah sama sekali.)

- [ ] **Step 2: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/produksi-validasi-tim.ts`
Expected: tidak ada error.

- [ ] **Step 3: Verifikasi lewat script scratch — regresi + kasus baru**

Panggil `getValidasiBulan` untuk bulan yang sama dipakai proyek sebelumnya (2026-09) dan cek:

1. **Regresi TakeAway (data nyata dari proyek sebelumnya):** shift yang berisi TakeAway nyata (DeliveryOrder `01242942`/SalesInvoice `01235065`, JamSelesaiMuat `2026-09-18T20:04:03.223Z` UTC, TanggalUsaha `2026-09-19` Shift 3) — `muatan.lengkap` HARUS tetap `true` (tidak boleh berubah jadi `false` akibat redesain ini, karena TakeAway sudah lama punya baris `DashboardTakeAwayAlokasi`).
2. **Kasus baru Armada 5KG:** shift yang dipakai verifikasi Task 3 (JadwalID yang di-COMMIT, bukan yang di-rollback) — `muatan.lengkap` harus `true` untuk shift itu, dan `detail`-nya sesuai.
3. **Kasus celah lama (kalau ada data historis):** cari (lewat query manual, BUKAN membuat data baru) satu `JadwalID` historis yang JamSelesaiMuat-nya ada tapi TIDAK punya baris `DashboardProduksiMuatanDetail` sama sekali (murni 5kg tanpa alokasi apapun, dari SEBELUM Task 3 wiring ini ada) — kalau ketemu, `muatan.lengkap` untuk shift itu HARUS `false` sekarang (sebelumnya `true` di kode lama) — ini bukti nyata bahwa redesain menutup celah yang dilaporkan user. Kalau tidak ada data historis semacam itu, cukup laporkan tidak ditemukan, tidak perlu membuat data buatan untuk kasus ini.

Hapus script setelah selesai.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/produksi-validasi-tim.ts
git commit -m "feat: redesain centang 3 supaya verifikasi bukti alokasi stok nyata, bukan cuma timestamp"
```
