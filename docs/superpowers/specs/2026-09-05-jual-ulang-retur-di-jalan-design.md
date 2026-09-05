# Jual Ulang Es Retur di Rute Pengiriman — Design Spec

## Ringkasan

Aturan yang sudah ada di sistem ini melarang Pemesanan baru yang tumpang tindih dengan armada yang sedang Berangkat — aturan itu dibuat untuk mencegah tabrakan alokasi armada/rute, bukan untuk melarang transaksi apa pun terhadap muatan yang sedang berjalan. Masalahnya: ketika seorang mitra menolak menerima es (retur) di tengah rute, qty itu saat ini otomatis kembali sia-sia ke pabrik meskipun kondisinya masih baik (bukan rusak plastik/kualitas) dan ada mitra lain — baik yang memang ada dalam rute yang sama, maupun yang di luar rute, maupun pembeli retail tanpa akun di sistem — yang bersedia membelinya saat itu juga.

Fitur ini menambahkan jalur "Jual Ulang" untuk qty retur berkondisi baik, tanpa menyentuh gerbang anti-tabrakan Pemesanan yang sudah ada — armadanya sudah pasti sama (armada yang sedang membawa retur itu) dan sudah di jalan, jadi tidak ada konflik alokasi yang perlu dicegah.

## Istilah

- **Retur**: qty yang gagal diterima mitra tujuan asli, dicatat di `DashboardPengirimanStopDeliveryItem.QtyRetur` saat driver mengonfirmasi stop (`confirmStopDelivery`, `src/lib/queries/pengiriman-jadwal.ts`).
- **Kondisi Retur**: field baru, dipilih driver bersamaan dengan pencatatan retur — **Baik** (bisa dijual ulang) atau **Rusak** (kerusakan plastik/kualitas, tidak pernah bisa dijual ulang).
- **Jual Ulang**: transaksi yang menyalurkan sebagian atau seluruh sisa qty retur berkondisi Baik ke penerima lain, lewat salah satu dari 3 jalur di bawah.
- **Sisa tersedia**: `QtyRetur` baris StopDeliveryItem dikurangi total qty yang sudah terjual ulang dari baris itu (lihat tabel `DashboardPengirimanReturResale`).

## Model Data

### 1. `DashboardPengirimanStopDeliveryItem.KondisiRetur` (kolom baru)

`VARCHAR(10) NULL` — diisi `'BAIK'` atau `'RUSAK'` oleh driver di layar Konfirmasi Pengiriman, satu pilihan per item retur (field ini ditambahkan ke `StopDeliveryItemInput` dan alur INSERT yang sudah ada di `confirmStopDelivery`, baris ~3057-3070). `NULL` ketika `QtyRetur = 0` (tidak relevan — item itu tidak retur). `KeteranganRetur` (teks bebas, sudah ada) tetap ada sebagai catatan tambahan, tidak digantikan.

Hanya baris dengan `KondisiRetur = 'BAIK'` yang boleh muncul di UI Jual Ulang mana pun — validasi ini harus di server, bukan cuma disembunyikan di UI.

### 2. Tabel baru `DashboardPengirimanReturResale`

Satu baris per eksekusi Jual Ulang (satu baris StopDeliveryItem retur bisa punya banyak baris resale — terjual sebagian-sebagian ke penerima berbeda pada waktu berbeda).

| Kolom | Tipe | Keterangan |
|---|---|---|
| ResaleID | INT IDENTITY PK | |
| StopDeliveryItemID | INT NOT NULL FK -> DashboardPengirimanStopDeliveryItem | baris retur asal |
| Jalur | VARCHAR(20) NOT NULL | `'DALAM_RUTE'` \| `'LUAR_RUTE'` \| `'RETAIL'` |
| Qty | DECIMAL(23,4) NOT NULL | jumlah yang dijual ulang lewat baris resale ini |
| TargetSalesOrderDetailID | VARCHAR(16) NULL | jalur DALAM_RUTE: baris SO mitra tujuan yang qty-nya ditambah. NULL untuk jalur lain |
| SalesOrderID | VARCHAR(16) NULL | jalur LUAR_RUTE/RETAIL: SO baru yang diterbitkan. NULL untuk DALAM_RUTE (tidak ada SO baru) |
| LokasiLat | DECIMAL(10,7) NULL | hanya jalur RETAIL — titik yang diinput driver dari peta |
| LokasiLng | DECIMAL(10,7) NULL | hanya jalur RETAIL |
| DicatatOlehAkunID | INT NOT NULL | driver atau dispatcher yang mengeksekusi |
| DicatatVia | VARCHAR(10) NOT NULL | `'DRIVER'` \| `'DISPATCHER'` |
| CreatedDate | DATETIME NOT NULL DEFAULT GETDATE() | |

"Sisa tersedia" suatu baris StopDeliveryItem = `QtyRetur - ISNULL(SUM(DashboardPengirimanReturResale.Qty WHERE StopDeliveryItemID = ...), 0)`.

### 3. BusinessPartner "Retail Return" (baris seed tetap, dibuat sekali)

Satu `BusinessPartnerID` tetap dibuat lewat DDL seed (pola sama seperti `SalesmanID '0127'` untuk TakeAway — satu record generik dipakai berulang, bukan satu per transaksi). Dipakai untuk **setiap** transaksi jalur Retail, tidak eksklusif per lokasi — lokasi disimpan per-transaksi di `DashboardPengirimanReturResale.LokasiLat/LokasiLng`, bukan di data BusinessPartner, karena mitra generik ini memang tidak punya alamat tetap. `PriceLevel` BusinessPartner ini tidak relevan karena harga jalur Retail selalu fixed (lihat di bawah), tidak pernah mengacu Price Level.

## Logika Bisnis

### Kelayakan

Sisa qty retur suatu baris StopDeliveryItem hanya bisa ditawarkan/dijual ulang jika `KondisiRetur = 'BAIK'` **dan** sisa tersedia > 0. Retur `'RUSAK'` tidak pernah muncul di UI Jual Ulang jalur mana pun.

### Jalur (a) — Mitra dalam rute

Berlaku hanya untuk mitra yang punya stop **belum selesai** (`DashboardPengirimanStopDelivery.JamSelesai IS NULL`) di **Jadwal yang sama**. Tidak menerbitkan SO-DO-SI baru — hanya mengubah angka qty pada dokumen mitra itu yang sudah ada untuk hari ini:

1. Cari baris `SalesOrderDetail` milik SO mitra target dengan `ItemID` yang sama dengan item retur. Kalau ada: tambah `Qty`+`Amount` (dihitung dari `Price` baris itu sendiri, bukan Price Level saat ini — sama seperti `updateSalesOrderDetailQty` yang sudah ada). Kalau tidak ada (mitra itu belum pernah pesan item ini hari ini): insert baris `SalesOrderDetail` baru untuk item itu.
2. Cascade yang sama ke `DeliveryOrderDetail` (dicocokkan lewat `SalesOrderDetailID`, kolom yang memang sudah ada di situ — hanya `Qty`/`Delivered`, tidak ada header Amount di `DeliveryOrder` yang perlu direcompute, dikonfirmasi tidak ada satu pun `UPDATE DeliveryOrder SET Amount`/`Netto` di seluruh `pengiriman-jadwal.ts`, hanya `ModifiedDate` yang disentuh untuk konsistensi audit) — dan ke `SalesInvoiceDetail` **kalau SI mitra itu sudah terbit lebih dulu** (dicocokkan lewat korespondensi posisi DeliveryOrderDetail<->SalesInvoiceDetail yang sudah dipakai `confirmStopDelivery`, baris ~2895-2925 — SalesInvoiceDetail tidak punya kolom `SalesOrderDetailID` langsung, jadi tekniknya di-reuse persis, bukan ditulis ulang). Kalau item itu belum ada baris SalesInvoiceDetail-nya, insert baru.
3. Recompute `Amount`/`Netto` header `SalesOrder` dan `SalesInvoice` (kalau sudah terbit) dari `SUM` baris detail masing-masing — pola yang sama seperti `updateSalesOrderDetailQty` dan `confirmStopDelivery`. `DeliveryOrder` sendiri hanya perlu `ModifiedDate` disentuh (lihat poin 2).
4. **Ditolak** (AppError) kalau stop target sudah `JamSelesai` (sudah dikonfirmasi selesai duluan) — pesan: "Stop mitra ini sudah selesai, tidak bisa ditambah qty dari sini."

Lalu (berlaku sama di jalur b dan c juga, lihat "Pengurangan SR" di bawah): kurangi `SalesReturnDetail` (dan header `SalesReturn`) sebesar qty yang ditransfer, dan insert satu baris `DashboardPengirimanReturResale` (`Jalur = 'DALAM_RUTE'`, `TargetSalesOrderDetailID` = baris SO mitra target).

### Jalur (b) — Mitra luar rute (mitra terdaftar, bukan bagian Jadwal ini)

Terbit `SalesOrder` + `DeliveryOrder` + `SalesInvoice` baru **sekaligus, atomik** — berbeda dari pola TakeAway yang sengaja menunda DO/SI ke langkah "Selesai Muat" terpisah (`createTakeAwayPemesanan`, `src/lib/queries/takeaway.ts`): di sini barangnya sudah fisik di atas truk dan diserahkan saat itu juga, tidak ada "Selesai Muat" susulan. `VehicleNo`/`ExpeditionID` pada DO baru ini = armada Jadwal yang sedang berjalan sekarang (bukan armada baru). Harga mengikuti Price Level mitra tujuan seperti pemesanan biasa.

Kurangi SR yang sama seperti jalur (a). Insert `DashboardPengirimanReturResale` (`Jalur = 'LUAR_RUTE'`, `SalesOrderID` = SO baru yang baru diterbitkan).

### Jalur (c) — Retail Return (non-mitra, tidak terdaftar di sistem)

Sama seperti jalur (b) — SO+DO+SI baru atomik, armada yang sama — tapi `BusinessPartnerID` = BusinessPartner "Retail Return" yang tetap (lihat Model Data #3), dan harga **fixed**, mengabaikan Price Level apa pun:

- Rp8.000 / kantong 10kg
- Rp6.000 / kantong 5kg

Driver **wajib** memilih titik lokasi lewat peta interaktif sebelum transaksi bisa disimpan — reuse pola click-to-move yang sudah ada di `MitraLocationMap` (`src/components/dashboard/mitra-location-map.tsx`, prop `onChange(lat, lng)`), bukan komponen baru. Lat/lng disimpan di `DashboardPengirimanReturResale.LokasiLat/LokasiLng` milik transaksi itu (bukan di BusinessPartner, karena "Retail Return" dipakai berulang untuk lokasi berbeda-beda setiap kali).

Kurangi SR yang sama seperti jalur (a)/(b). Insert `DashboardPengirimanReturResale` (`Jalur = 'RETAIL'`, `SalesOrderID` = SO baru).

### Pengurangan SalesReturn (berlaku di ketiga jalur)

Setiap kali sebagian qty retur berhasil dijual ulang lewat jalur mana pun, `SalesReturnDetail` yang sudah terbit dari mitra yang menolak tadi **dikurangi** sebesar qty yang berhasil dijual ulang itu:

1. Cari baris `SalesReturnDetail` lewat `SalesReturnID` (dari `DashboardPengirimanStopDelivery.SalesReturnID` milik stop retur itu) **dan** `SalesOrderDetailID` (dari `DashboardPengirimanStopDeliveryItem.SalesOrderDetailID`) — kombinasi ini sudah cukup unik untuk menunjuk baris yang tepat, tidak perlu teknik pencocokan posisi seperti SalesInvoiceDetail.
2. Kurangi `Qty`/`Amount`/`Netto`/`Value`/`Retur` baris itu sebesar qty yang ditransfer (dihitung dari `Price` baris itu sendiri).
3. Recompute header `SalesReturn.Amount`/`Netto` dari `SUM` `SalesReturnDetail` yang tersisa.

Alasan berlaku di ketiga jalur (dikonfirmasi user): makin sedikit es yang benar-benar kembali ke pabrik begitu sebagian terjual di jalan, jadi SR harus mencerminkan jumlah yang **benar-benar** kembali, bukan jumlah yang tadinya ditolak sebelum ada pembeli pengganti.

### Keamanan bersamaan (concurrency)

Driver (lewat driver-app) dan dispatcher (lewat Papan Pengiriman desktop) bisa sama-sama mencoba menjual dari pool retur yang sama nyaris bersamaan. Setiap eksekusi jalur (a)/(b)/(c) **wajib** membaca ulang "sisa tersedia" di dalam transaksi yang sama (bukan dari state yang sudah di-fetch sebelumnya) dan menolak (AppError, tanpa partial-fill otomatis) kalau qty yang diminta melebihi sisa saat itu — pola claim-guard yang sama seperti `isiAirBaru`/`setBabonan` (`src/lib/queries/produksi-bak-pmpersada.ts`) dan `confirmStopDelivery`'s sendiri claim UPDATE.

## UI

### Papan Pengiriman (desktop)

- Tanda seru merah di pojok kanan atas kartu Jadwal, muncul kalau ada sisa qty retur berkondisi Baik yang masih tersedia di mana pun dalam Jadwal itu.
- Saat kartu dibuka, tiap tujuan/stop menampilkan detail retur miliknya sendiri: item, qty, kondisi, dan sisa yang masih tersedia (kalau Baik dan sisa > 0).
- Pada baris retur yang masih punya sisa tersedia, tombol "Jual ke Mitra Lain" membuka form: pilih jalur (mitra dalam rute yang stop-nya belum selesai — daftar terbatas dari Jadwal ini sendiri / cari mitra lain lewat pencarian mitra biasa / Retail Return) → isi qty (divalidasi ≤ sisa tersedia) → (khusus Retail Return: titik lokasi wajib diisi dari peta) → konfirmasi.

### Driver-app

- Saat driver mengonfirmasi stop dan mencatat retur berkondisi Baik, langsung ada opsi: "Ada yang mau beli retur ini sekarang?" — form jalur yang sama, supaya driver bisa langsung catat kalau sudah ada peminat di tempat.
- Sisa retur yang belum terjual tetap terlihat & bisa dijual dari layar Jadwal driver-app di sepanjang sisa rute (bukan cuma sesaat setelah retur itu dicatat) — driver bisa saja baru ketemu peminat beberapa stop kemudian.

## Error Handling & Edge Case

- Retur berkondisi Rusak tidak pernah bisa dijual ulang di jalur mana pun — validasi server-side, bukan cuma disembunyikan di UI.
- Jalur (a) ditolak kalau stop target sudah `JamSelesai` — pesan: "Stop mitra ini sudah selesai, tidak bisa ditambah qty dari sini."
- Qty yang diminta melebihi sisa retur yang tersedia (termasuk akibat race 2 eksekusi bersamaan) → AppError, operator harus input ulang qty yang sesuai sisa saat itu — tidak ada partial-fill otomatis.
- Retail Return tanpa titik lokasi terisi → tombol submit disabled di UI, dan divalidasi lagi di server (lokasi wajib, bukan opsional).
- Item retur yang ItemID-nya belum pernah ada di SO mitra dalam-rute (jalur a) → insert baris baru di SalesOrderDetail/DeliveryOrderDetail/SalesInvoiceDetail, bukan gagal.
- Daftar target jalur (a) tidak pernah menyertakan mitra asal retur itu sendiri (stop yang sudah menolak barang itu tidak relevan sebagai tujuan Jual Ulang untuk retur miliknya sendiri).

## Arsitektur Komponen

### Query layer baru (kemungkinan `src/lib/queries/retur-resale.ts`)

- `getSisaReturTersedia(jadwalId)` — daftar baris StopDeliveryItem berkondisi Baik dengan sisa > 0, untuk satu Jadwal (dipakai badge + panel detail Papan Pengiriman & driver-app).
- `jualUlangDalamRute(stopDeliveryItemId, targetJadwalDetailId, qty, akunId, via)` — jalur (a), transaksi tunggal mencakup SO/DO/SI target + pengurangan SR + insert ReturResale.
- `jualUlangLuarRute(stopDeliveryItemId, businessPartnerId, qty, akunId, via)` — jalur (b), transaksi tunggal mencakup SO+DO+SI baru + pengurangan SR + insert ReturResale.
- `jualUlangRetail(stopDeliveryItemId, qty, lokasiLat, lokasiLng, akunId, via)` — jalur (c), sama seperti (b) dengan BusinessPartnerID "Retail Return" tetap + harga fixed.

### Server Actions

Ditambahkan di `src/lib/queries/pengiriman-jadwal.ts`'s pasangan actions (kemungkinan file actions Papan Pengiriman yang sudah ada) untuk desktop, dan di actions driver-app untuk mobile — keduanya memanggil query layer yang sama di atas, hanya beda gerbang akses (`requireProduksiView`-setara untuk desktop dashboard, gerbang driver untuk mobile).

### UI Components

- Badge tanda seru + panel detail retur per-stop: ditambahkan ke komponen kartu Jadwal Papan Pengiriman yang sudah ada (`src/components/dashboard/pengiriman-board.tsx`).
- Form "Jual ke Mitra Lain" (3 jalur): komponen dialog baru, reuse `MitraSelect`/pencarian mitra yang sudah ada (`pemesanan-form-dialog.tsx`) untuk jalur luar-rute, dan `MitraLocationMap` (click-to-move) untuk jalur Retail.
- Prompt "Ada yang mau beli retur ini sekarang?" + tampilan sisa retur sepanjang rute: ditambahkan ke layar konfirmasi stop driver-app yang sudah ada.

## Testing / Verifikasi

Tidak ada test runner di proyek ini (pola yang sudah mapan). Verifikasi: `npx tsc --noEmit` + `npx eslint` pada file yang berubah, lalu live click-through:

- Retur kondisi Rusak tidak pernah muncul di UI Jual Ulang mana pun.
- Jalur (a): qty mitra dalam-rute (SO/DO/SI-nya) bertambah benar, SR berkurang benar, stop yang sudah selesai ditolak.
- Jalur (b): SO+DO+SI baru muncul untuk mitra luar-rute dengan harga Price Level yang benar, armada sama dengan Jadwal berjalan, SR berkurang.
- Jalur (c): SO+DO+SI baru atas nama "Retail Return" dengan harga fixed 8000/6000, lokasi tersimpan benar, SR berkurang.
- Race: dua percobaan jual-ulang qty yang sisanya sudah tidak cukup → percobaan kedua ditolak dengan pesan yang jelas, tidak ada qty negatif di mana pun.
