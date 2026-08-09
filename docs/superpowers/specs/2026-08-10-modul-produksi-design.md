# Modul Produksi (Es Kristal) — Design Spec

## Latar Belakang

Bisnis Es Kristal (PT Mitra Kelola Esindo) belum punya modul untuk mencatat hasil produksi es maupun mengelola stok siap kirim di warehouse. Hari ini, Kartu Pengiriman (Jadwal) dibuat draf oleh Staf Operasional lewat Papan Pengiriman, lalu langkah "Mulai Muat" juga dipicu dari sana — tanpa keterkaitan ke stok es yang sebenarnya ada di warehouse maupun urutan FIFO (barang lama harus dikirim lebih dulu).

Tujuan pekerjaan ini: menambahkan modul Produksi yang memungkinkan akun Produksi (1) mencatat hasil produksi baru sebagai penambahan stok di posisi pallet tertentu, dan (2) mengambil alih langkah "Mulai Muat" pada Kartu Pengiriman — memilih pallet mana yang dipakai untuk memenuhi kebutuhan kirim, dengan panduan visual FIFO berdasarkan usia stok.

Fokus tahap ini murni Es Kristal (MKEsindo). Detail shift kerja Kepala Produksi & Staf Produksi dibahas terpisah nanti.

## Cakupan

### Peran & Rute

- Peran baru **Produksi**: flag `peran.is_produksi` (Postgres), pola sama persis dengan `is_driver`/`is_satpam` yang sudah ada. Guard baru `requireProduksi()` di `require-access.ts`.
- **`/mkesindo/produksi`** — modul dashboard (desktop, tampilan Peta Warehouse/Panel Mesin/Riwayat). **Tidak** masuk `NAV_ITEMS` sidebar dan **tidak** memakai sistem `ModuleKey`/`PermissionMap` granular seperti pnl/sales — digerbang langsung oleh flag `isProduksi`, persis pola Driver/Satpam (yang juga sepenuhnya tidak muncul di sidebar). Route ini hidup di luar route group `(dashboard)`, sebagai sibling dari `driver-app`/`satpam-app`/`produksi-app`, dengan layout minimal sendiri (tanpa AppSidebar) — menghindari kelas bug yang sama dengan insiden ERR_TOO_MANY_REDIRECTS sebelumnya (lihat catatan pada `mkesindo-route-restructuring`). Akun `isProduksi` yang mengunjungi rute lain di dalam `(dashboard)` (mis. `/mkesindo/pnl`, bare `/mkesindo`) dialihkan paksa ke `/mkesindo/produksi` lewat guard di `(dashboard)/layout.tsx`, sama seperti isDriver/isSatpam.
- **`/mkesindo/produksi-app`** — aplikasi mobile, gerbang sama (`isProduksi`), struktur tab (keep-alive shell) seperti `driver-app`. Sibling dari `/mkesindo/produksi`, bukan sub-rute di bawahnya — akun Produksi bebas berpindah antara keduanya (desktop untuk memantau, mobile untuk mencatat di lapangan); guard `(dashboard)/layout.tsx` di atas otomatis tidak mengganggu jalur ini karena pengecekan prefiks `"/mkesindo/produksi"` turut mencakup `"/mkesindo/produksi-app"`.
- Untuk tahap ini, Kepala Produksi dan Staf Produksi punya akses yang identik ke keduanya — belum dibedakan berdasarkan peran.

### Data (tabel baru, semua di MSSQL)

Ditaruh di MSSQL (bukan Postgres) karena terhubung langsung ke Kartu Pengiriman (`DashboardPengirimanJadwal`), yang juga di MSSQL — menghindari join lintas-database. Postgres tetap hanya menyimpan flag peran `is_produksi`.

- **`DashboardProduksiMesin`** — data 3 mesin utama: nama, kapasitas produksi, konsumsi listrik, lama produksi, lama pengemasan. Diisi/diubah oleh admin; dipilih sebagai referensi wajib setiap kali mencatat produksi baru.
- **`DashboardProduksiPalletPosisi`** — 12 baris tetap sesuai denah warehouse (kode `1A` s.d. `3D` — lihat bagian Denah Warehouse). Setiap baris menyimpan referensi ke batch produksi yang sedang menempatinya (`BatchIDAktif`, nullable — null berarti kosong).
- **`DashboardProduksiBatch`** — satu baris per pencatatan produksi baru: mesin yang dipakai, posisi pallet tempat ditaruh, tanggal produksi, jumlah awal (`Qty10KG`, `Qty5KG`), dan sisa yang belum diambil untuk pengiriman (`SisaQty10KG`, `SisaQty5KG` — berkurang seiring waktu; posisi pallet otomatis dianggap kosong lagi begitu keduanya mencapai 0).
- **`DashboardProduksiMuatanDetail`** — jejak setiap kali Produksi mengambil dari suatu pallet untuk mengisi sebuah Kartu Pengiriman: `JadwalID`, `BatchID`, jumlah yang diambil (`Qty10KGDiambil`, `Qty5KGDiambil`), siapa yang mencatat, kapan. Ini dasar riwayat/pelacakan FIFO dan juga yang dipakai untuk mengembalikan stok jika suatu saat "Isi Muatan" dibatalkan (lihat Catatan Rencana ke Depan).

**Satu pallet = satu batch sampai habis.** Posisi baru boleh diisi batch baru hanya setelah `SisaQty10KG` dan `SisaQty5KG` batch sebelumnya sama-sama 0. Tidak ada pencampuran/penumpukan batch dalam satu posisi.

Jumlah yang dibutuhkan saat "Isi Muatan" didapat dari total pesanan yang sudah melekat di Jadwal tersebut (data yang sudah ada di sistem — dihitung dari `SalesOrderDetail`, sama seperti yang dipakai Papan Pengiriman hari ini), tidak dicatat ulang.

### Modul Dashboard `/mkesindo/produksi`

Murni untuk **melihat** (siapa pun dengan akun Produksi) — semua aksi pencatatan dilakukan lewat produksi-app.

- **Peta Warehouse** — grid 12 pallet sesuai denah nyata (lihat bagian Denah Warehouse), warna menandakan usia stok untuk panduan FIFO (merah = paling lama, kuning = menengah, hijau = baru, abu-abu = kosong). Klik pallet untuk detail (mesin, tanggal produksi, sisa kantong 10kg/5kg).
- **Panel 3 Mesin** — kartu info per mesin: kapasitas produksi, konsumsi listrik, lama produksi, lama pengemasan.
- **Riwayat Produksi** — daftar semua pencatatan produksi (tanggal, mesin, posisi pallet, jumlah awal, sisa), bisa dilihat per mesin/per tanggal.

### Denah Warehouse

Denah berorientasi potret (walau bangunan warehouse sendiri landscape — hanya 2 kolom paling kanan yang dipakai untuk pallet). Dari kiri (dalam) ke kanan (Tembok luar):

```
[Tembok Dalam] [Jalan] [Kolom C/D] [Kolom A/B] [Tembok Luar — 3 Jendela distribusi]
```

Susunan dari atas ke bawah:

```
|-------------------------------------------------|
|                                     1C 1A Tembok |
|   Jalan & tempat berdiri staf — Jendela 1        |
|                                     1D 1B Tembok |
|                                     2C 2A Tembok |
|   Jalan & tempat berdiri staf — Jendela 2        |
|                                     2D 2B Tembok |
|                                     3C 3A Tembok |
|   Jalan & tempat berdiri staf — Jendela 3        |
|                                     3D 3B Tembok |
|                          Jalan                   |
|--------------------------------- Pintu Geser ----|
```

- **Kolom A/B**: menempel Tembok luar (kanan). **Kolom C/D**: satu baris ke arah dalam warehouse.
- **Jendela** (1, 2, 3): bukaan di Tembok luar tempat truk merapat langsung dari luar untuk bongkar/muat es dari 4 pallet di sekitarnya (misal Jendela 1 → pallet 1A, 1B, 1C, 1D). Digambar menonjol ke arah Tembok luar (kanan) di peta.
- **Jalan**: jalur staf/forklift di sisi Tembok Dalam (kiri), sepanjang kolom C/D.
- **Pintu Geser**: akses utama masuknya hasil produksi baru dari area produksi ke warehouse, di ujung bawah denah.
- Total **12 posisi pallet tetap** (3 Jendela × 4 posisi: A, B, C, D) — jumlahnya tidak bertambah/berkurang.

### Produksi-App (`/mkesindo/produksi-app`)

Struktur tab (keep-alive shell, pola sama seperti `driver-app`):

1. **Kartu Pengiriman** (tab utama) — daftar Kartu Pengiriman berstatus Draft yang siap dimuat. Tap satu → lihat jumlah kebutuhan (dari pesanan yang sudah ada), pilih pallet (disorot berdasarkan usia — FIFO), untuk tiap pallet terpilih tampilkan sisa stoknya (default "ambil semua sisa", bisa diubah ke sebagian). Tombol konfirmasi nonaktif sampai total yang dialokasikan mencukupi kebutuhan Jadwal. Konfirmasi memicu `produksiMulaiMuatAction` (lihat Integrasi ke Alur Jadwal).
2. **Produksi Baru** — form catat hasil produksi: pilih mesin (3 pilihan), isi jumlah kantong 10kg/5kg, pilih posisi pallet kosong dari peta (staf yang memilih sendiri, sistem tidak menaruh otomatis), simpan.
3. **Warehouse** — peta yang sama seperti di dashboard, versi mobile, untuk referensi cepat di lapangan (read-only, tanpa aksi pencatatan langsung dari sini).
4. **Profil** — info akun + logout, sama seperti `driver-app`/`satpam-app`.

### Integrasi ke Alur Jadwal yang Sudah Ada

Fungsi `startMuatAction` yang sudah ada (di `src/app/mkesindo/(dashboard)/delivery/actions.ts`) **tidak diubah sama sekali** — signature dan perilakunya tetap persis seperti sekarang.

Aksi baru `produksiMulaiMuatAction` (file terpisah, sisi produksi-app) melakukan, dalam satu transaksi database:
1. Validasi total kantong yang dialokasikan dari pallet-pallet terpilih mencukupi kebutuhan Jadwal.
2. Catat baris baru di `DashboardProduksiMuatanDetail` untuk tiap pallet yang dipakai.
3. Kurangi `SisaQty10KG`/`SisaQty5KG` pada `DashboardProduksiBatch` terkait; kosongkan `BatchIDAktif` di `DashboardProduksiPalletPosisi` untuk batch yang sisanya mencapai 0.
4. Panggil `startMuatAction` yang sudah ada (tidak diubah) untuk mengubah status Jadwal — persis seperti alur lama.

Satu-satunya perubahan ke kode dashboard yang sudah ada: tombol "Mulai Muat" di Papan Pengiriman **dihapus/disembunyikan**, karena pemicunya sekarang eksklusif dari produksi-app. Tidak ada logika status Jadwal yang diubah, hanya titik pemicunya yang berpindah.

"Selesai Muat" (`selesaiMuatAction`) dan langkah-langkah setelahnya (konfirmasi berangkat, dst.) **tidak berubah** — tetap berjalan seperti sekarang.

## Di Luar Cakupan

- Detail shift kerja Kepala Produksi & Staf Produksi — dibahas terpisah nanti.
- Pembedaan hak akses Kepala vs Staf Produksi — untuk tahap ini satu peran, akses identik.
- Pemantauan mesin secara live/real-time (sensor dsb.) — data mesin murni referensi tetap yang dikaitkan manual per pencatatan produksi, bukan telemetri.
- FIFO otomatis tanpa pilihan staf — FIFO di sini adalah panduan visual (penyorotan pallet tertua); staf yang selalu melakukan klik/pilih akhir, baik saat menaruh produksi baru maupun saat mengambil untuk muatan.

## Catatan Rencana ke Depan (bukan bagian dari pekerjaan ini)

- **Fitur "batalkan Isi Muatan"**: saat dibangun nanti, harus mengembalikan stok ke pallet asal (menambah kembali `SisaQty10KG`/`SisaQty5KG` pada batch terkait sesuai baris di `DashboardProduksiMuatanDetail` yang dibatalkan, dan mengembalikan `BatchIDAktif` di `DashboardProduksiPalletPosisi` jika posisi itu sudah terlanjur kosong). Ini murni catatan arah — tidak diimplementasikan dalam pekerjaan ini.
