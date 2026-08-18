# Kinerja Marketing: Existing vs NOO — Design Spec

## Latar Belakang

Penilaian Kinerja Marketing saat ini (`getMarketingPerformance()`, `src/lib/queries/marketing-performance.ts`) menjumlahkan **semua** mitra di bawah scope seorang marketing — baik mitra lama (existing) maupun mitra baru yang baru saja disetujui bulan ini — ke dalam satu angka target dan satu angka capaian (`TargetHarian`, `PctAchievement`). Ini menimbulkan bias: ketika penjualan stagnan di suatu bulan, tidak bisa langsung diketahui apakah penyebabnya adalah existing yang turun sementara NOO (New Open Outlet) naik, atau sebaliknya.

Spesifikasi ini memecah penilaian menjadi tiga kategori — **Existing**, **NOO**, **Total** — di dua modul: desktop `/mkesindo/pemasaran` dan mobile `/mkesindo/pemasaran-app`. Sebagai bagian dari redesign ini, kategori PartnerType mitra juga diperluas dari 2 (Agen/Retail) menjadi 3 tingkat (Agen/RPA/Outlet) berdasarkan qty, karena tabel Pangsa Pasar yang diminta memerlukan pemecahan ini.

## Cakupan

- Pemecahan `TargetHarian`/capaian Kinerja Marketing yang ada sekarang menjadi 3 kategori (Existing, NOO, Total), ditampilkan dalam 3 anatomi (jumlah outlet, persen capaian, kantong terkirim).
- Kategori PartnerType baru: **RPA**, ditambah rename label **Retail → Outlet** (murni label, bukan logika baru untuk kategori Agen/Outlet yang sudah ada).
- Tabel baru "Matriks Performa Marketing" (tren Existing/NOO/Total per bulan) dan "Pangsa Pasar & Kontribusi Internal" (tren Agen/RPA/Outlet + Lost per bulan), di desktop dan mobile.
- Mekanisme snapshot kapasitas bulanan (baru) sebagai basis Target Existing yang akurat secara historis, mulai dari bulan pertama fitur ini aktif.
- Kalkulasi Target NOO baru berbasis kapasitas armada.

**Di luar cakupan:**
- Reklasifikasi otomatis mitra lama ke Agen/RPA/Outlet — keputusan eksplisit: **tidak ada migrasi**, mitra existing tetap dengan Gender/PartnerType apa adanya sampai diedit manual.
- Target/kapasitas historis sebelum fitur ini aktif tidak direkonstruksi — bulan-bulan itu pakai kapasitas mitra hari ini sebagai pendekatan (lihat "Snapshot Kapasitas Bulanan").
- Tidak ada perubahan pada modul Pengiriman/Armada itu sendiri — Target NOO hanya *membaca* `DashboardArmada.KapasitasMaks` dan data muatan yang sudah ada, tidak menulis apa pun ke sana.
- "Mitra Prioritas" (`DashboardMarketingMitra`) tidak berubah strukturnya — hanya direposisikan sebagai sub-bagian dari kategori Existing di UI.

## Arsitektur

### 1. Kategori PartnerType baru (Agen / RPA / Outlet)

`PartnerType` tetap diturunkan dari kolom `BusinessPartner.Gender` (`PARTNER_TYPE_CASE`, `src/lib/queries/aging.ts`) — pola yang sudah ada dipertahankan, hanya ditambah satu nilai baru (mis. `"Other"`) untuk mewakili RPA. Tiga ambang batas qty di `approvePengajuan()` (`AGEN_QTY_THRESHOLD`, `src/lib/queries/mitra-pengajuan.ts`) dan `updateMitraCapacity()`/`updateMitra()` mana pun yang menentukan Gender dari qty:

- qty ≤ 10 → **Outlet** (`Gender = "Female"`, label tampilan berubah dari "Retail" ke "Outlet" di seluruh UI — cek setiap tempat yang literal menulis "Retail")
- 10 < qty ≤ 100 → **Agen** (`Gender = "Male"`, tidak berubah)
- qty > 100 → **RPA** (`Gender` nilai baru)

Ini otomatis, sama seperti sekarang — tidak ada field "Jenis Usaha" manual yang ditambahkan ke form manapun (konsisten dengan keputusan produk sebelumnya di modul ini). `PARTNER_TYPE_CASE` bertambah satu cabang `WHEN Gender = <nilai RPA> THEN 'RPA'`.

**Tidak ada migrasi** untuk mitra existing — perubahan hanya berlaku untuk Pengajuan yang di-approve setelah fitur ini aktif, dan saat seseorang mengedit ulang data mitra existing.

### 2. Snapshot Kapasitas Bulanan (baru)

Tabel baru `DashboardMitraCapacitySnapshot` (MSSQL, mengikuti konvensi `Dashboard*` yang sudah ada): satu baris per (bulan, `BusinessPartnerID`) berisi `Capacity` mitra tersebut pada saat snapshot diambil.

**Mekanisme "lazy snapshot"**: tidak perlu cron job baru. Saat query performa (lihat §3) pertama kali dijalankan untuk bulan berjalan dan belum ada baris snapshot untuk bulan itu, sistem otomatis menghitung snapshot dari kapasitas *live* semua mitra saat itu juga dan menyimpannya — snapshot bulan itu terkunci (idempotent, tidak ditimpa lagi) sejak pengambilan pertama. Bulan-bulan yang sudah lewat sebelum fitur ini aktif (tidak punya snapshot sama sekali) fallback ke kapasitas mitra **hari ini**, diterapkan mundur — sesuai keputusan eksplisit: bukan rekonstruksi historis yang akurat, melainkan pendekatan.

### 3. Existing vs NOO vs Total

Untuk satu bulan M, terhadap roster mitra hasil `resolveResponsibleMarketing()` yang sudah ada (`marketing-wilayah.ts`, tidak berubah):

- **NOO** = mitra dengan `JoinDate` di dalam bulan M (tanggal approve Pengajuan, atau `JoinDate` ERP-import untuk data lama).
- **Existing** = mitra dengan `JoinDate` sebelum awal bulan M.
- **Total** = gabungan keduanya.

`JoinDate` adalah fakta historis yang tidak berubah, jadi pembagian ini akurat untuk bulan manapun tanpa perlu snapshot — hanya `Capacity` (untuk Target Existing) yang butuh snapshot per §2.

### 4. Tiga anatomi tampilan

Setiap kategori (Existing/NOO/Total) ditampilkan dalam 3 cara:

1. **General** — jumlah outlet/mitra di kategori itu (murni hitungan, tanpa target).
2. **(%) per bulan** — capaian aktual terhadap target kategori itu (`aktual Bag Qty / target Bag Qty × 100`).
3. **(Bag Qty)** — kantong terkirim aktual vs target, dalam format `aktual/target`.

**Target Existing** = Σ `Capacity` (dari snapshot bulan M, §2) seluruh mitra Existing di scope marketing tsb, dikali jumlah hari di bulan M (pola yang sama seperti `TargetHarian * periodDays` yang sudah ada).

**Target NOO** = satu angka **bersama**, sama di semua kartu marketing maupun tampilan gabungan (bukan dibagi per-marketing, bukan berbasis wilayah — armada tidak terikat ke wilayah/marketing tertentu di data yang ada). Dihitung dinamis tiap kali (bukan disnapshot — "target ini bergerak"):

```
per armada: kapasitas_kosong_harian = KapasitasMaks − rata-rata_muatan_harian(30 hari terakhir)
Target NOO (bulan M) = Σ semua armada (kapasitas_kosong_harian) × jumlah_hari(bulan M)
```

**Target Total** = Target Existing (per-marketing) + Target NOO (angka bersama). Kolom **Total** di ketiga anatomi selalu penjumlahan sederhana dari Existing + NOO — bukan dihitung ulang dari roster gabungan secara terpisah: `Total.General = Existing.General + NOO.General`, `Total.BagQty.aktual = Existing.BagQty.aktual + NOO.BagQty.aktual`, `Total.BagQty.target = Target Existing + Target NOO`, `Total.% = Total.BagQty.aktual / Total.BagQty.target × 100`.

Snapshot (§2) hanya menyimpan nilai `Capacity` — resolusi scope "mitra ini milik marketing siapa" tetap dihitung *live* tiap query lewat `resolveResponsibleMarketing()` yang sudah ada (bukan ikut disnapshot). Konsekuensinya: kalau assignment wilayah seorang marketing berubah, angka bulan-bulan lalu di tren ikut bergeser mengikuti assignment *hari ini* — sama seperti kapasitas hari-ini-diterapkan-mundur di §2, ini konsisten, bukan bug.

### 5. Tabel "Matriks Performa Marketing" (tren bulanan)

Kolom: Bulan | Existing | NOO | Total — tiap sel menampilkan `aktual/target` (Bag Qty) dan `%` di baris kedua, sesuai mockup. Default menampilkan **3 bulan terakhir**; tombol untuk memperluas ke **12 bulan terakhir**. Query baru (nama sementara `getMarketingPerformanceTrend()`) yang menghasilkan array bulanan, dibedakan dari `getMarketingPerformance()` yang ada sekarang (yang tetap dipakai untuk tampilan "bulan berjalan" / roster Mitra Prioritas-Seluruh Mitra-NOO).

### 6. Tabel "Pangsa Pasar & Kontribusi Internal" (tren bulanan)

Kolom: Bulan | Agen | RPA | Outlet | Total | Lost. Rentang waktu sama seperti §5 (3 bulan default, 12 bulan expand).

- **Agen/RPA/Outlet/Total**: jumlah outlet per kategori PartnerType (§1) di scope marketing tsb pada bulan M, dengan **% dihitung terhadap total gabungan SEMUA marketing bulan itu** (kontribusi internal marketing ini terhadap total perusahaan) — bukan terhadap totalnya sendiri. Butuh query tambahan: total per kategori across semua marketing, per bulan.
- **Lost** = Total Bag Qty (dari tabel §5, kategori Total) bulan M − Total Bag Qty bulan M−1. Bisa positif (hijau, tumbuh) atau negatif (merah, turun) — bukan hitungan mitra yang churn/nonaktif.

### 7. Lokasi tampil

**Desktop `/mkesindo/pemasaran`** (dilihat Supervisor/Accounting/Manager/Super Admin):
- Satu set gabungan (§5 + §6, menjumlahkan seluruh marketing) ditampilkan di bagian atas panel Kinerja Marketing.
- Satu set per marketing di dalam `MarketingCard` masing-masing, menggantikan tampilan `TargetHarian`/`PctAchievement` tunggal yang ada sekarang.
- Roster di bawah kartu: "Mitra Prioritas" dan "Seluruh Mitra" yang sudah ada tetap sebagai sub-bagian dari **Existing**; ditambah toggle **NOO** baru yang menampilkan roster mitra dengan `JoinDate` bulan berjalan.

**Mobile `/mkesindo/pemasaran-app`** (`kinerja-marketing-sub-tab.tsx`, dilihat marketing yang login):
- Hanya set milik marketing itu sendiri (§5 + §6) — **tidak ada tampilan gabungan** di mobile, konsisten dengan aturan isolasi data antar-marketing yang berlaku di seluruh app ini (satu marketing tidak pernah melihat data marketing lain).
- Roster Existing (Prioritas/Seluruh)/NOO yang sudah ada di mobile tetap, ditambah toggle NOO baru dengan pola yang sama.

## Testing

Tidak ada test runner di proyek ini. Verifikasi:
- `npx tsc --noEmit`, `npx eslint`.
- Cross-check angka kategori **Total** bulan berjalan terhadap `getMarketingPerformance()` yang sudah ada (harus identik — Total = Existing + NOO harus sama dengan `TargetHarian`/`PctAchievement` versi lama untuk bulan berjalan, karena logikanya cuma dipecah, bukan diganti).
- Verifikasi manual: snapshot kapasitas bulan berjalan benar-benar tersimpan sekali (query ulang tidak menimpa nilai yang sudah terkunci di awal bulan).
- Live check di browser: login sebagai marketing (mobile) dan sebagai Super Admin (desktop), bandingkan angka gabungan desktop = penjumlahan seluruh kartu per-marketing.
- Regresi: modul lain yang menampilkan label "Retail" (Aging, form Mitra, dsb.) sudah konsisten menampilkan "Outlet".
