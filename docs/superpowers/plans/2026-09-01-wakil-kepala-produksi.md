# Wakil Kepala Produksi & Perbaikan Tampilan Nama Tim Produksi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 dropdowns that show raw IDs instead of names, and introduce a new "Wakil Kepala Produksi" (deputy) role — one per Tim Produksi — that participates alongside Kepala Produksi in per-shift attendance and the production kontribusi-per-orang split, with 3 real deputy accounts created and assigned.

**Architecture:** The dropdown fix is a pure render-prop change to 3 existing components (no schema/query changes). The new role adds one standing column (`WakilKepalaAkunID` on `DashboardTimProduksi`, mirroring `KepalaAkunID`) and two per-shift attendance flags (`KepalaHadir`/`WakilHadir` on `DashboardAktivitasProduksiShift`) — Kepala/Wakil are NOT added to the existing `DashboardAktivitasProduksiKehadiran` table (that stays anggota-only), since there's always exactly one Kepala and one Wakil per shift (whichever Tim is on duty), so two boolean columns suffice without a new join table.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript, MSSQL (`mssql`, raw parameterized SQL), Postgres (`pg`, akun/peran directory), React 19 client components, `@base-ui/react`-based Select.

**Spec:** `docs/superpowers/specs/2026-09-01-wakil-kepala-produksi-design.md`

## Global Constraints

- The `<Select>` fix must use the render-prop pattern already proven in `src/components/dashboard/pemesanan-form-dialog.tsx` — `<SelectValue placeholder="X">{(v: string) => lookup(v) ?? "X"}</SelectValue>` — never the bare `<SelectValue placeholder="X" />` form.
- `KepalaHadir`/`WakilHadir` are per-SHIFT flags (`DashboardAktivitasProduksiShift`) — they never modify `KepalaAkunID`/`WakilKepalaAkunID` (standing Tim-level assignment).
- `jumlahHadir` for `hitungKontribusiPerOrang` = `(kepalaAkunId != null && kepalaHadir ? 1 : 0) + (wakilKepalaAkunId != null && wakilHadir ? 1 : 0) + susunanTim.length` — exact formula from the spec, do not simplify away the `!= null` guards (a Tim with no Kepala/Wakil assigned yet must not be silently counted).
- No new roles/permissions in the Postgres `akun`/`peran` system — Wakil Kepala Produksi uses `peran_id = 1012` ("Produksi", `is_produksi = true`), the exact same peran as existing Kepala Produksi accounts.
- New accounts: `perusahaan_id = 1` (MKEsindo), `email = null`, `salesman_id = null`, `username` = short first name, `nama` = `"PRD-<Fullname>"` — Nizam→Tim A, Aldo→Tim B, Reza→Tim C, password `12345678` for all three.
- Do not touch `StafOperasionalSelect` (aktivitas-produksi-view.tsx) or any other `<Select>` beyond the 3 named in the spec — out of scope.
- Do not add the existing anggota roster's drag/reorder/add/remove mechanics (`TimProduksiRoster`'s `SortableRosterRow`, `handleDragEnd`, `persist`) to Kepala/Wakil — their rows are fixed-position, non-draggable, toggle-only.
- This repo has no automated test suite (no `"test"` script in `package.json`, no jest/vitest). Verification per task: `npx tsc --noEmit`, `npm run lint`, and disposable `npx tsx scripts/scratch-*.ts` run against the real live database (no staging environment exists) then deleted — the established convention for this repo.

---

### Task 1: Fix the 3 dropdowns showing raw IDs

**Files:**
- Modify: `src/components/produksi/panel-tim-produksi.tsx:151-175` (`KepalaSelect`)
- Modify: `src/components/produksi/jadwal-tim-bulanan.tsx:24-59` (`SelSelect`)
- Modify: `src/components/produksi-app/aktivitas-produksi-view.tsx:168-208` (`TimBertugasSelect`)

**Interfaces:** None — pure render fix, no new exports, no signature changes.

- [ ] **Step 1: Fix `KepalaSelect` in `panel-tim-produksi.tsx`**

Change:
```tsx
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pilih Kepala Produksi" />
      </SelectTrigger>
```
to:
```tsx
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pilih Kepala Produksi">
          {(v: string) =>
            v === UNSET ? "Pilih Kepala Produksi" : (produksiAkunOptions.find((o) => String(o.akunId) === v)?.nama ?? "Pilih Kepala Produksi")
          }
        </SelectValue>
      </SelectTrigger>
```

- [ ] **Step 2: Fix `SelSelect` in `jadwal-tim-bulanan.tsx`**

Change:
```tsx
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Belum dijadwalkan" />
      </SelectTrigger>
```
to:
```tsx
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Belum dijadwalkan">
          {(v: string) => (v === UNSET ? "Belum dijadwalkan" : (timList.find((t) => String(t.timId) === v)?.nama ?? "Belum dijadwalkan"))}
        </SelectValue>
      </SelectTrigger>
```

- [ ] **Step 3: Fix `TimBertugasSelect` in `aktivitas-produksi-view.tsx`**

Change:
```tsx
      <SelectTrigger>
        <SelectValue placeholder="Pilih Tim" />
      </SelectTrigger>
```
to:
```tsx
      <SelectTrigger>
        <SelectValue placeholder="Pilih Tim">
          {(v: string) =>
            v === BELUM_DIJADWALKAN ? "Pilih Tim" : (timList.find((t) => String(t.timId) === v)?.nama ?? "Pilih Tim")
          }
        </SelectValue>
      </SelectTrigger>
```

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: no errors from these 3 files.

- [ ] **Step 5: Manual visual check**

Start the dev server, open `/mkesindo/produksi`. Confirm the Kepala Produksi dropdown (Tim Produksi panel) and the Tim dropdown (Jadwal Tim Produksi calendar) both show names, not numbers, once a value is selected and the dropdown is closed. Open `/mkesindo/produksi-app`'s Aktivitas tab and confirm the Tim Bertugas dropdown shows the Tim name too.

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi/panel-tim-produksi.tsx src/components/produksi/jadwal-tim-bulanan.tsx src/components/produksi-app/aktivitas-produksi-view.tsx
git commit -m "fix: resolve Select dropdowns to names instead of raw IDs (Kepala Produksi, Tim)"
```

---

### Task 2: Add the new schema columns

**Files:**
- Create: `scripts/add-wakil-kepala-produksi-columns.ts`

**Interfaces:**
- Produces: `DashboardTimProduksi.WakilKepalaAkunID` (INT NULL), `DashboardAktivitasProduksiShift.KepalaHadir` (BIT NOT NULL DEFAULT 1), `DashboardAktivitasProduksiShift.WakilHadir` (BIT NOT NULL DEFAULT 1) — every later task depends on these existing.

- [ ] **Step 1: Write the script**

```ts
// One-off schema migration — adds Wakil Kepala Produksi support: a
// standing per-Tim deputy assignment, plus per-shift attendance flags
// for both Kepala and Wakil. Idempotent, safe to re-run.
// Usage: npx tsx scripts/add-wakil-kepala-produksi-columns.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function addColumnIfMissing(pool: Awaited<ReturnType<typeof getPool>>, table: string, column: string, ddl: string) {
  const result = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'
  `);
  if (result.recordset.length === 0) {
    await pool.request().query(ddl);
    console.log(`Added ${table}.${column}.`);
  } else {
    console.log(`${table}.${column} already exists — nothing to do.`);
  }
}

async function main() {
  const pool = await getPool();
  await addColumnIfMissing(pool, "DashboardTimProduksi", "WakilKepalaAkunID", `ALTER TABLE DashboardTimProduksi ADD WakilKepalaAkunID INT NULL`);
  await addColumnIfMissing(
    pool,
    "DashboardAktivitasProduksiShift",
    "KepalaHadir",
    `ALTER TABLE DashboardAktivitasProduksiShift ADD KepalaHadir BIT NOT NULL DEFAULT 1`
  );
  await addColumnIfMissing(
    pool,
    "DashboardAktivitasProduksiShift",
    "WakilHadir",
    `ALTER TABLE DashboardAktivitasProduksiShift ADD WakilHadir BIT NOT NULL DEFAULT 1`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the live database**

```bash
npx tsx scripts/add-wakil-kepala-produksi-columns.ts
```
Expected: three "Added ..." lines (or "already exists" if re-run).

- [ ] **Step 3: Verify with a scratch script**

Create `scripts/scratch-verify-wakil-columns.ts`:

```ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE (TABLE_NAME = 'DashboardTimProduksi' AND COLUMN_NAME = 'WakilKepalaAkunID')
       OR (TABLE_NAME = 'DashboardAktivitasProduksiShift' AND COLUMN_NAME IN ('KepalaHadir', 'WakilHadir'))
  `);
  console.table(result.recordset);
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/scratch-verify-wakil-columns.ts`
Expected: 3 rows — `WakilKepalaAkunID` (int, nullable), `KepalaHadir`/`WakilHadir` (bit, not nullable, default `((1))`).

Then delete the scratch script:
```bash
rm scripts/scratch-verify-wakil-columns.ts
```

- [ ] **Step 4: Commit**

```bash
git add scripts/add-wakil-kepala-produksi-columns.ts
git commit -m "feat: add WakilKepalaAkunID and per-shift Kepala/Wakil attendance columns"
```

---

### Task 3: Query layer — Tim/Wakil model and shift attendance

**Files:**
- Modify: `src/lib/queries/tim-produksi.ts`
- Modify: `src/lib/queries/aktivitas-produksi.ts`

**Interfaces:**
- Consumes: the columns from Task 2.
- Produces:
  - `TimRow { timId: number; nama: string; kepalaAkunId: number | null; wakilKepalaAkunId: number | null }` (extended)
  - `updateTimWakilKepala(timId: number, wakilKepalaAkunId: number | null): Promise<void>`
  - `AktivitasShiftInfo` extended with `kepalaAkunId: number | null; wakilKepalaAkunId: number | null; kepalaHadir: boolean; wakilHadir: boolean`
  - `setKepalaHadir(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean, akunId: number): Promise<void>`
  - `setWakilHadir(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean, akunId: number): Promise<void>`

  Tasks 4, 5, 6, 7 all depend on these exact names/shapes.

- [ ] **Step 1: Extend `TimRow` and `getAllTim` in `tim-produksi.ts`**

Change:
```ts
export interface TimRow {
  timId: number;
  nama: string;
  kepalaAkunId: number | null;
}
```
to:
```ts
export interface TimRow {
  timId: number;
  nama: string;
  kepalaAkunId: number | null;
  wakilKepalaAkunId: number | null;
}
```

Change:
```ts
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
```
to:
```ts
export async function getAllTim(): Promise<TimRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TimID, Nama, KepalaAkunID, WakilKepalaAkunID FROM DashboardTimProduksi WHERE IsDeleted = 0 ORDER BY Nama
  `);
  return (
    result.recordset as { TimID: number; Nama: string; KepalaAkunID: number | null; WakilKepalaAkunID: number | null }[]
  ).map((r) => ({
    timId: r.TimID,
    nama: r.Nama,
    kepalaAkunId: r.KepalaAkunID,
    wakilKepalaAkunId: r.WakilKepalaAkunID,
  }));
}
```

- [ ] **Step 2: Add `updateTimWakilKepala` to `tim-produksi.ts`**

Add this function directly after the existing `updateTimKepala`:
```ts
export async function updateTimWakilKepala(timId: number, wakilKepalaAkunId: number | null): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("timId", sql.Int, timId)
    .input("wakilKepalaAkunId", sql.Int, wakilKepalaAkunId)
    .query(`UPDATE DashboardTimProduksi SET WakilKepalaAkunID = @wakilKepalaAkunId, ModifiedDate = GETDATE() WHERE TimID = @timId`);
}
```

- [ ] **Step 3: Extend `AktivitasShiftInfo`, `RawAktivitasRow`, `mapAktivitasRow` in `aktivitas-produksi.ts`**

Change the interface:
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
to:
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
  // Kepala/Wakil Kepala Produksi Tim yang bertugas shift ini (dari
  // DashboardTimProduksi.KepalaAkunID/WakilKepalaAkunID via TimID di
  // atas) -- assignment standing, bukan per-shift. null kalau Tim belum
  // punya Kepala/Wakil ditetapkan.
  kepalaAkunId: number | null;
  wakilKepalaAkunId: number | null;
  // Status hadir KHUSUS shift ini (DashboardAktivitasProduksiShift.KepalaHadir/
  // WakilHadir) -- tidak mengubah assignment standing di atas. true untuk
  // shift yang belum pernah disimpan (belum ada baris untuk ditandai
  // tidak hadir sama sekali).
  kepalaHadir: boolean;
  wakilHadir: boolean;
}
```

Change `RawAktivitasRow`:
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
to:
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
  KepalaAkunID: number | null;
  WakilKepalaAkunID: number | null;
  KepalaHadir: boolean;
  WakilHadir: boolean;
}
```

Change `mapAktivitasRow`:
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
to:
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
    kepalaAkunId: r.KepalaAkunID,
    wakilKepalaAkunId: r.WakilKepalaAkunID,
    kepalaHadir: r.KepalaHadir,
    wakilHadir: r.WakilHadir,
  };
}
```

- [ ] **Step 4: Add a small helper + update `getAktivitasForShift` and `getAktivitasRiwayat`**

Add this private helper directly after `getTotalStokEs10KG` (used only by `getAktivitasForShift`'s "never saved" branch, where there's no `DashboardAktivitasProduksiShift` row yet to join from):
```ts
async function getTimKepalaWakil(pool: sql.ConnectionPool, timId: number | null): Promise<{ kepalaAkunId: number | null; wakilKepalaAkunId: number | null }> {
  if (timId == null) return { kepalaAkunId: null, wakilKepalaAkunId: null };
  const result = await pool
    .request()
    .input("timId", sql.Int, timId)
    .query(`SELECT KepalaAkunID, WakilKepalaAkunID FROM DashboardTimProduksi WHERE TimID = @timId AND IsDeleted = 0`);
  const row = result.recordset[0] as { KepalaAkunID: number | null; WakilKepalaAkunID: number | null } | undefined;
  return row ? { kepalaAkunId: row.KepalaAkunID, wakilKepalaAkunId: row.WakilKepalaAkunID } : { kepalaAkunId: null, wakilKepalaAkunId: null };
}
```

Change `getAktivitasForShift`:
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
to:
```ts
export async function getAktivitasForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<AktivitasShiftInfo> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`
      SELECT s.AktivitasID, s.TimID, s.StafOperasionalAkunID, s.StokEsSebelumnya10KG, s.PecahKemasanQty, s.EsJatuhQty,
             s.GantiReturnQty, s.SealerJebolQty, s.KepalaHadir, s.WakilHadir, t.KepalaAkunID, t.WakilKepalaAkunID
      FROM DashboardAktivitasProduksiShift s
      LEFT JOIN DashboardTimProduksi t ON t.TimID = s.TimID
      WHERE s.TanggalUsaha = @t AND s.Shift = @s
    `);
  const row = result.recordset[0] as RawAktivitasRow | undefined;
  if (row) return mapAktivitasRow(row, tanggalUsaha, shift);

  const stokEs = await getTotalStokEs10KG(pool);
  const timId = await getJadwalUntukShift(tanggalUsaha, shift);
  const { kepalaAkunId, wakilKepalaAkunId } = await getTimKepalaWakil(pool, timId);
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
    kepalaAkunId,
    wakilKepalaAkunId,
    kepalaHadir: true,
    wakilHadir: true,
  };
}
```

Change `getAktivitasRiwayat`:
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
to:
```ts
export async function getAktivitasRiwayat(limit = 30): Promise<AktivitasShiftInfo[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) s.AktivitasID, s.TanggalUsaha, s.Shift, s.TimID, s.StafOperasionalAkunID, s.StokEsSebelumnya10KG,
             s.PecahKemasanQty, s.EsJatuhQty, s.GantiReturnQty, s.SealerJebolQty, s.KepalaHadir, s.WakilHadir,
             t.KepalaAkunID, t.WakilKepalaAkunID
      FROM DashboardAktivitasProduksiShift s
      LEFT JOIN DashboardTimProduksi t ON t.TimID = s.TimID
      ORDER BY s.ShiftMulai DESC
    `);
  return (result.recordset as (RawAktivitasRow & { TanggalUsaha: Date; Shift: number })[]).map((r) =>
    mapAktivitasRow(r, r.TanggalUsaha.toISOString().slice(0, 10), r.Shift as ShiftNumber)
  );
}
```

- [ ] **Step 5: Add `setKepalaHadir`/`setWakilHadir`**

Add these directly after `upsertKerusakan`:
```ts
// Menandai Kepala Produksi hadir/tidak hadir KHUSUS shift ini -- tidak
// mengubah DashboardTimProduksi.KepalaAkunID (assignment standing Tim
// tetap sama). Dipanggil dari roster Aktivitas Produksi (produksi-app).
export async function setKepalaHadir(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .input("hadir", sql.Bit, hadir)
    .query(`UPDATE DashboardAktivitasProduksiShift SET KepalaHadir = @hadir, ModifiedDate = GETDATE() WHERE AktivitasID = @aktivitasId`);
}

export async function setWakilHadir(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .input("hadir", sql.Bit, hadir)
    .query(`UPDATE DashboardAktivitasProduksiShift SET WakilHadir = @hadir, ModifiedDate = GETDATE() WHERE AktivitasID = @aktivitasId`);
}
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```
Expected: errors will appear in files that construct `AktivitasShiftInfo`/`TimRow` object literals without the new required fields (e.g. `produksi-tab-shell.tsx`'s initial-prop typing, or anywhere else `TimRow`/`AktivitasShiftInfo` is directly constructed) — these are exactly the consumers Tasks 5-7 will fix. If `tsc` reports errors ONLY in files this task doesn't touch and that are explicitly listed in Tasks 5-7's Files sections below, that's expected and fine to leave for those tasks — do not fix them here. If it reports errors anywhere else, investigate before proceeding.

- [ ] **Step 7: Verify with a scratch script**

Create `scripts/scratch-verify-kepala-wakil-query.ts`:

```ts
import "dotenv/config";
import { getAllTim, updateTimWakilKepala } from "../src/lib/queries/tim-produksi";
import { getAktivitasForShift, setKepalaHadir, setWakilHadir, getCurrentShift } from "../src/lib/queries/aktivitas-produksi";

async function main() {
  const timList = await getAllTim();
  const timA = timList.find((t) => t.nama === "Tim A");
  if (!timA) throw new Error("Tim A not found");
  console.log("Tim A before:", timA);

  // Temporarily assign timA's own Kepala as a stand-in Wakil just to prove
  // the column round-trips correctly, then clear it back to null.
  const standInWakilId = timA.kepalaAkunId;
  if (standInWakilId == null) throw new Error("Tim A has no Kepala assigned to test with");

  await updateTimWakilKepala(timA.timId, standInWakilId);
  const afterSet = (await getAllTim()).find((t) => t.timId === timA.timId);
  console.log("Tim A after updateTimWakilKepala (should show wakilKepalaAkunId set):", afterSet);

  await updateTimWakilKepala(timA.timId, null);
  const afterClear = (await getAllTim()).find((t) => t.timId === timA.timId);
  console.log("Tim A after clearing (should be null again):", afterClear);

  const { tanggalUsaha, shift } = getCurrentShift();
  const before = await getAktivitasForShift(tanggalUsaha, shift);
  console.log("Current shift kepalaHadir/wakilHadir before (should both be true):", before.kepalaHadir, before.wakilHadir);

  await setKepalaHadir(tanggalUsaha, shift, false, 1);
  const afterKepalaFalse = await getAktivitasForShift(tanggalUsaha, shift);
  console.log("After setKepalaHadir(false) (should be false, wakil unchanged true):", afterKepalaFalse.kepalaHadir, afterKepalaFalse.wakilHadir);

  await setWakilHadir(tanggalUsaha, shift, false, 1);
  const afterWakilFalse = await getAktivitasForShift(tanggalUsaha, shift);
  console.log("After setWakilHadir(false) (should both be false):", afterWakilFalse.kepalaHadir, afterWakilFalse.wakilHadir);

  // Restore both to true so this doesn't leave today's real shift row
  // stuck showing "tidak hadir" after the test.
  await setKepalaHadir(tanggalUsaha, shift, true, 1);
  await setWakilHadir(tanggalUsaha, shift, true, 1);
  const restored = await getAktivitasForShift(tanggalUsaha, shift);
  console.log("Restored to true/true:", restored.kepalaHadir, restored.wakilHadir);

  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/scratch-verify-kepala-wakil-query.ts`
Expected: `wakilKepalaAkunId` round-trips to the stand-in value then back to `null`; `kepalaHadir`/`wakilHadir` start `true`/`true`, flip independently, then are restored to `true`/`true`.

Before running, check that akun id `1` (used as `dicatatOlehAkunID`/`akunId` in `setKepalaHadir`/`setWakilHadir`) is a real row in the Postgres `akun` table — adjust if not (any existing account id works, it's only stored as an audit column via `ensureAktivitasRow`).

Then delete the scratch script:
```bash
rm scripts/scratch-verify-kepala-wakil-query.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/tim-produksi.ts src/lib/queries/aktivitas-produksi.ts
git commit -m "feat: extend Tim/Aktivitas query layer for Wakil Kepala Produksi attendance"
```

---

### Task 4: Create the 3 new deputy accounts

**Files:**
- Create: `scripts/create-wakil-kepala-produksi-akun.ts`

**Interfaces:**
- Consumes: `createAkun` (`src/lib/queries/akun.ts`, already exists), `getAllTim`/`updateTimWakilKepala` (Task 3).

- [ ] **Step 1: Write the script**

```ts
// One-off setup — creates the 3 Wakil Kepala Produksi accounts and
// assigns each to their Tim. Run once; safe to re-run (skips a Tim that
// already has a WakilKepalaAkunID set, and skips creating an akun whose
// username already exists).
// Usage: npx tsx scripts/create-wakil-kepala-produksi-akun.ts
import "dotenv/config";
import { createAkun } from "../src/lib/queries/akun";
import { getAllTim, updateTimWakilKepala } from "../src/lib/queries/tim-produksi";
import { getPgPool } from "../src/lib/pg";

const PERAN_PRODUKSI_ID = 1012;
const PERUSAHAAN_MKESINDO_ID = 1;
const PASSWORD = "12345678";

const WAKIL_LIST: { username: string; nama: string; timNama: string }[] = [
  { username: "Nizam", nama: "PRD-Nizam", timNama: "Tim A" },
  { username: "Aldo", nama: "PRD-Aldo", timNama: "Tim B" },
  { username: "Reza", nama: "PRD-Reza", timNama: "Tim C" },
];

async function findAkunIdByUsername(username: string): Promise<number | null> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT id FROM akun WHERE username = $1`, [username]);
  return (result.rows[0] as { id: number } | undefined)?.id ?? null;
}

async function main() {
  const timList = await getAllTim();

  for (const wakil of WAKIL_LIST) {
    const tim = timList.find((t) => t.nama === wakil.timNama);
    if (!tim) {
      console.log(`SKIP ${wakil.username}: Tim "${wakil.timNama}" tidak ditemukan.`);
      continue;
    }

    let akunId = await findAkunIdByUsername(wakil.username);
    if (akunId == null) {
      await createAkun({
        nama: wakil.nama,
        username: wakil.username,
        password: PASSWORD,
        email: null,
        nomorTelepon: null,
        perusahaanId: PERUSAHAAN_MKESINDO_ID,
        peranId: PERAN_PRODUKSI_ID,
        salesmanId: null,
      });
      akunId = await findAkunIdByUsername(wakil.username);
      console.log(`Created akun ${wakil.username} (id ${akunId}).`);
    } else {
      console.log(`Akun ${wakil.username} sudah ada (id ${akunId}) — tidak dibuat ulang.`);
    }
    if (akunId == null) throw new Error(`Gagal menemukan akun ${wakil.username} setelah dibuat.`);

    if (tim.wakilKepalaAkunId === akunId) {
      console.log(`Tim ${wakil.timNama} sudah punya Wakil ${wakil.username} — tidak diubah.`);
      continue;
    }
    await updateTimWakilKepala(tim.timId, akunId);
    console.log(`Set ${wakil.username} (id ${akunId}) sebagai Wakil Kepala Produksi ${wakil.timNama}.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the live database**

```bash
npx tsx scripts/create-wakil-kepala-produksi-akun.ts
```
Expected: 3 lines confirming each account created and assigned (e.g. "Created akun Nizam (id X)." then "Set Nizam (id X) sebagai Wakil Kepala Produksi Tim A.").

- [ ] **Step 3: Verify with a scratch script**

Create `scripts/scratch-verify-wakil-akun.ts`:

```ts
import "dotenv/config";
import { getAllTim } from "../src/lib/queries/tim-produksi";
import { getAkunNamaMap } from "../src/lib/queries/akun";

async function main() {
  const timList = await getAllTim();
  const wakilIds = timList.map((t) => t.wakilKepalaAkunId).filter((id): id is number => id != null);
  const namaMap = await getAkunNamaMap(wakilIds);
  for (const t of timList) {
    console.log(`${t.nama}: Wakil = ${t.wakilKepalaAkunId != null ? (namaMap.get(t.wakilKepalaAkunId) ?? "(nama tidak ditemukan)") : "(belum ditentukan)"}`);
  }
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npx tsx scripts/scratch-verify-wakil-akun.ts`
Expected:
```
Tim A: Wakil = PRD-Nizam
Tim B: Wakil = PRD-Aldo
Tim C: Wakil = PRD-Reza
```

Then delete the scratch script:
```bash
rm scripts/scratch-verify-wakil-akun.ts
```

- [ ] **Step 4: Commit**

```bash
git add scripts/create-wakil-kepala-produksi-akun.ts
git commit -m "feat: create Wakil Kepala Produksi accounts for Nizam/Aldo/Reza"
```

---

### Task 5: Server actions — Wakil assignment and Kepala/Wakil attendance

**Files:**
- Modify: `src/app/mkesindo/produksi/actions.ts`

**Interfaces:**
- Consumes: `updateTimWakilKepala`, `setKepalaHadir`, `setWakilHadir` (Task 3).
- Produces:
  - `updateTimWakilKepalaAction(timId: number, wakilKepalaAkunId: number | null): Promise<ActionResult<void>>`
  - `setKepalaHadirAction(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean): Promise<ActionResult<void>>`
  - `setWakilHadirAction(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean): Promise<ActionResult<void>>`
  - `getCurrentAktivitasProduksiAction`/`getAktivitasDetailAction` return shape gains `kepalaNama: string | null; wakilKepalaNama: string | null` (alongside the existing `stafOperasionalNama`).

  Tasks 6-7 consume these.

- [ ] **Step 1: Add imports**

Add `updateTimWakilKepala` to the existing `tim-produksi.ts` import block:
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
  updateTimWakilKepala,
  getTimByKepalaAkunId,
  type AnggotaTimRow,
  type TimRow,
} from "@/lib/queries/tim-produksi";
```

Add `setKepalaHadir`/`setWakilHadir` to the existing `aktivitas-produksi.ts` import block:
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
  setKepalaHadir,
  setWakilHadir,
  getQtyRecapForShift,
  type AktivitasShiftInfo,
  type QtyRecap,
  type KerusakanInput,
  type SusunanTimRow,
} from "@/lib/queries/aktivitas-produksi";
```

- [ ] **Step 2: Add `updateTimWakilKepalaAction`**

Add directly after the existing `updateTimKepalaAction`:
```ts
export async function updateTimWakilKepalaAction(timId: number, wakilKepalaAkunId: number | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiAdmin();
    await updateTimWakilKepala(timId, wakilKepalaAkunId);
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}
```

- [ ] **Step 3: Add `setKepalaHadirAction`/`setWakilHadirAction`**

Add directly after the existing `setTimBertugasAction`:
```ts
export async function setKepalaHadirAction(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setKepalaHadir(tanggalUsaha, shift, hadir, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function setWakilHadirAction(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setWakilHadir(tanggalUsaha, shift, hadir, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}
```

- [ ] **Step 4: Resolve `kepalaNama`/`wakilKepalaNama` in `getCurrentAktivitasProduksiAction` and `getAktivitasDetailAction`**

Change `getCurrentAktivitasProduksiAction`:
```ts
export async function getCurrentAktivitasProduksiAction(): Promise<
  ActionResult<{
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    susunanTim: SusunanTimRow[];
    stafOperasionalNama: string | null;
  }>
> {
  return runAction(async () => {
    await requireProduksiView();
    const { tanggalUsaha, shift } = getCurrentShift();
    const [current, qty, susunanTim] = await Promise.all([
      getAktivitasForShift(tanggalUsaha, shift),
      getQtyRecapForShift(tanggalUsaha, shift),
      getSusunanTim(tanggalUsaha, shift),
    ]);
    const namaMap = await getAkunNamaMap(current.stafOperasionalAkunId != null ? [current.stafOperasionalAkunId] : []);
    return {
      current,
      qty,
      susunanTim,
      stafOperasionalNama:
        current.stafOperasionalAkunId != null
          ? (namaMap.get(current.stafOperasionalAkunId) ?? null)
          : null,
    };
  });
}
```
to:
```ts
export async function getCurrentAktivitasProduksiAction(): Promise<
  ActionResult<{
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    susunanTim: SusunanTimRow[];
    stafOperasionalNama: string | null;
    kepalaNama: string | null;
    wakilKepalaNama: string | null;
  }>
> {
  return runAction(async () => {
    await requireProduksiView();
    const { tanggalUsaha, shift } = getCurrentShift();
    const [current, qty, susunanTim] = await Promise.all([
      getAktivitasForShift(tanggalUsaha, shift),
      getQtyRecapForShift(tanggalUsaha, shift),
      getSusunanTim(tanggalUsaha, shift),
    ]);
    const akunIds = [current.stafOperasionalAkunId, current.kepalaAkunId, current.wakilKepalaAkunId].filter(
      (id): id is number => id != null
    );
    const namaMap = await getAkunNamaMap(akunIds);
    return {
      current,
      qty,
      susunanTim,
      stafOperasionalNama:
        current.stafOperasionalAkunId != null
          ? (namaMap.get(current.stafOperasionalAkunId) ?? null)
          : null,
      kepalaNama: current.kepalaAkunId != null ? (namaMap.get(current.kepalaAkunId) ?? null) : null,
      wakilKepalaNama: current.wakilKepalaAkunId != null ? (namaMap.get(current.wakilKepalaAkunId) ?? null) : null,
    };
  });
}
```

Change `getAktivitasDetailAction` the same way (it has the identical shape and body as `getCurrentAktivitasProduksiAction` above, just keyed by an explicit `tanggalUsaha`/`shift` parameter instead of `getCurrentShift()`):

Before:
```ts
export async function getAktivitasDetailAction(
  tanggalUsaha: string,
  shift: ShiftNumber
): Promise<
  ActionResult<{
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    susunanTim: SusunanTimRow[];
    stafOperasionalNama: string | null;
  }>
> {
  return runAction(async () => {
    await requireProduksiView();
    const [current, qty, susunanTim] = await Promise.all([
      getAktivitasForShift(tanggalUsaha, shift),
      getQtyRecapForShift(tanggalUsaha, shift),
      getSusunanTim(tanggalUsaha, shift),
    ]);
    const namaMap = await getAkunNamaMap(current.stafOperasionalAkunId != null ? [current.stafOperasionalAkunId] : []);
    return {
      current,
      qty,
      susunanTim,
      stafOperasionalNama:
        current.stafOperasionalAkunId != null
          ? (namaMap.get(current.stafOperasionalAkunId) ?? null)
          : null,
    };
  });
}
```
After:
```ts
export async function getAktivitasDetailAction(
  tanggalUsaha: string,
  shift: ShiftNumber
): Promise<
  ActionResult<{
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    susunanTim: SusunanTimRow[];
    stafOperasionalNama: string | null;
    kepalaNama: string | null;
    wakilKepalaNama: string | null;
  }>
> {
  return runAction(async () => {
    await requireProduksiView();
    const [current, qty, susunanTim] = await Promise.all([
      getAktivitasForShift(tanggalUsaha, shift),
      getQtyRecapForShift(tanggalUsaha, shift),
      getSusunanTim(tanggalUsaha, shift),
    ]);
    const akunIds = [current.stafOperasionalAkunId, current.kepalaAkunId, current.wakilKepalaAkunId].filter(
      (id): id is number => id != null
    );
    const namaMap = await getAkunNamaMap(akunIds);
    return {
      current,
      qty,
      susunanTim,
      stafOperasionalNama:
        current.stafOperasionalAkunId != null
          ? (namaMap.get(current.stafOperasionalAkunId) ?? null)
          : null,
      kepalaNama: current.kepalaAkunId != null ? (namaMap.get(current.kepalaAkunId) ?? null) : null,
      wakilKepalaNama: current.wakilKepalaAkunId != null ? (namaMap.get(current.wakilKepalaAkunId) ?? null) : null,
    };
  });
}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: this file's own errors are now clean. Remaining `tsc` errors, if any, should only be in `produksi-tab-shell.tsx`/`aktivitas-produksi-view.tsx`/`tim-produksi-roster.tsx`/`panel-tim-produksi.tsx` — those are Tasks 6-7's job, leave them.

- [ ] **Step 6: Verify with a scratch script**

Create `scripts/scratch-verify-actions-kepala-wakil.ts`:

```ts
import "dotenv/config";
import { getCurrentAktivitasProduksiAction, updateTimWakilKepalaAction, setKepalaHadirAction } from "../src/app/mkesindo/produksi/actions";

async function main() {
  const result = await getCurrentAktivitasProduksiAction();
  if (!result.success) throw new Error(result.error);
  console.log("current.kepalaAkunId/wakilKepalaAkunId:", result.data.current.kepalaAkunId, result.data.current.wakilKepalaAkunId);
  console.log("kepalaNama/wakilKepalaNama:", result.data.kepalaNama, result.data.wakilKepalaNama);
  console.log("kepalaHadir/wakilHadir:", result.data.current.kepalaHadir, result.data.current.wakilHadir);
  process.exit(0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Note: this calls `requireProduksiView()` internally, which reads the session via `auth()` and will redirect/throw outside a real request context — if this fails with an auth-related error when run standalone via `tsx`, that's expected (Server Actions assume a Next.js request context); in that case, skip this scratch script and instead verify Steps 2-4's changes purely via `tsc --noEmit` passing plus a careful read-through, and rely on Task 7's manual browser verification to confirm `kepalaNama`/`wakilKepalaNama` resolve correctly end-to-end.

If it does run, expected: `kepalaNama` shows a real name (e.g. "PRD-Maicha") if the current shift's Tim has a Kepala assigned; `wakilKepalaNama` shows the newly-created deputy's name if Task 4 already ran for that Tim.

Delete the scratch script either way:
```bash
rm scripts/scratch-verify-actions-kepala-wakil.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/app/mkesindo/produksi/actions.ts
git commit -m "feat: add Wakil Kepala Produksi assignment and attendance server actions"
```

---

### Task 6: Admin UI — Wakil Kepala Produksi dropdown

**Files:**
- Modify: `src/components/produksi/panel-tim-produksi.tsx`

**Interfaces:**
- Consumes: `updateTimWakilKepalaAction` (Task 5), `TimRow.wakilKepalaAkunId` (Task 3).

- [ ] **Step 1: Add `WakilKepalaSelect` and update `KepalaSelect`'s options filter**

Add the import:
```ts
import { tambahAnggotaTimAction, updateAnggotaTimAction, hapusAnggotaTimAction, updateTimKepalaAction, updateTimWakilKepalaAction } from "@/app/mkesindo/produksi/actions";
```

Change `KepalaSelect` to exclude the Tim's own `wakilKepalaAkunId` from its options (so one account can't be both Kepala and Wakil of the same Tim):
```tsx
function KepalaSelect({ tim, produksiAkunOptions }: { tim: TimRow; produksiAkunOptions: StafOperasionalOption[] }) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    startTransition(async () => {
      await updateTimKepalaAction(tim.timId, !value || value === UNSET ? null : Number(value));
    });
  }

  const options = produksiAkunOptions.filter((o) => o.akunId !== tim.wakilKepalaAkunId);

  return (
    <Select value={tim.kepalaAkunId != null ? String(tim.kepalaAkunId) : UNSET} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pilih Kepala Produksi">
          {(v: string) => (v === UNSET ? "Pilih Kepala Produksi" : (options.find((o) => String(o.akunId) === v)?.nama ?? "Pilih Kepala Produksi"))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>Belum ditentukan</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.akunId} value={String(o.akunId)}>
            {o.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

Note: this replaces `produksiAkunOptions` with the filtered `options` both in the `<SelectItem>` list AND in the render-prop lookup (Task 1's fix) — if Task 1 already landed, update the lookup target from `produksiAkunOptions` to `options`; if executing this task before Task 1 for some reason, write both changes together as shown above.

Add `WakilKepalaSelect` directly after `KepalaSelect`:
```tsx
function WakilKepalaSelect({ tim, produksiAkunOptions }: { tim: TimRow; produksiAkunOptions: StafOperasionalOption[] }) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    startTransition(async () => {
      await updateTimWakilKepalaAction(tim.timId, !value || value === UNSET ? null : Number(value));
    });
  }

  const options = produksiAkunOptions.filter((o) => o.akunId !== tim.kepalaAkunId);

  return (
    <Select value={tim.wakilKepalaAkunId != null ? String(tim.wakilKepalaAkunId) : UNSET} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Pilih Wakil Kepala Produksi">
          {(v: string) =>
            v === UNSET ? "Pilih Wakil Kepala Produksi" : (options.find((o) => String(o.akunId) === v)?.nama ?? "Pilih Wakil Kepala Produksi")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>Belum ditentukan</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.akunId} value={String(o.akunId)}>
            {o.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Render it in `PanelTimProduksi`**

Change:
```tsx
          <div>
            <Label className="text-xs">Kepala Produksi</Label>
            <KepalaSelect tim={tim} produksiAkunOptions={produksiAkunOptions} />
          </div>
```
to:
```tsx
          <div>
            <Label className="text-xs">Kepala Produksi</Label>
            <KepalaSelect tim={tim} produksiAkunOptions={produksiAkunOptions} />
          </div>
          <div>
            <Label className="text-xs">Wakil Kepala Produksi</Label>
            <WakilKepalaSelect tim={tim} produksiAkunOptions={produksiAkunOptions} />
          </div>
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: this file's own errors are clean.

- [ ] **Step 4: Manual visual check**

Open `/mkesindo/produksi`, confirm each Tim card now shows a "Wakil Kepala Produksi" dropdown below "Kepala Produksi", already pre-filled with the deputy created in Task 4 (Tim A → PRD-Nizam, Tim B → PRD-Aldo, Tim C → PRD-Reza). Confirm the currently-assigned Kepala does not appear as a selectable option in that Tim's own Wakil dropdown, and vice versa.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi/panel-tim-produksi.tsx
git commit -m "feat: add Wakil Kepala Produksi dropdown to the Tim Produksi admin panel"
```

---

### Task 7: Produksi-app roster — Kepala/Wakil rows, attendance toggle, dynamic kontribusi

**Files:**
- Modify: `src/components/produksi-app/tim-produksi-roster.tsx`
- Modify: `src/components/produksi-app/aktivitas-produksi-view.tsx`
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx`

**Interfaces:**
- Consumes: `setKepalaHadirAction`/`setWakilHadirAction` (Task 5), `AktivitasShiftInfo.kepalaAkunId/wakilKepalaAkunId/kepalaHadir/wakilHadir` (Task 3), `kepalaNama`/`wakilKepalaNama` (Task 5).

- [ ] **Step 1: Add the Kepala/Wakil rows to `TimProduksiRoster`**

Add a new component directly above `TimProduksiRoster`'s own definition in `tim-produksi-roster.tsx`:
```tsx
function KepalaWakilRow({
  label,
  nama,
  hadir,
  pending,
  onToggle,
}: {
  label: string;
  nama: string;
  hadir: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  if (!hadir) {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed border-border px-2 py-1.5 text-sm text-muted-foreground">
        <span>{label} tidak hadir shift ini</span>
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Tandai hadir kembali
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <span className="flex-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">{label}: </span>
        <span className="font-medium">{nama}</span>
      </span>
      <button
        type="button"
        title={`Tandai ${label} tidak hadir shift ini`}
        onClick={onToggle}
        disabled={pending}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
```

Add the import for the two new actions at the top of the file:
```ts
import { setSusunanTimAction, getSemuaAnggotaTimAction, setKepalaHadirAction, setWakilHadirAction } from "@/app/mkesindo/produksi/actions";
```

Change `TimProduksiRoster`'s props and add the toggle handlers:
```tsx
export function TimProduksiRoster({
  tanggalUsaha,
  shift,
  susunanTim,
  kepalaAkunId,
  kepalaNama,
  kepalaHadir,
  wakilKepalaAkunId,
  wakilKepalaNama,
  wakilHadir,
  canEdit,
  onChanged,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  susunanTim: SusunanTimRow[];
  kepalaAkunId: number | null;
  kepalaNama: string | null;
  kepalaHadir: boolean;
  wakilKepalaAkunId: number | null;
  wakilKepalaNama: string | null;
  wakilHadir: boolean;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState(susunanTim);
  const [semuaAnggota, setSemuaAnggota] = useState<AnggotaTimRow[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [kepalaPending, startKepalaTransition] = useTransition();
  const [wakilPending, startWakilTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleToggleKepala() {
    startKepalaTransition(async () => {
      const result = await setKepalaHadirAction(tanggalUsaha, shift, !kepalaHadir);
      if (result.success) onChanged();
    });
  }

  function handleToggleWakil() {
    startWakilTransition(async () => {
      const result = await setWakilHadirAction(tanggalUsaha, shift, !wakilHadir);
      if (result.success) onChanged();
    });
  }

  // ... rest of the existing hooks (useEffect for order sync, useEffect for
  // semuaAnggota fetch, persist, handleDragEnd, handleRemove, handleTambah,
  // tersedia) stay EXACTLY as they are today — unchanged.
```

Change the render to add the two new rows above the existing sortable list, inside the same `CardContent`:
```tsx
      <CardContent className="flex flex-col gap-3">
        {kepalaAkunId != null && kepalaNama != null && (
          <KepalaWakilRow label="Kepala Produksi" nama={kepalaNama} hadir={kepalaHadir} pending={kepalaPending} onToggle={handleToggleKepala} />
        )}
        {wakilKepalaAkunId != null && wakilKepalaNama != null && (
          <KepalaWakilRow label="Wakil Kepala Produksi" nama={wakilKepalaNama} hadir={wakilHadir} pending={wakilPending} onToggle={handleToggleWakil} />
        )}
        {order.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada anggota bertugas.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order.map((o) => o.anggotaId)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1.5">
                {order.map((entry, i) => (
                  <SortableRosterRow key={entry.anggotaId} entry={entry} index={i} canEdit={canEdit} pending={pending} onRemove={handleRemove} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
```
(Everything from `{canEdit && (<Select .../>)}` onward stays unchanged.)

- [ ] **Step 2: Wire the new props through `AktivitasProduksiView`**

Change the `<TimProduksiRoster>` call site in `aktivitas-produksi-view.tsx`:
```tsx
          <TimProduksiRoster tanggalUsaha={current.tanggalUsaha} shift={current.shift} susunanTim={susunanTim} canEdit onChanged={onChanged} />
```
to:
```tsx
          <TimProduksiRoster
            tanggalUsaha={current.tanggalUsaha}
            shift={current.shift}
            susunanTim={susunanTim}
            kepalaAkunId={current.kepalaAkunId}
            kepalaNama={kepalaNama}
            kepalaHadir={current.kepalaHadir}
            wakilKepalaAkunId={current.wakilKepalaAkunId}
            wakilKepalaNama={wakilKepalaNama}
            wakilHadir={current.wakilHadir}
            canEdit
            onChanged={onChanged}
          />
```

Add `kepalaNama`/`wakilKepalaNama` to `AktivitasProduksiView`'s props (alongside the existing `stafOperasionalNama`):
```tsx
export function AktivitasProduksiView({
  current,
  qty,
  susunanTim,
  stafOperasionalNama,
  kepalaNama,
  wakilKepalaNama,
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
  kepalaNama: string | null;
  wakilKepalaNama: string | null;
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
  timSaya: { timId: number; nama: string; anggota: AnggotaTimRow[] } | null;
  riwayat: AktivitasShiftInfo[];
  onChanged: () => void;
}) {
```

Change the `jumlahHadir` passed to `QtyRecapCard`:
```tsx
          <QtyRecapCard qty={qty} jumlahHadir={susunanTim.length} />
```
to:
```tsx
          <QtyRecapCard
            qty={qty}
            jumlahHadir={
              (current.kepalaAkunId != null && current.kepalaHadir ? 1 : 0) +
              (current.wakilKepalaAkunId != null && current.wakilHadir ? 1 : 0) +
              susunanTim.length
            }
          />
```

- [ ] **Step 3: Thread `kepalaNama`/`wakilKepalaNama` through `produksi-tab-shell.tsx`**

Since `setAktivitasProduksi({ ...aktivitasResult.data, ... })` already spreads the entire action result (which now includes `kepalaNama`/`wakilKepalaNama` from Task 5), the state object itself needs no change. Only the type annotation and the JSX call site need updating.

Change the `initialAktivitasProduksi` prop type (find the block containing `stafOperasionalNama: string | null;`):
```ts
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
to:
```ts
  initialAktivitasProduksi?: {
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    susunanTim: SusunanTimRow[];
    stafOperasionalNama: string | null;
    kepalaNama: string | null;
    wakilKepalaNama: string | null;
    mesinList: MesinRow[];
    mesinEvents: MesinEventRow[];
    stafOperasionalOptions: StafOperasionalOption[];
    timList: TimRow[];
    timSaya: { timId: number; nama: string; anggota: AnggotaTimRow[] } | null;
    riwayat: AktivitasShiftInfo[];
  };
```

Change the `<AktivitasProduksiView>` call site to pass the two new props (alongside the existing `stafOperasionalNama={aktivitasProduksi.stafOperasionalNama}`):
```tsx
              stafOperasionalNama={aktivitasProduksi.stafOperasionalNama}
```
to:
```tsx
              stafOperasionalNama={aktivitasProduksi.stafOperasionalNama}
              kepalaNama={aktivitasProduksi.kepalaNama}
              wakilKepalaNama={aktivitasProduksi.wakilKepalaNama}
```

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: clean across all 3 files. If `tsc` reports a mismatch anywhere else, it means a consumer of these types was missed — investigate and fix before proceeding (this plan's earlier tasks should have covered every consumer, but this step is the final cross-check).

- [ ] **Step 5: Manual verification in the browser**

Start the dev server, open `/mkesindo/produksi-app`'s Aktivitas tab for a shift whose Tim already has both a Kepala and the newly-created Wakil assigned (from Task 4). Confirm:
- Kepala Produksi's name appears as the top row, Wakil Kepala Produksi's name directly below it, then the existing anggota list.
- The "Kontribusi / Orang" figure in the Rekap Produksi card reflects `(1 + 1 + jumlah anggota)` as the divisor.
- Clicking the Kepala row's "X" marks it "tidak hadir", the divisor drops by 1, and the card updates accordingly. Clicking "Tandai hadir kembali" restores it.
- Repeat for the Wakil row.
- Remove one anggota from the roster (existing mechanism, untouched) and confirm the divisor also drops by 1 for that.

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi-app/tim-produksi-roster.tsx src/components/produksi-app/aktivitas-produksi-view.tsx src/components/produksi-app/produksi-tab-shell.tsx
git commit -m "feat: show Kepala/Wakil Kepala Produksi in the shift roster with attendance toggle"
```

---

### Task 8: End-to-end manual verification

This app has no automated test suite — this task verifies the complete feature by using it end-to-end, matching how every other feature in this codebase has been verified this session.

**Files:** none (verification only).

- [ ] **Step 1: Bagian A regression check**

Open `/mkesindo/produksi`. Confirm Kepala Produksi and Tim dropdowns show names (not raw IDs) in every card, and the Jadwal Tim Produksi calendar's Tim cells show names too. Open `/mkesindo/produksi-app`'s Aktivitas tab and confirm the Tim Bertugas dropdown shows the Tim name.

- [ ] **Step 2: Wakil assignment**

On `/mkesindo/produksi`, confirm all 3 Tim cards show their Wakil Kepala Produksi pre-filled (Tim A → PRD-Nizam, Tim B → PRD-Aldo, Tim C → PRD-Reza — Tim C's existing Kepala is PRD-Hartoyo, unaffected by this task). Try reassigning one Tim's Wakil to a different account and confirm it saves and the excluded-Kepala rule holds.

- [ ] **Step 3: Full attendance-and-kontribusi worked example**

Reproduce the 4 examples from the spec for one real shift: with Kepala+Wakil+5 anggota present, note the kontribusi figure; mark Wakil absent and confirm the divisor drops by exactly 1; restore Wakil, mark Kepala absent instead, confirm the same; restore Kepala, remove one anggota from the roster instead, confirm the divisor also drops by 1 for that case.

- [ ] **Step 4: New account login**

Log in as `Nizam` (or `Aldo`/`Reza`) with password `12345678`, confirm it authenticates and lands in a produksi-appropriate view (same experience as an existing Kepala Produksi account).

- [ ] **Step 5: Report results**

No commit for this task — it's verification only. If any step fails, return to the relevant earlier task, fix the root cause, and re-run this task's steps from the top.
