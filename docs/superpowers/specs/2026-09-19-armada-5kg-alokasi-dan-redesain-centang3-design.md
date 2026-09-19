# Alokasi FIFO Armada 5KG & Redesain Centang 3 Validasi Tim

## Ringkasan

Proyek sebelumnya (2026-09-19, "Varian Kualitas 10KG/5KG, Penautan TakeAway-FIFO, dan 3 Ikon Centang Validasi Tim") membangun centang 3 ("Mulai Muat") di kalender Jadwal Tim Produksi (`/mkesindo/produksi`) dengan validasi yang **hanya mengecek keberadaan timestamp** `JamSelesaiMuat` dalam jendela waktu shift, dari `DashboardPengirimanJadwal` (armada) ATAU `DashboardTakeAwayMuatan` (TakeAway) — tanpa memverifikasi bahwa stok es benar-benar berkurang.

Setelah proyek itu selesai, user meninjau ulang perilaku sebenarnya dan menemukan bahwa timestamp saja tidak cukup: ada celah nyata di mana armada bisa menyelesaikan Selesai Muat murni dengan qty 5KG (`qty5KGDimuat > 0`, `alokasi: []`) tanpa mengurangi stok apapun — karena `Qty5KGDimuat` pada armada saat ini murni angka yang dicatat ke kolom `DashboardPengirimanJadwal.Qty5KGDimuat`, sama sekali tidak terhubung ke ledger stok Kualitas-5KG manapun (berbeda dari TakeAway yang sudah punya `allocateTakeAwayStock`).

User memberi 4 aturan wajib eksplisit untuk kapan centang 3 valid:

1. **Armada + 10KG dari coldstorage** → wajib benar-benar mengambil dari pallet (`DashboardProduksiBatch`). Kalau stok pallet habis, wajib tunggu stok dialokasikan dulu ke pallet.
2. **Armada + 5KG dari hasil panen & cek kualitas** → wajib benar-benar dialokasikan dari entri Kualitas 5KG yang belum terpakai, bukan angka tanpa data.
3. **TakeAway 10KG dari hasil panen & cek kualitas** → wajib ambil dari stok belum masuk pallet (boleh fallback ke pallet kalau kurang — tetap dianggap valid, dikonfirmasi user).
4. **TakeAway 5KG dari hasil panen & cek kualitas** → wajib ambil dari Kualitas (tidak pernah dari pallet, sesuai aturan bisnis permanen 5KG-tidak-pernah-masuk-pallet).

Rule 1, 3, 4 sudah punya mekanisme data pendukung (perlu redesain QUERY centang 3 saja). Rule 2 (Armada 5KG) BELUM punya mekanisme data pendukung sama sekali — proyek ini membangunnya, mengikuti pola `allocateTakeAwayStock` yang sudah terbukti bekerja.

## Arsitektur

Proyek ini punya 4 bagian yang saling bergantung, dikerjakan sebagai satu proyek:

1. Tabel audit trail baru `DashboardArmadaAlokasi`.
2. Fungsi FIFO baru `allocateArmadaStock5KG`, diwire ke `produksiSelesaiMuat`, plus perbaikan `allocateTakeAwayStock` supaya kedua konsumen (TakeAway & Armada) tidak rebutan/dobel-pakai stok Kualitas-5KG yang sama.
3. Update 2 formula "sisa alokasi" yang sudah ada (tampilan) supaya ikut mengurangi alokasi Armada yang baru.
4. Redesain query `muatan` (centang 3) di `getValidasiBulan` — dari "cek timestamp" jadi "cek bukti alokasi/pengurangan stok nyata".

## Bagian 1: Skema `DashboardArmadaAlokasi`

Database: sama seperti semua tabel `Dashboard*` lain — database MSSQL "utama" MKEsindo, di-resolve lewat `getPool()` (`src/lib/db.ts`, `resolveKoneksi("mkesindo", "utama")`). Tidak ada database/server baru.

```sql
CREATE TABLE DashboardArmadaAlokasi (
  ArmadaAlokasiID INT IDENTITY PRIMARY KEY,
  JadwalID INT NOT NULL,           -- FK ke DashboardPengirimanJadwal
  KualitasID INT NOT NULL,          -- FK ke DashboardProduksiKualitas (selalu Variant='5kg')
  Qty INT NOT NULL,
  CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
)
```

Hanya mencatat alokasi 5KG armada. Armada 10KG tetap lewat mekanisme lama (`alokasi: MuatanAlokasi[]` → `DashboardProduksiBatch` via `DashboardProduksiMuatanDetail`), tidak butuh tabel baru.

Dibuat lewat script sekali-jalan `scripts/_scratch_*.ts` (via `npx tsx --env-file=.env`), dijalankan lalu dihapus, tidak pernah di-commit — konvensi yang sudah berlaku sepanjang repo ini (dipakai untuk kolom `Variant` dan tabel `DashboardTakeAwayAlokasi` di proyek sebelumnya).

## Bagian 2: `allocateArmadaStock5KG` + cegah dobel-pakai dengan TakeAway

Fungsi baru di file baru `src/lib/queries/armada-alokasi.ts`:

```ts
export async function allocateArmadaStock5KG(
  transaction: sql.Transaction,
  jadwalId: number,
  qtyDibutuhkan: number
): Promise<void>
```

- **Sumber:** hanya `DashboardProduksiKualitas` Variant='5kg' yang belum habis dialokasikan. TIDAK ADA fallback ke pallet (5KG tidak pernah masuk pallet — aturan bisnis permanen).
- **Arah FIFO:** terbaru dulu (`TanggalLabel DESC, Waktu DESC`) — sama seperti Sumber 1 TakeAway.
- **Sisa per entri Kualitas:** `Qty10KG - ISNULL(SUM(DashboardTakeAwayAlokasi WHERE SumberTipe='KUALITAS'), 0) - ISNULL(SUM(DashboardArmadaAlokasi), 0)` (Batch selalu 0 untuk 5kg, tapi struktur formula tetap konsisten dengan pola yang sudah ada).
- **Cap pengaman:** `TOP 200` dengan `WITH (UPDLOCK, HOLDLOCK)` — menerapkan pelajaran dari insiden nyata proyek sebelumnya (query FIFO tanpa batas pernah mengunci ribuan baris tabel produksi selama 5+ menit).
- **Kalau stok kurang:** `throw AppError("Stok 5kg tidak cukup untuk menyelesaikan Selesai Muat ini.")` — Selesai Muat armada ditolak total (rollback), tidak ada perubahan stok apapun. Konsisten dengan perilaku TakeAway saat stok tidak cukup.
- **Dipanggil dari:** `produksiSelesaiMuat` (`produksi-muatan.ts`), di dalam transaksi SQL yang sama, saat `qty5KGDimuat > 0`, dipanggil SEBELUM tulisan lain di transaksi itu (fail-fast).
- **UI:** TIDAK berubah — tetap field angka bebas "Qty 5kg dimuat". Server otomatis memilih entri Kualitas-5KG secara FIFO, sama seperti pola TakeAway (yang juga tanpa picker manual). Error stok kurang otomatis tersurface lewat `ActionResult`/`AppError` yang sudah jadi konvensi di seluruh aplikasi.

**Cegah dobel-pakai (perbaikan wajib pada kode yang sudah ada):** query Sumber 1 di `allocateTakeAwayStock` (`takeaway-alokasi.ts`) saat ini menghitung "sisa" dengan mengurangi Batch + `DashboardTakeAwayAlokasi` saja — belum tahu soal `DashboardArmadaAlokasi` yang baru. Query itu diperbarui supaya juga mengurangi `SUM(DashboardArmadaAlokasi.Qty WHERE KualitasID = k.KualitasID)`. Aman untuk entri 10kg (tidak akan pernah punya baris ArmadaAlokasi, pengurangannya otomatis nol) dan wajib untuk entri 5kg supaya TakeAway dan Armada tidak sama-sama mengklaim baris Kualitas yang sama.

## Bagian 3: Konsistensi tampilan "sisa alokasi"

Dua formula tampilan yang sudah ada (`getKualitasRiwayat`'s `SisaAlokasi` di `produksi-kualitas.ts`, dan `totalTeralokasi` di `produksi-riwayat-detail.ts` untuk Riwayat Produksi) diperbarui supaya juga mengurangi `DashboardArmadaAlokasi`, supaya angka "sisa belum dialokasikan" yang ditampilkan ke user tetap akurat setelah Armada mulai menyerap stok 5kg.

Centang 2 (pallet-completeness) di `getValidasiBulan` **TIDAK perlu diubah** — query itu hanya melihat entri `Variant='10kg'`, dan `DashboardArmadaAlokasi` hanya pernah berisi KualitasID varian 5kg, sehingga tidak pernah bersinggungan.

## Bagian 4: Redesain query centang 3 (`muatan`) di `getValidasiBulan`

Perubahan inti: dari "cek timestamp JamSelesaiMuat ada di jendela shift" menjadi "cek timestamp JamSelesaiMuat YANG PUNYA BUKTI ALOKASI/PENGURANGAN STOK NYATA", digabung dari 3 sumber bukti:

- **Bukti A (Armada 10KG):** `DashboardPengirimanJadwal` di-JOIN ke `DashboardProduksiMuatanDetail` (tabel sudah ada — baris ini hanya tercipta kalau klaim atomik ke `DashboardProduksiBatch.SisaQty10KG` berhasil di dalam `produksiSelesaiMuat`). JadwalID tanpa baris MuatanDetail → JamSelesaiMuat-nya tidak dihitung.
- **Bukti B (Armada 5KG, baru):** `DashboardPengirimanJadwal` di-JOIN ke `DashboardArmadaAlokasi` (Bagian 2).
- **Bukti C (TakeAway, 10KG & 5KG):** `DashboardTakeAwayMuatan` di-JOIN ke `DashboardTakeAwayAlokasi` (SumberTipe apa saja dihitung valid — termasuk fallback ke BATCH untuk 10KG, dikonfirmasi user; untuk 5KG SumberTipe memang selalu KUALITAS by design).

`muatan.lengkap` = true kalau ADA timestamp dari salah satu 3 bukti itu yang jatuh di jendela waktu shift (`getShiftWindow(...,"work")` + `naiveWibToUtcInstant`, pola yang sudah ada, termasuk perbaikan batas-bulan dari proyek sebelumnya).

Ketiga query bukti ini tidak butuh `TOP` cap tambahan — sudah dibatasi oleh rentang tanggal (`JamSelesaiMuat BETWEEN @start AND @end`, ~1 bulan) dan bersifat read-only (tidak ada `UPDLOCK`/`HOLDLOCK`), berbeda dari query FIFO klaim-stok di Bagian 2 yang memang butuh cap karena mengunci baris.

## Global Constraints

- Semua UI dan pesan error berbahasa Indonesia.
- `DashboardArmadaAlokasi` hanya pernah berisi KualitasID varian 5kg — tidak pernah 10kg.
- FIFO Armada-5KG: terbaru dulu (`TanggalLabel DESC, Waktu DESC`) — sama arah dengan Sumber 1 TakeAway, TIDAK BOLEH disamakan dengan arah FIFO Pallet/Batch (tertua dulu).
- Alokasi Armada-5KG terjadi di Selesai Muat (bukan Mulai Muat), di transaksi SQL yang sama dengan tulisan lain `produksiSelesaiMuat`.
- Stok 5KG tidak pernah fallback ke pallet — kalau kurang, Selesai Muat armada ditolak total (rollback), sama seperti perilaku TakeAway.
- TOP 200 + `WITH (UPDLOCK, HOLDLOCK)` wajib pada query FIFO klaim-stok Armada-5KG (pelajaran dari insiden proyek sebelumnya) — TIDAK BOLEH dihilangkan/dikurangi.
- Tidak ada framework migrasi — skema baru lewat script `scripts/_scratch_*.ts` sekali jalan, dijalankan lalu dihapus, tidak pernah di-commit.
- Tidak ada test suite otomatis — setiap task diverifikasi via `npx tsc --noEmit`, `npx eslint`, script scratch DB terhadap data live, dan (kalau memungkinkan) klik-coba browser.
- UI input Qty 5KG armada TIDAK berubah — tetap field angka bebas, alokasi FIFO sepenuhnya otomatis di server (tanpa picker manual), sama seperti pola TakeAway.
- Ketiga query Bukti (Bagian 4) WAJIB memfilter `IsDeleted = 0` pada `DashboardPengirimanJadwal`/`DashboardTakeAwayMuatan` dan `IS NOT NULL` pada `JamSelesaiMuat` — proyek sebelumnya sudah pernah melewatkan filter ini di percobaan pertama (ditemukan & diperbaiki lewat review), jangan diulangi.

## Verifikasi

Tidak ada test suite di repo ini. Setiap task diverifikasi seperti proyek sebelumnya: `npx tsc --noEmit`, `npx eslint <file berubah>`, dan script scratch yang memanggil fungsi terkait langsung terhadap data live (dihapus setelah dipakai). Untuk redesain centang 3 khususnya, verifikasi harus mencakup: (a) shift dengan Selesai Muat armada 10KG bervalidasi alokasi asli → hijau; (b) shift dengan Selesai Muat armada 10KG TANPA alokasi asli (kalau ada data historis semacam ini) → abu-abu; (c) shift dengan Selesai Muat armada 5KG setelah Bagian 2 selesai → hijau; (d) shift dengan TakeAway 10KG/5KG (data nyata dari proyek sebelumnya, DeliveryOrder `01242942`/SalesInvoice `01235065`) → tetap hijau (regresi check, tidak boleh berubah).
