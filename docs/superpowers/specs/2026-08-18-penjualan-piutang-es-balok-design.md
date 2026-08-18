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

Satu konstanta konfigurasi per (kode, label) untuk akun Piutang yang dihitung (pola sama seperti `HPP_BERSIH_ACCOUNTS`):

```ts
const PIUTANG_ACCOUNTS: { kode: string; label: CompanyKoneksiLabel; accountNo: string; displayName: string }[] = [
  { kode: "pmputra", label: "utama", accountNo: "1115", displayName: "Piutang Agen" },
  { kode: "pmputra", label: "logistik", accountNo: "1111", displayName: "Piutang Jasa Usaha" },
  { kode: "pmpersada", label: "utama", accountNo: "1115", displayName: "Piutang Agen" },
  { kode: "pmpersada", label: "logistik", accountNo: "1111", displayName: "Piutang Reguler" },
];
```

**Catatan/asumsi kerja yang perlu dikonfirmasi user:** nomor akun di atas dipilih dari akun "Piutang..." dengan saldo GL terbesar/paling relevan per (PT, label) — hasil eksplorasi live, BUKAN konfirmasi eksplisit dari user. Contoh saldo saat eksplorasi (18 Agu 2026): pmputra/utama 1115 "Piutang Agen" = Rp 263.981.437; pmputra/logistik 1111 "Piutang Jasa Usaha" = Rp 99.550.633; pmpersada/utama 1115 "Piutang Agen" = Rp 425.898.859; pmpersada/logistik 1111 "Piutang Reguler" = Rp 634.578.510 (ada kandidat kedua di logistik pmpersada, "Piutang Logistik" 1112 = Rp 41.612.500, saat ini tidak diikutkan — lebih kecil, kemungkinan bukan akun utama). Kalau ternyata salah pilih akun, ini titik yang perlu dikoreksi paling dulu.

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

**Query Penjualan** (per label, lalu digabung): kantong dari `PMP_Pemesanan` (`WHERE Status='3' AND ISNULL(IsVoid,0)=0 AND ISNULL(IsDeleted,0)=0`, `GROUP BY MONTH/YEAR(Tanggal)`) — pola identik `getMonthlyBalokRealisasi` yang sudah ada di `hpp-bersih-pmputra.ts`. Pendapatan Rupiah dari `GeneralLedger` × `ChartOfAccount` filter prefix akun `4` (Pendapatan) — pola identik `pnl-pmputra.ts`.

**Query Piutang**: saldo saat ini = `SUM(Debit) - SUM(Credit)` dari `GeneralLedger` untuk `ChartOfAccountID` yang cocok `PIUTANG_ACCOUNTS`, tanpa batas tanggal (s/d hari ini) — pola identik `balance-sheet-pmputra.ts`. Tren bulanan = `SUM(Debit)`/`SUM(Credit)` per bulan untuk akun yang sama, 12 bulan terakhir.

## Halaman & Routing

- `src/app/pmputra/penjualan/page.tsx`, `src/app/pmputra/piutang/page.tsx` — menggantikan placeholder `[modul]` untuk slug itu (pola identik `keuangan/page.tsx`).
- `src/app/pmpersada/(dashboard)/penjualan/page.tsx`, `src/app/pmpersada/(dashboard)/piutang/page.tsx` — sama, di dalam route group `(dashboard)`.
- Guard: `requirePmputra()` / `requirePmpersada()` yang sudah ada, tanpa perubahan.

**Halaman Penjualan:** `KpiCard` untuk total kantong & total Rp tahun berjalan, lalu tabel/grafik tren 12 bulan (kantong kecil/besar/total + Rp per bulan) — reuse `SimpleBarChart`/pola `HPPBersihPanel` yang sudah ada untuk navigasi tahun.

**Halaman Piutang:** `KpiCard` untuk total piutang saat ini (gabungan + per label utama/logistik), lalu tabel/grafik tren pergerakan 12 bulan (piutang baru vs tertagih vs net per bulan).

Tidak ada form, tombol simpan, atau server action penulis data — murni pembacaan, sama seperti halaman Keuangan.

## Testing

Tidak ada test runner di proyek ini. Verifikasi: `npx tsc --noEmit`, `npx eslint`, dan live check di browser untuk kedua PT — angka kantong tren Penjualan cocok manual-check terhadap `PMP_Pemesanan` (query langsung), angka Pendapatan cocok dengan yang sudah tampil di halaman Keuangan untuk periode yang sama, total Piutang cocok dengan saldo GL akun yang dipilih (query langsung terhadap `ChartOfAccount`/`GeneralLedger`). Pastikan halaman Keuangan pmputra/pmpersada tidak berubah (regresi check).
