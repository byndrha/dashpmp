# Kode Posisi + Orientasi Can + Layar HP Satu Baris — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tahap 1 dari spec identitas/orientasi can. Cakupannya:
- orientasi can per rek di denah (2D/3D ikut);
- kode posisi `3-52-14`;
- layar HP dan admin yang menggambar rek sebagai **satu baris can**, dengan dukungan bak campuran BK/BB.

**Architecture:**
- Bidang opsional baru di dokumen denah (`orientasiCan`, `orientasiCanBawaan`, `kodeBak`), diisi bawaannya saat baca. `skemaVersi` tetap 2.
- `tataBakMeter` menjadi satu-satunya tempat yang menerjemahkan orientasi ke geometri.
- Logika murni operasional membawa `kodeBak` dan `orientasiCan` ke `KeadaanRek`.
- Komponen `BarisCan` menggantikan grid 12×3 / 9×2.

**Tech Stack:** Next.js (versi breaking-change; baca `node_modules/next/dist/docs/` sebelum menulis kode Next), React, TypeScript, Tailwind/shadcn (base-ui), `node:test` via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-10-produksi-es-balok-identitas-orientasi-can-design.md` (Tahap 1, §1.1–1.6)

## Global Constraints
- Kode posisi: `kodeBak-nomorRek-slot` dengan tanda hubung, mis. `3-52-14`. Bentuk pendek `52-14`. Varian sebagai label: `3-52-14 · BB`.
- `orientasiCan` ∈ `"mendatar" | "tegak"`. **Bawaan `"mendatar"`**, sehingga denah lama tergambar persis sama.
  - Mendatar: lebar lajur = `lebarMm`, langkah = `panjangMm`.
  - Tegak: keduanya ditukar.
- `kodeBak`: 1–3 karakter `[0-9A-Za-z]`, tanpa "-", unik per denah.
  - Bila kosong, diambil dari angka pertama di `nama`; bila nama tanpa angka, dari urutan bak di dokumen (1-based).
- Posisi 1 = can pertama dari `b0` (urutan gambar sekarang). Nomor slot data **tidak berubah** dan tidak perlu remap.
- Baris can di HP dipatah **tiap 18 posisi**, dengan label rentang ("1–18", "19–36").
- Orientasi dan `kodeBak` boleh diubah walau rek berisi es. `kolomTerkunciBerubah` tidak diubah.
- `skemaVersi` **tetap 2**.
- Semua teks UI dalam Bahasa Indonesia. Commit message dalam Bahasa Indonesia, tanpa trailer Co-Authored-By.
- Uji: `npx tsx --test src/lib/__tests__/<berkas>.test.ts`.

## Review Focus
- **Bak bernama tanpa angka atau dengan angka ganda** ("Bak Utama", dua bak "Bak 3A"/"Bak 3B"): `kodeBak` efektif harus deterministik, dan simpan ditolak dengan pesan yang menyebut kedua bak. Diuji di Task 1.
- **Denah lama tanpa bidang baru**: dibaca → semua kolom `mendatar`, dan geometri identik dengan sebelumnya (`tataBakMeter` lama vs baru sama persis). Diuji di Task 1 dan Task 2.
- **Rek BK 36 di HP ±330 px**: dua baris 18 dengan label rentang, bukan satu baris 36 sel kecil. Diuji di Task 4 (helper patah baris) dan diverifikasi di browser (Task 6).
- **Bak yang hanya punya satu varian**: filter Semua/BK/BB disembunyikan, dan ringkasan tidak menampilkan baris varian yang kosong. Diuji di Task 3 (ringkasBak) dan diverifikasi di browser (Task 6).
- **localStorage diblokir** (mode privat): filter tetap berfungsi dengan bawaan "Semua", tanpa galat. Penanganan try/catch di Task 5, diperiksa reviewer.

---

### Task 1: Data denah — orientasi, kodeBak, validasi

**Files:**
- Modify: `src/lib/produksi-denah.ts`:
  - `DenahKolom` (±23) dan `BakElemen` (±68);
  - `buatKolom` (±326) dan pembuatan bak (±345–375);
  - `validasiDenah` (±458);
  - `lengkapiElemen` (±824).
- Test: `src/lib/__tests__/produksi-denah.test.ts`

**Interfaces:**
- Produces:
  - `export type OrientasiCan = "mendatar" | "tegak"`
  - `DenahKolom.orientasiCan?: OrientasiCan`
  - `BakElemen.orientasiCanBawaan?: OrientasiCan`
  - `BakElemen.kodeBak?: string`
  - `export function kodeBakEfektif(bak: BakElemen, indeksBak: number): string`, dengan `indeksBak` 0-based di antara elemen bak dokumen.
  - `export function orientasiKolom(k: DenahKolom): OrientasiCan`, mengembalikan `k.orientasiCan ?? "mendatar"`.

- [ ] **Step 1: Tulis uji yang gagal**

  `kodeBakEfektif`:
  - `{nama:"Bak 3"}`, indeks 0 → `"3"`
  - `{nama:"Bak Utama"}`, indeks 4 → `"5"`
  - `{nama:"Bak 3", kodeBak:"A1"}` → `"A1"`
  - `{nama:"B12 baru"}` → `"12"`

  `migrasiDenah` pada dokumen v2 tanpa bidang baru → setiap kolom `orientasiCan === "mendatar"`.

  `validasiDenah`:
  - dua bak "Bak 3A" dan "Bak 3B" → galat berisi `"kode bak"` dan kedua nama;
  - `kodeBak: "3-1"` → galat `"kode bak tidak sah"`;
  - `kodeBak: "ABCD"` → galat yang sama;
  - dua kolom ber-`nomor` 5 dalam satu bak → galat berisi `"nomor rek ganda"`;
  - `orientasiCan: "miring"` → galat `"orientasi can tidak sah"`.

  `buatBak` dengan `orientasiCanBawaan: "tegak"` → kolom barunya `tegak`.

- [ ] **Step 2: Jalankan uji untuk memastikan gagal**

  Run: `npx tsx --test src/lib/__tests__/produksi-denah.test.ts`
  Expected: FAIL (`kodeBakEfektif` tidak ada / asersi gagal)

- [ ] **Step 3: Implementasi**
  - Tambah tipe dan bidang.
  - `buatKolom` menerima `bawaan.orientasiCan?` dan menyalinnya. Pembuatan bak dan aksi tambah kolom (`ubahJumlahKolom`, `terapkanBawaan`) memakai `bak.orientasiCanBawaan`.
  - `lengkapiElemen`, cabang `bak`: isi `orientasiCan` per kolom bila tidak ada. Ini kode baru; fungsi tersebut belum pernah mengisi bidang tingkat kolom.
  - `validasiDenah`:
    - validasi format `kodeBak` bila diisi;
    - keunikan `kodeBakEfektif` antar-bak;
    - keunikan `nomor` per bak;
    - nilai `orientasiCan` dan `orientasiCanBawaan`.

  Cek dulu galat yang ada di produksi: denah PMPersada ("Bak 1"–"Bak 5", tanpa nomor ganda) **harus tetap lolos**.

- [ ] **Step 4: Jalankan uji sampai lolos**

  Run: `npx tsx --test src/lib/__tests__/produksi-denah.test.ts src/lib/__tests__/produksi-denah-builder.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/produksi-denah.ts src/lib/__tests__/produksi-denah.test.ts src/components/produksi-denah/builder-state.ts
  git commit -m "feat(produksi-denah): orientasi can per rek dan kode bak"
  ```

### Task 2: Geometri per orientasi

**Files:**
- Modify: `src/lib/produksi-denah-geometri.ts` (`tataBakMeter`, ±53–100)
- Test: `src/lib/__tests__/produksi-denah-geometri.test.ts`, `src/lib/__tests__/produksi-denah-3d.test.ts`

**Interfaces:**
- Consumes: `orientasiKolom` (Task 1)
- Produces: `TataKolom` bertambah `orientasi: OrientasiCan`. `lebar` dan `panjangCan` sudah mengikuti orientasi. Semua pemakai (2D `denah-kanvas.tsx`, 3D `koordinat.ts`/`elemen-3d.tsx`, `produksi-denah-teknik.ts`) tidak perlu diubah.

- [ ] **Step 1: Tulis uji yang gagal**

  Bak dengan 2 kolom kecil (can 120×360):
  - kolom A mendatar → `lebar === 0.36`, `panjangCan === 0.12`;
  - kolom B tegak → `lebar === 0.12`, `panjangCan === 0.36`;
  - `kolom[1].a0 === kolom[0].a0 + 0.36 + jarakKolom`;
  - `butuhB` = maks dari `jumlah × (panjangCan + jarakCan)` per kolom.

  Uji regresi: dokumen tanpa `orientasiCan` menghasilkan `tataBakMeter` yang `deepEqual` dengan nilai yang dibekukan dari fungsi saat ini (kecuali bidang baru `orientasi`).

  3D: `iceCanBak` untuk kolom tegak menghasilkan `ukuran[0]`/`ukuran[2]` tertukar dibanding mendatar.

- [ ] **Step 2: Jalankan uji untuk memastikan gagal**

  Run: `npx tsx --test src/lib/__tests__/produksi-denah-geometri.test.ts src/lib/__tests__/produksi-denah-3d.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementasi di `tataBakMeter`**

  Ambil `dim = bak.iceCan[k.varian]`. Bila `orientasiKolom(k) === "tegak"`:
  - `lebar = dim.panjangMm/1000`
  - `panjangCan = dim.lebarMm/1000`

  Selain itu, tetap seperti sekarang.

- [ ] **Step 4: Jalankan semua uji denah**

  Run: `npx tsx --test src/lib/__tests__/produksi-denah-geometri.test.ts src/lib/__tests__/produksi-denah-3d.test.ts src/lib/__tests__/produksi-denah-teknik.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit** dengan pesan `feat(produksi-denah): geometri rek mengikuti orientasi can`

### Task 3: Logika murni operasional — kode posisi, varian, buang SUSUNAN_CAN

**Files:**
- Modify: `src/lib/produksi-operasional.ts`:
  - hapus `SUSUNAN_CAN` (±47–51);
  - `KeadaanRek` (±82), `keadaanRek` (±178), `keadaanPabrik` (±295);
  - `RingkasanBak`/`ringkasBak` (±321–355), `Tugas`/`tugasSekarang` (±359–397).
- Modify: `src/app/produksi-operasional-actions.ts:346-380`, menyesuaikan tipe saja bila perlu.
- Test: `src/lib/__tests__/produksi-operasional.test.ts` (hapus uji `SUSUNAN_CAN` ±412–413)

**Interfaces:**
- Consumes: `kodeBakEfektif`, `orientasiKolom` (Task 1)
- Produces:
  - `KeadaanRek.kodeBak: string`, `KeadaanRek.orientasiCan: OrientasiCan`.
  - `export function kodePosisi(kodeBak: string, nomorRek: number, slot: number): string` → `"3-52-14"`.
  - `export function kodePosisiPendek(nomorRek: number, slot: number): string` → `"52-14"`.
  - `export function kodeRek(kodeBak: string, nomorRek: number): string` → `"3-52"`.
  - `export const PATAH_BARIS_CAN = 18`.
  - `export function patahBaris(kapasitas: number, per?: number): { dari: number; sampai: number }[]`. Contoh: 36 → `[{1,18},{19,36}]`, 18 → `[{1,18}]`, 20 → `[{1,18},{19,20}]`.
  - `RingkasanBak` menjadi `{ bakId: string; varian: Varian; rek: number; siap: number; kosong: number; babonan: number; rusak: number }`. Satu entri per (bak, varian) yang **punya rek aktif**, urut bak lalu `kecil`, `besar`.
  - `Tugas.varian: Varian`.

- [ ] **Step 1: Tulis uji yang gagal**
  - `kodePosisi("3",52,14) === "3-52-14"`, `kodePosisiPendek(52,14) === "52-14"`, `kodeRek("3",52) === "3-52"`.
  - Nilai `patahBaris` seperti di atas.
  - `keadaanPabrik` untuk bak "Bak 3" → setiap rek `kodeBak === "3"`, dan `orientasiCan` mengikuti kolom.
  - `ringkasBak` pada bak berisi 2 rek kecil + 1 rek besar → dua entri (`kecil` rek 2, `besar` rek 1). Bak yang hanya berisi rek kecil → satu entri.
  - `tugasSekarang` → `varian` terisi.

- [ ] **Step 2: Jalankan uji untuk memastikan gagal**

  Run: `npx tsx --test src/lib/__tests__/produksi-operasional.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementasi**

  `keadaanPabrik` menghitung `kodeBakEfektif(bak, i)` sekali per bak dan meneruskannya ke `keadaanRek`. Tambahkan parameter `kodeBak: string` dengan bawaan `"?"` agar pemanggil lama tetap jalan.

- [ ] **Step 4: Jalankan uji + typecheck**

  Run: `npx tsx --test src/lib/__tests__/produksi-operasional.test.ts && npx tsc --noEmit -p .`
  Expected: PASS. Galat tsc yang tersisa hanya di komponen yang masih mengimpor `SUSUNAN_CAN` atau membaca `RingkasanBak` lama. Itu diperbaiki di Task 4/5, tapi **jangan commit** dalam keadaan tsc merah: Task 3 dan Task 4 digabung dalam satu commit bila perlu.

- [ ] **Step 5: Commit** dengan pesan `feat(produksi-es-balok): kode posisi dan ringkasan bak per varian` (bersama Task 4 bila tsc masih merah)

### Task 4: Komponen BarisCan menggantikan GridCan

**Files:**
- Modify: `src/components/produksi-operasional/grid-can.tsx`. Ubah menjadi baris can; nama ekspor `GridCan` boleh dipertahankan.
- Modify pemakai:
  - `app/lembar-aksi-rek.tsx:329,495`
  - `app/form-panen.tsx:200,210`
  - `admin/dialog-koreksi.tsx:156`
  - `admin/detail-rek.tsx`

**Interfaces:**
- Consumes: `patahBaris`, `kodePosisi`, `KeadaanRek.kodeBak/orientasiCan` (Task 3)
- Produces:
  - Props `GridCan` mengganti `varian: Varian` dengan `rek: Pick<KeadaanRek, "kodeBak" | "nomor" | "orientasiCan">`.
  - Mode `lihat`/`pilih`/`panen` dan perilaku ketuknya **tidak berubah**.

- [ ] **Step 1: Implementasi**
  - Render `patahBaris(can.length)` sebagai baris-baris horizontal. Setiap baris diawali label `dari–sampai`. Baris kedua dan seterusnya diberi penanda "lanjut" (mis. `↳`).
  - Sel can memakai lebar `flex-1` dengan tinggi tetap. Bentuk sel boleh mencerminkan orientasi; ini diserahkan ke pembuat.
  - Keterangan ketuk (mode lihat) dan teks keterangan di mode pilih/panen diawali `kodePosisi(rek.kodeBak, rek.nomor, slot)`, mis. `3-52-14 · Babonan 92%`.

- [ ] **Step 2: Typecheck dan uji**

  Run: `npx tsc --noEmit -p . && npx tsx --test src/lib/__tests__/produksi-operasional.test.ts`
  Expected: PASS

- [ ] **Step 3: Commit** dengan pesan `feat(produksi-es-balok): rek digambar sebagai satu baris can`

### Task 5: Layar HP — bak campuran, filter, strip proporsional, label

**Files:**
- Modify:
  - `src/components/produksi-operasional/app/produksi-app.tsx` (`ChipRingkasan` ±441, `ringkasan`/`tugasBak` ±256–264)
  - `app/daftar-rek.tsx` (`BarisRek`)
  - `app/daftar-tugas.tsx`
  - `app/lembar-aksi-rek.tsx` (header ±116–149)
  - `app/form-panen.tsx:193`
  - `app/riwayat-saya.tsx:99`
  - `strip-can.tsx`

**Interfaces:**
- Consumes: `RingkasanBak` per varian, `Tugas.varian`, `KeadaanRek.orientasiCan/kodeBak`, `kodeRek` (Task 3)

- [ ] **Step 1: Implementasi**
  - **Ringkasan:** satu baris chip per entri `RingkasanBak` bak aktif, diawali `BK 30 rek` / `BB 7 rek`.
  - **Filter:** `Semua | BK | BB`, tampil hanya bila bak aktif punya ≥ 2 entri. Menyaring "Tugas sekarang" (via `Tugas.varian`) dan "Semua rek". Disimpan di localStorage kunci `produksi-app:filter-varian:<kode>`, dibaca dan ditulis dalam try/catch, bawaan `"semua"`.
  - **Strip:** `StripCan` menerima `skala?: number` (0–1) → `style={{ width: skala*100 + "%" }}`. `BarisRek` memberi `rek.kapasitas / kapasitasMaksBak`.
  - **BarisRek:** tampilkan `singkatVarian` + ikon orientasi (▭ mendatar, ▯ tegak).
  - **Header lembar rek:** `Rek 52 · BB · mendatar ▭ · 18 can`.
  - **Form panen** dan **riwayat operator:** lokasi memakai `kodeRek` (`3-52`) di samping nama bak.
  - **Log audit admin** tidak menampilkan array slot (diperiksa: `tab-log-audit.tsx` hanya menampilkan lokasi). Butir spec §1.4 "log audit menerjemahkan slot" tidak berlaku, dan cukup lokasi `kodeRek`, lihat Task 6.

- [ ] **Step 2: Typecheck + lint**

  Run: `npx tsc --noEmit -p . && npx eslint src/components/produksi-operasional`
  Expected: tanpa galat

- [ ] **Step 3: Commit** dengan pesan `feat(produksi-es-balok): layar HP untuk bak campuran BK/BB`

### Task 6: Builder denah + admin — kontrol orientasi, kodeBak, label

**Files:**
- Modify:
  - `src/components/produksi-denah/panel-kolom.tsx` (±110–120)
  - `src/components/produksi-denah/panel-properti.tsx` (bagian bak ±273–420)
  - `src/components/produksi-denah/denah-penampil.tsx:183`
  - `src/components/produksi-denah/denah-kanvas.tsx` (gambar can ±1083)
- Modify admin:
  - `admin/tabel-fifo.tsx:57`
  - `admin/tab-operasional.tsx:127`
  - `admin/detail-rek.tsx:145`
  - `admin/tab-log-audit.tsx:249`

**Interfaces:**
- Consumes: `OrientasiCan`, `kodeBakEfektif` (Task 1); `kodeRek` (Task 3); aksi reducer `ubahKolom` dan `ubahElemen` yang sudah ada.

- [ ] **Step 1: Implementasi**
  - **Panel kolom:** `Segmen` "Orientasi can" Mendatar ▭ / Tegak ▯ untuk kolom terpilih (bisa banyak), memakai pola `sama(pilih, k => orientasiKolom(k))` + `ubah({ orientasiCan })`.
  - **Panel properti bak:**
    - `Segmen` "Orientasi can bawaan";
    - `InputTeks` "Kode bak" (placeholder = `kodeBakEfektif`), dengan pratinjau `3-1-1`.
  - **Penampil:** ringkasan bak menambahkan "· mendatar N / tegak M".
  - **Kanvas:** angka "1" kecil di ujung `b0` setiap kolom, hanya saat skala cukup besar (ambang diserahkan ke pembuat, pakai pola `fsNomor`).
  - **Label admin:** `"<nama bak> – Rek <n>"` menjadi `"<nama bak> – Rek <n> (<kodeRek>)"`.

  `tab-log-audit` hanya punya `bakNama`/`kolomNomor`. Tampilkan kodeRek hanya bila kode bak tersedia dari denah yang sudah dimuat tab itu. Bila tidak tersedia, biarkan seperti sekarang.

- [ ] **Step 2: Typecheck + lint + semua uji**

  Run: `npx tsc --noEmit -p . && npx eslint src/components/produksi-denah src/components/produksi-operasional && npx tsx --test src/lib/__tests__/produksi-*.test.ts`
  Expected: PASS

- [ ] **Step 3: Verifikasi browser** (preview `dev`)
  - **Builder `/pmpersada/produksi/denah`:**
    - ubah satu kolom Bak 4 menjadi tegak → lajur menyempit di 2D dan 3D;
    - Validasi tetap bersih;
    - **jangan simpan** (denah produksi).
  - **`/pmpersada/produksi-app`** sebagai operator:
    - Bak 4 menampilkan dua baris ringkasan BK/BB dan filter;
    - Bak 1 tanpa filter;
    - strip BB lebih pendek;
    - lembar rek BK menampilkan baris "1–18" dan "19–36";
    - ketuk can → `1-1-14 · …`.
  - Ambil screenshot.

- [ ] **Step 4: Commit** dengan pesan `feat(produksi-denah): kontrol orientasi can dan kode bak di builder`

### Task 7: Verifikasi akhir

- [ ] **Step 1:** `npm run build`. Expected: build lolos.
- [ ] **Step 2:** `npx tsx --test src/lib/__tests__/*.test.ts`. Expected: semua PASS.
- [ ] **Step 3:** Perbarui memori `es-balok-produksi-knowledge.md`: tahap 1 can selesai, berikut ringkasan perubahannya.
