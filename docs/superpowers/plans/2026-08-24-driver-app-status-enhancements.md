# Driver-app Status Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add arrival gating (100m), a server-truth istirahat (break) lock overlay that survives the app being force-closed, a self-reported Pengiriman Terkendala flag with per-stop reordering, and two small time/estimate display additions — across driver-app and desktop's Validasi Rute.

**Architecture:** Two new MSSQL tables (`DashboardPengirimanIstirahat`, `DashboardPengirimanTerkendala`) plus one new nullable column (`DashboardPengirimanJadwalDetail.UrutanOverride`), following the exact conventions `DashboardPengirimanKendala`/`driver-kendala.ts` already established. `DriverStopRow` (shared by driver-app and desktop's `RouteValidationDialog`) gains 4 new fields. A new driver-app root layout enforces the istirahat lock from a server-read row, not client state.

**Tech Stack:** Next.js server actions, `mssql` (MKEsindo ERP DB), existing `haversineKm()` (`src/lib/route-estimate.ts`), existing `SwipeToConfirm`/`Select`/`Dialog` UI components.

**Spec:** `docs/superpowers/specs/2026-08-24-driver-app-status-enhancements-design.md`

## Global Constraints

- `DashboardPengirimanTerkendala`/`DashboardPengirimanIstirahat` are entirely separate from `DashboardPengirimanKendala` — no shared table, no shared dialog, no shared query function.
- The istirahat lock's source of truth is always the server row (`WaktuSelesai IS NULL`) — never client-only state.
- `getDriverJadwalStops()` (`src/lib/queries/pengiriman-jadwal.ts`) is shared by driver-app AND desktop's `RouteValidationDialog` (via `getJadwalDetailAction`). It may SELECT `UrutanOverride`/`IsTerkendala`/`TerkendalaAlasan` but its `ORDER BY` must stay exactly `Urutan` — the `UrutanOverride ?? Urutan` re-sort happens ONLY client-side inside `stop-flow.tsx`'s `remainingStops` derivation.
- Arrival gating has no override path when GPS fails — the phone button is the only always-available action in that state.
- Every new driver-app action follows the existing `requireOwnSalesmanId()` + `assertOwnsJadwal`/`assertOwnsJadwalDetail` ownership-check pattern already used by `recordStopArrivalAction`/`reportKendalaAction` in `src/app/mkesindo/driver-app/actions.ts`.

---

### Task 1: MSSQL schema — istirahat, terkendala, UrutanOverride

**Files:**
- Create: `scripts/create-driver-status-tables.ts`

**Interfaces:**
- Produces: two new tables + one new column, read/written by every later task.

- [ ] **Step 1: Write the migration script**

Mirrors `scripts/create-dashboard-sales-payment-metode-table.ts`'s exact shape (this app's own `getPool()`, MSSQL's `IF NOT EXISTS (SELECT * FROM sysobjects ...)` idiom for tables, and `IF NOT EXISTS (SELECT * FROM sys.columns ...)` for the new column).

```typescript
// One-off schema creation for driver-app status features (istirahat,
// pengiriman terkendala, driver-app-only stop reordering).
// Idempotent — safe to re-run. Usage: npx tsx scripts/create-driver-status-tables.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPengirimanIstirahat' AND xtype='U')
    CREATE TABLE DashboardPengirimanIstirahat (
      IstirahatID   INT IDENTITY PRIMARY KEY,
      JadwalID      INT NOT NULL,
      SalesmanID    VARCHAR(16) NOT NULL,
      Keterangan    VARCHAR(200) NOT NULL,
      WaktuMulai    DATETIME NOT NULL DEFAULT GETDATE(),
      WaktuSelesai  DATETIME NULL,
      CreatedDate   DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardPengirimanTerkendala' AND xtype='U')
    CREATE TABLE DashboardPengirimanTerkendala (
      TerkendalaID    INT IDENTITY PRIMARY KEY,
      JadwalDetailID  INT NOT NULL,
      SalesmanID      VARCHAR(16) NOT NULL,
      Alasan          VARCHAR(200) NOT NULL,
      IsResolved      BIT NOT NULL DEFAULT 0,
      CreatedDate     DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns
      WHERE object_id = OBJECT_ID('DashboardPengirimanJadwalDetail') AND name = 'UrutanOverride'
    )
    ALTER TABLE DashboardPengirimanJadwalDetail ADD UrutanOverride INT NULL
  `);

  console.log("DashboardPengirimanIstirahat + DashboardPengirimanTerkendala + UrutanOverride ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/create-driver-status-tables.ts`
Expected: `DashboardPengirimanIstirahat + DashboardPengirimanTerkendala + UrutanOverride ready.`

- [ ] **Step 3: Verify and re-run for idempotency**

Write a throwaway script querying `SELECT TOP 1 * FROM DashboardPengirimanIstirahat`, `SELECT TOP 1 * FROM DashboardPengirimanTerkendala`, and `SELECT UrutanOverride FROM DashboardPengirimanJadwalDetail WHERE 1=0` (schema-only check) via `getPool()` — all three must succeed without "invalid object/column name". Delete the throwaway script afterward. Re-run the real migration script once more — expect it to succeed silently (no duplicate-object errors).

- [ ] **Step 4: Commit**

```bash
git add scripts/create-driver-status-tables.ts
git commit -m "feat: add istirahat/terkendala tables and UrutanOverride column"
```

---

### Task 2: Query layer — istirahat

**Files:**
- Create: `src/lib/queries/driver-istirahat.ts`

**Interfaces:**
- Produces:
  - `interface ActiveIstirahat { istirahatId: number; keterangan: string; waktuMulai: string }`
  - `getActiveIstirahat(salesmanId: string): Promise<ActiveIstirahat | null>`
  - `startIstirahat(jadwalId: number, salesmanId: string, keterangan: string): Promise<number>` (returns new `IstirahatID`)
  - `endIstirahat(istirahatId: number, salesmanId: string): Promise<void>` (throws `AppError` if not found/not owned)
  - `interface IstirahatSession { keterangan: string; waktuMulai: string; waktuSelesai: string | null; durasiMenit: number }`
  - `getIstirahatForJadwal(jadwalId: number): Promise<IstirahatSession[]>`

- [ ] **Step 1: Write the file**

```typescript
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface ActiveIstirahat {
  istirahatId: number;
  keterangan: string;
  waktuMulai: string;
}

// Checked from the driver-app root layout on every load — the lock
// overlay's entire reason for surviving an app kill is that this reads a
// real server row, not client state. NULL WaktuSelesai = currently on break.
export async function getActiveIstirahat(salesmanId: string): Promise<ActiveIstirahat | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId).query(`
      SELECT TOP 1 IstirahatID, Keterangan, WaktuMulai
      FROM DashboardPengirimanIstirahat
      WHERE SalesmanID = @salesmanId AND WaktuSelesai IS NULL
      ORDER BY WaktuMulai DESC
    `);
  const row = result.recordset[0] as { IstirahatID: number; Keterangan: string; WaktuMulai: Date } | undefined;
  if (!row) return null;
  return { istirahatId: row.IstirahatID, keterangan: row.Keterangan, waktuMulai: row.WaktuMulai.toISOString() };
}

export async function startIstirahat(jadwalId: number, salesmanId: string, keterangan: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("keterangan", sql.VarChar(200), keterangan).query(`
      INSERT INTO DashboardPengirimanIstirahat (JadwalID, SalesmanID, Keterangan)
      OUTPUT INSERTED.IstirahatID
      VALUES (@jadwalId, @salesmanId, @keterangan)
    `);
  return (result.recordset[0] as { IstirahatID: number }).IstirahatID;
}

// Scoped to salesmanId in the WHERE clause itself (not a separate ownership
// check) — a mismatched id makes the UPDATE affect 0 rows, caught below.
export async function endIstirahat(istirahatId: number, salesmanId: string): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, istirahatId)
    .input("salesmanId", sql.VarChar(16), salesmanId).query(`
      UPDATE DashboardPengirimanIstirahat
      SET WaktuSelesai = GETDATE()
      WHERE IstirahatID = @id AND SalesmanID = @salesmanId AND WaktuSelesai IS NULL
    `);
  if (result.rowsAffected[0] === 0) {
    throw new AppError("Sesi istirahat ini tidak ditemukan atau sudah selesai.");
  }
}

export interface IstirahatSession {
  keterangan: string;
  waktuMulai: string;
  waktuSelesai: string | null;
  durasiMenit: number;
}

// For Validasi Rute's time summary (Task 11) — an in-progress session
// (waktuSelesai still null) has its duration computed up to now, not left
// as 0, so the "Total Istirahat" figure keeps growing live on every
// dialog re-open while a driver is still on break.
export async function getIstirahatForJadwal(jadwalId: number): Promise<IstirahatSession[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT Keterangan, WaktuMulai, WaktuSelesai,
             DATEDIFF(MINUTE, WaktuMulai, ISNULL(WaktuSelesai, GETDATE())) AS DurasiMenit
      FROM DashboardPengirimanIstirahat
      WHERE JadwalID = @jadwalId
      ORDER BY WaktuMulai
    `);
  return (
    result.recordset as { Keterangan: string; WaktuMulai: Date; WaktuSelesai: Date | null; DurasiMenit: number }[]
  ).map((r) => ({
    keterangan: r.Keterangan,
    waktuMulai: r.WaktuMulai.toISOString(),
    waktuSelesai: r.WaktuSelesai ? r.WaktuSelesai.toISOString() : null,
    durasiMenit: r.DurasiMenit,
  }));
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/lib/queries/driver-istirahat.ts`.

- [ ] **Step 3: Manual smoke test**

Write a throwaway script: call `startIstirahat` with a real `jadwalId`/`salesmanId` from an existing Jadwal, confirm `getActiveIstirahat` returns it, call `endIstirahat`, confirm `getActiveIstirahat` now returns `null` and `getIstirahatForJadwal` shows the completed session with a real `durasiMenit`. Delete the test row afterward (`DELETE FROM DashboardPengirimanIstirahat WHERE IstirahatID = ...`) and delete the throwaway script.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/driver-istirahat.ts
git commit -m "feat: add driver istirahat query layer"
```

---

### Task 3: Query layer — terkendala + extend `getDriverJadwalStops`

**Files:**
- Create: `src/lib/queries/driver-terkendala.ts`
- Modify: `src/lib/queries/pengiriman-jadwal.ts` (`DriverStopRow`, `getDriverJadwalStops`)

**Interfaces:**
- Produces:
  - `reportTerkendala(jadwalDetailId: number, salesmanId: string, alasan: string): Promise<void>`
  - `moveTerkendalaStop(jadwalDetailId: number, salesmanId: string, direction: "up" | "down", remainingDetailIdsInOrder: number[]): Promise<void>`
  - `DriverStopRow` gains: `UrutanOverride: number | null`, `IsTerkendala: boolean`, `TerkendalaAlasan: string | null`.

- [ ] **Step 1: Write `driver-terkendala.ts`**

```typescript
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export async function reportTerkendala(jadwalDetailId: number, salesmanId: string, alasan: string): Promise<void> {
  const pool = await getPool();

  // Idempotent: a double-tap (or retry after a dropped connection) must
  // not create two unresolved rows for the same stop — that would also
  // make getDriverJadwalStops()'s LEFT JOIN return duplicate base rows.
  // An existing unresolved report just gets its Alasan updated instead of
  // a second INSERT; UrutanOverride is deliberately left untouched on this
  // path so a driver's own earlier ▲▼ adjustment isn't silently undone by
  // re-reporting.
  const existing = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .query(`SELECT TerkendalaID FROM DashboardPengirimanTerkendala WHERE JadwalDetailID = @id AND IsResolved = 0`);
  if (existing.recordset[0]) {
    await pool
      .request()
      .input("terkendalaId", sql.Int, (existing.recordset[0] as { TerkendalaID: number }).TerkendalaID)
      .input("alasan", sql.VarChar(200), alasan)
      .query(`UPDATE DashboardPengirimanTerkendala SET Alasan = @alasan WHERE TerkendalaID = @terkendalaId`);
    return;
  }

  // Push to last among this stop's OWN Jadwal's remaining (not-yet-delivered)
  // stops — MAX(effective order) + 1, where "effective order" already
  // accounts for any prior UrutanOverride so repeated Terkendala reports
  // (e.g. after being reordered back up once) still land at the true end.
  const maxResult = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId).query(`
      SELECT MAX(ISNULL(other.UrutanOverride, other.Urutan)) AS MaxOrder
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwalDetail other ON other.JadwalID = jd.JadwalID AND other.IsDeleted = 0
      LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = other.JadwalDetailID
      WHERE jd.JadwalDetailID = @id AND sd.JamSelesai IS NULL
    `);
  const maxOrder = (maxResult.recordset[0] as { MaxOrder: number | null })?.MaxOrder ?? 0;

  await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("alasan", sql.VarChar(200), alasan)
    .input("urutan", sql.Int, maxOrder + 1).query(`
      INSERT INTO DashboardPengirimanTerkendala (JadwalDetailID, SalesmanID, Alasan)
      VALUES (@id, @salesmanId, @alasan);
      UPDATE DashboardPengirimanJadwalDetail SET UrutanOverride = @urutan WHERE JadwalDetailID = @id;
    `);
}

// remainingDetailIdsInOrder: the caller's OWN current effective order
// (UrutanOverride ?? Urutan) for every not-yet-delivered stop, exactly as
// stop-flow.tsx already computes it for display — swapping two adjacent
// UrutanOverride values here, rather than recomputing order server-side,
// keeps this function a pure "swap with my neighbor" operation matching
// what a single ▲▼ tap means.
export async function moveTerkendalaStop(
  jadwalDetailId: number,
  salesmanId: string,
  direction: "up" | "down",
  remainingDetailIdsInOrder: number[]
): Promise<void> {
  const index = remainingDetailIdsInOrder.indexOf(jadwalDetailId);
  if (index === -1) throw new AppError("Tujuan ini tidak ditemukan pada daftar tersisa.");
  const swapWithIndex = direction === "up" ? index - 1 : index + 1;
  if (swapWithIndex < 0 || swapWithIndex >= remainingDetailIdsInOrder.length) {
    throw new AppError("Tujuan ini sudah berada di posisi paling ujung.");
  }
  const otherDetailId = remainingDetailIdsInOrder[swapWithIndex];

  const pool = await getPool();
  const ownershipCheck = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .input("otherId", sql.Int, otherDetailId)
    .input("salesmanId", sql.VarChar(16), salesmanId).query(`
      SELECT COUNT(*) AS Cnt
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwal j ON j.JadwalID = jd.JadwalID
      WHERE jd.JadwalDetailID IN (@id, @otherId) AND j.SalesmanID = @salesmanId AND j.IsDeleted = 0
    `);
  if ((ownershipCheck.recordset[0] as { Cnt: number }).Cnt !== 2) {
    throw new AppError("Anda tidak memiliki akses ke salah satu tujuan ini.");
  }

  // Read both current effective positions, then write each one the OTHER's
  // value — a real swap, not just "+1"/"-1", so it also works correctly
  // for a stop that never had an UrutanOverride yet (falls back to Urutan).
  const positions = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .input("otherId", sql.Int, otherDetailId).query(`
      SELECT JadwalDetailID, ISNULL(UrutanOverride, Urutan) AS EffectiveOrder
      FROM DashboardPengirimanJadwalDetail
      WHERE JadwalDetailID IN (@id, @otherId)
    `);
  const rows = positions.recordset as { JadwalDetailID: number; EffectiveOrder: number }[];
  const mine = rows.find((r) => r.JadwalDetailID === jadwalDetailId)!;
  const other = rows.find((r) => r.JadwalDetailID === otherDetailId)!;

  await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .input("otherId", sql.Int, otherDetailId)
    .input("mineOrder", sql.Int, other.EffectiveOrder)
    .input("otherOrder", sql.Int, mine.EffectiveOrder).query(`
      UPDATE DashboardPengirimanJadwalDetail SET UrutanOverride = @mineOrder WHERE JadwalDetailID = @id;
      UPDATE DashboardPengirimanJadwalDetail SET UrutanOverride = @otherOrder WHERE JadwalDetailID = @otherId;
    `);
}
```

- [ ] **Step 2: Extend `DriverStopRow` and `getDriverJadwalStops`**

Read `src/lib/queries/pengiriman-jadwal.ts:2211-2261` first (the exact current interface and function) — then apply:

```typescript
// DriverStopRow interface — add these 3 fields:
export interface DriverStopRow extends JadwalDetailRow {
  JamTiba: string | Date | null;
  JamSelesai: string | Date | null;
  BusinessPartnerID: string;
  // UrutanOverride is driver-app-only convenience ordering — see the
  // Global Constraints note in this plan: getDriverJadwalStops() itself
  // must keep sorting by plain Urutan; only stop-flow.tsx re-sorts by
  // UrutanOverride ?? Urutan client-side.
  UrutanOverride: number | null;
  IsTerkendala: boolean;
  TerkendalaAlasan: string | null;
}
```

Extend `getDriverJadwalStops`'s extra query and merge — the function's own `ORDER BY` (inherited from `getJadwalDetail`, unchanged) must NOT change:

```typescript
export async function getDriverJadwalStops(jadwalId: number): Promise<DriverStopRow[]> {
  const pool = await getPool();
  const [stops, extraRows] = await Promise.all([
    getJadwalDetail(jadwalId),
    pool
      .request()
      .input("jadwalId", sql.Int, jadwalId).query(`
        SELECT jd.JadwalDetailID, sd.JamTiba, sd.JamSelesai, so.BusinessPartnerID, jd.UrutanOverride,
               tk.Alasan AS TerkendalaAlasan
        FROM DashboardPengirimanJadwalDetail jd
        JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
        LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
        LEFT JOIN DashboardPengirimanTerkendala tk ON tk.JadwalDetailID = jd.JadwalDetailID AND tk.IsResolved = 0
        WHERE jd.JadwalID = @jadwalId AND jd.IsDeleted = 0
      `),
  ]);
  const extraByDetailId = new Map(
    (
      extraRows.recordset as {
        JadwalDetailID: number;
        JamTiba: Date | null;
        JamSelesai: Date | null;
        BusinessPartnerID: string;
        UrutanOverride: number | null;
        TerkendalaAlasan: string | null;
      }[]
    ).map((r) => [r.JadwalDetailID, r])
  );
  return stops.map((s) => {
    const extra = extraByDetailId.get(s.JadwalDetailID);
    return {
      ...s,
      JamTiba: extra?.JamTiba ?? null,
      JamSelesai: extra?.JamSelesai ?? null,
      BusinessPartnerID: extra?.BusinessPartnerID ?? "",
      UrutanOverride: extra?.UrutanOverride ?? null,
      IsTerkendala: extra?.TerkendalaAlasan != null,
      TerkendalaAlasan: extra?.TerkendalaAlasan ?? null,
    };
  });
}
```

Note: `reportTerkendala` (Step 1 above) is idempotent — an existing unresolved row gets updated in place rather than a second one being inserted — so a `JadwalDetailID` can never have more than one unresolved `DashboardPengirimanTerkendala` row, and this `LEFT JOIN` can never return more than one match per stop. No extra guard needed here.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) — expect errors ONLY where `DriverStopRow` is constructed/spread incompletely elsewhere in the codebase (there should be none, since every field has a default). Run `npx eslint src/lib/queries/driver-terkendala.ts src/lib/queries/pengiriman-jadwal.ts`.

- [ ] **Step 4: Manual smoke test**

Write a throwaway script: call `reportTerkendala` on a real `jadwalDetailId`, confirm `getDriverJadwalStops` now shows `IsTerkendala: true` and a non-null `UrutanOverride` for it, call `moveTerkendalaStop` in both directions and confirm the swap, then clean up (`DELETE FROM DashboardPengirimanTerkendala WHERE ...`, reset `UrutanOverride` to `NULL` for the touched rows). Delete the throwaway script.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/driver-terkendala.ts src/lib/queries/pengiriman-jadwal.ts
git commit -m "feat: add pengiriman terkendala query layer, extend DriverStopRow"
```

---

### Task 4: Driver-app server actions

**Files:**
- Modify: `src/app/mkesindo/driver-app/actions.ts`

**Interfaces:**
- Consumes: Task 2/3's query functions.
- Produces: `getActiveIstirahatAction()`, `startIstirahatAction(jadwalId, keterangan)`, `endIstirahatAction(istirahatId)`, `reportTerkendalaAction(jadwalDetailId, alasan)`, `moveTerkendalaStopAction(jadwalDetailId, direction, remainingDetailIdsInOrder)`.

- [ ] **Step 1: Read the existing action file's imports and `requireOwnSalesmanId`/`assertOwnsJadwal`/`assertOwnsJadwalDetail` helpers**

Run: `grep -n "^import\|assertOwnsJadwal\|requireOwnSalesmanId" src/app/mkesindo/driver-app/actions.ts` to confirm the exact existing import list before adding to it (this file already has many actions — add new imports alongside the existing `pengiriman-jadwal` import block, don't duplicate an import statement).

- [ ] **Step 2: Add the 5 new actions**

```typescript
import { getActiveIstirahat, startIstirahat, endIstirahat } from "@/lib/queries/driver-istirahat";
import { reportTerkendala, moveTerkendalaStop } from "@/lib/queries/driver-terkendala";
import { assertOwnsJadwal } from "@/lib/queries/pengiriman-jadwal"; // add to the existing pengiriman-jadwal import if not already imported

export async function getActiveIstirahatAction(): Promise<ActionResult<{ istirahatId: number; keterangan: string; waktuMulai: string } | null>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    return getActiveIstirahat(salesmanId);
  });
}

export async function startIstirahatAction(jadwalId: number, keterangan: string): Promise<ActionResult<number>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwal(jadwalId, salesmanId);
    const id = await startIstirahat(jadwalId, salesmanId, keterangan);
    revalidatePath("/mkesindo/driver-app");
    return id;
  });
}

export async function endIstirahatAction(istirahatId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await endIstirahat(istirahatId, salesmanId);
    revalidatePath("/mkesindo/driver-app");
  });
}

export async function reportTerkendalaAction(jadwalDetailId: number, alasan: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwalDetail(jadwalDetailId, salesmanId);
    await reportTerkendala(jadwalDetailId, salesmanId, alasan);
    revalidatePath("/mkesindo/driver-app");
  });
}

export async function moveTerkendalaStopAction(
  jadwalDetailId: number,
  direction: "up" | "down",
  remainingDetailIdsInOrder: number[]
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await moveTerkendalaStop(jadwalDetailId, salesmanId, direction, remainingDetailIdsInOrder);
    revalidatePath("/mkesindo/driver-app");
  });
}
```

`getActiveIstirahatAction` deliberately does NOT call `assertOwnsJadwal` (it isn't scoped to a jadwalId at all — it's used from the root layout, which doesn't necessarily know which Jadwal is active) — `requireOwnSalesmanId()` alone is the right gate here, matching `getActiveIstirahat`'s own `salesmanId`-only signature.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/app/mkesindo/driver-app/actions.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/app/mkesindo/driver-app/actions.ts
git commit -m "feat: add driver-app istirahat and terkendala server actions"
```

---

### Task 5: Driver-app root layout + istirahat lock overlay

**Files:**
- Create: `src/app/mkesindo/driver-app/layout.tsx`
- Create: `src/components/driver-app/istirahat-overlay.tsx`

**Interfaces:**
- Consumes: `getActiveIstirahat` (Task 2, called directly — this is a Server Component, no need to go through the action wrapper), `endIstirahatAction` (Task 4).

- [ ] **Step 1: Write the layout**

`(tabs)/layout.tsx` and `jadwal/[jadwalId]/page.tsx` currently have no shared parent — this new file becomes that parent, so the lock applies regardless of which driver-app screen is open.

```typescript
import { requireDriver } from "@/lib/require-access";
import { getActiveIstirahat } from "@/lib/queries/driver-istirahat";
import { IstirahatOverlay } from "@/components/driver-app/istirahat-overlay";

export default async function DriverAppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireDriver();
  const activeIstirahat = session.user.salesmanId ? await getActiveIstirahat(session.user.salesmanId) : null;

  return (
    <>
      {children}
      <IstirahatOverlay initialIstirahat={activeIstirahat} />
    </>
  );
}
```

- [ ] **Step 2: Write `IstirahatOverlay`**

```typescript
"use client";

import { useEffect, useState } from "react";
import { Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { endIstirahatAction } from "@/app/mkesindo/driver-app/actions";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function IstirahatOverlay({
  initialIstirahat,
}: {
  initialIstirahat: { istirahatId: number; keterangan: string; waktuMulai: string } | null;
}) {
  const [istirahat, setIstirahat] = useState(initialIstirahat);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    setIstirahat(initialIstirahat);
  }, [initialIstirahat]);

  useEffect(() => {
    if (!istirahat) return;
    function tick() {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(istirahat!.waktuMulai).getTime()) / 1000)));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [istirahat]);

  if (!istirahat) return null;

  async function handleSelesai() {
    setEnding(true);
    const result = await endIstirahatAction(istirahat!.istirahatId);
    setEnding(false);
    if (result.success) setIstirahat(null);
    // On failure, the overlay simply stays up with its existing error
    // surface omitted for v1 — the driver can retry the same button.
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background/98 p-6 text-center backdrop-blur-sm">
      <Coffee className="size-12 text-primary" />
      <div>
        <p className="text-lg font-semibold">Sedang Istirahat</p>
        <p className="text-sm text-muted-foreground">{istirahat.keterangan}</p>
      </div>
      <p className="font-data text-4xl font-semibold tabular-nums">{formatElapsed(elapsedSeconds)}</p>
      <Button size="lg" disabled={ending} onClick={handleSelesai}>
        {ending ? "Menyimpan..." : "Selesai Istirahat"}
      </Button>
    </div>
  );
}
```

`z-[100]` is deliberately above every other z-index in this app's driver-app surfaces (dialogs sit at `z-50`, `PengirimanStep`'s own floating chrome at `z-10`) — matches the "hard lock, nothing underneath is reachable" decision from brainstorming.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/app/mkesindo/driver-app/layout.tsx src/components/driver-app/istirahat-overlay.tsx`.

- [ ] **Step 4: Live verification**

If a dev server + authenticated driver session is available: manually insert an open istirahat row for that driver via a throwaway script (`INSERT INTO DashboardPengirimanIstirahat (JadwalID, SalesmanID, Keterangan) VALUES (...)` using a real JadwalID/SalesmanID), reload `/mkesindo/driver-app`, confirm the overlay appears with a running timer, click "Selesai Istirahat", confirm it disappears and the row's `WaktuSelesai` is now set. If no session is available, static analysis is fine — say so clearly.

- [ ] **Step 5: Commit**

```bash
git add src/app/mkesindo/driver-app/layout.tsx src/components/driver-app/istirahat-overlay.tsx
git commit -m "feat: add driver-app root layout with server-truth istirahat lock overlay"
```

---

### Task 6: Istirahat button + dialog in `PengirimanStep`

**Files:**
- Create: `src/lib/istirahat-options.ts`
- Create: `src/components/driver-app/steps/istirahat-dialog.tsx`
- Modify: `src/components/driver-app/steps/pengiriman-step.tsx`

**Interfaces:**
- Consumes: `startIstirahatAction` (Task 4).

- [ ] **Step 1: Write `istirahat-options.ts`**

Mirrors `src/lib/kendala-options.ts` exactly (client-safe constant, no server-only imports).

```typescript
export const KETERANGAN_ISTIRAHAT_OPTIONS = ["Makan", "Toilet", "Sholat", "Lainnya"] as const;
export type KeteranganIstirahat = (typeof KETERANGAN_ISTIRAHAT_OPTIONS)[number];
```

- [ ] **Step 2: Write `IstirahatDialog`**

Mirrors `src/components/driver-app/steps/kendala-dialog.tsx`'s structure (same `UNSET` sentinel pattern for the `Select`, same dialog shape) — but with a free-text field that appears when "Lainnya" is picked, since the brief calls for that (unlike `KendalaDialog`, which has no free-text option today).

```typescript
"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { startIstirahatAction } from "@/app/mkesindo/driver-app/actions";
import { KETERANGAN_ISTIRAHAT_OPTIONS } from "@/lib/istirahat-options";

const UNSET = "__unset__";

export function IstirahatDialog({
  open,
  onOpenChange,
  jadwalId,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jadwalId: number;
  onStarted: (istirahat: { istirahatId: number; keterangan: string; waktuMulai: string }) => void;
}) {
  const [keterangan, setKeterangan] = useState<string>(UNSET);
  const [lainnyaText, setLainnyaText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    if (keterangan === UNSET) {
      setError("Pilih keterangan istirahat terlebih dahulu.");
      return;
    }
    const finalKeterangan = keterangan === "Lainnya" ? lainnyaText.trim() : keterangan;
    if (!finalKeterangan) {
      setError("Isi keterangan istirahat.");
      return;
    }
    startTransition(async () => {
      const result = await startIstirahatAction(jadwalId, finalKeterangan);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setKeterangan(UNSET);
      setLainnyaText("");
      onOpenChange(false);
      onStarted({ istirahatId: result.data, keterangan: finalKeterangan, waktuMulai: new Date().toISOString() });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mulai Istirahat</DialogTitle>
          <DialogDescription>Aplikasi akan terkunci sampai Anda menekan "Selesai Istirahat".</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label className="sr-only">Keterangan</Label>
          <Select value={keterangan} onValueChange={(v) => setKeterangan(v ?? UNSET)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pilih keterangan" />
            </SelectTrigger>
            <SelectContent>
              {KETERANGAN_ISTIRAHAT_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {keterangan === "Lainnya" && (
          <Input
            placeholder="Sebutkan keterangan..."
            value={lainnyaText}
            onChange={(e) => setLainnyaText(e.target.value)}
          />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button className="w-full" disabled={pending} onClick={handleSubmit}>
            {pending ? "Memulai..." : "Mulai Istirahat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire the button into `PengirimanStep`**

In `src/components/driver-app/steps/pengiriman-step.tsx`: add `import { Coffee } from "lucide-react"` to the existing lucide import, add `import { IstirahatDialog } from "./istirahat-dialog"`, add `const [istirahatOpen, setIstirahatOpen] = useState(false)` alongside the existing `kendalaOpen`/`bbmOpen` state, add a third icon button in the top-right cluster (same `flex size-10 items-center justify-center rounded-full` shape as the existing Fuel/Siren buttons):

```tsx
<button
  type="button"
  onClick={() => setIstirahatOpen(true)}
  className="flex size-10 items-center justify-center rounded-full bg-card shadow-md"
  title="Istirahat"
>
  <Coffee className="size-4.5" />
</button>
```

and render `<IstirahatDialog open={istirahatOpen} onOpenChange={setIstirahatOpen} jadwalId={jadwalId} onStarted={() => window.location.reload()} />` alongside the existing `<BbmDialog>`/`<KendalaDialog>` at the bottom of the component.

`onStarted` triggers a full reload rather than local state, deliberately: the actual lock overlay lives in the root layout (Task 5), one level up from this component — a hard reload is the simplest way to make the layout's server-side `getActiveIstirahat` check re-run immediately and show the overlay, without threading istirahat state down through props that this component doesn't otherwise need.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint` on all 3 files.

- [ ] **Step 5: Commit**

```bash
git add src/lib/istirahat-options.ts src/components/driver-app/steps/istirahat-dialog.tsx src/components/driver-app/steps/pengiriman-step.tsx
git commit -m "feat: add Istirahat button and dialog to driver-app PengirimanStep"
```

---

### Task 7: Arrival gating (100m)

**Files:**
- Modify: `src/components/driver-app/steps/pengiriman-step.tsx`

**Interfaces:**
- Consumes: `haversineKm` (`src/lib/route-estimate.ts`, already exists, no server-only imports).

- [ ] **Step 1: Compute the gate**

In `pengiriman-step.tsx`, add `import { haversineKm } from "@/lib/route-estimate";`. After the existing `position` state and before the `handleArrived` function, add:

```typescript
const ARRIVAL_RADIUS_KM = 0.1; // 100 meters

const distanceToActiveStopKm =
  position != null && activeStop.Latitude != null && activeStop.Longitude != null
    ? haversineKm(position, { lat: activeStop.Latitude, lng: activeStop.Longitude })
    : null;
const canShowArrivalSwipe = distanceToActiveStopKm != null && distanceToActiveStopKm <= ARRIVAL_RADIUS_KM;
```

- [ ] **Step 2: Replace the swipe control's rendering**

Find the existing block:

```tsx
<div className="flex items-center gap-2 px-4">
  <SwipeToConfirm label="Geser untuk Tiba" pending={pending} onConfirm={handleArrived} className="flex-1" />
  {activeStop.MobileNo && (
    <button ...>
      <Phone className="size-5" />
    </button>
  )}
</div>
```

Replace the `SwipeToConfirm` with a conditional:

```tsx
<div className="flex items-center gap-2 px-4">
  {canShowArrivalSwipe ? (
    <SwipeToConfirm label="Geser untuk Tiba" pending={pending} onConfirm={handleArrived} className="flex-1" />
  ) : (
    <p className="flex-1 rounded-full border border-dashed border-border px-4 py-3 text-center text-xs text-muted-foreground">
      {position == null
        ? "Lokasi tidak terdeteksi — aktifkan GPS"
        : `±${Math.round((distanceToActiveStopKm ?? 0) * 1000)}m menuju tujuan`}
    </p>
  )}
  {activeStop.MobileNo && (
    <button ...>
      <Phone className="size-5" />
    </button>
  )}
</div>
```

(Keep the existing `activeStop.MobileNo && (...)` phone button block exactly as-is — it must stay visible in every case, per the design's "the phone button is the only always-available action" constraint.)

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/components/driver-app/steps/pengiriman-step.tsx`.

- [ ] **Step 4: Live verification**

If a dev server + authenticated driver session with an active Jadwal is available: confirm the swipe control is hidden and the distance/GPS message shows when far from a stop, and confirm it appears once actually within 100m (or simulate via browser devtools geolocation override if the real device can't get close). If not possible, static analysis is fine.

- [ ] **Step 5: Commit**

```bash
git add src/components/driver-app/steps/pengiriman-step.tsx
git commit -m "feat: gate Geser untuk Tiba behind a 100m arrival radius"
```

---

### Task 8: Pengiriman Terkendala — dialog, call-attempt tracking, badge, reorder

**Files:**
- Create: `src/lib/terkendala-options.ts`
- Create: `src/components/driver-app/steps/terkendala-dialog.tsx`
- Modify: `src/components/driver-app/steps/pengiriman-step.tsx`
- Modify: `src/components/driver-app/stop-flow.tsx`

**Interfaces:**
- Consumes: `reportTerkendalaAction`, `moveTerkendalaStopAction` (Task 4), `DriverStopRow.IsTerkendala`/`TerkendalaAlasan`/`UrutanOverride` (Task 3).

- [ ] **Step 1: Write `terkendala-options.ts`**

```typescript
export const ALASAN_TERKENDALA_OPTIONS = ["Alamat tidak ditemukan", "Lokasi tutup", "Penerima tidak merespon", "Lainnya"] as const;
export type AlasanTerkendala = (typeof ALASAN_TERKENDALA_OPTIONS)[number];
```

- [ ] **Step 2: Write `TerkendalaDialog`**

Same shape as `IstirahatDialog` (Task 6) — dropdown + conditional free-text for "Lainnya" — but calling `reportTerkendalaAction(jadwalDetailId, alasan)` and with copy about the delivery being marked and reordered.

```typescript
"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { reportTerkendalaAction } from "@/app/mkesindo/driver-app/actions";
import { ALASAN_TERKENDALA_OPTIONS } from "@/lib/terkendala-options";

const UNSET = "__unset__";

export function TerkendalaDialog({
  open,
  onOpenChange,
  jadwalDetailId,
  onReported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jadwalDetailId: number;
  onReported: () => void;
}) {
  const [alasan, setAlasan] = useState<string>(UNSET);
  const [lainnyaText, setLainnyaText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    if (alasan === UNSET) {
      setError("Pilih alasan terlebih dahulu.");
      return;
    }
    const finalAlasan = alasan === "Lainnya" ? lainnyaText.trim() : alasan;
    if (!finalAlasan) {
      setError("Isi alasan.");
      return;
    }
    startTransition(async () => {
      const result = await reportTerkendalaAction(jadwalDetailId, finalAlasan);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setAlasan(UNSET);
      setLainnyaText("");
      onOpenChange(false);
      onReported();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pengiriman Terkendala</DialogTitle>
          <DialogDescription>Tujuan ini akan tetap ada di daftar, dipindah ke urutan terakhir.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label className="sr-only">Alasan</Label>
          <Select value={alasan} onValueChange={(v) => setAlasan(v ?? UNSET)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pilih alasan" />
            </SelectTrigger>
            <SelectContent>
              {ALASAN_TERKENDALA_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {alasan === "Lainnya" && (
          <Input placeholder="Sebutkan alasan..." value={lainnyaText} onChange={(e) => setLainnyaText(e.target.value)} />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button className="w-full" variant="destructive" disabled={pending} onClick={handleSubmit}>
            {pending ? "Melaporkan..." : "Laporkan Pengiriman Terkendala"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: `stop-flow.tsx` — the `UrutanOverride ?? Urutan` re-sort**

Read `src/components/driver-app/stop-flow.tsx:59-62` first (the current `remainingStops`/`activeStop` derivation) — then change:

```typescript
const remainingStops = stops
  .filter((s) => s.JamSelesai == null)
  .sort((a, b) => (a.UrutanOverride ?? a.Urutan) - (b.UrutanOverride ?? b.Urutan));
const activeStop = remainingStops[0] ?? null;
```

This is the ONLY place in the whole codebase that applies the override — see Global Constraints.

- [ ] **Step 4: `pengiriman-step.tsx` — call-attempt tracking + the "Laporkan" link + badge + reorder buttons**

Add state: `const [hasAttemptedCall, setHasAttemptedCall] = useState(false);` and `const [terkendalaOpen, setTerkendalaOpen] = useState(false);`. Reset `hasAttemptedCall` to `false` whenever `activeStop.JadwalDetailID` changes (add a `useEffect(() => setHasAttemptedCall(false), [activeStop.JadwalDetailID])`).

When the phone button opens `CallChoiceDialog` (`setCallOpen(true)`), also set `setHasAttemptedCall(true)` in the same `onClick`.

Below the existing phone button, conditionally render (only when `hasAttemptedCall && !activeStop.IsTerkendala`):

```tsx
{hasAttemptedCall && !activeStop.IsTerkendala && (
  <button
    type="button"
    onClick={() => setTerkendalaOpen(true)}
    className="px-4 pb-2 text-center text-xs text-destructive underline"
  >
    Tidak bisa dihubungi? Laporkan Pengiriman Terkendala
  </button>
)}
```

Render `<TerkendalaDialog open={terkendalaOpen} onOpenChange={setTerkendalaOpen} jadwalDetailId={activeStop.JadwalDetailID} onReported={() => router.refresh()} />` alongside the other dialogs — `router.refresh()` re-fetches the Server Component tree so `stops`/`remainingStops` picks up the new `IsTerkendala`/`UrutanOverride` from the server.

**Badge + reorder** in the destination list (`remainingStops.map(...)` block): for a stop where `s.IsTerkendala` is true, add a small badge next to its name (reuse the existing `kendalaReported`-style destructive text treatment) and two small ▲▼ buttons calling a new handler:

```typescript
function handleMoveTerkendala(jadwalDetailId: number, direction: "up" | "down") {
  const remainingDetailIdsInOrder = remainingStops.map((s) => s.JadwalDetailID);
  startTransition(async () => {
    const result = await moveTerkendalaStopAction(jadwalDetailId, direction, remainingDetailIdsInOrder);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  });
}
```

In the list item JSX, next to the existing distance text:

```tsx
{s.IsTerkendala && (
  <div className="flex shrink-0 flex-col items-center gap-0.5">
    <button type="button" onClick={() => handleMoveTerkendala(s.JadwalDetailID, "up")} className="text-muted-foreground" title="Pindah ke atas">
      ▲
    </button>
    <button type="button" onClick={() => handleMoveTerkendala(s.JadwalDetailID, "down")} className="text-muted-foreground" title="Pindah ke bawah">
      ▼
    </button>
  </div>
)}
```

and a "Terkendala" text badge near `s.CustomerName`, matching the existing `kendalaReported` destructive-text convention already used elsewhere in this same file.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint` on all 4 touched/created files.

- [ ] **Step 6: Live verification**

If a dev server + authenticated driver session with an active Jadwal is available: tap the phone button once, confirm the "Laporkan Pengiriman Terkendala" link appears, report one, confirm the stop moves to last with a badge and ▲▼ controls, use them to move it, confirm the order changes and persists across a reload. If not possible, static analysis is fine.

- [ ] **Step 7: Commit**

```bash
git add src/lib/terkendala-options.ts src/components/driver-app/steps/terkendala-dialog.tsx src/components/driver-app/steps/pengiriman-step.tsx src/components/driver-app/stop-flow.tsx
git commit -m "feat: add Pengiriman Terkendala reporting and per-stop reordering"
```

---

### Task 9: Driver-app destination list — travel-time estimate

**Files:**
- Modify: `src/components/driver-app/steps/pengiriman-step.tsx`

**Interfaces:**
- Consumes: `effectiveRoute.legs[i].durationMinutes` (already computed by the existing OSRM call in this file).

- [ ] **Step 1: Add the cumulative duration map**

Right after the existing `distanceByDetailId` `useMemo` (built from `effectiveRoute.legs[i]?.distanceKm`), add a parallel one:

```typescript
const durationByDetailId = useMemo(() => {
  const map = new Map<number, number>();
  if (!effectiveRoute) return map;
  let cumulative = 0;
  validStops.forEach((s, i) => {
    cumulative += effectiveRoute.legs[i]?.durationMinutes ?? 0;
    map.set(s.JadwalDetailID, cumulative);
  });
  return map;
}, [effectiveRoute, validStops]);
```

- [ ] **Step 2: Render it under the km text**

Find the existing per-stop list item:

```tsx
<span className="shrink-0 text-xs text-muted-foreground">{distanceKm != null ? `${distanceKm.toFixed(1)} km` : "-"}</span>
```

Replace with a small stacked block:

```tsx
<span className="shrink-0 text-right text-xs text-muted-foreground">
  <span className="block">{distanceKm != null ? `${distanceKm.toFixed(1)} km` : "-"}</span>
  {(() => {
    const durationMin = durationByDetailId.get(s.JadwalDetailID);
    return durationMin != null ? <span className="block">~{Math.round(durationMin)} menit</span> : null;
  })()}
</span>
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/components/driver-app/steps/pengiriman-step.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/driver-app/steps/pengiriman-step.tsx
git commit -m "feat: show per-stop travel-time estimate in driver-app destination list"
```

---

### Task 10: Desktop Validasi Rute — arrival time + Terkendala badge per stop

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`

**Interfaces:**
- Consumes: `DriverStopRow.JamTiba`/`IsTerkendala`/`TerkendalaAlasan` (Task 3) — already flowing into `order` via the existing `getJadwalDetailAction` call, no new query needed.

- [ ] **Step 1: Add the display to `SortableStopRow`**

Read `src/components/dashboard/route-validation-dialog.tsx:82-194` first (the current exact `SortableStopRow`, already showing `detail.CustomerName`/`Wilayah`/`Kecamatan`). Inside the existing name/location `<button>` block, right after the `Wilayah`/`Kecamatan` `<p>`, add:

```tsx
{detail.JamTiba != null && (
  <p className="text-xs text-muted-foreground">Tiba {formatTime(detail.JamTiba)}</p>
)}
```

(`formatTime` is already imported in this file.)

For the Terkendala badge, next to the existing `{detail.Latitude == null && (<Badge ...>Tanpa lokasi</Badge>)}` block, add:

```tsx
{detail.IsTerkendala && (
  <Badge
    variant="outline"
    className="shrink-0 border-destructive/30 text-[10px] text-destructive"
    title={detail.TerkendalaAlasan ?? undefined}
  >
    Terkendala
  </Badge>
)}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint src/components/dashboard/route-validation-dialog.tsx`.

- [ ] **Step 3: Live verification**

If a dev server + authenticated session with grup/pengiriman access is available: open Validasi Rute on a Jadwal with at least one completed stop, confirm "Tiba HH:MM" shows under that stop's name. If a Terkendala report exists on a real test Jadwal (from Task 8's live verification), confirm the badge shows there too. If not possible, static analysis is fine.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx
git commit -m "feat: show per-stop arrival time and Terkendala badge in Validasi Rute"
```

---

### Task 11: Desktop Validasi Rute — istirahat time summary

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`
- Modify: `src/app/mkesindo/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: `getIstirahatForJadwal` (Task 2).
- Produces: `getIstirahatForJadwalAction(jadwalId)`.

- [ ] **Step 1: Add the action**

In `src/app/mkesindo/(dashboard)/delivery/actions.ts`, alongside the other read-only actions (`getJadwalDetailAction`, `getDriverPositionAction`):

```typescript
import { getIstirahatForJadwal, type IstirahatSession } from "@/lib/queries/driver-istirahat";

export async function getIstirahatForJadwalAction(jadwalId: number): Promise<IstirahatSession[]> {
  return getIstirahatForJadwal(jadwalId);
}
```

- [ ] **Step 2: Fetch it in `RouteValidationDialog`**

Read `src/components/dashboard/route-validation-dialog.tsx:353-381` first (the existing `useEffect` that fetches `order`/`vehicleChecks` on `jadwalId` change) — add a parallel fetch in the same effect:

```typescript
const [istirahatSessions, setIstirahatSessions] = useState<IstirahatSession[]>([]);
// ...inside the existing useEffect keyed on [jadwalId], alongside the
// existing getVehicleChecksForJadwalAction call:
if (jadwalId == null) {
  setIstirahatSessions([]);
} else {
  getIstirahatForJadwalAction(jadwalId).then(setIstirahatSessions);
}
```

`route-validation-dialog.tsx` already has one `import { ... } from "@/app/mkesindo/(dashboard)/delivery/actions"` statement (for `getJadwalDetailAction`, `getDriverPositionAction`, etc.) — add `getIstirahatForJadwalAction` to that existing import list rather than writing a second import line. Separately import `type IstirahatSession` from `@/lib/queries/driver-istirahat`.

- [ ] **Step 3: Compute the three figures**

Add a `useMemo` near the existing `statusHistory` one:

```typescript
const totalIstirahatMenit = useMemo(
  () => istirahatSessions.reduce((sum, s) => sum + s.durasiMenit, 0),
  [istirahatSessions]
);
const totalBerjalanMenit = useMemo(() => {
  if (!jadwal?.JamAktualBerangkat) return null;
  const endMs = jamKembaliAktual ? new Date(jamKembaliAktual).getTime() : Date.now();
  return Math.round((endMs - new Date(jadwal.JamAktualBerangkat).getTime()) / 60000);
}, [jadwal, jamKembaliAktual]);
const waktuEfektifMenit = totalBerjalanMenit != null ? totalBerjalanMenit - totalIstirahatMenit : null;
```

(`jamKembaliAktual` is the existing `vehicleChecks.find((c) => c.tipe === "DATANG")?.checkedAt ?? null` already computed in this file for `statusHistory`.)

- [ ] **Step 4: Render inside the Riwayat Status popover**

Read `src/components/dashboard/route-validation-dialog.tsx:1163-1180` first (the exact current `PopoverContent`/`VerticalTimeline` block) — add, right after the closing `</VerticalTimeline>` and still inside `<PopoverContent>`:

```tsx
{(totalBerjalanMenit != null || istirahatSessions.length > 0) && (
  <div className="mt-3 flex flex-col gap-1 border-t pt-3 text-xs">
    {totalBerjalanMenit != null && (
      <div className="flex justify-between">
        <span className="text-muted-foreground">Total Berjalan</span>
        <span className="font-medium">{formatDurationMinutes(totalBerjalanMenit)}</span>
      </div>
    )}
    {istirahatSessions.length > 0 && (
      <div className="flex justify-between">
        <span className="text-muted-foreground">Total Istirahat ({istirahatSessions.length}x)</span>
        <span className="font-medium">{formatDurationMinutes(totalIstirahatMenit)}</span>
      </div>
    )}
    {waktuEfektifMenit != null && (
      <div className="flex justify-between font-semibold">
        <span>Waktu Efektif Pengiriman</span>
        <span>{formatDurationMinutes(waktuEfektifMenit)}</span>
      </div>
    )}
    {istirahatSessions.map((s, i) => (
      <p key={i} className="text-[11px] text-muted-foreground">
        {s.keterangan} — {formatDurationMinutes(s.durasiMenit)} ({formatTime(s.waktuMulai)}
        {s.waktuSelesai ? ` – ${formatTime(s.waktuSelesai)}` : " – berlangsung"})
      </p>
    ))}
  </div>
)}
```

(`formatDurationMinutes` is the existing local function already defined at the top of this file.)

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit` (filter `.next/`) and `npx eslint` on both touched files.

- [ ] **Step 6: Live verification**

If a dev server + authenticated session is available: open Validasi Rute on a Terbit Jadwal, open the Riwayat Status popover, confirm the three figures render (or are correctly absent if no istirahat/Berangkat data exists yet). Cross-check against a real istirahat session created during Task 5/6's live verification if one is still present. If not possible, static analysis is fine.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx "src/app/mkesindo/(dashboard)/delivery/actions.ts"
git commit -m "feat: show istirahat/berjalan/efektif time summary in Validasi Rute"
```
