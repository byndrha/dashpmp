# Produksi Es Balok — Denah v2 (meter) + Mode 3D Replika Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Denah produksi berskala nyata (meter, elevasi, mata angin, jalur pipa/kabel, beton, tangki), lengkap dengan pemeriksaan teknik dan mode 3D read-only untuk memverifikasi bahwa pembuatan sudah benar.

**Architecture:**
- Dokumen denah naik ke `skemaVersi: 2`, dengan satuan 1 unit = 1 m.
- Migrasi v1→v2 dilakukan saat baca, di fungsi murni.
- Geometri turunan (tata kolom/ice can berukuran nyata) dan pemeriksaan teknik ada di modul `src/lib/` yang client-safe, dan dipakai bersama oleh kanvas SVG 2D dan adegan React Three Fiber 3D.
- 3D merender `state.dok` builder (belum disimpan) dan berbagi seleksi dengan 2D.

**Tech Stack:** Next.js 16 App Router, React 19.2, Postgres, Tailwind 4, `node:test` + `tsx`. **Baru:** `three`, `@react-three/fiber@^9.8.2`, `@react-three/drei@^10.7.9`, `@types/three` (dev).

**Spec:** `docs/superpowers/specs/2026-11-01-produksi-es-balok-denah-v2-3d-design.md` (baca utuh sebelum task apa pun; semua nilai bawaan, preset, dan aturan ada di sana).

## Global Constraints

- **Teks & commit:**
  - Semua teks UI dalam Bahasa Indonesia. Angka memakai format Indonesia (`12,50 m`).
  - Commit dalam Bahasa Indonesia (subjek + isi), tanpa Co-Authored-By.
  - Kerjakan di `main`. `git add` hanya file milik task sendiri, karena ada banyak file pengguna yang belum di-commit.
- **Batas server/client:**
  - File `"use server"` hanya boleh mengekspor fungsi async (dijaga oleh `src/lib/__tests__/use-server-exports.test.ts`).
  - Komponen client tidak boleh mengimpor nilai dari modul yang menarik `pg`/`mssql`. Logika bersama hanya di `src/lib/produksi-denah*.ts` (tanpa impor server).
- **Aturan yang tidak boleh berubah:** izin edit (`bolehEditDenah`), penentuan kode perusahaan oleh server, optimistic locking, dan aturan kolom berisi es dari tahap 1.
- **Satuan:** 1 unit = 1 meter. Ketinggian dalam meter, dengan 0 = muka lantai jadi. Ukuran ice can dan diameter jalur dalam mm (field berakhiran `Mm`).
- **Lazy-load 3D:** pustaka 3D hanya boleh dimuat via `next/dynamic(() => import(...), { ssr: false })` dari komponen `"use client"`. Baca `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`. Tidak boleh ada impor statis `three`/`@react-three/*` dari file non-3D.
- **Peringatan tidak memblokir:** `validasiDenah` hanya mengembalikan galat yang memblokir. Peringatan teknik datang dari `periksaTeknik` dan tidak pernah dipanggil server saat simpan.
- **Verifikasi tiap task:**
  - `npx tsc --noEmit`
  - `npx eslint <file berubah>` tanpa galat baru
  - `npx tsx --test src/lib/__tests__/*.test.ts`
  - Task UI juga `npx next build`.

## Review Focus

1. Denah v1 tersimpan (PMPersada: Bak 27×8 unit, derek, dinding) dibuka di builder: tampil berskala 0,5 m/unit tanpa kehilangan elemen/ID, dan disimpan sebagai v2. Diuji oleh tes migrasi di Task 1.
2. Bak diputar 90/270 dengan `orientasiKolom: "vertikal"` dan `arahNomor: "mundur"`: urutan dan posisi kolom/ice can harus sama di 2D dan 3D. Diuji oleh tes `tataBakMeter` di Task 2, dan 3D memakai fungsi yang sama.
3. Jalur dipindah, diputar, diduplikat, lalu di-undo: semua titik ikut, kotak pembungkus tetap sinkron, dan z tidak berubah. Diuji oleh tes reducer di Task 6.
4. Denah yang hanya punya peringatan (mis. derek terlalu rendah) tetap bisa disimpan, di client maupun server. Diuji oleh tes di Task 3: `validasiDenah` tidak memuat aturan teknik.
5. Browser tanpa WebGL, atau adegan 3D yang melempar error, tidak merusak halaman. Penanganannya: error boundary + kembali ke 2D (Task 7).

---

### Task 1: Skema v2, migrasi, bentuk, query

**Files:**
- Modify: `src/lib/produksi-denah.ts`, `src/lib/queries/produksi-denah.ts`, `src/components/produksi-denah/builder-state.ts` (bawaan dalam meter + field wajib baru di `buatElemen`; perbaikan kompilasi minimal lain di folder `produksi-denah/` bila tsc menuntut)
- Test: `src/lib/__tests__/produksi-denah.test.ts`, `src/lib/__tests__/produksi-denah-builder.test.ts` (diperbarui ke v2)

**Interfaces — Produces** (`src/lib/produksi-denah.ts`):
```ts
type DenahDokumen  // v2 persis spec §3 (kanvas.langkahSnapM, utaraDerajat, pelatLantai; ElemenDasar.elevasiM/tinggiM)
type BakElemen     // + tebalDindingM, levelBrineM, jarakAntarKolomMm, jarakAntarCanMm, iceCan: Record<Varian, DimensiIceCan>
type DimensiIceCan = { panjangMm: number; lebarMm: number; tinggiMm: number; beratKg: number; presetId?: string }
type MesinElemen   // + kategori: "refrigerasi" | "pompa" | "listrik" | "lainnya"
type DerekElemen   // + tinggiKaitM (elevasiM = tinggi rel)
type BetonElemen   = ElemenDasar & { tipe: "beton" }
type TangkiElemen  = ElemenDasar & { tipe: "tangki"; jenis: JenisTangki; bentuk: "kotak" | "silinder"; kapasitasM3?: number; levelIsiPersen: number }
type JalurElemen   = ElemenDasar & { tipe: "jalur"; jenis: "pipa" | "kabel"; fluida?: Fluida; sistem?: "daya" | "kontrol"; diameterMm: number; titik: Titik3D[]; dariId?: string; keId?: string }
type Titik3D = { x: number; y: number; z: number }
type Fluida = "air-baku" | "air-pendingin" | "air-thawing" | "drain" | "brine" | "nh3-cair" | "nh3-gas" | "udara"
type JenisTangki = "tandon" | "filling" | "thawing" | "sumur" | "cooling-tower" | "lainnya"
type Lapisan = "arsitektur" | "proses" | "refrigerasi" | "air" | "listrik" | "lainnya"
TIPE_ELEMEN  // + "beton", "tangki", "jalur"
PRESET_ICE_CAN: readonly { id: string; label: string; panjangMm; lebarMm; tinggiMm; beratKg }[]  // 11 baris spec §3
ICE_CAN_DIMENSI_BAWAAN: Record<Varian, DimensiIceCan>  // kecil = pasar-25 (120×360×750, 25 kg, presetId "pasar-25"); besar = 240×360×750, 50 kg, tanpa presetId
denahKosong(): DenahDokumen          // v2: 60×40 m, ukuranGrid 20, langkahSnapM 0.1, utaraDerajat 0, pelatLantai.tebalM 0.2
buatBak(x, y, opsi?): BakElemen       // bawaan spec §3: 16×6,5 m, elevasi −0.7, tinggi 1.0, dinding 0.2, brine 0.95, jarak 60/40 mm
migrasiDenah(raw: unknown): DenahDokumen   // v1 → v2 (×0.5 untuk x,y,w,h,titikAwal/Akhir, kanvas lebar/tinggi; ukuranGrid ×2) + isi bawaan; v2 → lengkapi field opsional yang hilang; bentuk lain → lempar Error
lapisanElemen(e: DenahElemen): Lapisan     // pemetaan spec §4
kotakJalur(titik: readonly Titik3D[]): { x; y; w; h }  // kotak pembungkus, sisi minimum 0.05
```
`validasiBentukDenah` hanya menerima `skemaVersi: 2` dan memeriksa field baru (enum, angka finite, titik ≤ 1000 per jalur, `utaraDerajat` 0–359). `kolomTerkunciBerubah` diperluas: perubahan `bak.iceCan[varian]` (dimensi apa pun) ketika ada kolom berisi es bervarian itu → pelanggaran "dimensi ice can {Kecil|Besar} tidak boleh diubah: …".

- [ ] **Step 1: Tulis tes yang gagal**
  - `migrasiDenah` atas dokumen v1 (Bak 27×8 di x=4, derek A(2,10)→B(30,10), kanvas 120×80 grid 20) menghasilkan:
    - Bak 13,5×4 di x=2; titikAwal (1,5); kanvas 60×40; ukuranGrid 40; `skemaVersi` 2.
    - ID elemen & kolom identik.
    - Bak mendapat `iceCan` bawaan; derek `elevasiM` 3.5, `tinggiKaitM` 0.8.
  - `migrasiDenah(v2)` adalah identitas untuk dokumen lengkap.
  - `validasiBentukDenah` menolak `skemaVersi: 1`, fluida tak dikenal, dan titik jalur NaN; menerima jalur sah.
  - `lapisanElemen`: tangki filling → `proses`, jalur nh3-gas → `refrigerasi`, kabel → `listrik`, beton → `arsitektur`.
  - `kolomTerkunciBerubah` melaporkan perubahan `iceCan.kecil.tinggiMm` bila ada kolom kecil berisi es, dan tidak melapor bila hanya ada kolom besar berisi es.
  - Perbarui tes lama ke fixture v2 (pakai `denahKosong()` + `buatBak`).
- [ ] **Step 2:** `npx tsx --test src/lib/__tests__/produksi-denah.test.ts`, harus FAIL.
- [ ] **Step 3: Implementasi** tipe, bawaan, preset, `migrasiDenah`, `lapisanElemen`, `kotakJalur`, bentuk v2, dan perluasan kolom terkunci.
  - Di `queries/produksi-denah.ts`: `keDenahTersimpan` dan `barisLama.data` di `simpanDenahUntukKode` dilewatkan ke `migrasiDenah`.
  - Di `builder-state.ts`: `UKURAN_BAWAAN` dalam meter (bak 16×6.5, mesin 2×2, derek 16×0.3, dinding 10×0.2, pintu 1.2×0.2, area 6×4, label 4×1, beton 2×2, tangki 2×2, jalur 1×1), `NAMA_TIPE` + Beton/Tangki/Jalur, dan `buatElemen` mengisi elevasi/tinggi bawaan spec §3 untuk setiap tipe.
  - Dinding dari garis memakai tebal 0.2.
- [ ] **Step 4:** Jalankan semua tes, `npx tsc --noEmit`, dan eslint. Hasilnya harus PASS.
- [ ] **Step 5: Commit** `feat(produksi-es-balok): skema denah v2 berskala meter + migrasi v1`

### Task 2: Geometri berskala nyata (bersama 2D & 3D)

**Files:**
- Create: `src/lib/produksi-denah-geometri.ts`
- Test: `src/lib/__tests__/produksi-denah-geometri.test.ts`

**Interfaces — Consumes:** tipe Task 1. **Produces:**
```ts
// Koordinat LOKAL bak sebelum rotasi: a = sumbu deret kolom, b = sumbu sepanjang kolom
// (horizontal: a=x, b=y; vertikal: a=y, b=x — sama dengan tataBak lama di denah-kanvas.tsx:935-953).
interface TataKolom { kolomId: string; indeks: number; posisi: number; a0: number; lebar: number; b0: number; panjangCan: number; jarakCan: number; jumlah: number; varian: Varian; nonaktif: boolean }
interface TataBak { kolom: TataKolom[]; ruangA: number; ruangB: number; butuhA: number; butuhB: number; bibirZ: number; lantaiDalamZ: number; brineZ: number;
                    keXY(a: number, b: number, da: number, db: number): { x: number; y: number; w: number; h: number } }
tataBakMeter(bak: BakElemen): TataBak
// a0 kolom ke-posisi = tebal + jarakKolom + Σ(lebar kolom sebelumnya + jarakKolom); posisi = urutan setelah arahNomor;
// lebar = iceCan[varian].lebarMm/1000; b0 = tebal + jarakCan; ice can ke-j di b = b0 + j*(panjang+jarakCan).
// ruang = sisi bak − 2*tebal; butuhA = jarakKolom + Σ(lebar+jarakKolom); butuhB = jarakCan + max_kolom(jumlah*(panjang+jarakCan)).
// bibirZ = elevasiM+tinggiM; lantaiDalamZ = elevasiM+tebalDindingM; brineZ = elevasiM+levelBrineM.
pusatElemen(e: DenahElemen): { x: number; y: number }
keDunia(e: DenahElemen, lokal: { x: number; y: number }): { x: number; y: number }   // terapkan rotasi elemen (poros tengah, seperti SVG)
garisRel(d: DerekElemen): { a: Titik; b: Titik }
segmenJalur(j: JalurElemen): { a: Titik3D; b: Titik3D; panjang: number }[]
segmenTertanam(seg, dok: DenahDokumen): boolean   // z kedua ujung di [−pelatLantai.tebalM, 0] ATAU di dalam kotak+rentang z elemen beton
potongSegmenKotak(a: Titik3D, b: Titik3D, kotak: { x; y; w; h; zBawah; zAtas }): boolean
```
- [ ] **Step 1: Tulis tes yang gagal**
  - Bak bawaan (36 kolom kecil × 36 can):
    - `butuhA` = 0.06 + 36×0.42 = 15.18 dan `ruangA` = 15.6.
    - `butuhB` = 0.04 + 36×0.16 = 5.8 dan `ruangB` = 6.1.
    - `bibirZ` 0.3, `lantaiDalamZ` −0.5, `brineZ` 0.25.
  - `arahNomor: "mundur"` → kolom indeks 0 punya a0 terbesar.
  - Kolom besar memakai lebar 0.36 dan panjang 0.24.
  - `keDunia` dengan rotasi 90 memetakan pojok lokal sesuai rotasi SVG `rotate(90 cx cy)`.
  - `segmenTertanam`: z = −0.1 tertanam di pelat 0.2, z = −0.3 tidak (kecuali di dalam beton −0.5..0 yang menutup titiknya).
  - `potongSegmenKotak`: lolos/potong untuk satu kasus masing-masing.
- [ ] **Step 2:** Jalankan tes, harus FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Jalankan tes, harus PASS. Jalankan juga tsc dan eslint.
- [ ] **Step 5: Commit** `feat(produksi-es-balok): geometri denah berskala nyata`

### Task 3: Pemeriksaan teknik + galat baru + panel validasi

**Files:**
- Create: `src/lib/produksi-denah-teknik.ts`
- Test: `src/lib/__tests__/produksi-denah-teknik.test.ts`
- Modify: `src/lib/produksi-denah.ts` (`GalatDenah.tingkat?: "galat" | "peringatan"` + galat baru spec §5), `src/components/produksi-denah/panel-validasi.tsx`, `src/components/produksi-denah/denah-builder.tsx` (hitung `periksaTeknik(state.dok)` via `useMemo`, teruskan ke panel; Simpan tetap hanya diblokir `validasiDenah`)

**Produces:** `periksaTeknik(dok: DenahDokumen): GalatDenah[]`. Semua bertingkat `"peringatan"` dan menyertakan `elemenId` (dan `elemenTerkaitIds?: string[]`, ditambahkan ke `GalatDenah`). Aturan 1–7 spec §5 (aturan 2 = dua cek a/b; aturan 6 hanya untuk jalur NH3). Pesan memakai meter/cm berformat Indonesia, persis pola contoh spec.

- [ ] **Step 1: Tulis tes yang gagal**, masing-masing dengan kasus lolos dan gagal:
  - Bak bawaan → nol peringatan.
  - Bak lebar 13.5 → peringatan "kurang 2,08 m" (ruang 13,10 vs butuh 15,18).
  - `tinggiM` 0.8 → "menyentuh dasar bak".
  - `levelBrineM` 0.7 → "terendam 60%".
  - Derek `elevasiM` 1.8 untuk bak bawaan → "kurang 25 cm" (butuh 0.3+0.75+0.2=1.25; 1.8−0.8=1.0).
  - Derek rel tidak memotong bak.
  - Pipa menembus bak tanpa dari/ke bak.
  - Jalur nh3-gas tertanam.
  - Ujung jalur menggantung vs ujung bertemu jalur lain (toleransi 0.05).
  - `validasiDenah(dok)` untuk dokumen yang **hanya** memicu peringatan mengembalikan `[]` (Review Focus 4).
  - Galat baru: jalur 1 titik, diameter 0, `dariId` tak ada, `levelBrineM > tinggiM`.
- [ ] **Step 2:** Jalankan tes, harus FAIL.
- [ ] **Step 3:** Implementasi + panel validasi dua bagian ("Galat — harus diperbaiki" merah, "Peringatan teknik" kuning). Klik baris memilih dan menyorot elemen (pola sorot yang ada).
- [ ] **Step 4:** Jalankan tes, tsc, eslint, dan `npx next build`.
- [ ] **Step 5: Commit** `feat(produksi-es-balok): pemeriksaan teknik denah (peringatan non-blokir)`

### Task 4: Builder 2D berskala meter, mata angin, pengaturan, properti v2

**Files:** Modify `denah-builder.tsx`, `denah-kanvas.tsx`, `panel-properti.tsx`, `bidang.tsx` (bila perlu input baru), `builder-state.ts`. Create `src/components/produksi-denah/mawar-angin.tsx`, `src/components/produksi-denah/format.ts` (`formatMeter(m: number): string` → `"12,50 m"`; `formatCm`).

**Consumes:** `tataBakMeter`, `keDunia` (Task 2); `PRESET_ICE_CAN` (Task 1).

Isi (spec §6, kecuali alat baru & jalur):
- **Snap:** `snapTitik(p, aktif, langkah)` membulatkan ke kelipatan `kanvas.langkahSnapM`. Minimum ukuran saat resize = snap ? langkah : 0.01. Garis bantu tetap.
- **Grid:** tipis setiap 1 m, tebal setiap 5 m. Label ukuran, posisi, dan panjang derek memakai `formatMeter`. Status kursor dalam meter.
- **Skala batang:** komponen pojok kiri bawah. Panjang = angka bulat terbesar dari {1,2,5,10,20,50} m yang ≤ 120 px.
- **`MawarAngin`:** props `{ utaraDerajat: number; ukuran?: number }`. Pojok kanan atas kanvas, huruf U/T/S/B, berputar sesuai `utaraDerajat`. Dipakai juga di 3D sebagai HUD.
- **Panel "Pengaturan denah":** lahan (m), arah utara (input + tombol ±15°), tebal pelat, langkah snap (select 0.05/0.1/0.25/0.5/1). Field "elevasi kerja" disimpan di state builder (`elevasiKerja: number`, bawaan −0.1, bukan dokumen) dan dipakai Task 6.
- **Kanvas bak** digambar dari `tataBakMeter`:
  - Cangkang dinding setebal `tebalDindingM`, lajur kolom selebar lebar can, dan ice can berukuran nyata (path seperti sekarang, ditampilkan bila sel ≥ 3 px).
  - Nomor kolom di pita dinding atau di atas lajur.
  - Area kolom yang melebihi ruang dalam diarsir merah.
- **Panel properti:**
  - Semua elemen: elevasi dan tinggi (m).
  - Bak: tebal dinding, level brine, jarak kolom & can (mm), dan per varian: select preset (`PRESET_ICE_CAN` + "Kustom") + P/L/T (mm) + berat. Ditambah teks peringatan "ukur cetakan nyata di lapangan; variasi ±5 cm" dan ringkasan "Kapasitas per siklus: X kg" serta "Ruang terpakai: butuhA/ruangA × butuhB/ruangB m".
  - Derek: tinggi rel, tinggi kait.
  - Mesin: kategori.
- [ ] **Step 1:** Tambah tes builder untuk `snapTitik` (langkah 0.25: 1.13 → 1.25; nonaktif → 1.13) dan `formatMeter(12.5)` → `"12,50 m"`. Pindahkan `snapTitik` ke `builder-state.ts` agar bisa diuji. Jalankan tes, harus FAIL.
- [ ] **Step 2:** Implementasi isi di atas.
- [ ] **Step 3:** Jalankan tes, tsc, eslint, dan `npx next build`. Harus PASS.
- [ ] **Step 4: Commit** `feat(produksi-es-balok): builder denah berskala meter + mata angin + properti v2`

### Task 5: Alat Beton, Tangki, Ukur + lapisan 2D

**Files:** Modify `palet-alat.tsx`, `pintasan-keyboard.ts`, `denah-kanvas.tsx`, `denah-builder.tsx`, `panel-properti.tsx`. Create `src/components/produksi-denah/lapisan.ts` dan `src/components/produksi-denah/warna.ts`.

**Produces:**
```ts
// lapisan.ts (client)
useLapisanTampil(): [ReadonlySet<Lapisan>, (l: Lapisan, tampil: boolean) => void]   // localStorage "produksi-denah:lapisan", try/catch, bawaan semua tampil
// warna.ts (dipakai 2D & 3D, nilai hex)
WARNA_FLUIDA: Record<Fluida, string>; WARNA_KABEL: Record<"daya" | "kontrol", string>; WARNA_MESIN: Record<MesinElemen["kategori"], string>; WARNA_BETON: string; WARNA_AIR: string
```
- Alat **Beton** (huruf `O`) dan **Tangki** (huruf `T`) bekerja seperti Mesin (klik/tarik kotak).
  - 2D beton: kotak abu dengan arsir.
  - 2D tangki: kotak/lingkaran sesuai `bentuk` + ikon jenis.
  - Panel properti tangki: jenis, bentuk, kapasitas, level isi.
- Alat **Ukur** (huruf `M`): tarik → garis + label jarak `formatMeter` + sudut (°). Hilang saat alat lain dipilih atau Esc. Tidak mengubah dokumen.
- **Menu "Lapisan"** di header builder dan di penampil. Elemen yang lapisannya tersembunyi tidak digambar dan tidak bisa diklik.
- [ ] **Step 1:** Tes builder untuk `buatElemen("beton" | "tangki", …)` (bawaan spec §3: beton elevasi −0.5 tinggi 0.5; tangki tandon/kotak tinggi 1.5 isi 70). Jalankan, harus FAIL.
- [ ] **Step 2:** Implementasi.
- [ ] **Step 3:** Jalankan tes, tsc, eslint, dan build. Harus PASS.
- [ ] **Step 4: Commit** `feat(produksi-es-balok): alat beton, tangki, ukur, dan lapisan denah`

### Task 6: Alat Jalur (pipa & kabel)

**Files:** Modify `builder-state.ts`, `denah-builder.tsx`, `denah-kanvas.tsx`, `palet-alat.tsx`, `pintasan-keyboard.ts`, `panel-properti.tsx`.

**Produces (reducer):**
- `geserElemen` untuk jalur menggeser semua `titik` (z tetap).
- `putar90` untuk jalur memutar titik 90° searah jarum jam di sekitar pusat kotak.
- Setiap perubahan `titik` lewat `ubahElemen` menghitung ulang x/y/w/h dengan `kotakJalur`.
- Aksi baru `{ type: "balikJalur"; id }` membalik urutan titik dan menukar `dariId`/`keId`.
- `aturKotak` (resize) tidak berlaku untuk jalur, jadi handle tidak ditampilkan.

Perilaku:
- Alat **Jalur** (huruf `J`) dengan bilah opsi saat aktif: jenis (Pipa/Kabel) + fluida/sistem + diameter.
- Klik menambah titik (z = `elevasiKerja`, snap). Dobel klik atau Enter = selesai (minimum 2 titik). Esc = batal. Backspace = hapus titik terakhir.
- Titik pertama/terakhir menempel ke ujung jalur lain (radius 8 px) atau ke tepi elemen non-jalur di bawah kursor, sehingga `dariId`/`keId` terisi.
- **Render 2D:**
  - Polyline berwarna `WARNA_FLUIDA`/`WARNA_KABEL`, tebal = max(2 px, diameter dalam skala).
  - Panah arah aliran setiap ±3 m.
  - Segmen tertanam (`segmenTertanam`) digambar putus-putus.
- **Panel properti jalur:** jenis, fluida/sistem, diameter, dari/ke (select elemen), tombol "Balik arah aliran", dan tabel titik x/y/z yang bisa diedit (tambah/hapus baris), dengan label "Tertanam di beton" per segmen.
- [ ] **Step 1: Tulis tes reducer yang gagal**:
  - `pindah` jalur (dx 1, dy 2) → semua titik bergeser, z tetap, kotak = `kotakJalur`.
  - `putar` jalur.
  - `duplikat` → ID baru, titik sama + offset.
  - `undo` mengembalikan titik.
  - `balikJalur` membalik titik dan menukar dari/ke.
- [ ] **Step 2:** Jalankan tes, harus FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** Jalankan tes, tsc, eslint, dan build. Harus PASS.
- [ ] **Step 5: Commit** `feat(produksi-es-balok): alat jalur pipa & kabel 3D di denah`

### Task 7: Mode 3D Replika — adegan inti + toggle 2D/3D

**Files:**
- Modify: `package.json` / lockfile (`npm i three @react-three/fiber@^9.8.2 @react-three/drei@^10.7.9` dan `npm i -D @types/three`), `denah-builder.tsx`, `denah-penampil.tsx`, `produksi-halaman.tsx` (kartu "Kapasitas per siklus" dalam ton).
- Create: `src/components/produksi-denah/3d/tampilan-3d.tsx` (client; `dynamic(() => import("./adegan-3d"), { ssr: false, loading })` + error boundary + deteksi WebGL), `3d/adegan-3d.tsx`, `3d/elemen-3d.tsx`, `3d/koordinat.ts`.

**Produces:**
```ts
// tampilan-3d.tsx
interface Tampilan3DProps {
  dokumen: DenahDokumen; terpilihIds: ReadonlySet<string>; lapisanTampil: ReadonlySet<Lapisan>;
  peringatan: GalatDenah[]; fokusId?: string | null; className?: string;
  onPilih: (elemenId: string | null, kolomId?: string | null) => void;
  onGagal?: () => void;   // dipanggil bila WebGL tak ada / error boundary menangkap -> induk kembali ke 2D
}
export function Tampilan3D(p: Tampilan3DProps): JSX.Element
// koordinat.ts: keThree(x: number, y: number, z: number): [number, number, number]  // [x, z, y] — denah y = three z, elevasi = three y
```
Isi adegan (spec §7 "Isi adegan"):
- Lahan + pelat lantai + grid 1 m.
- Dinding (ekstrusi, pintu sebagai bukaan sederhana).
- Bak: cangkang beton, bidang brine transparan di `brineZ`, dan ice can sebagai **satu `InstancedMesh` per varian per bak**. Posisi dari `tataBakMeter` + `keDunia`; dasar can = `bibirZ − tinggi`. Kolom nonaktif abu-abu.
- Derek: balok rel + troli/kait + kotak ruang bebas hijau/merah dari hasil `periksaTeknik`.
- Mesin (warna per kategori), beton, tangki (silinder/kotak + isi air).
- Jalur sebagai `TubeGeometry` per segmen dengan diameter nyata (minimum visual 0.03 m).
- Tint area. Label `drei <Html>` pada hover/terpilih.
- Mawar angin di lantai + HUD `MawarAngin`.
- `CameraControls` (drei), `frameloop="demand"`.
- Klik → `onPilih`. Elemen terpilih diberi outline/emissive.
- Header builder dan penampil mendapat toggle `2D | 3D` (state lokal). Di builder, panel properti & validasi tetap aktif saat 3D, sehingga mengubah angka langsung memperbarui 3D. Di penampil, klik bak di 3D membuka sheet detail bak yang ada.
- [ ] **Step 1:** Tes `koordinat.ts`: `keThree(1, 2, 3)` → `[1, 3, 2]`. Jalankan, harus FAIL.
- [ ] **Step 2:** Pasang dependensi dan implementasi.
- [ ] **Step 3:** Jalankan tes, tsc, eslint, dan `npx next build`. Pastikan output build menunjukkan chunk three tidak masuk ke halaman di luar produksi: grep `.next` untuk impor `three` hanya pada chunk dinamis.
- [ ] **Step 4: Commit** `feat(produksi-es-balok): mode 3D replika denah (R3F)`

### Task 8: Alat 3D — x-ray, potongan, ukur, aliran, sorot peringatan

**Files:** Create `src/components/produksi-denah/3d/alat-3d.tsx` dan `3d/kamera.ts`. Modify `3d/adegan-3d.tsx`, `3d/elemen-3d.tsx`, `panel-validasi.tsx` (klik peringatan saat mode 3D → `fokusId`).

Perilaku (spec §7 "Alat 3D"):
- Bilah alat di atas viewport:
  - Kamera Isometrik / Atas (ortografis) / Depan / Fokus terpilih.
  - X-ray beton (opasitas 0.15 untuk pelat, dinding, beton, cangkang bak).
  - Potongan: mode Tidak / Horizontal / Vertikal-X / Vertikal-Y + slider posisi, memakai `gl.localClippingEnabled` + `clippingPlanes` pada material.
  - Ukur: dua klik raycast → garis + label jarak 3D, Δhorizontal, Δtinggi dengan `formatMeter`.
  - Aliran on/off: tekstur bergerak/offset UV pada tabung pipa sesuai urutan titik; `frameloop` menjadi "always" hanya saat menyala.
  - Lapisan (pakai `useLapisanTampil`).
- Peringatan teknik: elemen dalam `peringatan` (elemenId + elemenTerkaitIds) diberi outline kuning. Ruang bebas derek merah.
- `kamera.ts` menghitung target/posisi preset dari kotak denah atau kotak elemen: `posisiPreset(preset: "iso" | "atas" | "depan" | "fokus", kotak: { x; y; w; h; zBawah; zAtas }): { posisi: [n, n, n]; target: [n, n, n] }`.
- [ ] **Step 1:** Tes `posisiPreset`: "atas" untuk kotak 60×40 → target di pusat (30, 0, 20), posisi tepat di atas target. "iso" → posisi di +x, +y, +z relatif target. Jalankan, harus FAIL.
- [ ] **Step 2:** Implementasi.
- [ ] **Step 3:** Jalankan tes, tsc, eslint, dan build. Harus PASS.
- [ ] **Step 4: Commit** `feat(produksi-es-balok): alat 3D x-ray, potongan, ukur, aliran`

### Task 9: Verifikasi browser lokal (controller)

- [ ] Jalankan dev server lewat `preview_start`, login sebagai pengguna berizin edit, dan buka `/pmpersada/produksi/denah`.
- [ ] Pastikan denah uji v1 milik pengguna tampil berskala (Bak 13,5×4 m) dengan peringatan "ice can tidak muat". **Jangan simpan ke baris pmpersada** kecuali pengguna setuju. Uji simpan di jalur uji: `simpanDenahUntukKode("zz-uji", …)` via skrip sekali pakai, lalu hapus barisnya.
- [ ] Bangun denah contoh di builder (tanpa simpan):
  - 5 bak dengan 37/37/44/66/66 kolom, derek di atas bak, ruang mesin (2 kompresor, kondensor, panel).
  - Pipa air-baku tertanam z = −0.1 dari tandon ke filling.
  - Kabel daya dari panel ke kompresor.
  - Utara 30°.
- [ ] Periksa 2D: grid & skala batang, mawar angin, alat ukur, panah aliran, garis putus-putus tertanam.
- [ ] Periksa 3D:
  - Semua benda tampil; ±12 rb can tetap lancar.
  - X-ray memperlihatkan pipa di pelat; potongan horizontal di +1,0 m.
  - Ukur tinggi rel derek.
  - Turunkan tinggi rel di panel → kotak ruang bebas merah + peringatan.
- [ ] Penampil `/pmpersada/produksi`: toggle 3D dan klik bak membuka detail.
- [ ] Mode gelap dan lebar mobile: tidak ada overflow horizontal.
- [ ] Ambil screenshot sebagai bukti, laporkan, dan catat temuan ke memory.
