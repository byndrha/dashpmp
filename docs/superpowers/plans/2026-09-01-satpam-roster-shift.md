# Fondasi Roster Shift Satpam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the duty-roster data model, shift-window math, and a Supervisor-facing admin UI for MKEsindo's Satpam shift schedule — the foundation later sub-projects (satpam-app tab-shell, Patroli, Tamu) will consume, without touching satpam-app itself in this plan.

**Architecture:** A new MSSQL table (`DashboardSatpamJadwalJaga`) holds one row per (date, shift-type, satpam) assignment. A pure-function module (`src/lib/satpam-shift.ts`, mirroring the existing `report-shift.ts` pattern) computes each row's actual time window and who is on duty at any instant. A new admin page at `/mkesindo/keamanan`, gated to Supervisor/Accounting/Manager/Super Admin (`WILAYAH_MANAGER_ROLE_IDS`), lets Supervisors add/remove assignments.

**Tech Stack:** Next.js Server Components + Server Actions, MSSQL (`mssql` package via `@/lib/db`) for the new roster table, Postgres (`pg` via `@/lib/pg`) for existing `akun`/`peran` account data, shadcn/ui components, Tailwind.

**Spec:** docs/superpowers/specs/2026-09-01-satpam-roster-shift-design.md

## Global Constraints

- Role gate for all roster-management (add/remove/list) actions and the `/mkesindo/keamanan` page: `user.isSuperAdmin || WILAYAH_MANAGER_ROLE_IDS.includes(user.roleId)` — reuse the existing `WILAYAH_MANAGER_ROLE_IDS = [3, 4, 1004]` from `src/lib/roles.ts` verbatim. Do NOT invent a new role list.
- `TanggalUsaha` means "the calendar date the shift STARTS on" — computed forward, NOT the rollover-adjusted business-date convention `report-shift.ts`/`business-date.ts` use elsewhere. This is a deliberate, documented departure — do not "fix" it to match those other conventions.
- Every Date this plan's pure functions build or compare MUST be a "naive WIB" Date (raw UTC-component values equal the WIB wall-clock value) — built via `Date.UTC(...)` component arithmetic only, never string-parsed, never `new Date()` bare. This project has a documented history of real production bugs from mixing naive-WIB and true-UTC Date values (see `src/lib/business-date.ts`'s own extensive comments) — `getSatpamOnDutyNow`'s default `now` parameter MUST come from `getNaiveWibNow()` (`@/lib/business-date`), never `new Date()`.
- No automated test suite exists in this repo (no "test" script in package.json, no jest/vitest). Verification per task is `npx tsc --noEmit` + `npm run lint`, plus a disposable `npx tsx` scratch script (written, run, then deleted) for the two correctness-critical pure functions in Task 1.
- `SatpamAkunID` (and `CreatedByAkunID`) on the new MSSQL table reference Postgres `akun.id` — there is NO database-level FK (this codebase never uses cross-database FK constraints) and NO SQL-level JOIN is possible across the two separate connections. Every query that needs a satpam's display name must fetch roster rows from MSSQL, then batch-resolve names via the existing `getAkunNamaMap(akunIds: number[])` (`src/lib/queries/akun.ts:534`) from Postgres, and merge in application code.
- New dashboard-native MSSQL tables in this codebase follow a fixed shape: `Dashboard`-prefixed name, `INT IDENTITY PRIMARY KEY`, `IsDeleted BIT NOT NULL DEFAULT 0`, `CreatedDate`/`ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()`, created via a one-off idempotent script under `scripts/`, run manually (`npx tsx scripts/...`) — never as part of app startup or an automated migration.

---

### Task 1: Shift-window pure functions

**Files:**
- Create: `src/lib/satpam-shift.ts`
- Create (disposable, deleted at the end of this task): `scripts/scratch-verify-satpam-shift.ts`

**Interfaces:**
- Consumes: `getNaiveWibNow` from `@/lib/business-date` (already exists, exported).
- Produces (consumed by Task 2's query layer and Task 4's UI): `SatpamShiftType` (union type), `SATPAM_SHIFT_LIST: SatpamShiftType[]`, `SATPAM_SHIFT_LABEL: Record<SatpamShiftType, string>`, `SatpamJadwalRow` (interface: `{ jadwalJagaId: number; tanggalUsaha: Date; shiftType: SatpamShiftType; satpamAkunId: number }`), `getSatpamShiftWindow(tanggalUsaha: Date, shiftType: SatpamShiftType): { start: Date; end: Date }`, `getSatpamOnDutyNow(rows: SatpamJadwalRow[], now?: Date): SatpamJadwalRow[]`.

- [ ] **Step 1: Write `src/lib/satpam-shift.ts`**

```ts
import { getNaiveWibNow } from "@/lib/business-date";

export type SatpamShiftType = "SHIFT1" | "SHIFT2" | "SHIFT3" | "LONG_MALAM" | "LONG_PAGI";

export const SATPAM_SHIFT_LIST: SatpamShiftType[] = ["SHIFT1", "SHIFT2", "SHIFT3", "LONG_MALAM", "LONG_PAGI"];

export const SATPAM_SHIFT_LABEL: Record<SatpamShiftType, string> = {
  SHIFT1: "Shift 1 (06:00–13:59)",
  SHIFT2: "Shift 2 (14:00–21:59)",
  SHIFT3: "Shift 3 (22:00–05:59)",
  LONG_MALAM: "Long Shift Malam (18:00–05:59)",
  LONG_PAGI: "Long Shift Pagi (06:00–17:59)",
};

// startHour/endHour dalam jam WIB. crossesMidnight = true berarti endHour
// jatuh di TanggalUsaha + 1 hari, bukan hari yang sama.
const SATPAM_SHIFT_HOURS: Record<SatpamShiftType, { startHour: number; endHour: number; crossesMidnight: boolean }> = {
  SHIFT1: { startHour: 6, endHour: 14, crossesMidnight: false },
  SHIFT2: { startHour: 14, endHour: 22, crossesMidnight: false },
  SHIFT3: { startHour: 22, endHour: 6, crossesMidnight: true },
  LONG_MALAM: { startHour: 18, endHour: 6, crossesMidnight: true },
  LONG_PAGI: { startHour: 6, endHour: 18, crossesMidnight: false },
};

// Jendela waktu aktual [start, end) untuk satu baris jadwal, sebagai
// naive-WIB Date (raw UTC-component values = jam dinding WIB) — pola yang
// sama seperti getShiftWindow di report-shift.ts, TAPI TanggalUsaha di sini
// artinya tanggal kalender SAAT SHIFT MULAI (dihitung maju), bukan tanggal
// bisnis dengan rollover mundur seperti report-shift.ts. Jangan disamakan.
export function getSatpamShiftWindow(tanggalUsaha: Date, shiftType: SatpamShiftType): { start: Date; end: Date } {
  const { startHour, endHour, crossesMidnight } = SATPAM_SHIFT_HOURS[shiftType];
  const y = tanggalUsaha.getUTCFullYear();
  const m = tanggalUsaha.getUTCMonth();
  const d = tanggalUsaha.getUTCDate();
  return {
    start: new Date(Date.UTC(y, m, d, startHour, 0, 0)),
    end: new Date(Date.UTC(y, m, d + (crossesMidnight ? 1 : 0), endHour, 0, 0)),
  };
}

export interface SatpamJadwalRow {
  jadwalJagaId: number;
  tanggalUsaha: Date;
  shiftType: SatpamShiftType;
  satpamAkunId: number;
}

// Baris mana saja (dari kandidat yang sudah diambil pemanggil — biasanya
// untuk TanggalUsaha hari ini DAN kemarin, supaya shift semalam yang masih
// berjalan ikut tertangkap) yang jendelanya mencakup `now`. Bisa
// mengembalikan 0, 1, atau lebih dari 1 baris (Long Shift bisa tumpang
// tindih dengan shift reguler di titik pergantian) — TIDAK ada asumsi
// "maksimal satu". `now` default ke getNaiveWibNow(), BUKAN `new Date()` —
// getSatpamShiftWindow di atas membangun start/end sebagai naive-WIB, jadi
// `now` yang dibandingkan terhadapnya harus naive-WIB juga, kalau tidak
// perbandingannya meleset ~7 jam (lihat Global Constraints).
export function getSatpamOnDutyNow(rows: SatpamJadwalRow[], now: Date = getNaiveWibNow()): SatpamJadwalRow[] {
  return rows.filter((row) => {
    const { start, end } = getSatpamShiftWindow(row.tanggalUsaha, row.shiftType);
    return now >= start && now < end;
  });
}
```

- [ ] **Step 2: Write the scratch verification script**

Create `scripts/scratch-verify-satpam-shift.ts`:

```ts
import { getSatpamShiftWindow, getSatpamOnDutyNow, type SatpamJadwalRow } from "../src/lib/satpam-shift";

// Kasus 1: Shift 1 biasa (tidak lewat tengah malam).
const w1 = getSatpamShiftWindow(new Date(Date.UTC(2026, 8, 1)), "SHIFT1");
console.log("Kasus 1 (jendela Shift1, 1 Sep):", w1);
console.assert(
  w1.start.getTime() === Date.UTC(2026, 8, 1, 6, 0, 0) && w1.end.getTime() === Date.UTC(2026, 8, 1, 14, 0, 0),
  "FAIL kasus 1"
);

// Kasus 2: Shift 3 lewat tengah malam -- end jatuh di tanggal +1.
const w2 = getSatpamShiftWindow(new Date(Date.UTC(2026, 8, 1)), "SHIFT3");
console.log("Kasus 2 (jendela Shift3, 1 Sep, lewat tengah malam):", w2);
console.assert(
  w2.start.getTime() === Date.UTC(2026, 8, 1, 22, 0, 0) && w2.end.getTime() === Date.UTC(2026, 8, 2, 6, 0, 0),
  "FAIL kasus 2"
);

// Kasus 3: now di dalam jendela Shift1 -> satpam itu dapat ditemukan.
const rows3: SatpamJadwalRow[] = [
  { jadwalJagaId: 1, tanggalUsaha: new Date(Date.UTC(2026, 8, 1)), shiftType: "SHIFT1", satpamAkunId: 100 },
];
const now3 = new Date(Date.UTC(2026, 8, 1, 10, 0, 0));
const result3 = getSatpamOnDutyNow(rows3, now3);
console.log("Kasus 3 (now jam 10:00, dalam jendela Shift1):", result3);
console.assert(result3.length === 1 && result3[0].jadwalJagaId === 1, "FAIL kasus 3");

// Kasus 4: now tepat di batas akhir jendela Shift1 (14:00:00) -> TIDAK dapat
// (end eksklusif, karena Shift2 mulai persis di jam yang sama).
const now4 = new Date(Date.UTC(2026, 8, 1, 14, 0, 0));
const result4 = getSatpamOnDutyNow(rows3, now4);
console.log("Kasus 4 (now tepat jam 14:00, batas akhir Shift1):", result4);
console.assert(result4.length === 0, "FAIL kasus 4");

// Kasus 5: Shift3 semalam (TanggalUsaha 1 Sep) masih berjalan pada tanggal
// KALENDER berikutnya (2 Sep jam 03:00) -> tetap ditemukan.
const rows5: SatpamJadwalRow[] = [
  { jadwalJagaId: 2, tanggalUsaha: new Date(Date.UTC(2026, 8, 1)), shiftType: "SHIFT3", satpamAkunId: 200 },
];
const now5 = new Date(Date.UTC(2026, 8, 2, 3, 0, 0));
const result5 = getSatpamOnDutyNow(rows5, now5);
console.log("Kasus 5 (Shift3 1 Sep, now 2 Sep jam 03:00 -- masih berjalan):", result5);
console.assert(result5.length === 1 && result5[0].jadwalJagaId === 2, "FAIL kasus 5");

// Kasus 6: dua satpam bersamaan -- Shift2 1 Sep (14:00-21:59) tumpang tindih
// dengan Long Malam 1 Sep (18:00-05:59) pada jam 19:00 -- keduanya harus
// ditemukan sekaligus.
const rows6: SatpamJadwalRow[] = [
  { jadwalJagaId: 3, tanggalUsaha: new Date(Date.UTC(2026, 8, 1)), shiftType: "SHIFT2", satpamAkunId: 300 },
  { jadwalJagaId: 4, tanggalUsaha: new Date(Date.UTC(2026, 8, 1)), shiftType: "LONG_MALAM", satpamAkunId: 400 },
];
const now6 = new Date(Date.UTC(2026, 8, 1, 19, 0, 0));
const result6 = getSatpamOnDutyNow(rows6, now6);
console.log("Kasus 6 (dua satpam bersamaan, Shift2 + Long Malam tumpang tindih):", result6);
console.assert(result6.length === 2, "FAIL kasus 6");

console.log("Selesai — cek di atas apakah ada baris 'Assertion failed' dari console.assert.");
```

- [ ] **Step 3: Run the scratch script**

```bash
npx tsx scripts/scratch-verify-satpam-shift.ts
```
Expected: 6 result lines logged, no "Assertion failed" lines from any `console.assert` call.

- [ ] **Step 4: Delete the scratch script**

```bash
rm scripts/scratch-verify-satpam-shift.ts
```

- [ ] **Step 5: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/satpam-shift.ts
git commit -m "feat: add pure shift-window functions for the Satpam duty roster"
```

---

### Task 2: Roster table, akun options, and query layer

**Files:**
- Create: `scripts/create-satpam-jadwal-jaga-table.ts`
- Modify: `src/lib/queries/akun.ts` (add `getSatpamAkunOptions`, right after `getProduksiAkunOptions` at line 532)
- Create: `src/lib/queries/satpam-jadwal-jaga.ts`

**Interfaces:**
- Consumes: `SatpamShiftType`, `SatpamJadwalRow`, `getSatpamOnDutyNow` from `@/lib/satpam-shift` (Task 1). `getNaiveWibNow` from `@/lib/business-date`. `getPool`, `sql` from `@/lib/db`. `getAkunNamaMap`, `StafOperasionalOption` from `@/lib/queries/akun` (already exist).
- Produces (consumed by Task 3's actions): `getSatpamAkunOptions(): Promise<StafOperasionalOption[]>` (added to `akun.ts`). From the new `satpam-jadwal-jaga.ts`: `SatpamJadwalDisplayRow` (interface, extends `SatpamJadwalRow` with `satpamNama: string; catatan: string | null`), `getSatpamJadwalJagaList(startDate: Date, endDate: Date): Promise<SatpamJadwalDisplayRow[]>`, `getSatpamOnDutyNowRows(now?: Date): Promise<SatpamJadwalDisplayRow[]>`, `addSatpamJadwalJaga(input: { tanggalUsaha: Date; shiftType: SatpamShiftType; satpamAkunId: number; catatan: string | null; createdByAkunId: number }): Promise<void>`, `removeSatpamJadwalJaga(jadwalJagaId: number): Promise<void>`.

- [ ] **Step 1: Write the table-creation script**

Create `scripts/create-satpam-jadwal-jaga-table.ts`:

```ts
// One-off table creation for the Satpam duty roster (Fondasi Roster Shift
// Satpam) -- idempotent, safe to re-run.
// Usage: npx tsx scripts/create-satpam-jadwal-jaga-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSatpamJadwalJaga' AND xtype='U')
    CREATE TABLE DashboardSatpamJadwalJaga (
      JadwalJagaID    INT IDENTITY PRIMARY KEY,
      TanggalUsaha    DATE NOT NULL,
      ShiftType       VARCHAR(12) NOT NULL,
      SatpamAkunID    INT NOT NULL,
      Catatan         VARCHAR(256) NULL,
      IsDeleted       BIT NOT NULL DEFAULT 0,
      CreatedByAkunID INT NOT NULL,
      CreatedDate     DATETIME NOT NULL DEFAULT GETDATE(),
      ModifiedDate    DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  console.log("DashboardSatpamJadwalJaga ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script against the live MSSQL database**

```bash
npx tsx scripts/create-satpam-jadwal-jaga-table.ts
```
Expected: `DashboardSatpamJadwalJaga ready.` printed, exit code 0. Safe to re-run (the `IF NOT EXISTS` guard no-ops on a second run).

- [ ] **Step 3: Add `getSatpamAkunOptions` to `src/lib/queries/akun.ts`**

Insert immediately after `getProduksiAkunOptions` (after line 532, before `getAkunNamaMap`):

```ts
// Daftar akun is_satpam=true aktif -- dipakai dropdown "Satpam" di panel
// admin Roster Shift Satpam. Mirip getStafOperasionalOptions/
// getProduksiAkunOptions di atas, beda flag peran saja (is_satpam).
export async function getSatpamAkunOptions(): Promise<StafOperasionalOption[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT a.id, a.nama
    FROM akun a
    JOIN peran r ON r.id = a.peran_id
    WHERE r.is_satpam = true AND a.is_active = true
    ORDER BY a.nama
  `);
  return result.rows.map((row) => ({ akunId: row.id as number, nama: row.nama as string }));
}
```

- [ ] **Step 4: Write `src/lib/queries/satpam-jadwal-jaga.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import { getNaiveWibNow } from "@/lib/business-date";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { getSatpamOnDutyNow, type SatpamShiftType, type SatpamJadwalRow } from "@/lib/satpam-shift";

export interface SatpamJadwalDisplayRow extends SatpamJadwalRow {
  satpamNama: string;
  catatan: string | null;
}

interface JadwalJagaDbRow {
  JadwalJagaID: number;
  TanggalUsaha: Date;
  ShiftType: SatpamShiftType;
  SatpamAkunID: number;
  Catatan: string | null;
}

async function attachSatpamNama(rows: JadwalJagaDbRow[]): Promise<SatpamJadwalDisplayRow[]> {
  const nameMap = await getAkunNamaMap(rows.map((r) => r.SatpamAkunID));
  return rows.map((r) => ({
    jadwalJagaId: r.JadwalJagaID,
    tanggalUsaha: r.TanggalUsaha,
    shiftType: r.ShiftType,
    satpamAkunId: r.SatpamAkunID,
    satpamNama: nameMap.get(r.SatpamAkunID) ?? "Akun tidak ditemukan",
    catatan: r.Catatan,
  }));
}

export async function getSatpamJadwalJagaList(startDate: Date, endDate: Date): Promise<SatpamJadwalDisplayRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("startDate", sql.Date, startDate)
    .input("endDate", sql.Date, endDate)
    .query(`
      SELECT JadwalJagaID, TanggalUsaha, ShiftType, SatpamAkunID, Catatan
      FROM DashboardSatpamJadwalJaga
      WHERE IsDeleted = 0 AND TanggalUsaha BETWEEN @startDate AND @endDate
      ORDER BY TanggalUsaha, ShiftType
    `);
  return attachSatpamNama(result.recordset as JadwalJagaDbRow[]);
}

// Ambil TanggalUsaha hari ini DAN kemarin (naive-WIB) supaya shift semalam
// yang masih berjalan (mis. Shift 3/Long Malam yang baru berakhir pagi ini)
// ikut tertangkap -- lihat komentar getSatpamOnDutyNow di satpam-shift.ts.
// `now` default ke getSatpamOnDutyNow's own default (getNaiveWibNow()) --
// TIDAK pernah diberi `new Date()` eksplisit dari pemanggil, supaya
// perbandingannya tetap konsisten naive-WIB (lihat Global Constraints).
export async function getSatpamOnDutyNowRows(now: Date = getNaiveWibNow()): Promise<SatpamJadwalDisplayRow[]> {
  const todayWIB = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayWIB = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const pool = await getPool();
  const result = await pool
    .request()
    .input("yesterdayWIB", sql.Date, yesterdayWIB)
    .input("todayWIB", sql.Date, todayWIB)
    .query(`
      SELECT JadwalJagaID, TanggalUsaha, ShiftType, SatpamAkunID, Catatan
      FROM DashboardSatpamJadwalJaga
      WHERE IsDeleted = 0 AND TanggalUsaha IN (@yesterdayWIB, @todayWIB)
    `);
  const rows = await attachSatpamNama(result.recordset as JadwalJagaDbRow[]);
  return getSatpamOnDutyNow(rows, now);
}

export async function addSatpamJadwalJaga(input: {
  tanggalUsaha: Date;
  shiftType: SatpamShiftType;
  satpamAkunId: number;
  catatan: string | null;
  createdByAkunId: number;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("tanggalUsaha", sql.Date, input.tanggalUsaha)
    .input("shiftType", sql.VarChar(12), input.shiftType)
    .input("satpamAkunId", sql.Int, input.satpamAkunId)
    .input("catatan", sql.VarChar(256), input.catatan)
    .input("createdByAkunId", sql.Int, input.createdByAkunId)
    .query(`
      INSERT INTO DashboardSatpamJadwalJaga (TanggalUsaha, ShiftType, SatpamAkunID, Catatan, CreatedByAkunID)
      VALUES (@tanggalUsaha, @shiftType, @satpamAkunId, @catatan, @createdByAkunId)
    `);
}

export async function removeSatpamJadwalJaga(jadwalJagaId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalJagaId", sql.Int, jadwalJagaId)
    .query(`UPDATE DashboardSatpamJadwalJaga SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalJagaID = @jadwalJagaId`);
}
```

- [ ] **Step 5: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/create-satpam-jadwal-jaga-table.ts src/lib/queries/akun.ts src/lib/queries/satpam-jadwal-jaga.ts
git commit -m "feat: add Satpam duty-roster table and query layer"
```

---

### Task 3: Role gate and Server Actions

**Files:**
- Modify: `src/lib/require-access.ts` (add `requireSatpamRosterManager`, after `requireSatpam` at line 83)
- Create: `src/app/mkesindo/(dashboard)/keamanan/actions.ts`

**Interfaces:**
- Consumes: `WILAYAH_MANAGER_ROLE_IDS` from `@/lib/roles`. `auth` from `@/lib/auth`. `AppError`, `runAction`, `ActionResult` from `@/lib/action-result`. From Task 2: `getSatpamJadwalJagaList`, `getSatpamOnDutyNowRows`, `addSatpamJadwalJaga`, `removeSatpamJadwalJaga`, `SatpamJadwalDisplayRow` (from `@/lib/queries/satpam-jadwal-jaga`). `SatpamShiftType` (from `@/lib/satpam-shift`).
- Produces (consumed by Task 4's UI, and — later — by other sub-projects for `getSatpamOnDutyNowAction`): `requireSatpamRosterManager(): Promise<Session>` (exported from `require-access.ts`). `getSatpamJadwalJagaListAction(startDateISO: string, endDateISO: string): Promise<ActionResult<SatpamJadwalDisplayRow[]>>`, `addSatpamJadwalJagaAction(input: { tanggalUsaha: string; shiftType: SatpamShiftType; satpamAkunId: number; catatan?: string }): Promise<ActionResult<void>>`, `removeSatpamJadwalJagaAction(jadwalJagaId: number): Promise<ActionResult<void>>`, `getSatpamOnDutyNowAction(): Promise<ActionResult<SatpamJadwalDisplayRow[]>>`.

- [ ] **Step 1: Add `requireSatpamRosterManager` to `src/lib/require-access.ts`**

Add the import at the top of the file (alongside the existing `MARKETING_ROLE_ID` import from `@/lib/roles`):

```ts
import { MARKETING_ROLE_ID, WILAYAH_MANAGER_ROLE_IDS } from "@/lib/roles";
```

Add the new function immediately after `requireSatpam` (after line 83):

```ts
// Gerbang /mkesindo/keamanan (admin roster shift Satpam) dan Server Action
// yang mengubah roster (add/remove/list) -- Supervisor/Accounting/Manager/
// Super Admin, sama seperti requireWilayahManager di mitra/actions.ts.
// TIDAK dipakai untuk getSatpamOnDutyNowAction: itu action baca-saja yang
// akan dipanggil dari satpam-app oleh satpam biasa (bukan Supervisor),
// jadi hanya butuh sesi login yang valid, tidak digate role ini.
export async function requireSatpamRosterManager() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isSuperAdmin && !WILAYAH_MANAGER_ROLE_IDS.includes(session.user.roleId)) {
    redirect("/akses-ditolak");
  }
  return session;
}
```

- [ ] **Step 2: Write `src/app/mkesindo/(dashboard)/keamanan/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireSatpamRosterManager } from "@/lib/require-access";
import {
  getSatpamJadwalJagaList,
  getSatpamOnDutyNowRows,
  addSatpamJadwalJaga,
  removeSatpamJadwalJaga,
  type SatpamJadwalDisplayRow,
} from "@/lib/queries/satpam-jadwal-jaga";
import type { SatpamShiftType } from "@/lib/satpam-shift";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getSatpamJadwalJagaListAction(
  startDateISO: string,
  endDateISO: string
): Promise<ActionResult<SatpamJadwalDisplayRow[]>> {
  return runAction(async () => {
    await requireSatpamRosterManager();
    return getSatpamJadwalJagaList(new Date(startDateISO), new Date(endDateISO));
  });
}

export async function addSatpamJadwalJagaAction(input: {
  tanggalUsaha: string;
  shiftType: SatpamShiftType;
  satpamAkunId: number;
  catatan?: string;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireSatpamRosterManager();
    await addSatpamJadwalJaga({
      tanggalUsaha: new Date(input.tanggalUsaha),
      shiftType: input.shiftType,
      satpamAkunId: input.satpamAkunId,
      catatan: input.catatan?.trim() || null,
      createdByAkunId: Number(session.user.id),
    });
    revalidatePath("/mkesindo/keamanan");
  });
}

export async function removeSatpamJadwalJagaAction(jadwalJagaId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireSatpamRosterManager();
    await removeSatpamJadwalJaga(jadwalJagaId);
    revalidatePath("/mkesindo/keamanan");
  });
}

// Tidak digate requireSatpamRosterManager -- ini akan dipanggil dari
// satpam-app (sub-proyek berikutnya) oleh satpam biasa, bukan cuma
// Supervisor. Hanya butuh sesi login yang valid. `now` sengaja TIDAK
// diberikan ke getSatpamOnDutyNowRows -- biarkan default-nya sendiri
// (getNaiveWibNow()) yang jalan, jangan pernah oper `new Date()` di sini.
export async function getSatpamOnDutyNowAction(): Promise<ActionResult<SatpamJadwalDisplayRow[]>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user) throw new AppError("Unauthorized");
    return getSatpamOnDutyNowRows();
  });
}
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/require-access.ts "src/app/mkesindo/(dashboard)/keamanan/actions.ts"
git commit -m "feat: add role gate and Server Actions for the Satpam duty roster"
```

---

### Task 4: Admin page and panel UI

**Files:**
- Create: `src/app/mkesindo/(dashboard)/keamanan/page.tsx`
- Create: `src/components/dashboard/satpam-roster-panel.tsx`

**Interfaces:**
- Consumes: `requireSatpamRosterManager` (from `@/lib/require-access`, Task 3). `getSatpamJadwalJagaListAction`, `addSatpamJadwalJagaAction`, `removeSatpamJadwalJagaAction` (from `@/app/mkesindo/(dashboard)/keamanan/actions`, Task 3). `getSatpamAkunOptions` (from `@/lib/queries/akun`, Task 2). `getSatpamJadwalJagaList` (from `@/lib/queries/satpam-jadwal-jaga`, Task 2, called directly by the page for the initial server-rendered fetch — actions are for the client component's later refetches only). `SATPAM_SHIFT_LIST`, `SATPAM_SHIFT_LABEL`, `SatpamShiftType` (from `@/lib/satpam-shift`, Task 1). `SatpamJadwalDisplayRow` (from `@/lib/queries/satpam-jadwal-jaga`, Task 2). `StafOperasionalOption` (from `@/lib/queries/akun`, already exists).
- Produces: nothing further downstream in this plan — this is the final task.

- [ ] **Step 1: Write `src/app/mkesindo/(dashboard)/keamanan/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireSatpamRosterManager } from "@/lib/require-access";
import { getSatpamAkunOptions } from "@/lib/queries/akun";
import { getSatpamJadwalJagaList } from "@/lib/queries/satpam-jadwal-jaga";
import { SatpamRosterPanel } from "@/components/dashboard/satpam-roster-panel";

export const metadata: Metadata = { title: "Keamanan" };

// Senin minggu berjalan (WIB) -- getUTCDay() 0=Minggu..6=Sabtu, jarak
// mundur ke Senin adalah (getUTCDay()+6)%7 hari. Dibangun via Date.UTC
// component arithmetic saja, mengikuti konvensi naive-WIB seluruh app ini.
function currentWeekRangeISO(): { start: string; end: string } {
  const now = new Date();
  const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const dayOfWeek = wibNow.getUTCDay();
  const backToMonday = (dayOfWeek + 6) % 7;
  const y = wibNow.getUTCFullYear();
  const m = wibNow.getUTCMonth();
  const d = wibNow.getUTCDate();
  const monday = new Date(Date.UTC(y, m, d - backToMonday));
  const sunday = new Date(Date.UTC(y, m, d - backToMonday + 6));
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

export default async function KeamananPage() {
  await requireSatpamRosterManager();
  const range = currentWeekRangeISO();
  const [satpamOptions, rows] = await Promise.all([
    getSatpamAkunOptions(),
    getSatpamJadwalJagaList(new Date(range.start), new Date(range.end)),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-bold">Roster Shift Satpam</h1>
      <SatpamRosterPanel initialRows={rows} satpamOptions={satpamOptions} initialRange={range} />
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/dashboard/satpam-roster-panel.tsx`**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addSatpamJadwalJagaAction,
  removeSatpamJadwalJagaAction,
  getSatpamJadwalJagaListAction,
} from "@/app/mkesindo/(dashboard)/keamanan/actions";
import { SATPAM_SHIFT_LIST, SATPAM_SHIFT_LABEL, type SatpamShiftType } from "@/lib/satpam-shift";
import type { SatpamJadwalDisplayRow } from "@/lib/queries/satpam-jadwal-jaga";
import type { StafOperasionalOption } from "@/lib/queries/akun";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnlyISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Panel admin roster shift Satpam -- form tambah + daftar dikelompokkan per
// tanggal, ditaruh langsung di halaman /mkesindo/keamanan (bukan di dalam
// Dialog seperti MarketingWilayahPanel, karena halaman ini SATU-SATUNYA isi
// halaman itu, bukan fitur tambahan di atas halaman lain yang sudah padat).
export function SatpamRosterPanel({
  initialRows,
  satpamOptions,
  initialRange,
}: {
  initialRows: SatpamJadwalDisplayRow[];
  satpamOptions: StafOperasionalOption[];
  initialRange: { start: string; end: string };
}) {
  const [rows, setRows] = useState(initialRows);
  const [range, setRange] = useState(initialRange);
  const [tanggal, setTanggal] = useState(todayISO());
  const [shiftType, setShiftType] = useState<SatpamShiftType | "">("");
  const [satpamAkunId, setSatpamAkunId] = useState("");
  const [catatan, setCatatan] = useState("");
  const [pending, startTransition] = useTransition();
  const [filterPending, startFilterTransition] = useTransition();
  const [removingId, setRemovingId] = useState<number | null>(null);

  function resetForm() {
    setShiftType("");
    setSatpamAkunId("");
    setCatatan("");
  }

  function refetchRange(nextRange: { start: string; end: string }) {
    startFilterTransition(async () => {
      const result = await getSatpamJadwalJagaListAction(nextRange.start, nextRange.end);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setRows(result.data);
      setRange(nextRange);
    });
  }

  function handleAdd() {
    if (!tanggal || !shiftType || !satpamAkunId) {
      toast.error("Pilih Tanggal, Tipe Shift, dan Satpam.");
      return;
    }
    startTransition(async () => {
      const result = await addSatpamJadwalJagaAction({
        tanggalUsaha: tanggal,
        shiftType,
        satpamAkunId: Number(satpamAkunId),
        catatan: catatan || undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      resetForm();
      refetchRange(range);
    });
  }

  function handleRemove(id: number) {
    setRemovingId(id);
    startTransition(async () => {
      const result = await removeSatpamJadwalJagaAction(id);
      if (!result.success) {
        toast.error(result.error);
      } else {
        refetchRange(range);
      }
      setRemovingId(null);
    });
  }

  // Peringatan tabrakan -- dihitung dari `rows` yang SUDAH dimuat untuk
  // rentang filter yang sedang aktif, bukan query tambahan ke server. Kalau
  // tanggal yang mau ditambahkan berada di luar rentang filter yang sedang
  // ditampilkan, peringatan ini tidak akan muncul -- keterbatasan yang
  // disengaja, lihat spec.
  const collision = useMemo(() => {
    if (!tanggal || !shiftType) return undefined;
    return rows.find((r) => dateOnlyISO(r.tanggalUsaha) === tanggal && r.shiftType === shiftType);
  }, [rows, tanggal, shiftType]);

  const groupedByDate = useMemo(() => {
    const byDate = new Map<string, SatpamJadwalDisplayRow[]>();
    for (const row of rows) {
      const key = dateOnlyISO(row.tanggalUsaha);
      const list = byDate.get(key) ?? [];
      list.push(row);
      byDate.set(key, list);
    }
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border bg-secondary/30 p-4">
        <h3 className="text-sm font-semibold">Tambah Jadwal Jaga</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex w-40 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tanggal</span>
            <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          </div>
          <div className="flex w-56 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tipe Shift</span>
            <Select value={shiftType} onValueChange={(v) => setShiftType((v as SatpamShiftType) ?? "")}>
              <SelectTrigger className="w-full" aria-label="Tipe Shift">
                <SelectValue placeholder="Pilih tipe shift">
                  {(v: string) => SATPAM_SHIFT_LABEL[v as SatpamShiftType] ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SATPAM_SHIFT_LIST.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SATPAM_SHIFT_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-48 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Satpam</span>
            <Select value={satpamAkunId} onValueChange={(v) => setSatpamAkunId(v ?? "")}>
              <SelectTrigger className="w-full" aria-label="Satpam">
                <SelectValue placeholder="Pilih Satpam">
                  {(v: string) => satpamOptions.find((o) => String(o.akunId) === v)?.nama ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {satpamOptions.map((o) => (
                  <SelectItem key={o.akunId} value={String(o.akunId)}>
                    {o.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-56 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Catatan (opsional)
            </span>
            <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Mis. pengganti sementara" />
          </div>
          <Button type="button" disabled={pending} onClick={handleAdd}>
            Tambah
          </Button>
        </div>
        {collision && (
          <p className="text-xs text-amber-600">
            Slot ini sudah diisi oleh {collision.satpamNama} — menambah lagi tetap diizinkan, tidak akan diblokir.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex w-40 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Dari Tanggal</span>
            <Input type="date" value={range.start} onChange={(e) => refetchRange({ ...range, start: e.target.value })} />
          </div>
          <div className="flex w-40 flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Sampai Tanggal</span>
            <Input type="date" value={range.end} onChange={(e) => refetchRange({ ...range, end: e.target.value })} />
          </div>
          {filterPending && <span className="text-xs text-muted-foreground">Memuat...</span>}
        </div>

        {groupedByDate.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada jadwal jaga pada rentang tanggal ini.</p>
        ) : (
          groupedByDate.map(([dateISO, dateRows]) => (
            <div key={dateISO} className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">
                {new Date(dateISO).toLocaleDateString("id-ID", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <div className="flex flex-col gap-2">
                {dateRows.map((row) => (
                  <div
                    key={row.jadwalJagaId}
                    className="flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-3 py-2"
                  >
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {SATPAM_SHIFT_LABEL[row.shiftType]}
                      </span>
                      <span className="text-sm">{row.satpamNama}</span>
                      {row.catatan && <span className="text-xs text-muted-foreground">{row.catatan}</span>}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={pending && removingId === row.jadwalJagaId}
                      onClick={() => handleRemove(row.jadwalJagaId)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 4: Manual browser verification**

Open `/mkesindo/keamanan` logged in as a Supervisor/Accounting/Manager/Super Admin account (NOT an `isSatpam` account — that would hit the unrelated redirect at `src/app/mkesindo/(dashboard)/layout.tsx:38` before this page's own gate even runs). Confirm:
1. The page loads with the current week's range pre-filled and any existing rows (if seeded) grouped by date.
2. Adding a row (Tanggal + Tipe Shift + Satpam, Catatan optional) succeeds and the new row appears in the list without a full page reload.
3. Adding a second row for the same Tanggal + Tipe Shift shows the amber collision warning, but the Tambah button still works.
4. Removing a row makes it disappear from the list.
5. Changing "Dari Tanggal"/"Sampai Tanggal" refetches and shows only rows in the new range.
6. Logging in as an account that is NOT Supervisor/Accounting/Manager/Super Admin and NOT `isSuperAdmin` and visiting `/mkesindo/keamanan` redirects to `/akses-ditolak`.

If no such test account is available in this environment, fall back to a careful code read tracing the exact same checklist against the written source (role gate logic, the add/remove/refetch handlers, and the collision-detection `useMemo`) instead of skipping this step silently.

- [ ] **Step 5: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/keamanan/page.tsx" src/components/dashboard/satpam-roster-panel.tsx
git commit -m "feat: add /mkesindo/keamanan admin page for the Satpam duty roster"
```
