# Tim Produksi Fleksibel & Penjadwalan Bulanan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lepaskan identitas Tim Produksi dari nomor shift (jadi Tim A/B/C bernama, dengan Kepala Produksi masing-masing), tambahkan penjadwalan bulanan oleh Supervisor/Admin, dan beri Staf Operasional kemampuan mengoreksi Tim yang benar-benar bertugas langsung di shift yang sedang berjalan.

**Architecture:** Entitas `DashboardTimProduksi` baru menggantikan kolom `Shift` di `DashboardTimProduksiAnggota` sebagai identitas tim. Tabel `DashboardJadwalTimProduksi` menyimpan rencana bulanan (TanggalUsaha+Shift → TimID), dipakai hanya sebagai nilai default saat `DashboardAktivitasProduksiShift.TimID` (realisasi per kejadian shift) pertama dibuat — koreksi sesudahnya tidak pernah menulis balik ke jadwal. Panel admin baru di `/mkesindo/produksi` mengelola jadwal dan Kepala Produksi; panel baru di produksi-app memberi Kepala Produksi akses swalayan ke roster timnya sendiri.

**Tech Stack:** Next.js Server Actions, MSSQL (`mssql` package via `src/lib/db.ts`), Postgres (`pg` via `src/lib/pg.ts` untuk akun), React (`@dnd-kit` sudah dipakai untuk drag-reorder, tidak disentuh plan ini).

**Spec:** [docs/superpowers/specs/2026-08-30-tim-produksi-penjadwalan-fleksibel-design.md](../specs/2026-08-30-tim-produksi-penjadwalan-fleksibel-design.md)

## Global Constraints

- Semua nama tabel/kolom baru pakai konvensi `Dashboard*` PascalCase yang sudah ada.
- Tidak ada FK constraint fisik lintas Dashboard* table maupun lintas-DB (AkunID Postgres disimpan sebagai kolom INT polos di MSSQL, tanpa FK — pola yang sama seperti `StafOperasionalAkunID`/`CreatedByAkunID`/`DicatatOlehAkunID` di seluruh codebase ini).
- Bahasa UI: Indonesia, konsisten dengan seluruh aplikasi.
- MKEsindo saja — tidak direplikasi ke PMPersada/PMPutra.
- Tidak ada framework test otomatis di repo ini — verifikasi tiap task pakai `npx tsc --noEmit`, `npx eslint <file>`, dan untuk kode yang menyentuh DB, script sekali-jalan (`npx tsx scripts/...ts` atau scratch script sementara) dijalankan langsung ke database live, lalu scratch script dihapus setelah dipakai (bukan bagian dari commit).
- `DashboardTimProduksiAnggota` dikonfirmasi **kosong** di database live sebelum plan ini ditulis (dicek langsung) — migrasi Task 1 mengasumsikan tabel ini kosong saat pertama kali dijalankan (tidak perlu backfill data).
- Jadwal Tim bulan berjalan sengaja **tidak** diisi apapun oleh migrasi — Supervisor mengisi manual mulai kapan fitur ini aktif (lihat spec Non-Goals).
- Akun 3 Kepala Produksi (Fendianto/Hartoyo/Maicha) dibuat manual oleh user lewat `/grup/akun` — TIDAK dibuat oleh plan/script manapun di sini. `KepalaAkunID` mereka ditaut lewat panel admin (Task 2) setelah akunnya ada.

---

### Task 1: Migrasi Skema & Seed Data

**Files:**
- Create: `scripts/add-tim-produksi-flexible.ts`

**Interfaces:**
- Consumes: `getPool`, `sql` dari `src/lib/db.ts` (sudah ada).
- Produces: tabel `DashboardTimProduksi` (TimID, Nama, KepalaAkunID, IsDeleted, CreatedDate, ModifiedDate), tabel `DashboardJadwalTimProduksi` (JadwalID, TanggalUsaha, Shift, TimID, CreatedByAkunID, ModifiedDate, unique TanggalUsaha+Shift), kolom `DashboardTimProduksiAnggota.TimID` (menggantikan `Shift`), kolom `DashboardAktivitasProduksiShift.TimID` (nullable). Tim A/B/C ter-seed dengan roster default. Task-task berikutnya bergantung pada skema ini sudah ada di DB live sebelum kode aplikasi memanggilnya.

- [ ] **Step 1: Tulis script migrasi**

```ts
// One-off schema migration -- introduces flexible, named Tim Produksi
// (Tim A/B/C) decoupled from shift number, a monthly Jadwal Tim table, and
// a TimID column on DashboardAktivitasProduksiShift for live corrections --
// see docs/superpowers/specs/2026-08-30-tim-produksi-penjadwalan-fleksibel-design.md.
// DashboardTimProduksiAnggota was confirmed EMPTY in the live DB before this
// migration (no real member data existed yet), so its Shift->TimID column
// swap is a clean replacement, not a data migration. Idempotent.
// Usage: npx tsx scripts/add-tim-produksi-flexible.ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

const ROSTER: Record<string, string[]> = {
  "Tim A": ["Fendianto", "Irfan", "Aldo", "Deva", "Bayu"],
  "Tim B": ["Hartoyo", "Fian", "Reza", "Danar", "Rozi", "Bima"],
  "Tim C": ["Maicha", "Nizam", "Arif", "Dika", "Raga", "Bagas", "Rayhan"],
};

async function columnExists(pool: sql.ConnectionPool, table: string, column: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("table", sql.VarChar, table)
    .input("column", sql.VarChar, column)
    .query(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table AND COLUMN_NAME = @column`);
  return result.recordset.length > 0;
}

async function tableExists(pool: sql.ConnectionPool, table: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("table", sql.VarChar, table)
    .query(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @table`);
  return result.recordset.length > 0;
}

async function main() {
  const pool = await getPool();

  if (!(await tableExists(pool, "DashboardTimProduksi"))) {
    await pool.request().query(`
      CREATE TABLE DashboardTimProduksi (
        TimID INT IDENTITY PRIMARY KEY,
        Nama VARCHAR(50) NOT NULL,
        KepalaAkunID INT NULL,
        IsDeleted BIT NOT NULL DEFAULT 0,
        CreatedDate DATETIME NOT NULL DEFAULT GETDATE(),
        ModifiedDate DATETIME NULL
      )
    `);
    console.log("Created DashboardTimProduksi.");
  } else {
    console.log("DashboardTimProduksi already exists -- nothing to do.");
  }

  if (!(await tableExists(pool, "DashboardJadwalTimProduksi"))) {
    await pool.request().query(`
      CREATE TABLE DashboardJadwalTimProduksi (
        JadwalID INT IDENTITY PRIMARY KEY,
        TanggalUsaha DATE NOT NULL,
        Shift TINYINT NOT NULL,
        TimID INT NOT NULL,
        CreatedByAkunID INT NOT NULL,
        ModifiedDate DATETIME NULL,
        CONSTRAINT UQ_JadwalTim_TanggalShift UNIQUE (TanggalUsaha, Shift)
      )
    `);
    console.log("Created DashboardJadwalTimProduksi.");
  } else {
    console.log("DashboardJadwalTimProduksi already exists -- nothing to do.");
  }

  if (await columnExists(pool, "DashboardTimProduksiAnggota", "Shift")) {
    await pool.request().query(`ALTER TABLE DashboardTimProduksiAnggota DROP COLUMN Shift`);
    await pool.request().query(`ALTER TABLE DashboardTimProduksiAnggota ADD TimID INT NOT NULL`);
    console.log("Replaced DashboardTimProduksiAnggota.Shift with TimID.");
  } else if (!(await columnExists(pool, "DashboardTimProduksiAnggota", "TimID"))) {
    await pool.request().query(`ALTER TABLE DashboardTimProduksiAnggota ADD TimID INT NOT NULL`);
    console.log("Added DashboardTimProduksiAnggota.TimID.");
  } else {
    console.log("DashboardTimProduksiAnggota.TimID already exists -- nothing to do.");
  }

  if (!(await columnExists(pool, "DashboardAktivitasProduksiShift", "TimID"))) {
    await pool.request().query(`ALTER TABLE DashboardAktivitasProduksiShift ADD TimID INT NULL`);
    console.log("Added DashboardAktivitasProduksiShift.TimID.");
  } else {
    console.log("DashboardAktivitasProduksiShift.TimID already exists -- nothing to do.");
  }

  const existingTim = await pool.request().query(`SELECT COUNT(*) AS Total FROM DashboardTimProduksi`);
  if ((existingTim.recordset[0] as { Total: number }).Total === 0) {
    for (const [nama, anggotaList] of Object.entries(ROSTER)) {
      const timResult = await pool
        .request()
        .input("nama", sql.VarChar(50), nama)
        .query(`INSERT INTO DashboardTimProduksi (Nama) OUTPUT INSERTED.TimID VALUES (@nama)`);
      const timId = (timResult.recordset[0] as { TimID: number }).TimID;
      for (const namaAnggota of anggotaList) {
        await pool
          .request()
          .input("timId", sql.Int, timId)
          .input("nama", sql.VarChar(100), namaAnggota)
          .query(`INSERT INTO DashboardTimProduksiAnggota (TimID, Nama) VALUES (@timId, @nama)`);
      }
      console.log(`Seeded ${nama} (TimID ${timId}) dengan ${anggotaList.length} anggota.`);
    }
  } else {
    console.log("DashboardTimProduksi sudah ada isinya -- skip seed.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Jalankan migrasi ke DB live**

Run: `npx tsx scripts/add-tim-produksi-flexible.ts`
Expected: log "Created DashboardTimProduksi.", "Created DashboardJadwalTimProduksi.", "Replaced DashboardTimProduksiAnggota.Shift with TimID.", "Added DashboardAktivitasProduksiShift.TimID.", lalu 3 baris "Seeded Tim X (TimID N) dengan M anggota." Jalankan ulang sekali lagi untuk pastikan idempotent (semua baris jadi "... already exists -- nothing to do." / "... sudah ada isinya -- skip seed.").

- [ ] **Step 3: Commit**

```bash
git add scripts/add-tim-produksi-flexible.ts
git commit -m "feat: migrate Tim Produksi to named, shift-independent entities"
```

---

### Task 2: Backend — Model Tim, Jadwal, dan Panel Admin

Task ini mengubah tipe inti `AnggotaTimRow` (dari `shift` ke `timId`), jadi HARUS mengubah semua pemanggil langsungnya (`panel-tim-produksi.tsx`, `tim-produksi-roster.tsx`, `actions.ts`) dalam task yang sama supaya build tetap hijau.

**Files:**
- Modify: `src/lib/queries/tim-produksi.ts` (rewrite penuh)
- Modify: `src/lib/queries/akun.ts` (tambah 1 fungsi)
- Create: `src/lib/queries/jadwal-tim-produksi.ts`
- Modify: `src/lib/queries/aktivitas-produksi.ts`
- Modify: `src/app/mkesindo/produksi/actions.ts`
- Modify: `src/components/produksi/panel-tim-produksi.tsx` (rewrite penuh)
- Modify: `src/components/produksi-app/tim-produksi-roster.tsx` (label saja)
- Modify: `src/app/mkesindo/(dashboard)/produksi/page.tsx`

**Interfaces:**
- Consumes: `getPool`/`sql` dari `src/lib/db.ts`, `getPgPool` dari `src/lib/pg.ts`, `AppError`/`runAction`/`ActionResult` dari `src/lib/action-result.ts`, `requireProduksiView` dari `src/lib/require-access.ts`, `getReportShift`/`getShiftWindow`/`ShiftNumber` dari `src/lib/report-shift.ts` (skema Task 1 sudah ada di DB).
- Produces (dipakai Task 3, 4, 5):
  - `TimRow { timId: number; nama: string; kepalaAkunId: number | null }`
  - `AnggotaTimRow { anggotaId: number; timId: number; timNama: string; nama: string }`
  - `getAllTim(): Promise<TimRow[]>`
  - `getAnggotaTim(timId: number): Promise<AnggotaTimRow[]>`
  - `getSemuaAnggotaTim(): Promise<AnggotaTimRow[]>`
  - `tambahAnggotaTim(timId: number, nama: string): Promise<number>`
  - `updateAnggotaTim(anggotaId: number, input: { nama: string; timId: number }): Promise<void>`
  - `hapusAnggotaTim(anggotaId: number): Promise<void>` (tidak berubah)
  - `hapusAnggotaTimIfOwned(anggotaId: number, timId: number): Promise<void>` (throw `AppError` kalau anggota bukan milik `timId`)
  - `updateTimKepala(timId: number, kepalaAkunId: number | null): Promise<void>`
  - `getTimByKepalaAkunId(akunId: number): Promise<{ timId: number; nama: string } | null>`
  - `getProduksiAkunOptions(): Promise<StafOperasionalOption[]>` (akun.ts)
  - `JadwalTimRow { tanggalUsaha: string; shift: ShiftNumber; timId: number; timNama: string }`
  - `getJadwalBulan(tahun: number, bulan: number): Promise<JadwalTimRow[]>`
  - `getJadwalUntukShift(tanggalUsaha: string, shift: ShiftNumber): Promise<number | null>`
  - `setJadwalTim(tanggalUsaha: string, shift: ShiftNumber, timId: number, akunId: number): Promise<void>`
  - `AktivitasShiftInfo` mendapat field baru `timId: number | null`
  - `setTimBertugas(tanggalUsaha: string, shift: ShiftNumber, timId: number, akunId: number): Promise<void>`
  - Actions baru: `getAllTimAction`, `updateTimKepalaAction`, `getProduksiAkunOptionsAction`, `getJadwalBulanAction`, `setJadwalTimAction`, `setTimBertugasAction`, `getTimSayaAction`, `tambahAnggotaTimSayaAction`, `hapusAnggotaTimSayaAction`

- [ ] **Step 1: Rewrite `src/lib/queries/tim-produksi.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface TimRow {
  timId: number;
  nama: string;
  kepalaAkunId: number | null;
}

export interface AnggotaTimRow {
  anggotaId: number;
  timId: number;
  timNama: string;
  nama: string;
}

export async function getAllTim(): Promise<TimRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TimID, Nama, KepalaAkunID FROM DashboardTimProduksi WHERE IsDeleted = 0 ORDER BY Nama
  `);
  return (result.recordset as { TimID: number; Nama: string; KepalaAkunID: number | null }[]).map((r) => ({
    timId: r.TimID,
    nama: r.Nama,
    kepalaAkunId: r.KepalaAkunID,
  }));
}

export async function updateTimKepala(timId: number, kepalaAkunId: number | null): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("timId", sql.Int, timId)
    .input("kepalaAkunId", sql.Int, kepalaAkunId)
    .query(`UPDATE DashboardTimProduksi SET KepalaAkunID = @kepalaAkunId, ModifiedDate = GETDATE() WHERE TimID = @timId`);
}

// Dipakai panel "Tim Saya" di produksi-app -- mencari Tim milik akun yang
// sedang login lewat KepalaAkunID, bukan lewat ID Tim yang dikirim client
// (supaya seorang Kepala Produksi tidak bisa mengklaim Tim orang lain).
export async function getTimByKepalaAkunId(akunId: number): Promise<{ timId: number; nama: string } | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("akunId", sql.Int, akunId)
    .query(`SELECT TOP 1 TimID, Nama FROM DashboardTimProduksi WHERE KepalaAkunID = @akunId AND IsDeleted = 0`);
  const row = result.recordset[0] as { TimID: number; Nama: string } | undefined;
  return row ? { timId: row.TimID, nama: row.Nama } : null;
}

// Roster aktif satu Tim -- dipakai sebagai default Susunan Tim (lihat
// getSusunanTim/setTimBertugas di aktivitas-produksi.ts) dan panel admin.
export async function getAnggotaTim(timId: number): Promise<AnggotaTimRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("timId", sql.Int, timId)
    .query(`
      SELECT a.AnggotaID, a.TimID, t.Nama AS TimNama, a.Nama
      FROM DashboardTimProduksiAnggota a
      JOIN DashboardTimProduksi t ON t.TimID = a.TimID
      WHERE a.TimID = @timId AND a.IsDeleted = 0
      ORDER BY a.Nama
    `);
  return (result.recordset as { AnggotaID: number; TimID: number; TimNama: string; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    timId: r.TimID,
    timNama: r.TimNama,
    nama: r.Nama,
  }));
}

export async function tambahAnggotaTim(timId: number, nama: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("timId", sql.Int, timId)
    .input("nama", sql.VarChar(100), nama)
    .query(`
      INSERT INTO DashboardTimProduksiAnggota (TimID, Nama)
      OUTPUT INSERTED.AnggotaID
      VALUES (@timId, @nama)
    `);
  return (result.recordset[0] as { AnggotaID: number }).AnggotaID;
}

// Soft-remove only -- lihat catatan yang sama di versi lama fungsi ini:
// baris DashboardAktivitasProduksiKehadiran masa lalu harus tetap
// resolve ke nama asli untuk Riwayat.
export async function hapusAnggotaTim(anggotaId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .query(`UPDATE DashboardTimProduksiAnggota SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE AnggotaID = @anggotaId`);
}

// Versi ter-scoped untuk panel swalayan "Tim Saya" -- gagal (AppError) kalau
// anggotaId bukan milik timId, supaya Kepala Tim A tidak bisa menonaktifkan
// anggota Tim B lewat request yang dimanipulasi (client hanya mengirim
// anggotaId; timId selalu berasal dari lookup server-side terhadap sesi
// login, lihat hapusAnggotaTimSayaAction di actions.ts).
export async function hapusAnggotaTimIfOwned(anggotaId: number, timId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .input("timId", sql.Int, timId)
    .query(`
      UPDATE DashboardTimProduksiAnggota
      SET IsDeleted = 1, ModifiedDate = GETDATE()
      OUTPUT INSERTED.AnggotaID
      WHERE AnggotaID = @anggotaId AND TimID = @timId AND IsDeleted = 0
    `);
  if (result.recordset.length === 0) throw new AppError("Anggota ini bukan bagian dari Tim Anda.");
}

// Semua tim sekaligus -- dipakai dropdown "tambah dari tim lain" (Susunan
// Tim) dan panel admin Tim Produksi.
export async function getSemuaAnggotaTim(): Promise<AnggotaTimRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT a.AnggotaID, a.TimID, t.Nama AS TimNama, a.Nama
    FROM DashboardTimProduksiAnggota a
    JOIN DashboardTimProduksi t ON t.TimID = a.TimID
    WHERE a.IsDeleted = 0
    ORDER BY t.Nama, a.Nama
  `);
  return (result.recordset as { AnggotaID: number; TimID: number; TimNama: string; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    timId: r.TimID,
    timNama: r.TimNama,
    nama: r.Nama,
  }));
}

// Edit nama dan/atau Tim seorang anggota -- panel admin saja. Tidak
// menyentuh Susunan Tim shift lampau manapun (Kehadiran mereferensikan
// AnggotaID langsung, independen dari TimID saat ini -- sama seperti
// versi lama fungsi ini terhadap kolom Shift).
export async function updateAnggotaTim(anggotaId: number, input: { nama: string; timId: number }): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .input("nama", sql.VarChar(100), input.nama)
    .input("timId", sql.Int, input.timId)
    .query(`UPDATE DashboardTimProduksiAnggota SET Nama = @nama, TimID = @timId, ModifiedDate = GETDATE() WHERE AnggotaID = @anggotaId`);
}
```

- [ ] **Step 2: Tambah `getProduksiAkunOptions` di `src/lib/queries/akun.ts`**

Tambahkan setelah `getStafOperasionalOptions` (baris ~517, sebelum `getAkunNamaMap`):

```ts
// Daftar akun is_produksi=true aktif -- dipakai dropdown "Kepala Produksi"
// di panel admin Tim Produksi. Mirip getStafOperasionalOptions di atas,
// beda flag peran saja (is_produksi, bukan is_operasional).
export async function getProduksiAkunOptions(): Promise<StafOperasionalOption[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT a.id, a.nama
    FROM akun a
    JOIN peran r ON r.id = a.peran_id
    WHERE r.is_produksi = true AND a.is_active = true
    ORDER BY a.nama
  `);
  return result.rows.map((row) => ({ akunId: row.id as number, nama: row.nama as string }));
}
```

- [ ] **Step 3: Buat `src/lib/queries/jadwal-tim-produksi.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import type { ShiftNumber } from "@/lib/report-shift";

export interface JadwalTimRow {
  tanggalUsaha: string;
  shift: ShiftNumber;
  timId: number;
  timNama: string;
}

// Semua baris jadwal dalam satu bulan kalender (bulan: 1-12) -- dipakai
// kalender bulanan admin di /mkesindo/produksi.
export async function getJadwalBulan(tahun: number, bulan: number): Promise<JadwalTimRow[]> {
  const pool = await getPool();
  const awal = new Date(Date.UTC(tahun, bulan - 1, 1));
  const akhir = new Date(Date.UTC(tahun, bulan, 1));
  const result = await pool
    .request()
    .input("awal", sql.Date, awal)
    .input("akhir", sql.Date, akhir)
    .query(`
      SELECT j.TanggalUsaha, j.Shift, j.TimID, t.Nama AS TimNama
      FROM DashboardJadwalTimProduksi j
      JOIN DashboardTimProduksi t ON t.TimID = j.TimID
      WHERE j.TanggalUsaha >= @awal AND j.TanggalUsaha < @akhir
    `);
  return (result.recordset as { TanggalUsaha: Date; Shift: number; TimID: number; TimNama: string }[]).map((r) => ({
    tanggalUsaha: r.TanggalUsaha.toISOString().slice(0, 10),
    shift: r.Shift as ShiftNumber,
    timId: r.TimID,
    timNama: r.TimNama,
  }));
}

// Dipakai ensureAktivitasRow (aktivitas-produksi.ts) sebagai nilai default
// TimID saat baris shift baru pertama dibuat -- lihat spec Bagian 3.1.
export async function getJadwalUntukShift(tanggalUsaha: string, shift: ShiftNumber): Promise<number | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT TimID FROM DashboardJadwalTimProduksi WHERE TanggalUsaha = @t AND Shift = @s`);
  const row = result.recordset[0] as { TimID: number } | undefined;
  return row?.TimID ?? null;
}

// UPSERT satu sel kalender -- Supervisor mengubah sel yang sama berkali-kali
// seiring waktu, bukan insert baru tiap kali (lihat spec Bagian 1.3).
export async function setJadwalTim(tanggalUsaha: string, shift: ShiftNumber, timId: number, akunId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .input("timId", sql.Int, timId)
    .input("akunId", sql.Int, akunId)
    .query(`
      MERGE DashboardJadwalTimProduksi AS target
      USING (SELECT @t AS TanggalUsaha, @s AS Shift) AS src
      ON target.TanggalUsaha = src.TanggalUsaha AND target.Shift = src.Shift
      WHEN MATCHED THEN UPDATE SET TimID = @timId, ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT (TanggalUsaha, Shift, TimID, CreatedByAkunID) VALUES (@t, @s, @timId, @akunId);
    `);
}
```

- [ ] **Step 4: Wiring TimID di `src/lib/queries/aktivitas-produksi.ts`**

Tambah import di baris 1-4 (setelah baris `import { getAnggotaTim } from "@/lib/queries/tim-produksi";`):

```ts
import { getJadwalUntukShift } from "@/lib/queries/jadwal-tim-produksi";
```

Ubah `AktivitasShiftInfo` (baris 7-18) — tambah field `timId`:

```ts
export interface AktivitasShiftInfo {
  aktivitasId: number | null; // null when this shift has never been saved yet
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
  timId: number | null;
  stafOperasionalAkunId: number | null;
  stokEsSebelumnya10KG: number;
  pecahKemasanQty: number;
  esJatuhQty: number;
  gantiReturnQty: number;
  sealerJebolQty: number;
}
```

Ubah `ensureAktivitasRow` (baris 60-84) — INSERT sekarang mengisi `TimID` dari jadwal:

```ts
async function ensureAktivitasRow(pool: sql.ConnectionPool, tanggalUsaha: string, shift: ShiftNumber, akunId: number): Promise<number> {
  const existing = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT AktivitasID FROM DashboardAktivitasProduksiShift WHERE TanggalUsaha = @t AND Shift = @s`);
  if (existing.recordset.length > 0) return (existing.recordset[0] as { AktivitasID: number }).AktivitasID;

  const stokEs = await getTotalStokEs10KG(pool);
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, shift, "work").start;
  const timId = await getJadwalUntukShift(tanggalUsaha, shift);
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("stokEs", sql.Int, stokEs)
    .input("timId", sql.Int, timId)
    .input("akunId", sql.Int, akunId)
    .query(`
      INSERT INTO DashboardAktivitasProduksiShift (TanggalUsaha, Shift, ShiftMulai, StokEsSebelumnya10KG, TimID, CreatedByAkunID, StafOperasionalAkunID)
      OUTPUT INSERTED.AktivitasID
      VALUES (@t, @s, @shiftMulai, @stokEs, @timId, @akunId, @akunId)
    `);
  return (result.recordset[0] as { AktivitasID: number }).AktivitasID;
}
```

Ubah `RawAktivitasRow` (baris 86-94) — tambah `TimID: number | null`:

```ts
interface RawAktivitasRow {
  AktivitasID: number;
  TimID: number | null;
  StafOperasionalAkunID: number | null;
  StokEsSebelumnya10KG: number;
  PecahKemasanQty: number;
  EsJatuhQty: number;
  GantiReturnQty: number;
  SealerJebolQty: number;
}
```

Ubah `mapAktivitasRow` (baris 96-109) — tambah `timId: r.TimID`:

```ts
function mapAktivitasRow(r: RawAktivitasRow, tanggalUsaha: string, shift: ShiftNumber): AktivitasShiftInfo {
  return {
    aktivitasId: r.AktivitasID,
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    timId: r.TimID,
    stafOperasionalAkunId: r.StafOperasionalAkunID,
    stokEsSebelumnya10KG: r.StokEsSebelumnya10KG,
    pecahKemasanQty: r.PecahKemasanQty,
    esJatuhQty: r.EsJatuhQty,
    gantiReturnQty: r.GantiReturnQty,
    sealerJebolQty: r.SealerJebolQty,
  };
}
```

Ubah `getAktivitasForShift` (baris 115-141) — SELECT tambah `TimID`, dan cabang "belum pernah disimpan" ikut menampilkan Tim terjadwal sebagai preview:

```ts
export async function getAktivitasForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<AktivitasShiftInfo> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`
      SELECT AktivitasID, TimID, StafOperasionalAkunID, StokEsSebelumnya10KG, PecahKemasanQty, EsJatuhQty, GantiReturnQty, SealerJebolQty
      FROM DashboardAktivitasProduksiShift WHERE TanggalUsaha = @t AND Shift = @s
    `);
  const row = result.recordset[0] as RawAktivitasRow | undefined;
  if (row) return mapAktivitasRow(row, tanggalUsaha, shift);

  const stokEs = await getTotalStokEs10KG(pool);
  const timId = await getJadwalUntukShift(tanggalUsaha, shift);
  return {
    aktivitasId: null,
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    timId,
    stafOperasionalAkunId: null,
    stokEsSebelumnya10KG: stokEs,
    pecahKemasanQty: 0,
    esJatuhQty: 0,
    gantiReturnQty: 0,
    sealerJebolQty: 0,
  };
}
```

Ubah `getAktivitasRiwayat` (baris 143-157) — SELECT tambah `TimID`:

```ts
export async function getAktivitasRiwayat(limit = 30): Promise<AktivitasShiftInfo[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) AktivitasID, TanggalUsaha, Shift, TimID, StafOperasionalAkunID, StokEsSebelumnya10KG,
             PecahKemasanQty, EsJatuhQty, GantiReturnQty, SealerJebolQty
      FROM DashboardAktivitasProduksiShift
      ORDER BY ShiftMulai DESC
    `);
  return (result.recordset as (RawAktivitasRow & { TanggalUsaha: Date; Shift: number })[]).map((r) =>
    mapAktivitasRow(r, r.TanggalUsaha.toISOString().slice(0, 10), r.Shift as ShiftNumber)
  );
}
```

Ubah `getSusunanTim` (baris 200-228) — fallback "belum pernah disimpan" sekarang ikut jadwal, bukan `getAnggotaTim(shift)`:

```ts
export async function getSusunanTim(tanggalUsaha: string, shift: ShiftNumber): Promise<SusunanTimRow[]> {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT AktivitasID FROM DashboardAktivitasProduksiShift WHERE TanggalUsaha = @t AND Shift = @s`);
  const aktivitasId = (existing.recordset[0] as { AktivitasID: number } | undefined)?.AktivitasID;

  if (aktivitasId == null) {
    const timId = await getJadwalUntukShift(tanggalUsaha, shift);
    if (timId == null) return [];
    const timTetap = await getAnggotaTim(timId);
    return timTetap.map((a, i) => ({ anggotaId: a.anggotaId, nama: a.nama, urutan: i }));
  }

  const result = await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId).query(`
      SELECT kh.AnggotaID, kh.Urutan, a.Nama
      FROM DashboardAktivitasProduksiKehadiran kh
      JOIN DashboardTimProduksiAnggota a ON a.AnggotaID = kh.AnggotaID
      WHERE kh.AktivitasID = @aktivitasId
      ORDER BY kh.Urutan ASC
    `);
  return (result.recordset as { AnggotaID: number; Urutan: number; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    urutan: r.Urutan,
    nama: r.Nama,
  }));
}
```

Tambah fungsi baru `setTimBertugas` setelah `setSusunanTim` (setelah baris 255, sebelum komentar "// 10KG: grouped by..."):

```ts
// Koreksi live "Tim Bertugas" -- hanya memengaruhi kejadian shift ini
// (DashboardJadwalTimProduksi TIDAK ikut berubah, lihat spec Bagian 3.2).
// Kalau nilainya benar-benar berubah, Susunan Tim ditulis ulang ke roster
// default Tim yang baru (spec Bagian 3.3) -- memilih Tim yang sama tidak
// menghapus penyesuaian manual yang sudah dilakukan.
export async function setTimBertugas(tanggalUsaha: string, shift: ShiftNumber, timId: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  const current = await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .query(`SELECT TimID FROM DashboardAktivitasProduksiShift WHERE AktivitasID = @aktivitasId`);
  const timIdSaatIni = (current.recordset[0] as { TimID: number | null }).TimID;

  await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .input("timId", sql.Int, timId)
    .query(`UPDATE DashboardAktivitasProduksiShift SET TimID = @timId, ModifiedDate = GETDATE() WHERE AktivitasID = @aktivitasId`);

  if (timIdSaatIni !== timId) {
    const anggotaBaru = await getAnggotaTim(timId);
    await setSusunanTim(tanggalUsaha, shift, anggotaBaru.map((a) => a.anggotaId), akunId);
  }
}
```

- [ ] **Step 5: Wiring `src/app/mkesindo/produksi/actions.ts`**

Ubah import block tim-produksi.ts (baris 49-56) jadi:

```ts
import {
  getAllTim,
  getAnggotaTim,
  getSemuaAnggotaTim,
  tambahAnggotaTim,
  updateAnggotaTim,
  hapusAnggotaTim,
  hapusAnggotaTimIfOwned,
  updateTimKepala,
  getTimByKepalaAkunId,
  type AnggotaTimRow,
  type TimRow,
} from "@/lib/queries/tim-produksi";
```

Ubah import block aktivitas-produksi.ts (baris 58-71) — tambah `setTimBertugas`:

```ts
import {
  getCurrentShift,
  getAktivitasForShift,
  getAktivitasRiwayat,
  upsertStafOperasional,
  upsertKerusakan,
  getSusunanTim,
  setSusunanTim,
  setTimBertugas,
  getQtyRecapForShift,
  type AktivitasShiftInfo,
  type QtyRecap,
  type KerusakanInput,
  type SusunanTimRow,
} from "@/lib/queries/aktivitas-produksi";
```

Tambah import baru setelah baris `import { getJadwalDetail, ... } from "@/lib/queries/pengiriman-jadwal";`:

```ts
import { getJadwalBulan, setJadwalTim, type JadwalTimRow } from "@/lib/queries/jadwal-tim-produksi";
```

Ubah import `akun.ts` (baris 33) jadi:

```ts
import { getAkunNamaMap, getStafOperasionalOptions, getProduksiAkunOptions, type StafOperasionalOption } from "@/lib/queries/akun";
```

Ganti 3 fungsi berikut (baris 325-358 di file lama) dengan versi timId:

```ts
export async function getAllTimAction(): Promise<ActionResult<TimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getAllTim();
  });
}

export async function updateTimKepalaAction(timId: number, kepalaAkunId: number | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    await updateTimKepala(timId, kepalaAkunId);
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function getProduksiAkunOptionsAction(): Promise<ActionResult<StafOperasionalOption[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getProduksiAkunOptions();
  });
}

export async function getAnggotaTimAction(timId: number): Promise<ActionResult<AnggotaTimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getAnggotaTim(timId);
  });
}

export async function getSemuaAnggotaTimAction(): Promise<ActionResult<AnggotaTimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getSemuaAnggotaTim();
  });
}

export async function updateAnggotaTimAction(anggotaId: number, input: { nama: string; timId: number }): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!input.nama.trim()) throw new AppError("Nama anggota tidak boleh kosong.");
    await updateAnggotaTim(anggotaId, { nama: input.nama.trim(), timId: input.timId });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function tambahAnggotaTimAction(timId: number, nama: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!nama.trim()) throw new AppError("Nama anggota tidak boleh kosong.");
    const id = await tambahAnggotaTim(timId, nama.trim());
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/produksi");
    return id;
  });
}

export async function hapusAnggotaTimAction(anggotaId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    await hapusAnggotaTim(anggotaId);
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/produksi");
  });
}
```

Tambah action-action baru untuk Jadwal, koreksi live, dan "Tim Saya" — taruh setelah `setSusunanTimAction` di akhir file:

```ts
export async function getJadwalBulanAction(tahun: number, bulan: number): Promise<ActionResult<JadwalTimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getJadwalBulan(tahun, bulan);
  });
}

export async function setJadwalTimAction(tanggalUsaha: string, shift: ShiftNumber, timId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setJadwalTim(tanggalUsaha, shift, timId, Number(session.user.id));
    revalidatePath("/mkesindo/produksi");
  });
}

export async function setTimBertugasAction(tanggalUsaha: string, shift: ShiftNumber, timId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setTimBertugas(tanggalUsaha, shift, timId, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function getTimSayaAction(): Promise<ActionResult<{ timId: number; nama: string; anggota: AnggotaTimRow[] } | null>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const tim = await getTimByKepalaAkunId(Number(session.user.id));
    if (!tim) return null;
    const anggota = await getAnggotaTim(tim.timId);
    return { ...tim, anggota };
  });
}

export async function tambahAnggotaTimSayaAction(nama: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!nama.trim()) throw new AppError("Nama anggota tidak boleh kosong.");
    const tim = await getTimByKepalaAkunId(Number(session.user.id));
    if (!tim) throw new AppError("Anda bukan Kepala Produksi tim manapun.");
    const id = await tambahAnggotaTim(tim.timId, nama.trim());
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/produksi");
    return id;
  });
}

export async function hapusAnggotaTimSayaAction(anggotaId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const tim = await getTimByKepalaAkunId(Number(session.user.id));
    if (!tim) throw new AppError("Anda bukan Kepala Produksi tim manapun.");
    await hapusAnggotaTimIfOwned(anggotaId, tim.timId);
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/produksi");
  });
}
```

- [ ] **Step 6: Rewrite `src/components/produksi/panel-tim-produksi.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tambahAnggotaTimAction, updateAnggotaTimAction, hapusAnggotaTimAction, updateTimKepalaAction } from "@/app/mkesindo/produksi/actions";
import type { AnggotaTimRow, TimRow } from "@/lib/queries/tim-produksi";
import type { StafOperasionalOption } from "@/lib/queries/akun";

const UNSET = "__unset__";

function AnggotaCard({ anggota, timList }: { anggota: AnggotaTimRow; timList: TimRow[] }) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState(anggota.nama);
  const [timId, setTimId] = useState(anggota.timId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateAnggotaTimAction(anggota.anggotaId, { nama, timId });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  function handleNonaktifkan() {
    if (!confirm(`Nonaktifkan ${anggota.nama}? Tindakan ini tidak bisa dibatalkan dari sini.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await hapusAnggotaTimAction(anggota.anggotaId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setNama(anggota.nama);
          setTimId(anggota.timId);
          setError(null);
        }
      }}
    >
      <DialogTrigger className="w-full rounded-lg border border-border p-2 text-left text-sm hover:bg-muted/50">
        {anggota.nama}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah Anggota Tim Produksi</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Nama</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} />
          </div>
          <div>
            <Label>Tim</Label>
            <Select value={String(timId)} onValueChange={(v) => setTimId(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timList.map((t) => (
                  <SelectItem key={t.timId} value={String(t.timId)}>
                    {t.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={pending} onClick={handleNonaktifkan}>
            Nonaktifkan
          </Button>
          <Button disabled={pending} onClick={handleSave}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TambahAnggotaDialog({ tim }: { tim: TimRow }) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    if (!nama.trim()) {
      setError("Nama tidak boleh kosong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await tambahAnggotaTimAction(tim.timId, nama.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setNama("");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2 text-sm text-muted-foreground hover:bg-muted/50">
        <Plus className="size-4" /> Tambah Anggota
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Anggota — {tim.nama}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Nama</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KepalaSelect({ tim, produksiAkunOptions }: { tim: TimRow; produksiAkunOptions: StafOperasionalOption[] }) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      await updateTimKepalaAction(tim.timId, value === UNSET ? null : Number(value));
    });
  }

  return (
    <Select value={tim.kepalaAkunId != null ? String(tim.kepalaAkunId) : UNSET} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pilih Kepala Produksi" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>Belum ditentukan</SelectItem>
        {produksiAkunOptions.map((o) => (
          <SelectItem key={o.akunId} value={String(o.akunId)}>
            {o.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PanelTimProduksi({
  timList,
  anggotaList,
  produksiAkunOptions,
}: {
  timList: TimRow[];
  anggotaList: AnggotaTimRow[];
  produksiAkunOptions: StafOperasionalOption[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {timList.map((tim) => (
        <div key={tim.timId} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">{tim.nama}</p>
          <div>
            <Label className="text-xs">Kepala Produksi</Label>
            <KepalaSelect tim={tim} produksiAkunOptions={produksiAkunOptions} />
          </div>
          {anggotaList
            .filter((a) => a.timId === tim.timId)
            .map((a) => (
              <AnggotaCard key={a.anggotaId} anggota={a} timList={timList} />
            ))}
          <TambahAnggotaDialog tim={tim} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Perbaiki label di `src/components/produksi-app/tim-produksi-roster.tsx`**

Ganti baris `{a.nama} (Shift {a.shift})` (di dropdown "Tambah dari tim lain") jadi:

```tsx
{a.nama} ({a.timNama})
```

- [ ] **Step 8: Wiring `src/app/mkesindo/(dashboard)/produksi/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireProduksiView } from "@/lib/require-access";
import { getWarehouseMap, getRiwayatProduksi } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getAllTim, getSemuaAnggotaTim } from "@/lib/queries/tim-produksi";
import { getAkunNamaMap, getProduksiAkunOptions } from "@/lib/queries/akun";
import { PetaWarehouseDesktop } from "@/components/produksi/peta-warehouse-desktop";
import { PanelMesin } from "@/components/produksi/panel-mesin";
import { PanelTimProduksi } from "@/components/produksi/panel-tim-produksi";
import { RiwayatProduksi } from "@/components/produksi/riwayat-produksi";

export const metadata: Metadata = { title: "Produksi" };

export default async function ProduksiPage() {
  await requireProduksiView();
  const [posisi, mesinList, timList, anggotaTimList, produksiAkunOptions, riwayatRaw] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getAllTim(),
    getSemuaAnggotaTim(),
    getProduksiAkunOptions(),
    getRiwayatProduksi(),
  ]);
  const namaMap = await getAkunNamaMap(riwayatRaw.map((r) => r.DicatatOlehAkunID));
  const riwayat = riwayatRaw.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-xl font-semibold">Produksi</h1>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Peta Warehouse</h2>
        <PetaWarehouseDesktop posisi={posisi} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Mesin Produksi</h2>
        <PanelMesin mesinList={mesinList} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Tim Produksi</h2>
        <PanelTimProduksi timList={timList} anggotaList={anggotaTimList} produksiAkunOptions={produksiAkunOptions} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Riwayat Produksi</h2>
        <RiwayatProduksi riwayat={riwayat} />
      </section>
    </div>
  );
}
```

- [ ] **Step 9: Verifikasi build**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/tim-produksi.ts src/lib/queries/akun.ts src/lib/queries/jadwal-tim-produksi.ts src/lib/queries/aktivitas-produksi.ts src/app/mkesindo/produksi/actions.ts src/components/produksi/panel-tim-produksi.tsx src/components/produksi-app/tim-produksi-roster.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"`
Expected: tidak ada error.

- [ ] **Step 10: Commit**

```bash
git add src/lib/queries/tim-produksi.ts src/lib/queries/akun.ts src/lib/queries/jadwal-tim-produksi.ts src/lib/queries/aktivitas-produksi.ts src/app/mkesindo/produksi/actions.ts src/components/produksi/panel-tim-produksi.tsx src/components/produksi-app/tim-produksi-roster.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"
git commit -m "feat: decouple Tim Produksi from shift number, add Kepala Produksi admin panel"
```

---

### Task 3: Jadwal Tim Produksi Bulanan (Admin)

**Files:**
- Create: `src/components/produksi/jadwal-tim-bulanan.tsx`
- Modify: `src/app/mkesindo/(dashboard)/produksi/page.tsx`

**Interfaces:**
- Consumes: `getJadwalBulanAction`, `setJadwalTimAction` (Task 2, `actions.ts`), `JadwalTimRow` (Task 2, `jadwal-tim-produksi.ts`), `TimRow` (Task 2, `tim-produksi.ts`), `ShiftNumber` (`report-shift.ts`), `getCurrentShift` (`aktivitas-produksi.ts`).
- Produces: `JadwalTimBulanan` component — tidak dikonsumsi task lain.

- [ ] **Step 1: Buat `src/components/produksi/jadwal-tim-bulanan.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getJadwalBulanAction, setJadwalTimAction } from "@/app/mkesindo/produksi/actions";
import type { JadwalTimRow } from "@/lib/queries/jadwal-tim-produksi";
import type { TimRow } from "@/lib/queries/tim-produksi";
import type { ShiftNumber } from "@/lib/report-shift";

const UNSET = "__unset__";
const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Urutan kronologis nyata dalam satu TanggalUsaha: Shift 2 (H-1, 15:00) ->
// Shift 3 (H-1 ke H, 23:00) -> Shift 1 (H, 07:00) -- lihat getShiftWindow
// di report-shift.ts. Kolom kalender mengikuti urutan ini, bukan 1-2-3.
const KOLOM_SHIFT: { shift: ShiftNumber; label: string }[] = [
  { shift: 2, label: "Shift 2 (15:00-22:59, H-1)" },
  { shift: 3, label: "Shift 3 (23:00-06:59, H-1->H)" },
  { shift: 1, label: "Shift 1 (07:00-14:59, H)" },
];

function SelSelect({
  timId,
  timList,
  onPilih,
}: {
  timId: number | null;
  timList: TimRow[];
  onPilih: (timId: number) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  async function handleChange(value: string) {
    if (value === UNSET) return;
    setPending(true);
    await onPilih(Number(value));
    setPending(false);
  }

  return (
    <Select value={timId != null ? String(timId) : UNSET} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Belum dijadwalkan" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET} disabled>
          Belum dijadwalkan
        </SelectItem>
        {timList.map((t) => (
          <SelectItem key={t.timId} value={String(t.timId)}>
            {t.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function JadwalTimBulanan({
  tahunAwal,
  bulanAwal,
  jadwalAwal,
  timList,
}: {
  tahunAwal: number;
  bulanAwal: number;
  jadwalAwal: JadwalTimRow[];
  timList: TimRow[];
}) {
  const [tahun, setTahun] = useState(tahunAwal);
  const [bulan, setBulan] = useState(bulanAwal);
  const [jadwal, setJadwal] = useState(jadwalAwal);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tahun === tahunAwal && bulan === bulanAwal) return;
    let cancelled = false;
    setLoading(true);
    getJadwalBulanAction(tahun, bulan).then((result) => {
      if (cancelled) return;
      if (result.success) setJadwal(result.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tahun, bulan, tahunAwal, bulanAwal]);

  function gantiBulan(delta: number) {
    let nextBulan = bulan + delta;
    let nextTahun = tahun;
    if (nextBulan < 1) {
      nextBulan = 12;
      nextTahun -= 1;
    } else if (nextBulan > 12) {
      nextBulan = 1;
      nextTahun += 1;
    }
    setBulan(nextBulan);
    setTahun(nextTahun);
  }

  function handleSaved(tanggalUsaha: string, shift: ShiftNumber, timId: number) {
    setJadwal((prev) => {
      const timNama = timList.find((t) => t.timId === timId)?.nama ?? "";
      const tanpaLama = prev.filter((j) => !(j.tanggalUsaha === tanggalUsaha && j.shift === shift));
      return [...tanpaLama, { tanggalUsaha, shift, timId, timNama }];
    });
  }

  async function pilihSel(tanggalUsaha: string, shift: ShiftNumber, timId: number) {
    const result = await setJadwalTimAction(tanggalUsaha, shift, timId);
    if (result.success) handleSaved(tanggalUsaha, shift, timId);
  }

  const jumlahHari = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  const tanggalList = Array.from({ length: jumlahHari }, (_, i) => new Date(Date.UTC(tahun, bulan - 1, i + 1)).toISOString().slice(0, 10));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => gantiBulan(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-semibold">
          {BULAN_NAMA[bulan - 1]} {tahun}
        </p>
        <Button variant="outline" size="icon" onClick={() => gantiBulan(1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Memuat...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr>
                <th className="border-b border-border p-1.5 text-left">Tanggal</th>
                {KOLOM_SHIFT.map((k) => (
                  <th key={k.shift} className="border-b border-border p-1.5 text-left font-normal text-muted-foreground">
                    {k.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tanggalList.map((tanggalUsaha) => (
                <tr key={tanggalUsaha}>
                  <td className="border-b border-border p-1.5 font-medium">{tanggalUsaha}</td>
                  {KOLOM_SHIFT.map((k) => {
                    const entry = jadwal.find((j) => j.tanggalUsaha === tanggalUsaha && j.shift === k.shift);
                    return (
                      <td key={k.shift} className="border-b border-border p-1.5">
                        <SelSelect timId={entry?.timId ?? null} timList={timList} onPilih={(timId) => pilihSel(tanggalUsaha, k.shift, timId)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

`SelSelect` sengaja tidak memanggil `setJadwalTimAction` sendiri (ia tidak tahu `tanggalUsaha`/`shift` baris tempat ia dirender) — parent (`JadwalTimBulanan`) yang memanggil `pilihSel` lewat prop `onPilih`, sudah tercermin di kode `JadwalTimBulanan` pada Step 1 di atas (fungsi `pilihSel` memanggil `setJadwalTimAction` lalu `handleSaved`).

- [ ] **Step 2: Wiring ke `src/app/mkesindo/(dashboard)/produksi/page.tsx`**

Tambah import:

```tsx
import { getJadwalBulan } from "@/lib/queries/jadwal-tim-produksi";
import { getCurrentShift } from "@/lib/queries/aktivitas-produksi";
import { JadwalTimBulanan } from "@/components/produksi/jadwal-tim-bulanan";
```

Di dalam `ProduksiPage`, sebelum `Promise.all` yang sudah ada, hitung tahun/bulan berjalan dari `getCurrentShift()` (WIB-aware, konsisten dengan sisa aplikasi):

```tsx
const { tanggalUsaha } = getCurrentShift();
const tahunAwal = Number(tanggalUsaha.slice(0, 4));
const bulanAwal = Number(tanggalUsaha.slice(5, 7));
```

Tambahkan `getJadwalBulan(tahunAwal, bulanAwal)` ke dalam `Promise.all` yang sudah ada (sekarang jadi 6 elemen):

```tsx
const [posisi, mesinList, timList, anggotaTimList, produksiAkunOptions, riwayatRaw, jadwalAwal] = await Promise.all([
  getWarehouseMap(),
  getMesinList(),
  getAllTim(),
  getSemuaAnggotaTim(),
  getProduksiAkunOptions(),
  getRiwayatProduksi(),
  getJadwalBulan(tahunAwal, bulanAwal),
]);
```

Tambah section baru setelah section "Tim Produksi":

```tsx
<section>
  <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Jadwal Tim Produksi</h2>
  <JadwalTimBulanan tahunAwal={tahunAwal} bulanAwal={bulanAwal} jadwalAwal={jadwalAwal} timList={timList} />
</section>
```

- [ ] **Step 3: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/produksi/jadwal-tim-bulanan.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"`
Expected: tidak ada error.

Buka `/mkesindo/produksi` sebagai akun Supervisor/Admin di browser. Konfirmasi: kalender bulan berjalan tampil dengan kolom Shift 2/3/1 (urutan itu), pilih Tim di satu sel, reload halaman, konfirmasi pilihan tersimpan (persist di DB, bukan cuma state lokal).

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi/jadwal-tim-bulanan.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"
git commit -m "feat: add Jadwal Tim Produksi monthly scheduling calendar"
```

---

### Task 4: Kroscek & Koreksi Live "Tim Bertugas"

**Files:**
- Modify: `src/components/produksi-app/aktivitas-produksi-view.tsx`
- Modify: `src/components/produksi-app/riwayat-aktivitas-produksi.tsx`
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx`
- Modify: `src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx`

**Interfaces:**
- Consumes: `setTimBertugasAction`, `getAllTimAction` (Task 2, `actions.ts`), `TimRow` (Task 2, `tim-produksi.ts`), `AktivitasShiftInfo.timId` (Task 2, `aktivitas-produksi.ts`).
- Produces: `TimBertugasSelect` component (dieksport dari `aktivitas-produksi-view.tsx`, dipakai `riwayat-aktivitas-produksi.tsx` — pola yang sama seperti `StafOperasionalSelect` yang sudah ada).

- [ ] **Step 1: Tambah `TimBertugasSelect` + wiring di `src/components/produksi-app/aktivitas-produksi-view.tsx`**

Tambah import di baris atas:

```tsx
import type { TimRow } from "@/lib/queries/tim-produksi";
import { upsertStafOperasionalAction, upsertKerusakanAction, setTimBertugasAction } from "@/app/mkesindo/produksi/actions";
```

(baris `upsertStafOperasionalAction, upsertKerusakanAction` yang sudah ada di-extend dengan `setTimBertugasAction`, bukan baris baru terpisah)

Tambah komponen baru setelah `StafOperasionalSelect` (setelah baris 162, sebelum `export function AktivitasProduksiView`):

```tsx
const BELUM_DIJADWALKAN = "__belum_dijadwalkan__";

export function TimBertugasSelect({
  tanggalUsaha,
  shift,
  timId,
  timList,
  onChanged,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  timId: number | null;
  timList: TimRow[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string) {
    if (value === BELUM_DIJADWALKAN) return;
    startTransition(async () => {
      await setTimBertugasAction(tanggalUsaha, shift, Number(value));
      onChanged();
    });
  }

  return (
    <Select value={timId != null ? String(timId) : BELUM_DIJADWALKAN} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger>
        <SelectValue placeholder="Pilih Tim" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={BELUM_DIJADWALKAN} disabled>
          Tim belum dijadwalkan — pilih Tim
        </SelectItem>
        {timList.map((t) => (
          <SelectItem key={t.timId} value={String(t.timId)}>
            {t.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

Ubah signature `AktivitasProduksiView` — tambah `timList` ke props, dan tambah Card "Tim Bertugas" sebelum Card "Staf Operasional Bertugas":

```tsx
export function AktivitasProduksiView({
  current,
  qty,
  susunanTim,
  stafOperasionalNama,
  mesinList,
  mesinEvents,
  stafOperasionalOptions,
  timList,
  riwayat,
  onChanged,
}: {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  susunanTim: SusunanTimRow[];
  stafOperasionalNama: string | null;
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
  riwayat: AktivitasShiftInfo[];
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {current.tanggalUsaha} — {current.shiftLabel}
      </h2>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Tim Bertugas</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <TimBertugasSelect tanggalUsaha={current.tanggalUsaha} shift={current.shift} timId={current.timId} timList={timList} onChanged={onChanged} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Staf Operasional Bertugas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 pt-0">
          <p className="text-sm font-medium">{stafOperasionalNama ?? "Belum ada aktivitas tercatat"}</p>
          <p className="text-xs text-muted-foreground">
            Stok Es Sebelumnya (10KG): <span className="font-medium text-foreground">{current.stokEsSebelumnya10KG.toLocaleString("id-ID")}</span>
          </p>
        </CardContent>
      </Card>

      <TimProduksiRoster tanggalUsaha={current.tanggalUsaha} shift={current.shift} susunanTim={susunanTim} canEdit onChanged={onChanged} />
      <MesinEventPanel mesinList={mesinList} events={mesinEvents} onChanged={onChanged} />
      <QtyRecapCard qty={qty} jumlahHadir={susunanTim.length} />
      <KerusakanCard tanggalUsaha={current.tanggalUsaha} shift={current.shift} current={current} onSaved={onChanged} />
      <RiwayatAktivitasProduksi riwayat={riwayat} stafOperasionalOptions={stafOperasionalOptions} timList={timList} onChanged={onChanged} />
    </div>
  );
}
```

- [ ] **Step 2: Wiring `src/components/produksi-app/riwayat-aktivitas-produksi.tsx`**

Tambah import:

```tsx
import { TimProduksiRoster } from "@/components/produksi-app/tim-produksi-roster";
import { QtyRecapCard, KerusakanCard, StafOperasionalSelect, TimBertugasSelect } from "@/components/produksi-app/aktivitas-produksi-view";
import type { TimRow } from "@/lib/queries/tim-produksi";
```

Ubah `UbahAktivitasDialog` — tambah prop `timList`, render `TimBertugasSelect` sebelum Card "Staf Operasional Bertugas":

```tsx
function UbahAktivitasDialog({
  row,
  stafOperasionalOptions,
  timList,
  onOpenChange,
}: {
  row: AktivitasShiftInfo;
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset display before the async fetch below, same pattern as UbahRiwayatDialog.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    setError(null);
    getAktivitasDetailAction(row.tanggalUsaha, row.shift).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setDetail(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [row.tanggalUsaha, row.shift]);

  function refetchDetail() {
    getAktivitasDetailAction(row.tanggalUsaha, row.shift).then((result) => {
      if (result.success) setDetail(result.data);
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ubah Aktivitas — {formatDate(row.tanggalUsaha)}</DialogTitle>
          <DialogDescription>{row.shiftLabel}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!detail && !error && <p className="text-xs text-muted-foreground">Memuat...</p>}
        {detail && (
          <div className="flex flex-col gap-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Tim Bertugas</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <TimBertugasSelect tanggalUsaha={row.tanggalUsaha} shift={row.shift} timId={detail.current.timId} timList={timList} onChanged={refetchDetail} />
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Staf Operasional Bertugas</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <StafOperasionalSelect
                  tanggalUsaha={row.tanggalUsaha}
                  shift={row.shift}
                  stafOperasionalAkunId={detail.current.stafOperasionalAkunId}
                  stafOperasionalOptions={stafOperasionalOptions}
                  onChanged={refetchDetail}
                />
              </CardContent>
            </Card>
            <TimProduksiRoster
              tanggalUsaha={row.tanggalUsaha}
              shift={row.shift}
              susunanTim={detail.susunanTim}
              canEdit
              onChanged={refetchDetail}
            />
            <QtyRecapCard qty={detail.qty} jumlahHadir={detail.susunanTim.length} />
            <KerusakanCard tanggalUsaha={row.tanggalUsaha} shift={row.shift} current={detail.current} onSaved={refetchDetail} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

Ubah `RiwayatAktivitasProduksi` — tambah prop `timList`, teruskan ke `UbahAktivitasDialog`:

```tsx
export function RiwayatAktivitasProduksi({
  riwayat,
  stafOperasionalOptions,
  timList,
  onChanged,
}: {
  riwayat: AktivitasShiftInfo[];
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<AktivitasShiftInfo | null>(null);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Riwayat</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {riwayat.map((r) => (
          <div key={`${r.tanggalUsaha}-${r.shift}`} className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
            <span>
              {formatDate(r.tanggalUsaha)} — {r.shiftLabel}
            </span>
            <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
              Ubah
            </Button>
          </div>
        ))}
        {riwayat.length === 0 && <p className="text-xs text-muted-foreground">Belum ada riwayat.</p>}
      </CardContent>
      {editing && (
        <UbahAktivitasDialog
          row={editing}
          stafOperasionalOptions={stafOperasionalOptions}
          timList={timList}
          onOpenChange={(open) => {
            if (open) return;
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Wiring `src/components/produksi-app/produksi-tab-shell.tsx`**

Tambah import:

```tsx
import { getAllTimAction } from "@/app/mkesindo/produksi/actions";
import type { TimRow } from "@/lib/queries/tim-produksi";
```

Ubah tipe `initialAktivitasProduksi` (tambah `timList: TimRow[]`):

```tsx
initialAktivitasProduksi?: {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  susunanTim: SusunanTimRow[];
  stafOperasionalNama: string | null;
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
  riwayat: AktivitasShiftInfo[];
};
```

Di dalam `useEffect`'s `load()`, blok `activeTab === "aktivitas-produksi"` — tambahkan `getAllTimAction()` ke `Promise.all` yang sudah memanggil `getMesinListAction()`/`getAktivitasRiwayatAction()`:

```tsx
if (activeTab === "aktivitas-produksi" && aktivitasProduksi === null) {
  setLoadingTab("aktivitas-produksi");
  const [aktivitasResult, mesinResult, riwayatResult, timListResult] = await Promise.all([
    getCurrentAktivitasProduksiAction(),
    getMesinListAction(),
    getAktivitasRiwayatAction(),
    getAllTimAction(),
  ]);
  if (cancelled) return;
  if (!aktivitasResult.success) {
    setTabError(aktivitasResult.error);
    setLoadingTab(null);
    return;
  }
  if (!mesinResult.success) {
    setTabError(mesinResult.error);
    setLoadingTab(null);
    return;
  }
  if (!riwayatResult.success) {
    setTabError(riwayatResult.error);
    setLoadingTab(null);
    return;
  }
  if (!timListResult.success) {
    setTabError(timListResult.error);
    setLoadingTab(null);
    return;
  }
  const [eventsResult, stafResult] = await Promise.all([
    getMesinEventsForShiftAction(aktivitasResult.data.current.tanggalUsaha, aktivitasResult.data.current.shift),
    getStafOperasionalOptionsAction(),
  ]);
  if (cancelled) return;
  if (!eventsResult.success) {
    setTabError(eventsResult.error);
    setLoadingTab(null);
    return;
  }
  if (!stafResult.success) {
    setTabError(stafResult.error);
    setLoadingTab(null);
    return;
  }
  setAktivitasProduksi({
    ...aktivitasResult.data,
    mesinList: mesinResult.data,
    mesinEvents: eventsResult.data,
    stafOperasionalOptions: stafResult.data,
    timList: timListResult.data,
    riwayat: riwayatResult.data,
  });
  setLoadingTab(null);
}
```

Teruskan `timList` ke `AktivitasProduksiView` di JSX bagian bawah:

```tsx
{visited.has("aktivitas-produksi") && aktivitasProduksi && (
  <div className={cn("h-full overflow-y-auto", activeTab !== "aktivitas-produksi" && "hidden")}>
    <AktivitasProduksiView
      current={aktivitasProduksi.current}
      qty={aktivitasProduksi.qty}
      susunanTim={aktivitasProduksi.susunanTim}
      stafOperasionalNama={aktivitasProduksi.stafOperasionalNama}
      mesinList={aktivitasProduksi.mesinList}
      mesinEvents={aktivitasProduksi.mesinEvents}
      stafOperasionalOptions={aktivitasProduksi.stafOperasionalOptions}
      timList={aktivitasProduksi.timList}
      riwayat={aktivitasProduksi.riwayat}
      onChanged={refreshAktivitasProduksi}
    />
  </div>
)}
```

- [ ] **Step 4: Wiring `src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getUserById, getAkunNamaMap, getStafOperasionalOptions } from "@/lib/queries/akun";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getMesinEventsForShift } from "@/lib/queries/produksi-mesin-event";
import { getCurrentShift, getAktivitasForShift, getQtyRecapForShift, getSusunanTim, getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { getAllTim } from "@/lib/queries/tim-produksi";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Aktivitas Produksi" };

export default async function ProduksiAppAktivitasProduksiPage() {
  const session = await requireProduksi();
  const { tanggalUsaha, shift } = getCurrentShift();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);

  const [profile, current, qty, susunanTim, mesinList, mesinEvents, stafOperasionalOptions, timList, riwayat] = await Promise.all([
    getUserById(Number(session.user.id)),
    getAktivitasForShift(tanggalUsaha, shift),
    getQtyRecapForShift(tanggalUsaha, shift),
    getSusunanTim(tanggalUsaha, shift),
    getMesinList(),
    getMesinEventsForShift(businessDate, shift),
    getStafOperasionalOptions(),
    getAllTim(),
    getAktivitasRiwayat(),
  ]);
  const namaMap = await getAkunNamaMap(current.stafOperasionalAkunId != null ? [current.stafOperasionalAkunId] : []);
  const stafOperasionalNama = current.stafOperasionalAkunId != null ? (namaMap.get(current.stafOperasionalAkunId) ?? null) : null;

  return (
    <ProduksiTabShell
      initialTab="aktivitas-produksi"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialAktivitasProduksi={{ current, qty, susunanTim, stafOperasionalNama, mesinList, mesinEvents, stafOperasionalOptions, timList, riwayat }}
    />
  );
}
```

- [ ] **Step 5: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/produksi-app/aktivitas-produksi-view.tsx src/components/produksi-app/riwayat-aktivitas-produksi.tsx src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx"`
Expected: tidak ada error.

Buka tab Aktivitas di produksi-app. Konfirmasi: Card "Tim Bertugas" tampil di atas "Staf Operasional Bertugas", pilih Tim, konfirmasi Susunan Tim di bawahnya ikut berubah ke roster default Tim itu (tanpa reload). Buka salah satu baris Riwayat → "Ubah" → konfirmasi Card "Tim Bertugas" juga muncul di dialog itu dan bisa dikoreksi.

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi-app/aktivitas-produksi-view.tsx src/components/produksi-app/riwayat-aktivitas-produksi.tsx src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx"
git commit -m "feat: add live Tim Bertugas cross-check and correction"
```

---

### Task 5: Panel Swalayan "Tim Saya" untuk Kepala Produksi

**Files:**
- Create: `src/components/produksi-app/tim-saya-panel.tsx`
- Modify: `src/components/produksi-app/aktivitas-produksi-view.tsx`
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx`
- Modify: `src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx`

**Interfaces:**
- Consumes: `tambahAnggotaTimSayaAction`, `hapusAnggotaTimSayaAction`, `getTimSayaAction` (Task 2, `actions.ts`), `getTimByKepalaAkunId`, `getAnggotaTim`, `AnggotaTimRow` (Task 2, `tim-produksi.ts`).
- Produces: `TimSayaPanel` component — tidak dikonsumsi task lain.

- [ ] **Step 1: Buat `src/components/produksi-app/tim-saya-panel.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { tambahAnggotaTimSayaAction, hapusAnggotaTimSayaAction } from "@/app/mkesindo/produksi/actions";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";

export function TimSayaPanel({
  timNama,
  anggota,
  onChanged,
}: {
  timNama: string;
  anggota: AnggotaTimRow[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleTambah() {
    if (!nama.trim()) {
      setError("Nama tidak boleh kosong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await tambahAnggotaTimSayaAction(nama.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setNama("");
      setOpen(false);
      onChanged();
    });
  }

  function handleNonaktifkan(anggotaId: number, namaAnggota: string) {
    if (!confirm(`Nonaktifkan ${namaAnggota} dari ${timNama}?`)) return;
    startTransition(async () => {
      const result = await hapusAnggotaTimSayaAction(anggotaId);
      if (result.success) onChanged();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Tim Saya — {timNama}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {anggota.map((a) => (
          <div key={a.anggotaId} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-sm">
            <span>{a.nama}</span>
            <button
              type="button"
              onClick={() => handleNonaktifkan(a.anggotaId, a.nama)}
              disabled={pending}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2 text-sm text-muted-foreground hover:bg-muted/50">
            <Plus className="size-4" /> Tambah Anggota
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Tambah Anggota — {timNama}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama anggota" />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button disabled={pending} onClick={handleTambah}>
                {pending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wiring `src/components/produksi-app/aktivitas-produksi-view.tsx`**

Tambah import:

```tsx
import { TimSayaPanel } from "@/components/produksi-app/tim-saya-panel";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
```

Tambah prop `timSaya` ke `AktivitasProduksiView` dan render `TimSayaPanel` di paling atas (sebelum Card "Tim Bertugas") kalau tidak `null`:

```tsx
export function AktivitasProduksiView({
  current,
  qty,
  susunanTim,
  stafOperasionalNama,
  mesinList,
  mesinEvents,
  stafOperasionalOptions,
  timList,
  timSaya,
  riwayat,
  onChanged,
}: {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  susunanTim: SusunanTimRow[];
  stafOperasionalNama: string | null;
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
  timSaya: { timId: number; nama: string; anggota: AnggotaTimRow[] } | null;
  riwayat: AktivitasShiftInfo[];
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {current.tanggalUsaha} — {current.shiftLabel}
      </h2>

      {timSaya && <TimSayaPanel timNama={timSaya.nama} anggota={timSaya.anggota} onChanged={onChanged} />}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Tim Bertugas</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <TimBertugasSelect tanggalUsaha={current.tanggalUsaha} shift={current.shift} timId={current.timId} timList={timList} onChanged={onChanged} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Staf Operasional Bertugas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 pt-0">
          <p className="text-sm font-medium">{stafOperasionalNama ?? "Belum ada aktivitas tercatat"}</p>
          <p className="text-xs text-muted-foreground">
            Stok Es Sebelumnya (10KG): <span className="font-medium text-foreground">{current.stokEsSebelumnya10KG.toLocaleString("id-ID")}</span>
          </p>
        </CardContent>
      </Card>

      <TimProduksiRoster tanggalUsaha={current.tanggalUsaha} shift={current.shift} susunanTim={susunanTim} canEdit onChanged={onChanged} />
      <MesinEventPanel mesinList={mesinList} events={mesinEvents} onChanged={onChanged} />
      <QtyRecapCard qty={qty} jumlahHadir={susunanTim.length} />
      <KerusakanCard tanggalUsaha={current.tanggalUsaha} shift={current.shift} current={current} onSaved={onChanged} />
      <RiwayatAktivitasProduksi riwayat={riwayat} stafOperasionalOptions={stafOperasionalOptions} timList={timList} onChanged={onChanged} />
    </div>
  );
}
```

- [ ] **Step 3: Wiring `src/components/produksi-app/produksi-tab-shell.tsx`**

Tambah import:

```tsx
import { getTimSayaAction } from "@/app/mkesindo/produksi/actions";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
```

Tambah `timSaya` ke tipe `initialAktivitasProduksi`:

```tsx
initialAktivitasProduksi?: {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  susunanTim: SusunanTimRow[];
  stafOperasionalNama: string | null;
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
  timSaya: { timId: number; nama: string; anggota: AnggotaTimRow[] } | null;
  riwayat: AktivitasShiftInfo[];
};
```

Di blok `activeTab === "aktivitas-produksi"`, tambahkan `getTimSayaAction()` ke `Promise.all` pertama (bersama `getAllTimAction()` dari Task 4):

```tsx
const [aktivitasResult, mesinResult, riwayatResult, timListResult, timSayaResult] = await Promise.all([
  getCurrentAktivitasProduksiAction(),
  getMesinListAction(),
  getAktivitasRiwayatAction(),
  getAllTimAction(),
  getTimSayaAction(),
]);
if (cancelled) return;
if (!aktivitasResult.success) {
  setTabError(aktivitasResult.error);
  setLoadingTab(null);
  return;
}
if (!mesinResult.success) {
  setTabError(mesinResult.error);
  setLoadingTab(null);
  return;
}
if (!riwayatResult.success) {
  setTabError(riwayatResult.error);
  setLoadingTab(null);
  return;
}
if (!timListResult.success) {
  setTabError(timListResult.error);
  setLoadingTab(null);
  return;
}
if (!timSayaResult.success) {
  setTabError(timSayaResult.error);
  setLoadingTab(null);
  return;
}
```

Lalu masukkan `timSaya: timSayaResult.data` ke `setAktivitasProduksi(...)`:

```tsx
setAktivitasProduksi({
  ...aktivitasResult.data,
  mesinList: mesinResult.data,
  mesinEvents: eventsResult.data,
  stafOperasionalOptions: stafResult.data,
  timList: timListResult.data,
  timSaya: timSayaResult.data,
  riwayat: riwayatResult.data,
});
```

Teruskan `timSaya` ke `AktivitasProduksiView`:

```tsx
<AktivitasProduksiView
  current={aktivitasProduksi.current}
  qty={aktivitasProduksi.qty}
  susunanTim={aktivitasProduksi.susunanTim}
  stafOperasionalNama={aktivitasProduksi.stafOperasionalNama}
  mesinList={aktivitasProduksi.mesinList}
  mesinEvents={aktivitasProduksi.mesinEvents}
  stafOperasionalOptions={aktivitasProduksi.stafOperasionalOptions}
  timList={aktivitasProduksi.timList}
  timSaya={aktivitasProduksi.timSaya}
  riwayat={aktivitasProduksi.riwayat}
  onChanged={refreshAktivitasProduksi}
/>
```

- [ ] **Step 4: Wiring `src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx`**

Tambah import:

```tsx
import { getAllTim, getTimByKepalaAkunId, getAnggotaTim } from "@/lib/queries/tim-produksi";
```

Setelah `Promise.all` yang sudah ada, tambahkan lookup Tim Saya (Server Component ini sudah punya akses langsung ke query functions, tidak perlu lewat Action):

```tsx
export default async function ProduksiAppAktivitasProduksiPage() {
  const session = await requireProduksi();
  const { tanggalUsaha, shift } = getCurrentShift();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);

  const [profile, current, qty, susunanTim, mesinList, mesinEvents, stafOperasionalOptions, timList, riwayat] = await Promise.all([
    getUserById(Number(session.user.id)),
    getAktivitasForShift(tanggalUsaha, shift),
    getQtyRecapForShift(tanggalUsaha, shift),
    getSusunanTim(tanggalUsaha, shift),
    getMesinList(),
    getMesinEventsForShift(businessDate, shift),
    getStafOperasionalOptions(),
    getAllTim(),
    getAktivitasRiwayat(),
  ]);
  const namaMap = await getAkunNamaMap(current.stafOperasionalAkunId != null ? [current.stafOperasionalAkunId] : []);
  const stafOperasionalNama = current.stafOperasionalAkunId != null ? (namaMap.get(current.stafOperasionalAkunId) ?? null) : null;

  const timSayaBase = await getTimByKepalaAkunId(Number(session.user.id));
  const timSaya = timSayaBase ? { ...timSayaBase, anggota: await getAnggotaTim(timSayaBase.timId) } : null;

  return (
    <ProduksiTabShell
      initialTab="aktivitas-produksi"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialAktivitasProduksi={{ current, qty, susunanTim, stafOperasionalNama, mesinList, mesinEvents, stafOperasionalOptions, timList, timSaya, riwayat }}
    />
  );
}
```

- [ ] **Step 5: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/produksi-app/tim-saya-panel.tsx src/components/produksi-app/aktivitas-produksi-view.tsx src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx"`
Expected: tidak ada error.

Login sebagai akun biasa (bukan Kepala) di produksi-app, tab Aktivitas — konfirmasi Card "Tim Saya" TIDAK muncul. Setelah salah satu dari 3 akun Kepala Produksi dibuat dan ditaut lewat panel admin (Task 2 Step 6), login sebagai akun itu — konfirmasi Card "Tim Saya" muncul dengan roster timnya, tambah satu anggota uji coba, konfirmasi muncul di list, nonaktifkan, konfirmasi hilang dari list.

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi-app/tim-saya-panel.tsx src/components/produksi-app/aktivitas-produksi-view.tsx src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx"
git commit -m "feat: add self-service Tim Saya panel for Kepala Produksi"
```
