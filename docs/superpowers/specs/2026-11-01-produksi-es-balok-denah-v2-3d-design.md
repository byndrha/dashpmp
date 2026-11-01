# Produksi Es Balok — Denah v2 (skala nyata) + Mode 3D Replika — Desain

Tanggal: 2026-11-01 · Bisnis: Es Balok · Pabrik: PMPersada, PMPakis
Melanjutkan: `2026-10-25-produksi-es-balok-builder-denah-design.md` (tahap 1, sudah live)
Riset: `docs/research/2026-11-01-denah-produksi-es-balok-3d-digital-twin.md`

## Maksud

Denah tahap 1 belum bisa dipercaya sebagai gambaran pabrik nyata:
- belum ada satuan ukur dunia nyata;
- belum ada mata angin;
- belum ada ketinggian;
- belum ada jalur pipa/kabel.

Tahap ini menjadikan denah **replika berskala nyata**. Semua ukuran dalam meter, setiap benda punya ketinggian, ada arah utara, pipa dan kabel bisa ditarik sampai ke dalam beton, dan ada **mode 3D** untuk *memeriksa apakah pembuatan sudah benar*. Contoh pemeriksaannya: apakah derek cukup tinggi untuk mengangkat ice can keluar dari bak, apakah pipa tertanam di pelat lantai, ke mana air mengalir, dan apakah ice can muat di dalam bak.

## Keputusan pengguna (2026-11-01)

- Wawancara detail ditunda. Claude langsung mengerjakan, dan keputusan teknis menjadi wewenang Claude (ditandai "Claude" di bawah).
- 3D **bukan sekadar hiasan**. Fungsinya mode pemeriksaan kebenaran pembuatan: tinggi derek di atas bak, jalur pipa di dalam beton, aliran air, dan sebagainya. Targetnya **hampir menyerupai replika/miniatur dunia nyata**.
- Wajib ada: satuan ukur sesuai dunia nyata, mata angin, dan konfigurasi yang lengkap.
- Lisensi pustaka bebas.

## Keputusan desain (Claude)

### 1. Satuan: 1 unit = 1 meter
- Dokumen naik ke `skemaVersi: 2`. **Semua koordinat dan ukuran horizontal (x, y, w, h, titik) dalam meter**, dan semua ketinggian (`elevasiM`, `tinggiM`, `z`) juga dalam meter. Ukuran kecil (ice can, diameter pipa) disimpan dalam milimeter, dengan nama field berakhiran `Mm`.
- `0` vertikal = **muka lantai jadi** (finished floor level, ±0,00). Nilai negatif = di bawah lantai (pelat, bak yang tertanam, pipa dalam beton/tanah).
- Snap grid memakai langkah `kanvas.langkahSnapM` (bawaan 0,1 m; pilihan 0,05 / 0,1 / 0,25 / 0,5 / 1). Garis grid tipis setiap 1 m, tebal setiap 5 m. Alt tetap berarti "tanpa snap" (presisi 1 cm).
- Ukuran minimum elemen 0,05 m. Tebal dinding bawaan 0,2 m.
- Semua label ukuran di builder memakai format meter Indonesia (`12,50 m`). Status kursor menampilkan koordinat dalam meter.

### 2. Migrasi v1 → v2
- Fungsi murni `migrasiDenah(raw): DenahDokumenV2` dijalankan saat **membaca**: dokumen v1 diskalakan dengan **1 unit lama = 0,5 m**, lalu semua field baru diisi bawaan. Dokumen v2 diteruskan apa adanya, hanya field opsional yang hilang yang dilengkapi bawaan.
- Server hanya **menyimpan** v2. `validasiBentukDenah` menerima `skemaVersi: 2` saja.
- Data saat ini hanya satu denah uji di PMPersada (3 elemen) dan `produksi_kolom_isi` masih kosong. Tidak perlu skrip migrasi DB; dokumen ditulis ulang sebagai v2 saat pertama kali disimpan.

### 3. Dokumen v2

```ts
interface DenahDokumen {            // v2 menggantikan v1 sebagai tipe utama
  skemaVersi: 2;
  kanvas: {
    lebar: number; tinggi: number;   // meter (ukuran lahan), bawaan 60 × 40
    ukuranGrid: number;              // piksel per meter pada zoom 100% (tampilan saja), bawaan 20
    langkahSnapM: number;            // bawaan 0.1
    utaraDerajat: number;            // 0 = utara ke atas kanvas; searah jarum jam, 0–359
    pelatLantai: { tebalM: number }; // pelat beton global di bawah ±0,00, bawaan 0.2
  };
  elemen: DenahElemen[];
}

interface ElemenDasar {
  id; nama; x; y; w; h; rotasi; terkunci?;      // x/y/w/h dalam meter
  elevasiM: number;                             // dasar benda dari ±0,00
  tinggiM: number;                              // tinggi benda
}
```

| Tipe | Field baru/ubah | Bawaan |
|---|---|---|
| `bak` | `elevasiM` = dasar bak (negatif bila tertanam), `tinggiM` = kedalaman total. `tebalDindingM`, `levelBrineM` (dari dasar bak), `jarakAntarKolomMm`, `jarakAntarCanMm`, `iceCan: { kecil: DimensiIceCan; besar: DimensiIceCan }` | elevasi −0,7, tinggi 1,0 (bibir +0,3), dinding 0,2, brine 0,95, jarak kolom 60 mm, jarak can 40 mm; ukuran bawaan 16 × 6,5 m (muat 36 kolom × 36 can Kecil) |
| `DimensiIceCan` | `{ panjangMm; lebarMm; tinggiMm; beratKg; presetId?: string }`. Panjang = sumbu sepanjang kolom, lebar = sumbu antar-kolom, tinggi = vertikal | Kecil = preset "pasar 25 kg", Besar = panjang 2× Kecil (fakta pengguna: lebar & tinggi sama) |
| `mesin` | `kategori: "refrigerasi" \| "pompa" \| "listrik" \| "lainnya"` (menentukan lapisan & warna 3D) | `refrigerasi`, tinggi 1,8 |
| `derek` | `elevasiM` = tinggi **rel** dari ±0,00; `tinggiKaitM` = jarak rel → dasar kait saat terangkat penuh; `tinggiM` = tinggi balok rel | rel +3,5, kait 0,8, balok 0,3 |
| `dinding` | `tinggiM` (h atau w = tebal) | tinggi 4,0, tebal 0,2 |
| `pintu` | `tinggiM` | 2,4 |
| `area` | `elevasiM` (lantai turun/naik, mis. lubang pit) | 0 |
| `label` | – | – |
| **`beton`** (baru) | Balok beton: pondasi mesin, plinth, saluran, pelat tambahan. `elevasiM`, `tinggiM` | elevasi −0,5, tinggi 0,5 |
| **`tangki`** (baru) | `jenis: "tandon" \| "filling" \| "thawing" \| "sumur" \| "cooling-tower" \| "lainnya"`, `bentuk: "kotak" \| "silinder"`, `kapasitasM3?`, `levelIsiPersen` (0–100, visual) | tandon, kotak, tinggi 1,5, isi 70 |
| **`jalur`** (baru) | Polyline 3D. `jenis: "pipa" \| "kabel"`; untuk pipa `fluida: "air-baku" \| "air-pendingin" \| "air-thawing" \| "drain" \| "brine" \| "nh3-cair" \| "nh3-gas" \| "udara"`; untuk kabel `sistem: "daya" \| "kontrol"`; `diameterMm`; `titik: {x;y;z}[]` (urutan = **arah aliran**); `dariId?`, `keId?` (elemen di ujung awal/akhir). x/y/w/h = kotak pembungkus titik (dihitung, untuk seleksi) | pipa air-baku Ø 50 mm; kabel daya Ø 25 mm; z bawaan = elevasi kerja aktif |

**Preset ukuran ice can** (`PRESET_ICE_CAN`, dari riset: tabel pasar Indonesia mesinesbalok.id dan FAO):

| id | Label | P × L × T (mm) | kg |
|---|---|---|---|
| pasar-5 | Pasar 5 kg | 80 × 165 × 500 | 5 |
| pasar-10 | Pasar 10 kg | 100 × 205 × 610 | 10 |
| pasar-15 | Pasar 15 kg | 100 × 320 × 610 | 15 |
| pasar-20 | Pasar 20 kg | 120 × 320 × 750 | 20 |
| pasar-25 | Pasar 25 kg | 120 × 360 × 750 | 25 |
| pasar-50 | Pasar 50 kg | 145 × 460 × 1000 | 50 |
| pasar-100 | Pasar 100 kg | 210 × 550 × 1200 | 100 |
| fao-25 | FAO 25 kg | 190 × 190 × 1105 | 25 |
| fao-50 | FAO 50 kg | 184 × 408 × 1000 | 50 |
| fao-136 | FAO 136 kg | 280 × 560 × 1220 | 136 |
| kustom | Kustom | bebas | bebas |

Catatan: dimensi pasar dan FAO adalah ukuran bibir atas (cetakan tirus). Panel properti menampilkan peringatan "ukur cetakan nyata di lapangan; variasi ±5 cm".

### 4. Lapisan (diturunkan, tidak disimpan)
`lapisanElemen(e)` memetakan setiap elemen ke satu dari 6 lapisan:
- `arsitektur`: dinding, pintu, area, label, beton
- `proses`: bak, derek, tangki filling/thawing
- `refrigerasi`: mesin refrigerasi, jalur NH3/brine
- `air`: tangki lain, pompa, jalur air/drain/udara
- `listrik`: mesin listrik, kabel
- `lainnya`: mesin `lainnya`

Visibilitas lapisan bisa diatur di 2D dan 3D. Pengaturan ini disimpan per pengguna di `localStorage`, bukan di dokumen.

### 5. Validasi: galat vs peringatan teknik
`GalatDenah` mendapat `tingkat: "galat" | "peringatan"`. Hanya **galat** yang memblokir Simpan. **Peringatan teknik** adalah inti "mode pemeriksaan": tampil di panel validasi (ikon kuning), disorot di 2D dan 3D, tetapi tidak memblokir.

Galat (baru, selain galat tahap 1 yang dipertahankan):
- `jalur` punya kurang dari 2 titik, atau diameter ≤ 0.
- `dariId`/`keId` menunjuk elemen yang tidak ada.
- Dimensi ice can ≤ 0.
- `levelBrineM` > `tinggiM` bak.
- `utaraDerajat` di luar 0–359.
- `tinggiM` ≤ 0 untuk tipe ber-volume.

Peringatan teknik (`periksaTeknik(dok)`, fungsi murni):
1. **Ice can tidak muat di bak.** Hitungan dilakukan dalam bak (dikurangi tebal dinding), mengikuti `orientasiKolom`:
   - Panjang yang dibutuhkan = Σ(lebar can tiap kolom + jarak antar-kolom).
   - Lebar yang dibutuhkan = maksimum (jumlah can × (panjang can + jarak can)).
   - Bila melebihi ruang dalam bak: "Bak 1: 36 kolom butuh 15,48 m, ruang dalam 14,60 m (kurang 0,88 m)".
2. **Ice can vs kedalaman & brine.** Ice can digantung dengan bibir atas sejajar bibir bak, jadi dasar can = bibir − tinggi can. Dua cek, memakai varian tertinggi yang dipakai kolom aktif:
   - (a) Dasar can lebih rendah dari lantai dalam bak (`elevasiM + tebalDindingM`): "ice can menyentuh dasar bak".
   - (b) Bagian can yang terendam brine kurang dari 85% tingginya: "brine terlalu rendah, ice can hanya terendam X%".
3. **Derek terlalu rendah.** Untuk setiap bak di `bakIds`: `elevasiRel − tinggiKait` harus ≥ `bibirBak + tinggi can tertinggi + 0,20 m` (ruang bebas). Pesannya menyebut kekurangan dalam cm.
4. **Derek tidak melintasi bak yang dilayaninya.** Garis rel (2D) tidak memotong kotak bak.
5. **Pipa menembus bak.** Segmen pipa melewati volume bak padahal pipa tidak berujung di bak itu (`dariId`/`keId` ≠ bak).
6. **Jalur tertanam.** Informasi, bukan masalah: segmen dengan z di antara `−tebalPelat` dan 0 (atau di dalam elemen `beton`) ditandai "tertanam di beton". Jalur NH3 yang tertanam diberi peringatan, karena pipa amonia sebaiknya terlihat untuk inspeksi.
7. **Ujung jalur menggantung.** Ujung tanpa `dariId`/`keId` dan tidak berada pada titik jalur lain (toleransi 0,05 m).
8. **Elemen di luar dinding.** Opsional bila ada dinding tertutup. Bukan tujuan tahap ini; tidak diimplementasikan.

Aturan "kolom berisi es" tahap 1 tetap berlaku, ditambah satu aturan: mengubah `iceCan[varian]` sebuah bak saat ada kolom berisi es bervarian itu adalah pelanggaran.

### 6. Builder 2D: penambahan
- **Panel "Pengaturan denah"** (saat tidak ada yang dipilih): ukuran lahan (m), arah utara (derajat + tombol putar 15°), tebal pelat lantai, langkah snap, dan elevasi kerja (z bawaan untuk alat Jalur).
- **Mawar mata angin** di pojok kanan atas kanvas (2D & 3D), berputar sesuai `utaraDerajat`, dengan huruf U/T/S/B.
- **Skala batang** (mis. "0 — 5 m") di pojok kiri bawah, menyesuaikan zoom.
- **Label dimensi** pada elemen terpilih: panjang × lebar dalam meter di sisi elemen. Rel derek menampilkan panjang rel.
- **Alat Ukur** (huruf `M`): tarik dua titik untuk melihat jarak (m) dan sudutnya. Hasilnya sementara dan tidak disimpan.
- **Alat Beton** dan **alat Tangki** (kotak, seperti mesin).
- **Alat Jalur** (huruf `J`): klik titik demi titik, lalu dobel klik atau Enter untuk selesai, Esc untuk batal. Titik menempel ke ujung jalur lain atau ke tepi elemen; menempel ke elemen mengisi `dariId`/`keId`. Jenis dan fluida dipilih di bilah kecil saat alat aktif. Setiap titik baru memakai z = elevasi kerja.
  - Tampilan 2D: garis berwarna per fluida, dengan panah arah aliran.
  - Garis **putus-putus** bila tertanam (z < 0), tebal sesuai diameter (minimum 2 px).
- **Panel properti** untuk tipe baru dan field baru:
  - Elevasi & tinggi semua elemen.
  - Bak: preset ice can per varian + dimensi + jarak + level brine + tebal dinding, ditambah ringkasan "kapasitas per siklus (kg)" dan "ruang terpakai x / y m".
  - Jalur: tabel titik (x, y, z) yang bisa diedit, tombol balik arah aliran, dari/ke.
  - Derek: tinggi rel, tinggi kait.
- **Toggle lapisan** di bilah atas (ikon "Lapisan", menu centang).
- Panel validasi memisahkan Galat dan Peringatan teknik. Klik baris = pilih + sorot elemen.

### 7. Mode 3D Replika
- **Tombol `2D | 3D`** di bilah atas builder dan di penampil halaman Produksi. Di builder, 3D menggantikan kanvas 2D pada tata letak yang sama, sementara panel properti dan validasi tetap ada. Jadi pengguna bisa **memilih benda di 3D lalu mengubah angkanya (mis. tinggi rel derek) dan melihat hasilnya seketika**. 3D merender `state.dok` yang belum disimpan. Seleksi berbagi state dengan 2D. **Menggeser benda di 3D bukan tujuan tahap ini.**
- **Pustaka:** `three`, `@react-three/fiber` (9.x, peer React 19 ✓), `@react-three/drei`. Dimuat via `next/dynamic(..., { ssr: false })` dari komponen client (ikuti `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`), hanya di halaman produksi.
- **Sistem koordinat:** denah (x kanan, y bawah) → three (x, y=atas, z=y denah). Satu unit three = 1 m.
- **Isi adegan, semuanya prosedural dari dokumen:**
  - Tanah/lahan seluas kanvas. **Pelat lantai** beton setebal `pelatLantai.tebalM` di bawah ±0,00.
  - Dinding diekstrusi setinggi `tinggiM`. Pintu menjadi bukaan berwarna (dinding dipotong setinggi pintu bila pintu bersinggungan dengan dinding; bila tidak, kotak pintu biasa).
  - Bak:
    - Cangkang beton (dinding setebal `tebalDindingM`), dari `elevasiM` sampai bibir.
    - Bidang permukaan brine transparan di `levelBrineM`.
    - **Ice can sebagai `InstancedMesh`** berukuran nyata, tersusun per kolom dengan jarak yang dikonfigurasi. Warna per varian; kolom nonaktif abu-abu.
  - Derek: balok rel di `elevasiM` sepanjang titikAwal→titikAkhir, troli + kait di tengah rel pada `elevasiM − tinggiKaitM`, dan **kotak ruang bebas** semi-transparan: hijau bila lolos, merah bila peringatan 3 aktif.
  - Mesin: kotak berwarna per kategori. Beton: kotak abu beton. Tangki: kotak/silinder dengan isi air setinggi `levelIsiPersen`.
  - Jalur: `TubeGeometry` per segmen (sudut siku tajam), berwarna per fluida dengan diameter nyata (minimum visual 30 mm). **Animasi aliran**: tekstur garis/panah bergerak sesuai urutan titik, bisa dimatikan.
  - Area: tint lantai. Label: teks melayang (`drei <Html>`/`<Text>`) yang hanya tampil saat hover/terpilih, ditambah label nama bak/mesin bila zoom dekat.
  - **Mawar mata angin** di lantai pojok lahan + indikator utara HUD.
  - Grid lantai 1 m.
- **Alat 3D** (bilah kecil di atas viewport):
  - Kamera preset: Isometrik, Atas (ortografis), Depan, dan "Fokus ke terpilih".
  - **X-ray beton**: pelat, dinding, beton, dan cangkang bak menjadi transparan agar pipa tertanam dan isi bak terlihat.
  - **Potongan (section)**: bidang potong horizontal (slider ketinggian, mis. potong di +1,0 m untuk melihat ke dalam) dan vertikal (sumbu X atau Y, slider posisi). Memakai clipping plane renderer.
  - **Ukur**: klik dua titik permukaan → jarak 3D, Δ horizontal, dan Δ tinggi.
  - Toggle lapisan (sama dengan 2D), toggle animasi aliran.
- **Sorotan peringatan:** elemen yang terkena peringatan teknik diberi outline kuning/merah di 3D. Mengklik peringatan di panel validasi memfokuskan kamera ke elemen itu.
- **Kinerja:**
  - `frameloop="demand"`, kecuali animasi aliran menyala.
  - Satu `InstancedMesh` per varian per bak.
  - Geometri di-memo per elemen. Target 60 fps untuk 5 bak × 66 kolom × 36 can (±12.000 can) di laptop kantor.
  - Bila WebGL tidak tersedia, tampilkan pesan dan kembali ke 2D.
- **Penampil halaman Produksi:** tombol 2D/3D yang sama. Klik bak di 3D membuka panel detail bak yang sudah ada. Ringkasan mendapat kartu "Kapasitas per siklus" (Σ can aktif × berat kg, dalam ton).

## Bukan tujuan tahap ini
Menggeser/mengedit benda langsung di 3D; auto-routing pipa; skematik P&ID/SLD; data sensor/live; status isi/kematangan kolom (tahap operasional); model GLB realistis; impor IFC/CAD; posisi matahari/geolokasi; bangunan bertingkat; perhitungan beban listrik/refrigerasi.

## Anti-tujuan
- 3D dan 2D tidak sepakat. Keduanya membaca satu `DenahDokumen`, dan geometri turunan (tata kolom/ice can, kotak efektif rotasi) dihitung oleh fungsi murni bersama di `src/lib/`.
- Denah lama hilang atau rusak karena migrasi.
- Pustaka 3D ikut terbundel ke halaman lain.
- Peringatan teknik memblokir Simpan.
- Aturan "kolom berisi es", izin edit, dan isolasi antar-pabrik dari tahap 1 melemah.

## Struktur kode (Claude)
- `src/lib/produksi-denah.ts`: tipe v2, bawaan, `migrasiDenah`, preset ice can, `lapisanElemen`, validasi bentuk v2, `validasiDenah` (galat), dan `kolomTerkunciBerubah` (diperluas). Bila file menjadi terlalu besar, geometri dipecah ke `src/lib/produksi-denah-geometri.ts` (tata kolom & ice can dalam meter, bibir bak, garis rel, kotak jalur, segmen tertanam) dan `src/lib/produksi-denah-teknik.ts` (`periksaTeknik`). Semuanya client-safe (tanpa impor server) dan diuji `node:test`.
- `src/components/produksi-denah/3d/*`: adegan R3F (`adegan-3d.tsx`, satu komponen per tipe elemen, `alat-3d.tsx`, `kamera.ts`), dibungkus `tampilan-3d.tsx` yang di-*dynamic import*.
- Builder & penampil: perluasan file yang ada (palet, panel properti, kanvas, builder, penampil, pintasan).

## Pengujian
- `node:test` untuk:
  - migrasi v1→v2 (skala 0,5, bawaan);
  - validasi bentuk v2;
  - tata kolom/ice can dalam meter;
  - setiap aturan `periksaTeknik`, dengan kasus lolos dan gagal;
  - jalur tertanam;
  - perluasan kolom terkunci (iceCan).
- Verifikasi di browser bawaan dengan denah contoh mirip PMPersada: 5 bak (37/37/44/66/66 kolom), derek, ruang mesin, pipa air tertanam, dan kabel. Yang diperiksa:
  - 2D: skala, mata angin, ukur, jalur.
  - 3D: semua benda tampil, x-ray, potongan, ukur, sorotan peringatan derek terlalu rendah.
  - Simpan lalu muat ulang.
  - Penampil 3D di halaman Produksi.

## Diserahkan ke pembangun
Warna persis per fluida/kategori (gunakan konvensi umum: air biru, drain coklat, NH3 kuning/oranye, brine ungu, udara abu muda, kabel daya merah, kabel kontrol hijau), bentuk ikon, detail tata letak bilah alat 3D, dan cara memotong bukaan pintu di dinding (boleh disederhanakan).
