# Tab Tamu Satpam-App — Design Spec

## Latar belakang

Sub-proyek terakhir dari roadmap perluasan `/mkesindo/satpam-app` (lihat `docs/superpowers/specs/2026-09-01-satpam-roster-shift-design.md`'s Latar Belakang untuk daftar lengkap sub-proyek). Sub-proyek #1 (ikon status), #2a (fondasi roster/shift), #2b (tab-shell Inspeksi/Patroli/Tamu), dan #5 (tab Patroli) sudah selesai. Sub-proyek #3 (tipe inspeksi Es Balok) dan #4 (label jenis bisnis) tetap **ditunda** — bergantung pada modul pengiriman PMPutra yang belum dibangun.

Tab "Tamu" saat ini masih placeholder "Segera Hadir" (`ComingSoonPanel`). Sub-proyek ini menggantinya dengan buku tamu digital: satpam mencatat kedatangan tamu (nama, tujuan, yang dikunjungi, foto masuk) dan, saat tamu pulang, mencatat kepulangannya (foto keluar) — semua tamu yang sedang "di dalam" terlihat oleh satpam mana pun yang sedang bertugas, terlepas dari siapa yang mencatat kedatangannya.

## Tujuan

1. Tabel data satu-baris-per-kunjungan (bukan model sesi multi-foto seperti Patroli) yang menyimpan data masuk dan keluar tamu.
2. Formulir "Tamu Baru" (masuk) dan layar konfirmasi keluar, masing-masing dengan satu foto berwatermark.
3. Watermark foto Tamu memakai mekanisme yang sama persis dengan Patroli (lokasi, waktu WIB, cuaca) — dicapai lewat **rename+reuse** hook kamera Patroli menjadi hook generik, bukan duplikasi ketiga.
4. Daftar "Tamu di Dalam" (belum checkout) yang terlihat sama oleh semua satpam yang login, tidak dibatasi per-akun pencatat — mendukung serah-terima antar-shift.
5. Riwayat tamu yang sudah checkout.

## Non-tujuan

- **Tidak** mengubah `use-live-camera-capture.ts`, `LiveInspeksiClient`, atau alur Inspeksi kendaraan dengan cara apa pun.
- **Tidak** mengubah logika/perilaku `usePatroliCameraCapture` — hanya rename file/fungsi/tipe menjadi nama generik (`useWatermarkCameraCapture`/`WatermarkCaptureResult`), tanpa perubahan mekanisme sama sekali. Titik pemakaian di `patroli-foto-client.tsx` ikut diperbarui sebagai bagian rename ini, tapi perilaku Patroli tidak berubah.
- **Tidak** membangun pencarian/dropdown akun karyawan untuk field "Dikunjungi" — teks bebas, sesuai konfirmasi (sistem ini tidak punya konsep "departemen" formal, hanya peran/role per akun).
- **Tidak** membatasi visibilitas "Tamu di Dalam"/riwayat per akun satpam pencatat — bersifat bersama (shared) untuk semua satpam, sesuai konfirmasi soal serah-terima shift.
- **Tidak** mewajibkan nomor kendaraan tamu — field opsional.
- **Tidak** membangun mekanisme checkout mandiri oleh tamu (kode/QR/link) — satpam yang mencatat exit secara manual, ini aplikasi internal satpam.
- **Tidak** membangun edit/koreksi data kunjungan setelah dibuat (baik sebelum maupun sesudah checkout) — YAGNI, tidak diminta.

## Model Data

Satu tabel baru di MSSQL (konvensi `Dashboard*` yang sama seperti tabel Patroli/roster):

```sql
CREATE TABLE DashboardSatpamTamu (
  KunjunganID        INT IDENTITY PRIMARY KEY,
  NamaTamu           VARCHAR(128) NOT NULL,
  AsalInstansi       VARCHAR(128) NULL,
  TujuanKunjungan    VARCHAR(256) NOT NULL,
  Dikunjungi         VARCHAR(128) NOT NULL,
  NomorKendaraan     VARCHAR(32) NULL,
  FotoMasukPath      VARCHAR(256) NOT NULL,
  FotoMasukLatitude  DECIMAL(10,7) NULL,
  FotoMasukLongitude DECIMAL(10,7) NULL,
  WaktuMasuk         DATETIME NOT NULL DEFAULT GETDATE(),
  FotoKeluarPath      VARCHAR(256) NULL,
  FotoKeluarLatitude  DECIMAL(10,7) NULL,
  FotoKeluarLongitude DECIMAL(10,7) NULL,
  WaktuKeluar         DATETIME NULL,       -- NULL = tamu masih di dalam
  IsDeleted          BIT NOT NULL DEFAULT 0,
  ModifiedDate       DATETIME NOT NULL DEFAULT GETDATE()
)
```

Tidak ada kolom "dicatat oleh akun mana" yang membatasi query — `WaktuKeluar IS NULL`/`IS NOT NULL` adalah satu-satunya pembeda status, dan setiap satpam yang login melihat baris yang sama, terlepas siapa yang mencatatnya.

**Guard anti-double-checkout**: `recordTamuKeluar` melakukan `UPDATE ... WHERE KunjunganID=@id AND WaktuKeluar IS NULL` — kalau dua satpam menekan "Konfirmasi Keluar" pada tamu yang sama nyaris bersamaan, hanya UPDATE pertama yang mengenai baris (`rowsAffected > 0`); yang kedua mendapat 0 baris terpengaruh dan action-nya melempar error "tamu ini sudah dicatat keluar".

## Rename Hook Kamera — `useWatermarkCameraCapture`

`src/hooks/use-patroli-camera-capture.ts` → `src/hooks/use-watermark-camera-capture.ts`. Perubahan murni penamaan, TIDAK ADA perubahan logika:
- `usePatroliCameraCapture` → `useWatermarkCameraCapture`
- `PatroliCaptureResult` → `WatermarkCaptureResult`
- Isi fungsi (geolocation, `/api/geocode`+`/api/weather` paralel, `drawWatermark`, `toBlob`) disalin apa adanya.

Satu-satunya titik pemakaian yang ada sekarang, `src/components/satpam-app/patroli-foto-client.tsx`, diperbarui importnya ke nama baru — tidak ada perubahan perilaku Patroli.

Foto Tamu (masuk maupun keluar) memakai hook yang sama: `useWatermarkCameraCapture({label, active, onCapture})`, dengan `label` diisi `"tamu-masuk"` atau `"tamu-keluar"` (dipakai hook hanya untuk penamaan sementara sisi klien, tidak memengaruhi watermark yang tercetak pada gambar).

## Upload Foto — `/api/mkesindo/upload/satpam-tamu` (baru)

Route baru, meniru persis pola `satpam-check`/`satpam-patroli` (double-gate `requireModuleAccess("delivery")` + `session.user.isSatpam`, validasi tipe file + ukuran maks 5MB, timestamp filename). Form field: `file`, `kunjunganId`, `jenis` (`"masuk"` | `"keluar"`, dipakai hanya untuk penamaan file, bukan kolom terpisah di DB). Kategori Google Drive: `["satpam-tamu", String(kunjunganId)]` — satu folder per kunjungan (menampung foto masuk + keluar).

## UI & Route

```
src/app/mkesindo/satpam-app/(tabs)/tamu/page.tsx              -- MODIFIKASI: ganti ComingSoonPanel jadi TamuPanel sungguhan
src/app/mkesindo/satpam-app/tamu/masuk/page.tsx                -- BARU: form Tamu Baru + foto masuk (sibling seperti inspeksi/[jadwalId], patroli/foto/[sesiId])
src/app/mkesindo/satpam-app/tamu/keluar/[kunjunganId]/page.tsx -- BARU: ringkasan kunjungan + foto keluar
```

**`TamuPanel`** (baru, `src/components/satpam-app/tamu-panel.tsx`):
- Tombol besar "Tamu Baru" di atas → navigasi ke `/tamu/masuk`.
- Bagian "Tamu di Dalam": kartu per tamu (nama, tujuan, dikunjungi, jam masuk) — tap kartu navigasi ke `/tamu/keluar/[kunjunganId]`.
- Bagian "Riwayat": kartu per tamu yang sudah checkout (nama, jam masuk—jam keluar), dibatasi 50 terbaru.

**`TamuMasukClient`** (baru, `src/components/satpam-app/tamu-masuk-client.tsx`): form teks (Nama Tamu*, Asal Instansi, Tujuan Kunjungan*, Dikunjungi*, Nomor Kendaraan — 3 wajib ditandai *, 2 opsional) + tombol untuk membuka kamera watermark dan mengambil 1 foto. Tombol "Simpan" aktif setelah semua field wajib terisi DAN foto sudah diambil. Simpan → upload foto → `createTamuMasukAction` (mengirim seluruh field form + `fotoPath`/`latitude`/`longitude`) → `router.push` kembali ke tab Tamu.

**`TamuKeluarClient`** (baru, `src/components/satpam-app/tamu-keluar-client.tsx`): tampilkan ringkasan data masuk tamu (nama, tujuan, dikunjungi, jam masuk) dari data yang sudah di-fetch server-side, lalu kamera watermark untuk 1 foto keluar. Simpan → upload foto → `recordTamuKeluarAction` → `router.push` kembali ke tab Tamu.

## Server Actions & Query

`src/lib/queries/satpam-tamu.ts` (baru):
- `TamuKunjunganRow` interface (bentuk baris lengkap, mapping 1:1 ke kolom tabel).
- `getTamuDiDalam(): Promise<TamuKunjunganRow[]>` — `WHERE WaktuKeluar IS NULL ORDER BY WaktuMasuk DESC`.
- `getTamuRiwayat(): Promise<TamuKunjunganRow[]>` — `WHERE WaktuKeluar IS NOT NULL ORDER BY WaktuKeluar DESC`, dibatasi `TOP 50`.
- `createTamuMasuk(input): Promise<number>` — INSERT, `OUTPUT INSERTED.KunjunganID`.
- `recordTamuKeluar(kunjunganId, fotoKeluarPath, latitude, longitude): Promise<number>` — UPDATE dengan guard `WaktuKeluar IS NULL`, mengembalikan jumlah baris terpengaruh (0 atau 1) supaya action bisa mendeteksi double-checkout.

**Server Actions** — ditambahkan ke `src/app/mkesindo/satpam-app/actions.ts` yang sudah ada (bukan file baru), semua digate `requireSatpam()` saja:
- `createTamuMasukAction(input: { namaTamu: string; asalInstansi: string | null; tujuanKunjungan: string; dikunjungi: string; nomorKendaraan: string | null; fotoPath: string; latitude: number | null; longitude: number | null }): Promise<ActionResult<{ kunjunganId: number }>>`
- `getTamuDiDalamAction(): Promise<ActionResult<TamuKunjunganRow[]>>`
- `getTamuRiwayatAction(): Promise<ActionResult<TamuKunjunganRow[]>>`
- `recordTamuKeluarAction(input: { kunjunganId: number; fotoPath: string; latitude: number | null; longitude: number | null }): Promise<ActionResult<void>>` — melempar `AppError` kalau `recordTamuKeluar` mengembalikan 0 baris terpengaruh ("Tamu ini sudah dicatat keluar sebelumnya.").

Tidak ada pengecekan kepemilikan sesi seperti `addPatroliFotoAction` — visibilitas dan penulisan memang bersama (shared) untuk semua satpam, sesuai keputusan desain di atas, jadi `sesiId`/`kunjunganId` boleh diproses oleh satpam mana pun yang login.

## Error handling & edge case

- GPS/geocode/cuaca gagal → foto tetap tersimpan, watermark menampilkan "tidak tersedia" untuk bagian yang gagal (perilaku diwarisi apa adanya dari `useWatermarkCameraCapture`, sudah teruji di Patroli).
- Dua satpam mencoba checkout tamu yang sama nyaris bersamaan → hanya yang pertama berhasil, yang kedua mendapat pesan error jelas (lihat Model Data).
- Field teks wajib kosong → tombol "Simpan" nonaktif di form masuk; server action tetap divalidasi ulang (defense-in-depth) dengan melempar `AppError` kalau field wajib kosong/hanya spasi.
- Satpam menutup aplikasi sebelum foto masuk sempat disimpan → tidak ada baris `DashboardSatpamTamu` yang ter-INSERT sama sekali (INSERT hanya terjadi setelah upload+form lengkap), tidak ada baris "yatim" separuh-jadi yang perlu dibersihkan.

## Testing

Tidak ada test suite otomatis di repo ini. Verifikasi:
1. `npx tsc --noEmit` dan `npm run lint` bersih, termasuk memastikan rename hook tidak meninggalkan referensi nama lama yang terlewat.
2. Klik-tayang manual (atau penelusuran kode teliti kalau kredensial `isSatpam` tidak tersedia): catat tamu baru lengkap dengan foto masuk (konfirmasi watermark muncul), lihat muncul di "Tamu di Dalam", buka dari satpam lain (kalau ada 2 akun test) untuk konfirmasi visibilitas bersama, catat keluar dengan foto, konfirmasi pindah ke Riwayat. Pastikan Patroli (setelah rename hook) masih berfungsi identik seperti sebelumnya.

## Struktur File

- Buat: `scripts/create-satpam-tamu-table.ts` (migrasi tabel, dijalankan manual sekali)
- Buat: `src/lib/queries/satpam-tamu.ts`
- Rename: `src/hooks/use-patroli-camera-capture.ts` → `src/hooks/use-watermark-camera-capture.ts` (isi fungsi tidak berubah, hanya nama)
- Modifikasi: `src/components/satpam-app/patroli-foto-client.tsx` (update import ke nama hook baru, tidak ada perubahan lain)
- Buat: `src/app/api/mkesindo/upload/satpam-tamu/route.ts`
- Modifikasi: `src/app/mkesindo/satpam-app/actions.ts` (tambah 4 action baru, tidak mengubah action Patroli yang sudah ada)
- Modifikasi: `src/app/mkesindo/satpam-app/(tabs)/tamu/page.tsx`
- Buat: `src/components/satpam-app/tamu-panel.tsx`
- Buat: `src/app/mkesindo/satpam-app/tamu/masuk/page.tsx`
- Buat: `src/components/satpam-app/tamu-masuk-client.tsx`
- Buat: `src/app/mkesindo/satpam-app/tamu/keluar/[kunjunganId]/page.tsx`
- Buat: `src/components/satpam-app/tamu-keluar-client.tsx`
- Tidak berubah: `src/hooks/use-live-camera-capture.ts`, `src/components/satpam-app/live-inspeksi-client.tsx`, seluruh alur Inspeksi kendaraan; logika internal hook watermark (hanya nama yang berubah, sudah dicatat di atas)
