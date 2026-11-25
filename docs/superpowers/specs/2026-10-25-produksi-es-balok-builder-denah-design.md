# Produksi Es Balok — Builder Denah (tahap 1) — Desain

Tanggal: 2026-10-25 · Bisnis: Es Balok · Pabrik: PMPersada (Tuban) dan PMPakis (Pakis). PMPutra belum punya entri modul Produksi; bisa ditambahkan belakangan dengan mekanisme yang sama.

## Maksud
Setiap pabrik Es Balok punya denah produksi yang berbeda: jumlah brine tank (BAK), jumlah kolom per bak, jumlah dan ukuran ice can, varian (Balok Kecil/Besar), mesin yang melayani, jalur derek, dan pola panen. Tahap 1 ini menyediakan **tempat menyimpan denah itu sebagai data** lewat builder visual ala game. Layar operasional (status kolom, kematangan, Babonan, maintenance, panen) adalah tahap berikutnya dan akan membaca denah ini.

Sumber pengetahuan domain: memory `es-balok-produksi-knowledge` (penjelasan pengguna 2026-09-03 & 2026-09-16, file riset `riset-produksi-es-balok-brine-tank (1).md`).

## Keputusan pengguna
- Tiap modul Produksi pabrik Es Balok menampilkan denah yang **kosong secara default**.
- Ada tombol **"Edit Denah"** yang membuka builder.
- Perubahan denah pada **kolom yang masih berisi es ditolak**.
- Builder boleh **seperti game — semakin kompleks semakin baik**.

## Keputusan desain (Claude)
- **Penyimpanan:** Postgres pusat (`getPgPool()`), satu dokumen JSON per perusahaan. Denah adalah data milik dashboard, tidak berkaitan dengan ERP, dan tidak butuh JOIN SQL dengan tabel ERP.
- **Izin "Edit Denah":** Super Admin, Direktur (`accountScope === "direktur"`), atau peran dengan `permissions.produksi.canEdit`. Ditegakkan di server action, bukan hanya disembunyikan di UI. Melihat denah mengikuti gerbang halaman yang sudah ada (`requirePmpersada` / `requirePmpakis`).
- **ID stabil:** setiap elemen dan setiap kolom punya `id` (UUID) yang tidak berubah walau dipindah, diganti nama, atau dinomori ulang. Inilah kunci aturan "kolom berisi es".
- **Konkurensi:** penyimpanan memakai nomor versi (optimistic locking). Simpan ditolak bila denah sudah diubah orang lain sejak dibuka.

## Model data

### Postgres
```
produksi_denah (
  perusahaan_kode text PRIMARY KEY,      -- 'pmpersada' | 'pmpakis'
  versi integer NOT NULL,                -- naik 1 setiap simpan
  data jsonb NOT NULL,                   -- DenahDokumen
  updated_by text, updated_at timestamptz NOT NULL DEFAULT now()
)
produksi_kolom_isi (                     -- diisi tahap operasional; tahap 1 hanya membaca
  perusahaan_kode text NOT NULL,
  kolom_id text NOT NULL,                -- = DenahKolom.id
  mulai_at timestamptz NOT NULL,
  selesai_at timestamptz NULL,           -- NULL = kolom masih berisi es
  ...kolom lain menyusul di tahap operasional
)
INDEX ON produksi_kolom_isi (perusahaan_kode, kolom_id) WHERE selesai_at IS NULL
```

### Dokumen denah (TypeScript, `src/lib/produksi-denah.ts`, client-safe)
- `DenahDokumen { skemaVersi: 1; kanvas: { lebar; tinggi; ukuranGrid }; elemen: DenahElemen[] }`
- Elemen (semua punya `id`, `nama`, posisi/ukuran dalam unit grid, `rotasi` 0/90/180/270, `terkunci?` untuk mencegah tergeser):
  - `bak`: brine tank. Berisi `orientasiKolom` ('horizontal'|'vertikal'), `arahNomor` ('maju'|'mundur'), `kolom: DenahKolom[]`, `varianBawaan`, `iceCanPerKolomBawaan`, `durasiBekuJam: { kecil; besar }`, `kolomPerPanen`, `mesinIds: string[]`, `catatan`.
  - `DenahKolom { id; nomor; varian: 'kecil'|'besar'; jumlahIceCan; ukuranIceCan?: string; catatan?: string; nonaktif?: boolean }`
  - `mesin`: `jenis` (mis. "Kompresor Amonia"), `kapasitas?`, `catatan`.
  - `derek`: jalur rel, `titikAwal`/`titikAkhir`, `bakIds` yang dilayani.
  - Pelengkap tata letak: `dinding`, `pintu`, `area` (zona berlabel, mis. "Thawing Tank", "Area Sortir", "Filling Tank"), `label` (teks bebas).
- Fungsi murni (diuji `node:test`):
  - `denahKosong()`, `buatBak(posisi, opsi)`, `buatKolom(jumlah, bawaan)`, `ubahJumlahKolom(bak, n)` (pertahankan ID kolom yang ada, tambah/kurangi dari ujung), `nomoriUlangKolom(bak)`.
  - `validasiDenah(dok)` → daftar galat: nama kosong, nama bak ganda, elemen keluar kanvas, bak bertumpuk, jumlah kolom/ice can ≤ 0, `mesinIds`/`bakIds` menunjuk elemen yang tidak ada, durasi ≤ 0.
  - `kolomTerkunciBerubah(lama, baru, kolomIsiIds: Set<string>)` → daftar pelanggaran untuk setiap kolom berisi es yang **dihapus**, **bak induknya dihapus**, atau **varian / jumlahIceCan / ukuranIceCan / nonaktif-nya berubah**. Memindah atau mengganti nama bak dan menomori ulang kolom tidak dianggap pelanggaran.

## Halaman
- `/pmpersada/produksi` dan `/pmpakis/produksi` menggantikan placeholder `[modul]` untuk `produksi`.
  - Denah kosong → kartu kosong "Denah produksi belum diatur" + tombol "Edit Denah" (bila boleh).
  - Ada denah → penampil denah (read-only, bisa pan/zoom, klik bak untuk melihat detail kolom) + ringkasan (jumlah bak, kolom, ice can per varian, mesin) + tombol "Edit Denah".
- `/pmpersada/produksi/denah` dan `/pmpakis/produksi/denah` → builder layar penuh. Pengguna tanpa izin edit diarahkan kembali ke halaman Produksi.

## Builder ala game
Kanvas SVG dengan pointer events sendiri (tanpa dependensi baru).
- **Navigasi:** pan (drag ruang kosong / spasi+drag / tombol tengah), zoom (scroll, tombol +/−, "pas ke layar"), grid dengan snap, minimap di pojok.
- **Palet alat:** Bak, Mesin, Derek, Dinding, Pintu, Area, Label. Klik alat lalu klik/drag di kanvas untuk menaruh.
- **Manipulasi:** pilih (klik, shift-klik, kotak seleksi), drag untuk pindah, handle untuk ubah ukuran, putar 90°, duplikat (Ctrl+D), hapus (Delete), geser dengan panah (Shift = 5 grid), kunci elemen, urutan lapisan.
- **Undo/redo** (Ctrl+Z / Ctrl+Y) dengan riwayat minimal 100 langkah.
- **Bak tergambar hidup:** kolom digambar di dalam bak sesuai orientasi dan jumlahnya, warna per varian (Kecil/Besar), nomor kolom, ice can sebagai titik-titik kecil saat zoom cukup dekat, mesin terhubung ditandai garis putus-putus.
- **Panel properti** di samping untuk elemen terpilih. Untuk bak: nama, orientasi, arah penomoran, jumlah kolom, ice can per kolom, varian bawaan, durasi beku per varian, kolom per panen, mesin yang melayani, catatan. Klik satu kolom → atur varian, jumlah ice can, ukuran, catatan, nonaktif. Bisa pilih beberapa kolom sekaligus untuk diubah bersamaan.
- **Panel validasi** langsung menampilkan galat `validasiDenah` dan menyorot elemen bermasalah. Tombol Simpan nonaktif selama ada galat.
- **Simpan:** server menjalankan `validasiDenah` + `kolomTerkunciBerubah` lagi, lalu menulis dengan cek versi. Pelanggaran kolom berisi es ditampilkan per kolom dengan pesan jelas.
- **Peringatan keluar** bila ada perubahan belum disimpan.

## Bukan tujuan tahap 1
Pencatatan isi kolom, kematangan, Babonan, maintenance, jadwal panen, aplikasi operator, laporan produksi. Tabel `produksi_kolom_isi` dibuat sekarang hanya agar aturan penolakan sudah nyata.

## Anti-tujuan
- Denah tersimpan rusak/sebagian bila simpan gagal.
- Pengguna tanpa izin bisa menyimpan lewat memanggil action langsung.
- Pabrik satu bisa membaca/menulis denah pabrik lain.
