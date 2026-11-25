# Produksi Es Balok — Builder Denah Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modul Produksi PMPersada & PMPakis dengan denah kosong bawaan, penampil denah, dan builder denah visual ala game yang menyimpan ke Postgres serta menolak perubahan pada kolom berisi es.

**Architecture:** Satu dokumen JSON denah per perusahaan di Postgres (`produksi_denah`, versi optimistik). Logika murni (tipe, generator, validasi, deteksi kolom terkunci) di `src/lib/produksi-denah.ts`. Kanvas SVG sendiri dipakai bersama oleh penampil (read-only) dan builder (edit).

**Tech Stack:** Next.js 16 App Router + Server Actions, React 19, Postgres (`getPgPool`), Tailwind 4 + komponen `src/components/ui`, lucide-react, sonner, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-25-produksi-es-balok-builder-denah-design.md`

## Global Constraints
- Semua teks UI Bahasa Indonesia. Commit Bahasa Indonesia (subjek+isi), tanpa Co-Authored-By. Kerjakan di `main`; `git add` hanya file sendiri (banyak file pengguna belum di-commit).
- **File `"use server"` hanya boleh mengekspor fungsi async — tidak ada `export type {…}` / `export {…}` ulang** (insiden 2026-10-24; dijaga tes `src/lib/__tests__/use-server-exports.test.ts`). Tipe diimpor langsung dari modul aslinya.
- Komponen client tidak boleh mengimpor nilai dari modul yang menarik `pg`/`mssql`; logika bersama ada di `src/lib/produksi-denah.ts` tanpa impor server.
- Izin edit: `bolehEditDenah(user) = user.isSuperAdmin || user.accountScope === "direktur" || !!user.permissions?.produksi?.canEdit`, ditegakkan di setiap action tulis.
- `perusahaanKode` selalu ditentukan server dari rute (konstanta per halaman/action), tidak pernah dari input client.
- Tanpa dependensi npm baru.
- Baca panduan di `node_modules/next/dist/docs/` sebelum menulis kode Next.js.
- Verifikasi tiap task: `npx tsc --noEmit`, `npx eslint <file berubah>` tanpa galat baru, `npx tsx --test src/lib/__tests__/*.test.ts`. Task UI juga `npx next build`.

## Review Focus
1. Kolom berisi es yang dihapus lewat pengurangan jumlah kolom di panel properti harus ditolak saat simpan, dengan nama bak + nomor kolom di pesan. → tes `kolomTerkunciBerubah` (Task 1).
2. Dua pengguna membuka builder bersamaan; yang menyimpan kedua harus ditolak ("denah sudah diubah orang lain"), bukan menimpa. → tes query/aksi Task 1 (skrip uji) + pesan UI Task 3.
3. Mengurangi lalu menambah lagi jumlah kolom tidak boleh membuat ID kolom lama berubah untuk kolom yang tetap ada. → tes `ubahJumlahKolom` (Task 1).
4. Denah besar (≥10 bak × 66 kolom × 36 ice can) tetap lancar saat drag/zoom. → ice can hanya digambar bila zoom cukup dekat; verifikasi manual Task 3.
5. Pengguna tanpa izin edit yang membuka `/…/produksi/denah` langsung atau memanggil action simpan harus ditolak di server. → Task 2/3.

---

### Task 1: Skema, logika murni, query, action

**Files:**
- Create: `scripts/create-produksi-denah-tables.ts`, `src/lib/produksi-denah.ts`, `src/lib/__tests__/produksi-denah.test.ts`, `src/lib/queries/produksi-denah.ts`, `src/app/produksi-denah-actions.ts` (atau lokasi setara di bawah `src/app`)
- Modify: `src/lib/permissions.ts` (tambah `bolehEditDenah`)

**Interfaces — Produces:**
```ts
// src/lib/produksi-denah.ts (client-safe) — tipe & fungsi persis spec §Model data
export type Varian = "kecil" | "besar";
export interface DenahKolom { id: string; nomor: number; varian: Varian; jumlahIceCan: number; ukuranIceCan?: string; catatan?: string; nonaktif?: boolean }
export type DenahElemen = BakElemen | MesinElemen | DerekElemen | DindingElemen | PintuElemen | AreaElemen | LabelElemen; // semua punya id, nama, x, y, w, h, rotasi, terkunci?
export interface DenahDokumen { skemaVersi: 1; kanvas: { lebar: number; tinggi: number; ukuranGrid: number }; elemen: DenahElemen[] }
export function denahKosong(): DenahDokumen;
export function buatBak(x: number, y: number, opsi?: Partial<BakElemen>): BakElemen;
export function buatKolom(jumlah: number, bawaan: { varian: Varian; jumlahIceCan: number }, mulaiNomor?: number): DenahKolom[];
export function ubahJumlahKolom(bak: BakElemen, n: number): BakElemen;
export interface GalatDenah { elemenId?: string; kolomId?: string; pesan: string }
export function validasiDenah(dok: DenahDokumen): GalatDenah[];
export function kolomTerkunciBerubah(lama: DenahDokumen | null, baru: DenahDokumen, kolomIsiIds: Set<string>): GalatDenah[];
export function ringkasDenah(dok: DenahDokumen): { jumlahBak: number; jumlahKolom: number; iceCanKecil: number; iceCanBesar: number; jumlahMesin: number };

// src/lib/permissions.ts
export function bolehEditDenah(user: { isSuperAdmin: boolean; accountScope?: string | null; permissions?: PermissionMap }): boolean;

// src/lib/queries/produksi-denah.ts (server)
export type KodeProduksi = "pmpersada" | "pmpakis";
export async function getDenah(kode: KodeProduksi): Promise<{ versi: number; data: DenahDokumen; updatedAt: string; updatedBy: string | null } | null>;
export async function getKolomIsiIds(kode: KodeProduksi): Promise<Set<string>>;
export async function simpanDenah(kode: KodeProduksi, data: DenahDokumen, versiDasar: number | null, userId: string): Promise<{ versi: number }>;
// simpanDenah dalam satu transaksi: SELECT … FOR UPDATE; versi saat ini ≠ versiDasar → AppError("Denah sudah diubah orang lain sejak Anda membuka builder. Muat ulang untuk melihat versi terbaru."); jalankan validasiDenah + kolomTerkunciBerubah(lama, data, kolomIsi) → AppError berisi daftar pelanggaran; INSERT/UPDATE versi+1.

// server actions (file "use server", hanya fungsi async)
export async function simpanDenahAction(kode: KodeProduksi, data: DenahDokumen, versiDasar: number | null): Promise<ActionResult<{ versi: number }>>;
// cek sesi; cek scope sesuai kode (pmpersada: accountScope pmpersada atau canAccessGrup; idem pmpakis); cek bolehEditDenah; panggil simpanDenah.
```

- [ ] **Step 1: Tes gagal** untuk: `buatKolom` (nomor berurutan, ID unik); `ubahJumlahKolom` (36→30 membuang 6 kolom terakhir, 30→36 menambah 6 baru, ID 30 pertama tetap); `validasiDenah` (nama bak kosong, nama ganda, bak bertumpuk, keluar kanvas, mesinIds menunjuk elemen tak ada, jumlah ≤0, durasi ≤0, denah valid → []); `kolomTerkunciBerubah` (kolom berisi es dihapus → galat menyebut nama bak & nomor; bak induk dihapus → galat; varian/jumlahIceCan/ukuran/nonaktif berubah → galat; pindah posisi bak/ganti nama/nomori ulang → tidak galat; kolom tanpa es dihapus → tidak galat; `lama` null → []); `ringkasDenah`. Jalankan → FAIL.
- [ ] **Step 2: Implementasi** `src/lib/produksi-denah.ts` (ID via `crypto.randomUUID()`). Tes → PASS.
- [ ] **Step 3: Skrip DDL idempoten** (`CREATE TABLE IF NOT EXISTS`, index parsial). Jalankan 2×.
- [ ] **Step 4: Query + action + `bolehEditDenah`** (+ tes untuk `bolehEditDenah`). `getDenah`/`simpanDenah` publik bertipe `KodeProduksi`, tetapi memanggil fungsi internal yang menerima `kode: string` (`simpanDenahUntukKode`), supaya skrip uji sekali-pakai (tidak di-commit) bisa memakai `perusahaan_kode = 'zz-uji'`. Uji lewat skrip: simpan baru → versi 1; simpan dengan versi basi → ditolak; sisipkan baris `produksi_kolom_isi` uji untuk satu kolom lalu simpan denah yang menghapus kolom itu → ditolak dengan nama bak + nomor kolom. Hapus semua baris 'zz-uji' sesudahnya.
- [ ] **Step 5: Commit** `feat(produksi-es-balok): skema & logika denah produksi`.

### Task 2: Halaman Produksi + penampil denah

**Files:**
- Create: `src/components/produksi-denah/denah-kanvas.tsx` (kanvas SVG bersama: render semua tipe elemen, pan/zoom, mode `lihat`), `src/components/produksi-denah/denah-penampil.tsx`, `src/components/produksi-denah/produksi-halaman.tsx` (kartu kosong / penampil + ringkasan + tombol Edit Denah)
- Create: `src/app/pmpersada/(dashboard)/produksi/page.tsx`, `src/app/pmpakis/(dashboard)/produksi/page.tsx`

**Interfaces:** Consumes Task 1 (`getDenah`, `ringkasDenah`, `bolehEditDenah`, tipe). Produces `DenahKanvas` props: `{ dokumen: DenahDokumen; mode: "lihat" | "edit"; terpilih?: Set<string>; onPilih?; … }` — Task 3 memperluas mode edit tanpa menggandakan kode gambar.

- [ ] **Step 1:** Halaman memakai `requirePmpersada()` / `requirePmpakis()`, ambil denah, kirim `bolehEdit` dari server. Kosong → kartu "Denah produksi belum diatur" + "Edit Denah" (link ke `…/produksi/denah`, hanya bila boleh). Ada → penampil (pan/zoom, klik bak → panel detail kolom) + ringkasan + info "Diperbarui … oleh …".
- [ ] **Step 2:** Verifikasi tsc/eslint/build. Commit `feat(produksi-es-balok): halaman Produksi dan penampil denah`.

### Task 3: Builder denah ala game

**Files:**
- Create: `src/app/pmpersada/(dashboard)/produksi/denah/page.tsx`, `src/app/pmpakis/(dashboard)/produksi/denah/page.tsx` (gerbang halaman + `bolehEditDenah` → redirect ke `…/produksi` bila tidak boleh)
- Create di `src/components/produksi-denah/`: `denah-builder.tsx` (shell layar penuh), `builder-state.ts` (reducer + riwayat undo/redo ≥100), `palet-alat.tsx`, `panel-properti.tsx`, `panel-kolom.tsx`, `panel-validasi.tsx`, `minimap.tsx`, `pintasan-keyboard.ts`
- Modify: `denah-kanvas.tsx` (mode edit: seleksi, drag, resize handle, kotak seleksi, snap grid, garis bantu)

Fitur wajib persis spec §Builder ala game: navigasi (pan/zoom/fit/minimap), palet 7 alat, manipulasi (pilih/multi-pilih/kotak seleksi, drag, resize, putar 90°, duplikat Ctrl+D, hapus Delete, panah ±1 / Shift ±5, kunci, urutan lapisan), undo/redo, bak tergambar hidup (kolom sesuai orientasi/jumlah, warna varian, nomor, ice can saat zoom dekat, garis putus-putus ke mesin), panel properti + panel kolom (multi-kolom), panel validasi live (Simpan nonaktif bila ada galat), simpan dengan versi (pesan konflik versi & daftar pelanggaran kolom berisi es), peringatan `beforeunload` bila belum disimpan.

- [ ] **Step 1:** `builder-state.ts` murni + tes (`src/lib/__tests__/produksi-denah-builder.test.ts` — impor dari file state yang tidak mengimpor React): tambah/pindah/hapus/duplikat elemen, undo/redo mengembalikan dokumen identik, batas riwayat.
- [ ] **Step 2:** Kanvas mode edit + panel-panel + pintasan.
- [ ] **Step 3:** Verifikasi tsc/eslint/build + tes. Commit (boleh 2–3 commit) `feat(produksi-es-balok): builder denah visual`.

### Task 4: Verifikasi browser lokal (controller)
- [ ] Jalankan dev server, pengguna login. Buka `/pmpersada/produksi` (kosong), Edit Denah, buat 2 bak + mesin + derek, simpan, kembali → penampil menampilkan denah. Uji undo/redo, konflik versi (dua tab), dan penolakan kolom berisi es (sisipkan baris uji di `produksi_kolom_isi` untuk denah uji lalu hapus). Ulangi singkat di `/pmpakis/produksi`. Hapus data uji. Tangkap screenshot.
