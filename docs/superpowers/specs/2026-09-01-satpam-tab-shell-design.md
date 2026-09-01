# Tab-Shell Satpam-App (Inspeksi/Patroli/Tamu) — Design Spec

## Latar belakang

Sub-proyek #2b dari roadmap perluasan `/mkesindo/satpam-app` (lihat `docs/superpowers/specs/2026-09-01-satpam-roster-shift-design.md`'s Latar Belakang untuk daftar lengkap 6 sub-proyek). Sub-proyek #1 (ikon status upload) dan #2a (fondasi roster/shift Satpam, admin `/mkesindo/keamanan`) sudah selesai.

`satpam-app` saat ini hanya punya 2 layar: `src/app/mkesindo/satpam-app/page.tsx` (Beranda — daftar Kartu Pengiriman BERANGKAT/DATANG + Riwayat Hari Ini, lewat `SatpamBerandaClient`) dan `src/app/mkesindo/satpam-app/inspeksi/[jadwalId]/page.tsx` (layar penuh-layar `LiveInspeksiClient` untuk mengambil 6 foto + data kendaraan). Tidak ada navbar/tab-shell sama sekali — "header" saat ini cuma `<header>` inline di dalam `beranda-client.tsx`.

Sub-proyek ini membangun navbar 3-tab (Inspeksi/Patroli/Tamu) untuk `satpam-app`, mengikuti persis pola keep-alive tab-shell yang sudah mapan dan terbukti di `driver-app` (`DriverTabShell`/`DriverBottomNav`, dengan struktur route `(tabs)/<segment>/page.tsx`) dan `produksi-app` (`ProduksiTabShell`, header bersama berisi judul + `AppearanceMenu` + `UserMenu`).

## Tujuan

1. Navbar bawah 3-tab: Inspeksi, Patroli, Tamu.
2. Konten Beranda yang sudah ada (Tabs BERANGKAT/DATANG + daftar kartu + Riwayat Hari Ini) pindah utuh ke bawah tab "Inspeksi", tanpa perubahan perilaku/data.
3. Tab Patroli dan Tamu menampilkan placeholder "Segera Hadir" — kontennya sendiri adalah sub-proyek terpisah (#5 dan #6).
4. Header (judul + `AppearanceMenu` + `UserMenu`) menjadi milik shell (satu tempat, dipakai semua tab) — bukan lagi milik konten Beranda sendiri.
5. Setiap tab yang sudah pernah dikunjungi tetap ter-mount (pola keep-alive), sehingga berpindah tab tidak memicu fetch ulang atau kehilangan state lokal (mis. pilihan sub-tab BERANGKAT/DATANG di Inspeksi).

## Non-tujuan

- **Tidak** membangun konten fungsional apa pun untuk tab Patroli (kamera panorama, watermark, checklist foto) — itu sub-proyek #5.
- **Tidak** membangun konten fungsional apa pun untuk tab Tamu (form pengunjung masuk/keluar) — itu sub-proyek #6.
- **Tidak** mengubah `LiveInspeksiClient` atau alur inspeksi kendaraan penuh-layar sama sekali — tetap route terpisah, dijangkau lewat `router.push`, di luar struktur `(tabs)/`.
- **Tidak** memasang tampilan "siapa sedang piket" dari roster/shift (#2a) ke layar manapun di sini — itu pemasangan untuk sub-proyek #5/#6 nanti, bukan bagian dari shell navigasi ini.
- **Tidak** mengubah `getSatpamInspectionList`/`getSatpamTimeline` atau query lain yang sudah ada — hanya dipindah lokasi pemanggilannya (dari `page.tsx` lama ke `(tabs)/page.tsx` baru), bukan diubah isinya.

## Struktur Route

```
src/app/mkesindo/satpam-app/
  (tabs)/
    layout.tsx              -- BARU: gate requireSatpam() (defense-in-depth, sama seperti driver-app's (tabs)/layout.tsx)
    page.tsx                 -- BARU (menggantikan page.tsx lama di lokasi ini): tab Inspeksi, initialTab="inspeksi"
    patroli/page.tsx         -- BARU: tab Patroli (stub), initialTab="patroli", tanpa data
    tamu/page.tsx             -- BARU: tab Tamu (stub), initialTab="tamu", tanpa data
  inspeksi/[jadwalId]/page.tsx  -- TIDAK BERUBAH, tetap sibling di luar (tabs)/
```

`src/app/mkesindo/satpam-app/page.tsx` (file lama, di luar `(tabs)/`) **dihapus** — Next.js App Router tidak bisa punya dua route yang sama-sama menjawab `/mkesindo/satpam-app` (satu di luar `(tabs)/`, satu route-group `(tabs)/page.tsx` di dalamnya juga menjawab path yang sama karena route group tidak muncul di URL) — jadi konten & logic-nya dipindah utuh ke `(tabs)/page.tsx` yang baru, filenya sendiri dihapus.

## Komponen

**`src/components/satpam-app/satpam-tab-shell.tsx`** (BARU) — meniru persis `ProduksiTabShell`:
- `SatpamTabKey = "inspeksi" | "patroli" | "tamu"`.
- `TAB_PATHS: Record<SatpamTabKey, string>` — `{ inspeksi: "/mkesindo/satpam-app", patroli: "/mkesindo/satpam-app/patroli", tamu: "/mkesindo/satpam-app/tamu" }`, dipakai murni untuk `history.replaceState` (sinkronisasi kosmetik URL), bukan navigasi Next.js sungguhan.
- State: `activeTab`, `visited: Set<SatpamTabKey>` (pola keep-alive identik `ProduksiTabShell`/`DriverTabShell`).
- Props: `initialTab: SatpamTabKey`, `userName: string`, `profile: OwnProfile | null`, `initialCards?: SatpamInspectionCard[]`, `initialTimeline?: SatpamTimelineEntry[]` (hanya diisi kalau `initialTab === "inspeksi"`; `undefined` untuk Patroli/Tamu, konsisten dengan pola `DriverTabShell`'s `initial<X>?` optional props).
- Render: `<header>` (judul "Aplikasi Satpam" + `AppearanceMenu` + `UserMenu`, style identik `ProduksiTabShell`'s header) → area konten (`InspeksiPanel` untuk tab Inspeksi, `ComingSoonPanel` untuk Patroli/Tamu, di-toggle lewat `hidden` class per pola keep-alive) → `SatpamBottomNav` di bawah (flex sibling, **bukan** `fixed` — pelajaran yang sudah didokumentasikan di `DriverBottomNav`'s komentar sendiri soal kenapa `fixed` bermasalah dengan konten `flex-1` di atasnya).
- Tidak ada fetch-on-tab-switch untuk Patroli/Tamu di sub-proyek ini (keduanya statis, tanpa data) — logic `useEffect` fetch-lazy seperti `DriverTabShell` HANYA diperlukan kalau tab punya data untuk diambil; karena Patroli/Tamu murni placeholder, shell ini tidak butuh `useEffect` fetch sama sekali untuk sub-proyek ini (akan ditambahkan oleh sub-proyek #5/#6 ketika kontennya dibangun).

**`src/components/satpam-app/satpam-bottom-nav.tsx`** (BARU) — meniru persis `DriverBottomNav`: array `TABS` const (`{key, label, icon}` — ikon usulan: Inspeksi = `ClipboardCheck`, Patroli = `Footprints`, Tamu = `UserPlus`, dari `lucide-react`, boleh disesuaikan saat implementasi kalau ada ikon yang lebih pas tersedia), tombol biasa (bukan `<Link>`) yang memanggil `onChange(tab.key)`, `nav` sebagai flex sibling biasa (bukan `fixed`).

**`src/components/satpam-app/inspeksi-panel.tsx`** (BARU, hasil ekstraksi dari `beranda-client.tsx`) — persis konten `SatpamBerandaClient` saat ini MINUS `<header>`-nya (header sekarang milik shell). Termasuk: `InspectionCard`, `TimelineCard` (dua fungsi komponen internal, dipindah apa adanya), Tabs BERANGKAT/DATANG, daftar kartu, Riwayat Hari Ini, dan polling `setInterval(() => router.refresh(), 30000)` yang sudah ada — dipindah apa adanya, tidak diubah logikanya. Nama export baru: `InspeksiPanel`, props: `{ cards: SatpamInspectionCard[]; timeline: SatpamTimelineEntry[] }` (tidak lagi butuh `userName`/`profile` karena `UserMenu` sudah pindah ke shell).

**`src/components/satpam-app/coming-soon-panel.tsx`** (BARU) — komponen placeholder generik dipakai Patroli & Tamu: `{ title: string }` sebagai prop, tampilan sederhana (ikon + teks "Fitur {title} segera hadir.") di tengah layar.

**`src/components/satpam-app/beranda-client.tsx`** — **dihapus** (isinya sudah dipindah ke `inspeksi-panel.tsx`, tidak ada lagi pemanggil `SatpamBerandaClient`).

## Halaman

**`src/app/mkesindo/satpam-app/(tabs)/layout.tsx`** (BARU):
```tsx
import { requireSatpam } from "@/lib/require-access";

export default async function SatpamTabsLayout({ children }: { children: React.ReactNode }) {
  await requireSatpam();
  return children;
}
```

**`src/app/mkesindo/satpam-app/(tabs)/page.tsx`** (BARU) — isi persis sama seperti `page.tsx` lama (fetch `getSatpamInspectionList`, `getSatpamTimeline`, `getUserById`), tapi merender `SatpamTabShell` dengan `initialTab="inspeksi"` alih-alih `SatpamBerandaClient` langsung.

**`src/app/mkesindo/satpam-app/(tabs)/patroli/page.tsx`** dan **`.../tamu/page.tsx`** (BARU) — masing-masing memanggil `requireSatpam()` DAN `getUserById(Number(session.user.id))` (sama seperti `(tabs)/page.tsx`, karena `userName`/`profile` tetap wajib diisi — header shell dengan `UserMenu` tetap tampil di kedua tab ini juga), lalu render `SatpamTabShell` dengan `initialTab` yang sesuai, tanpa `initialCards`/`initialTimeline` (undefined, shell merender `ComingSoonPanel`).

## Error handling & edge case

- Karena Patroli/Tamu tidak melakukan fetch data apa pun di sub-proyek ini, tidak ada state error untuk ditangani di kedua tab tersebut.
- Layar Inspeksi kendaraan penuh-layar (`LiveInspeksiClient`) — navigasi masuk/keluar dari layar ini (`router.push`/`router.back()`) tidak berubah sama sekali; saat kembali dari layar itu, `(tabs)/page.tsx`'s Server Component akan fetch ulang (navigasi Next.js sungguhan, bukan tab-switch), sehingga daftar kartu Inspeksi otomatis ter-refresh — perilaku ini sudah ada sebelumnya (route Next.js biasa antara `/mkesindo/satpam-app` dan `/mkesindo/satpam-app/inspeksi/[jadwalId]`), tidak berubah oleh sub-proyek ini.

## Testing

Tidak ada test suite otomatis di repo ini. Verifikasi:
1. `npx tsc --noEmit` dan `npm run lint` bersih.
2. Klik-tayang manual: buka `/mkesindo/satpam-app`, konfirmasi header+nav 3-tab muncul, tab Inspeksi menampilkan konten Beranda seperti sebelumnya (termasuk sub-tab BERANGKAT/DATANG dan Riwayat Hari Ini berfungsi), berpindah ke Patroli/Tamu menampilkan placeholder "Segera Hadir", berpindah balik ke Inspeksi tidak kehilangan state sub-tab BERANGKAT/DATANG yang sedang aktif (bukti keep-alive bekerja), URL address bar berubah kosmetik sesuai tab aktif, dan menekan tombol "Inspeksi" pada sebuah kartu tetap membuka layar penuh-layar seperti sebelumnya. Kalau tidak ada kredensial akun `isSatpam` yang tersedia di lingkungan pengembangan (keterbatasan yang sudah berulang kali muncul sepanjang sesi ini), lakukan penelusuran kode teliti sebagai gantinya, terdokumentasi jelas.

## Struktur File (ringkasan)

- Buat: `src/app/mkesindo/satpam-app/(tabs)/layout.tsx`
- Buat: `src/app/mkesindo/satpam-app/(tabs)/page.tsx`
- Buat: `src/app/mkesindo/satpam-app/(tabs)/patroli/page.tsx`
- Buat: `src/app/mkesindo/satpam-app/(tabs)/tamu/page.tsx`
- Hapus: `src/app/mkesindo/satpam-app/page.tsx` (lama, di luar `(tabs)/`)
- Buat: `src/components/satpam-app/satpam-tab-shell.tsx`
- Buat: `src/components/satpam-app/satpam-bottom-nav.tsx`
- Buat: `src/components/satpam-app/inspeksi-panel.tsx`
- Buat: `src/components/satpam-app/coming-soon-panel.tsx`
- Hapus: `src/components/satpam-app/beranda-client.tsx` (lama)
- Tidak berubah: `src/app/mkesindo/satpam-app/inspeksi/[jadwalId]/page.tsx`, `src/components/satpam-app/live-inspeksi-client.tsx`, `src/lib/queries/satpam-inspection.ts`
