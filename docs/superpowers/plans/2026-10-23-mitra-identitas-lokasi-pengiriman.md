# Mitra: Identitas, Alamat Mitra & Lokasi Pengiriman Ganda — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memisahkan identitas mitra dari lokasi pengiriman (banyak lokasi per mitra) di Es Kristal dan Es Balok, dengan NIK/berkas terlindung, master kompetitor, pemilihan lokasi per stop di Papan Pengiriman, dan alamat kirim yang dibekukan saat DO dibuat.

**Architecture:** Hibrida. Lokasi pengiriman tambahan + alamat mitra disimpan di tabel pendamping di setiap DB ERP (MSSQL), sedangkan lokasi utama tetap berada di kolom ERP yang ada + `DashboardMitraLocation`/`DashboardAgenLocation` (invarian: kolom lama = lokasi utama). Identitas sensitif dan master kompetitor disimpan di Postgres pusat. Stop Jadwal menyimpan `LokasiPengirimanID` (NULL = utama) dan snapshot alamat yang diisi saat DO dibuat.

**Tech Stack:** Next.js 16 (App Router, Server Actions), `mssql` via `getPool()`/`getCompanyPool()`, Postgres via `getPgPool()`, Google Drive via `src/lib/storage/google-drive.ts`, Leaflet, `node:test` + `tsx` untuk logika murni.

**Spec:** `docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md`. Baca spec ini dulu, karena rencana berargumen dari sana.

## Global Constraints

- Semua teks UI dalam Bahasa Indonesia. Pesan commit dalam Bahasa Indonesia (subjek + isi), tanpa trailer Co-Authored-By.
- Kerjakan langsung di branch `main` (pola proyek ini), tanpa worktree.
- Sebelum menulis kode Next.js, baca panduan terkait di `node_modules/next/dist/docs/` (AGENTS.md). Ini Next 16, dan middleware ada di `middleware.ts`.
- **Invarian:** kolom ERP lama selalu berisi lokasi pengiriman utama:
  - Es Kristal: `BusinessPartner.Address/NPWPName/NPWPAddress/MobileNo` + `DashboardMitraLocation`.
  - Es Balok: `PMP_AgenDetail.Address1/RegionID` + `PMP_Agen.Telepon` + `DashboardAgenLocation`.
  - Lokasi utama **tidak pernah** ditulis ke tabel lokasi tambahan.
- `DashboardPengirimanJadwalDetail.LokasiPengirimanID` NULL = lokasi utama.
- Es Balok: satu-satunya penentu DB fisik adalah `resolveAgenKoneksi(kode, sumber)`. Kunci Postgres untuk Es Balok memakai kode **fisik** hasil fungsi itu.
- Hak lihat/ubah identitas (NIK + berkas NIK + SK): Super Admin, akun Direktur (`accountScope === "direktur"`), atau izin `mitra_identitas`. Ditegakkan di server: tanpa hak, nilai NIK dan file_id tidak pernah dikirim ke client.
- Berkas identitas: JPG/PNG/WEBP/PDF, maks 5 MB. Tidak boleh lewat `/api/files` dan tidak boleh memakai fallback disk lokal. Respons baca memakai `Cache-Control: private, no-store`.
- Verifikasi setiap task: `npx tsc --noEmit` nol error + `npx eslint <file yang diubah>`. Logika murni diuji dengan `npx tsx --test <file>`. Task yang menyentuh data juga diverifikasi langsung di dev server (`preview_start` dengan nama `dev`).
- DDL harus aditif dan idempoten (`IF NOT EXISTS`), mengikuti pola `scripts/create-retur-resale-schema.ts`.
- Perbaikan data: dry-run JSON ke `docs/data-fixes/` → ditinjau pengguna → `scripts/fix-*` + `scripts/revert-*`.

## Review Focus

1. **Mitra lama tanpa perubahan apa pun** harus tampil dan menyimpan persis seperti sebelumnya: kotak tidak dicentang, alamat dan pin sama, dan angka laporan wilayah/marketing tidak bergeser. → tes `normalisasiMitraForm` di Task 2 + verifikasi langsung di Task 6.
2. **Lokasi tambahan yang belum dipin dipilih untuk sebuah stop** tidak boleh diam-diam memakai pin utama. Stop harus tampil sebagai "belum ada pin", supaya sopir tidak dikirim ke tempat lain. → tes `pilihLokasiStop` di Task 2.
3. **Pengguna tanpa izin membuka URL berkas NIK/SK langsung**, atau berkas itu tersimpan di cache publik, maka hasilnya harus 403/404 dan tidak ter-cache. → langkah verifikasi Task 5.
4. **"Jadikan Utama" atau edit lokasi setelah DO dibuat** tidak boleh mengubah cetak ulang DO lama. → tes `pilihLokasiStop` (snapshot menang) di Task 2 + verifikasi langsung di Task 8.
5. **Teks kompetitor lama yang berantakan** ("Kristal Jaya, es kristal jaya; Tirta dan Segar") harus jadi nama unik tanpa duplikat beda huruf besar-kecil. → tes `pecahTeksKompetitor` di Task 2.

---

### Task 0: Pemeriksaan awal data live (tanpa mengubah apa pun)

**Files:**
- Create: `scripts/diag-mitra-lokasi-preflight-2026-10-23.ts`

**Interfaces:** Produces `docs/data-fixes/2026-10-23-mitra-lokasi-preflight.json`, dipakai oleh Task 9 (keputusan duplikasi kartu Es Balok).

- [ ] **Step 1: Tulis skrip SELECT-only** yang, untuk kelima DB Es Balok (lewat `getCompanyPool` sesuai daftar `TARGETS` di `docs/superpowers/plans/2026-09-24-mitra-es-balok.md` Task 2), menghitung Agen yang punya >1 baris `PMP_AgenDetail` aktif (dengan contoh AgenID). Untuk Es Kristal, skrip menghitung:
  - mitra yang `JoinDate`-nya NULL;
  - jumlah baris `DashboardMitraCompetitor` berisi (data live 2026-10-23: 67);
  - DO yang `AddressDelivery`-nya tidak kosong (data live: 765, dari ERP lama 2018–2026).
- [ ] **Step 2: Jalankan** `npx tsx scripts/diag-mitra-lokasi-preflight-2026-10-23.ts`. Expected: JSON tertulis. **Kalau ada Agen dengan >1 AgenDetail aktif, berhenti dan laporkan ke pengguna** sebelum Task 9.
- [ ] **Step 3: Rekam baseline laporan.** Skrip yang sama menyimpan hasil `getMitraGrowthByWilayah()` dan pemilik marketing efektif per mitra (`getMitraList()` → `BusinessPartnerID, Wilayah, Kecamatan, MarketingNama`) ke `docs/data-fixes/2026-10-23-mitra-lokasi-baseline.json`. Hasil ini dipakai Task 11.
- [ ] **Step 4: Commit** `chore(mitra): diagnosa awal dan baseline lokasi pengiriman`.

---

### Task 1: Skema database (MSSQL Es Kristal + Es Balok, Postgres)

**Files:**
- Create: `scripts/create-mitra-lokasi-identitas-schema.ts`

**Interfaces — Produces (dipakai semua task berikutnya):**
- **Setiap DB Es Kristal** (semua kode di `tenantEskristalKodes()` lewat `getCompanyPool(kode,"utama")`, ditambah demokristal):
  - `DashboardMitraAlamat` (kolom sesuai spec §6.1).
  - `DashboardMitraLokasiPengiriman` (spec §6.1, `LokasiPengirimanID INT IDENTITY`, index pada `BusinessPartnerID`).
  - `DashboardPengirimanJadwalDetail` ditambah kolom: `LokasiPengirimanID INT NULL`, `KirimAlamat VARCHAR(1024) NULL`, `KirimWilayah VARCHAR(128) NULL`, `KirimKecamatan VARCHAR(128) NULL`, `KirimKontak VARCHAR(128) NULL`, `KirimLatitude DECIMAL(10,7) NULL`, `KirimLongitude DECIMAL(10,7) NULL`, `KirimDibekukanAt DATETIME NULL`. `KirimDibekukanAt` bukan NULL = snapshot berlaku.
  - `DashboardMitraPengajuan` ditambah kolom `KompetitorIDs VARCHAR(512) NULL` (CSV id Postgres).
- **Kelima DB Es Balok:**
  - `DashboardAgenAlamat` (`AgenID` PK + kolom yang sama).
  - `DashboardAgenLokasiPengiriman` (`AgenID` + kolom yang sama).
  - Pengecualian untuk kedua tabel ini: kolom `Wilayah` diganti `WilayahID VARCHAR(16)` (merujuk `PMP_Wilayah.WilayahID`, sama dengan `PMP_AgenDetail.RegionID`). Di sisi TS, `AlamatFields.wilayah` membawa WilayahID untuk Es Balok.
  - `DashboardAgenProfil` ditambah `Kecamatan VARCHAR(128) NULL`.
- **Postgres:** `mitra_identitas`, `kompetitor` (dengan `holding_kode`), `mitra_kompetitor`, persis seperti spec §6.3.

- [ ] **Step 1: Tulis skrip idempoten.** Satu fungsi per target. Setiap `CREATE`/`ALTER` dijaga `IF NOT EXISTS`. Cetak "siap" per tabel per DB.
- [ ] **Step 2: Jalankan** `npx tsx scripts/create-mitra-lokasi-identitas-schema.ts` dua kali. Expected: run kedua tidak mengubah apa pun dan tidak error.
- [ ] **Step 3: Verifikasi** dengan `SELECT` ke `sys.columns` untuk tiap tabel di tiap DB, dan `\d` di Postgres. Pastikan kolom sesuai.
- [ ] **Step 4: Tambahkan tabel baru** ke `scripts/saas-dump-eskristal-schema.ts` (dan provisioning tenant bila daftar tabelnya eksplisit). Commit `feat(mitra): skema lokasi pengiriman, alamat mitra, identitas, kompetitor`.

---

### Task 2: Logika murni (client-safe) + tes

**Files:**
- Create: `src/lib/mitra-lokasi.ts`, `src/lib/__tests__/mitra-lokasi.test.ts`

**Interfaces — Produces:**
```ts
export interface AlamatFields { wilayah: string | null; kecamatan: string | null; alamat: string | null; kontak: string | null }
export interface PinFields { latitude: number | null; longitude: number | null; geoAlamat: string | null }
export interface LokasiTambahanInput extends AlamatFields, PinFields { lokasiPengirimanId: number | null; label: string | null }
export interface MitraAlamatForm {
  lokasiBerbeda: boolean;
  alamatMitra: AlamatFields & PinFields;      // pin dipakai hanya bila !lokasiBerbeda
  lokasiUtama: AlamatFields & PinFields;      // diabaikan bila !lokasiBerbeda
  lokasiTambahan: LokasiTambahanInput[];      // harus [] bila !lokasiBerbeda
}
export interface MitraAlamatTernormalisasi {
  utama: AlamatFields & PinFields;            // → kolom ERP + pin
  alamatMitra: AlamatFields | null;           // → Dashboard*Alamat; null = hapus baris
  tambahan: LokasiTambahanInput[];
}
export function normalisasiMitraForm(f: MitraAlamatForm): MitraAlamatTernormalisasi; // throws Error("Wilayah lokasi utama wajib diisi")
export interface StopLokasiSumber { snapshot: (AlamatFields & { latitude: number|null; longitude: number|null }) | null; dipilih: (AlamatFields & PinFields) | null; lokasiDipilihId: number | null; utama: AlamatFields & PinFields }
export function pilihLokasiStop(s: StopLokasiSumber): AlamatFields & { latitude: number | null; longitude: number | null; sumber: "snapshot" | "dipilih" | "utama" };
export function pecahTeksKompetitor(teks: string | null): string[];
```

- [ ] **Step 1: Tulis tes yang gagal** (`node:test` + `assert/strict`, gaya `src/lib/penagihan/__tests__/logika.test.ts`):
  - `normalisasiMitraForm: tidak dicentang → utama = alamatMitra (termasuk pin), alamatMitra null, tambahan []`
  - `normalisasiMitraForm: tidak dicentang tapi tambahan terisi → tambahan dibuang`
  - `normalisasiMitraForm: dicentang → utama = lokasiUtama, alamatMitra tanpa pin`
  - `normalisasiMitraForm: wilayah utama kosong/spasi → throw "Wilayah lokasi utama wajib diisi"`
  - `pilihLokasiStop: snapshot ada → sumber "snapshot", walau dipilih/utama berbeda`
  - `pilihLokasiStop: lokasiDipilihId ada, dipilih tanpa pin → latitude/longitude null, sumber "dipilih" (TIDAK jatuh ke pin utama)`
  - `pilihLokasiStop: lokasiDipilihId null → utama`
  - `pecahTeksKompetitor("Kristal Jaya, es kristal jaya; Tirta dan Segar\nKristal Jaya") → ["Kristal Jaya","Tirta","Segar"]` (dedupe tanpa beda huruf besar-kecil, pertahankan ejaan kemunculan pertama, pemisah `,` `;` baris baru dan kata ` dan `)
  - `pecahTeksKompetitor(null) → []`, `pecahTeksKompetitor("  ") → []`
- [ ] **Step 2: Jalankan** `npx tsx --test src/lib/__tests__/mitra-lokasi.test.ts`. Expected: FAIL (modul belum ada).
- [ ] **Step 3: Implementasi** di `src/lib/mitra-lokasi.ts`. Tanpa import `mssql`/`pg`, karena modul ini diimpor oleh komponen client.
- [ ] **Step 4: Jalankan tes.** Expected: semua PASS.
- [ ] **Step 5: Commit** `feat(mitra): logika normalisasi alamat, pemilihan lokasi stop, pemecah kompetitor`.

---

### Task 3: Izin `mitra_identitas` + akses Direktur

**Files:**
- Modify: `src/lib/permissions.ts`, `src/lib/queries/akun.ts` (`getPermissionMapForPeran`, `setPeranIzin`, `getAllPeranIzin`), `src/components/dashboard/peran-editor.tsx`, `src/app/grup/akun/peran/actions.ts`
- Test: `src/lib/__tests__/permissions-identitas.test.ts`

**Interfaces — Produces:**
```ts
// src/lib/permissions.ts
export const SPECIAL_PERMISSION_KEYS = ["mitra_identitas"] as const;
export type SpecialPermissionKey = (typeof SPECIAL_PERMISSION_KEYS)[number];
export const SPECIAL_PERMISSION_LABEL: Record<SpecialPermissionKey, string> = { mitra_identitas: "Identitas Mitra (NIK & Berkas)" };
export type PermissionMap = Partial<Record<ModuleKey | SpecialPermissionKey, ModulePermission>>;
export function aksesIdentitasMitra(user: { isSuperAdmin: boolean; accountScope?: string | null; permissions?: PermissionMap }): { lihat: boolean; ubah: boolean };
```
`fullPermissionMap()` juga menyertakan `mitra_identitas`. Sidebar tetap hanya membaca `MODULE_KEYS`.

- [ ] **Step 1: Tulis tes gagal** untuk `aksesIdentitasMitra`:
  - Super Admin → `{lihat:true, ubah:true}`.
  - `accountScope:"direktur"` dengan permissions `{}` → `{true,true}`.
  - Peran dengan `mitra_identitas {canView:true, canEdit:false}` → `{true,false}`.
  - Peran tanpa kunci → `{false,false}`.
  - `permissions` undefined → `{false,false}`.
- [ ] **Step 2: Jalankan** `npx tsx --test src/lib/__tests__/permissions-identitas.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasi** di `permissions.ts`. Perluas filter di `getPermissionMapForPeran` agar menerima `MODULE_KEYS ∪ SPECIAL_PERMISSION_KEYS`, dan perluas tipe parameter `setPeranIzin.moduleKey`.
- [ ] **Step 4: Tambah bagian "Izin Khusus"** di `peran-editor.tsx` di bawah grid modul. Satu baris per `SPECIAL_PERMISSION_KEYS` dengan kotak Lihat/Ubah, memakai action yang sama.
- [ ] **Step 5: Jalankan tes** (PASS) + `tsc` + `eslint`. Verifikasi langsung: centang izin untuk satu peran di /grup/akun/peran, muat ulang halaman, lalu pastikan centangnya tetap tersimpan.
- [ ] **Step 6: Commit** `feat(akun): izin khusus Identitas Mitra (NIK & berkas), Direktur selalu boleh`.

---

### Task 4: Query lapisan data — Es Kristal lokasi, identitas, kompetitor

**Files:**
- Create: `src/lib/queries/mitra-lokasi-pengiriman.ts`, `src/lib/queries/mitra-identitas.ts`, `src/lib/queries/kompetitor.ts`
- Modify: `src/lib/queries/mitra.ts` (`createMitra`, `updateMitra` menerima executor opsional; `MitraRow` + `getMitraList`/`getMitraDetail` diperluas), `src/lib/queries/mitra-location.ts` (`setMitraLocation` menerima executor opsional)

**Interfaces:**
- Consumes: Task 1 (tabel), Task 2 (`MitraAlamatTernormalisasi`, `LokasiTambahanInput`, `AlamatFields`, `PinFields`).
- Produces:
```ts
// mitra.ts — tanda tangan lama tetap kompatibel (pengajuan & aplikasi pemasaran tetap jalan)
type Exec = sql.ConnectionPool | sql.Transaction;
export async function createMitra(input: MitraInput, exec?: Exec): Promise<string>;
export async function updateMitra(id: string, input: MitraInput, exec?: Exec): Promise<void>;
// MitraRow ditambah: LokasiBerbeda: boolean; AlamatMitra: AlamatFields | null; LokasiTambahan: LokasiPengirimanRow[]
//   (getMitraList memuat semua tambahan aktif dalam SATU query lalu dikelompokkan di JS, bukan N+1)

// mitra-lokasi-pengiriman.ts
export interface LokasiPengirimanRow extends AlamatFields, PinFields { LokasiPengirimanID: number; Urutan: number; Label: string | null; IsDeleted: boolean }
export async function simpanAlamatDanLokasiMitra(tx: sql.Transaction, bpId: string, n: MitraAlamatTernormalisasi, userId: string): Promise<void>;
export async function jadikanLokasiUtama(bpId: string, lokasiPengirimanId: number, userId: string): Promise<void>;
export async function getLokasiPilihanStop(bpIds: string[]): Promise<Map<string, { id: number | null; label: string }[]>>; // null = Utama
export async function assertLokasiTidakDipakaiJadwalTerbuka(exec: Exec, lokasiIds: number[]): Promise<void>; // AppError("Lokasi … masih dipakai Jadwal yang belum jadi DO")
export const STOP_LOKASI_JOIN: (jdAlias: string, soAlias: string) => string;  // LEFT JOIN DashboardMitraLocation ml + DashboardMitraLokasiPengiriman lp
export const STOP_LOKASI_COLUMNS: (jdAlias: string) => string;               // StopAlamat, StopWilayah, StopKecamatan, StopKontak, StopLatitude, StopLongitude, StopLokasiSumber

// mitra-identitas.ts (Postgres)
export interface IdentitasKunci { perusahaanKode: string; sumber: "utama" | "logistik"; partnerId: string }
export interface IdentitasMitra { namaPenanggungJawab: string | null; nik: string | null; punyaBerkasNik: boolean; punyaBerkasSk: boolean; skNamaFile: string | null; tanggalPendaftaran: string | null }
export async function getIdentitasMitra(k: IdentitasKunci, bolehLihat: boolean): Promise<IdentitasMitra>; // bolehLihat=false → nik=null & tanpa info berkas
export async function getPenanggungJawabMap(perusahaanKode: string, sumber: "utama" | "logistik"): Promise<Map<string, string>>;
export async function simpanIdentitasMitra(k: IdentitasKunci, v: { namaPenanggungJawab: string | null; nik?: string | null }, userId: string): Promise<void>; // nik undefined = jangan sentuh
export async function setBerkasIdentitas(k: IdentitasKunci, jenis: "nik" | "sk", berkas: { fileId: string; nama: string; mime: string } | null, userId: string): Promise<{ fileIdLama: string | null }>;
export async function getBerkasIdentitas(k: IdentitasKunci, jenis: "nik" | "sk"): Promise<{ fileId: string; nama: string; mime: string } | null>;

// kompetitor.ts (Postgres)
export type BisnisKompetitor = "es_kristal" | "es_balok";
export interface Kompetitor { id: number; nama: string }
export async function listKompetitor(holdingKode: string, bisnis: BisnisKompetitor): Promise<Kompetitor[]>;
export async function tambahKompetitor(holdingKode: string, bisnis: BisnisKompetitor, nama: string, userId: string): Promise<Kompetitor>; // nama sudah ada (tanpa beda huruf besar-kecil) → kembalikan yang ada
export async function getKompetitorMitraMap(perusahaanKode: string, sumber: "utama"|"logistik"): Promise<Map<string, Kompetitor[]>>;
export async function setKompetitorMitra(k: IdentitasKunci, kompetitorIds: number[]): Promise<void>; // ganti seluruh set
```

Aturan `STOP_LOKASI_COLUMNS` (spec §6.1, cermin `pilihLokasiStop`):
- Bila `jd.KirimDibekukanAt IS NOT NULL` → pakai kolom `Kirim*`.
- Selain itu, bila `jd.LokasiPengirimanID IS NOT NULL` → pakai kolom `lp.*`, **tanpa** fallback ke `ml`.
- Selain itu → `bp.*` + `ml.*`.
- `StopLokasiSumber` bernilai `'snapshot' | 'dipilih' | 'utama'`.

Perilaku `simpanAlamatDanLokasiMitra`, semua dalam `tx`:
1. Upsert/hapus `DashboardMitraAlamat` sesuai `n.alamatMitra`.
2. Sinkronkan lokasi tambahan: baris dengan `lokasiPengirimanId` → UPDATE; baris tanpa id → INSERT dengan Urutan = urutan array + 2; id lama yang tidak ada di input → cek dulu `assertLokasiTidakDipakaiJadwalTerbuka`, lalu `IsDeleted = 1`.

Kolom ERP + pin ditulis oleh pemanggil lewat `updateMitra(…, tx)` + `setMitraLocation(…, tx)` dengan nilai `n.utama`.

Perilaku `jadikanLokasiUtama` dalam satu transaksi (spec §8):
1. Baca utama (bp + ml) dan baris lokasi target.
2. INSERT baris tambahan baru berisi utama lama.
3. Tulis isi target ke kolom ERP + `DashboardMitraLocation`.
4. Soft-delete baris target.
5. Kembalikan wilayah lama dan baru supaya UI bisa memberi peringatan bila wilayahnya berbeda.

- [ ] **Step 1: Implementasi** sesuai tanda tangan di atas. Untuk `getMitraList`, satu query tambahan `SELECT … FROM DashboardMitraLokasiPengiriman WHERE IsDeleted=0` + `DashboardMitraAlamat`, lalu digabung di JS.
- [ ] **Step 2: Verifikasi** dengan `tsc` + `eslint`. Lalu jalankan skrip sekali-pakai `scripts/_scratch_uji_lokasi.ts` (tidak di-commit) di DB **demokristal** untuk menguji:
  - mitra uji: simpan dengan kotak dicentang + 2 lokasi tambahan;
  - `jadikanLokasiUtama`;
  - hapus lokasi.

  Setelah tiap langkah, SELECT dan pastikan kolom ERP selalu sama dengan utama. Bersihkan mitra uji.
- [ ] **Step 3: Commit** `feat(mitra): lapisan data lokasi pengiriman, identitas, dan kompetitor`.

---

### Task 5: Rute berkas identitas (unggah, baca, hapus)

**Files:**
- Create: `src/app/api/mitra-berkas/route.ts` (POST unggah, DELETE hapus), `src/app/api/mitra-berkas/[kode]/[sumber]/[partnerId]/[jenis]/route.ts` (GET baca)
- Modify: `src/lib/storage/google-drive.ts`: tambah `uploadFileWajibDrive(...)` (sama seperti `uploadFile` tapi melempar `AppError("Google Drive perusahaan belum terhubung…")`, bukan fallback disk) dan `deleteFile(perusahaanKode, fileId)` bila belum ada.

**Interfaces:**
- Consumes: Task 3 `aksesIdentitasMitra`, Task 4 `setBerkasIdentitas`/`getBerkasIdentitas`, `auth()`.
- Produces: `POST /api/mitra-berkas` (formData: `file`, `kode`, `sumber`, `partnerId`, `jenis` = `nik|sk`) → `{ ok: true, nama }`; `DELETE /api/mitra-berkas?kode=&sumber=&partnerId=&jenis=`; `GET /api/mitra-berkas/{kode}/{sumber}/{partnerId}/{jenis}` → isi berkas.

Aturan:
- Semua handler menolak tanpa sesi (401) dan tanpa hak (`ubah` untuk POST/DELETE, `lihat` untuk GET → 403).
- `kode` divalidasi: Es Kristal harus sama dengan `currentEskristalKode()`. Es Balok harus kode fisik hasil `resolveAgenKoneksi`, dan akun harus berscope PMP (`isPmpScope`).
- Folder Drive `["mitra-identitas", kode, partnerId]`.
- GET memakai header `Cache-Control: private, no-store` dan `Content-Disposition: inline`.
- Unggah ulang mengganti berkas lama; berkas lama dihapus dari Drive setelah DB berhasil diperbarui.

- [ ] **Step 1: Implementasi** ketiga handler + dua helper Drive.
- [ ] **Step 2: Verifikasi langsung:**
  - Sebagai Super Admin, unggah JPG ke mitra uji, buka URL GET → tampil, dan header berisi `private, no-store`.
  - Logout, buka URL yang sama → 401.
  - Login sebagai peran tanpa izin → 403.
  - Unggah file 6 MB atau `.txt` → ditolak dengan pesan Bahasa Indonesia.
  - Pada tenant tanpa Drive (demokristal bila belum terhubung) → ditolak, dan tidak ada file baru di `public/uploads`.
- [ ] **Step 3: Commit** `feat(mitra): rute berkas identitas privat (NIK & SK)`.

---

### Task 6: Form & halaman Mitra Es Kristal

**Files:**
- Create:
  - `src/components/dashboard/mitra-form/mitra-identitas-section.tsx` (Nama Mitra | Penanggung Jawab; NIK + berkas | Tanggal Pendaftaran + SK)
  - `src/components/dashboard/mitra-form/lokasi-pengiriman-section.tsx` (kotak centang + daftar lokasi [+], tombol pin per baris memakai `MitraLocationField`, tombol "Jadikan Utama", tombol hapus)
  - `src/components/dashboard/mitra-form/kompetitor-picker.tsx` (multi-pilih dari master + [+] tambah baru; dipakai juga di Task 9 & 10 dengan prop `bisnis`)
  - `src/components/dashboard/mitra-form/berkas-identitas-field.tsx` (Unggah/Hapus/Pratinjau; gambar inline, PDF di tab baru; pakai rute Task 5)
- Modify: `src/components/dashboard/mitra-list.tsx` (`MitraFormDialog` disusun ulang sesuai spec §2; kartu daftar menampilkan jumlah lokasi), `src/components/dashboard/mitra-detail-dialog.tsx`, `src/components/dashboard/mitra-edit-dialog.tsx`, `src/app/mkesindo/(dashboard)/mitra/actions.ts`, `src/app/mkesindo/(dashboard)/mitra/page.tsx`, `src/components/dashboard/mitra-locations-panel.tsx` / `mitra-locations-map.tsx` (titik per lokasi; popup "Nama Mitra — Label/Utama")

**Interfaces:**
- Consumes: Task 2, 3, 4, 5.
- Produces (server actions di `mkesindo/(dashboard)/mitra/actions.ts`):
```ts
export interface MitraLengkapInput extends MitraAlamatForm {
  mitra: Omit<MitraInput, "mobileNo" | "address" | "wilayah" | "kecamatan">; // nama, gender/segmentasi, priceLevel, termOfPaymentId, capacity
  namaPenanggungJawab: string | null;
  nik?: string | null;          // hanya dikirim bila pengguna punya hak ubah
  kompetitorIds: number[];
}
export async function simpanMitraLengkapAction(id: string | null, input: MitraLengkapInput): Promise<ActionResult<string>>;
export async function jadikanLokasiUtamaAction(bpId: string, lokasiPengirimanId: number): Promise<ActionResult<{ wilayahLama: string | null; wilayahBaru: string | null }>>;
export async function tambahKompetitorAction(bisnis: BisnisKompetitor, nama: string): Promise<ActionResult<Kompetitor>>;
export async function getIdentitasMitraAction(bpId: string): Promise<ActionResult<IdentitasMitra>>;
```

`simpanMitraLengkapAction` berjalan dalam urutan ini:
1. `normalisasiMitraForm`.
2. Transaksi MSSQL: `createMitra`/`updateMitra` dengan alamat utama, lalu `setMitraLocation` utama (lewati bila pin utama kosong), lalu `simpanAlamatDanLokasiMitra`. Commit.
3. Postgres: `simpanIdentitasMitra` (field `nik` hanya bila `aksesIdentitasMitra().ubah`; selain itu `undefined`) + `setKompetitorMitra`.
4. Bila langkah 3 gagal setelah langkah 2 berhasil → kembalikan error "Data mitra tersimpan, tetapi identitas/kompetitor gagal disimpan — coba simpan ulang."

Aturan tampilan:
- Tata letak baris persis spec §2. Kapasitas Harian berada di sebelah Daftar Kompetitor.
- "Tanggal Pendaftaran" dari `JoinDate`, read-only, "—" bila NULL.
- Tanpa hak `lihat`, NIK tampil "Tersembunyi" dan tombol berkas tidak muncul. Tanpa hak `ubah`, input NIK dan unggah dinonaktifkan.
- Hapus centang saat ada lokasi tambahan → dialog konfirmasi berisi teks spec §8.
- "Jadikan Utama" → bila `wilayahLama !== wilayahBaru`, tampilkan peringatan bahwa marketing penanggung jawab & laporan wilayah ikut pindah.
- Peta: filter "pin" tetap memakai lokasi utama.

- [ ] **Step 1: Bangun komponen bagian** + susun ulang `MitraFormDialog`. Field `rowToForm`/`rowToLocation` disesuaikan ke `MitraLengkapInput`.
- [ ] **Step 2: Bangun action** + ganti panggilan create/update/setLocation/setCompetitor di form ke `simpanMitraLengkapAction`. `setMitraCompetitorAction` dihapus bila tidak ada pemanggil lain (grep dulu).
- [ ] **Step 3: Peta multi-pin.**
- [ ] **Step 4: Verifikasi langsung** di dev server (`/mkesindo/mitra`):
  - (a) Mitra lama dibuka lalu disimpan tanpa perubahan → SELECT `BusinessPartner` + `DashboardMitraLocation` sebelum & sesudah identik (kecuali `ModifiedDate`); `DashboardMitraAlamat` & lokasi tambahan tetap 0 baris.
  - (b) Centang kotak + 2 lokasi + pin → peta menampilkan 3 pin.
  - (c) Jadikan Utama lokasi ke-2 yang beda wilayah → peringatan muncul, dan `NPWPName` berubah.
  - (d) Hapus centang → konfirmasi, lalu lokasi tambahan ter-soft-delete.
  - (e) Kompetitor baru via [+] muncul di dropdown mitra lain.
  - (f) Login sebagai peran tanpa izin identitas → NIK "Tersembunyi". Respons action di tab Network tidak berisi NIK.
  - Ambil screenshot.
- [ ] **Step 5: Commit** `feat(mitra): form Mitra Es Kristal baru — identitas, lokasi pengiriman ganda, kompetitor`.

---

### Task 7: Migrasi kompetitor Es Kristal

**Files:**
- Create: `scripts/diag-kompetitor-mitra-2026-10-23.ts` (dry-run), `scripts/fix-kompetitor-mitra-2026-10-23.ts`, `scripts/revert-kompetitor-mitra-2026-10-23.ts`

**Interfaces:** Consumes Task 2 `pecahTeksKompetitor`, Task 4 `tambahKompetitor`/`setKompetitorMitra`.

- [ ] **Step 1: Dry-run.** Untuk setiap holding PMP (holding `pmp`, kode `mkesindo`), baca `DashboardMitraCompetitor`, pecah teksnya, lalu tulis `docs/data-fixes/2026-10-23-kompetitor-mitra-dryrun.json` berisi `{ namaUnik: { nama, mitra: [id,…] }[], perMitra: { bpId, teksAsli, hasil: string[] }[] }`. Jalankan, lalu **minta pengguna meninjau dan menyatukan ejaan** (mereka boleh menyunting file `…-disetujui.json` hasil salinan).
- [ ] **Step 2: Skrip fix** membaca `…-disetujui.json`, mengisi `kompetitor` + `mitra_kompetitor`, lalu menulis `…-posted.json` (id yang dibuat). Skrip revert menghapus tepat id tersebut. `DashboardMitraCompetitor` tidak disentuh.
- [ ] **Step 3: Jalankan fix setelah disetujui pengguna.** Verifikasi: jumlah mitra yang punya ≥1 kompetitor = jumlah mitra dengan teks tidak kosong (live: 67). Spot-check 3 mitra di UI.
- [ ] **Step 4: Commit** `fix(data): migrasi kompetitor mitra ke master terstruktur`.

---

### Task 8: Papan Pengiriman, snapshot per stop, cetak

**Files:**
- Modify:
  - `src/lib/queries/pengiriman-jadwal.ts`: 5 JOIN pin di sekitar baris 558, 787, 888, 1101 dan daftar stop 878–891 diganti `STOP_LOKASI_JOIN`/`STOP_LOKASI_COLUMNS`; `insertJadwalDetailRows` (DO eksternal → bekukan utama); `selesaiMuat` di sekitar baris 2506 (bekukan saat `DeliveryOrderID` diisi + tulis `DeliveryOrder.AddressDelivery`); fungsi baru `setJadwalDetailLokasi`.
  - `src/lib/queries/laporan-shift-pengiriman.ts:88`, `src/lib/queries/satpam-inspeksi-shift.ts:48`, `src/lib/queries/delivery-order-print.ts:42`, `src/lib/queries/thermal-receipt.ts:62`.
  - Komponen kartu stop di Papan Pengiriman (cari pemanggil `addSalesOrdersToJadwal`/`updateJadwalUrutan` di `src/components/dashboard/`) + action-nya.
- Create: `scripts/diag-backfill-snapshot-stop-2026-10-23.ts`, `scripts/fix-backfill-snapshot-stop-2026-10-23.ts`, `scripts/revert-backfill-snapshot-stop-2026-10-23.ts`

**Interfaces:**
- Consumes: Task 4 `STOP_LOKASI_JOIN`, `STOP_LOKASI_COLUMNS`, `getLokasiPilihanStop`, `assertLokasiTidakDipakaiJadwalTerbuka`.
- Produces:
```ts
export async function setJadwalDetailLokasi(jadwalDetailId: number, lokasiPengirimanId: number | null): Promise<void>; // AppError bila stop sudah dibekukan atau lokasi bukan milik mitra SO tsb
async function bekukanLokasiStop(tx: sql.Transaction, jadwalDetailId: number): Promise<{ alamat: string | null }>; // isi Kirim* dari pilihan saat ini; idempoten (tidak menimpa yang sudah beku)
```

Aturan:
- Pemilih lokasi hanya muncul untuk stop yang mitranya punya >1 lokasi dan belum dibekukan. Pilihan "Utama" = NULL.
- `bekukanLokasiStop` dipanggil di transaksi yang sama dengan pengisian `DeliveryOrderID`: `selesaiMuat` dan `insertJadwalDetailRows` saat `deliveryOrderId` tidak null.
- Nilai alamat beku juga ditulis ke `DeliveryOrder.AddressDelivery`, dipotong 150 karakter (lebar kolom live). Nilai `''` lama tidak dipertahankan.
- Cetak DO & struk: JOIN `DashboardPengirimanJadwalDetail jd ON jd.DeliveryOrderID = do.DeliveryOrderID AND jd.IsDeleted = 0`, lalu `STOP_LOKASI_COLUMNS`. DO tanpa Jadwal → `bp.Address`.
- Pengelompokan wilayah/kecamatan stop (sekitar baris 781–800) memakai `StopWilayah`/`StopKecamatan`.
- Backfill: dry-run hitung JadwalDetail `DeliveryOrderID IS NOT NULL AND KirimDibekukanAt IS NULL`, lalu tulis contoh ke `docs/data-fixes/`. Fix mengisi `Kirim*` dari `bp.*`+`ml.*` saat ini, dengan `KirimDibekukanAt = '1900-01-01'` sebagai penanda backfill. Revert mengosongkan baris yang bertanda itu. **`DeliveryOrder.AddressDelivery` tidak di-backfill** (DO lama tidak diubah).

- [ ] **Step 1: Ganti semua JOIN pin/alamat stop.** Setelah itu, `grep -n "DashboardMitraLocation" src/lib/queries/pengiriman-jadwal.ts src/lib/queries/laporan-shift-pengiriman.ts src/lib/queries/satpam-inspeksi-shift.ts` hanya boleh menyisakan pemakaian lewat helper.
- [ ] **Step 2: `bekukanLokasiStop` + `setJadwalDetailLokasi`** + pemanggilan di dua jalur pengisian `DeliveryOrderID`.
- [ ] **Step 3: UI pemilih lokasi** di kartu stop.
- [ ] **Step 4: Ubah query cetak DO & struk thermal.**
- [ ] **Step 5: Verifikasi langsung** di demokristal (atau mkesindo dengan mitra uji):
  - Mitra uji dengan 2 lokasi → buat Pemesanan → susun Jadwal → pilih lokasi ke-2 → estimasi waktu tempuh berubah.
  - Selesai Muat → `KirimDibekukanAt` terisi dan `DeliveryOrder.AddressDelivery` = alamat lokasi ke-2.
  - Cetak DO & struk menampilkan alamat lokasi ke-2.
  - Lalu "Jadikan Utama" / edit alamat lokasi itu → cetak ulang DO tetap alamat lama.
  - Stop mitra satu-lokasi tidak menampilkan pemilih.
  - Ambil screenshot.
- [ ] **Step 6: Jalankan dry-run backfill**, tunjukkan jumlahnya ke pengguna, jalankan fix setelah disetujui, lalu simpan `…-posted.json`.
- [ ] **Step 7: Commit** `feat(pengiriman): pilih lokasi pengiriman per stop, bekukan alamat saat DO dibuat`.

---

### Task 9: Mitra Es Balok (PMPutra, PMPersada, PMPakis)

**Files:**
- Create: `src/lib/queries/mitra-es-balok-lokasi.ts`
- Modify: `src/lib/queries/mitra-es-balok.ts` (`MitraCard` + `getAgenRows` diperluas; `createMitra`/`updateMitra` menerima transaksi luar; `setAgenLocation`/`setAgenProfil` menerima executor), `src/components/dashboard/mitra-es-balok-form-dialog.tsx`, `src/app/{pmputra,pmpersada,pmpakis}/…/mitra/actions.ts` + `mitra-page-client.tsx` + `page.tsx`, `src/components/dashboard/agen-locations-panel.tsx`

**Interfaces:**
- Consumes: Task 2, 3, 4 (`mitra-identitas.ts`, `kompetitor.ts` dengan `bisnis:"es_balok"`), 5, 6 (`MitraIdentitasSection`, `LokasiPengirimanSection`, `KompetitorPicker`, `BerkasIdentitasField`; komponen ini harus menerima prop yang tidak terikat `MitraRow`).
- Produces (padanan Task 4 dengan kunci `(kode, sumber, agenId)`; DB dipilih lewat `resolveAgenKoneksi`):
```ts
export async function simpanAlamatDanLokasiAgen(tx: sql.Transaction, agenId: string, n: MitraAlamatTernormalisasi, userId: string): Promise<void>;
export async function jadikanLokasiUtamaAgen(kode: string, sumber: SumberAgen, agenId: string, lokasiPengirimanId: number, userId: string): Promise<{ wilayahLama: string | null; wilayahBaru: string | null }>;
export interface MitraLengkapEsBalokInput extends MitraAlamatForm {
  mitra: Omit<MitraInput /* mitra-es-balok.ts */, "telepon" | "wilayahId" | "alamat">; // nama, harga kecil/besar, maksimumHutang, kapasitas kecil/besar, segmentasi
  namaPenanggungJawab: string | null;
  nik?: string | null;
  kompetitorIds: number[];
}
export async function simpanMitraLengkapEsBalokAction(sumber: SumberAgen, agenId: string | null, input: MitraLengkapEsBalokInput): Promise<ActionResult<string>>; // di tiap actions.ts perusahaan
// telepon/wilayahId/alamat di PMP_Agen/PMP_AgenDetail diisi dari normalisasiMitraForm(input).utama; Kecamatan utama → DashboardAgenProfil.Kecamatan
```

Pemetaan slot (spec §6.2): Wilayah = `RegionID`/`PMP_Wilayah`, Kecamatan = `DashboardAgenProfil.Kecamatan` (opsional), Marketing = "—", Harga = Balok Kecil + Besar, Tenggat = Batas Hutang, Kapasitas = Kecil + Besar.

Tanggal Pendaftaran:
- Mitra baru dari dashboard → `mitra_identitas.tanggal_pendaftaran = today WIB`.
- Mitra lama → "—".

- [ ] **Step 1: Bila Task 0 menemukan Agen dengan >1 AgenDetail aktif**, terapkan keputusan pengguna dulu (task ini terblokir sampai ada keputusan).
- [ ] **Step 2: Lapisan data + action** untuk ketiga perusahaan (logistik bersama pmpersada/pmpakis lewat `resolveAgenKoneksi`).
- [ ] **Step 3: Form & peta multi-pin** memakai komponen Task 6.
- [ ] **Step 4: Verifikasi langsung** di /pmpersada/mitra (utama + logistik bersama), /pmpakis/mitra (kartu logistik yang sama menampilkan lokasi & identitas yang sama), dan /pmputra/mitra:
  - Simpan mitra lama tanpa perubahan → `PMP_AgenDetail` & `DashboardAgenLocation` identik.
  - Akun Direktur bisa melihat NIK.
  - Ambil screenshot.
- [ ] **Step 5: Commit** `feat(mitra-es-balok): identitas, lokasi pengiriman ganda, kompetitor`.

---

### Task 10: Aplikasi Pemasaran, form pengajuan, kunjungan, ByChat

**Files:**
- Modify:
  - Aplikasi Pemasaran: `src/components/pemasaran-app/mitra-detail.tsx`, `src/components/pemasaran-app/mitra-edit-form.tsx`, `src/app/mkesindo/pemasaran-app/mitra/[id]/*`, `src/app/mkesindo/pemasaran-app/actions.ts`.
  - Kunjungan: `src/components/pemasaran-app/tambah-kunjungan-sheet.tsx` beserta action validasi jaraknya.
  - Pengajuan: `src/components/dashboard/pengajuan-form-dialog.tsx`, `src/components/driver-app/pengajuan-form.tsx`, `src/components/pemasaran-app/pengajuan-form.tsx`, `src/lib/queries/mitra-pengajuan.ts`.
  - ByChat: `src/lib/bychat/mitra.ts`, `src/app/embed/mitra/page.tsx`.

**Interfaces:** Consumes Task 4 (`getLokasiPilihanStop` tidak dipakai di sini; pakai `MitraRow.LokasiTambahan`, `setKompetitorMitra`, `listKompetitor`), Task 6 `KompetitorPicker`.

Aturan:
- **Detail Aplikasi Pemasaran:** menampilkan Penanggung Jawab, daftar lokasi, dan kompetitor. NIK mengikuti `aksesIdentitasMitra`.
- **Edit di Aplikasi Pemasaran:** boleh mengubah lokasi (memakai `simpanMitraLengkapAction` dari Task 6, dipanggil lewat action pemasaran-app dengan field identitas `nik` tidak dikirim).
- **Kunjungan:** jarak check-in = jarak minimum ke semua pin milik mitra (utama + tambahan).
- **Pengajuan:**
  - Input kompetitor di ketiga form diganti `KompetitorPicker` (bisnis `es_kristal`), lalu disimpan ke `DashboardMitraPengajuan.KompetitorIDs`.
  - Saat disetujui → `setKompetitorMitra`. Bila `KompetitorIDs` NULL (pengajuan lama), jatuh ke `pecahTeksKompetitor(Kompetitor)` + `tambahKompetitor`.
- **ByChat:**
  - Pencocokan nomor juga memeriksa `DashboardMitraAlamat.Kontak` dan `DashboardMitraLokasiPengiriman.Kontak` (aktif), dengan helper `phoneMatches` yang sudah ada.
  - `/embed/mitra` menampilkan ringkasan lokasi.

- [ ] **Step 1: Tulis tes gagal** di `src/lib/bychat/__tests__/` untuk fungsi murni pencocokan baru (bila logika pencocokan diekstrak), misalnya `cocokkanNomorKeMitra(nomor, kandidat: { bpId, kontak: (string|null)[] }[])`. Isinya: cocok lewat kontak lokasi tambahan, dan tidak cocok bila hanya 8 digit terakhir sama (ikuti `last9`).
- [ ] **Step 2: Implementasi** semua perubahan di atas. Jalankan `npx tsx --test src/lib/bychat/__tests__/*.test.ts` → PASS.
- [ ] **Step 3: Verifikasi langsung:**
  - Buat pengajuan dari Aplikasi Pemasaran dengan 2 kompetitor (satu baru), lalu setujui; mitra yang terbentuk punya 2 kompetitor.
  - Check-in kunjungan di dekat lokasi tambahan → diterima.
  - Detail mitra di aplikasi pemasaran menampilkan lokasi.
- [ ] **Step 4: Commit** `feat(pemasaran): lokasi pengiriman & kompetitor terstruktur di aplikasi pemasaran, pengajuan, ByChat`.

---

### Task 11: Verifikasi menyeluruh

- [ ] **Step 1:** `npx tsc --noEmit` dan `npx eslint src` → nol error baru. `npx tsx --test src/lib/__tests__/*.test.ts src/lib/bychat/__tests__/*.test.ts src/lib/penagihan/__tests__/*.test.ts` → PASS.
- [ ] **Step 2:** Jalankan ulang bagian baseline dari skrip Task 0 dengan keluaran `…-sesudah.json`, lalu bandingkan dengan `2026-10-23-mitra-lokasi-baseline.json`. Expected: identik untuk semua mitra, kecuali mitra uji yang memang diubah selama verifikasi.
- [ ] **Step 3:** `npx next build` → sukses.
- [ ] **Step 4:** Perbarui memory proyek (berkas memory baru `mitra-lokasi-pengiriman.md`) dengan invarian, tabel, dan keputusan pengguna. Commit `docs(mitra): catat invarian lokasi pengiriman`.
