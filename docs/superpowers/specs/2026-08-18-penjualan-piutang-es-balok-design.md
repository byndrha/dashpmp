# Modul Penjualan & Piutang — Jenis Bisnis Es Balok (pmputra + pmpersada) — Design Spec

## Latar Belakang

`pmputra` (PT Prima Maesa Putra) dan `pmpersada` (PT Putra Maesa Persada) sama-sama berjenis bisnis `Es Balok` (field `perusahaan.jenis_bisnis` di Postgres). Modul Keuangan keduanya sudah live, dibaca langsung dari dua database ERP klien per PT: **utama** (`FINAC_ES_PO` untuk pmputra, `FINAC_ES_TB` untuk pmpersada) dan **logistik** (`FINAC_LOGISTIC_PO` / `FINAC_PMP_LOGISTIC`), lewat `getCompanyPool(kode, label)`.

Modul `penjualan` dan `piutang` untuk kedua PT masih placeholder ("Belum ada data... setelah integrasi FINAC_ES_PO dikerjakan"). Pekerjaan ini membangun keduanya, **read-only**, mengikuti pola UI modul Keuangan yang sudah ada.

**Sudah diverifikasi langsung ke database live (read-only) sebelum spec ini ditulis:**

- Skema ERP standar (`SalesOrder`, `SalesInvoice`, `SalesPayment`, `DeliveryOrder`) ada di kedua database tiap PT tapi **kosong total (0 baris)** — tidak dipakai operasional nyata.
- Sistem penjualan yang sungguh aktif dipakai (data sampai hari ini, ratusan ribu baris) adalah tabel kustom **`PMP_Pemesanan`** (order — kolom `BalokKecil/BalokBesar Pesanan/Realisasi/Retur/Total`, `Status`, `AgenID`, `Tanggal`) dan **`PMP_Agen`** (master pelanggan, dengan kolom `PiutangSaatIni`/`TabunganSaatIni` yang **tidak pernah dipakai** — 0 di seluruh 774 baris Agen di keempat database).
- Nilai Rupiah di `PMP_Pemesanan` (`JumlahTotal`, `BalokKecilHarga × Realisasi`, dst) **tidak cocok** dengan Pendapatan riil dari General Ledger (dicoba silang untuk pmputra/utama April 2026: GL Pendapatan Rp 572.883.900 vs `SUM(JumlahTotal)` Rp 16.721.000 vs `SUM(Realisasi×Harga)` Rp 317.417.804) — kolom harga di tabel ini tidak reliabel untuk nilai penjualan, kemungkinan cuma harga rencana/quote saat order.
- Jumlah **kantong** (`BalokKecilRealisasi`/`BalokBesarRealisasi`) di `PMP_Pemesanan` **valid secara fisik** — ini persis yang sudah dipakai fitur HPP Bersih (`getMonthlyBalokRealisasi`, filter `Status='3' AND IsVoid=0 AND IsDeleted=0`).
- `ChartOfAccount` di keempat database punya akun bertipe "Piutang" dengan saldo GL riil (bukan nol) — lihat bagian Akun Piutang di bawah.
- Kedua database (`utama` dan `logistik`) di kedua PT sama-sama punya data `PMP_Pemesanan`/`PMP_Agen` aktif sampai hari ini — bukan cuma `utama` yang relevan.
- **Temuan penting (18 Sep 2026, dikonfirmasi accounting PMPutra & PMPersada):** database `pmpersada/logistik` (`FINAC_PMP_LOGISTIC`) **dipakai bersama** dengan perusahaan lain, "PMPakis" (PT Panen Mutiara Pakis / "Prama Pakis" secara informal), dipisahkan lewat kolom `GeneralLedger.BranchID` — `'012'` = PMPersada (Prama Tuban), `'011'` = PMPakis. Ketiga database lainnya (`pmputra/utama`, `pmputra/logistik`, `pmpersada/utama`) masing-masing 100% satu `BranchID` saja — bersih, tidak perlu filter tambahan. **Setiap query terhadap `pmpersada`+`logistik` WAJIB menambahkan `AND gl.BranchID = '012'`** supaya tidak ikut menghitung transaksi PMPakis (dikonfirmasi live: akun Piutang `1111` dan Pendapatan `4001` di database ini sama-sama dipakai oleh kedua perusahaan, bukan eksklusif milik PMPersada).

## Cakupan

- Modul **Penjualan**: tren bulanan saja (per keputusan user — daftar transaksi per Agen sudah/akan ada di modul Transaksi terpisah, bukan cakupan ini).
- Modul **Piutang**: total piutang saat ini + tren pergerakan bulanan (bertambah/tertagih), **tanpa breakdown per Agen** (tidak ada sumber data reliabel untuk itu — lihat Latar Belakang).
- Kedua modul: **read-only**, mengikuti pola modul Keuangan (tidak ada input/pencatatan transaksi baru dari aplikasi ini).
- Kedua PT (`pmputra`, `pmpersada`), kedua database per PT (`utama`, `logistik`).

**Di luar cakupan:**
- Breakdown/daftar piutang per Agen (ditunda — perlu sumber data yang jelas, bukan bagian pekerjaan ini).
- Pencatatan Pemesanan/Pembayaran baru dari aplikasi ini.
- Modul Transaksi (daftar transaksi per Agen) — modul terpisah, bukan cakupan ini.

## Arsitektur

**Satu modul query bersama**, bukan file terduplikasi per PT (berbeda dari pola Keuangan) — karena skema `PMP_Pemesanan`/`PMP_Agen`/`ChartOfAccount` (struktur kolom) identik persis di kedua PT; yang berbeda cuma *nilai* (nomor akun GL Piutang mana yang relevan per PT+label), bukan struktur/logika query.

`src/lib/queries/penjualan-piutang.ts`:
- `getPenjualanTrend(kode: string, months = 12): Promise<PenjualanTrendData>`
- `getPiutangSummary(kode: string): Promise<PiutangSummaryData>`

Keduanya menerima `kode` (`"pmputra"` | `"pmpersada"`) sebagai parameter, memanggil `getCompanyPool(kode, label)` untuk `label` `"utama"` dan `"logistik"`, dijalankan paralel via `Promise.all`.

Dua konstanta konfigurasi per (kode, label): satu untuk akun Piutang, satu untuk akun Pendapatan/Penjualan (pola sama seperti `HPP_BERSIH_ACCOUNTS`). Baris `pmpersada`+`logistik` di kedua konstanta **wajib difilter `BranchID='012'`** di query-nya (lihat Latar Belakang) — field `requiresBranchFilter` menandai baris mana yang butuh ini, supaya implementer tidak lupa:

```ts
const PIUTANG_ACCOUNTS: { kode: string; label: CompanyKoneksiLabel; accountNo: string; displayName: string; requiresBranchFilter?: boolean }[] = [
  { kode: "pmputra", label: "utama", accountNo: "1115", displayName: "Piutang Agen" },
  { kode: "pmputra", label: "logistik", accountNo: "1111", displayName: "Piutang Jasa Usaha" },
  { kode: "pmpersada", label: "utama", accountNo: "1115", displayName: "Piutang Agen" },
  { kode: "pmpersada", label: "logistik", accountNo: "1111", displayName: "Piutang Reguler", requiresBranchFilter: true },
];

const PENJUALAN_ACCOUNTS: { kode: string; label: CompanyKoneksiLabel; accountNo: string; displayName: string; requiresBranchFilter?: boolean }[] = [
  { kode: "pmputra", label: "utama", accountNo: "4001", displayName: "Pendapatan Balok Kecil" },
  { kode: "pmputra", label: "utama", accountNo: "4002", displayName: "Pendapatan Balok Besar" },
  { kode: "pmputra", label: "logistik", accountNo: "4001", displayName: "Pendapatan Reguler" },
  { kode: "pmpersada", label: "utama", accountNo: "4004", displayName: "Pendapatan Balok Kecil" },
  { kode: "pmpersada", label: "utama", accountNo: "4005", displayName: "Pendapatan Balok Besar" },
  { kode: "pmpersada", label: "logistik", accountNo: "4001", displayName: "Pendapatan Reguler", requiresBranchFilter: true },
];
```

**Semua nomor akun di atas SUDAH dikonfirmasi live via cross-check dengan accounting PMPutra dan PMPersada (17-18 Sep 2026)** — bukan lagi asumsi kerja. Ringkasan verifikasi:

- **Piutang**: setiap akun di atas dikonfirmasi 100% terhubung ke transaksi `PMP_PEMESANAN` (order es riil), bukan jurnal manual. Akun `1114 "Piutang Lainnya"` (pmpersada/logistik) dikonfirmasi **BUKAN** piutang pelanggan sama sekali — itu piutang antar-perusahaan (PMPutra ↔ PMPersada) — dikecualikan total dari perhitungan.
- **Pendapatan/Penjualan**: akun-akun di atas 100% terhubung ke `PMP_PEMESANAN`. Akun "Jasa Logistik"/"Jasa Logistik Luar" (di database `logistik` kedua PT) dikonfirmasi terhubung ke `PMP_PENJADWALAN` (penjadwalan armada) + jurnal manual — pendapatan sewa-angkut pihak luar, **bukan penjualan es** — dikecualikan. Akun "Potongan Penjualan"/"Potongan Pendapatan" dikonfirmasi diskon riil ke Agen (kalau nanti dibutuhkan sebagai pengurang, gunakan akun ini secara terpisah — TIDAK termasuk dalam `PENJUALAN_ACCOUNTS` di atas karena cakupan modul ini hanya tren kantong+Rp kotor, bukan breakdown diskon). Akun "Pendapatan Lain Lain" dikonfirmasi di luar operasional inti — dikecualikan.
- **BranchID**: hanya `pmpersada`+`logistik` yang perlu filter (akun `1111` dan `4001` di database itu dikonfirmasi dipakai bersama oleh PMPersada `BranchID='012'` dan PMPakis `BranchID='011'` — tanpa filter ini, angka PMPersada akan ikut menghitung transaksi PMPakis, ~6-9% dari total).

## Data Model

```ts
export interface PenjualanTrendMonth {
  month: string; // "2026-01"
  kantongKecil: number;
  kantongBesar: number;
  kantongTotal: number;
  pendapatanRp: number; // dari GL, utama + logistik digabung
}
export interface PenjualanTrendData {
  months: PenjualanTrendMonth[]; // 12 bulan terakhir
  totalKantongTahunIni: number;
  totalPendapatanTahunIni: number;
}

export interface PiutangTrendMonth {
  month: string;
  piutangBaru: number;   // SUM(Debit) akun Piutang bulan itu
  piutangTertagih: number; // SUM(Credit) akun Piutang bulan itu
  netMovement: number;   // piutangBaru - piutangTertagih
}
export interface PiutangSummaryData {
  totalPiutangSaatIni: number; // saldo GL akun Piutang s/d hari ini, utama+logistik
  totalPiutangUtama: number;
  totalPiutangLogistik: number;
  months: PiutangTrendMonth[]; // 12 bulan terakhir
}
```

**Query Penjualan** (per label, lalu digabung): kantong dari `PMP_Pemesanan` (`WHERE Status='3' AND ISNULL(IsVoid,0)=0 AND ISNULL(IsDeleted,0)=0`, `GROUP BY MONTH/YEAR(Tanggal)`) — pola identik `getMonthlyBalokRealisasi` yang sudah ada di `hpp-bersih-pmputra.ts`. Pendapatan Rupiah dari `GeneralLedger` × `ChartOfAccount` **filter eksplisit ke `PENJUALAN_ACCOUNTS`** (bukan prefix akun `4` mentah — itu akan ikut menghitung pendapatan Jasa Logistik yang bukan penjualan es). Baris dengan `requiresBranchFilter: true` WAJIB menambahkan `AND gl.BranchID = '012'` di WHERE clause-nya.

**Query Piutang**: saldo saat ini = `SUM(Debit) - SUM(Credit)` dari `GeneralLedger` untuk `ChartOfAccountID` yang cocok `PIUTANG_ACCOUNTS`, tanpa batas tanggal (s/d hari ini) — pola identik `balance-sheet-pmputra.ts`. Tren bulanan = `SUM(Debit)`/`SUM(Credit)` per bulan untuk akun yang sama, 12 bulan terakhir. Sama seperti Penjualan, baris `requiresBranchFilter: true` (saat ini hanya pmpersada/logistik) WAJIB menambahkan `AND gl.BranchID = '012'`.

## Halaman & Routing

- `src/app/pmputra/penjualan/page.tsx`, `src/app/pmputra/piutang/page.tsx` — menggantikan placeholder `[modul]` untuk slug itu (pola identik `keuangan/page.tsx`).
- `src/app/pmpersada/(dashboard)/penjualan/page.tsx`, `src/app/pmpersada/(dashboard)/piutang/page.tsx` — sama, di dalam route group `(dashboard)`.
- Guard: `requirePmputra()` / `requirePmpersada()` yang sudah ada, tanpa perubahan.

**Halaman Penjualan:** `KpiCard` untuk total kantong & total Rp tahun berjalan, lalu tabel/grafik tren 12 bulan (kantong kecil/besar/total + Rp per bulan) — reuse `SimpleBarChart`/pola `HPPBersihPanel` yang sudah ada untuk navigasi tahun.

**Halaman Piutang:** `KpiCard` untuk total piutang saat ini (gabungan + per label utama/logistik), lalu tabel/grafik tren pergerakan 12 bulan (piutang baru vs tertagih vs net per bulan).

Tidak ada form, tombol simpan, atau server action penulis data — murni pembacaan, sama seperti halaman Keuangan.

## Testing

Tidak ada test runner di proyek ini. Verifikasi: `npx tsc --noEmit`, `npx eslint`, dan live check di browser untuk kedua PT — angka kantong tren Penjualan cocok manual-check terhadap `PMP_Pemesanan` (query langsung), total Piutang & Pendapatan `pmpersada`/`logistik` HARUS lebih kecil dari saldo akun `1111`/`4001` mentah (tanpa filter `BranchID`) — kalau sama persis berarti filter `BranchID='012'` tidak terpasang/tidak jalan. Pastikan halaman Keuangan pmputra/pmpersada tidak berubah (regresi check) — halaman Keuangan sendiri TIDAK perlu filter `BranchID` karena hitungannya dari prefix akun `4`/`1`-`3` secara keseluruhan (pola lama, di luar cakupan pekerjaan ini), bukan dari `PENJUALAN_ACCOUNTS`/`PIUTANG_ACCOUNTS`.
