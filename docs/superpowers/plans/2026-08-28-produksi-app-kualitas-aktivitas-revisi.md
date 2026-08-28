# Revisi Tab Kualitas & Aktivitas (produksi-app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revise `/mkesindo/produksi-app`'s Kualitas and Aktivitas tabs per the approved spec: QTY-based plafon stok, unit/field cleanup on Kualitas, automatic Staf Operasional, and a redesigned drag-orderable per-shift Tim Produksi roster with a new admin management section.

**Architecture:** No new subsystems — extends existing tables
(`DashboardProduksiKualitas`, `DashboardProduksiBatch` via its existing
`KualitasID` FK, `DashboardTimProduksiAnggota`,
`DashboardAktivitasProduksiKehadiran`/`...Shift`) and existing Server
Action modules (`src/app/mkesindo/produksi/actions.ts`). One new UI
section (Tim Produksi management) added to the existing
`/mkesindo/produksi` desktop page.

**Tech Stack:** Next.js Server Components + Server Actions, MSSQL (`mssql`
package, `getPool()`/`sql` from `@/lib/db`), `@dnd-kit/core` +
`@dnd-kit/sortable` (already a dependency — see
[`route-validation-dialog.tsx`](../../../src/components/dashboard/route-validation-dialog.tsx)
for the exact pattern this plan mirrors).

**Spec:** [2026-08-28-produksi-app-kualitas-aktivitas-revisi-design.md](../specs/2026-08-28-produksi-app-kualitas-aktivitas-revisi-design.md)

## Global Constraints

- No automated test framework exists for produksi-app in this repo — every
  task's verification step is manual (a one-off script for schema/data
  checks, or the Browser pane for UI), matching this codebase's existing
  practice. Do not invent a test framework or skip verification because of
  its absence.
- Every schema-migration script must be idempotent (check
  `INFORMATION_SCHEMA.COLUMNS` before altering) and runnable via
  `npx tsx scripts/<name>.ts` — mirror
  [`rename-kualitas-suhues-to-diameter.ts`](../../../scripts/rename-kualitas-suhues-to-diameter.ts)
  and [`drop-legacy-auth-tables.ts`](../../../scripts/drop-legacy-auth-tables.ts).
- `DashboardProduksiKualitas.Qty10KG` and `DiameterDalamMm` are nullable —
  legacy rows stay `NULL` after migration (never backfilled). Any new code
  reading them must handle `null` (treat as "no data"/"no limit", per the
  spec's Bagian 2).
- `requireProduksiView()` (from `@/lib/require-access`) gates every
  produksi-app/produksi Server Action and page in this plan — reuse it
  exactly as existing actions in `src/app/mkesindo/produksi/actions.ts`
  already do, never a different guard.
- Indonesian strings throughout (labels, error messages, comments in
  business-logic-heavy spots only) — match the existing file's own
  language and comment density, don't over-comment straightforward code.

---

### Task 1: DB migration — Kualitas Qty10KG/DiameterDalamMm/drop Kontaminasi-Kemasan

**Files:**
- Create: `scripts/revisi-kualitas-qty-diameter-drop-checks.ts`

**Interfaces:**
- Produces: `DashboardProduksiKualitas` columns `Qty10KG INT NULL`,
  `DiameterDalamMm DECIMAL(5,1) NULL` — consumed by Task 3 (query layer)
  and Task 5 (form UI). Columns `BeratSampel`, `DiameterDalamCm`,
  `CekKontaminasi`, `CekKemasan` no longer exist after this task — every
  later task in this plan must not reference them.

- [ ] **Step 1: Write the migration script**

```ts
// One-off schema migration for DashboardProduksiKualitas, three independent
// changes bundled together (all from the same "revisi tab Kualitas" request
// -- see docs/superpowers/specs/2026-08-28-produksi-app-kualitas-aktivitas-revisi-design.md):
//
// 1. BeratSampel (DECIMAL(10,2), gram, never actually used for anything) is
//    replaced by Qty10KG (INT) -- becomes the plafon stok source of truth
//    checked against DashboardProduksiBatch's existing KualitasID FK. Old
//    gram values are discarded (no unit relationship to kantong count), so
//    this is add-new-column + drop-old, not a pure rename.
// 2. DiameterDalamCm (DECIMAL(5,2)) is replaced by DiameterDalamMm
//    (DECIMAL(5,1)) -- existing non-NULL values ARE carried over
//    (multiplied x10, cm -> mm), since the measurement itself is still
//    meaningful, just in a different unit.
// 3. CekKontaminasi/CekKemasan (BIT) are DROPPED entirely, including their
//    historical data -- explicit user request (their form input was
//    already removed in an earlier change; this finishes the removal).
//    Backed up to scratchpad/ first (gitignored), mirroring
//    scripts/drop-legacy-auth-tables.ts's own safety pattern, before the
//    DROP COLUMN runs.
//
// Idempotent, safe to re-run -- each step checks INFORMATION_SCHEMA first.
// Usage: npx tsx scripts/revisi-kualitas-qty-diameter-drop-checks.ts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getPool, sql } from "../src/lib/db";

const TABLE = "DashboardProduksiKualitas";

async function columnExists(pool: Awaited<ReturnType<typeof getPool>>, column: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("t", sql.VarChar(128), TABLE)
    .input("c", sql.VarChar(128), column)
    .query(`SELECT 1 AS Found FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t AND COLUMN_NAME = @c`);
  return result.recordset.length > 0;
}

async function main() {
  const pool = await getPool();

  // 1. BeratSampel -> Qty10KG
  if (await columnExists(pool, "Qty10KG")) {
    console.log("Qty10KG already exists -- skipping step 1.");
  } else if (await columnExists(pool, "BeratSampel")) {
    await pool.request().query(`ALTER TABLE ${TABLE} ADD Qty10KG INT NULL`);
    await pool.request().query(`ALTER TABLE ${TABLE} DROP COLUMN BeratSampel`);
    console.log("Replaced BeratSampel with Qty10KG (old gram values discarded).");
  } else {
    throw new Error("Neither BeratSampel nor Qty10KG found -- unexpected schema state.");
  }

  // 2. DiameterDalamCm -> DiameterDalamMm (x10 conversion)
  if (await columnExists(pool, "DiameterDalamMm")) {
    console.log("DiameterDalamMm already exists -- skipping step 2.");
  } else if (await columnExists(pool, "DiameterDalamCm")) {
    await pool.request().query(`ALTER TABLE ${TABLE} ADD DiameterDalamMm DECIMAL(5,1) NULL`);
    await pool.request().query(`UPDATE ${TABLE} SET DiameterDalamMm = DiameterDalamCm * 10 WHERE DiameterDalamCm IS NOT NULL`);
    await pool.request().query(`ALTER TABLE ${TABLE} DROP COLUMN DiameterDalamCm`);
    console.log("Replaced DiameterDalamCm with DiameterDalamMm (values converted x10).");
  } else {
    throw new Error("Neither DiameterDalamCm nor DiameterDalamMm found -- unexpected schema state.");
  }

  // 3. Drop CekKontaminasi/CekKemasan (backup first)
  if (!(await columnExists(pool, "CekKontaminasi")) && !(await columnExists(pool, "CekKemasan"))) {
    console.log("CekKontaminasi/CekKemasan already gone -- skipping step 3.");
  } else {
    const backupResult = await pool.request().query(`SELECT KualitasID, CekKontaminasi, CekKemasan FROM ${TABLE}`);
    const scratchpad = path.join(process.cwd(), "scratchpad");
    fs.mkdirSync(scratchpad, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(scratchpad, `kualitas-kontaminasi-kemasan-backup-${stamp}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify({ capturedAt: new Date().toISOString(), rows: backupResult.recordset }, null, 2),
      "utf8"
    );
    const written = JSON.parse(fs.readFileSync(backupPath, "utf8")) as { rows: unknown[] };
    if (written.rows.length !== backupResult.recordset.length) {
      throw new Error("ABORT -- backup verification failed for CekKontaminasi/CekKemasan. Nothing dropped.");
    }
    console.log(`Backup written and verified: ${backupPath}`);
    if (await columnExists(pool, "CekKontaminasi")) await pool.request().query(`ALTER TABLE ${TABLE} DROP COLUMN CekKontaminasi`);
    if (await columnExists(pool, "CekKemasan")) await pool.request().query(`ALTER TABLE ${TABLE} DROP COLUMN CekKemasan`);
    console.log("Dropped CekKontaminasi/CekKemasan.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/revisi-kualitas-qty-diameter-drop-checks.ts`
Expected: three log lines confirming each change (or "already exists/gone"
on a re-run), a backup JSON path printed, process exits 0.

- [ ] **Step 3: Verify columns directly**

Run a quick ad-hoc check (any existing script that calls `getPool()` and
queries `INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'DashboardProduksiKualitas'`
works — or reuse the `columnExists` pattern above in a throwaway
`scratchpad/` script, deleted after). Expected: `Qty10KG`, `DiameterDalamMm`
present; `BeratSampel`, `DiameterDalamCm`, `CekKontaminasi`, `CekKemasan`
absent.

- [ ] **Step 4: Commit**

```bash
git add scripts/revisi-kualitas-qty-diameter-drop-checks.ts
git commit -m "feat: migrate DashboardProduksiKualitas to Qty10KG/DiameterDalamMm, drop Kontaminasi/Kemasan"
```

---

### Task 2: DB migration — Urutan column on Kehadiran

**Files:**
- Create: `scripts/add-urutan-to-aktivitas-kehadiran.ts`

**Interfaces:**
- Produces: `DashboardAktivitasProduksiKehadiran.Urutan INT NOT NULL
  DEFAULT 0` — consumed by Task 7 (`getSusunanTim`/`setSusunanTim`).

- [ ] **Step 1: Write the migration script**

```ts
// One-off schema migration -- DashboardAktivitasProduksiKehadiran gains a
// Urutan column (drag-reorder support for the redesigned per-shift roster
// -- see docs/superpowers/specs/2026-08-28-produksi-app-kualitas-aktivitas-revisi-design.md).
// Existing rows get Urutan = 0 (their old relative order was never
// meaningful -- the column simply didn't exist; real ordering starts the
// next time each shift's roster is saved through the new UI). Idempotent.
// Usage: npx tsx scripts/add-urutan-to-aktivitas-kehadiran.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardAktivitasProduksiKehadiran' AND COLUMN_NAME = 'Urutan'
  `);
  if (result.recordset.length === 0) {
    await pool.request().query(`ALTER TABLE DashboardAktivitasProduksiKehadiran ADD Urutan INT NOT NULL DEFAULT 0`);
    console.log("Added DashboardAktivitasProduksiKehadiran.Urutan.");
  } else {
    console.log("DashboardAktivitasProduksiKehadiran.Urutan already exists -- nothing to do.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run and verify**

Run: `npx tsx scripts/add-urutan-to-aktivitas-kehadiran.ts`
Expected: "Added..." on first run, "...already exists..." on a re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/add-urutan-to-aktivitas-kehadiran.ts
git commit -m "feat: add Urutan column to DashboardAktivitasProduksiKehadiran"
```

---

### Task 3: Backend — Kualitas query/action layer (Qty10KG, DiameterDalamMm, drop Kontaminasi/Kemasan)

**Files:**
- Modify: `src/lib/queries/produksi-kualitas.ts`
- Modify: `src/app/mkesindo/produksi/actions.ts` (only `createKualitasAction`
  and `getKualitasRiwayatAction` — other exports in this file are untouched
  by this task)

**Interfaces:**
- Consumes: Task 1's `Qty10KG`/`DiameterDalamMm` columns.
- Produces: `KualitasRow.Qty10KG: number | null`, `.DiameterDalamMm: number
  | null`, `.SisaAlokasi: number | null` (new field — `null` when
  `Qty10KG` itself is `null`, meaning "no ceiling"; otherwise `Qty10KG`
  minus everything already allocated to pallete via
  `DashboardProduksiBatch.KualitasID`). No more `BeratSampel`,
  `DiameterDalamCm`, `CekKontaminasi`, `CekKemasan` on `KualitasRow`/
  `CreateKualitasInput`. Consumed by Task 5 (form) and Task 6 (Tambah
  Produksi dialog's sisa-kuota display).

- [ ] **Step 1: Rewrite `produksi-kualitas.ts`**

Replace the entire file content with:

```ts
import { getPool, sql } from "@/lib/db";

// Pass/fail checklist a QC entry records (Kontaminasi/Kemasan were dropped
// entirely -- see the 2026-08-28 revisi spec), a QTY reading that doubles as
// this pemeriksaan's plafon stok (see DashboardProduksiBatch.KualitasID in
// produksi-warehouse.ts), a diameter reading, a free-text note, and one
// evidence photo -- the shared Tanggal/Waktu/Shift/Mesin fields mirror
// Tambah Produksi's own form exactly (same input types, same Shift/Mesin
// conventions), since this is the same "who recorded what, on which
// machine, during which shift" frame as every other produksi-app entry.
export interface KualitasRow {
  KualitasID: number;
  TanggalLabel: string;
  Waktu: string;
  Shift: 1 | 2 | 3;
  MesinID: number;
  MesinNama: string;
  CekKejernihan: boolean;
  CekUkuranBentuk: boolean;
  Qty10KG: number | null;
  DiameterDalamMm: number | null;
  Catatan: string | null;
  FotoPath: string | null;
  CreatedByUserID: string;
  CreatedDate: string;
  // Qty10KG minus SUM(DashboardProduksiBatch.Qty10KG) already allocated to
  // any pallete under this KualitasID (IsDeleted = 0) -- null when Qty10KG
  // itself is null (no ceiling to compute against, e.g. legacy rows).
  // Never negative (floored at 0) even if over-allocated somehow slipped
  // through before this check existed.
  SisaAlokasi: number | null;
}

// Most recent QC entries across all mesin -- a flat riwayat log, not
// filtered by business-date period like Kartu Pengiriman (a QC log is
// meant to be browsable further back without a Pengiriman/Riwayat-style
// split; capped instead, same reasoning as
// getSelesaiMuatJadwalForProduksi's own cap in produksi-muatan.ts).
export async function getKualitasRiwayat(limit = 50): Promise<KualitasRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit).query(`
      SELECT TOP (@limit) k.KualitasID, k.TanggalLabel, k.Waktu, k.Shift, k.MesinID, m.Nama AS MesinNama,
             k.CekKejernihan, k.CekUkuranBentuk, k.Qty10KG, k.DiameterDalamMm, k.Catatan, k.FotoPath,
             k.CreatedByUserID, k.CreatedDate,
             ISNULL(alok.TotalTeralokasi, 0) AS TotalTeralokasi
      FROM DashboardProduksiKualitas k
      LEFT JOIN DashboardProduksiMesin m ON m.MesinID = k.MesinID
      OUTER APPLY (
        SELECT SUM(b.Qty10KG) AS TotalTeralokasi
        FROM DashboardProduksiBatch b
        WHERE b.KualitasID = k.KualitasID AND b.IsDeleted = 0
      ) alok
      ORDER BY k.CreatedDate DESC
    `);
  return (
    result.recordset as (Omit<KualitasRow, "TanggalLabel" | "CreatedDate" | "SisaAlokasi"> & {
      TanggalLabel: Date;
      CreatedDate: Date;
      TotalTeralokasi: number;
    })[]
  ).map((r) => ({
    ...r,
    TanggalLabel: r.TanggalLabel.toISOString().slice(0, 10),
    CreatedDate: r.CreatedDate.toISOString(),
    SisaAlokasi: r.Qty10KG == null ? null : Math.max(0, r.Qty10KG - r.TotalTeralokasi),
  }));
}

export interface CreateKualitasInput {
  tanggalLabel: string;
  waktu: string;
  shift: 1 | 2 | 3;
  mesinId: number;
  cekKejernihan: boolean;
  cekUkuranBentuk: boolean;
  qty10KG: number;
  diameterDalamMm: number | null;
  catatan: string | null;
  fotoPath: string | null;
  dicatatOlehUserId: string;
}

export async function createKualitas(input: CreateKualitasInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("tanggalLabel", sql.Date, input.tanggalLabel)
    .input("waktu", sql.VarChar(5), input.waktu)
    .input("shift", sql.TinyInt, input.shift)
    .input("mesinId", sql.Int, input.mesinId)
    .input("cekKejernihan", sql.Bit, input.cekKejernihan)
    .input("cekUkuranBentuk", sql.Bit, input.cekUkuranBentuk)
    .input("qty10KG", sql.Int, input.qty10KG)
    .input("diameterDalamMm", sql.Decimal(5, 1), input.diameterDalamMm)
    .input("catatan", sql.NVarChar(500), input.catatan)
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("userId", sql.VarChar(16), input.dicatatOlehUserId).query(`
      INSERT INTO DashboardProduksiKualitas
        (TanggalLabel, Waktu, Shift, MesinID, CekKejernihan, CekUkuranBentuk, Qty10KG, DiameterDalamMm, Catatan, FotoPath, CreatedByUserID)
      OUTPUT INSERTED.KualitasID
      VALUES
        (@tanggalLabel, @waktu, @shift, @mesinId, @cekKejernihan, @cekUkuranBentuk, @qty10KG, @diameterDalamMm, @catatan, @fotoPath, @userId)
    `);
  return (result.recordset[0] as { KualitasID: number }).KualitasID;
}
```

- [ ] **Step 2: Update `createKualitasAction` in `actions.ts`**

Find (inside the existing import block near the top of the file):

```ts
import {
  getKualitasRiwayat,
  createKualitas,
  type KualitasRow,
  type CreateKualitasInput,
} from "@/lib/queries/produksi-kualitas";
```

Leave this import block exactly as-is (the same names still exist, just
with different fields on the types — no import path/name changes needed).

Find the `createKualitasAction` function and replace it with:

```ts
export async function createKualitasAction(
  input: Omit<CreateKualitasInput, "dicatatOlehUserId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!input.mesinId) throw new AppError("Pilih mesin yang dipakai.");
    if (!input.waktu) throw new AppError("Isi waktu pemeriksaan.");
    if (!input.qty10KG || input.qty10KG <= 0) throw new AppError("Isi QTY 10 KG Kantong Es.");
    const kualitasId = await createKualitas({ ...input, dicatatOlehUserId: session.user.id });
    revalidatePath("/mkesindo/produksi-app");
    return kualitasId;
  });
}
```

(Only the added `qty10KG` validation line changed — everything else in
this function is identical to before.)

- [ ] **Step 3: Verify no other file still references the removed fields**

Run: `npx tsc --noEmit`
Expected: errors in every file still using `beratSampel`/`diameterDalam`/
`cekKontaminasi`/`cekKemasan` — these are exactly the files Tasks 4-6 fix
next. Confirm the error list matches
`kualitas-view.tsx`/`tambah-produksi-dialog.tsx`/`produksi-warehouse.ts`
and nothing unexpected.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/produksi-kualitas.ts src/app/mkesindo/produksi/actions.ts
git commit -m "feat: Kualitas query/action layer uses Qty10KG/DiameterDalamMm, drops Kontaminasi/Kemasan"
```

---

### Task 4: Backend — plafon stok check in `createBatch`

**Files:**
- Modify: `src/lib/queries/produksi-warehouse.ts`

**Interfaces:**
- Consumes: `DashboardProduksiKualitas.Qty10KG` (Task 1/3).
- Produces: `createBatch` now rejects (via `AppError`) when the requested
  allocation would push a Kualitas record's total allocated `Qty10KG`
  (across all its batches) past its own `Qty10KG`. Consumed by Task 6
  (client-side dialog shows the same ceiling pre-emptively, but this is
  the actual enforcement).

- [ ] **Step 1: Add the check inside `createBatch`'s existing transaction**

The function already reads the Kualitas record's `MesinID`/`TanggalLabel`/
`Shift`/`Waktu` for the batch insert. Extend that same read and add a new
check right after the existing pallete-capacity check (both run inside the
same transaction, before `commit()`).

Find:

```ts
    const kualitasResult = await new sql.Request(transaction)
      .input("kualitasId", sql.Int, input.kualitasId)
      .query(`SELECT MesinID, TanggalLabel, Shift, Waktu FROM DashboardProduksiKualitas WHERE KualitasID = @kualitasId`);
    const kualitas = kualitasResult.recordset[0] as
      | { MesinID: number; TanggalLabel: Date; Shift: number; Waktu: string }
      | undefined;
    if (!kualitas) throw new AppError("Pemeriksaan Kualitas yang dipilih tidak ditemukan.");
```

Replace with:

```ts
    const kualitasResult = await new sql.Request(transaction)
      .input("kualitasId", sql.Int, input.kualitasId)
      .query(`SELECT MesinID, TanggalLabel, Shift, Waktu, Qty10KG FROM DashboardProduksiKualitas WHERE KualitasID = @kualitasId`);
    const kualitas = kualitasResult.recordset[0] as
      | { MesinID: number; TanggalLabel: Date; Shift: number; Waktu: string; Qty10KG: number | null }
      | undefined;
    if (!kualitas) throw new AppError("Pemeriksaan Kualitas yang dipilih tidak ditemukan.");
```

Find the existing pallete-capacity check block (the one throwing
`"Kapasitas pallet ini penuh..."`) and add the new plafon check
immediately after it, still before `await transaction.commit();`:

```ts
    // Plafon stok: total Qty10KG yang sudah dialokasikan ke pallete manapun
    // di bawah Kualitas ini (baris yang baru diinsert di atas sudah ikut
    // terhitung) tidak boleh melebihi Qty10KG milik Kualitas itu sendiri.
    // Qty10KG null (baris Kualitas lama, sebelum field ini ada) berarti
    // tidak ada plafon -- dilewati sepenuhnya, sama seperti sebelum
    // pengecekan ini ada.
    if (kualitas.Qty10KG != null) {
      const alokasiCheck = await new sql.Request(transaction)
        .input("kualitasId", sql.Int, input.kualitasId)
        .query(`
          SELECT ISNULL(SUM(Qty10KG), 0) AS TotalTeralokasi
          FROM DashboardProduksiBatch
          WHERE KualitasID = @kualitasId AND IsDeleted = 0
        `);
      const totalTeralokasi = alokasiCheck.recordset[0].TotalTeralokasi as number;
      if (totalTeralokasi > kualitas.Qty10KG) {
        const sebelumnya = totalTeralokasi - input.qty10KG;
        throw new AppError(
          `Melebihi qty produksi tercatat pada pemeriksaan ini (tercatat ${kualitas.Qty10KG} kantong, sudah dialokasikan ${sebelumnya}, sisa ${Math.max(0, kualitas.Qty10KG - sebelumnya)}).`
        );
      }
    }
```

(Placed after the pallete-capacity check, matching that check's own
"insert speculatively, verify inside the same transaction, rollback on
violation" reasoning — see that block's existing comment for why no extra
row lock is needed here beyond the posisi-row lock already taken earlier
in this function.)

- [ ] **Step 2: Verify with `tsc`**

Run: `npx tsc --noEmit`
Expected: no new errors from this file (the `Qty10KG` field now exists on
`KualitasRow`'s source table per Task 1, and this query selects it by
column name directly, not through the `KualitasRow` type).

- [ ] **Step 3: Manual verification**

Using the Browser pane against `/mkesindo/produksi-app`: create a Kualitas
entry with QTY 10KG = 5 (small number for a fast test), allocate 3 to one
pallete (should succeed), then try to allocate 3 more to a different
pallete (should be rejected with the new message, since only 2 remain).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/produksi-warehouse.ts
git commit -m "feat: enforce Kualitas QTY as an allocation ceiling in createBatch"
```

---

### Task 5: Frontend — Kualitas form & card (`kualitas-view.tsx`)

**Files:**
- Modify: `src/components/produksi-app/kualitas-view.tsx`

**Interfaces:**
- Consumes: `KualitasRow`/`CreateKualitasInput` from Task 3.

- [ ] **Step 1: Remove the now-nonexistent Kontaminasi/Kemasan handling**

Find (near the top, the `CHECKLIST_ITEMS` comment block already only
lists Kejernihan/UkuranBentuk — no `CHECKLIST_ITEMS` array change is
needed). Find inside `handleSubmit`:

```ts
        cekKejernihan: checklist.cekKejernihan,
        cekUkuranBentuk: checklist.cekUkuranBentuk,
        // Dropped from the form (see CHECKLIST_ITEMS's own comment) — always
        // true going forward, historical entries keep their real value.
        cekKontaminasi: true,
        cekKemasan: true,
        diameterDalam: diameterDalam.trim() ? Number(diameterDalam) : null,
        beratSampel: beratSampel.trim() ? Number(beratSampel) : null,
```

Replace with:

```ts
        cekKejernihan: checklist.cekKejernihan,
        cekUkuranBentuk: checklist.cekUkuranBentuk,
        diameterDalamMm: diameterDalamMm.trim() ? Number(diameterDalamMm) : null,
        qty10KG: Number(qty10KG) || 0,
```

- [ ] **Step 2: Rename state and add QTY validation**

Find:

```ts
  const [diameterDalam, setDiameterDalam] = useState("");
  const [beratSampel, setBeratSampel] = useState("");
```

Replace with:

```ts
  const [diameterDalamMm, setDiameterDalamMm] = useState("");
  const [qty10KG, setQty10KG] = useState("");
```

Find (inside `reset()`):

```ts
    setDiameterDalam("");
    setBeratSampel("");
```

Replace with:

```ts
    setDiameterDalamMm("");
    setQty10KG("");
```

Find (inside `handleSubmit`, the existing validation block before
`startTransition`):

```ts
    if (!waktu) {
      setError("Isi waktu pemeriksaan.");
      return;
    }
```

Replace with:

```ts
    if (!waktu) {
      setError("Isi waktu pemeriksaan.");
      return;
    }
    if (!qty10KG.trim() || Number(qty10KG) <= 0) {
      setError("Isi QTY 10 KG Kantong Es.");
      return;
    }
```

- [ ] **Step 3: Replace the two number inputs**

Find:

```tsx
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Ukuran Diameter Dalam (cm)</label>
              <Input
                type="number"
                step="0.1"
                value={diameterDalam}
                onChange={(e) => setDiameterDalam(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Berat Sampel (gram)</label>
              <Input type="number" step="0.1" value={beratSampel} onChange={(e) => setBeratSampel(e.target.value)} className="mt-1" />
            </div>
          </div>
```

Replace with:

```tsx
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Ukuran Diameter Dalam (mm)</label>
              <Input
                type="number"
                step="0.1"
                value={diameterDalamMm}
                onChange={(e) => setDiameterDalamMm(e.target.value)}
                placeholder="Standar: 28mm"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">QTY 10 KG Kantong Es</label>
              <Input
                type="number"
                step="1"
                min="0"
                value={qty10KG}
                onChange={(e) => setQty10KG(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
```

- [ ] **Step 4: Update `KualitasCard`**

Find:

```tsx
function KualitasCard({ kualitas }: { kualitas: KualitasRow }) {
  const items = [
    { label: "Kejernihan", pass: kualitas.CekKejernihan },
    { label: "Ukuran/Bentuk", pass: kualitas.CekUkuranBentuk },
    { label: "Kontaminasi", pass: kualitas.CekKontaminasi },
    { label: "Kemasan", pass: kualitas.CekKemasan },
  ];
```

Replace with:

```tsx
function KualitasCard({ kualitas }: { kualitas: KualitasRow }) {
  const items = [
    { label: "Kejernihan", pass: kualitas.CekKejernihan },
    { label: "Ukuran/Bentuk", pass: kualitas.CekUkuranBentuk },
  ];
```

Find:

```tsx
      {(kualitas.DiameterDalamCm != null || kualitas.BeratSampel != null) && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {kualitas.DiameterDalamCm != null && `Diameter dalam: ${kualitas.DiameterDalamCm}cm`}
          {kualitas.DiameterDalamCm != null && kualitas.BeratSampel != null && " • "}
          {kualitas.BeratSampel != null && `Berat sampel: ${kualitas.BeratSampel}g`}
        </p>
      )}
```

Replace with:

```tsx
      {(kualitas.DiameterDalamMm != null || kualitas.Qty10KG != null) && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {kualitas.DiameterDalamMm != null && `Diameter dalam: ${kualitas.DiameterDalamMm}mm`}
          {kualitas.DiameterDalamMm != null && kualitas.Qty10KG != null && " • "}
          {kualitas.Qty10KG != null && `QTY: ${kualitas.Qty10KG} kantong 10kg (sisa ${kualitas.SisaAlokasi})`}
        </p>
      )}
```

- [ ] **Step 5: Verify with `tsc` and `eslint`**

Run: `npx tsc --noEmit && npx eslint src/components/produksi-app/kualitas-view.tsx`
Expected: both clean.

- [ ] **Step 6: Manual verification**

Browser pane, `/mkesindo/produksi-app` Kualitas tab: create an entry,
confirm the form shows "QTY 10 KG Kantong Es" (not "Berat Sampel"),
diameter in mm with the "Standar: 28mm" placeholder, and the saved card
shows no Kontaminasi/Kemasan badges and the new QTY/sisa line.

- [ ] **Step 7: Commit**

```bash
git add src/components/produksi-app/kualitas-view.tsx
git commit -m "feat: Kualitas form collects QTY 10KG and mm diameter, drops Kontaminasi/Kemasan"
```

---

### Task 6: Frontend — Tambah Produksi dialog shows sisa kuota

**Files:**
- Modify: `src/components/produksi-app/tambah-produksi-dialog.tsx`

**Interfaces:**
- Consumes: `KualitasRow.SisaAlokasi`/`Qty10KG` (Task 3).

- [ ] **Step 1: Fix `allPass` and add sisa-kuota display**

Find:

```tsx
                  const allPass = k.CekKejernihan && k.CekUkuranBentuk && k.CekKontaminasi && k.CekKemasan;
```

Replace with:

```tsx
                  const allPass = k.CekKejernihan && k.CekUkuranBentuk;
                  const habis = k.SisaAlokasi != null && k.SisaAlokasi <= 0;
```

Find:

```tsx
                    <button
                      key={k.KualitasID}
                      type="button"
                      onClick={() => setKualitasId(String(k.KualitasID))}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border p-2 text-left text-xs transition-colors",
                        "border-border hover:bg-muted/50",
                        active && "border-primary bg-primary/10"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{k.MesinNama}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {new Date(k.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                          {" • "}
                          {k.Waktu}
                          {" • "}
                          {SHIFT_LABEL[k.Shift]}
                        </p>
                      </div>
                      {!allPass && (
                        <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          Ada temuan
                        </span>
                      )}
                    </button>
```

Replace with:

```tsx
                    <button
                      key={k.KualitasID}
                      type="button"
                      disabled={habis}
                      onClick={() => setKualitasId(String(k.KualitasID))}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border p-2 text-left text-xs transition-colors",
                        habis ? "cursor-not-allowed border-border bg-muted/40 opacity-50" : "border-border hover:bg-muted/50",
                        active && !habis && "border-primary bg-primary/10"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{k.MesinNama}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {new Date(k.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                          {" • "}
                          {k.Waktu}
                          {" • "}
                          {SHIFT_LABEL[k.Shift]}
                        </p>
                        {k.SisaAlokasi != null && (
                          <p className="text-[11px] text-muted-foreground">Sisa {k.SisaAlokasi} kantong</p>
                        )}
                      </div>
                      {!allPass && (
                        <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          Ada temuan
                        </span>
                      )}
                    </button>
```

- [ ] **Step 2: Cap the qty10 input by the selected Kualitas's sisa kuota**

Find:

```ts
  const sisaKapasitas = posisi ? KAPASITAS_PALLET_10KG - posisi.TotalSisaQty10KG : KAPASITAS_PALLET_10KG;
```

Replace with:

```ts
  const sisaKapasitas = posisi ? KAPASITAS_PALLET_10KG - posisi.TotalSisaQty10KG : KAPASITAS_PALLET_10KG;
  const selectedKualitas = kualitasList?.find((k) => String(k.KualitasID) === kualitasId) ?? null;
  const sisaMax =
    selectedKualitas?.SisaAlokasi != null ? Math.min(sisaKapasitas, selectedKualitas.SisaAlokasi) : sisaKapasitas;
```

Find (inside `handleSubmit`):

```ts
    if (qty10Num > sisaKapasitas) {
      setError(`Melebihi sisa kapasitas pallet ini (sisa ${sisaKapasitas} kantong).`);
      return;
    }
```

Replace with:

```ts
    if (qty10Num > sisaMax) {
      setError(
        selectedKualitas?.SisaAlokasi != null && selectedKualitas.SisaAlokasi < sisaKapasitas
          ? `Melebihi sisa kuota Kualitas ini (sisa ${sisaMax} kantong).`
          : `Melebihi sisa kapasitas pallet ini (sisa ${sisaMax} kantong).`
      );
      return;
    }
```

Find the `qty10` `<Input>`:

```tsx
              <Input
                type="number"
                value={qty10}
                onChange={(e) => setQty10(e.target.value)}
                className="pr-12"
              />
```

Replace with:

```tsx
              <Input
                type="number"
                max={sisaMax}
                value={qty10}
                onChange={(e) => setQty10(e.target.value)}
                className="pr-12"
              />
```

- [ ] **Step 3: Verify with `tsc` and `eslint`**

Run: `npx tsc --noEmit && npx eslint src/components/produksi-app/tambah-produksi-dialog.tsx`
Expected: both clean.

- [ ] **Step 4: Manual verification**

Repeat Task 4's manual check through this exact dialog (not a raw action
call): confirm the Kualitas picker shows "Sisa N kantong", greys out once
exhausted, and the qty input's client-side error matches the server's.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi-app/tambah-produksi-dialog.tsx
git commit -m "feat: Tambah Produksi dialog shows and enforces Kualitas sisa kuota"
```

---

### Task 7: Backend — Tim Produksi CRUD + susunan-tim rename

**Files:**
- Modify: `src/lib/queries/tim-produksi.ts`
- Modify: `src/lib/queries/aktivitas-produksi.ts`
- Modify: `src/app/mkesindo/produksi/actions.ts`

**Interfaces:**
- Produces: `updateAnggotaTim(anggotaId, {nama, shift})`,
  `getSemuaAnggotaTim()` (all 3 teams' active members) — consumed by
  Task 9 (roster's cross-team dropdown) and Task 11 (admin section).
  `getSusunanTim`/`setSusunanTim` replacing `getKehadiran`/`setKehadiran`,
  returning `SusunanTimRow[]` (`{anggotaId, nama, urutan}`) instead of
  `number[]` — consumed by Task 9/10.

- [ ] **Step 1: Add `updateAnggotaTim`/`getSemuaAnggotaTim` to `tim-produksi.ts`**

Append to the end of the file:

```ts
// All 3 teams' active rosters combined, for the cross-team "tambah dari
// tim lain" dropdown on the per-shift roster (tim-produksi-roster.tsx) and
// the admin management section on /mkesindo/produksi.
export async function getSemuaAnggotaTim(): Promise<AnggotaTimRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT AnggotaID, Shift, Nama FROM DashboardTimProduksiAnggota
    WHERE IsDeleted = 0
    ORDER BY Shift, Nama
  `);
  return (result.recordset as { AnggotaID: number; Shift: number; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    shift: r.Shift as 1 | 2 | 3,
    nama: r.Nama,
  }));
}

// Edits a member's name and/or which permanent team (Shift) they belong
// to -- used by the new admin management section only. Does not touch any
// past shift's already-saved susunan tim (DashboardAktivitasProduksiKehadiran
// rows reference AnggotaID directly, independent of this table's own Shift
// column, so a past roster entry keeps showing the name/team that was true
// at the time -- acceptable, matches how every other historical-name
// lookup in this app already behaves, e.g. DicatatOlehNama).
export async function updateAnggotaTim(anggotaId: number, input: { nama: string; shift: 1 | 2 | 3 }): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .input("nama", sql.VarChar(100), input.nama)
    .input("shift", sql.TinyInt, input.shift)
    .query(`UPDATE DashboardTimProduksiAnggota SET Nama = @nama, Shift = @shift, ModifiedDate = GETDATE() WHERE AnggotaID = @anggotaId`);
}
```

- [ ] **Step 2: Replace `getKehadiran`/`setKehadiran` in `aktivitas-produksi.ts`**

Find:

```ts
export async function getKehadiran(tanggalUsaha: string, shift: ShiftNumber): Promise<number[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`
      SELECT kh.AnggotaID FROM DashboardAktivitasProduksiKehadiran kh
      JOIN DashboardAktivitasProduksiShift a ON a.AktivitasID = kh.AktivitasID
      WHERE a.TanggalUsaha = @t AND a.Shift = @s
    `);
  return (result.recordset as { AnggotaID: number }[]).map((r) => r.AnggotaID);
}

// Replaces the whole attendance list for this shift (delete then
// re-insert) rather than diffing — the UI always submits the complete
// checked set, never an incremental add/remove.
export async function setKehadiran(tanggalUsaha: string, shift: ShiftNumber, anggotaIds: number[], akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).input("aktivitasId", sql.Int, aktivitasId).query(`
      DELETE FROM DashboardAktivitasProduksiKehadiran WHERE AktivitasID = @aktivitasId
    `);
    for (const anggotaId of anggotaIds) {
      await new sql.Request(transaction)
        .input("aktivitasId", sql.Int, aktivitasId)
        .input("anggotaId", sql.Int, anggotaId)
        .query(`INSERT INTO DashboardAktivitasProduksiKehadiran (AktivitasID, AnggotaID) VALUES (@aktivitasId, @anggotaId)`);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

Replace with:

```ts
export interface SusunanTimRow {
  anggotaId: number;
  nama: string;
  urutan: number;
}

// Who's actually on duty for this ONE (tanggalUsaha, shift) occurrence --
// independent of DashboardTimProduksiAnggota's permanent team membership
// (see getAnggotaTim in tim-produksi.ts). Distinguishes "never saved" (no
// DashboardAktivitasProduksiShift row at all -- falls back to this shift's
// own permanent team as a starting point, NOT written to DB yet) from
// "saved with nobody in it" (a real, empty, already-persisted roster) by
// checking for the Shift row's existence first, not by whether the
// Kehadiran query comes back empty.
export async function getSusunanTim(tanggalUsaha: string, shift: ShiftNumber): Promise<SusunanTimRow[]> {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT AktivitasID FROM DashboardAktivitasProduksiShift WHERE TanggalUsaha = @t AND Shift = @s`);
  const aktivitasId = (existing.recordset[0] as { AktivitasID: number } | undefined)?.AktivitasID;

  if (aktivitasId == null) {
    const timTetap = await getAnggotaTim(shift);
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

// Replaces the whole susunan tim for this shift (delete then re-insert)
// rather than diffing -- the UI always submits the complete ordered list,
// never an incremental add/remove/reorder. Urutan = the array's own index,
// so callers encode order purely by array position.
export async function setSusunanTim(tanggalUsaha: string, shift: ShiftNumber, anggotaIds: number[], akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).input("aktivitasId", sql.Int, aktivitasId).query(`
      DELETE FROM DashboardAktivitasProduksiKehadiran WHERE AktivitasID = @aktivitasId
    `);
    for (let i = 0; i < anggotaIds.length; i++) {
      await new sql.Request(transaction)
        .input("aktivitasId", sql.Int, aktivitasId)
        .input("anggotaId", sql.Int, anggotaIds[i])
        .input("urutan", sql.Int, i)
        .query(`INSERT INTO DashboardAktivitasProduksiKehadiran (AktivitasID, AnggotaID, Urutan) VALUES (@aktivitasId, @anggotaId, @urutan)`);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

Add `getAnggotaTim` to this file's imports (it currently has none from
`tim-produksi.ts` — `aktivitas-produksi.ts` only computes `AktivitasShiftInfo`
etc. today). Find the top of the file:

```ts
import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";
```

Replace with:

```ts
import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";
import { getAnggotaTim } from "@/lib/queries/tim-produksi";
```

- [ ] **Step 3: Staf Operasional auto-assign (fold into this task's `ensureAktivitasRow` edit)**

Find:

```ts
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("stokEs", sql.Int, stokEs)
    .input("akunId", sql.Int, akunId)
    .query(`
      INSERT INTO DashboardAktivitasProduksiShift (TanggalUsaha, Shift, ShiftMulai, StokEsSebelumnya10KG, CreatedByAkunID)
      OUTPUT INSERTED.AktivitasID
      VALUES (@t, @s, @shiftMulai, @stokEs, @akunId)
    `);
```

Replace with:

```ts
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("stokEs", sql.Int, stokEs)
    .input("akunId", sql.Int, akunId)
    .query(`
      INSERT INTO DashboardAktivitasProduksiShift (TanggalUsaha, Shift, ShiftMulai, StokEsSebelumnya10KG, CreatedByAkunID, StafOperasionalAkunID)
      OUTPUT INSERTED.AktivitasID
      VALUES (@t, @s, @shiftMulai, @stokEs, @akunId, @akunId)
    `);
```

(The akun that triggers this shift's very first write — whichever action
runs first: Kerusakan, susunan tim, mesin event, or Staf Operasional
itself — is automatically recorded as Staf Operasional Bertugas. See this
task's spec Bagian 4: never overwritten afterward by this automatic path,
since `ensureAktivitasRow` only INSERTs once and returns the existing
`AktivitasID` on every later call.)

- [ ] **Step 4: Wire up `actions.ts`**

Find the `tim-produksi` import:

```ts
import { getAnggotaTim, tambahAnggotaTim, hapusAnggotaTim, type AnggotaTimRow } from "@/lib/queries/tim-produksi";
```

Replace with:

```ts
import {
  getAnggotaTim,
  getSemuaAnggotaTim,
  tambahAnggotaTim,
  updateAnggotaTim,
  hapusAnggotaTim,
  type AnggotaTimRow,
} from "@/lib/queries/tim-produksi";
```

Find the `aktivitas-produksi` import:

```ts
import {
  getCurrentShift,
  getAktivitasForShift,
  getAktivitasRiwayat,
  upsertStafOperasional,
  upsertKerusakan,
  getKehadiran,
  setKehadiran,
  getQtyRecapForShift,
  type AktivitasShiftInfo,
  type QtyRecap,
  type KerusakanInput,
} from "@/lib/queries/aktivitas-produksi";
```

Replace with:

```ts
import {
  getCurrentShift,
  getAktivitasForShift,
  getAktivitasRiwayat,
  upsertStafOperasional,
  upsertKerusakan,
  getSusunanTim,
  setSusunanTim,
  getQtyRecapForShift,
  type AktivitasShiftInfo,
  type QtyRecap,
  type KerusakanInput,
  type SusunanTimRow,
} from "@/lib/queries/aktivitas-produksi";
```

Find `getAnggotaTimAction`/`tambahAnggotaTimAction`/`hapusAnggotaTimAction`
and add two new actions right after `getAnggotaTimAction`:

```ts
export async function getAnggotaTimAction(shift: ShiftNumber): Promise<ActionResult<AnggotaTimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getAnggotaTim(shift);
  });
}

export async function getSemuaAnggotaTimAction(): Promise<ActionResult<AnggotaTimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getSemuaAnggotaTim();
  });
}

export async function updateAnggotaTimAction(anggotaId: number, input: { nama: string; shift: ShiftNumber }): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!input.nama.trim()) throw new AppError("Nama anggota tidak boleh kosong.");
    await updateAnggotaTim(anggotaId, { nama: input.nama.trim(), shift: input.shift });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
  });
}
```

Find every occurrence of `getKehadiran(tanggalUsaha, shift)` (there are
two — inside `getCurrentAktivitasProduksiAction` and
`getAktivitasDetailAction`) and replace with `getSusunanTim(tanggalUsaha,
shift)`. Update both functions' return type annotations from
`kehadiran: number[]` to `susunanTim: SusunanTimRow[]`, and their
destructuring from `kehadiran` to `susunanTim` accordingly. For example,
find:

```ts
export async function getCurrentAktivitasProduksiAction(): Promise<
  ActionResult<{ current: AktivitasShiftInfo; qty: QtyRecap; kehadiran: number[]; timAnggota: AnggotaTimRow[] }>
> {
  return runAction(async () => {
    await requireProduksiView();
    const { tanggalUsaha, shift } = getCurrentShift();
    const [current, qty, kehadiran, timAnggota] = await Promise.all([
      getAktivitasForShift(tanggalUsaha, shift),
      getQtyRecapForShift(tanggalUsaha, shift),
      getKehadiran(tanggalUsaha, shift),
      getAnggotaTim(shift),
    ]);
    return { current, qty, kehadiran, timAnggota };
  });
}
```

Replace with:

```ts
export async function getCurrentAktivitasProduksiAction(): Promise<
  ActionResult<{ current: AktivitasShiftInfo; qty: QtyRecap; susunanTim: SusunanTimRow[] }>
> {
  return runAction(async () => {
    await requireProduksiView();
    const { tanggalUsaha, shift } = getCurrentShift();
    const [current, qty, susunanTim] = await Promise.all([
      getAktivitasForShift(tanggalUsaha, shift),
      getQtyRecapForShift(tanggalUsaha, shift),
      getSusunanTim(tanggalUsaha, shift),
    ]);
    return { current, qty, susunanTim };
  });
}
```

(`timAnggota`/`getAnggotaTim(shift)` is dropped from this action's return
value entirely — Task 9/10 no longer need the permanent-team list at this
call site, since `susunanTim` already carries names directly and the
cross-team dropdown fetches `getSemuaAnggotaTimAction()` separately, only
when the dropdown is opened.)

Apply the exact same transformation to `getAktivitasDetailAction` (same
shape, same two functions being called, same return type).

Both actions also need to resolve the Staf Operasional's display name
server-side (consumed by Task 8 — the live view no longer has a
`stafOperasionalOptions`-based picker to derive it from client-side, and
resolving it once here avoids duplicating the lookup in both the
Server Component page and this action). Add `stafOperasionalNama: string
| null` to both actions' return type and body. For
`getCurrentAktivitasProduksiAction`:

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
      stafOperasionalNama: current.stafOperasionalAkunId != null ? (namaMap.get(current.stafOperasionalAkunId) ?? null) : null,
    };
  });
}
```

(`getAkunNamaMap` is already imported at the top of `actions.ts` — used
by `getRiwayatProduksiAction` — no new import needed.) Apply the exact
same body change to `getAktivitasDetailAction` (same return type
addition, same `stafOperasionalNama` resolution, using that function's
own already-fetched `current`).

Find:

```ts
export async function setKehadiranAction(tanggalUsaha: string, shift: ShiftNumber, anggotaIds: number[]): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setKehadiran(tanggalUsaha, shift, anggotaIds, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}
```

Replace with:

```ts
export async function setSusunanTimAction(tanggalUsaha: string, shift: ShiftNumber, anggotaIds: number[]): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setSusunanTim(tanggalUsaha, shift, anggotaIds, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}
```

- [ ] **Step 5: Verify with `tsc`**

Run: `npx tsc --noEmit`
Expected: errors in the 3 client components still calling the old names
(`tim-produksi-roster.tsx`, `aktivitas-produksi-view.tsx`,
`riwayat-aktivitas-produksi.tsx`) — fixed in Tasks 9/10. No errors should
remain in the 3 files this task touched.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/tim-produksi.ts src/lib/queries/aktivitas-produksi.ts src/app/mkesindo/produksi/actions.ts
git commit -m "feat: susunan-tim backend (ordered, cross-team) + Tim Produksi CRUD + auto Staf Operasional"
```

---

### Task 8: Frontend — Staf Operasional read-only on the live shift view

**Files:**
- Modify: `src/components/produksi-app/aktivitas-produksi-view.tsx`
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx` — this is
  the actual state owner and prop-passer for the live Aktivitas tab (the
  "keep-alive tab shell" — tabs stay mounted client-side, each owns its
  own fetched state); `aktivitas-produksi/page.tsx` only supplies the
  FIRST-LOAD snapshot as `initialAktivitasProduksi`, every refresh after
  that goes through this shell's own `getCurrentAktivitasProduksiAction()`
  call.
- Modify: `src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx`

**Interfaces:**
- Consumes: `AktivitasShiftInfo.stafOperasionalAkunId` (unchanged shape —
  now populated automatically per Task 7 Step 3), `SusunanTimRow[]` and
  `stafOperasionalNama` from Task 7's updated actions/queries.
- Produces: `AktivitasProduksiView` gains a `stafOperasionalNama: string |
  null` prop and a `susunanTim: SusunanTimRow[]` prop, replacing
  `kehadiran`/`timAnggota`. `StafOperasionalSelect` stays exported (still
  used by `riwayat-aktivitas-produksi.tsx`, Task 9) but is no longer used
  inside `AktivitasProduksiView` itself.

- [ ] **Step 1: Replace the live-view Staf Operasional card**

Find:

```tsx
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Staf Operasional Bertugas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <StafOperasionalSelect
            tanggalUsaha={current.tanggalUsaha}
            shift={current.shift}
            stafOperasionalAkunId={current.stafOperasionalAkunId}
            stafOperasionalOptions={stafOperasionalOptions}
            onChanged={onChanged}
          />
          <p className="text-xs text-muted-foreground">
            Stok Es Sebelumnya (10KG): <span className="font-medium text-foreground">{current.stokEsSebelumnya10KG.toLocaleString("id-ID")}</span>
          </p>
        </CardContent>
      </Card>
```

Replace with:

```tsx
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
```

- [ ] **Step 2: Update the component's props**

Find:

```tsx
export function AktivitasProduksiView({
  current,
  qty,
  kehadiran,
  timAnggota,
  mesinList,
  mesinEvents,
  stafOperasionalOptions,
  riwayat,
  onChanged,
}: {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  kehadiran: number[];
  timAnggota: AnggotaTimRow[];
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  stafOperasionalOptions: StafOperasionalOption[];
  riwayat: AktivitasShiftInfo[];
  onChanged: () => void;
}) {
```

Replace with:

```tsx
export function AktivitasProduksiView({
  current,
  qty,
  susunanTim,
  stafOperasionalNama,
  mesinList,
  mesinEvents,
  stafOperasionalOptions,
  riwayat,
  onChanged,
}: {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  susunanTim: SusunanTimRow[];
  // Resolved by the caller (page.tsx) via getAkunNamaMap — null only for a
  // shift that has genuinely never had any activity recorded yet.
  stafOperasionalNama: string | null;
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  // Still needed here — passed through unchanged to RiwayatAktivitasProduksi
  // below, whose own "Ubah Aktivitas" dialog keeps the manual picker for
  // correcting past shifts (see riwayat-aktivitas-produksi.tsx, untouched
  // by this plan).
  stafOperasionalOptions: StafOperasionalOption[];
  riwayat: AktivitasShiftInfo[];
  onChanged: () => void;
}) {
```

Find:

```tsx
      <TimProduksiRoster tanggalUsaha={current.tanggalUsaha} shift={current.shift} timAnggota={timAnggota} kehadiran={kehadiran} canEdit onChanged={onChanged} />
      <MesinEventPanel mesinList={mesinList} events={mesinEvents} onChanged={onChanged} />
      <QtyRecapCard qty={qty} jumlahHadir={kehadiran.length} />
```

Replace with:

```tsx
      <TimProduksiRoster tanggalUsaha={current.tanggalUsaha} shift={current.shift} susunanTim={susunanTim} canEdit onChanged={onChanged} />
      <MesinEventPanel mesinList={mesinList} events={mesinEvents} onChanged={onChanged} />
      <QtyRecapCard qty={qty} jumlahHadir={susunanTim.length} />
```

- [ ] **Step 3: Update `produksi-tab-shell.tsx`'s types and prop-passing**

Find:

```ts
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
```

Replace with:

```ts
import type { SusunanTimRow } from "@/lib/queries/aktivitas-produksi";
```

(`AnggotaTimRow` is no longer referenced anywhere in this file once the
change below lands — this import is a straight swap, not an addition.)

Find:

```ts
  initialAktivitasProduksi?: {
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    kehadiran: number[];
    timAnggota: AnggotaTimRow[];
    mesinList: MesinRow[];
    mesinEvents: MesinEventRow[];
    stafOperasionalOptions: StafOperasionalOption[];
    riwayat: AktivitasShiftInfo[];
  };
```

Replace with:

```ts
  initialAktivitasProduksi?: {
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    susunanTim: SusunanTimRow[];
    stafOperasionalNama: string | null;
    mesinList: MesinRow[];
    mesinEvents: MesinEventRow[];
    stafOperasionalOptions: StafOperasionalOption[];
    riwayat: AktivitasShiftInfo[];
  };
```

The `useEffect`'s refresh branch (`setAktivitasProduksi({
...aktivitasResult.data, mesinList: ..., mesinEvents: ...,
stafOperasionalOptions: ..., riwayat: ... })`) needs NO change — spreading
`aktivitasResult.data` already carries `susunanTim`/`stafOperasionalNama`
through automatically once Task 7 Step 4's action change lands, since
this line doesn't name `kehadiran`/`timAnggota` explicitly anywhere.

Find:

```tsx
            <AktivitasProduksiView
              current={aktivitasProduksi.current}
              qty={aktivitasProduksi.qty}
              kehadiran={aktivitasProduksi.kehadiran}
              timAnggota={aktivitasProduksi.timAnggota}
              mesinList={aktivitasProduksi.mesinList}
              mesinEvents={aktivitasProduksi.mesinEvents}
              stafOperasionalOptions={aktivitasProduksi.stafOperasionalOptions}
              riwayat={aktivitasProduksi.riwayat}
              onChanged={refreshAktivitasProduksi}
            />
```

Replace with:

```tsx
            <AktivitasProduksiView
              current={aktivitasProduksi.current}
              qty={aktivitasProduksi.qty}
              susunanTim={aktivitasProduksi.susunanTim}
              stafOperasionalNama={aktivitasProduksi.stafOperasionalNama}
              mesinList={aktivitasProduksi.mesinList}
              mesinEvents={aktivitasProduksi.mesinEvents}
              stafOperasionalOptions={aktivitasProduksi.stafOperasionalOptions}
              riwayat={aktivitasProduksi.riwayat}
              onChanged={refreshAktivitasProduksi}
            />
```

- [ ] **Step 4: Update `aktivitas-produksi/page.tsx`**

Replace the entire file content with:

```tsx
import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getUserById, getAkunNamaMap, getStafOperasionalOptions } from "@/lib/queries/akun";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getMesinEventsForShift } from "@/lib/queries/produksi-mesin-event";
import { getCurrentShift, getAktivitasForShift, getQtyRecapForShift, getSusunanTim, getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Aktivitas Produksi" };

export default async function ProduksiAppAktivitasProduksiPage() {
  const session = await requireProduksi();
  const { tanggalUsaha, shift } = getCurrentShift();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);

  const [profile, current, qty, susunanTim, mesinList, mesinEvents, stafOperasionalOptions, riwayat] = await Promise.all([
    getUserById(Number(session.user.id)),
    getAktivitasForShift(tanggalUsaha, shift),
    getQtyRecapForShift(tanggalUsaha, shift),
    getSusunanTim(tanggalUsaha, shift),
    getMesinList(),
    getMesinEventsForShift(businessDate, shift),
    getStafOperasionalOptions(),
    getAktivitasRiwayat(),
  ]);
  const namaMap = await getAkunNamaMap(current.stafOperasionalAkunId != null ? [current.stafOperasionalAkunId] : []);
  const stafOperasionalNama = current.stafOperasionalAkunId != null ? (namaMap.get(current.stafOperasionalAkunId) ?? null) : null;

  return (
    <ProduksiTabShell
      initialTab="aktivitas-produksi"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialAktivitasProduksi={{ current, qty, susunanTim, stafOperasionalNama, mesinList, mesinEvents, stafOperasionalOptions, riwayat }}
    />
  );
}
```

(This drops the old direct `getKehadiran`/`getAnggotaTim` imports/calls —
the permanent-team lookup is no longer needed at this call site at all,
per Task 7's design note under Step 4.)

- [ ] **Step 5: Verify with `tsc`**

Run: `npx tsc --noEmit`
Expected: remaining errors only in `tim-produksi-roster.tsx` and
`riwayat-aktivitas-produksi.tsx` (both fixed in Task 9).

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi-app/aktivitas-produksi-view.tsx src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx"
git commit -m "feat: Staf Operasional Bertugas is read-only (auto) on the live shift view"
```

---

### Task 9: Frontend — susunan tim roster rewrite (drag, cross-team add, per-shift remove)

**Files:**
- Modify: `src/components/produksi-app/tim-produksi-roster.tsx`
- Modify: `src/components/produksi-app/riwayat-aktivitas-produksi.tsx` (prop
  plumbing only — it renders `TimProduksiRoster` too, in read-only mode
  for a past shift)

**Interfaces:**
- Consumes: `SusunanTimRow[]` (Task 7), `setSusunanTimAction`,
  `getSemuaAnggotaTimAction` (Task 7).

- [ ] **Step 1: Rewrite `tim-produksi-roster.tsx`**

Replace the entire file content with:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SusunanTimRow } from "@/lib/queries/aktivitas-produksi";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
import { setSusunanTimAction, getSemuaAnggotaTimAction } from "@/app/mkesindo/produksi/actions";

const TAMBAH_PLACEHOLDER = "__pilih__";

function SortableRosterRow({
  entry,
  index,
  canEdit,
  onRemove,
}: {
  entry: SusunanTimRow;
  index: number;
  canEdit: boolean;
  onRemove: (anggotaId: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.anggotaId,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border border-border px-2 py-1.5", isDragging && "z-10 opacity-70 shadow-lg")}
    >
      {canEdit && (
        <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
          <GripVertical className="size-4" />
        </button>
      )}
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
        {index + 1}
      </span>
      <span className="flex-1 text-sm">{entry.nama}</span>
      {canEdit && (
        <button
          type="button"
          title="Keluarkan dari susunan shift ini"
          onClick={() => onRemove(entry.anggotaId)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function TimProduksiRoster({
  tanggalUsaha,
  shift,
  susunanTim,
  canEdit,
  onChanged,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  susunanTim: SusunanTimRow[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState(susunanTim);
  const [semuaAnggota, setSemuaAnggota] = useState<AnggotaTimRow[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // susunanTim comes from the parent's own fetch (re-run after onChanged)
  // -- resync local drag/edit state whenever a fresh copy arrives, same
  // reasoning as every other "server state -> local editable copy" pattern
  // in this app (e.g. RouteValidationDialog's own `order` state).
  useEffect(() => {
    setOrder(susunanTim);
  }, [susunanTim]);

  useEffect(() => {
    if (!canEdit) return;
    getSemuaAnggotaTimAction().then((result) => {
      if (result.success) setSemuaAnggota(result.data);
    });
  }, [canEdit]);

  function persist(next: SusunanTimRow[]) {
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const result = await setSusunanTimAction(tanggalUsaha, shift, next.map((n) => n.anggotaId));
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((o) => o.anggotaId === active.id);
    const newIndex = order.findIndex((o) => o.anggotaId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    persist(arrayMove(order, oldIndex, newIndex));
  }

  function handleRemove(anggotaId: number) {
    persist(order.filter((o) => o.anggotaId !== anggotaId));
  }

  function handleTambah(value: string | null) {
    if (!value || value === TAMBAH_PLACEHOLDER) return;
    const anggotaId = Number(value);
    const anggota = semuaAnggota?.find((a) => a.anggotaId === anggotaId);
    if (!anggota || order.some((o) => o.anggotaId === anggotaId)) return;
    persist([...order, { anggotaId, nama: anggota.nama, urutan: order.length }]);
  }

  const tersedia = (semuaAnggota ?? []).filter((a) => !order.some((o) => o.anggotaId === a.anggotaId));

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Tim Produksi bertugas — Shift {shift}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {order.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada anggota bertugas.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order.map((o) => o.anggotaId)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1.5">
                {order.map((entry, i) => (
                  <SortableRosterRow key={entry.anggotaId} entry={entry} index={i} canEdit={canEdit} onRemove={handleRemove} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        {canEdit && (
          <Select value={TAMBAH_PLACEHOLDER} onValueChange={handleTambah} disabled={pending}>
            <SelectTrigger>
              <SelectValue placeholder="Tambah dari tim lain..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TAMBAH_PLACEHOLDER} disabled>
                Tambah dari tim lain...
              </SelectItem>
              {tersedia.map((a) => (
                <SelectItem key={a.anggotaId} value={String(a.anggotaId)}>
                  {a.nama} (Shift {a.shift})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
```

(Note: no more "Simpan" button — every add/remove/reorder persists
immediately via `persist()`, matching `RouteValidationDialog`'s own
auto-save-on-drop precedent rather than the old
"Simpan Kehadiran"-on-demand button. This is a deliberate small deviation
from the spec's Bagian 5 wording — flagged here rather than silently
guessed both ways; if an explicit Simpan button is actually preferred,
swap `persist()`'s body to only update local `order` state and add a
button calling the same server-action call with the latest `order`.)

- [ ] **Step 2: Fix `riwayat-aktivitas-produksi.tsx`'s call site**

This file's `UbahAktivitasDialog` is a **correction** dialog for a past
shift — it already lets the Staf Operasional be re-picked there (kept,
per this plan's Task 8/spec Non-Goals), and its `TimProduksiRoster` usage
is passed `canEdit` (bare, i.e. `true`) today for the exact same reason:
fixing a past shift's roster is an intended, existing capability of this
dialog. Keep it editable here — only the field names change, not the
`canEdit` value.

Find:

```ts
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
```

Replace with:

```ts
import type { SusunanTimRow } from "@/lib/queries/aktivitas-produksi";
```

Find:

```ts
type Detail = { current: AktivitasShiftInfo; qty: QtyRecap; kehadiran: number[]; timAnggota: AnggotaTimRow[] };
```

Replace with:

```ts
type Detail = { current: AktivitasShiftInfo; qty: QtyRecap; susunanTim: SusunanTimRow[] };
```

Find:

```tsx
            <TimProduksiRoster
              tanggalUsaha={row.tanggalUsaha}
              shift={row.shift}
              timAnggota={detail.timAnggota}
              kehadiran={detail.kehadiran}
              canEdit
              onChanged={refetchDetail}
            />
            <QtyRecapCard qty={detail.qty} jumlahHadir={detail.kehadiran.length} />
```

Replace with:

```tsx
            <TimProduksiRoster
              tanggalUsaha={row.tanggalUsaha}
              shift={row.shift}
              susunanTim={detail.susunanTim}
              canEdit
              onChanged={refetchDetail}
            />
            <QtyRecapCard qty={detail.qty} jumlahHadir={detail.susunanTim.length} />
```

`getAktivitasDetailAction` (Task 7 Step 4) also needs the same
`stafOperasionalNama` field added as `getCurrentAktivitasProduksiAction` —
this file's `StafOperasionalSelect` usage already gets its
`stafOperasionalAkunId` from `detail.current.stafOperasionalAkunId`
directly (not from a `stafOperasionalNama` field), so no further change
is needed here beyond the two blocks above — `stafOperasionalNama` on
this action's return value is unused by this particular file, only by
Task 8's live view.

- [ ] **Step 3: Verify with `tsc` and `eslint`**

Run: `npx tsc --noEmit && npx eslint src/components/produksi-app/tim-produksi-roster.tsx src/components/produksi-app/riwayat-aktivitas-produksi.tsx`
Expected: both clean, zero remaining `tsc` errors project-wide (this was
the last file referencing the old `kehadiran`/`timAnggota` shape).

- [ ] **Step 4: Manual verification**

Browser pane, `/mkesindo/produksi-app` Aktivitas tab: open a shift that's
never been touched today — confirm its own permanent team shows up
automatically with no clicking. Add a member from a different team via
the dropdown. Drag-reorder two rows. Remove one via X. Reload the page —
confirm the exact order/membership persisted. Open `/mkesindo/produksi-app`'s
Riwayat tab, "Ubah" a past shift, and confirm its roster is STILL fully
editable there too (drag handle, X, and the cross-team dropdown all
present) — this dialog is a deliberate correction tool for past shifts,
not a read-only view.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi-app/tim-produksi-roster.tsx src/components/produksi-app/riwayat-aktivitas-produksi.tsx
git commit -m "feat: redesign per-shift Tim Produksi roster (drag reorder, cross-team add, per-shift remove)"
```

---

### Task 10: Frontend — Tim Produksi admin section on `/mkesindo/produksi`

**Files:**
- Create: `src/components/produksi/panel-tim-produksi.tsx`
- Modify: `src/app/mkesindo/(dashboard)/produksi/page.tsx`

**Interfaces:**
- Consumes: `getSemuaAnggotaTimAction`, `tambahAnggotaTimAction`,
  `updateAnggotaTimAction`, `hapusAnggotaTimAction` (Task 7).

- [ ] **Step 1: Write `panel-tim-produksi.tsx`**

Mirror [`panel-mesin.tsx`](../../../src/components/produksi/panel-mesin.tsx)'s
card-opens-a-dialog pattern, grouped into 3 columns (one per Shift/team):

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SHIFT_LABEL } from "@/lib/produksi-shift";
import { tambahAnggotaTimAction, updateAnggotaTimAction, hapusAnggotaTimAction } from "@/app/mkesindo/produksi/actions";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";

const SHIFTS = [1, 2, 3] as const;

function AnggotaCard({ anggota, onChanged }: { anggota: AnggotaTimRow; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [nama, setNama] = useState(anggota.nama);
  const [shift, setShift] = useState<1 | 2 | 3>(anggota.shift);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateAnggotaTimAction(anggota.anggotaId, { nama, shift });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onChanged();
    });
  }

  function handleNonaktifkan() {
    setError(null);
    startTransition(async () => {
      const result = await hapusAnggotaTimAction(anggota.anggotaId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onChanged();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setNama(anggota.nama);
          setShift(anggota.shift);
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
            <Label>Tim (Shift)</Label>
            <Select value={String(shift)} onValueChange={(v) => setShift((Number(v) as 1 | 2 | 3) ?? shift)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIFTS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {SHIFT_LABEL[s]}
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

function TambahAnggotaDialog({ shift, onChanged }: { shift: 1 | 2 | 3; onChanged: () => void }) {
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
      const result = await tambahAnggotaTimAction(shift, nama.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setNama("");
      setOpen(false);
      onChanged();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2 text-sm text-muted-foreground hover:bg-muted/50">
        <Plus className="size-4" /> Tambah Anggota
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Anggota — {SHIFT_LABEL[shift]}</DialogTitle>
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

export function PanelTimProduksi({ anggotaList, onChanged }: { anggotaList: AnggotaTimRow[]; onChanged: () => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {SHIFTS.map((shift) => (
        <div key={shift} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">{SHIFT_LABEL[shift]}</p>
          {anggotaList
            .filter((a) => a.shift === shift)
            .map((a) => (
              <AnggotaCard key={a.anggotaId} anggota={a} onChanged={onChanged} />
            ))}
          <TambahAnggotaDialog shift={shift} onChanged={onChanged} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the page**

This page is currently a Server Component with no client-side refresh
mechanism — `PanelTimProduksi`'s `onChanged` needs a way to re-fetch.
Follow the same `router.refresh()`-on-callback pattern used elsewhere in
this app for a Server Component page with a client mutation island (e.g.
`PemesananList`'s `onDeleted={() => router.refresh()}`): wrap the new
section's data-fetching in a small client boundary, OR — simpler, and
consistent with `PanelMesin` which has no `onChanged` at all and instead
relies on Next.js's automatic revalidation after `revalidatePath` inside
the Server Action — drop the `onChanged` prop entirely and let
`revalidatePath("/mkesindo/produksi")` (already added in
`updateAnggotaTimAction`/already present in `tambahAnggotaTimAction`/
`hapusAnggotaTimAction`) handle the refresh automatically on next
navigation. Match `PanelMesin`'s simpler no-callback shape: remove
`onChanged` from `PanelTimProduksi`'s props and every dialog inside it
(the `revalidatePath` calls already in Task 7's actions are sufficient —
Next.js Server Actions revalidate the calling page's Server Component
tree automatically after the action resolves, no manual `router.refresh()`
needed for a same-page mutation triggered by a Server Action).

Update the file: in each dialog component, remove the `onChanged: () =>
void` prop and its call sites (the components' `handleSave`/
`handleNonaktifkan`/`handleSubmit` just call `setOpen(false)` after a
successful result, nothing else). Update `PanelTimProduksi`'s own props
to drop `onChanged` too.

In `src/app/mkesindo/(dashboard)/produksi/page.tsx`, add the fetch and
section:

Find:

```ts
import { getWarehouseMap, getRiwayatProduksi } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { PetaWarehouseDesktop } from "@/components/produksi/peta-warehouse-desktop";
import { PanelMesin } from "@/components/produksi/panel-mesin";
import { RiwayatProduksi } from "@/components/produksi/riwayat-produksi";
```

Replace with:

```ts
import { getWarehouseMap, getRiwayatProduksi } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getSemuaAnggotaTim } from "@/lib/queries/tim-produksi";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { PetaWarehouseDesktop } from "@/components/produksi/peta-warehouse-desktop";
import { PanelMesin } from "@/components/produksi/panel-mesin";
import { PanelTimProduksi } from "@/components/produksi/panel-tim-produksi";
import { RiwayatProduksi } from "@/components/produksi/riwayat-produksi";
```

Find:

```ts
  const [posisi, mesinList, riwayatRaw] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getRiwayatProduksi(),
  ]);
```

Replace with:

```ts
  const [posisi, mesinList, anggotaTimList, riwayatRaw] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getSemuaAnggotaTim(),
    getRiwayatProduksi(),
  ]);
```

Find:

```tsx
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Mesin Produksi</h2>
        <PanelMesin mesinList={mesinList} />
      </section>
```

Replace with:

```tsx
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Mesin Produksi</h2>
        <PanelMesin mesinList={mesinList} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Tim Produksi</h2>
        <PanelTimProduksi anggotaList={anggotaTimList} />
      </section>
```

- [ ] **Step 3: Verify with `tsc` and `eslint`**

Run: `npx tsc --noEmit && npx eslint src/components/produksi/panel-tim-produksi.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"`
Expected: both clean, zero errors project-wide.

- [ ] **Step 4: Manual verification**

Browser pane, `/mkesindo/produksi`: confirm the new "Tim Produksi" section
shows 3 columns. Add a member to Shift 2, confirm it appears after the
page updates. Edit that member's name and move them to Shift 3, confirm
the card moves columns. Nonaktifkan them, confirm they disappear. Then
check `/mkesindo/produksi-app`'s Aktivitas tab's "Tambah dari tim lain"
dropdown reflects these same changes.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi/panel-tim-produksi.tsx "src/app/mkesindo/(dashboard)/produksi/page.tsx"
git commit -m "feat: add Tim Produksi management section to /mkesindo/produksi"
```

---

### Task 11: Final integration pass

No new files — this task is a full manual walkthrough of every spec
section together, since Tasks 1-10 each verified their own slice in
isolation but never all together in one flow.

- [ ] **Step 1: Full walkthrough**

Using the Browser pane, in order:

1. `/mkesindo/produksi-app` Kualitas tab — create a fresh pemeriksaan with
   QTY 10KG = 10, diameter 28mm, confirm the card shows correctly with no
   Kontaminasi/Kemasan.
2. `/mkesindo/produksi-app` Warehouse tab — open an empty pallete slot,
   Tambah Produksi, pick the Kualitas just created, allocate 6 (succeeds,
   sisa becomes 4), try allocating 5 more to a different slot (rejected).
3. `/mkesindo/produksi-app` Aktivitas tab — confirm Staf Operasional shows
   your own logged-in name with no picker, confirm the Tim Produksi
   roster auto-shows your shift's permanent team, add one cross-team
   member, reorder, remove one, reload and confirm persistence.
4. `/mkesindo/produksi` (desktop) — confirm the sidebar loads (already
   fixed in an earlier, separate change — just re-confirm no regression),
   confirm the new Tim Produksi section reflects the exact same
   membership changes made from the mobile app in step 3.
5. `/mkesindo/produksi-app` Riwayat tab — "Ubah" the shift touched in
   step 3, confirm its roster is still fully editable there (drag/add/
   remove — a deliberate past-shift correction capability, not read-only)
   and its Staf Operasional dropdown (manual correction) still works.

- [ ] **Step 2: Full `tsc`/`eslint` sweep**

Run: `npx tsc --noEmit` and `npx eslint .` (or every file touched across
all 10 tasks, listed explicitly if running eslint on the whole repo is
too slow) — both must be completely clean before considering this plan
done.

- [ ] **Step 3: Report to the user**

Summarize what changed against the spec's 5 sections, flag the one
deliberate deviation noted in Task 9 (auto-save-on-drop instead of an
explicit Simpan button) for explicit confirmation, and ask about
committing/pushing per this repo's established convention (never push
without an explicit separate instruction).
