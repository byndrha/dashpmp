# Perluasan Modul Produksi — Akses, Tanggal, Sisa Kantong, Shift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 independent perluasan/perbaikan to the already-built Modul Produksi (`/mkesindo/produksi` desktop + `/mkesindo/produksi-app` mobile), per `docs/superpowers/specs/2026-08-11-modul-produksi-perluasan-design.md`: (1) turn `/mkesindo/produksi` into a regular permission-gated module reachable from the sidebar, while `is_produksi` accounts now land on `/mkesindo/produksi-app` after login instead; (2) show the calendar date on Kartu Pengiriman cards in produksi-app, not just the time; (3) show remaining 10kg/5kg bag counts directly on each warehouse pallet cell, not only after clicking it; (4) let a new production batch record a business `TanggalLabel`/`Shift` distinct from the real-time `TanggalProduksi` FIFO timestamp.

**Architecture:** (1) reuses the existing module-permission system (`MODULE_KEYS`/`canView`/`NAV_ITEMS`) plus one new guard function `requireProduksiView()` that also bypasses for `is_produksi` accounts directly — mirrors `canAccessAllPT`'s bypass pattern but scoped to this one module. (2) and (3) are small presentational changes to existing components, (3) landing in the component shared by both the desktop and mobile warehouse views. (4) adds two plain columns to the existing `DashboardProduksiBatch` table (no new reference table — Shift is a fixed 3-value TINYINT mapped to labels in TS) and threads them through the existing `createBatch`/`CreateBatchInput`/`ProduksiBaruForm` path, read back through the existing `getRiwayatProduksi`/`getWarehouseMap` queries.

**Tech Stack:** Next.js 16 (App Router, Server Actions), MSSQL (`mssql` via `src/lib/db.ts`), NextAuth (JWT sessions), shadcn/base-ui components, Tailwind.

## Global Constraints

- All Indonesian-language user-facing strings (labels, error messages) — no English UI text.
- No test runner exists in this project. Every task's verification is `npx tsc --noEmit` (zero errors touching changed files) + `npx eslint <changed files>`; live browser verification is consolidated into the final task.
- Everything happens directly on the `main` branch. No worktree.
- The MSSQL DDL task is **controller-run**: executed directly via the `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_ddl` tool by whoever is executing this plan, before dispatching the task that depends on it — never delegated to an implementer subagent. No `FOREIGN KEY`/`REFERENCES` clauses and no `CREATE INDEX`, matching every existing custom `Dashboard*` table in this codebase.
- `TanggalProduksi` on `DashboardProduksiBatch` is **not touched** by any task in this plan — it stays `GETDATE()`-driven at insert time and remains the sole basis for FIFO ordering and the pallet-cell age coloring (`ageClass` in `peta-warehouse.tsx`). `TanggalLabel`/`Shift` are new, independent, purely descriptive columns.
- `requireProduksi()` (`src/lib/require-access.ts`) is **not modified** and keeps gating every `/mkesindo/produksi-app/*` page exactly as today — only the desktop `/mkesindo/produksi` surfaces (layout, page, every action in `src/app/mkesindo/produksi/actions.ts`) switch to the new `requireProduksiView()`.
- Shift is a fixed 3-value `TINYINT` (1/2/3), mapped to display labels via a plain TS `Record`, not a new database reference table.
- No `react-hook-form`/`zod` anywhere in this codebase — every form uses controlled `<input>`/shadcn `<Select>`/`<Input>` + `useState` + `useTransition` + `ActionResult<T>`. New form fields in this plan follow this exact convention.
- Money/quantity/date values from MSSQL columns arrive as plain JS `number`/`Date` via the `mssql` driver — no `Decimal.js` or extra parsing layers.

---

## Task 1: Akses & Navigasi — module permission, guard, sidebar entry, login redirect

**Files:**
- Modify: `src/lib/permissions.ts:6-20`
- Modify: `src/lib/require-access.ts` (append after the existing `requireProduksi()` at the end of the file)
- Modify: `src/components/dashboard/app-sidebar.tsx:5-16` (icon import), `:34-45` (NAV_ITEMS)
- Modify: `src/app/mkesindo/produksi/layout.tsx`
- Modify: `src/app/mkesindo/produksi/page.tsx`
- Modify: `src/app/mkesindo/produksi/actions.ts`
- Modify: `src/app/mkesindo/(dashboard)/layout.tsx:70-83`

**Interfaces:**
- Consumes: `canAccessAllPT`, `canView`, `ModuleKey` (already exported from `src/lib/require-access.ts` / `src/lib/permissions.ts`).
- Produces: `ModuleKey` now includes `"produksi"`; `requireProduksiView(): Promise<Session>` exported from `src/lib/require-access.ts`, consumed by every file this task edits.

- [ ] **Step 1: Add `"produksi"` to the module-permission system**

In `src/lib/permissions.ts`, change line 6:

```ts
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "pemesanan", "mitra", "pemasaran", "produksi"] as const;
```

And add an entry to `MODULE_LABEL` (after `pemasaran: "Pemasaran",`):

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
};
```

No other change needed in this file — `PeranEditor` (`src/components/dashboard/peran-editor.tsx`) already renders one `<tr>` per `MODULE_KEYS` entry generically, so "Produksi" appears in the Peran permission table automatically.

- [ ] **Step 2: Add `requireProduksiView()` guard**

In `src/lib/require-access.ts`, append after the existing `requireProduksi()` function (end of file):

```ts

// Desktop /mkesindo/produksi is now a regular, permission-gated module
// (like Pengiriman, Penjualan, etc.) rather than exclusively is_produksi's
// own view — but is_produksi accounts still get automatic access without
// needing the "produksi" module permission explicitly granted, since they
// remain a special role (mirrors canAccessAllPT's superadmin/direktur
// bypass pattern, just for this one module instead of every module).
export async function requireProduksiView() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessAllPT(session.user) && !session.user.isProduksi && !canView(session.user.permissions, "produksi")) {
    redirect("/akses-ditolak");
  }
  return session;
}
```

- [ ] **Step 3: Add sidebar entry**

In `src/components/dashboard/app-sidebar.tsx`, add `Factory` to the `lucide-react` import (line 5-16):

```ts
import {
  LayoutGrid,
  LineChart,
  Receipt,
  ShoppingCart,
  ArrowLeftRight,
  Zap,
  Truck,
  ClipboardList,
  Users,
  Megaphone,
  Factory,
} from "lucide-react";
```

Add a new entry to `NAV_ITEMS` (line 34-45), after the `pemasaran` entry:

```ts
const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutGrid; exact?: boolean; moduleKey: ModuleKey }[] = [
  { href: "/mkesindo", label: "Beranda", icon: LayoutGrid, exact: true, moduleKey: "beranda" },
  { href: "/mkesindo/pnl", label: "Keuangan", icon: LineChart, moduleKey: "pnl" },
  { href: "/mkesindo/aging", label: "Piutang", icon: Receipt, moduleKey: "aging" },
  { href: "/mkesindo/sales", label: "Penjualan", icon: ShoppingCart, moduleKey: "sales" },
  { href: "/mkesindo/transaksi", label: "Transaksi", icon: ArrowLeftRight, moduleKey: "transaksi" },
  { href: "/mkesindo/electricity", label: "Biaya Listrik", icon: Zap, moduleKey: "electricity" },
  { href: "/mkesindo/delivery", label: "Pengiriman", icon: Truck, moduleKey: "delivery" },
  { href: "/mkesindo/pemesanan", label: "Pemesanan", icon: ClipboardList, moduleKey: "pemesanan" },
  { href: "/mkesindo/mitra", label: "Mitra", icon: Users, moduleKey: "mitra" },
  { href: "/mkesindo/pemasaran", label: "Pemasaran", icon: Megaphone, moduleKey: "pemasaran" },
  { href: "/mkesindo/produksi", label: "Produksi", icon: Factory, moduleKey: "produksi" },
];
```

- [ ] **Step 4: Swap the guard in the three desktop Produksi surfaces**

`src/app/mkesindo/produksi/layout.tsx` — replace the whole file:

```tsx
import { requireProduksiView } from "@/lib/require-access";

export default async function ProduksiLayout({ children }: { children: React.ReactNode }) {
  await requireProduksiView();
  return children;
}
```

`src/app/mkesindo/produksi/page.tsx` — change line 1 and line 11 only, everything else stays the same:

```tsx
import { requireProduksiView } from "@/lib/require-access";
```

```tsx
  const session = await requireProduksiView();
```

`src/app/mkesindo/produksi/actions.ts` — replace the whole file (every `requireProduksi()` call site becomes `requireProduksiView()`, plus the import):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireProduksiView } from "@/lib/require-access";
import { getMesinList, updateMesin, type MesinRow, type UpdateMesinInput } from "@/lib/queries/produksi-mesin";
import {
  getWarehouseMap,
  getRiwayatProduksi,
  createBatch,
  type PalletPosisiRow,
  type RiwayatProduksiRow,
  type CreateBatchInput,
} from "@/lib/queries/produksi-warehouse";
import {
  getDraftJadwalForProduksi,
  produksiMulaiMuat,
  type DraftJadwalForProduksi,
  type ProduksiMulaiMuatInput,
} from "@/lib/queries/produksi-muatan";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getMesinListAction(): Promise<ActionResult<MesinRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getMesinList();
  });
}

export async function updateMesinAction(input: UpdateMesinInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireProduksiView();
    if (!input.nama.trim()) throw new AppError("Nama mesin tidak boleh kosong.");
    if (input.kapasitasProduksiPerHari <= 0) throw new AppError("Kapasitas produksi harus lebih dari 0.");
    await updateMesin(input);
    revalidatePath("/mkesindo/produksi");
  });
}

export async function getWarehouseMapAction(): Promise<ActionResult<PalletPosisiRow[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getWarehouseMap();
  });
}

export interface RiwayatProduksiRowWithNama extends RiwayatProduksiRow {
  DicatatOlehNama: string;
}

export async function getRiwayatProduksiAction(): Promise<ActionResult<RiwayatProduksiRowWithNama[]>> {
  return runAction(async () => {
    await requireProduksiView();
    const rows = await getRiwayatProduksi();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}

export async function createBatchAction(
  input: Omit<CreateBatchInput, "dicatatOlehAkunId">
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    if (input.qty10KG <= 0 && input.qty5KG <= 0) {
      throw new AppError("Isi jumlah kantong 10kg atau 5kg minimal satu.");
    }
    const batchId = await createBatch({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    return batchId;
  });
}

export async function getDraftJadwalForProduksiAction(): Promise<ActionResult<DraftJadwalForProduksi[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getDraftJadwalForProduksi();
  });
}

export async function produksiMulaiMuatAction(
  input: Omit<ProduksiMulaiMuatInput, "dicatatOlehAkunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireProduksiView();
    const totalQty10 = input.alokasi.reduce((sum, a) => sum + a.qty10KG, 0);
    const totalQty5 = input.alokasi.reduce((sum, a) => sum + a.qty5KG, 0);
    const jadwalList = await getDraftJadwalForProduksi();
    const jadwal = jadwalList.find((j) => j.JadwalID === input.jadwalId);
    if (!jadwal) throw new AppError("Kartu Pengiriman ini sudah tidak tersedia untuk diisi.");
    if (totalQty10 < jadwal.Qty10KGDibutuhkan || totalQty5 < jadwal.Qty5KGDibutuhkan) {
      throw new AppError("Jumlah yang dialokasikan belum mencukupi kebutuhan Kartu Pengiriman ini.");
    }
    await produksiMulaiMuat({ ...input, dicatatOlehAkunId: Number(session.user.id) });
    revalidatePath("/mkesindo/produksi");
    revalidatePath("/mkesindo/produksi-app");
    revalidatePath("/mkesindo/delivery");
  });
}
```

- [ ] **Step 5: Redirect `is_produksi` login destination to produksi-app**

In `src/app/mkesindo/(dashboard)/layout.tsx`, replace lines 70-83 (the `isProduksi` confinement block and its comment):

```tsx
  // Same reasoning as Satpam/Driver above, but is_produksi accounts land on
  // /mkesindo/produksi-app (the mobile action app) on login, not
  // /mkesindo/produksi (the desktop view-only module, now a regular
  // permission-gated module like Pengiriman/Penjualan — see
  // docs/superpowers/specs/2026-08-11-modul-produksi-perluasan-design.md).
  // The prefix check below matches both "/mkesindo/produksi-app" and
  // "/mkesindo/produksi" itself (the latter starts with the same string),
  // so an is_produksi account that navigates to either one from here is
  // never bounced back — only landing anywhere else in the dashboard tree
  // triggers this redirect, straight to produksi-app.
  if (!session?.user?.isSuperAdmin && session?.user?.isProduksi && !pathname.startsWith("/mkesindo/produksi")) {
    redirect("/mkesindo/produksi-app");
  }
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/permissions.ts src/lib/require-access.ts src/components/dashboard/app-sidebar.tsx src/app/mkesindo/produksi/layout.tsx src/app/mkesindo/produksi/page.tsx src/app/mkesindo/produksi/actions.ts "src/app/mkesindo/(dashboard)/layout.tsx"`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/permissions.ts src/lib/require-access.ts src/components/dashboard/app-sidebar.tsx src/app/mkesindo/produksi/layout.tsx src/app/mkesindo/produksi/page.tsx src/app/mkesindo/produksi/actions.ts "src/app/mkesindo/(dashboard)/layout.tsx"
git commit -m "feat: make /mkesindo/produksi a permission-gated module, land is_produksi on produksi-app"
```

---

## Task 2: Tanggal di Kartu Pengiriman (produksi-app)

**Files:**
- Modify: `src/components/produksi-app/kartu-pengiriman-list.tsx:53-56`

**Interfaces:**
- Consumes: `DraftJadwalForProduksi.JamJadwal` (already a full datetime string — no query/type change).

- [ ] **Step 1: Add the date line above the existing time line**

In `src/components/produksi-app/kartu-pengiriman-list.tsx`, replace lines 53-56:

```tsx
          <p className="text-xs text-muted-foreground">
            {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          </p>
```

with:

```tsx
          <p className="text-xs text-muted-foreground">
            {new Date(jadwal.JamJadwal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
            {" • "}
            {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          </p>
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/produksi-app/kartu-pengiriman-list.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi-app/kartu-pengiriman-list.tsx
git commit -m "feat: show date alongside time on produksi-app Kartu Pengiriman cards"
```

---

## Task 3: Sisa Kantong per Pallet (Peta Warehouse)

**Files:**
- Modify: `src/components/produksi/peta-warehouse.tsx:25-39`

**Interfaces:**
- Consumes: `PalletPosisiRow.SisaQty10KG`/`SisaQty5KG`/`BatchIDAktif` (already returned by `getWarehouseMap` — no query/type change). This component is shared by both `/mkesindo/produksi` (desktop) and `/mkesindo/produksi-app/warehouse` (mobile, via `WarehouseView`), so this change applies to both automatically.

- [ ] **Step 1: Show remaining bag counts directly on each pallet cell**

In `src/components/produksi/peta-warehouse.tsx`, replace the `Cell` function (lines 25-39):

```tsx
  function Cell({ kode }: { kode: string }) {
    const row = byKode.get(kode);
    return (
      <button
        type="button"
        onClick={() => row && setSelected(row)}
        className={cn(
          "flex h-14 flex-1 items-center justify-center rounded-md text-xs font-semibold",
          row ? ageClass(row.TanggalProduksi) : "bg-muted text-muted-foreground"
        )}
      >
        {kode}
      </button>
    );
  }
```

with:

```tsx
  function Cell({ kode }: { kode: string }) {
    const row = byKode.get(kode);
    return (
      <button
        type="button"
        onClick={() => row && setSelected(row)}
        className={cn(
          "flex h-14 flex-1 flex-col items-center justify-center rounded-md text-xs font-semibold leading-tight",
          row ? ageClass(row.TanggalProduksi) : "bg-muted text-muted-foreground"
        )}
      >
        <span>{kode}</span>
        {row?.BatchIDAktif != null && (
          <span className="text-[9px] font-normal opacity-90">
            {row.SisaQty10KG ?? 0}·{row.SisaQty5KG ?? 0}
          </span>
        )}
      </button>
    );
  }
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/produksi/peta-warehouse.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi/peta-warehouse.tsx
git commit -m "feat: show remaining 10kg/5kg bag counts directly on warehouse pallet cells"
```

---

## Task 4: DB migration — `TanggalLabel`/`Shift` columns (controller-run)

**Files:**
- None (direct DDL execution, no repo files).

**Interfaces:**
- Produces: `DashboardProduksiBatch.TanggalLabel DATE NOT NULL`, `DashboardProduksiBatch.Shift TINYINT NOT NULL` — consumed by Task 5.

- [ ] **Step 1: Run the DDL**

Execute via the `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_execute_ddl` tool (controller-run, not delegated):

```sql
ALTER TABLE DashboardProduksiBatch ADD TanggalLabel DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE);
ALTER TABLE DashboardProduksiBatch ADD Shift TINYINT NOT NULL DEFAULT 1;
```

Expected: both statements succeed with no error. Existing rows backfill to today's date and Shift 1 via the `DEFAULT` clauses — acceptable since these are new descriptive fields with no prior data to preserve.

- [ ] **Step 2: Verify the columns exist**

Execute via `mcp__c27c2698-2904-45f3-b9f5-0e2f89f6238b__sql_get_table_info` (or `sql_execute_dql` with `SELECT TOP 1 TanggalLabel, Shift FROM DashboardProduksiBatch`).
Expected: both columns present, no error.

---

## Task 5: Query layer — `TanggalLabel`/`Shift` in types, `createBatch`, `getRiwayatProduksi`, `getWarehouseMap`

**Files:**
- Modify: `src/lib/queries/produksi-warehouse.ts` (entire file)

**Interfaces:**
- Consumes: `DashboardProduksiBatch.TanggalLabel`/`.Shift` columns from Task 4.
- Produces: `SHIFT_LABEL: Record<1 | 2 | 3, string>`, `PalletPosisiRow.TanggalLabel: Date | null` / `.Shift: 1 | 2 | 3 | null`, `RiwayatProduksiRow.TanggalLabel: Date` / `.Shift: 1 | 2 | 3`, `CreateBatchInput.tanggalLabel: string` / `.shift: 1 | 2 | 3` — all consumed by Task 6 (form) and Task 7 (display).

- [ ] **Step 1: Replace the whole file**

Replace `src/lib/queries/produksi-warehouse.ts` in full:

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export const SHIFT_LABEL: Record<1 | 2 | 3, string> = {
  1: "Shift 1 (07:00)",
  2: "Shift 2 (15:00)",
  3: "Shift 3 (23:00)",
};

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
}

export async function getWarehouseMap(): Promise<PalletPosisiRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.PosisiID, p.Kode, p.BatchIDAktif, m.Nama AS MesinNama, b.TanggalProduksi, b.SisaQty10KG, b.SisaQty5KG,
           b.TanggalLabel, b.Shift
    FROM DashboardProduksiPalletPosisi p
    LEFT JOIN DashboardProduksiBatch b ON b.BatchID = p.BatchIDAktif AND b.IsDeleted = 0
    LEFT JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
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
}

export async function getRiwayatProduksi(limit = 50): Promise<RiwayatProduksiRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) b.BatchID, p.Kode, m.Nama AS MesinNama, b.TanggalProduksi,
             b.Qty10KG, b.Qty5KG, b.SisaQty10KG, b.SisaQty5KG, b.DicatatOlehAkunID,
             b.TanggalLabel, b.Shift
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
      .query(`
        INSERT INTO DashboardProduksiBatch (MesinID, PosisiID, TanggalProduksi, Qty10KG, Qty5KG, SisaQty10KG, SisaQty5KG, DicatatOlehAkunID, TanggalLabel, Shift)
        OUTPUT INSERTED.BatchID
        VALUES (@mesinId, @posisiId, GETDATE(), @qty10, @qty5, @qty10, @qty5, @akunId, @tanggalLabel, @shift)
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

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: errors in `src/components/produksi-app/produksi-baru-form.tsx` (call to `createBatchAction` missing the now-required `tanggalLabel`/`shift` fields) — this is expected and fixed by Task 6. No errors anywhere else touching this file's exports.

Run: `npx eslint src/lib/queries/produksi-warehouse.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/produksi-warehouse.ts
git commit -m "feat: add TanggalLabel/Shift to DashboardProduksiBatch read/write path"
```

---

## Task 6: `ProduksiBaruForm` — Tanggal & Shift fields

**Files:**
- Modify: `src/components/produksi-app/produksi-baru-form.tsx` (entire file)

**Interfaces:**
- Consumes: `SHIFT_LABEL`, `CreateBatchInput` (Task 5); `getBusinessDateISO` (`src/lib/business-date.ts`, already exists, unmodified); `createBatchAction` (`src/app/mkesindo/produksi/actions.ts`, unmodified — its `Omit<CreateBatchInput, "dicatatOlehAkunId">` parameter type now requires `tanggalLabel`/`shift` automatically since `CreateBatchInput` grew those fields in Task 5).

- [ ] **Step 1: Replace the whole file**

Replace `src/components/produksi-app/produksi-baru-form.tsx` in full:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createBatchAction } from "@/app/mkesindo/produksi/actions";
import { getBusinessDateISO } from "@/lib/business-date";
import { SHIFT_LABEL } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

const SHIFT_OPTIONS = [1, 2, 3] as const;

export function ProduksiBaruForm({
  mesinList,
  posisi,
  onAfterSimpan,
}: {
  mesinList: MesinRow[];
  posisi: PalletPosisiRow[];
  onAfterSimpan: () => void;
}) {
  const [tanggalLabel, setTanggalLabel] = useState(() => getBusinessDateISO());
  const [shift, setShift] = useState<string>("1");
  const [mesinId, setMesinId] = useState<string>("");
  const [posisiId, setPosisiId] = useState<string>("");
  const [qty10, setQty10] = useState("");
  const [qty5, setQty5] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  const posisiKosong = posisi.filter((p) => p.BatchIDAktif == null);

  function handleSubmit() {
    setError(null);
    setSuccess(false);
    if (!tanggalLabel) {
      setError("Isi tanggal produksi.");
      return;
    }
    if (!shift) {
      setError("Pilih shift.");
      return;
    }
    if (!mesinId) {
      setError("Pilih mesin yang dipakai.");
      return;
    }
    if (!posisiId) {
      setError("Pilih posisi pallet.");
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
        posisiId: Number(posisiId),
        qty10KG: Number(qty10) || 0,
        qty5KG: Number(qty5) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      setQty10("");
      setQty5("");
      setPosisiId("");
      onAfterSimpan();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <Label>Tanggal Produksi</Label>
        <Input type="date" value={tanggalLabel} onChange={(e) => setTanggalLabel(e.target.value)} />
      </div>

      <div>
        <Label>Shift</Label>
        <Select value={shift} onValueChange={(v) => setShift(v ?? "1")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pilih shift">
              {(v: string) => SHIFT_LABEL[Number(v) as 1 | 2 | 3]}
            </SelectValue>
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
        <Label>Jumlah Kantong 10kg</Label>
        <Input type="number" value={qty10} onChange={(e) => setQty10(e.target.value)} />
      </div>
      <div>
        <Label>Jumlah Kantong 5kg</Label>
        <Input type="number" value={qty5} onChange={(e) => setQty5(e.target.value)} />
      </div>

      <div>
        <Label>Posisi Pallet Kosong</Label>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {posisiKosong.map((p) => (
            <button
              key={p.PosisiID}
              type="button"
              onClick={() => setPosisiId(String(p.PosisiID))}
              className={
                String(p.PosisiID) === posisiId
                  ? "rounded-md border-2 border-primary bg-primary/10 py-2 text-sm font-semibold"
                  : "rounded-md border border-border py-2 text-sm"
              }
            >
              {p.Kode}
            </button>
          ))}
        </div>
        {posisiKosong.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">Tidak ada posisi pallet kosong saat ini.</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-emerald-600">Produksi baru berhasil dicatat.</p>}
      <Button disabled={pending} onClick={handleSubmit}>
        {pending ? "Menyimpan..." : "Simpan"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors (the errors expected from Task 5's Step 2 are now resolved).

Run: `npx eslint src/components/produksi-app/produksi-baru-form.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/produksi-app/produksi-baru-form.tsx
git commit -m "feat: add Tanggal Produksi + Shift fields to Produksi Baru form"
```

---

## Task 7: Display `TanggalLabel`/`Shift` in Riwayat Produksi and Warehouse pallet detail

**Files:**
- Modify: `src/components/produksi/riwayat-produksi.tsx` (entire file)
- Modify: `src/components/produksi/peta-warehouse.tsx` (detail panel, the `{selected && (...)}` block near the end of the file)

**Interfaces:**
- Consumes: `RiwayatProduksiRowWithNama.TanggalLabel`/`.Shift` (flows through automatically from Task 5's `RiwayatProduksiRow`, since `RiwayatProduksiRowWithNama extends RiwayatProduksiRow` in `src/app/mkesindo/produksi/actions.ts` — no action-file change needed); `PalletPosisiRow.TanggalLabel`/`.Shift` (Task 5).

- [ ] **Step 1: Add a Tanggal & Shift column to Riwayat Produksi**

Replace `src/components/produksi/riwayat-produksi.tsx` in full:

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

- [ ] **Step 2: Add Tanggal & Shift to the Warehouse pallet detail panel**

In `src/components/produksi/peta-warehouse.tsx`, find the detail panel block near the end of the file:

```tsx
      {selected && (
        <div className="mt-4 rounded-md border border-border p-3 text-sm">
          <p className="font-semibold">Pallet {selected.Kode}</p>
          <p className="text-muted-foreground">Mesin: {selected.MesinNama ?? "-"}</p>
          <p className="text-muted-foreground">
            Sisa: {selected.SisaQty10KG ?? 0} kantong 10kg, {selected.SisaQty5KG ?? 0} kantong 5kg
          </p>
        </div>
      )}
```

Replace it with:

```tsx
      {selected && (
        <div className="mt-4 rounded-md border border-border p-3 text-sm">
          <p className="font-semibold">Pallet {selected.Kode}</p>
          <p className="text-muted-foreground">Mesin: {selected.MesinNama ?? "-"}</p>
          {selected.TanggalLabel != null && (
            <p className="text-muted-foreground">
              Tanggal &amp; Shift Produksi:{" "}
              {new Date(selected.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
              {" — Shift "}
              {selected.Shift}
            </p>
          )}
          <p className="text-muted-foreground">
            Sisa: {selected.SisaQty10KG ?? 0} kantong 10kg, {selected.SisaQty5KG ?? 0} kantong 5kg
          </p>
        </div>
      )}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/components/produksi/riwayat-produksi.tsx src/components/produksi/peta-warehouse.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/produksi/riwayat-produksi.tsx src/components/produksi/peta-warehouse.tsx
git commit -m "feat: display TanggalLabel/Shift in Riwayat Produksi and warehouse pallet detail"
```

---

## Task 8: Full verification pass

**Files:**
- None (verification only).

- [ ] **Step 1: Full typecheck and lint**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 2: Live browser check — Akses & Navigasi**

Using an account whose Peran does NOT have `is_produksi` but HAS been granted `canView` on the new "Produksi" module (via `/grup/akun/peran` → Peran Editor → tick "Lihat" on the Produksi row → Simpan Otoritas):
- Confirm "Produksi" now appears in the sidebar.
- Click it, confirm `/mkesindo/produksi` loads (Peta Warehouse, Mesin Produksi, Riwayat Produksi sections all render).

Using an `is_produksi` account:
- Log in, confirm landing page is `/mkesindo/produksi-app` (not `/mkesindo/produksi`).
- From the sidebar or by navigating directly, open `/mkesindo/produksi` — confirm it loads without redirect (the `isProduksi` bypass in `requireProduksiView()`), and confirm navigating back to any other `/mkesindo/*` dashboard route redirects back to `/mkesindo/produksi-app`.

Using an account with neither `is_produksi` nor the "Produksi" module permission granted:
- Confirm "Produksi" does NOT appear in the sidebar, and confirm navigating to `/mkesindo/produksi` directly redirects to `/akses-ditolak`.

- [ ] **Step 3: Live browser check — Tanggal di Kartu Pengiriman**

As an `is_produksi` account, open `/mkesindo/produksi-app` (Kartu Pengiriman tab). Confirm each card shows both a date (e.g. "11 Agu 2026") and a time, not time alone.

- [ ] **Step 4: Live browser check — Sisa Kantong per Pallet**

Open the Peta Warehouse on both `/mkesindo/produksi` (desktop) and `/mkesindo/produksi-app/warehouse` (mobile). Confirm any pallet cell with an active batch shows its remaining bag counts (e.g. "10·5") directly on the cell, without needing to click it. Confirm empty cells show no count. Click a filled cell and confirm the detail panel below still shows the full "kantong 10kg/5kg" breakdown as before.

- [ ] **Step 5: Live browser check — Tanggal & Shift Produksi Baru**

On `/mkesindo/produksi-app` → Produksi Baru tab:
- Confirm the Tanggal Produksi field defaults to today's business date (or tomorrow's, if tested after 14:00 WIB) and the Shift field defaults to "Shift 1 (07:00)".
- Change the date to a different day and the shift to "Shift 2", fill in mesin/posisi/qty, submit.
- Confirm success, then check Riwayat Produksi (`/mkesindo/produksi`) shows the new row with the chosen date and "Shift 2" in the new column, while the existing "Tanggal" column still shows the real submission timestamp (today's actual date/time, unaffected by the chosen Tanggal Produksi).
- Click the pallet just filled in Peta Warehouse and confirm the detail panel shows the same "Tanggal & Shift Produksi" line.
- Try submitting with the Tanggal Produksi field cleared — confirm the "Isi tanggal produksi." validation error appears and the request is not sent.

- [ ] **Step 6: Report results**

Summarize pass/fail for each check above. If any check fails, use systematic-debugging to find the root cause before patching — do not layer a fix on top of a guess.
