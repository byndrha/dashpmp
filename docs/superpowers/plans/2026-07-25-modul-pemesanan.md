# Modul Pemesanan (Sales Order) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff create a Sales Order directly from the dashboard — pick an existing Mitra, enter a quantity, get price/wilayah/kecamatan/address auto-detected, and schedule delivery (time + Armada + optional Driver) in one submit — plus a list view of all Sales Orders with a resolved scheduling status.

**Architecture:** A new `src/lib/queries/pemesanan.ts` orchestrates two already-shipped, independently-reviewed subsystems: SO creation (extended from `sales-order.ts`'s existing `createSalesOrderFromPengajuan` shape) and Draft scheduling (`pengiriman-jadwal.ts`'s existing `createJadwalDraft`/`updateJadwalDriverTime`). Submitting the new form creates a real `SalesOrder`+`SalesOrderDetail` plus a Draft `DashboardPengirimanJadwal` in one action — it does **not** create a real `DeliveryOrder` directly, preserving the existing mandatory route-validation gate (`startBerangkat`) as the only path from Draft to a real `DeliveryOrder`.

**Tech Stack:** Next.js Server Components + Server Actions, raw parameterized `mssql` queries, existing `src/components/ui` primitives (`Select`, `Dialog`, `Table`, `Badge`) and the existing `MitraSelect` combobox.

## Global Constraints

- No automated test suite exists in this codebase (no test runner in `package.json`, no `*.test.*`/`*.spec.*` files). Verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual browser checks via the Browser pane — every task substitutes these for the "write failing test" steps this skill's template normally shows.
- Every new `SalesOrder`/`SalesOrderDetail` write must reproduce the exact live-verified column shape `createSalesOrderFromPengajuan` (`src/lib/queries/sales-order.ts`) already uses — same placeholder values for unused columns (empty string, `0`, `1`), not `NULL`, except where explicitly noted otherwise in this plan.
- `SalesOrderDetail` has no `IsDeleted` column — only `SalesOrder.IsDeleted` is ever set; every read in this codebase already joins detail rows through a non-deleted `SalesOrder` header, so that alone is sufficient to hide a row.
- Two kantong variants exist as separate `Item` rows: `ItemID "019"` / `"Es Tube Jual"` (10KG) and `ItemID "0111"` / `"Es Tube Jual 5 KG"`. `SalesOrderDetail.Qty` is always the raw count of whichever variant was ordered — existing code elsewhere (`JADWAL_KANTONG_EXPR` in `pengiriman-jadwal.ts`) already halves 5KG-named rows for capacity bookkeeping; this plan must not duplicate that logic, only produce `Name`/`Qty` in the shape that logic already expects.
- Exclusive-upper-bound date filtering (`TransDate >= @start AND TransDate < @end`) is the codebase-wide convention — follow it for the new SO list query, and default it via the existing `resolveFilter` (`src/lib/date-range.ts`, current-calendar-month default) rather than an unbounded `IsClosed = 0` filter (the live `SalesOrder` table carries thousands of open rows back to 2018).
- Module access reuses the existing `requireModuleAccess(moduleKey)` / `MODULE_KEYS` permission system — no new auth mechanism.
- Reference: `docs/superpowers/specs/2026-07-25-modul-pemesanan-design.md` for the full approved design.

---

### Task 1: Generalize `getPriceLevelOptions` for both kantong variants

**Files:**
- Modify: `src/lib/queries/mitra.ts:159-180`

**Interfaces:**
- Produces: `getPriceLevelOptions(itemName?: string): Promise<PriceLevelOption[]>` — `itemName` defaults to `"Es Tube Jual"`, so all 4 existing call sites (`mitra-do.ts`, `mitra/page.tsx`, `pemasaran/page.tsx`, `sales-order.ts`) keep working unchanged.

- [ ] **Step 1: Replace the function in `src/lib/queries/mitra.ts`**

Replace lines 159-180 (the comment block + `getPriceLevelOptions` function) with:

```ts
// BusinessPartner.PriceLevel (1-8) selects which Item.UnitPriceN column
// applies to that mitra. There's no dedicated price-level lookup table, so
// this reads the nominal off a specific product Item — "Es Tube Jual" by
// default, but callers creating a 5KG-variant order (Pemesanan module) pass
// "Es Tube Jual 5 KG" instead, since that's a wholly separate Item row with
// its own UnitPriceN values.
export async function getPriceLevelOptions(itemName: string = "Es Tube Jual"): Promise<PriceLevelOption[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("itemName", sql.VarChar(150), itemName).query(`
      SELECT TOP 1 UnitPrice1, UnitPrice2, UnitPrice3, UnitPrice4, UnitPrice5, UnitPrice6, UnitPrice7, UnitPrice8
      FROM Item
      WHERE Name = @itemName AND ISNULL(IsDeleted, 0) = 0
    `);
  const row = result.recordset[0] as Record<string, number | null> | undefined;
  if (!row) return [];

  const levels: PriceLevelOption[] = [];
  for (let level = 1; level <= 8; level++) {
    const price = row[`UnitPrice${level}`];
    if (price != null && price > 0) levels.push({ Level: level, Price: price });
  }
  return levels;
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `mitra.ts`, `mitra-do.ts`, `sales-order.ts`, `mitra/page.tsx`, or `pemasaran/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/mitra.ts
git commit -m "Add itemName parameter to getPriceLevelOptions for kantong variants"
```

---

### Task 2: Manual Sales Order creation with variant + real mitra terms

**Files:**
- Modify: `src/lib/queries/sales-order.ts`

**Interfaces:**
- Consumes: `getPriceLevelOptions(itemName?: string)` from Task 1 (`@/lib/queries/mitra`).
- Produces: `KantongVariant` (`"10kg" | "5kg"`), `CreateSalesOrderManualInput { businessPartnerId: string; variant: KantongVariant; qtyKantong: number; deliveryDateTime: Date }`, `createSalesOrderManual(input: CreateSalesOrderManualInput): Promise<string>`, `softDeleteSalesOrder(salesOrderId: string): Promise<void>`.

- [ ] **Step 1: Append to `src/lib/queries/sales-order.ts`**

Add at the end of the file:

```ts
export type KantongVariant = "10kg" | "5kg";

const KANTONG_VARIANTS: Record<KantongVariant, { itemId: string; name: string; unit: string }> = {
  "10kg": { itemId: KANTONG_ITEM_ID, name: KANTONG_ITEM_NAME, unit: KANTONG_UNIT },
  "5kg": { itemId: "0111", name: "Es Tube Jual 5 KG", unit: KANTONG_UNIT },
};

export interface CreateSalesOrderManualInput {
  businessPartnerId: string;
  variant: KantongVariant;
  qtyKantong: number;
  deliveryDateTime: Date;
}

// Manual Sales Order creation for the Pemesanan module (mitra already
// exists, unlike createSalesOrderFromPengajuan which may run before a full
// mitra record does) — mirrors that function's live-verified SalesOrder/
// SalesOrderDetail shape exactly, except TermOfPaymentID/AddressInvoice
// come from the mitra's own BusinessPartner row (falling back to the same
// hardcoded default only when the mitra's own value is blank), and either
// kantong variant can be ordered. DueDate is set to the chosen delivery
// datetime, not a separately-entered due date — in this flow they're the
// same moment by construction.
export async function createSalesOrderManual(input: CreateSalesOrderManualInput): Promise<string> {
  if (input.qtyKantong <= 0) throw new Error("Qty pemesanan harus lebih dari 0.");

  const pool = await getPool();
  const variant = KANTONG_VARIANTS[input.variant];

  const bpResult = await pool
    .request()
    .input("bpId", sql.VarChar(16), input.businessPartnerId).query(`
      SELECT TermOfPaymentID, Address, PriceLevel FROM BusinessPartner
      WHERE BusinessPartnerID = @bpId AND ISNULL(IsDeleted, 0) = 0
    `);
  const bp = bpResult.recordset[0] as
    | { TermOfPaymentID: string | null; Address: string | null; PriceLevel: number | null }
    | undefined;
  if (!bp) throw new Error("Mitra tidak ditemukan.");
  if (bp.PriceLevel == null) throw new Error("Mitra belum punya Price Level — atur dulu di modul Mitra.");

  const priceLevels = await getPriceLevelOptions(variant.name);
  const price = priceLevels.find((p) => p.Level === bp.PriceLevel)?.Price ?? 0;
  const amount = input.qtyKantong * price;

  const termOfPaymentId = bp.TermOfPaymentID?.trim() ? bp.TermOfPaymentID : SO_TERM_OF_PAYMENT_ID;
  const addressInvoice = bp.Address?.slice(0, 128) ?? "";

  const salesOrderId = await nextSalesOrderId(pool);
  const salesOrderDetailId = await nextSalesOrderDetailId(pool);
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const voucherSeq = await nextVoucherSeq(pool, yearMonth);
  const voucherNo = `MKE/SO/${voucherSeq}/${yearMonth}/${SO_DOC_SUFFIX}`;

  await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderId)
    .input("voucherNo", sql.VarChar(128), voucherNo)
    .input("dueDate", sql.DateTime, input.deliveryDateTime)
    .input("branchId", sql.VarChar(16), SO_BRANCH_ID)
    .input("departmentId", sql.VarChar(16), SO_DEPARTMENT_ID)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("termOfPaymentId", sql.VarChar(16), termOfPaymentId)
    .input("addressInvoice", sql.VarChar(128), addressInvoice)
    .input("amount", sql.Decimal(23, 4), amount)
    .input("netto", sql.Decimal(23, 4), amount).query(`
      INSERT INTO SalesOrder
        (SalesOrderID, VoucherNo, ReferenceNo, TransDate, DueDate, BranchID, DepartmentID, BusinessPartnerID,
         TermOfPaymentID, AddressInvoice, AddressDelivery, AddressDeliveryID, CurrencyID, IsClosed, Notes,
         Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, IsInvoiced, IsDeleted, ModifiedDate, Rate,
         StatusForm, SalesmanID, ServiceTaxValue, ServiceTax, Visitor, PromotionID, Number, DiscRpBefore,
         ProjectID, BillOfQuantityID, NotesDelivery, DeliveryMemo, Status)
      VALUES
        (@id, @voucherNo, '', GETDATE(), @dueDate, @branchId, @departmentId, @bpId,
         @termOfPaymentId, @addressInvoice, '', '', '', 0, '',
         @amount, 0, 0, 0, 0, 0, @netto, 0, 0, GETDATE(), 1,
         1, '', 0, 0, 0, '', 1, 0,
         '', '', '', '', '')
    `);

  await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderDetailId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("itemId", sql.VarChar(150), variant.itemId)
    .input("name", sql.VarChar(150), variant.name)
    .input("qty", sql.Float, input.qtyKantong)
    .input("unit", sql.VarChar(16), variant.unit)
    .input("price", sql.Float, price)
    .input("amount", sql.Float, amount).query(`
      INSERT INTO SalesOrderDetail
        (SalesOrderDetailID, SalesOrderID, ItemID, Name, Qty, Unit, Price, Disc, DiscValue, DiscRp,
         Ratio, Amount, FlagClosed)
      VALUES
        (@id, @soId, @itemId, @name, @qty, @unit, @price, 0, 0, 0,
         1, @amount, '')
    `);

  return salesOrderId;
}

// Soft-deletes a SalesOrder — compensating cleanup for createPemesanan
// (pemesanan.ts) when the scheduling step after SO creation fails, matching
// createJadwalDraft's own cleanup discipline in pengiriman-jadwal.ts.
export async function softDeleteSalesOrder(salesOrderId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderId)
    .query(`UPDATE SalesOrder SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE SalesOrderID = @id`);
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `sales-order.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/sales-order.ts
git commit -m "Add createSalesOrderManual and softDeleteSalesOrder to sales-order.ts"
```

---

### Task 3: `pemesanan.ts` — orchestration + Sales Order list query

**Files:**
- Create: `src/lib/queries/pemesanan.ts`

**Interfaces:**
- Consumes: `createSalesOrderManual`, `softDeleteSalesOrder`, `type KantongVariant` from Task 2 (`@/lib/queries/sales-order`); `createJadwalDraft`, `updateJadwalDriverTime` (existing, `@/lib/queries/pengiriman-jadwal`).
- Produces: `CreatePemesananInput { businessPartnerId: string; variant: KantongVariant; qtyKantong: number; deliveryDateTime: Date; armadaId: number; salesmanId: string | null }`, `CreatePemesananResult { salesOrderId: string; jadwalId: number }`, `createPemesanan(input: CreatePemesananInput): Promise<CreatePemesananResult>`; `SalesOrderStatus` (`"Belum Dijadwalkan" | "Draft" | "Terbit"`), `SalesOrderListRow`, `SalesOrderListFilter { from: string; to: string; wilayah?: string }`, `getSalesOrderList(filter: SalesOrderListFilter): Promise<SalesOrderListRow[]>`.

- [ ] **Step 1: Write `src/lib/queries/pemesanan.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import { createSalesOrderManual, softDeleteSalesOrder, type KantongVariant } from "@/lib/queries/sales-order";
import { createJadwalDraft, updateJadwalDriverTime } from "@/lib/queries/pengiriman-jadwal";

export interface CreatePemesananInput {
  businessPartnerId: string;
  variant: KantongVariant;
  qtyKantong: number;
  deliveryDateTime: Date;
  armadaId: number;
  salesmanId: string | null;
}

export interface CreatePemesananResult {
  salesOrderId: string;
  jadwalId: number;
}

// Orchestrates the Pemesanan module's single-submit flow: create the real
// SalesOrder, then immediately schedule it as a Draft keberangkatan on the
// Papan Pengiriman board (createJadwalDraft already enforces Armada
// capacity). Deliberately stops at Draft, not a real DeliveryOrder — the
// existing route-validation gate in startBerangkat (pengiriman-jadwal.ts)
// stays the only path from Draft to Terbit, so this doesn't add a second,
// unvalidated way to create a real DeliveryOrder. If scheduling fails after
// the SO was already created, the SO is soft-deleted so it doesn't linger
// as an unscheduled orphan the user never asked for.
export async function createPemesanan(input: CreatePemesananInput): Promise<CreatePemesananResult> {
  const salesOrderId = await createSalesOrderManual({
    businessPartnerId: input.businessPartnerId,
    variant: input.variant,
    qtyKantong: input.qtyKantong,
    deliveryDateTime: input.deliveryDateTime,
  });

  try {
    const jadwalId = await createJadwalDraft({
      armadaId: input.armadaId,
      jamJadwal: input.deliveryDateTime,
      salesOrderIds: [salesOrderId],
    });

    if (input.salesmanId) {
      await updateJadwalDriverTime(jadwalId, {
        jamJadwal: input.deliveryDateTime,
        salesmanId: input.salesmanId,
      });
    }

    return { salesOrderId, jadwalId };
  } catch (err) {
    await softDeleteSalesOrder(salesOrderId);
    throw err;
  }
}

export type SalesOrderStatus = "Belum Dijadwalkan" | "Draft" | "Terbit";

export interface SalesOrderListRow {
  SalesOrderID: string;
  VoucherNo: string;
  TransDate: string | Date;
  DueDate: string | Date | null;
  CustomerName: string;
  Wilayah: string;
  Qty: number;
  Amount: number;
  Status: SalesOrderStatus;
}

export interface SalesOrderListFilter {
  from: string;
  to: string;
  wilayah?: string;
}

// Lists Sales Orders from every source (Pemesanan module, Pengajuan-approval
// auto-creation, manual desktop-ERP entry) with a resolved scheduling
// status — a linked, non-deleted DashboardPengirimanJadwal's own Status
// (Draft/Terbit) wins when one exists; otherwise a directly-linked
// DeliveryOrder (created outside the Jadwal flow) still counts as Terbit;
// anything else is not yet scheduled at all. TransDate-bounded (exclusive
// upper bound, same convention as the rest of the app) rather than an
// unbounded IsClosed=0 filter — SalesOrder carries years of open backlog
// (see the documented SO-availability-window finding) an unbounded query
// would flood this list with.
export async function getSalesOrderList(filter: SalesOrderListFilter): Promise<SalesOrderListRow[]> {
  const pool = await getPool();
  const request = pool.request().input("from", sql.Date, filter.from).input("to", sql.Date, filter.to);
  if (filter.wilayah) request.input("wilayah", sql.VarChar(128), filter.wilayah);

  const result = await request.query(`
    SELECT
        so.SalesOrderID,
        so.VoucherNo,
        so.TransDate,
        so.DueDate,
        bp.Name AS CustomerName,
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        ISNULL(sod.TotalQty, 0) AS Qty,
        ISNULL(sod.TotalAmount, 0) AS Amount,
        CASE
          WHEN j.Status IS NOT NULL THEN j.Status
          WHEN do_.DeliveryOrderID IS NOT NULL THEN 'Terbit'
          ELSE 'Belum Dijadwalkan'
        END AS Status
    FROM SalesOrder so
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN (
      SELECT SalesOrderID, SUM(Qty) AS TotalQty, SUM(Amount) AS TotalAmount
      FROM SalesOrderDetail
      GROUP BY SalesOrderID
    ) sod ON sod.SalesOrderID = so.SalesOrderID
    OUTER APPLY (
      SELECT TOP 1 jh.Status
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwal jh ON jh.JadwalID = jd.JadwalID AND jh.IsDeleted = 0
      WHERE jd.SalesOrderID = so.SalesOrderID AND jd.IsDeleted = 0
      ORDER BY jd.JadwalDetailID DESC
    ) j
    OUTER APPLY (
      SELECT TOP 1 do2.DeliveryOrderID
      FROM DeliveryOrder do2
      WHERE do2.SalesOrderID = so.SalesOrderID AND do2.IsDeleted = 0
    ) do_
    WHERE so.IsDeleted = 0
      AND so.TransDate >= @from AND so.TransDate < @to
      ${filter.wilayah ? "AND bp.NPWPName = @wilayah" : ""}
    ORDER BY so.TransDate DESC
  `);
  return result.recordset;
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `pemesanan.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/pemesanan.ts
git commit -m "Add pemesanan.ts: createPemesanan orchestration and getSalesOrderList"
```

---

### Task 4: Expose the module (permissions + sidebar)

**Files:**
- Modify: `src/lib/permissions.ts`
- Modify: `src/components/dashboard/app-sidebar.tsx`

**Interfaces:**
- Produces: `"pemesanan"` added to `ModuleKey`/`MODULE_KEYS`/`MODULE_LABEL`; a new sidebar nav entry.

- [ ] **Step 1: Edit `src/lib/permissions.ts`**

Change:

```ts
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "mitra", "pemasaran"] as const;
```

to:

```ts
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "pemesanan", "mitra", "pemasaran"] as const;
```

Change:

```ts
export const MODULE_LABEL: Record<ModuleKey, string> = {
  beranda: "Beranda",
  pnl: "Keuangan",
  aging: "Piutang",
  sales: "Penjualan",
  transaksi: "Transaksi",
  electricity: "Biaya Listrik",
  delivery: "Pengiriman",
  mitra: "Mitra",
  pemasaran: "Pemasaran",
};
```

to:

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
};
```

- [ ] **Step 2: Edit `src/components/dashboard/app-sidebar.tsx`**

Change the lucide-react import:

```ts
import {
  LayoutGrid,
  LineChart,
  Receipt,
  ShoppingCart,
  ArrowLeftRight,
  Zap,
  Truck,
  Users,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
```

to:

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
  ShieldCheck,
} from "lucide-react";
```

Change:

```ts
  { href: "/delivery", label: "Pengiriman", icon: Truck, moduleKey: "delivery" },
  { href: "/mitra", label: "Mitra", icon: Users, moduleKey: "mitra" },
```

to:

```ts
  { href: "/delivery", label: "Pengiriman", icon: Truck, moduleKey: "delivery" },
  { href: "/pemesanan", label: "Pemesanan", icon: ClipboardList, moduleKey: "pemesanan" },
  { href: "/mitra", label: "Mitra", icon: Users, moduleKey: "mitra" },
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `permissions.ts` or `app-sidebar.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permissions.ts src/components/dashboard/app-sidebar.tsx
git commit -m "Add pemesanan module key and sidebar entry"
```

---

### Task 5: Server actions

**Files:**
- Create: `src/app/(dashboard)/pemesanan/actions.ts`

**Interfaces:**
- Consumes: `createPemesanan`, `type CreatePemesananInput`, `type CreatePemesananResult` from Task 3 (`@/lib/queries/pemesanan`).
- Produces: `createPemesananAction(input: CreatePemesananInput): Promise<CreatePemesananResult>`.

- [ ] **Step 1: Write `src/app/(dashboard)/pemesanan/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createPemesanan, type CreatePemesananInput, type CreatePemesananResult } from "@/lib/queries/pemesanan";

export async function createPemesananAction(input: CreatePemesananInput): Promise<CreatePemesananResult> {
  const result = await createPemesanan(input);
  revalidatePath("/pemesanan");
  revalidatePath("/delivery");
  return result;
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/pemesanan/actions.ts"
git commit -m "Add Pemesanan server action"
```

---

### Task 6: "Buat Pemesanan" form dialog

**Files:**
- Create: `src/components/dashboard/pemesanan-form-dialog.tsx`

**Interfaces:**
- Consumes: `createPemesananAction` from Task 5 (`@/app/(dashboard)/pemesanan/actions`); `type MitraRow`, `type PriceLevelOption` (existing, `@/lib/queries/mitra`); `type ArmadaRow` (existing, `@/lib/queries/armada`); `type DriverOption` (existing, `@/lib/queries/delivery`); `type KantongVariant` from Task 2 (`@/lib/queries/sales-order`); `MitraSelect` (existing, `@/components/dashboard/mitra-select`).
- Produces: `PemesananFormDialog({ mitraList, armadaList, drivers, priceLevels10kg, priceLevels5kg }: { mitraList: MitraRow[]; armadaList: ArmadaRow[]; drivers: DriverOption[]; priceLevels10kg: PriceLevelOption[]; priceLevels5kg: PriceLevelOption[] })` — self-contained, own "Buat Pemesanan" trigger button + dialog open state (same pattern as `ArmadaManager` in `armada-dialog.tsx`).

- [ ] **Step 1: Write `src/components/dashboard/pemesanan-form-dialog.tsx`**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MitraSelect } from "@/components/dashboard/mitra-select";
import { formatRupiah } from "@/lib/format";
import type { MitraRow, PriceLevelOption } from "@/lib/queries/mitra";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { DriverOption } from "@/lib/queries/delivery";
import type { KantongVariant } from "@/lib/queries/sales-order";
import { createPemesananAction } from "@/app/(dashboard)/pemesanan/actions";

// Sentinel for "not chosen yet" — Select items can't use an empty string as
// a value (established convention, see the "all" sentinel in
// mitra-list.tsx's filter Selects / delivery-assignment-panel.tsx's UNSET).
const UNSET = "__unset__";

export function PemesananFormDialog({
  mitraList,
  armadaList,
  drivers,
  priceLevels10kg,
  priceLevels5kg,
}: {
  mitraList: MitraRow[];
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
  priceLevels10kg: PriceLevelOption[];
  priceLevels5kg: PriceLevelOption[];
}) {
  const [open, setOpen] = useState(false);
  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [variant, setVariant] = useState<KantongVariant>("10kg");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [armadaId, setArmadaId] = useState<string>(UNSET);
  const [salesmanId, setSalesmanId] = useState<string>(UNSET);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const mitra = useMemo(
    () => mitraList.find((m) => m.BusinessPartnerID === businessPartnerId) ?? null,
    [mitraList, businessPartnerId]
  );
  const mitraOptions = useMemo(
    () =>
      mitraList.map((m) => ({
        BusinessPartnerID: m.BusinessPartnerID,
        Name: m.Name,
        Wilayah: m.Wilayah ?? "Tidak Diketahui",
      })),
    [mitraList]
  );
  const priceLevels = variant === "10kg" ? priceLevels10kg : priceLevels5kg;
  const price = mitra?.PriceLevel != null ? (priceLevels.find((p) => p.Level === mitra.PriceLevel)?.Price ?? null) : null;
  const qtyNumber = Number(qty);
  const total = price != null && qtyNumber > 0 ? price * qtyNumber : 0;
  const canSubmit = !!mitra && mitra.PriceLevel != null && qtyNumber > 0 && !!date && armadaId !== UNSET;

  function resetForm() {
    setBusinessPartnerId("");
    setVariant("10kg");
    setQty("");
    setDate("");
    setTime("08:00");
    setArmadaId(UNSET);
    setSalesmanId(UNSET);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function handleSubmit() {
    if (!canSubmit || !mitra) return;
    setError(null);
    startTransition(async () => {
      try {
        await createPemesananAction({
          businessPartnerId: mitra.BusinessPartnerID,
          variant,
          qtyKantong: qtyNumber,
          deliveryDateTime: new Date(`${date}T${time}:00`),
          armadaId: Number(armadaId),
          salesmanId: salesmanId === UNSET ? null : salesmanId,
        });
        handleOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal membuat pemesanan.");
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Buat Pemesanan
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Pemesanan</DialogTitle>
            <DialogDescription>
              Pilih mitra, isi jumlah pesanan, lalu jadwalkan pengirimannya. Pesanan langsung tampil sebagai Draft di
              Papan Pengiriman.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="sr-only">Mitra</Label>
              <MitraSelect options={mitraOptions} value={businessPartnerId} onChange={setBusinessPartnerId} />
            </div>

            {mitra && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Wilayah</p>
                  <p className="font-medium">{mitra.Wilayah ?? "Tidak Diketahui"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Kecamatan</p>
                  <p className="font-medium">{mitra.Kecamatan ?? "-"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">Alamat</p>
                  <p className="font-medium">{mitra.Alamat ?? "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Termin Pembayaran</p>
                  <p className="font-medium">{mitra.TermOfPaymentName ?? "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Price Level</p>
                  <p className="font-medium">{mitra.PriceLevel != null ? `Level ${mitra.PriceLevel}` : "Belum diatur"}</p>
                </div>
              </div>
            )}

            {mitra && mitra.PriceLevel == null && (
              <p className="text-xs text-destructive">
                Mitra ini belum punya Price Level — atur dulu di modul Mitra sebelum bisa dipesankan.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label className="sr-only">Varian Kantong</Label>
                <Select value={variant} onValueChange={(v) => setVariant((v as KantongVariant) ?? "10kg")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => (v === "5kg" ? "5 KG" : "10 KG")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10kg">10 KG</SelectItem>
                    <SelectItem value="5kg">5 KG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qty" className="sr-only">
                  Qty (kantong)
                </Label>
                <Input
                  id="qty"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Qty (kantong)"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
            </div>

            {price != null && (
              <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span className="text-muted-foreground">{formatRupiah(price)} / kantong</span>
                <span className="font-semibold">Total {formatRupiah(total)}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tanggal" className="sr-only">
                  Tanggal Kirim
                </Label>
                <Input id="tanggal" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jam" className="sr-only">
                  Jam
                </Label>
                <Input id="jam" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label className="sr-only">Armada</Label>
                <Select value={armadaId} onValueChange={(v) => setArmadaId(v ?? UNSET)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih armada">
                      {(v: string) =>
                        v === UNSET ? "Pilih armada" : (armadaList.find((a) => String(a.ArmadaID) === v)?.Nama ?? "Pilih armada")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {armadaList.map((a) => (
                      <SelectItem key={a.ArmadaID} value={String(a.ArmadaID)} disabled={a.Status !== "Baik"}>
                        {a.Nama} {a.Status !== "Baik" && `(${a.Status})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="sr-only">Driver</Label>
                <Select value={salesmanId} onValueChange={(v) => setSalesmanId(v ?? UNSET)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Belum ditentukan">
                      {(v: string) =>
                        v === UNSET ? "Belum ditentukan" : (drivers.find((d) => d.SalesmanID === v)?.Name ?? "Belum ditentukan")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Belum ditentukan</SelectItem>
                    {drivers.map((d) => (
                      <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                        {d.Name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button disabled={!canSubmit || pending} onClick={handleSubmit}>
              {pending ? "Menyimpan..." : "Buat Pemesanan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `pemesanan-form-dialog.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pemesanan-form-dialog.tsx
git commit -m "Add Buat Pemesanan form dialog"
```

---

### Task 7: Sales Order list table

**Files:**
- Create: `src/components/dashboard/pemesanan-list.tsx`

**Interfaces:**
- Consumes: `type SalesOrderListRow`, `type SalesOrderStatus` from Task 3 (`@/lib/queries/pemesanan`).
- Produces: `PemesananList({ rows: SalesOrderListRow[] })`.

- [ ] **Step 1: Write `src/components/dashboard/pemesanan-list.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatRupiah } from "@/lib/format";
import type { SalesOrderListRow, SalesOrderStatus } from "@/lib/queries/pemesanan";

const STATUS_VARIANT: Record<SalesOrderStatus, "outline" | "secondary" | "default"> = {
  "Belum Dijadwalkan": "outline",
  Draft: "secondary",
  Terbit: "default",
};

export function PemesananList({ rows }: { rows: SalesOrderListRow[] }) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>No. Voucher</TableHead>
            <TableHead>Tanggal</TableHead>
            <TableHead>Mitra</TableHead>
            <TableHead>Wilayah</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Jatuh Tempo</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.SalesOrderID}>
              <TableCell className="font-medium">{r.VoucherNo}</TableCell>
              <TableCell>{formatDate(r.TransDate)}</TableCell>
              <TableCell>{r.CustomerName}</TableCell>
              <TableCell>{r.Wilayah}</TableCell>
              <TableCell className="text-right tabular-nums">{r.Qty}</TableCell>
              <TableCell className="text-right tabular-nums">{formatRupiah(r.Amount)}</TableCell>
              <TableCell>{r.DueDate ? formatDate(r.DueDate) : "-"}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.Status]}>{r.Status}</Badge>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                Tidak ada Sales Order pada rentang ini.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `pemesanan-list.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pemesanan-list.tsx
git commit -m "Add Pemesanan Sales Order list table"
```

---

### Task 8: `/pemesanan` page

**Files:**
- Create: `src/app/(dashboard)/pemesanan/page.tsx`

**Interfaces:**
- Consumes: `getSalesOrderList` from Task 3 (`@/lib/queries/pemesanan`); `PemesananFormDialog` from Task 6; `PemesananList` from Task 7; `getMitraList`, `getPriceLevelOptions` (existing, `@/lib/queries/mitra`); `getArmadaList` (existing, `@/lib/queries/armada`); `getDriverOptions` (existing, `@/lib/queries/delivery`); `getWilayahList` (existing, `@/lib/queries/wilayah`); `resolveFilter`, `type DashboardSearchParams` (existing, `@/lib/date-range`); `requireModuleAccess` (existing, `@/lib/require-access`); `FilterBar` (existing, `@/components/dashboard/filter-bar`).

- [ ] **Step 1: Write `src/app/(dashboard)/pemesanan/page.tsx`**

```tsx
import { requireModuleAccess } from "@/lib/require-access";
import { getSalesOrderList } from "@/lib/queries/pemesanan";
import { getMitraList, getPriceLevelOptions } from "@/lib/queries/mitra";
import { getArmadaList } from "@/lib/queries/armada";
import { getDriverOptions } from "@/lib/queries/delivery";
import { getWilayahList } from "@/lib/queries/wilayah";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { PemesananFormDialog } from "@/components/dashboard/pemesanan-form-dialog";
import { PemesananList } from "@/components/dashboard/pemesanan-list";

export default async function PemesananPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  await requireModuleAccess("pemesanan");
  const params = await searchParams;
  const filter = resolveFilter(params);

  const [rows, mitraList, armadaList, drivers, priceLevels10kg, priceLevels5kg, wilayahList] = await Promise.all([
    getSalesOrderList({ from: filter.startDate, to: filter.endDate, wilayah: filter.wilayah }),
    getMitraList(),
    getArmadaList(),
    getDriverOptions(),
    getPriceLevelOptions("Es Tube Jual"),
    getPriceLevelOptions("Es Tube Jual 5 KG"),
    getWilayahList(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pemesanan</h1>
        <FilterBar wilayahList={wilayahList} />
      </div>

      <div className="flex justify-end">
        <PemesananFormDialog
          mitraList={mitraList}
          armadaList={armadaList}
          drivers={drivers}
          priceLevels10kg={priceLevels10kg}
          priceLevels5kg={priceLevels5kg}
        />
      </div>

      <PemesananList rows={rows} />
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/pemesanan/page.tsx"
git commit -m "Add /pemesanan page"
```

---

### Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 0 TypeScript errors, 0 lint errors, build succeeds (in particular: no server-only module — `mssql`/`tedious` — leaking into the client bundle via any of the new `"use client"` files; this exact bug class hit `armada-dialog.tsx` in a prior plan, see `pemesanan-form-dialog.tsx`'s imports carefully — it must only import `type`s from query files, never a runtime value).

- [ ] **Step 2: Manual browser walkthrough — permissions & navigation**

Log in as Super Admin, confirm:
- Sidebar shows "Pemesanan" between "Pengiriman" and "Mitra".
- `/akun/peran` (Peran editor) lists "Pemesanan" as a togglable module row.
- Navigating to `/pemesanan` loads without error.

- [ ] **Step 3: Manual browser walkthrough — create a Pemesanan**

On `/pemesanan`, click "Buat Pemesanan":
- Search and pick a real Mitra with a `PriceLevel` already set — confirm Wilayah/Kecamatan/Alamat/Termin Pembayaran/Price Level auto-fill correctly and match that mitra's data on `/mitra`.
- Enter Qty, confirm the Harga/kantong and Total shown match `PriceLevel`'s price × qty.
- Pick a delivery date/time, an Armada (confirm any non-"Baik" Armada is shown disabled), and a Driver.
- Submit — confirm the dialog closes, no error shown, and the new SO appears at the top of the list below with Status "Draft".
- Navigate to `/delivery`, Papan Pengiriman tab — confirm the same departure appears as a Draft card on the correct Armada's row at the chosen time, with the chosen Driver already assigned (open its detail dialog to confirm the SO shows up as a stop with the correct Mitra/Qty).

- [ ] **Step 4: Manual browser walkthrough — guard rails**

- Pick a Mitra with no `PriceLevel` set (or temporarily clear one via `/mitra` and restore it after) — confirm the dialog shows the "belum punya Price Level" warning and the submit button stays disabled.
- Confirm the submit button stays disabled until Mitra, Qty > 0, Tanggal, and Armada are all filled in.

- [ ] **Step 5: Regression spot-check**

Confirm `/delivery` (both tabs), `/mitra`, and `/pemasaran` still load and render normally — these all call `getPriceLevelOptions()` with no argument and must be unaffected by Task 1's new optional parameter.

- [ ] **Step 6: Record progress**

Append a summary of this plan's completion (task-by-task, any findings) to `.superpowers/sdd/progress.md`, following the same format as the prior plan entries in that file.
