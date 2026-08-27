# Modul Laporan — Fondasi Cutoff-Shift & Tahap 1 (Stok Bahan Baku) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared shift-cutoff utility every future "Modul Laporan"
stage will use, plus the first concrete stage: a `/mkesindo/laporan` page
where a new "Staf Operasional" Peran logs per-shift Kantong
Plastik/Ikat Kabel stock movements, a new "Bahan Baku" tab in `produksi-app`
where Staf Produksi logs usage/damage, and running stock balances computed
live from the full shift history.

**Architecture:** One new MSSQL table pair
(`DashboardStokBahanBakuShift` + `DashboardStokBahanBakuSaldoAwal`) holding
only raw per-shift numbers; a SQL window-function query computes running
balances at read time so edits to old shifts never leave later balances
stale. Staf Operasional gets access via the existing generic
module-permission grid (new `"laporan"` module key) — no new role flag, no
new app shell. Staf Produksi keeps using `isProduksi`/`produksi-app`, with
one new tab added to the existing tab-shell.

**Tech Stack:** Next.js Server Actions, `mssql` (`getPool`/`sql`), existing
`ActionResult<T>`/`runAction()`/`AppError` pattern, existing shadcn/ui
components, `getBusinessDateWithRollover` from `business-date.ts`.

**Spec:** [`docs/superpowers/specs/2026-08-27-modul-laporan-stok-bahan-baku-design.md`](../specs/2026-08-27-modul-laporan-stok-bahan-baku-design.md)

## Global Constraints

- No `operasional-app`, no `isOperasional` flag anywhere (Postgres,
  `auth.ts`, `next-auth.d.ts`) — Staf Operasional access is purely the
  `"laporan"` module-permission grid, exactly like every other desktop
  module.
- `DashboardStokBahanBakuShift`/`DashboardStokBahanBakuSaldoAwal` live in
  **MSSQL** (via `getPool()`/`sql` from `@/lib/db`), not Postgres — no
  desktop-ERP counterpart, matching `DashboardProduksiBatch`/
  `DashboardPengirimanBBM`'s own precedent.
- Running balances (`SisaGudangAkhir`/`SisaInventoriAkhir`) are **never**
  stored as columns — always computed at read time via the SQL window
  function in Task 3, so an edit to any historical shift is automatically
  reflected everywhere without a manual recompute step.
- Cutoff-kerja (`"work"`, rollover 15:00 WIB) is what Tahap 1 uses
  end-to-end. Cutoff-jual (`"sales"`, rollover 14:00 WIB — same as the
  existing `ROLLOVER_HOUR`) is built in `report-shift.ts` too but has no
  caller yet in this plan; do not skip implementing it just because
  nothing calls it yet, later Modul Laporan stages depend on it.
- `report-shift.ts`'s `getShiftWindow` returns **naive-WIB** Dates (raw
  UTC-component values ARE the WIB wall-clock value — same convention as
  `getNaiveWibTransDate`/`combineDateAndTime` in `business-date.ts`).
  Never compare these against a true-UTC value (e.g.
  `DashboardPengirimanJadwal.JamJadwal`) without going through
  `naiveWibToUtcInstant()`/`utcInstantToWibDisplay()` first.
- No test framework exists in this repo — verify with `npx tsc --noEmit`
  plus a throwaway `npx tsx` scratch script against the real dev DB for
  anything that touches SQL, then delete the scratch script. This mirrors
  how every other DB-touching change in this codebase has been verified.
- Work happens directly on `main` (standing arrangement for this repo,
  already in effect all session) — commit at the end of each task, push
  only when the user explicitly says so.

---

### Task 1: `report-shift.ts` foundation

**Files:**
- Create: `src/lib/report-shift.ts`
- Test (scratch, delete after use): `scratch-verify-report-shift.ts`

**Interfaces:**
- Produces: `ReportShiftKind` ("sales" | "work"), `ShiftNumber` (1 | 2 | 3),
  `getShiftNumber(wibHour: number, kind: ReportShiftKind): ShiftNumber`,
  `getReportShift(kind: ReportShiftKind, now?: Date): { shift: ShiftNumber; businessDate: Date }`,
  `getShiftWindow(businessDate: Date, shift: ShiftNumber, kind: ReportShiftKind): { start: Date; end: Date }`,
  `SHIFT_LABEL_WITH_HOUR(shift, kind)` display helper. Consumed by every
  later task in this plan.
- Consumes: `getBusinessDateWithRollover` from `@/lib/business-date`
  ([`business-date.ts:35`](../../../src/lib/business-date.ts)).

- [ ] **Step 1: Write `src/lib/report-shift.ts`**

```ts
import { getBusinessDateWithRollover } from "@/lib/business-date";

const WIB_TIME_ZONE = "Asia/Jakarta";

export type ReportShiftKind = "sales" | "work";
export type ShiftNumber = 1 | 2 | 3;

// The hour WIB where Shift 1 ends and Shift 2 begins — the only boundary
// that differs between the two kinds (Shift 2↔3 at 23:00 and Shift 3↔1 at
// 07:00 are identical for both). "sales" matches the pre-existing
// ROLLOVER_HOUR (14:00); "work" is the shift-cutoff table's own 15:00.
export const REPORT_SHIFT_ROLLOVER_HOUR: Record<ReportShiftKind, number> = {
  sales: 14,
  work: 15,
};

function getWibHour(now: Date): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: WIB_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  });
  return Number(formatter.format(now)) % 24;
}

// Which shift (1/2/3) a WIB hour-of-day falls into. Shift1: 07:00 up to
// (rolloverHour-1):59. Shift2: rolloverHour:00 up to 22:59. Shift3: 23:00
// up to 06:59 (wraps past midnight).
export function getShiftNumber(wibHour: number, kind: ReportShiftKind): ShiftNumber {
  const shift2Start = REPORT_SHIFT_ROLLOVER_HOUR[kind];
  if (wibHour >= 23 || wibHour < 7) return 3;
  if (wibHour < shift2Start) return 1;
  return 2;
}

// Which shift + business-date label `now` belongs to. businessDate reuses
// getBusinessDateWithRollover with the SAME rollover hour as the shift
// boundary above, so both stay consistent by construction (a shift-2
// instant, hour >= rolloverHour, always lands on businessDate+1 — see the
// spec's worked example).
export function getReportShift(kind: ReportShiftKind, now: Date = new Date()): { shift: ShiftNumber; businessDate: Date } {
  const wibHour = getWibHour(now);
  return {
    shift: getShiftNumber(wibHour, kind),
    businessDate: getBusinessDateWithRollover(REPORT_SHIFT_ROLLOVER_HOUR[kind], now),
  };
}

// Real-time [start, end] window (naive-WIB Dates — see this plan's Global
// Constraints) that a given (businessDate, shift, kind) covers. Shift 2
// and Shift 3 both fall on the calendar day BEFORE businessDate (Shift 2
// starts the cycle, Shift 3 continues it overnight); only Shift 1 falls on
// businessDate itself — see the spec's "urutan kronologis" note. Date.UTC's
// automatic day/month/year normalization (day: -1) handles month/year
// boundaries the same way shiftDateISO already relies on elsewhere.
export function getShiftWindow(businessDate: Date, shift: ShiftNumber, kind: ReportShiftKind): { start: Date; end: Date } {
  const shift2Start = REPORT_SHIFT_ROLLOVER_HOUR[kind];
  const y = businessDate.getUTCFullYear();
  const m = businessDate.getUTCMonth();
  const d = businessDate.getUTCDate();
  if (shift === 1) {
    return {
      start: new Date(Date.UTC(y, m, d, 7, 0, 0)),
      end: new Date(Date.UTC(y, m, d, shift2Start - 1, 59, 59)),
    };
  }
  if (shift === 2) {
    return {
      start: new Date(Date.UTC(y, m, d - 1, shift2Start, 0, 0)),
      end: new Date(Date.UTC(y, m, d - 1, 22, 59, 59)),
    };
  }
  return {
    start: new Date(Date.UTC(y, m, d - 1, 23, 0, 0)),
    end: new Date(Date.UTC(y, m, d, 6, 59, 59)),
  };
}

const SHIFT_START_HOUR_LABEL: Record<ReportShiftKind, Record<ShiftNumber, number>> = {
  work: { 1: 7, 2: 15, 3: 23 },
  sales: { 1: 7, 2: 14, 3: 23 },
};

// Display label, e.g. "Shift 2 (15:00)" — matches SHIFT_LABEL's existing
// "Shift 2 (15:00)" style in produksi-shift.ts, parameterized by kind.
export function getShiftLabel(shift: ShiftNumber, kind: ReportShiftKind): string {
  const hour = SHIFT_START_HOUR_LABEL[kind][shift];
  return `Shift ${shift} (${String(hour).padStart(2, "0")}:00)`;
}
```

- [ ] **Step 2: Verify with a throwaway script**

Write `scratch-verify-report-shift.ts` at the repo root:

```ts
import { getReportShift, getShiftWindow, getShiftLabel } from "./src/lib/report-shift";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`FAIL ${label}: got ${a}, expected ${e}`);
  console.log(`OK ${label}`);
}

// 27/08/2026 real-time instants from the spec's worked example.
assertEqual(getReportShift("work", new Date("2026-08-26T08:00:00Z")).shift, 2, "work shift2 real 26/08 15:00 WIB"); // 08:00Z = 15:00 WIB
assertEqual(getReportShift("work", new Date("2026-08-26T08:00:00Z")).businessDate.toISOString().slice(0, 10), "2026-08-27", "work shift2 businessDate");
assertEqual(getReportShift("work", new Date("2026-08-26T17:00:00Z")).shift, 3, "work shift3 real 27/08 00:00 WIB"); // 17:00Z = 00:00 WIB next day
assertEqual(getReportShift("work", new Date("2026-08-27T00:00:00Z")).shift, 1, "work shift1 real 27/08 07:00 WIB"); // 00:00Z = 07:00 WIB
assertEqual(getReportShift("sales", new Date("2026-08-26T07:00:00Z")).shift, 2, "sales shift2 real 26/08 14:00 WIB"); // 07:00Z = 14:00 WIB
assertEqual(getReportShift("sales", new Date("2026-08-27T00:00:00Z")).shift, 1, "sales shift1 real 27/08 07:00 WIB");

const d = new Date(Date.UTC(2026, 7, 27));
assertEqual(getShiftWindow(d, 1, "work"), { start: new Date(Date.UTC(2026, 7, 27, 7, 0, 0)), end: new Date(Date.UTC(2026, 7, 27, 14, 59, 59)) }, "work shift1 window");
assertEqual(getShiftWindow(d, 2, "work"), { start: new Date(Date.UTC(2026, 7, 26, 15, 0, 0)), end: new Date(Date.UTC(2026, 7, 26, 22, 59, 59)) }, "work shift2 window");
assertEqual(getShiftWindow(d, 3, "work"), { start: new Date(Date.UTC(2026, 7, 26, 23, 0, 0)), end: new Date(Date.UTC(2026, 7, 27, 6, 59, 59)) }, "work shift3 window");
assertEqual(getShiftWindow(d, 1, "sales"), { start: new Date(Date.UTC(2026, 7, 27, 7, 0, 0)), end: new Date(Date.UTC(2026, 7, 27, 13, 59, 59)) }, "sales shift1 window");
assertEqual(getShiftWindow(d, 2, "sales"), { start: new Date(Date.UTC(2026, 7, 26, 14, 0, 0)), end: new Date(Date.UTC(2026, 7, 26, 22, 59, 59)) }, "sales shift2 window");

assertEqual(getShiftLabel(2, "work"), "Shift 2 (15:00)", "work shift2 label");
assertEqual(getShiftLabel(2, "sales"), "Shift 2 (14:00)", "sales shift2 label");

console.log("ALL PASSED");
```

Run: `npx tsx scratch-verify-report-shift.ts`
Expected: every line prints `OK ...`, ending with `ALL PASSED`. If any
`FAIL` line prints, fix `report-shift.ts` (not the script — the script
encodes the spec's own worked example) and re-run.

- [ ] **Step 3: Delete the scratch script and type-check**

```bash
rm -f scratch-verify-report-shift.ts
npx tsc --noEmit
```

Expected: no output (no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/report-shift.ts
git commit -m "feat: add report-shift cutoff foundation for Modul Laporan"
```

---

### Task 2: MSSQL tables for Tahap 1

**Files:**
- Create: `scripts/create-stok-bahan-baku-tables.ts`

**Interfaces:**
- Produces: tables `DashboardStokBahanBakuShift`,
  `DashboardStokBahanBakuSaldoAwal` (3 seed rows: `'Plastik10KG'`,
  `'Plastik5KG'`, `'IkatKabel'`). Consumed by Task 3's queries.

- [ ] **Step 1: Write the migration script**

```ts
// One-off table creation for Modul Laporan Tahap 1 (Stok Bahan Baku) —
// idempotent, safe to re-run. Usage:
// npx tsx scripts/create-stok-bahan-baku-tables.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardStokBahanBakuShift' AND xtype='U')
    CREATE TABLE DashboardStokBahanBakuShift (
      StokBahanBakuID                BIGINT IDENTITY PRIMARY KEY,
      TanggalUsaha                   DATE NOT NULL,
      Shift                          TINYINT NOT NULL,
      ShiftMulai                     DATETIME NOT NULL,
      JenisBarang                    VARCHAR(20) NOT NULL,
      StokMasukGudang                INT NOT NULL DEFAULT 0,
      StokMasukInventoriOperasional  INT NOT NULL DEFAULT 0,
      StokDipakaiProduksi            INT NOT NULL DEFAULT 0,
      StokRusakProduksi              INT NOT NULL DEFAULT 0,
      OperasionalAkunID              INT NULL,
      OperasionalDiisiPada           DATETIME NULL,
      ProduksiAkunID                 INT NULL,
      ProduksiDiisiPada              DATETIME NULL,
      CreatedDate                    DATETIME NOT NULL DEFAULT GETDATE(),
      ModifiedDate                   DATETIME NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_StokBahanBakuShift UNIQUE (TanggalUsaha, Shift, JenisBarang)
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardStokBahanBakuSaldoAwal' AND xtype='U')
    CREATE TABLE DashboardStokBahanBakuSaldoAwal (
      JenisBarang                     VARCHAR(20) NOT NULL PRIMARY KEY,
      SaldoAwalGudang                 INT NOT NULL DEFAULT 0,
      SaldoAwalInventoriOperasional   INT NOT NULL DEFAULT 0,
      DiisiOlehAkunID                 INT NULL,
      ModifiedDate                    DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  for (const jenis of ["Plastik10KG", "Plastik5KG", "IkatKabel"]) {
    await pool.request().input("jenis", jenis).query(`
      IF NOT EXISTS (SELECT * FROM DashboardStokBahanBakuSaldoAwal WHERE JenisBarang = @jenis)
      INSERT INTO DashboardStokBahanBakuSaldoAwal (JenisBarang) VALUES (@jenis)
    `);
  }

  console.log("DashboardStokBahanBakuShift + DashboardStokBahanBakuSaldoAwal ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the dev DB**

```bash
npx tsx scripts/create-stok-bahan-baku-tables.ts
```

Expected: prints the ready message. Re-run once more to confirm it's a
no-op the second time (idempotency).

- [ ] **Step 3: Commit**

```bash
git add scripts/create-stok-bahan-baku-tables.ts
git commit -m "feat: add DashboardStokBahanBakuShift/SaldoAwal tables"
```

---

### Task 3: `src/lib/queries/stok-bahan-baku.ts`

**Files:**
- Create: `src/lib/queries/stok-bahan-baku.ts`
- Test (scratch, delete after use): `scratch-verify-stok-bahan-baku.ts`

**Interfaces:**
- Consumes: `getPool`, `sql` from `@/lib/db`; `getReportShift`,
  `getShiftWindow`, `getShiftLabel` from `@/lib/report-shift` (Task 1);
  the tables from Task 2.
- Produces: `JenisBarang`, `JENIS_BARANG_LIST`, `JENIS_BARANG_LABEL`,
  `JENIS_BARANG_UNIT_BUNDLE`, `StokBahanBakuRow`, `CurrentShiftInfo`,
  `SaldoAwalRow`, `getStokBahanBakuHistory(limit?)`,
  `getCurrentShiftRows()`, `getSaldoAwal()`, `setSaldoAwal(...)`,
  `upsertOperasionalStok(...)`, `upsertProduksiStok(...)`. Consumed by
  Tasks 5 and 7.

- [ ] **Step 1: Write the query module**

```ts
import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";

export type JenisBarang = "Plastik10KG" | "Plastik5KG" | "IkatKabel";

export const JENIS_BARANG_LIST: JenisBarang[] = ["Plastik10KG", "Plastik5KG", "IkatKabel"];

export const JENIS_BARANG_LABEL: Record<JenisBarang, string> = {
  Plastik10KG: "Kantong Plastik 10 KG",
  Plastik5KG: "Kantong Plastik 5 KG",
  IkatKabel: "Ikat Kabel",
};

// 1 unit = 100 lembar/pcs for every JenisBarang — "Bundle" for plastik,
// "Pack" for ikat kabel (same ceil(qty/100) math either way, see toBundle).
export const JENIS_BARANG_UNIT_BUNDLE: Record<JenisBarang, string> = {
  Plastik10KG: "Bundle",
  Plastik5KG: "Bundle",
  IkatKabel: "Pack",
};

// ceil(lembar/100), display-only — never stored. 0 lembar = 0 bundle, 100
// lembar tepat = 1 bundle, 101 = 2.
export function toBundle(lembar: number): number {
  return lembar <= 0 ? 0 : Math.ceil(lembar / 100);
}

export interface StokBahanBakuRow {
  stokBahanBakuId: number | null; // null when synthesized for a shift with no row yet
  tanggalUsaha: string; // "YYYY-MM-DD"
  shift: ShiftNumber;
  shiftMulai: Date;
  jenisBarang: JenisBarang;
  stokMasukGudang: number;
  stokMasukInventoriOperasional: number;
  stokDipakaiProduksi: number;
  stokRusakProduksi: number;
  operasionalAkunId: number | null;
  operasionalDiisiPada: Date | null;
  produksiAkunId: number | null;
  produksiDiisiPada: Date | null;
  sisaGudangAkhir: number;
  sisaInventoriAkhir: number;
}

export interface CurrentShiftInfo {
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
}

export interface SaldoAwalRow {
  jenisBarang: JenisBarang;
  saldoAwalGudang: number;
  saldoAwalInventoriOperasional: number;
}

interface RawRow {
  StokBahanBakuID: number;
  TanggalUsaha: Date;
  Shift: number;
  ShiftMulai: Date;
  JenisBarang: JenisBarang;
  StokMasukGudang: number;
  StokMasukInventoriOperasional: number;
  StokDipakaiProduksi: number;
  StokRusakProduksi: number;
  OperasionalAkunID: number | null;
  OperasionalDiisiPada: Date | null;
  ProduksiAkunID: number | null;
  ProduksiDiisiPada: Date | null;
  SisaGudangAkhir: number;
  SisaInventoriAkhir: number;
}

function mapRow(r: RawRow): StokBahanBakuRow {
  return {
    stokBahanBakuId: r.StokBahanBakuID,
    tanggalUsaha: r.TanggalUsaha.toISOString().slice(0, 10),
    shift: r.Shift as ShiftNumber,
    shiftMulai: r.ShiftMulai,
    jenisBarang: r.JenisBarang,
    stokMasukGudang: r.StokMasukGudang,
    stokMasukInventoriOperasional: r.StokMasukInventoriOperasional,
    stokDipakaiProduksi: r.StokDipakaiProduksi,
    stokRusakProduksi: r.StokRusakProduksi,
    operasionalAkunId: r.OperasionalAkunID,
    operasionalDiisiPada: r.OperasionalDiisiPada,
    produksiAkunId: r.ProduksiAkunID,
    produksiDiisiPada: r.ProduksiDiisiPada,
    sisaGudangAkhir: r.SisaGudangAkhir,
    sisaInventoriAkhir: r.SisaInventoriAkhir,
  };
}

export async function getSaldoAwal(): Promise<SaldoAwalRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT JenisBarang, SaldoAwalGudang, SaldoAwalInventoriOperasional FROM DashboardStokBahanBakuSaldoAwal
  `);
  return (result.recordset as { JenisBarang: JenisBarang; SaldoAwalGudang: number; SaldoAwalInventoriOperasional: number }[]).map((r) => ({
    jenisBarang: r.JenisBarang,
    saldoAwalGudang: r.SaldoAwalGudang,
    saldoAwalInventoriOperasional: r.SaldoAwalInventoriOperasional,
  }));
}

export async function setSaldoAwal(
  jenisBarang: JenisBarang,
  saldoAwalGudang: number,
  saldoAwalInventoriOperasional: number,
  akunId: number
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jenisBarang", sql.VarChar(20), jenisBarang)
    .input("saldoAwalGudang", sql.Int, saldoAwalGudang)
    .input("saldoAwalInventoriOperasional", sql.Int, saldoAwalInventoriOperasional)
    .input("akunId", sql.Int, akunId).query(`
      UPDATE DashboardStokBahanBakuSaldoAwal
      SET SaldoAwalGudang = @saldoAwalGudang,
          SaldoAwalInventoriOperasional = @saldoAwalInventoriOperasional,
          DiisiOlehAkunID = @akunId,
          ModifiedDate = GETDATE()
      WHERE JenisBarang = @jenisBarang
    `);
}

// Full shift history (newest first) with running balances computed via a
// window function partitioned per JenisBarang — see this plan's Global
// Constraints on why balances are never stored. `limit` caps how many
// SHIFT ROWS come back per call (not per JenisBarang), matching how the
// desktop table/riwayat views page through it.
export async function getStokBahanBakuHistory(limit = 90): Promise<StokBahanBakuRow[]> {
  const pool = await getPool();
  const result = await pool.request().input("limit", sql.Int, limit).query(`
    SELECT TOP (@limit) *
    FROM (
      SELECT
        s.StokBahanBakuID, s.TanggalUsaha, s.Shift, s.ShiftMulai, s.JenisBarang,
        s.StokMasukGudang, s.StokMasukInventoriOperasional, s.StokDipakaiProduksi, s.StokRusakProduksi,
        s.OperasionalAkunID, s.OperasionalDiisiPada, s.ProduksiAkunID, s.ProduksiDiisiPada,
        sa.SaldoAwalGudang + SUM(s.StokMasukGudang - s.StokMasukInventoriOperasional)
          OVER (PARTITION BY s.JenisBarang ORDER BY s.ShiftMulai ROWS UNBOUNDED PRECEDING) AS SisaGudangAkhir,
        sa.SaldoAwalInventoriOperasional + SUM(s.StokMasukInventoriOperasional - s.StokDipakaiProduksi - s.StokRusakProduksi)
          OVER (PARTITION BY s.JenisBarang ORDER BY s.ShiftMulai ROWS UNBOUNDED PRECEDING) AS SisaInventoriAkhir
      FROM DashboardStokBahanBakuShift s
      JOIN DashboardStokBahanBakuSaldoAwal sa ON sa.JenisBarang = s.JenisBarang
    ) x
    ORDER BY x.ShiftMulai DESC
  `);
  return (result.recordset as RawRow[]).map(mapRow);
}

// Current work-shift row per JenisBarang — synthesizes a zero-valued row
// (stokBahanBakuId: null) for any JenisBarang with no row yet this shift,
// carrying forward the latest known running balance (or SaldoAwal if this
// JenisBarang has no history at all yet) so the UI always has a sensible
// starting point to display before anyone has typed anything.
export async function getCurrentShiftRows(): Promise<{ current: CurrentShiftInfo; rows: StokBahanBakuRow[] }> {
  const { shift, businessDate } = getReportShift("work");
  const tanggalUsaha = businessDate.toISOString().slice(0, 10);
  const [history, saldoAwal] = await Promise.all([getStokBahanBakuHistory(), getSaldoAwal()]);
  const saldoAwalMap = new Map(saldoAwal.map((s) => [s.jenisBarang, s]));

  const rows: StokBahanBakuRow[] = JENIS_BARANG_LIST.map((jenisBarang) => {
    const existing = history.find((r) => r.tanggalUsaha === tanggalUsaha && r.shift === shift && r.jenisBarang === jenisBarang);
    if (existing) return existing;
    // history is ORDER BY ShiftMulai DESC — the first match for this
    // jenisBarang is the latest existing shift strictly before this one.
    const previous = history.find((r) => r.jenisBarang === jenisBarang);
    const saldo = saldoAwalMap.get(jenisBarang);
    return {
      stokBahanBakuId: null,
      tanggalUsaha,
      shift,
      shiftMulai: getShiftWindow(businessDate, shift, "work").start,
      jenisBarang,
      stokMasukGudang: 0,
      stokMasukInventoriOperasional: 0,
      stokDipakaiProduksi: 0,
      stokRusakProduksi: 0,
      operasionalAkunId: null,
      operasionalDiisiPada: null,
      produksiAkunId: null,
      produksiDiisiPada: null,
      sisaGudangAkhir: previous?.sisaGudangAkhir ?? saldo?.saldoAwalGudang ?? 0,
      sisaInventoriAkhir: previous?.sisaInventoriAkhir ?? saldo?.saldoAwalInventoriOperasional ?? 0,
    };
  });

  return { current: { tanggalUsaha, shift, shiftLabel: getShiftLabel(shift, "work") }, rows };
}

export interface UpsertOperasionalStokInput {
  tanggalUsaha: string;
  shift: ShiftNumber;
  jenisBarang: JenisBarang;
  stokMasukGudang: number;
  stokMasukInventoriOperasional: number;
  akunId: number;
}

export async function upsertOperasionalStok(input: UpsertOperasionalStokInput): Promise<void> {
  const pool = await getPool();
  const businessDate = new Date(`${input.tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, input.shift, "work").start;
  await pool
    .request()
    .input("tanggalUsaha", sql.Date, input.tanggalUsaha)
    .input("shift", sql.TinyInt, input.shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("jenisBarang", sql.VarChar(20), input.jenisBarang)
    .input("stokMasukGudang", sql.Int, input.stokMasukGudang)
    .input("stokMasukInventoriOperasional", sql.Int, input.stokMasukInventoriOperasional)
    .input("akunId", sql.Int, input.akunId).query(`
      MERGE DashboardStokBahanBakuShift AS target
      USING (SELECT @tanggalUsaha AS TanggalUsaha, @shift AS Shift, @jenisBarang AS JenisBarang) AS src
      ON target.TanggalUsaha = src.TanggalUsaha AND target.Shift = src.Shift AND target.JenisBarang = src.JenisBarang
      WHEN MATCHED THEN UPDATE SET
        StokMasukGudang = @stokMasukGudang,
        StokMasukInventoriOperasional = @stokMasukInventoriOperasional,
        OperasionalAkunID = @akunId,
        OperasionalDiisiPada = GETDATE(),
        ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT
        (TanggalUsaha, Shift, ShiftMulai, JenisBarang, StokMasukGudang, StokMasukInventoriOperasional, OperasionalAkunID, OperasionalDiisiPada)
        VALUES (@tanggalUsaha, @shift, @shiftMulai, @jenisBarang, @stokMasukGudang, @stokMasukInventoriOperasional, @akunId, GETDATE());
    `);
}

export interface UpsertProduksiStokInput {
  tanggalUsaha: string;
  shift: ShiftNumber;
  jenisBarang: JenisBarang;
  stokDipakaiProduksi: number;
  stokRusakProduksi: number;
  akunId: number;
}

export async function upsertProduksiStok(input: UpsertProduksiStokInput): Promise<void> {
  const pool = await getPool();
  const businessDate = new Date(`${input.tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, input.shift, "work").start;
  await pool
    .request()
    .input("tanggalUsaha", sql.Date, input.tanggalUsaha)
    .input("shift", sql.TinyInt, input.shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("jenisBarang", sql.VarChar(20), input.jenisBarang)
    .input("stokDipakaiProduksi", sql.Int, input.stokDipakaiProduksi)
    .input("stokRusakProduksi", sql.Int, input.stokRusakProduksi)
    .input("akunId", sql.Int, input.akunId).query(`
      MERGE DashboardStokBahanBakuShift AS target
      USING (SELECT @tanggalUsaha AS TanggalUsaha, @shift AS Shift, @jenisBarang AS JenisBarang) AS src
      ON target.TanggalUsaha = src.TanggalUsaha AND target.Shift = src.Shift AND target.JenisBarang = src.JenisBarang
      WHEN MATCHED THEN UPDATE SET
        StokDipakaiProduksi = @stokDipakaiProduksi,
        StokRusakProduksi = @stokRusakProduksi,
        ProduksiAkunID = @akunId,
        ProduksiDiisiPada = GETDATE(),
        ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT
        (TanggalUsaha, Shift, ShiftMulai, JenisBarang, StokDipakaiProduksi, StokRusakProduksi, ProduksiAkunID, ProduksiDiisiPada)
        VALUES (@tanggalUsaha, @shift, @shiftMulai, @jenisBarang, @stokDipakaiProduksi, @stokRusakProduksi, @akunId, GETDATE());
    `);
}
```

- [ ] **Step 2: Verify against the real dev DB with a throwaway script**

Write `scratch-verify-stok-bahan-baku.ts` at the repo root:

```ts
import "dotenv/config";
import {
  getCurrentShiftRows,
  upsertOperasionalStok,
  upsertProduksiStok,
  getStokBahanBakuHistory,
  toBundle,
} from "./src/lib/queries/stok-bahan-baku";

async function main() {
  console.log("toBundle checks:", toBundle(0), toBundle(100), toBundle(101), toBundle(150), toBundle(200));
  // expect: 0 1 2 2 2

  const before = await getCurrentShiftRows();
  console.log("Current shift:", before.current);
  console.log("Rows before:", before.rows.map((r) => `${r.jenisBarang}: masuk=${r.stokMasukGudang} sisaGudang=${r.sisaGudangAkhir}`));

  await upsertOperasionalStok({
    tanggalUsaha: before.current.tanggalUsaha,
    shift: before.current.shift,
    jenisBarang: "Plastik10KG",
    stokMasukGudang: 500,
    stokMasukInventoriOperasional: 200,
    akunId: 1,
  });
  await upsertProduksiStok({
    tanggalUsaha: before.current.tanggalUsaha,
    shift: before.current.shift,
    jenisBarang: "Plastik10KG",
    stokDipakaiProduksi: 50,
    stokRusakProduksi: 5,
    akunId: 1,
  });

  const after = await getCurrentShiftRows();
  const plastik10 = after.rows.find((r) => r.jenisBarang === "Plastik10KG")!;
  console.log("Plastik10KG after upsert:", plastik10);
  const expectedGudang = before.rows.find((r) => r.jenisBarang === "Plastik10KG")!.sisaGudangAkhir + 500 - 200;
  const expectedInventori = before.rows.find((r) => r.jenisBarang === "Plastik10KG")!.sisaInventoriAkhir + 200 - 50 - 5;
  console.log("Expected sisaGudangAkhir:", expectedGudang, "got:", plastik10.sisaGudangAkhir);
  console.log("Expected sisaInventoriAkhir:", expectedInventori, "got:", plastik10.sisaInventoriAkhir);
  if (plastik10.sisaGudangAkhir !== expectedGudang || plastik10.sisaInventoriAkhir !== expectedInventori) {
    throw new Error("MISMATCH — running balance math is wrong");
  }

  // Clean up the test row so this script leaves no residue.
  const { getPool, sql } = await import("./src/lib/db");
  const pool = await getPool();
  await pool
    .request()
    .input("t", sql.Date, before.current.tanggalUsaha)
    .input("s", sql.TinyInt, before.current.shift)
    .query(`DELETE FROM DashboardStokBahanBakuShift WHERE TanggalUsaha = @t AND Shift = @s AND JenisBarang = 'Plastik10KG'`);

  console.log("PASSED — cleaned up test row.");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
```

Run: `npx tsx scratch-verify-stok-bahan-baku.ts`
Expected: `PASSED — cleaned up test row.` with matching expected/got balance
numbers. If it mismatches, fix the window-function query (not the script)
and re-run.

- [ ] **Step 3: Delete the scratch script and type-check**

```bash
rm -f scratch-verify-stok-bahan-baku.ts
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/stok-bahan-baku.ts
git commit -m "feat: add stok-bahan-baku queries with computed running balances"
```

---

### Task 4: `"laporan"` module key + sidebar entry

**Files:**
- Modify: `src/lib/permissions.ts:6-21`
- Modify: `src/components/dashboard/app-sidebar.tsx:1-47`

**Interfaces:**
- Produces: `ModuleKey` now includes `"laporan"`. Consumed by Task 5's
  `requireModuleAccess("laporan")` and by the Peran editor (already
  generic over `MODULE_KEYS`, no change needed there — see spec Bagian 2).

- [ ] **Step 1: Add the module key**

In `src/lib/permissions.ts`, change:

```ts
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "pemesanan", "mitra", "pemasaran", "produksi"] as const;
```

to:

```ts
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "pemesanan", "mitra", "pemasaran", "produksi", "laporan"] as const;
```

and add to `MODULE_LABEL`:

```ts
export const MODULE_LABEL: Record<ModuleKey, string> = {
  beranda: "Beranda",
  pnl: "Keuangan",
  aging: "Piutang",
  sales: "Penjualan",
  transaksi: "Transaksi",
  electricity: "Biaya Listrik",
  delivery: "Pengiriman",
  pemesanan: "Pemesanan",
  mitra: "Mitra",
  pemasaran: "Pemasaran",
  produksi: "Produksi",
  laporan: "Laporan",
};
```

- [ ] **Step 2: Add the sidebar nav item**

In `src/components/dashboard/app-sidebar.tsx`, add `FileSpreadsheet` to the
lucide-react import list (line 5-17), and add a row to `NAV_ITEMS`
(line 35-47):

```ts
{ href: "/mkesindo/laporan", label: "Laporan", icon: FileSpreadsheet, moduleKey: "laporan" },
```

(append after the `produksi` row, before the closing `];`).

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/permissions.ts src/components/dashboard/app-sidebar.tsx
git commit -m "feat: add laporan module key and sidebar entry"
```

---

### Task 5: `/mkesindo/laporan` page + actions

**Files:**
- Create: `src/app/mkesindo/(dashboard)/laporan/actions.ts`
- Create: `src/app/mkesindo/(dashboard)/laporan/page.tsx`

**Interfaces:**
- Consumes: `requireModuleAccess`, `canAccessAllPT` from
  `@/lib/require-access`; everything from Task 3's
  `@/lib/queries/stok-bahan-baku`; `getAkunNamaMap` from
  `@/lib/queries/akun`; `AppError`/`runAction`/`ActionResult` from
  `@/lib/action-result`.
- Produces: `getCurrentShiftRowsAction`, `getStokBahanBakuHistoryAction`,
  `upsertOperasionalStokAction`, `getSaldoAwalAction`,
  `setSaldoAwalAction` — consumed by Task 6's client component.

- [ ] **Step 1: Write `actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import {
  getCurrentShiftRows,
  getStokBahanBakuHistory,
  upsertOperasionalStok,
  getSaldoAwal,
  setSaldoAwal,
  type StokBahanBakuRow,
  type CurrentShiftInfo,
  type SaldoAwalRow,
  type UpsertOperasionalStokInput,
  type JenisBarang,
} from "@/lib/queries/stok-bahan-baku";

// Bypasses the permission grid for Direktur/Superadmin the same way every
// other module's canAccessAllPT() checks do, so they can exercise the
// input form too (support/testing), not just view it.
function assertCanEditLaporan(user: { isSuperAdmin: boolean; accountScope: string; permissions: { laporan?: { canEdit: boolean } } }): void {
  const canEdit = canAccessAllPT(user) || !!user.permissions.laporan?.canEdit;
  if (!canEdit) throw new AppError("Anda tidak punya izin mengubah data ini.");
}

export async function getCurrentShiftRowsAction(): Promise<ActionResult<{ current: CurrentShiftInfo; rows: StokBahanBakuRow[] }>> {
  return runAction(async () => {
    await requireModuleAccess("laporan");
    return getCurrentShiftRows();
  });
}

export async function getStokBahanBakuHistoryAction(): Promise<ActionResult<StokBahanBakuRow[]>> {
  return runAction(async () => {
    await requireModuleAccess("laporan");
    return getStokBahanBakuHistory();
  });
}

export async function upsertOperasionalStokAction(
  input: Omit<UpsertOperasionalStokInput, "akunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    assertCanEditLaporan(session.user);
    if (input.stokMasukGudang < 0 || input.stokMasukInventoriOperasional < 0) {
      throw new AppError("Jumlah tidak boleh negatif.");
    }
    await upsertOperasionalStok({ ...input, akunId: Number(session.user.id) });
    revalidatePath("/mkesindo/laporan");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function getSaldoAwalAction(): Promise<ActionResult<SaldoAwalRow[]>> {
  return runAction(async () => {
    await requireModuleAccess("laporan");
    return getSaldoAwal();
  });
}

export async function setSaldoAwalAction(
  jenisBarang: JenisBarang,
  saldoAwalGudang: number,
  saldoAwalInventoriOperasional: number
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    if (!canAccessAllPT(session.user)) {
      throw new AppError("Hanya Direktur/Superadmin yang bisa mengubah saldo awal.");
    }
    if (saldoAwalGudang < 0 || saldoAwalInventoriOperasional < 0) {
      throw new AppError("Saldo awal tidak boleh negatif.");
    }
    await setSaldoAwal(jenisBarang, saldoAwalGudang, saldoAwalInventoriOperasional, Number(session.user.id));
    revalidatePath("/mkesindo/laporan");
  });
}
```

- [ ] **Step 2: Write `page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { getCurrentShiftRows, getStokBahanBakuHistory, getSaldoAwal } from "@/lib/queries/stok-bahan-baku";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { LaporanStokBahanBaku } from "@/components/dashboard/laporan-stok-bahan-baku";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage() {
  const session = await requireModuleAccess("laporan");
  const canEdit = canAccessAllPT(session.user) || !!session.user.permissions.laporan?.canEdit;
  const canEditSaldoAwal = canAccessAllPT(session.user);

  const [{ current, rows }, history, saldoAwal] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getSaldoAwal(),
  ]);

  const akunIds = [...rows, ...history].flatMap((r) => [r.operasionalAkunId, r.produksiAkunId]).filter((id): id is number => id != null);
  const namaMap = await getAkunNamaMap(akunIds);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Laporan</h1>
      <LaporanStokBahanBaku
        canEdit={canEdit}
        canEditSaldoAwal={canEditSaldoAwal}
        current={current}
        initialCurrentRows={rows}
        initialHistory={history}
        initialSaldoAwal={saldoAwal}
        namaMap={Object.fromEntries(namaMap)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check** (will fail until Task 6 creates the
  component — that's expected; proceed to Task 6 before checking, or
  check after Task 6 instead if executing sequentially).

- [ ] **Step 4: Commit** (combine with Task 6's commit, since `page.tsx`
  doesn't compile without it — see Task 6's Step 4).

---

### Task 6: `LaporanStokBahanBaku` client component

**Files:**
- Create: `src/components/dashboard/laporan-stok-bahan-baku.tsx`

**Interfaces:**
- Consumes: `upsertOperasionalStokAction`, `setSaldoAwalAction` from
  Task 5's `@/app/mkesindo/(dashboard)/laporan/actions`; everything from
  Task 3's `@/lib/queries/stok-bahan-baku`; `formatDate` from
  `@/lib/format`; shadcn `Card`/`Input`/`Label`/`Button`/`Table` components
  (all already used elsewhere in this codebase, see e.g.
  [`electricity/page.tsx`](../../../src/app/mkesindo/(dashboard)/electricity/page.tsx)
  for the `Table` import shape).
- Produces: `LaporanStokBahanBaku` — the component Task 5's `page.tsx`
  renders.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { upsertOperasionalStokAction, setSaldoAwalAction } from "@/app/mkesindo/(dashboard)/laporan/actions";
import {
  JENIS_BARANG_LIST,
  JENIS_BARANG_LABEL,
  JENIS_BARANG_UNIT_BUNDLE,
  toBundle,
  type StokBahanBakuRow,
  type CurrentShiftInfo,
  type SaldoAwalRow,
  type JenisBarang,
} from "@/lib/queries/stok-bahan-baku";

function formatQty(n: number, jenis: JenisBarang): string {
  return `${n.toLocaleString("id-ID")} lembar (${toBundle(n)} ${JENIS_BARANG_UNIT_BUNDLE[jenis]})`;
}

function StokInputCard({
  jenis,
  row,
  canEdit,
  onSaved,
}: {
  jenis: JenisBarang;
  row: StokBahanBakuRow;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [masukGudang, setMasukGudang] = useState(String(row.stokMasukGudang));
  const [masukInventori, setMasukInventori] = useState(String(row.stokMasukInventoriOperasional));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await upsertOperasionalStokAction({
        tanggalUsaha: row.tanggalUsaha,
        shift: row.shift,
        jenisBarang: jenis,
        stokMasukGudang: Number(masukGudang) || 0,
        stokMasukInventoriOperasional: Number(masukInventori) || 0,
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
        <CardTitle className="font-display text-sm">{JENIS_BARANG_LABEL[jenis]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-2 text-xs">
          <div>
            <p className="text-muted-foreground">Sisa Gudang</p>
            <p className="font-medium">{formatQty(row.sisaGudangAkhir, jenis)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sisa Inventori Operasional</p>
            <p className="font-medium">{formatQty(row.sisaInventoriAkhir, jenis)}</p>
          </div>
        </div>
        {canEdit ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`masuk-gudang-${jenis}`}>Masuk Gudang (shift ini)</Label>
              <Input id={`masuk-gudang-${jenis}`} type="number" min={0} value={masukGudang} onChange={(e) => setMasukGudang(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`masuk-inventori-${jenis}`}>Masuk Inventori Operasional (shift ini)</Label>
              <Input id={`masuk-inventori-${jenis}`} type="number" min={0} value={masukInventori} onChange={(e) => setMasukInventori(e.target.value)} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button size="sm" className="w-fit" disabled={pending} onClick={handleSave}>
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Masuk Gudang</p>
              <p className="font-medium">{row.stokMasukGudang.toLocaleString("id-ID")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Masuk Inventori Operasional</p>
              <p className="font-medium">{row.stokMasukInventoriOperasional.toLocaleString("id-ID")}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SaldoAwalDialogInline({ saldoAwal, onSaved }: { saldoAwal: SaldoAwalRow[]; onSaved: () => void }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(saldoAwal.map((s) => [s.jenisBarang, { gudang: String(s.saldoAwalGudang), inventori: String(s.saldoAwalInventoriOperasional) }]))
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      for (const jenis of JENIS_BARANG_LIST) {
        const v = values[jenis];
        const result = await setSaldoAwalAction(jenis, Number(v.gudang) || 0, Number(v.inventori) || 0);
        if (!result.success) {
          setError(result.error);
          return;
        }
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
        {JENIS_BARANG_LIST.map((jenis) => (
          <div key={jenis} className="grid grid-cols-3 items-end gap-2">
            <p className="text-xs text-muted-foreground">{JENIS_BARANG_LABEL[jenis]}</p>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Saldo Gudang</Label>
              <Input
                type="number"
                min={0}
                value={values[jenis].gudang}
                onChange={(e) => setValues((prev) => ({ ...prev, [jenis]: { ...prev[jenis], gudang: e.target.value } }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Saldo Inventori Operasional</Label>
              <Input
                type="number"
                min={0}
                value={values[jenis].inventori}
                onChange={(e) => setValues((prev) => ({ ...prev, [jenis]: { ...prev[jenis], inventori: e.target.value } }))}
              />
            </div>
          </div>
        ))}
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

export function LaporanStokBahanBaku({
  canEdit,
  canEditSaldoAwal,
  current,
  initialCurrentRows,
  initialHistory,
  initialSaldoAwal,
  namaMap,
}: {
  canEdit: boolean;
  canEditSaldoAwal: boolean;
  current: CurrentShiftInfo;
  initialCurrentRows: StokBahanBakuRow[];
  initialHistory: StokBahanBakuRow[];
  initialSaldoAwal: SaldoAwalRow[];
  namaMap: Record<number, string>;
}) {
  const router = useRouter();
  // Any save (operasional input or saldo awal) changes running balances for
  // this AND every later shift (see Global Constraints — balances are
  // computed at read time), so a full server refetch via router.refresh()
  // is the correct response, not a local patch.
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {initialCurrentRows.map((row) => (
            <StokInputCard key={row.jenisBarang} jenis={row.jenisBarang} row={row} canEdit={canEdit} onSaved={handleChanged} />
          ))}
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
                <TableHead>Barang</TableHead>
                <TableHead className="text-right">Masuk Gudang</TableHead>
                <TableHead className="text-right">Masuk Inventori</TableHead>
                <TableHead className="text-right">Dipakai</TableHead>
                <TableHead className="text-right">Rusak</TableHead>
                <TableHead className="text-right">Sisa Gudang</TableHead>
                <TableHead className="text-right">Sisa Inventori</TableHead>
                <TableHead>Diisi Operasional</TableHead>
                <TableHead>Diisi Produksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialHistory.map((r) => (
                <TableRow key={`${r.tanggalUsaha}-${r.shift}-${r.jenisBarang}`}>
                  <TableCell>{formatDate(r.tanggalUsaha)}</TableCell>
                  <TableCell>Shift {r.shift}</TableCell>
                  <TableCell>{JENIS_BARANG_LABEL[r.jenisBarang]}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.stokMasukGudang.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.stokMasukInventoriOperasional.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.stokDipakaiProduksi.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.stokRusakProduksi.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.sisaGudangAkhir, r.jenisBarang)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.sisaInventoriAkhir, r.jenisBarang)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.operasionalAkunId ? (namaMap[r.operasionalAkunId] ?? "?") : "Belum diisi"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.produksiAkunId ? (namaMap[r.produksiAkunId] ?? "?") : "Belum diisi"}</TableCell>
                </TableRow>
              ))}
              {initialHistory.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                    Belum ada data.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Fix any mismatch between this component's props and `page.tsx`'s (Task 5)
before proceeding — they were written in the same pass but verify anyway.

- [ ] **Step 3: Lint**

```bash
npx eslint src/app/mkesindo/\(dashboard\)/laporan/actions.ts src/app/mkesindo/\(dashboard\)/laporan/page.tsx src/components/dashboard/laporan-stok-bahan-baku.tsx
```

- [ ] **Step 4: Live-verify in the browser, then commit**

Start the dev server, log in as an account with `canAccessAllPT` (e.g.
Superadmin), navigate to `/mkesindo/laporan`, confirm: the 3 cards render
with the current shift's label, typing numbers and clicking Simpan
succeeds and the Riwayat table below updates, "Atur Saldo Awal" opens the
inline form and saves. Then:

```bash
git add src/app/mkesindo/\(dashboard\)/laporan src/components/dashboard/laporan-stok-bahan-baku.tsx
git commit -m "feat: add /mkesindo/laporan Tahap 1 Stok Bahan Baku page"
```

---

### Task 7: "Bahan Baku" tab in `produksi-app`

**Files:**
- Modify: `src/app/mkesindo/produksi/actions.ts` (append)
- Create: `src/components/produksi-app/bahan-baku-view.tsx`
- Create: `src/app/mkesindo/produksi-app/(tabs)/bahan-baku/page.tsx`
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx`
- Modify: `src/components/produksi-app/bottom-nav.tsx`

**Interfaces:**
- Consumes: `getCurrentShiftRows`, `upsertProduksiStok` and their types
  from Task 3's `@/lib/queries/stok-bahan-baku`; `requireProduksiView`,
  `AppError`/`runAction`/`ActionResult` (already imported in
  `produksi/actions.ts`).
- Produces: `getCurrentShiftRowsForProduksiAction`,
  `upsertProduksiStokAction` — new server actions; `BahanBakuView`
  component; a 5th `ProduksiTabKey` (`"bahan-baku"`).

- [ ] **Step 1: Append actions to `src/app/mkesindo/produksi/actions.ts`**

Add this import alongside the existing ones at the top of the file:

```ts
import {
  getCurrentShiftRows,
  upsertProduksiStok,
  type StokBahanBakuRow,
  type CurrentShiftInfo,
  type UpsertProduksiStokInput,
} from "@/lib/queries/stok-bahan-baku";
```

Append at the end of the file:

```ts
export async function getCurrentShiftRowsForProduksiAction(): Promise<ActionResult<{ current: CurrentShiftInfo; rows: StokBahanBakuRow[] }>> {
  return runAction(async () => {
    await requireProduksiView();
    return getCurrentShiftRows();
  });
}

export async function upsertProduksiStokAction(
  input: Omit<UpsertProduksiStokInput, "akunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (input.stokDipakaiProduksi < 0 || input.stokRusakProduksi < 0) {
      throw new AppError("Jumlah tidak boleh negatif.");
    }
    await upsertProduksiStok({ ...input, akunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/laporan");
  });
}
```

- [ ] **Step 2: Write `src/components/produksi-app/bahan-baku-view.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  JENIS_BARANG_LABEL,
  toBundle,
  JENIS_BARANG_UNIT_BUNDLE,
  type StokBahanBakuRow,
  type CurrentShiftInfo,
  type JenisBarang,
} from "@/lib/queries/stok-bahan-baku";
import { upsertProduksiStokAction } from "@/app/mkesindo/produksi/actions";

function formatQty(n: number, jenis: JenisBarang): string {
  return `${n.toLocaleString("id-ID")} lembar (${toBundle(n)} ${JENIS_BARANG_UNIT_BUNDLE[jenis]})`;
}

function ProduksiStokCard({ jenis, row, onSaved }: { jenis: JenisBarang; row: StokBahanBakuRow; onSaved: () => void }) {
  const [dipakai, setDipakai] = useState(String(row.stokDipakaiProduksi));
  const [rusak, setRusak] = useState(String(row.stokRusakProduksi));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await upsertProduksiStokAction({
        tanggalUsaha: row.tanggalUsaha,
        shift: row.shift,
        jenisBarang: jenis,
        stokDipakaiProduksi: Number(dipakai) || 0,
        stokRusakProduksi: Number(rusak) || 0,
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
        <CardTitle className="text-sm">{JENIS_BARANG_LABEL[jenis]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="rounded-md border bg-muted/30 p-2 text-xs">
          <p className="text-muted-foreground">Masuk Inventori Operasional (shift ini)</p>
          <p className="font-medium">{row.operasionalAkunId ? formatQty(row.stokMasukInventoriOperasional, jenis) : "Belum diisi Staf Operasional"}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`dipakai-${jenis}`}>Dipakai</Label>
          <Input id={`dipakai-${jenis}`} type="number" min={0} value={dipakai} onChange={(e) => setDipakai(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rusak-${jenis}`}>Rusak</Label>
          <Input id={`rusak-${jenis}`} type="number" min={0} value={rusak} onChange={(e) => setRusak(e.target.value)} />
        </div>
        <div className="rounded-md border bg-muted/30 p-2 text-xs">
          <p className="text-muted-foreground">Sisa Inventori Operasional</p>
          <p className="font-medium">{formatQty(row.sisaInventoriAkhir, jenis)}</p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-fit" disabled={pending} onClick={handleSave}>
          {pending ? "Menyimpan..." : "Simpan"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function BahanBakuView({
  current,
  rows,
  onAfterSimpan,
}: {
  current: CurrentShiftInfo;
  rows: StokBahanBakuRow[];
  onAfterSimpan: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {current.tanggalUsaha} — {current.shiftLabel}
      </h2>
      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <ProduksiStokCard key={row.jenisBarang} jenis={row.jenisBarang} row={row} onSaved={onAfterSimpan} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the new tab into `produksi-tab-shell.tsx`**

In `src/components/produksi-app/produksi-tab-shell.tsx`:

Add imports:

```ts
import { BahanBakuView } from "@/components/produksi-app/bahan-baku-view";
import { getCurrentShiftRowsForProduksiAction } from "@/app/mkesindo/produksi/actions";
import type { StokBahanBakuRow, CurrentShiftInfo } from "@/lib/queries/stok-bahan-baku";
```

Change the type and path map (line 27-34):

```ts
export type ProduksiTabKey = "kartu-pengiriman" | "riwayat" | "warehouse" | "kualitas" | "bahan-baku";

const TAB_PATHS: Record<ProduksiTabKey, string> = {
  "kartu-pengiriman": "/mkesindo/produksi-app",
  riwayat: "/mkesindo/produksi-app/riwayat",
  warehouse: "/mkesindo/produksi-app/warehouse",
  kualitas: "/mkesindo/produksi-app/kualitas",
  "bahan-baku": "/mkesindo/produksi-app/bahan-baku",
};
```

Add a new optional prop `initialBahanBaku?: { current: CurrentShiftInfo; rows: StokBahanBakuRow[] }` to the component's props type (alongside `initialKualitas` etc., line 36-53), and its matching state:

```ts
const [bahanBaku, setBahanBaku] = useState<{ current: CurrentShiftInfo; rows: StokBahanBakuRow[] } | null>(initialBahanBaku ?? null);
```

Add a refresh helper alongside `refreshWarehouse` (line 82-84):

```ts
function refreshBahanBaku() {
  setBahanBaku(null);
}
```

Inside the `useEffect`'s `load()` function, add a branch (after the
`kualitas` blocks, before the closing brace of `load`, matching the same
shape as the other tabs' fetch branches):

```ts
if (activeTab === "bahan-baku" && bahanBaku === null) {
  setLoadingTab("bahan-baku");
  const result = await getCurrentShiftRowsForProduksiAction();
  if (cancelled) return;
  if (!result.success) {
    setTabError(result.error);
    setLoadingTab(null);
    return;
  }
  setBahanBaku(result.data);
  setLoadingTab(null);
}
```

Add `bahanBaku` to the effect's dependency array (line 184, alongside the
existing state variables).

Add the rendered panel (alongside the other `visited.has(...)` blocks,
line 206-240):

```tsx
{visited.has("bahan-baku") && bahanBaku && (
  <div className={cn("h-full overflow-y-auto", activeTab !== "bahan-baku" && "hidden")}>
    <BahanBakuView current={bahanBaku.current} rows={bahanBaku.rows} onAfterSimpan={refreshBahanBaku} />
  </div>
)}
```

- [ ] **Step 4: Add the tab button in `bottom-nav.tsx`**

In `src/components/produksi-app/bottom-nav.tsx`, add `Package` to the
lucide-react import and append to `TABS`:

```ts
{ key: "bahan-baku", label: "Bahan Baku", icon: Package },
```

- [ ] **Step 5: Create the tab's route** `src/app/mkesindo/produksi-app/(tabs)/bahan-baku/page.tsx`

```tsx
import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getCurrentShiftRows } from "@/lib/queries/stok-bahan-baku";
import { getUserById } from "@/lib/queries/akun";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Bahan Baku" };

export default async function ProduksiAppBahanBakuPage() {
  const session = await requireProduksi();
  const [bahanBaku, profile] = await Promise.all([getCurrentShiftRows(), getUserById(Number(session.user.id))]);

  return (
    <ProduksiTabShell
      initialTab="bahan-baku"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialBahanBaku={bahanBaku}
    />
  );
}
```

- [ ] **Step 6: Type-check and lint**

```bash
npx tsc --noEmit
npx eslint src/app/mkesindo/produksi/actions.ts src/components/produksi-app/bahan-baku-view.tsx src/components/produksi-app/produksi-tab-shell.tsx src/components/produksi-app/bottom-nav.tsx src/app/mkesindo/produksi-app/\(tabs\)/bahan-baku/page.tsx
```

- [ ] **Step 7: Live-verify in the browser**

Start the dev server, log in as a Produksi account, open
`/mkesindo/produksi-app`, tap the new "Bahan Baku" tab, confirm the 3
cards render, typing Dipakai/Rusak and saving succeeds, and (after also
saving something via `/mkesindo/laporan` as a Staf Operasional/Superadmin
account in another session) the "Masuk Inventori Operasional" read-only
value updates on refresh.

- [ ] **Step 8: Commit**

```bash
git add src/app/mkesindo/produksi/actions.ts src/components/produksi-app/bahan-baku-view.tsx src/components/produksi-app/produksi-tab-shell.tsx src/components/produksi-app/bottom-nav.tsx src/app/mkesindo/produksi-app/\(tabs\)/bahan-baku
git commit -m "feat: add Bahan Baku tab to produksi-app"
```

---

### Task 8: Create the "Staf Operasional" Peran (data setup, not code)

**Files:** none — this is an admin-UI action, not a code change.

- [ ] **Step 1**: Log in as Superadmin, go to `/grup/akun/peran`, click
  "Tambah Peran", name it "Staf Operasional".
- [ ] **Step 2**: In that Peran's card, check "Ubah" (canEdit) on the new
  "Laporan" row only, leave every other module unchecked, click "Simpan
  Otoritas".
- [ ] **Step 3**: Create (or repoint an existing) Akun with this Peran,
  confirm logging in as that account lands them with edit access at
  `/mkesindo/laporan` and nothing else in the sidebar.
- [ ] **Step 4**: Use the "Atur Saldo Awal" form (as Superadmin) to enter
  the real current physical stock counts for all 3 `JenisBarang` before
  handing this over to real Staf Operasional/Produksi users — otherwise
  every running balance starts from 0, not the real physical count.

No commit — this step is data setup done through the already-shipped
admin UI (Task 4-6), not a code change.
