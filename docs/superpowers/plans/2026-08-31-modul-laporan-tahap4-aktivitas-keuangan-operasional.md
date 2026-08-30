# Modul Laporan Tahap 4 (Aktivitas Keuangan Operasional) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan pencatatan "Kas Kecil" (petty cash) per shift kerja untuk Staf Operasional di `/mkesindo/laporan` — top-up kas masuk, rincian pengeluaran per transaksi, saldo berjalan — sebagai tab kelima di halaman Laporan yang sudah ada.

**Architecture:** Tiga tabel baru mengikuti pola Tahap 1 persis (`DashboardStokBahanBakuShift`/`SaldoAwal`) tapi untuk uang: satu baris ringkas per shift untuk Kas Masuk, satu tabel anak untuk rincian Pengeluaran (FK ke baris shift, pola sama seperti `DashboardAktivitasProduksiKehadiran`→`AktivitasID` di Tahap 2), dan satu tabel Saldo Awal singleton (satu baris saja, bukan per JenisBarang seperti Tahap 1, karena kas kecil cuma satu pool). Saldo berjalan dihitung saat baca via window function, sama prinsip Tahap 1.

**Tech Stack:** Next.js Server Actions, MSSQL (`mssql` via `src/lib/db.ts`), React.

**Spec:** [docs/superpowers/specs/2026-08-31-modul-laporan-tahap4-aktivitas-keuangan-operasional-design.md](../specs/2026-08-31-modul-laporan-tahap4-aktivitas-keuangan-operasional-design.md)

## Global Constraints

- Hanya Staf Operasional yang mengisi — tidak ada perubahan ke driver-app atau produksi-app.
- Cutoff Kerja (rollover 15:00 WIB), sama seperti Tahap 1/2.
- Saldo berjalan dihitung saat baca (window function), tidak pernah disimpan statis.
- Tidak terhubung ke `DashboardCashFlowDaily`/`DashboardCashFlowExpense`/COA/GeneralLedger yang sudah ada — entitas benar-benar terpisah.
- Rincian Pengeluaran adalah hard-delete (bukan soft-delete) — tidak ada tabel lain yang mereferensikan `PengeluaranID`, beda dari `DashboardTimProduksiAnggota` yang harus soft-delete.
- Bahasa UI: Indonesia.
- MKEsindo saja.
- Tidak ada framework test otomatis di repo ini — verifikasi tiap task pakai `npx tsc --noEmit`, `npx eslint` pada file yang disentuh, dan untuk kode yang menyentuh DB, script sekali-jalan (`npx tsx scratch-*.ts` atau `scripts/*.ts` untuk migrasi) dijalankan ke database live.

---

### Task 1: Migrasi Skema

**Files:**
- Create: `scripts/add-kas-kecil-tahap4.ts`

**Interfaces:**
- Consumes: `getPool`, `sql` dari `src/lib/db.ts`.
- Produces: tabel `DashboardKasKecilShift` (KasKecilShiftID, TanggalUsaha, Shift, ShiftMulai, KasMasuk, DiisiOlehAkunID, CreatedDate, ModifiedDate, unique TanggalUsaha+Shift), `DashboardKasKecilPengeluaran` (PengeluaranID, KasKecilShiftID, Keterangan, Nominal, DicatatOlehAkunID, CreatedDate, ModifiedDate), `DashboardKasKecilSaldoAwal` (SaldoAwal, DiisiOlehAkunID, ModifiedDate — selalu tepat 1 baris, di-seed oleh migrasi ini). Task 2 bergantung pada skema ini sudah ada di DB live.

- [ ] **Step 1: Tulis script migrasi**

```ts
// One-off schema migration -- introduces Tahap 4's "Kas Kecil" (petty
// cash) tracking: a per-shift shift-level table for Kas Masuk top-ups, an
// itemized child table for pengeluaran (expense) line items, and a
// singleton SaldoAwal table as the running-balance starting point -- see
// docs/superpowers/specs/2026-08-31-modul-laporan-tahap4-aktivitas-keuangan-operasional-design.md.
// Idempotent. Usage: npx tsx scripts/add-kas-kecil-tahap4.ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

async function tableExists(pool: sql.ConnectionPool, table: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("table", sql.VarChar, table)
    .query(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @table`);
  return result.recordset.length > 0;
}

async function main() {
  const pool = await getPool();

  if (!(await tableExists(pool, "DashboardKasKecilShift"))) {
    await pool.request().query(`
      CREATE TABLE DashboardKasKecilShift (
        KasKecilShiftID INT IDENTITY PRIMARY KEY,
        TanggalUsaha DATE NOT NULL,
        Shift TINYINT NOT NULL,
        ShiftMulai DATETIME NOT NULL,
        KasMasuk DECIMAL(18,2) NOT NULL DEFAULT 0,
        DiisiOlehAkunID INT NULL,
        CreatedDate DATETIME NOT NULL DEFAULT GETDATE(),
        ModifiedDate DATETIME NULL,
        CONSTRAINT UQ_KasKecilShift_TanggalShift UNIQUE (TanggalUsaha, Shift)
      )
    `);
    console.log("Created DashboardKasKecilShift.");
  } else {
    console.log("DashboardKasKecilShift already exists -- nothing to do.");
  }

  if (!(await tableExists(pool, "DashboardKasKecilPengeluaran"))) {
    await pool.request().query(`
      CREATE TABLE DashboardKasKecilPengeluaran (
        PengeluaranID INT IDENTITY PRIMARY KEY,
        KasKecilShiftID INT NOT NULL,
        Keterangan VARCHAR(200) NOT NULL,
        Nominal DECIMAL(18,2) NOT NULL,
        DicatatOlehAkunID INT NOT NULL,
        CreatedDate DATETIME NOT NULL DEFAULT GETDATE(),
        ModifiedDate DATETIME NULL
      )
    `);
    console.log("Created DashboardKasKecilPengeluaran.");
  } else {
    console.log("DashboardKasKecilPengeluaran already exists -- nothing to do.");
  }

  if (!(await tableExists(pool, "DashboardKasKecilSaldoAwal"))) {
    await pool.request().query(`
      CREATE TABLE DashboardKasKecilSaldoAwal (
        SaldoAwal DECIMAL(18,2) NOT NULL DEFAULT 0,
        DiisiOlehAkunID INT NULL,
        ModifiedDate DATETIME NULL
      )
    `);
    console.log("Created DashboardKasKecilSaldoAwal.");
  } else {
    console.log("DashboardKasKecilSaldoAwal already exists -- nothing to do.");
  }

  const existingSaldo = await pool.request().query(`SELECT COUNT(*) AS Total FROM DashboardKasKecilSaldoAwal`);
  if ((existingSaldo.recordset[0] as { Total: number }).Total === 0) {
    await pool.request().query(`INSERT INTO DashboardKasKecilSaldoAwal (SaldoAwal) VALUES (0)`);
    console.log("Seeded DashboardKasKecilSaldoAwal with SaldoAwal=0.");
  } else {
    console.log("DashboardKasKecilSaldoAwal already has a row -- skip seed.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Jalankan migrasi ke DB live**

Run: `npx tsx scripts/add-kas-kecil-tahap4.ts`
Expected: log "Created DashboardKasKecilShift.", "Created DashboardKasKecilPengeluaran.", "Created DashboardKasKecilSaldoAwal.", "Seeded DashboardKasKecilSaldoAwal with SaldoAwal=0." Jalankan ulang sekali lagi untuk pastikan idempotent (semua baris jadi "... already exists -- nothing to do." / "... already has a row -- skip seed.").

- [ ] **Step 3: Commit**

```bash
git add scripts/add-kas-kecil-tahap4.ts
git commit -m "feat: migrate Kas Kecil schema for Modul Laporan Tahap 4"
```

---

### Task 2: Query Module — `kas-kecil.ts`

**Files:**
- Create: `src/lib/queries/kas-kecil.ts`

**Interfaces:**
- Consumes: `getPool`/`sql` dari `src/lib/db.ts`, `getReportShift`/`getShiftWindow`/`getShiftLabel`/`ShiftNumber` dari `src/lib/report-shift.ts` (skema Task 1 sudah ada di DB).
- Produces (dipakai Task 3):
  - `PengeluaranRow { pengeluaranId: number; keterangan: string; nominal: number }`
  - `KasKecilShiftRow { kasKecilShiftId: number | null; tanggalUsaha: string; shift: ShiftNumber; shiftMulai: Date; kasMasuk: number; diisiOlehAkunId: number | null; pengeluaran: PengeluaranRow[]; totalPengeluaran: number; saldoAkhir: number }`
  - `CurrentShiftKasKecilInfo { tanggalUsaha: string; shift: ShiftNumber; shiftLabel: string }`
  - `getSaldoAwalKasKecil(): Promise<number>`
  - `setSaldoAwalKasKecil(saldoAwal: number, akunId: number): Promise<void>`
  - `getKasKecilHistory(limit?: number): Promise<KasKecilShiftRow[]>`
  - `getCurrentShiftKasKecil(): Promise<{ current: CurrentShiftKasKecilInfo; row: KasKecilShiftRow }>`
  - `upsertKasMasuk(tanggalUsaha: string, shift: ShiftNumber, kasMasuk: number, akunId: number): Promise<void>`
  - `tambahPengeluaran(tanggalUsaha: string, shift: ShiftNumber, keterangan: string, nominal: number, akunId: number): Promise<number>`
  - `hapusPengeluaran(pengeluaranId: number): Promise<void>`

- [ ] **Step 1: Tulis `src/lib/queries/kas-kecil.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";

export interface PengeluaranRow {
  pengeluaranId: number;
  keterangan: string;
  nominal: number;
}

export interface KasKecilShiftRow {
  kasKecilShiftId: number | null; // null when synthesized for a shift with no row yet
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftMulai: Date;
  kasMasuk: number;
  diisiOlehAkunId: number | null;
  pengeluaran: PengeluaranRow[];
  totalPengeluaran: number;
  saldoAkhir: number;
}

export interface CurrentShiftKasKecilInfo {
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
}

// Shared core of every saldo-berjalan query below -- pre-aggregates
// Pengeluaran per KasKecilShiftID FIRST (avoiding fan-out from the
// one-to-many child table), then runs the running-balance window function
// ordered by ShiftMulai (never raw Shift -- see Global Constraints in the
// plan this came from). CROSS JOIN against DashboardKasKecilSaldoAwal is
// safe (never fans out) because that table always has exactly one row
// (seeded by this feature's migration, enforced in application code by
// setSaldoAwalKasKecil always doing a plain UPDATE, never an INSERT).
const SALDO_BERJALAN_SUBQUERY = `
  SELECT
    s.KasKecilShiftID, s.TanggalUsaha, s.Shift, s.ShiftMulai, s.KasMasuk, s.DiisiOlehAkunID,
    ISNULL(p.TotalPengeluaran, 0) AS TotalPengeluaran,
    sa.SaldoAwal + SUM(s.KasMasuk - ISNULL(p.TotalPengeluaran, 0))
      OVER (ORDER BY s.ShiftMulai ROWS UNBOUNDED PRECEDING) AS SaldoAkhir
  FROM DashboardKasKecilShift s
  CROSS JOIN DashboardKasKecilSaldoAwal sa
  LEFT JOIN (
    SELECT KasKecilShiftID, SUM(Nominal) AS TotalPengeluaran
    FROM DashboardKasKecilPengeluaran
    GROUP BY KasKecilShiftID
  ) p ON p.KasKecilShiftID = s.KasKecilShiftID
`;

interface RawShiftRow {
  KasKecilShiftID: number;
  TanggalUsaha: Date;
  Shift: number;
  ShiftMulai: Date;
  KasMasuk: number;
  DiisiOlehAkunID: number | null;
  TotalPengeluaran: number;
  SaldoAkhir: number;
}

// Fetches every Pengeluaran row for a batch of KasKecilShiftIDs in ONE
// round trip, fully parameterized (never string-interpolated) even though
// the ids always originate from our own prior query, not user input.
async function attachPengeluaran(pool: sql.ConnectionPool, ids: number[]): Promise<Map<number, PengeluaranRow[]>> {
  const map = new Map<number, PengeluaranRow[]>();
  if (ids.length === 0) return map;
  const request = pool.request();
  const placeholders = ids.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const result = await request.query(`
    SELECT PengeluaranID, KasKecilShiftID, Keterangan, Nominal
    FROM DashboardKasKecilPengeluaran
    WHERE KasKecilShiftID IN (${placeholders.join(",")})
  `);
  for (const row of result.recordset as { PengeluaranID: number; KasKecilShiftID: number; Keterangan: string; Nominal: number }[]) {
    const list = map.get(row.KasKecilShiftID) ?? [];
    list.push({ pengeluaranId: row.PengeluaranID, keterangan: row.Keterangan, nominal: row.Nominal });
    map.set(row.KasKecilShiftID, list);
  }
  return map;
}

function mapRow(r: RawShiftRow, pengeluaranMap: Map<number, PengeluaranRow[]>): KasKecilShiftRow {
  return {
    kasKecilShiftId: r.KasKecilShiftID,
    tanggalUsaha: r.TanggalUsaha.toISOString().slice(0, 10),
    shift: r.Shift as ShiftNumber,
    shiftMulai: r.ShiftMulai,
    kasMasuk: r.KasMasuk,
    diisiOlehAkunId: r.DiisiOlehAkunID,
    pengeluaran: pengeluaranMap.get(r.KasKecilShiftID) ?? [],
    totalPengeluaran: r.TotalPengeluaran,
    saldoAkhir: r.SaldoAkhir,
  };
}

export async function getSaldoAwalKasKecil(): Promise<number> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT TOP 1 SaldoAwal FROM DashboardKasKecilSaldoAwal`);
  return (result.recordset[0] as { SaldoAwal: number } | undefined)?.SaldoAwal ?? 0;
}

// Always UPDATEs the singleton row (seeded by Task 1's migration) --
// never INSERTs -- so the CROSS JOIN in SALDO_BERJALAN_SUBQUERY can never
// fan out.
export async function setSaldoAwalKasKecil(saldoAwal: number, akunId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("saldoAwal", sql.Decimal(18, 2), saldoAwal)
    .input("akunId", sql.Int, akunId)
    .query(`UPDATE DashboardKasKecilSaldoAwal SET SaldoAwal = @saldoAwal, DiisiOlehAkunID = @akunId, ModifiedDate = GETDATE()`);
}

// Full shift history (newest first) with running balances -- see this
// plan's Global Constraints on why balances are never stored.
export async function getKasKecilHistory(limit = 90): Promise<KasKecilShiftRow[]> {
  const pool = await getPool();
  const result = await pool.request().input("limit", sql.Int, limit).query(`
    SELECT TOP (@limit) * FROM (${SALDO_BERJALAN_SUBQUERY}) x ORDER BY x.ShiftMulai DESC
  `);
  const rawRows = result.recordset as RawShiftRow[];
  const pengeluaranMap = await attachPengeluaran(pool, rawRows.map((r) => r.KasKecilShiftID));
  return rawRows.map((r) => mapRow(r, pengeluaranMap));
}

async function getKasKecilShiftRow(pool: sql.ConnectionPool, tanggalUsaha: string, shift: ShiftNumber): Promise<KasKecilShiftRow | null> {
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift).query(`
      SELECT * FROM (${SALDO_BERJALAN_SUBQUERY}) x WHERE x.TanggalUsaha = @t AND x.Shift = @s
    `);
  const row = result.recordset[0] as RawShiftRow | undefined;
  if (!row) return null;
  const pengeluaranMap = await attachPengeluaran(pool, [row.KasKecilShiftID]);
  return mapRow(row, pengeluaranMap);
}

// Latest SaldoAkhir over the FULL unfiltered history (no TOP N
// truncation) -- used by getCurrentShiftKasKecil's fallback so it never
// mistakes "pushed out of a display-limited window" for "no history at
// all yet" (same reasoning as Tahap 1's getLatestBalancePerJenisBarang).
async function getLatestSaldoAkhirKasKecil(pool: sql.ConnectionPool): Promise<number | null> {
  const result = await pool.request().query(`
    SELECT TOP 1 SaldoAkhir FROM (${SALDO_BERJALAN_SUBQUERY}) x ORDER BY x.ShiftMulai DESC
  `);
  const row = result.recordset[0] as { SaldoAkhir: number } | undefined;
  return row?.SaldoAkhir ?? null;
}

// Current work-shift row -- synthesizes a zero-valued row
// (kasKecilShiftId: null) if this shift has no row yet, carrying forward
// the latest known running balance (or SaldoAwal if no history at all
// yet) so the UI always has a sensible starting point before anyone has
// typed anything.
export async function getCurrentShiftKasKecil(): Promise<{ current: CurrentShiftKasKecilInfo; row: KasKecilShiftRow }> {
  const { shift, businessDate } = getReportShift("work");
  const tanggalUsaha = businessDate.toISOString().slice(0, 10);
  const current = { tanggalUsaha, shift, shiftLabel: getShiftLabel(shift, "work") };
  const pool = await getPool();

  const existing = await getKasKecilShiftRow(pool, tanggalUsaha, shift);
  if (existing) return { current, row: existing };

  const [latestSaldoAkhir, saldoAwal] = await Promise.all([getLatestSaldoAkhirKasKecil(pool), getSaldoAwalKasKecil()]);
  return {
    current,
    row: {
      kasKecilShiftId: null,
      tanggalUsaha,
      shift,
      shiftMulai: getShiftWindow(businessDate, shift, "work").start,
      kasMasuk: 0,
      diisiOlehAkunId: null,
      pengeluaran: [],
      totalPengeluaran: 0,
      saldoAkhir: latestSaldoAkhir ?? saldoAwal,
    },
  };
}

export async function upsertKasMasuk(tanggalUsaha: string, shift: ShiftNumber, kasMasuk: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, shift, "work").start;
  await pool
    .request()
    .input("tanggalUsaha", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("kasMasuk", sql.Decimal(18, 2), kasMasuk)
    .input("akunId", sql.Int, akunId).query(`
      MERGE DashboardKasKecilShift AS target
      USING (SELECT @tanggalUsaha AS TanggalUsaha, @shift AS Shift) AS src
      ON target.TanggalUsaha = src.TanggalUsaha AND target.Shift = src.Shift
      WHEN MATCHED THEN UPDATE SET
        KasMasuk = @kasMasuk,
        DiisiOlehAkunID = @akunId,
        ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT
        (TanggalUsaha, Shift, ShiftMulai, KasMasuk, DiisiOlehAkunID)
        VALUES (@tanggalUsaha, @shift, @shiftMulai, @kasMasuk, @akunId);
    `);
}

// Gets-or-creates the shift row so a Pengeluaran can FK to it even if
// nobody has touched KasMasuk yet this shift -- same pattern as
// ensureAktivitasRow in aktivitas-produksi.ts.
async function ensureKasKecilShiftId(pool: sql.ConnectionPool, tanggalUsaha: string, shift: ShiftNumber, akunId: number): Promise<number> {
  const existing = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT KasKecilShiftID FROM DashboardKasKecilShift WHERE TanggalUsaha = @t AND Shift = @s`);
  if (existing.recordset.length > 0) return (existing.recordset[0] as { KasKecilShiftID: number }).KasKecilShiftID;

  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, shift, "work").start;
  const result = await pool
    .request()
    .input("tanggalUsaha", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("akunId", sql.Int, akunId).query(`
      INSERT INTO DashboardKasKecilShift (TanggalUsaha, Shift, ShiftMulai, DiisiOlehAkunID)
      OUTPUT INSERTED.KasKecilShiftID
      VALUES (@tanggalUsaha, @shift, @shiftMulai, @akunId)
    `);
  return (result.recordset[0] as { KasKecilShiftID: number }).KasKecilShiftID;
}

export async function tambahPengeluaran(
  tanggalUsaha: string,
  shift: ShiftNumber,
  keterangan: string,
  nominal: number,
  akunId: number
): Promise<number> {
  const pool = await getPool();
  const kasKecilShiftId = await ensureKasKecilShiftId(pool, tanggalUsaha, shift, akunId);
  const result = await pool
    .request()
    .input("kasKecilShiftId", sql.Int, kasKecilShiftId)
    .input("keterangan", sql.VarChar(200), keterangan)
    .input("nominal", sql.Decimal(18, 2), nominal)
    .input("akunId", sql.Int, akunId).query(`
      INSERT INTO DashboardKasKecilPengeluaran (KasKecilShiftID, Keterangan, Nominal, DicatatOlehAkunID)
      OUTPUT INSERTED.PengeluaranID
      VALUES (@kasKecilShiftId, @keterangan, @nominal, @akunId)
    `);
  return (result.recordset[0] as { PengeluaranID: number }).PengeluaranID;
}

// Hard delete -- per Global Constraints, nothing else references
// PengeluaranID, unlike DashboardTimProduksiAnggota which must soft-delete.
export async function hapusPengeluaran(pengeluaranId: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input("pengeluaranId", sql.Int, pengeluaranId).query(`
    DELETE FROM DashboardKasKecilPengeluaran WHERE PengeluaranID = @pengeluaranId
  `);
}
```

- [ ] **Step 2: Verifikasi lewat script sekali-jalan ke DB live**

Buat file sementara `scratch-test-kas-kecil.ts` di root repo:

```ts
import "dotenv/config";
import { getCurrentShiftKasKecil, upsertKasMasuk, tambahPengeluaran, hapusPengeluaran, getKasKecilHistory } from "./src/lib/queries/kas-kecil";

async function main() {
  const { current, row } = await getCurrentShiftKasKecil();
  console.log("Current:", current, row);

  await upsertKasMasuk(current.tanggalUsaha, current.shift, 500000, 1);
  const pengeluaranId = await tambahPengeluaran(current.tanggalUsaha, current.shift, "Test beli kertas", 15000, 1);
  console.log("Added pengeluaran:", pengeluaranId);

  const afterAdd = await getCurrentShiftKasKecil();
  console.log("After add:", JSON.stringify(afterAdd.row, null, 2));

  await hapusPengeluaran(pengeluaranId);
  const afterDelete = await getCurrentShiftKasKecil();
  console.log("After delete (should be back to no pengeluaran, saldoAkhir up by removed nominal):", JSON.stringify(afterDelete.row, null, 2));

  const history = await getKasKecilHistory(5);
  console.log("History sample:", JSON.stringify(history.slice(0, 3), null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scratch-test-kas-kecil.ts`
Expected: no errors; "After add" shows `kasMasuk: 500000`, one pengeluaran item ("Test beli kertas", 15000), `totalPengeluaran: 15000`, and `saldoAkhir` reflecting `previous saldo + 500000 - 15000`; "After delete" shows the pengeluaran array empty again and `saldoAkhir` back up by 15000 (i.e. `previous saldo + 500000 - 0`). Confirm `akunId: 1` actually exists in this DB's `akun` table before running (any real account id works — if `1` doesn't exist, substitute a real id you know exists, e.g. from an earlier session's scratch scripts).

**IMPORTANT:** replace `1` in the script above with a real account id that actually exists in the `akun` table before running — check with a quick query if unsure (e.g. `SELECT TOP 1 id FROM akun`) rather than guessing. This test data is safe to leave in the live DB after verification (it's clearly labeled "Test beli kertas" and nets to zero effect on saldo after the delete step), but delete the scratch script file itself when done.

- [ ] **Step 3: Verifikasi build**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/lib/queries/kas-kecil.ts`
Expected: tidak ada error.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/kas-kecil.ts
git commit -m "feat: add Kas Kecil query module for Modul Laporan Tahap 4"
```

---

### Task 3: UI — Tab Laporan & Aksi

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/laporan/actions.ts`
- Create: `src/components/dashboard/laporan-kas-kecil.tsx`
- Modify: `src/components/dashboard/laporan-tab-shell.tsx`
- Modify: `src/app/mkesindo/(dashboard)/laporan/page.tsx`

**Interfaces:**
- Consumes: `getSaldoAwalKasKecil`, `setSaldoAwalKasKecil`, `getKasKecilHistory`, `getCurrentShiftKasKecil`, `upsertKasMasuk`, `tambahPengeluaran`, `hapusPengeluaran`, `KasKecilShiftRow`, `CurrentShiftKasKecilInfo` (Task 2), `requireModuleAccess`/`canAccessAllPT` dari `src/lib/require-access.ts`, `runAction`/`ActionResult`/`AppError` dari `src/lib/action-result.ts`, `formatDate` dari `src/lib/format.ts`. The private `assertCanEditLaporan` helper already exists in `laporan/actions.ts` (checks `canAccessAllPT(user) || !!user.permissions.laporan?.canEdit`) — reuse it, do not redefine it.
- Produces: `setSaldoAwalKasKecilAction`, `upsertKasMasukAction`, `tambahPengeluaranAction`, `hapusPengeluaranAction`; component `LaporanKasKecil`. (`getSaldoAwalKasKecil`/`getKasKecilHistory`/`getCurrentShiftKasKecil` are called directly from `page.tsx` as a Server Component — no client-callable Action wrapper needed for them, since nothing in this tab's client code re-fetches on its own; every save triggers `router.refresh()` instead, same as `LaporanStokBahanBaku`'s pattern.)

- [ ] **Step 1: Tambah actions di `src/app/mkesindo/(dashboard)/laporan/actions.ts`**

Tambah import setelah baris `import { getAktivitasMuatanDistribusi, type AktivitasMuatanDistribusiRow } from "@/lib/queries/laporan-muatan-distribusi";`:

```ts
import {
  setSaldoAwalKasKecil,
  upsertKasMasuk,
  tambahPengeluaran,
  hapusPengeluaran,
} from "@/lib/queries/kas-kecil";
import type { ShiftNumber } from "@/lib/report-shift";
```

Tambah fungsi-fungsi baru di akhir file:

```ts
export async function setSaldoAwalKasKecilAction(saldoAwal: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    if (!canAccessAllPT(session.user)) {
      throw new AppError("Hanya Direktur/Superadmin yang bisa mengubah saldo awal.");
    }
    if (saldoAwal < 0) throw new AppError("Saldo awal tidak boleh negatif.");
    await setSaldoAwalKasKecil(saldoAwal, Number(session.user.id));
    revalidatePath("/mkesindo/laporan");
  });
}

export async function upsertKasMasukAction(tanggalUsaha: string, shift: ShiftNumber, kasMasuk: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    assertCanEditLaporan(session.user);
    if (kasMasuk < 0) throw new AppError("Kas masuk tidak boleh negatif.");
    await upsertKasMasuk(tanggalUsaha, shift, kasMasuk, Number(session.user.id));
    revalidatePath("/mkesindo/laporan");
  });
}

export async function tambahPengeluaranAction(
  tanggalUsaha: string,
  shift: ShiftNumber,
  keterangan: string,
  nominal: number
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    assertCanEditLaporan(session.user);
    if (!keterangan.trim()) throw new AppError("Keterangan tidak boleh kosong.");
    if (!nominal || nominal <= 0) throw new AppError("Nominal harus lebih dari 0.");
    const id = await tambahPengeluaran(tanggalUsaha, shift, keterangan.trim(), nominal, Number(session.user.id));
    revalidatePath("/mkesindo/laporan");
    return id;
  });
}

export async function hapusPengeluaranAction(pengeluaranId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    assertCanEditLaporan(session.user);
    await hapusPengeluaran(pengeluaranId);
    revalidatePath("/mkesindo/laporan");
  });
}
```

- [ ] **Step 2: Buat `src/components/dashboard/laporan-kas-kecil.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import {
  upsertKasMasukAction,
  tambahPengeluaranAction,
  hapusPengeluaranAction,
  setSaldoAwalKasKecilAction,
} from "@/app/mkesindo/(dashboard)/laporan/actions";
import type { KasKecilShiftRow, CurrentShiftKasKecilInfo } from "@/lib/queries/kas-kecil";

function formatRupiah(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

function PengeluaranList({ row, canEdit, onChanged }: { row: KasKecilShiftRow; canEdit: boolean; onChanged: () => void }) {
  const [keterangan, setKeterangan] = useState("");
  const [nominal, setNominal] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleTambah() {
    if (!keterangan.trim()) {
      setError("Keterangan tidak boleh kosong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await tambahPengeluaranAction(row.tanggalUsaha, row.shift, keterangan.trim(), Number(nominal) || 0);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setKeterangan("");
      setNominal("");
      onChanged();
    });
  }

  function handleHapus(pengeluaranId: number) {
    if (!confirm("Hapus rincian pengeluaran ini?")) return;
    startTransition(async () => {
      const result = await hapusPengeluaranAction(pengeluaranId);
      if (result.success) onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {row.pengeluaran.map((p) => (
        <div key={p.pengeluaranId} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
          <span className="flex-1">{p.keterangan}</span>
          <span className="tabular-nums font-medium">{formatRupiah(p.nominal)}</span>
          {canEdit && (
            <button
              type="button"
              onClick={() => handleHapus(p.pengeluaranId)}
              disabled={pending}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}
      {row.pengeluaran.length === 0 && <p className="text-xs text-muted-foreground">Belum ada pengeluaran.</p>}
      {canEdit && (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border p-2">
          <Input placeholder="Keterangan" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} disabled={pending} />
          <div className="flex gap-1.5">
            <Input type="number" min={0} placeholder="Nominal" value={nominal} onChange={(e) => setNominal(e.target.value)} disabled={pending} />
            <Button size="sm" disabled={pending} onClick={handleTambah}>
              <Plus className="size-4" /> Tambah
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function KasKecilCard({ row, canEdit, onChanged }: { row: KasKecilShiftRow; canEdit: boolean; onChanged: () => void }) {
  const [kasMasuk, setKasMasuk] = useState(String(row.kasMasuk));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await upsertKasMasukAction(row.tanggalUsaha, row.shift, Number(kasMasuk) || 0);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Kas Kecil</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-2 text-xs">
          <div>
            <p className="text-muted-foreground">Total Pengeluaran</p>
            <p className="font-medium">{formatRupiah(row.totalPengeluaran)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Saldo Akhir</p>
            <p className="font-medium">{formatRupiah(row.saldoAkhir)}</p>
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`kas-masuk-${row.tanggalUsaha}-${row.shift}`}>Kas Masuk (Top-up shift ini)</Label>
            <div className="flex gap-1.5">
              <Input
                id={`kas-masuk-${row.tanggalUsaha}-${row.shift}`}
                type="number"
                min={0}
                value={kasMasuk}
                onChange={(e) => setKasMasuk(e.target.value)}
              />
              <Button size="sm" disabled={pending} onClick={handleSave}>
                {pending ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground">Kas Masuk</p>
            <p className="font-medium">{formatRupiah(row.kasMasuk)}</p>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Rincian Pengeluaran</p>
          <PengeluaranList row={row} canEdit={canEdit} onChanged={onChanged} />
        </div>
      </CardContent>
    </Card>
  );
}

function SaldoAwalDialogInline({ saldoAwal, onSaved }: { saldoAwal: number; onSaved: () => void }) {
  const [value, setValue] = useState(String(saldoAwal));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await setSaldoAwalKasKecilAction(Number(value) || 0);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onSaved();
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        Atur Saldo Awal
      </Button>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Saldo Awal (titik nol perhitungan)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Saldo Awal</Label>
          <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={handleSave}>
            {pending ? "Menyimpan..." : "Simpan Saldo Awal"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
            Batal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function LaporanKasKecil({
  canEdit,
  canEditSaldoAwal,
  current,
  initialRow,
  initialHistory,
  initialSaldoAwal,
  namaMap,
}: {
  canEdit: boolean;
  canEditSaldoAwal: boolean;
  current: CurrentShiftKasKecilInfo;
  initialRow: KasKecilShiftRow;
  initialHistory: KasKecilShiftRow[];
  initialSaldoAwal: number;
  namaMap: Record<number, string>;
}) {
  const router = useRouter();
  // Keyed by tanggalUsaha+shift, not the row object itself -- so after a
  // save triggers router.refresh(), the dialog derives fresh data from the
  // updated initialHistory prop instead of freezing on a stale snapshot
  // captured at click time (same pattern used for Tim Produksi's
  // peta-warehouse-desktop.tsx selectedPosisiId, this session's other plan).
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editingRow = editingKey ? (initialHistory.find((r) => `${r.tanggalUsaha}-${r.shift}` === editingKey) ?? null) : null;

  function handleChanged() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Shift Berjalan — Tanggal Usaha {formatDate(current.tanggalUsaha)}, {current.shiftLabel}
          </h2>
          {canEditSaldoAwal && <SaldoAwalDialogInline saldoAwal={initialSaldoAwal} onSaved={handleChanged} />}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:max-w-md">
          <KasKecilCard row={initialRow} canEdit={canEdit} onChanged={handleChanged} />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Riwayat</h2>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal Usaha</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead className="text-right">Kas Masuk</TableHead>
                <TableHead className="text-right">Total Pengeluaran</TableHead>
                <TableHead>Rincian</TableHead>
                <TableHead className="text-right">Saldo Akhir</TableHead>
                <TableHead>Diisi Oleh</TableHead>
                {canEdit && <TableHead className="text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialHistory.map((r) => (
                <TableRow key={`${r.tanggalUsaha}-${r.shift}`}>
                  <TableCell>{formatDate(r.tanggalUsaha)}</TableCell>
                  <TableCell>Shift {r.shift}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(r.kasMasuk)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(r.totalPengeluaran)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.pengeluaran.length > 0 ? r.pengeluaran.map((p) => `${p.keterangan}: ${formatRupiah(p.nominal)}`).join(", ") : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(r.saldoAkhir)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.diisiOlehAkunId ? (namaMap[r.diisiOlehAkunId] ?? "?") : "Belum diisi"}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditingKey(`${r.tanggalUsaha}-${r.shift}`)}>
                        Ubah
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {initialHistory.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 8 : 7} className="text-center text-muted-foreground py-8">
                    Belum ada data.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog
        open={editingRow != null}
        onOpenChange={(open) => {
          if (!open) setEditingKey(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ubah Riwayat</DialogTitle>
          </DialogHeader>
          {editingRow && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                <p className="text-muted-foreground">
                  {formatDate(editingRow.tanggalUsaha)} — Shift {editingRow.shift}
                </p>
              </div>
              <KasKecilCard row={editingRow} canEdit={canEdit} onChanged={handleChanged} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Wiring `src/components/dashboard/laporan-tab-shell.tsx`**

Tambah import:

```tsx
import { LaporanKasKecil } from "@/components/dashboard/laporan-kas-kecil";
import type { KasKecilShiftRow, CurrentShiftKasKecilInfo } from "@/lib/queries/kas-kecil";
```

Ubah `LaporanTab` type:

```tsx
type LaporanTab = "stok-bahan-baku" | "aktivitas-produksi" | "aktivitas-muatan-distribusi" | "keuangan-operasional";
```

Tambah props baru ke `LaporanTabShell` (di samping props `muatanDistribusi*` yang sudah ada dari Tahap 3):

```tsx
export function LaporanTabShell({
  canEdit,
  canEditSaldoAwal,
  current,
  initialCurrentRows,
  initialHistory,
  initialSaldoAwal,
  namaMap,
  aktivitasRiwayat,
  muatanDistribusiTahunAwal,
  muatanDistribusiBulanAwal,
  muatanDistribusiRowsAwal,
  kasKecilCurrent,
  kasKecilInitialRow,
  kasKecilInitialHistory,
  kasKecilInitialSaldoAwal,
}: {
  canEdit: boolean;
  canEditSaldoAwal: boolean;
  current: CurrentShiftInfo;
  initialCurrentRows: StokBahanBakuRow[];
  initialHistory: StokBahanBakuRow[];
  initialSaldoAwal: SaldoAwalRow[];
  namaMap: Record<number, string>;
  aktivitasRiwayat: AktivitasShiftInfo[];
  muatanDistribusiTahunAwal: number;
  muatanDistribusiBulanAwal: number;
  muatanDistribusiRowsAwal: AktivitasMuatanDistribusiRow[];
  kasKecilCurrent: CurrentShiftKasKecilInfo;
  kasKecilInitialRow: KasKecilShiftRow;
  kasKecilInitialHistory: KasKecilShiftRow[];
  kasKecilInitialSaldoAwal: number;
}) {
  const [tab, setTab] = useState<LaporanTab>("stok-bahan-baku");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tab === "stok-bahan-baku" ? "default" : "outline"} onClick={() => setTab("stok-bahan-baku")}>
          Stok Bahan Baku
        </Button>
        <Button size="sm" variant={tab === "aktivitas-produksi" ? "default" : "outline"} onClick={() => setTab("aktivitas-produksi")}>
          Aktivitas Produksi
        </Button>
        <Button
          size="sm"
          variant={tab === "aktivitas-muatan-distribusi" ? "default" : "outline"}
          onClick={() => setTab("aktivitas-muatan-distribusi")}
        >
          Aktivitas Muatan Distribusi
        </Button>
        <Button size="sm" variant={tab === "keuangan-operasional" ? "default" : "outline"} onClick={() => setTab("keuangan-operasional")}>
          Keuangan Operasional
        </Button>
      </div>
      <div className={cn(tab !== "stok-bahan-baku" && "hidden")}>
        <LaporanStokBahanBaku
          canEdit={canEdit}
          canEditSaldoAwal={canEditSaldoAwal}
          current={current}
          initialCurrentRows={initialCurrentRows}
          initialHistory={initialHistory}
          initialSaldoAwal={initialSaldoAwal}
          namaMap={namaMap}
        />
      </div>
      <div className={cn(tab !== "aktivitas-produksi" && "hidden")}>
        <LaporanAktivitasProduksi riwayat={aktivitasRiwayat} namaMap={namaMap} />
      </div>
      <div className={cn(tab !== "aktivitas-muatan-distribusi" && "hidden")}>
        <LaporanAktivitasMuatanDistribusi
          tahunAwal={muatanDistribusiTahunAwal}
          bulanAwal={muatanDistribusiBulanAwal}
          rowsAwal={muatanDistribusiRowsAwal}
        />
      </div>
      <div className={cn(tab !== "keuangan-operasional" && "hidden")}>
        <LaporanKasKecil
          canEdit={canEdit}
          canEditSaldoAwal={canEditSaldoAwal}
          current={kasKecilCurrent}
          initialRow={kasKecilInitialRow}
          initialHistory={kasKecilInitialHistory}
          initialSaldoAwal={kasKecilInitialSaldoAwal}
          namaMap={namaMap}
        />
      </div>
    </div>
  );
}
```

Catatan: baris pembungkus tombol tab diubah dari `flex gap-2` jadi `flex flex-wrap gap-2` supaya 4 tombol tab tidak meluber di layar sempit — satu-satunya perubahan pada baris yang sudah ada di luar penambahan tombol/panel baru.

- [ ] **Step 4: Wiring `src/app/mkesindo/(dashboard)/laporan/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { getCurrentShiftRows, getStokBahanBakuHistory, getSaldoAwal } from "@/lib/queries/stok-bahan-baku";
import { getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { getAktivitasMuatanDistribusi } from "@/lib/queries/laporan-muatan-distribusi";
import { getSaldoAwalKasKecil, getKasKecilHistory, getCurrentShiftKasKecil } from "@/lib/queries/kas-kecil";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { getReportShift } from "@/lib/report-shift";
import { LaporanTabShell } from "@/components/dashboard/laporan-tab-shell";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage() {
  const session = await requireModuleAccess("laporan");
  const canEdit = canAccessAllPT(session.user) || !!session.user.permissions.laporan?.canEdit;
  const canEditSaldoAwal = canAccessAllPT(session.user);

  const { businessDate } = getReportShift("work");
  const muatanDistribusiTahunAwal = businessDate.getUTCFullYear();
  const muatanDistribusiBulanAwal = businessDate.getUTCMonth() + 1;

  const [
    { current, rows },
    history,
    saldoAwal,
    aktivitasRiwayat,
    muatanDistribusiRowsAwal,
    kasKecilSaldoAwal,
    kasKecilHistory,
    kasKecilCurrentShift,
  ] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getSaldoAwal(),
    getAktivitasRiwayat(),
    getAktivitasMuatanDistribusi(muatanDistribusiTahunAwal, muatanDistribusiBulanAwal),
    getSaldoAwalKasKecil(),
    getKasKecilHistory(),
    getCurrentShiftKasKecil(),
  ]);

  const akunIds = [
    ...[...rows, ...history].flatMap((r) => [r.operasionalAkunId, r.produksiAkunId]),
    ...aktivitasRiwayat.map((r) => r.stafOperasionalAkunId),
    ...kasKecilHistory.map((r) => r.diisiOlehAkunId),
  ].filter((id): id is number => id != null);
  const namaMap = await getAkunNamaMap(akunIds);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Laporan</h1>
      <LaporanTabShell
        canEdit={canEdit}
        canEditSaldoAwal={canEditSaldoAwal}
        current={current}
        initialCurrentRows={rows}
        initialHistory={history}
        initialSaldoAwal={saldoAwal}
        namaMap={Object.fromEntries(namaMap)}
        aktivitasRiwayat={aktivitasRiwayat}
        muatanDistribusiTahunAwal={muatanDistribusiTahunAwal}
        muatanDistribusiBulanAwal={muatanDistribusiBulanAwal}
        muatanDistribusiRowsAwal={muatanDistribusiRowsAwal}
        kasKecilCurrent={kasKecilCurrentShift.current}
        kasKecilInitialRow={kasKecilCurrentShift.row}
        kasKecilInitialHistory={kasKecilHistory}
        kasKecilInitialSaldoAwal={kasKecilSaldoAwal}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint "src/app/mkesindo/(dashboard)/laporan/actions.ts" src/components/dashboard/laporan-kas-kecil.tsx src/components/dashboard/laporan-tab-shell.tsx "src/app/mkesindo/(dashboard)/laporan/page.tsx"`
Expected: tidak ada error.

Buka `/mkesindo/laporan` sebagai akun dengan akses `canEdit` pada modul "laporan". Klik tab "Keuangan Operasional". Isi "Kas Masuk", simpan, konfirmasi Saldo Akhir bertambah. Tambah 1-2 rincian pengeluaran, konfirmasi Saldo Akhir berkurang sesuai nominal dan baris muncul di daftar. Hapus salah satu rincian, konfirmasi Saldo Akhir kembali naik dan baris hilang. Buka salah satu baris Riwayat lewat "Ubah", konfirmasi dialog menampilkan data yang sama dan bisa diedit. Login sebagai akun `canView`-saja (atau Direktur), konfirmasi tab ini tampil read-only tanpa kartu input.

- [ ] **Step 6: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/laporan/actions.ts" src/components/dashboard/laporan-kas-kecil.tsx src/components/dashboard/laporan-tab-shell.tsx "src/app/mkesindo/(dashboard)/laporan/page.tsx"
git commit -m "feat: add Keuangan Operasional (Kas Kecil) tab to /mkesindo/laporan"
```
