# Audit dashpmp — 22 November 2026

Audit menyeluruh dashboard PMP Group (MKEsindo/Es Kristal, PMPutra, PMPersada,
PMPakis/Es Balok, Grup, dan aplikasi HP produksi): apa yang kurang dari sisi
mekanisme, tampilan, animasi, dan hal di luar keduanya; riset praktik terbaik;
dan apa saja yang sudah diperbaiki pada putaran ini.

## 1. Metode & sumber

- Audit kode: 47 halaman dashboard, pola komponen, dependensi, konfigurasi Next.js 16.
- Audit langsung di peramban (desktop 1440×900 dan HP 375×812).
- Uji data baca-saja ke ERP Es Balok (`scripts/diag-pemesanan-es-balok-*.ts`).
- Rujukan yang dibaca langsung (pencarian web otomatis sedang galat di sisi alat):
  - NN/g — *Skeleton Screens 101*: skeleton untuk muat **halaman penuh** < 10 dtk;
    spinner untuk **satu modul**; < 1 dtk tidak perlu indikator; > 10 dtk progress bar.
  - NN/g — *Executing UX Animations: Duration and Motion Characteristics*: durasi
    umumnya **100–500 ms**; umpan balik kecil ±100 ms; perubahan layar besar
    **200–300 ms**; ≥ 500 ms terasa lamban; animasi masuk sedikit lebih lama dari
    keluar; hindari gerak linear (pakai easing); hormati *reduce motion*.
  - NN/g — *Confirmation Dialogs Can Prevent User Errors*: konfirmasi hanya untuk
    tindakan berisiko/tak bisa dibatalkan; **sebut tindakan & objeknya secara
    spesifik**; jangan pakai untuk tindakan rutin.
  - OWASP — *Authentication Cheat Sheet* (Account Lockout): penghitung gagal
    login per **akun** (bukan IP), ambang + jendela + durasi kunci; jangan
    membocorkan keberadaan akun lewat pesan galat.
  - web.dev — *prefers-reduced-motion*.
  - Dokumentasi Next.js 16 lokal (`node_modules/next/dist/docs`): `loading.tsx`,
    `error.tsx`, `template.tsx`, View Transitions (masih **eksperimental**).

## 2. Temuan mekanisme & tampilan

| # | Temuan | Dampak | Status |
|---|---|---|---|
| M1 | Dashboard PMPutra/PMPersada/PMPakis & Grup tidak punya `loading.tsx` → layar kosong saat pindah halaman yang lambat | Pengguna mengira aplikasi macet | **Diperbaiki** — `MemuatHalaman` (skeleton) di kelima dashboard |
| M2 | Tidak ada `error.tsx` di 4 dashboard; galat MKEsindo menampilkan pesan teknis mentah | Halaman galat bawaan Next / membingungkan | **Diperbaiki** — `GalatHalaman`: Coba lagi, Kembali ke Beranda, detail teknis dilipat |
| M3 | Tidak ada halaman 404 | Halaman bawaan Next berbahasa Inggris | **Diperbaiki** — `src/app/not-found.tsx` |
| M4 | 25 `confirm()` + 4 `alert()` bawaan peramban | Tidak konsisten, tidak bisa diberi gaya, kurang spesifik | **Diperbaiki** — `konfirmasi()` (dialog aplikasi, kata kerja jadi label tombol, tombol merah untuk tindakan merusak) + `toast.error` |
| M5 | Beranda Es Balok masih menampilkan "Integrasi database belum dihubungkan" padahal Penjualan/Piutang/Keuangan sudah memakai data nyata | Informasi salah di halaman pertama | **Diperbaiki** — `BerandaEsBalok`: KPI penjualan hari ini, balok terjual, pesanan, piutang + pintasan modul (angka dari query modul yang sama) |
| M6 | Modul Pemesanan Es Balok belum ada sama sekali (placeholder) | Operasional pesanan agen tak terlihat di dashboard | **Dibangun (baca-saja)** — lihat §5 |
| M7 | Halaman login: kartu polos, tanpa tampil/sembunyi password, tanpa peringatan Caps Lock, tombol aktif lagi saat berpindah halaman, pesan galat tak menyebut penguncian | Kesan kurang profesional; pengguna bingung saat akun terkunci | **Diperbaiki** — tata letak dua panel, kolom berikon, tampil/sembunyi, Caps Lock, galat beranimasi, spinner sampai halaman berganti |
| M8 | Penguncian login **sudah ada** (5× gagal → 15 menit, per akun) tetapi tidak dijelaskan ke pengguna | — | Pesan galat kini menyebut aturan ini **tanpa** membedakan "salah" vs "terkunci" (OWASP) |
| M9 | KPI tampil statis | Perubahan angka (AutoRefresh) tak terasa | **Diperbaiki** — `AngkaBerjalan` di `KpiCard` |
| M10 | Kartu pintasan Beranda tanpa umpan balik hover | Kurang terasa bisa diklik | **Diperbaiki** — angkat 2 px, bayangan, panah bergeser |

## 3. Animasi

Kondisi awal: hampir hanya `transition-colors` (79×), `animate-spin` (41×),
animasi bawaan dialog/popover (`tw-animate-css`), **satu** pemakaian
`prefers-reduced-motion`, tanpa transisi halaman, tanpa animasi angka.

Ditambahkan (semua memakai varian `motion-safe:` → otomatis mati bila pengguna
memilih *reduce motion*):

| Animasi | Durasi / easing | Alasan |
|---|---|---|
| Masuk halaman (`template.tsx` di 5 dashboard): fade + naik 4 px | 300 ms ease-out | Perubahan layar besar → 200–300 ms (NN/g) |
| Skeleton halaman muncul setelah jeda 150 ms | 300 ms | Muatan < 1 dtk tidak "berkedip" (NN/g) |
| Angka KPI berjalan ke nilainya | 600 ms ease-out cubic | Menonjolkan perubahan nilai; teks akhir identik dengan server (tanpa hydration mismatch) |
| Dialog konfirmasi, galat, 404: fade + zoom-in 95% | 100–300 ms | Bawaan dialog + konsisten |
| Kartu pintasan: angkat + panah bergeser | 200 ms ease-out | Umpan balik hover ±100–200 ms |
| Kartu Papan Pemesanan Es Balok: muncul bertahap (stagger 25 ms, maks 12) | 300 ms | Membantu mata mengikuti susunan kolom; dibatasi agar total < 600 ms |
| Login: form naik-fade, sorotan panel merek bertahap, pola kristal berputar sangat pelan | 500 ms; 90–240 dtk | Kesan pertama; gerak latar sangat lambat agar tidak mengganggu |
| Bilah kapasitas kendaraan | 500 ms ease-out | Menunjukkan pengisian muatan |

Tidak dipakai dengan sengaja: View Transitions Next.js (masih eksperimental),
paralaks/scroll-jacking (NN/g: memicu pusing), animasi berulang tanpa makna.

## 4. Kekurangan di luar mekanisme & tampilan (dicatat, belum dikerjakan)

1. **Pengujian otomatis minim** — hanya `src/lib/bychat/__tests__` dan
   `src/lib/penagihan/__tests__`; `package.json` tidak punya skrip `test`; tidak
   ada CI yang menjalankan lint/typecheck/test sebelum deploy.
2. **Lint belum bersih** — sejumlah galat `react-hooks/*` lama (mis.
   `route-validation-dialog.tsx`, `driver-manager.tsx`, `mitra-list.tsx`,
   `ubah-pemesanan-dialog.tsx`).
3. **Tidak ada pemantauan galat produksi** (mis. Sentry/log terpusat) — galat
   hanya `console.error`; `error.digest` kini tampil di layar galat untuk
   memudahkan pelacakan di log server.
4. **Tidak ada header keamanan HTTP** di `next.config.ts` (mis.
   `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`). Catatan:
   `X-Frame-Options`/CSP `frame-ancestors` harus hati-hati — dashpmp di-embed
   ByChat lewat iframe (`/embed`).
5. **Skrip diagnostik menumpuk di `scripts/`** (diag/fix sekali pakai) dan
   beberapa berkas tak terlacak di `docs/` — perlu kebijakan arsip.
6. **Repositori di OneDrive** + mesin dev sering nyaris kehabisan memori →
   HMR sering memakai modul basi ("module factory is not available"),
   `.next/dev` pernah korup. Disarankan memindahkan repo keluar dari folder
   yang disinkronkan.
7. **Ketergantungan latensi DB** (ERP MSSQL jarak jauh) — beberapa halaman
   2–6 dtk; belum ada cache data lintas permintaan untuk agregat berat.
8. **Dokumentasi operasional** (cara deploy, variabel lingkungan Coolify,
   rotasi kredensial, pemulihan) tersebar di memori/percakapan, belum satu
   dokumen.
9. **Aksesibilitas** — ±99 `aria-label`, masih ada tombol ikon tanpa label dan
   kontras teks redup di beberapa chip; belum diaudit dengan pembaca layar.
10. **Alat riset** — pencarian web otomatis sesi ini galat (konfigurasi model
    alat), riset dilakukan dengan membaca sumber langsung.

## 5. Pemesanan Es Balok

### Temuan skema (baca-saja, dicek di ketiga PT)

- `PMP_Pemesanan`: satu baris per pesanan agen; `Tanggal` = tanggal kirim
  (tanpa jam); qty **pesanan / realisasi / retur** per jenis (kecil/besar),
  harga per jenis, `AlasanBedaRealisasi`, `AlasanRetur` (`'0'` = tidak ada),
  `Status` (`'2'` aktif, `'3'` selesai), `IsVoid`, `IsDeleted`.
- `PMP_PenjadwalanDetail` → `PMP_Penjadwalan` (kendaraan per hari) →
  `PMP_DaftarKendaraan` (`MaxQty`, sering 0 = tidak diisi).
- Wilayah: `AlamatID` (= `PMP_AgenDetail.AgenDetailID`) → `PMP_Wilayah`.
- Database `utama` saja (sama dengan `SUMBER_DO` modul produksi; `logistik`
  adalah cermin).
- Pola harian PMPutra: ±47–60 pesanan, ±1.300–2.300 balok; pesanan untuk besok
  dimasukkan malam sebelumnya (contoh: `ModifiedDate` 21 Nov 21.50 untuk
  tanggal kirim 22 Nov).

### Yang dibangun

`/pmputra/pemesanan`, `/pmpersada/pemesanan`, `/pmpakis/pemesanan`:
- Navigasi tanggal kirim (← / Hari ini / Besok / → / pilih tanggal).
- **Papan** empat tahap: Belum Dijadwalkan → Dijadwalkan → Selesai, + Retur;
  total balok kecil/besar per kolom; chip realisasi berbeda dari pesanan
  (dicoret) dan retur.
- **Per Kendaraan**: muatan tiap kendaraan + bilah kapasitas (bila `MaxQty` ada,
  merah bila melebihi), daftar agen tujuan.
- Pencarian agen / wilayah / no. SO; ringkasan pesanan, agen, balok, kendaraan.
- Dicek cocok dengan Beranda & Penjualan (22 Nov PMPutra: 47 pesanan, 44 agen,
  Kecil 805 + Besar 467 = 1.272 balok).

### Belum dibangun — perlu keputusan

**Membuat/mengubah pesanan dari dashboard** sengaja belum dibuat karena
menulis ke ERP Es Balok:
- `PemesananID` (`'01207844'`) dan `NoDokumen` (`PMP/SO/001207/2026-11/GE/HO`)
  dibuat ERP desktop — mekanisme penomorannya (tabel urutan? per cabang/bulan?)
  belum dipetakan; menebaknya berisiko bentrok nomor.
- Harga per agen (`BalokKecilHarga`/`BalokBesarHarga` berbeda per agen),
  pengaruh ke `PiutangSaatIni`/`TabunganSaatIni` di `PMP_Agen`, dan pasangan
  baris di database `logistik` belum diketahui.
Langkah yang disarankan: petakan penomoran & efek samping ERP dari satu pesanan
contoh (dibuat di ERP lalu dibandingkan sebelum/sesudah), baru bangun formulir
"Buat Pemesanan" yang meniru persis perilaku ERP.

## 6. Rekomendasi berikutnya (prioritas)

1. Keputusan & pemetaan penulisan pesanan Es Balok (§5).
2. Skrip `test` + CI sederhana (lint, `tsc`, tes unit) sebelum deploy.
3. Header keamanan HTTP yang aman untuk iframe ByChat.
4. Pemantauan galat produksi.
5. Bersihkan galat lint `react-hooks` lama.
6. Modul Pengiriman Es Balok (masih placeholder) — bisa memakai data jadwal
   kendaraan yang sama dengan Pemesanan.
