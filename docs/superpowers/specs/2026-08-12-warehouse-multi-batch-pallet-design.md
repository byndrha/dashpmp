# Warehouse Multi-Batch Pallet + 5KG Decoupling — Design Spec

## Latar Belakang

Modul Produksi MKEsindo (`/mkesindo/produksi-app`) saat ini menerapkan aturan "satu posisi pallet = satu batch sampai habis" (lihat `docs/superpowers/specs/2026-08-10-modul-produksi-design.md`) — begitu sebuah posisi pallet (mis. `U2A`) menyimpan satu batch produksi aktif, posisi itu terkunci: tidak bisa menerima produksi baru sampai batch lama habis (`SisaQty10KG` dan `SisaQty5KG` sama-sama 0).

User melaporkan ini tidak cocok dengan kenyataan lapangan: sebuah pallet fisik punya kapasitas nyata (kira-kira 120 kantong es 10kg), dan biasanya belum penuh meski sudah ada isinya. Operator ingin bisa menambah produksi baru ke posisi yang sudah terisi, selama kapasitas fisiknya belum tercapai — bukan menunggu posisi itu benar-benar kosong dulu.

Terpisah, user juga mengonfirmasi bahwa kemasan 5KG sebenarnya **tidak melalui alur stok-pallet-FIFO** seperti 10KG — kemasan ini "diproses langsung" begitu produksi selesai, tanpa disimpan menunggu di sebuah posisi pallet tertentu. Modul ini sejak awal ikut men-generalisasi 5KG ke pola yang sama seperti 10KG (Qty5KG di setiap batch, alokasi per-pallet saat Isi Muatan) — itu keliru dan perlu dilepas dari model stok pallet.

## Cakupan

Dua perubahan yang saling terkait, keduanya di modul MKEsindo Produksi (`/mkesindo/produksi` desktop + `/mkesindo/produksi-app` mobile) — **tidak menyentuh** modul PMPersada Produksi (Rek/Bak) yang terpisah total:

**(A) Satu posisi pallet bisa menampung banyak batch sekaligus**, dengan batas kapasitas gabungan 120 kantong 10kg per posisi. Tidak ada batas jumlah batch — selama total sisa masih di bawah 120, batch baru boleh ditambahkan.

**(B) Kemasan 5KG dilepas dari model stok pallet/batch** — tidak lagi dicatat per-batch, tidak lagi dialokasikan per-pallet saat Isi Muatan, tidak lagi mengurangi "Sisa" pallet manapun. Angka "berapa kantong 5kg dimuat" tetap dicatat, tapi sebagai satu angka per Kartu Pengiriman (bukan per-pallet).

## Model Data

### `DashboardProduksiPalletPosisi` — `BatchIDAktif` berhenti dipakai

Kolom `BatchIDAktif` (single nullable FK, "batch aktif saat ini") **tidak lagi jadi sumber kebenaran** untuk status posisi. Status "terisi/kosong" dan "sisa kapasitas" sekarang **selalu diturunkan** dari agregasi `DashboardProduksiBatch` yang mereferensikan posisi itu:

```sql
SELECT PosisiID, SUM(SisaQty10KG) AS TotalSisa
FROM DashboardProduksiBatch
WHERE PosisiID = @posisiId AND IsDeleted = 0 AND SisaQty10KG > 0
GROUP BY PosisiID
```

- **Kosong** = tidak ada baris dengan `SisaQty10KG > 0` di posisi itu (`TotalSisa` = 0 atau tidak ada baris).
- **Kapasitas tersisa** = `120 - TotalSisa` (bisa 0 kalau sudah penuh).
- Kolom `BatchIDAktif` di-drop lewat migration (`ALTER TABLE DashboardProduksiPalletPosisi DROP COLUMN BatchIDAktif`) — tidak dibiarkan menggantung tak terpakai, karena kalau tetap ada nanti membingungkan pembaca kode berikutnya (terlihat seperti sumber kebenaran padahal bukan).

### `DashboardProduksiBatch` — hapus kolom 5KG

`ALTER TABLE DashboardProduksiBatch DROP COLUMN Qty5KG, SisaQty5KG` — kolom ini dihapus total. `PosisiID` (sudah ada, NOT NULL) tetap jadi cara batch mereferensikan posisinya — tidak berubah.

### `DashboardPengirimanJadwal` — kolom baru `Qty5KGDimuat`

`ALTER TABLE DashboardPengirimanJadwal ADD Qty5KGDimuat INT NULL` — satu angka "berapa kantong 5kg dimuat" untuk seluruh Kartu Pengiriman, diisi sekali saat "Isi Muatan" (Selesai Muat), terpisah total dari alokasi pallet 10kg. `NULL` berarti belum diisi (Kartu Pengiriman lama, sebelum perubahan ini, atau yang di-Selesai-Muat lewat jalur manual `produksiSelesaiMuatManual` yang tidak melalui alokasi pallet sama sekali).

### `DashboardProduksiMuatanDetail` — tetap satu baris per batch, kolom 5KG dihapus

`ALTER TABLE DashboardProduksiMuatanDetail DROP COLUMN Qty5KGDiambil` — baris di tabel ini sekarang murni "berapa 10kg diambil dari batch X untuk Jadwal Y", satu baris per batch yang dialokasikan. Riwayat "5kg dimuat" dibaca dari `DashboardPengirimanJadwal.Qty5KGDimuat`, bukan dari tabel ini.

### Yang TIDAK berubah

- `JADWAL_KANTONG_10KG_EXPR`/`JADWAL_KANTONG_5KG_EXPR` (`src/lib/queries/pengiriman-jadwal.ts`) — ini menghitung kebutuhan pesanan pelanggan dari `SalesOrderDetail`, sepenuhnya independen dari stok pallet. Tidak tersentuh.
- Semua pembacaan `Qty5KG`/`kantong 5kg` yang bersumber dari ekspresi di atas (kartu satpam-app, kartu Kartu Pengiriman "Dibutuhkan"/"Sudah Selesai Muat", driver-app) — ini "sisi permintaan", bukan "sisi stok pallet", tidak berubah.
- `produksiStartMuat`/`produksiSelesaiMuatManual` (jalur manual tanpa alokasi pallet) — tidak tersentuh.

## Alur "Tambah Produksi" (`TambahProduksiDialog`, mobile)

- Dialog ini sekarang bisa dibuka dari **posisi manapun** (kosong atau sudah terisi), selama kapasitas belum penuh — bukan cuma posisi kosong seperti sekarang.
- Field Qty 5KG dihapus dari form — tinggal Mesin, Qty 10KG, Tanggal Label, Shift, Jam Panen.
- Dialog menampilkan sisa kapasitas posisi saat ini (mis. "Terisi 84/120 — sisa ruang 36 kantong"), dihitung dari agregasi di atas.
- Validasi qty10 client-side: tidak boleh > sisa kapasitas.
- `createBatch` (`src/lib/queries/produksi-warehouse.ts`) diubah: klaim `WHERE PosisiID=@posisiId AND BatchIDAktif IS NULL` diganti dengan pengecekan kapasitas atomik di dalam transaksi yang sama — baca `SUM(SisaQty10KG)` posisi itu dengan row-lock (`WITH (UPDLOCK, HOLDLOCK)` pada agregasi, atau pola terkunci setara) sebelum INSERT, tolak dengan `AppError` kalau `total + qty10Baru > 120`. Ini menggantikan pola "IS NULL" lama, tapi tetap menutup race yang sama (dua operator submit ke posisi yang sama secara bersamaan).

## Popup Detail Pallet (mobile `WarehouseView` + desktop `PetaWarehouseDesktop`)

- Popup detail (yang sudah ada — menampilkan `RiwayatPosisiList` per posisi) **dipertahankan apa adanya** untuk daftar riwayatnya — query `getRiwayatProduksiForPosisi` sudah mengambil semua batch per posisi (aktif maupun sudah habis), jadi otomatis sudah kompatibel dengan model banyak-batch.
- **Tambahan**: tombol **"+ Tambah Produksi"** di dalam popup ini, muncul kalau kapasitas posisi itu masih tersisa (`total < 120`), membuka `TambahProduksiDialog` dengan posisi yang sama sudah terisi otomatis.
- Kolom Qty5KG/Sisa5KG dihapus dari `RiwayatPosisiList` (baris jadi "Qty10KG" saja, bukan "10KG-5KG").

## Peta Warehouse (grid sel, `warehouse-cell.tsx` — dipakai bersama desktop & mobile)

- **Warna sel** (panduan FIFO): berdasarkan batch **paling tua** (berdasarkan `TanggalLabel`+`JamPanen`, konsisten dengan logika age-coloring yang sudah ada) di antara semua batch aktif di posisi itu — bukan satu batch tunggal seperti sekarang.
- **Angka "Sisa"** di badge sel: `SUM(SisaQty10KG)` semua batch aktif di posisi itu (satu angka, bukan `10KG-5KG` seperti sekarang karena 5KG sudah dihapus).
- **Badge jumlah batch**: kalau lebih dari 1 batch aktif menumpuk di satu posisi, tampilkan indikator kecil (mis. `×3`) di pojok sel.
- `getWarehouseMap()` (`src/lib/queries/produksi-warehouse.ts`) diubah dari `LEFT JOIN ... ON b.BatchID = p.BatchIDAktif` (satu batch) menjadi agregasi per posisi: `COUNT(batch aktif)`, `SUM(SisaQty10KG)`, dan batch tertua untuk warna — lewat subquery/CTE per posisi, bukan join flat.
- `peta-warehouse-desktop.tsx` panel detail (saat sel diklik di desktop): sama seperti popup mobile — hapus baris "5kg", tambahkan total + badge jumlah batch, dan (opsional, sama seperti mobile) tombol untuk memicu pencatatan produksi baru kalau desktop ingin fitur yang sama — **tapi desktop `/mkesindo/produksi` secara desain memang view-only** (lihat spec awal: "alur tambah-produksi selalu mobile-only"), jadi panel desktop **hanya menampilkan** info kapasitas, tidak ada tombol aksi — konsisten dengan constraint desain yang sudah ada.

## Riwayat Produksi (desktop, `riwayat-produksi.tsx`)

- Kolom "Jumlah Awal"/"Sisa" berhenti menampilkan `Qty5KG`/`SisaQty5KG` — tinggal `Qty10KG`/`SisaQty10KG`. Tabel ini sudah berbasis per-batch (bukan per-posisi), jadi tidak perlu restrukturisasi lain — satu baris tetap satu batch, baik posisinya sendirian maupun menumpuk dengan batch lain.

## Layar "Isi Muatan" (`AlokasiScreen` di `kartu-pengiriman-list.tsx`, mobile)

- Daftar pallet yang bisa diambil berubah dari **satu baris per posisi** (asumsi lama: 1 posisi = 1 batch) menjadi **satu baris per batch aktif** — kalau satu posisi punya 3 batch aktif, muncul 3 baris terpisah, masing-masing dengan kode posisi + usia + sisa sendiri.
- Pengurutan FIFO tetap: batch dengan `TanggalLabel`+`JamPanen` (atau `TanggalProduksi`) paling tua ditaruh paling atas, badge "Paling lama — ambil dulu" tetap di baris pertama. Ini sudah dilakukan di client (`sort` di `useEffect`) — cukup diganti sumbernya dari daftar posisi jadi daftar batch flat (butuh query baru atau endpoint baru yang mengembalikan daftar batch aktif, bukan `getWarehouseMap()` yang sekarang per-posisi).
- Field Qty 5kg **per-baris dihapus** sepenuhnya dari daftar alokasi.
- **Field baru**: satu input "Qty 5kg dimuat" di bagian atas layar (di luar daftar pallet 10kg), untuk seluruh Kartu Pengiriman — pre-filled dari `jadwal.Qty5KGDibutuhkan` (kebutuhan pesanan) sebagai default yang bisa diedit, sama seperti pola pengisian sekarang.
- Pengecekan "cukup" (`actions.ts`, `produksiSelesaiMuatAction`): `totalQty10` tetap dijumlah dari alokasi baris-baris batch dibandingkan `Qty10KGDibutuhkan`; `qty5KGTotal` (field tunggal baru) dibandingkan `Qty5KGDibutuhkan` — logika sama, sumber datanya saja yang berubah dari "jumlah semua baris.qty5" jadi "satu field".

## Server: `produksiSelesaiMuat` (`src/lib/queries/produksi-muatan.ts`)

- `MuatanAlokasi` jadi 10kg-only: `{ batchId: number; qty10KG: number }` — `qty5KG` dihapus dari interface ini.
- `ProduksiSelesaiMuatInput` dapat field baru: `qty5KGDimuat: number` (bukan bagian dari `alokasi[]`).
- Di dalam transaksi: setiap item alokasi tetap insert `DashboardProduksiMuatanDetail` (kolom `Qty5KGDiambil` dihapus dari INSERT karena kolomnya sudah tidak ada) dan klaim `SisaQty10KG` (klaim `SisaQty5KG` dihapus dari UPDATE dan `WHERE`).
- Klaim kosongnya posisi (baris `if (SisaQty10KG === 0 && SisaQty5KG === 0)` yang men-null-kan `BatchIDAktif`) **dihapus seluruhnya** — karena `BatchIDAktif` sudah tidak dipakai (lihat Model Data di atas), tidak ada lagi yang perlu di-clear di tabel posisi setelah batch habis.
- Setelah semua item alokasi diproses, satu `UPDATE DashboardPengirimanJadwal SET Qty5KGDimuat = @qty5KGDimuat WHERE JadwalID = @jadwalId` di transaksi yang sama.

## Migrasi Data (satu kali, controller-run sebelum kode baru di-deploy)

Karena ini production sistem yang sudah punya data live (250 Rek PMPersada terpisah, tapi MKEsindo Produksi punya datanya sendiri — perlu dicek apakah ada batch/posisi aktif saat ini):
1. Sebelum drop kolom `BatchIDAktif`/`Qty5KG`/`SisaQty5KG`/`Qty5KGDiambil`, cek dulu apakah masih ada baris live yang datanya perlu diselamatkan (mis. batch dengan `SisaQty5KG > 0` yang belum sempat diambil — perlu keputusan bisnis: dianggap hangus, atau dikonversi ke suatu bentuk lain). Ini dicek langsung di database produksi saat eksekusi task DDL, dilaporkan ke user sebelum drop kalau ada data yang berpotensi hilang.
2. Urutan DDL: tambah kolom baru dulu (`Qty5KGDimuat` di Jadwal) → migrasi data lama kalau perlu → baru drop kolom lama.

## Testing / Verifikasi Manual

- Klik posisi kosong → Tambah Produksi → posisi jadi terisi (seperti sekarang, regresi-check).
- Klik posisi yang sudah terisi (di bawah 120) → popup detail → tombol "+ Tambah Produksi" muncul → isi lagi → total sisa bertambah, riwayat menunjukkan 2 batch terpisah di posisi yang sama, warna sel tetap dari batch tertua.
- Coba Tambah Produksi ke posisi yang totalnya sudah/akan melebihi 120 → ditolak dengan pesan jelas, baik dari validasi client maupun (simulasi race 2 device) dari server.
- Isi Muatan: daftar alokasi menampilkan pallet per-batch (bukan per-posisi) kalau ada posisi bertumpuk, urutan FIFO benar lintas posisi. Field "Qty 5kg dimuat" terpisah, tersimpan ke `DashboardPengirimanJadwal.Qty5KGDimuat`, terbaca lagi di kartu "Sudah Selesai Muat".
- satpam-app dan driver-app: pastikan kartu kantong 10kg/5kg mereka **tidak berubah** (bersumber dari `JADWAL_KANTONG_*_EXPR`, bukan stok pallet) — regresi-check bahwa perubahan ini benar-benar tidak menyentuh sisi permintaan.
