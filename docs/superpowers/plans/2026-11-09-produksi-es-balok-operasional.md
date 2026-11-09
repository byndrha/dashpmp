# Produksi Es Balok — Operasional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menjadikan modul Produksi Es Balok (PMPersada & PMPakis) bisa dipakai operasional begitu denah dibuat: operator mencatat isi air / panen per kendaraan / Babonan / maintenance dari HP, admin memantau peta status, stok can, FIFO, peringatan, pencocokan panen ↔ DO ERP, dan log audit.

**Architecture:** Logika murni (kematangan, keadaan rek, validasi panen, tanggal bisnis, peringatan, pencocokan) di satu modul client-safe yang diuji `node:test`. Tulis/baca Postgres pusat lewat satu modul query bertransaksi (kunci denah `FOR SHARE` + isian `FOR UPDATE`, log hanya-INSERT). DO dan kendaraan dibaca read-only dari ERP MSSQL (`getCompanyPool`). Dua layar di atas server action yang sama: app HP `/{kode}/produksi-app` dan tab admin di `/{kode}/produksi`.

**Tech Stack:** Next.js (versi repo, baca `node_modules/next/dist/docs/` sebelum menyentuh routing/layout), React, TypeScript, `pg` (Postgres pusat, `getPgPool()`), `mssql` (`getCompanyPool`), shadcn/base-ui, `exceljs` via `src/lib/export-xlsx.ts`, `node:test` lewat `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-09-produksi-es-balok-operasional-design.md` — baca utuh sebelum task mana pun. Spec induk: `2026-10-25-…builder-denah-design.md`, `2026-11-01-…denah-v2-3d-design.md`.

## Global Constraints

- Verifikasi setiap task: `npx tsc --noEmit` nol error + `npx eslint <file yang diubah>`. Logika murni: `npx tsx --test <file>`.
- Postgres pusat = database PRODUKSI. Tes integrasi hanya memakai `perusahaan_kode = 'uji-operasional'` dan membersihkan semua barisnya di `finally`. ERP hanya dibaca (SELECT), tidak pernah ditulis.
- Pesan commit dalam Bahasa Indonesia (`feat(produksi-es-balok): …`), tanpa trailer Co-Authored-By.
- File `"use server"` hanya mengekspor fungsi async (dijaga `src/lib/__tests__/use-server-exports.test.ts`).
- Semua waktu aksi = jam server (`now()` Postgres). Klien tidak pernah mengirim waktu, kecuali admin di Koreksi.
- Tanggal bisnis: closing 13:59 WIB, 14:00 = hari berikutnya. `ROLLOVER_PANEN_JAM = ROLLOVER_HOUR` (14) dari `src/lib/business-date.ts`, konstanta terpisah milik modul ini.
- Tahap kematangan: 0 → `air`, 1–49 → `mulai`, 50–74 → `kristal`, 75–99 → `siap`, 100 → `jadi`. `pct = clamp(round((now − mulai_at)/durasi_beku_jam × 100), 0, 100)`.
- Shift (jam WIB): 1 = 07:00–14:59, 2 = 15:00–22:59, 3 = 23:00–06:59.
- Ambang peringatan: terlambat panen = usia > jam beku + 12 jam; Babonan > 48 jam; maintenance > 72 jam; kolom kosong > 6 jam; panen < 75% dalam 24 jam terakhir; selisih pencocokan ≠ 0 pada hari bisnis terakhir yang sudah closing.
- Panen dari isian `produksi`: `Σ muatan + babonan + pecah = sisa`. Panen dari isian `babonan`: `Σ muatan ≤ sisa`, babonan = pecah = 0.
- Admin produksi = `bolehKelolaProduksi(user)` = aturan `bolehEditDenah` (Super Admin, `accountScope === "direktur"`, atau `permissions.produksi.canEdit`).
- Kode perusahaan sah: `"pmpersada" | "pmpakis"` (`KodeProduksi`).
- Sumber DO PMPersada = koneksi `utama` saja (`logistik` adalah cermin). Jangan pernah menjumlahkan keduanya.

## Review Focus

1. Dua operator (atau satu operator menekan dua kali) memanen rek yang sama hampir bersamaan → yang kedua ditolak jelas ("isian sudah selesai / tinggal n can"), tidak ada can terhitung dua kali. Tes: Task 3 `panen ganda ditolak`.
2. Rek yang hanya berisi Babonan tetap mengunci denah → builder menolak menghapus/mengubah kolom itu. Tes: Task 3 `babonan mengunci kolom denah`.
3. Layar HP basi setelah admin menonaktifkan/menghapus kolom di denah → Isi Air ditolak, bukan membuat isian yatim. Tes: Task 3 `isi air ditolak untuk kolom nonaktif atau hilang`.
4. Panen pukul 13:59 vs 14:00 WIB dan DO dengan `Tanggal` naive 13:59/14:00 → jatuh di tanggal bisnis yang sama dengan aturan yang sama. Tes: Task 1 `tanggal bisnis 13:59 vs 14:00` dan Task 4 `DO dikelompokkan dengan tanggalBisnisNaive`.
5. Operator yang bukan admin mencoba aksi admin (Koreksi, batalkan panen) lewat panggilan server action langsung → ditolak di server. Tes: Task 5 `aksi admin ditolak untuk operator`.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `src/lib/produksi-operasional.ts` (baru) | Tipe, konstanta, fungsi murni. Client-safe |
| `src/lib/__tests__/produksi-operasional.test.ts` (baru) | Uji fungsi murni |
| `scripts/create-produksi-operasional-tables.ts` (baru) | DDL idempoten |
| `src/lib/queries/produksi-operasional.ts` (baru) | Transaksi tulis + baca Postgres |
| `scripts/uji-produksi-operasional.ts` (baru) | Uji integrasi berbasis kode `uji-operasional` |
| `src/lib/queries/produksi-do-erp.ts` (baru) | Kendaraan, agen, DO per kendaraan (ERP read-only) |
| `src/lib/permissions.ts` (ubah) | `bolehKelolaProduksi` |
| `src/lib/require-access.ts` (ubah) | `requireProduksiPabrik(kode)` |
| `src/app/produksi-operasional-actions.ts` (baru) | Server actions + gerbang peran |
| `scripts/seed-peran-produksi-pmpakis.ts`, `scripts/seed-denah-pmpersada-icecontrol.ts` (baru) | Data awal |
| `src/app/{pmpersada,pmpakis}/produksi-app/` (baru) | Rute app HP |
| `src/components/produksi-operasional/app/*` (baru) | Komponen app HP |
| `src/components/produksi-operasional/admin/*` (baru) | Tab admin |
| `src/components/produksi-operasional/warna-tahap.ts` (baru) | Warna tahap/keadaan, dipakai kedua layar |
| `src/components/produksi-denah/produksi-halaman.tsx`, `denah-penampil.tsx` (ubah) | Tab admin + overlay status |
| `src/app/{pmpersada,pmpakis}/(dashboard)/layout.tsx` (ubah) | Redirect akun operator |

---

### Task 1: Logika murni operasional

**Files:**
- Create: `src/lib/produksi-operasional.ts`
- Test: `src/lib/__tests__/produksi-operasional.test.ts`

**Interfaces:**
- Consumes: `Varian`, `DenahKolom`, `DenahDokumen`, `BakElemen` dari `src/lib/produksi-denah.ts`; `getBusinessDateWithRollover`, `ROLLOVER_HOUR` dari `src/lib/business-date.ts`.
- Produces (diekspor persis dengan nama ini):

```ts
export const ROLLOVER_PANEN_JAM = ROLLOVER_HOUR;
export const AMBANG = { terlambatTambahJam: 12, babonanJam: 48, maintenanceJam: 72, kosongJam: 6, panenBelumSiapPersen: 75, panenBelumSiapJendelaJam: 24 } as const;
export type JenisIsian = "produksi" | "babonan";
export type Tahap = "air" | "mulai" | "kristal" | "siap" | "jadi";
export interface IsianAktif { id: string; kolomId: string; bakId: string; jenis: JenisIsian; varian: Varian; jumlahAwal: number; sisa: number; pecah: number; mulaiAt: string; durasiBekuJam: number | null; diisiOlehNama: string }
export interface MaintenanceAktif { id: string; kolomId: string; mulaiAt: string; catatan: string; dibukaOlehNama: string }
export type KeadaanUtama = "kosong" | "berisi" | "babonan" | "maintenance" | "nonaktif";
export interface KeadaanRek { kolomId: string; bakId: string; nomor: number; varian: Varian; kapasitas: number; utama: KeadaanUtama; pct: number | null; tahap: Tahap | null; usiaMenit: number | null; estimasiMatang: string | null; canKosong: number; babonan: number; isianProduksi: IsianAktif[]; isianBabonan: IsianAktif | null; maintenance: MaintenanceAktif | null }
export interface KendaraanPilihan { jenis: "armada" | "pembeli"; kendaraanErpId: string | null; plat: string; agenId: string | null; agenNama: string | null }
export interface MuatanInput extends KendaraanPilihan { jumlah: number }
export interface PanenInput { isianId: string; muatan: MuatanInput[]; babonan: number; pecah: number; isiUlang: boolean; konfirmasiBelumSiap: boolean }
export function hitungKematangan(mulaiAt: Date, durasiBekuJam: number, sekarang: Date): number;
export function tahapDari(pct: number): Tahap;
export function shiftDari(t: Date): 1 | 2 | 3;
export function tanggalBisnisPanen(t: Date): string;          // "YYYY-MM-DD", WIB, rollover ROLLOVER_PANEN_JAM
export function tanggalBisnisNaive(naiveWib: Date): string;   // untuk DATETIME ERP naive WIB (komponen UTC = jam WIB)
export function keadaanRek(bak: BakElemen, kolom: DenahKolom, isian: IsianAktif[], mt: MaintenanceAktif | null, sekarang: Date): KeadaanRek;
export function keadaanPabrik(denah: DenahDokumen, isian: IsianAktif[], mt: MaintenanceAktif[], sekarang: Date): KeadaanRek[];
export function validasiPanen(jenis: JenisIsian, sisa: number, input: Pick<PanenInput, "muatan" | "babonan" | "pecah">): string | null; // null = sah, selain itu pesan Indonesia
export interface RingkasanStok { sehat: number; air: number; proses: number; matang: number; babonan: number; maintenance: number; perBak: { bakId: string; nama: string; kapasitas: number; terisi: number }[] }
export function ringkasStok(denah: DenahDokumen, keadaan: KeadaanRek[]): RingkasanStok;
export interface MuatanKendaraan { kendaraanErpId: string; plat: string; kecil: number; besar: number; jumlahPanen: number; operator: string[] }
export interface DoKendaraan { kendaraanErpId: string; plat: string; kecil: number; besar: number; noDo: string[] }
export type StatusCocok = "cocok" | "panen-lebih" | "do-lebih" | "hanya-do" | "hanya-panen";
export interface BarisCocok { kendaraanErpId: string; plat: string; panenKecil: number; panenBesar: number; doKecil: number; doBesar: number; selisihKecil: number; selisihBesar: number; status: StatusCocok; noDo: string[]; operator: string[] }
export function cocokkanMuatan(panen: MuatanKendaraan[], dos: DoKendaraan[]): BarisCocok[];
export type KodePeringatan = "TERLAMBAT_PANEN" | "BABONAN_LAMA" | "MAINTENANCE_LAMA" | "KOSONG_LAMA" | "PANEN_BELUM_SIAP" | "SELISIH_MUATAN";
export interface Peringatan { kode: KodePeringatan; kolomId: string | null; pesan: string; sejak: string }
export function peringatanDari(a: { keadaan: KeadaanRek[]; kosongSejak: Record<string, string>; panenBelumSiap: { kolomId: string; panenAt: string; persen: number }[]; selisih: BarisCocok[]; sekarang: Date; label: (kolomId: string) => string }): Peringatan[];
```

- [ ] **Step 1: Tulis tes gagal** di `src/lib/__tests__/produksi-operasional.test.ts`, dengan pola impor seperti `produksi-denah.test.ts`. Gunakan `buatBak`/`denahKosong` untuk fixture. Tes dan asersinya:
  - `kematangan dan tahap`: `hitungKematangan(t0, 24, t0 + 12 jam) === 50`, `+ 0 menit === 0`, `+ 30 jam === 100`; `tahapDari(0) === "air"`, `1 → "mulai"`, `49 → "mulai"`, `50 → "kristal"`, `75 → "siap"`, `99 → "siap"`, `100 → "jadi"`.
  - `shift`: 07:00 WIB → 1, 14:59 → 1, 15:00 → 2, 22:59 → 2, 23:00 → 3, 06:59 → 3. Buat instant dengan `new Date("2026-11-09T07:00:00+07:00")`.
  - `tanggal bisnis 13:59 vs 14:00`: `tanggalBisnisPanen(new Date("2026-11-09T13:59:00+07:00")) === "2026-11-09"`, `14:00 → "2026-11-10"`, `00:30 → "2026-11-09"`; `tanggalBisnisNaive(new Date("2026-11-09T13:59:00Z")) === "2026-11-09"`, `new Date("2026-11-09T14:00:00Z") → "2026-11-10"`.
  - `validasi panen produksi`: sisa 36 dengan muatan [20, 14], babonan 2, pecah 0 → `null`; total 35 → pesan memuat `"36"`; kendaraan armada ganda (`kendaraanErpId` sama) → bukan null; jumlah negatif atau muatan 0 → bukan null; pembeli tanpa plat → bukan null.
  - `validasi panen babonan`: sisa 2, muatan [1], babonan 0, pecah 0 → `null`; muatan [3] → bukan null; babonan 1 → bukan null.
  - `keadaan rek`: kolom kapasitas 36, satu isian produksi sisa 34 (mulai 12 jam lalu, durasi 24) + isian babonan sisa 2 → `utama "berisi"`, `pct 50`, `tahap "kristal"`, `babonan 2`, `canKosong 0`. Hanya babonan 2 → `utama "babonan"`, `canKosong 34`. Tanpa isian → `"kosong"`, `canKosong 36`. `kolom.nonaktif` → `"nonaktif"`. Maintenance terbuka → `"maintenance"`. Dua isian produksi → `pct` dari yang `mulaiAt` tertua.
  - `ringkas stok`: jumlahkan `sisa` per tahap (`air`=0%, `proses`=mulai/kristal/siap, `matang`=jadi), `babonan` dari isian babonan, `maintenance` = kapasitas kolom maintenance, `sehat` = total kapasitas kolom tidak nonaktif dikurangi maintenance.
  - `cocokkan muatan`: panen 306 besar vs DO 302 → `status "panen-lebih"`, `selisihBesar 4`; sama → `"cocok"`; hanya DO → `"hanya-do"`; hanya panen → `"hanya-panen"`; kecil +2 dan besar −3 → `"panen-lebih"` (panen-lebih didahulukan). Baris diurutkan: panen-lebih, hanya-panen, do-lebih, hanya-do, cocok, lalu plat.
  - `peringatan`: isian produksi umur 37 jam dengan durasi 24 → `TERLAMBAT_PANEN`; 35 jam → tidak ada. Babonan `mulaiAt` 49 jam lalu → `BABONAN_LAMA`. Maintenance 73 jam → `MAINTENANCE_LAMA`. `kosongSejak` 7 jam untuk kolom kosong → `KOSONG_LAMA`. `panenBelumSiap` berisi entri 70% → `PANEN_BELUM_SIAP`. `selisih` dengan status ≠ cocok → satu `SELISIH_MUATAN` per baris.
- [ ] **Step 2: Jalankan** `npx tsx --test src/lib/__tests__/produksi-operasional.test.ts`. Expected: FAIL (modul belum ada).
- [ ] **Step 3: Implementasikan** semua ekspor di atas di `src/lib/produksi-operasional.ts`. File ini tidak boleh mengimpor apa pun dari server (`pg`, `mssql`, `next/*`). `tanggalBisnisPanen` memakai `getBusinessDateWithRollover(ROLLOVER_PANEN_JAM, t).toISOString().slice(0,10)`. `tanggalBisnisNaive` membaca komponen `getUTC*` sebagai jam WIB dengan aturan rollover yang sama. Pesan validasi dalam Bahasa Indonesia, mis. `"Jumlah dimuat + Babonan + pecah harus 36 can (sekarang 35)."`.
- [ ] **Step 4: Jalankan** tes yang sama. Expected: PASS. Lalu `npx tsc --noEmit` dan `npx eslint src/lib/produksi-operasional.ts src/lib/__tests__/produksi-operasional.test.ts`.
- [ ] **Step 5: Commit** `feat(produksi-es-balok): logika murni operasional (kematangan, keadaan rek, panen, pencocokan)`.

### Task 2: Skema Postgres

**Files:**
- Create: `scripts/create-produksi-operasional-tables.ts` (pola `scripts/create-produksi-denah-tables.ts`: `import "dotenv/config"`, `getPgPool()`, cetak `current_database()`)

**Interfaces:**
- Produces: tabel dan kolom persis seperti bagian 11 spec. Nama kolom yang dipakai task lain: `produksi_kolom_isi(id, perusahaan_kode, kolom_id, mulai_at, selesai_at, jenis, bak_id, varian, jumlah_awal, sisa, durasi_beku_jam, pecah, diisi_oleh_akun_id, ditutup_oleh_akun_id)`, `produksi_maintenance`, `produksi_panen(…, isian_id, tanggal_bisnis, dimuat, ke_babonan, pecah, persen_saat_panen, operator_akun_id, shift, dibatalkan_at, alasan_batal)`, `produksi_muatan`, `produksi_babonan_keluar`, `produksi_kendaraan_aktif`, `produksi_log`. ID akun bertipe `text` (`session.user.id` adalah string).

- [ ] **Step 1: Tulis skrip DDL idempoten:**
  - `ALTER TABLE produksi_kolom_isi ADD COLUMN IF NOT EXISTS …` untuk setiap kolom baru. Kolom NOT NULL diberi DEFAULT sementara karena tabelnya masih kosong; pastikan dulu dengan `SELECT count(*)`, dan skrip berhenti kalau ada baris.
  - `CHECK (jenis IN ('produksi','babonan'))`, `CHECK (sisa >= 0)`, `CHECK (varian IN ('kecil','besar'))`.
  - Partial unique index `produksi_kolom_isi_babonan_aktif_uq ON (perusahaan_kode, kolom_id) WHERE selesai_at IS NULL AND jenis = 'babonan'`.
  - `CREATE TABLE IF NOT EXISTS` untuk tabel lain, dengan FK `produksi_panen.isian_id → produksi_kolom_isi(id)`, `produksi_muatan.panen_id → produksi_panen(id)`, dan `produksi_babonan_keluar.isian_id → produksi_kolom_isi(id)`.
  - `CHECK (jumlah > 0)` di muatan, dan `CHECK (jenis IN ('armada','pembeli'))`.
  - Partial unique maintenance aktif per kolom.
  - Index: `produksi_panen (perusahaan_kode, tanggal_bisnis)`, `produksi_log (perusahaan_kode, at DESC)`.
- [ ] **Step 2: Jalankan** `npx tsx scripts/create-produksi-operasional-tables.ts`. Expected: setiap tabel tercetak "siap", tanpa error. Jalankan sekali lagi. Expected: tetap sukses (idempoten).
- [ ] **Step 3: Commit** `feat(produksi-es-balok): skema tabel operasional`.

### Task 3: Query & transaksi aksi (Postgres)

**Files:**
- Create: `src/lib/queries/produksi-operasional.ts`
- Create: `scripts/uji-produksi-operasional.ts`

**Interfaces:**
- Consumes: Task 1 (tipe, `validasiPanen`, `hitungKematangan`, `tanggalBisnisPanen`, `shiftDari`, `AMBANG`); `migrasiDenah`, `DenahDokumen` (`produksi-denah.ts`); `getPgPool`; `AppError` (`@/lib/action-result`).
- Produces:

```ts
export type KodeGalatProduksi = "TIDAK_DITEMUKAN" | "KEADAAN_BERUBAH" | "VALIDASI" | "BELUM_SIAP" | "KOLOM_TIDAK_SAH" | "KAPASITAS";
export class GalatAksiProduksi extends AppError { kodeGalat: KodeGalatProduksi }
export interface Pelaku { akunId: string; nama: string; peran: "operator" | "admin" }
export interface DataPabrik { denah: DenahDokumen | null; isian: IsianAktif[]; maintenance: MaintenanceAktif[]; kosongSejak: Record<string, string>; panenBelumSiap: { kolomId: string; panenAt: string; persen: number }[]; sekarang: string }
export function getDataPabrik(kode: string): Promise<DataPabrik>;
export function isiAir(kode: string, kolomId: string, jumlah: number | null, p: Pelaku): Promise<{ isianId: string }>;
export function panen(kode: string, input: PanenInput, p: Pelaku): Promise<{ panenId: string; isianBaruId: string | null }>;
export function tandaiBabonan(kode: string, isianId: string, jumlah: number, p: Pelaku): Promise<void>;
export function buangBabonan(kode: string, kolomId: string, jumlah: number, alasan: string, p: Pelaku): Promise<void>;
export function mulaiMaintenance(kode: string, kolomId: string, catatan: string, p: Pelaku): Promise<void>;
export function selesaiMaintenance(kode: string, kolomId: string, p: Pelaku): Promise<void>;
export function koreksiIsian(kode: string, isianId: string, ubah: { mulaiAt?: string; varian?: Varian; sisa?: number }, alasan: string, p: Pelaku): Promise<void>;
export function batalkanPanen(kode: string, panenId: string, alasan: string, p: Pelaku): Promise<void>;
export function getKendaraanAktif(akunId: string, kode: string): Promise<KendaraanPilihan | null>;
export function setKendaraanAktif(akunId: string, kode: string, k: KendaraanPilihan): Promise<void>;
export interface MuatanHarian { armada: MuatanKendaraan[]; pembeli: (KendaraanPilihan & { kecil: number; besar: number })[]; ringkasan: { dimuat: number; keBabonan: number; pecah: number; babonanDibuang: number } }
export function getMuatanHarian(kode: string, tanggalBisnis: string): Promise<MuatanHarian>;
export interface BarisLog { id: string; at: string; akunNama: string; peran: string; shift: number; aksi: string; bakNama: string | null; kolomNomor: number | null; sebelum: unknown; sesudah: unknown; alasan: string | null }
export function getLog(kode: string, f: { dari: string; sampai: string; akunId?: string; bakId?: string; aksi?: string }, batas: number): Promise<BarisLog[]>;
export function getRiwayatOperator(kode: string, akunId: string, sejak: string): Promise<BarisLog[]>;
```

Aturan transaksi untuk SETIAP fungsi tulis:
- `BEGIN`.
- `SELECT data FROM produksi_denah WHERE perusahaan_kode=$1 FOR SHARE`, lalu `migrasiDenah`. Kolom harus ada, tidak `nonaktif`, dan ambil `bak` induknya. Kalau gagal → `KOLOM_TIDAK_SAH`.
- `SELECT … FROM produksi_kolom_isi WHERE perusahaan_kode=$1 AND kolom_id=$2 AND selesai_at IS NULL FOR UPDATE`.
- Hitung ulang di server. Ubah `sisa`; set `selesai_at = now()` kalau sisa mencapai 0.
- `INSERT produksi_log` (snapshot `bak_nama`, `kolom_nomor`, `shift = shiftDari(now)`).
- `COMMIT`. Error apa pun → `ROLLBACK`.

Aturan per aksi:
- **`panen`:**
  - Isian `produksi` dengan `pct < AMBANG.panenBelumSiapPersen` dan `!konfirmasiBelumSiap` → `BELUM_SIAP`.
  - Babonan/pecah ditambahkan ke isian babonan aktif kolom itu (buat baru kalau belum ada: `jumlah_awal = sisa = n`, `mulai_at = now()`, `varian` = varian isian asal). Kalau sudah ada: `sisa += n`, `jumlah_awal += n`, `pecah += pecah`.
  - `isiUlang` → isian produksi baru dengan jumlah = Σ muatan, `durasi_beku_jam = bak.durasiBekuJam[varian]`, varian = `DenahKolom.varian`. Tolak `KAPASITAS` kalau Σ sisa > `jumlahIceCan`.
  - `tanggal_bisnis = tanggalBisnisPanen(now)`.
- **`isiAir`:**
  - Ditolak kalau ada maintenance terbuka.
  - Jumlah bawaan = `jumlahIceCan − Σ sisa`. Kalau `jumlah` diberikan, nilainya harus 1..bawaan.
- **`mulaiMaintenance`:** ditolak kalau ada isian `produksi` aktif. Babonan boleh tetap ada.
- **`koreksiIsian` / `batalkanPanen`:**
  - Mensyaratkan `p.peran === "admin"` dan alasan tidak kosong.
  - Pembatalan hanya untuk panen ≤ 7 hari. Panen di-set `dibatalkan_at`. Kalau isian asal masih aktif, `sisa` dikembalikan. Kalau tidak, cukup ditandai.
  - Isian baru hasil `isiUlang` tidak dihapus otomatis; admin mengoreksinya terpisah.
- **Tidak ada `DELETE` di modul ini.**

- [ ] **Step 1: Tulis uji integrasi gagal** `scripts/uji-produksi-operasional.ts`:
  - Memakai `node:test`. Tulis denah uji ke `produksi_denah` untuk kode `'uji-operasional'`: 1 bak, 3 kolom BK 36, kolom ke-3 `nonaktif`, `durasiBekuJam` BK 24.
  - `after()` menghapus semua baris `'uji-operasional'` dari semua tabel `produksi_*`.
  - Pelaku `{ akunId: "uji-1", nama: "Uji", peran: "operator" }` dan admin `"uji-admin"`.
  - Untuk tes yang butuh es "siap", mundurkan `mulai_at` langsung lewat SQL di skrip uji.
  - Tes:
    - `isi air lalu panen dengan babonan dan isi ulang`: isi air kolom 1 (36) → mundurkan 25 jam → panen muatan [{armada A, 20}, {armada B, 14}], babonan 2. Asersi: isian lama `selesai_at` terisi; isian babonan sisa 2; isian produksi baru sisa 34; 2 baris muatan; `getMuatanHarian(..., tanggalBisnisPanen(now))` → armada A kecil 20 + B kecil 14; log bertambah 2 (isi_air, panen).
    - `panen ganda ditolak`: panggil `panen` dua kali dengan input yang sama secara `Promise.allSettled`. Tepat satu sukses; yang lain `GalatAksiProduksi` dengan `kodeGalat` `"KEADAAN_BERUBAH"` atau `"VALIDASI"`.
    - `panen belum siap butuh konfirmasi`: isian 2 jam → `BELUM_SIAP`. Dengan `konfirmasiBelumSiap: true` → sukses, `persen_saat_panen < 75`.
    - `isi air ditolak untuk kolom nonaktif atau hilang`: kolom 3 → `KOLOM_TIDAK_SAH`; id acak → `KOLOM_TIDAK_SAH`.
    - `babonan mengunci kolom denah`: setelah kolom hanya berisi Babonan, `getKolomIsiIdsUntukKode('uji-operasional')` (dari `queries/produksi-denah.ts`) memuat kolom itu.
    - `maintenance`: mulai di kolom berisi produksi → ditolak; setelah panen tanpa isi ulang → sukses; isi air saat maintenance → ditolak; selesai → isi air sukses.
    - `koreksi dan batal hanya admin`: operator → ditolak; admin tanpa alasan → ditolak; admin dengan alasan → sukses, log memuat `sebelum`/`sesudah`.
    - `invarian jumlah`: untuk setiap isian produksi selesai, `jumlah_awal = sisa + Σ(muatan) + ke_babonan + pecah` dari panen tak dibatalkan.
- [ ] **Step 2: Jalankan** `npx tsx --test scripts/uji-produksi-operasional.ts`. Expected: FAIL (modul belum ada).
- [ ] **Step 3: Implementasikan** `src/lib/queries/produksi-operasional.ts` dengan signature dan aturan di atas. `GalatAksiProduksi` membawa `kodeGalat` agar UI bisa menampilkan dialog konfirmasi untuk `BELUM_SIAP`. Pesan untuk `KEADAAN_BERUBAH` menyebut siapa dan kapan aksi terakhir di kolom itu (ambil dari `produksi_log` terbaru kolom tersebut).
- [ ] **Step 4: Jalankan** uji integrasi. Expected: PASS, dan setelahnya `SELECT count(*) FROM produksi_kolom_isi WHERE perusahaan_kode='uji-operasional'` = 0. Lalu tsc + eslint.
- [ ] **Step 5: Commit** `feat(produksi-es-balok): transaksi aksi operasional + log audit`.

### Task 4: Baca ERP (kendaraan, agen, DO)

**Files:**
- Create: `src/lib/queries/produksi-do-erp.ts`
- Test: `src/lib/__tests__/produksi-do-erp.test.ts` (hanya bagian murni pengelompokan)

**Interfaces:**
- Consumes: `getCompanyPool(kode, label)` dari `src/lib/db-company.ts`; `tanggalBisnisNaive`, `DoKendaraan`, `KendaraanPilihan` (Task 1).
- Produces:

```ts
export const SUMBER_DO: Record<KodeProduksi, { label: CompanyKoneksiLabel; branchId: string | null }>;
export interface KendaraanArmada { kendaraanErpId: string; plat: string; sopir: string | null }
export function getKendaraanArmada(kode: KodeProduksi): Promise<KendaraanArmada[]>;
export function cariAgen(kode: KodeProduksi, q: string): Promise<{ agenId: string; nama: string }[]>; // maks 20
export interface BarisDo { noDo: string; tanggal: Date; kendaraanErpId: string; plat: string; kecil: number; besar: number }
export function kelompokkanDo(rows: BarisDo[], tanggalBisnis: string): DoKendaraan[]; // murni
export function getDoPerKendaraan(kode: KodeProduksi, tanggalBisnis: string): Promise<DoKendaraan[]>;
```

- [ ] **Step 1: Tentukan sumber DO PMPakis.**
  - Jalankan skrip sementara (hapus setelah selesai) yang membandingkan muatan per plat per hari 7 hari terakhir antara `getCompanyPool("pmpakis","utama")` dan `getCompanyPool("pmpakis","logistik")` dengan `BranchID='011'`, serta cek `Status` pemesanan aktif.
  - Isi `SUMBER_DO`: `pmpersada: { label: "utama", branchId: null }`, PMPakis sesuai hasil. Tulis temuan sebagai komentar di atas konstanta, termasuk tanggal cek dan "Status tidak difilter karena …".
  - Laporkan juga (tanpa memperbaiki) apakah `src/lib/queries/penjualan-piutang.ts` menjumlahkan kuantitas balok dari `utama` + `logistik`.
- [ ] **Step 2: Tulis tes gagal** `DO dikelompokkan dengan tanggalBisnisNaive`:
  - Baris bertanggal naive `2026-11-09T13:59:00Z` dan `2026-11-09T14:00:00Z` untuk plat sama. `kelompokkanDo(rows, "2026-11-09")` hanya memuat yang 13:59, dan `kelompokkanDo(rows, "2026-11-10")` memuat yang 14:00.
  - Dua DO untuk kendaraan sama dijumlahkan, dan `noDo` berisi keduanya.
- [ ] **Step 3: Jalankan** `npx tsx --test src/lib/__tests__/produksi-do-erp.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implementasikan.**
  - `getDoPerKendaraan` mengambil baris dengan `j.Tanggal` di rentang `[tanggalBisnis−1 hari 00:00, tanggalBisnis+1 hari 00:00)` naive, join `PMP_PenjadwalanDetail` (IsDeleted=0) → `PMP_Pemesanan` (IsDeleted=0, IsVoid=0) → `PMP_DaftarKendaraan`, lalu memanggil `kelompokkanDo`. Filter `BranchID` kalau `branchId` tidak null.
  - `getKendaraanArmada` dari `PMP_DaftarKendaraan` IsDeleted=0, join `PMP_Sopir`, urut plat.
  - `cariAgen` dari `PMP_Agen` (`LIKE` berparameter).
- [ ] **Step 5: Jalankan** tes. Expected: PASS. Uji asap: skrip sementara memanggil `getDoPerKendaraan("pmpersada", "2026-11-07")`. Expected: 14 kendaraan, dengan total sama seperti di spec (mis. S 9805 UH besar 302). Hapus skrip itu, lalu tsc + eslint.
- [ ] **Step 6: Commit** `feat(produksi-es-balok): baca kendaraan, agen, dan DO dari ERP`.

### Task 5: Izin, gerbang, dan server actions

**Files:**
- Modify: `src/lib/permissions.ts` (tambah `bolehKelolaProduksi`, dengan `bolehEditDenah` tetap ada)
- Modify: `src/lib/require-access.ts` (tambah `requireProduksiPabrik`)
- Create: `src/app/produksi-operasional-actions.ts`
- Test: `src/lib/__tests__/produksi-operasional-akses.test.ts`

**Interfaces:**
- Produces:

```ts
// permissions.ts
export function bolehKelolaProduksi(user: { isSuperAdmin: boolean; accountScope?: string | null; permissions?: PermissionMap }): boolean; // = bolehEditDenah
export function bolehAksiProduksi(user: { isProduksi?: boolean; isSuperAdmin: boolean; accountScope?: string | null; permissions?: PermissionMap }): boolean; // isProduksi || bolehKelolaProduksi
export function peranProduksi(user: …): "admin" | "operator";
// require-access.ts
export async function requireProduksiPabrik(kode: KodeProduksi): Promise<Session>; // requirePmpersada/requirePmpakis + bolehAksiProduksi, selain itu redirect("/akses-ditolak")
// produksi-operasional-actions.ts (semua mengembalikan ActionResult<T> via runAction)
getKeadaanAction(kode) → { data: DataPabrik; keadaan: KeadaanRek[]; peringatan: Peringatan[]; ringkasan: RingkasanStok }
isiAirAction(kode, kolomId, jumlah: number | null)
panenAction(kode, input: PanenInput)            // gagal BELUM_SIAP → { success:false, error, kodeGalat:"BELUM_SIAP" }
tandaiBabonanAction(kode, isianId, jumlah)
buangBabonanAction(kode, kolomId, jumlah, alasan)
mulaiMaintenanceAction(kode, kolomId, catatan) / selesaiMaintenanceAction(kode, kolomId)
koreksiIsianAction(kode, isianId, ubah, alasan) / batalkanPanenAction(kode, panenId, alasan)   // admin
getPilihanKendaraanAction(kode) → { armada: KendaraanArmada[]; aktif: KendaraanPilihan | null }
setKendaraanAktifAction(kode, k: KendaraanPilihan)
cariAgenAction(kode, q)
getPencocokanAction(kode, tanggalBisnis) → { baris: BarisCocok[]; muatan: MuatanHarian; sementara: boolean }   // admin
getLogAction(kode, filter) → BarisLog[]                                                                          // admin
getRiwayatSayaAction(kode) → { log: BarisLog[]; muatanHariIni: MuatanHarian }
```

- Setiap action memvalidasi `kode ∈ ["pmpersada","pmpakis"]` dan akses perusahaan (pola `simpanDenahAction`), lalu `bolehAksiProduksi` atau, untuk action admin, `bolehKelolaProduksi`. Input klien diperiksa bentuknya (integer ≥ 0, string terbatas panjang ≤ 1000, enum).
- `peringatanDari` di `getKeadaanAction` memakai `selisih` dari hari bisnis terakhir yang sudah closing. Hasilnya di-cache per request saja, tanpa job terjadwal.
- `sementara = tanggalBisnis >= tanggalBisnisPanen(now)`.
- Action tulis memanggil `revalidatePath(`/${kode}/produksi`)` dan `revalidatePath(`/${kode}/produksi-app`)`.

- [ ] **Step 1: Tulis tes gagal** `aksi admin ditolak untuk operator`:
  - `bolehKelolaProduksi` false untuk `{ isSuperAdmin:false, accountScope:"pmpersada", permissions:{} }`, dan true untuk superadmin, direktur, dan `permissions.produksi.canEdit`.
  - `bolehAksiProduksi` true untuk `isProduksi:true`.
  - `peranProduksi` → `"operator"` untuk operator, `"admin"` untuk canEdit.
  - Tes `use-server-exports.test.ts` yang sudah ada tetap lulus untuk file action baru.
- [ ] **Step 2: Jalankan** `npx tsx --test src/lib/__tests__/produksi-operasional-akses.test.ts src/lib/__tests__/use-server-exports.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan** ketiga file.
- [ ] **Step 4: Jalankan** tes yang sama. Expected: PASS. Lalu tsc + eslint.
- [ ] **Step 5: Commit** `feat(produksi-es-balok): izin dan server action operasional`.

### Task 6: Data awal (peran PMPakis + denah PMPersada dari IceControl)

**Files:**
- Create: `scripts/seed-peran-produksi-pmpakis.ts`
- Create: `scripts/seed-denah-pmpersada-icecontrol.ts`

**Interfaces:**
- Consumes: `buatBak`, `buatKolom`, `denahKosong`, `validasiDenah` (`produksi-denah.ts`); `simpanDenahUntukKode`, `getDenahUntukKode` (`queries/produksi-denah.ts`).

- [ ] **Step 1: Skrip peran PMPakis.** `INSERT` peran `nama='Produksi'`, `is_produksi=true` untuk `perusahaan.kode='pmpakis'` kalau belum ada (idempoten, berdasarkan nama + perusahaan). Jalankan dua kali. Expected: pertama "dibuat", kedua "sudah ada".
- [ ] **Step 2: Skrip denah PMPersada.**
  - Isi denah: 5 bak "Bak 1"…"Bak 5" dengan 37/37/44/66/66 kolom, BK 36 can. Bak 4 dan Bak 5 kolom nomor 41 ke atas BB 18 can. `durasiBekuJam = { kecil: 24, besar: 32 }`.
  - Bak ditata berjajar vertikal dengan jarak 3 m. Ukuran bak memakai bawaan `buatBak` dan diperpanjang secukupnya agar `validasiDenah` tidak melaporkan galat. Kanvas diperbesar kalau perlu.
  - Skrip mencetak ringkasan (jumlah bak, kolom, can per varian), lalu **berhenti dengan dry-run kecuali diberi argumen `--tulis`**.
  - Dengan `--tulis`: tolak kalau ada isian aktif. Simpan lewat `simpanDenahUntukKode("pmpersada", dok, versiSekarang, "seed-icecontrol")`.
- [ ] **Step 3: Jalankan** `npx tsx scripts/seed-denah-pmpersada-icecontrol.ts`. Expected (dry-run): 5 bak, 250 kolom, BK 198 kolom (7.128 can), BB 52 kolom (936 can), total 8.064 can (cocok dengan IceControl: 7.884 can sehat + 5 rek maintenance × 36), 0 galat validasi. **Minta persetujuan pengguna** sebelum menjalankan `--tulis`, karena ini menimpa denah uji di produksi. Setelah disetujui, jalankan dengan `--tulis` dan buka `/pmpersada/produksi` untuk memastikan denah tampil.
- [ ] **Step 4: Commit** `feat(produksi-es-balok): seed peran Produksi PMPakis dan denah awal PMPersada dari IceControl`.

### Task 7: Aplikasi HP operator

**Files:**
- Create: `src/app/pmpersada/produksi-app/page.tsx`, `src/app/pmpakis/produksi-app/page.tsx` (+ `layout.tsx` tipis per pabrik bila diperlukan pola repo)
- Create: `src/components/produksi-operasional/warna-tahap.ts`
- Create: `src/components/produksi-operasional/app/produksi-app.tsx` (shell klien), `grid-rek.tsx`, `lembar-aksi-rek.tsx`, `form-panen.tsx`, `pemilih-kendaraan.tsx`, `riwayat-saya.tsx`
- Modify: `src/app/pmpersada/(dashboard)/layout.tsx`, `src/app/pmpakis/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: action Task 5; tipe Task 1.
- Produces: `WARNA_TAHAP: Record<Tahap, { latar: string; teks: string; label: string }>` dan `WARNA_KEADAAN: Record<Exclude<KeadaanUtama,"berisi">, …>` (kelas Tailwind, mode terang dan gelap), dipakai juga di Task 8. Label: Air baru (0%), Mulai (1–49%), Kristal (50–74%), Siap (75–99%), Jadi (100%), Babonan, Maintenance, Nonaktif, Kosong.

Rincian layar mengikuti spec bagian 7 dan 3 (formulir panen, termasuk sketsa ASCII-nya):
- Layout HP tanpa sidebar. Bottom nav (Rek / Riwayat saya) tidak fixed, mengikuti pola `driver-tab-shell.tsx` dan `satpam-tab-shell.tsx`.
- Bagian atas selalu menampilkan nama, shift, dan pemilih kendaraan aktif.
- Tab bak sesuai urutan denah.
- Ketuk kartu rek → lembar aksi sesuai keadaan.
- Formulir panen: baris muatan pertama = kendaraan aktif dengan jumlah = sisa isian; "+ Bagi ke kendaraan lain"; Babonan; Pecah; ringkasan total ✓/✗. Tombol "Panen & Isi Air n can" baru aktif kalau `validasiPanen` mengembalikan null. "Panen tanpa isi ulang" berupa tautan.
- Respons `BELUM_SIAP` → dialog "Es baru {pct}%, tetap panen?" → kirim ulang dengan `konfirmasiBelumSiap: true`.
- Setelah panen, kendaraan pada baris muatan terakhir disimpan sebagai kendaraan aktif.
- Segarkan otomatis setiap 30 detik (`setInterval` + `router.refresh()` atau panggil ulang `getKeadaanAction`) dan setelah setiap aksi. Tombol aksi dikunci selama permintaan berjalan.
- Denah kosong atau rusak → pesan "Denah produksi belum diatur — hubungi admin."
- Layout dashboard: setelah `requirePmpersada()`, kalau `session.user.isProduksi && !bolehKelolaProduksi(session.user) && !canAccessAllPT(session.user)` → `redirect("/pmpersada/produksi-app")`. PMPakis sama. Hapus komentar lama "akun is_produksi untuk sementara jatuh ke beranda generik". Untuk admin, app HP menampilkan tautan "Layar admin" ke `/{kode}/produksi`.

- [ ] **Step 1: Implementasikan** halaman, komponen, dan perubahan layout.
- [ ] **Step 2: Verifikasi** `npx tsc --noEmit` + eslint untuk semua file baru dan yang diubah.
- [ ] **Step 3: Verifikasi di browser.**
  - `preview_start` dengan nama `dev`, viewport `mobile`.
  - Login sebagai akun berperan Produksi PMPersada. Kalau belum ada akun uji pribadi, minta pengguna membuatnya lewat `/grup/akun`; jangan mengetik kata sandi milik pengguna.
  - Pastikan: membuka `/pmpersada` diarahkan ke `/pmpersada/produksi-app`; Isi Air di satu rek; ubah kendaraan aktif; Panen dengan pembagian 2 kendaraan + Babonan 2. Hasilnya: kartu menampilkan badge Babonan 2 dan isian baru 0%, dan "Riwayat saya" memuat kedua aksi.
  - Batalkan data uji lewat Koreksi admin di Task 9, atau catat id isian untuk dibersihkan bersama pengguna.
  - Ambil screenshot.
- [ ] **Step 4: Commit** `feat(produksi-es-balok): aplikasi HP operator produksi`.

### Task 8: Admin — Peta status, Ringkasan, FIFO, Peringatan

**Files:**
- Modify: `src/components/produksi-denah/produksi-halaman.tsx` (jadi tab; bagian denah/ringkasan denah lama dipertahankan di tab Peta)
- Modify: `src/components/produksi-denah/denah-penampil.tsx` (prop opsional `statusKolom?: Record<string, { warna: string; label: string }>` dan `onKlikKolom?: (kolomId: string) => void`; tanpa prop, perilakunya sama seperti sekarang)
- Create: `src/components/produksi-operasional/admin/tab-operasional.tsx` (klien, memegang data `getKeadaanAction` + polling 30 dtk), `ringkasan-stok.tsx`, `tabel-fifo.tsx`, `daftar-peringatan.tsx`, `detail-rek.tsx`

**Interfaces:**
- Consumes: `getKeadaanAction`, `WARNA_TAHAP`/`WARNA_KEADAAN` (Task 7), `ringkasStok`, `keadaanPabrik`.
- Produces: komponen `DetailRek` (props `{ kode: KodeProduksi; keadaan: KeadaanRek; admin: boolean; onBerubah: () => void }`) yang dipakai ulang Task 9 untuk aksi Koreksi.

Rincian:
- **Tab** urut: Peta · Ringkasan · FIFO · Peringatan (badge jumlah) · Pencocokan · Log audit. Dua tab terakhir hanya dirender kalau `bolehKelolaProduksi(user)`; isinya ditambahkan di Task 9.
- **Ringkasan:**
  - kartu can sehat / air / proses / matang / Babonan / maintenance
  - progres per bak (`terisi/kapasitas`)
  - estimasi can menjadi "jadi" dalam 6 dan 12 jam ke depan (Σ sisa isian produksi dengan `mulaiAt + durasi ≤ now + 6/12 jam`)
- **FIFO:** satu baris per isian aktif, diurutkan dari `mulaiAt` tertua. Kolom: lokasi (Bak – Rek n), varian, jenis, sisa/awal, tahap & %, operator pengisi, waktu isi, estimasi matang, usia. Filter bak/varian/tahap/jenis + pencarian teks.
- **Peta:** `DenahPenampil` dengan `statusKolom` dari `keadaanPabrik`. Klik kolom → `DetailRek` di sheet samping.
- Semua waktu ditampilkan dalam zona `Asia/Jakarta`.

- [ ] **Step 1: Implementasikan.**
- [ ] **Step 2: Verifikasi** tsc + eslint.
- [ ] **Step 3: Verifikasi di browser** sebagai admin (desktop):
  - rek yang diisi di Task 7 berwarna di Peta
  - angka Ringkasan sama dengan Σ sisa
  - FIFO terurut tertua di atas
  - Peringatan muncul setelah `mulai_at` isian uji dimundurkan > 36 jam lewat Koreksi (Task 9) atau SQL di data uji
  - akun non-admin tidak melihat tab Pencocokan/Log
  - Ambil screenshot.
- [ ] **Step 4: Commit** `feat(produksi-es-balok): tab admin peta status, ringkasan, FIFO, peringatan`.

### Task 9: Admin — Pencocokan, Log audit + Excel, Koreksi

**Files:**
- Create: `src/components/produksi-operasional/admin/tab-pencocokan.tsx`, `tab-log-audit.tsx`, `dialog-koreksi.tsx`
- Modify: `src/components/produksi-operasional/admin/detail-rek.tsx` (tombol Koreksi & batalkan panen terakhir, admin saja)

**Interfaces:**
- Consumes: `getPencocokanAction`, `getLogAction`, `koreksiIsianAction`, `batalkanPanenAction`, `exportRowsToXlsx` (`src/lib/export-xlsx.ts`), `tanggalBisnisPanen`.

Rincian:
- **Pencocokan:**
  - Pemilih tanggal bisnis, bawaan = hari bisnis terakhir yang sudah closing. Label "Sementara" kalau `sementara`.
  - Ringkasan atas: dimuat, total DO, ke Babonan, pecah, Babonan dibuang.
  - Tabel `BarisCocok` dengan warna status (panen-lebih = merah). Kolom No DO dan operator.
  - Bagian "Kendaraan pembeli" (plat, agen, K/B) dengan total.
  - Tombol "Lihat H−1 / H+1" mengganti tanggal.
- **Log audit:**
  - Filter tanggal (bawaan 7 hari), operator, bak, aksi.
  - Kolom: waktu, lokasi, aksi, perubahan (ringkas dari `sebelum` → `sesudah`), operator & shift, alasan.
  - "Ekspor Excel" memakai `exportRowsToXlsx` dengan baris yang sedang tampil. Nama file `Log_Produksi_{kode}_{tanggal}.xlsx`.
- **Koreksi:**
  - Form untuk `mulaiAt` (datetime-local WIB → ISO), varian, dan sisa. Alasan wajib.
  - Batalkan panen ≤ 7 hari dengan alasan wajib.
  - Pesan galat dari server ditampilkan apa adanya.

- [ ] **Step 1: Implementasikan.**
- [ ] **Step 2: Verifikasi** tsc + eslint.
- [ ] **Step 3: Verifikasi di browser:**
  - Pencocokan untuk tanggal bisnis data uji menampilkan muatan Task 7 sebagai "hanya-panen" atau selisih terhadap DO nyata hari itu.
  - Pilih `2026-11-07` (tanpa panen) → 14 baris "hanya-do" dengan angka DO spec.
  - Ekspor Excel terunduh dan berisi baris yang tampil.
  - Koreksi tanpa alasan ditolak; dengan alasan, perubahan masuk log.
  - Batalkan panen uji → sisa kembali.
  - Bersihkan data uji di PMPersada lewat Koreksi/batal bersama pengguna. Jangan memakai DELETE SQL di data produksi tanpa persetujuan.
  - Ambil screenshot.
- [ ] **Step 4: Commit** `feat(produksi-es-balok): pencocokan panen-DO, log audit, koreksi admin`.

### Task 10: Verifikasi akhir

- [ ] **Step 1: Jalankan** seluruh tes: `npx tsx --test src/lib/__tests__/produksi-operasional.test.ts src/lib/__tests__/produksi-do-erp.test.ts src/lib/__tests__/produksi-operasional-akses.test.ts src/lib/__tests__/produksi-denah.test.ts src/lib/__tests__/use-server-exports.test.ts` dan `npx tsx --test scripts/uji-produksi-operasional.ts`. Expected: semua PASS, dan tidak ada baris `uji-operasional` tersisa.
- [ ] **Step 2: Jalankan** `npm run build`. Expected: sukses, dan rute `/pmpersada/produksi-app` + `/pmpakis/produksi-app` muncul di daftar.
- [ ] **Step 3: Tulis catatan serah** di ringkasan akhir (bukan file):
  - langkah manual pengguna: buat 9 akun operator di `/grup/akun` (peran Produksi PMPersada), nonaktifkan akun bersama `produksi-tuban`, atur akun admin produksi (`produksi.canEdit`)
  - temuan Task 4 tentang sumber DO PMPakis dan penjumlahan ganda di modul Penjualan
  - hal yang ditunda: mode offline
- [ ] **Step 4: Commit** sisa perubahan kalau ada. Jangan push tanpa persetujuan pengguna.
