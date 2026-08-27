# Modul Laporan — Fondasi Cutoff-Shift & Tahap 1 (Stok Bahan Baku)

## Konteks

"Modul Laporan" adalah kebutuhan besar dengan 5 tahapan (Stok Bahan Baku,
Aktivitas Produksi, Aktivitas Muatan Distribusi, Aktivitas Keuangan
Operasional, dan panel gabungan lintas-shift) yang mencatat aktivitas 3
divisi (Driver, Staf Operasional, Staf Produksi) dengan periode kerja
shift yang beririsan dengan cutoff penjualan yang sudah ada.

Spec ini HANYA mencakup dua hal, disepakati sebagai sub-proyek pertama:

1. **Fondasi cutoff-shift** — utilitas bersama yang akan dipakai oleh
   seluruh 5 tahap ke depannya.
2. **Tahap 1: Stok Bahan Baku** — pencatatan stok Kantong Plastik (10 KG
   & 5 KG) dan Ikat Kabel per shift, untuk **MKEsindo saja**.

Tahap 2–5, dan replikasi ke PMPersada/PMPutra, adalah sub-proyek terpisah
di masa depan — lihat "Non-Goals" di bawah.

## Non-Goals (sengaja di luar cakupan spec ini)

- Tahap 2 (Aktivitas Produksi/Tim Produksi), Tahap 3 (Muatan Distribusi),
  Tahap 4 (Keuangan Operasional) — masing-masing sub-proyek sendiri.
- Replikasi ke PMPersada atau PMPutra — PMPutra bahkan belum punya
  infrastruktur produksi-app/driver-app sama sekali; ini menyusul setelah
  pola Tahap 1 terbukti benar di MKEsindo.
- Cutoff shift penjualan ("Distribusi") tidak dipakai oleh Tahap 1 sama
  sekali (Tahap 1 murni cutoff kerja) — namun fondasi tetap mendukung
  keduanya karena Tahap 3 nanti butuh cutoff penjualan.

## Bagian 1: Fondasi Cutoff-Shift

### Masalah

Sistem sudah mengenal satu titik rollover harian (`ROLLOVER_HOUR = 14` di
[`business-date.ts`](../../../src/lib/business-date.ts)) dan label 3 shift
kerja (`SHIFT_LABEL`, 07:00/15:00/23:00, di
[`produksi-shift.ts`](../../../src/lib/produksi-shift.ts)) — tapi belum
ada yang menggabungkan keduanya: "jam sekian WIB itu shift keberapa, dan
tanggal usaha (label) berapa?"

### Tabel Cutoff (final, dikonfirmasi user)

**Cutoff Kerja** ("work") — dipakai Tahap 1 (dan nantinya Tahap 2 & 4):

| Shift | Jendela waktu nyata (WIB) |
|---|---|
| Shift 1 | 07:00 – 14:59 |
| Shift 2 | 15:00 – 22:59 |
| Shift 3 | 23:00 – 06:59 (lintas tengah malam) |

**Cutoff Penjualan** ("sales") — TIDAK dipakai Tahap 1, disiapkan untuk
Tahap 3 nanti:

| Shift | Jendela waktu nyata (WIB) |
|---|---|
| Shift 1 | 07:00 – 13:59 |
| Shift 2 | 14:00 – 22:59 |
| Shift 3 | 23:00 – 06:59 (lintas tengah malam) |

Satu-satunya perbedaan antara keduanya: batas antara Shift 1 dan Shift 2
ada di jam 14 (sales, sama seperti `ROLLOVER_HOUR` yang sudah ada) vs jam
15 (work). Batas Shift 3 ↔ Shift 1 (jam 07:00) dan Shift 2 ↔ Shift 3 (jam
23:00) sama untuk keduanya.

**Label tanggal usaha**: satu siklus shift (Shift 2 sore → Shift 3 malam →
Shift 1 pagi keesokan harinya) semuanya diberi label tanggal yang SAMA —
tanggal dari Shift 1-nya (hari setelah Shift 2 dimulai). Ini persis sama
dengan aturan rollover 14:00 yang sudah ada di `getBusinessDate()`/
`getBusinessDateWithRollover()`, HANYA beda titik jamnya untuk "work"
(15) vs yang sudah ada (14, tetap dipakai untuk "sales").

**Urutan kronologis PENTING**: dalam satu tanggal usaha D, urutan
kejadian NYATA adalah Shift 2 (mulai duluan, sore hari D-1) → Shift 3
(malam D-1 ke pagi D) → Shift 1 (pagi D). Angka Shift (1/2/3) TIDAK
merepresentasikan urutan kronologis — jangan pernah `ORDER BY Shift ASC`
untuk mengurutkan riwayat; selalu urutkan berdasarkan waktu mulai
sesungguhnya (lihat `getShiftWindow` di bawah).

### Desain: `src/lib/report-shift.ts` (baru)

Reuse penuh dari `getBusinessDateWithRollover()` yang sudah ada — tidak
membangun ulang rollover, hanya menambah pemetaan jam→shift di atasnya.

```ts
export type ReportShiftKind = "sales" | "work";
export type ShiftNumber = 1 | 2 | 3;

export const REPORT_SHIFT_ROLLOVER_HOUR: Record<ReportShiftKind, number> = {
  sales: 14, // sama dengan ROLLOVER_HOUR yang sudah ada
  work: 15,
};

// Shift keberapa (1/2/3) untuk sebuah jam WIB (0-23), tergantung kind.
// Shift1: 07:00 sampai (rolloverHour - 1):59. Shift2: rolloverHour:00
// sampai 22:59. Shift3: 23:00 sampai 06:59.
export function getShiftNumber(wibHour: number, kind: ReportShiftKind): ShiftNumber { ... }

// Shift + tanggal usaha (label) untuk instant `now` — dipakai untuk tahu
// "sekarang ini shift & tanggal usaha berapa" (mis. saat mobile app
// dibuka untuk mengisi data shift berjalan).
export function getReportShift(kind: ReportShiftKind, now: Date = new Date()): { shift: ShiftNumber; businessDate: Date } { ... }

// Jendela waktu nyata (naive-WIB, lihat catatan konvensi di bawah) untuk
// sebuah (businessDate, shift, kind) tertentu — dipakai untuk mengurutkan
// riwayat secara kronologis dan (nanti, Tahap 3) memfilter data by shift.
export function getShiftWindow(businessDate: Date, shift: ShiftNumber, kind: ReportShiftKind): { start: Date; end: Date } { ... }
```

**Catatan konvensi (wajib dibaca sebelum implementasi)**: sesi hari ini
menemukan bug nyata karena dua kolom (`SalesOrder.TransDate` vs
`DashboardPengirimanJadwal.JamJadwal`) diam-diam memakai dua konvensi
berbeda (naive-WIB vs true-UTC) tanpa dokumentasi — lihat memori
`transdate-wib-utc-boundary-bug`. Untuk menghindari kelas bug yang sama,
`getShiftWindow` mengembalikan Date **naive-WIB** (raw UTC-component
value-nya ADALAH nilai jam dinding WIB, dibangun via `Date.UTC(...)`,
persis pola `getNaiveWibTransDate`/`combineDateAndTime`) — BUKAN true-UTC.
Setiap tempat yang membandingkan nilai ini dengan sesuatu yang true-UTC
(mis. `JamJadwal`, kalau dipakai nanti di Tahap 3) WAJIB memakai
`naiveWibToUtcInstant()`/`utcInstantToWibDisplay()` yang sudah ada di
`business-date.ts` — jangan pernah bandingkan mentah-mentah.

## Bagian 2: Akses Staf Operasional — lewat modul `/mkesindo/laporan`, bukan app terpisah

### Keputusan (revisi dari draf awal)

Tidak ada `operasional-app`, dan tidak ada flag role baru (`isOperasional`)
di Postgres/`auth.ts`/`next-auth.d.ts`. Staf Operasional memakai
**sistem izin modul yang sudah ada** — sama seperti peran terbatas
lainnya di app ini:

1. Modul baru `"laporan"` ditambahkan ke `MODULE_KEYS`/`MODULE_LABEL`
   ([`permissions.ts`](../../../src/lib/permissions.ts) baris 6-9).
2. Halaman `/mkesindo/laporan` digerbangi `requireModuleAccess("laporan")`
   — pola generik yang sama dipakai modul desktop lain (Pengiriman,
   Penjualan, dst; Direktur/Superadmin otomatis lolos lewat
   `canAccessAllPT`).
3. Lewat **editor Peran yang sudah ada**
   ([`peran-editor.tsx`](../../../src/components/dashboard/peran-editor.tsx)),
   admin membuat Peran baru "Staf Operasional" dan memberinya `canEdit`
   pada modul "laporan" saja (tidak ada modul lain) — TIDAK perlu
   perubahan kode apa pun untuk ini, editor Peran & grid izin sudah
   generik untuk modul apa pun di `MODULE_KEYS`.
4. Di dalam halaman `/mkesindo/laporan` sendiri: `canEdit` pada modul
   "laporan" menentukan apakah kartu-kartu input (Bagian 4) ditampilkan;
   `canView`-saja menampilkan versi read-only (tabel riwayat).

Ini menghilangkan seluruh pekerjaan app-shell/bottom-nav/tab-shell baru,
dan tidak menyentuh `auth.ts`, `next-auth.d.ts`, atau skema Postgres sama
sekali — modul "laporan" bekerja persis seperti modul desktop lain yang
sudah ada.

### Staf Produksi — tidak berubah

Staf Produksi tetap memakai `isProduksi`/`produksi-app` yang sudah ada
(lihat Bagian 4) — instruksi user hanya menghapus `operasional-app`,
bukan mengubah cara Staf Produksi mengakses bagiannya.

## Bagian 3: Skema Data Tahap 1

### Prinsip kunci: saldo "sisa" dihitung saat baca, tidak disimpan

User memilih data **bebas diedit**. Kalau saldo akhir disimpan sebagai
kolom statis per baris, koreksi pada shift lama akan meninggalkan semua
saldo shift-shift setelahnya jadi basi. Solusi: simpan HANYA angka
mentah per shift, hitung saldo berjalan via SQL window function
(`SUM(...) OVER (... ORDER BY ShiftMulai ROWS UNBOUNDED PRECEDING)`) —
setiap kali dibaca, otomatis konsisten terhadap seluruh riwayat, termasuk
setelah ada koreksi ke shift manapun.

### Tabel baru: `DashboardStokBahanBakuShift` (MSSQL — tabel dashboard-only,
mengikuti pola `DashboardProduksiBatch`/`DashboardPengirimanBBM`, bukan
Postgres, karena tidak ada padanan di ERP desktop)

| Kolom | Tipe | Keterangan |
|---|---|---|
| `StokBahanBakuID` | `BIGINT IDENTITY PK` | |
| `TanggalUsaha` | `DATE` | Label tanggal usaha (dari `getReportShift("work", ...).businessDate`) |
| `Shift` | `TINYINT` | 1/2/3 |
| `ShiftMulai` | `DATETIME` | Naive-WIB — awal jendela shift ini (dari `getShiftWindow(...).start`) — **kunci pengurutan kronologis**, jangan pernah urutkan pakai `Shift` mentah |
| `JenisBarang` | `VARCHAR(20)` | `'Plastik10KG'` \| `'Plastik5KG'` \| `'IkatKabel'` |
| `StokMasukGudang` | `INT NOT NULL DEFAULT 0` | Lembar/pcs masuk gudang shift ini (diisi Staf Operasional) |
| `StokMasukInventoriOperasional` | `INT NOT NULL DEFAULT 0` | Lembar/pcs dipindah gudang → inventori operasional shift ini (diisi Staf Operasional) |
| `StokDipakaiProduksi` | `INT NOT NULL DEFAULT 0` | Dipakai Staf Produksi shift ini (diisi Staf Produksi) |
| `StokRusakProduksi` | `INT NOT NULL DEFAULT 0` | Rusak shift ini (diisi Staf Produksi) |
| `OperasionalAkunID` | `INT NULL` | Siapa yang mengisi bagian Operasional |
| `OperasionalDiisiPada` | `DATETIME NULL` | |
| `ProduksiAkunID` | `INT NULL` | Siapa yang mengisi bagian Produksi |
| `ProduksiDiisiPada` | `DATETIME NULL` | |
| `CreatedDate`, `ModifiedDate` | `DATETIME DEFAULT GETDATE()` | Audit timestamp biasa (true-UTC, sama seperti kolom `ModifiedDate` lain di app ini — bukan business-date field) |

Unique constraint: `(TanggalUsaha, Shift, JenisBarang)` — satu baris per
kombinasi shift+barang (upsert, bukan insert baru tiap kali staf mengisi
ulang).

### Tabel baru: `DashboardStokBahanBakuSaldoAwal`

Satu baris per `JenisBarang`, diisi SEKALI secara manual saat modul ini
pertama kali dipakai (oleh Superadmin/Direktur — bukan Staf
Operasional/Produksi), jadi titik nol untuk perhitungan saldo berjalan.

| Kolom | Tipe |
|---|---|
| `JenisBarang` | `VARCHAR(20) PK` |
| `SaldoAwalGudang` | `INT NOT NULL DEFAULT 0` |
| `SaldoAwalInventoriOperasional` | `INT NOT NULL DEFAULT 0` |
| `DiisiOlehAkunID`, `ModifiedDate` | audit |

### Rumus saldo berjalan (dihitung di query, bukan disimpan)

Untuk baris shift `n` (diurutkan `ORDER BY ShiftMulai`):

```
SisaGudangAkhir(n)      = SaldoAwalGudang
                         + SUM(StokMasukGudang - StokMasukInventoriOperasional) [shift 1..n]

SisaInventoriAkhir(n)   = SaldoAwalInventoriOperasional
                         + SUM(StokMasukInventoriOperasional - StokDipakaiProduksi - StokRusakProduksi) [shift 1..n]
```

`SisaGudangAwal`/`SisaInventoriAwal` shift `n` = nilai `SisaXAkhir` shift
`n-1` (atau `SaldoAwalX` kalau `n` adalah baris paling awal).

### Bundle/Pack (tampilan saja, tidak disimpan)

```ts
function toBundle(lembar: number): number {
  return Math.ceil(lembar / 100); // 100 lembar tepat = 1 bundle, 0 = 0
}
```

Berlaku sama untuk Plastik10KG, Plastik5KG (unit "Bundle"), dan IkatKabel
(unit "Pack").

## Bagian 4: Alur UI

### Halaman `/mkesindo/laporan` (baru — module key `"laporan"`)

Satu halaman, tampilannya bergantung pada izin akun yang login (lihat
Bagian 2):

- **`canEdit` pada "laporan" (Staf Operasional)**: menampilkan shift
  kerja SEKARANG (dari `getReportShift("work")`) dengan 3 kartu (Plastik
  10KG, Plastik 5KG, Ikat Kabel), masing-masing berisi saldo gudang &
  inventori operasional awal shift ini (read-only, hasil hitung), input
  "Masuk Gudang" & "Masuk Inventori Operasional", dan saldo akhir hasil
  hitung real-time saat mengetik. Di bawahnya, tabel riwayat shift-shift
  sebelumnya (`ShiftMulai DESC`) yang barisnya **tetap bisa dibuka &
  diedit ulang** (sesuai keputusan "bebas diedit"), bukan murni tampilan.
- **`canView`-saja (mis. Direktur/manajemen)**: tabel riwayat yang sama
  persis, TANPA kartu input — murni untuk MELIHAT (TanggalUsaha, Shift,
  JenisBarang, semua angka mentah + saldo berjalan lembar & bundle,
  siapa yang mengisi tiap bagian).
- Karena Staf Operasional kemungkinan mengakses ini dari ponsel di
  lapangan, layout kartu input harus responsif (bukan tabel lebar) —
  bukan berarti app-shell terpisah, cukup halaman dashboard biasa yang
  wajar dilihat di layar sempit.

### Tab baru "Bahan Baku" di `produksi-app` (role `isProduksi`, TIDAK berubah dari draf awal)

- Menampilkan shift kerja sekarang, per barang: berapa yang sudah masuk
  ke inventori operasional shift ini (read-only di sisi Produksi, diisi
  Staf Operasional lewat `/mkesindo/laporan` — bisa kosong/"Belum diisi"
  kalau belum sempat diisi), input "Dipakai" & "Rusak", saldo inventori
  produksi akhir hasil hitung.
- Ada juga daftar riwayat shift sebelumnya yang barisnya tetap bisa
  dibuka & diedit ulang (field "Dipakai"/"Rusak" saja — field milik Staf
  Operasional tetap read-only di sisi ini, dan hanya bisa diubah lewat
  `/mkesindo/laporan`).

## Ringkasan Keputusan yang Sudah Dikonfirmasi

- Cutoff kerja: 07:00/15:00/23:00. Cutoff penjualan: 07:00/14:00/23:00
  (tabel awal user ada celah/tumpang-tindih — sudah dikoreksi jadi bersih).
- Bundle/Pack = `ceil(lembar/100)` murni.
- Satu baris ringkas per shift per barang (bukan log transaksi).
- Staf Operasional = Peran baru + izin `canEdit` modul "laporan" yang
  sudah ada (bukan flag/app baru) — input & riwayat sama-sama di
  `/mkesindo/laporan`.
- Cakupan: MKEsindo saja untuk sub-proyek ini.
- Saldo awal: diisi manual sekali (tabel `DashboardStokBahanBakuSaldoAwal`).
- Data bebas diedit → saldo dihitung saat baca (window function), tidak
  disimpan statis.
