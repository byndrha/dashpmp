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

## Bagian 2: Role & App Baru — Staf Operasional

### Kenapa perlu

Tahap 1 butuh dua pihak pengisi data: Staf Operasional (masuk gudang,
masuk ke inventori operasional) dan Staf Produksi (dipakai, rusak).
Staf Produksi sudah punya `isProduksi`/`produksi-app`. Staf Operasional
belum ada sama sekali sebagai role.

### Perubahan yang dibutuhkan (mengikuti pola `isDriver`/`isSatpam`/`isProduksi` persis)

1. **Postgres**: kolom baru `peran.is_operasional` (boolean, default
   false) — mirror `is_produksi` dkk.
2. **`src/lib/queries/akun.ts`**: tambah `isOperasional` ke
   `AkunRow`/`findAkunByUsername` query (~baris 20, 34, 56), ke
   `PeranRow` (~baris 297, 306, 316), dan fungsi baru
   `setPeranOperasional(peranId, isOperasional)` (mirror
   `setPeranProduksi`, ~baris 377).
3. **`src/lib/auth.ts`**: tambah `isOperasional` ke `AuthorizedUser`,
   query `authorize()`, dan callback `jwt()` (mirror baris 26/88/109).
4. **`src/types/next-auth.d.ts`**: tambah `isOperasional: boolean` ke
   `Session.user`, `User`, dan `JWT` (mirror baris 18/33/49).
5. **`src/lib/require-access.ts`**: `requireStafOperasional()` baru,
   mirror persis `requireProduksi()` (baris 92–97) — cek
   `session.user.isOperasional`.
6. **`src/components/dashboard/peran-editor.tsx`** +
   **`src/app/grup/akun/peran/actions.ts`**: tambah toggle "Staf
   Operasional" di kartu peran (mirror `isProduksi`/`toggleProduksi()`,
   baris 35/56-59) dan `setPeranOperasionalAction`.
7. **App shell baru**: `src/app/mkesindo/operasional-app/` — struktur
   route group `(tabs)` sama seperti `produksi-app`:
   - `(tabs)/layout.tsx` → `await requireStafOperasional()`.
   - `(tabs)/page.tsx` → tab utama: form isi shift berjalan.
   - `(tabs)/riwayat/page.tsx` → riwayat shift-shift sebelumnya
     (read-only).
   - Komponen: `src/components/operasional-app/operasional-tab-shell.tsx`
     (mirror `produksi-tab-shell.tsx` — keep-alive per tab, lazy-load
     per tab, `visited` Set, `loadingTab` overlay) +
     `bottom-nav.tsx` (mirror `produksi-app/bottom-nav.tsx`).
   - Actions: `src/app/mkesindo/operasional-app/actions.ts` (mirror
     `driver-app/actions.ts` — app baru dengan actions sendiri, bukan
     numpang ke modul desktop lain karena belum ada modul desktop
     "Operasional").
8. **Halaman desktop baru** `/mkesindo/laporan` — untuk melihat riwayat
   Tahap 1 (lihat Bagian 4). Ditambahkan sebagai module key baru
   `"laporan"` di `MODULE_KEYS`/`MODULE_LABEL`
   ([`permissions.ts`](../../../src/lib/permissions.ts) baris 6-9),
   digerbangi `requireModuleAccess("laporan")` seperti modul desktop
   lainnya (Direktur/Superadmin otomatis lolos via `canAccessAllPT`).

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

### `operasional-app` (baru, mobile-first — role `isOperasional`)

- Tab utama: menampilkan shift kerja SEKARANG (dari
  `getReportShift("work")`), dengan 3 kartu (Plastik 10KG, Plastik 5KG,
  Ikat Kabel) masing-masing berisi: saldo gudang & inventori operasional
  awal shift ini (read-only, hasil hitung), input "Masuk Gudang" & "Masuk
  Inventori Operasional", saldo akhir hasil hitung real-time saat mengetik.
- Tab Riwayat: daftar shift-shift sebelumnya, diurutkan terbaru dulu (by
  `ShiftMulai DESC`) — **tetap bisa diedit** (tap baris → form yang sama
  terbuka terisi nilai lama, sesuai keputusan "bebas diedit"), bukan
  murni tampilan.

### Tab baru "Bahan Baku" di `produksi-app` (role `isProduksi` — sudah tergerbang lewat layout yang ada)

- Menampilkan shift kerja sekarang, per barang: berapa yang sudah masuk
  ke inventori operasional shift ini (read-only di sisi Produksi, diisi
  Staf Operasional — bisa kosong/"Belum diisi" kalau Staf Operasional
  belum sempat input), input "Dipakai" & "Rusak", saldo inventori
  produksi akhir hasil hitung.
- Sama seperti `operasional-app`: ada tab/daftar riwayat shift sebelumnya
  yang barisnya tetap bisa dibuka & diedit ulang (field "Dipakai"/"Rusak"
  saja — field milik Staf Operasional tetap read-only di sisi ini).

### Halaman desktop `/mkesindo/laporan` (baru — module key `"laporan"`)

- Tabel riwayat: TanggalUsaha, Shift (label jam, mis. "Shift 2 (15:00)"),
  JenisBarang, semua angka mentah + saldo berjalan (lembar & bundle),
  siapa yang mengisi tiap bagian. Murni untuk MELIHAT (oversight
  Direktur/manajemen) — halaman ini sendiri tidak punya form edit; semua
  koreksi tetap dilakukan lewat mobile app masing-masing peran (lihat di
  atas), konsisten dengan siapa yang berwenang mengisi bagian mana.

## Ringkasan Keputusan yang Sudah Dikonfirmasi

- Cutoff kerja: 07:00/15:00/23:00. Cutoff penjualan: 07:00/14:00/23:00
  (tabel awal user ada celah/tumpang-tindih — sudah dikoreksi jadi bersih).
- Bundle/Pack = `ceil(lembar/100)` murni.
- Satu baris ringkas per shift per barang (bukan log transaksi).
- Staf Operasional = role & app baru (`isOperasional` / `operasional-app`).
- Cakupan: MKEsindo saja untuk sub-proyek ini.
- Saldo awal: diisi manual sekali (tabel `DashboardStokBahanBakuSaldoAwal`).
- Data bebas diedit → saldo dihitung saat baca (window function), tidak
  disimpan statis.
