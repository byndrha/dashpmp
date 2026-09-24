# Modul Mitra — Jenis Bisnis Es Balok (pmputra + pmpersada + pmpakis) — Design Spec

## Latar Belakang

`pmputra` (PT Prima Maesa Putra), `pmpersada` (PT Putra Maesa Persada), dan `pmpakis` (PT Panen Mutiara Pakis) sama-sama berjenis bisnis Es Balok. Modul Penjualan/Piutang ketiganya (pmputra+pmpersada) sudah live (`docs/superpowers/specs/2026-08-18-penjualan-piutang-es-balok-design.md`), menampilkan angka agregat per perusahaan saja. User meminta modul **Mitra** (pelanggan/Agen) dengan tampilan setara modul Mitra Es Kristal (MKEsindo) — termasuk detail per-Mitra, bukan cuma agregat.

`pmpakis` belum pernah punya modul apa pun di dashboard ini selain shell `(dashboard)/[modul]` placeholder — modul Mitra ini akan jadi modul pertamanya.

**Perbedaan mendasar dari Es Kristal, sudah diverifikasi langsung ke database live (read-only) sebelum spec ini ditulis:**

- Tabel master pelanggan Es Balok adalah **`PMP_Agen`** (bukan `BusinessPartner` standar ERP), dengan skema identik di kelima database: `AgenID` (PK, varchar, format `'01' + integer sequential per database, tanpa celah`), `Nama`, `MitraBisnisID` (konstan `'011'` di semua baris semua database — bukan pembeda apa pun), `Telepon`, `IsActive`, `BalokKecil`/`BalokBesar` (harga per unit), `MaksimumHutang`, `PiutangSaatIni`/`TabunganSaatIni` (**kolom mati, selalu 0** — jangan pernah dibaca), `PiutangSaldoAwal`/`TabunganSaldoAwal` (**valid** — saldo piutang/kelebihan bayar dibawa dari closing bulan sebelumnya, dikonfirmasi user), `IsDeleted`, `Code` (legacy, tidak konsisten, aman diabaikan/dikosongkan).
- Alamat/wilayah ada di tabel terpisah **`PMP_AgenDetail`** (`AgenDetailID`, `AgenID`, `Address1`, `Address2`, `RegionID`, `IsDeleted`) — `RegionID` mengacu ke **`PMP_Wilayah`** (`WilayahID`, `Nama`, `Telepon`, `IsDeleted`) yang **flat, tanpa hierarki Kecamatan**. Tidak ada kolom GPS di skema aslinya sama sekali.
- **Tidak ada konsep Term of Payment per-Mitra yang benar-benar berfungsi.** `PMP_MitraBisnis` punya kolom `JenisTempo`/`Interval` yang terlihat seperti TOP, tapi hanya berisi **satu baris generik** (`MitraBisnisID='011'`) yang dipakai semua Agen — tidak ada diferensiasi. **Keputusan: kosongkan/jangan tampilkan TOP untuk modul ini.**
- **Satuan fisik berbeda dari "kantong" (Es Kristal)**: Es Balok memakai **Balok Kecil** dan **Balok Besar**, dengan **1 Balok Besar = 2 Balok Kecil** (dikonfirmasi user) untuk metrik gabungan "Total Balok".
- **`AgenID` TIDAK konsisten lintas database untuk semua perusahaan** — dikonfirmasi live:
  - **pmputra**: `AgenID` sama persis antara database `utama` (`FINAC_ES_PO`) dan `logistik` (`FINAC_LOGISTIC_PO`) untuk 10 sampel yang dicek — aman dipakai sebagai kunci gabung.
  - **pmpersada**: `AgenID` **tidak cocok sama sekali** antara `utama` (`FINAC_ES_TB`) dan `logistik` (`FINAC_PMP_LOGISTIC`, database yang sama juga dipakai `pmpakis` lewat `GeneralLedger.BranchID='011'`) — 10/10 sampel mismatch, beberapa nama bahkan cocok ke banyak baris sekaligus. **Keputusan user: JANGAN coba gabungkan — tampilkan sebagai dua daftar/entri terpisah dengan badge sumber (Utama/Logistik) + AgenID masing-masing.**
  - **pmpakis**: punya database `utama` sendiri (`FINAC_ES_PAKIS`, 119 baris Agen) — TIDAK punya sisi logistik miliknya sendiri, tapi **melihat logistik yang sama persis dengan pmpersada** (lihat temuan berikut).
- **`PMP_Agen` di database logistik pmpersada (`FINAC_PMP_LOGISTIC`) TERNYATA BENAR-BENAR DIPAKAI BERSAMA pmpakis, bukan cuma "AgenID beda tapi milik pmpersada sendiri"** — dikonfirmasi live (investigasi kedua, setelah spec draf pertama):
  - 107 dari 119 (≈90%) nama Agen `pmpakis`/utama muncul PERSIS di `PMP_Agen` logistik pmpersada — bukan kebetulan, ini kumpulan pelanggan yang sama.
  - `PMP_Agen` **tidak punya kolom `BranchID` sama sekali** — tidak ada cara memfilternya di level tabel Agen.
  - `PMP_Pemesanan` (di database logistik yang sama) PUNYA `BranchID` (`'012'`=pmpersada, `'011'`=pmpakis) — tapi **56 dari 159 AgenID aktif tercatat bertransaksi di KEDUA BranchID sekaligus** (baris Agen yang identik dipakai order milik dua perusahaan berbeda) — jadi filter `BranchID` di level `PMP_Pemesanan` TIDAK menghasilkan pemisahan Agen yang bersih; 28 dari 186 baris Agen bahkan tidak punya order sama sekali (tidak bisa diklasifikasi ke branch manapun).
  - **Keputusan user**: tampilkan apa adanya, **berlabel jelas "Logistik (Bersama PMPersada & PMPakis)"**, dan **kedua perusahaan (pmpersada DAN pmpakis) melihat data logistik yang identik** — bukan diklaim eksklusif milik salah satu.
- **Hipotesis pembagian pendapatan 70%/30% (utama/logistik) TIDAK terbukti dan TIDAK divalidasi** — dicoba mencocokkan `PMP_Pemesanan.NoDokumen` yang sama antara dua database, tapi `AgenID` pada baris yang "cocok" itu selalu berbeda (indikasi kuat ini cuma kebetulan tabrakan nomor urut independen, bukan link asli). Dicek juga `PMP_Realisasi`, `PMP_Penyelesaian`, `PMP_Penjadwalan(+Detail)` — tidak ada kolom referensi silang database di manapun. **Keputusan: topik 70/30 split DI LUAR CAKUPAN modul ini, jadi investigasi terpisah nanti.**
- **Piutang per-Agen dari GeneralLedger — andal sebagian saja:**
  - `GeneralLedger.BusinessPartnerID` ada tapi **100% kosong** (0 dari 208.257 baris akun Piutang di pmputra/utama) — kolom mati, sama seperti `PMP_Agen.PiutangSaatIni`.
  - **Sisi debit (Piutang Baru dari pesanan)**: **100% andal** — `GeneralLedger.VoucherNo` untuk posting `PMP/SO/*` cocok PERSIS dengan `PMP_Pemesanan.NoDokumen`, diverifikasi 192.927/192.927 baris (100%) balik ke `AgenID` yang valid, konsisten sejak 2018.
  - **Sisi kredit (Pembayaran)**: hanya **perkiraan** — posting `PMP/AT/*` (`Type='PEMBAYARAN'`) punya `Memo` bebas teks (`'Agent <Nama> - Pembayaran'`), dicocokkan ke `PMP_Agen.Nama` (berhasil 100% pada sampel 1.170 baris 2026), TAPI **2 nama Agen aktif ternyata duplikat** (`PMP TUBAN` ×4, `SUGENG` ×2) sehingga ambigu untuk keduanya secara spesifik.
  - Posting `PMP/JU/*` ("Tabungan Agen", entri jurnal bulanan) **sama sekali tidak bisa dilacak ke Agen manapun** — nilainya signifikan (miliaran Rupiah per tahun), jadi saldo per-Agen yang dihitung dari SO+AT **tidak akan pas 100%** dengan saldo agregat perusahaan yang sudah tayang di `/pmputra/piutang` dkk.
  - **Keputusan: tampilkan "Piutang Baru" (andal) dan "Pembayaran" (berlabel perkiraan) terpisah, dengan catatan kecil bahwa totalnya mungkin tidak pas 100% dengan agregat perusahaan.**
- `AgenID` adalah **primary key clustered**, varchar biasa (bukan identity/computed) — insert duplikat GAGAL KERAS (SQL error 2627), tidak pernah diam-diam dobel. ID baru dihitung `'01' + (MAX(TRY_CAST(SUBSTRING(AgenID,3,10) AS INT)) + 1)`, per database (counter independen per perusahaan/database, bukan lintas perusahaan).

## Cakupan

- Modul **Mitra**: daftar (card grid) + CRUD penuh (tambah/edit/nonaktifkan/hapus, sama seperti Es Kristal) + detail per-Mitra (dialog, bukan halaman route — meniru pola Es Kristal).
- Tiga perusahaan: `pmputra`, `pmpersada`, `pmpakis`.
- **Pin lokasi (GPS)**: fitur baru, tidak ada di data asli — ditambahkan lewat tabel companion baru **`DashboardAgenLocation`** di **kelima database ERP** (`FINAC_ES_PO`, `FINAC_LOGISTIC_PO`, `FINAC_ES_TB`, `FINAC_PMP_LOGISTIC`, `FINAC_ES_PAKIS`) — bukan di Postgres, sesuai keputusan eksplisit user untuk mengikuti pola Es Kristal apa adanya walau berarti DDL ke 5 database sekaligus.

**Di luar cakupan:**

- Validasi/investigasi pembagian pendapatan 70/30 antara utama/logistik — topik terpisah, tidak diselesaikan lewat modul ini.
- Term of Payment per-Mitra — dikosongkan, tidak ada sumber data yang valid.
- Pencocokan otomatis Agen pmpersada utama↔logistik sebagai satu entitas — ditampilkan terpisah apa adanya.
- Kecamatan/sub-wilayah — `PMP_Wilayah` flat, tidak ada level di bawah Wilayah.

## Arsitektur

**Satu modul query bersama** `src/lib/queries/mitra-es-balok.ts`, parameterized by `kode` (`"pmputra"` | `"pmpersada"` | `"pmpakis"`) — skema `PMP_Agen`/`PMP_AgenDetail`/`PMP_Wilayah`/`DashboardAgenLocation` identik di semua database, hanya *nilai* koneksi yang beda (pola sama seperti `penjualan-piutang.ts`).

```ts
type SumberAgen = "utama" | "logistik";

// Koneksi fisik aktual di balik tiap (kode, sumber) -- BUKAN 1:1 dengan kode,
// karena logistik pmpersada & pmpakis adalah DATABASE YANG SAMA PERSIS
// (FINAC_PMP_LOGISTIC), dikonfirmasi live: PMP_Agen di dalamnya tidak punya
// kolom BranchID sama sekali dan 56/159 AgenID aktif bertransaksi di kedua
// BranchID PMP_Pemesanan sekaligus -- tidak ada pemisahan bersih yang mungkin.
// Keputusan user: tampilkan APA ADANYA, berlabel "Logistik (Bersama)", dan
// pmpersada+pmpakis MELIHAT DATA YANG SAMA PERSIS di sisi ini.
function resolveKoneksi(kode: string, sumber: SumberAgen): { kode: string; label: CompanyKoneksiLabel } {
  if (sumber === "logistik" && (kode === "pmpersada" || kode === "pmpakis")) {
    return { kode: "pmpersada", label: "logistik" }; // shared physical DB, always pmpersada's koneksi row
  }
  return { kode, label: sumber === "logistik" ? "logistik" : "utama" };
}

interface MitraSourceConfig {
  kode: string;
  sources: SumberAgen[]; // pmputra: ["utama","logistik"] MERGED by AgenID (aman, AgenID cocok)
                          // pmpersada: ["utama","logistik"] SEPARATE, never merged (AgenID tak cocok)
                          // pmpakis: ["utama","logistik"] SEPARATE -- "logistik" adalah data BERSAMA
                          //          dgn pmpersada (lihat resolveKoneksi), bukan milik pmpakis sendiri
}
```

Fungsi utama:
- `getMitraList(kode: string): Promise<MitraCard[]>` — untuk pmputra, satu `MitraCard` per `AgenID` gabungan utama+logistik (riwayat/piutang dijumlahkan dari kedua database). Untuk pmpersada & pmpakis, satu `MitraCard` per (sumber, AgenID) — kartu `sumber="logistik"` pada KEDUANYA berasal dari koneksi fisik yang sama (`resolveKoneksi`) dan akan menampilkan Mitra yang identik, dengan badge "Logistik (Bersama)" bukan "Logistik" polos.
- `getMitraDetail(kode: string, sumber: SumberAgen, agenId: string): Promise<MitraDetailData>` — untuk pmputra, `sumber` diabaikan (selalu gabungan); untuk pmpersada & pmpakis, `sumber` menentukan koneksi lewat `resolveKoneksi` (yang bisa jadi koneksi bersama).
- `createMitra(kode: string, sumber: SumberAgen, input): Promise<string>` — hitung `AgenID` baru dalam transaksi (retry on 2627), insert `PMP_Agen` + `PMP_AgenDetail`.
- `updateMitra`, `setMitraSuspended` (toggle `IsActive`), `deleteMitra` (soft, `IsDeleted=1`) — semua menerima `(kode, sumber, agenId, ...)`.
- `getWilayahOptions(kode, sumber)` — dari `PMP_Wilayah`.
- `setMitraLocation(kode, sumber, agenId, {latitude, longitude, alamat}, userId)` — MERGE ke `DashboardAgenLocation`, pola sama persis `mitra-location.ts`'s `setMitraLocation`.

**Konversi Balok**: `totalBalok = balokKecil + balokBesar * 2` — helper murni, dipakai di query kantong DAN di panel tampilan.

**Otorisasi Server Actions**: setiap Server Action mutasi (`createMitra`, `updateMitra`, `setMitraSuspended`, `deleteMitra`, `setMitraLocation`) WAJIB memanggil guard yang sama dengan halamannya (`requirePmputra()`/`requirePmpersadaKeuangan()`/`requirePmpakis()`) di awal fungsi — bukan cuma di `page.tsx` — persis pola `postGLBacklogAction` yang sudah ada (`src/app/mkesindo/(dashboard)/pnl/actions.ts:97-103`). Halaman yang ter-guard tidak melindungi Server Action yang dipanggil langsung.

**Piutang per-Agen** (fungsi terpisah, dipakai hanya di dialog detail):
- `getPiutangBaruAgen(kode, sumber, agenId, bulan)`: join `PMP_Pemesanan.AgenID = @agenId` → `GeneralLedger.VoucherNo = PMP_Pemesanan.NoDokumen`, filter `[Type]='SALESORDER'`-equivalent voucher prefix `PMP/SO/`, akun Piutang sesuai `PIUTANG_ACCOUNTS` yang sudah ada di `penjualan-piutang.ts` (reuse konfigurasi akun, JANGAN duplikasi daftar akun).
- `getPembayaranAgenEstimasi(kode, sumber, agenId, bulan)`: cocokkan `GeneralLedger.Memo LIKE 'Agent ' + @nama + ' - Pembayaran'` untuk voucher prefix `PMP/AT/` — kembalikan hasil dengan flag `isEstimasi: true` selalu, dan jangan pernah dipakai untuk menghitung total resmi apa pun di luar dialog ini.
- Dialog detail menampilkan kedua angka berdampingan dengan label eksplisit + teks kecil disclaimer, TIDAK dijumlahkan jadi satu "Saldo Piutang" tunggal yang diklaim akurat.

## Data Model

```ts
export interface MitraCard {
  agenId: string;
  sumber: SumberAgen; // badge ditampilkan utk pmpersada & pmpakis (>1 sumber mungkin); pmputra selalu "utama" (gabungan)
  nama: string;
  telepon: string | null;
  isActive: boolean;
  wilayah: string | null;
  alamat: string | null;
  hargaBalokKecil: number;
  hargaBalokBesar: number;
  maksimumHutang: number;
  latitude: number | null;
  longitude: number | null;
}

export interface MitraDetailData extends MitraCard {
  piutangSaldoAwal: number;
  tabunganSaldoAwal: number;
  riwayatBulanan: {
    bulan: string; // "2026-08"
    balokKecil: number;
    balokBesar: number;
    totalBalok: number; // balokKecil + balokBesar*2
  }[];
  piutangBaruBulanIni: number; // andal
  pembayaranEstimasiBulanIni: number; // berlabel perkiraan
}
```

## Halaman & Routing

- `src/app/pmputra/mitra/page.tsx`, `src/app/pmpersada/(dashboard)/mitra/page.tsx`, `src/app/pmpakis/(dashboard)/mitra/page.tsx` — menggantikan placeholder `[modul]` untuk slug `mitra` (pola identik `penjualan`/`piutang`).
- Guard: `requirePmputra()`, `requirePmpersadaKeuangan()` (data Mitra mencakup `MaksimumHutang`/saldo piutang — finansial, konsisten dengan ruling modul Penjualan/Piutang sebelumnya), `requirePmpakis()`.

**Halaman Mitra**: card grid (meniru `mitra-list.tsx` Es Kristal) — Nama, badge Aktif/Nonaktif, badge Sumber (pmpersada & pmpakis: "Utama" / "Logistik (Bersama)"; pmputra tanpa badge, selalu gabungan), Telepon, Wilayah, Alamat, Harga Balok Kecil/Besar, Batas Hutang. Filter: cari nama, Wilayah, status aktif, sumber (pmpersada/pmpakis). Peta overview (multi-pin, Leaflet, reuse pola `mitra-locations-map.tsx`) di atas grid, menampilkan Mitra yang sudah punya pin.

**Dialog Detail** (reuse pola `mitra-detail-dialog.tsx`): info dasar + Saldo Awal + tabel tren bulanan (Balok Kecil/Besar/Total) + Piutang Baru & Pembayaran (berlabel jelas) + peta single-pin (reuse `mitra-location-map.tsx`) dengan tombol "Edit Lokasi". Untuk kartu bersumber "Logistik (Bersama)", tambahkan catatan kecil bahwa Mitra ini juga terlihat identik di modul Mitra perusahaan pasangannya (pmpersada↔pmpakis).

**Form Tambah/Edit** (reuse pola `MitraFormDialog`): Nama, Telepon, Wilayah (select dari `PMP_Wilayah`), Alamat, Harga Balok Kecil/Besar, Batas Hutang, toggle Aktif. Untuk pmpersada & pmpakis: field tambahan "Sumber" (Utama/Logistik) yang WAJIB dipilih saat membuat baru (menentukan koneksi tujuan insert lewat `resolveKoneksi`) dan tidak bisa diubah saat edit (AgenID+sumber adalah identitas baris, bukan atribut yang bisa dipindah). Saat "Sumber"="Logistik" dipilih (baik dari pmpersada maupun pmpakis), tampilkan peringatan inline bahwa Mitra baru ini akan otomatis muncul juga di modul Mitra perusahaan pasangannya, karena keduanya menulis ke database fisik yang sama.

## Testing

Tidak ada test runner. Verifikasi: `npx tsc --noEmit`, `npx eslint`, live cross-check:
- `AgenID` baru yang dihitung harus match `MAX+1` independen per database, tanpa collision (test dengan urutan create ganda berurutan cepat, verifikasi tidak ada error 2627 yang lolos tak tertangani).
- pmputra: total riwayat/piutang gabungan detail satu Mitra harus sama dengan jumlah manual utama+logistik untuk Mitra itu.
- pmpersada: pastikan daftar Mitra menunjukkan DUA entri terpisah (bukan tergabung) untuk nama yang sama persis di kedua database, masing-masing dengan AgenID dan badge sumber yang benar.
- Logistik bersama: pastikan `getMitraList("pmpersada")`'s entri `sumber="logistik"` dan `getMitraList("pmpakis")`'s entri `sumber="logistik"` menghasilkan daftar `AgenID`+`Nama` yang BYTE-IDENTICAL (sumber fisik sama) — kalau berbeda, `resolveKoneksi` salah menunjuk koneksi.
- Piutang Baru per-Agen: cross-check manual terhadap join `PMP_Pemesanan`→`GeneralLedger` untuk 2-3 Agen sampel, pastikan angka `getPiutangBaruAgen` sama persis.
- Live browser check: create → muncul di list dengan `AgenID` baru yang benar; edit → tersimpan; nonaktifkan/hapus → status berubah; pin lokasi → tersimpan dan muncul di peta.
- Regresi: `/pmputra/penjualan`, `/pmputra/piutang`, `/pmpersada/penjualan`, `/pmpersada/piutang` tetap tidak berubah (modul ini tidak menyentuh `penjualan-piutang.ts` kecuali me-reuse `PIUTANG_ACCOUNTS`-nya secara read-only, import saja, bukan modifikasi).
