# Produksi Es Balok — Slot Can + Rombak Layar HP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mencatat posisi setiap ice can dalam rek (slot), termasuk Babonan, pecah, dan rusak, lalu merombak layar HP operator menjadi berorientasi tugas dengan strip can berwarna tegas.

**Architecture:** Kolom `slot int[]` di isian dan kolom slot di panen, plus tabel slot rusak, di Postgres pusat. Logika murni slot (keadaan per can, validasi panen per slot, isi air) ada di `src/lib/produksi-operasional.ts`. Transaksi di `src/lib/queries/produksi-operasional.ts` menjadi sadar slot. Layar HP ditulis ulang, sedangkan layar admin memakai komponen grid can yang sama.

**Tech Stack:** Next.js (versi repo — baca `node_modules/next/dist/docs/` sebelum menyentuh routing), React, TypeScript, `pg`, base-ui/shadcn, `node:test` lewat `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-09-produksi-es-balok-slot-can-design.md` (binding). Spec induk: `docs/superpowers/specs/2026-11-09-produksi-es-balok-operasional-design.md`.

## Global Constraints

- Postgres pusat = PRODUKSI. DDL aditif dan idempoten. Backfill tidak menghapus data. Uji integrasi hanya memakai kode `'uji-operasional'` dan membersihkan diri. ERP read-only.
- Invarian slot: setiap isian aktif `array_length(slot) = sisa`. Slot isian aktif dalam satu (kode, kolom) tidak beririsan. Semua slot berada di `1..DenahKolom.jumlahIceCan`. Slot rusak aktif tidak ditempati isian aktif. Isian Babonan: `slot_pecah ⊆ slot`, `pecah = |slot_pecah|`.
- Panen produksi: `slotBabonan`, `slotPecah` ⊆ `isian.slot`, saling lepas. `Σ muatan = |slot| − |slotBabonan| − |slotPecah|`. Panen Babonan: `slotDimuat ⊆ slot \ slot_pecah`, `Σ muatan = |slotDimuat|`.
- Isi Air = semua slot kosong yang tidak rusak (bawaan), atau subset eksplisit.
- Aturan transaksi lama tetap: denah FOR SHARE → advisory lock (kode, kolom) → isian FOR UPDATE → hitung ulang → log INSERT → COMMIT. Jam server. Tidak ada DELETE di modul.
- Susunan tampilan can: BK 12 kolom × 3 baris, BB 9 × 2 (konstanta `SUSUNAN_CAN`).
- Warna tegas: air merah, mulai amber, kristal ungu, siap sky/biru muda, jadi hijau, Babonan oranye ◆, pecah oranye ✕, rusak abu ✕, kosong garis putus. Mode terang dan gelap.
- Pesan commit dalam Bahasa Indonesia, tanpa trailer Co-Authored-By. Hanya stage file sendiri (`.claude/launch.json` dan file untracked lain bukan milik task).
- Verifikasi setiap task: `npx tsc --noEmit` + eslint file yang diubah + tes terkait. Task UI juga menjalankan `npm run build`.

## Review Focus

1. Dua operator memanen atau mengisi rek yang sama bersamaan → tidak ada slot ganda. Tes: Task 3 `slot tidak ganda saat aksi bersamaan`.
2. Isi Air setelah panen dengan Babonan + slot rusak → hanya slot kosong non-rusak yang terisi. Tes: Task 3 `isi ulang melewati babonan dan rusak`.
3. Klien basi mengirim slot yang sudah tidak dimiliki isian → ditolak KEADAAN_BERUBAH. Tes: Task 3 `slot basi ditolak`.
4. Backfill data yang sudah live (isian aktif tanpa slot) → mendapat slot valid tanpa irisan, dan invarian terpenuhi. Tes: Task 2 langkah verifikasi query invarian.
5. Rek BB (18 can) dan rek dengan slot rusak di layar HP → strip dan grid tidak keliru panjang. Tes: Task 1 `keadaan can BB dan rusak`.

---

### Task 1: Logika murni slot

**Files:** Modify `src/lib/produksi-operasional.ts`, Test `src/lib/__tests__/produksi-operasional.test.ts`

**Interfaces — Produces:**
```ts
export const SUSUNAN_CAN: Record<Varian, { kolom: number; baris: number }> = { kecil: { kolom: 12, baris: 3 }, besar: { kolom: 9, baris: 2 } };
// IsianAktif bertambah: slot: number[]; slotPecah: number[]  (slotPecah selalu [] untuk produksi)
export interface SlotRusak { id: string; kolomId: string; slot: number; mulaiAt: string; catatan: string }
export type JenisCan = "kosong" | "produksi" | "babonan" | "pecah" | "rusak";
export interface KeadaanCan { slot: number; jenis: JenisCan; isianId: string | null; pct: number | null; tahap: Tahap | null }
// KeadaanRek bertambah: can: KeadaanCan[]; slotKosong: number[]  (kosong & tidak rusak); rusak: number   — canKosong = slotKosong.length
export function keadaanRek(bak, kolom, isian, mt, sekarang, rusak?: SlotRusak[]): KeadaanRek;           // param rusak opsional
export function keadaanPabrik(denah, isian, mt, sekarang, rusak?: SlotRusak[]): KeadaanRek[];
export interface PanenSlotInput { muatan: MuatanInput[]; slotBabonan: number[]; slotPecah: number[]; slotDimuat?: number[] }
export function validasiPanenSlot(isian: Pick<IsianAktif, "jenis" | "slot" | "slotPecah">, input: PanenSlotInput): string | null;
export function slotDimuatDari(isian: Pick<IsianAktif, "jenis" | "slot">, input: PanenSlotInput): number[];
export function validasiPilihSlot(pilihan: number[], boleh: number[]): string | null; // unik, integer, ⊆ boleh, tidak kosong
export interface RingkasanBak { bakId: string; siap: number; kosong: number; babonan: number; rusak: number }
export function ringkasBak(keadaan: KeadaanRek[]): RingkasanBak[];   // jumlah REK per kategori (siap = ada isian produksi ≥ 75%)
export type JenisTugas = "panen" | "isi-air" | "babonan-lama";
export interface Tugas { jenis: JenisTugas; kolomId: string; bakId: string; nomor: number; pct: number | null; sejak: string }
export function tugasSekarang(keadaan: KeadaanRek[], kosongSejak: Record<string, string>, sekarang: Date): Tugas[]; // urut: panen (FIFO tertua) → isi-air (paling lama kosong) → babonan-lama (> AMBANG.babonanJam)
```
`validasiPanen` lama tetap ada sampai Task 3/4 tidak memakainya, lalu dihapus di Task 4 kalau tidak ada pemanggil.

- [ ] **Step 1: Tes gagal** (tambahkan ke file tes):
  - `keadaan can BK`: kapasitas 36, isian produksi slot 1..34 (12 jam/24 jam), Babonan slot [35,36] dengan slotPecah [36] → `can.length 36`, slot 1 `{jenis:"produksi", pct 50, tahap "kristal"}`, slot 35 `"babonan"`, slot 36 `"pecah"`, `slotKosong []`.
  - `keadaan can BB dan rusak`: kapasitas 18, rusak slot 5, tanpa isian → `can.length 18`, slot 5 `"rusak"`, `slotKosong.length 17`, `canKosong 17`, `rusak 1`.
  - `validasi panen slot produksi`: slot 1..36, babonan [35,36], muatan [20,14] → null. Babonan [37] → bukan null. Babonan dan pecah beririsan → bukan null. Σ 33 → pesan memuat "34".
  - `validasi panen slot babonan`: slot [35,36], slotPecah [36], slotDimuat [35], muatan [1] → null. slotDimuat [36] → bukan null (pecah tidak dimuat).
  - `slotDimuatDari`: produksi 1..36 minus [35,36] → 1..34.
  - `ringkas bak` dan `tugas sekarang`: fixture 3 rek (siap 90%, kosong 7 jam, Babonan 50 jam) → urutan `["panen","isi-air","babonan-lama"]`, chip `siap 1 kosong 1 babonan 1`.
- [ ] **Step 2:** `npx tsx --test src/lib/__tests__/produksi-operasional.test.ts` → FAIL.
- [ ] **Step 3:** Implementasi. `keadaanRek` membangun `can` dari slot isian, Babonan/pecah, rusak, lalu kosong. `utama`/`pct` tetap seperti sekarang. Tes lama harus tetap lulus. Fixture lama yang tidak punya slot diperbarui dengan slot.
- [ ] **Step 4:** Tes PASS, lalu tsc + eslint.
- [ ] **Step 5:** Commit `feat(produksi-es-balok): logika slot can, ringkasan bak, dan tugas sekarang`.

### Task 2: Skema + backfill

**Files:** Modify `scripts/create-produksi-operasional-tables.ts`. Create `scripts/backfill-slot-can.ts`.

- [ ] **Step 1:** DDL idempoten:
  - `produksi_kolom_isi`: `slot int[] NOT NULL DEFAULT '{}'`, `slot_pecah int[] NOT NULL DEFAULT '{}'`
  - `produksi_panen`: `slot_dimuat`, `slot_babonan`, `slot_pecah int[] NOT NULL DEFAULT '{}'`
  - tabel `produksi_slot_rusak` sesuai spec §1, dengan partial unique `(perusahaan_kode, kolom_id, slot) WHERE selesai_at IS NULL` dan CHECK `slot >= 1`
  - Jalankan dua kali (idempoten).
- [ ] **Step 2:** `backfill-slot-can.ts`:
  - Dry-run bawaan, `--tulis` untuk menulis.
  - Untuk setiap (kode, kolom) yang punya isian aktif dengan `cardinality(slot) = 0`: isian produksi diurutkan `mulai_at` naik dan mengambil slot terendah berurutan sebanyak `sisa`. Babonan mengambil slot tertinggi sebanyak `sisa`, dan `slot_pecah` = `pecah` slot teratasnya.
  - Ditulis dalam satu transaksi per kolom dengan advisory lock yang sama seperti Task 3 di modul query. Hash lock harus identik: impor helper dari modul query kalau bisa, kalau tidak salin rumus persis dan beri komentar.
  - Validasi kapasitas dari denah. Kalau jumlah melebihi kapasitas, laporkan dan lewati kolom itu.
- [ ] **Step 3:** Jalankan dry-run, lalu `--tulis` (data live saat ini hanya data uji Bak 1 Rek 1 PMPersada; menulis slot tidak menghapus apa pun). Verifikasi dengan query: tidak ada isian aktif dengan `cardinality(slot) <> sisa`, dan tidak ada slot ganda per kolom.
- [ ] **Step 4:** Commit `feat(produksi-es-balok): skema slot can dan backfill`.

### Task 3: Transaksi sadar slot

**Files:** Modify `src/lib/queries/produksi-operasional.ts`, `src/lib/queries/produksi-denah.ts` (kunci kolom: tambah slot rusak aktif ke `SQL_KOLOM_TERKUNCI`), `scripts/uji-produksi-operasional.ts`.

**Interfaces — Produces (perubahan signature):**
```ts
export function isiAir(kode, kolomId, slot: number[] | null, p: Pelaku): Promise<{ isianId: string }>;    // null = semua slot kosong non-rusak
export interface PanenInputSlot extends PanenSlotInput { isianId: string; isiUlang: boolean; konfirmasiBelumSiap: boolean }
export function panen(kode, input: PanenInputSlot, p: Pelaku): Promise<{ panenId: string; isianBaruId: string | null }>;
export function tandaiBabonan(kode, isianId, slot: number[], p): Promise<void>;
export function buangBabonan(kode, kolomId, slot: number[], alasan: string, p): Promise<void>;
export function tandaiRusak(kode, kolomId, slot: number[], catatan: string, p): Promise<void>;
export function perbaikiRusak(kode, kolomId, slot: number[], p): Promise<void>;
export function koreksiIsian(kode, isianId, ubah: { mulaiAt?: string; varian?: Varian; slot?: number[] }, alasan, p): Promise<void>; // sisa = |slot|
// getDataPabrik → DataPabrik bertambah rusak: SlotRusak[]; IsianAktif berisi slot/slotPecah
```
Setiap tulis memvalidasi invarian slot dari Global Constraints di server, terhadap baris yang sudah dikunci. Slot dari klien yang tidak lagi cocok → `KEADAAN_BERUBAH`. `batalkanPanen` mengembalikan slot persis (slot_dimuat ke isian asal kalau slot itu masih kosong; kalau tidak, hanya ditandai). `koreksiMuatan` tidak berubah. Panen menulis `slot_dimuat/slot_babonan/slot_pecah`. Log menyimpan slot di `sebelum/sesudah`.

- [ ] **Step 1:** Perbarui uji integrasi ke API slot, dan tambahkan:
  - `isi ulang melewati babonan dan rusak`: rusak slot 3, isi air → slot 1,2,4..36 (35 can). Panen dengan Babonan [35,36] → isian baru = slot dimuat (tanpa 3, 35, 36).
  - `slot tidak ganda saat aksi bersamaan`: dua `isiAir` bersamaan pada rek kosong → satu sukses, satu `KEADAAN_BERUBAH`/`VALIDASI`, dan tidak ada slot ganda.
  - `slot basi ditolak`: panen dengan `slotBabonan` berisi slot milik isian lain → `KEADAAN_BERUBAH`.
  - `tandai rusak pada slot berisi ditolak`, `perbaiki rusak`, `batal panen mengembalikan slot`, `slot rusak mengunci kolom denah`.
  - Invarian global di akhir: query `cardinality(slot) = sisa` dan tidak ada slot ganda.
- [ ] **Step 2:** `npx tsx --test scripts/uji-produksi-operasional.ts` → FAIL.
- [ ] **Step 3:** Implementasi.
- [ ] **Step 4:** PASS (cleanup 0 baris), lalu tsc + eslint + tes unit.
- [ ] **Step 5:** Commit `feat(produksi-es-balok): transaksi aksi sadar slot can dan can rusak`.

### Task 4: Server actions

**Files:** Modify `src/app/produksi-operasional-actions.ts`, `src/lib/__tests__/produksi-operasional-akses.test.ts`.

- [ ] Sesuaikan action ke signature Task 3: `isiAirAction(kode, kolomId, slot: number[] | null)`, `panenAction(kode, input: PanenInputSlot)`, `tandaiBabonanAction(kode, isianId, slot)`, `buangBabonanAction(kode, kolomId, slot, alasan)`, `koreksiIsianAction(kode, isianId, ubah{mulaiAt?,varian?,slot?}, alasan)`.
- [ ] Tambahkan action baru `tandaiRusakAction(kode, kolomId, slot, catatan)` dan `perbaikiRusakAction(kode, kolomId, slot)` dengan gerbang "aksi".
- [ ] Validasi bentuk: array integer 1..200, unik, panjang ≤ 200.
- [ ] `getKeadaanAction` mengembalikan `ringkasBak` dan `tugas`, serta meneruskan `rusak` ke `keadaanPabrik`.
- [ ] Pin gerbang action baru di tes akses. Hapus `validasiPanen` lama kalau tidak ada pemanggil.
- [ ] Jalankan tes akses + use-server-exports + tsc + eslint.
- [ ] Commit `feat(produksi-es-balok): server action slot can`.

### Task 5: Komponen grid can + layar HP baru

**Files:**
- Modify `src/components/produksi-operasional/warna-tahap.ts` (palet tegas + `WARNA_CAN: Record<JenisCan | Tahap, …>`)
- Create `src/components/produksi-operasional/grid-can.tsx` (props `{ can: KeadaanCan[]; varian: Varian; mode: "lihat" | "panen" | "pilih"; pilihan?: …; onUbah?: … }`; mode panen bersiklus biasa → Babonan → Pecah → biasa; mode pilih = toggle; slot yang tidak boleh dipilih dinonaktifkan)
- Create `src/components/produksi-operasional/strip-can.tsx` (strip satu baris, ringan, untuk daftar rek)
- Rewrite `src/components/produksi-operasional/app/*`:
  - `produksi-app.tsx`: shell, header, tab bak lebar sama, chip ringkasan bak
  - `daftar-tugas.tsx` (baru): Tugas sekarang dengan tombol Panen / Isi Air (1 ketukan) / buka rek
  - `daftar-rek.tsx` (baru, menggantikan `grid-rek.tsx`): baris rek dengan strip can
  - `lembar-aksi-rek.tsx`: grid can + aksi termasuk Tandai rusak/Perbaiki, Tandai/Buang Babonan dengan grid pilih
  - `form-panen.tsx`: grid can mode panen + daftar kendaraan seperti sekarang
  - Hapus file yang tidak terpakai.

Pertahankan perilaku yang sudah lolos uji: kendaraan aktif, dialog BELUM_SIAP, kunci saat request, refresh 30 dtk + setelah aksi, galat jaringan/ERP, bottom nav tidak fixed, Riwayat saya.

- [ ] Implementasi, lalu tsc + eslint + `npm run build`.
- [ ] Commit `feat(produksi-es-balok): layar HP berorientasi tugas dengan grid dan strip can`.

### Task 6: Admin memakai grid can

**Files:** Modify `src/components/produksi-operasional/admin/detail-rek.tsx`, `dialog-koreksi.tsx` (koreksi sisa → grid pilih slot), dan pemakai lain yang memanggil `isiAirAction`/`panenAction`/`tandaiBabonanAction`/`buangBabonanAction`/`koreksiIsianAction` dengan signature lama (cari dengan grep).

- [ ] `DetailRek` menampilkan `GridCan` mode lihat. Aksi admin memakai komponen lembar dari Task 5. Koreksi slot memakai grid pilih.
- [ ] tsc + eslint + `npm run build`. Grep untuk memastikan tidak ada pemanggil signature lama.
- [ ] Commit `feat(produksi-es-balok): detail rek admin memakai grid can`.
