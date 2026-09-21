# Kunjungan Marketing Terverifikasi (GPS + Foto)

## Latar Belakang

`/mkesindo/pemasaran-app` (marketing-app) dan halaman desktop `/mkesindo/pemasaran` sudah punya "Kinerja Marketing" — grid tanggal per mitra yang bisa diklik untuk menulis catatan bebas "Hasil Kunjungan" (tabel `DashboardMarketingVisitLog`, 1 baris per (mitra, tanggal), upsert). Catatan ini bisa ditulis siapa saja yang punya akses (termasuk telemarketing dari desktop), murni teks, tanpa bukti kunjungan fisik apa pun.

Fitur ini menambahkan **kunjungan lapangan terverifikasi**: marketing yang benar-benar berada di lokasi mitra (divalidasi GPS, radius 100 meter) dapat mengonfirmasi kunjungan dengan 2 foto bukti + catatan hasil, memicu ikon centang yang berbeda dari catatan teks biasa. Dibangun sebagai **perluasan** tabel/alur yang sudah ada, bukan sistem terpisah — supaya riwayat kunjungan otomatis muncul dari baris-baris tanggal yang sudah ada.

## Bagian 1: Perluasan data

```sql
ALTER TABLE DashboardMarketingVisitLog ADD
  FotoTampakDepanPath VARCHAR(512) NULL,
  FotoPenagihanPath VARCHAR(512) NULL,
  Latitude DECIMAL(10,7) NULL,
  Longitude DECIMAL(10,7) NULL,
  IsTerverifikasi BIT NOT NULL DEFAULT 0,
  VerifiedAt DATETIME NULL
```

Baris tetap 1 per (mitra, tanggal) — model upsert yang sudah ada dipertahankan. `IsTerverifikasi = 1` HANYA diset oleh alur "Tambah Kunjungan" baru (GPS+foto+konfirmasi); catatan teks biasa dari jalur lama (termasuk telemarketing dari desktop) tidak pernah mengubah kolom ini. Kalau marketing melakukan kunjungan terverifikasi di tanggal yang sudah punya catatan manual, upsert yang sama menimpa `HasilKunjungan` dan menambahkan foto+GPS+verified ke baris itu (perilaku upsert existing dipertahankan apa adanya).

Foto disimpan ke Google Drive lewat `uploadFile()` (`src/lib/storage/google-drive.ts`), pola identik dengan upload foto Satpam Patroli — API route baru `src/app/api/mkesindo/upload/marketing-kunjungan/route.ts` mengikuti bentuk yang sama persis (auth/role gate → validasi MIME+size 5MB → `uploadFile("mkesindo", [...], fileName, buffer, type)`).

**Penting soal jalur lama (`saveMarketingVisitLog`, catatan teks manual)**: fungsi ini TIDAK diubah untuk menyentuh kolom baru sama sekali (MERGE-nya cuma `UPDATE SET HasilKunjungan = ..., ModifiedAt = ...`). Konsekuensinya sengaja dipertahankan: kalau suatu tanggal SUDAH punya kunjungan terverifikasi (foto+GPS+`IsTerverifikasi=1`), lalu seseorang mengedit teks `HasilKunjungan` di tanggal itu lewat jalur lama (desktop), kolom foto/GPS/`IsTerverifikasi` TIDAK ikut terhapus/ter-reset — hanya teksnya yang berubah. Ini mencegah edit teks biasa secara tidak sengaja menghapus status "terverifikasi" yang sudah tercatat.

## Bagian 2: Ikon centang di grid Kinerja Marketing

**Desktop** (`MitraDayCell`, `src/components/dashboard/marketing-performance-panel.tsx`): dot kecil yang sudah ada (penanda "ada catatan teks") dipertahankan apa adanya. Ditambah ikon centang bulat hijau (`CheckCircle2` dari lucide-react) di posisi berdekatan, tampil independen kalau `IsTerverifikasi = true` untuk (mitra, tanggal) tersebut.

**Mobile** (`DayBox`, `src/components/pemasaran-app/kinerja-marketing-sub-tab.tsx`): pola sama — tint background yang sudah ada (penanda "ada catatan") dipertahankan, ditambah ikon centang kecil pojok kanan-atas kalau `IsTerverifikasi = true`.

**Sumber data**: `getMarketingPerformance()` (`src/lib/queries/marketing-performance.ts`) yang sudah menghasilkan `hasLog` per (mitra, tanggal) diperluas untuk juga mengembalikan `isTerverifikasi` dari kolom baru — perluasan query yang sama, bukan query tambahan.

## Bagian 3: Alur "Tambah Kunjungan"

**Tombol floating**: persisten di level shell marketing-app (tampil di semua tab), pojok kanan-bawah layar. Klik membuka layar/sheet penuh baru (bukan popover kecil).

**Alur**:
1. Dropdown pilih mitra, dibatasi ke mitra milik marketing yang login (`resolveResponsibleMarketing`/`ownMitra`, pola scope yang sudah ada).
2. Setelah dipilih → detail mitra (nama, wilayah, alamat) + peta muncul.
3. **Mitra belum punya lokasi** (`DashboardMitraLocation` kosong untuknya): peta beralih ke mode pin-drop, pakai komponen `MitraLocationMap` yang sudah ada, posisi awal pin = GPS marketing saat itu. Marketing geser/konfirmasi pin → tersimpan lewat `setMitraLocationAction` (sudah ada) → lanjut ke langkah 4.
4. **Peta normal**: pin mitra (tetap) + pin marketing (muncul setelah tombol GPS ditekan — `getCurrentPosition` sekali-tembak, pola `GpsButton` yang sudah ada di `src/components/dashboard/mitra-locations-map.tsx`, BUKAN `watchPosition` otomatis-terus-menerus). Tombol "Generate Rute" memanggil OSRM `getRoute` lewat API route Next.js (konvensi existing: "jangan panggil OSRM langsung dari client"), menggambar jalur di peta yang sama.
5. Jarak dihitung dengan `haversineKm` (`src/lib/route-estimate.ts`, sudah ada, tanpa network call) antara pin mitra dan pin marketing terakhir, ditampilkan real-time, diperbarui tiap tombol GPS ditekan ulang.
6. **Jarak > 100m**: bagian input (foto + teks) terkunci/disabled, tampil pesan jarak + ajakan mendekat lalu refresh GPS. **Jarak ≤ 100m**: bagian input otomatis terbuka.

## Bagian 4: Foto, teks hasil kunjungan, konfirmasi

**Dua slot foto**, keduanya pakai kamera langsung + watermark (perluasan `use-watermark-camera-capture.ts` yang sudah ada, dipakai Satpam Patroli):
- **Foto tampak depan lokasi**: opsi toggle kamera depan/belakang (untuk selfie) — perluasan kecil dari hook (saat ini `facingMode` di-hardcode `"environment"`, perlu jadi parameter).
- **Foto hasil penagihan/penawaran**: kamera belakang saja.
- Keduanya WAJIB diisi sebelum lanjut. Preview kecil tiap foto, bisa diambil ulang.

**Teks "Hasil Kunjungan"**: textarea bebas, field yang sudah ada (`HasilKunjungan`, `NVarChar(500)`).

**Tombol "Konfirmasi Kunjungan"**: aktif setelah kedua foto + teks terisi (dan hanya bisa dicapai dalam radius 100m per Bagian 3). Saat ditekan:
1. Upload kedua foto ke Google Drive.
2. Server Action baru menyimpan ke `DashboardMarketingVisitLog` (foto, koordinat, teks, `IsTerverifikasi=1`, `VerifiedAt=GETDATE()`) via perluasan `saveMarketingVisitLog`.
3. **Validasi jarak diulang di server** — hitung ulang `haversineKm` dari koordinat yang dikirim vs `DashboardMitraLocation` mitra tsb; kalau >100m, tolak dengan `AppError` pesan jelas. Mencegah manipulasi koordinat sisi client.
4. Sukses → layar tertutup, `revalidatePath` memicu grid Kinerja Marketing & panel Piutang Tertinggi menampilkan kunjungan terbaru.

## Bagian 5: Panel Piutang Tertinggi — hasil kunjungan terbaru & riwayat

- Di tiap baris mitra pada panel "Piutang Tertinggi" (`src/components/pemasaran-app/beranda-tab.tsx`), tambah baris teks kecil di bawah nama/status: cuplikan `HasilKunjungan` dari tanggal TERBARU yang ada isinya (baik terverifikasi maupun catatan manual) — dipotong 1 baris.
- Klik baris itu → dialog "Riwayat Kunjungan — <nama mitra>": semua entri `DashboardMarketingVisitLog` mitra itu, urut tanggal terbaru dulu. Tiap entri: tanggal, teks hasil, badge centang + 2 thumbnail foto kalau `IsTerverifikasi`, dan "Dicatat oleh: <nama akun>" (resolusi `CreatedByUserID` lewat `getAkunNamaMap` yang sudah ada — otomatis membedakan kunjungan lapangan marketing sendiri vs catatan manual dari telemarketing/pihak lain, tanpa kolom baru).
- Query baru `getVisitLogHistoryForMitra(businessPartnerId)` — dipakai dialog riwayat ini saja, terpisah dari query ringan grid utama.

## Global Constraints

- Semua UI dan pesan berbahasa Indonesia.
- Perluasan tabel yang sudah ada (`DashboardMarketingVisitLog`), bukan tabel baru — model 1-baris-per-(mitra,tanggal) dipertahankan.
- `IsTerverifikasi` HANYA pernah diset oleh alur "Tambah Kunjungan" (GPS+foto+konfirmasi) — jalur catatan teks manual yang sudah ada (desktop, termasuk telemarketing) tidak pernah menyentuh kolom ini.
- Validasi jarak 100 meter WAJIB diulang di server saat konfirmasi (tidak boleh hanya percaya validasi sisi client).
- Kedua foto (tampak depan, hasil penagihan/penawaran) WAJIB diisi sebelum "Konfirmasi Kunjungan" bisa ditekan.
- Mitra tanpa lokasi tersimpan WAJIB melalui alur pin-lokasi dulu (pakai `MitraLocationMap` + `setMitraLocationAction` yang sudah ada) sebelum bisa lanjut ke validasi jarak.
- GPS marketing diambil manual (tombol, `getCurrentPosition` sekali-tembak) — bukan pelacakan otomatis/`watchPosition`.
- "Generate Rute" memakai OSRM (`getRoute`) lewat API route Next.js — tidak pernah dipanggil langsung dari client component.
- Foto disimpan ke Google Drive lewat `uploadFile()`, pola identik modul upload yang sudah ada (mis. Satpam Patroli): validasi MIME (`image/jpeg|png|webp`) + batas 5MB.
- Tidak ada framework migrasi — perubahan skema lewat script `scripts/_scratch_*.ts` sekali jalan, dihapus setelah dipakai.
- Tidak ada test suite otomatis — verifikasi via `npx tsc --noEmit`, `npx eslint`, skrip scratch DB live, dan uji browser (termasuk uji radius jarak, karena ini device GPS nyata — mungkin perlu disimulasikan/dites dengan koordinat manual saat development).
- Field/kolom existing (`HasilKunjungan`, dot/tint penanda catatan, upsert MERGE) tidak diubah perilakunya — hanya diperluas.

## Verifikasi

Tidak ada test suite di repo ini. Verifikasi per task: `npx tsc --noEmit`, `npx eslint <file berubah>`, skrip scratch DB live untuk skema baru, dan uji browser untuk alur UI (dropdown → peta → GPS → radius → foto → konfirmasi). Verifikasi khusus:
- Ikon centang HANYA muncul untuk (mitra,tanggal) dengan `IsTerverifikasi=true`, dot/tint lama tidak berubah perilaku untuk catatan manual biasa.
- Validasi jarak sisi server menolak percobaan konfirmasi dengan koordinat >100m dari lokasi mitra (uji dengan koordinat palsu lewat script/DevTools).
- Mitra tanpa lokasi tersimpan diarahkan ke alur pin-lokasi, bukan error/crash.
- Panel Piutang Tertinggi menampilkan cuplikan hasil kunjungan TERBARU per mitra (bukan tercampur/salah urut), dan dialog riwayat menampilkan semua entri terurut benar dengan atribusi "Dicatat oleh" yang akurat.
