# Koreksi Stok Pallet Cold Storage

## Ringkasan

Fitur admin-only untuk memperbaiki stok pallet Cold Storage (`DashboardProduksiBatch`) di `/mkesindo/produksi`, untuk 2 kebutuhan:

1. **Baseline** — pallet yang sudah ada fisik di gudang sebelum sistem dashboard ini melacak stok, belum pernah tercatat lewat alur Cek Kualitas → Tambah Produksi normal.
2. **Koreksi opname** — selisih antara stok fisik hasil hitung manual berkala dengan angka `SisaQty10KG` di sistem.

Investigasi awal menemukan bahwa sebagian mekanisme koreksi **sudah ada** di codebase (`updateBatchQtyAction`/`deleteBatchAction`, dipakai dari popup "Info Pallet" di Peta Cold Storage), tapi punya 2 celah: (a) gate aksesnya `requireProduksiView()` (staf biasa bisa akses), padahal komentar kode itu sendiri menyatakan ini "deliberately admin/supervisor-only capability"; (b) tidak ada jejak audit sama sekali — qty berubah tanpa catatan alasan/siapa/kapan. Kolom `KualitasID` di `DashboardProduksiBatch` juga sudah nullable di database live (dikonfirmasi lewat `INFORMATION_SCHEMA.COLUMNS`), sehingga opsi "baseline tanpa KualitasID" tidak memerlukan perubahan skema kolom itu.

Fitur ini punya 3 bagian:
1. Perbaiki & lengkapi mekanisme koreksi yang sudah ada (gate akses + audit trail).
2. Baseline — buat pallet baru tanpa KualitasID.
3. Koreksi snapshot historis — perbaiki angka `DashboardLaporanShiftStokEsSnapshot` untuk shift yang sudah final.

## Arsitektur

Satu tabel audit baru (`DashboardKoreksiStokPallet`) dipakai bersama untuk ketiga jenis koreksi, dibedakan lewat kolom `Jenis` — karena ketiganya konseptual sama (event koreksi stok dengan jejak siapa/kapan/kenapa) meski targetnya beda (Batch aktif vs Batch baru vs snapshot historis).

## Bagian 1: Perbaiki & lengkapi mekanisme koreksi yang sudah ada

**Tabel audit baru:**

```sql
CREATE TABLE DashboardKoreksiStokPallet (
  KoreksiID INT IDENTITY PRIMARY KEY,
  Jenis VARCHAR(20) NOT NULL,      -- 'KOREKSI' | 'BASELINE' | 'SNAPSHOT'
  BatchID INT NULL,                 -- diisi untuk KOREKSI & BASELINE
  TanggalUsaha DATE NULL,           -- diisi untuk SNAPSHOT
  Shift TINYINT NULL,               -- diisi untuk SNAPSHOT
  QtyLama INT NULL,
  QtyBaru INT NOT NULL,
  Alasan NVARCHAR(500) NOT NULL,
  DicatatOlehAkunID INT NOT NULL,
  CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
)
```

Database: sama seperti semua tabel `Dashboard*` lain — MSSQL "utama" MKEsindo via `getPool()`. Dibuat lewat script `scripts/_scratch_*.ts` sekali jalan, konvensi yang sudah berlaku di repo ini.

**Perubahan ke `src/lib/queries/produksi-warehouse.ts`:**

- `updateBatchQty(input: UpdateBatchQtyInput)` — tambah parameter `alasan: string` dan `dicatatOlehAkunId: number` ke `UpdateBatchQtyInput`. Di dalam transaksi yang sudah ada (setelah UPDATE `DashboardProduksiBatch` berhasil, sebelum `transaction.commit()`), tambahkan INSERT ke `DashboardKoreksiStokPallet` (Jenis='KOREKSI', BatchID, QtyLama=`batch.Qty10KG` lama, QtyBaru=`input.qty10KG`, Alasan, DicatatOlehAkunID).
- `deleteBatch(batchId, alasan, dicatatOlehAkunId)` — sebelum melakukan soft-delete, baca dulu `Qty10KG` batch yang akan dihapus (untuk QtyLama). Bungkus operasi (soft-delete UPDATE + INSERT audit) dalam satu transaksi baru (saat ini `deleteBatch` cuma satu UPDATE polos tanpa transaksi eksplisit — perlu dibungkus transaksi supaya audit dan penghapusan atomik). INSERT ke `DashboardKoreksiStokPallet` (Jenis='KOREKSI', BatchID, QtyLama, QtyBaru=0, Alasan, DicatatOlehAkunID).

**Perubahan ke `src/app/mkesindo/produksi/actions.ts`:**

- `updateBatchQtyAction(batchId, qty10KG, alasan)` — ganti `requireProduksiView()` → `requireProduksiAdmin()`. Validasi `alasan` tidak boleh kosong (`AppError` kalau kosong/whitespace saja). Ambil `dicatatOlehAkunId` dari session (pola yang sama dipakai action lain di file ini).
- `deleteBatchAction(batchId, alasan)` — sama: `requireProduksiAdmin()`, validasi alasan wajib.

**Perubahan ke `src/components/produksi/riwayat-posisi-list-desktop.tsx`:**

- `BatchRow`'s form Ubah: tambah `Input` teks "Alasan koreksi" di bawah field Qty (state baru `alasan`, kosong secara default). Tombol "Simpan" `disabled` kalau `alasan.trim() === ""` (selain kondisi `pending` yang sudah ada). Panggil `updateBatchQtyAction(row.BatchID, Number(qty) || 0, alasan)`.
- `BatchRow`'s tombol Hapus: ganti `confirm(...)` polos jadi `prompt("Alasan menghapus input ini:")` — kalau hasilnya `null` atau string kosong, batalkan (jangan panggil action). Kalau ada isinya, panggil `deleteBatchAction(row.BatchID, alasan)`.

## Bagian 2: Baseline (pallet baru tanpa KualitasID)

**Fungsi baru di `src/lib/queries/produksi-warehouse.ts`:**

```typescript
export interface CreateBatchBaselineInput {
  posisiId: number;
  mesinId: number;
  qty10KG: number;
  alasan: string;
  dicatatOlehAkunId: number;
}

export async function createBatchBaseline(input: CreateBatchBaselineInput): Promise<void>
```

Mengikuti pola locking `createBatch` yang sudah ada (klaim baris `DashboardProduksiPalletPosisi` dulu via `WITH (UPDLOCK, HOLDLOCK)`, lalu cek kapasitas `KAPASITAS_PALLET_10KG` setelah insert), TAPI:
- `KualitasID = NULL` (bukan dari parameter — baseline tidak pernah punya sumber Kualitas).
- `TanggalProduksi = GETDATE()`. `TanggalLabel` dan `Shift` diambil dari SATU pemanggilan `getReportShift("work")` yang sama (pola yang sudah dipakai `produksi-korelasi-penjualan.ts`: `const { shift, businessDate } = getReportShift("work")`) supaya keduanya konsisten satu sama lain, bukan dihitung terpisah. `JamPanen = NULL`.
- `Qty10KG = SisaQty10KG = input.qty10KG`.
- Setelah INSERT berhasil dan cek kapasitas lolos, INSERT ke `DashboardKoreksiStokPallet` (Jenis='BASELINE', BatchID=baru, QtyLama=NULL, QtyBaru=input.qty10KG, Alasan, DicatatOlehAkunID) — dalam transaksi yang sama.

**Action baru di `actions.ts`:** `createBatchBaselineAction(input)` — `requireProduksiAdmin()`, validasi `alasan` wajib, delegasi ke `createBatchBaseline`.

**UI — `src/components/produksi/peta-warehouse-desktop.tsx`:** `WarehouseCell`'s `onClick` saat ini `(r) => r && setSelectedPosisiId(r.PosisiID)` — klik slot KOSONG (row `undefined`) tidak melakukan apa-apa. Tambah cabang baru: klik slot kosong membuka dialog "Tambah Stok Awal" (form: dropdown Mesin, input Qty10KG, input Alasan) alih-alih panel Info Pallet yang sudah ada (yang hanya untuk slot terisi).

## Bagian 3: Koreksi snapshot historis

**Fungsi baru di `src/lib/queries/laporan-shift-stok-es-snapshot.ts`:**

```typescript
export async function koreksiSnapshotStokEs(
  tanggalUsaha: string,
  shift: ShiftNumber,
  qtyBaru: number,
  alasan: string,
  dicatatOlehAkunId: number
): Promise<void>
```

Mengikuti PERSIS instruksi yang sudah tertulis di komentar `catatSnapshotJikaBelumAda` (WARNING for future maintainers): **UPDATE langsung** kolom `TotalSisaQty10KG` pada baris `(TanggalUsaha, Shift)` yang sudah ada — TIDAK PERNAH soft-delete lalu insert ulang (bentrok `UQ_LaporanShiftStokEsSnapshot`, yang tidak difilter `IsDeleted`). Kalau baris untuk `(tanggalUsaha, shift)` itu belum ada sama sekali (shift itu belum pernah di-snapshot), lempar `AppError("Belum ada snapshot untuk shift ini -- tidak bisa dikoreksi.")`. Baca `TotalSisaQty10KG` lama dulu sebelum UPDATE (untuk QtyLama), lalu dalam transaksi yang sama INSERT ke `DashboardKoreksiStokPallet` (Jenis='SNAPSHOT', BatchID=NULL, TanggalUsaha, Shift, QtyLama, QtyBaru, Alasan, DicatatOlehAkunID).

**Action baru di `actions.ts`:** `koreksiSnapshotStokEsAction(tanggalUsaha, shift, qtyBaru, alasan)` — `requireProduksiAdmin()`, validasi alasan wajib.

Perlu juga action baca: `getSnapshotStokEsAction(tanggalUsaha, shift)` (delegasi tipis ke `getSnapshotStokEs` yang sudah ada, dipakai form untuk menampilkan angka lama sebelum admin mengisi angka baru).

**UI:** dialog baru, dipicu dari satu tombol kecil (misal "Koreksi Riwayat Stok") di halaman `/mkesindo/produksi` (dekat Peta Cold Storage). Form: input tanggal (date picker) + pilihan Shift (1/2/3) → menampilkan angka snapshot saat ini (atau pesan "Belum ada snapshot" kalau `null`) → input Qty baru + Alasan → submit.

## Global Constraints

- Semua UI dan pesan error berbahasa Indonesia.
- Ketiga aksi (koreksi qty, hapus, baseline, koreksi snapshot) WAJIB `requireProduksiAdmin()` — bukan `requireProduksiView()`. Ini bukan sekadar penambahan gate baru, tapi PERBAIKAN celah akses yang sudah ada di `updateBatchQtyAction`/`deleteBatchAction`.
- Setiap aksi koreksi WAJIB mengisi `Alasan` (tidak boleh kosong/whitespace) dan menulis satu baris `DashboardKoreksiStokPallet` DALAM TRANSAKSI YANG SAMA dengan perubahan datanya — tidak boleh ada kasus data berubah tapi audit gagal tercatat (atau sebaliknya).
- Koreksi berlaku LANGSUNG begitu disubmit (tidak ada alur approval berlapis) — akuntabilitas dijaga lewat jejak audit, bukan proses persetujuan.
- `KualitasID` pada Batch baseline SELALU `NULL` — jangan pernah membuatkan entri Kualitas palsu/retroaktif untuk baseline.
- Koreksi snapshot historis HANYA lewat UPDATE langsung ke baris yang sudah ada — TIDAK PERNAH soft-delete + insert ulang (lihat WARNING di `catatSnapshotJikaBelumAda`).
- Tidak ada framework migrasi — tabel baru lewat script `scripts/_scratch_*.ts` sekali jalan, dijalankan lalu dihapus, tidak pernah di-commit.
- Tidak ada test suite otomatis — setiap task diverifikasi via `npx tsc --noEmit`, `npx eslint`, script scratch DB terhadap data live, dan klik-coba browser untuk bagian UI (kalau memungkinkan, mengingat keterbatasan role browser di sesi kerja sebelumnya).
- Panel Korelasi Produksi-Penjualan TIDAK PERLU diubah kodenya sama sekali — `stokAwal` setiap shift sudah selalu bersumber dari `SisaQty10KG` asli (`DashboardProduksiBatch`) lewat `getColdStorageForShift`/`hitungTotalSisaStokEsLive`/`getSnapshotStokEs`, sehingga koreksi Bagian 1 & 2 otomatis mengalir ke laporan itu tanpa perubahan kode tambahan. Koreksi Bagian 3 secara eksplisit menyasar snapshot historis yang dipakai panel yang sama.

## Verifikasi

Tidak ada test suite di repo ini. Setiap task diverifikasi lewat `npx tsc --noEmit`, `npx eslint <file berubah>`, dan script scratch yang memanggil fungsi terkait langsung terhadap data live (dihapus setelah dipakai, tidak pernah commit). Verifikasi khusus yang perlu dicakup:
- Bagian 1: koreksi qty lewat akun BUKAN admin harus ditolak (`requireProduksiAdmin`); koreksi tanpa alasan harus ditolak; audit row tercipta dengan QtyLama/QtyBaru yang benar.
- Bagian 2: baseline sukses membuat Batch baru dengan `KualitasID = NULL`, kapasitas pallet tetap dicek (tidak bisa melebihi `KAPASITAS_PALLET_10KG`), audit row Jenis='BASELINE' tercipta.
- Bagian 3: koreksi snapshot pada shift yang SUDAH ADA snapshot-nya berhasil UPDATE (bukan insert baru — cek `DashboardLaporanShiftStokEsSnapshot` tetap satu baris untuk `(TanggalUsaha, Shift)` itu sebelum dan sesudah); koreksi pada shift yang BELUM punya snapshot ditolak dengan pesan yang jelas; audit row Jenis='SNAPSHOT' tercipta.
- Regresi: setelah Bagian 1/2 dijalankan terhadap satu pallet/posisi nyata, panel Korelasi Produksi-Penjualan (`getKorelasiProduksiPenjualan`) untuk shift BERJALAN/berikutnya menunjukkan `stokAwal`/`coldStorage` yang sudah mencerminkan koreksi itu, TANPA perubahan kode di file itu (murni karena sumber datanya sama).
