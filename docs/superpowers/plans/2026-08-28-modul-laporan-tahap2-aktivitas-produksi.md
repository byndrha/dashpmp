# Modul Laporan — Tahap 2 (Aktivitas Produksi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Tahap 2 of Modul Laporan — a "Aktivitas Produksi" tab in
`produksi-app` where Kepala Produksi records per-shift team attendance,
machine on/off events, and damage counts, with production quantity and
per-member contribution computed automatically from existing data; plus
a read-only history view on the existing `/mkesindo/laporan` page.

**Architecture:** Four new MSSQL tables hold only raw inputs (attendance,
machine events, damage counts, who was on duty) — production quantity
(10KG per machine, 5KG shift total) is always computed fresh from
`DashboardProduksiBatch`/`DashboardPengirimanJadwal`, never stored, so it
can never drift from the source data. A new `isOperasional` Peran-Khusus
boolean flag (mirroring `isDriver`/`isSatpam`/`isProduksi` exactly) marks
which accounts can appear in the "Staf Operasional bertugas" picker —
unrelated to and not replacing Tahap 1's `"laporan"` module-permission
page-access mechanism.

**Tech Stack:** Next.js Server Actions, `mssql` (`getPool`/`sql`) for
MSSQL, `pg` (`getPgPool`) for the Postgres `akun`/`peran` directory,
existing `ActionResult<T>`/`runAction()`/`AppError` pattern, existing
shadcn/ui components, `report-shift.ts`/`business-date.ts` from Tahap 1.

**Spec:** [`docs/superpowers/specs/2026-08-28-modul-laporan-tahap2-aktivitas-produksi-design.md`](../specs/2026-08-28-modul-laporan-tahap2-aktivitas-produksi-design.md)

## Global Constraints

- 3 Tim Produksi are FIXED, one per shift number (1/2/3) — never a
  flexible many-teams-per-shift model. `Shift` on
  `DashboardTimProduksiAnggota` IS the team identifier.
- Production quantity is NEVER stored — always computed at read time
  from `DashboardProduksiBatch` (10KG, grouped by its own `MesinID`
  column, filtered by its own `TanggalLabel`+`Shift` columns — NOT via a
  join to `DashboardProduksiKualitas`, since `Batch` already carries its
  own copies of these fields, and `KualitasID` is nullable on older
  rows) and `DashboardPengirimanJadwal.Qty5KGDimuat` (shift total only,
  summed across all Jadwal whose `JamSelesaiMuat` falls in the shift's
  window — no per-machine breakdown, since that data has no machine
  link at all).
- **Timestamp convention, read this before writing any SQL comparing
  `JamSelesaiMuat`**: `DashboardPengirimanJadwal.JamSelesaiMuat` is
  written via raw `GETDATE()` — **true-UTC**. `getShiftWindow()` (Tahap
  1's `report-shift.ts`) returns **naive-WIB** boundaries. Convert the
  window to true-UTC with `naiveWibToUtcInstant()` (already exported
  from `business-date.ts`) BEFORE comparing against `JamSelesaiMuat` —
  comparing them raw is the exact class of bug fixed today in
  `assertJamJadwalNotBeforeOrders`. Never skip this conversion.
- `DashboardProduksiBatch.TanggalLabel` defaults from
  `getBusinessDateISO()` — the **14:00** WIB rollover
  (`ROLLOVER_HOUR`), NOT the 15:00 rollover `report-shift.ts`'s `"work"`
  kind uses. This is a pre-existing inconsistency (not introduced by
  this plan) affecting a 59-minute/day window (14:00–14:59 WIB). Group
  the 10KG recap by `Batch.TanggalLabel`+`Batch.Shift` AS STORED —
  do not attempt to re-derive a "corrected" shift from `CreatedDate`.
- Total Denda = `PecahKemasanQty*1000 + EsJatuhQty*3000` only —
  `GantiReturnQty`/`SealerJebolQty` are event counts with NO monetary
  contribution (confirmed).
- `isOperasional` is a Peran-Khusus boolean flag (Postgres
  `peran.is_operasional`), separate from and NOT a replacement for
  Tahap 1's `"laporan"` module-permission page gate — do not touch
  `requireModuleAccess("laporan")` or anything under
  `/mkesindo/(dashboard)/laporan/actions.ts`'s existing authorization
  logic for this.
- Any `"use client"` component must only import TYPES (never values)
  from a module that imports `@/lib/db` (mssql/pg) — same rule Tahap 1
  established via `src/lib/stok-bahan-baku-shared.ts`/
  `src/lib/produksi-shift.ts`. `report-shift.ts` and
  `produksi-mesin-status.ts` are already client-safe (no `@/lib/db`
  import) — new query files in this plan (`tim-produksi.ts`,
  `produksi-mesin-event.ts`, `aktivitas-produksi.ts`) are NOT
  client-safe. `hitungTotalDenda`/`hitungKontribusiPerOrang` are pure
  functions two different client components need as VALUES, so Task 6
  puts them in a dedicated client-safe `src/lib/aktivitas-produksi-shared.ts`
  from the start (re-exported from `aktivitas-produksi.ts` for
  server-side callers) — do not import them from `@/lib/queries/aktivitas-produksi`
  in any `"use client"` file, only from the shared file.
- No test framework — verify with `npx tsc --noEmit`/`npx eslint` plus a
  throwaway `npx tsx` scratch script against the real dev DB for
  anything touching SQL (delete the script after use), plus a live
  dev-server/browser compile-and-redirect check (a full authenticated
  click-through isn't possible in this environment — known, accepted
  limitation, not a defect to chase).
- Work happens directly on `main` (standing arrangement for this repo)
  — commit at the end of each task, push only when the user explicitly
  asks.

---

### Task 1: `isOperasional` Peran Khusus flag + Staf Operasional picker

**Files:**
- Modify: `src/lib/queries/akun.ts` (multiple spots, see below)
- Modify: `src/lib/auth.ts`
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/components/dashboard/peran-editor.tsx`
- Modify: `src/app/grup/akun/peran/actions.ts`
- Migration: `scripts/add-peran-is-operasional-column.ts` (new)

**Interfaces:**
- Produces: `session.user.isOperasional: boolean` (available everywhere
  a session already is); `getStafOperasionalOptions(): Promise<{akunId: number; nama: string}[]>`
  exported from `src/lib/queries/akun.ts`. Consumed by Task 8's UI (Staf
  Operasional dropdown) and Task 7's actions (validating the picked
  account is real).

- [ ] **Step 1: Postgres migration**

```ts
// One-off column addition — idempotent, safe to re-run.
// Usage: npx tsx scripts/add-peran-is-operasional-column.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pool = getPgPool();
  await pool.query(`ALTER TABLE peran ADD COLUMN IF NOT EXISTS is_operasional BOOLEAN NOT NULL DEFAULT false`);
  console.log("peran.is_operasional ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run it: `npx tsx scripts/add-peran-is-operasional-column.ts`. Run it a
second time to confirm idempotency.

- [ ] **Step 2: `src/lib/queries/akun.ts` — mirror `isProduksi` exactly at every one of these spots**

In `AkunAuthRow` (after `isProduksi: boolean;`, ~line 22): add
`isOperasional: boolean;`.

In `findAkunByUsername`'s SQL (~line 32-38): add
`COALESCE(r.is_operasional, false) AS is_operasional,` after the
`is_produksi` line, and in the returned object (~line 47-63) add
`isOperasional: row.is_operasional,`.

In `PeranRow` (~line 292-301): add `isOperasional: boolean;` after
`isProduksi: boolean;`.

In `listAllPeran`'s SQL (~line 305-310) add `r.is_operasional,` to the
SELECT list, and in the mapped return (~line 311-320) add
`isOperasional: row.is_operasional,`.

After `setPeranProduksi` (~line 377-380), add:

```ts
export async function setPeranOperasional(peranId: number, isOperasional: boolean): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE peran SET is_operasional = $1 WHERE id = $2`, [isOperasional, peranId]);
}
```

Near `getAkunNamaMap` (~line 488), add:

```ts
export interface StafOperasionalOption {
  akunId: number;
  nama: string;
}

// Mirrors getDriverOptions() in delivery.ts, but sourced from the
// Postgres akun/peran directory (isOperasional lives there), not the
// MSSQL Salesman table Driver identity uses — these are two unrelated
// identity systems.
export async function getStafOperasionalOptions(): Promise<StafOperasionalOption[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT a.id, a.nama
    FROM akun a
    JOIN peran r ON r.id = a.peran_id
    WHERE r.is_operasional = true AND a.is_active = true
    ORDER BY a.nama
  `);
  return result.rows.map((row) => ({ akunId: row.id as number, nama: row.nama as string }));
}
```

- [ ] **Step 3: `src/lib/auth.ts`**

In `AuthorizedUser` (after `isProduksi: boolean;`, ~line 26): add
`isOperasional: boolean;`.

In `authorize()`'s returned `user` object (after `isProduksi: row.isProduksi,`, ~line 88): add
`isOperasional: row.isOperasional,`.

In the `jwt` callback (after `token.isProduksi = u.isProduksi;`, ~line 109): add
`token.isOperasional = u.isOperasional;`.

Also find the `session` callback a few lines below (assigns
`session.user.isProduksi = token.isProduksi as boolean;` around line 30
per this file's other callback) and add the matching
`session.user.isOperasional = token.isOperasional as boolean;` line.

- [ ] **Step 4: `src/types/next-auth.d.ts`**

Add `isOperasional: boolean;` to all three interfaces (`Session.user`,
`User`, `JWT`) at the same relative position as `isProduksi` in each
(~lines 18, 33, 49).

- [ ] **Step 5: `src/components/dashboard/peran-editor.tsx`**

Add import: `setPeranOperasionalAction` alongside the existing
`setPeranProduksiAction` import from `@/app/grup/akun/peran/actions`
(~line 19).

Add state (after `const [isProduksi, setIsProduksiState] = useState(peran.isProduksi);`, ~line 35):

```ts
const [isOperasional, setIsOperasionalState] = useState(peran.isOperasional);
```

Add a toggle function (after `toggleProduksi`, ~line 64):

```ts
function toggleOperasional() {
  setIsOperasionalState((prev) => !prev);
  setDirty(true);
}
```

In `handleSave`'s `Promise.all` array (after
`setPeranProduksiAction(peran.id, isProduksi),`, ~line 80): add
`setPeranOperasionalAction(peran.id, isOperasional),`.

After the "Peran Khusus: Produksi" `<label>` block (~line 156-165), add
a matching block:

```tsx
<label className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
  <input type="checkbox" className="accent-primary" checked={isOperasional} onChange={toggleOperasional} />
  <span>
    Peran Khusus: Staf Operasional
    <span className="block text-muted-foreground">
      Menandai akun sebagai Staf Operasional — dipakai untuk dropdown pemilihan di fitur lain (mis. Aktivitas
      Produksi), terpisah dari izin akses modul "Laporan".
    </span>
  </span>
</label>
```

- [ ] **Step 6: `src/app/grup/akun/peran/actions.ts`**

Add `setPeranOperasional` to the import from `@/lib/queries/akun`
(~line 5, alongside `setPeranProduksi`).

After `setPeranProduksiAction` (~line 60-66), add:

```ts
export async function setPeranOperasionalAction(peranId: number, isOperasional: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setPeranOperasional(peranId, isOperasional);
    revalidatePath("/grup/akun/peran");
  });
}
```

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit
npx eslint src/lib/queries/akun.ts src/lib/auth.ts src/components/dashboard/peran-editor.tsx src/app/grup/akun/peran/actions.ts
```

Write a throwaway script confirming `getStafOperasionalOptions()` runs
against the real dev DB and returns an array (empty is fine — no
account has the flag yet):

```ts
import "dotenv/config";
import { getStafOperasionalOptions } from "./src/lib/queries/akun";
async function main() {
  console.log(await getStafOperasionalOptions());
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
```

Run via `npx tsx`, confirm no error, then delete the script.

- [ ] **Step 8: Commit**

```bash
git add scripts/add-peran-is-operasional-column.ts src/lib/queries/akun.ts src/lib/auth.ts src/types/next-auth.d.ts src/components/dashboard/peran-editor.tsx src/app/grup/akun/peran/actions.ts
git commit -m "feat: add isOperasional Peran Khusus flag and Staf Operasional picker"
```

---

### Task 2: `getNaiveWibNow()` helper

**Files:**
- Modify: `src/lib/business-date.ts`

**Interfaces:**
- Produces: `getNaiveWibNow(now?: Date): Date`. Consumed by Task 5
  (`produksi-mesin-event.ts`).

- [ ] **Step 1: Add the function**

Add after `getNaiveWibTransDate` (before the `WIB_OFFSET_MS` constant):

```ts
// Plain "right now" as a naive-WIB Date (raw UTC-component values ARE
// the WIB wall-clock value) — unlike getNaiveWibTransDate, this has NO
// business-date rollover logic at all (no ROLLOVER_HOUR involved): it's
// for a pure event timestamp (e.g. a machine on/off toggle) where "which
// business day does this belong to" isn't a meaningful question, only
// "what did the clock say." Built via Date.UTC(...), same reasoning as
// every other naive-WIB constructor in this file.
export function getNaiveWibNow(now: Date = new Date()): Date {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: WIB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    )
  );
}
```

- [ ] **Step 2: Verify**

Throwaway script:

```ts
import { getNaiveWibNow } from "./src/lib/business-date";
const d = getNaiveWibNow(new Date("2026-08-28T10:00:00Z")); // 17:00 WIB
console.log(d.toISOString()); // expect 2026-08-28T17:00:00.000Z
if (d.toISOString() !== "2026-08-28T17:00:00.000Z") throw new Error("FAIL");
console.log("OK");
```

Run via `npx tsx`, confirm `OK`, delete the script.

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/business-date.ts
git commit -m "feat: add getNaiveWibNow helper for plain event timestamps"
```

---

### Task 3: MSSQL tables for Tahap 2

**Files:**
- Create: `scripts/create-aktivitas-produksi-tables.ts`

**Interfaces:**
- Produces: tables `DashboardTimProduksiAnggota`,
  `DashboardAktivitasProduksiShift`,
  `DashboardAktivitasProduksiKehadiran`, `DashboardProduksiMesinEvent`.
  Consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Write the migration script**

```ts
// One-off table creation for Modul Laporan Tahap 2 (Aktivitas Produksi)
// — idempotent, safe to re-run.
// Usage: npx tsx scripts/create-aktivitas-produksi-tables.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardTimProduksiAnggota' AND xtype='U')
    CREATE TABLE DashboardTimProduksiAnggota (
      AnggotaID     INT IDENTITY PRIMARY KEY,
      Shift         TINYINT NOT NULL,
      Nama          VARCHAR(100) NOT NULL,
      IsDeleted     BIT NOT NULL DEFAULT 0,
      CreatedDate   DATETIME NOT NULL DEFAULT GETDATE(),
      ModifiedDate  DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardAktivitasProduksiShift' AND xtype='U')
    CREATE TABLE DashboardAktivitasProduksiShift (
      AktivitasID             INT IDENTITY PRIMARY KEY,
      TanggalUsaha            DATE NOT NULL,
      Shift                   TINYINT NOT NULL,
      ShiftMulai              DATETIME NOT NULL,
      StafOperasionalAkunID   INT NULL,
      StokEsSebelumnya10KG    INT NOT NULL DEFAULT 0,
      PecahKemasanQty         INT NOT NULL DEFAULT 0,
      EsJatuhQty              INT NOT NULL DEFAULT 0,
      GantiReturnQty          INT NOT NULL DEFAULT 0,
      SealerJebolQty          INT NOT NULL DEFAULT 0,
      CreatedByAkunID         INT NOT NULL,
      CreatedDate             DATETIME NOT NULL DEFAULT GETDATE(),
      ModifiedDate            DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_AktivitasProduksiShift UNIQUE (TanggalUsaha, Shift)
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardAktivitasProduksiKehadiran' AND xtype='U')
    CREATE TABLE DashboardAktivitasProduksiKehadiran (
      AktivitasID   INT NOT NULL,
      AnggotaID     INT NOT NULL,
      PRIMARY KEY (AktivitasID, AnggotaID)
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardProduksiMesinEvent' AND xtype='U')
    CREATE TABLE DashboardProduksiMesinEvent (
      EventID             INT IDENTITY PRIMARY KEY,
      MesinID             INT NOT NULL,
      JenisEvent          VARCHAR(10) NOT NULL,
      WaktuEvent          DATETIME NOT NULL,
      DicatatOlehAkunID   INT NOT NULL,
      CreatedDate         DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  console.log("DashboardTimProduksiAnggota + DashboardAktivitasProduksiShift + DashboardAktivitasProduksiKehadiran + DashboardProduksiMesinEvent ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the dev DB, twice**

```bash
npx tsx scripts/create-aktivitas-produksi-tables.ts
npx tsx scripts/create-aktivitas-produksi-tables.ts
```

Both runs must print the ready message with no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/create-aktivitas-produksi-tables.ts
git commit -m "feat: add Tahap 2 Aktivitas Produksi tables"
```

---

### Task 4: `src/lib/queries/tim-produksi.ts` (roster)

**Files:**
- Create: `src/lib/queries/tim-produksi.ts`

**Interfaces:**
- Consumes: `getPool`, `sql` from `@/lib/db`.
- Produces: `AnggotaTimRow`, `getAnggotaTim(shift)`,
  `tambahAnggotaTim(shift, nama)`, `hapusAnggotaTim(anggotaId)`.
  Consumed by Task 7's actions.

- [ ] **Step 1: Write the module**

```ts
import { getPool, sql } from "@/lib/db";

export interface AnggotaTimRow {
  anggotaId: number;
  shift: 1 | 2 | 3;
  nama: string;
}

// One of the 3 fixed teams' active roster — Shift IS the team identifier
// (Tim Shift 1/2/3 are permanent, not a rotating assignment).
export async function getAnggotaTim(shift: 1 | 2 | 3): Promise<AnggotaTimRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("shift", sql.TinyInt, shift)
    .query(`
      SELECT AnggotaID, Shift, Nama FROM DashboardTimProduksiAnggota
      WHERE Shift = @shift AND IsDeleted = 0
      ORDER BY Nama
    `);
  return (result.recordset as { AnggotaID: number; Shift: number; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    shift: r.Shift as 1 | 2 | 3,
    nama: r.Nama,
  }));
}

export async function tambahAnggotaTim(shift: 1 | 2 | 3, nama: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("shift", sql.TinyInt, shift)
    .input("nama", sql.VarChar(100), nama)
    .query(`
      INSERT INTO DashboardTimProduksiAnggota (Shift, Nama)
      OUTPUT INSERTED.AnggotaID
      VALUES (@shift, @nama)
    `);
  return (result.recordset[0] as { AnggotaID: number }).AnggotaID;
}

// Soft-remove only — a member's past DashboardAktivitasProduksiKehadiran
// rows must keep resolving to a real name for historical Riwayat views.
export async function hapusAnggotaTim(anggotaId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("anggotaId", sql.Int, anggotaId)
    .query(`UPDATE DashboardTimProduksiAnggota SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE AnggotaID = @anggotaId`);
}
```

- [ ] **Step 2: Verify**

Throwaway script: call `tambahAnggotaTim(1, "Test Anggota")`, confirm it
appears in `getAnggotaTim(1)`, call `hapusAnggotaTim` on it, confirm it
no longer appears. Delete the script after.

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/tim-produksi.ts
git commit -m "feat: add tim-produksi roster queries"
```

---

### Task 5: `src/lib/queries/produksi-mesin-event.ts`

**Files:**
- Create: `src/lib/queries/produksi-mesin-event.ts`

**Interfaces:**
- Consumes: `getPool`/`sql` from `@/lib/db`; `getNaiveWibNow` from
  `@/lib/business-date` (Task 2); `getShiftWindow`, `ShiftNumber` from
  `@/lib/report-shift` (Tahap 1).
- Produces: `JenisMesinEvent`, `MesinEventRow`,
  `catatMesinEvent(mesinId, jenisEvent, akunId)`,
  `getMesinEventsForShift(businessDate, shift)`. Consumed by Task 7.

- [ ] **Step 1: Write the module**

```ts
import { getPool, sql } from "@/lib/db";
import { getNaiveWibNow } from "@/lib/business-date";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";

export type JenisMesinEvent = "On" | "Off";

export interface MesinEventRow {
  eventId: number;
  mesinId: number;
  jenisEvent: JenisMesinEvent;
  waktuEvent: Date; // naive-WIB
  dicatatOlehAkunId: number;
}

export async function catatMesinEvent(mesinId: number, jenisEvent: JenisMesinEvent, akunId: number): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("mesinId", sql.Int, mesinId)
    .input("jenisEvent", sql.VarChar(10), jenisEvent)
    .input("waktuEvent", sql.DateTime, getNaiveWibNow())
    .input("akunId", sql.Int, akunId)
    .query(`
      INSERT INTO DashboardProduksiMesinEvent (MesinID, JenisEvent, WaktuEvent, DicatatOlehAkunID)
      OUTPUT INSERTED.EventID
      VALUES (@mesinId, @jenisEvent, @waktuEvent, @akunId)
    `);
  return (result.recordset[0] as { EventID: number }).EventID;
}

// Events shown on a specific shift's screen — filtered by real-time
// window, not a stored AktivitasID link (a toggle can happen before the
// shift's own DashboardAktivitasProduksiShift row is ever created).
// getShiftWindow returns naive-WIB bounds, matching WaktuEvent's own
// naive-WIB storage (getNaiveWibNow) — no cross-convention conversion
// needed here, unlike the Qty5KG/JamSelesaiMuat query in Task 6.
export async function getMesinEventsForShift(businessDate: Date, shift: ShiftNumber): Promise<MesinEventRow[]> {
  const pool = await getPool();
  const { start, end } = getShiftWindow(businessDate, shift, "work");
  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end)
    .query(`
      SELECT EventID, MesinID, JenisEvent, WaktuEvent, DicatatOlehAkunID
      FROM DashboardProduksiMesinEvent
      WHERE WaktuEvent BETWEEN @start AND @end
      ORDER BY WaktuEvent ASC
    `);
  return (result.recordset as { EventID: number; MesinID: number; JenisEvent: JenisMesinEvent; WaktuEvent: Date; DicatatOlehAkunID: number }[]).map(
    (r) => ({
      eventId: r.EventID,
      mesinId: r.MesinID,
      jenisEvent: r.JenisEvent,
      waktuEvent: r.WaktuEvent,
      dicatatOlehAkunId: r.DicatatOlehAkunID,
    })
  );
}
```

- [ ] **Step 2: Verify**

Throwaway script: fetch a real `MesinID` (via `getMesinList()`),
`catatMesinEvent(mesinId, "On", 1)`, then confirm
`getMesinEventsForShift(getReportShift("work").businessDate, getReportShift("work").shift)`
includes it. Delete the test row afterward (`DELETE FROM
DashboardProduksiMesinEvent WHERE EventID = ...`) and confirm cleanup.
Delete the script.

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/produksi-mesin-event.ts
git commit -m "feat: add produksi-mesin-event log queries"
```

---

### Task 6: `src/lib/queries/aktivitas-produksi.ts` (core)

**Files:**
- Create: `src/lib/aktivitas-produksi-shared.ts`
- Create: `src/lib/queries/aktivitas-produksi.ts`

**Interfaces:**
- Consumes: `getPool`/`sql` from `@/lib/db`; `getReportShift`,
  `getShiftWindow`, `getShiftLabel`, `ShiftNumber` from
  `@/lib/report-shift`; `naiveWibToUtcInstant` from
  `@/lib/business-date`.
- Produces (from `aktivitas-produksi-shared.ts`, client-safe — zero
  imports): `hitungTotalDenda(pecahKemasanQty, esJatuhQty)`,
  `hitungKontribusiPerOrang(totalKantongEkivalen, jumlahHadir)`.
  Produces (from `aktivitas-produksi.ts`, NOT client-safe — imports
  `@/lib/db`): `AktivitasShiftInfo`, `QtyPerMesinRow`, `QtyRecap`,
  `KerusakanInput`, `getCurrentShift()`,
  `getAktivitasForShift(tanggalUsaha, shift)`, `getAktivitasRiwayat(limit?)`,
  `upsertStafOperasional(...)`, `upsertKerusakan(...)`, `setKehadiran(...)`,
  `getKehadiran(...)`, `getQtyRecapForShift(tanggalUsaha, shift)`, plus
  re-exports of both shared functions (so existing server-side callers
  can keep importing them from either file). Consumed by Task 7's
  actions (server-side, either file) and Tasks 8/9's `"use client"`
  components (the shared file ONLY — see Global Constraints on the
  client/server bundle boundary; this split mirrors
  `src/lib/stok-bahan-baku-shared.ts`'s own precedent from Tahap 1,
  which existed for the exact same reason).

- [ ] **Step 1: Write the client-safe shared file**

```ts
// Pure, zero-dependency functions a "use client" component can import as
// VALUES safely — split out of aktivitas-produksi.ts (which imports
// @/lib/db, i.e. mssql/pg) for the same reason
// src/lib/stok-bahan-baku-shared.ts was split out of
// src/lib/queries/stok-bahan-baku.ts in Tahap 1: a client component
// value-importing anything from a @/lib/db-importing module fails to
// bundle (Turbopack tries to pull mssql/pg's Node-only deps into the
// browser). See that file's own comment for the fuller precedent.
export function hitungTotalDenda(pecahKemasanQty: number, esJatuhQty: number): number {
  return pecahKemasanQty * 1000 + esJatuhQty * 3000;
}

export function hitungKontribusiPerOrang(totalKantongEkivalen: number, jumlahHadir: number): number | null {
  return jumlahHadir > 0 ? totalKantongEkivalen / jumlahHadir : null;
}
```

- [ ] **Step 2: Write the main query module**

```ts
import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";
export { hitungTotalDenda, hitungKontribusiPerOrang } from "@/lib/aktivitas-produksi-shared";

export interface AktivitasShiftInfo {
  aktivitasId: number | null; // null when this shift has never been saved yet
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
  stafOperasionalAkunId: number | null;
  stokEsSebelumnya10KG: number;
  pecahKemasanQty: number;
  esJatuhQty: number;
  gantiReturnQty: number;
  sealerJebolQty: number;
}

export interface QtyPerMesinRow {
  mesinId: number;
  mesinNama: string;
  qty10KG: number;
}

export interface QtyRecap {
  perMesin: QtyPerMesinRow[];
  total10KG: number;
  total5KG: number;
  totalKantongEkivalen: number;
}

export interface KerusakanInput {
  pecahKemasanQty: number;
  esJatuhQty: number;
  gantiReturnQty: number;
  sealerJebolQty: number;
}

export function getCurrentShift(): { tanggalUsaha: string; shift: ShiftNumber } {
  const { shift, businessDate } = getReportShift("work");
  return { tanggalUsaha: businessDate.toISOString().slice(0, 10), shift };
}

async function getTotalStokEs10KG(pool: sql.ConnectionPool): Promise<number> {
  const result = await pool.request().query(`
    SELECT ISNULL(SUM(SisaQty10KG), 0) AS Total FROM DashboardProduksiBatch WHERE IsDeleted = 0 AND SisaQty10KG > 0
  `);
  return (result.recordset[0] as { Total: number }).Total;
}

// Creates the shift's row on first write (any of the upsert functions
// below), snapshotting StokEsSebelumnya10KG at that exact moment — never
// re-snapshotted after. A tiny check-then-insert race is possible under
// truly concurrent first-writes to the same brand-new shift (the UNIQUE
// constraint would reject the loser with a duplicate-key error rather
// than corrupt data) — accepted, matching this codebase's existing
// MERGE-without-HOLDLOCK precedent across 14+ query files for a
// low-traffic internal tool.
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
  return (result.recordset[0] as { AktivitasID: number }).AktivitasID;
}

interface RawAktivitasRow {
  AktivitasID: number;
  StafOperasionalAkunID: number | null;
  StokEsSebelumnya10KG: number;
  PecahKemasanQty: number;
  EsJatuhQty: number;
  GantiReturnQty: number;
  SealerJebolQty: number;
}

function mapAktivitasRow(r: RawAktivitasRow, tanggalUsaha: string, shift: ShiftNumber): AktivitasShiftInfo {
  return {
    aktivitasId: r.AktivitasID,
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    stafOperasionalAkunId: r.StafOperasionalAkunID,
    stokEsSebelumnya10KG: r.StokEsSebelumnya10KG,
    pecahKemasanQty: r.PecahKemasanQty,
    esJatuhQty: r.EsJatuhQty,
    gantiReturnQty: r.GantiReturnQty,
    sealerJebolQty: r.SealerJebolQty,
  };
}

// Returns a synthesized zero-valued row (aktivitasId: null,
// stokEsSebelumnya10KG computed LIVE since no snapshot exists yet) for a
// shift that has never been saved — same pattern as Tahap 1's
// getCurrentShiftRows.
export async function getAktivitasForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<AktivitasShiftInfo> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`
      SELECT AktivitasID, StafOperasionalAkunID, StokEsSebelumnya10KG, PecahKemasanQty, EsJatuhQty, GantiReturnQty, SealerJebolQty
      FROM DashboardAktivitasProduksiShift WHERE TanggalUsaha = @t AND Shift = @s
    `);
  const row = result.recordset[0] as RawAktivitasRow | undefined;
  if (row) return mapAktivitasRow(row, tanggalUsaha, shift);

  const stokEs = await getTotalStokEs10KG(pool);
  return {
    aktivitasId: null,
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    stafOperasionalAkunId: null,
    stokEsSebelumnya10KG: stokEs,
    pecahKemasanQty: 0,
    esJatuhQty: 0,
    gantiReturnQty: 0,
    sealerJebolQty: 0,
  };
}

export async function getAktivitasRiwayat(limit = 30): Promise<AktivitasShiftInfo[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) AktivitasID, TanggalUsaha, Shift, StafOperasionalAkunID, StokEsSebelumnya10KG,
             PecahKemasanQty, EsJatuhQty, GantiReturnQty, SealerJebolQty
      FROM DashboardAktivitasProduksiShift
      ORDER BY ShiftMulai DESC
    `);
  return (result.recordset as (RawAktivitasRow & { TanggalUsaha: Date; Shift: number })[]).map((r) =>
    mapAktivitasRow(r, r.TanggalUsaha.toISOString().slice(0, 10), r.Shift as ShiftNumber)
  );
}

export async function upsertStafOperasional(tanggalUsaha: string, shift: ShiftNumber, stafOperasionalAkunId: number | null, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .input("stafId", sql.Int, stafOperasionalAkunId)
    .query(`UPDATE DashboardAktivitasProduksiShift SET StafOperasionalAkunID = @stafId, ModifiedDate = GETDATE() WHERE AktivitasID = @aktivitasId`);
}

export async function upsertKerusakan(tanggalUsaha: string, shift: ShiftNumber, input: KerusakanInput, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .input("pecah", sql.Int, input.pecahKemasanQty)
    .input("jatuh", sql.Int, input.esJatuhQty)
    .input("retur", sql.Int, input.gantiReturnQty)
    .input("sealer", sql.Int, input.sealerJebolQty)
    .query(`
      UPDATE DashboardAktivitasProduksiShift
      SET PecahKemasanQty = @pecah, EsJatuhQty = @jatuh, GantiReturnQty = @retur, SealerJebolQty = @sealer, ModifiedDate = GETDATE()
      WHERE AktivitasID = @aktivitasId
    `);
}

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

// 10KG: grouped by DashboardProduksiBatch's OWN MesinID/TanggalLabel/
// Shift columns (copied from Kualitas at insert time — see createBatch
// in produksi-warehouse.ts) — NOT via a join to DashboardProduksiKualitas,
// since KualitasID is nullable on older batches and Batch already
// carries everything needed directly.
// 5KG: summed from Qty5KGDimuat across Jadwal whose JamSelesaiMuat falls
// in this shift's window — true-UTC column, so the naive-WIB shift
// window is converted via naiveWibToUtcInstant() before the SQL
// comparison. Total only, no per-machine breakdown (no machine link
// exists on this data at all).
export async function getQtyRecapForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<QtyRecap> {
  const pool = await getPool();

  const perMesinResult = await pool
    .request()
    .input("tanggalLabel", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift)
    .query(`
      SELECT b.MesinID, m.Nama AS MesinNama, SUM(b.Qty10KG) AS Qty10KG
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0 AND b.TanggalLabel = @tanggalLabel AND b.Shift = @shift
      GROUP BY b.MesinID, m.Nama
      ORDER BY m.Nama
    `);
  const perMesin = (perMesinResult.recordset as { MesinID: number; MesinNama: string; Qty10KG: number }[]).map((r) => ({
    mesinId: r.MesinID,
    mesinNama: r.MesinNama,
    qty10KG: r.Qty10KG,
  }));
  const total10KG = perMesin.reduce((sum, r) => sum + r.qty10KG, 0);

  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const window = getShiftWindow(businessDate, shift, "work");
  const startUtc = naiveWibToUtcInstant(window.start);
  const endUtc = naiveWibToUtcInstant(window.end);
  const qty5Result = await pool
    .request()
    .input("start", sql.DateTime, startUtc)
    .input("end", sql.DateTime, endUtc)
    .query(`
      SELECT ISNULL(SUM(Qty5KGDimuat), 0) AS Total
      FROM DashboardPengirimanJadwal
      WHERE IsDeleted = 0 AND JamSelesaiMuat IS NOT NULL AND JamSelesaiMuat BETWEEN @start AND @end
    `);
  const total5KG = (qty5Result.recordset[0] as { Total: number }).Total;

  return { perMesin, total10KG, total5KG, totalKantongEkivalen: total10KG + total5KG / 2 };
}
```

- [ ] **Step 3: Verify against the real dev DB**

Write a throwaway script that:
1. Calls `getCurrentShift()`, then `getAktivitasForShift(tanggalUsaha, shift)` — confirm it returns `aktivitasId: null` and a live `stokEsSebelumnya10KG` if this shift has no row yet.
2. Calls `upsertKerusakan(tanggalUsaha, shift, {pecahKemasanQty: 2, esJatuhQty: 1, gantiReturnQty: 0, sealerJebolQty: 0}, 1)`, then `getAktivitasForShift` again — confirm `aktivitasId` is now non-null, `stokEsSebelumnya10KG` is UNCHANGED from step 1's live value (now frozen), and the kerusakan fields match.
3. Confirms `hitungTotalDenda(2, 1) === 5000`.
4. Calls `getQtyRecapForShift(tanggalUsaha, shift)` — confirm it runs without error and returns a plausible shape (numbers, even if zero).
5. Calls `setKehadiran(tanggalUsaha, shift, [], 1)` (empty list is valid — confirm `getKehadiran` returns `[]` after).
6. Cleans up: `DELETE FROM DashboardAktivitasProduksiShift WHERE TanggalUsaha = @t AND Shift = @s` (cascades logically to the Kehadiran row via the AktivitasID, but Kehadiran has no FK constraint — delete it explicitly too before deleting the Shift row) — confirm both are gone afterward.

Run via `npx tsx`, confirm every assertion, then delete the script.

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/aktivitas-produksi-shared.ts src/lib/queries/aktivitas-produksi.ts
git commit -m "feat: add aktivitas-produksi core queries with computed qty recap"
```

---

### Task 7: `produksi/actions.ts` additions (no UI yet)

**Files:**
- Modify: `src/app/mkesindo/produksi/actions.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 (`getStafOperasionalOptions`), 4
  (`tim-produksi.ts`), 5 (`produksi-mesin-event.ts`), 6
  (`aktivitas-produksi.ts`); `requireProduksiView`, `AppError`,
  `runAction`, `ActionResult` (already imported in this file).
- Produces: 12 new server actions, listed below. Consumed by Task 8's
  UI.

- [ ] **Step 1: Add imports**

```ts
import { getStafOperasionalOptions, type StafOperasionalOption } from "@/lib/queries/akun";
import { getAnggotaTim, tambahAnggotaTim, hapusAnggotaTim, type AnggotaTimRow } from "@/lib/queries/tim-produksi";
import { catatMesinEvent, getMesinEventsForShift, type JenisMesinEvent, type MesinEventRow } from "@/lib/queries/produksi-mesin-event";
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
import type { ShiftNumber } from "@/lib/report-shift";
```

(`getAkunNamaMap` is already imported in this file — reuse it, no new
import needed for name resolution.)

- [ ] **Step 2: Append the 12 actions**

```ts
export async function getStafOperasionalOptionsAction(): Promise<ActionResult<StafOperasionalOption[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getStafOperasionalOptions();
  });
}

export async function getAnggotaTimAction(shift: ShiftNumber): Promise<ActionResult<AnggotaTimRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getAnggotaTim(shift);
  });
}

export async function tambahAnggotaTimAction(shift: ShiftNumber, nama: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!nama.trim()) throw new AppError("Nama anggota tidak boleh kosong.");
    const id = await tambahAnggotaTim(shift, nama.trim());
    revalidatePath("/mkesindo/produksi-app");
    return id;
  });
}

export async function hapusAnggotaTimAction(anggotaId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    await hapusAnggotaTim(anggotaId);
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function catatMesinEventAction(mesinId: number, jenisEvent: JenisMesinEvent): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await catatMesinEvent(mesinId, jenisEvent, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function getMesinEventsForShiftAction(tanggalUsaha: string, shift: ShiftNumber): Promise<ActionResult<MesinEventRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
    return getMesinEventsForShift(businessDate, shift);
  });
}

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

export async function getAktivitasRiwayatAction(): Promise<ActionResult<AktivitasShiftInfo[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getAktivitasRiwayat();
  });
}

// Used by the Riwayat list when a past row is opened: full detail for
// ONE specific past shift (its own qty recap + kehadiran + team roster),
// fetched on demand rather than eagerly for every row.
export async function getAktivitasDetailAction(
  tanggalUsaha: string,
  shift: ShiftNumber
): Promise<ActionResult<{ current: AktivitasShiftInfo; qty: QtyRecap; kehadiran: number[]; timAnggota: AnggotaTimRow[] }>> {
  return runAction(async () => {
    await requireProduksiView();
    const [current, qty, kehadiran, timAnggota] = await Promise.all([
      getAktivitasForShift(tanggalUsaha, shift),
      getQtyRecapForShift(tanggalUsaha, shift),
      getKehadiran(tanggalUsaha, shift),
      getAnggotaTim(shift),
    ]);
    return { current, qty, kehadiran, timAnggota };
  });
}

export async function upsertStafOperasionalAction(tanggalUsaha: string, shift: ShiftNumber, stafOperasionalAkunId: number | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await upsertStafOperasional(tanggalUsaha, shift, stafOperasionalAkunId, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function upsertKerusakanAction(tanggalUsaha: string, shift: ShiftNumber, input: KerusakanInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (input.pecahKemasanQty < 0 || input.esJatuhQty < 0 || input.gantiReturnQty < 0 || input.sealerJebolQty < 0) {
      throw new AppError("Jumlah tidak boleh negatif.");
    }
    await upsertKerusakan(tanggalUsaha, shift, input, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}

export async function setKehadiranAction(tanggalUsaha: string, shift: ShiftNumber, anggotaIds: number[]): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    await setKehadiran(tanggalUsaha, shift, anggotaIds, Number(session.user.id));
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npx eslint src/app/mkesindo/produksi/actions.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/app/mkesindo/produksi/actions.ts
git commit -m "feat: add Aktivitas Produksi server actions"
```

---

### Task 8: "Aktivitas Produksi" tab in `produksi-app`

**Files:**
- Create: `src/components/produksi-app/tim-produksi-roster.tsx`
- Create: `src/components/produksi-app/mesin-event-panel.tsx`
- Create: `src/components/produksi-app/aktivitas-produksi-view.tsx`
- Create: `src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx`
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx`
- Modify: `src/components/produksi-app/bottom-nav.tsx`

**Interfaces:**
- Consumes: all 12 actions from Task 7; types from Task 6
  (`AktivitasShiftInfo`, `QtyRecap`, `KerusakanInput`), Task 4
  (`AnggotaTimRow`), Task 5 (`MesinEventRow`, `JenisMesinEvent`), Task 1
  (`StafOperasionalOption`); `hitungTotalDenda`/`hitungKontribusiPerOrang`
  from `@/lib/aktivitas-produksi-shared` (Task 6 — client-safe file, see
  Global Constraints); `getMesinListAction`/`MesinRow` (already exist,
  used by other tabs already wired into `produksi-tab-shell.tsx`).
- Produces: a 6th `ProduksiTabKey` (`"aktivitas-produksi"`).

- [ ] **Step 1: `src/components/produksi-app/tim-produksi-roster.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2 } from "lucide-react";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
import { tambahAnggotaTimAction, hapusAnggotaTimAction, setKehadiranAction } from "@/app/mkesindo/produksi/actions";

export function TimProduksiRoster({
  tanggalUsaha,
  shift,
  timAnggota,
  kehadiran,
  canEdit,
  onChanged,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  timAnggota: AnggotaTimRow[];
  kehadiran: number[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [namaBaru, setNamaBaru] = useState("");
  const [checked, setChecked] = useState<Set<number>>(new Set(kehadiran));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleHadir(anggotaId: number) {
    if (!canEdit) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(anggotaId)) next.delete(anggotaId);
      else next.add(anggotaId);
      return next;
    });
  }

  function handleSimpanKehadiran() {
    setError(null);
    startTransition(async () => {
      const result = await setKehadiranAction(tanggalUsaha, shift, [...checked]);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  function handleTambahAnggota() {
    if (!namaBaru.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await tambahAnggotaTimAction(shift, namaBaru.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setNamaBaru("");
      onChanged();
    });
  }

  function handleHapusAnggota(anggotaId: number) {
    setError(null);
    startTransition(async () => {
      const result = await hapusAnggotaTimAction(anggotaId);
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
        <CardTitle className="text-sm">Tim Produksi (Shift {shift})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {timAnggota.map((a) => (
            <div key={a.anggotaId} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-primary"
                checked={checked.has(a.anggotaId)}
                onChange={() => toggleHadir(a.anggotaId)}
                disabled={!canEdit}
              />
              <span className="flex-1 text-sm">{a.nama}</span>
              <Button variant="ghost" size="icon" className="size-6" disabled={pending} onClick={() => handleHapusAnggota(a.anggotaId)}>
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          ))}
          {timAnggota.length === 0 && <p className="text-xs text-muted-foreground">Belum ada anggota di tim ini.</p>}
        </div>
        {canEdit && (
          <Button size="sm" className="w-fit" disabled={pending} onClick={handleSimpanKehadiran}>
            Simpan Kehadiran
          </Button>
        )}
        <div className="flex gap-2">
          <Input placeholder="Nama anggota baru" value={namaBaru} onChange={(e) => setNamaBaru(e.target.value)} />
          <Button size="sm" variant="outline" disabled={pending} onClick={handleTambahAnggota}>
            Tambah
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: `src/components/produksi-app/mesin-event-panel.tsx`**

```tsx
"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { MesinEventRow, JenisMesinEvent } from "@/lib/queries/produksi-mesin-event";
import { catatMesinEventAction } from "@/app/mkesindo/produksi/actions";

// WaktuEvent is naive-WIB (see catatMesinEvent's own comment) — reading
// with local Date getters here would be WRONG unless the browser's OS
// timezone happens to be WIB. Use UTC getters, matching every other
// naive-WIB display in this app (e.g. ubah-tanggal-pemesanan-dialog.tsx).
function formatJamNaiveWib(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function MesinEventPanel({
  mesinList,
  events,
  onChanged,
}: {
  mesinList: MesinRow[];
  events: MesinEventRow[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleToggle(mesinId: number, jenisEvent: JenisMesinEvent) {
    startTransition(async () => {
      const result = await catatMesinEventAction(mesinId, jenisEvent);
      if (result.success) onChanged();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Status Mesin</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {mesinList.map((m) => (
          <div key={m.MesinID} className="flex items-center justify-between gap-2 rounded-md border p-2">
            <span className="text-sm">{m.Nama}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => handleToggle(m.MesinID, "On")}>
                On
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => handleToggle(m.MesinID, "Off")}>
                Off
              </Button>
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-1 text-xs">
          {events.map((e) => {
            const mesin = mesinList.find((m) => m.MesinID === e.mesinId);
            return (
              <p key={e.eventId} className="text-muted-foreground">
                {formatJamNaiveWib(e.waktuEvent)} — {mesin?.Nama ?? "?"}: {e.jenisEvent}
              </p>
            );
          })}
          {events.length === 0 && <p className="text-muted-foreground">Belum ada kejadian shift ini.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: `src/components/produksi-app/aktivitas-produksi-view.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimProduksiRoster } from "@/components/produksi-app/tim-produksi-roster";
import { MesinEventPanel } from "@/components/produksi-app/mesin-event-panel";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
import type { MesinEventRow } from "@/lib/queries/produksi-mesin-event";
import type { StafOperasionalOption } from "@/lib/queries/akun";
import type { AktivitasShiftInfo, QtyRecap } from "@/lib/queries/aktivitas-produksi";
import { hitungTotalDenda, hitungKontribusiPerOrang } from "@/lib/aktivitas-produksi-shared";
import { upsertStafOperasionalAction, upsertKerusakanAction } from "@/app/mkesindo/produksi/actions";

const UNSET = "__unset__";

function QtyRecapCard({ qty, jumlahHadir }: { qty: QtyRecap; jumlahHadir: number }) {
  const kontribusi = hitungKontribusiPerOrang(qty.totalKantongEkivalen, jumlahHadir);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Rekap Produksi</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {qty.perMesin.map((m) => (
          <div key={m.mesinId} className="flex justify-between text-xs">
            <span>{m.mesinNama} (10KG)</span>
            <span className="tabular-nums">{m.qty10KG.toLocaleString("id-ID")}</span>
          </div>
        ))}
        <div className="flex justify-between border-t pt-2 text-xs">
          <span>Total 10KG</span>
          <span className="tabular-nums font-medium">{qty.total10KG.toLocaleString("id-ID")}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span>Total 5KG (shift ini)</span>
          <span className="tabular-nums font-medium">{qty.total5KG.toLocaleString("id-ID")}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span>Kontribusi / Orang</span>
          <span className="tabular-nums font-medium">
            {kontribusi === null ? "Belum ada anggota hadir" : kontribusi.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function KerusakanCard({
  tanggalUsaha,
  shift,
  current,
  onSaved,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  current: AktivitasShiftInfo;
  onSaved: () => void;
}) {
  const [pecah, setPecah] = useState(String(current.pecahKemasanQty));
  const [jatuh, setJatuh] = useState(String(current.esJatuhQty));
  const [retur, setRetur] = useState(String(current.gantiReturnQty));
  const [sealer, setSealer] = useState(String(current.sealerJebolQty));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const totalDenda = hitungTotalDenda(Number(pecah) || 0, Number(jatuh) || 0);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await upsertKerusakanAction(tanggalUsaha, shift, {
        pecahKemasanQty: Number(pecah) || 0,
        esJatuhQty: Number(jatuh) || 0,
        gantiReturnQty: Number(retur) || 0,
        sealerJebolQty: Number(sealer) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Kerusakan</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Pecah Kemasan (Rp1.000/kejadian)</Label>
            <Input type="number" min={0} value={pecah} onChange={(e) => setPecah(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Es Jatuh (Rp3.000/kejadian)</Label>
            <Input type="number" min={0} value={jatuh} onChange={(e) => setJatuh(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Ganti Return</Label>
            <Input type="number" min={0} value={retur} onChange={(e) => setRetur(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Sealer Jebol</Label>
            <Input type="number" min={0} value={sealer} onChange={(e) => setSealer(e.target.value)} />
          </div>
        </div>
        <p className="text-sm font-medium">Total Denda: Rp{totalDenda.toLocaleString("id-ID")}</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-fit" disabled={pending} onClick={handleSave}>
          Simpan
        </Button>
      </CardContent>
    </Card>
  );
}

export function AktivitasProduksiView({
  current,
  qty,
  kehadiran,
  timAnggota,
  mesinList,
  mesinEvents,
  stafOperasionalOptions,
  onChanged,
}: {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  kehadiran: number[];
  timAnggota: AnggotaTimRow[];
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  stafOperasionalOptions: StafOperasionalOption[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleStafChange(value: string) {
    startTransition(async () => {
      await upsertStafOperasionalAction(current.tanggalUsaha, current.shift, value === UNSET ? null : Number(value));
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {current.tanggalUsaha} — {current.shiftLabel}
      </h2>

      <Card size="sm">
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Staf Operasional Bertugas</Label>
            <Select value={current.stafOperasionalAkunId ? String(current.stafOperasionalAkunId) : UNSET} onValueChange={handleStafChange} disabled={pending}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih Staf Operasional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Belum dipilih</SelectItem>
                {stafOperasionalOptions.map((o) => (
                  <SelectItem key={o.akunId} value={String(o.akunId)}>
                    {o.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Stok Es Sebelumnya (10KG): <span className="font-medium text-foreground">{current.stokEsSebelumnya10KG.toLocaleString("id-ID")}</span>
          </p>
        </CardContent>
      </Card>

      <TimProduksiRoster tanggalUsaha={current.tanggalUsaha} shift={current.shift} timAnggota={timAnggota} kehadiran={kehadiran} canEdit onChanged={onChanged} />
      <MesinEventPanel mesinList={mesinList} events={mesinEvents} onChanged={onChanged} />
      <QtyRecapCard qty={qty} jumlahHadir={kehadiran.length} />
      <KerusakanCard tanggalUsaha={current.tanggalUsaha} shift={current.shift} current={current} onSaved={onChanged} />
    </div>
  );
}
```

- [ ] **Step 4: Wire into `produksi-tab-shell.tsx`**

Add imports:

```ts
import { AktivitasProduksiView } from "@/components/produksi-app/aktivitas-produksi-view";
import {
  getCurrentAktivitasProduksiAction,
  getMesinEventsForShiftAction,
  getStafOperasionalOptionsAction,
} from "@/app/mkesindo/produksi/actions";
import type { AktivitasShiftInfo, QtyRecap } from "@/lib/queries/aktivitas-produksi";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
import type { MesinEventRow } from "@/lib/queries/produksi-mesin-event";
import type { StafOperasionalOption } from "@/lib/queries/akun";
```

Extend `ProduksiTabKey` and `TAB_PATHS`:

```ts
export type ProduksiTabKey = "kartu-pengiriman" | "riwayat" | "warehouse" | "kualitas" | "bahan-baku" | "aktivitas-produksi";

const TAB_PATHS: Record<ProduksiTabKey, string> = {
  "kartu-pengiriman": "/mkesindo/produksi-app",
  riwayat: "/mkesindo/produksi-app/riwayat",
  warehouse: "/mkesindo/produksi-app/warehouse",
  kualitas: "/mkesindo/produksi-app/kualitas",
  "bahan-baku": "/mkesindo/produksi-app/bahan-baku",
  "aktivitas-produksi": "/mkesindo/produksi-app/aktivitas-produksi",
};
```

Add a new optional prop to the component's props type:

```ts
initialAktivitasProduksi?: {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  kehadiran: number[];
  timAnggota: AnggotaTimRow[];
  mesinList: MesinRow[]; // reuse existing MesinRow import already in this file
  mesinEvents: MesinEventRow[];
  stafOperasionalOptions: StafOperasionalOption[];
};
```

Add matching state:

```ts
const [aktivitasProduksi, setAktivitasProduksi] = useState(initialAktivitasProduksi ?? null);
```

Add a refresh helper (alongside `refreshBahanBaku`):

```ts
function refreshAktivitasProduksi() {
  setAktivitasProduksi(null);
}
```

Inside the `useEffect`'s `load()`, add (after the `bahan-baku` branch):

```ts
if (activeTab === "aktivitas-produksi" && aktivitasProduksi === null) {
  setLoadingTab("aktivitas-produksi");
  const [aktivitasResult, mesinResult] = await Promise.all([getCurrentAktivitasProduksiAction(), getMesinListAction()]);
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
  });
  setLoadingTab(null);
}
```

Add `aktivitasProduksi` to the effect's dependency array.

Add the render block (alongside the `bahan-baku` one):

```tsx
{visited.has("aktivitas-produksi") && aktivitasProduksi && (
  <div className={cn("h-full overflow-y-auto", activeTab !== "aktivitas-produksi" && "hidden")}>
    <AktivitasProduksiView
      current={aktivitasProduksi.current}
      qty={aktivitasProduksi.qty}
      kehadiran={aktivitasProduksi.kehadiran}
      timAnggota={aktivitasProduksi.timAnggota}
      mesinList={aktivitasProduksi.mesinList}
      mesinEvents={aktivitasProduksi.mesinEvents}
      stafOperasionalOptions={aktivitasProduksi.stafOperasionalOptions}
      onChanged={refreshAktivitasProduksi}
    />
  </div>
)}
```

- [ ] **Step 5: `bottom-nav.tsx`**

Add `Users` to the lucide import, append to `TABS`:

```ts
{ key: "aktivitas-produksi", label: "Aktivitas", icon: Users },
```

- [ ] **Step 6: Route page** `src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx`

```tsx
import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { getStafOperasionalOptions } from "@/lib/queries/akun";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getAnggotaTim } from "@/lib/queries/tim-produksi";
import { getMesinEventsForShift } from "@/lib/queries/produksi-mesin-event";
import { getCurrentShift, getAktivitasForShift, getQtyRecapForShift, getKehadiran } from "@/lib/queries/aktivitas-produksi";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Aktivitas Produksi" };

export default async function ProduksiAppAktivitasProduksiPage() {
  const session = await requireProduksi();
  const { tanggalUsaha, shift } = getCurrentShift();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);

  const [profile, current, qty, kehadiran, timAnggota, mesinList, mesinEvents, stafOperasionalOptions] = await Promise.all([
    getUserById(Number(session.user.id)),
    getAktivitasForShift(tanggalUsaha, shift),
    getQtyRecapForShift(tanggalUsaha, shift),
    getKehadiran(tanggalUsaha, shift),
    getAnggotaTim(shift),
    getMesinList(),
    getMesinEventsForShift(businessDate, shift),
    getStafOperasionalOptions(),
  ]);

  return (
    <ProduksiTabShell
      initialTab="aktivitas-produksi"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialAktivitasProduksi={{ current, qty, kehadiran, timAnggota, mesinList, mesinEvents, stafOperasionalOptions }}
    />
  );
}
```

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit
npx eslint src/components/produksi-app/tim-produksi-roster.tsx src/components/produksi-app/mesin-event-panel.tsx src/components/produksi-app/aktivitas-produksi-view.tsx src/components/produksi-app/produksi-tab-shell.tsx src/components/produksi-app/bottom-nav.tsx "src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi/page.tsx"
```

- [ ] **Step 8: Live-verify**

Start the dev server, confirm `/mkesindo/produksi-app/aktivitas-produksi`
compiles with zero build/console errors and correctly redirects
unauthenticated requests (same accepted verification level as Tahap 1 —
a full authenticated click-through isn't possible in this environment).

- [ ] **Step 9: Commit**

```bash
git add src/components/produksi-app/tim-produksi-roster.tsx src/components/produksi-app/mesin-event-panel.tsx src/components/produksi-app/aktivitas-produksi-view.tsx src/components/produksi-app/produksi-tab-shell.tsx src/components/produksi-app/bottom-nav.tsx "src/app/mkesindo/produksi-app/(tabs)/aktivitas-produksi"
git commit -m "feat: add Aktivitas Produksi tab to produksi-app"
```

---

### Task 9: Desktop `/mkesindo/laporan` — tabbed conversion + Aktivitas Produksi riwayat

**Files:**
- Create: `src/components/dashboard/laporan-aktivitas-produksi.tsx`
- Create: `src/components/dashboard/laporan-tab-shell.tsx`
- Modify: `src/app/mkesindo/(dashboard)/laporan/page.tsx`
- Modify: `src/app/mkesindo/(dashboard)/laporan/actions.ts`

**Interfaces:**
- Consumes: `getAktivitasRiwayat` (server-side, from
  `@/lib/queries/aktivitas-produksi`) and `hitungTotalDenda`
  (client-side, from `@/lib/aktivitas-produksi-shared` — see Global
  Constraints on the bundle boundary) — both from Task 6;
  `getAkunNamaMap` (existing).
- Produces: `getAktivitasRiwayatForLaporanAction` in
  `src/app/mkesindo/(dashboard)/laporan/actions.ts` (a NEW action in
  this file — distinct from the one Task 7 added to
  `src/app/mkesindo/produksi/actions.ts`, since this one is gated by
  `requireModuleAccess("laporan")` for the desktop viewer, not
  `requireProduksiView()`).

This tab is READ-ONLY on desktop — all Tahap 2 input happens in
`produksi-app` only (unlike Tahap 1, which had two-sided input).

- [ ] **Step 1: Add the action**

In `src/app/mkesindo/(dashboard)/laporan/actions.ts`, add the import
(only `getAktivitasRiwayat` and its type — the read-only summary table
in Step 2 doesn't drill into per-shift qty/kehadiran detail, so nothing
else from `aktivitas-produksi.ts` or `tim-produksi.ts` is needed here):

```ts
import { getAktivitasRiwayat, type AktivitasShiftInfo } from "@/lib/queries/aktivitas-produksi";
```

Append:

```ts
export async function getAktivitasRiwayatForLaporanAction(): Promise<ActionResult<AktivitasShiftInfo[]>> {
  return runAction(async () => {
    await requireModuleAccess("laporan");
    return getAktivitasRiwayat();
  });
}
```

- [ ] **Step 2: `src/components/dashboard/laporan-aktivitas-produksi.tsx`**

```tsx
"use client";

import { formatDate } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AktivitasShiftInfo } from "@/lib/queries/aktivitas-produksi";
import { hitungTotalDenda } from "@/lib/aktivitas-produksi-shared";

export function LaporanAktivitasProduksi({
  riwayat,
  namaMap,
}: {
  riwayat: AktivitasShiftInfo[];
  namaMap: Record<number, string>;
}) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tanggal Usaha</TableHead>
            <TableHead>Shift</TableHead>
            <TableHead>Staf Operasional</TableHead>
            <TableHead className="text-right">Stok Es Sebelumnya</TableHead>
            <TableHead className="text-right">Pecah Kemasan</TableHead>
            <TableHead className="text-right">Es Jatuh</TableHead>
            <TableHead className="text-right">Ganti Return</TableHead>
            <TableHead className="text-right">Sealer Jebol</TableHead>
            <TableHead className="text-right">Total Denda</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {riwayat.map((r) => (
            <TableRow key={`${r.tanggalUsaha}-${r.shift}`}>
              <TableCell>{formatDate(r.tanggalUsaha)}</TableCell>
              <TableCell>{r.shiftLabel}</TableCell>
              <TableCell>{r.stafOperasionalAkunId ? (namaMap[r.stafOperasionalAkunId] ?? "?") : "Belum diisi"}</TableCell>
              <TableCell className="text-right tabular-nums">{r.stokEsSebelumnya10KG.toLocaleString("id-ID")}</TableCell>
              <TableCell className="text-right tabular-nums">{r.pecahKemasanQty}</TableCell>
              <TableCell className="text-right tabular-nums">{r.esJatuhQty}</TableCell>
              <TableCell className="text-right tabular-nums">{r.gantiReturnQty}</TableCell>
              <TableCell className="text-right tabular-nums">{r.sealerJebolQty}</TableCell>
              <TableCell className="text-right tabular-nums">
                Rp{hitungTotalDenda(r.pecahKemasanQty, r.esJatuhQty).toLocaleString("id-ID")}
              </TableCell>
            </TableRow>
          ))}
          {riwayat.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                Belum ada data.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

(Per-shift QTY-per-mesin/kontribusi detail — via `getQtyRecapForShift`/
`getKehadiran`/`getAnggotaTim`, already used on Task 8's produksi-app
side — is a future drill-down, out of scope for this task's read-only
summary table.)

- [ ] **Step 3: `src/components/dashboard/laporan-tab-shell.tsx`**

Both tabs' data are fetched eagerly server-side (a desktop admin page,
not a mobile app — no lazy-fetch complexity needed here unlike
produksi-app's tab-shell).

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LaporanStokBahanBaku } from "@/components/dashboard/laporan-stok-bahan-baku";
import { LaporanAktivitasProduksi } from "@/components/dashboard/laporan-aktivitas-produksi";
import type { StokBahanBakuRow, CurrentShiftInfo, SaldoAwalRow } from "@/lib/queries/stok-bahan-baku";
import type { AktivitasShiftInfo } from "@/lib/queries/aktivitas-produksi";

type LaporanTab = "stok-bahan-baku" | "aktivitas-produksi";

export function LaporanTabShell({
  canEdit,
  canEditSaldoAwal,
  current,
  initialCurrentRows,
  initialHistory,
  initialSaldoAwal,
  namaMap,
  aktivitasRiwayat,
}: {
  canEdit: boolean;
  canEditSaldoAwal: boolean;
  current: CurrentShiftInfo;
  initialCurrentRows: StokBahanBakuRow[];
  initialHistory: StokBahanBakuRow[];
  initialSaldoAwal: SaldoAwalRow[];
  namaMap: Record<number, string>;
  aktivitasRiwayat: AktivitasShiftInfo[];
}) {
  const [tab, setTab] = useState<LaporanTab>("stok-bahan-baku");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "stok-bahan-baku" ? "default" : "outline"} onClick={() => setTab("stok-bahan-baku")}>
          Stok Bahan Baku
        </Button>
        <Button size="sm" variant={tab === "aktivitas-produksi" ? "default" : "outline"} onClick={() => setTab("aktivitas-produksi")}>
          Aktivitas Produksi
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
    </div>
  );
}
```

- [ ] **Step 4: Modify `page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { getCurrentShiftRows, getStokBahanBakuHistory, getSaldoAwal } from "@/lib/queries/stok-bahan-baku";
import { getAktivitasRiwayat } from "@/lib/queries/aktivitas-produksi";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { LaporanTabShell } from "@/components/dashboard/laporan-tab-shell";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage() {
  const session = await requireModuleAccess("laporan");
  const canEdit = canAccessAllPT(session.user) || !!session.user.permissions.laporan?.canEdit;
  const canEditSaldoAwal = canAccessAllPT(session.user);

  const [{ current, rows }, history, saldoAwal, aktivitasRiwayat] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getSaldoAwal(),
    getAktivitasRiwayat(),
  ]);

  const akunIds = [
    ...[...rows, ...history].flatMap((r) => [r.operasionalAkunId, r.produksiAkunId]),
    ...aktivitasRiwayat.map((r) => r.stafOperasionalAkunId),
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
      />
    </div>
  );
}
```

Note this REPLACES the direct `<LaporanStokBahanBaku>` render with
`<LaporanTabShell>` — `LaporanStokBahanBaku` itself is untouched, just
no longer rendered directly from `page.tsx`.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npx eslint src/components/dashboard/laporan-aktivitas-produksi.tsx src/components/dashboard/laporan-tab-shell.tsx "src/app/mkesindo/(dashboard)/laporan/page.tsx" "src/app/mkesindo/(dashboard)/laporan/actions.ts"
```

- [ ] **Step 6: Live-verify**

Start the dev server, confirm `/mkesindo/laporan` still compiles with
zero build/console errors and correctly redirects unauthenticated
requests, with both tab buttons present in the compiled output.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/laporan-aktivitas-produksi.tsx src/components/dashboard/laporan-tab-shell.tsx "src/app/mkesindo/(dashboard)/laporan/page.tsx" "src/app/mkesindo/(dashboard)/laporan/actions.ts"
git commit -m "feat: add Aktivitas Produksi riwayat tab to /mkesindo/laporan"
```

---

### Task 10: Create the "Staf Operasional" flag on real accounts + first Tim Produksi rosters (data setup, not code)

**Files:** none — admin-UI actions.

- [ ] **Step 1**: In `/grup/akun/peran`, toggle "Peran Khusus: Staf
  Operasional" on the appropriate Peran(s) (this can be the SAME Peran
  Tahap 1 already created with `"laporan"` canEdit, or a different one —
  the two mechanisms are independent, see Global Constraints).
- [ ] **Step 2**: Open `/mkesindo/produksi-app`'s new "Aktivitas" tab as
  Kepala Produksi, use "Tambah" under Tim Produksi to populate the real
  member names for Shift 1/2/3's fixed teams before handing this over to
  real use — otherwise the attendance checklist starts empty for all 3
  teams.

No commit — data setup through the already-shipped admin UI, not a code
change.
