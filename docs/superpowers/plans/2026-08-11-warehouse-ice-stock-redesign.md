# Redesain Peta Warehouse (Ice Stock Cold Storage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the produksi module's 12-slot warehouse floor plan with the real 42-slot Ice Stock Cold Storage denah (Selatan/Tengah/Utara zones), add a `JamPanen` (harvest time) field used for cold-storage age tracking, and replace the mobile app's standalone "Produksi Baru" tab with a click-empty-slot-to-add-production flow directly on the warehouse map.

**Architecture:** A shared layout constant (`warehouse-layout.ts`) and shared cell renderer (`warehouse-cell.tsx`) become the single source of truth for the 42-slot denah, consumed by two thin platform-specific components: `PetaWarehouseDesktop` (all 3 zones side-by-side, read-only, unchanged interaction) and a rewritten mobile `WarehouseView` (swipeable per-zone carousel, click-empty-slot opens a new `TambahProduksiDialog`). The old 12 pallet positions are never deleted (only new rows are added) so historical `Riwayat Produksi` records keep resolving correctly; `getWarehouseMap()` filters to only the new 42 rows going forward.

**Tech Stack:** Next.js 16 (App Router, Server Components, Server Actions), MSSQL (`mssql` package) via `getPool()`/`sql`, shadcn/ui components (`Dialog`, `Select`, `Input`, `Button`), Tailwind CSS.

## Global Constraints

- All Indonesian-language user-facing strings — no English UI text.
- No test runner exists in this project. Every task's verification is `npx tsc --noEmit` (zero errors touching changed files) + `npx eslint <changed files>`, plus a live check where noted.
- Everything happens directly on the `main` branch. No worktree.
- **Task 1's DDL is controller-run**: executed directly via the `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_ddl` tool by whoever is executing this plan — never delegated to an implementer subagent. No `FOREIGN KEY`/`REFERENCES` clauses and no `CREATE INDEX`, matching every existing custom `Dashboard*` table in this codebase.
- **The old 12 `DashboardProduksiPalletPosisi` rows (`Kode` `1A`-`3D`) are NEVER deleted.** Only the new 42 rows are inserted alongside them. This is a deliberate deviation from a literal "delete and replace" reading of "reset bersih": deleting the old rows would silently break `getRiwayatProduksi()`'s `JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID` for every historical batch ever recorded against the old denah, making real production history vanish from the Riwayat table. Keeping the old rows costs nothing (they're simply never surfaced by the new, filtered `getWarehouseMap()`) and fully satisfies what was actually asked: a clean, empty 42-slot map going forward, with no active-pallet migration needed.
- Jam field convention: this codebase already has a precedent for clock-time fields (`DriverProfile.JamMulaiKerja`/`JamSelesaiKerja`, see `src/lib/queries/driver-profile.ts`) — stored as `VARCHAR(5)` (`"HH:mm"`), typed as `string | null` in TypeScript, edited via `<Input type="time">`. `JamPanen` follows this exact convention — **not** a SQL `TIME` column.
- Money/quantity/date values from MSSQL arrive as plain JS `number`/`Date` via the `mssql` driver — no extra parsing layer.
- No `react-hook-form`/`zod` anywhere in this codebase — every form uses controlled `<input>`/shadcn `<Select>`/`<Input>` + `useState` + `useTransition` + `ActionResult<T>`. `TambahProduksiDialog` (Task 7) follows this exact convention.
- The confirmed denah (7 groups, exact codes, divider labels) lives in `docs/superpowers/specs/2026-08-11-warehouse-ice-stock-redesign-design.md` — Task 3 transcribes it verbatim, do not re-derive or "improve" the code ordering.

---

## Task 1: DDL — 42 pallet positions + `JamPanen` column (controller-run)

**Files:**
- None (direct DDL execution, no repo files).

**Interfaces:**
- Produces: 42 new `DashboardProduksiPalletPosisi` rows (`Kode` `S1A`..`U3D`, see exact list in Step 1), `DashboardProduksiBatch.JamPanen VARCHAR(5) NULL` — consumed by Task 2.

- [ ] **Step 1: Run the DDL**

Execute via the `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_ddl` tool (controller-run, not delegated):

```sql
INSERT INTO DashboardProduksiPalletPosisi (Kode) VALUES
('S1F'), ('S1C'), ('S1E'), ('S1B'), ('S1D'), ('S1A'),
('S2D'), ('S2A'), ('S2E'), ('S2B'), ('S2F'), ('S2C'),
('T1I'), ('T1F'), ('T1C'), ('T1H'), ('T1E'), ('T1B'), ('T1G'), ('T1D'), ('T1A'),
('T2G'), ('T2D'), ('T2A'), ('T2H'), ('T2E'), ('T2B'), ('T2I'), ('T2F'), ('T2C'),
('U1D'), ('U1B'), ('U1C'), ('U1A'),
('U2C'), ('U2A'), ('U2D'), ('U2B'),
('U3C'), ('U3A'), ('U3D'), ('U3B');

ALTER TABLE DashboardProduksiBatch ADD JamPanen VARCHAR(5) NULL;
```

Expected: both statements succeed with no error. `Kode` is already `VARCHAR(4)` (see `DashboardProduksiPalletPosisi`'s original DDL) — every new code is 3 characters, no column width change needed. `JamPanen` is nullable at the DB level (existing rows and any batch created without it stay `NULL`); the form makes it required (Task 7), not the schema.

- [ ] **Step 2: Verify**

Execute via `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_dql`:

```sql
SELECT COUNT(*) AS TotalBaru FROM DashboardProduksiPalletPosisi WHERE Kode LIKE '[SUT]%';
SELECT TOP 1 JamPanen FROM DashboardProduksiBatch;
```

Expected: `TotalBaru` = 42, second query returns with no error (column exists).

- [ ] **Step 3: Record in the SDD ledger**

No git commit for this task (no files changed) — record completion in the progress ledger only, noting the DDL ran successfully and was verified, and that the old 12 rows were deliberately left untouched (see Global Constraints).

---

## Task 2: Query layer — `JamPanen` + filtered `getWarehouseMap()`

**Files:**
- Modify: `src/lib/queries/produksi-warehouse.ts` (entire file)

**Interfaces:**
- Consumes: `DashboardProduksiPalletPosisi` (42 new rows), `DashboardProduksiBatch.JamPanen` from Task 1.
- Produces: `PalletPosisiRow.JamPanen: string | null`, `RiwayatProduksiRow.JamPanen: string`, `CreateBatchInput.jamPanen: string` — consumed by Task 3 (age calc), Task 5 (Riwayat display), Task 6 (action validation), Task 7 (dialog).

- [ ] **Step 1: Replace the whole file**

Replace `src\lib\queries\produksi-warehouse.ts` in full:

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface PalletPosisiRow {
  PosisiID: number;
  Kode: string;
  BatchIDAktif: number | null;
  MesinNama: string | null;
  TanggalProduksi: Date | null;
  SisaQty10KG: number | null;
  SisaQty5KG: number | null;
  TanggalLabel: Date | null;
  Shift: 1 | 2 | 3 | null;
  JamPanen: string | null;
}

// Filtered to Kode LIKE '[SUT]%' -- only the new 42-slot Ice Stock denah
// (codes S1A..U3D). The old 12 rows (Kode '1A'..'3D') are deliberately left
// in the table (never deleted, see plan's Global Constraints) so historical
// DashboardProduksiBatch rows recorded against them still resolve through
// getRiwayatProduksi()'s JOIN -- they're just never returned by this
// function, so the UI never shows them as available slots.
export async function getWarehouseMap(): Promise<PalletPosisiRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.PosisiID, p.Kode, p.BatchIDAktif, m.Nama AS MesinNama, b.TanggalProduksi, b.SisaQty10KG, b.SisaQty5KG,
           b.TanggalLabel, b.Shift, b.JamPanen
    FROM DashboardProduksiPalletPosisi p
    LEFT JOIN DashboardProduksiBatch b ON b.BatchID = p.BatchIDAktif AND b.IsDeleted = 0
    LEFT JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
    WHERE p.Kode LIKE '[SUT]%'
    ORDER BY p.Kode
  `);
  return result.recordset;
}

export interface RiwayatProduksiRow {
  BatchID: number;
  Kode: string;
  MesinNama: string;
  TanggalProduksi: Date;
  Qty10KG: number;
  Qty5KG: number;
  SisaQty10KG: number;
  SisaQty5KG: number;
  DicatatOlehAkunID: number;
  TanggalLabel: Date;
  Shift: 1 | 2 | 3;
  JamPanen: string;
}

export async function getRiwayatProduksi(limit = 50): Promise<RiwayatProduksiRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) b.BatchID, p.Kode, m.Nama AS MesinNama, b.TanggalProduksi,
             b.Qty10KG, b.Qty5KG, b.SisaQty10KG, b.SisaQty5KG, b.DicatatOlehAkunID,
             b.TanggalLabel, b.Shift, b.JamPanen
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0
      ORDER BY b.TanggalProduksi DESC
    `);
  return result.recordset;
}

export interface CreateBatchInput {
  mesinId: number;
  posisiId: number;
  qty10KG: number;
  qty5KG: number;
  tanggalLabel: string;
  shift: 1 | 2 | 3;
  jamPanen: string;
  dicatatOlehAkunId: number;
}

// A pallet position holds exactly one batch until it's fully consumed
// (BatchIDAktif is cleared only when both Sisa columns hit 0 — see
// produksi-muatan.ts's produksiMulaiMuat) — this function enforces that
// "one pallet = one batch at a time" rule at creation time.
export async function createBatch(input: CreateBatchInput): Promise<number> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Insert speculatively — this is safe because it's inside the same
    // transaction as the atomic claim below: if the claim fails, the
    // rollback discards this row too, so no orphan batch is ever visible
    // outside this function.
    const insertResult = await new sql.Request(transaction)
      .input("mesinId", sql.Int, input.mesinId)
      .input("posisiId", sql.Int, input.posisiId)
      .input("qty10", sql.Int, input.qty10KG)
      .input("qty5", sql.Int, input.qty5KG)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .input("tanggalLabel", sql.Date, input.tanggalLabel)
      .input("shift", sql.TinyInt, input.shift)
      .input("jamPanen", sql.VarChar(5), input.jamPanen)
      .query(`
        INSERT INTO DashboardProduksiBatch (MesinID, PosisiID, TanggalProduksi, Qty10KG, Qty5KG, SisaQty10KG, SisaQty5KG, DicatatOlehAkunID, TanggalLabel, Shift, JamPanen)
        OUTPUT INSERTED.BatchID
        VALUES (@mesinId, @posisiId, GETDATE(), @qty10, @qty5, @qty10, @qty5, @akunId, @tanggalLabel, @shift, @jamPanen)
      `);
    const batchId = insertResult.recordset[0].BatchID as number;

    // Atomic claim: the WHERE clause encodes both preconditions (position
    // exists, position is currently empty) as part of the write itself,
    // instead of a separate SELECT-then-act that a racing call could slip
    // between. rowsAffected[0] === 0 means either the position doesn't
    // exist or another transaction already claimed it first — same
    // idiom as selesaiMuat's claim UPDATE in pengiriman-jadwal.ts.
    const claim = await new sql.Request(transaction)
      .input("posisiId", sql.Int, input.posisiId)
      .input("batchId", sql.Int, batchId)
      .query(
        `UPDATE DashboardProduksiPalletPosisi SET BatchIDAktif = @batchId, ModifiedDate = GETDATE() WHERE PosisiID = @posisiId AND BatchIDAktif IS NULL`
      );
    if (claim.rowsAffected[0] === 0) {
      throw new AppError("Posisi pallet ini sudah terisi batch lain.");
    }

    await transaction.commit();
    return batchId;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in files this task hasn't touched yet (Task 3-8 will fix consumers of the new `JamPanen`/`jamPanen` fields — e.g. `peta-warehouse.tsx`, `produksi-baru-form.tsx`, `actions.ts` will show type errors until later tasks land). If you see an error in `produksi-warehouse.ts` itself, fix it before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/produksi-warehouse.ts
git commit -m "feat: add JamPanen field and filter getWarehouseMap to the new 42-slot denah"
```

---

## Task 3: Shared warehouse layout data + `WarehouseCell` component

**Files:**
- Create: `src/components/produksi/warehouse-layout.ts`
- Create: `src/components/produksi/warehouse-cell.tsx`

**Interfaces:**
- Consumes: `PalletPosisiRow` (Task 2).
- Produces: `WAREHOUSE_ZONES: WarehouseZone[]`, `WarehouseZone`/`WarehouseGrup` types (from `warehouse-layout.ts`) — consumed by Task 4 and Task 8. `WarehouseCell` component, `ageClass()` function (from `warehouse-cell.tsx`) — consumed by Task 4 and Task 8.

- [ ] **Step 1: Create `src/components/produksi/warehouse-layout.ts`**

Transcribed verbatim from the confirmed denah in `docs/superpowers/specs/2026-08-11-warehouse-ice-stock-redesign-design.md` — do not reorder or re-derive.

```ts
// The confirmed 42-slot Ice Stock Cold Storage denah — one physical room,
// 3 zones (Selatan/Tengah/Utara), each zone made of 2-3 groups. Confirmed
// interactively with the user via the brainstorming visual companion (see
// .superpowers/brainstorm/700-1786449270/content/denah-v2.html) — every
// code, row order, and divider label here is taken directly from that
// confirmed layout, not re-derived.

export interface WarehouseGrup {
  id: string;
  columns: 2 | 3;
  rows: string[][];
  /** Divider label shown after this grup, inside its own zone. Omitted for
   * the last grup of a zone whose only "next" divider is the cross-zone
   * "Jalan" strip a parent component renders structurally between zones. */
  dividerAfter?: string;
}

export interface WarehouseZone {
  id: "S" | "T" | "U";
  label: string;
  grup: WarehouseGrup[];
  /** Only the Utara zone has the room's single sliding door at its end. */
  showPintuGeser: boolean;
}

export const WAREHOUSE_ZONES: WarehouseZone[] = [
  {
    id: "S",
    label: "Selatan",
    showPintuGeser: false,
    grup: [
      {
        id: "S1",
        columns: 2,
        dividerAfter: "Jalan",
        rows: [
          ["S1F", "S1C"],
          ["S1E", "S1B"],
          ["S1D", "S1A"],
        ],
      },
      {
        id: "S2",
        columns: 2,
        rows: [
          ["S2D", "S2A"],
          ["S2E", "S2B"],
          ["S2F", "S2C"],
        ],
      },
    ],
  },
  {
    id: "T",
    label: "Tengah",
    showPintuGeser: false,
    grup: [
      {
        id: "T1",
        columns: 3,
        dividerAfter: "Jalan",
        rows: [
          ["T1I", "T1F", "T1C"],
          ["T1H", "T1E", "T1B"],
          ["T1G", "T1D", "T1A"],
        ],
      },
      {
        id: "T2",
        columns: 3,
        rows: [
          ["T2G", "T2D", "T2A"],
          ["T2H", "T2E", "T2B"],
          ["T2I", "T2F", "T2C"],
        ],
      },
    ],
  },
  {
    id: "U",
    label: "Utara",
    showPintuGeser: true,
    grup: [
      {
        id: "U1",
        columns: 2,
        dividerAfter: "Jalan & Jendela 1",
        rows: [
          ["U1D", "U1B"],
          ["U1C", "U1A"],
        ],
      },
      {
        id: "U2",
        columns: 2,
        dividerAfter: "Jalan & Jendela 2",
        rows: [
          ["U2C", "U2A"],
          ["U2D", "U2B"],
        ],
      },
      {
        id: "U3",
        columns: 2,
        dividerAfter: "Jalan & Jendela 3",
        rows: [
          ["U3C", "U3A"],
          ["U3D", "U3B"],
        ],
      },
    ],
  },
];
```

- [ ] **Step 2: Create `src/components/produksi/warehouse-cell.tsx`**

`ageClass` moves here from the old `peta-warehouse.tsx` and switches its basis from `TanggalProduksi` (form-submit timestamp) to `TanggalLabel` + `JamPanen` (the actual cold-storage-entry moment) — per the design spec's confirmed requirement that age must measure real storage time, not data-entry time.

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

// Age is measured from TanggalLabel + JamPanen (when the ice actually
// entered cold storage), not TanggalProduksi (when the form was submitted
// — could be minutes or hours after the real harvest moment). Falls back to
// 00:00 if JamPanen is somehow null on an old row, so age is never NaN.
export function ageClass(tanggalLabel: Date | string | null, jamPanen: string | null): string {
  if (!tanggalLabel) return "bg-muted text-muted-foreground";
  const dateOnly = new Date(tanggalLabel).toISOString().slice(0, 10);
  const harvestedAt = new Date(`${dateOnly}T${jamPanen || "00:00"}:00`);
  const ageDays = (Date.now() - harvestedAt.getTime()) / 86400000;
  if (ageDays >= 3) return "bg-red-600 text-white";
  if (ageDays >= 1) return "bg-amber-500 text-white";
  return "bg-emerald-600 text-white";
}

export function WarehouseCell({
  kode,
  row,
  onClick,
}: {
  kode: string;
  row: PalletPosisiRow | undefined;
  onClick?: (row: PalletPosisiRow | undefined) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(row)}
      className={cn(
        "flex h-14 flex-1 flex-col items-center justify-center rounded-md text-xs font-semibold leading-tight",
        row?.BatchIDAktif != null ? ageClass(row.TanggalLabel, row.JamPanen) : "bg-muted text-muted-foreground"
      )}
    >
      <span>{kode}</span>
      {row?.BatchIDAktif != null && (
        <span className="text-[9px] font-normal opacity-90">
          {row.SisaQty10KG ?? 0}-{row.SisaQty5KG ?? 0}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no new errors from these two new files.

Run: `npx eslint src/components/produksi/warehouse-layout.ts src/components/produksi/warehouse-cell.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi/warehouse-layout.ts src/components/produksi/warehouse-cell.tsx
git commit -m "feat: add shared warehouse denah layout data and WarehouseCell component"
```

---

## Task 4: `PetaWarehouseDesktop` component + desktop page wiring

**Files:**
- Create: `src/components/produksi/peta-warehouse-desktop.tsx`
- Delete: `src/components/produksi/peta-warehouse.tsx`
- Modify: `src/app/mkesindo/produksi/page.tsx:6,26` (import + usage)

**Interfaces:**
- Consumes: `WAREHOUSE_ZONES` (Task 3), `WarehouseCell` (Task 3), `PalletPosisiRow` (Task 2).
- Produces: `PetaWarehouseDesktop({ posisi }: { posisi: PalletPosisiRow[] })` — consumed by `src/app/mkesindo/produksi/page.tsx`.

- [ ] **Step 1: Delete the old file**

```bash
rm src/components/produksi/peta-warehouse.tsx
```

- [ ] **Step 2: Create `src/components/produksi/peta-warehouse-desktop.tsx`**

Renders all 3 zones side-by-side (desktop has the width for it — no tabs, no swipe, matching the confirmed design). Click behavior unchanged from the old component: filled cell → read-only detail panel below; empty cell → no-op (desktop has no add-production entry point, same as before this plan).

```tsx
"use client";

import { useState } from "react";
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

export function PetaWarehouseDesktop({ posisi }: { posisi: PalletPosisiRow[] }) {
  const [selected, setSelected] = useState<PalletPosisiRow | null>(null);
  const byKode = new Map(posisi.map((p) => [p.Kode, p]));

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-4 overflow-x-auto pb-2">
        {WAREHOUSE_ZONES.map((zone, zoneIdx) => (
          <div key={zone.id} className="flex items-start gap-4">
            {zoneIdx > 0 && <div className="mt-6 h-full w-px self-stretch bg-border" />}
            <div className="flex min-w-fit flex-col gap-1">
              <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                {zone.label} (kode {zone.id})
              </p>
              {zone.grup.map((g) => (
                <div key={g.id} className="flex flex-col gap-1">
                  {g.rows.map((row, i) => (
                    <div key={i} className="flex gap-2">
                      {row.map((kode) => (
                        <WarehouseCell
                          key={kode}
                          kode={kode}
                          row={byKode.get(kode)}
                          onClick={(r) => r && setSelected(r)}
                        />
                      ))}
                    </div>
                  ))}
                  {g.dividerAfter && (
                    <div className="flex items-center gap-2 text-center text-[11px] text-muted-foreground">
                      <span className="flex-1 border-t border-dashed border-border" />
                      <span>{g.dividerAfter}</span>
                      <span className="flex-1 border-t border-dashed border-border" />
                    </div>
                  )}
                </div>
              ))}
              {zone.showPintuGeser && (
                <p className="mt-2 rounded-md bg-muted py-1 text-center text-xs font-medium">Pintu Geser</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-[11px]">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-red-600" /> Paling lama
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-amber-500" /> Menengah
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-emerald-600" /> Baru
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-muted" /> Kosong
        </span>
      </div>

      {selected && (
        <div className="mt-4 rounded-md border border-border p-3 text-sm">
          <p className="font-semibold">Pallet {selected.Kode}</p>
          <p className="text-muted-foreground">Mesin: {selected.MesinNama ?? "-"}</p>
          {selected.TanggalLabel != null && (
            <p className="text-muted-foreground">
              Tanggal &amp; Shift Produksi:{" "}
              {new Date(selected.TanggalLabel).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {" — Shift "}
              {selected.Shift}
              {selected.JamPanen && ` — Jam Panen ${selected.JamPanen}`}
            </p>
          )}
          <p className="text-muted-foreground">
            Sisa: {selected.SisaQty10KG ?? 0} kantong 10kg, {selected.SisaQty5KG ?? 0} kantong 5kg
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire into the desktop page**

In `src\app\mkesindo\produksi\page.tsx`, change line 6:

```tsx
import { PetaWarehouseDesktop } from "@/components/produksi/peta-warehouse-desktop";
```

And change line 26:

```tsx
          <PetaWarehouseDesktop posisi={posisi} />
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors in these files (other files touching the deleted `PetaWarehouse` export, if any beyond `page.tsx`, would show here — there are none besides `warehouse-view.tsx`, which Task 8 rewrites).

Run: `npx eslint src/components/produksi/peta-warehouse-desktop.tsx src/app/mkesindo/produksi/page.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi/peta-warehouse-desktop.tsx src/app/mkesindo/produksi/page.tsx
git rm src/components/produksi/peta-warehouse.tsx
git commit -m "feat: add PetaWarehouseDesktop with the 42-slot denah, replacing PetaWarehouse"
```

---

## Task 5: `RiwayatProduksi` — add Jam Panen column

**Files:**
- Modify: `src/components/produksi/riwayat-produksi.tsx` (entire file)

**Interfaces:**
- Consumes: `RiwayatProduksiRowWithNama` (already includes `.JamPanen: string` via `RiwayatProduksiRow` from Task 2).

- [ ] **Step 1: Replace the whole file**

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RiwayatProduksiRowWithNama } from "@/app/mkesindo/produksi/actions";

export function RiwayatProduksi({ riwayat }: { riwayat: RiwayatProduksiRowWithNama[] }) {
  if (riwayat.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada riwayat produksi.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tanggal</TableHead>
            <TableHead>Tanggal &amp; Shift Produksi</TableHead>
            <TableHead>Jam Panen</TableHead>
            <TableHead>Mesin</TableHead>
            <TableHead>Pallet</TableHead>
            <TableHead>Jumlah Awal</TableHead>
            <TableHead>Sisa</TableHead>
            <TableHead>Dicatat Oleh</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {riwayat.map((r) => (
            <TableRow key={r.BatchID}>
              <TableCell>{new Date(r.TanggalProduksi).toLocaleDateString("id-ID")}</TableCell>
              <TableCell>
                {new Date(r.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" — Shift "}
                {r.Shift}
              </TableCell>
              <TableCell>{r.JamPanen || "-"}</TableCell>
              <TableCell>{r.MesinNama}</TableCell>
              <TableCell>{r.Kode}</TableCell>
              <TableCell>
                {r.Qty10KG} kantong 10kg, {r.Qty5KG} kantong 5kg
              </TableCell>
              <TableCell>
                {r.SisaQty10KG} kantong 10kg, {r.SisaQty5KG} kantong 5kg
              </TableCell>
              <TableCell>{r.DicatatOlehNama}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

Run: `npx eslint src/components/produksi/riwayat-produksi.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi/riwayat-produksi.tsx
git commit -m "feat: show Jam Panen column in Riwayat Produksi"
```

---

## Task 6: `createBatchAction` — validate `jamPanen`

**Files:**
- Modify: `src/app/mkesindo/produksi/actions.ts:60-72`

**Interfaces:**
- Consumes: `CreateBatchInput.jamPanen: string` (Task 2).
- Produces: `createBatchAction` now requires and validates `jamPanen` — consumed by Task 7's `TambahProduksiDialog`.

- [ ] **Step 1: Add the validation**

In `src\app\mkesindo\produksi\actions.ts`, replace the `createBatchAction` function (lines 60-72):

```ts
export async function createBatchAction(
  input: Omit<CreateBatchInput, "dicatatOlehAkunId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (!input.jamPanen) {
      throw new AppError("Isi jam panen.");
    }
    if (input.qty10KG <= 0 && input.qty5KG <= 0) {
      throw new AppError("Isi jumlah kantong 10kg atau 5kg minimal satu.");
    }
    const batchId = await createBatch({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    return batchId;
  });
}
```

(This is the only change in the file — `CreateBatchInput` already carries `jamPanen` from Task 2, so the `Omit<..., "dicatatOlehAkunId">` type flows through automatically with no other edits needed.)

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

Run: `npx eslint src/app/mkesindo/produksi/actions.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/mkesindo/produksi/actions.ts
git commit -m "feat: require jamPanen in createBatchAction"
```

---

## Task 7: `TambahProduksiDialog` component

**Files:**
- Create: `src/components/produksi-app/tambah-produksi-dialog.tsx`

**Interfaces:**
- Consumes: `createBatchAction` (Task 6), `getBusinessDateISO` (`@/lib/business-date`, existing), `SHIFT_LABEL` (`@/lib/produksi-shift`, existing), `MesinRow` (`@/lib/queries/produksi-mesin`, existing), `PalletPosisiRow` (Task 2), shadcn `Dialog`/`Select`/`Input`/`Button`/`Label` (existing, see `src/components/driver-app/steps/bbm-dialog.tsx` for the same `Dialog` usage pattern).
- Produces: `TambahProduksiDialog({ open, onOpenChange, posisi, mesinList, onSaved })` — consumed by Task 8.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createBatchAction } from "@/app/mkesindo/produksi/actions";
import { getBusinessDateISO } from "@/lib/business-date";
import { SHIFT_LABEL } from "@/lib/produksi-shift";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

const SHIFT_OPTIONS = [1, 2, 3] as const;

export function TambahProduksiDialog({
  open,
  onOpenChange,
  posisi,
  mesinList,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  posisi: PalletPosisiRow | null;
  mesinList: MesinRow[];
  onSaved: () => void;
}) {
  const [tanggalLabel, setTanggalLabel] = useState(() => getBusinessDateISO());
  const [shift, setShift] = useState<string>("1");
  const [mesinId, setMesinId] = useState<string>("");
  const [jamPanen, setJamPanen] = useState("");
  const [qty10, setQty10] = useState("");
  const [qty5, setQty5] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTanggalLabel(getBusinessDateISO());
    setShift("1");
    setMesinId("");
    setJamPanen("");
    setQty10("");
    setQty5("");
    setError(null);
  }

  function handleSubmit() {
    if (!posisi) return;
    setError(null);
    if (!mesinId) {
      setError("Pilih mesin yang dipakai.");
      return;
    }
    if (!jamPanen) {
      setError("Isi jam panen.");
      return;
    }
    if ((Number(qty10) || 0) <= 0 && (Number(qty5) || 0) <= 0) {
      setError("Isi jumlah kantong 10kg atau 5kg minimal satu.");
      return;
    }
    startTransition(async () => {
      const result = await createBatchAction({
        tanggalLabel,
        shift: Number(shift) as 1 | 2 | 3,
        mesinId: Number(mesinId),
        posisiId: posisi.PosisiID,
        jamPanen,
        qty10KG: Number(qty10) || 0,
        qty5KG: Number(qty5) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      reset();
      onSaved();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Produksi — Slot {posisi?.Kode}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Tanggal Produksi</Label>
            <Input type="date" value={tanggalLabel} onChange={(e) => setTanggalLabel(e.target.value)} />
          </div>
          <div>
            <Label>Shift</Label>
            <Select value={shift} onValueChange={(v) => setShift(v ?? "1")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih shift">{(v: string) => SHIFT_LABEL[Number(v) as 1 | 2 | 3]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SHIFT_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {SHIFT_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Mesin yang Dipakai</Label>
            <Select value={mesinId} onValueChange={(v) => setMesinId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih mesin">
                  {(v: string) => mesinList.find((m) => String(m.MesinID) === v)?.Nama ?? v}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {mesinList.map((m) => (
                  <SelectItem key={m.MesinID} value={String(m.MesinID)}>
                    {m.Nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Jam Panen</Label>
            <Input type="time" value={jamPanen} onChange={(e) => setJamPanen(e.target.value)} />
          </div>
          <div>
            <Label>Jumlah Kantong 10kg</Label>
            <Input type="number" value={qty10} onChange={(e) => setQty10(e.target.value)} />
          </div>
          <div>
            <Label>Jumlah Kantong 5kg</Label>
            <Input type="number" value={qty5} onChange={(e) => setQty5(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button disabled={pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors in this file.

Run: `npx eslint src/components/produksi-app/tambah-produksi-dialog.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi-app/tambah-produksi-dialog.tsx
git commit -m "feat: add TambahProduksiDialog for click-slot-to-add production"
```

---

## Task 8: Mobile `WarehouseView` — swipeable zones + click-to-add

**Files:**
- Modify: `src/components/produksi-app/warehouse-view.tsx` (entire file)

**Interfaces:**
- Consumes: `WAREHOUSE_ZONES`, `WarehouseCell` (Task 3), `TambahProduksiDialog` (Task 7), `PalletPosisiRow` (Task 2), `MesinRow` (existing).
- Produces: `WarehouseView({ posisi, mesinList, onAfterTambah })` — note the signature change (adds `mesinList` and `onAfterTambah`, was previously just `{ posisi }`) — consumed by Task 9.

- [ ] **Step 1: Replace the whole file**

```tsx
"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import { TambahProduksiDialog } from "@/components/produksi-app/tambah-produksi-dialog";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

export function WarehouseView({
  posisi,
  mesinList,
  onAfterTambah,
}: {
  posisi: PalletPosisiRow[];
  mesinList: MesinRow[];
  onAfterTambah: () => void;
}) {
  const [selected, setSelected] = useState<PalletPosisiRow | null>(null);
  const [dialogPosisi, setDialogPosisi] = useState<PalletPosisiRow | null>(null);
  const [activeZone, setActiveZone] = useState<string>(WAREHOUSE_ZONES[0].id);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const byKode = new Map(posisi.map((p) => [p.Kode, p]));

  function scrollToZone(zoneId: string) {
    setActiveZone(zoneId);
    panelRefs.current[zoneId]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  function handleCellClick(row: PalletPosisiRow | undefined) {
    if (!row) return;
    if (row.BatchIDAktif == null) {
      setDialogPosisi(row);
    } else {
      setSelected(row);
    }
  }

  // Keeps the Selatan/Tengah/Utara tab highlight in sync when the user
  // swipes manually (not just when they tap a tab) — finds whichever
  // panel's horizontal center is closest to the scroller's own center.
  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const centerX = scrollerRect.left + scrollerRect.width / 2;
    let closest = WAREHOUSE_ZONES[0].id;
    let closestDist = Infinity;
    for (const zone of WAREHOUSE_ZONES) {
      const el = panelRefs.current[zone.id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.left + rect.width / 2 - centerX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = zone.id;
      }
    }
    setActiveZone(closest);
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex gap-1 border-b border-border">
        {WAREHOUSE_ZONES.map((zone) => (
          <button
            key={zone.id}
            type="button"
            onClick={() => scrollToZone(zone.id)}
            className={cn(
              "flex-1 border-b-2 py-2 text-sm font-medium",
              activeZone === zone.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
            )}
          >
            {zone.label}
          </button>
        ))}
      </div>

      <div ref={scrollerRef} onScroll={handleScroll} className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
        {WAREHOUSE_ZONES.map((zone) => (
          <div
            key={zone.id}
            ref={(el) => {
              panelRefs.current[zone.id] = el;
            }}
            className="flex w-[88%] shrink-0 snap-start flex-col gap-1 rounded-lg border border-border p-3"
          >
            {zone.grup.map((g) => (
              <div key={g.id} className="flex flex-col gap-1">
                {g.rows.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    {row.map((kode) => (
                      <WarehouseCell key={kode} kode={kode} row={byKode.get(kode)} onClick={handleCellClick} />
                    ))}
                  </div>
                ))}
                {g.dividerAfter && (
                  <div className="flex items-center gap-2 text-center text-[11px] text-muted-foreground">
                    <span className="flex-1 border-t border-dashed border-border" />
                    <span>{g.dividerAfter}</span>
                    <span className="flex-1 border-t border-dashed border-border" />
                  </div>
                )}
              </div>
            ))}
            {zone.showPintuGeser && (
              <p className="mt-2 rounded-md bg-muted py-1 text-center text-xs font-medium">Pintu Geser</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-[11px]">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-red-600" /> Paling lama
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-amber-500" /> Menengah
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-emerald-600" /> Baru
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-muted" /> Kosong — ketuk untuk tambah produksi
        </span>
      </div>

      {selected && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-semibold">Pallet {selected.Kode}</p>
          <p className="text-muted-foreground">Mesin: {selected.MesinNama ?? "-"}</p>
          {selected.TanggalLabel != null && (
            <p className="text-muted-foreground">
              Tanggal &amp; Shift Produksi:{" "}
              {new Date(selected.TanggalLabel).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {" — Shift "}
              {selected.Shift}
              {selected.JamPanen && ` — Jam Panen ${selected.JamPanen}`}
            </p>
          )}
          <p className="text-muted-foreground">
            Sisa: {selected.SisaQty10KG ?? 0} kantong 10kg, {selected.SisaQty5KG ?? 0} kantong 5kg
          </p>
        </div>
      )}

      <TambahProduksiDialog
        open={dialogPosisi != null}
        onOpenChange={(open) => !open && setDialogPosisi(null)}
        posisi={dialogPosisi}
        mesinList={mesinList}
        onSaved={() => {
          setDialogPosisi(null);
          onAfterTambah();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `produksi-tab-shell.tsx` (still calling `WarehouseView` with the old `{ posisi }`-only signature) — Task 9 fixes that call site. No errors should appear in `warehouse-view.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi-app/warehouse-view.tsx
git commit -m "feat: rewrite mobile WarehouseView as swipeable zones with click-to-add"
```

---

## Task 9: Remove the "Produksi Baru" tab

**Files:**
- Delete: `src/components/produksi-app/produksi-baru-form.tsx`
- Delete: `src/app/mkesindo/produksi-app/(tabs)/produksi-baru/page.tsx`
- Modify: `src/components/produksi-app/bottom-nav.tsx` (entire file)
- Modify: `src/components/produksi-app/produksi-tab-shell.tsx` (entire file)
- Modify: `src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx` (entire file)

**Interfaces:**
- Consumes: `WarehouseView` (Task 8, new `{ posisi, mesinList, onAfterTambah }` signature).
- Produces: `ProduksiTabKey = "kartu-pengiriman" | "warehouse" | "profil"` (removed `"produksi-baru"`) — this is the last task that touches `ProduksiTabKey`, no later task depends on it.

- [ ] **Step 1: Delete the old form component and its route**

```bash
rm src/components/produksi-app/produksi-baru-form.tsx
rm src/app/mkesindo/produksi-app/\(tabs\)/produksi-baru/page.tsx
rmdir "src/app/mkesindo/produksi-app/(tabs)/produksi-baru"
```

- [ ] **Step 2: Replace `src/components/produksi-app/bottom-nav.tsx`**

```tsx
"use client";

import { ClipboardList, Warehouse, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProduksiTabKey } from "./produksi-tab-shell";

const TABS: { key: ProduksiTabKey; label: string; icon: typeof ClipboardList }[] = [
  { key: "kartu-pengiriman", label: "Kartu Pengiriman", icon: ClipboardList },
  { key: "warehouse", label: "Warehouse", icon: Warehouse },
  { key: "profil", label: "Profil", icon: User },
];

export function ProduksiBottomNav({
  activeTab,
  onChange,
}: {
  activeTab: ProduksiTabKey;
  onChange: (tab: ProduksiTabKey) => void;
}) {
  return (
    <nav className="flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
              active ? "text-primary" : "text-muted-foreground"
            )}
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

- [ ] **Step 3: Replace `src/components/produksi-app/produksi-tab-shell.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { KartuPengirimanList } from "@/components/produksi-app/kartu-pengiriman-list";
import { WarehouseView } from "@/components/produksi-app/warehouse-view";
import { ProfilView } from "@/components/produksi-app/profil-view";
import { ProduksiBottomNav } from "@/components/produksi-app/bottom-nav";
import {
  getDraftJadwalForProduksiAction,
  getWarehouseMapAction,
  getMesinListAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

export type ProduksiTabKey = "kartu-pengiriman" | "warehouse" | "profil";

const TAB_PATHS: Record<ProduksiTabKey, string> = {
  "kartu-pengiriman": "/mkesindo/produksi-app",
  warehouse: "/mkesindo/produksi-app/warehouse",
  profil: "/mkesindo/produksi-app/profil",
};

export function ProduksiTabShell({
  initialTab,
  userName,
  initialKartuPengiriman,
  initialWarehouse,
  initialMesin,
}: {
  initialTab: ProduksiTabKey;
  userName: string;
  initialKartuPengiriman?: DraftJadwalForProduksi[];
  initialWarehouse?: PalletPosisiRow[];
  initialMesin?: MesinRow[];
}) {
  const [activeTab, setActiveTab] = useState<ProduksiTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<ProduksiTabKey>>(() => new Set([initialTab]));

  const [kartuPengiriman, setKartuPengiriman] = useState<DraftJadwalForProduksi[] | null>(initialKartuPengiriman ?? null);
  const [warehouse, setWarehouse] = useState<PalletPosisiRow[] | null>(initialWarehouse ?? null);
  const [mesin, setMesin] = useState<MesinRow[] | null>(initialMesin ?? null);

  const [loadingTab, setLoadingTab] = useState<ProduksiTabKey | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  function handleChangeTab(tab: ProduksiTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  function refreshKartuPengiriman() {
    setKartuPengiriman(null);
  }

  function refreshWarehouse() {
    setWarehouse(null);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTabError(null);
      if (activeTab === "kartu-pengiriman" && kartuPengiriman === null) {
        setLoadingTab("kartu-pengiriman");
        const result = await getDraftJadwalForProduksiAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setKartuPengiriman(result.data);
        setLoadingTab(null);
        return;
      }
      if (activeTab === "warehouse" && warehouse === null) {
        setLoadingTab("warehouse");
        const result = await getWarehouseMapAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setWarehouse(result.data);
        setLoadingTab(null);
      }
      // Warehouse now also needs the Mesin list up front — the click-slot
      // Tambah Produksi dialog is embedded directly in the Warehouse tab
      // (the old separate "Produksi Baru" tab is gone), so both must be
      // loaded before that tab can render its dialog's Mesin picker.
      if (activeTab === "warehouse" && mesin === null) {
        setLoadingTab("warehouse");
        const result = await getMesinListAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setMesin(result.data);
        setLoadingTab(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // kartuPengiriman/warehouse/mesin are deliberately in the dependency
    // list, not just activeTab: refreshKartuPengiriman/refreshWarehouse
    // reset the relevant state to null WITHOUT changing activeTab (a save
    // action's onAfter callback fires while the user is still on that same
    // tab), and this effect must re-run to refetch in that case, not only
    // when the user switches tabs.
  }, [activeTab, kartuPengiriman, warehouse, mesin]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        {loadingTab && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {tabError && (
          <p className="absolute inset-x-4 top-4 z-10 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {tabError}
          </p>
        )}
        {visited.has("kartu-pengiriman") && kartuPengiriman && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "kartu-pengiriman" && "hidden")}>
            <KartuPengirimanList
              initialJadwal={kartuPengiriman}
              onAfterMuat={() => {
                refreshKartuPengiriman();
                refreshWarehouse();
              }}
            />
          </div>
        )}
        {visited.has("warehouse") && warehouse && mesin && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "warehouse" && "hidden")}>
            <WarehouseView posisi={warehouse} mesinList={mesin} onAfterTambah={refreshWarehouse} />
          </div>
        )}
        {visited.has("profil") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "profil" && "hidden")}>
            <ProfilView userName={userName} />
          </div>
        )}
      </div>
      <ProduksiBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx`**

Now also fetches `mesinList` up front (needed by the embedded Tambah Produksi dialog), same pattern the old `produksi-baru/page.tsx` used:

```tsx
import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppWarehousePage() {
  const session = await requireProduksi();
  const [posisi, mesinList] = await Promise.all([getWarehouseMap(), getMesinList()]);

  return (
    <ProduksiTabShell
      initialTab="warehouse"
      userName={session.user.name ?? session.user.username}
      initialWarehouse={posisi}
      initialMesin={mesinList}
    />
  );
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: zero errors anywhere in the project (this is the last task touching these files — every consumer of the old `ProduksiTabKey`/`ProduksiBaruForm`/old `WarehouseView` signature has now been updated).

Run: `npx eslint src/components/produksi-app/bottom-nav.tsx src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/produksi-app/bottom-nav.tsx src/components/produksi-app/produksi-tab-shell.tsx "src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx"
git rm src/components/produksi-app/produksi-baru-form.tsx "src/app/mkesindo/produksi-app/(tabs)/produksi-baru/page.tsx"
git commit -m "feat: remove Produksi Baru tab, add production via click-slot on Warehouse map"
```

---

## Task 10: Full verification pass

**Files:**
- None (verification only).

- [ ] **Step 1: Full typecheck and lint**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npm run lint`
Expected: zero errors (or only pre-existing errors/warnings unrelated to this plan's files — confirm any such finding is not in a file this plan touched before treating it as acceptable, e.g. via `git diff --stat <task-1-commit>..HEAD -- <the file in question>` returning empty).

- [ ] **Step 2: Live browser check — desktop `/mkesindo/produksi`**

Log in as a `produksi`-permission account (or superadmin/direktur). Confirm:
- "Peta Warehouse" section shows all 42 slots grouped into Selatan/Tengah/Utara side-by-side, with correct group sizes (S1/S2 = 6 each, T1/T2 = 9 each, U1/U2/U3 = 4 each), correct divider labels ("Jalan" between S1/S2 and T1/T2, "Jalan & Jendela 1/2/3" between U1/U2/U3), and "Pintu Geser" after U3.
- Every slot starts empty (gray/muted) — confirms the new 42 rows were seeded correctly and the old 12 rows are correctly filtered out.
- Clicking any slot does nothing (no dialog, no navigation) since it's empty — desktop stays read-only.
- "Riwayat Produksi" table (if any historical rows exist from before this plan) still shows its old entries with their old pallet codes (`1A` etc.) intact — proves the old `DashboardProduksiPalletPosisi` rows were correctly preserved, not deleted.

- [ ] **Step 3: Live browser check — mobile `/mkesindo/produksi-app`**

- Bottom nav shows exactly 3 items: Kartu Pengiriman, Warehouse, Profil (no "Produksi Baru").
- Open the Warehouse tab: confirm the Selatan/Tengah/Utara tab row at top, and that tapping each tab smooth-scrolls to the corresponding zone panel (S1/S2 grid, T1/T2 grid, U1/U2/U3 grid respectively), with a sliver of the neighboring zone panel visible at the edge.
- Manually swipe the zone carousel left/right — confirm the active tab underline updates to match whichever zone is now centered, even without tapping a tab.
- Tap an empty slot — confirm the Tambah Produksi dialog opens with the correct slot code in its title, fill in Mesin, Shift, Jam Panen, and a Qty 10kg or 5kg value, submit — confirm the dialog closes and that exact slot immediately renders as filled (green, with the "qty10-qty5" readout) without a full page reload.
- Tap that now-filled slot — confirm the read-only detail panel opens below showing the pallet code, mesin, tanggal/shift, Jam Panen, and sisa quantities.
- Try submitting the dialog with Jam Panen left blank — confirm it's rejected client-side with "Isi jam panen." before any network call.

- [ ] **Step 4: Report results**

Summarize pass/fail for each check above. If any check fails, use systematic-debugging to find the root cause before patching — do not layer a fix on top of a guess.
