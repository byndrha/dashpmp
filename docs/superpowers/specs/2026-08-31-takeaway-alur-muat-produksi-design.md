# TakeAway: Alur Mulai Muat / Selesai Muat di Produksi-App

## Latar belakang

Order TakeAway ("Ambil Sendiri", SalesmanID `0127`) saat ini dibuat lewat `createTakeAwayPemesanan` (`src/lib/queries/takeaway.ts`) yang langsung membuat SalesOrder, DeliveryOrder, dan SalesInvoice dalam satu langkah, lalu SI langsung di-enqueue ke antrian cetak (`createTakeAwayPemesananAction`, `src/app/mkesindo/(dashboard)/pemesanan/actions.ts:44-53`). TakeAway tidak pernah menyentuh Jadwal/Armada, tidak tampil di `/mkesindo/produksi-app`, dan tidak ikut terhitung di laporan hasil produksi manapun.

Pengiriman non-TakeAway (bertruk) sebaliknya baru membuat DeliveryOrder+SalesInvoice pada saat "Selesai Muat" (`produksiSelesaiMuat` -> `selesaiMuat`, `src/lib/queries/produksi-muatan.ts` & `pengiriman-jadwal.ts`), setelah melalui dua langkah: "Mulai Muat" (stempel `JamMulaiMuat`) lalu pengisian qty (10kg lewat alokasi pallet FIFO, 5kg lewat input manual `Qty5KGDimuat` tanpa FIFO). Angka 5kg ini yang menjadi salah satu sumber laporan hasil produksi (`getQtyRecapForShift`, `src/lib/queries/aktivitas-produksi.ts:312-350`), dihitung sebagai kantong-ekivalen (`total10KG + total5KG / 2`).

Pemilik produk meminta TakeAway mengikuti pola yang sama: harus "Mulai Muat" dahulu, lalu pengisian manual di produksi-app oleh Kepala Produksi (akun `isProduksi=true`), lalu "Selesai Muat" — baru setelah itu Staf Operasional (akun `isOperasional=true`, atau siapa pun yang mengoperasikan `/mkesindo/pemesanan`) mengambil Struk SI yang sudah tercetak. Tujuannya: TakeAway 10kg (dan 5kg) ikut terakumulasi di laporan hasil produksi, sama seperti 5kg pada pengiriman bertruk, tanpa menggunakan mekanisme stok es FIFO.

"Kepala Produksi" dan "Staf Operasional" bukan konsep baru — keduanya sudah ada sebagai flag peran di direktori akun Postgres (`is_produksi`, `is_operasional`; lihat `getProduksiAkunOptions`/`getStafOperasionalOptions` di `src/lib/queries/akun.ts`) dan sudah dipakai di modul Tim Produksi & Aktivitas Produksi. Tidak ada peran baru yang perlu dibuat untuk fitur ini.

## Tujuan

- Order TakeAway tidak lagi langsung membuat DeliveryOrder/SalesInvoice/print job saat dibuat — hanya SalesOrder.
- Kepala Produksi (akun `isProduksi`) melakukan "Mulai Muat" lalu "Selesai Muat" untuk tiap order TakeAway lewat `/mkesindo/produksi-app`, mirroring alur non-TakeAway.
- DeliveryOrder+SalesInvoice+print job baru dibuat saat "Selesai Muat", bukan saat order dibuat.
- Qty TakeAway (5kg maupun 10kg) ikut terakumulasi ke laporan hasil produksi (`getQtyRecapForShift`), dikonversi ke kantong-ekivalen dengan rumus yang sama seperti sekarang.
- TakeAway 10kg tidak memakai mekanisme stok es FIFO — sama seperti 5kg pada pengiriman bertruk, dicatat manual.

## Non-tujuan

- Tidak mengubah cara pemesanan TakeAway dibuat di `/mkesindo/pemesanan` (form, variant, qty, bonus tetap sama) — yang berubah hanya apa yang terjadi *setelah* SO dibuat.
- Tidak menyentuh `src/components/produksi-app/warehouse-view.tsx` sama sekali (batasan berdiri sejak sesi sebelumnya — file itu sedang dikerjakan terpisah oleh pemilik produk).
- Tidak menyentuh alur non-TakeAway (`DashboardPengirimanJadwal`, `selesaiMuat`, `KartuPengirimanList`) sama sekali — TakeAway mendapat jalur & tabel sendiri, tidak menumpang jalur Jadwal berarmada yang penuh validasi driver/rute/kapasitas yang tidak relevan untuknya.
- Tidak memperkenalkan konsep pemuatan sebagian (partial fulfillment) — qty yang dimuat selalu sama dengan qty yang dipesan (lihat bagian "Qty saat Selesai Muat" di bawah).
- Tidak menambah peran/permission baru — memakai flag `isProduksi`/`isOperasional` yang sudah ada.

## Model data: tabel baru `DashboardTakeAwayMuatan`

Satu baris per SalesOrder TakeAway, dibuat bersamaan dengan SO itu sendiri (Draft), bukan per-batch/pallet:

```sql
CREATE TABLE DashboardTakeAwayMuatan (
  TakeAwayMuatanID  INT IDENTITY PRIMARY KEY,
  SalesOrderID      VARCHAR(16) NOT NULL UNIQUE,
  Variant           VARCHAR(8) NOT NULL,       -- '5kg' | '10kg', sama dengan KantongVariant
  QtyDipesan        INT NOT NULL,               -- qtyKantong asli dari order (tidak termasuk bonus)
  JamMulaiMuat      DATETIME NULL,              -- true-UTC, sama konvensi dengan DashboardPengirimanJadwal.JamMulaiMuat
  JamSelesaiMuat    DATETIME NULL,              -- true-UTC
  QtyDimuat         INT NULL,                   -- diisi saat Selesai Muat, selalu = QtyDipesan (lihat bagian di bawah)
  DicatatOlehAkunID INT NULL,                   -- akun Kepala Produksi yang menekan Selesai Muat
  DeliveryOrderID   VARCHAR(16) NULL,           -- diisi setelah dokumen dibuat di Selesai Muat
  SalesInvoiceID    VARCHAR(16) NULL,
  IsDeleted         BIT NOT NULL DEFAULT 0,
  CreatedDate       DATETIME NOT NULL DEFAULT GETDATE()
)
```

Status tersirat dari kolom timestamp, tidak ada kolom Status terpisah:
- `JamMulaiMuat IS NULL` → menunggu diproses ("Draft", belum dimulai)
- `JamMulaiMuat IS NOT NULL AND JamSelesaiMuat IS NULL` → sedang dimuat
- `JamSelesaiMuat IS NOT NULL` → selesai (DO/SI sudah ada)

Dibuat lewat script one-off idempoten mengikuti pola yang sudah ada di `scripts/create-print-queue-table.ts` (`IF NOT EXISTS ... CREATE TABLE`, dijalankan manual sekali via `npx tsx`), bukan migration framework — konsisten dengan setiap tabel `Dashboard*` lain di repo ini.

## Alur & urutan pembuatan dokumen

**1. Pembuatan order (tidak berubah di sisi form, berubah di sisi backend):**

`createTakeAwayPemesanan` (`takeaway.ts`) dipangkas drastis — hanya membuat SalesOrder (kode yang sudah ada, `createSalesOrderManual`) lalu insert satu baris `DashboardTakeAwayMuatan` (`JamMulaiMuat`/`JamSelesaiMuat`/`QtyDimuat` semua NULL). Seluruh blok pembuatan DeliveryOrder+DeliveryOrderDetail+SalesInvoice+SalesInvoiceDetail (baris 121-250 saat ini) **dipindahkan**, bukan dihapus — akan dipakai lagi persis di langkah Selesai Muat (langkah 4 di bawah), dengan sedikit penyesuaian: dipanggil dari fungsi baru, bukan dari `createTakeAwayPemesanan`.

`createTakeAwayPemesananAction` tidak lagi memanggil `enqueuePrintJob` sama sekali — itu berpindah ke langkah 4.

**2. Menunggu diproses (produksi-app):**

Kepala Produksi (akun `isProduksi`) membuka `/mkesindo/produksi-app`, tab "Stok Es" (`warehouse`), melihat daftar order TakeAway yang `JamMulaiMuat IS NULL`, dalam komponen baru sejajar dengan `KartuPengirimanList` (lihat bagian UI di bawah).

**3. Mulai Muat:**

Kepala Produksi menekan "Mulai Muat" pada satu kartu order TakeAway → stempel `JamMulaiMuat = GETDATE()` (true-UTC, sama seperti `startMuat` yang sudah ada untuk Jadwal biasa). Tidak ada validasi driver/rute/kapasitas (tidak relevan untuk TakeAway) — hanya guard sederhana: baris harus `IsDeleted = 0` dan `JamMulaiMuat IS NULL` (mencegah klik dobel).

**4. Isi qty & Selesai Muat:**

Layar berikutnya menampilkan qty yang dipesan (`QtyDipesan`, dari kolom yang sama, bukan input bebas — lihat "Qty saat Selesai Muat" di bawah) dan tombol "Selesai Muat". Menekannya memicu, dalam satu transaksi:
- `UPDATE DashboardTakeAwayMuatan SET JamSelesaiMuat = GETDATE(), QtyDimuat = QtyDipesan, DicatatOlehAkunID = @akunId`
- Membuat DeliveryOrder+DeliveryOrderDetail+SalesInvoice+SalesInvoiceDetail — logika yang sama persis yang dipindahkan dari `createTakeAwayPemesanan` (langkah 1), memakai `TransDate = getNaiveWibTransDate()` seperti sekarang.
- `UPDATE DashboardTakeAwayMuatan SET DeliveryOrderID = ..., SalesInvoiceID = ...`
- `UPDATE SalesOrder SET IsClosed = 1, IsInvoiced = 1 ...` / `UPDATE DeliveryOrder SET IsClosed = 1, IsInvoiced = 1 ...` (persis seperti sekarang)

Setelah transaksi commit, `enqueuePrintJob(pool, salesInvoiceId, null, false)` dipanggil — persis seperti pemanggilan yang sekarang ada di `createTakeAwayPemesananAction`, hanya waktunya bergeser ke sini.

**5. Pengambilan struk (langkah fisik, tanpa kode baru):**

Print-queue poller yang sudah ada mencetak SI begitu di-enqueue. "Staf Operasional mengambil Struk SI yang telah tercetak" adalah langkah fisik di lapangan (menyerahkan barang + struk ke pelanggan) — tidak memerlukan halaman/aksi baru, karena mekanisme cetak & antrian sudah otomatis seperti pada alur non-TakeAway.

### Qty saat Selesai Muat

Berbeda dari 5kg pada pengiriman bertruk (yang memang angka manual bebas karena satu Jadwal mengagregasi banyak SO sekaligus), TakeAway adalah 1 order = 1 pengambilan langsung — qty yang dimuat **selalu sama** dengan qty yang dipesan (`QtyDipesan`). Layar Selesai Muat menampilkan angka ini sebagai konfirmasi (bukan field angka yang bisa diketik bebas), supaya tidak membuka celah SI dan yang benar-benar diserahkan ke pelanggan menjadi berbeda tanpa proses koreksi order yang jelas. Jika ke depan ada kebutuhan koreksi qty, itu koreksi pada SO (lewat `updateSalesOrderDetailQty` yang sudah ada, sebelum Mulai Muat), bukan lewat langkah Selesai Muat ini.

## UI

Komponen baru `TakeAwayMuatanList` (`src/components/produksi-app/`), dirender sejajar dengan `KartuPengirimanList` di dalam tab "Stok Es" milik `produksi-tab-shell.tsx` (baris ~320-349) — **tidak menyentuh** `warehouse-view.tsx`. Pola kartu & dialog mengikuti `kartu-pengiriman-list.tsx` yang sudah ada (kartu → tombol Mulai Muat → dialog konfirmasi qty & Selesai Muat), disederhanakan karena tidak ada pemilihan pallet/alokasi 10kg.

Berbeda dari Jadwal bertruk (yang dijadwalkan jauh ke depan sehingga perlu pemisahan periode hari-ini vs backlog), TakeAway dibuat dan diambil dalam kunjungan yang sama — tidak ada dinamika "backlog terjadwal". Daftar cukup dua bagian sederhana, tanpa pemisahan periode:
- **Menunggu/Sedang Dimuat**: `JamSelesaiMuat IS NULL` (mencakup baik yang belum maupun yang sudah Mulai Muat — sama seperti pola `getAllDraftJadwalForProduksi` yang menampilkan Draft apa pun status `JamMulaiMuat`-nya).
- **Baru Selesai**: `JamSelesaiMuat IS NOT NULL`, dibatasi N terbaru (mis. 50, mengikuti pola `TOP (100)` pada `fetchRecentSelesaiMuatJadwalForProduksi`) — sekadar agar operator bisa melihat apa yang baru saja diselesaikan tanpa harus pindah tab.

## Integrasi laporan produksi

`getQtyRecapForShift` (`aktivitas-produksi.ts:312-350`) ditambah satu query baru: menjumlah `DashboardTakeAwayMuatan.QtyDimuat` per varian (5kg/10kg) untuk baris dengan `JamSelesaiMuat` jatuh dalam window shift yang sama (dikonversi UTC dengan cara yang sama seperti window Jadwal yang sudah ada di fungsi ini). Hasilnya digabung ke total kantong-ekivalen yang sudah ada (`total10KG + total5KG / 2`), sehingga TakeAway tidak menjadi kategori laporan terpisah — murni menambah angka ke total yang sudah ada.

## Error handling & edge case

- **Order TakeAway dibatalkan sebelum Mulai Muat**: `deletePemesanan`/pembatalan SO TakeAway (jika ada jalurnya) harus ikut men-soft-delete baris `DashboardTakeAwayMuatan` terkait (`IsDeleted = 1`), supaya tidak nongol selamanya di daftar menunggu produksi-app.
- **Mulai Muat diklik dobel (race)**: guard `JamMulaiMuat IS NULL` di klausa WHERE UPDATE (pola atomic-claim yang sama seperti `claimPrintQueueJob`), bukan cek-lalu-update terpisah.
- **Selesai Muat gagal di tengah jalan** (mis. gagal insert SalesInvoiceDetail): rollback transaksi seperti pola `try/catch` yang sudah ada di `createTakeAwayPemesanan` saat ini (soft-delete SI/DO parsial, `JamSelesaiMuat` tetap NULL sehingga bisa dicoba ulang).
- **Order lama (sebelum fitur ini dirilis)**: tidak ada TakeAway yang sedang "in-flight" menunggu DO/SI karena pola lama selalu selesai dalam satu langkah — tidak perlu migrasi data historis.

## Testing

- Unit/manual test: buat order TakeAway → pastikan tidak ada DO/SI/print-job yang muncul sebelum Selesai Muat.
- Mulai Muat → Selesai Muat lewat produksi-app → pastikan DO/SI muncul dengan qty & TransDate benar, print job ter-enqueue dengan `JadwalID = NULL`.
- `getQtyRecapForShift` untuk shift yang mengandung TakeAway yang baru Selesai Muat → pastikan angka kantong-ekivalen bertambah sesuai varian.
- Order TakeAway dibatalkan sebelum Mulai Muat → tidak muncul di daftar produksi-app setelah dibatalkan.
