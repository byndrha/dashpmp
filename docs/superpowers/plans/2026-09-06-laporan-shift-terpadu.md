# Laporan Shift Terpadu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Laporan Shift" tab to `/mkesindo/laporan` that shows one shift's complete picture (kartu pengiriman + status bayar + retur/jual-ulang, kas keluar otomatis+manual, produksi, mesin ON/OFF+counter, stok bahan baku, stok es) in a single scrollable card, alongside the 5 existing tabs.

**Architecture:** A new composed read-only query layer (`getLaporanShiftDetail`) pulls from 7 already-existing subsystems for one `(tanggalUsaha, shift)` at a time (never a whole month), reusing existing single-shift lookup functions where they already exist and adding a small number of new bulk read functions where they don't. One new table (`DashboardLaporanShiftStokEsSnapshot`) plus a background scanner — reusing this repo's own established `setInterval` + `globalThis` guard pattern from `src/lib/notifications/scanner.ts`, NOT a new `node-cron` dependency — captures the ice-stock total exactly once per shift, shortly after that shift ends, and catches up automatically if the server was down when a shift ended.

**Tech Stack:** Next.js App Router, MSSQL (`mssql` package, `src/lib/db.ts`), Postgres (`src/lib/pg.ts`, only for `metode_pembayaran` lookups), TypeScript, Tailwind/shadcn UI components.

**Spec:** docs/superpowers/specs/2026-09-06-laporan-shift-terpadu-design.md

## Global Constraints

- Shift definition: `getReportShift("work")` / `getShiftWindow(businessDate, shift, "work")` from `src/lib/report-shift.ts` — rollover 15:00 WIB, chronological order within one TanggalUsaha is Shift 2 → Shift 3 → Shift 1.
- Every new query filters to ONE `(tanggalUsaha, shift)` pair at a time — never a whole month. Use `WHERE <kolom> BETWEEN @start AND @end` with `getShiftWindow(...)`'s bounds, matching `getMesinEventsForShift`'s existing idiom — do NOT duplicate the whole-month `SHIFT_CASE`/`TANGGAL_USAHA_CASE` SQL `CASE` expressions from `laporan-ringkasan-lintas-shift.ts`/`laporan-muatan-distribusi.ts` (those exist for a different, whole-month use case).
- All new timestamps written by this feature (the snapshot's `CreatedDate`) use `getNaiveWibNow()` from `src/lib/business-date.ts` — never `new Date()` or `GETDATE()` directly in application code, matching `catatMesinEvent`'s own convention.
- This repo has no automated test suite. Verification is `npx tsc --noEmit` + `npx eslint <files>` + live-DB scratch scripts (`BEGIN TRAN...ROLLBACK` for read-only checks, capture-baseline/modify/verify/revert for anything that writes) — the same convention used throughout this codebase's recent history.
- No worktree — this session's standing convention is to commit directly to `main`.
- Read-only aggregation only, except the one new snapshot table. Do not modify any existing table's schema or any existing function's behavior, except the two additive read-function exports named explicitly below (Task 3).
- BBM (`DashboardPengirimanBBM`) is grouped by its OWN `WaktuIsi` timestamp's shift window (real-time-of-payment, matching kas-kecil's accounting philosophy) — **deliberately different** from `laporan-muatan-distribusi.ts`'s existing `BBMPerJadwal` CTE, which groups BBM by its parent Jadwal's own loading shift (a different report, different purpose — do not "fix" that file to match this one).

---

### Task 1: Schema — Stok Es snapshot table + shift-arithmetic helper

**Files:**
- Create: `scripts/create-laporan-shift-stok-es-snapshot-table.ts`
- Modify: `src/lib/report-shift.ts` (add `getPreviousShift`)
- Create: `src/lib/queries/laporan-shift-stok-es-snapshot.ts`

**Interfaces:**
- Consumes: `getShiftWindow`, `ShiftNumber` (`src/lib/report-shift.ts`, already exist); `getNaiveWibNow` (`src/lib/business-date.ts`, already exists); `getPool`, `sql` (`src/lib/db.ts`, already exist).
- Produces: `getPreviousShift(tanggalUsaha: string, shift: ShiftNumber): { tanggalUsaha: string; shift: ShiftNumber }` (`report-shift.ts`); `catatSnapshotJikaBelumAda(tanggalUsaha: string, shift: ShiftNumber): Promise<void>` and `getSnapshotStokEs(tanggalUsaha: string, shift: ShiftNumber): Promise<number | null>` (`laporan-shift-stok-es-snapshot.ts`) — both consumed by Task 2 and Task 7.

- [ ] **Step 1: Create the idempotent schema script**

```ts
// scripts/create-laporan-shift-stok-es-snapshot-table.ts
import { getPool } from "@/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardLaporanShiftStokEsSnapshot' AND xtype='U')
    BEGIN
      CREATE TABLE DashboardLaporanShiftStokEsSnapshot (
        SnapshotID INT IDENTITY PRIMARY KEY,
        TanggalUsaha DATE NOT NULL,
        Shift TINYINT NOT NULL,
        TotalSisaQty10KG DECIMAL(18,2) NOT NULL,
        CreatedDate DATETIME NOT NULL,
        IsDeleted BIT NOT NULL DEFAULT 0,
        CONSTRAINT UQ_LaporanShiftStokEsSnapshot UNIQUE (TanggalUsaha, Shift)
      )
    END
  `);

  console.log("DashboardLaporanShiftStokEsSnapshot ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/create-laporan-shift-stok-es-snapshot-table.ts`
Expected: prints "DashboardLaporanShiftStokEsSnapshot ready." Run it a second time to confirm it's a no-op (idempotency).

- [ ] **Step 3: Add `getPreviousShift` to `report-shift.ts`**

Append to `src/lib/report-shift.ts` (after `getShiftLabel`):

```ts
// The (tanggalUsaha, shift) that chronologically immediately precedes the
// given one, within the same "work" shift-boundary system this whole file
// implements. Chronological order within one TanggalUsaha is Shift 2 -> 3
// -> 1 (see getShiftWindow's own comment) — Shift 1's predecessor is Shift
// 3 of the SAME TanggalUsaha, Shift 3's predecessor is Shift 2 of the SAME
// TanggalUsaha, and Shift 2's predecessor is Shift 1 of the PREVIOUS
// TanggalUsaha (the calendar day before). Used by the Stok Es snapshot
// scanner (Task 2) to find "the shift that just ended" and by
// getLaporanShiftDetail (Task 7) to find "Stok Awal" (= previous shift's
// "Stok Akhir").
export function getPreviousShift(tanggalUsaha: string, shift: ShiftNumber): { tanggalUsaha: string; shift: ShiftNumber } {
  if (shift === 1) return { tanggalUsaha, shift: 3 };
  if (shift === 3) return { tanggalUsaha, shift: 2 };
  const d = new Date(`${tanggalUsaha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return { tanggalUsaha: d.toISOString().slice(0, 10), shift: 1 };
}
```

- [ ] **Step 4: Create the snapshot read/write functions**

```ts
// src/lib/queries/laporan-shift-stok-es-snapshot.ts
import { getPool, sql } from "@/lib/db";
import { getNaiveWibNow } from "@/lib/business-date";
import type { ShiftNumber } from "@/lib/report-shift";

// Total live sisa stok es (SUM SisaQty10KG across all active pallet
// batches) — same query as getTotalStokEs10KG in aktivitas-produksi.ts and
// the live Peta Warehouse total, duplicated here rather than imported
// (this file must not depend on aktivitas-produksi.ts, and the query is a
// single COALESCE-guarded SUM, not worth a shared-module indirection).
async function hitungTotalSisaStokEsLive(): Promise<number> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ISNULL(SUM(SisaQty10KG), 0) AS Total FROM DashboardProduksiBatch WHERE IsDeleted = 0 AND SisaQty10KG > 0
  `);
  return (result.recordset[0] as { Total: number }).Total;
}

// Idempotent: does nothing if a snapshot for (tanggalUsaha, shift) already
// exists. Called both by the periodic scanner (Task 2, for "the shift that
// just ended") and its own startup catch-up sweep — safe to call for the
// same shift many times in a row.
export async function catatSnapshotJikaBelumAda(tanggalUsaha: string, shift: ShiftNumber): Promise<void> {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT 1 FROM DashboardLaporanShiftStokEsSnapshot WHERE TanggalUsaha = @t AND Shift = @s AND IsDeleted = 0`);
  if (existing.recordset.length > 0) return;

  const total = await hitungTotalSisaStokEsLive();
  await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .input("total", sql.Decimal(18, 2), total)
    .input("createdDate", sql.DateTime, getNaiveWibNow())
    .query(`
      INSERT INTO DashboardLaporanShiftStokEsSnapshot (TanggalUsaha, Shift, TotalSisaQty10KG, CreatedDate)
      VALUES (@t, @s, @total, @createdDate)
    `);
}

// null when no snapshot exists yet for this shift (shift still running, or
// this feature wasn't active yet when that shift happened).
export async function getSnapshotStokEs(tanggalUsaha: string, shift: ShiftNumber): Promise<number | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT TotalSisaQty10KG FROM DashboardLaporanShiftStokEsSnapshot WHERE TanggalUsaha = @t AND Shift = @s AND IsDeleted = 0`);
  const row = result.recordset[0] as { TotalSisaQty10KG: number } | undefined;
  return row?.TotalSisaQty10KG ?? null;
}

// Live total, exported for Task 7's "shift currently running" display path
// (labeled "(live, belum final)" in the UI, per spec Bagian 4).
export { hitungTotalSisaStokEsLive };
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/report-shift.ts src/lib/queries/laporan-shift-stok-es-snapshot.ts`
Expected: clean.

Live-DB check (read-only + one throwaway insert, cleaned up): call `catatSnapshotJikaBelumAda("2020-01-01", 1)` twice via a scratch `tsx` script (pick a date far in the past so it can't collide with a real shift anyone cares about) — confirm exactly one row exists after both calls (idempotency), then delete that row directly via SQL to leave the table empty again.

- [ ] **Step 6: Commit**

```bash
git add scripts/create-laporan-shift-stok-es-snapshot-table.ts src/lib/report-shift.ts src/lib/queries/laporan-shift-stok-es-snapshot.ts
git commit -m "feat: add Stok Es snapshot table and shift-arithmetic helper"
```

---

### Task 2: Background scanner for the Stok Es snapshot

**Files:**
- Create: `src/lib/laporan-shift-stok-es-scanner.ts`
- Modify: `src/instrumentation.ts`

**Interfaces:**
- Consumes: `catatSnapshotJikaBelumAda`, `getPreviousShift` (Task 1); `getReportShift` (`report-shift.ts`, already exists).
- Produces: `startStokEsSnapshotScanner(): void`, called once from `instrumentation.ts`.

- [ ] **Step 1: Read the existing scanner for the pattern to mirror**

Read `src/lib/notifications/scanner.ts` in full (already read during planning — the pattern: a `SCAN_INTERVAL_MS` constant, an in-flight guard, a `globalThis.__xStarted` idempotency guard, `setInterval` in an exported `startX()` function). This task's scanner is much simpler (one thing to check, not N sources), but follows the same shape.

- [ ] **Step 2: Write the scanner**

```ts
// src/lib/laporan-shift-stok-es-scanner.ts
import { getReportShift } from "@/lib/report-shift";
import { catatSnapshotJikaBelumAda } from "@/lib/queries/laporan-shift-stok-es-snapshot";

// Checked every minute — cheap (getReportShift is pure JS, catatSnapshot...
// short-circuits to a single indexed SELECT when a snapshot already
// exists). Every tick asks "what's the CURRENT shift right now, and has
// the one immediately before it already been snapshotted?" — if not, it
// snapshots it now, using the CURRENT live total as that shift's "final"
// figure. This is deliberately simpler than firing exactly at 07:00/15:00/
// 23:00: checking every minute means a shift's snapshot is captured within
// ~1 minute of it ending (accurate enough — the report's own spec accepts
// "(live, belum final)" while a shift is still running, so this is not a
// business-critical instant), AND it doubles as the startup/downtime
// catch-up mechanism for free — the same tick that would have run at the
// exact boundary still runs on the very next minute after the process
// (re)starts, no separate catch-up code path needed (matches this file's
// sibling scanner.ts, which achieves catch-up purely through its own
// periodic re-check + watermark, not a special first-run branch).
const CHECK_INTERVAL_MS = 60_000;

async function tick(): Promise<void> {
  try {
    const { shift, businessDate } = getReportShift("work");
    const tanggalUsaha = businessDate.toISOString().slice(0, 10);
    const previous = getPreviousShift(tanggalUsaha, shift);
    await catatSnapshotJikaBelumAda(previous.tanggalUsaha, previous.shift);
  } catch (err) {
    // One failed tick (e.g. a transient DB blip) must not crash the
    // interval or stop future ticks — the next tick retries the same
    // check from scratch, same resilience posture as notifications/scanner.ts.
    console.error("Stok Es snapshot scan failed:", err);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __laporanShiftStokEsScannerStarted: boolean | undefined;
}

export function startStokEsSnapshotScanner(): void {
  if (globalThis.__laporanShiftStokEsScannerStarted) return;
  globalThis.__laporanShiftStokEsScannerStarted = true;
  setInterval(tick, CHECK_INTERVAL_MS);
  // Fire once immediately on startup too, rather than waiting a full
  // minute for the first tick — catches a shift that ended while the
  // server was down as soon as it comes back up, not up to 60s later.
  void tick();
}
```

Add the missing import at the top: `import { getPreviousShift } from "@/lib/report-shift";`

- [ ] **Step 2: Wire it into `instrumentation.ts`**

```ts
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNotificationScanner } = await import("@/lib/notifications/scanner");
    startNotificationScanner();
    const { startStokEsSnapshotScanner } = await import("@/lib/laporan-shift-stok-es-scanner");
    startStokEsSnapshotScanner();
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/laporan-shift-stok-es-scanner.ts src/instrumentation.ts`
Expected: clean.

Manual check: run the dev server (`npm run dev`), confirm in the server console that no error is thrown at startup, then directly call `getSnapshotStokEs` for the shift immediately before the one running right now (via a throwaway script) and confirm a row now exists (created by the scanner's immediate on-startup `tick()`) — delete it afterward if it collides with a real shift's future data (it won't, since `catatSnapshotJikaBelumAda` never overwrites an existing row, but clean up your own test artifact if this was a real, currently-relevant shift).

- [ ] **Step 4: Commit**

```bash
git add src/lib/laporan-shift-stok-es-scanner.ts src/instrumentation.ts
git commit -m "feat: start Stok Es snapshot scanner on server startup"
```

---

### Task 3: Small additive exports — kas kecil single-shift lookup + retur/resale-per-stop bulk read

**Files:**
- Modify: `src/lib/queries/kas-kecil.ts:130-141` (export the existing private helper via a thin wrapper)
- Modify: `src/lib/queries/retur-resale.ts` (add a new bulk read function, no changes to existing functions)

**Interfaces:**
- Produces: `getKasKecilShiftForTanggalShift(tanggalUsaha: string, shift: ShiftNumber): Promise<KasKecilShiftRow | null>` (`kas-kecil.ts`); `getResaleBreakdownUntukStopItems(stopDeliveryItemIds: number[]): Promise<Map<number, { jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; qty: number }[]>>` (`retur-resale.ts`) — both consumed by Task 4/7.

- [ ] **Step 1: Add the kas kecil wrapper**

`getKasKecilShiftRow(pool, tanggalUsaha, shift)` already exists in `kas-kecil.ts:130-141` but is not exported (it takes a `pool` param, awkward for external callers). Append this thin export at the end of `src/lib/queries/kas-kecil.ts`:

```ts
// Thin export of the existing private getKasKecilShiftRow, for callers
// outside this file that don't already have a pool handle (Laporan Shift's
// getLaporanShiftDetail, Task 7) — resolves its own pool rather than
// requiring the caller to pass one.
export async function getKasKecilShiftForTanggalShift(tanggalUsaha: string, shift: ShiftNumber): Promise<KasKecilShiftRow | null> {
  const pool = await getPool();
  return getKasKecilShiftRow(pool, tanggalUsaha, shift);
}
```

- [ ] **Step 2: Add the resale-breakdown bulk read to `retur-resale.ts`**

Append at the end of `src/lib/queries/retur-resale.ts` (after the `export { claimSisaReturAtauGagal, ... }` line — a new, independent, exported function, not touching anything above it):

```ts
// Bulk resale breakdown for a batch of StopDeliveryItemID, grouped by
// Jalur — used by Laporan Shift (Task 4) to show "qty X dijual ulang lewat
// jalur Y" per retur item. Deliberately DIFFERENT from getSisaReturTersedia
// above: that function only returns items with UNSOLD sisa > 0 (it answers
// "what's still available to sell"), while a shift report needs to show
// EVERY retur item's resale history including ones that are already fully
// sold out (sisa = 0) — so this reads DashboardPengirimanReturResale
// directly, with no SisaQty filter at all.
export async function getResaleBreakdownUntukStopItems(
  stopDeliveryItemIds: number[]
): Promise<Map<number, { jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; qty: number }[]>> {
  const map = new Map<number, { jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; qty: number }[]>();
  if (stopDeliveryItemIds.length === 0) return map;
  const pool = await getPool();
  const request = pool.request();
  const placeholders = stopDeliveryItemIds.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const result = await request.query(`
    SELECT StopDeliveryItemID, Jalur, SUM(Qty) AS TotalQty
    FROM DashboardPengirimanReturResale
    WHERE StopDeliveryItemID IN (${placeholders.join(",")})
    GROUP BY StopDeliveryItemID, Jalur
  `);
  for (const row of result.recordset as { StopDeliveryItemID: number; Jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; TotalQty: number }[]) {
    const list = map.get(row.StopDeliveryItemID) ?? [];
    list.push({ jalur: row.Jalur, qty: row.TotalQty });
    map.set(row.StopDeliveryItemID, list);
  }
  return map;
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/kas-kecil.ts src/lib/queries/retur-resale.ts`
Expected: clean.

Live-DB check (read-only): call `getKasKecilShiftForTanggalShift` for a real recent `(tanggalUsaha, shift)` you know has data (check via existing Keuangan Operasional tab) and confirm the returned row matches what that tab shows. Call `getResaleBreakdownUntukStopItems` with a real `StopDeliveryItemID` known to have resale rows (from this session's earlier retur-resale testing, or query `SELECT TOP 5 StopDeliveryItemID FROM DashboardPengirimanReturResale` directly) and confirm the grouped totals match `SELECT Jalur, SUM(Qty) FROM DashboardPengirimanReturResale WHERE StopDeliveryItemID = @id GROUP BY Jalur` run directly.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/kas-kecil.ts src/lib/queries/retur-resale.ts
git commit -m "feat: add single-shift kas kecil lookup and resale breakdown bulk read"
```

---

### Task 4: Kartu Pengiriman read function (Jadwal + stops + items + status bayar + retur)

**Files:**
- Create: `src/lib/queries/laporan-shift-pengiriman.ts`

**Interfaces:**
- Consumes: `getShiftWindow`, `ShiftNumber` (`report-shift.ts`); `getResaleBreakdownUntukStopItems` (Task 3); `getMetodePembayaranByKode` (`src/lib/queries/metode-pembayaran.ts`, Postgres, already exists).
- Produces:

```ts
export interface KartuPengirimanItemRow {
  itemId: string;
  itemName: string;
  qty: number;
}
export interface KartuPengirimanReturRow {
  itemId: string;
  itemName: string;
  qtyRetur: number;
  kondisiRetur: "BAIK" | "RUSAK" | null;
  resale: { jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; qty: number }[];
}
export type StatusBayar = "TUNAI" | "QRIS" | "TRANSFER" | "TIDAK_BAYAR" | "BELUM_BAYAR";
export interface KartuPengirimanStopRow {
  jadwalDetailId: number;
  customerName: string;
  items: KartuPengirimanItemRow[];
  statusBayar: StatusBayar;
  nominalBayar: number | null;
  retur: KartuPengirimanReturRow[];
}
export interface KartuPengirimanRow {
  jadwalId: number;
  driverName: string | null;
  armadaNama: string | null;
  jamSelesaiMuat: string; // ISO
  stops: KartuPengirimanStopRow[];
}
export async function getKartuPengirimanUntukShift(tanggalUsaha: string, shift: ShiftNumber, perusahaanId: number): Promise<KartuPengirimanRow[]>
```

Consumed by Task 7.

- [ ] **Step 1: Write the function**

```ts
// src/lib/queries/laporan-shift-pengiriman.ts
import { getPool, sql } from "@/lib/db";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";
import { getResaleBreakdownUntukStopItems } from "@/lib/queries/retur-resale";
import { getMetodePembayaranByKode } from "@/lib/queries/metode-pembayaran";

export interface KartuPengirimanItemRow {
  itemId: string;
  itemName: string;
  qty: number;
}
export interface KartuPengirimanReturRow {
  itemId: string;
  itemName: string;
  qtyRetur: number;
  kondisiRetur: "BAIK" | "RUSAK" | null;
  resale: { jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; qty: number }[];
}
export type StatusBayar = "TUNAI" | "QRIS" | "TRANSFER" | "TIDAK_BAYAR" | "BELUM_BAYAR";
export interface KartuPengirimanStopRow {
  jadwalDetailId: number;
  customerName: string;
  items: KartuPengirimanItemRow[];
  statusBayar: StatusBayar;
  nominalBayar: number | null;
  retur: KartuPengirimanReturRow[];
}
export interface KartuPengirimanRow {
  jadwalId: number;
  driverName: string | null;
  armadaNama: string | null;
  jamSelesaiMuat: string;
  stops: KartuPengirimanStopRow[];
}

export async function getKartuPengirimanUntukShift(
  tanggalUsaha: string,
  shift: ShiftNumber,
  perusahaanId: number
): Promise<KartuPengirimanRow[]> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const window = getShiftWindow(businessDate, shift, "work");

  // 1. Jadwal in this shift's window.
  const jadwalResult = await pool
    .request()
    .input("start", sql.DateTime, window.start)
    .input("end", sql.DateTime, window.end).query(`
      SELECT j.JadwalID, sm.Name AS DriverName, a.Nama AS ArmadaNama, j.JamSelesaiMuat
      FROM DashboardPengirimanJadwal j
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamSelesaiMuat BETWEEN @start AND @end
      ORDER BY j.JamSelesaiMuat
    `);
  const jadwalRows = jadwalResult.recordset as { JadwalID: number; DriverName: string | null; ArmadaNama: string | null; JamSelesaiMuat: Date }[];
  if (jadwalRows.length === 0) return [];
  const jadwalIds = jadwalRows.map((r) => r.JadwalID);

  // 2. Stops (JadwalDetail) for those Jadwal, with their SalesOrder's
  //    BusinessPartner name, SalesInvoiceID (for payment lookup), and the
  //    linked StopDelivery's TanpaPembayaran/StopDeliveryID (for retur lookup).
  const jadwalPlaceholders = jadwalIds.map((id, i) => `@jid${i}`).join(",");
  const stopRequest = pool.request();
  jadwalIds.forEach((id, i) => stopRequest.input(`jid${i}`, sql.Int, id));
  const stopResult = await stopRequest.query(`
    SELECT jd.JadwalDetailID, jd.JadwalID, jd.SalesOrderID, jd.SalesInvoiceID,
           bp.Name AS CustomerName, sd.StopDeliveryID, sd.TanpaPembayaran
    FROM DashboardPengirimanJadwalDetail jd
    JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
    WHERE jd.JadwalID IN (${jadwalPlaceholders}) AND jd.IsDeleted = 0
  `);
  const stopRows = stopResult.recordset as {
    JadwalDetailID: number;
    JadwalID: number;
    SalesOrderID: string;
    SalesInvoiceID: string | null;
    CustomerName: string;
    StopDeliveryID: number | null;
    TanpaPembayaran: boolean | null;
  }[];
  if (stopRows.length === 0) return jadwalRows.map((j) => ({ jadwalId: j.JadwalID, driverName: j.DriverName, armadaNama: j.ArmadaNama, jamSelesaiMuat: j.JamSelesaiMuat.toISOString(), stops: [] }));

  // 3. Items ordered per SalesOrderID.
  const soIds = [...new Set(stopRows.map((r) => r.SalesOrderID))];
  const soRequest = pool.request();
  const soPlaceholders = soIds.map((id, i) => {
    soRequest.input(`so${i}`, sql.VarChar(16), id);
    return `@so${i}`;
  });
  const itemResult = await soRequest.query(`
    SELECT SalesOrderID, ItemID, Name, Qty FROM SalesOrderDetail WHERE SalesOrderID IN (${soPlaceholders.join(",")})
  `);
  const itemsBySoId = new Map<string, KartuPengirimanItemRow[]>();
  for (const r of itemResult.recordset as { SalesOrderID: string; ItemID: string; Name: string; Qty: number }[]) {
    const list = itemsBySoId.get(r.SalesOrderID) ?? [];
    list.push({ itemId: r.ItemID, itemName: r.Name, qty: r.Qty });
    itemsBySoId.set(r.SalesOrderID, list);
  }

  // 4. Retur items (StopDeliveryItem) per StopDeliveryID.
  const stopDeliveryIds = [...new Set(stopRows.map((r) => r.StopDeliveryID).filter((id): id is number => id != null))];
  const returByStopDeliveryId = new Map<number, KartuPengirimanReturRow[]>();
  const stopDeliveryItemIdsAll: number[] = [];
  const returRawByStopDeliveryId = new Map<number, { StopDeliveryItemID: number; ItemID: string; Name: string | null; QtyRetur: number; KondisiRetur: "BAIK" | "RUSAK" | null }[]>();
  if (stopDeliveryIds.length > 0) {
    const sdRequest = pool.request();
    const sdPlaceholders = stopDeliveryIds.map((id, i) => {
      sdRequest.input(`sd${i}`, sql.Int, id);
      return `@sd${i}`;
    });
    const returResult = await sdRequest.query(`
      SELECT sdi.StopDeliveryID, sdi.StopDeliveryItemID, sdi.ItemID, sod.Name, sdi.QtyRetur, sdi.KondisiRetur
      FROM DashboardPengirimanStopDeliveryItem sdi
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = sdi.SalesOrderDetailID
      WHERE sdi.StopDeliveryID IN (${sdPlaceholders.join(",")}) AND sdi.QtyRetur > 0
    `);
    for (const r of returResult.recordset as { StopDeliveryID: number; StopDeliveryItemID: number; ItemID: string; Name: string | null; QtyRetur: number; KondisiRetur: "BAIK" | "RUSAK" | null }[]) {
      const list = returRawByStopDeliveryId.get(r.StopDeliveryID) ?? [];
      list.push(r);
      returRawByStopDeliveryId.set(r.StopDeliveryID, list);
      stopDeliveryItemIdsAll.push(r.StopDeliveryItemID);
    }
  }
  const resaleMap = await getResaleBreakdownUntukStopItems(stopDeliveryItemIdsAll);
  for (const [stopDeliveryId, rows] of returRawByStopDeliveryId) {
    returByStopDeliveryId.set(
      stopDeliveryId,
      rows.map((r) => ({
        itemId: r.ItemID,
        itemName: r.Name ?? r.ItemID,
        qtyRetur: r.QtyRetur,
        kondisiRetur: r.KondisiRetur,
        resale: resaleMap.get(r.StopDeliveryItemID) ?? [],
      }))
    );
  }

  // 5. Payment per SalesInvoiceID -- same join path as getStopDeliveryProof
  //    (pengiriman-jadwal.ts), plus resolving MetodeKode -> metode label via
  //    Postgres (deduped so each distinct kode is looked up once, not once
  //    per stop).
  const invoiceIds = [...new Set(stopRows.map((r) => r.SalesInvoiceID).filter((id): id is string => id != null))];
  const paymentByInvoiceId = new Map<string, { voucherNo: string; amount: number; metodeKode: string | null }>();
  if (invoiceIds.length > 0) {
    const payRequest = pool.request();
    const payPlaceholders = invoiceIds.map((id, i) => {
      payRequest.input(`si${i}`, sql.VarChar(16), id);
      return `@si${i}`;
    });
    const payResult = await payRequest.query(`
      SELECT spd.SalesInvoiceID, sp.VoucherNo, spd.Amount, spm.MetodeKode,
             ROW_NUMBER() OVER (PARTITION BY spd.SalesInvoiceID ORDER BY sp.TransDate DESC) AS rn
      FROM SalesPaymentDetail spd
      JOIN SalesPayment sp ON sp.SalesPaymentID = spd.SalesPaymentID
      LEFT JOIN DashboardSalesPaymentMetode spm ON spm.SalesPaymentID = sp.SalesPaymentID
      WHERE spd.SalesInvoiceID IN (${payPlaceholders.join(",")}) AND spd.IsDeleted = 0
    `);
    for (const r of payResult.recordset as { SalesInvoiceID: string; VoucherNo: string; Amount: number; MetodeKode: string | null; rn: number }[]) {
      if (r.rn !== 1) continue; // most recent payment per invoice only, matching getStopDeliveryProof's TOP 1
      paymentByInvoiceId.set(r.SalesInvoiceID, { voucherNo: r.VoucherNo, amount: r.Amount, metodeKode: r.MetodeKode });
    }
  }
  const distinctKode = [...new Set([...paymentByInvoiceId.values()].map((p) => p.metodeKode).filter((k): k is string => k != null))];
  const metodeLabelByKode = new Map<string, "TUNAI" | "QRIS" | "TRANSFER">();
  for (const kode of distinctKode) {
    const row = await getMetodePembayaranByKode(perusahaanId, kode);
    if (row) metodeLabelByKode.set(kode, row.metode);
  }

  // 6. Assemble.
  const stopsByJadwalId = new Map<number, KartuPengirimanStopRow[]>();
  for (const s of stopRows) {
    const payment = s.SalesInvoiceID ? paymentByInvoiceId.get(s.SalesInvoiceID) : undefined;
    let statusBayar: StatusBayar;
    let nominalBayar: number | null = null;
    if (s.TanpaPembayaran) {
      statusBayar = "TIDAK_BAYAR";
    } else if (payment) {
      statusBayar = payment.metodeKode ? (metodeLabelByKode.get(payment.metodeKode) ?? "BELUM_BAYAR") : "BELUM_BAYAR";
      nominalBayar = payment.amount;
    } else {
      statusBayar = "BELUM_BAYAR";
    }
    const list = stopsByJadwalId.get(s.JadwalID) ?? [];
    list.push({
      jadwalDetailId: s.JadwalDetailID,
      customerName: s.CustomerName,
      items: itemsBySoId.get(s.SalesOrderID) ?? [],
      statusBayar,
      nominalBayar,
      retur: s.StopDeliveryID != null ? (returByStopDeliveryId.get(s.StopDeliveryID) ?? []) : [],
    });
    stopsByJadwalId.set(s.JadwalID, list);
  }

  return jadwalRows.map((j) => ({
    jadwalId: j.JadwalID,
    driverName: j.DriverName,
    armadaNama: j.ArmadaNama,
    jamSelesaiMuat: j.JamSelesaiMuat.toISOString(),
    stops: stopsByJadwalId.get(j.JadwalID) ?? [],
  }));
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/laporan-shift-pengiriman.ts`
Expected: clean.

Live-DB check (read-only): pick a real, recent `(tanggalUsaha, shift)` you know had deliveries (cross-check via the existing Papan Pengiriman board for that businessDate/time range), call `getKartuPengirimanUntukShift` for it with a real `perusahaanId` (read one via `SELECT id FROM perusahaan WHERE kode = 'MKE'` against Postgres, or check `getPerusahaanByKode`/similar if it exists — otherwise ask which numeric id MKEsindo uses in `perusahaan` before writing the test script), and manually cross-check 2-3 stops' item qty, payment status, and retur figures against what `RouteValidationDialog`'s "Bukti Pengiriman" popup shows for the same stops.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/laporan-shift-pengiriman.ts
git commit -m "feat: add per-shift kartu pengiriman read (items, status bayar, retur+resale)"
```

---

### Task 5: BBM-per-shift read function

**Files:**
- Modify: `src/lib/queries/driver-fuel.ts`

**Interfaces:**
- Produces: `getBbmUntukShift(tanggalUsaha: string, shift: ShiftNumber): Promise<{ salesmanId: string; driverName: string | null; liter: number; nominalAsli: number; nominalEkstra: number; waktuIsi: string }[]>` — consumed by Task 7.

- [ ] **Step 1: Add the function**

Append to `src/lib/queries/driver-fuel.ts`:

```ts
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";

export interface BbmShiftRow {
  salesmanId: string;
  driverName: string | null;
  liter: number;
  nominalAsli: number;
  nominalEkstra: number;
  waktuIsi: string; // ISO
}

// Grouped by WaktuIsi's own real-time shift window (when the money left the
// register), NOT the parent Jadwal's own JamSelesaiMuat-based shift --
// deliberately different from laporan-muatan-distribusi.ts's BBMPerJadwal
// CTE, which groups by the Jadwal's loading shift for a different report.
// See this plan's Global Constraints.
export async function getBbmUntukShift(tanggalUsaha: string, shift: ShiftNumber): Promise<BbmShiftRow[]> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const window = getShiftWindow(businessDate, shift, "work");
  const result = await pool
    .request()
    .input("start", sql.DateTime, window.start)
    .input("end", sql.DateTime, window.end).query(`
      SELECT b.SalesmanID, sm.Name AS DriverName, b.Liter, b.NominalAsli, b.NominalEkstra, b.WaktuIsi
      FROM DashboardPengirimanBBM b
      LEFT JOIN Salesman sm ON sm.SalesmanID = b.SalesmanID
      WHERE b.WaktuIsi IS NOT NULL AND b.WaktuIsi BETWEEN @start AND @end
      ORDER BY b.WaktuIsi
    `);
  return (result.recordset as { SalesmanID: string; DriverName: string | null; Liter: number; NominalAsli: number; NominalEkstra: number; WaktuIsi: Date }[]).map(
    (r) => ({
      salesmanId: r.SalesmanID,
      driverName: r.DriverName,
      liter: r.Liter,
      nominalAsli: r.NominalAsli,
      nominalEkstra: r.NominalEkstra,
      waktuIsi: r.WaktuIsi.toISOString(),
    })
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/driver-fuel.ts`
Expected: clean.

Live-DB check (read-only): find a real `(tanggalUsaha, shift)` with BBM entries via `SELECT TOP 5 WaktuIsi FROM DashboardPengirimanBBM WHERE WaktuIsi IS NOT NULL ORDER BY WaktuIsi DESC`, derive its shift with `getReportShift`-equivalent logic (or just pick the window containing that timestamp), call `getBbmUntukShift`, confirm the rows match `SELECT * FROM DashboardPengirimanBBM WHERE WaktuIsi BETWEEN ... AND ...` run directly.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/driver-fuel.ts
git commit -m "feat: add per-shift BBM expense read"
```

---

### Task 6: Mesin counter (per-batch timestamped readings) read function

**Files:**
- Modify: `src/lib/queries/produksi-mesin.ts`

**Interfaces:**
- Produces: `getMesinCounterUntukShift(tanggalUsaha: string, shift: ShiftNumber): Promise<{ mesinId: number; mesinNama: string; readings: { jamPanen: string; qty10KG: number }[] }[]>` — consumed by Task 7. `jamPanen` is a plain `"HH:mm"` clock-time string (from `DashboardProduksiBatch.JamPanen`, `VARCHAR(5)`), NOT an ISO datetime — do not run it through a UTC/WIB datetime formatter.

- [ ] **Step 1: Add the function**

Append to `src/lib/queries/produksi-mesin.ts`:

```ts
import { type ShiftNumber } from "@/lib/report-shift";

export interface MesinCounterReading {
  jamPanen: string; // "HH:mm" clock-time label, NOT an ISO datetime -- see note below
  qty10KG: number;
}
export interface MesinCounterRow {
  mesinId: number;
  mesinNama: string;
  readings: MesinCounterReading[];
}

// Individual DashboardProduksiBatch rows (one row per "panen"/harvest
// event), NOT aggregated like getQtyRecapForShift's perMesin totals in
// aktivitas-produksi.ts -- this is the timestamped counter list format
// (jam | qty per event) the Laporan Shift design references, TanggalLabel/
// Shift are stored directly on Batch (copied at insert time from Kualitas),
// same lookup basis getQtyRecapForShift already uses.
//
// JamPanen is DashboardProduksiBatch.JamPanen, VARCHAR(5) "HH:mm" (same
// "Jam field convention" as DriverProfile.JamMulaiKerja/JamSelesaiKerja --
// see the 2026-08-11 warehouse-ice-stock-redesign plan's own DDL), NOT a
// SQL datetime column -- the mssql driver returns it as a plain string, so
// it is passed straight through with NO Date/.toISOString() conversion (an
// earlier draft of this task's code called .toISOString() on it, which
// throws TypeError on every real row -- confirmed and fixed during Task 6's
// own implementation). Nullable for batches recorded before this field
// existed, coalesced to "" here rather than crashing a downstream renderer.
export async function getMesinCounterUntukShift(tanggalUsaha: string, shift: ShiftNumber): Promise<MesinCounterRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("tanggalLabel", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift).query(`
      SELECT b.MesinID, m.Nama AS MesinNama, b.JamPanen, b.Qty10KG
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0 AND b.TanggalLabel = @tanggalLabel AND b.Shift = @shift
      ORDER BY b.MesinID, b.JamPanen
    `);
  const byMesin = new Map<number, MesinCounterRow>();
  for (const r of result.recordset as { MesinID: number; MesinNama: string; JamPanen: string | null; Qty10KG: number }[]) {
    const entry = byMesin.get(r.MesinID) ?? { mesinId: r.MesinID, mesinNama: r.MesinNama, readings: [] };
    entry.readings.push({ jamPanen: r.JamPanen ?? "", qty10KG: r.Qty10KG });
    byMesin.set(r.MesinID, entry);
  }
  return [...byMesin.values()];
}
```

Note (recorded after Task 6's actual implementation and review): `ORDER BY b.MesinID, b.JamPanen` is a lexicographic STRING sort — correct for Shift 1/2, but for Shift 3 (which crosses midnight) a reading at `"00:05"` sorts before one at `"23:12"` even though it happened later chronologically. This is spec-mandated as written (design spec: "urutkan per `MesinID, JamPanen ASC`") and left as-is — a known, low-severity display-ordering quirk for Shift 3's counter list, not a data-correctness bug.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/produksi-mesin.ts`
Expected: clean.

Live-DB check (read-only): pick a real `(tanggalUsaha, shift)` with production via `SELECT TOP 1 TanggalLabel, Shift FROM DashboardProduksiBatch WHERE IsDeleted = 0 ORDER BY TanggalLabel DESC`, call `getMesinCounterUntukShift` for it, confirm the readings' count and total qty match `SELECT MesinID, COUNT(*), SUM(Qty10KG) FROM DashboardProduksiBatch WHERE TanggalLabel = @t AND Shift = @s AND IsDeleted = 0 GROUP BY MesinID` run directly.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/produksi-mesin.ts
git commit -m "feat: add per-shift mesin counter (per-batch timestamped) read"
```

---

### Task 7: Compose everything — `getLaporanShiftDetail`

**Files:**
- Create: `src/lib/queries/laporan-shift-detail.ts`

**Interfaces:**
- Consumes: `getShiftLabel`, `getPreviousShift`, `ShiftNumber` (`report-shift.ts`); `getAktivitasForShift`, `getQtyRecapForShift`, `hitungTotalDenda` (`aktivitas-produksi.ts`, all already exist); `getStokBahanBakuHistory` (`stok-bahan-baku.ts`, already exists); `getKasKecilShiftForTanggalShift` (Task 3); `getMesinEventsForShift` (`produksi-mesin-event.ts`, already exists); `getMesinList` (`produksi-mesin.ts`, already exists); `getMesinCounterUntukShift` (Task 6); `getKartuPengirimanUntukShift` (Task 4); `getBbmUntukShift` (Task 5); `getSnapshotStokEs`, `hitungTotalSisaStokEsLive` (Task 1); `getReportShift` (`report-shift.ts`).
- Produces: `getLaporanShiftDetail(tanggalUsaha: string, shift: ShiftNumber, perusahaanId: number): Promise<LaporanShiftDetail>` — consumed by Task 8.

- [ ] **Step 1: Write the composing function**

```ts
// src/lib/queries/laporan-shift-detail.ts
import { getShiftLabel, getPreviousShift, getReportShift, type ShiftNumber } from "@/lib/report-shift";
import { getAktivitasForShift, getQtyRecapForShift, hitungTotalDenda } from "@/lib/queries/aktivitas-produksi";
import { getStokBahanBakuHistory, type StokBahanBakuRow } from "@/lib/queries/stok-bahan-baku";
import { getKasKecilShiftForTanggalShift, type KasKecilShiftRow } from "@/lib/queries/kas-kecil";
import { getMesinEventsForShift, type MesinEventRow } from "@/lib/queries/produksi-mesin-event";
import { getMesinList, getMesinCounterUntukShift, type MesinRow, type MesinCounterRow } from "@/lib/queries/produksi-mesin";
import { getKartuPengirimanUntukShift, type KartuPengirimanRow } from "@/lib/queries/laporan-shift-pengiriman";
import { getBbmUntukShift, type BbmShiftRow } from "@/lib/queries/driver-fuel";
import { getSnapshotStokEs, hitungTotalSisaStokEsLive } from "@/lib/queries/laporan-shift-stok-es-snapshot";

export interface StokEsInfo {
  stokAwal: number | null; // null when the previous shift has no snapshot yet
  stokAkhir: number;
  stokAkhirFinal: boolean; // false when this is the currently-running shift (live figure)
}

export interface LaporanShiftDetail {
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
  timId: number | null;
  stafOperasionalAkunId: number | null;
  stokBahanBaku: StokBahanBakuRow[];
  kartuPengiriman: KartuPengirimanRow[];
  bbm: BbmShiftRow[];
  kasKecil: KasKecilShiftRow | null;
  produksiKantongEkivalen: number;
  produksiTotalDenda: number;
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  mesinCounter: MesinCounterRow[];
  stokEs: StokEsInfo;
}

// hitungLimitHistori mirrors laporan-ringkasan-lintas-shift.ts's own helper
// (same reasoning: getStokBahanBakuHistory's `limit` caps a TOP-N window,
// so a shift far enough in the past needs a correspondingly large limit to
// guarantee it's still inside that window) -- duplicated here rather than
// imported since laporan-ringkasan-lintas-shift.ts's version is private
// (not exported) and this is a handful of lines.
function hitungLimitHistori(tanggalUsaha: string, maxBarisPerHari: number): number {
  const targetDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const sekarang = new Date();
  const hariMundur = Math.max(0, Math.ceil((sekarang.getTime() - targetDate.getTime()) / 86_400_000));
  return (hariMundur + 7) * maxBarisPerHari;
}

export async function getLaporanShiftDetail(tanggalUsaha: string, shift: ShiftNumber, perusahaanId: number): Promise<LaporanShiftDetail> {
  const previous = getPreviousShift(tanggalUsaha, shift);
  const { shift: shiftBerjalan, businessDate: businessDateBerjalan } = getReportShift("work");
  const tanggalUsahaBerjalan = businessDateBerjalan.toISOString().slice(0, 10);
  const isShiftBerjalan = tanggalUsaha === tanggalUsahaBerjalan && shift === shiftBerjalan;
  // getMesinEventsForShift takes (businessDate: Date, shift), not
  // (tanggalUsaha: string, shift) like every other function called below --
  // matching its existing real signature (produksi-mesin-event.ts).
  const businessDateUntukMesinEvent = new Date(`${tanggalUsaha}T00:00:00Z`);

  const [
    stokBahanBakuHistory,
    kartuPengiriman,
    bbm,
    kasKecil,
    aktivitas,
    qtyRecap,
    mesinList,
    mesinEvents,
    mesinCounter,
    snapshotAkhir,
    snapshotAwal,
  ] = await Promise.all([
    getStokBahanBakuHistory(hitungLimitHistori(tanggalUsaha, 9)), // 3 JenisBarang x 3 shift
    getKartuPengirimanUntukShift(tanggalUsaha, shift, perusahaanId),
    getBbmUntukShift(tanggalUsaha, shift),
    getKasKecilShiftForTanggalShift(tanggalUsaha, shift),
    getAktivitasForShift(tanggalUsaha, shift),
    getQtyRecapForShift(tanggalUsaha, shift),
    getMesinList(),
    getMesinEventsForShift(businessDateUntukMesinEvent, shift),
    getMesinCounterUntukShift(tanggalUsaha, shift),
    isShiftBerjalan ? Promise.resolve(null) : getSnapshotStokEs(tanggalUsaha, shift),
    getSnapshotStokEs(previous.tanggalUsaha, previous.shift),
  ]);

  const stokBahanBaku = stokBahanBakuHistory.filter((r) => r.tanggalUsaha === tanggalUsaha && r.shift === shift);

  const stokAkhir = isShiftBerjalan ? await hitungTotalSisaStokEsLive() : (snapshotAkhir ?? (await hitungTotalSisaStokEsLive()));

  return {
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    timId: aktivitas.timId,
    stafOperasionalAkunId: aktivitas.stafOperasionalAkunId,
    stokBahanBaku,
    kartuPengiriman,
    bbm,
    kasKecil,
    produksiKantongEkivalen: qtyRecap.totalKantongEkivalen,
    produksiTotalDenda: hitungTotalDenda(aktivitas.pecahKemasanQty, aktivitas.esJatuhQty),
    mesinList,
    mesinEvents,
    mesinCounter,
    stokEs: {
      stokAwal: snapshotAwal,
      stokAkhir,
      stokAkhirFinal: !isShiftBerjalan && snapshotAkhir != null,
    },
  };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/laporan-shift-detail.ts`
Expected: clean.

Live-DB check (read-only): call `getLaporanShiftDetail` for (a) a real recent PAST shift with known data, confirming `stokEs.stokAkhirFinal` is `true` only if a snapshot exists (it may be `false` with a live figure if this feature was deployed after that shift — expected), and (b) the CURRENTLY RUNNING shift (via `getReportShift("work")`), confirming `stokEs.stokAkhirFinal` is `false`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/laporan-shift-detail.ts
git commit -m "feat: compose getLaporanShiftDetail from all per-shift subsystems"
```

---

### Task 8: Server action

**Files:**
- Modify: `src/app/mkesindo/(dashboard)/laporan/actions.ts`

**Interfaces:**
- Consumes: `getLaporanShiftDetail`, `LaporanShiftDetail` (Task 7); `requireModuleAccess` (`src/lib/require-access.ts`, already used by this file's siblings — read the current file first to match its exact existing action style).
- Produces: `getLaporanShiftDetailAction(tanggalUsaha: string, shift: ShiftNumber): Promise<ActionResult<LaporanShiftDetail>>` — consumed by Task 9.

- [ ] **Step 1: Add the action**

`src/app/mkesindo/(dashboard)/laporan/actions.ts` already imports `AppError, runAction, type ActionResult` from `@/lib/action-result` and `requireModuleAccess` from `@/lib/require-access` (used by every existing action in this file, e.g. `getCurrentShiftRowsAction`) — reuse both directly, no new imports of these two. Add the two new imports below alongside the file's existing import block, then append the action at the end of the file:

```ts
import { getLaporanShiftDetail, type LaporanShiftDetail } from "@/lib/queries/laporan-shift-detail";
import type { ShiftNumber } from "@/lib/report-shift";

export async function getLaporanShiftDetailAction(tanggalUsaha: string, shift: ShiftNumber): Promise<ActionResult<LaporanShiftDetail>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    if (!session.user.perusahaanId) throw new AppError("Akun ini tidak terhubung ke PT manapun.");
    return getLaporanShiftDetail(tanggalUsaha, shift, session.user.perusahaanId);
  });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint "src/app/mkesindo/(dashboard)/laporan/actions.ts"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/mkesindo/(dashboard)/laporan/actions.ts"
git commit -m "feat: add getLaporanShiftDetailAction server action"
```

---

### Task 9: UI — shift selector + 7-section detail card with sticky jump-nav

**Files:**
- Create: `src/components/dashboard/laporan-shift-detail.tsx`
- Modify: `src/components/dashboard/laporan-tab-shell.tsx`

**Interfaces:**
- Consumes: `getLaporanShiftDetailAction` (Task 8); `LaporanShiftDetail`/`StatusBayar` types (Tasks 4/7); `getReportShift` (client-safe? — check: `report-shift.ts` has no `"use client"` boundary issue since it only uses `Intl.DateTimeFormat`/plain JS, no `@/lib/db` import, so it's safe to import from a client component for computing a sensible default shift to preselect).
- Produces: `LaporanShiftDetail` component (the file's own default export name may differ — follow this codebase's existing naming, e.g. `export function LaporanShiftDetailView(...)` to avoid a name collision with the `LaporanShiftDetail` TYPE imported from Task 7).

- [ ] **Step 1: Read `laporan-tab-shell.tsx`'s current full content** (already read during planning — reproduced below for reference) and `src/components/dashboard/laporan-ringkasan-lintas-shift.tsx` for the month+shift selector pattern to mirror (read this file fully now if not already familiar with its exact selector UI, since Step 3 below reuses its interaction style).

- [ ] **Step 2: Write the shift-detail component**

```tsx
// src/components/dashboard/laporan-shift-detail.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah, formatTime, formatDate } from "@/lib/format";
import { getLaporanShiftDetailAction } from "@/app/mkesindo/(dashboard)/laporan/actions";
import { getReportShift, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import type { LaporanShiftDetail } from "@/lib/queries/laporan-shift-detail";
import type { StatusBayar } from "@/lib/queries/laporan-shift-pengiriman";

const STATUS_BAYAR_LABEL: Record<StatusBayar, string> = {
  TUNAI: "Tunai",
  QRIS: "QRIS",
  TRANSFER: "Transfer",
  TIDAK_BAYAR: "Tidak Bayar",
  BELUM_BAYAR: "Belum Bayar",
};

const SECTIONS = [
  { id: "stok-bahan-baku", label: "Stok Bahan Baku" },
  { id: "kartu-pengiriman", label: "Kartu Pengiriman" },
  { id: "kas", label: "Kas" },
  { id: "produksi", label: "Produksi" },
  { id: "mesin", label: "Mesin" },
  { id: "stok-es", label: "Stok Es" },
] as const;

function todayDefault(): { tanggalUsaha: string; shift: ShiftNumber } {
  const { shift, businessDate } = getReportShift("work");
  return { tanggalUsaha: businessDate.toISOString().slice(0, 10), shift };
}

export function LaporanShiftDetailView() {
  const [{ tanggalUsaha, shift }, setPilihan] = useState(todayDefault);
  const [detail, setDetail] = useState<LaporanShiftDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleTampilkan() {
    setError(null);
    startTransition(async () => {
      const result = await getLaporanShiftDetailAction(tanggalUsaha, shift);
      if (!result.success) {
        setError(result.error);
        setDetail(null);
        return;
      }
      setDetail(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Tanggal Usaha</label>
          <Input type="date" value={tanggalUsaha} onChange={(e) => setPilihan((p) => ({ ...p, tanggalUsaha: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Shift</label>
          <Select value={String(shift)} onValueChange={(v) => setPilihan((p) => ({ ...p, shift: Number(v) as ShiftNumber }))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3].map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {getShiftLabel(s as ShiftNumber, "work")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleTampilkan} disabled={pending}>
          {pending ? "Memuat..." : "Tampilkan"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {detail && (
        <div className="flex flex-col gap-4 rounded-lg border p-4">
          <div className="sticky top-0 z-10 -mx-4 -mt-4 flex flex-wrap gap-1 border-b bg-background px-4 py-2">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                {s.label}
              </a>
            ))}
          </div>

          <div>
            <h2 className="font-display text-lg font-semibold">
              {formatDate(detail.tanggalUsaha)} — {detail.shiftLabel}
            </h2>
          </div>

          <section id="stok-bahan-baku" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Stok Bahan Baku</h3>
            {detail.stokBahanBaku.length === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada data stok bahan baku pada shift ini.</p>
            ) : (
              <div className="flex flex-col gap-1.5 text-xs">
                {detail.stokBahanBaku.map((r) => (
                  <div key={r.jenisBarang} className="flex flex-col gap-0.5 rounded border p-2">
                    <span className="font-medium">{r.jenisBarang}</span>
                    <span>
                      Masuk Gudang: {r.stokMasukGudang} {r.operasionalDiisiPada && `(${formatTime(r.operasionalDiisiPada)})`}
                    </span>
                    <span>
                      Masuk Inventori: {r.stokMasukInventoriOperasional} {r.operasionalDiisiPada && `(${formatTime(r.operasionalDiisiPada)})`}
                    </span>
                    <span>
                      Dipakai/Rusak Produksi: {r.stokDipakaiProduksi}/{r.stokRusakProduksi}{" "}
                      {r.produksiDiisiPada && `(${formatTime(r.produksiDiisiPada)})`}
                    </span>
                    <span className="font-medium">
                      Sisa Akhir — Gudang: {r.sisaGudangAkhir}, Inventori: {r.sisaInventoriAkhir}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="kartu-pengiriman" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Kartu Pengiriman</h3>
            {detail.kartuPengiriman.length === 0 ? (
              <p className="text-xs text-muted-foreground">Tidak ada kartu pengiriman pada shift ini.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {detail.kartuPengiriman.map((k) => (
                  <div key={k.jadwalId} className="rounded-md border p-2 text-xs">
                    <p className="mb-1.5 font-medium">
                      Jadwal #{k.jadwalId} — {k.driverName ?? "-"} ({k.armadaNama ?? "-"})
                    </p>
                    <div className="flex flex-col divide-y">
                      {k.stops.map((s) => (
                        <div key={s.jadwalDetailId} className="flex flex-col gap-1 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{s.customerName}</span>
                            <span className="text-muted-foreground">
                              {s.statusBayar === "BELUM_BAYAR" && s.nominalBayar != null
                                ? `Dibayar (metode belum tercatat) — ${formatRupiah(s.nominalBayar)}`
                                : `${STATUS_BAYAR_LABEL[s.statusBayar]}${s.nominalBayar != null ? ` — ${formatRupiah(s.nominalBayar)}` : ""}`}
                            </span>
                          </div>
                          <p className="text-muted-foreground">{s.items.map((i) => `${i.itemName} x${i.qty}`).join(", ")}</p>
                          {s.retur.map((r) => (
                            <p key={r.itemId} className="text-destructive">
                              Retur {r.itemName}: {r.qtyRetur} ({r.kondisiRetur ?? "-"})
                              {r.resale.length > 0 &&
                                ` — dijual ulang: ${r.resale.map((rs) => `${rs.jalur} x${rs.qty}`).join(", ")}`}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="kas" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Pengeluaran Uang Kas</h3>
            {detail.bbm.length === 0 && (!detail.kasKecil || detail.kasKecil.pengeluaran.length === 0) ? (
              <p className="text-xs text-muted-foreground">Tidak ada pengeluaran kas pada shift ini.</p>
            ) : (
              <div className="flex flex-col gap-1 text-xs">
                {detail.bbm.map((b, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span>
                      BBM — {b.driverName ?? b.salesmanId} ({formatTime(b.waktuIsi)})
                    </span>
                    <span>{formatRupiah((b.nominalAsli ?? 0) + (b.nominalEkstra ?? 0))}</span>
                  </div>
                ))}
                {detail.kasKecil?.pengeluaran.map((p) => (
                  <div key={p.pengeluaranId} className="flex items-center justify-between">
                    <span>{p.keterangan}</span>
                    <span>{formatRupiah(p.nominal)}</span>
                  </div>
                ))}
                {detail.kasKecil && (
                  <div className="mt-1 flex items-center justify-between border-t pt-1 font-medium">
                    <span>Total Pengeluaran / Saldo Akhir</span>
                    <span>
                      {formatRupiah(detail.kasKecil.totalPengeluaran)} / {formatRupiah(detail.kasKecil.saldoAkhir)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>

          <section id="produksi" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Data Produksi</h3>
            <p className="text-xs">Kantong Ekivalen: {detail.produksiKantongEkivalen}</p>
            <p className="text-xs">Total Denda: {formatRupiah(detail.produksiTotalDenda)}</p>
          </section>

          <section id="mesin" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Mesin</h3>
            <div className="flex flex-col gap-2 text-xs">
              {detail.mesinList.map((m) => {
                const events = detail.mesinEvents.filter((e) => e.mesinId === m.MesinID);
                const counter = detail.mesinCounter.find((c) => c.mesinId === m.MesinID);
                return (
                  <div key={m.MesinID} className="rounded border p-2">
                    <p className="mb-1 font-medium">{m.Nama}</p>
                    <p className="text-muted-foreground">
                      {events.length === 0 ? "Tidak ada event ON/OFF" : events.map((e) => `${e.jenisEvent} ${formatTime(e.waktuEvent)}`).join(", ")}
                    </p>
                    {counter && counter.readings.length > 0 && (
                      <p className="text-muted-foreground">
                        Counter: {counter.readings.map((r) => `${r.jamPanen || "-"}|${r.qty10KG}`).join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section id="stok-es" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Stok Es</h3>
            <p className="text-xs">Stok Awal: {detail.stokEs.stokAwal ?? "Belum ada data"}</p>
            <p className="text-xs">
              Stok Akhir: {detail.stokEs.stokAkhir} {!detail.stokEs.stokAkhirFinal && "(live, belum final)"}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
```

`formatRupiah(value: number)`, `formatDate(value: string | Date)`, `formatTime(value: string | Date)` are all confirmed to exist in `src/lib/format.ts` with exactly these signatures — the import above is correct as written.

- [ ] **Step 3: Wire the new tab into `laporan-tab-shell.tsx`**

In `src/components/dashboard/laporan-tab-shell.tsx`: add `"laporan-shift"` to the `LaporanTab` union (line 17), add a new `<Button>` for it in the tab-switcher row (after the existing 5), import `LaporanShiftDetailView` from `@/components/dashboard/laporan-shift-detail`, and add a new `<div className={cn(tab !== "laporan-shift" && "hidden")}><LaporanShiftDetailView /></div>` block alongside the 5 existing ones. This component needs no props from `LaporanTabShell`'s existing prop list (it fetches its own data on demand via the server action) — do not thread any of the existing `page.tsx`-fetched props into it.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/components/dashboard/laporan-shift-detail.tsx src/components/dashboard/laporan-tab-shell.tsx`
Expected: clean.

Manual browser check on `/mkesindo/laporan`: click the new "Laporan Shift" tab, pick a real recent date+shift known to have kartu pengiriman/kas/produksi/mesin data, click "Tampilkan", confirm all 7 sections render with real data (or the correct "tidak ada data" message where genuinely empty), confirm the sticky jump-nav links scroll to the right section, and confirm the currently-running shift shows "(live, belum final)" next to Stok Akhir while any past shift with a snapshot does not.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/laporan-shift-detail.tsx src/components/dashboard/laporan-tab-shell.tsx
git commit -m "feat: add Laporan Shift tab UI with shift selector and sticky jump-nav"
```
