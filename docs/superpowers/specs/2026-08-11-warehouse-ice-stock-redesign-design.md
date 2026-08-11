# Redesain Peta Warehouse (Ice Stock Cold Storage) — Design Spec

## Ringkasan

Modul Produksi (balok es) saat ini memodelkan gudang penyimpanan sebagai **1 ruangan tetap dengan 12 posisi pallet** (kode `1A`–`3D`, dikelompokkan 3 "Jendela" berisi 4 slot masing-masing), dirender oleh satu komponen bersama `PetaWarehouse` yang dipakai identik di desktop (`/mkesindo/produksi`) dan mobile (`/mkesindo/produksi-app` tab Warehouse).

Ruangan fisik sebenarnya (cold storage "Ice Stock") jauh lebih besar: **42 posisi pallet**, dibagi 3 zona (Selatan/Tengah/Utara) yang masing-masing punya sub-grup dengan jumlah slot berbeda. Spec ini mendefinisikan ulang seluruh lapisan (data, query, komponen) untuk mencerminkan denah nyata ini, sekaligus menyederhanakan alur pencatatan produksi baru di mobile: dari "pilih tab terpisah → pilih slot dari daftar" menjadi "klik slot kosong langsung di peta".

Tidak ada migrasi data pallet aktif dari skema lama — user mengonfirmasi reset bersih (semua 42 posisi baru mulai kosong).

## Denah fisik yang dikonfirmasi

**1 ruangan fisik**, dibagi 3 kelompok kode berdasarkan huruf awal — Selatan (`S`), Tengah (`T`), Utara (`U`) — total **42 slot**. Dikonfirmasi interaktif lewat visual companion (lihat `.superpowers/brainstorm/700-1786449270/content/denah-v2.html`).

| Grup | Jumlah slot | Grid | Kode (urutan render) |
|---|---|---|---|
| S1 | 6 | 2 kolom × 3 baris | Baris1: `S1F`,`S1C` · Baris2: `S1E`,`S1B` · Baris3: `S1D`,`S1A` |
| S2 | 6 | 2 kolom × 3 baris | Baris1: `S2D`,`S2A` · Baris2: `S2E`,`S2B` · Baris3: `S2F`,`S2C` |
| T1 | 9 | 3 kolom × 3 baris | Baris1: `T1I`,`T1F`,`T1C` · Baris2: `T1H`,`T1E`,`T1B` · Baris3: `T1G`,`T1D`,`T1A` |
| T2 | 9 | 3 kolom × 3 baris | Baris1: `T2G`,`T2D`,`T2A` · Baris2: `T2H`,`T2E`,`T2B` · Baris3: `T2I`,`T2F`,`T2C` |
| U1 | 4 | 2 kolom × 2 baris | Baris1: `U1D`,`U1B` · Baris2: `U1C`,`U1A` |
| U2 | 4 | 2 kolom × 2 baris | Baris1: `U2C`,`U2A` · Baris2: `U2D`,`U2B` |
| U3 | 4 | 2 kolom × 2 baris | Baris1: `U3C`,`U3A` · Baris2: `U3D`,`U3B` |

Divider antar-grup, urut dari kiri (Selatan) ke kanan (Utara):
- Antara S1 dan S2: label **"Jalan"**
- Antara blok S dan blok T: **"Jalan"** (strip vertikal)
- Antara T1 dan T2: label **"Jalan"**
- Antara blok T dan blok U: **"Jalan"** (strip vertikal)
- Antara U1 dan U2: label **"Jalan & Jendela 1"**
- Antara U2 dan U3: label **"Jalan & Jendela 2"**
- Setelah U3: label **"Jalan & Jendela 3"**, lalu footer **"Pintu Geser"**

Zona untuk keperluan UI (tab Selatan/Tengah/Utara di mobile) = huruf pertama `Kode` (`S`/`T`/`U`) — **tidak** disimpan sebagai kolom terpisah, cukup diturunkan dari `Kode` di kode aplikasi (denah fisik tetap, tidak diharapkan bertambah/berkurang — sama seperti prinsip 12-slot yang sudah ada sekarang).

## Perubahan data model

### `DashboardProduksiPalletPosisi` (controller-run DDL)

Ganti isi tabel: hapus 12 baris lama (`1A`–`3D`), insert 42 baris baru sesuai tabel denah di atas, semua `BatchIDAktif = NULL`. Script migrasi mengikuti pola idempotent (check-then-insert) yang sudah dipakai di setiap task DDL sebelumnya di sesi ini, dan **tidak** menyertakan logika migrasi pallet aktif dari skema lama (reset bersih, dikonfirmasi user).

### `DashboardProduksiBatch` (controller-run DDL, additive)

Tambah kolom baru: `JamPanen TIME NULL` (nullable di level DB — validasi "wajib diisi" ada di form/server action, bukan constraint DB, konsisten dengan pola `TanggalLabel`/`Shift` yang ditambahkan di plan sebelumnya). Merepresentasikan jam:menit saat es selesai diproduksi/dipanen dari mesin — **berbeda** dari `TanggalProduksi` (timestamp otomatis saat form disubmit) dan dipakai sebagai basis pengukuran usia stok di cold storage (lihat bagian "Logika warna umur" di bawah).

## Perubahan query layer (`src/lib/queries/produksi-warehouse.ts`)

- `PalletPosisiRow` — tambah field `JamPanen: string | null` (format `HH:mm` atau `HH:mm:ss` dari DB).
- `RiwayatProduksiRow` — tambah field `JamPanen: string`.
- `CreateBatchInput` — tambah field wajib `jamPanen: string`.
- `getWarehouseMap()` — tidak ada perubahan logika, hanya jumlah baris hasil (42, bukan 12).
- `createBatch()` — tambah `JamPanen` ke `INSERT` batch baru. Transaksi atomik "claim posisi" (`UPDATE ... WHERE PosisiID = @posisiId AND BatchIDAktif IS NULL`, rollback + `AppError` jika sudah diklaim) **tidak berubah** — makin relevan dengan 42 posisi yang bisa diklik paralel oleh lebih banyak orang.

## Logika warna umur (perubahan)

Saat ini `ageClass()` menghitung umur dari `TanggalProduksi` (timestamp submit form). **Diganti**: umur dihitung dari datetime gabungan `TanggalLabel` (tanggal) + `JamPanen` (jam) — merepresentasikan kapan es itu benar-benar mulai disimpan di cold storage, bukan kapan operator sempat mengetik form-nya. Threshold warna (merah ≥3 hari / oranye ≥1 hari / hijau &lt;1 hari / abu-abu kosong) tidak berubah, hanya sumber datanya.

## Arsitektur komponen (Approach 2 — disetujui user)

### Modul layout bersama baru: `src/components/produksi/warehouse-layout.ts`

Konstanta yang mendeskripsikan 7 grup (S1, S2, T1, T2, U1, U2, U3) — masing-masing: daftar kode terurut sesuai tabel denah, jumlah kolom grid (2 atau 3), dan label divider setelahnya. Satu sumber kebenaran dipakai baik oleh renderer desktop maupun mobile — mencegah duplikasi/divergensi denah antar platform.

### Komponen presentasional bersama: `WarehouseCell`

Merender satu slot: kode, warna (dari `ageClass()` yang sudah diperbarui), dan baris `SisaQty10KG-SisaQty5KG` — separator diganti dari `·` menjadi `-` (mengikuti mockup, berlaku di kedua platform). Menerima prop `onClick` — pemanggil (desktop/mobile) menentukan perilakunya.

### `PetaWarehouseDesktop` (dipakai di `/mkesindo/produksi`)

Merender ketiga blok zona (S, T, U) berdampingan sekaligus (tanpa tab/swipe — memanfaatkan lebar layar desktop), pakai `warehouse-layout.ts` + `WarehouseCell`. Klik slot terisi → panel detail read-only (sama seperti sekarang, sekarang menampilkan Jam Panen juga). Klik slot kosong → tidak melakukan apa-apa (desktop tidak punya alur tambah-produksi, sama seperti sekarang — alur itu memang selalu mobile-only).

### Warehouse mobile (`src/components/produksi-app/warehouse-view.tsx`, direvisi)

- Merender ketiga blok zona sebagai carousel horizontal yang bisa di-swipe (CSS scroll-snap), dengan tab Selatan/Tengah/Utara di atas berfungsi sebagai kontrol "scroll ke posisi" (tap tab = smooth-scroll ke blok itu; swipe manual juga berfungsi native). Lebar tiap blok zona diatur sedikit kurang dari lebar viewport (bukan 100%) supaya sebagian blok tetangga selalu kelihatan mengintip di tepi layar — konfirmasi dari diskusi awal bahwa perilakunya "kalau ada sisa di sebelah kanan, tampilkan cuplikan dari view ruangan sebelahnya".
- Klik slot terisi → panel detail read-only (sama, + Jam Panen).
- Klik slot kosong → membuka `TambahProduksiDialog` baru (pola sama dengan `BbmDialog`/`VehicleCheckDialog` yang sudah ada), dengan `posisiId` dari slot yang diklik sudah terisi otomatis (user tidak perlu pilih slot lagi). Form: Mesin, Tanggal (label), Shift, Jam Panen (wajib), Qty 10KG, Qty 5KG. Submit memanggil server action yang membungkus `createBatch()` (sudah termasuk `JamPanen`). Sukses → dialog tertutup, slot langsung berubah jadi terisi.

### Penghapusan tab "Produksi Baru"

- `src/components/produksi-app/produksi-baru-form.tsx` dan entry-nya di `src/components/produksi-app/bottom-nav.tsx` dihapus.
- Bottom nav mobile jadi 3 item: Kartu Pengiriman, Warehouse, Profil (urutan tetap, hanya item "Produksi Baru" yang hilang).
- `src/components/produksi-app/produksi-tab-shell.tsx` — hapus case `"produksi-baru"` dari tab switcher.

### `RiwayatProduksi` (desktop, `src/components/produksi/riwayat-produksi.tsx`)

Tambah kolom Jam Panen di tabel riwayat, konsisten dengan data yang sekarang tersedia.

## Error handling & edge case

- Race condition klik-slot-kosong-sama-oleh-2-orang: sudah ditangani transaksi atomik `createBatch()` yang ada — `AppError` "posisi sudah diklaim" akan muncul di dialog kalau terjadi, user tinggal pilih slot lain.
- Validasi Jam Panen wajib diisi: divalidasi di server action (pola `AppError` yang sudah dipakai di semua server action lain di project ini), bukan hanya di client.
- Migrasi DDL: idempotent (check-then-insert), dijalankan controller-run sekali, script dihapus setelah dipakai (pola yang sudah konsisten dipakai di setiap task DDL sebelumnya).

## Testing / verifikasi

Tidak ada test runner di proyek ini (pola yang sudah mapan). Verifikasi: `npx tsc --noEmit` + `npx eslint` pada file yang berubah, lalu live click-through:
- Desktop `/mkesindo/produksi`: 42 slot tampil terkelompok & berwarna benar berdampingan, klik slot terisi menampilkan detail (termasuk Jam Panen baru).
- Mobile `/mkesindo/produksi-app` tab Warehouse: swipe antar 3 zona berfungsi, tab Selatan/Tengah/Utara berfungsi sebagai scroll-to, klik slot kosong membuka dialog tambah produksi, submit berhasil membuat batch baru dengan Jam Panen dan slot langsung terisi di layar, klik slot terisi tetap menampilkan detail read-only.
- Bottom nav mobile hanya 3 item, tidak ada lagi entry Produksi Baru.
