# Driver Health Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pemeriksaan kesehatan driver per keberangkatan di Validasi Rute, wajib lolos sebelum Selesai Muat (atau diambil alih dengan Kode Ambil-Alih + alasan).

**Architecture:** Penilaian di satu modul murni (`src/lib/health-check-driver.ts`) yang dipakai klien dan server. Riwayat pemeriksaan disimpan di tabel MSSQL baru `DashboardDriverHealthCheck`, dan data SIM di `DashboardDriverSim` yang diperluas. `selesaiMuat` menolak bila baris terbaru (jadwal, driver) tidak lolos dan tidak diambil alih. UI: tombol + dialog di `route-validation-dialog.tsx`.

**Tech Stack:** Next.js 16 (server actions, `runAction`/`AppError`), mssql (`getPool`), Postgres (`kode_ambil_alih`), React + shadcn/base-ui, `node --test` + tsx.

**Spec:** `docs/superpowers/specs/2026-11-26-driver-health-check-design.md`

## Global Constraints

- Lolos tensi: sistolik 90–159 **dan** diastolik 60–99 mmHg (inklusif).
- Lolos alkohol: angka breathalyzer = 0; > 0 gagal.
- Lolos SIM: ≥1 SIM dengan `BerlakuHingga` ≥ tanggal kalender WIB hari ini **dan** "SIM fisik dibawa" dicentang. SIM ≤ 30 hari lagi habis = peringatan (tetap lolos).
- Hasil lolos = keempat kriteria lolos. Server selalu menilai ulang; jangan percaya `lolos` dari klien.
- Kelayakan per (JadwalID, SalesmanID); baris terbaru yang berlaku; layak = `Lolos = 1` atau `AmbilAlih = 1`.
- Ambil-alih: `verifikasiDanPakaiKodeAmbilAlih(kode, akunId, jadwalId, "HEALTH_CHECK")` + alasan wajib (tidak kosong setelah trim). Hanya bila baris terbaru tidak lolos.
- Simpan Health Check hanya saat Jadwal berstatus `Draft`. Health Check dikunci ke `SalesmanID` yang dikirim; gerbang di `selesaiMuat` mencocokkan ke `SalesmanID` jadwal di DB saat itu, sehingga driver yang diganti otomatis tidak layak sampai dicek. Ini penyederhanaan dari spec: tidak perlu menyimpan driver dulu sebelum cek.
- Akses: `requireModuleAccess("delivery")`; pemeriksa = `Number(session.user.id)`.
- Teks UI & komentar dalam Bahasa Indonesia; pesan commit Bahasa Indonesia.
- Saat verifikasi di browser: JANGAN menyimpan/menghapus data apa pun (hanya buka & isi formulir tanpa Simpan).

## Review Focus

- **Driver diganti setelah lolos:** status di dialog kembali kosong, dan `selesaiMuat` menolak. Uji: `layakBerangkat(null) === false` (Task 1). Gerbang memakai `SalesmanID` dari DB (Task 2).
- **Input kosong/bukan angka** (tensi atau alkohol tidak diisi): hasilnya gagal dengan alasan jelas, tidak boleh lolos diam-diam. Uji di Task 1.
- **Batas tepat** 159/99 dan 160/100, 90/60 dan 89/59: inklusif sesuai konstanta. Uji di Task 1.
- **SIM berakhir hari ini:** masih berlaku (`BerlakuHingga` = hari ini → lolos). Tanpa tanggal berlaku → tidak dihitung berlaku. Uji di Task 1.
- **Ambil-alih pada baris yang sudah lolos atau belum ada baris:** ditolak dengan `AppError`, dan kode tidak terpakai (verifikasi kode dilakukan SETELAH validasi baris). Task 2.

---

### Task 1: Modul penilaian murni

**Files:**
- Create: `src/lib/health-check-driver.ts`
- Test: `src/lib/__tests__/health-check-driver.test.ts`

**Interfaces:**
- Produces:
  - `export const BATAS_TENSI = { sistolikMin: 90, sistolikMaks: 159, diastolikMin: 60, diastolikMaks: 99 } as const`
  - `export const HARI_PERINGATAN_SIM = 30`
  - `export interface SimDriver { jenisSim: string; nomorSim: string | null; berlakuHingga: string | null /* YYYY-MM-DD */ }`
  - `export interface MasukanHealthCheck { sistolik: number | null; diastolik: number | null; kadarAlkohol: number | null; pandanganLolos: boolean | null; simDibawa: boolean; sims: SimDriver[] }`
  - `export interface HasilHealthCheck { lolos: boolean; alasanGagal: string[]; simTerbaik: SimDriver | null; peringatan: string[] }`
  - `export function nilaiHealthCheck(m: MasukanHealthCheck, hariIniISO: string): HasilHealthCheck`
  - `export function statusSim(s: SimDriver, hariIniISO: string): "berlaku" | "hampir_habis" | "kedaluwarsa" | "tanpa_tanggal"`
  - `export function layakBerangkat(terbaru: { Lolos: boolean; AmbilAlih: boolean } | null): boolean`
  - `export function hariIniWibISO(now?: Date): string`, berdasarkan `getNaiveWibNow` dari `@/lib/business-date` (`.toISOString().slice(0, 10)`).

- [ ] **Step 1: Tulis tes yang gagal** `src/lib/__tests__/health-check-driver.test.ts` (import relatif `../health-check-driver`), `HARI = "2026-11-26"`:
  - `lolos semua`: tensi 120/80, alkohol 0, pandangan true, simDibawa true, sims `[{jenisSim:"B1",nomorSim:"123",berlakuHingga:"2027-01-01"}]` → `lolos === true`, `alasanGagal` kosong, `simTerbaik.jenisSim === "B1"`.
  - `batas tensi inklusif`: 159/99 lolos; 160/80 gagal; 120/100 gagal; 90/60 lolos; 89/70 gagal; 120/59 gagal.
  - `alkohol`: 0 lolos; 0.01 gagal dengan alasan memuat "alkohol".
  - `input kosong`: sistolik null → gagal (alasan memuat "tekanan darah"); kadarAlkohol null → gagal; pandanganLolos null → gagal.
  - `SIM`: berlakuHingga = HARI → lolos; "2026-11-25" → gagal (alasan memuat "SIM"); berlakuHingga null satu-satunya → gagal; simDibawa false → gagal; sims kosong → gagal.
  - `peringatan SIM`: berlakuHingga "2026-12-20" (24 hari) → lolos dan `peringatan.length === 1`.
  - `statusSim`: "2026-12-26" → "hampir_habis" (30 hari, inklusif), "2026-12-27" → "berlaku", "2026-11-25" → "kedaluwarsa", null → "tanpa_tanggal".
  - `layakBerangkat`: null → false; `{Lolos:true,AmbilAlih:false}` → true; `{Lolos:false,AmbilAlih:true}` → true; `{Lolos:false,AmbilAlih:false}` → false.

- [ ] **Step 2: Jalankan, pastikan gagal**
  Run: `node --import tsx --test src/lib/__tests__/health-check-driver.test.ts`
  Expected: FAIL (modul tidak ditemukan)

- [ ] **Step 3: Implementasikan `src/lib/health-check-driver.ts`.** `simTerbaik` = SIM berstatus berlaku/hampir_habis dengan `berlakuHingga` terjauh. Perbandingan tanggal lewat string `YYYY-MM-DD`. Selisih hari dihitung dengan `Date.UTC` dari kedua tanggal. Alasan gagal berupa kalimat pendek Indonesia, mis. "Tekanan darah 160/80 di luar batas 90–159 / 60–99", "Kadar alkohol 0,01 (harus 0)", "Pandangan tidak lolos", "Tidak ada SIM yang masih berlaku", "SIM fisik tidak dibawa".

- [ ] **Step 4: Jalankan, pastikan lulus**
  Run: `node --import tsx --test src/lib/__tests__/health-check-driver.test.ts`
  Expected: semua PASS

- [ ] **Step 5: Commit**
  `git add src/lib/health-check-driver.ts src/lib/__tests__/health-check-driver.test.ts`
  `git commit -m "feat(health-check): modul penilaian kelayakan driver"`

### Task 2: Tabel, query, gerbang Selesai Muat, aksi server

**Files:**
- Create: `scripts/create-driver-health-check-table.ts`
- Create: `src/lib/queries/driver-health-check.ts`
- Modify: `src/lib/queries/kode-ambil-alih.ts` (union `aksi` tambah `"HEALTH_CHECK"`)
- Modify: `src/lib/queries/pengiriman-jadwal.ts` (`selesaiMuat`, setelah cek `!headerRow.SalesmanID`, ±baris 2565)
- Modify: `src/lib/queries/driver-profile.ts` (SIM jadi `SimDriver[]`)
- Modify: `src/app/mkesindo/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: Task 1 (`nilaiHealthCheck`, `layakBerangkat`, `hariIniWibISO`, `SimDriver`, `MasukanHealthCheck`, `HasilHealthCheck`).
- Produces:
  - `export interface HealthCheckRow { HealthCheckID: number; JadwalID: number; SalesmanID: string; Sistolik: number | null; Diastolik: number | null; KadarAlkohol: number | null; PandanganLolos: boolean | null; SimDibawa: boolean; SimBerlakuHingga: string | null; Lolos: boolean; AlasanGagal: string | null; Catatan: string | null; DiperiksaOlehAkunID: number; DiperiksaPada: string; AmbilAlih: boolean; AmbilAlihAlasan: string | null; AmbilAlihOlehAkunID: number | null; AmbilAlihPada: string | null }`
  - `getHealthCheckTerbaru(jadwalId: number, salesmanId: string): Promise<HealthCheckRow | null>`
  - `simpanHealthCheck(input: { jadwalId: number; salesmanId: string; masukan: Omit<MasukanHealthCheck, "sims">; catatan: string | null; akunId: number }): Promise<HealthCheckRow>`: menolak bila jadwal bukan Draft; membaca SIM dari DB (`getSimDriver`), menilai dengan `nilaiHealthCheck(…, hariIniWibISO())`, lalu INSERT dengan `AlasanGagal = alasanGagal.join("; ")`.
  - `ambilAlihHealthCheck(input: { jadwalId: number; salesmanId: string; kode: string; alasan: string; akunId: number }): Promise<HealthCheckRow>`: validasi alasan, baris terbaru ada & `Lolos = 0` & `AmbilAlih = 0` & jadwal Draft, BARU verifikasi kode, lalu UPDATE baris itu.
  - `assertDriverLayakBerangkat(jadwalId: number, salesmanId: string): Promise<void>`, melempar `AppError("Driver belum lolos Health Check untuk keberangkatan ini — lakukan Health Check, ganti driver, atau ambil alih dengan kode.")`.
  - `getSimDriver(salesmanId: string): Promise<SimDriver[]>` dan `simpanSimDriver(salesmanId: string, sims: SimDriver[]): Promise<void>` (di `driver-profile.ts`).
  - `DriverProfileRow.Sims: SimDriver[]` (mengganti `SimTypes: string[]`), `SaveDriverProfileInput.sims: SimDriver[]` (mengganti `simTypes`).
  - Aksi di `delivery/actions.ts`: `getHealthCheckTerbaruAction(jadwalId, salesmanId)`, `getSimDriverAction(salesmanId)`, `simpanSimDriverAction(salesmanId, sims)`, `simpanHealthCheckAction(input)`, `ambilAlihHealthCheckAction(input)`. Semuanya `ActionResult<…>` via `runAction` + `requireModuleAccess("delivery")`, dengan `revalidatePath("/mkesindo/delivery")` pada penulisan.

- [ ] **Step 1: Skrip tabel** idempoten (pola `scripts/create-mitra-cadangan-table.ts`): buat `DashboardDriverHealthCheck` dengan kolom persis seperti spec + indeks `(JadwalID, SalesmanID, HealthCheckID DESC)`. Tambah kolom `NomorSim VARCHAR(30) NULL`, `BerlakuHingga DATE NULL` ke `DashboardDriverSim` bila belum ada (`COL_LENGTH`).
- [ ] **Step 2: Jalankan skrip** `npx tsx scripts/create-driver-health-check-table.ts`. Expected: selesai tanpa galat; jalankan kedua kali juga tanpa galat.
- [ ] **Step 3: Query & SIM.** Tulis `driver-health-check.ts`; ubah `driver-profile.ts` (`getDriverProfiles` memuat 3 kolom SIM; `saveDriverProfile` menyimpan `sims` lewat `simpanSimDriver`); perluas union `aksi`.
- [ ] **Step 4: Gerbang** `await assertDriverLayakBerangkat(jadwalId, headerRow.SalesmanID)` di `selesaiMuat` sebelum cek rute.
- [ ] **Step 5: Aksi server** di `delivery/actions.ts`.
- [ ] **Step 6: Typecheck**
  Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`
  Expected: galat hanya di `driver-manager.tsx` (`SimTypes`/`simTypes`), yang diperbaiki di Task 3. Tidak boleh ada galat lain.
- [ ] **Step 7: Commit** (setelah Task 3 membuat typecheck bersih, gabungkan commit bila perlu)
  `git commit -m "feat(health-check): tabel riwayat, gerbang Selesai Muat, ambil-alih dengan kode"`

### Task 3: SIM per driver di Kelola Driver

**Files:**
- Modify: `src/components/dashboard/driver-manager.tsx` (bagian "No. SIM", ±baris 48–101, 189–215)

**Interfaces:**
- Consumes: `SimDriver`, `statusSim`, `hariIniWibISO` (Task 1); `DriverProfileRow.Sims`, `SaveDriverProfileInput.sims` (Task 2).
- Produces: `export function EditorSimDriver({ sims, onUbah }: { sims: SimDriver[]; onUbah: (s: SimDriver[]) => void })` di `src/components/dashboard/editor-sim-driver.tsx`, yang juga dipakai Task 4.

- [ ] **Step 1:** Buat `editor-sim-driver.tsx`: daftar baris (golongan teks pendek, nomor, tanggal berlaku), tambah/hapus baris, dan lencana status dari `statusSim` (Kedaluwarsa merah, ≤30 hari kuning).
- [ ] **Step 2:** Ganti chip SIM di `driver-manager.tsx` dengan `EditorSimDriver`; state `sims: SimDriver[]`.
- [ ] **Step 3: Typecheck + lint**
  Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` lalu `npx eslint src/components/dashboard/driver-manager.tsx src/components/dashboard/editor-sim-driver.tsx src/lib/queries/driver-health-check.ts src/lib/queries/driver-profile.ts`
  Expected: tsc bersih; eslint tanpa galat baru (galat setState-in-effect lama di `mitra-list.tsx` tidak relevan).
- [ ] **Step 4: Commit**
  `git commit -m "feat(health-check): SIM per driver (nomor & masa berlaku) di Kelola Driver"`

### Task 4: Tombol & dialog Health Check di Validasi Rute

**Files:**
- Create: `src/components/dashboard/health-check-dialog.tsx`
- Modify: `src/components/dashboard/route-validation-dialog.tsx` (dropdown driver ±baris 1568–1581; `canSelesaiMuat` ±1244; tombol Selesai Muat ±1715)

**Interfaces:**
- Consumes: aksi Task 2, `EditorSimDriver` (Task 3), `nilaiHealthCheck`/`layakBerangkat`/`hariIniWibISO` (Task 1), `HealthCheckRow`.
- Produces: `export function HealthCheckDialog({ open, onOpenChange, jadwalId, salesmanId, namaDriver, onSelesai }: { open: boolean; onOpenChange: (v: boolean) => void; jadwalId: number; salesmanId: string; namaDriver: string; onSelesai: (row: HealthCheckRow) => void })` dan `export function StatusHealthCheck({ row }: { row: HealthCheckRow | null })` (✓ hijau lolos, ✓ kuning "diambil alih", ✗ merah gagal, kosong bila null).

- [ ] **Step 1: Dialog.** Bagian: Tekanan darah (2 input angka + label lolos/gagal langsung via `nilaiHealthCheck`), Kadar alkohol (input angka, label "sesuai tampilan alat"), Pandangan (Lolos/Tidak lolos), SIM (`EditorSimDriver` dimuat dari `getSimDriverAction`; tombol simpan SIM memanggil `simpanSimDriverAction`; centang "SIM fisik dibawa"), Catatan opsional, Simpan → `simpanHealthCheckAction`. Bila hasil gagal: tampilkan `AlasanGagal` + tombol "Ganti driver" (tutup) dan "Ambil alih dengan kode" (input 6 digit + alasan wajib → `ambilAlihHealthCheckAction`).
- [ ] **Step 2: Integrasi.** State `healthCheck: HealthCheckRow | null`, dimuat ulang lewat `getHealthCheckTerbaruAction(jadwalId, driverId)` setiap `jadwalId`/`driverId` berubah (abaikan respons basi). Tombol "Health Check" (nonaktif bila `driverId === ""`) + `StatusHealthCheck` di samping Select driver. `canSelesaiMuat` ditambah `&& layakBerangkat(healthCheck)`, dengan petunjuk kecil "Driver belum lolos Health Check" saat Draf dan belum layak. Mode `capturing` (Bagikan) tidak menampilkan tombol.
- [ ] **Step 3: Typecheck + lint + tes**
  Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`; `npx eslint src/components/dashboard/health-check-dialog.tsx src/components/dashboard/route-validation-dialog.tsx`; `node --import tsx --test src/lib/__tests__/*.test.ts`
  Expected: tsc bersih; eslint hanya 2 galat lama "Cannot access refs during render" di `route-validation-dialog.tsx`; semua tes PASS.
- [ ] **Step 4: Verifikasi browser (tanpa menyimpan data).** Buka Pengiriman → jadwal Draf → tombol Health Check tampil di samping driver; Selesai Muat nonaktif dengan petunjuk; dialog terbuka; isi 160/80 → label gagal tampil langsung. Tutup tanpa Simpan. Ganti driver → status kosong. Screenshot.
- [ ] **Step 5: Commit**
  `git commit -m "feat(health-check): tombol & dialog Health Check driver di Validasi Rute"`
