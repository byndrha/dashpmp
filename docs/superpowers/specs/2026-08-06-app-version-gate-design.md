# Deteksi Versi Aplikasi & Pembaruan Paksa/Opsional

## Latar Belakang

`capacitor.config.ts` memakai `server.url`, sehingga kode web (JS/React) selalu otomatis versi terbaru setiap kali aplikasi dibuka — tidak pernah "basi". Tapi shell native Android (izin runtime seperti CAMERA, plugin `@capgo/background-geolocation`, `OfflineAwareWebViewClient`) hanya berlaku setelah APK benar-benar di-*rebuild* dan diinstal ulang di perangkat. Beberapa perubahan sesi ini (izin kamera untuk Satpam, plugin pelacakan lokasi latar belakang, fallback offline) menambah risiko: perangkat yang masih memakai APK lama bisa menjalankan kode web yang berasumsi kemampuan native tertentu ada, padahal belum di-*install*-kan.

`android/app/build.gradle` saat ini masih `versionCode 1` / `versionName "1.0"` — belum pernah dinaikkan meski sudah beberapa kali ada perubahan level-native.

Fitur ini memberi jaring pengaman: saat aplikasi dibuka, deteksi versi native APK yang berjalan, dan jika di bawah ambang minimum, blokir penggunaan hingga user memperbarui.

## Cakupan

Hanya untuk aplikasi native (Android, dijalankan lewat Capacitor). Tidak berlaku untuk akses dashboard via browser desktop biasa.

## Arsitektur

Konfigurasi versi disimpan statis sebagai konstanta kode (bukan tabel DB + UI admin), karena:
- Nilai ini hanya relevan berubah bersamaan dengan rilis APK baru, yang selama ini dikerjakan lewat sesi kerja developer, bukan oleh Superadmin lewat dashboard.
- Karena web selalu di-*load* fresh dari `server.url`, mengedit file config + deploy web sudah cukup membuat aturan baru berlaku ke semua perangkat pada buka-app berikutnya, tanpa perlu API endpoint atau server action tambahan.

## Komponen

### 1. `src/lib/app-version-config.ts` (baru)

Konstanta yang diedit manual setiap rilis APK:

```ts
// Dinaikkan setiap kali android/app/build.gradle versionCode dinaikkan.
// APP_MIN_VERSION_CODE: versi di bawah ini diblokir total (wajib update).
// APP_LATEST_VERSION_CODE / APP_LATEST_VERSION_NAME: versi terbaru yang
// tersedia, dipakai untuk banner "update tersedia" (non-blocking) saat
// versi user masih >= minimum tapi < terbaru.
export const APP_MIN_VERSION_CODE = 1;
export const APP_LATEST_VERSION_CODE = 1;
export const APP_LATEST_VERSION_NAME = "1.0";
```

### 2. `src/components/app-version-gate.tsx` (baru, client component)

- Gating: render `null` kecuali `Capacitor.isNativePlatform()` true.
- Saat mount (`useEffect`, sekali): panggil `App.getInfo()` dari `@capacitor/app`, ambil `build` (string versionCode Android) dan `version` (versionName, untuk tampilan saja). Parse `build` ke integer.
- Jika `App.getInfo()` gagal (throw) → tangkap, render `null` (tidak mengganggu user dengan error).
- State: `currentVersionCode: number | null`.
- Logika render:
  - `currentVersionCode === null` (belum termuat / gagal) → `null`.
  - `currentVersionCode < APP_MIN_VERSION_CODE` → render layar blokir penuh (lihat di bawah). Anak komponen (`children`) TIDAK dirender.
  - `APP_MIN_VERSION_CODE <= currentVersionCode < APP_LATEST_VERSION_CODE` → render banner update opsional (bisa ditutup) DI ATAS `children` (children tetap dirender & tetap bisa dipakai).
  - `currentVersionCode >= APP_LATEST_VERSION_CODE` → render `children` saja, tanpa UI tambahan.
- Dipasang membungkus children di `src/components/providers.tsx`, di posisi terluar `PaletteProvider` (agar layar blokir menimpa seluruh isi app termasuk NativeStatusBarSync/LocationTrackingBootstrap yang sudah ada — komponen tersebut tetap mount seperti biasa, hanya isi visual dashboard yang tertutup overlay).

### 3. Layar blokir wajib (bagian dari `app-version-gate.tsx`)

- `<div className="fixed inset-0 z-[9999] ...">` — bukan Radix `Dialog`, supaya tidak ada jalur tutup lewat Escape/klik-luar.
- Tidak ada tombol tutup, tidak ada tombol aksi/link (sesuai keputusan: instruksi teks saja, tanpa link download).
- Konten: ikon peringatan, judul "Pembaruan Aplikasi Wajib", teks: "Versi aplikasi ini sudah tidak didukung. Hubungi admin/IT perusahaan untuk mendapatkan pembaruan aplikasi sebelum melanjutkan."
- Mengikuti palet warna/tema yang sudah ada di app (dark/light aware, konsisten dengan komponen dashboard lain — pakai token warna Tailwind/shadcn yang sudah dipakai project, bukan warna hardcoded baru).

### 4. Banner update opsional (bagian dari `app-version-gate.tsx`)

- Bar tipis, posisi di atas konten (bukan modal), dengan tombol X untuk menutup.
- Teks: "Versi baru (v{APP_LATEST_VERSION_NAME}) tersedia. Hubungi admin/IT untuk memperbarui aplikasi."
- State tutup: `useState<boolean>` lokal komponen (bukan localStorage/cookie) — otomatis muncul lagi di sesi buka-app berikutnya karena component ter-mount ulang setiap cold start aplikasi native.

## Dependensi

- Tambah `@capacitor/app` ke `package.json` (belum terpasang — dicek, hanya ada `@capacitor/android`, `@capacitor/core`, `@capacitor/geolocation`, `@capacitor/ios`, `@capacitor/status-bar`).
- Setelah `npm install @capacitor/app`, jalankan `npx cap sync android` agar modul native plugin ter-registrasi (pola yang sama seperti saat menambah `@capgo/background-geolocation` sebelumnya).

## Penanganan Error

- `App.getInfo()` gagal / plugin tidak tersedia → tangkap di `try/catch`, treat sebagai "belum diketahui", tidak render UI apa pun (fail-open, tidak mem-blokir user karena kegagalan teknis membaca versi).
- Tidak ada percobaan ulang (retry) — cukup sekali cek per cold-start, konsisten dengan pola `LocationTrackingBootstrap`.

## Pengujian

Karena APK sungguhan tidak bisa di-*build*/dijalankan di sandbox ini (kendala environment yang sudah ditemukan sebelumnya), verifikasi dilakukan dengan:
- Unit-level: fungsi perbandingan versi (murni, tanpa I/O) diuji dengan beberapa kombinasi (`current < min`, `min <= current < latest`, `current >= latest`).
- Verifikasi visual: render `AppVersionGate` di lingkungan dev biasa (browser, bukan native) untuk memastikan tidak muncul apa pun ketika `Capacitor.isNativePlatform()` false (perilaku default di browser) — lalu, jika memungkinkan, paksa nilai `currentVersionCode` via override sementara untuk melihat kedua tampilan (blokir & banner) secara visual di browser preview.
- Rebuild APK sungguhan dan uji end-to-end di perangkat Android tetap menjadi tanggung jawab user (di luar sandbox ini), sama seperti proses build APK sebelumnya.

## Di Luar Cakupan

- Tidak ada tombol/link unduh APK otomatis.
- Tidak ada tabel DB atau halaman admin untuk mengatur versi — murni file config kode.
- Tidak menyentuh iOS (belum ada rilis iOS aktif untuk project ini).
