# Kode Ambil-Alih untuk Mulai/Selesai Muat Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wajibkan kode ambil-alih sekali-pakai (digenerate Manager ke atas) sebelum tombol "Mulai Muat"/"Selesai Muat" di `/mkesindo/delivery` bisa dipakai, supaya board itu benar-benar jadi jalur manual/darurat yang dipersulit, bukan alur utama.

**Architecture:** Tabel Postgres baru `kode_ambil_alih` (satu ekosistem dengan akun/peran, bukan MSSQL) menyimpan tiap kode 6-digit yang digenerate + jejak pemakaiannya sekaligus (tidak ada tabel riwayat terpisah). Flag baru `boleh_generate_kode_ambil_alih` di tabel `peran` menandai siapa yang boleh generate, dialirkan ke sesi NextAuth (pola sama dengan `isProduksi`/`isOperasional`). Verifikasi kode memakai klaim atomik `UPDATE ... WHERE ... RETURNING` terhadap baris TERBARU saja — ini otomatis mengimplementasikan "generate baru membatalkan kode lama" tanpa kolom status terpisah.

**Tech Stack:** Next.js 16 App Router, TypeScript, `pg` (node-postgres) untuk database Postgres akun/peran (`getPgPool()`, terpisah dari MSSQL `getPool()`), NextAuth v5, `bcryptjs`.

**Spec:** docs/superpowers/specs/2026-09-21-kode-ambil-alih-mulai-selesai-muat-design.md

## Global Constraints

- Semua UI dan pesan error berbahasa Indonesia.
- Kode ambil-alih berlaku universal di `/mkesindo/delivery` — tanpa pengecualian akun.
- Kode 6 digit angka, berlaku 3 menit ATAU sampai terpakai sekali (mana lebih dulu).
- Generate kode baru otomatis membuat kode lama tidak valid — lewat logika verifikasi (selalu bandingkan ke baris PALING BARU dibuat), bukan menghapus/menandai baris lama.
- Melihat ulang kode aktif TIDAK perlu password lagi — hanya GENERATE kode baru yang wajib re-entry password.
- Verifikasi & pemakaian kode WAJIB atomik (`UPDATE ... WHERE ... RETURNING`) untuk mencegah kode yang sama dipakai dua kali oleh dua permintaan bersamaan.
- `startMuatAction`/`selesaiMuatAction` WAJIB memanggil `requireModuleAccess("delivery")` (perbaikan celah yang sudah ada — saat ini kedua action ini tidak punya gerbang akses sama sekali).
- Tidak ada framework migrasi — perubahan skema (Postgres maupun MSSQL) lewat script `scripts/_scratch_*.ts` sekali jalan, dijalankan lalu dihapus, tidak pernah di-commit.
- Tidak ada test suite otomatis — verifikasi via `npx tsc --noEmit`, `npx eslint`, script scratch DB terhadap data live.
- Database Postgres diakses lewat `getPgPool()` (`@/lib/pg`), query dengan `pool.query(text, [params])` positional `$1`/`$2`, TIDAK ada wrapper transaksi eksplisit di modul `akun.ts` yang sudah ada (konsisten dengan pola itu kecuali klaim atomik kode yang memang butuh `RETURNING`).

## Review Focus

- Password salah saat generate kode — orang wajar mengharapkan DITOLAK dengan pesan jelas, TIDAK ada baris kode baru tercipta di database.
- Kode benar tapi sudah lewat 3 menit sejak dibuat — orang wajar mengharapkan DITOLAK (kedaluwarsa), bukan tetap diterima karena "toh kodenya benar".
- Kode dipakai dua kali (dua permintaan hampir bersamaan memakai kode yang sama) — orang wajar mengharapkan HANYA SATU yang berhasil, yang kedua ditolak "sudah dipakai" — bukan keduanya lolos karena race condition.
- Akun tanpa `boleh_generate_kode_ambil_alih` (dan bukan superadmin/Direktur) memanggil `generateKodeAmbilAlihAction` langsung (melewati UI yang disembunyikan) — orang wajar mengharapkan tetap DITOLAK di server, bukan cuma disembunyikan di client.
- `startMuatAction`/`selesaiMuatAction` dipanggil dengan kode kosong/string acak yang tidak pernah digenerate — orang wajar mengharapkan DITOLAK dengan pesan jelas, TIDAK ada perubahan apa pun di `DashboardPengirimanJadwal` (bukan crash SQL mentah).

---

### Task 1: Skema Postgres

**Files:**
- Scratch (dibuat lalu dihapus, TIDAK di-commit): `scripts/_scratch_kode_ambil_alih_schema.ts`

**Interfaces:**
- Produces: kolom `peran.boleh_generate_kode_ambil_alih BOOLEAN NOT NULL DEFAULT FALSE`; tabel `kode_ambil_alih(id SERIAL PK, kode VARCHAR(6), dibuat_oleh_akun_id INT, dibuat_pada TIMESTAMPTZ, kedaluwarsa_pada TIMESTAMPTZ, dipakai_pada TIMESTAMPTZ NULL, dipakai_oleh_akun_id INT NULL, dipakai_untuk_jadwal_id INT NULL, dipakai_untuk_aksi VARCHAR(20) NULL)` — keduanya di database Postgres "direktori" yang sama dengan akun/peran (`getPgPool()`), dipakai Task 2-4.

- [ ] **Step 1: Tulis & jalankan script skema**

Buat `scripts/_scratch_kode_ambil_alih_schema.ts`:

```typescript
import { getPgPool } from "@/lib/pg";

async function main() {
  const pool = getPgPool();
  await pool.query(`ALTER TABLE peran ADD COLUMN boleh_generate_kode_ambil_alih BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`
    CREATE TABLE kode_ambil_alih (
      id SERIAL PRIMARY KEY,
      kode VARCHAR(6) NOT NULL,
      dibuat_oleh_akun_id INT NOT NULL,
      dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now(),
      kedaluwarsa_pada TIMESTAMPTZ NOT NULL,
      dipakai_pada TIMESTAMPTZ NULL,
      dipakai_oleh_akun_id INT NULL,
      dipakai_untuk_jadwal_id INT NULL,
      dipakai_untuk_aksi VARCHAR(20) NULL
    )
  `);
  console.log("Skema kode_ambil_alih selesai dibuat.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx --env-file=.env scripts/_scratch_kode_ambil_alih_schema.ts`
Expected: output "Skema kode_ambil_alih selesai dibuat.", exit code 0.

- [ ] **Step 2: Verifikasi skema live**

Tambahkan sementara (sebelum menghapus script) query verifikasi:

```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'peran' AND column_name = 'boleh_generate_kode_ambil_alih';
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'kode_ambil_alih' ORDER BY ordinal_position;
```

Expected: baris pertama menunjukkan kolom baru di `peran` bertipe `boolean`; baris kedua menunjukkan 9 kolom `kode_ambil_alih` sesuai definisi di atas, dengan `id`/`kode`/`dibuat_oleh_akun_id`/`dibuat_pada`/`kedaluwarsa_pada` = `is_nullable='NO'` dan sisanya `'YES'`.

- [ ] **Step 3: Hapus script scratch**

```bash
rm scripts/_scratch_kode_ambil_alih_schema.ts
```

Tidak ada commit untuk task ini — konsisten dengan konvensi repo ini untuk setiap perubahan skema (MSSQL maupun Postgres).

---

### Task 2: Infrastruktur role "Manager ke atas"

**Files:**
- Modify: `src/lib/queries/akun.ts` (`PeranRow`, `listAllPeran`, `setPeranOperasional` area — tambah `setPeranBolehGenerateKodeAmbilAlih`)
- Modify: `src/app/grup/akun/peran/actions.ts` (action baru)
- Modify: `src/components/dashboard/peran-editor.tsx` (toggle baru)
- Modify: `src/lib/auth.ts` (`AuthorizedUser`, `authorize()`, `jwt()`)
- Modify: `src/lib/auth.config.ts` (session callback)
- Modify: `src/types/next-auth.d.ts` (3 interface augmentation)
- Modify: `src/lib/require-access.ts` (`requireManagerKeAtas` baru)

**Interfaces:**
- Consumes: kolom `peran.boleh_generate_kode_ambil_alih` (Task 1).
- Produces: `session.user.bolehGenerateKodeAmbilAlih: boolean` (dipakai Task 3 & 4 lewat `requireManagerKeAtas()`), `requireManagerKeAtas(): Promise<Session>` diekspor dari `@/lib/require-access`.

- [ ] **Step 1: `akun.ts` — tambah field & setter**

Di `src/lib/queries/akun.ts`, ubah `PeranRow` (sekitar baris 303-312) dari:

```ts
export interface PeranRow {
  id: number;
  perusahaanId: number;
  nama: string;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  isProduksi: boolean;
  isOperasional: boolean;
  akunCount: number;
}
```

jadi:

```ts
export interface PeranRow {
  id: number;
  perusahaanId: number;
  nama: string;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  isProduksi: boolean;
  isOperasional: boolean;
  bolehGenerateKodeAmbilAlih: boolean;
  akunCount: number;
}
```

Di `listAllPeran` (sekitar baris 314-334), tambah `r.boleh_generate_kode_ambil_alih` ke `SELECT` dan `bolehGenerateKodeAmbilAlih: row.boleh_generate_kode_ambil_alih` ke hasil `.map(...)`, mengikuti pola persis `isOperasional`/`r.is_operasional` yang sudah ada di baris yang sama.

Tambahkan setter baru setelah `setPeranOperasional` (sekitar baris 395-398):

```ts
export async function setPeranBolehGenerateKodeAmbilAlih(peranId: number, boleh: boolean): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE peran SET boleh_generate_kode_ambil_alih = $1 WHERE id = $2`, [boleh, peranId]);
}
```

Ubah `AkunAuthRow` (baris 11-29) dari:

```ts
export interface AkunAuthRow {
  id: number;
  username: string;
  passwordHash: string;
  nama: string;
  peranId: number | null;
  perusahaanId: number | null;
  perusahaanKode: string | null; // null only for Direktur accounts
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  isProduksi: boolean;
  isOperasional: boolean;
  canAksesInventaris: boolean;
  salesmanId: string | null;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}
```

jadi (tambah satu field setelah `isOperasional`):

```ts
export interface AkunAuthRow {
  id: number;
  username: string;
  passwordHash: string;
  nama: string;
  peranId: number | null;
  perusahaanId: number | null;
  perusahaanKode: string | null; // null only for Direktur accounts
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  isProduksi: boolean;
  isOperasional: boolean;
  bolehGenerateKodeAmbilAlih: boolean;
  canAksesInventaris: boolean;
  salesmanId: string | null;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}
```

Di `findAkunByUsername` (baris 31-70), tambah `COALESCE(r.boleh_generate_kode_ambil_alih, false) AS boleh_generate_kode_ambil_alih` ke `SELECT` (baris sejajar dengan `COALESCE(r.is_operasional, false) AS is_operasional`), dan tambah `bolehGenerateKodeAmbilAlih: row.boleh_generate_kode_ambil_alih` ke object hasil `return { ... }` (sejajar dengan `isOperasional: row.is_operasional`).

- [ ] **Step 2: Action & UI toggle di halaman Peran**

Di `src/app/grup/akun/peran/actions.ts`, tambah import `setPeranBolehGenerateKodeAmbilAlih` ke daftar import dari `@/lib/queries/akun` yang sudah ada (baris 5-14), lalu tambah action baru setelah `setPeranOperasionalAction`:

```ts
export async function setPeranBolehGenerateKodeAmbilAlihAction(peranId: number, boleh: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setPeranBolehGenerateKodeAmbilAlih(peranId, boleh);
    revalidatePath("/grup/akun/peran");
  });
}
```

Di `src/components/dashboard/peran-editor.tsx`, tambah state baru setelah `isOperasional` (sekitar baris 37):

```tsx
const [bolehGenerateKodeAmbilAlih, setBolehGenerateKodeAmbilAlihState] = useState(peran.bolehGenerateKodeAmbilAlih);
```

Tambah toggler setelah `toggleOperasional` (sekitar baris 68-71):

```tsx
function toggleBolehGenerateKodeAmbilAlih() {
  setBolehGenerateKodeAmbilAlihState((prev) => !prev);
  setDirty(true);
}
```

Tambah JSX toggle setelah blok toggle "Peran Khusus: Staf Operasional" yang sudah ada (sekitar baris 174-183):

```tsx
<label className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
  <input
    type="checkbox"
    className="accent-primary"
    checked={bolehGenerateKodeAmbilAlih}
    onChange={toggleBolehGenerateKodeAmbilAlih}
  />
  <span>
    Boleh Generate Kode Ambil-Alih
    <span className="block text-muted-foreground">
      Peran ini bisa generate kode ambil-alih untuk tombol Mulai/Selesai Muat manual di board Delivery (harus Manager
      ke atas).
    </span>
  </span>
</label>
```

Import `setPeranBolehGenerateKodeAmbilAlihAction` di top-of-file import dari `@/app/grup/akun/peran/actions` yang sudah ada. Tambah pemanggilannya ke `Promise.all` di `handleSave` (sekitar baris 73-97), sejajar dengan `setPeranOperasionalAction(peran.id, isOperasional)`:

```tsx
setPeranBolehGenerateKodeAmbilAlihAction(peran.id, bolehGenerateKodeAmbilAlih),
```

- [ ] **Step 3: Alirkan ke sesi NextAuth**

Di `src/lib/auth.ts`, tambah `bolehGenerateKodeAmbilAlih: boolean;` ke interface `AuthorizedUser` (setelah `isOperasional: boolean;`, sekitar baris 18-34).

Di `authorize()` callback (sekitar baris 82-99), tambah `bolehGenerateKodeAmbilAlih: row.bolehGenerateKodeAmbilAlih,` ke object `user: AuthorizedUser = { ... }` (setelah `isOperasional: row.isOperasional,`).

Di `jwt()` callback (sekitar baris 104-122), tambah `token.bolehGenerateKodeAmbilAlih = u.bolehGenerateKodeAmbilAlih;` (setelah `token.isOperasional = u.isOperasional;`).

Di `src/lib/auth.config.ts` (sekitar baris 28-35), tambah `session.user.bolehGenerateKodeAmbilAlih = token.bolehGenerateKodeAmbilAlih as boolean;` (setelah baris `session.user.isOperasional = token.isOperasional as boolean;`).

Di `src/types/next-auth.d.ts`, tambah `bolehGenerateKodeAmbilAlih: boolean;` ke SEMUA TIGA interface augmentation (`Session.user`, `User`, `JWT`) — di posisi yang sama, setelah `isOperasional: boolean;` di masing-masing.

- [ ] **Step 4: Gerbang akses baru**

Di `src/lib/require-access.ts`, tambah fungsi baru setelah `requireProduksiAdmin` (atau di lokasi wajar lain di file yang sama):

```ts
export async function requireManagerKeAtas() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessAllPT(session.user) && !session.user.bolehGenerateKodeAmbilAlih) {
    redirect("/akses-ditolak");
  }
  return session;
}
```

Tidak perlu import baru — `auth`, `canAccessAllPT`, `redirect` sudah diimpor di file ini.

- [ ] **Step 5: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/akun.ts src/app/grup/akun/peran/actions.ts src/components/dashboard/peran-editor.tsx src/lib/auth.ts src/lib/auth.config.ts src/types/next-auth.d.ts src/lib/require-access.ts`
Expected: tidak ada error.

- [ ] **Step 6: Verifikasi lewat script scratch**

Tulis script scratch yang:
1. Panggil `setPeranBolehGenerateKodeAmbilAlih(peranId, true)` terhadap peran "Manager" yang sudah ada (cari `id`-nya lewat `listAllPeran()` atau query manual `SELECT id FROM peran WHERE nama = 'Manager'`), lalu `findAkunByUsername` salah satu dari 2 akun Manager tersebut — verifikasi `bolehGenerateKodeAmbilAlih === true` di hasilnya.
2. Panggil `setPeranBolehGenerateKodeAmbilAlih(peranId, false)` untuk mengembalikan seperti semula SETELAH verifikasi selesai (supaya tidak meninggalkan perubahan tak terduga di peran nyata sebelum fitur ini benar-benar selesai semua task-nya) -- KECUALI kalau ingin langsung menyalakannya sebagai bagian dari go-live fitur ini, tanyakan dulu ke user di akhir task ini sebelum memutuskan tetap menyalakannya atau mematikannya lagi.

Hapus script setelah selesai.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/akun.ts src/app/grup/akun/peran/actions.ts src/components/dashboard/peran-editor.tsx src/lib/auth.ts src/lib/auth.config.ts src/types/next-auth.d.ts src/lib/require-access.ts
git commit -m "feat: tambah peran Manager ke atas untuk generate kode ambil-alih"
```

---

### Task 3: Generate kode & riwayat (navbar)

**Files:**
- Create: `src/lib/queries/kode-ambil-alih.ts`
- Modify: `src/lib/queries/akun.ts` (`verifyOwnPassword` baru)
- Create: `src/app/mkesindo/kode-ambil-alih/actions.ts`
- Create: `src/components/dashboard/kode-ambil-alih-button.tsx`
- Modify: `src/app/mkesindo/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: tabel `kode_ambil_alih` (Task 1), `requireManagerKeAtas()` (Task 2).
- Produces: `generateKodeAmbilAlih(dibuatOlehAkunId): Promise<KodeAmbilAlihAktif>`, `getKodeAmbilAlihAktif(): Promise<KodeAmbilAlihAktif | null>`, `getRiwayatKodeAmbilAlih(limit?): Promise<RiwayatKodeAmbilAlihRow[]>` (dipakai Task 4 tidak sama sekali — task ini murni sisi generate/lihat, verifikasi-pakai ada di Task 4).

- [ ] **Step 1: Query layer `kode-ambil-alih.ts`**

Buat `src/lib/queries/kode-ambil-alih.ts`:

```typescript
import { getPgPool } from "@/lib/pg";

export interface KodeAmbilAlihAktif {
  kode: string;
  kedaluwarsaPada: string;
}

// Kode 6-digit acak, berlaku 3 menit. Generate baru otomatis "mengalahkan"
// kode lama yang belum terpakai -- bukan lewat kolom status terpisah,
// tapi karena verifikasi (lihat verifikasiDanPakaiKodeAmbilAlih di bawah)
// hanya pernah membandingkan ke baris PALING BARU dibuat.
export async function generateKodeAmbilAlih(dibuatOlehAkunId: number): Promise<KodeAmbilAlihAktif> {
  const pool = getPgPool();
  const kode = String(Math.floor(100000 + Math.random() * 900000));
  const result = await pool.query(
    `INSERT INTO kode_ambil_alih (kode, dibuat_oleh_akun_id, kedaluwarsa_pada)
     VALUES ($1, $2, now() + interval '3 minutes')
     RETURNING kode, kedaluwarsa_pada`,
    [kode, dibuatOlehAkunId]
  );
  const row = result.rows[0] as { kode: string; kedaluwarsa_pada: Date };
  return { kode: row.kode, kedaluwarsaPada: row.kedaluwarsa_pada.toISOString() };
}

// Kode aktif SEKARANG (baris paling baru, belum dipakai, belum kedaluwarsa)
// -- untuk ditampilkan ulang tanpa perlu password lagi kalau dialog dibuka
// ulang sebelum kode itu dipakai/kedaluwarsa.
export async function getKodeAmbilAlihAktif(): Promise<KodeAmbilAlihAktif | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT kode, kedaluwarsa_pada, dipakai_pada FROM kode_ambil_alih ORDER BY dibuat_pada DESC LIMIT 1`
  );
  const row = result.rows[0] as { kode: string; kedaluwarsa_pada: Date; dipakai_pada: Date | null } | undefined;
  if (!row) return null;
  if (row.dipakai_pada != null) return null;
  if (row.kedaluwarsa_pada.getTime() < Date.now()) return null;
  return { kode: row.kode, kedaluwarsaPada: row.kedaluwarsa_pada.toISOString() };
}

export interface RiwayatKodeAmbilAlihRow {
  id: number;
  kode: string;
  dibuatOlehAkunId: number;
  dibuatPada: string;
  kedaluwarsaPada: string;
  dipakaiPada: string | null;
  dipakaiOlehAkunId: number | null;
  dipakaiUntukJadwalId: number | null;
  dipakaiUntukAksi: string | null;
}

export async function getRiwayatKodeAmbilAlih(limit = 20): Promise<RiwayatKodeAmbilAlihRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, kode, dibuat_oleh_akun_id, dibuat_pada, kedaluwarsa_pada, dipakai_pada, dipakai_oleh_akun_id,
            dipakai_untuk_jadwal_id, dipakai_untuk_aksi
     FROM kode_ambil_alih ORDER BY dibuat_pada DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map(
    (row: {
      id: number;
      kode: string;
      dibuat_oleh_akun_id: number;
      dibuat_pada: Date;
      kedaluwarsa_pada: Date;
      dipakai_pada: Date | null;
      dipakai_oleh_akun_id: number | null;
      dipakai_untuk_jadwal_id: number | null;
      dipakai_untuk_aksi: string | null;
    }) => ({
      id: row.id,
      kode: row.kode,
      dibuatOlehAkunId: row.dibuat_oleh_akun_id,
      dibuatPada: row.dibuat_pada.toISOString(),
      kedaluwarsaPada: row.kedaluwarsa_pada.toISOString(),
      dipakaiPada: row.dipakai_pada ? row.dipakai_pada.toISOString() : null,
      dipakaiOlehAkunId: row.dipakai_oleh_akun_id,
      dipakaiUntukJadwalId: row.dipakai_untuk_jadwal_id,
      dipakaiUntukAksi: row.dipakai_untuk_aksi,
    })
  );
}
```

- [ ] **Step 2: `verifyOwnPassword` di `akun.ts`**

Di `src/lib/queries/akun.ts`, tambah fungsi baru dekat `changeOwnPassword` yang sudah ada:

```ts
// Re-verifikasi password akun yang SEDANG LOGIN (bukan login ulang) --
// dipakai sebelum generate kode ambil-alih, supaya sesi yang lupa
// di-logout tidak bisa dipakai orang lain generate kode tanpa tahu
// passwordnya.
export async function verifyOwnPassword(userId: number, password: string): Promise<boolean> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT password_hash FROM akun WHERE id = $1`, [userId]);
  const row = result.rows[0] as { password_hash: string } | undefined;
  if (!row) return false;
  return bcrypt.compare(password, row.password_hash);
}
```

(`bcrypt` sudah diimpor di bagian atas file ini: `import bcrypt from "bcryptjs";`.)

- [ ] **Step 3: Server Actions**

Buat `src/app/mkesindo/kode-ambil-alih/actions.ts`:

```typescript
"use server";

import { requireManagerKeAtas } from "@/lib/require-access";
import { verifyOwnPassword, getAkunNamaMap } from "@/lib/queries/akun";
import {
  generateKodeAmbilAlih,
  getKodeAmbilAlihAktif,
  getRiwayatKodeAmbilAlih,
  type KodeAmbilAlihAktif,
  type RiwayatKodeAmbilAlihRow,
} from "@/lib/queries/kode-ambil-alih";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function generateKodeAmbilAlihAction(password: string): Promise<ActionResult<KodeAmbilAlihAktif>> {
  return runAction(async () => {
    const session = await requireManagerKeAtas();
    if (!password) throw new AppError("Isi password.");
    const ok = await verifyOwnPassword(Number(session.user.id), password);
    if (!ok) throw new AppError("Password salah.");
    return generateKodeAmbilAlih(Number(session.user.id));
  });
}

export async function getKodeAmbilAlihAktifAction(): Promise<ActionResult<KodeAmbilAlihAktif | null>> {
  return runAction(async () => {
    await requireManagerKeAtas();
    return getKodeAmbilAlihAktif();
  });
}

export interface RiwayatKodeAmbilAlihRowWithNama extends RiwayatKodeAmbilAlihRow {
  dibuatOlehNama: string;
  dipakaiOlehNama: string | null;
}

export async function getRiwayatKodeAmbilAlihAction(): Promise<ActionResult<RiwayatKodeAmbilAlihRowWithNama[]>> {
  return runAction(async () => {
    await requireManagerKeAtas();
    const rows = await getRiwayatKodeAmbilAlih();
    const akunIds = rows.flatMap((r) => (r.dipakaiOlehAkunId != null ? [r.dibuatOlehAkunId, r.dipakaiOlehAkunId] : [r.dibuatOlehAkunId]));
    const namaMap = await getAkunNamaMap(akunIds);
    return rows.map((r) => ({
      ...r,
      dibuatOlehNama: namaMap.get(r.dibuatOlehAkunId) ?? "Tidak diketahui",
      dipakaiOlehNama: r.dipakaiOlehAkunId != null ? (namaMap.get(r.dipakaiOlehAkunId) ?? "Tidak diketahui") : null,
    }));
  });
}
```

- [ ] **Step 4: Komponen navbar**

Buat `src/components/dashboard/kode-ambil-alih-button.tsx`:

```tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  generateKodeAmbilAlihAction,
  getKodeAmbilAlihAktifAction,
  getRiwayatKodeAmbilAlihAction,
  type RiwayatKodeAmbilAlihRowWithNama,
} from "@/app/mkesindo/kode-ambil-alih/actions";

export function KodeAmbilAlihButton() {
  const [open, setOpen] = useState(false);
  const [kodeAktif, setKodeAktif] = useState<{ kode: string; kedaluwarsaPada: string } | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [riwayat, setRiwayat] = useState<RiwayatKodeAmbilAlihRowWithNama[]>([]);
  const [pending, startTransition] = useTransition();
  const [sisaDetik, setSisaDetik] = useState(0);

  function muatData() {
    getKodeAmbilAlihAktifAction().then((r) => setKodeAktif(r.success ? r.data : null));
    getRiwayatKodeAmbilAlihAction().then((r) => {
      if (r.success) setRiwayat(r.data);
    });
  }

  useEffect(() => {
    if (open) {
      setError(null);
      setPassword("");
      muatData();
    }
  }, [open]);

  useEffect(() => {
    if (!kodeAktif) {
      setSisaDetik(0);
      return;
    }
    const update = () => setSisaDetik(Math.max(0, Math.floor((new Date(kodeAktif.kedaluwarsaPada).getTime() - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [kodeAktif]);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateKodeAmbilAlihAction(password);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setKodeAktif(result.data);
      setPassword("");
      muatData();
    });
  }

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} title="Kode Ambil-Alih">
        <KeyRound className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-w-sm flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Kode Ambil-Alih Mulai/Selesai Muat</DialogTitle>
          </DialogHeader>
          {kodeAktif === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : kodeAktif ? (
            <div className="flex flex-col items-center gap-1 rounded-md border border-border p-3">
              <p className="text-3xl font-bold tabular-nums tracking-widest">{kodeAktif.kode}</p>
              <p className="text-xs text-muted-foreground">Berlaku {sisaDetik} detik lagi</p>
              <Button size="sm" variant="outline" onClick={() => setKodeAktif(null)}>
                Generate Kode Baru
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Input
                type="password"
                placeholder="Password Anda"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button size="sm" disabled={pending || !password} onClick={handleGenerate}>
                Generate Kode
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-muted-foreground">Riwayat Kode</p>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
              {riwayat.length === 0 && <p className="text-muted-foreground">Belum ada riwayat.</p>}
              {riwayat.map((r) => (
                <div key={r.id} className="flex flex-col border-b border-border py-1 last:border-b-0">
                  <span>
                    {r.kode} — dibuat {r.dibuatOlehNama} ({new Date(r.dibuatPada).toLocaleString("id-ID")})
                  </span>
                  <span className="text-muted-foreground">
                    {r.dipakaiPada
                      ? `Dipakai ${r.dipakaiOlehNama} untuk ${r.dipakaiUntukAksi} (Jadwal #${r.dipakaiUntukJadwalId}) — ${new Date(r.dipakaiPada).toLocaleString("id-ID")}`
                      : new Date(r.kedaluwarsaPada).getTime() < Date.now()
                        ? "Kedaluwarsa, tidak terpakai"
                        : "Masih aktif"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 5: Render di navbar**

Di `src/app/mkesindo/(dashboard)/layout.tsx`, tambah import:

```tsx
import { KodeAmbilAlihButton } from "@/components/dashboard/kode-ambil-alih-button";
import { canAccessAllPT } from "@/lib/require-access";
```

(`canAccessAllPT` mungkin sudah diimpor di file ini — cek dulu import yang sudah ada sebelum menambah baris duplikat.)

Ubah header (baris 119-130) dari:

```tsx
          <div className="flex items-center gap-1">
            <NotificationBell />
            <AppearanceMenu />
            <UserMenu name={session?.user?.name ?? session?.user?.username ?? "User"} profile={profile} />
          </div>
```

jadi:

```tsx
          <div className="flex items-center gap-1">
            <NotificationBell />
            {session?.user && (canAccessAllPT(session.user) || session.user.bolehGenerateKodeAmbilAlih) && <KodeAmbilAlihButton />}
            <AppearanceMenu />
            <UserMenu name={session?.user?.name ?? session?.user?.username ?? "User"} profile={profile} />
          </div>
```

- [ ] **Step 6: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/kode-ambil-alih.ts src/lib/queries/akun.ts src/app/mkesindo/kode-ambil-alih/actions.ts src/components/dashboard/kode-ambil-alih-button.tsx "src/app/mkesindo/(dashboard)/layout.tsx"`
Expected: tidak ada error.

- [ ] **Step 7: Verifikasi lewat script scratch**

1. Panggil `generateKodeAmbilAlih(akunId)` langsung (fungsi query, bukan action -- tidak lewat `auth()`) dua kali berturut-turut dengan `akunId` nyata. Verifikasi: `getKodeAmbilAlihAktif()` mengembalikan kode dari panggilan KEDUA (bukan pertama) -- membuktikan "generate baru mengalahkan yang lama" bekerja lewat urutan `dibuat_pada`.
2. Verifikasi `getRiwayatKodeAmbilAlih()` mengembalikan KEDUA baris tadi (riwayat tidak kehilangan baris pertama meski sudah "kalah").
3. Panggil `verifyOwnPassword(akunId, "password-yang-jelas-salah")` -- harus `false`. Panggil `verifyOwnPassword(akunId, <password asli akun uji yang diketahui>)` -- harus `true`. (Fungsi ini murni Postgres, TIDAK lewat `auth()`, jadi bisa dipanggil langsung dari script scratch tanpa keterbatasan request-scope.)
4. Untuk `generateKodeAmbilAlihAction`/`getKodeAmbilAlihAktifAction`/`getRiwayatKodeAmbilAlihAction` (yang lewat `auth()`/`requireManagerKeAtas()`) -- TIDAK BISA dipanggil langsung dari script `tsx` polos (akan gagal "headers was called outside a request scope", keterbatasan lingkungan yang sudah ditemukan di proyek-proyek sebelumnya di sesi ini). Verifikasi action-level CUKUP lewat pembacaan kode (urutan `requireManagerKeAtas()` sebelum logika lain, pesan error yang benar), laporkan keterbatasan ini di report.
5. Hapus baris-baris uji (`DELETE FROM kode_ambil_alih WHERE id IN (...)`) setelah selesai, supaya tidak meninggalkan data uji di riwayat nyata.

Hapus script setelah selesai.

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/kode-ambil-alih.ts src/lib/queries/akun.ts src/app/mkesindo/kode-ambil-alih/actions.ts src/components/dashboard/kode-ambil-alih-button.tsx "src/app/mkesindo/(dashboard)/layout.tsx"
git commit -m "feat: generate & riwayat kode ambil-alih lewat navbar"
```

---

### Task 4: Verifikasi & konsumsi kode di Mulai/Selesai Muat (delivery)

**Files:**
- Modify: `src/lib/queries/kode-ambil-alih.ts` (fungsi baru `verifikasiDanPakaiKodeAmbilAlih`)
- Modify: `src/app/mkesindo/(dashboard)/delivery/actions.ts` (`startMuatAction`, `selesaiMuatAction`)
- Modify: `src/components/dashboard/route-validation-dialog.tsx` (dialog kode + restrukturisasi handler)

**Interfaces:**
- Consumes: `AppError` (`@/lib/action-result`), tabel `kode_ambil_alih` (Task 1).
- Produces: `verifikasiDanPakaiKodeAmbilAlih(kode, dipakaiOlehAkunId, jadwalId, aksi): Promise<void>` (throws `AppError` kalau tidak valid) — dipakai `startMuatAction`/`selesaiMuatAction` di task ini sendiri, tidak dipakai task lain.

- [ ] **Step 1: Fungsi verifikasi & konsumsi**

Di `src/lib/queries/kode-ambil-alih.ts`, tambah import `AppError` dari `@/lib/action-result` di bagian atas file, lalu tambah fungsi baru di akhir file:

```typescript
// Klaim atomik terhadap baris PALING BARU dibuat saja -- ini yang membuat
// "generate baru mengalahkan kode lama" bekerja tanpa kolom status
// terpisah, dan mencegah kode yang sama dipakai dua kali oleh dua
// permintaan bersamaan (UPDATE...WHERE...RETURNING, pola atomik yang
// sama dipakai berulang kali di seluruh dashboard ini untuk klaim stok).
export async function verifikasiDanPakaiKodeAmbilAlih(
  kode: string,
  dipakaiOlehAkunId: number,
  jadwalId: number,
  aksi: "MULAI_MUAT" | "SELESAI_MUAT"
): Promise<void> {
  const pool = getPgPool();
  const result = await pool.query(
    `UPDATE kode_ambil_alih
     SET dipakai_pada = now(), dipakai_oleh_akun_id = $1, dipakai_untuk_jadwal_id = $2, dipakai_untuk_aksi = $3
     WHERE id = (SELECT id FROM kode_ambil_alih ORDER BY dibuat_pada DESC LIMIT 1)
       AND kode = $4 AND dipakai_pada IS NULL AND kedaluwarsa_pada >= now()
     RETURNING id`,
    [dipakaiOlehAkunId, jadwalId, aksi, kode]
  );
  if (result.rows.length === 0) {
    throw new AppError("Kode ambil-alih tidak valid, sudah dipakai, atau sudah kedaluwarsa.");
  }
}
```

- [ ] **Step 2: Gerbangi & wajibkan kode di `delivery/actions.ts`**

Di `src/app/mkesindo/(dashboard)/delivery/actions.ts`, tambah import `verifikasiDanPakaiKodeAmbilAlih` dari `@/lib/queries/kode-ambil-alih` (`requireModuleAccess` sudah diimpor di baris 4).

Ubah (baris 207-220) dari:

```ts
export async function startMuatAction(jadwalId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await startMuat(jadwalId);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function selesaiMuatAction(jadwalId: number): Promise<ActionResult<{ jadwalDetailId: number; invoiceToken: string }[]>> {
  return runAction(async () => {
    const result = await selesaiMuat(jadwalId);
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}
```

jadi:

```ts
export async function startMuatAction(jadwalId: number, kode: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("delivery");
    await verifikasiDanPakaiKodeAmbilAlih(kode, Number(session.user.id), jadwalId, "MULAI_MUAT");
    await startMuat(jadwalId);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function selesaiMuatAction(
  jadwalId: number,
  kode: string
): Promise<ActionResult<{ jadwalDetailId: number; invoiceToken: string }[]>> {
  return runAction(async () => {
    const session = await requireModuleAccess("delivery");
    await verifikasiDanPakaiKodeAmbilAlih(kode, Number(session.user.id), jadwalId, "SELESAI_MUAT");
    const result = await selesaiMuat(jadwalId);
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}
```

- [ ] **Step 3: Dialog kode & restrukturisasi handler di `route-validation-dialog.tsx`**

**Catatan penting hasil investigasi:** `doSaveDriverTimeThenSelesaiMuat` punya DUA titik panggil -- (a) langsung dari `handleSelesaiMuat` (baris 792, jalur tanpa konflik), dan (b) dari `ArmadaConflictDialog`'s `onConfirm` (baris 1638, jalur "Lanjutkan" setelah konflik terdeteksi). KEDUANYA wajib menerima parameter `kode` yang sama. Supaya tidak perlu mengubah bentuk state `conflict` yang sudah ada (dipakai juga oleh jalur "save" yang tidak terkait kode sama sekali), kode disimpan di state TERPISAH (`pendingKodeSelesaiMuat`) yang ditulis tepat sebelum `setConflict(...)` dan dibaca lagi saat konflik di-"Lanjutkan".

Tambah state baru dekat deklarasi `conflict` (baris 364):

```tsx
const [showKodeDialog, setShowKodeDialog] = useState<"MULAI_MUAT" | "SELESAI_MUAT" | null>(null);
const [kodeInput, setKodeInput] = useState("");
const [kodeError, setKodeError] = useState<string | null>(null);
const [pendingKodeSelesaiMuat, setPendingKodeSelesaiMuat] = useState("");
```

Ganti `handleMuat` (baris 710-720) dari:

```tsx
  function handleMuat() {
    if (jadwalId == null) return;
    const targetId = jadwalId;
    setError(null);
    startTransition(async () => {
      const result = await startMuatAction(targetId);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
      }
    });
  }
```

jadi:

```tsx
  function handleMuat() {
    if (jadwalId == null) return;
    setKodeInput("");
    setKodeError(null);
    setShowKodeDialog("MULAI_MUAT");
  }

  function handleMuatDenganKode(kode: string) {
    if (jadwalId == null) return;
    const targetId = jadwalId;
    setKodeError(null);
    startTransition(async () => {
      const result = await startMuatAction(targetId, kode);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setKodeError(result.error);
        return;
      }
      setShowKodeDialog(null);
    });
  }
```

Ganti `doSaveDriverTimeThenSelesaiMuat` (baris 741-774) dari:

```tsx
  function doSaveDriverTimeThenSelesaiMuat(targetId: number, jamJadwal: Date) {
    startTransition(async () => {
      const driverTimeResult = await updateJadwalDriverTimeAction(
        targetId,
        { jamJadwal, salesmanId: driverId || null },
        { skipOrderTimeCheck: true }
      );
      if (!driverTimeResult.success) {
        if (jadwalIdRef.current === targetId) setError(driverTimeResult.error);
        return;
      }
      if (driverTimeResult.data !== targetId) {
        toast.success(
          "Waktu ini tumpang tindih dengan keberangkatan lain untuk armada ini — sudah digabung. Buka kembali untuk melanjutkan keberangkatan."
        );
        if (jadwalIdRef.current === targetId) {
          onDeleted?.();
          onOpenChange(false);
        }
        return;
      }
      const selesaiMuatResult = await selesaiMuatAction(targetId);
      if (!selesaiMuatResult.success) {
        if (jadwalIdRef.current === targetId) setError(selesaiMuatResult.error);
        return;
      }
      const rows = await getJadwalDetailAction(targetId);
      if (jadwalIdRef.current === targetId) setOrder(rows);
    });
  }
```

jadi (satu-satunya perubahan: parameter `kode` baru, diteruskan ke `selesaiMuatAction`):

```tsx
  function doSaveDriverTimeThenSelesaiMuat(targetId: number, jamJadwal: Date, kode: string) {
    startTransition(async () => {
      const driverTimeResult = await updateJadwalDriverTimeAction(
        targetId,
        { jamJadwal, salesmanId: driverId || null },
        { skipOrderTimeCheck: true }
      );
      if (!driverTimeResult.success) {
        if (jadwalIdRef.current === targetId) setError(driverTimeResult.error);
        return;
      }
      if (driverTimeResult.data !== targetId) {
        toast.success(
          "Waktu ini tumpang tindih dengan keberangkatan lain untuk armada ini — sudah digabung. Buka kembali untuk melanjutkan keberangkatan."
        );
        if (jadwalIdRef.current === targetId) {
          onDeleted?.();
          onOpenChange(false);
        }
        return;
      }
      const selesaiMuatResult = await selesaiMuatAction(targetId, kode);
      if (!selesaiMuatResult.success) {
        if (jadwalIdRef.current === targetId) setError(selesaiMuatResult.error);
        return;
      }
      const rows = await getJadwalDetailAction(targetId);
      if (jadwalIdRef.current === targetId) setOrder(rows);
    });
  }
```

Ganti `handleSelesaiMuat` (baris 780-794) dari:

```tsx
  function handleSelesaiMuat() {
    if (jadwalId == null || armadaId == null) return;
    const targetId = jadwalId;
    const jamJadwal = buildJamJadwal();
    setError(null);
    startTransition(async () => {
      const check = await checkArmadaConflictAction(armadaId, jamJadwal, totalQty, targetId);
      if (jadwalIdRef.current !== targetId) return;
      if (check) {
        setConflict({ info: check, jamJadwal, then: "selesaiMuat" });
        return;
      }
      doSaveDriverTimeThenSelesaiMuat(targetId, jamJadwal);
    });
  }
```

jadi:

```tsx
  function handleSelesaiMuat() {
    if (jadwalId == null || armadaId == null) return;
    setKodeInput("");
    setKodeError(null);
    setShowKodeDialog("SELESAI_MUAT");
  }

  function handleSelesaiMuatDenganKode(kode: string) {
    if (jadwalId == null || armadaId == null) return;
    const targetId = jadwalId;
    const jamJadwal = buildJamJadwal();
    setKodeError(null);
    startTransition(async () => {
      const check = await checkArmadaConflictAction(armadaId, jamJadwal, totalQty, targetId);
      if (jadwalIdRef.current !== targetId) return;
      setShowKodeDialog(null);
      if (check) {
        setPendingKodeSelesaiMuat(kode);
        setConflict({ info: check, jamJadwal, then: "selesaiMuat" });
        return;
      }
      doSaveDriverTimeThenSelesaiMuat(targetId, jamJadwal, kode);
    });
  }
```

Ganti pemanggilan di `ArmadaConflictDialog`'s `onConfirm` (baris 1626-1642) dari:

```tsx
        {conflict && (
          <ArmadaConflictDialog
            conflict={conflict.info}
            onCancel={() => setConflict(null)}
            onConfirm={() => {
              if (jadwalId == null) return;
              const targetId = jadwalId;
              const { jamJadwal, then } = conflict;
              setConflict(null);
              if (then === "save") {
                doSaveDriverTime(targetId, jamJadwal);
              } else {
                doSaveDriverTimeThenSelesaiMuat(targetId, jamJadwal);
              }
            }}
          />
        )}
```

jadi (satu-satunya perubahan: cabang `else` meneruskan `pendingKodeSelesaiMuat`):

```tsx
        {conflict && (
          <ArmadaConflictDialog
            conflict={conflict.info}
            onCancel={() => setConflict(null)}
            onConfirm={() => {
              if (jadwalId == null) return;
              const targetId = jadwalId;
              const { jamJadwal, then } = conflict;
              setConflict(null);
              if (then === "save") {
                doSaveDriverTime(targetId, jamJadwal);
              } else {
                doSaveDriverTimeThenSelesaiMuat(targetId, jamJadwal, pendingKodeSelesaiMuat);
              }
            }}
          />
        )}
```

Tambah dialog kode baru — taruh di dekat `ArmadaConflictDialog` JSX yang sudah ada (`Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`Input`/`Button` semuanya sudah diimpor di file ini, tidak perlu import baru):

```tsx
        <Dialog open={showKodeDialog != null} onOpenChange={(open) => !open && setShowKodeDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Masukkan Kode Ambil-Alih</DialogTitle>
              <DialogDescription>
                Alur normal Mulai/Selesai Muat seharusnya lewat aplikasi produksi (Kepala Produksi/Wakilnya). Kode
                ambil-alih didapat dari Manager, berlaku 3 menit dan hanya bisa dipakai sekali.
              </DialogDescription>
            </DialogHeader>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="Kode 6 digit"
              value={kodeInput}
              onChange={(e) => setKodeInput(e.target.value)}
            />
            {kodeError && <p className="text-sm text-destructive">{kodeError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowKodeDialog(null)} disabled={pending}>
                Batal
              </Button>
              <Button
                disabled={pending || kodeInput.trim().length !== 6}
                onClick={() => {
                  if (showKodeDialog === "MULAI_MUAT") handleMuatDenganKode(kodeInput.trim());
                  else if (showKodeDialog === "SELESAI_MUAT") handleSelesaiMuatDenganKode(kodeInput.trim());
                }}
              >
                Konfirmasi
              </Button>
            </div>
          </DialogContent>
        </Dialog>
```

- [ ] **Step 4: Verifikasi tipe & lint**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/kode-ambil-alih.ts src/app/mkesindo/(dashboard)/delivery/actions.ts src/components/dashboard/route-validation-dialog.tsx`
Expected: tidak ada error.

- [ ] **Step 5: Verifikasi lewat script scratch**

1. Panggil `generateKodeAmbilAlih(akunId)` untuk dapat kode nyata. Panggil `verifikasiDanPakaiKodeAmbilAlih(kode, akunId, 999999, "MULAI_MUAT")` (pakai `jadwalId` fiktif yang aman, BUKAN Jadwal nyata, karena fungsi ini murni Postgres, tidak menyentuh MSSQL) -- verifikasi baris `kode_ambil_alih` ter-update (`dipakai_pada` terisi, dst).
2. Panggil `verifikasiDanPakaiKodeAmbilAlih` LAGI dengan kode YANG SAMA -- harus `AppError` "Kode ambil-alih tidak valid, sudah dipakai, atau sudah kedaluwarsa." (sudah terpakai).
3. Panggil `verifikasiDanPakaiKodeAmbilAlih("000000", akunId, 999999, "MULAI_MUAT")` (kode acak yang TIDAK PERNAH digenerate sama sekali) -- harus `AppError` yang sama (tidak valid).
4. Generate kode baru, tunggu/simulasikan kedaluwarsa (langsung `UPDATE kode_ambil_alih SET kedaluwarsa_pada = now() - interval '1 second' WHERE id = ...` lewat query manual untuk mempercepat pengujian, BUKAN menunggu 3 menit sungguhan) -- panggil `verifikasiDanPakaiKodeAmbilAlih` dengan kode itu -- harus ditolak juga (kedaluwarsa).
5. **Uji race sungguhan**: generate SATU kode baru, lalu panggil `verifikasiDanPakaiKodeAmbilAlih` DUA KALI SECARA BERSAMAAN dengan kode yang SAMA lewat `Promise.allSettled([verifikasiDanPakaiKodeAmbilAlih(kode, akunId, 1, "MULAI_MUAT"), verifikasiDanPakaiKodeAmbilAlih(kode, akunId, 2, "SELESAI_MUAT")])` -- verifikasi TEPAT SATU yang berhasil (fulfilled) dan SATU yang gagal (rejected dengan `AppError` "sudah dipakai"), BUKAN keduanya berhasil. Ini membuktikan klaim atomik `UPDATE...WHERE...RETURNING` benar-benar mencegah dobel-pakai, bukan cuma benar secara berurutan.
6. Untuk `startMuatAction`/`selesaiMuatAction` (lewat `auth()`) -- TIDAK BISA dipanggil langsung dari script scratch (keterbatasan yang sama, sudah ditemukan berulang kali di proyek-proyek sebelumnya). Verifikasi CUKUP lewat pembacaan kode bahwa urutan pemanggilan benar: `requireModuleAccess("delivery")` → `verifikasiDanPakaiKodeAmbilAlih(...)` → baru `startMuat`/`selesaiMuat` asli. Laporkan keterbatasan ini di report.
7. Hapus semua baris uji dari `kode_ambil_alih` setelah selesai.

Hapus script setelah selesai.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/kode-ambil-alih.ts "src/app/mkesindo/(dashboard)/delivery/actions.ts" src/components/dashboard/route-validation-dialog.tsx
git commit -m "feat: wajibkan kode ambil-alih untuk Mulai/Selesai Muat manual di delivery"
```
