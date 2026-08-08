# Restrukturisasi Rute MKEsindo ke `/mkesindo` — Design Spec

## Latar Belakang

Saat ini PT Mitra Kelola Esindo (MKEsindo) adalah satu-satunya PT yang dashboard-nya hidup di root URL (`/`, `/pnl`, `/sales`, dst.) melalui route group `(dashboard)` — sebuah detail implementasi Next.js yang tidak muncul di URL. Ini membuat hirarki URL tidak konsisten: `/grup` (holding) dan `/pmputra` (PT lain) adalah segmen URL nyata, sementara MKEsindo "tersembunyi" di root, padahal secara struktur organisasi MKEsindo sejajar dengan PMPutra sebagai dua PT di bawah PMP Group.

Tujuan pekerjaan ini: memindahkan seluruh rute MKEsindo (termasuk `/driver-app` dan `/satpam-app`, yang secara fungsi murni milik MKEsindo hari ini) ke bawah `/mkesindo`, sehingga hirarki URL benar-benar mencerminkan hirarki bisnis: `/grup` (holding) → `/mkesindo`, `/pmputra` (PT-PT sejajar).

## Cakupan

### Peta URL

| Lama | Baru |
|---|---|
| `/` (beranda dashboard) | `/mkesindo` |
| `/pnl`, `/aging`, `/sales`, `/transaksi`, `/electricity`, `/delivery`, `/pemesanan`, `/mitra`, `/pemasaran` (dan seluruh sub-rute masing-masing) | `/mkesindo/pnl`, `/mkesindo/aging`, dst. |
| `/driver-app` (dan seluruh sub-rute) | `/mkesindo/driver-app` |
| `/satpam-app` (dan seluruh sub-rute) | `/mkesindo/satpam-app` |
| `/invoice/[token]`, `/payment/[token]` | `/mkesindo/invoice/[token]`, `/mkesindo/payment/[token]` |
| `/akses-ditolak` | **Tidak berubah** — tetap di root, dipakai bersama oleh seluruh PT (MKEsindo, PMPutra, PMP Group) karena isinya generik, bukan spesifik satu PT. |
| `/grup`, `/pmputra`, `/login`, `/api/auth/...` | Tidak berubah. |

Halaman invoice/payment publik (`/invoice`, `/payment`) saat ini **hanya pernah melayani data Es Kristal (MKEsindo)** — PMPutra belum punya modul Sales Order/Delivery Order/Invoice sama sekali (baru modul Keuangan yang hidup: P&L, neraca, arus kas). Karena itu keduanya dipindah ke `/mkesindo/invoice` dan `/mkesindo/payment` sekalian dalam pekerjaan ini, TANPA membuat versi PMPutra — lihat bagian "Di Luar Cakupan" di bawah.

### Rute API

Dipindah ke `/api/mkesindo/...` (data/fitur spesifik MKEsindo):
- `pabrik-location`
- `print/delivery-order/[deliveryOrderId]`
- `routing`, `routing/multi`
- `notifications/stream`
- `upload/armada-foto`, `upload/doc-template`, `upload/driver-app`, `upload/satpam-check`, `upload/site-asset`

Tidak berubah (utilitas bersama, bukan data milik satu PT):
- `auth/[...nextauth]` — konvensi baku NextAuth, tidak boleh dipindah.
- `geocode`, `geocode/search`, `wilayah/districts`, `wilayah/regencies` — utilitas generik, berpotensi dipakai PT lain di masa depan.

## Strategi Redirect

Dua mekanisme berbeda untuk dua kebutuhan berbeda:

1. **URL lama → baru (statis, tidak tergantung sesi login)** — didaftarkan sebagai satu larik deklaratif di `next.config.ts` (`redirects()`), mencakup seluruh path pada tabel di atas (`/pnl` → `/mkesindo/pnl`, `/driver-app` → `/mkesindo/driver-app`, dst., termasuk pola dinamis seperti `/invoice/:token*` → `/mkesindo/invoice/:token*`). Ini murni jaring pengaman untuk bookmark/kebiasaan lama — ditangani Next.js di lapisan routing, tanpa logika tambahan di `proxy.ts`.

2. **Root `/` setelah login (dinamis, tergantung `accountScope`)** — `proxy.ts` (di root repo — bukan `src/proxy.ts`, yang sudah dihapus di pekerjaan sebelumnya) mendapat aturan baru: `accountScope === "mkesindo"` dan path adalah tepat `/` → redirect ke `/mkesindo`. Pola ini sudah ada persis untuk `pmputra` → `/pmputra` dan `direktur` → `/grup`; sekarang MKEsindo mengikuti pola yang sama alih-alih menjadi default implisit "semua yang bukan /grup atau /pmputra".

Penting: mekanisme redirect ini TIDAK menggantikan kebutuhan memperbarui seluruh referensi internal (lihat "Pendekatan Implementasi").

## Pendekatan Implementasi

**Pindahkan folder fisik + perbarui seluruh referensi internal.** `src/app/(dashboard)/*` dipindah menjadi `src/app/mkesindo/*` (segmen URL sungguhan — layout, page, dan seluruh sub-folder modul ikut pindah), `src/app/driver-app` → `src/app/mkesindo/driver-app`, `src/app/satpam-app` → `src/app/mkesindo/satpam-app`, `src/app/invoice` → `src/app/mkesindo/invoice`, `src/app/payment` → `src/app/mkesindo/payment`.

`akses-ditolak` dikeluarkan dari `(dashboard)` dan menjadi folder top-level tersendiri: `src/app/akses-ditolak/page.tsx`, tanpa layout tambahan (memakai root `layout.tsx` apa adanya — tidak mewarisi `AppSidebar`/header milik MKEsindo, karena halaman ini juga harus tampil wajar untuk akun PMPutra atau direktur yang ditolak aksesnya, bukan cuma akun MKEsindo).

Halaman `invoice`/`payment` di bawah `/mkesindo/invoice` dan `/mkesindo/payment` adalah rute publik (diakses pelanggan lewat token, tanpa login) — ini satu-satunya sub-path di bawah `/mkesindo` yang TIDAK memerlukan sesi. `PUBLIC_PREFIXES` di `proxy.ts` diperbarui dari `"/invoice"`, `"/payment"` menjadi `"/mkesindo/invoice"`, `"/mkesindo/payment"`, supaya keduanya tetap bisa diakses tanpa login setelah pindah.

Setiap referensi path hardcoded diperbarui langsung ke path baru — bukan dibiarkan mengandalkan redirect layer:
- Setiap `<Link href="...">` dan `router.push("...")` yang menunjuk salah satu path lama.
- Setiap `redirect("...")` di Server Component/Server Action.
- Setiap `revalidatePath("...")` di Server Action.
- Item navigasi di `AppSidebar`, `PmputraSidebar` tidak berubah (sudah benar); `AppSidebar`'s NAV_ITEMS diperbarui ke path baru.
- `proxy.ts` — aturan baru untuk `accountScope === "mkesindo"`.
- File konfigurasi/util lain yang mereferensikan path ini (mis. `PUBLIC_PREFIXES` di `proxy.ts` untuk `/invoice`, `/payment` menjadi bagian dari prefix `/mkesindo` yang tetap publik untuk token-based routes tersebut, atau tetap didaftarkan eksplisit — detail ini diselesaikan saat implementasi).

**Alternatif yang dipertimbangkan dan ditolak:** memakai `rewrites()` untuk membuat `/mkesindo/*` menyajikan konten `(dashboard)/*` yang sekarang tanpa memindah file. Ditolak karena address bar akan tetap menampilkan URL lama pada navigasi internal — tidak benar-benar mencapai tujuan "sejajar dengan `/pmputra`", hanya alias kosmetik dari luar.

## Urutan Pengerjaan

Satu rencana, dipecah menjadi tahapan yang masing-masing bisa diverifikasi sebelum lanjut ke tahap berikutnya:

1. Pindahkan `driver-app` dan `satpam-app` ke `/mkesindo/driver-app`, `/mkesindo/satpam-app` (paling terisolasi, referensi silang paling sedikit) — verifikasi login + alur masing-masing sebelum lanjut.
2. Pindahkan `invoice` dan `payment` ke `/mkesindo/invoice`, `/mkesindo/payment` — verifikasi link yang sudah beredar (jika ada) tetap bisa diakses lewat redirect.
3. Pindahkan modul-modul dashboard MKEsindo (`pnl`, `aging`, `sales`, `transaksi`, `electricity`, `delivery`, `pemesanan`, `mitra`, `pemasaran`, beranda) ke `/mkesindo/...`, perbarui `AppSidebar` dan seluruh link/redirect/revalidatePath internal.
4. Restrukturisasi endpoint API yang sudah disepakati pindah ke `/api/mkesindo/...`.
5. Perbarui `proxy.ts`: tambah aturan `accountScope === "mkesindo"` → `/mkesindo` untuk path `/`, pastikan bypass lintas-PT (`canAccessAllPT`) tetap berfungsi seperti sebelumnya untuk seluruh path baru.
6. Tambahkan tabel `redirects()` di `next.config.ts` untuk seluruh path lama → baru.
7. Verifikasi menyeluruh: setiap path lama (harus redirect benar) dan path baru (harus berfungsi normal), untuk setiap peran akun (mkesindo biasa, pmputra, direktur, superadmin, satpam, driver).

## Risiko

- **Aplikasi native Android**: dikonfirmasi aman — `capacitor.config.ts` hanya menunjuk domain root (`https://dash.pabrikespmp.com`), tidak ada path spesifik yang di-*hardcode* di native config maupun kode Kotlin/Java.
- **`proxy.ts`**: komponen yang baru saja terbukti rapuh terhadap kesalahan kecil yang sulit terdeteksi (ada dua file `proxy.ts` yang membingungkan di pekerjaan sebelumnya, sudah diperbaiki). Perubahan pada file ini akan diuji eksplisit untuk setiap kombinasi peran sebelum dianggap selesai.
- **Volume perubahan**: sekitar 40-50 file menyentuh path yang berubah — mekanis tapi butuh ketelitian; setiap tahap di atas diverifikasi sebelum lanjut untuk membatasi blast radius kalau ada yang terlewat.

## Di Luar Cakupan

- **Versi PMPutra untuk invoice/payment publik.** PMPutra belum punya modul Sales Order/Delivery Order/Invoice yang hidup (skema `FINAC_ES_PO`/`FINAC_LOGISTIC_PO` untuk ini belum diintegrasikan — baru Keuangan). Membangun halaman invoice/payment untuk PMPutra sekarang berarti menebak skema yang belum jelas — proyek terpisah, dikerjakan setelah modul Penjualan/Pengiriman PMPutra benar-benar hidup.
- **Restrukturisasi rute PMPutra atau `/grup`.** Keduanya sudah berada di posisi yang benar, tidak ada perubahan.

## Catatan Rencana ke Depan (bukan bagian dari pekerjaan ini)

Ke depannya — di luar pekerjaan ini, sebagai catatan untuk proyek terpisah nanti:
- `/mkesindo/invoice` dan `/mkesindo/payment` direncanakan berganti nama menjadi `/kristal/invoice` dan `/kristal/payment`.
- Saat modul Penjualan/Pengiriman/Invoice PMPutra sudah hidup, versi PMPutra-nya akan dibuat langsung dengan nama `/balok/invoice` dan `/balok/payment` (bukan `/pmputra/invoice` dan `/pmputra/payment`).

Penamaan `kristal`/`balok` ini mengikuti jenis bisnis (Es Kristal / Es Balok) yang lebih relevan untuk halaman publik pelanggan dibanding kode internal perusahaan (`mkesindo`/`pmputra`). Ini murni catatan arah masa depan — tidak diimplementasikan dalam pekerjaan ini.
