# Ikon Status Upload Foto (Seluruh Sistem)

## Konteks

Saat ini setiap alur upload foto di dashpmp menampilkan status upload
hanya lewat teks ("Mengunggah...") atau teks error merah di bawah tombol
— tidak ada indikator visual langsung pada foto itu sendiri. Permintaan
ini menambahkan ikon status (centang untuk berhasil, silang untuk gagal,
loading untuk sedang berjalan) di pojok kanan-atas setiap foto, diterapkan
ke seluruh sistem.

Riset menemukan **6 alur upload foto yang benar-benar independen**, tidak
ada hook atau komponen upload bersama sama sekali (hanya satu util storage
bersama `uploadFile` di level server, dan satu komponen capture-kamera
bersama `LiveCameraCaptureField` di level client):

1. **Kualitas** (`src/components/produksi-app/kualitas-view.tsx`) — 1 foto,
   upload langsung saat difoto.
2. **Vehicle Check** (`src/components/dashboard/vehicle-check-dialog.tsx`)
   — 4 sisi truk, upload langsung per sisi saat difoto.
3. **Bukti Pengiriman** (multi-foto,
   `src/components/driver-app/multi-photo-capture-field.tsx` dipakai dari
   `src/components/driver-app/steps/konfir-kirim-step.tsx`) — foto
   ditumpuk lokal dulu, upload semua sekaligus saat tombol "Lanjut"
   ditekan.
4. **Retur** (foto per item retur, di file yang sama dengan #3) — upload
   bersamaan dengan #3, saat submit.
5. **Tanda Tangan** (`src/components/driver-app/steps/konfir-terima-step.tsx`)
   — upload saat submit konfirmasi terima.
6. **Foto Armada** (`src/components/dashboard/armada-dialog.tsx`,
   termasuk foto QR MyPertamina) — input file biasa, upload saat pilih
   file.
7. **Logo Situs & Template Dokumen** (panel pengaturan situs & template
   dokumen, admin) — input file biasa, upload saat pilih file.

(Penomoran di atas 7 karena Retur dihitung terpisah dari Bukti Pengiriman
meski satu file — keduanya independen secara UI meski upload-nya
bersamaan.)

## Non-Goals

- **Tidak ada hook upload bersama** — Pendekatan yang dipilih (bukan
  pendekatan yang menyatukan logika fetch/FormData ke satu hook) adalah
  murni menambah komponen tampilan bersama; logika upload di keenam
  lokasi tetap independen seperti sekarang, tidak direfaktor.
- **Tidak ada interaksi retry baru** — ikon silang murni indikator visual,
  bukan tombol. Pemulihan error tetap seperti sekarang (teks merah di
  bawah tombol/form).
- **Tidak ada perubahan pada validasi file** (tipe/ukuran) — itu sudah
  ditangani di masing-masing API route, tidak disentuh sama sekali.

## Bagian 1: Komponen Overlay Bersama

Komponen baru `src/components/ui/photo-status-overlay.tsx`,
`PhotoStatusOverlay({ status })` dengan `status?: "uploading" | "success"
| "error"` — kalau `undefined` (idle, foto belum diambil/belum ada upaya
upload), komponen tidak merender apa pun.

- **Berhasil**: ikon `CheckCircle2` (lucide-react), `text-emerald-600`.
- **Gagal**: ikon `XCircle` (lucide-react), `text-destructive`.
- **Sedang mengunggah**: ikon `Loader2` (lucide-react) dengan
  `animate-spin`, warna netral (`text-muted-foreground`).
- Setiap ikon dibungkus chip bulat kecil (`bg-background`, `shadow-sm`,
  `rounded-full`, ukuran chip ~20px, ikon ~14px di dalamnya) supaya
  kontras di atas foto apa pun, diposisikan `absolute -top-1.5 -right-1.5`
  — persis meniru posisi tombol hapus (X) yang sudah ada di grid
  multi-foto driver, demi konsistensi visual.
- Setiap ikon punya `title`/`aria-label` singkat: "Sedang mengunggah",
  "Berhasil diunggah", "Gagal diunggah".
- Parent yang memakai komponen ini wajib punya `className="relative"`
  di elemen pembungkus foto agar posisi absolut ini benar.

Komponen ini murni tampilan — tidak melakukan fetch, tidak menyimpan
state upload apa pun sendiri.

## Bagian 2: Penyesuaian `LiveCameraCaptureField`

`src/components/dashboard/live-camera-capture-field.tsx` sudah punya
elemen pembungkus `relative` sebagai akar visualnya, dan dipakai oleh 4
dari 6/7 lokasi (Kualitas, Vehicle Check, tombol "Tambah Foto" di
multi-foto, capture foto Retur). Ditambah prop opsional:

```ts
status?: "uploading" | "success" | "error";
```

Dirender sebagai `<PhotoStatusOverlay status={status} />` di dalam
elemen `relative` yang sudah ada. Ini adalah penambahan prop tampilan ke
komponen bersama yang sudah ada, bukan logika upload baru — sejalan
dengan Non-Goals di atas.

2 lokasi yang tidak memakai `LiveCameraCaptureField` (Foto Armada/QR,
Logo Situs & Template Dokumen — keduanya `<input type="file">` biasa
dengan `<img>` pratinjau manual) membungkus `PhotoStatusOverlay` secara
langsung di sekitar `<img>` masing-masing.

## Bagian 3: Retrofit per Lokasi

| # | Lokasi | State status | Sumber status | Catatan perubahan perilaku |
|---|---|---|---|---|
| 1 | Kualitas | State baru `fotoStatus?: "uploading"\|"success"\|"error"` | Diisi eksplisit di `handleCapture` (uploading → sukses/gagal) | State ini **terpisah** dari state `error` form yang sudah ada (dipakai bersama untuk validasi lain, mis. "Pilih mesin") — kalau disatukan, ikon silang bisa salah muncul di foto padahal errornya bukan soal foto. |
| 2 | Vehicle Check | Map baru `photoStatus: Partial<Record<JenisFotoKendaraan, "uploading"\|"success"\|"error">>` | Diisi per sisi truk di fungsi upload yang sudah ada | 4 slot independen, satu kamera aktif per waktu — makanya map, bukan skalar tunggal seperti Kualitas. |
| 3 | Bukti Pengiriman (multi-foto) | Array/map status baru di `konfir-kirim-step.tsx`, diteruskan ke `MultiPhotoCaptureField` lewat prop baru `statuses?: Record<number, "uploading"\|"success"\|"error">` | Diisi saat `handleSubmit` menjalankan `Promise.all` upload — setiap foto diberi `.then`/`.catch` sendiri supaya statusnya bisa diperbarui satu-satu, bukan menunggu semua selesai baru tahu mana yang gagal | **Pojok kanan-atas berbagi peran dengan tombol hapus (X) yang sudah ada**: selama belum submit, tombol hapus tetap seperti sekarang. Begitu `submitting` true, pojok itu berganti jadi `PhotoStatusOverlay` (form memang terkunci saat submit, jadi hapus foto saat itu tidak relevan). |
| 4 | Retur (foto per item) | Map status baru `returFotoStatus: Record<string, "uploading"\|"success"\|"error">` (kunci: `SalesOrderDetailID`) | Diisi bersamaan dengan #3, di `Promise.all` yang sama | — |
| 5 | Tanda Tangan | State baru `signatureStatus?: "uploading"\|"success"\|"error"` | Diisi di `handleConfirm` sekitar pemanggilan `uploadSignature` | Overlay dipasang di atas area pratinjau tanda tangan (`SignaturePad`). |
| 6 | Foto Armada (+ QR MyPertamina) | Diturunkan langsung dari state `uploading`/`uploadError` yang sudah ada (sudah spesifik ke foto ini, tidak tercampur validasi lain) | — | **Perubahan perilaku**: saat ini foto disembunyikan total selama upload (`{(previewUrl ?? fotoPath) && !uploading && (<img/>)}`); diubah supaya foto (pakai `previewUrl`, sudah tersedia begitu file dipilih) tetap tampil dengan overlay loading di atasnya, tidak hilang. |
| 7 | Logo Situs & Template Dokumen | Diturunkan dari `uploading`/`uploadError` yang sudah ada | — | Paling sederhana — `<img>` sudah selalu tampil tanpa syarat, tinggal dibungkus `relative` + overlay. |

## Bagian 4: Reset, Aksesibilitas, Verifikasi

- **Reset saat foto diambil ulang**: memotret ulang otomatis
  mengembalikan status ke `"uploading"` di awal `handleCapture`, menimpa
  status lama (gagal/berhasil) — tidak perlu logika reset terpisah.
- **Reset saat dialog ditutup/dibuka lagi**: setiap dialog yang sudah
  punya fungsi `reset()` (Kualitas, Vehicle Check, Armada) menyertakan
  state status foto baru ini juga, supaya membuka dialog baru tidak
  menampilkan sisa ikon dari sesi sebelumnya.
- **Aksesibilitas**: lihat `title`/`aria-label` di Bagian 1.
- **Verifikasi**: tidak ada automated test framework di repo ini —
  verifikasi tiap lokasi lewat `npx tsc --noEmit`, `npx eslint`, dan cek
  manual di browser (mode dev) untuk memastikan ketiga status tampil
  benar di setiap dari 7 titik retrofit.

## Ringkasan Keputusan yang Sudah Dikonfirmasi

- Cakupan: semua 6 alur upload foto yang ada (Kualitas, Vehicle Check,
  Bukti Pengiriman, Retur, Tanda Tangan, Armada, Logo Situs & Template
  Dokumen — 7 titik retrofit karena Retur dihitung terpisah).
- Pendekatan: komponen overlay tampilan bersama (`PhotoStatusOverlay`)
  ditambah prop `status` opsional di `LiveCameraCaptureField` yang sudah
  ada — TANPA hook upload bersama; logika fetch/FormData di keenam alur
  tetap independen seperti sekarang.
- Tidak ada interaksi retry baru pada ikon gagal — murni indikator.
- Dua perubahan perilaku kecil disetujui: (1) di Bukti Pengiriman,
  tombol hapus (X) berganti jadi ikon status saat submit berlangsung;
  (2) di Armada, foto tidak lagi disembunyikan total selama upload,
  melainkan tetap tampil dengan ikon loading di atasnya.
- Implementasi akan dipecah jadi beberapa task terpisah (bukan satu
  perubahan besar) karena menyentuh 3 area berbeda (produksi-app,
  dashboard bersama, driver-app) yang saling independen.
