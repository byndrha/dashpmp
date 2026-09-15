# Modul Inventaris — Tahap 1: Vendor, Produk, PIC & Peringkat

## Latar Belakang & Ruang Lingkup

PMP Group (menaungi MKEsindo, PMPersada, PMPutra) belum punya modul Inventaris lintas-grup. Data supplier saat ini hanya berupa baris `BusinessPartner` di masing-masing database ERP MSSQL per perusahaan (kode `SUPPxxxxx`), tanpa data produk yang mereka tawarkan, PIC, lokasi cabang, atau catatan performa historis — dan modul "Stok Bahan Baku" yang sudah ada (per-MKEsindo, per-shift) tidak mengenal konsep vendor sama sekali.

**Modul Inventaris** adalah modul baru lintas-grup yang menaungi semuanya. Dibangun bertahap:

- **Tahap 1 (spec ini)**: Tab **Vendor** — data vendor, produk (brand & model) yang mereka tawarkan, lokasi cabang, PIC (vendor & internal), dan sistem peringkat berbasis log pengiriman ringkas.
- **Tahap 2 (nanti, di luar cakupan spec ini)**: Pencatatan transaksi pembelian (PO) penuh ke vendor.
- **Tahap 3 (nanti, di luar cakupan spec ini)**: Tab **Stok Bahan Baku** — migrasi/integrasi modul Stok Bahan Baku yang sudah ada ke bawah payung modul Inventaris ini, terhubung ke data vendor.

Modul ini berlaku **lintas grup** (MKEsindo, PMPersada, PMPutra) — satu vendor bisa bertransaksi dengan lebih dari satu perusahaan.

## Temuan Investigasi (fakta yang menjadi dasar desain)

- Setiap perusahaan (MKEsindo, dan berpotensi PMPersada/PMPutra) punya database ERP MSSQL sendiri dengan tabel `BusinessPartner` yang sudah dipakai untuk mencatat vendor/supplier via kode `Code = 'SUPP' + 5 digit angka` (contoh nyata: `SUPP00139` = "PT. Hotei Poly Mulia", `SUPP00287` = "Pabrik Es Khasanah"). Saat ini ada 20 baris `SUPP%` di database MKEsindo, nomor tertinggi `SUPP00670`.
- Semua baris `SUPP%` yang ada memakai `GroupBusinessPartner = '0'` sebagai penanda "supplier" (berbeda dari pelanggan yang memakai `1`/`2`/`3`) — dijadikan konvensi baku untuk baris baru.
- Kolom-kolom akuntansi pada `BusinessPartner` seragam persis di seluruh 20 baris yang ada: `AccountPayableID='0137'`, `AccountReceivableID='019'`, `SalesDiscID='0183'`, `PurchaseDiscID='0114'`, `TaxInID='0122'`, `TaxOutID='0147'`, `PurchaseDepositID='0115'`, `SalesDepositID='0185'`, `PriceLevel=1` (2 pengecualian bernilai 7, diabaikan — pakai 1 sebagai default).
- **Nilai default BAKU untuk vendor baru dari modul ini** (dikonfirmasi user, sebagian sengaja BEDA dari pola historis di atas — lihat `ChartOfAccountID` masing-masing telah diverifikasi langsung ke `ChartOfAccount.AccountNo`/`Description`):
  | Field | Nilai default | Akun terverifikasi |
  |---|---|---|
  | `GroupBusinessPartner` | `'0'` | (label ERP: "Vendor") |
  | `TermOfPaymentID` | `'014'` | "Tunai" (`TermOfPayment` table) |
  | `AccountPayableID` | `'0137'` | AccountNo `2101` — "Hutang Dagang" |
  | `PurchaseDepositID` | **kosong/NULL** (bukan `'0115'`) | sengaja tidak diisi — beda dari pola historis 20 vendor lama, yang semuanya memakai `'0115'` = AccountNo `1500` "Uang Muka" |
  | `PurchaseDiscID` | `'0114'` | AccountNo `14012` — "Persediaan - Barang Dagang" |
  | `TaxInID` | `'0122'` | AccountNo `1606` — "PPN Masukan" |
  | `AccountReceivableID`, `SalesDiscID`, `TaxOutID`, `SalesDepositID`, `PriceLevel` | sama seperti pola historis (`'019'`, `'0183'`, `'0147'`, `'0185'`, `1`) | tidak diminta berubah, dipertahankan agar baris tetap konsisten dengan supplier lain |
  | `IsSuspended` | `false` (aktif) | vendor baru dianggap aktif sampai staf menonaktifkan |
- Field lain yang WAJIB diisi staf saat membuat/link vendor baru (bukan default, input nyata per vendor): **Nama** (`BusinessPartner.Name`), **NPWP** (`BusinessPartner.NPWP`, format berpisah titik ala NPWP Indonesia, mis. `12.345.678.9-012.000`), **Alamat NPWP** (`BusinessPartner.NPWPAddress` — kolom terpisah dari `Address` biasa), dan **PIC utama** (`BusinessPartner.ContactPerson` = nama PIC, `BusinessPartner.MobileNo` = nomor HP PIC).
- `BusinessPartnerID` adalah `varchar(16)`, bukan auto-increment, dan panjangnya TIDAK seragam di data yang ada (`"0139"`, `"01114"`, `"01679"`, dst). **Peringatan penting**: kolom serupa (`GeneralLedger.ID`) pernah terbukti membuat `MAX(ID)` sebagai string SQL biasa memberi hasil salah (`'048550' > '01238503'` secara leksikal padahal lebih kecil secara angka) — ID baru untuk `BusinessPartnerID` HARUS digenerate dengan `MAX(TRY_CAST(BusinessPartnerID AS BIGINT))` lalu +1, zero-padded mengikuti panjang mayoritas ID terbaru, bukan `MAX(BusinessPartnerID)` polos.
- Modul lintas-grup yang sudah ada (Akun, Perusahaan) hidup di Postgres (`akun_direktori`), diakses lewat halaman di bawah `/grup/...`, dengan gerbang akses `requireGrupAccess()` (Direktur-scope atau `isSuperAdmin`/`canAccessAllPT()`) — pola inilah yang diikuti modul Inventaris.
- **Koreksi penting dari rencana awal**: `ModuleKey`/`canView(permissions, moduleKey)` (`src/lib/permissions.ts`, `src/lib/require-access.ts`) TERNYATA khusus untuk modul per-perusahaan (MKEsindo) — `permissions` di JWT session dibangun dari `peran_id` milik SATU perusahaan (`getPermissionMapForPeran`), dan komentar di `auth.ts` menegaskan eksplisit: "*/grup gates on accountScope directly, not this permission map*". Halaman `/grup/*` yang sudah ada (Akun, Perusahaan) TIDAK PERNAH memakai sistem ini — modul Inventaris (lintas-PT) tidak bisa memakai pola yang sama.
- Flag serupa lain yang sudah ada (`is_satpam`, `is_driver`, `is_produksi`, `is_operasional`) juga TIDAK cocok ditiru — semuanya kolom pada tabel `peran` (diset per-ROLE lewat `setPeranSatpam` dkk di `src/lib/queries/akun.ts`), sehingga tetap ter-scope ke SATU perusahaan lewat peran itu, bukan mekanisme lintas-PT.
- **Desain akses yang benar untuk Inventaris**: kolom BOOLEAN baru langsung di tabel `akun` (bukan `peran`) — mis. `can_akses_inventaris` — independen dari perusahaan asal staf maupun peran yang mereka pegang, karena hak akses Inventaris ini per-ORANG, bukan per-peran-per-PT. Dialirkan ke JWT session (`auth.ts`) persis seperti `isDriver`/`isSatpam` dialirkan sekarang, hanya sumbernya `akun` langsung, bukan hasil JOIN ke `peran`.
- Modul "Stok Bahan Baku" yang sudah ada (`DashboardStokBahanBakuShift`) adalah pelacakan stok internal murni (kantong plastik, ikat kabel) per shift — TIDAK punya konsep vendor/PIC sama sekali, dan sengaja tidak disentuh oleh Tahap 1 ini (integrasinya masuk Tahap 3).

## Model Data

Seluruhnya baru, hidup di **Postgres** (mengikuti pola `akun_direktori`/`perusahaan_koneksi`), kecuali baris cermin di MSSQL `BusinessPartner` per perusahaan.

```
vendor
├── id, nama, npwp (format berpisah titik), npwp_alamat, catatan, is_aktif
├── vendor_lokasi[]          — cabang/gudang vendor: nama lokasi, alamat, kota, kontak lokasi
├── vendor_pic[]             — PIC dari pihak vendor: nama, jabatan, telepon/WA, email (bisa >1;
│                              PIC pertama/utama yang dipakai untuk mengisi BusinessPartner.
│                              ContactPerson & MobileNo saat sinkronisasi)
├── vendor_pic_internal[]    — staf PMP Group yang menangani vendor ini, PER perusahaan
│                              (staf MKEsindo yang pegang vendor X belum tentu staf PMPersada
│                              yang pegang vendor sama)
├── vendor_kategori (tabel terpisah, dikelola bebas oleh staf — bukan enum tetap di kode)
├── vendor_produk[]          — kategori (FK ke vendor_kategori) + brand + model + spesifikasi bebas teks
├── vendor_perusahaan_link[] — satu baris per perusahaan tempat vendor ini transaksi:
│                              perusahaan_id, business_partner_id (MSSQL), term_of_payment_id,
│                              is_suspended, tanggal_link_dibuat
└── vendor_pengiriman[]      — log tiap pengiriman: vendor_perusahaan_link_id (implisit: perusahaan
                               mana), vendor_produk_id (opsional), tanggal_pesan, tanggal_tiba,
                               rating_kualitas (1-5), catatan, dicatat_oleh (akun internal)
```

**Peringkat vendor** dihitung on-the-fly (bukan kolom tersimpan) dari `vendor_pengiriman`:
- Rata-rata lama kirim = rata-rata `(tanggal_tiba - tanggal_pesan)` dalam hari.
- Rata-rata rating kualitas = rata-rata `rating_kualitas`.
- Bisa dilihat gabungan (semua perusahaan) atau difilter per perusahaan tertentu.
- Vendor tanpa log sama sekali tampil sebagai "belum ada data" — bukan 0 yang menyesatkan.

## Sinkronisasi ke MSSQL `BusinessPartner`

**Vendor baru** dikaitkan ke suatu perusahaan (mengisi `vendor_perusahaan_link` pertama kali untuk perusahaan itu):
1. Sistem generate `BusinessPartnerID` baru mengikuti pola ID yang sudah dipakai di tabel `BusinessPartner` perusahaan itu, dan `Code` = `SUPP` + nomor urut berikutnya (query `MAX` dari `Code LIKE 'SUPP%'` milik perusahaan itu, +1, zero-padded 5 digit).
2. Insert baris `BusinessPartner` baru: `Name` dari nama vendor, `Address` dari lokasi utama vendor, `NPWP`/`NPWPAddress` dan `ContactPerson`/`MobileNo` (PIC utama) dari input staf, field akuntansi & `GroupBusinessPartner`/`TermOfPaymentID`/`IsSuspended` memakai nilai default baku yang sudah ditabelkan di atas (staf bisa override `TermOfPaymentID`/`IsSuspended` per vendor bila perlu berbeda dari default).
3. `BusinessPartnerID` hasil insert disimpan di `vendor_perusahaan_link.business_partner_id`.

**Vendor lama** (salah satu dari 20 yang sudah ada di `BusinessPartner`) di-link: TIDAK ada insert baru — cukup simpan `BusinessPartnerID` yang sudah ada.

**Update berkelanjutan**: Postgres adalah sumber kebenaran untuk `Name`, `Address`, `NPWP`, `NPWPAddress`, dan PIC utama (`ContactPerson`/`MobileNo`) — setiap kali salah satu field ini diedit di direktori vendor SETELAH sudah ter-link, baris `BusinessPartner` terkait ikut diperbarui otomatis (satu arah, Postgres → MSSQL; tidak ada arah sebaliknya).

## Asumsi Belum Terverifikasi

Investigasi teknis sejauh ini hanya memeriksa database MKEsindo secara langsung. Belum dikonfirmasi apakah PMPersada dan PMPutra benar-benar punya database MSSQL terpisah dengan struktur `BusinessPartner` yang identik (kolom, konvensi `Code`/`GroupBusinessPartner`, dsb) — **ini harus diverifikasi di awal implementasi Task 1** sebelum kode sinkronisasi ditulis untuk ketiga perusahaan. Jika strukturnya berbeda atau salah satu perusahaan tidak punya `BusinessPartner` sama sekali, sinkronisasi MSSQL untuk perusahaan itu perlu didesain ulang (atau untuk sementara di-skip, vendor tetap bisa dipakai read-only di direktori Postgres tanpa link MSSQL).

## Migrasi Data Awal

Saat modul ini pertama kali dibuat, script migrasi menarik seluruh baris `BusinessPartner` dengan `Code LIKE 'SUPP%'` dari MKEsindo (dan PMPersada/PMPutra jika strukturnya sama) menjadi baris `vendor` + `vendor_perusahaan_link` awal — menarik `Name`, `Code`/`BusinessPartnerID`, `NPWP`, `NPWPAddress` (ke field vendor), `Address` (jadi satu `vendor_lokasi` awal), dan `ContactPerson`/`MobileNo` (jadi satu `vendor_pic` awal) langsung dari data yang sudah ada, bukan kosong — supaya migrasi tidak membuang data yang kebetulan sudah terisi di ERP. Field yang benar-benar belum ada di ERP (produk/brand/model, lokasi kedua dst, PIC internal, log pengiriman) mulai kosong — staf melengkapi bertahap.

## Kontrol Akses

- Kolom baru `akun.can_akses_inventaris BOOLEAN NOT NULL DEFAULT false` (Postgres `pmp_directory`) — satu flag untuk seluruh modul Inventaris (Vendor sekarang, Stok Bahan Baku nanti di Tahap 3), diset per akun individual, berlaku lintas perusahaan.
- `AuthorizedUser`/JWT session (`src/lib/auth.ts`) dapat field baru `canAksesInventaris: boolean`, diisi langsung dari `row.canAksesInventaris` (query `findAkunByUsername` di `src/lib/queries/akun.ts` ditambah kolom ini) — TIDAK lewat JOIN ke `peran` seperti `isDriver`/`isSatpam`, karena ini murni atribut akun.
- Gerbang akses baru `requireInventarisAccess()` di `src/lib/require-access.ts`: `canAccessAllPT()` (Direktur-scope/superadmin) otomatis lolos; staf lain butuh `session.user.canAksesInventaris === true`.
- Editor untuk menyalakan/mematikan `can_akses_inventaris` per akun: toggle sederhana di halaman `/grup/akun` yang sudah ada (dialog edit akun), mengikuti pola field boolean lain di form itu — bukan editor Peran (karena ini bukan atribut peran).
- Halaman hidup di `/grup/inventaris` (sejajar `/grup/akun`, `/grup/perusahaan`).

## Halaman & Alur UI (garis besar, detail komponen ditentukan saat perencanaan implementasi)

- `/grup/inventaris` — shell modul dengan navigasi tab. Tahap 1 mengisi tab **Vendor** (tab **Stok Bahan Baku** menyusul Tahap 3):
  - Tab **Vendor** — daftar vendor (nama, jumlah lokasi, peringkat ringkas, perusahaan mana saja yang terhubung), pencarian, filter kategori produk.
- `/grup/inventaris/vendor/[id]` — detail satu vendor: tab Lokasi, tab PIC (vendor & internal per perusahaan), tab Produk, tab Log Pengiriman & Peringkat, tab Perusahaan Terhubung (link/unlink ke `BusinessPartner`).
- Form tambah/edit vendor, lokasi, PIC, produk — dialog sederhana mengikuti pola dialog yang sudah ada di codebase (mis. `MitraEditDialog`).
- Form catat pengiriman (log ringkas) — dipicu dari halaman detail vendor.
- Halaman kelola kategori produk (`vendor_kategori`) — CRUD sederhana, tidak dikunci di kode, dapat diakses dari tab Vendor.

## Di Luar Cakupan Tahap 1

- Pencatatan Purchase Order/transaksi pembelian penuh (Tahap 2).
- Migrasi tab Stok Bahan Baku ke bawah modul Inventaris ini, dan penghubungannya ke data Vendor (Tahap 3) — modul Stok Bahan Baku yang sudah ada TIDAK disentuh oleh Tahap 1.
- Perhitungan peringkat otomatis dari histori PO nyata (Tahap 1 memakai log manual ringkas sebagai gantinya, dirancang agar bisa diperluas jadi input Tahap 2 nanti tanpa migrasi ulang skema).
