# Tab Patroli Satpam-App — Design Spec

## Latar belakang

Sub-proyek #5 dari roadmap perluasan `/mkesindo/satpam-app` (lihat `docs/superpowers/specs/2026-09-01-satpam-roster-shift-design.md`'s Latar Belakang untuk daftar lengkap 6 sub-proyek). Sub-proyek #1 (ikon status), #2a (fondasi roster/shift, `/mkesindo/keamanan`), dan #2b (tab-shell Inspeksi/Patroli/Tamu) sudah selesai. Sub-proyek #3 (tipe inspeksi Es Balok) dan #4 (label jenis bisnis) **ditunda** — bergantung pada modul pengiriman PMPutra yang belum dibangun.

Tab "Patroli" saat ini masih placeholder "Segera Hadir" (`ComingSoonPanel`). Sub-proyek ini menggantinya dengan fitur sungguhan: satpam berkeliling memotret 13 titik tetap di lokasi pabrik (Foto Kondisi Pabrik) plus foto tambahan bebas, setiap foto otomatis diberi watermark berisi lokasi, waktu, dan cuaca.

## Tujuan

1. Tabel data untuk sesi patroli (ad-hoc, bebas kapan saja) dan foto-foto di dalamnya.
2. Kamera live baru khusus Patroli yang membubuhkan watermark (alamat, koordinat, tanggal+jam WIB, cuaca) langsung ke piksel foto sebelum diunggah — terpisah sepenuhnya dari kamera Inspeksi kendaraan yang sudah ada (Inspeksi TIDAK boleh terpengaruh sama sekali).
3. Integrasi cuaca baru (Open-Meteo, gratis tanpa API key) via route proxy baru, mengikuti pola `/api/geocode` yang sudah ada dan terbukti bekerja.
4. UI tab Patroli: mulai sesi → checklist 13 titik wajib + Foto Tambahan bebas jumlah → Selesai Patroli (aktif hanya setelah ke-13 titik wajib terisi).
5. Sesi patroli mencatat snapshot shift yang sedang piket (dari fondasi #2a) untuk keperluan audit/laporan.

## Non-tujuan

- **Tidak** mengubah `use-live-camera-capture.ts`, `LiveInspeksiClient`, atau alur Inspeksi kendaraan dengan cara apa pun — Inspeksi tetap tanpa watermark/panorama, sesuai konfirmasi eksplisit sebelumnya.
- **Tidak** membangun panorama sungguhan (multi-foto yang di-stitch) — satu jepretan foto lebar per titik, lewat kamera live yang sudah terbukti (`getUserMedia`), bukan menyerahkan ke aplikasi kamera native HP.
- **Tidak** membangun tab Tamu — sub-proyek terpisah (#6).
- **Tidak** membangun UI/CRUD roster baru — fondasi #2a (`DashboardSatpamJadwalJaga`, `getSatpamOnDutyNowAction`) dipakai apa adanya, hanya dibaca untuk snapshot.
- **Tidak** membatasi kapan sesi patroli boleh dimulai berdasarkan shift — bebas/ad-hoc sesuai konfirmasi, snapshot shift murni informasional.
- **Tidak** memblokir pengambilan foto kalau GPS/geocode/cuaca gagal — foto tetap tersimpan, bagian watermark yang gagal diambil ditulis sebagai "tidak tersedia".

## Model Data

Dua tabel baru di MSSQL (mengikuti konvensi `Dashboard*` yang sama seperti `DashboardSatpamJadwalJaga`):

```sql
CREATE TABLE DashboardSatpamPatroliSesi (
  SesiID           INT IDENTITY PRIMARY KEY,
  SatpamAkunID     INT NOT NULL,        -- lintas-DB ke Postgres akun.id, sama seperti roster
  ShiftType        VARCHAR(12) NULL,    -- snapshot shift yang sedang piket SAAT sesi dimulai
  TanggalUsahaShift DATE NULL,          -- boleh NULL kalau tidak ada yang terjadwal saat itu
  MulaiWaktu       DATETIME NOT NULL DEFAULT GETDATE(),
  SelesaiWaktu     DATETIME NULL,       -- NULL = sesi masih berjalan
  IsDeleted        BIT NOT NULL DEFAULT 0,
  ModifiedDate     DATETIME NOT NULL DEFAULT GETDATE()
)

CREATE TABLE DashboardSatpamPatroliFoto (
  FotoID           INT IDENTITY PRIMARY KEY,
  SesiID           INT NOT NULL,
  TitikPatroli     VARCHAR(50) NULL,    -- salah satu dari 13 titik tetap, NULL untuk Foto Tambahan
  Keterangan       VARCHAR(256) NULL,   -- wajib diisi untuk Foto Tambahan, NULL untuk titik tetap
  FotoPath         VARCHAR(256) NOT NULL,
  Latitude         DECIMAL(10,7) NULL,
  Longitude        DECIMAL(10,7) NULL,
  WaktuFoto        DATETIME NOT NULL DEFAULT GETDATE(),
  IsDeleted        BIT NOT NULL DEFAULT 0
)
```

**13 titik tetap** (konstanta baru `PATROLI_TITIK_LIST`, urutan tampil sama seperti urutan ini):
Area Produksi Es Balok-A, Area Produksi Es Balok-B, Area Produksi Es Balok-C, Area Produksi Es Kristal-A, Area Produksi Es Kristal-B, Area Produksi Es Kristal-C, Area Cuci Armada Es Kristal, Gudang, Distribusi, Ruang Trafo Kelistrikan, Tempat Parkir Kendaraan Karyawan, Area Parkir Armada Operasional, Area Luar Kantor.

**Aturan sesi**: hanya boleh **satu sesi aktif** (`SelesaiWaktu IS NULL`) per satpam pada satu waktu — mirip aturan "satu sesi ambil-stok aktif" di Papan Pengiriman (Peta Gudang). "Mulai Patroli" gagal dengan pesan jelas kalau satpam tersebut sudah punya sesi aktif yang belum diselesaikan.

**Snapshot shift**: saat "Mulai Patroli" ditekan, panggil `getSatpamOnDutyNowAction()` (sudah ada dari #2a), cari baris yang `satpamAkunId`-nya cocok dengan akun yang sedang login, ambil `shiftType`/`tanggalUsaha`-nya untuk snapshot. Kalau tidak ada baris yang cocok (satpam sedang tidak terjadwal formal), `ShiftType`/`TanggalUsahaShift` disimpan NULL — bukan error.

## Integrasi Cuaca — `/api/weather` (baru)

Route baru `src/app/api/weather/route.ts`, meniru persis pola `/api/geocode` (proxy server-side, `GET ?lat=...&lng=...`), memanggil **Open-Meteo** (`https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...&current_weather=true`) — gratis, tanpa API key, tidak perlu header khusus. Open-Meteo mengembalikan `current_weather.weathercode` (kode integer WMO) dan `temperature` (Celsius); route ini memetakan `weathercode` ke label Indonesia singkat (mis. 0 → "Cerah", 61 → "Hujan Ringan", dst. — tabel pemetaan kode WMO ke label, lengkap untuk kode-kode yang relevan untuk Indonesia) dan mengembalikan `{ cuaca: string, suhu: number } | { error: string }`.

## Kamera & Watermark — `usePatroliCameraCapture` (baru, terpisah dari `useLiveCameraCapture`)

Hook baru `src/hooks/use-patroli-camera-capture.ts`, meniru mekanisme `getUserMedia`/torch/retry `use-live-camera-capture.ts` yang sudah ada (duplikasi kecil disengaja — tidak mengubah/generalisasi hook yang sudah dipakai Inspeksi, sesuai Non-tujuan), tapi `handleCapture`-nya melakukan langkah tambahan sebelum `canvas.toBlob()`:

1. `ctx.drawImage(video, ...)` — sama seperti sekarang.
2. `navigator.geolocation.getCurrentPosition(...)` — sekali per foto (bukan `watchPosition`), dengan timeout wajar (mis. 8 detik) dan fallback ke "tidak tersedia" kalau gagal/ditolak/timeout.
3. Kalau lokasi berhasil didapat: panggil `/api/geocode` dan `/api/weather` secara paralel (`Promise.all`, masing-masing dengan fallback null-nya sendiri kalau gagal — satu gagal tidak menggagalkan yang lain).
4. Ambil tanggal+jam WIB via `getWibTimeHHmm`/formatter yang sudah ada di `@/lib/business-date`/`@/lib/format`.
5. `ctx.fillRect(...)` kotak semi-transparan di pojok bawah foto + `ctx.fillText(...)` menuliskan alamat (atau "Lokasi tidak tersedia"), koordinat (kalau ada), tanggal+jam WIB, cuaca (atau "Cuaca tidak tersedia").
6. `canvas.toBlob()` → `onCapture(file, { latitude, longitude })` — lat/long ikut dikirim ke pemanggil untuk disimpan sebagai kolom terpisah di `DashboardSatpamPatroliFoto`, terlepas dari watermark yang sudah menempel di piksel.

## UI & Route

```
src/app/mkesindo/satpam-app/(tabs)/patroli/page.tsx        -- MODIFIKASI: ganti ComingSoonPanel jadi PatroliPanel sungguhan
src/app/mkesindo/satpam-app/patroli/foto/[sesiId]/page.tsx -- BARU: layar penuh-layar ambil 1 foto (di luar (tabs)/, sibling seperti inspeksi/[jadwalId])
```

**`PatroliPanel`** (baru, `src/components/satpam-app/patroli-panel.tsx`), dua kondisi:
- **Tidak ada sesi aktif**: tombol "Mulai Patroli" + daftar ringkas sesi yang sudah selesai (tanggal, jam mulai-selesai, jumlah foto total) sebagai riwayat.
- **Ada sesi aktif**: daftar 13 titik wajib (label + status sudah/belum difoto, tap membuka layar kamera penuh-layar untuk titik itu), bagian "Foto Tambahan" (tombol "+ Tambah Foto", jumlah bebas, tiap foto minta keterangan singkat), tombol "Selesai Patroli" — nonaktif sampai ke-13 titik wajib terisi (Foto Tambahan tidak menghalangi).

**Layar kamera penuh-layar** (`/patroli/foto/[sesiId]?titik=<nama>` untuk titik tetap, `?titik=` kosong untuk Foto Tambahan): satu jepretan per kunjungan (bukan grid 6 foto seperti Inspeksi). Untuk Foto Tambahan, ada input keterangan yang wajib diisi sebelum tombol simpan aktif. Setelah simpan, `router.back()` ke tab Patroli, checklist otomatis ter-update (data di-refresh).

## Server Actions & Query

- `getPatroliAkunOptions()` — tidak diperlukan; `SatpamAkunID` sesi diisi dari sesi login yang sedang aktif (`session.user.id`), bukan dropdown.
- `startPatroliSesiAction(): Promise<ActionResult<{ sesiId: number }>>` — cek belum ada sesi aktif, snapshot shift, INSERT baris sesi baru.
- `getPatroliActiveSesiAction(): Promise<ActionResult<PatroliSesiDetail | null>>` — sesi aktif milik akun yang login (kalau ada) beserta daftar foto yang sudah diambil.
- `getPatroliRiwayatAction(): Promise<ActionResult<PatroliSesiRingkas[]>>` — daftar sesi selesai milik akun yang login, untuk ditampilkan sebagai riwayat.
- `addPatroliFotoAction(input: { sesiId: number; titikPatroli: string | null; keterangan: string | null; fotoPath: string; latitude: number | null; longitude: number | null }): Promise<ActionResult<void>>` — INSERT baris foto, validasi kalau `titikPatroli === null` maka `keterangan` wajib diisi.
- `selesaiPatroliSesiAction(sesiId: number): Promise<ActionResult<void>>` — validasi ke-13 titik wajib sudah ada fotonya, isi `SelesaiWaktu`.
- Upload foto lewat route baru `src/app/api/mkesindo/upload/satpam-patroli/route.ts`, meniru persis pola `satpam-check/route.ts` yang sudah ada (validasi tipe file, ukuran maks 5MB, simpan ke Google Drive lewat `uploadFile("mkesindo", ["satpam-patroli", sesiId], fileName, buffer, mimeType)`).

Semua action ini digate `requireSatpam()` — tidak digate role Supervisor (`WILAYAH_MANAGER_ROLE_IDS`), karena ini alur kerja satpam sendiri, bukan admin.

## Error handling & edge case

- GPS/geocode/cuaca gagal → foto tetap tersimpan, watermark menampilkan "tidak tersedia" untuk bagian yang gagal (lihat bagian Kamera & Watermark).
- Satpam mencoba "Mulai Patroli" padahal sudah punya sesi aktif → pesan error jelas, tidak membuat sesi baru.
- Satpam mencoba "Selesai Patroli" sebelum ke-13 titik wajib lengkap → tombol tetap nonaktif di UI; action juga divalidasi ulang di server (defense-in-depth, jangan cuma andalkan UI).
- Satpam menutup aplikasi di tengah sesi aktif → sesi tetap tersimpan sebagai aktif, begitu dibuka lagi tab Patroli langsung menampilkan checklist yang sudah terisi sejauh ini (tidak hilang).

## Testing

Tidak ada test suite otomatis di repo ini. Verifikasi:
1. `npx tsc --noEmit` dan `npm run lint` bersih.
2. Klik-tayang manual (atau penelusuran kode teliti kalau kredensial `isSatpam` tidak tersedia di lingkungan ini — keterbatasan yang sudah berulang kali muncul sepanjang sesi ini): mulai sesi, foto beberapa titik (konfirmasi watermark muncul di foto hasil), tambah 1-2 Foto Tambahan dengan keterangan, konfirmasi tombol Selesai Patroli nonaktif sampai ke-13 titik lengkap, selesaikan sesi, konfirmasi muncul di riwayat.

## Struktur File

- Buat: `scripts/create-satpam-patroli-tables.ts` (migrasi tabel, dijalankan manual sekali)
- Buat: `src/lib/queries/satpam-patroli.ts` (query MSSQL)
- Buat: `src/app/api/weather/route.ts`
- Buat: `src/hooks/use-patroli-camera-capture.ts`
- Buat: `src/app/api/mkesindo/upload/satpam-patroli/route.ts`
- Buat: `src/app/mkesindo/satpam-app/actions.ts` (server actions, mengikuti pola `src/app/mkesindo/driver-app/actions.ts` yang sudah ada — file actions di root app, bukan per-tab)
- Modifikasi: `src/app/mkesindo/satpam-app/(tabs)/patroli/page.tsx`
- Buat: `src/components/satpam-app/patroli-panel.tsx`
- Buat: `src/app/mkesindo/satpam-app/patroli/foto/[sesiId]/page.tsx`
- Buat: `src/components/satpam-app/patroli-foto-client.tsx` (komponen layar kamera penuh-layar)
- Tidak berubah: `src/hooks/use-live-camera-capture.ts`, `src/components/satpam-app/live-inspeksi-client.tsx`, seluruh alur Inspeksi kendaraan
