# Modul Laporan — Tahap 5 (Panel Gabungan Lintas Shift)

## Konteks

Sub-proyek kelima dan **terakhir** dari "Modul Laporan" (lihat
[Tahap 1](2026-08-27-modul-laporan-stok-bahan-baku-design.md),
[Tahap 2](2026-08-28-modul-laporan-tahap2-aktivitas-produksi-design.md),
[Tahap 3](2026-08-30-modul-laporan-tahap3-aktivitas-muatan-distribusi-design.md),
[Tahap 4](2026-08-31-modul-laporan-tahap4-aktivitas-keuangan-operasional-design.md)).
Keempat tahap sebelumnya sudah dibangun, semuanya memakai cutoff **Kerja**
(07:00/15:00/23:00 WIB) dan grain `(TanggalUsaha, Shift)` yang sama —
Tahap 3 sengaja dipindah dari rencana awal cutoff Penjualan ke cutoff
Kerja justru demi memungkinkan tahap ini.

Tahap 5 menggabungkan keempat tahap itu jadi satu panel: (1) cek
kelengkapan pengisian shift sekilas, dan (2) performa/KPI lintas shift
dari waktu ke waktu — murni lapisan agregasi di atas fungsi query yang
sudah ada di Tahap 1-4, **tanpa tabel database baru**, sama semangat
ringan seperti Tahap 3.

## Non-Goals

- **Tidak ada tabel database baru** — seluruhnya dihitung saat baca dari
  fungsi query Tahap 1-4 yang sudah ada.
- **Tidak ada input manual sama sekali** — 100% read-only, tidak ada
  perbedaan tampilan `canEdit`/`canView` seperti tahap-tahap lain (semua
  tahap sudah punya tempat inputnya sendiri).
- **Tidak ada tautan cepat** dari kartu detail ke tab tahap lain — dibuat
  sesederhana mungkin dulu (YAGNI), bisa ditambah nanti kalau memang
  dibutuhkan.
- **Muatan Distribusi dikecualikan dari skor kelengkapan** — tidak ada
  konsep "input manual" di tahap itu (murni agregasi otomatis dari data
  Pengiriman), jadi tidak ada yang bisa dicek "sudah diisi atau belum".
  Angka rekapnya tetap tampil sebagai KPI, hanya tidak ikut skor.
- Replikasi ke PMPersada/PMPutra — di luar cakupan, sama seperti
  tahap-tahap sebelumnya (MKEsindo saja).

## Bagian 1: Skor Kelengkapan & KPI Kunci

### Skor Kelengkapan (0-3)

Hanya menghitung 3 tahap yang punya input manual:

| Tahap | Kriteria "lengkap" |
|---|---|
| Bahan Baku | Ketiga `JenisBarang` (Plastik 10KG, Plastik 5KG, Ikat Kabel) sudah punya baris `DashboardStokBahanBakuShift` untuk `(TanggalUsaha, Shift)` ini |
| Produksi | Baris `DashboardAktivitasProduksiShift` untuk `(TanggalUsaha, Shift)` ini sudah ada |
| Kas Kecil | Baris `DashboardKasKecilShift` untuk `(TanggalUsaha, Shift)` ini sudah ada |

Skor = jumlah kriteria yang terpenuhi (0-3), ditampilkan juga sebagai
persentase (`skor/3 * 100%`).

### KPI Kunci per Tahap (dipakai grafik tren mini — Bagian 3)

| Tahap | KPI Kunci | Formula |
|---|---|---|
| Bahan Baku | Kantong-ekivalen masuk inventori operasional | `StokMasukInventoriOperasional(Plastik10KG) + StokMasukInventoriOperasional(Plastik5KG) / 2` — Ikat Kabel TIDAK termasuk (bukan kantong), tetap tampil terpisah di kartu detail (Bagian 2) |
| Produksi | Total kantong-ekivalen | `totalQty10KG + totalQty5KG / 2` — angka yang sama persis dipakai `getQtyRecapForShift` Tahap 2 |
| Muatan Distribusi | Total Jumlah Muat | `SUM(jumlahMuat)` dari semua baris `AktivitasMuatanDistribusiRow` (semua driver) untuk `(TanggalUsaha, Shift)` ini |
| Kas Kecil | Saldo Akhir | Langsung dari `KasKecilShiftRow.saldoAkhir` shift itu |

## Bagian 2: Kartu Detail Shift

Menampilkan satu shift yang sedang dipilih (default: shift berjalan dari
`getReportShift("work")`, navigasi mundur/maju satu shift demi shift,
terpisah dari navigasi bulan Bagian 3).

- **Header**: Tanggal Usaha, label shift, skor kelengkapan besar (mis.
  "2/3 lengkap", dengan indikator warna — hijau 3/3, kuning 1-2/3, merah
  0/3).
- **4 sub-kartu bersebelahan**, satu per tahap, tanpa tautan ke tab lain:
  - **Bahan Baku**: status lengkap/belum per jenis barang (✓/✗ × 3),
    rincian sisa gudang & inventori per jenis (dari
    `getStokBahanBakuHistory`/`getCurrentShiftRows`).
  - **Produksi**: status lengkap/belum, Tim Bertugas, Staf Operasional,
    total kantong-ekivalen, Total Denda (dari `getAktivitasRiwayat`/
    `getQtyRecapForShift`).
  - **Muatan Distribusi**: jumlah muat & total kantong-ekivalen (dijumlah
    semua driver shift itu), jumlah Kendala (dari
    `getAktivitasMuatanDistribusi`, di-`SUM` lintas baris driver untuk
    `(TanggalUsaha, Shift)` yang sama).
  - **Kas Kecil**: status lengkap/belum, Kas Masuk, Total Pengeluaran,
    Saldo Akhir (dari `getKasKecilHistory`).
- Shift yang belum ada baris apa pun di satu tahap menampilkan sub-kartu
  itu dengan status "Belum diisi"/nol, bukan disembunyikan — konsisten
  dengan cara tahap-tahap lain menampilkan shift yang belum disentuh.

## Bagian 3: Grafik Tren

Memakai `recharts` (sudah jadi dependency, dipakai pola yang sama seperti
`src/components/charts/sales-trend-chart-monthly.tsx` — `ResponsiveContainer`,
`CartesianGrid`, tooltip custom, warna dari CSS variable `--chart-*`).

- **Grafik utama**: tren Skor Kelengkapan (0-3) per shift sepanjang bulan
  yang dipilih, satu garis, diurutkan kronologis (Shift 2 → 3 → 1 dalam
  satu Tanggal Usaha, bukan urutan angka — sama aturan seperti tab-tab
  lain).
- **4 grafik mini berdampingan**, satu per tahap, masing-masing tren KPI
  Kunci-nya sendiri (Bagian 1) — sumbu Y masing-masing berdiri sendiri,
  TIDAK digabung jadi satu sumbu (satuannya beda: kantong, rupiah,
  jumlah).
- Navigasi bulan sendiri (terpisah dari navigasi shift Bagian 2) — pola
  sama seperti kalender Jadwal Tim Bulanan/tab Muatan Distribusi.

## Bagian 4: Alur UI

Tab baru **"Ringkasan Lintas Shift"**, tab kelima (dan terakhir) di
`/mkesindo/laporan` — 100% read-only, tidak ada perbedaan `canEdit`/
`canView`, siapa pun dengan akses modul "laporan" melihat tampilan yang
sama persis.

Susunan halaman: Kartu Detail Shift (Bagian 2) di atas, Grafik Tren
(Bagian 3) di bawahnya.

## Ringkasan Keputusan yang Sudah Dikonfirmasi

- Tujuan ganda: cek kelengkapan pengisian DAN performa/KPI lintas shift.
- Bentuk tampilan: kartu ringkas per shift + grafik tren (bukan tabel
  datar seperti 4 tab lain) — memakai `recharts` yang sudah jadi
  dependency.
- Skor kelengkapan hanya dari 3 tahap yang punya input manual (Bahan
  Baku, Produksi, Kas Kecil) — Bahan Baku butuh ketiga jenis barang
  terisi untuk dianggap lengkap.
- Muatan Distribusi dikecualikan dari skor kelengkapan, tapi KPI-nya
  tetap tampil.
- Grafik tren: satu grafik gabungan (skor kelengkapan) + 4 grafik mini
  terpisah per tahap (KPI kunci masing-masing) — sesuai kesepakatan
  "keduanya, semakin lengkap semakin baik".
- KPI kunci per tahap: kantong-ekivalen Produksi, Jumlah Muat Distribusi,
  Saldo Akhir Kas Kecil, kantong-ekivalen masuk Bahan Baku.
- Tidak ada tautan cepat dari kartu detail ke tab lain (YAGNI).
- Tidak ada tabel database baru sama sekali — murni agregasi dari
  fungsi query Tahap 1-4 yang sudah ada.
- Lokasi: tab kelima di `/mkesindo/laporan`, 100% read-only.
