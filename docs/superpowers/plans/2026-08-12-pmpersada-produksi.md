# Modul Produksi PMPersada (Pelacakan Pembekuan Es) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/pmpersada/produksi` (dashboard desktop, Admin) dan `/pmpersada/produksi-app` (mobile, 9 operator shift) — pelacakan proses pembekuan es (Bak/Rek/Ice Can) untuk pabrik Tuban, dari nol (belum ada sistem digital sebelumnya).

**Architecture:** 5 tabel MSSQL baru di DB `FINAC_ES_TB` PMPersada (via `getCompanyPool("pmpersada","utama")`), mengikuti pola `DashboardProduksiPalletPosisi`/`DashboardProduksiBatch` MKEsindo (Rek = slot, Batch = siklus pembekuan, tidak pernah di-overwrite). Progres tahap pembekuan dihitung server-side dari `WaktuIsi`/`EstimasiBeku` setiap fetch, tidak disimpan sebagai kolom. Dashboard desktop pakai `Tabs` yang sudah ada di UI kit; app mobile pakai shell tab-bawah mengikuti pola persis `produksi-app` MKEsindo.

**Tech Stack:** Next.js App Router (server actions), MSSQL (`mssql` package via `getCompanyPool`), Postgres (`peran`/`akun` untuk akun operator).

**Reference spec:** `docs/superpowers/specs/2026-08-12-pmpersada-produksi-design.md` — baca untuk konteks penuh kalau ada yang ambigu; plan ini adalah sumber kebenaran untuk nilai-nilai eksak.

## Global Constraints

- 5 Bak: Bak 1 (37 Rek), Bak 2 (37), Bak 3 (44), Bak 4 (66), Bak 5 (66) — total 250 Rek. Nilai ini FIXED, jangan diubah.
- Jenis Es: `BK` (36 Can/Rek default) atau `BB` (18 Can/Rek default) — properti per-Batch, bisa dikoreksi Admin.
- Durasi beku standar default: BK = 24 jam, BB = 32 jam — tersimpan di `DashboardProduksiKonfigurasi`, bisa diubah Admin, TIDAK hardcode di kode setelah Task 2.
- `BB` (jenis es) dan status `BABONAN` adalah dua konsep independen — jangan digabung/disamakan.
- Semua tabel baru pakai prefix `DashboardProduksi*`, hidup di DB `FINAC_ES_TB` (label `"utama"`), diakses lewat `getCompanyPool("pmpersada", "utama")` — TIDAK PERNAH `getPool()` biasa (itu punya MKEsindo).
- Panel peringatan/deteksi anomali dilabeli jujur sebagai "Peringatan" — JANGAN pakai istilah "AI"/"AI Engine" di UI manapun.
- Semua pesan error pengguna pakai `AppError` dari `@/lib/action-result`, semua server action pakai `runAction()` + `ActionResult<T>` — pola yang sudah konsisten dipakai di seluruh codebase ini.
- Setiap aksi yang mengubah state (Isi Air Baru, Babonan, Maintenance, Override, Koreksi, Update Konfigurasi) WAJIB menulis satu baris ke `DashboardProduksiAuditLog` dalam transaksi yang sama.

---

### Task 0: DDL — 5 tabel baru + seed (controller-run)

**Files:**
- Tidak ada file kode yang dibuat/diubah — DDL dijalankan langsung oleh controller lewat SQL MCP tool (atau fallback script `npx tsx` sekali-pakai kalau connector transient-fail, pola yang sudah dipakai berulang di sesi ini), terhadap DB `FINAC_ES_TB` (`kode="pmpersada"`, `label="utama"`).

**Interfaces:**
- Produces: 5 tabel siap dipakai oleh Task 2-4.

- [ ] **Step 1: Jalankan DDL berikut (idempotent, check-then-create)**

```sql
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardProduksiBak')
BEGIN
  CREATE TABLE DashboardProduksiBak (
    BakID INT IDENTITY(1,1) PRIMARY KEY,
    Nama VARCHAR(20) NOT NULL,
    TotalRek INT NOT NULL
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardProduksiBatch')
BEGIN
  CREATE TABLE DashboardProduksiBatch (
    BatchID INT IDENTITY(1,1) PRIMARY KEY,
    RekID INT NOT NULL,
    JenisEs VARCHAR(4) NOT NULL,
    JumlahCan INT NOT NULL,
    IsBabonan BIT NOT NULL DEFAULT 0,
    WaktuIsi DATETIME NOT NULL,
    EstimasiBeku DATETIME NOT NULL,
    DicatatOlehAkunID INT NOT NULL,
    ClosedDate DATETIME NULL,
    CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardProduksiRek')
BEGIN
  CREATE TABLE DashboardProduksiRek (
    RekID INT IDENTITY(1,1) PRIMARY KEY,
    BakID INT NOT NULL,
    NomorRek INT NOT NULL,
    IsMaintenance BIT NOT NULL DEFAULT 0,
    BatchIDAktif INT NULL,
    ModifiedDate DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_DashboardProduksiRek_Bak FOREIGN KEY (BakID) REFERENCES DashboardProduksiBak(BakID)
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardProduksiAuditLog')
BEGIN
  CREATE TABLE DashboardProduksiAuditLog (
    LogID INT IDENTITY(1,1) PRIMARY KEY,
    RekID INT NOT NULL,
    BatchID INT NULL,
    AksiLabel NVARCHAR(100) NOT NULL,
    Keterangan NVARCHAR(200) NULL,
    DicatatOlehAkunID INT NOT NULL,
    CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DashboardProduksiKonfigurasi')
BEGIN
  CREATE TABLE DashboardProduksiKonfigurasi (
    ID INT PRIMARY KEY,
    DurasiBKJam INT NOT NULL,
    DurasiBBJam INT NOT NULL,
    ModifiedDate DATETIME NOT NULL DEFAULT GETDATE(),
    ModifiedByAkunID INT NULL
  );
END
```

- [ ] **Step 2: Seed Bak (idempotent)**

```sql
IF NOT EXISTS (SELECT 1 FROM DashboardProduksiBak)
BEGIN
  INSERT INTO DashboardProduksiBak (Nama, TotalRek) VALUES
    ('Bak 1', 37), ('Bak 2', 37), ('Bak 3', 44), ('Bak 4', 66), ('Bak 5', 66);
END
```

- [ ] **Step 3: Seed 250 Rek kosong (idempotent)**

```sql
IF NOT EXISTS (SELECT 1 FROM DashboardProduksiRek)
BEGIN
  DECLARE @BakID INT, @Total INT, @i INT;
  DECLARE bak_cursor CURSOR FOR SELECT BakID, TotalRek FROM DashboardProduksiBak ORDER BY BakID;
  OPEN bak_cursor;
  FETCH NEXT FROM bak_cursor INTO @BakID, @Total;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @i = 1;
    WHILE @i <= @Total
    BEGIN
      INSERT INTO DashboardProduksiRek (BakID, NomorRek) VALUES (@BakID, @i);
      SET @i = @i + 1;
    END
    FETCH NEXT FROM bak_cursor INTO @BakID, @Total;
  END
  CLOSE bak_cursor;
  DEALLOCATE bak_cursor;
END
```

- [ ] **Step 4: Seed Konfigurasi default (idempotent)**

```sql
IF NOT EXISTS (SELECT 1 FROM DashboardProduksiKonfigurasi WHERE ID = 1)
BEGIN
  INSERT INTO DashboardProduksiKonfigurasi (ID, DurasiBKJam, DurasiBBJam) VALUES (1, 24, 32);
END
```

- [ ] **Step 5: Verifikasi**

Jalankan `SELECT COUNT(*) FROM DashboardProduksiRek` — harus `250`. `SELECT * FROM DashboardProduksiBak ORDER BY BakID` — harus 5 baris cocok dengan Global Constraints. `SELECT * FROM DashboardProduksiKonfigurasi` — harus 1 baris (24, 32).

---

### Task 1: Auth guards — `requirePmpersadaProduksi()` + tutup celah `requirePmpersadaKeuangan()`

**Files:**
- Modify: `src/lib/require-access.ts`
- Modify: `src/app/pmpersada/keuangan/page.tsx:41`

**Interfaces:**
- Produces: `requirePmpersadaProduksi()`, `requirePmpersadaKeuangan()` — dipakai Task 5, 6, dan menggantikan `requirePmpersada()` di halaman keuangan.
- Consumes: `session.user.isProduksi` (boolean), `session.user.accountScope` (`AccountScope`), `canAccessAllPT()` — semua sudah ada di `src/lib/auth.ts`/`src/lib/require-access.ts`, tidak ada perubahan skema akun/session diperlukan (kolom `is_produksi` di `peran` Postgres sudah generic, tinggal dipakai ulang untuk peran PMPersada).

- [ ] **Step 1: Tambah `requirePmpersadaProduksi()` di `src/lib/require-access.ts`**

Tambahkan setelah `requireProduksiView()` (akhir file):

```ts
// Gerbang app mobile /pmpersada/produksi-app — operator lantai produksi
// PMPersada. Beda dari requireProduksiView() milik MKEsindo: sengaja TIDAK
// pakai canAccessAllPT() bypass di sini, karena akun Direktur/PMP Group
// yang mengelola banyak PT tidak otomatis relevan sebagai "operator
// lantai produksi PMPersada" — mereka melihat data ini lewat dashboard
// desktop /pmpersada/produksi (requirePmpersada() biasa), bukan app mobile ini.
export async function requirePmpersadaProduksi() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isProduksi || session.user.accountScope !== "pmpersada") {
    redirect("/akses-ditolak");
  }
  return session;
}
```

- [ ] **Step 2: Tambah `requirePmpersadaKeuangan()` — tutup celah is_produksi-only ke data finansial**

Tambahkan tepat setelah `requirePmpersada()`:

```ts
// requirePmpersada() sendiri hanya cek accountScope company-wide, tanpa
// cek modul — akun operator produksi PMPersada baru (Task 1 rencana ini)
// otomatis punya accountScope==="pmpersada" juga (dari perusahaan_id yang
// sama), jadi tanpa lapisan ini mereka bisa ikut membuka data finansial.
// canAccessAllPT() tetap lolos (Direktur/superadmin selalu boleh lihat semua).
export async function requirePmpersadaKeuangan() {
  const session = await requirePmpersada();
  if (session.user.isProduksi && !canAccessAllPT(session.user)) redirect("/akses-ditolak");
  return session;
}
```

- [ ] **Step 3: Pakai guard baru di halaman keuangan**

Di `src/app/pmpersada/keuangan/page.tsx`, ganti import dan pemanggilan:

```ts
import { requirePmpersadaKeuangan } from "@/lib/require-access";
```

Baris 41, ganti `await requirePmpersada();` → `await requirePmpersadaKeuangan();`.

- [ ] **Step 4: Verifikasi**

`npx tsc --noEmit` — harus 0 error. Baca ulang kedua fungsi baru untuk pastikan tidak ada typo pada nama field session (`isProduksi`, `accountScope`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/require-access.ts src/app/pmpersada/keuangan/page.tsx
git commit -m "feat: add requirePmpersadaProduksi + close is_produksi access gap on keuangan"
```

---

### Task 2: Query module — tipe + formula status + fungsi baca (`produksi-bak-pmpersada.ts`)

**Files:**
- Create: `src/lib/queries/produksi-bak-pmpersada.ts`

**Interfaces:**
- Consumes: `getCompanyPool` dari `@/lib/db-company`, `sql` dari `mssql`, `AppError` dari `@/lib/action-result`.
- Produces: `TahapPembekuan`, `RekMapRow`, `BakRow`, `KonfigurasiRow`, `getBakList()`, `getRekMap()`, `getKonfigurasi()` — dipakai Task 3-6.

- [ ] **Step 1: Tulis tipe dasar + formula status (dipakai bersama semua fungsi lain di file ini)**

```ts
import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import sql from "mssql";
import { AppError } from "@/lib/action-result";

const LABEL: CompanyKoneksiLabel = "utama";

async function getPool() {
  return getCompanyPool("pmpersada", LABEL);
}

export type TahapPembekuan = "BARU" | "MULAI" | "KRISTAL" | "SIAP" | "JADI" | "BABONAN" | "MAINTENANCE";

// Diporting persis dari formula draf referensi (getEffectiveRekStatus) —
// tahap & persentase TIDAK PERNAH disimpan sebagai kolom, selalu dihitung
// ulang dari WaktuIsi/EstimasiBeku setiap kali di-fetch.
function computeTahap(row: {
  IsMaintenance: boolean;
  BatchID: number | null;
  IsBabonan: boolean;
  WaktuIsi: Date | null;
  EstimasiBeku: Date | null;
}): { Tahap: TahapPembekuan; Pct: number; UsiaJam: number } {
  if (row.IsMaintenance) return { Tahap: "MAINTENANCE", Pct: 0, UsiaJam: 0 };
  if (row.BatchID == null || !row.WaktuIsi || !row.EstimasiBeku) return { Tahap: "BARU", Pct: 0, UsiaJam: 0 };

  const start = row.WaktuIsi.getTime();
  const usiaJam = (Date.now() - start) / 3600000;

  if (row.IsBabonan) return { Tahap: "BABONAN", Pct: 100, UsiaJam: usiaJam };

  const end = row.EstimasiBeku.getTime();
  if (end <= start) return { Tahap: "JADI", Pct: 100, UsiaJam: usiaJam };

  const pct = Math.min(100, Math.max(0, Math.round(((Date.now() - start) / (end - start)) * 100)));
  const tahap: TahapPembekuan = pct >= 100 ? "JADI" : pct >= 75 ? "SIAP" : pct >= 50 ? "KRISTAL" : pct > 0 ? "MULAI" : "BARU";
  return { Tahap: tahap, Pct: pct, UsiaJam: usiaJam };
}
```

- [ ] **Step 2: `getBakList()`**

```ts
export interface BakRow {
  BakID: number;
  Nama: string;
  TotalRek: number;
}

export async function getBakList(): Promise<BakRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT BakID, Nama, TotalRek FROM DashboardProduksiBak ORDER BY BakID`);
  return result.recordset;
}
```

- [ ] **Step 3: `getRekMap()` — denah lengkap 250 Rek dengan status terhitung**

```ts
export interface RekMapRow {
  RekID: number;
  BakID: number;
  BakNama: string;
  NomorRek: number;
  IsMaintenance: boolean;
  BatchID: number | null;
  JenisEs: "BK" | "BB" | null;
  JumlahCan: number | null;
  WaktuIsi: string | null;
  EstimasiBeku: string | null;
  IsBabonan: boolean;
  DicatatOlehAkunID: number | null;
  Tahap: TahapPembekuan;
  Pct: number;
  UsiaJam: number;
}

export async function getRekMap(): Promise<RekMapRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT r.RekID, r.BakID, bak.Nama AS BakNama, r.NomorRek, r.IsMaintenance, r.BatchIDAktif AS BatchID,
           b.JenisEs, b.JumlahCan, b.WaktuIsi, b.EstimasiBeku, b.IsBabonan, b.DicatatOlehAkunID
    FROM DashboardProduksiRek r
    JOIN DashboardProduksiBak bak ON bak.BakID = r.BakID
    LEFT JOIN DashboardProduksiBatch b ON b.BatchID = r.BatchIDAktif
    ORDER BY r.BakID, r.NomorRek
  `);
  const rows = result.recordset as {
    RekID: number;
    BakID: number;
    BakNama: string;
    NomorRek: number;
    IsMaintenance: boolean;
    BatchID: number | null;
    JenisEs: "BK" | "BB" | null;
    JumlahCan: number | null;
    WaktuIsi: Date | null;
    EstimasiBeku: Date | null;
    IsBabonan: boolean | null;
    DicatatOlehAkunID: number | null;
  }[];
  return rows.map((r) => {
    const eff = computeTahap({
      IsMaintenance: r.IsMaintenance,
      BatchID: r.BatchID,
      IsBabonan: r.IsBabonan ?? false,
      WaktuIsi: r.WaktuIsi,
      EstimasiBeku: r.EstimasiBeku,
    });
    return {
      RekID: r.RekID,
      BakID: r.BakID,
      BakNama: r.BakNama,
      NomorRek: r.NomorRek,
      IsMaintenance: r.IsMaintenance,
      BatchID: r.BatchID,
      JenisEs: r.JenisEs,
      JumlahCan: r.JumlahCan,
      WaktuIsi: r.WaktuIsi ? r.WaktuIsi.toISOString() : null,
      EstimasiBeku: r.EstimasiBeku ? r.EstimasiBeku.toISOString() : null,
      IsBabonan: r.IsBabonan ?? false,
      DicatatOlehAkunID: r.DicatatOlehAkunID,
      Tahap: eff.Tahap,
      Pct: eff.Pct,
      UsiaJam: eff.UsiaJam,
    };
  });
}
```

- [ ] **Step 4: `getKonfigurasi()` + `getKonfigurasiInternal()` (dipakai transaksi Task 3)**

```ts
export interface KonfigurasiRow {
  DurasiBKJam: number;
  DurasiBBJam: number;
}

export async function getKonfigurasi(): Promise<KonfigurasiRow> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT DurasiBKJam, DurasiBBJam FROM DashboardProduksiKonfigurasi WHERE ID = 1`);
  return result.recordset[0];
}

// Dipakai dari dalam transaksi (Task 3's isiAirBaru) — Request harus dibuat
// dari sql.Transaction, bukan pool langsung, supaya baca konsisten dalam
// transaksi yang sama.
export async function getKonfigurasiInternal(transaction: sql.Transaction): Promise<KonfigurasiRow> {
  const result = await new sql.Request(transaction).query(`SELECT DurasiBKJam, DurasiBBJam FROM DashboardProduksiKonfigurasi WHERE ID = 1`);
  return result.recordset[0];
}
```

- [ ] **Step 5: Verifikasi**

`npx tsc --noEmit` — 0 error. Belum ada pemanggil nyata, jadi tidak bisa dites live di langkah ini — ditest end-to-end di Task 5/8.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/produksi-bak-pmpersada.ts
git commit -m "feat: add produksi-bak-pmpersada.ts read layer (Bak/Rek map, status formula, konfigurasi)"
```

---

### Task 3: Query module — aksi Operator (`isiAirBaru`, `setBabonan`, `setMaintenance`)

**Files:**
- Modify: `src/lib/queries/produksi-bak-pmpersada.ts`

**Interfaces:**
- Consumes: `getKonfigurasiInternal()` (Task 2).
- Produces: `isiAirBaru()`, `setBabonan()`, `setMaintenance()` — dipakai Task 6 (mobile actions).

- [ ] **Step 1: `isiAirBaru()` — transaksi atomik: tutup batch lama, buka batch baru**

Tambahkan ke akhir file:

```ts
export async function isiAirBaru(rekId: number, jenisEs: "BK" | "BB", jumlahCan: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const config = await getKonfigurasiInternal(transaction);
    const durasiJam = jenisEs === "BK" ? config.DurasiBKJam : config.DurasiBBJam;

    const rekResult = await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .query(`SELECT BatchIDAktif FROM DashboardProduksiRek WHERE RekID = @rekId`);
    const rekRow = rekResult.recordset[0] as { BatchIDAktif: number | null } | undefined;
    if (!rekRow) throw new AppError("Rek tidak ditemukan.");

    if (rekRow.BatchIDAktif) {
      await new sql.Request(transaction)
        .input("batchId", sql.Int, rekRow.BatchIDAktif)
        .query(`UPDATE DashboardProduksiBatch SET ClosedDate = GETDATE() WHERE BatchID = @batchId`);
    }

    const waktuIsi = new Date();
    const estimasiBeku = new Date(waktuIsi.getTime() + durasiJam * 3600000);

    const insertResult = await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("jenisEs", sql.VarChar(4), jenisEs)
      .input("jumlahCan", sql.Int, jumlahCan)
      .input("waktuIsi", sql.DateTime, waktuIsi)
      .input("estimasiBeku", sql.DateTime, estimasiBeku)
      .input("akunId", sql.Int, akunId).query(`
        INSERT INTO DashboardProduksiBatch (RekID, JenisEs, JumlahCan, WaktuIsi, EstimasiBeku, DicatatOlehAkunID)
        OUTPUT INSERTED.BatchID
        VALUES (@rekId, @jenisEs, @jumlahCan, @waktuIsi, @estimasiBeku, @akunId)
      `);
    const newBatchId = (insertResult.recordset[0] as { BatchID: number }).BatchID;

    await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("batchId", sql.Int, newBatchId)
      .query(`UPDATE DashboardProduksiRek SET BatchIDAktif = @batchId, IsMaintenance = 0, ModifiedDate = GETDATE() WHERE RekID = @rekId`);

    await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("batchId", sql.Int, newBatchId)
      .input("akunId", sql.Int, akunId)
      .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, 'Isi Air Baru', @akunId)`);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

- [ ] **Step 2: `setBabonan()`**

```ts
export async function setBabonan(rekId: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const rekResult = await pool
    .request()
    .input("rekId", sql.Int, rekId)
    .query(`SELECT BatchIDAktif FROM DashboardProduksiRek WHERE RekID = @rekId`);
  const rekRow = rekResult.recordset[0] as { BatchIDAktif: number | null } | undefined;
  if (!rekRow) throw new AppError("Rek tidak ditemukan.");
  if (!rekRow.BatchIDAktif) throw new AppError("Rek ini kosong, isi air baru dulu sebelum diset Babonan.");

  await pool.request().input("batchId", sql.Int, rekRow.BatchIDAktif).query(`UPDATE DashboardProduksiBatch SET IsBabonan = 1 WHERE BatchID = @batchId`);
  await pool
    .request()
    .input("rekId", sql.Int, rekId)
    .input("batchId", sql.Int, rekRow.BatchIDAktif)
    .input("akunId", sql.Int, akunId)
    .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, 'Set Babonan', @akunId)`);
}
```

- [ ] **Step 3: `setMaintenance()`**

```ts
export async function setMaintenance(rekId: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const rekResult = await pool
    .request()
    .input("rekId", sql.Int, rekId)
    .query(`SELECT BatchIDAktif FROM DashboardProduksiRek WHERE RekID = @rekId`);
  const rekRow = rekResult.recordset[0] as { BatchIDAktif: number | null } | undefined;
  if (!rekRow) throw new AppError("Rek tidak ditemukan.");

  if (rekRow.BatchIDAktif) {
    await pool.request().input("batchId", sql.Int, rekRow.BatchIDAktif).query(`UPDATE DashboardProduksiBatch SET ClosedDate = GETDATE() WHERE BatchID = @batchId`);
  }
  await pool.request().input("rekId", sql.Int, rekId).query(`UPDATE DashboardProduksiRek SET IsMaintenance = 1, BatchIDAktif = NULL, ModifiedDate = GETDATE() WHERE RekID = @rekId`);
  await pool
    .request()
    .input("rekId", sql.Int, rekId)
    .input("batchId", sql.Int, rekRow.BatchIDAktif)
    .input("akunId", sql.Int, akunId)
    .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, 'Set Maintenance', @akunId)`);
}
```

- [ ] **Step 4: Verifikasi**

`npx tsc --noEmit` — 0 error.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/produksi-bak-pmpersada.ts
git commit -m "feat: add isiAirBaru/setBabonan/setMaintenance operator actions"
```

---

### Task 4: Query module — aksi Admin + laporan (`overrideTahap`, `koreksiBatch`, `updateKonfigurasi`, `getRiwayatBatch`, `getAuditLog`)

**Files:**
- Modify: `src/lib/queries/produksi-bak-pmpersada.ts`

**Interfaces:**
- Consumes: `getKonfigurasi()` (Task 2).
- Produces: semua fungsi di bawah — dipakai Task 5 (desktop actions).

- [ ] **Step 1: `overrideTahap()` — Admin memaksa tahap tertentu dengan hitung-mundur waktu**

```ts
const TARGET_PCT: Record<"MULAI" | "KRISTAL" | "SIAP" | "JADI", number> = {
  MULAI: 0.25,
  KRISTAL: 0.6,
  SIAP: 0.85,
  JADI: 1.0,
};

export async function overrideTahap(rekId: number, tahap: "MULAI" | "KRISTAL" | "SIAP" | "JADI", akunId: number): Promise<void> {
  const pool = await getPool();
  const rekResult = await pool.request().input("rekId", sql.Int, rekId).query(`
    SELECT r.BatchIDAktif, b.JenisEs
    FROM DashboardProduksiRek r
    LEFT JOIN DashboardProduksiBatch b ON b.BatchID = r.BatchIDAktif
    WHERE r.RekID = @rekId
  `);
  const row = rekResult.recordset[0] as { BatchIDAktif: number | null; JenisEs: "BK" | "BB" | null } | undefined;
  if (!row || !row.BatchIDAktif || !row.JenisEs) throw new AppError("Rek ini kosong, isi air baru dulu sebelum override tahap.");

  const config = await getKonfigurasi();
  const durasiJam = row.JenisEs === "BK" ? config.DurasiBKJam : config.DurasiBBJam;
  const targetPct = TARGET_PCT[tahap];
  const waktuIsi = new Date(Date.now() - targetPct * durasiJam * 3600000);
  const estimasiBeku = new Date(waktuIsi.getTime() + durasiJam * 3600000);

  await pool
    .request()
    .input("batchId", sql.Int, row.BatchIDAktif)
    .input("waktuIsi", sql.DateTime, waktuIsi)
    .input("estimasiBeku", sql.DateTime, estimasiBeku)
    .query(`UPDATE DashboardProduksiBatch SET WaktuIsi = @waktuIsi, EstimasiBeku = @estimasiBeku WHERE BatchID = @batchId`);

  await pool
    .request()
    .input("rekId", sql.Int, rekId)
    .input("batchId", sql.Int, row.BatchIDAktif)
    .input("akunId", sql.Int, akunId)
    .input("label", sql.NVarChar(100), `Override ke ${tahap} (Admin)`)
    .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, @label, @akunId)`);
}
```

- [ ] **Step 2: `koreksiBatch()` — Admin koreksi Jenis Es / Jumlah Can pada batch aktif**

```ts
export async function koreksiBatch(rekId: number, jenisEs: "BK" | "BB", jumlahCan: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const rekResult = await pool.request().input("rekId", sql.Int, rekId).query(`SELECT BatchIDAktif FROM DashboardProduksiRek WHERE RekID = @rekId`);
  const rekRow = rekResult.recordset[0] as { BatchIDAktif: number | null } | undefined;
  if (!rekRow?.BatchIDAktif) throw new AppError("Rek ini kosong, tidak ada batch untuk dikoreksi.");

  await pool
    .request()
    .input("batchId", sql.Int, rekRow.BatchIDAktif)
    .input("jenisEs", sql.VarChar(4), jenisEs)
    .input("jumlahCan", sql.Int, jumlahCan)
    .query(`UPDATE DashboardProduksiBatch SET JenisEs = @jenisEs, JumlahCan = @jumlahCan WHERE BatchID = @batchId`);

  await pool
    .request()
    .input("rekId", sql.Int, rekId)
    .input("batchId", sql.Int, rekRow.BatchIDAktif)
    .input("akunId", sql.Int, akunId)
    .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, 'Koreksi Jenis/Can (Admin)', @akunId)`);
}
```

- [ ] **Step 3: `updateKonfigurasi()` — Admin ubah durasi beku standar**

```ts
export async function updateKonfigurasi(durasiBKJam: number, durasiBBJam: number, akunId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("bk", sql.Int, durasiBKJam)
    .input("bb", sql.Int, durasiBBJam)
    .input("akunId", sql.Int, akunId)
    .query(`UPDATE DashboardProduksiKonfigurasi SET DurasiBKJam = @bk, DurasiBBJam = @bb, ModifiedDate = GETDATE(), ModifiedByAkunID = @akunId WHERE ID = 1`);
}
```

- [ ] **Step 4: `getRiwayatBatch()` — untuk tab Rekap (semua batch, aktif maupun sudah ditutup)**

```ts
export interface BatchRow {
  BatchID: number;
  RekID: number;
  BakNama: string;
  NomorRek: number;
  JenisEs: "BK" | "BB";
  JumlahCan: number;
  IsBabonan: boolean;
  WaktuIsi: string;
  EstimasiBeku: string;
  ClosedDate: string | null;
  DicatatOlehAkunID: number;
}

export async function getRiwayatBatch(): Promise<BatchRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1000 b.BatchID, b.RekID, bak.Nama AS BakNama, r.NomorRek, b.JenisEs, b.JumlahCan, b.IsBabonan,
           b.WaktuIsi, b.EstimasiBeku, b.ClosedDate, b.DicatatOlehAkunID
    FROM DashboardProduksiBatch b
    JOIN DashboardProduksiRek r ON r.RekID = b.RekID
    JOIN DashboardProduksiBak bak ON bak.BakID = r.BakID
    ORDER BY b.CreatedDate DESC
  `);
  const rows = result.recordset as (Omit<BatchRow, "WaktuIsi" | "EstimasiBeku" | "ClosedDate"> & {
    WaktuIsi: Date;
    EstimasiBeku: Date;
    ClosedDate: Date | null;
  })[];
  return rows.map((r) => ({
    ...r,
    WaktuIsi: r.WaktuIsi.toISOString(),
    EstimasiBeku: r.EstimasiBeku.toISOString(),
    ClosedDate: r.ClosedDate ? r.ClosedDate.toISOString() : null,
  }));
}
```

- [ ] **Step 5: `getAuditLog()` — untuk tab Rekap & Log Audit, dan Riwayat mobile (filter per akun opsional)**

```ts
export interface AuditLogRow {
  LogID: number;
  RekID: number;
  BakNama: string;
  NomorRek: number;
  AksiLabel: string;
  Keterangan: string | null;
  DicatatOlehAkunID: number;
  CreatedDate: string;
}

export async function getAuditLog(akunId?: number): Promise<AuditLogRow[]> {
  const pool = await getPool();
  const request = pool.request();
  let whereClause = "";
  if (akunId != null) {
    request.input("akunId", sql.Int, akunId);
    whereClause = "WHERE l.DicatatOlehAkunID = @akunId";
  }
  const result = await request.query(`
    SELECT TOP 500 l.LogID, l.RekID, bak.Nama AS BakNama, r.NomorRek, l.AksiLabel, l.Keterangan, l.DicatatOlehAkunID, l.CreatedDate
    FROM DashboardProduksiAuditLog l
    JOIN DashboardProduksiRek r ON r.RekID = l.RekID
    JOIN DashboardProduksiBak bak ON bak.BakID = r.BakID
    ${whereClause}
    ORDER BY l.CreatedDate DESC
  `);
  const rows = result.recordset as (Omit<AuditLogRow, "CreatedDate"> & { CreatedDate: Date })[];
  return rows.map((r) => ({ ...r, CreatedDate: r.CreatedDate.toISOString() }));
}
```

- [ ] **Step 6: Verifikasi**

`npx tsc --noEmit` — 0 error. File `produksi-bak-pmpersada.ts` sekarang lengkap (Task 2-4) — baca ulang seluruh file sekali untuk pastikan tidak ada nama fungsi/tipe yang bentrok atau duplikat.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/produksi-bak-pmpersada.ts
git commit -m "feat: add Admin overrides (tahap/koreksi/konfigurasi) + Rekap/AuditLog reads"
```

---

### Task 5: Server actions Desktop (`src/app/pmpersada/produksi/actions.ts`)

**Files:**
- Create: `src/app/pmpersada/produksi/actions.ts`

**Interfaces:**
- Consumes: semua fungsi `produksi-bak-pmpersada.ts` (Task 2-4), `requirePmpersada()`, `getAkunNamaMap()` dari `@/lib/queries/akun`, `canAccessAllPT()`.
- Produces: satu action per fungsi query, dipakai Task 8-10.

- [ ] **Step 1: Tulis seluruh file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmpersada } from "@/lib/require-access";
import { canAccessAllPT } from "@/lib/require-access";
import {
  getBakList,
  getRekMap,
  getKonfigurasi,
  isiAirBaru,
  setBabonan,
  setMaintenance,
  overrideTahap,
  koreksiBatch,
  updateKonfigurasi,
  getRiwayatBatch,
  getAuditLog,
  type BakRow,
  type RekMapRow,
  type KonfigurasiRow,
  type BatchRow,
  type AuditLogRow,
} from "@/lib/queries/produksi-bak-pmpersada";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

// "Admin" di modul ini = siapa pun yang lolos requirePmpersada() (akun
// dashboard penuh /pmpersada) — bukan akun is_produksi-only. Dipakai untuk
// menolak aksi Admin-only kalau suatu saat sesi is_produksi ikut memanggil
// action ini secara langsung (di luar UI yang sudah membatasi tombolnya).
function assertAdmin(session: Awaited<ReturnType<typeof requirePmpersada>>) {
  if (session.user.isProduksi && !canAccessAllPT(session.user)) {
    throw new AppError("Hanya Admin yang boleh melakukan aksi ini.");
  }
}

export async function getBakListAction(): Promise<ActionResult<BakRow[]>> {
  return runAction(async () => {
    await requirePmpersada();
    return getBakList();
  });
}

export interface RekMapRowWithNama extends RekMapRow {
  DicatatOlehNama: string | null;
}

export async function getRekMapAction(): Promise<ActionResult<RekMapRowWithNama[]>> {
  return runAction(async () => {
    await requirePmpersada();
    const rows = await getRekMap();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID).filter((id): id is number => id != null));
    return rows.map((r) => ({ ...r, DicatatOlehNama: r.DicatatOlehAkunID != null ? (namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui") : null }));
  });
}

export async function getKonfigurasiAction(): Promise<ActionResult<KonfigurasiRow>> {
  return runAction(async () => {
    await requirePmpersada();
    return getKonfigurasi();
  });
}

export async function isiAirBaruAction(input: { rekId: number; jenisEs: "BK" | "BB"; jumlahCan: number }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    if (input.jumlahCan <= 0) throw new AppError("Jumlah Can harus lebih dari 0.");
    await isiAirBaru(input.rekId, input.jenisEs, input.jumlahCan, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function setBabonanAction(rekId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    await setBabonan(rekId, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function setMaintenanceAction(rekId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    await setMaintenance(rekId, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function overrideTahapAction(rekId: number, tahap: "MULAI" | "KRISTAL" | "SIAP" | "JADI"): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    assertAdmin(session);
    await overrideTahap(rekId, tahap, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function koreksiBatchAction(input: { rekId: number; jenisEs: "BK" | "BB"; jumlahCan: number }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    assertAdmin(session);
    if (input.jumlahCan <= 0) throw new AppError("Jumlah Can harus lebih dari 0.");
    await koreksiBatch(input.rekId, input.jenisEs, input.jumlahCan, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function updateKonfigurasiAction(durasiBKJam: number, durasiBBJam: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    assertAdmin(session);
    if (durasiBKJam <= 0 || durasiBBJam <= 0) throw new AppError("Durasi harus lebih dari 0 jam.");
    await updateKonfigurasi(durasiBKJam, durasiBBJam, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export interface BatchRowWithNama extends BatchRow {
  DicatatOlehNama: string;
}

export async function getRiwayatBatchAction(): Promise<ActionResult<BatchRowWithNama[]>> {
  return runAction(async () => {
    await requirePmpersada();
    const rows = await getRiwayatBatch();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}

export interface AuditLogRowWithNama extends AuditLogRow {
  DicatatOlehNama: string;
}

export async function getAuditLogAction(): Promise<ActionResult<AuditLogRowWithNama[]>> {
  return runAction(async () => {
    await requirePmpersada();
    const rows = await getAuditLog();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}
```

- [ ] **Step 2: Verifikasi**

`npx tsc --noEmit` — 0 error. Pastikan `getAkunNamaMap` menerima `number[]` (cek signature riil di `src/lib/queries/akun.ts` sebelum diasumsikan cocok — kalau parameter/return beda, sesuaikan pemanggilan di atas, jangan ubah `akun.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/app/pmpersada/produksi/actions.ts
git commit -m "feat: add desktop server actions for PMPersada Produksi"
```

---

### Task 6: Server actions Mobile (`src/app/pmpersada/produksi-app/actions.ts`)

**Files:**
- Create: `src/app/pmpersada/produksi-app/actions.ts`

**Interfaces:**
- Consumes: `getRekMap`, `getBakList`, `isiAirBaru`, `setBabonan`, `setMaintenance`, `getAuditLog` dari `produksi-bak-pmpersada.ts`; `requirePmpersadaProduksi()` (Task 1).
- Produces: subset action Operator-only, dipakai Task 12-13. Sengaja TIDAK mengekspos `overrideTahapAction`/`koreksiBatchAction`/`updateKonfigurasiAction` — operator tidak pernah boleh memanggilnya bahkan lewat request langsung.

- [ ] **Step 1: Tulis seluruh file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmpersadaProduksi } from "@/lib/require-access";
import {
  getBakList,
  getRekMap,
  isiAirBaru,
  setBabonan,
  setMaintenance,
  getAuditLog,
  type BakRow,
  type RekMapRow,
  type AuditLogRow,
} from "@/lib/queries/produksi-bak-pmpersada";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getBakListProduksiAppAction(): Promise<ActionResult<BakRow[]>> {
  return runAction(async () => {
    await requirePmpersadaProduksi();
    return getBakList();
  });
}

export async function getRekMapProduksiAppAction(): Promise<ActionResult<RekMapRow[]>> {
  return runAction(async () => {
    await requirePmpersadaProduksi();
    return getRekMap();
  });
}

export async function isiAirBaruProduksiAppAction(input: { rekId: number; jenisEs: "BK" | "BB"; jumlahCan: number }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersadaProduksi();
    if (input.jumlahCan <= 0) throw new AppError("Jumlah Can harus lebih dari 0.");
    await isiAirBaru(input.rekId, input.jenisEs, input.jumlahCan, Number(session.user.id));
    revalidatePath("/pmpersada/produksi-app");
    revalidatePath("/pmpersada/produksi");
  });
}

export async function setBabonanProduksiAppAction(rekId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersadaProduksi();
    await setBabonan(rekId, Number(session.user.id));
    revalidatePath("/pmpersada/produksi-app");
    revalidatePath("/pmpersada/produksi");
  });
}

export async function setMaintenanceProduksiAppAction(rekId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersadaProduksi();
    await setMaintenance(rekId, Number(session.user.id));
    revalidatePath("/pmpersada/produksi-app");
    revalidatePath("/pmpersada/produksi");
  });
}

// Riwayat milik operator yang login saja (bukan seluruh log semua orang —
// itu tab Rekap & Log Audit yang cuma ada di dashboard desktop Admin).
export async function getRiwayatSayaProduksiAppAction(): Promise<ActionResult<AuditLogRow[]>> {
  return runAction(async () => {
    const session = await requirePmpersadaProduksi();
    return getAuditLog(Number(session.user.id));
  });
}
```

- [ ] **Step 2: Verifikasi**

`npx tsc --noEmit` — 0 error.

- [ ] **Step 3: Commit**

```bash
git add src/app/pmpersada/produksi-app/actions.ts
git commit -m "feat: add mobile server actions for PMPersada Produksi (operator-only)"
```

---

### Task 7: Sidebar + `PMPERSADA_MODULES` — entry "Produksi"

**Files:**
- Modify: `src/lib/pmpersada-modules.ts`
- Modify: `src/components/dashboard/pmpersada-sidebar.tsx`

**Interfaces:**
- Produces: item sidebar baru "Produksi" → `/pmpersada/produksi`, tampil untuk semua akun yang lolos `requirePmpersada()` (Task 8-10 menyediakan halamannya — sebelum task itu selesai, item ini akan 404 lewat catch-all `[modul]`, itu tidak masalah untuk sementara karena literal folder `src/app/pmpersada/produksi/` dari Task 8 akan menggantikannya).

- [ ] **Step 1: Tambah slug "produksi" ke `PMPERSADA_MODULES`**

```ts
export const PMPERSADA_MODULES: Record<string, string> = {
  keuangan: "Keuangan",
  produksi: "Produksi",
  piutang: "Piutang",
  penjualan: "Penjualan",
  transaksi: "Transaksi",
  listrik: "Biaya Listrik",
  pengiriman: "Pengiriman",
  pemesanan: "Pemesanan",
  mitra: "Mitra",
  pemasaran: "Pemasaran",
};
```

- [ ] **Step 2: Tambah ikon di `pmpersada-sidebar.tsx`**

Tambah import `Snowflake` dari `lucide-react` (baris import icon), lalu tambah entry di `MODULE_ICONS`:

```ts
import { LayoutGrid, LineChart, Receipt, ShoppingCart, ArrowLeftRight, Zap, Truck, ClipboardList, Users, Megaphone, Snowflake } from "lucide-react";
```

```ts
const MODULE_ICONS: Record<string, typeof LineChart> = {
  keuangan: LineChart,
  produksi: Snowflake,
  piutang: Receipt,
  penjualan: ShoppingCart,
  transaksi: ArrowLeftRight,
  listrik: Zap,
  pengiriman: Truck,
  pemesanan: ClipboardList,
  mitra: Users,
  pemasaran: Megaphone,
};
```

- [ ] **Step 3: Verifikasi**

`npx tsc --noEmit` — 0 error. Sidebar sekarang menampilkan "Produksi" di urutan ke-2 (setelah Keuangan) — belum ada halamannya sampai Task 8.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pmpersada-modules.ts src/components/dashboard/pmpersada-sidebar.tsx
git commit -m "feat: add Produksi entry to PMPersada sidebar"
```

---

### Task 8: Dashboard Desktop shell + tab Overview

**Files:**
- Create: `src/app/pmpersada/produksi/layout.tsx`
- Create: `src/app/pmpersada/produksi/page.tsx`
- Create: `src/components/produksi-pmpersada/produksi-dashboard-client.tsx`
- Create: `src/components/produksi-pmpersada/produksi-lib.ts`

**Interfaces:**
- Consumes: semua action Task 5, komponen `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` dari `@/components/ui/tabs`, `Card` dari `@/components/ui/card`.
- Produces: `ProduksiDashboardClient` — dipakai lagi utuh oleh Task 9 & 10 (menambah isi `TabsContent` "denah" dan "rekap", bukan file baru). `TAHAP_LABEL`, `TAHAP_COLOR_CLASS`, `formatDurasiBatch` helper di `produksi-lib.ts` — dipakai bersama Task 9, 12.

- [ ] **Step 1: `src/components/produksi-pmpersada/produksi-lib.ts` — konstanta & helper tampilan bersama**

```ts
import type { TahapPembekuan } from "@/lib/queries/produksi-bak-pmpersada";

export const TAHAP_LABEL: Record<TahapPembekuan, string> = {
  BARU: "Isi Air (0%)",
  MULAI: "Mulai Beku",
  KRISTAL: "Kristalisasi",
  SIAP: "Siap Panen",
  JADI: "Matang (100%)",
  BABONAN: "Babonan",
  MAINTENANCE: "Maintenance",
};

// Kelas warna badge per tahap — dipetakan manual (bukan dari draf HTML
// mentah) supaya konsisten dengan token warna Tailwind/shadcn yang sudah
// dipakai di seluruh codebase ini (bg-*/text-*/border-* semantic tokens,
// bukan warna hex custom seperti draf).
export const TAHAP_BADGE_CLASS: Record<TahapPembekuan, string> = {
  BARU: "bg-destructive/15 text-destructive border-destructive/30",
  MULAI: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  KRISTAL: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
  SIAP: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",
  JADI: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  BABONAN: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  MAINTENANCE: "bg-muted text-muted-foreground border-border",
};

export function formatUsia(usiaJam: number): string {
  const h = Math.floor(usiaJam);
  const m = Math.round((usiaJam - h) * 60);
  return `${h} Jam ${m} Mnt`;
}
```

- [ ] **Step 2: `src/app/pmpersada/produksi/layout.tsx`**

```tsx
import { requirePmpersada } from "@/lib/require-access";

export default async function PmpersadaProduksiLayout({ children }: { children: React.ReactNode }) {
  await requirePmpersada();
  return children;
}
```

- [ ] **Step 3: `src/app/pmpersada/produksi/page.tsx` — fetch semua data 3 tab sekaligus**

```tsx
import { requirePmpersada, canAccessAllPT } from "@/lib/require-access";
import { getBakListAction, getRekMapAction, getKonfigurasiAction, getRiwayatBatchAction, getAuditLogAction } from "@/app/pmpersada/produksi/actions";
import { ProduksiDashboardClient } from "@/components/produksi-pmpersada/produksi-dashboard-client";

export default async function PmpersadaProduksiPage() {
  const session = await requirePmpersada();
  const [bakResult, rekResult, konfigResult, riwayatResult, auditResult] = await Promise.all([
    getBakListAction(),
    getRekMapAction(),
    getKonfigurasiAction(),
    getRiwayatBatchAction(),
    getAuditLogAction(),
  ]);
  if (!bakResult.success) throw new Error(bakResult.error);
  if (!rekResult.success) throw new Error(rekResult.error);
  if (!konfigResult.success) throw new Error(konfigResult.error);
  if (!riwayatResult.success) throw new Error(riwayatResult.error);
  if (!auditResult.success) throw new Error(auditResult.error);

  return (
    <ProduksiDashboardClient
      initialBak={bakResult.data}
      initialRek={rekResult.data}
      initialKonfigurasi={konfigResult.data}
      initialRiwayat={riwayatResult.data}
      initialAudit={auditResult.data}
      isAdmin={!session.user.isProduksi || canAccessAllPT(session.user)}
    />
  );
}
```

- [ ] **Step 4: `ProduksiDashboardClient` — shell 3 tab + isi tab Overview (Denah & Rekap diisi Task 9-10)**

```tsx
"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { getRekMapAction, getBakListAction } from "@/app/pmpersada/produksi/actions";
import type { RekMapRowWithNama, BatchRowWithNama, AuditLogRowWithNama } from "@/app/pmpersada/produksi/actions";
import type { BakRow, KonfigurasiRow } from "@/lib/queries/produksi-bak-pmpersada";
import { formatUsia } from "./produksi-lib";

const POLL_INTERVAL_MS = 30000;
// Toleransi di atas durasi standar sebelum sebuah Rek dianggap perlu
// diperingatkan (meniru ambang draf referensi: durasi + 12 jam).
const PERINGATAN_TOLERANSI_JAM = 12;

export function ProduksiDashboardClient({
  initialBak,
  initialRek,
  initialKonfigurasi,
  initialRiwayat,
  initialAudit,
  isAdmin,
}: {
  initialBak: BakRow[];
  initialRek: RekMapRowWithNama[];
  initialKonfigurasi: KonfigurasiRow;
  initialRiwayat: BatchRowWithNama[];
  initialAudit: AuditLogRowWithNama[];
  isAdmin: boolean;
}) {
  const [bak] = useState(initialBak);
  const [rek, setRek] = useState(initialRek);
  const [konfigurasi, setKonfigurasi] = useState(initialKonfigurasi);
  const [riwayat] = useState(initialRiwayat);
  const [audit] = useState(initialAudit);
  const [, startTransition] = useTransition();

  const refreshRek = useCallback(() => {
    startTransition(async () => {
      const result = await getRekMapAction();
      if (result.success) setRek(result.data);
    });
  }, []);

  useEffect(() => {
    const id = setInterval(refreshRek, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshRek]);

  const totalCan = rek.reduce((sum, r) => sum + (r.IsMaintenance ? 0 : (r.JumlahCan ?? 0)), 0);
  const canBaru = rek.filter((r) => r.Tahap === "BARU").reduce((sum, r) => sum + (r.JumlahCan ?? 0), 0);
  const canProses = rek.filter((r) => ["MULAI", "KRISTAL", "SIAP"].includes(r.Tahap)).reduce((sum, r) => sum + (r.JumlahCan ?? 0), 0);
  const canMatang = rek.filter((r) => ["JADI", "BABONAN"].includes(r.Tahap)).reduce((sum, r) => sum + (r.JumlahCan ?? 0), 0);

  const peringatan = rek.filter((r) => {
    if (r.IsMaintenance || r.IsBabonan || r.BatchID == null || !r.JenisEs) return false;
    const durasiStandar = r.JenisEs === "BK" ? konfigurasi.DurasiBKJam : konfigurasi.DurasiBBJam;
    return r.UsiaJam > durasiStandar + PERINGATAN_TOLERANSI_JAM;
  });

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Produksi — Pembekuan Es</h1>
        <p className="text-sm text-muted-foreground">Monitoring proses pembekuan, FIFO, dan audit stok — PMPersada Tuban.</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="denah">Denah Bak 1-5</TabsTrigger>
          <TabsTrigger value="rekap">Rekap &amp; Log Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4 pt-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Can Sehat</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{totalCan.toLocaleString("id-ID")}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Isi Air Baru</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{canBaru.toLocaleString("id-ID")}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Proses Beku</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{canProses.toLocaleString("id-ID")}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Matang / Babonan</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{canMatang.toLocaleString("id-ID")}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Progres per Bak</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {bak.map((b) => {
                const rekBak = rek.filter((r) => r.BakID === b.BakID && !r.IsMaintenance);
                const isi = rekBak.filter((r) => r.BatchID != null).length;
                const pct = rekBak.length > 0 ? Math.round((isi / rekBak.length) * 100) : 0;
                return (
                  <div key={b.BakID} className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span>
                        {b.Nama} ({b.TotalRek} Rek)
                      </span>
                      <span className="text-muted-foreground">
                        {isi} / {rekBak.length} terisi ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4 text-amber-500" />
                Peringatan ({peringatan.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {peringatan.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tidak ada Rek yang usianya melebihi batas standar.</p>
              ) : (
                peringatan.map((r) => (
                  <p key={r.RekID} className="text-sm">
                    <span className="font-medium">
                      {r.BakNama} Rek {r.NomorRek}
                    </span>{" "}
                    — usia {formatUsia(r.UsiaJam)}, melebihi durasi standar {r.JenisEs === "BK" ? konfigurasi.DurasiBKJam : konfigurasi.DurasiBBJam} jam.
                  </p>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TabsContent "denah" ditambahkan Task 9, "rekap" ditambahkan Task 10 */}
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 5: Verifikasi**

`npx tsc --noEmit` — 0 error. Baca `src/components/ui/tabs.tsx` sebelum menulis kalau ragu dengan API `Tabs`/`TabsTrigger` persis (rujuk pemakaian nyata di `src/components/satpam-app/beranda-client.tsx` yang sudah pakai komponen sama). Perhatikan bahwa `isAdmin` belum dipakai sampai Task 9 (tombol override baru muncul di situ) — biarkan prop-nya ada meski belum dipakai di step ini (dipakai Task 9), TIDAK dihapus.

- [ ] **Step 6: Commit**

```bash
git add src/app/pmpersada/produksi/layout.tsx src/app/pmpersada/produksi/page.tsx src/components/produksi-pmpersada/produksi-dashboard-client.tsx src/components/produksi-pmpersada/produksi-lib.ts
git commit -m "feat: add PMPersada Produksi desktop shell + Overview tab"
```

---

### Task 9: Desktop — tab Denah Bak 1-5 + dialog detail/override Rek

**Files:**
- Modify: `src/components/produksi-pmpersada/produksi-dashboard-client.tsx`
- Create: `src/components/produksi-pmpersada/rek-detail-dialog.tsx`

**Interfaces:**
- Consumes: `isiAirBaruAction`, `setBabonanAction`, `setMaintenanceAction`, `overrideTahapAction`, `koreksiBatchAction` (Task 5), `TAHAP_LABEL`/`TAHAP_BADGE_CLASS`/`formatUsia` (Task 8).
- Produces: `RekDetailDialog` — dipakai lagi di Task 12 (mobile, versi terbatas non-Admin lewat prop `isAdmin={false}`).

- [ ] **Step 1: `RekDetailDialog` — dialog detail + form aksi, versi permission-aware**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RekMapRow } from "@/lib/queries/produksi-bak-pmpersada";
import { TAHAP_LABEL, formatUsia } from "./produksi-lib";

export function RekDetailDialog({
  rek,
  isAdmin,
  onClose,
  onIsiAirBaru,
  onSetBabonan,
  onSetMaintenance,
  onOverrideTahap,
  onKoreksiBatch,
}: {
  rek: RekMapRow;
  isAdmin: boolean;
  onClose: () => void;
  onIsiAirBaru: (jenisEs: "BK" | "BB", jumlahCan: number) => Promise<{ success: boolean; error?: string }>;
  onSetBabonan: () => Promise<{ success: boolean; error?: string }>;
  onSetMaintenance: () => Promise<{ success: boolean; error?: string }>;
  onOverrideTahap?: (tahap: "MULAI" | "KRISTAL" | "SIAP" | "JADI") => Promise<{ success: boolean; error?: string }>;
  onKoreksiBatch?: (jenisEs: "BK" | "BB", jumlahCan: number) => Promise<{ success: boolean; error?: string }>;
}) {
  const [jenisEs, setJenisEs] = useState<"BK" | "BB">(rek.JenisEs ?? "BK");
  const [jumlahCan, setJumlahCan] = useState(String(rek.JumlahCan ?? 36));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        setError(result.error ?? "Gagal menyimpan.");
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rek.BakNama} — Rek {rek.NomorRek}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="font-medium">{TAHAP_LABEL[rek.Tahap]}</span>
          </div>
          {rek.BatchID != null && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Jenis / Jumlah</span>
                <span className="font-medium">
                  {rek.JenisEs} ({rek.JumlahCan} Can)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Usia</span>
                <span className="font-mono font-medium">{formatUsia(rek.UsiaJam)}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-muted-foreground">Isi Air Baru (mulai siklus baru)</p>
          <div className="flex gap-2">
            <select
              value={jenisEs}
              onChange={(e) => setJenisEs(e.target.value as "BK" | "BB")}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              disabled={!isAdmin}
            >
              <option value="BK">BK (36 Can)</option>
              <option value="BB">BB (18 Can)</option>
            </select>
            <Input type="number" value={jumlahCan} onChange={(e) => setJumlahCan(e.target.value)} disabled={!isAdmin} className="flex-1" />
          </div>
          <Button disabled={pending} onClick={() => run(() => onIsiAirBaru(jenisEs, Number(jumlahCan)))}>
            Isi Air Baru
          </Button>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={pending} onClick={() => run(onSetBabonan)}>
            Set Babonan
          </Button>
          <Button variant="outline" className="flex-1" disabled={pending} onClick={() => run(onSetMaintenance)}>
            Set Maintenance
          </Button>
        </div>

        {isAdmin && onOverrideTahap && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-xs font-semibold text-amber-600">Override Tahap (Admin)</p>
            <div className="grid grid-cols-2 gap-2">
              {(["MULAI", "KRISTAL", "SIAP", "JADI"] as const).map((t) => (
                <Button key={t} size="sm" variant="secondary" disabled={pending} onClick={() => run(() => onOverrideTahap(t))}>
                  {TAHAP_LABEL[t]}
                </Button>
              ))}
            </div>
          </div>
        )}

        {isAdmin && onKoreksiBatch && rek.BatchID != null && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => onKoreksiBatch(jenisEs, Number(jumlahCan)))}>
            Simpan Koreksi Jenis/Jumlah Can
          </Button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Tambah tab "denah" ke `ProduksiDashboardClient`**

Tambah state `selectedBakId`, `selectedRek`, import `RekDetailDialog` dan 4 action mutasi (`isiAirBaruAction`, `setBabonanAction`, `setMaintenanceAction`, `overrideTahapAction`, `koreksiBatchAction`). Sisipkan `<TabsContent value="denah">` tepat setelah `<TabsContent value="overview">` (sebelum komentar penanda Task 10):

```tsx
// tambahan import di atas file:
import { Button } from "@/components/ui/button";
import { isiAirBaruAction, setBabonanAction, setMaintenanceAction, overrideTahapAction, koreksiBatchAction } from "@/app/pmpersada/produksi/actions";
import { RekDetailDialog } from "./rek-detail-dialog";
import { TAHAP_BADGE_CLASS } from "./produksi-lib";
import { cn } from "@/lib/utils";

// tambahan state di dalam komponen:
const [selectedBakId, setSelectedBakId] = useState(bak[0]?.BakID ?? 0);
const [selectedRek, setSelectedRek] = useState<RekMapRowWithNama | null>(null);
```

```tsx
<TabsContent value="denah" className="flex flex-col gap-4 pt-4">
  <div className="flex flex-wrap gap-2">
    {bak.map((b) => (
      <Button key={b.BakID} size="sm" variant={selectedBakId === b.BakID ? "default" : "outline"} onClick={() => setSelectedBakId(b.BakID)}>
        {b.Nama} ({b.TotalRek})
      </Button>
    ))}
  </div>
  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
    {rek
      .filter((r) => r.BakID === selectedBakId)
      .map((r) => (
        <button
          key={r.RekID}
          type="button"
          onClick={() => setSelectedRek(r)}
          className={cn("flex flex-col gap-1 rounded-lg border p-2 text-left text-xs", TAHAP_BADGE_CLASS[r.Tahap])}
        >
          <span className="font-bold">Rek {r.NomorRek}</span>
          <span className="truncate">{r.JenisEs ?? "-"}</span>
        </button>
      ))}
  </div>
  {selectedRek && (
    <RekDetailDialog
      rek={selectedRek}
      isAdmin={isAdmin}
      onClose={() => setSelectedRek(null)}
      onIsiAirBaru={(jenisEs, jumlahCan) => isiAirBaruAction({ rekId: selectedRek.RekID, jenisEs, jumlahCan }).then((r) => { if (r.success) refreshRek(); return r; })}
      onSetBabonan={() => setBabonanAction(selectedRek.RekID).then((r) => { if (r.success) refreshRek(); return r; })}
      onSetMaintenance={() => setMaintenanceAction(selectedRek.RekID).then((r) => { if (r.success) refreshRek(); return r; })}
      onOverrideTahap={(tahap) => overrideTahapAction(selectedRek.RekID, tahap).then((r) => { if (r.success) refreshRek(); return r; })}
      onKoreksiBatch={(jenisEs, jumlahCan) => koreksiBatchAction({ rekId: selectedRek.RekID, jenisEs, jumlahCan }).then((r) => { if (r.success) refreshRek(); return r; })}
    />
  )}
</TabsContent>
```

- [ ] **Step 3: Verifikasi**

`npx tsc --noEmit` — 0 error. Live: login sebagai akun PMPersada existing (full dashboard), buka `/pmpersada/produksi` tab Denah, klik Rek kosong → isi BK 36 can → submit → Rek berubah warna "Isi Air (0%)" tanpa reload penuh (`refreshRek()` jalan). Klik Rek yang sudah terisi → coba Override ke SIAP → status berubah sesuai.

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi-pmpersada/produksi-dashboard-client.tsx src/components/produksi-pmpersada/rek-detail-dialog.tsx
git commit -m "feat: add PMPersada Produksi Denah tab + Rek detail/override dialog"
```

---

### Task 10: Desktop — tab Rekap & Log Audit + ekspor Excel

**Files:**
- Modify: `src/components/produksi-pmpersada/produksi-dashboard-client.tsx`

**Interfaces:**
- Consumes: `initialRiwayat` (`BatchRowWithNama[]`), `initialAudit` (`AuditLogRowWithNama[]`) — sudah ada di props sejak Task 8.

- [ ] **Step 1: Tambah `<TabsContent value="rekap">` menggantikan komentar penanda dari Task 8**

```tsx
// tambahan import di atas file:
import { formatDate } from "@/lib/format";
```

```tsx
<TabsContent value="rekap" className="flex flex-col gap-4 pt-4">
  <div className="flex items-center justify-between">
    <h3 className="text-sm font-semibold">Riwayat Batch & Log Audit</h3>
    <Button size="sm" variant="outline" onClick={() => exportAuditExcel(audit)}>
      Ekspor Excel
    </Button>
  </div>

  <Card>
    <CardHeader>
      <CardTitle className="text-base">Ringkasan Panen per Bak (Matang/Siap)</CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-2">
      {bak.map((b) => {
        const panen = riwayat.filter((r) => r.BakNama === b.Nama && r.ClosedDate == null);
        const totalCan = panen.reduce((sum, r) => sum + r.JumlahCan, 0);
        return (
          <div key={b.BakID} className="flex justify-between rounded-lg border p-2 text-sm">
            <span>{b.Nama}</span>
            <span className="font-medium">{totalCan.toLocaleString("id-ID")} Can aktif</span>
          </div>
        );
      })}
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle className="text-base">Log Audit (500 terbaru)</CardTitle>
    </CardHeader>
    <CardContent className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b text-muted-foreground uppercase">
          <tr>
            <th className="p-2">Waktu</th>
            <th className="p-2">Lokasi</th>
            <th className="p-2">Aksi</th>
            <th className="p-2">Operator</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {audit.map((a) => (
            <tr key={a.LogID}>
              <td className="p-2 font-mono">{formatDate(a.CreatedDate)}</td>
              <td className="p-2 font-medium">
                {a.BakNama} Rek {a.NomorRek}
              </td>
              <td className="p-2">{a.AksiLabel}</td>
              <td className="p-2">{a.DicatatOlehNama}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent>
  </Card>
</TabsContent>
```

- [ ] **Step 2: Fungsi `exportAuditExcel` — blob `.xls` client-side (belum ada precedent siap-pakai di codebase ini, jadi ditulis langsung mengikuti pola draf referensi)**

Tambahkan di akhir file (di luar komponen):

```tsx
function exportAuditExcel(audit: AuditLogRowWithNama[]) {
  const rows = audit
    .map((a) => `<tr><td>${a.CreatedDate}</td><td>${a.BakNama} Rek ${a.NomorRek}</td><td>${a.AksiLabel}</td><td>${a.DicatatOlehNama}</td></tr>`)
    .join("");
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8"></head>
    <body>
      <table border="1">
        <thead><tr><th>Waktu</th><th>Lokasi</th><th>Aksi</th><th>Operator</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
    </html>
  `;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Audit_Produksi_PMPersada_${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
```

- [ ] **Step 3: Verifikasi**

`npx tsc --noEmit` — 0 error. Live: buka tab Rekap & Log Audit, pastikan tabel log terisi (akan kosong sampai ada aksi tercatat dari Task 9's live test), klik Ekspor Excel → file `.xls` terunduh dan bisa dibuka.

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi-pmpersada/produksi-dashboard-client.tsx
git commit -m "feat: add PMPersada Produksi Rekap & Log Audit tab + Excel export"
```

---

### Task 11: App Mobile shell — route tree + tab-shell + bottom-nav

**Files:**
- Create: `src/app/pmpersada/produksi-app/(tabs)/layout.tsx`
- Create: `src/app/pmpersada/produksi-app/(tabs)/page.tsx`
- Create: `src/app/pmpersada/produksi-app/(tabs)/riwayat/page.tsx`
- Create: `src/app/pmpersada/produksi-app/(tabs)/profil/page.tsx`
- Create: `src/components/produksi-pmpersada-app/produksi-app-tab-shell.tsx`
- Create: `src/components/produksi-pmpersada-app/bottom-nav.tsx`

**Interfaces:**
- Consumes: `requirePmpersadaProduksi()` (Task 1), `getBakListProduksiAppAction`/`getRekMapProduksiAppAction`/`getRiwayatSayaProduksiAppAction` (Task 6).
- Produces: `ProduksiAppTabShell`, `ProduksiAppTabKey` — dipakai Task 12-13 untuk mengisi konten tiap tab (pola persis `ProduksiTabShell` MKEsindo, `src/components/produksi-app/produksi-tab-shell.tsx`, tapi domain berbeda jadi folder terpisah `produksi-pmpersada-app`).

- [ ] **Step 1: `bottom-nav.tsx`**

```tsx
"use client";

import { LayoutGrid, History, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProduksiAppTabKey } from "./produksi-app-tab-shell";

const TABS: { key: ProduksiAppTabKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "denah", label: "Denah", icon: LayoutGrid },
  { key: "riwayat", label: "Riwayat", icon: History },
  { key: "profil", label: "Profil", icon: User },
];

export function ProduksiAppBottomNav({ activeTab, onChange }: { activeTab: ProduksiAppTabKey; onChange: (tab: ProduksiAppTabKey) => void }) {
  return (
    <nav className="flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: `produksi-app-tab-shell.tsx` — shell client, lazy-fetch per tab (pola persis `ProduksiTabShell` MKEsindo)**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProduksiAppBottomNav } from "./bottom-nav";
import { getRekMapProduksiAppAction, getBakListProduksiAppAction, getRiwayatSayaProduksiAppAction } from "@/app/pmpersada/produksi-app/actions";
import type { RekMapRow, BakRow, AuditLogRow } from "@/lib/queries/produksi-bak-pmpersada";
import { DenahProduksiAppView } from "./denah-view";
import { RiwayatProduksiAppView } from "./riwayat-view";
import { ProfilProduksiAppView } from "./profil-view";

export type ProduksiAppTabKey = "denah" | "riwayat" | "profil";

const TAB_PATHS: Record<ProduksiAppTabKey, string> = {
  denah: "/pmpersada/produksi-app",
  riwayat: "/pmpersada/produksi-app/riwayat",
  profil: "/pmpersada/produksi-app/profil",
};

export function ProduksiAppTabShell({
  initialTab,
  userName,
  initialBak,
  initialRek,
  initialRiwayat,
}: {
  initialTab: ProduksiAppTabKey;
  userName: string;
  initialBak?: BakRow[];
  initialRek?: RekMapRow[];
  initialRiwayat?: AuditLogRow[];
}) {
  const [activeTab, setActiveTab] = useState<ProduksiAppTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<ProduksiAppTabKey>>(() => new Set([initialTab]));

  const [bak, setBak] = useState<BakRow[] | null>(initialBak ?? null);
  const [rek, setRek] = useState<RekMapRow[] | null>(initialRek ?? null);
  const [riwayat, setRiwayat] = useState<AuditLogRow[] | null>(initialRiwayat ?? null);

  const [loadingTab, setLoadingTab] = useState<ProduksiAppTabKey | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  function handleChangeTab(tab: ProduksiAppTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  function refreshDenah() {
    setBak(null);
    setRek(null);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTabError(null);
      if (activeTab === "denah" && (bak === null || rek === null)) {
        setLoadingTab("denah");
        const [bakResult, rekResult] = await Promise.all([getBakListProduksiAppAction(), getRekMapProduksiAppAction()]);
        if (cancelled) return;
        if (!bakResult.success) { setTabError(bakResult.error); setLoadingTab(null); return; }
        if (!rekResult.success) { setTabError(rekResult.error); setLoadingTab(null); return; }
        setBak(bakResult.data);
        setRek(rekResult.data);
        setLoadingTab(null);
        return;
      }
      if (activeTab === "riwayat" && riwayat === null) {
        setLoadingTab("riwayat");
        const result = await getRiwayatSayaProduksiAppAction();
        if (cancelled) return;
        if (!result.success) { setTabError(result.error); setLoadingTab(null); return; }
        setRiwayat(result.data);
        setLoadingTab(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, bak, rek, riwayat]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        {loadingTab && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {tabError && (
          <p className="absolute inset-x-4 top-4 z-10 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{tabError}</p>
        )}
        {visited.has("denah") && bak && rek && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "denah" && "hidden")}>
            <DenahProduksiAppView bak={bak} rek={rek} onAfterAksi={refreshDenah} />
          </div>
        )}
        {visited.has("riwayat") && riwayat && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "riwayat" && "hidden")}>
            <RiwayatProduksiAppView entries={riwayat} />
          </div>
        )}
        {visited.has("profil") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "profil" && "hidden")}>
            <ProfilProduksiAppView userName={userName} />
          </div>
        )}
      </div>
      <ProduksiAppBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
```

- [ ] **Step 3: 3 file route**

`src/app/pmpersada/produksi-app/(tabs)/layout.tsx`:

```tsx
import { requirePmpersadaProduksi } from "@/lib/require-access";

export default async function ProduksiAppTabsLayout({ children }: { children: React.ReactNode }) {
  await requirePmpersadaProduksi();
  return children;
}
```

`src/app/pmpersada/produksi-app/(tabs)/page.tsx`:

```tsx
import { requirePmpersadaProduksi } from "@/lib/require-access";
import { getBakList, getRekMap } from "@/lib/queries/produksi-bak-pmpersada";
import { ProduksiAppTabShell } from "@/components/produksi-pmpersada-app/produksi-app-tab-shell";

export default async function ProduksiAppDenahPage() {
  const session = await requirePmpersadaProduksi();
  const [bak, rek] = await Promise.all([getBakList(), getRekMap()]);
  return <ProduksiAppTabShell initialTab="denah" userName={session.user.name ?? session.user.username} initialBak={bak} initialRek={rek} />;
}
```

`src/app/pmpersada/produksi-app/(tabs)/riwayat/page.tsx`:

```tsx
import { requirePmpersadaProduksi } from "@/lib/require-access";
import { getAuditLog } from "@/lib/queries/produksi-bak-pmpersada";
import { ProduksiAppTabShell } from "@/components/produksi-pmpersada-app/produksi-app-tab-shell";

export default async function ProduksiAppRiwayatPage() {
  const session = await requirePmpersadaProduksi();
  const riwayat = await getAuditLog(Number(session.user.id));
  return <ProduksiAppTabShell initialTab="riwayat" userName={session.user.name ?? session.user.username} initialRiwayat={riwayat} />;
}
```

`src/app/pmpersada/produksi-app/(tabs)/profil/page.tsx`:

```tsx
import { requirePmpersadaProduksi } from "@/lib/require-access";
import { ProduksiAppTabShell } from "@/components/produksi-pmpersada-app/produksi-app-tab-shell";

export default async function ProduksiAppProfilPage() {
  const session = await requirePmpersadaProduksi();
  return <ProduksiAppTabShell initialTab="profil" userName={session.user.name ?? session.user.username} />;
}
```

- [ ] **Step 4: Verifikasi**

`npx tsc --noEmit` akan MASIH ERROR di step ini karena `DenahProduksiAppView`/`RiwayatProduksiAppView`/`ProfilProduksiAppView` belum ada — itu wajar, dibuat di Task 12-13. Cukup pastikan tidak ada error lain di luar "Cannot find module './denah-view'" dkk.

- [ ] **Step 5: Commit**

```bash
git add "src/app/pmpersada/produksi-app/(tabs)" src/components/produksi-pmpersada-app/produksi-app-tab-shell.tsx src/components/produksi-pmpersada-app/bottom-nav.tsx
git commit -m "feat: add PMPersada Produksi mobile app shell (route tree + tab shell)"
```

---

### Task 12: Mobile — tab Denah (aksi terbatas Operator)

**Files:**
- Create: `src/components/produksi-pmpersada-app/denah-view.tsx`

**Interfaces:**
- Consumes: `RekDetailDialog` (Task 9, dipanggil dengan `isAdmin={false}` sehingga tombol Override/Koreksi otomatis tidak muncul), `isiAirBaruProduksiAppAction`/`setBabonanProduksiAppAction`/`setMaintenanceProduksiAppAction` (Task 6), `TAHAP_BADGE_CLASS` (Task 8).
- Produces: `DenahProduksiAppView` — dipakai Task 11's tab-shell (import sudah ditulis di sana).

- [ ] **Step 1: Tulis `denah-view.tsx`**

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { BakRow, RekMapRow } from "@/lib/queries/produksi-bak-pmpersada";
import { RekDetailDialog } from "@/components/produksi-pmpersada/rek-detail-dialog";
import { TAHAP_BADGE_CLASS } from "@/components/produksi-pmpersada/produksi-lib";
import { isiAirBaruProduksiAppAction, setBabonanProduksiAppAction, setMaintenanceProduksiAppAction } from "@/app/pmpersada/produksi-app/actions";

export function DenahProduksiAppView({ bak, rek, onAfterAksi }: { bak: BakRow[]; rek: RekMapRow[]; onAfterAksi: () => void }) {
  const [selectedBakId, setSelectedBakId] = useState(bak[0]?.BakID ?? 0);
  const [selectedRek, setSelectedRek] = useState<RekMapRow | null>(null);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {bak.map((b) => (
          <Button key={b.BakID} size="sm" variant={selectedBakId === b.BakID ? "default" : "outline"} onClick={() => setSelectedBakId(b.BakID)} className="shrink-0">
            {b.Nama}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {rek
          .filter((r) => r.BakID === selectedBakId)
          .map((r) => (
            <button
              key={r.RekID}
              type="button"
              onClick={() => setSelectedRek(r)}
              className={cn("flex flex-col gap-1 rounded-lg border p-2 text-left text-xs", TAHAP_BADGE_CLASS[r.Tahap])}
            >
              <span className="font-bold">Rek {r.NomorRek}</span>
              <span className="truncate">{r.JenisEs ?? "-"}</span>
            </button>
          ))}
      </div>
      {selectedRek && (
        <RekDetailDialog
          rek={selectedRek}
          isAdmin={false}
          onClose={() => setSelectedRek(null)}
          onIsiAirBaru={(jenisEs, jumlahCan) =>
            isiAirBaruProduksiAppAction({ rekId: selectedRek.RekID, jenisEs, jumlahCan }).then((r) => {
              if (r.success) onAfterAksi();
              return r;
            })
          }
          onSetBabonan={() =>
            setBabonanProduksiAppAction(selectedRek.RekID).then((r) => {
              if (r.success) onAfterAksi();
              return r;
            })
          }
          onSetMaintenance={() =>
            setMaintenanceProduksiAppAction(selectedRek.RekID).then((r) => {
              if (r.success) onAfterAksi();
              return r;
            })
          }
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verifikasi**

`npx tsc --noEmit` — masih error karena `RiwayatProduksiAppView`/`ProfilProduksiAppView` belum ada (Task 13), tapi sudah tidak ada error terkait `denah-view.tsx` itu sendiri.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi-pmpersada-app/denah-view.tsx
git commit -m "feat: add PMPersada Produksi mobile Denah tab"
```

---

### Task 13: Mobile — tab Riwayat + Profil

**Files:**
- Create: `src/components/produksi-pmpersada-app/riwayat-view.tsx`
- Create: `src/components/produksi-pmpersada-app/profil-view.tsx`

**Interfaces:**
- Consumes: `VerticalTimeline`/`VerticalTimelineItem` dari `@/components/ui/vertical-timeline`, `formatTime` dari `@/lib/format`, pola `ProfilView` MKEsindo (`src/components/produksi-app/profil-view.tsx`) — disalin persis (logout + signOut), tidak ada logika baru.

- [ ] **Step 1: `riwayat-view.tsx`**

```tsx
"use client";

import { Card, CardContent } from "@/components/ui/card";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
import { formatTime } from "@/lib/format";
import type { AuditLogRow } from "@/lib/queries/produksi-bak-pmpersada";

export function RiwayatProduksiAppView({ entries }: { entries: AuditLogRow[] }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Riwayat Saya</h1>
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Belum ada aktivitas.</p>
      ) : (
        <VerticalTimeline>
          {entries.map((e, i) => (
            <VerticalTimelineItem key={e.LogID} time={formatTime(e.CreatedDate)} isLast={i === entries.length - 1}>
              <Card className="py-3">
                <CardContent className="flex flex-col gap-1 px-4">
                  <p className="text-sm font-medium">
                    {e.BakNama} Rek {e.NomorRek}
                  </p>
                  <p className="text-xs text-muted-foreground">{e.AksiLabel}</p>
                </CardContent>
              </Card>
            </VerticalTimelineItem>
          ))}
        </VerticalTimeline>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `profil-view.tsx` — salinan persis pola MKEsindo, nama komponen disesuaikan**

```tsx
"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function ProfilProduksiAppView({ userName }: { userName: string }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-sm text-muted-foreground">Masuk sebagai</p>
        <p className="text-lg font-semibold">{userName}</p>
      </div>
      <Button variant="outline" onClick={() => signOut({ callbackUrl: "/login" })}>
        <LogOut className="size-4" />
        Keluar
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Verifikasi**

`npx tsc --noEmit` — sekarang harus 0 error di SELURUH proyek (semua import yang tadinya belum ada file-nya sudah lengkap sejak Task 11).

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi-pmpersada-app/riwayat-view.tsx src/components/produksi-pmpersada-app/profil-view.tsx
git commit -m "feat: add PMPersada Produksi mobile Riwayat + Profil tabs"
```

---

### Task 14: Full verification pass

**Files:**
- Tidak ada file kode — verifikasi + akun uji sementara (dibuat & dihapus lagi, pola yang sudah dipakai berulang di sesi ini).

- [ ] **Step 1: Typecheck + lint**

```bash
npx tsc --noEmit
npx eslint src/lib/queries/produksi-bak-pmpersada.ts src/app/pmpersada/produksi src/app/pmpersada/produksi-app src/components/produksi-pmpersada src/components/produksi-pmpersada-app src/lib/require-access.ts src/lib/pmpersada-modules.ts src/components/dashboard/pmpersada-sidebar.tsx src/app/pmpersada/keuangan/page.tsx
```

Harus 0 error. Warning yang sudah ada sebelumnya di file lain (baseline pre-existing sesi ini) boleh diabaikan asal tidak bertambah di file-file yang disentuh plan ini.

- [ ] **Step 2: Buat 1 akun uji operator sementara (script sekali-pakai, dihapus setelah verifikasi — pola persis yang dipakai berulang di sesi ini)**

Query Postgres cari `perusahaan_id` untuk `perusahaan.kode = 'pmpersada'`. Panggil `createPeran(perusahaanIdPmpersada, "Operator Produksi (Uji)")` (`src/lib/queries/akun.ts:341`) untuk dapat `peranId` baru, lalu `setPeranProduksi(peranId, true)` (`src/lib/queries/akun.ts:377`) untuk set `is_produksi=true` pada peran itu. Lalu `createAkun({ nama: "Test Operator Debug", username: "test-operator-pmpersada-debug", password: "TestDebug123!", email: null, nomorTelepon: null, perusahaanId: perusahaanIdPmpersada, peranId, salesmanId: null })` (`src/lib/queries/akun.ts:242`). Login sebagai akun ini di browser — verifikasi HANYA bisa buka `/pmpersada/produksi-app`, ditolak (`/akses-ditolak`) di `/pmpersada/keuangan` dan `/pmpersada/produksi`.

- [ ] **Step 3: Live click-through Desktop**

Login sebagai akun PMPersada existing (full dashboard). Buka `/pmpersada/produksi` — sidebar menampilkan "Produksi". Tab Overview: kartu statistik + progress per Bak + panel Peringatan tampil (kosong wajar karena baru). Tab Denah: 5 tombol Bak, grid Rek sesuai jumlah masing-masing (37/37/44/66/66 — total 250), klik Rek kosong → isi BK 36 can → Rek berubah "Isi Air (0%)". Klik Rek terisi → Override ke SIAP (Admin) → status berubah. Tab Rekap & Log Audit: baris log dari 2 aksi di atas muncul, Ekspor Excel menghasilkan file `.xls` valid.

- [ ] **Step 4: Live click-through Mobile**

Login sebagai akun operator uji dari Step 2. `/pmpersada/produksi-app` — 3 tab bottom-nav (Denah/Riwayat/Profil), tidak ada tombol Override/Koreksi di dialog Rek (hanya Isi Air Baru/Babonan/Maintenance). Isi Air Baru pada satu Rek → tab Riwayat menampilkan entry baru milik akun ini.

- [ ] **Step 5: Bersihkan data uji**

Hapus akun + peran uji dari Step 2 (skrip sekali-pakai, dihapus setelah dipakai). Reset 1-2 Rek yang dipakai untuk live-test (Step 3-4) kembali ke kosong (`BatchIDAktif=NULL`, hapus baris `DashboardProduksiBatch`/`DashboardProduksiAuditLog` yang dibuat murni untuk pengujian) — SAMA seperti pola cleanup yang konsisten dipakai di setiap task verifikasi live di sesi ini, supaya data produksi PMPersada tetap bersih untuk peluncuran nyata (250 Rek kosong, bukan berisi data uji).

- [ ] **Step 6: Commit (kalau ada perubahan kode dari perbaikan verifikasi)**

Kalau Step 1-4 menemukan bug yang perlu diperbaiki, commit terpisah dengan pesan yang jelas. Kalau semua bersih dari awal, tidak ada commit di task ini.
