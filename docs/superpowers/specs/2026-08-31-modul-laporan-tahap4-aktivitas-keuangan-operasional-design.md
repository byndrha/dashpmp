# Modul Laporan — Tahap 4 (Aktivitas Keuangan Operasional)

## Konteks

Sub-proyek keempat dari "Modul Laporan" (lihat [Tahap 1](2026-08-27-modul-laporan-stok-bahan-baku-design.md)
untuk fondasi cutoff-shift yang dipakai ulang di sini). Tahap 4 mencatat
**kas kecil** yang dipegang Staf Operasional per shift kerja: top-up kas
yang diterima, rincian tiap pengeluaran (dibelikan apa, berapa), dan saldo
berjalan — mengikuti pola persis Tahap 1 (saldo dihitung saat baca, bebas
diedit), hanya untuk uang, bukan barang, dan dengan rincian per transaksi
(bukan angka ringkas per shift) karena akuntabilitas kas butuh tahu untuk
apa uang dipakai.

Sebelum spec ini ditulis, dicek langsung: belum ada satu pun konsep kas
level shift/staf di codebase ini — yang sudah ada (`DashboardCashFlowDaily`/
`DashboardCashFlowExpense` di modul Keuangan PMPutra/PMPersada) adalah
entitas terpisah, per hari kalender, terkunci ke halaman manajemen
keuangan perusahaan, sama sekali tidak terkait modul "laporan" MKEsindo
atau akun Staf Operasional.

## Non-Goals

- **Hanya Staf Operasional** yang memegang/mencatat kas kecil ini — tidak
  melibatkan Driver atau Staf Produksi.
- **Tidak terhubung** ke `DashboardCashFlowDaily`/`DashboardCashFlowExpense`,
  COA, atau GeneralLedger yang sudah ada — entitas benar-benar terpisah,
  murni untuk laporan modul ini.
- **Tidak mengubah** Denda (Tahap 2) atau BBM (Tahap 3) — keduanya tetap
  berdiri sendiri, tidak digabung ke kas kecil ini meskipun sama-sama
  "keuangan operasional" secara konsep.
- Tahap 5 (panel gabungan lintas-shift) — sub-proyek terpisah.
- Replikasi ke PMPersada/PMPutra — MKEsindo saja, sama seperti tahap-tahap
  sebelumnya.

## Bagian 1: Skema Data

### Prinsip kunci: saldo berjalan dihitung saat baca (sama Tahap 1)

Data bebas diedit — kalau saldo akhir disimpan sebagai kolom statis,
koreksi pada shift lama akan meninggalkan semua saldo shift-shift
setelahnya jadi basi. Saldo dihitung via SQL window function setiap kali
dibaca, sama prinsip Tahap 1.

### Tabel baru: `DashboardKasKecilShift`

Satu baris per (TanggalUsaha, Shift) — cutoff **kerja** (rollover 15:00),
sama seperti Tahap 1/2.

| Kolom | Tipe | Keterangan |
|---|---|---|
| `KasKecilShiftID` | `INT IDENTITY PK` | |
| `TanggalUsaha` | `DATE NOT NULL` | dari `getReportShift("work", ...).businessDate` |
| `Shift` | `TINYINT NOT NULL` | |
| `ShiftMulai` | `DATETIME NOT NULL` | naive-WIB, dari `getShiftWindow(...).start` — kunci urutan kronologis, sama pola tabel-tabel Tahap 1/2 |
| `KasMasuk` | `DECIMAL(18,2) NOT NULL DEFAULT 0` | Top-up kas yang diterima Staf Operasional shift ini — bisa diisi ulang |
| `DiisiOlehAkunID` | `INT NULL` | |
| `CreatedDate`, `ModifiedDate` | `DATETIME DEFAULT GETDATE()` | |

Unique constraint: `(TanggalUsaha, Shift)`.

### Tabel baru: `DashboardKasKecilPengeluaran`

Rincian pengeluaran — banyak baris per shift, FK ke `KasKecilShiftID`
(pola sama seperti `DashboardAktivitasProduksiKehadiran` mereferensikan
`AktivitasID` di Tahap 2 — bukan menduplikasi TanggalUsaha+Shift).

| Kolom | Tipe | Keterangan |
|---|---|---|
| `PengeluaranID` | `INT IDENTITY PK` | |
| `KasKecilShiftID` | `INT NOT NULL` | FK app-level ke `DashboardKasKecilShift` |
| `Keterangan` | `VARCHAR(200) NOT NULL` | Dibelikan/dipakai untuk apa |
| `Nominal` | `DECIMAL(18,2) NOT NULL` | |
| `DicatatOlehAkunID` | `INT NOT NULL` | |
| `CreatedDate`, `ModifiedDate` | `DATETIME DEFAULT GETDATE()` | |

Baris bisa ditambah/dihapus bebas dalam satu shift (soft/hard delete —
lihat Global Constraints saat plan ditulis; hard delete cukup di sini
karena rincian pengeluaran bukan data historis yang dirujuk tabel lain,
beda dari `DashboardTimProduksiAnggota` yang harus soft-delete karena
dirujuk riwayat kehadiran).

### Tabel baru: `DashboardKasKecilSaldoAwal`

Satu baris saja (bukan per jenis barang seperti Tahap 1 — kas kecil cuma
satu pool), diisi manual sekali oleh Superadmin/Direktur, titik nol
perhitungan saldo berjalan.

| Kolom | Tipe |
|---|---|
| `SaldoAwal` | `DECIMAL(18,2) NOT NULL DEFAULT 0` |
| `DiisiOlehAkunID`, `ModifiedDate` | audit |

Tabel ini secara aplikasi selalu punya tepat satu baris (upsert
"UPDATE kalau ada, INSERT kalau belum" — pola sama seperti
`ensureAktivitasRow`, tanpa constraint fisik khusus, konsisten dengan
tabel Dashboard* lain di app ini yang menegakkan invarian di kode
aplikasi, bukan lewat DB constraint).

### Rumus saldo berjalan (dihitung di query, bukan disimpan)

Untuk baris shift `n` (diurutkan `ORDER BY ShiftMulai`):

```
TotalPengeluaran(n) = SUM(Nominal) semua DashboardKasKecilPengeluaran milik shift n

SaldoAkhir(n) = SaldoAwal + SUM(KasMasuk - TotalPengeluaran) [shift 1..n]
```

`SaldoAwal` shift `n` (ditampilkan sebagai konteks) = `SaldoAkhir` shift
`n-1`, atau `SaldoAwal` dari `DashboardKasKecilSaldoAwal` kalau `n` adalah
baris paling awal.

## Bagian 2: Alur UI

Tab baru **"Keuangan Operasional"** di `/mkesindo/laporan` yang sudah ada
(bergabung dengan Stok Bahan Baku, Aktivitas Produksi, Aktivitas Muatan
Distribusi) — akses sama persis pola Tahap 1:

- **`canEdit` pada "laporan" (Staf Operasional)**: kartu shift berjalan —
  saldo awal shift ini (read-only, hasil hitung), input "Kas Masuk
  (Top-up)", daftar rincian pengeluaran shift ini (tambah baris baru:
  keterangan + nominal; hapus baris), saldo akhir dihitung real-time saat
  mengetik. Di bawahnya, riwayat shift-shift sebelumnya (`ShiftMulai DESC`)
  yang barisnya tetap bisa dibuka & diedit ulang (ubah `KasMasuk`,
  tambah/hapus rincian pengeluaran) — konsisten "bebas diedit" Tahap 1/2.
- **`canView`-saja (mis. Direktur/manajemen)**: tabel riwayat yang sama
  persis, TANPA kartu input — TanggalUsaha, Shift, Kas Masuk, Total
  Pengeluaran (dengan rincian yang bisa di-expand), Saldo Akhir, siapa
  yang mengisi.
- Saldo awal (`DashboardKasKecilSaldoAwal`) diisi lewat kontrol kecil
  khusus Superadmin/Direktur (`canAccessAllPT`), sama pola Tahap 1.

## Ringkasan Keputusan yang Sudah Dikonfirmasi

- Hanya Staf Operasional yang terlibat — tidak melibatkan Driver/Staf
  Produksi.
- Rincian per transaksi pengeluaran (keterangan + nominal), bukan angka
  ringkas — beda dari Tahap 1 yang cukup angka per shift.
- Tidak terhubung ke Cash Flow Harian/COA/GeneralLedger yang sudah ada —
  entitas baru yang sepenuhnya terpisah.
- Saldo berjalan dihitung saat baca (window function), tidak disimpan
  statis — sama prinsip Tahap 1.
- Lokasi UI: tab baru "Keuangan Operasional" di `/mkesindo/laporan`,
  akses `canEdit`/`canView` sama pola Tahap 1.
- Cakupan: MKEsindo saja.
