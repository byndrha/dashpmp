# Varian Kualitas 5KG/10KG, Penautan TakeAway-FIFO, dan 3 Ikon Centang Validasi Tim

## Latar Belakang

Permintaan awal: tambahkan 3 ikon centang kecil (bulat) di pojok kanan-atas
tiap kotak huruf Tim pada kalender Jadwal Tim Produksi
(`jadwal-tim-bulanan.tsx`, `/mkesindo/produksi`), memvalidasi per
(TanggalUsaha, Shift):

1. Tim sudah memakai fitur **Input Panen & Cek Kualitas** dari tiap mesin.
2. Tim sudah memakai fitur **Input Stok ke Pallet**.
3. Tim sudah memakai fitur **Mulai Muat** (pengurangan stok pallet ke armada
   logistik).

Selama brainstorming, dua prasyarat besar ditemukan yang harus dibereskan
lebih dulu:

- Centang 2 butuh tahu berapa hasil panen yang **seharusnya** masuk pallet
  vs yang dikecualikan (dijual langsung lewat TakeAway) — tapi
  `DashboardProduksiKualitas` belum membedakan varian 5KG/10KG sama sekali,
  padahal **varian 5KG tidak pernah masuk pallet**.
- Fitur TakeAway (`takeaway-muatan.ts`) saat ini **sama sekali tidak
  terhubung** ke data Kualitas/Batch — TakeAway murni membuat
  SalesOrder→DeliveryOrder→SalesInvoice tanpa mencatat stok itu diambil dari
  mana. Supaya centang 2 akurat, TakeAway harus mengurangi stok yang tepat
  (Kualitas belum-dipallet dulu, baru Pallet) saat Selesai Muat.

Spec ini jadi satu paket karena ketiganya saling bergantung: Varian Kualitas
adalah fondasi, TakeAway-FIFO baru bisa benar setelah Varian ada, dan 3 ikon
centang adalah konsumen akhir dari keduanya.

## Cakupan (Global Constraints)

- Semua UI berbahasa Indonesia, mengikuti konvensi copy yang sudah ada.
- Konversi 5KG→10KG-ekivalen selalu `qty / 2.0`, sama seperti konvensi
  `CASE WHEN Name LIKE '%5 KG%' THEN qty/2.0 ELSE qty END` yang sudah dipakai
  di seluruh modul produksi/korelasi lain — dipakai HANYA untuk tampilan
  angka gabungan, tidak pernah untuk menyimpan data mentah (data mentah
  selalu jumlah kantong asli sesuai variannya sendiri).
- Data historis (`DashboardProduksiKualitas` sebelum kolom `Variant` ada)
  diperlakukan sebagai `'10KG'`.
- Tidak ada task ini yang mengubah alur "Selesai Muat" untuk Jadwal
  Pengiriman armada biasa (`produksiSelesaiMuat`) — itu tetap manual
  (staf memilih pallet sendiri via UI), tidak disentuh.

---

## Bagian 1 — Varian Kualitas (5KG/10KG)

### Skema

`DashboardProduksiKualitas` mendapat kolom baru:

```sql
ALTER TABLE DashboardProduksiKualitas
  ADD Variant VARCHAR(8) NOT NULL CONSTRAINT DF_DashboardProduksiKualitas_Variant DEFAULT '10KG';
```

Nilai yang valid: `'10KG'` | `'5KG'`. `DEFAULT '10KG'` sekaligus jadi
backfill otomatis untuk semua baris lama saat `ALTER TABLE` dijalankan
(tidak perlu `UPDATE` terpisah).

`Qty10KG` pada baris `Variant='5KG'` tetap berarti **jumlah kantong 5KG
asli** (bukan sudah dikonversi) — nama kolom historis, tidak diganti,
supaya tidak mengubah semua query yang sudah membaca kolom ini. Konversi ke
ekivalen 10KG dilakukan di lapisan tampilan/agregasi (lihat Bagian 2), sama
seperti konvensi 5KG di modul lain.

### Form Input (produksi-app, tab Kualitas)

`kualitas-view.tsx` (form submit) mendapat satu field baru: pilihan Varian
(`10KG` / `5KG`), default `10KG`. Satu entri pemeriksaan = satu varian
(tidak ada input campuran dua varian dalam satu entri). `createKualitasAction`
dan `createKualitas` (produksi-kualitas.ts) meneruskan `variant` ini ke
INSERT.

### Aturan bisnis turunan

- Entri `Variant='5KG'` **tidak pernah** boleh dialokasikan ke pallet (tidak
  muncul sebagai opsi di alur "Tambah Produksi"/Input Stok ke Pallet, yang
  sudah memfilter berdasar `KualitasID` — cukup filter tambahan
  `Variant='10KG'` di titik itu).
- `SisaAlokasi` untuk entri `Variant='5KG'` dihitung dari
  `Qty10KG - SUM(TakeAwayAlokasi terhubung)` saja (tidak ada Batch yang bisa
  terhubung ke entri 5KG sama sekali, by design).

---

## Bagian 2 — Tampilan Split Varian + Gabungan

Tiga lokasi yang perlu menampilkan pemisahan **10KG / 5KG / Gabungan
(10KG + 5KG÷2)**:

1. **Panel Korelasi Produksi-Penjualan** (`korelasi-produksi-penjualan-panel.tsx`)
   — kotak ringkasan atas ("Produksi") dan tabel Metrik/Shift bawah ("Produksi"
   per shift) masing-masing dipecah jadi 3 angka. `getKorelasiProduksiPenjualan`
   (produksi-korelasi-penjualan.ts) perlu query `Qty10KG` terpisah per
   `Variant` dari `DashboardProduksiBatch` — TAPI `DashboardProduksiBatch`
   tidak punya kolom Variant sendiri (batch selalu 10KG, karena 5KG tidak
   pernah masuk pallet). Jadi "Total Produksi" versi lama (dari
   `getQtyRecapForShift`, yang menjumlahkan `DashboardProduksiBatch.Qty10KG`)
   TETAP sepenuhnya varian 10KG apa adanya — yang baru ditambahkan adalah
   angka 5KG, diambil terpisah dari `DashboardProduksiKualitas` (bukan
   Batch) yang `Variant='5KG'` pada shift yang sama. Gabungan = Produksi 10KG
   (dari Batch, seperti sekarang) + (Kualitas 5KG shift itu ÷ 2).
2. **Riwayat Produksi** (`riwayat-shift-group-card.tsx`) — tiap baris entri
   Kualitas menampilkan label variannya (badge kecil "10KG"/"5KG"), dan
   statistik header grup (Stok Awal/Produksi/Masuk Pallet/dst) menambahkan
   baris kedua khusus varian 5KG + baris Gabungan.
3. **Ringkasan per kotak tanggal** (toggle di kalender Jadwal Tim Produksi,
   `jadwal-tim-bulanan.tsx`) — baris "Produksi" yang sudah ada dipecah jadi
   3 baris (10KG / 5KG / Gabungan), field lain (Terkirim, Retur, dst — yang
   sumbernya DeliveryOrder/SalesReturn, bukan Kualitas) tidak berubah karena
   sudah otomatis memakai konvensi konversi 5KG yang sama.

---

## Bagian 3 — Penautan TakeAway → Kualitas/Pallet (FIFO)

### Tabel baru: `DashboardTakeAwayAlokasi`

```sql
CREATE TABLE DashboardTakeAwayAlokasi (
  TakeAwayAlokasiID INT IDENTITY PRIMARY KEY,
  TakeAwayMuatanID INT NOT NULL REFERENCES DashboardTakeAwayMuatan(TakeAwayMuatanID),
  SumberTipe VARCHAR(10) NOT NULL, -- 'KUALITAS' | 'BATCH'
  KualitasID INT NULL REFERENCES DashboardProduksiKualitas(KualitasID),
  BatchID INT NULL REFERENCES DashboardProduksiBatch(BatchID),
  Qty INT NOT NULL, -- jumlah kantong ASLI (sesuai varian sumbernya, bukan hasil konversi)
  CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
);
```

Satu `TakeAwayMuatanID` bisa punya BEBERAPA baris di sini (kalau stoknya
terpecah dari beberapa entri Kualitas dan/atau beberapa pallet).

### Alur pengurangan stok — dipanggil dari `takeAwaySelesaiMuat`

Ditempatkan **sebelum** blok pembuatan DeliveryOrder/SalesInvoice yang sudah
ada di `takeAwaySelesaiMuat` (takeaway-muatan.ts), di dalam transaksi SQL
yang sama supaya atomic (kalau alokasi gagal, tidak ada DO/SI yang
terlanjur dibuat).

Fungsi baru `allocateTakeAwayStock(transaction, takeAwayMuatanId, variant, qtyDibutuhkan)`:

1. **Sumber 1 — Kualitas varian yang SAMA, belum dipallet, TERBARU dulu**
   (`ORDER BY TanggalLabel DESC, Waktu DESC`): kurangi `qtyDibutuhkan` dari
   `SisaAlokasi` tiap baris Kualitas (varian sama dengan TakeAway ini) satu
   per satu sampai `qtyDibutuhkan` habis atau baris habis. `SisaAlokasi`
   dihitung ulang di sini dengan lock (`WITH (UPDLOCK, HOLDLOCK)` pada baris
   Kualitas yang disentuh, dan pada `DashboardProduksiBatch`/
   `DashboardTakeAwayAlokasi` yang menjadi bagian perhitungan sisa) supaya
   dua TakeAway konkuren tidak bisa berebut sisa yang sama — pola sama
   dengan lock di `createBatch` (produksi-warehouse.ts).
2. **Sumber 2 — HANYA untuk varian 10KG, kalau masih kurang: Pallet
   (`DashboardProduksiBatch`), TERTUA dulu** (`ORDER BY TanggalLabel ASC,
   JamPanen ASC`, filter `IsDeleted=0 AND SisaQty10KG > 0`): klaim atomik
   sama seperti `produksiSelesaiMuat` (`UPDATE ... SET SisaQty10KG =
   SisaQty10KG - @qty ... WHERE SisaQty10KG >= @qty`), bisa menyentuh lebih
   dari satu pallet berturut-turut sampai `qtyDibutuhkan` habis. **Varian
   5KG TIDAK PERNAH sampai ke langkah ini** (pallet tidak pernah berisi 5KG
   — kalau Sumber 1 tidak cukup untuk TakeAway 5KG, langsung ke langkah 3).
3. **Kalau `qtyDibutuhkan` masih > 0 setelah kedua sumber di atas (atau
   setelah Sumber 1 saja untuk varian 5KG)**: `throw new AppError("Stok
   tidak cukup untuk menyelesaikan TakeAway ini.")` — transaksi rollback,
   DO/SI tidak jadi dibuat, `JamSelesaiMuat` tidak ter-set (staf bisa coba
   lagi nanti setelah ada stok baru).
4. Kalau cukup: tulis satu baris `DashboardTakeAwayAlokasi` per sumber yang
   disentuh (bisa beberapa baris), lalu lanjut ke pembuatan DO/SI seperti
   alur `takeAwaySelesaiMuat` yang sudah ada.

### Dampak pada perhitungan `SisaAlokasi`/`SisaBelumDialokasikan`

Baik `getKualitasRiwayat` (produksi-kualitas.ts) maupun
`getRiwayatProduksiDetail` (produksi-riwayat-detail.ts) yang sekarang
menghitung sisa hanya dari `SUM(DashboardProduksiBatch.Qty10KG WHERE
KualitasID=...)`, ditambah `SUM(DashboardTakeAwayAlokasi.Qty WHERE
KualitasID=... AND SumberTipe='KUALITAS')` — total keduanya yang dikurangkan
dari `Qty10KG` milik Kualitas itu.

---

## Bagian 4 — Tiga Ikon Centang di Kalender Jadwal Tim Produksi

Fungsi baru `getValidasiBulan(tahun, bulan): Record<string, {kualitas: boolean; pallet: boolean; muatan: boolean}>` (key = `"TanggalUsaha|Shift"`, mis. `"2026-09-18|1"`), dihitung SELALU tampil (bukan toggle opt-in seperti Ringkasan Korelasi) — beban query-nya jauh lebih ringan daripada `getKorelasiRingkasanBulan` karena murni COUNT/EXISTS per hari (tidak ada rantai Stok Awal antar-shift), sehingga aman dimuat bersamaan dengan `getJadwalBulan` di `page.tsx` setiap kali bulan berganti.

- **Centang 1 (Kualitas)**: `true` kalau untuk SETIAP `DashboardProduksiMesin`
  berstatus `'AKTIF'`, ada minimal satu `DashboardProduksiKualitas` dengan
  `TanggalLabel=tanggalUsaha AND Shift=shift AND MesinID=mesin itu` (varian
  apa pun dihitung).
- **Centang 2 (Pallet)**: `true` kalau SEMUA `DashboardProduksiKualitas`
  dengan `TanggalLabel=tanggalUsaha AND Shift=shift AND Variant='10KG'`
  punya `SisaAlokasi = 0` (definisi `SisaAlokasi` sudah termasuk pengurang
  TakeAway dari Bagian 3). Kalau tidak ada entri 10KG sama sekali pada shift
  itu (atau semua entrinya legacy dengan `Qty10KG IS NULL` -- lihat komentar
  `SisaAlokasi` di produksi-kualitas.ts, tidak ada plafon untuk dihitung),
  dianggap `true` (tidak ada yang perlu dialokasikan — vacuously true,
  konsisten dengan "belum ada aktivitas" bukan "gagal").
- **Centang 3 (Muatan)**: `true` kalau ada minimal satu
  `DashboardPengirimanJadwal.JamSelesaiMuat` ATAU
  `DashboardTakeAwayMuatan.JamSelesaiMuat` yang jatuh dalam jendela waktu
  `getShiftWindow(tanggalUsaha, shift, "work")` (konversi UTC/naive sesuai
  kolom aslinya — `JamSelesaiMuat` Jadwal Pengiriman perlu dicek apakah
  true-UTC atau naive-WIB sebelum implementasi, ikuti pola yang sudah
  dipakai `getTotalDOForShift` untuk kolom sejenis).

Catatan: centang ini per-Tim, bukan per-shift-saja — karena tampil di
kotak huruf Tim yang mana pun terjadwal di shift itu (bisa beda Tim beda
hari via drag-drop). Karena Kualitas/Batch/Pengiriman TIDAK menyimpan
`TimID` langsung (hanya `TanggalLabel`+`Shift`), validasi ini sebenarnya
sama untuk SEMUA Tim yang kebetulan bertugas di (tanggalUsaha, shift) yang
sama — bukan dibedakan per-Tim secara individual (tidak ada cara membedakan
"Tim A yang input Kualitas ini" vs "Tim B" tanpa kolom TimID di Kualitas).
Jadi tiga centang ini murni menandai **kelengkapan shift**, ditampilkan di
badge Tim manapun yang mengisi slot shift itu — bukan validasi personal per
Tim.

### UI (Opsi A dari companion visual)

Di `TimBadge` (jadwal-tim-bulanan.tsx): 3 titik kecil (`~9px` diameter)
menumpuk rapat di pojok kanan-atas kotak huruf Tim (`size-7`, 28px),
sedikit menutupi tepi kotak, masing-masing dengan `box-shadow` cincin putih
tipis supaya kontras dari warna badge di baliknya. Hijau (`bg-emerald-600`)
= tervalidasi, abu-abu (`bg-muted-foreground/40`) = belum. Tiap titik punya
`title`/tooltip menjelaskan detailnya (mis. centang 1: "2 dari 3 mesin
sudah dicek: Msn 1, Msn 2 — Msn 3 belum"; centang 2: "Sisa 42 kantong 10kg
belum dipallet"; centang 3: "Belum ada Selesai Muat pada shift ini").

---

## Non-Goals

- Tidak mengubah alur manual "Selesai Muat" Jadwal Pengiriman armada biasa.
- Tidak membangun UI admin untuk melihat/mengedit `DashboardTakeAwayAlokasi`
  secara langsung — tabel ini murni audit trail, dibaca lewat agregasi.
- Tidak menambah validasi/centang baru selain 3 yang diminta.
