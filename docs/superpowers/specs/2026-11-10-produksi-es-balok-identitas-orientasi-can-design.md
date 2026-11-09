# Produksi Es Balok — Kode Posisi, Orientasi Can, dan Can Fisik — Desain

Tanggal: 2026-11-10

Melanjutkan:
- `2026-11-09-produksi-es-balok-slot-can-design.md` (slot can, sudah di main 9ccf2bd)
- `2026-11-01-produksi-es-balok-denah-v2-3d-design.md` (denah v2 / 3D)

## Maksud

Pengguna ingin setiap ice can punya nama singkat. Tujuannya:
- **melacak asal es**, yaitu balok ini dari posisi mana;
- **menyimpan riwayat perawatan per can**;
- **mencatat penggantian**, yaitu posisi X sekarang ditempati can cadangan yang mana.

Pengguna juga ingin **orientasi can per rek** bisa diatur. Penampang can tidak persegi, sehingga rek dengan can mendatar memuat lebih banyak can dibanding rek dengan can tegak.

Dari diskusi ini juga terungkap bahwa layar HP yang sudah jalan **salah menggambar rek**:
- **Satu rek hanya berisi satu baris ice can** (koreksi pengguna).
- Grid 12 × 3 (BK) dan 9 × 2 (BB) — konstanta `SUSUNAN_CAN` di `src/lib/produksi-operasional.ts` (diuji di `src/lib/__tests__/produksi-operasional.test.ts`), dipakai `grid-can.tsx` — berasal dari pola IceControl dan tidak sesuai kenyataan.
- Gambar denah 2D/3D sudah benar, karena menggambar satu baris per rek.
- **Satu bak bisa berisi rek BK dan rek BB sekaligus.** Layar HP perlu menampilkannya dengan jelas.

Pengguna menyetujui pemahaman ini lewat dua visualisasi: tampak atas Bak 3 dan mockup layar HP ("oke mantap sudah sangat bagus").

## Keputusan pengguna

1. **Dua nama yang terpisah:**
   - **Kode posisi** `3-52-14` (bak–rek–posisi, angka saja, dipisah tanda hubung). Kode ini tetap dan diturunkan dari denah. Varian ditampilkan sebagai label tambahan: `3-52-14 · BB`.
   - **Nomor can fisik** `BB-0087` / `BK-0412`. Nomor ini melekat pada can dan ikut ke mana pun can dipindah.
   - Format huruf seperti `3AZ14` dan `B3-R52-14` ditolak: terlalu panjang, bentrok dengan BB/BK, dan rek di lapangan bernomor.
2. **Orientasi diatur per rek.** Satu rek selalu searah semua: tegak semua atau mendatar semua. Tidak ada campuran di dalam satu rek.
3. **Jumlah can per rek tetap diisi manual di denah.** Tidak dihitung dari ukuran.
4. **Satu rek = satu baris can.**
5. **Can fisik saat ini tidak bertanda dan belum ada standarnya.** Sistem yang menerbitkan nomor; penandaan fisik dilakukan bertahap.
6. **Dikerjakan dua tahap.** Tahap 1 memperbaiki tampilan, tahap 2 menambahkan can fisik. Kedua tahap dirancang di dokumen ini.

## Pendekatan yang ditimbang

| | Isi | Plus / minus |
|---|---|---|
| **Dua tahap (dipilih)** | Tahap 1: orientasi + layar HP satu baris + bak campuran + kode posisi. Tahap 2: can fisik, ganti can, riwayat, label. | Tampilan yang salah cepat diperbaiki. Tahap 2 tidak menahan tahap 1. |
| Sekaligus | Semua dalam satu rilis. | Satu deploy, tapi perbaikan tampilan ikut menunggu. |
| Kode posisi saja | Tanpa can fisik. | Paling sederhana, tapi tujuan penggantian dan riwayat per can tidak tercapai. Ditolak. |

---

## TAHAP 1 — Orientasi, layar satu baris, kode posisi

### 1.1 Data denah
- **`DenahKolom.orientasiCan?: "mendatar" | "tegak"`**
  - Bila tidak ada → `"mendatar"`. Claude memilih ini karena geometri sekarang memang meletakkan sisi panjang can (`lebarMm`, 360) melintang rek, sehingga semua denah lama tetap tergambar sama persis.
  - **Mendatar:** lebar lajur rek = `lebarMm`, langkah sepanjang rek = `panjangMm`.
  - **Tegak:** keduanya ditukar. Lebar lajur = `panjangMm`, langkah sepanjang rek = `lebarMm`.
- **`BakElemen.orientasiCanBawaan?`** → orientasi untuk rek baru di bak itu. Bawaan `"mendatar"`.
- **`BakElemen.kodeBak?: string`** → bagian "bak" dari kode posisi (Claude).
  - Bila kosong, diambil dari angka pertama di `nama` ("Bak 3" → "3"). Bila nama tidak mengandung angka, dipakai urutan bak di dokumen (1-based).
  - Validasi: 1–3 karakter alfanumerik tanpa "-", unik per denah.
  - Builder menampilkan pratinjau kode.
- **Migrasi baca:** `lengkapiElemen` diperluas untuk mengisi bawaan `orientasiCan` per kolom. Ini kode baru, karena saat ini fungsi itu belum mengisi bidang tingkat kolom. Versi skema **tidak** dinaikkan, karena hanya bidang opsional.
- **Validasi baru yang memblokir simpan denah** (Claude):
  - `kodeBak` efektif (diisi atau diturunkan) harus unik per denah;
  - `nomor` kolom harus unik per bak.

  Keduanya mencegah kode posisi ganda. Dicek 2026-11-10: denah PMPersada (5 bak, 250 rek) lolos keduanya ("Bak 1"–"Bak 5", tidak ada nomor rek ganda). PMPakis belum punya denah.
- **Kunci denah:** orientasi **boleh** diubah walau rek berisi es (Claude). Perubahan ini hanya mengubah geometri, jumlah slot tetap. `kolomTerkunciBerubah` tidak perlu memeriksanya. `kodeBak` juga boleh diubah, karena riwayat disimpan per `kolom_id` + slot, bukan per kode.

### 1.2 Geometri, 2D, dan 3D
- `tataBakMeter` memakai orientasi **per kolom**:
  - `lebar` = lebar lajur sesuai orientasi;
  - `panjangCan` = langkah sesuai orientasi;
  - `butuhB` dihitung dari langkah per kolom.
- Pemeriksaan teknik "muat/tidak muat" (`produksi-denah-teknik.ts`), kanvas 2D (`denah-kanvas.tsx`, gambar can per kolom), dan 3D (`elemen-3d.tsx`, `koordinat.ts`) otomatis mengikuti, karena semuanya membaca `TataKolom`.
  - Builder harus memastikan ketiganya tidak membaca `iceCan[varian]` langsung tanpa melewati orientasi.
- **Arah posisi:** posisi 1 = can pertama dari awal sumbu b (`b0`), sama dengan urutan gambar sekarang.
  - Kanvas menampilkan nomor posisi 1 di ujung rek saat diperbesar (Claude). Tujuannya agar "dari ujung mana" bisa dicocokkan dengan lapangan.
- **Panel properti:**
  - Kontrol "Orientasi can" (Mendatar ▭ / Tegak ▯) untuk kolom terpilih. Bisa banyak kolom sekaligus, mengikuti pola edit kolom yang ada.
  - Kontrol orientasi bawaan di tingkat bak.
  - Ringkasan bak menampilkan jumlah rek per orientasi.

### 1.3 Kode posisi (logika murni)
- `kodePosisi(kodeBak, nomorRek, slot)` → `"3-52-14"`
- `kodePosisiPendek(nomorRek, slot)` → `"52-14"`, dipakai saat bak sudah jelas dari konteks.
- `kodeBak` dihitung sekali per bak di `keadaanPabrik` dan dibawa di `KeadaanRek` (`kodeBak`, `orientasiCan`).

### 1.4 Data slot yang sudah ada
Nomor slot sejak awal hanyalah urutan 1..kapasitas. Grid 12 × 3 hanya cara menampilkannya, jadi slot 14 tetap berarti can ke-14 dari ujung rek, dan **tidak perlu remap**. Dicek 2026-11-10 di produksi: hanya ada data uji (3 isian + 1 panen di PMPersada Bak 1 Rek 1, 0 slot rusak), yang memang dijadwalkan untuk dihapus.

### 1.5 Layar HP
- **Hapus `SUSUNAN_CAN`** beserta ujinya. `GridCan` menjadi **baris can**:
  - Satu baris berurutan 1..kapasitas, dari kiri ke kanan.
  - **Dipatah tiap 18 posisi** agar target ketuk tetap layak di layar ±330 px (≈ 16–18 px per can). BB 18 = 1 baris; BK 36 = 2 baris.
  - Setiap baris diberi label rentang "1–18", "19–36" dan tanda "lanjut", supaya tidak terbaca sebagai susunan 2 baris fisik.
  - Semua mode tetap sama: lihat, pilih, panen.
- **Header lembar rek:** `Rek 52 · BB · mendatar ▭ · 18 can`.
- **Mode lihat:** ketuk can → panel keterangan berisi kode posisi `3-52-14`, status, persen, dan usia. Di tahap 2 ditambah nomor can fisik dan riwayat singkat.
- **Daftar rek ("Semua rek"):**
  - Setiap baris memuat nomor, varian + ikon orientasi, strip can, persen, dan usia.
  - **Panjang strip sebanding dengan kapasitas** terhadap kapasitas terbesar di bak, jadi rek BB tampak lebih pendek.
- **Bak campuran:**
  - Ringkasan bak dipisah per varian, mis. `BK 30 rek · BB 7 rek`, masing-masing dengan chip siap/kosong/Babonan/rusak.
  - Filter cepat `Semua | BK | BB` berlaku untuk "Tugas sekarang" dan "Semua rek".
  - Filter disimpan per perangkat (localStorage dengan try/catch). Bila bak hanya punya satu varian, filter disembunyikan.
- **Kode posisi juga tampil di:**
  - keterangan can pada formulir panen, Tandai/Buang Babonan, dan Tandai rusak;
  - riwayat operator;
  - log audit admin, yang menerjemahkan array slot menjadi kode. Mis. `slot_babonan [14,18]` ditampilkan `52-14, 52-18`.

### 1.6 Layar admin
- `DetailRek` dan `DialogKoreksi` memakai komponen baris can yang sama.
- Tabel FIFO dan peringatan menampilkan `kodeBak-nomorRek` pada label rek.

---

## TAHAP 2 — Can fisik

### 2.1 Data (Postgres pusat, per `perusahaan_kode`)
- **`produksi_can`**
  - Kolom: `id uuid`, `perusahaan_kode`, `nomor text` (`BK-0001`), `varian`, `status`, `catatan`, `dibuat_at`, `dibuat_oleh_akun_id`.
  - `status` ∈ `terpasang | cadangan | perbaikan | afkir`.
  - Unik `(perusahaan_kode, nomor)`.
  - Nomor diterbitkan berurutan per varian per perusahaan, empat digit dengan nol di depan. Bila lewat 9999, digit bertambah.
- **`produksi_can_pasang`**: riwayat pemasangan.
  - Kolom: `id`, `perusahaan_kode`, `can_id`, `kolom_id`, `slot`, `dipasang_at`, `dilepas_at NULL`, `alasan_lepas`, `dipasang_oleh`, `dilepas_oleh`.
  - Unik aktif per `can_id`, dan unik aktif per `(perusahaan_kode, kolom_id, slot)`.
- **`produksi_can_peristiwa`**: riwayat perawatan.
  - Kolom: `id`, `perusahaan_kode`, `can_id`, `jenis`, `catatan`, `at`, `oleh`.
  - `jenis` ∈ `didaftarkan | dipasang | dilepas | rusak | diperbaiki | afkir`.
  - INSERT-only, seperti log operasional.
- **Invarian:**
  - `status = terpasang` ⇔ ada pemasangan aktif.
  - Varian can = varian rek tempat ia dipasang.
  - Slot ≤ `jumlahIceCan` rek.

### 2.2 Pendaftaran awal
- Aksi admin **"Daftarkan can"** per bak atau seluruh pabrik membuat satu can untuk setiap slot rek aktif yang belum punya can terpasang.
- Penomoran berurutan menurut bak → nomor rek → slot. Contoh: Bak 1 Rek 1 posisi 1 = `BK-0001`.
- Idempoten: slot yang sudah punya can dilewati.
- Can cadangan didaftarkan terpisah lewat form admin: varian + jumlah. Statusnya `cadangan`.

### 2.3 Aksi
| Aksi | Siapa | Efek |
|---|---|---|
| **Ganti can** | operator + admin | Hanya untuk slot yang **tidak ditempati isian aktif** (kosong atau rusak). Pemasangan can lama ditutup, can lama berstatus `perbaikan` atau `afkir` (pilihan), lalu can cadangan berstatus `cadangan` dengan varian sama dipasang. Bila slot itu sedang rusak, `produksi_slot_rusak` aktifnya ikut ditutup ("diganti"). |
| **Tandai rusak** (sudah ada) | — | Juga mencatat peristiwa `rusak` pada can yang terpasang. |
| **Sudah diperbaiki** (sudah ada) | — | Mencatat `diperbaiki` pada can terpasang (diperbaiki di tempat). |
| **Selesai perbaikan** | admin | Can berstatus `perbaikan` → `cadangan`. |
| **Lepas can** | admin | Can dilepas tanpa pengganti. Hanya untuk slot tanpa isian aktif. Can lama menjadi `cadangan`, `perbaikan` atau `afkir` (dipilih). Tersedia juga **"Lepas semua can di rek ini"** (satu transaksi), dipakai saat rek dikecilkan, dihapus, atau diganti varian. |
| **Afkir** | admin | Can → `afkir`. Bila sedang terpasang, harus dilepas dulu (bisa digabung dalam satu aksi "Lepas → afkir"). |

- Pemilihan can cadangan di HP: daftar can `cadangan` dengan varian yang cocok, bisa dicari dengan mengetik nomor.
- **Urutan kunci** mengikuti aturan yang ada: denah FOR SHARE → advisory kolom → isian → rusak → baris can/pasang FOR UPDATE.
- **Perubahan denah yang menyentuh can terpasang:** builder menolak simpan bila
  - `jumlahIceCan` dikecilkan dan slot yang hilang masih punya can terpasang;
  - rek dihapus atau dipindah ke bak lain sementara masih punya can terpasang;
  - **varian rek diubah** sementara masih punya can terpasang.

  Pesannya meminta "Lepas semua can di rek ini" dulu. Ini aturan baru di jalur simpan denah, sejajar dengan kunci kolom berisi es.
- **Rek dinonaktifkan:** boleh, dan can **tetap terpasang** (Claude). Rek nonaktif di lapangan biasanya hanya tidak dipakai sementara, sedangkan can-nya masih di tempat. Pendaftaran awal melewati rek nonaktif.
- **Penutupan `produksi_slot_rusak`:** tambah kolom `ditutup_karena text NULL` ∈ `diperbaiki | diganti`, diisi oleh aksi Sudah diperbaiki / Ganti can. Baris lama tetap NULL. Kolom ini dibaca layar "Riwayat posisi".

### 2.4 Pelacakan asal es
- Panen sudah menyimpan `slot_dimuat` dan waktunya. Can fisik untuk sebuah panen **diturunkan lewat join** dengan `produksi_can_pasang` pada waktu panen. Tidak ada kolom baru di `produksi_panen` (Claude).
- Layar admin **"Riwayat posisi"** (`3-52-14`): daftar pemasangan dan peristiwa.
- Layar admin **"Riwayat can"** (`BB-0087`): posisi yang pernah ditempati, peristiwa perawatan, jumlah rusak, dan umur pakai.

### 2.5 Label fisik
- Halaman cetak admin: lembar label per bak atau per daftar can. Setiap label berisi nomor besar `BB-0087` dan QR berisi nomor itu.
- Rekomendasi media (bukan bagian kode): plat kecil yang dikeling atau angka yang diketok pada bibir can, karena stiker tidak tahan air garam.
- **Pemindaian QR dari HP bukan bagian tahap ini.** Operator memilih can dari daftar.

---

## Bukan tujuan
- Mode offline.
- Pemindaian QR / kamera.
- Jadwal perawatan preventif terjadwal (mis. "periksa tiap 6 bulan"). Tahap 2 hanya menyimpan riwayat; jadwal bisa dibangun di atasnya nanti.
- Menghitung jumlah can otomatis dari ukuran rek.
- Campuran orientasi di dalam satu rek.
- Mengubah pencocokan DO.

## Anti-tujuan
- Satu can terpasang di dua posisi, atau satu posisi berisi dua can.
- Can BK terpasang di rek BB, atau sebaliknya.
- Denah lama berubah gambar setelah rilis tahap 1 (bawaan harus `mendatar`).
- Kode posisi yang ambigu atau bentrok dengan nomor can.
- Riwayat hilang karena rek dinomori ulang. Riwayat diikat ke `kolom_id`, kode hanya untuk tampilan.

## Diserahkan ke pembuat
- Bentuk visual ikon ▭/▯ dan bentuk sel can mendatar/tegak di HP.
- Lebar sel dan titik patah baris (18 sebagai acuan).
- Tata letak halaman riwayat dan halaman cetak label (format kertas A4).
- Nama berkas dan komponen.
