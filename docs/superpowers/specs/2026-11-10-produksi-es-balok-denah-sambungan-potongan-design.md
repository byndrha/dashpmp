# Denah Produksi Es Balok — Sambungan Pipa/Kabel (Port + Simpul) dan Tampak Potong Bak — Desain

Tanggal: 2026-11-10 · Melanjutkan: `2026-11-01-produksi-es-balok-denah-v2-3d-design.md` (denah v2 + 3D, sudah live — pengguna melihat isian Elevasi di produksi)

## Maksud

Pengguna menemukan, saat memakai builder denah, bahwa pemasangan utilitas belum realistis:
- Tandon Air dan Bak tidak benar-benar terhubung. Pipa bisa digeser sendiri dan tidak ikut bergerak bersama benda yang disambungnya.
- Tidak ada tombol Selesai/Batal saat menggambar pipa (yang ada hanya dobel klik, Enter, dan Esc).
- Diameter pipa tidak tampak.
- Tidak bisa membuat **cabang pipa**.
- **Urgensi utama: posisi Z.** Pipa atau kabel sering naik atau turun tegak dulu sebelum berbelok, dan ada **tandon bawah tanah**. Saat ini z setiap titik pipa hanya bisa diubah lewat tabel setelah pipa selesai digambar, dan gambar 2D tidak menunjukkan z.

Tentang bak, pengguna ingin bisa melihat:
- **tinggi gedung/atap di atas bak**;
- **tinggi dinding bak dari lantai**;
- **can di dalam bak** dan **level air (brine)**.

Fakta dari pengguna:
- **Bibir can harus sejajar dengan permukaan brine**, tidak lebih tinggi dan tidak tenggelam.
- Selang pendingin yang masuk ke dalam can **tidak perlu digambar**.

## Keadaan sekarang (diperiksa di kode)

**Sudah ada:**
- Setiap elemen punya `elevasiM` (posisi Z dasar, boleh negatif) dan `tinggiM`, dan keduanya bisa diedit.
- Pipa (`JalurElemen`) punya:
  - `titik: Titik3D[]` (urutan titik = arah aliran);
  - `diameterMm` di bilah opsi dan panel properti;
  - `dariId/keId`, berupa dropdown elemen tanpa ikatan geometris.
- Ujung pipa bisa menempel ke ujung pipa lain atau ke tepi elemen di bawah kursor (`tempelUjungJalur`). Saat menggambar, semua titik baru mengambil z = `elevasiKerja`, yang hanya bisa diubah di panel kanvas.
- Bak punya `levelBrineM` dan dimensi can.
- Tampilan 3D menggambar brine dan can, tapi **bibir can diletakkan sejajar bibir bak** (`iceCanBak`), bukan sejajar brine.
- Pemeriksaan teknik:
  - aturan 2b `RENDAM_MIN = 0.85`;
  - aturan 3 ruang bebas derek;
  - aturan 7 ujung jalur bertemu.

**Belum ada:**
- ikatan ujung pipa ke benda;
- cabang;
- ruas tegak saat menggambar;
- tombol layar untuk Selesai/Batal;
- penanda z di 2D;
- atap/gedung;
- tampak potong bak.

## Keputusan pengguna
1. **Pendekatan A — Port + simpul** untuk sambungan pipa dan kabel. Ditolak:
   - B "ringan" (ikatan kira-kira, ujung bisa meleset saat benda diputar atau diubah ukurannya);
   - C "jaringan penuh" (graf simpul–ruas, berlebihan untuk sekarang).
2. Gedung/atap dan tinggi dinding bak dari lantai **keduanya** dibutuhkan.
3. Bibir can = permukaan brine. Selang pendingin tidak digambar.
4. Usulan tampak potong bak (gambar) diterima sebagai arah. Angka contoh "20 cm di atas brine" **dicabut**, karena berasal dari asumsi bawaan, bukan data lapangan.

---

## Bagian 1 — Sambungan: port + simpul

### 1.1 Port (titik sambung) pada elemen
- Bidang opsional baru `port?: Port[]` pada **bak, mesin, tangki, dan beton**.
  - `Port = { id, nama, u, v, w }`
  - `u, v` ∈ [0, 1]: posisi pada kotak lokal elemen **sebelum rotasi** (0,0 = pojok kiri-atas). Karena relatif, port tetap di tempat saat elemen digeser, diputar, atau diubah ukurannya.
  - `w` ∈ [0, 1]: tinggi port **sebagai pecahan dari `tinggiM`** di atas `elevasiM` (Claude). Dengan begitu port "masuk atas" tetap di atas saat tinggi tangki diubah. Panel menampilkan dan menerima nilainya dalam meter, lalu mengonversinya.
  - Posisi dunia dihitung dengan helper murni `posisiPort(elemen, port) → Titik3D`.
- **Port bawaan** diisi saat baca **hanya bila bidang `port` tidak ada** (Claude). `port: []` berarti pengguna sengaja menghapus semuanya, dan tidak diisi ulang.
  - ID port bawaan deterministik: `<elemenId>:masuk-atas`, dst. Ini supaya pembacaan berulang (termasuk dari jalur operasional) menghasilkan ID yang sama.
  - Tangki: "Masuk atas" (tengah, `w = 1`) dan "Keluar bawah" (tepi sisi depan, `w = 0`).
  - Mesin: "Masuk" (tepi kiri) dan "Keluar" (tepi kanan), keduanya `w = 0.5`.
  - Bak dan beton: tanpa port bawaan. Port dibuat saat pipa pertama kali ditempelkan ke tepinya (lihat 1.4).
- **Edit port** di panel properti:
  - daftar port dengan nama, u, v, z;
  - tambah dan hapus port;
  - port bisa ditarik di kanvas saat elemen terpilih.
- **Menghapus port** yang masih dipakai pipa: ujung pipa dilepas (menjadi bebas), lalu muncul peringatan. Port tidak diblokir.

### 1.2 Simpul (cabang)
- Tipe elemen baru **`simpul`**: titik 3D (x, y, `elevasiM` = z) dengan `w = h` = diameter terbesar pipa yang tersambung, untuk keperluan seleksi.
  - Ditampilkan sebagai bulatan kecil di 2D dan bola/sambungan T di 3D.
  - Masuk lapisan yang sama dengan pipa-pipanya.
- **Membuat cabang:** saat menggambar, klik **di tengah pipa lain** akan:
  - memecah pipa itu menjadi dua pipa di titik tersebut (fluida, diameter, dan arah sama; nama "… (1)" dan "… (2)");
  - membuat satu simpul di titik itu;
  - mengikat kedua potongan dan ujung pipa baru ke simpul.
- **Menghapus simpul:**
  - Bila tinggal 2 pipa tersambung dengan jenis/fluida/diameter sama → keduanya digabung kembali menjadi satu pipa.
  - Selain itu → ujung-ujungnya dilepas.
- **Menggeser simpul** memindahkan semua ujung yang terikat padanya.

### 1.3 Ujung pipa terikat
- Model ujung baru: `dari?` / `ke?` bertipe `UjungJalur = { elemenId: string; portId?: string }`.
  - Dengan `portId` → ujung terikat ke port elemen itu.
  - Tanpa `portId` → `elemenId` harus sebuah simpul.
  - `dariId` / `keId` lama dihapus (lihat migrasi 1.6).
- **Invarian:** titik pertama/terakhir pipa **selalu sama** dengan posisi dunia port atau simpul yang mengikatnya.
  - Reducer builder menyinkronkan ujung setelah aksi apa pun yang mengubah geometri elemen: geser, putar, ubah ukuran, ubah elevasi atau tinggi, ubah port, geser simpul, termasuk undo/redo.
  - Sinkronisasi hanya memindahkan titik ujung. Titik tengah pipa tidak diubah.
- **Pipa tidak bisa digeser utuh** bila salah satu ujungnya terikat. Titik tengahnya tetap bisa diedit.
  - Untuk memindahkan pipa terikat: lepas ikatannya (tombol "Lepas" per ujung di panel), atau geser benda/simpulnya.
- Pipa kabel memakai mekanisme yang sama. Kabel tidak bisa tersambung ke simpul pipa, dan sebaliknya.

### 1.4 Menggambar pipa (alat Jalur)
- **Bilah gambar di layar**, terlihat selama alat Jalur aktif, dan bisa diketuk di layar sentuh:
  - **Selesai**, **Batal**, **Hapus titik terakhir**;
  - opsi jenis, fluida/sistem, dan **Ø diameter** yang sudah ada;
  - **isian z** untuk titik berikutnya.
- **Ruas tegak (naik/turun):**
  - Tombol "**Naik/Turun ke z = …**": isi angka lalu Enter → titik baru ditambahkan di x,y yang sama dengan z baru.
  - Klik berikutnya memakai z itu.
  - Pintasan keyboard PageUp/PageDown menaikkan/menurunkan sebesar langkah 0,1 m (Claude).
- **Prioritas tempel** saat klik dan saat mengarahkan kursor:
  1. port (semua port elemen ditampilkan sebagai lingkaran kecil selama alat Jalur aktif);
  2. simpul;
  3. ujung pipa lain → membuat simpul di sana;
  4. tengah pipa lain → cabang (1.2);
  5. tepi elemen ber-port (bak, mesin, tangki, beton) → **membuat port baru** di titik itu dengan z = z kerja saat ini.

  Mengklik port atau simpul sebagai titik awal membuat pipa **mulai di z port itu**. Contoh: pipa dari dasar tandon −3 m dimulai di −3 m.
- **Alt** = tanpa tempel, seperti sekarang.

### 1.5 Tampilan 2D
- **Ruas tegak** digambar dengan simbol: ⊙ untuk naik (aliran keluar ke arah penonton) dan ⊗ untuk turun, di titik x,y-nya. Disertai label "+4,00 → −3,00 m" saat pipa terpilih atau saat zoom cukup besar.
- **Label z** di setiap belokan saat pipa terpilih.
- **Label Ø** di tengah ruas terpanjang saat zoom cukup besar.
- Pipa di bawah lantai (z < 0) tetap memakai penanda tertanam yang ada (`maskTertanam`).
- Port dan simpul digambar sesuai 1.1 dan 1.2.

### 1.6 Migrasi dokumen
- Saat baca, untuk setiap pipa dengan `dariId`/`keId` lama:
  - Bila titik ujungnya berjarak ≤ 0,05 m (`TOLERANSI_UJUNG_M`) dari tepi elemen tersebut → buat port pada elemen itu di posisi tersebut (u, v, zRel dihitung dari titik), lalu ikat ujung pipa ke port itu.
  - Bila tidak → ujung dibiarkan bebas dan ID lama dibuang. Peringatan teknik "ujung pipa belum tersambung" akan muncul.
- Ujung pipa yang bertemu ujung pipa lain (aturan 7) → **tidak** otomatis dibuatkan simpul (Claude). Pengguna bisa menyambungnya ulang dengan sekali klik.
- `skemaVersi` naik ke **3**, dengan migrasi v2 → v3 di `migrasiDenah` mengikuti pola v1 → v2. Server menyimpan dalam bentuk v3.
- **Urutan rilis (Claude), demi keamanan rollback.** `migrasiDenah` dipanggil oleh setiap aksi operasional di HP. Kode lama melempar galat untuk versi selain 1/2, sehingga rollback setelah ada denah v3 tersimpan akan mematikan layar operator.
  1. **Rilis persiapan:** `migrasiDenah` menerima dokumen v3 untuk kebutuhan baca. Bidang baru (`port`, `dari`/`ke`, tipe `simpul`/`gedung`, `selisihBibirCanM`) diabaikan dengan aman, dan tipe elemen yang tidak dikenal dilewati, bukan dilempar. Rilis ini di-deploy lebih dulu.
  2. **Baru kemudian** rilis yang menulis v3.

### 1.7 Validasi dan pemeriksaan teknik
- **Galat pemblokir** (`validasiDenah`):
  - `UjungJalur` menunjuk elemen atau port yang tidak ada;
  - simpul tanpa satu pipa pun (dibersihkan otomatis oleh reducer, tetapi tetap divalidasi).
- **Peringatan:**
  - ujung pipa bebas (menggantikan aturan 7);
  - pipa yang tersambung ke simpul memiliki fluida berbeda;
  - port yang dipakai lebih dari satu pipa. Ini **boleh** (manifold), tetapi diberi peringatan agar disengaja (Claude).
- **Aturan 5** (pipa menembus bak): pipa dikecualikan untuk sebuah bak bila **salah satu ujungnya terikat ke port bak itu**, di ruas mana pun (Claude). Ini setara dengan pengecualian `dariId`/`keId` sekarang, sehingga pipa brine yang masuk ke bak tidak memicu peringatan palsu.

---

## Bagian 2 — Gedung/atap dan tampak potong bak

### 2.1 Elemen gedung
- Tipe elemen baru **`gedung`**: kotak dengan `elevasiM` (bawaan 0) dan `tinggiM` = **tinggi atap dari lantai**. Bisa lebih dari satu (area dengan atap berbeda).
  - Lapisan "arsitektur".
  - 2D: garis putus tipis dan label "Atap +6,50 m".
  - 3D: rangka atap transparan yang bisa disembunyikan lewat lapisan.
- **Pemeriksaan teknik baru:** rel derek (`elevasiM` derek) + tinggi derek harus berada di bawah atap gedung yang menaunginya, dengan selisih ≥ 0,3 m (Claude).

### 2.2 Posisi can di bak
- Rumus bibir can menjadi **bibir can = permukaan brine + `selisihBibirCanM`**, dengan permukaan brine = `tataBakMeter(bak).brineZ` = `elevasiM + levelBrineM`. Datum `levelBrineM` tidak berubah: tetap diukur dari dasar luar bak, seperti kode sekarang.
  - Bidang baru pada bak, bawaan 0 = sejajar brine (fakta pengguna).
  - Bidang ini mencatat kenyataan bila di lapangan berbeda.
- `iceCanBak` (3D) dan semua perhitungan memakai rumus ini.
- **Aturan 2b diganti:**
  - `RENDAM_MIN` dihapus;
  - peringatan bila |`selisihBibirCanM`| > 0,02 m ("bibir can tidak sejajar brine");
  - peringatan bila dasar can < dasar dalam bak ("can lebih tinggi dari kedalaman brine — tidak muat").
- **Aturan 3** (ruang bebas derek) **tidak berubah**: bibir bak + tinggi can + 0,2 m. Can yang diangkat dasarnya tetap harus melewati bibir bak. Tampak potong menampilkan ruang angkat = dasar kait − (bibir bak + tinggi can).

### 2.3 Tampak potong bak
- Panel **"Tampak potong"** di builder: tab baru di panel kanan, aktif bila satu bak terpilih.
  - Berisi gambar SVG skematis memotong melintang rek, **tidak berskala horizontal**. Skala vertikal mengikuti meter.
  - Isi dari atas ke bawah, masing-masing dengan elevasi:
    - atap gedung yang menaungi bak (bila ada);
    - rel derek dan dasar kait (bila ada derek yang relnya melintasi bak);
    - lantai ±0,00;
    - **bibir bak** dengan label "tinggi dinding dari lantai = bibir − 0,00";
    - **permukaan brine**;
    - **can** (tinggi, bibir, dasar), satu baris untuk BK dan satu untuk BB bila bak campuran;
    - dasar dalam bak.
  - Garis ukur di sisi gambar: tinggi dinding di atas lantai, kedalaman brine, tinggi can, ruang angkat (dasar kait → bibir can terangkat).
  - Nilai yang melanggar pemeriksaan teknik diberi warna peringatan, dengan teks yang sama seperti di panel validasi.
- **Selang pendingin tidak digambar** (keputusan pengguna).
- Panel ini hanya-baca. Angka diubah di tab Properti.
- Komponen yang sama dipakai di `denah-penampil` (mode lihat) saat bak dipilih.

---

## Bukan tujuan
- Simulasi aliran, tekanan, atau kapasitas pompa.
- Menggambar selang pendingin di dalam can.
- Fitting rinci (elbow, reducer, katup) sebagai elemen. Simpul hanya untuk cabang.
- Port pada dinding, pintu, area, label, derek, dan gedung.
- Pengeditan 3D langsung (3D tetap hanya-baca).

## Anti-tujuan
- Ujung pipa terikat yang tidak berada tepat di port atau simpulnya setelah aksi apa pun, termasuk undo/redo.
- Denah lama rusak atau kehilangan pipa saat migrasi v3.
- Pipa terikat yang ikut bergeser tanpa bendanya, atau benda yang bergeser tanpa pipanya.
- Angka tampak potong yang berbeda dari angka 3D atau pemeriksaan teknik. Semuanya harus memakai satu helper geometri.

## Diserahkan ke pembuat
- Bentuk ikon dan warna port, simpul, dan simbol naik/turun.
- Ambang zoom untuk label z dan Ø.
- Tata letak bilah gambar, termasuk lebar layar HP.
- Nama komponen dan berkas.
- Urutan pengerjaan Bagian 1 dan Bagian 2. Keduanya independen dan boleh dikerjakan bergantian.
