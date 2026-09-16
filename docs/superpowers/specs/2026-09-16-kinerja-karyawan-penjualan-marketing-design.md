# Modul Kinerja Karyawan — Aspek Penjualan (Marketing and Collection) — Design Spec

## Latar Belakang

Perusahaan ingin sebuah modul **Kinerja Karyawan** yang tidak memakai satu formula universal untuk semua karyawan, melainkan mengikuti struktur:

```
Karyawan → Jabatan → Aspek Kinerja → Indikator → Business Rule → Hasil
```

Implementasi pertama menyasar:

```
Karyawan → Marketing and Collection → Penjualan → Kantong Es Terjual
```

Aspek Penjualan mengukur **kuantitas Kantong Es Terjual**, dipecah menjadi kontribusi dari mitra berstatus **NOO** (baru diakuisisi) dan **Existing** (sudah berjalan), dengan aturan bisnis eksplisit: status NOO seorang mitra bersifat sementara — begitu melewati satu bulan, mitra itu otomatis dan permanen menjadi Existing. Tujuannya mendorong dua hal sekaligus: mempertahankan/mengembangkan mitra Existing, dan terus mengakuisisi mitra baru untuk memperluas pangsa pasar.

## Temuan Investigasi

Sebelum desain ini disusun, dilakukan investigasi terhadap kode yang sudah ada:

1. **Tidak ada modul "Kinerja Karyawan" generik.** Yang ada adalah **"Kinerja Marketing"**, tertanam di dalam modul Pemasaran (`src/components/dashboard/marketing-performance-panel.tsx`, `src/lib/queries/marketing-performance.ts`, `src/lib/queries/marketing-performance-trend.ts`), dispesifikasikan di `docs/superpowers/specs/2026-08-18-kinerja-marketing-existing-noo-design.md`. Fitur ini punya definisi NOO/Existing **berbasis `BusinessPartner.JoinDate` dan atribusi wilayah** (`resolveResponsibleMarketing()`), yang bersifat **live/retroaktif** — jika assignment wilayah seorang Marketing berubah, angka bulan-bulan lalu ikut bergeser mengikuti assignment hari ini (didokumentasikan sebagai perilaku yang disengaja, bukan bug).
2. **Tidak ada entitas `Jabatan`** di database manapun (Postgres maupun MSSQL). "Jabatan" Marketing saat ini hanya berupa `peran_id = 1003` (konstanta `MARKETING_ROLE_ID`, `src/lib/roles.ts`) pada tabel Postgres `akun` — sebuah role akses, bukan entitas HR/jabatan.
3. **Data kuantitas "Kantong Es Terjual per mitra per bulan" sudah tersedia**, dihitung dari `DeliveryOrder`/`DeliveryOrderDetail` (bukan `SalesOrder`/`SalesInvoice`, dengan alasan: pengiriman adalah realisasi penjualan). Konvensi satuan sudah baku dan dipakai berulang di beberapa file: `KANTONG_QTY_EXPR = SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END)` — kantong 5KG dihitung setengah kantong.
4. **Alur Pengajuan Mitra** (`DashboardMitraPengajuan`, `src/lib/queries/mitra-pengajuan.ts`) mencatat `MarketingUserID` (Postgres `akun.id`) sebagai **pengaju**, terpisah dari `ReviewedByUserID` (penyetuju). Saat disetujui (`Status='Disetujui'`), sebuah `BusinessPartner` baru dibuat dan `ConvertedBusinessPartnerID` diisi — inilah satu-satunya penaut antara Pengajuan dan mitra hasilnya (relasi 1:1 secara praktik, tidak ada FK/constraint DB yang menegakkannya). `ReviewedAt` (dan `BusinessPartner.JoinDate`, ditulis dalam transaksi yang sama, berselisih milidetik) menjadi penanda momen "kapan mitra ini resmi onboard".
5. **Mitra lama/legacy** (diinput langsung lewat modul Mitra, bukan lewat Pengajuan, atau hasil impor ERP) **tidak punya baris `DashboardMitraPengajuan` sama sekali** — tidak ada data "siapa pengaju" untuk mitra ini. Mekanisme `getCrossWilayahProposalOverrides()` yang sudah ada hanya menjangkau mitra dengan Pengajuan disetujui yang wilayahnya berbeda dari cakupan wilayah pengajunya sendiri; sisanya (termasuk semua mitra lama) jatuh ke resolusi wilayah biasa (`resolveResponsibleMarketing()`).
6. Fitur baru ini **sengaja dibuat sebagai modul terpisah**, tidak menyentuh/mengubah "Kinerja Marketing" yang sudah ada di Pemasaran (baik kode maupun angka yang ditampilkannya) — dua sistem ini punya definisi NOO/Existing yang berbeda by design dan tidak boleh saling mempengaruhi.

## Model Data

Seluruhnya di Postgres direktori (`getPgPool()`, database yang sama dengan `akun`/`peran`), migration idempoten mengikuti pola `scripts/migrate-inventaris-db.ts`.

```sql
CREATE TABLE jabatan (
  id            SERIAL PRIMARY KEY,
  kode          VARCHAR(50) NOT NULL UNIQUE,   -- 'marketing_collection'
  nama          VARCHAR(100) NOT NULL          -- 'Marketing and Collection'
);

-- Pemetaan sementara jabatan -> peran akses. Tabel terpisah (bukan kolom
-- langsung di `peran`) supaya jabatan lain nanti bisa dipetakan tanpa
-- mengubah skema `peran`, dan satu peran bisa dipetakan ke >1 jabatan
-- di masa depan kalau perlu.
CREATE TABLE jabatan_peran_map (
  jabatan_id    INTEGER NOT NULL REFERENCES jabatan(id),
  peran_id      INTEGER NOT NULL,              -- FK longgar ke peran.id (cross-concern, tidak di-enforce FK)
  PRIMARY KEY (jabatan_id, peran_id)
);

CREATE TABLE aspek_kinerja (
  id            SERIAL PRIMARY KEY,
  jabatan_id    INTEGER NOT NULL REFERENCES jabatan(id),
  kode          VARCHAR(50) NOT NULL,          -- 'penjualan'
  nama          VARCHAR(100) NOT NULL,         -- 'Penjualan'
  satuan        VARCHAR(50) NOT NULL,          -- 'Kantong Es Terjual'
  UNIQUE (jabatan_id, kode)
);
```

Seed awal (dalam migration script): `jabatan('marketing_collection', 'Marketing and Collection')`, `jabatan_peran_map(jabatan_id, 1003)`, `aspek_kinerja(jabatan_id, 'penjualan', 'Penjualan', 'Kantong Es Terjual')`.

**Indikator dan Business Rule TIDAK dimodelkan sebagai baris data/formula-string.** Ini disengaja: kodebase ini secara konsisten menaruh business rule sebagai kode TypeScript dengan komentar penjelasan (lihat `KANTONG_QTY_EXPR`, rollover hour, dsb.), bukan sebagai DSL/formula yang di-parse dari data — membangun rule engine generik untuk 1 aspek adalah over-engineering (YAGNI). Sebagai gantinya: setiap pasangan (jabatan, aspek) punya modul TypeScript perhitungan sendiri, didaftarkan lewat registry:

```ts
// src/lib/kinerja/registry.ts
export interface AspekKinerjaCalculator {
  hitungHistoriBulanan(akunId: number, perusahaanId: number): Promise<HistoriBulananAspek>;
}

const registry = new Map<string, AspekKinerjaCalculator>();
registry.set("marketing_collection:penjualan", marketingCollectionPenjualanCalculator);

export function getCalculator(jabatanKode: string, aspekKode: string): AspekKinerjaCalculator | null {
  return registry.get(`${jabatanKode}:${aspekKode}`) ?? null;
}
```

Jabatan/aspek lain di masa depan menulis calculator sendiri dan mendaftarkannya di sini — tidak menyentuh kode Marketing and Collection.

## Business Rule — Atribusi Mitra & Status NOO/Existing

File baru: `src/lib/kinerja/marketing-collection-penjualan.ts`.

**Sumber kepemilikan NOO (kredit permanen ke pengaju):**

```sql
-- MSSQL, per perusahaan
SELECT p.MarketingUserID, p.ConvertedBusinessPartnerID AS BusinessPartnerID, p.ReviewedAt
FROM DashboardMitraPengajuan p
WHERE p.Status = 'Disetujui' AND p.ConvertedBusinessPartnerID IS NOT NULL
```

Untuk setiap `BusinessPartnerID` hasil query ini: pemiliknya adalah `MarketingUserID` (akun.id), dan mitra berstatus **NOO pada bulan kalender `ReviewedAt`**, lalu **Existing permanen mulai bulan berikutnya**, seterusnya — tidak ada mekanisme yang mengembalikannya jadi NOO lagi, dan tidak berubah kalau assignment wilayah berubah di kemudian hari (berbeda dari "Kinerja Marketing" lama).

**Mitra tanpa baris Pengajuan disetujui** (legacy, atau Pengajuan-nya sudah dihapus setelah dikonversi): dianggap **Existing permanen sejak selalu** (tidak pernah NOO), pemiliknya diresolusi lewat `resolveResponsibleMarketing()` yang sudah ada (`src/lib/queries/marketing-wilayah.ts`) — wilayah/kecamatan mitra dicocokkan ke assignment Marketing saat ini. Mitra yang tidak match wilayah manapun (`null`) dikecualikan dari agregasi (konsisten dengan perilaku modul lama).

**Prioritas resolusi kepemilikan per mitra:** (1) ada Pengajuan disetujui dengan `ConvertedBusinessPartnerID` = mitra ini → pemilik = pengaju, status by `ReviewedAt`; (2) tidak ada → pemilik = hasil `resolveResponsibleMarketing()`, status = Existing permanen. Setiap mitra jatuh ke tepat satu jalur, tidak tumpang tindih.

**Agregasi QTY per bulan per Marketing:**

```
qtyNoo(akunId, bulan M)      = SUM(kantong terjual bulan M) dari mitra yang:
                                 owner = akunId DAN statusnya NOO pada bulan M
                                 (yaitu ReviewedAt jatuh di bulan M)
qtyExisting(akunId, bulan M) = SUM(kantong terjual bulan M) dari mitra yang:
                                 owner = akunId DAN statusnya Existing pada bulan M
                                 (ReviewedAt < awal bulan M, ATAU tidak ada Pengajuan sama sekali)
```

## Perhitungan Delta & Konversi Rupiah

Untuk setiap kolom bulan M (M-1 adalah bulan sebelumnya):

```
deltaNoo(M)      = qtyNoo(akunId, M) − qtyNoo(akunId, M-1)
deltaExisting(M) = qtyExisting(akunId, M) − qtyExisting(akunId, M-1)
totalQty(M)      = deltaNoo(M) + deltaExisting(M)          // bisa negatif/nol/positif
nilaiRupiah(M)   = totalQty(M) × 200                        // Rp200 / kantong, ikut tanda totalQty
```

Catatan penting: `deltaNoo` membandingkan **kohort NOO bulan M vs kohort NOO bulan M-1** (dua kelompok mitra yang berbeda — kohort lama sudah "naik kelas" ke Existing) untuk mengukur tren kualitas/volume akuisisi baru dari waktu ke waktu. `deltaExisting` membandingkan **kelompok Existing yang sama** (yang terus tumbuh menyerap kohort NOO sebelumnya) ke dirinya sendiri bulan lalu, untuk mengukur retensi/pengembangan.

Bulan pertama yang tersedia (tidak ada M-1) memakai pembanding 0.

**QTY Average / QTY non Average.** Formula pasti untuk kedua istilah ini belum ditetapkan perusahaan. Diimplementasikan sebagai *strategi tampilan yang bisa dikonfigurasi*, bukan formula hardcoded:

```ts
// src/lib/kinerja/qty-strategy.ts
export type QtyStrategyKey = "non_average" | "average";

// Tahap 1: keduanya passthrough (angka mentah, tanpa modifikasi). Ganti isi
// fungsi ini kapan pun formula sebenarnya sudah ditentukan — struktur tabel
// dan query di atas TIDAK perlu berubah.
export function applyQtyStrategy(rawQty: number, strategy: QtyStrategyKey): number {
  return rawQty;
}
```

Baris NOO memakai `"non_average"`, baris Existing memakai `"average"` — label yang tampil di UI, bukan formula aktif untuk saat ini.

## Kontrol Akses

- `ModuleKey` baru `"kinerja"` ditambahkan ke `src/lib/permissions.ts`, digerbangi lewat `requireModuleAccess("kinerja")` — akses diatur lewat sistem Peran/izin per-PT yang sudah ada (bukan flag lintas-PT seperti `can_akses_inventaris`, karena modul ini per-perusahaan, mengikuti pola modul lain seperti Pemasaran/Produksi).
- Akun dengan `peran_id` yang termuat di `jabatan_peran_map` untuk jabatan Marketing and Collection: melihat baris kinerjanya sendiri saja (`session.user.id` dicocokkan ke `akunId`).
- Akun dengan `canView(permissions, "kinerja")` (Supervisor/Approver/Direktur/Superadmin sesuai `peran_izin`): melihat seluruh baris karyawan Marketing and Collection.

## Halaman & Alur UI

- Route baru: `src/app/mkesindo/(dashboard)/kinerja/page.tsx` (server component, pola sama seperti modul lain: `Promise.all` fetch, filter baris berdasar sesi, pass ke client component).
- Struktur halaman: daftar Karyawan (untuk viewer dengan akses penuh) → pilih satu → tampil breadcrumb `Marketing and Collection > Penjualan` → tabel histori bulanan.
- Tabel: baris = NOO / Existing / Total (dengan label "Selisih dari bulan lalu" di bawah tiap angka NOO/Existing sesuai poin 5 permintaan), kolom = bulan dinamis (dari bulan Pengajuan/transaksi paling awal karyawan tsb sampai bulan berjalan — dihitung on-the-fly, tidak ada tabel "Periode Penilaian" tersimpan, konsisten dengan pola modul lain).
- Klik sel bulan → panel/dialog detail audit: QTY sebelumnya, QTY berjalan, Selisih (NOO dan Existing terpisah), Total dengan tanda eksplisit, dan hasil kali Rupiah.
- Rollover periode: memakai `ROLLOVER_HOUR = 14` (rollover WIB standar aplikasi), bukan `KINERJA_MARKETING_ROLLOVER_HOUR = 13` milik panel lama — karena ini modul terpisah dengan siklusnya sendiri.
- Satuan yang ditampilkan selalu "Kantong Es Terjual" secara eksplisit, tidak pernah "poin".

## Edge Case

1. **Pengajuan dihapus (hard-delete) setelah dikonversi jadi mitra**: `deletePengajuan` tidak menyentuh `BusinessPartner`-nya (dikonfirmasi saat investigasi) — mitra tsb otomatis jatuh ke jalur "tanpa Pengajuan" (Existing permanen via resolusi wilayah), kehilangan kredit NOO historisnya. Tidak boleh menyebabkan error pada query, hanya kehilangan atribusi.
2. **Akun Marketing pengaju dinonaktifkan (`is_active=false`) atau dihapus**: kredit NOO tetap melekat ke `akun.id` historis — histori kinerja tidak berubah retroaktif karena karyawan resign. Jika akun benar-benar dihapus (bukan hanya nonaktif), tampilkan nama sebagai "Akun tidak ditemukan" pada baris histori, tanpa menghapus datanya.
3. **Bulan tanpa transaksi sama sekali** dari seorang Marketing: qty = 0 (bukan null), supaya delta bulan berikutnya tetap terhitung benar.
4. **Pengajuan berstatus selain "Disetujui"** (Menunggu/Diproses/Ditolak): tidak pernah menghasilkan kredit NOO.
5. **Karyawan baru tanpa histori Pengajuan maupun transaksi sama sekali**: tabel tampil kosong dengan pesan informatif, bukan error.

## Di Luar Cakupan Tahap 1 Ini

- Jabatan selain Marketing and Collection, aspek selain Penjualan (arsitektur registry sudah menyiapkan tempatnya, implementasinya menyusul terpisah).
- Integrasi ke sistem gaji/payroll sungguhan — nilai Rupiah murni tampilan evaluasi kinerja.
- UI admin untuk mengelola `jabatan`/`aspek_kinerja` (tambah/ubah lewat halaman) — untuk Tahap 1 cukup di-seed lewat migration script.
- Perubahan apa pun terhadap panel "Kinerja Marketing" yang sudah ada di Pemasaran — dibiarkan sama sekali tidak tersentuh.
- Notifikasi/reminder otomatis terkait pencapaian NOO/Existing.

## Asumsi Belum Terverifikasi

- Formula pasti "QTY Average" vs "QTY non Average" — sengaja dibuat sebagai lapisan konfigurasi terpisah (lihat bagian Perhitungan), menunggu kejelasan bisnis lebih lanjut.
- Berlaku untuk MKEsindo terlebih dahulu (di mana `DashboardMitraPengajuan`/`DashboardMarketingWilayah` sudah dipakai secara aktif) — belum diverifikasi apakah PMPersada/PMPutra punya Marketing dengan alur Pengajuan yang sama.
