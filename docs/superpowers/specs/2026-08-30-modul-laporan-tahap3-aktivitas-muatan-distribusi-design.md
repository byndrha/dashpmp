# Modul Laporan — Tahap 3 (Aktivitas Muatan Distribusi)

## Konteks

Sub-proyek ketiga dari "Modul Laporan" (lihat [Tahap 1](2026-08-27-modul-laporan-stok-bahan-baku-design.md)
untuk fondasi cutoff-shift, dan [Tahap 2](2026-08-28-modul-laporan-tahap2-aktivitas-produksi-design.md)
untuk pola rekap-per-shift yang dipakai ulang di sini). Tahap 3 melaporkan
aktivitas Driver per shift kerja: berapa kali muat, total qty terkirim,
kendala di jalan, pengisian BBM, dan istirahat — semuanya diagregasi dari
data yang **sudah ada** di alur Pengiriman/driver-app, bukan input baru.

Berbeda dari Tahap 1 & 2, tahap ini **tidak menambah tabel database sama
sekali** — murni lapisan query/tampilan read-only di atas
`DashboardPengirimanJadwal`, `DashboardPengirimanKendala`,
`DashboardPengirimanBBM`, dan `DashboardPengirimanIstirahat` yang sudah
berjalan lewat driver-app.

## Revisi dari asumsi Tahap 1

Spec Tahap 1 menyiapkan **cutoff Penjualan** (rollover 14:00, sama dengan
`ROLLOVER_HOUR` yang sudah dipakai SO/DO/SI/TransDate) khusus untuk tahap
ini, dengan alasan aktivitas Distribusi mengikuti siklus pemenuhan Sales
Order. Setelah dipertimbangkan ulang bersama user, keputusan itu **dibalik**:
Tahap 3 memakai **cutoff Kerja** (rollover 15:00) — sama seperti Tahap 1 & 2
(dan rencana Tahap 4) — supaya Driver, Staf Produksi, dan Staf Operasional
konsisten memakai batas shift yang identik, memudahkan penggabungan
lintas-divisi di Tahap 5 nanti (panel gabungan lintas-shift). Cutoff
Penjualan tetap ada di [`report-shift.ts`](../../../src/lib/report-shift.ts)
untuk kebutuhan lain, tapi sejauh ini tidak dipakai tahap manapun.

## Non-Goals

- **Tidak ada tabel database baru** — seluruh laporan dihitung saat baca
  dari tabel yang sudah ada.
- **Tidak ada tab baru di driver-app** — Driver tidak melihat rekap ini
  sendiri; laporan ini murni untuk `/mkesindo/laporan` (manajemen/Staf
  Operasional/Direktur).
- **Tidak ada pencatatan kerusakan/kejadian baru khusus pengiriman** —
  memakai data `DashboardPengirimanKendala` yang sudah ada apa adanya,
  bukan field denda baru ala "Pecah Kemasan/Es Jatuh" Tahap 2.
- Tahap 4 (Aktivitas Keuangan Operasional) dan Tahap 5 (panel gabungan
  lintas-shift) — sub-proyek terpisah.
- Replikasi ke PMPersada/PMPutra — di luar cakupan, sama seperti
  tahap-tahap sebelumnya (MKEsindo saja).

## Bagian 1: Cutoff & Pengelompokan Shift

Satu `DashboardPengirimanJadwal` ditempatkan ke satu `(TanggalUsaha, Shift)`
berdasarkan `JamSelesaiMuat`-nya — **hanya** Jadwal dengan
`JamSelesaiMuat IS NOT NULL` yang dihitung (Jadwal yang belum selesai muat
belum masuk laporan shift manapun).

`JamSelesaiMuat` sudah terkonfirmasi **true-UTC** (dicatat di Tahap 2's
spec Bagian 5, dipakai ulang untuk agregasi 5KG). Filter SQL wajib
membandingkan `JamSelesaiMuat` terhadap batas jendela
`getShiftWindow(businessDate, shift, "work")` yang sudah dikonversi ke
true-UTC lewat `naiveWibToUtcInstant()` — jangan pernah dibandingkan
mentah-mentah, persis pola yang sudah dipakai Tahap 2.

**Satu Jadwal = satu unit kerja utuh.** Seluruh aktivitas yang menempel
pada satu Jadwal (qty terkirim, Kendala, sesi BBM, sesi Istirahat) ikut
dibundel ke shift yang sama dengan `JamSelesaiMuat` Jadwal itu — TIDAK
dipecah berdasarkan waktu masing-masing kejadian individual (yang bisa
saja terjadi setelah `JamSelesaiMuat`, misalnya Kendala yang dilaporkan di
tengah perjalanan pengantaran). Ini konsisten dengan cara Tahap 2
memperlakukan qty 5KG satu Jadwal sebagai milik satu shift saja.

## Bagian 2: Rekap per Driver per Shift

Satu baris ringkas per `(TanggalUsaha, Shift, SalesmanID)`, dihitung saat
baca (tidak disimpan) dari Jadwal-Jadwal yang termasuk kombinasi itu
(Bagian 1):

| Field | Sumber |
|---|---|
| `jumlahMuat` | `COUNT(*)` Jadwal dalam kelompok ini |
| `totalQty10KG` | `SUM` qty 10KG yang dialokasikan ke Jadwal-Jadwal ini (via `DashboardProduksiMuatanDetail`, sama sumber yang dipakai `getRiwayatProduksi`/rekap Tahap 2) |
| `totalQty5KG` | `SUM(Qty5KGDimuat)` |
| `totalKantongEkivalen` | `totalQty10KG + totalQty5KG / 2` — formula sama seperti Tahap 2 |
| `jumlahKendala` + breakdown per `JenisKendala` | `COUNT` baris `DashboardPengirimanKendala` yang `JadwalID` masuk kelompok ini, dikelompokkan juga per jenis |
| `totalLiterBBM`, `totalNominalBBM` | `SUM(Liter)`, `SUM(NominalAsli + NominalEkstra)` dari `DashboardPengirimanBBM` milik Jadwal-Jadwal ini yang sudah selesai diisi (`WaktuIsi IS NOT NULL`) |
| `jumlahSesiIstirahat`, `totalDurasiIstirahatMenit` | `COUNT` dan `SUM` durasi dari `DashboardPengirimanIstirahat` milik Jadwal-Jadwal ini (durasi sesi yang masih berjalan dihitung sampai `GETDATE()`, sama pola `getIstirahatForJadwal`) |

Nama Driver diambil dari `Salesman.Name` (sama pola dengan
`getKendalaReports`/`getDriverJadwalHistory` yang sudah ada).

## Bagian 3: Alur UI

Section/tab baru **"Aktivitas Muatan Distribusi"** di halaman
`/mkesindo/laporan` yang sudah ada (dari Tahap 1). Karena laporan ini
100% read-only (tidak ada input manual sama sekali), tidak ada perbedaan
tampilan `canEdit` vs `canView` seperti Tahap 1/2 — siapa pun dengan akses
modul "laporan" (view maupun edit) melihat tampilan yang sama.

- Tabel dengan kolom: Tanggal Usaha, Shift, Nama Driver, Jumlah Muat,
  Total Qty (10KG / 5KG / kantong-ekivalen), Jumlah Kendala (+ rincian
  jenis), Ringkasan BBM (liter & nominal), Ringkasan Istirahat (jumlah
  sesi & total durasi).
- Diurutkan kronologis (Shift 2 → 3 → 1 dalam satu TanggalUsaha, bukan
  urutan angka — sama aturan yang sudah dipakai di Jadwal Tim Bulanan).
- Navigasi bulan (mundur/maju), mengikuti pola yang sama seperti kalender
  Jadwal Tim Bulanan — supaya tidak menampilkan seluruh riwayat sekaligus
  mengingat jumlah baris (driver × shift) bertambah terus dari waktu ke
  waktu.

## Ringkasan Keputusan yang Sudah Dikonfirmasi

- Cutoff Kerja (15:00), BUKAN cutoff Penjualan — revisi dari asumsi awal
  Tahap 1, demi konsistensi lintas-divisi menjelang Tahap 5.
- Satu Jadwal dikelompokkan ke shift berdasarkan `JamSelesaiMuat`,
  diperlakukan sebagai satu unit kerja utuh (semua aktivitas turunannya
  ikut shift yang sama).
- Kerusakan/kejadian: pakai data Kendala yang sudah ada, tidak ada input
  baru.
- Tidak ada tab baru di driver-app — murni laporan manajemen di
  `/mkesindo/laporan`.
- Field rekap: Jumlah Muat, Total Qty (+ekivalen), Kendala, BBM,
  Istirahat.
- Tidak ada tabel database baru sama sekali di tahap ini.
