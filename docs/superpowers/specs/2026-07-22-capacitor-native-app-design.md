# Capacitor Native App — Design Spec

Status: Approved by user, ready for implementation plan.
Date: 2026-07-22

## Latar Belakang & Tujuan

Sub-proyek 2 dari inisiatif Modul Pemasaran (lihat
`docs/superpowers/specs/2026-07-22-modul-pemasaran-design.md`): membungkus
dashboard web yang sudah ada jadi app native Android (dan scaffold iOS)
lewat Capacitor, supaya staff bisa install app langsung di HP alih-alih
buka lewat browser mobile.

Cakupan: **seluruh dashboard**, bukan cuma alur Marketing — semua modul dan
role yang sudah ada tetap bisa diakses dari app native persis seperti dari
browser desktop.

## Arsitektur

App ini `output: "standalone"` (Next.js Server Actions, session NextAuth
server-side, koneksi SQL langsung) — **tidak bisa** di-export jadi static
HTML yang berjalan mandiri di device. Karena itu, pendekatan yang dipakai:
Capacitor membungkus WebView yang menunjuk ke URL production yang sudah
live, `https://dash.pabrikespmp.com`, lewat `server.url` di
`capacitor.config.ts` — bukan bundle offline.

Konsekuensi:
- Tidak ada perubahan pada kode Next.js/web yang sudah ada, kecuali satu
  titik integrasi GPS (lihat bagian Fitur Native).
- Sub-proyek ini murni menambah folder native baru (`android/`, `ios/`) +
  file konfigurasi Capacitor di root project, terpisah total dari `src/`.
- App butuh koneksi internet untuk berfungsi — tidak ada mode offline.
- Auth tetap pakai session cookie NextAuth seperti biasa — WebView
  menyimpan cookie sama seperti browser mobile, sehingga login persisten
  antar buka-tutup app tanpa perubahan apa pun di server.
- Kalau URL production berubah nanti, cukup update satu baris config lalu
  build ulang APK.

## Konfigurasi Capacitor

- **Package ID (Android `applicationId`):** `com.pabrikespmp.dashboard`
  (reverse-domain dari `pabrikespmp.com`).
- **App name:** `PMP Group` (label di bawah ikon Home Screen).
- **Ikon & Splash Screen:** dibuat dari mark heksagonal "es" yang sudah ada
  di `src/components/dashboard/ice-mark.tsx`, di atas warna primary tema
  (`oklch(0.55 0.14 175)`, hijau-teal — default sidebar/tombol saat ini).
  Satu file master 1024×1024 digenerate ke semua ukuran resolusi
  Android/iOS lewat `@capacitor/assets`.
- **`capacitor.config.ts`:**
  - `appId: "com.pabrikespmp.dashboard"`
  - `appName: "PMP Group"`
  - `webDir`: folder placeholder (wajib ada secara teknis untuk tooling
    Capacitor, isinya halaman loading sederhana bertema sama — nyaris
    tidak pernah tampil karena `server.url` langsung override begitu
    WebView bisa connect)
  - `server.url: "https://dash.pabrikespmp.com"`
  - `server.androidScheme: "https"`
- **Permission Android** (`AndroidManifest.xml`): `INTERNET` (default),
  `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` (untuk GPS).

## Fitur Native

- **GPS (`@capacitor/geolocation`):** titik integrasi di
  `src/components/dashboard/mitra-location-map.tsx` dan
  `mitra-location-field.tsx`, yang sekarang panggil `navigator.geolocation`
  browser langsung. Diganti ke Capacitor's Geolocation plugin API
  (`Geolocation.getCurrentPosition()` / permission check). Plugin ini
  otomatis fallback ke `navigator.geolocation` bawaan kalau dijalankan di
  browser biasa (bukan di app native) — satu kode jalan konsisten di
  browser desktop, browser mobile, DAN app native, tanpa cabang logic
  terpisah. Dipakai di form Pengajuan Mitra (modul Pemasaran) dan form
  Mitra biasa (modul Mitra) — keduanya reuse komponen yang sama.
- **Tombol Back Android (`@capacitor/app`):** back di WebView history kalau
  masih bisa mundur; keluar app kalau sudah di halaman awal (perilaku
  standar Android).
- **Status bar (`@capacitor/status-bar`):** warna ikon status bar
  menyesuaikan tema app (terang/gelap) saat ini.
- **iOS:** platform di-scaffold (struktur project, `Info.plist` dengan
  deskripsi izin lokasi `NSLocationWhenInUseUsageDescription`, dst.) supaya
  siap dipakai nanti, tapi **tidak dibangun/ditest end-to-end** di
  sub-proyek ini — build iOS sungguhan butuh Mac + akun Apple Developer
  yang belum dibahas/dimiliki di scope ini.

## Build & Distribusi

1. `npx cap sync android` — sinkronkan config & assets ke project native.
2. Build APK release lewat Android Studio (atau `./gradlew
   assembleRelease` via CLI).
3. Sign APK dengan release keystore (dibuat sekali, disimpan aman — bukan
   dikomit ke git).
4. Bagikan APK langsung ke staff (side-load — link download / share file).
   **Bukan** lewat Google Play Store.

## Yang Sengaja Tidak Dikerjakan (di luar spec ini)

- Build & distribusi iOS sungguhan (App Store/TestFlight) — hanya scaffold
  struktur project, build nyata jadi item terpisah nanti kalau ada Mac.
- Publikasi ke Google Play Store — side-load internal saja untuk sekarang.
- Push notification.
- Mode offline / bundle konten statis lokal.
- UI/UX khusus mobile-native yang beda dari web (mis. bottom nav bar
  native) — app tetap pakai UI web yang sudah responsive/mobile-friendly
  apa adanya.

## Verifikasi

Tidak ada framework test di project ini (konsisten dengan seluruh
codebase). Verifikasi: build APK debug berhasil tanpa error → install &
jalankan di emulator Android (Android Studio) atau device fisik → cek app
terbuka, bisa login, navigasi antar modul jalan, dan khususnya form
Pengajuan Mitra bisa minta izin lokasi & GPS berfungsi (satu-satunya
bagian dengan kode native baru yang berisiko).
