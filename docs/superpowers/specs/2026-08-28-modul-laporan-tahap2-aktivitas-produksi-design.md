# Modul Laporan — Tahap 2 (Aktivitas Produksi)

## Konteks

Sub-proyek kedua dari "Modul Laporan" (lihat
[Tahap 1's spec](2026-08-27-modul-laporan-stok-bahan-baku-design.md) untuk
fondasi cutoff-shift yang dipakai ulang di sini). Tahap 2 mencatat
aktivitas produksi per shift kerja: tim yang bertugas, status mesin,
rekap kuantitas produksi, kerusakan/denda, dan pembagian kontribusi per
anggota tim.

## Non-Goals

- Denda TIDAK masuk COA/Kas Kecil — murni angka rekap/laporan untuk
  sub-proyek ini (keputusan eksplisit, bisa jadi tahap terpisah nanti).
- Tidak ada breakdown per-mesin untuk Varian 5KG — hanya total shift,
  karena data sumbernya (`DashboardPengirimanJadwal.Qty5KGDimuat`) tidak
  pernah punya keterkaitan ke Mesin.
- Tidak mengubah cara Tim Produksi berotasi — dianggap 3 tim TETAP, satu
  per nomor shift (Tim Shift 1/2/3), bukan tim yang bisa dipindah-pindah
  ke shift lain.
- Tidak memperbaiki inkonsistensi kecil pre-existing antara
  `DashboardProduksiKualitas.TanggalLabel` (default dari
  `getBusinessDateISO()`, rollover 14:00) dan konvensi "work" shift
  Tahap 1 (rollover 15:00) — lihat catatan teknis di Bagian 4.

## Bagian 1: Peran Khusus baru — `isOperasional`

Berbeda dari cara Tahap 1 memberi akses (izin modul "Laporan" generik),
`isOperasional` di sini adalah **Peran Khusus** (boolean flag) mengikuti
pola `isDriver`/`isSatpam`/`isProduksi` PERSIS — dipakai untuk
identitas/pemilihan (dropdown "Nama Staf Operasional yang bertugas" di
Tahap 2), BUKAN untuk mengganti akses ke `/mkesindo/laporan` (itu tetap
lewat izin modul "Laporan" yang sudah ada, tidak berubah).

Perubahan (mengikuti [`isDriver`/`isProduksi` pattern](2026-08-27-modul-laporan-stok-bahan-baku-design.md) tepat, file:baris sama seperti draf awal Tahap 1 yang sempat dibatalkan — sekarang benar-benar dipakai):

1. Postgres: kolom baru `peran.is_operasional`.
2. `src/lib/queries/akun.ts`: `isOperasional` di `AkunRow`/query/`PeranRow`,
   fungsi `setPeranOperasional(peranId, isOperasional)`.
3. `src/lib/auth.ts` + `src/types/next-auth.d.ts`: tambah `isOperasional`
   ke `AuthorizedUser`/`Session.user`/`JWT`.
4. `src/lib/require-access.ts`: tidak perlu guard baru (tidak menggerbangi
   halaman apa pun) — hanya dipakai untuk query "akun mana saja yang
   isOperasional".
5. `src/components/dashboard/peran-editor.tsx` + `peran/actions.ts`:
   toggle "Peran Khusus: Staf Operasional" baru (mirror `isProduksi`).
6. Query baru `getStafOperasionalOptions(): Promise<{akunId: number; nama: string}[]>`
   (mirror [`getDriverOptions()`](../../../src/lib/queries/delivery.ts:198)) —
   akun Postgres dengan `is_operasional = true`, dipakai untuk dropdown.

## Bagian 2: Tim Produksi & Roster Anggota

3 tim TETAP, satu per nomor shift (1/2/3) — bukan entitas terpisah yang
dipilih bebas. Anggota adalah nama teks saja (tanpa login), dikelola
Kepala Produksi lewat produksi-app.

### Tabel baru: `DashboardTimProduksiAnggota` (MSSQL)

| Kolom | Tipe |
|---|---|
| `AnggotaID` | `INT IDENTITY PK` |
| `Shift` | `TINYINT NOT NULL` (1/2/3 — tim tetap mana anggota ini masuk) |
| `Nama` | `VARCHAR(100) NOT NULL` |
| `IsDeleted` | `BIT NOT NULL DEFAULT 0` (soft-remove dari roster, riwayat kehadiran lama tetap utuh) |
| `CreatedDate`, `ModifiedDate` | audit |

Kepala Produksi (role `isProduksi`) tambah/nonaktifkan nama lewat layar
kelola roster di produksi-app (bagian dari tab "Aktivitas Produksi" baru,
bukan tab terpisah).

## Bagian 3: Catatan Aktivitas Per Shift

### Tabel baru: `DashboardAktivitasProduksiShift`

Satu baris per (TanggalUsaha, Shift) — cutoff **kerja** (rollover 15:00,
sama seperti Tahap 1), bukan cutoff jual.

| Kolom | Tipe | Keterangan |
|---|---|---|
| `AktivitasID` | `INT IDENTITY PK` | |
| `TanggalUsaha` | `DATE NOT NULL` | dari `getReportShift("work", ...).businessDate` |
| `Shift` | `TINYINT NOT NULL` | |
| `ShiftMulai` | `DATETIME NOT NULL` | naive-WIB, dari `getShiftWindow(...).start` — kunci urutan kronologis, sama pola Tahap 1 |
| `StafOperasionalAkunID` | `INT NULL` | dipilih dari `getStafOperasionalOptions()` |
| `StokEsSebelumnya10KG` | `INT NOT NULL DEFAULT 0` | **snapshot**, diambil SEKALI saat baris ini pertama kali dibuat (total `SisaQty10KG` gudang saat itu) — bukan dihitung ulang tiap kali dibaca, supaya tidak bergeser begitu produksi baru shift ini menambah stok pallet |
| `PecahKemasanQty`, `EsJatuhQty`, `GantiReturnQty`, `SealerJebolQty` | `INT NOT NULL DEFAULT 0` | |
| `CreatedByAkunID` | `INT NOT NULL` | |
| `CreatedDate`, `ModifiedDate` | audit |

Unique constraint: `(TanggalUsaha, Shift)`.

**Total Denda** dihitung di aplikasi (tidak disimpan):
`PecahKemasanQty*1000 + EsJatuhQty*3000` — Ganti Return & Sealer Jebol
dikonfirmasi TIDAK punya nominal denda, ditampilkan sebagai hitungan
kejadian saja, tidak menyumbang ke Total Denda.

### Tabel baru: `DashboardAktivitasProduksiKehadiran`

Siapa dari tim tetap shift itu yang HADIR — menentukan pembagi
kontribusi.

| Kolom | Tipe |
|---|---|
| `AktivitasID` | `INT NOT NULL` |
| `AnggotaID` | `INT NOT NULL` |

PK gabungan `(AktivitasID, AnggotaID)`.

## Bagian 4: Status Mesin — Log Kejadian Real-Time

### Tabel baru: `DashboardProduksiMesinEvent`

Terpisah dari `DashboardProduksiMesin.Status` yang sudah ada (itu status
administratif "sekarang", dikelola lewat Panel Mesin desktop — TIDAK
disentuh). Ini murni log historis kejadian On/Off per shift.

| Kolom | Tipe |
|---|---|
| `EventID` | `INT IDENTITY PK` |
| `MesinID` | `INT NOT NULL` |
| `JenisEvent` | `VARCHAR(10) NOT NULL` (`'On'` \| `'Off'`) |
| `WaktuEvent` | `DATETIME NOT NULL` | naive-WIB (lihat catatan konvensi di bawah) |
| `DicatatOlehAkunID` | `INT NOT NULL` |

Tidak ada kolom AktivitasID — event ditampilkan di layar shift tertentu
dengan memfilter `WaktuEvent` yang jatuh dalam jendela
`getShiftWindow(businessDate, shift, "work")` shift itu, sama pola
seperti `ShiftMulai` di tabel-tabel lain. Ini menghindari perlu
tahu/insert AktivitasID sebelum baris shift-nya sendiri ada (toggle bisa
terjadi sebelum Kepala Produksi menyimpan apa pun untuk shift itu).

**Catatan konvensi baru**: `business-date.ts` belum punya helper "waktu
sekarang, naive-WIB, presisi penuh, TANPA rollover bisnis" (yang ada,
`getNaiveWibTransDate()`, sengaja menggabungkan tanggal-usaha-dengan-rollover
+ jam WIB — cocok untuk TransDate, berlebihan untuk sekadar timestamp
kejadian). Tambahkan fungsi kecil baru `getNaiveWibNow(now = new Date())`
di `business-date.ts` (ekstrak logika Intl yang sama, tanpa bagian
rollover) — dipakai di sini SAJA sejauh Tahap 2, tapi tersedia untuk
kebutuhan serupa nanti.

## Bagian 5: Rekap QTY Produksi

### 10KG — otomatis, per Mesin

Dihitung dari `DashboardProduksiBatch` (via JOIN ke
`DashboardProduksiKualitas` untuk `MesinID`), difilter
`Kualitas.TanggalLabel = @tanggalUsaha AND Kualitas.Shift = @shift`,
`GROUP BY MesinID`. Ini query BARU (tidak ada di `produksi-warehouse.ts`
sekarang), tapi memakai kolom yang sudah ada persis seperti
`getRiwayatProduksi()` sudah lakukan.

**Catatan pre-existing (bukan bug Tahap 2, tapi perlu diketahui)**:
`Kualitas.TanggalLabel` di-default dari `getBusinessDateISO()` —
rollover **14:00** (`ROLLOVER_HOUR`, dipakai luas di app), BUKAN rollover
**15:00** yang jadi konvensi "work" shift Tahap 1/2. Untuk kejadian yang
dicatat 14:00–14:59 WIB (Shift 1 secara kerja, tapi tanggal sudah
"besok" menurut rollover 14:00), `TanggalLabel`+`Shift` yang tersimpan
bisa sedikit tidak sinkron dengan pengelompokan "work" murni. Jendela
59 menit/hari ini sudah ada SEBELUM Tahap 2 (memengaruhi tampilan
Riwayat Produksi desktop yang sudah ada juga) — Tahap 2 mengelompokkan
persis mengikuti `TanggalLabel`+`Shift` tersimpan (konsisten dengan
tampilan yang sudah ada), tidak mencoba menghitung ulang dari
`CreatedDate`.

### 5KG — otomatis, total shift saja (tanpa breakdown Mesin)

Dijumlah dari `SUM(Qty5KGDimuat)` semua
`DashboardPengirimanJadwal` yang `JamSelesaiMuat IS NOT NULL` dan jatuh
dalam jendela shift ini.

**Catatan konvensi WAJIB**: `JamSelesaiMuat` diisi via `GETDATE()`
mentah — **true-UTC** (beda konvensi dari `TransDate` yang sekarang
naive-WIB pasca perbaikan hari ini). Jendela shift dari
`getShiftWindow(...,"work")` itu naive-WIB. Filter SQL WAJIB
membandingkan `JamSelesaiMuat` terhadap batas jendela yang SUDAH
dikonversi ke true-UTC lewat `naiveWibToUtcInstant()` — JANGAN
membandingkan mentah-mentah (ini persis kelas bug yang ditemukan &
diperbaiki hari ini pada `assertJamJadwalNotBeforeOrders`).

### Kantong-ekivalen untuk pembagian kontribusi

`totalKantongEkivalen = totalQty10KG + totalQty5KG / 2` (5KG dihitung
setengah kantong — konvensi yang sudah dipakai luas di app,
lihat `JADWAL_KANTONG_EXPR` di `pengiriman-jadwal.ts`).

## Bagian 6: Kontribusi Per Anggota

```
kontribusiPerOrang = totalKantongEkivalen / jumlahAnggotaHadir
```

Dihitung & ditampilkan di layar (tidak disimpan) — murni turunan dari
rekap QTY (Bagian 5) dan daftar kehadiran (Bagian 3). Kalau
`jumlahAnggotaHadir = 0`, tampilkan "Belum ada anggota hadir" alih-alih
membagi dengan nol.

## Bagian 7: Alur UI

Semua di tab baru **"Aktivitas Produksi"** di `produksi-app` (role
`isProduksi`, sudah tergerbang lewat layout yang ada) — mengikuti pola
tab-shell yang sama seperti tab "Bahan Baku" Tahap 1.

- **Header shift berjalan**: tanggal usaha, label shift, dropdown Nama
  Staf Operasional (dari `getStafOperasionalOptions()`), Stok Es
  Sebelumnya (read-only, snapshot).
- **Kelola Tim**: lihat & centang siapa dari tim tetap shift ini yang
  hadir; tombol kecil untuk tambah/nonaktifkan nama anggota (roster,
  Bagian 2).
- **Status Mesin**: daftar mesin dengan tombol On/Off, riwayat toggle
  shift ini di bawahnya (dari `DashboardProduksiMesinEvent`, difilter
  jendela shift).
- **Rekap Produksi**: tabel 10KG per mesin (read-only, dihitung), total
  5KG shift (read-only, dihitung), kartu Kontribusi per Anggota
  (read-only, turunan).
- **Kerusakan**: 4 input angka (Pecah Kemasan, Es Jatuh, Ganti Return,
  Sealer Jebol) + Total Denda (read-only, dihitung).
- **Riwayat**: daftar shift-shift sebelumnya, baris tetap bisa
  dibuka & diedit ulang (field kerusakan, kehadiran, Staf Operasional —
  konsisten "bebas diedit" seperti Tahap 1; rekap QTY tetap dihitung ulang
  otomatis untuk shift manapun yang dibuka, tidak pernah membeku).

Ditambahkan pula: tab/bagian baru di halaman desktop
`/mkesindo/laporan` yang sudah ada (Tahap 1) untuk melihat riwayat
Aktivitas Produksi — read-only, konsisten dengan alasan modul ini
bernama "Laporan".

## Ringkasan Keputusan yang Sudah Dikonfirmasi

- `isOperasional` = Peran Khusus (flag) baru, terpisah dari izin modul
  "Laporan" Tahap 1 — untuk identitas/pemilihan, bukan akses halaman.
- 3 Tim Produksi TETAP, satu per nomor shift; anggota = nama saja
  (tanpa login), dikelola Kepala Produksi lewat produksi-app.
- QTY 10KG per Mesin: otomatis dari Kualitas/Batch yang sudah ada.
  QTY 5KG: otomatis, total shift saja (tanpa breakdown Mesin), dijumlah
  dari `Qty5KGDimuat` Jadwal yang selesai muat dalam jendela shift itu.
- Status mesin On/Off: log kejadian real-time (bukan ringkasan akhir
  shift), tabel baru terpisah dari `Status` administratif yang ada.
- Denda: sekadar dicatat & dilaporkan, belum masuk COA/Kas Kecil.
- Kontribusi: total kantong-ekivalen dibagi rata ke anggota yang hadir
  saja.
- Total Denda hanya dari Pecah Kemasan (Rp1000/kejadian) + Es Jatuh
  (Rp3000/kejadian) — Ganti Return & Sealer Jebol dicatat sebagai
  kejadian saja, tanpa nominal.
- Lokasi input: tab baru "Aktivitas Produksi" di produksi-app.
