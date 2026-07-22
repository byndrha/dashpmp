# Modul Armada & Driver (fondasi Pengiriman) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff assign a vehicle (Armada) and driver to each Delivery Order, and surface that assignment in the dashboard — building on the ERP's existing `Salesman` table for Driver identity and a new `DashboardArmada` table for vehicle master data.

**Architecture:** Two new backend query modules (`armada.ts` CRUD, extensions to `delivery.ts`), a restructure of the existing `/delivery` page into two tabs (existing open-deliveries report + new date-based assignment panel), all writes going through `"use server"` actions that call `revalidatePath("/delivery")`.

**Tech Stack:** Next.js Server Components + Server Actions, raw parameterized `mssql` queries, Base UI-backed `Select`/`Dialog`/`Tabs` from `src/components/ui`.

## Global Constraints

- No automated test suite exists in this codebase (verified: no test runner in `package.json`, no `*.test.*`/`*.spec.*` files). Verification is `npx tsc --noEmit`, `npm run lint`, and manual browser checks via the Browser pane — every task substitutes these for the "write failing test" steps this skill's template normally shows.
- Driver identity comes from the ERP `Salesman` table only. `SalesmanID = "0127"` ("Ambil Sendiri"/TakeAway — see `PARTNER_TYPE_CASE` in `src/lib/queries/aging.ts`) must never appear in the assignable driver list.
- `DashboardArmada` has exactly one user-facing field: `Nama` (e.g. "GrandMax 1972"). No Jenis Kendaraan, Plat Nomor, or Kapasitas.
- All writes to `DeliveryOrder` are single-column `UPDATE ... WHERE DeliveryOrderID = @id` — never `INSERT`.
- The existing `/delivery` page's open-deliveries report (`getOpenDeliveries()`) is preserved byte-for-byte in behavior, just moved into its own tab.
- The assignment tab's date navigation (prev/next, date input, `useTransition`-driven loading bar) copies the exact pattern already built in `src/components/dashboard/piutang-payments-panel.tsx`, including the `.animate-indeterminate` utility already in `src/app/globals.css`.
- Module access reuses `requireModuleAccess("delivery")` — no new permission scope.
- Exclusive-upper-bound date filtering (`TransDate >= @start AND TransDate < @end`) is the codebase-wide convention (see `business-date.ts` callers throughout) — follow it for the assignment date query.

---

### Task 0: Create the `DashboardArmada` table (controller-run, not delegated)

This is DDL against the live database — run directly by whoever is executing this plan (not dispatched to a subagent, since subagents don't have database DDL access). Do this before starting Task 1.

- [ ] **Step 1: Run this DDL against the database**

```sql
CREATE TABLE DashboardArmada (
  ArmadaID INT IDENTITY(1,1) PRIMARY KEY,
  Nama VARCHAR(128) NOT NULL,
  IsDeleted BIT NOT NULL DEFAULT 0,
  ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()
);
```

- [ ] **Step 2: Verify the table exists with the right shape**

Query `INFORMATION_SCHEMA.COLUMNS` for `DashboardArmada` (or equivalent table-info tool) and confirm the four columns above with `ArmadaID` as an IDENTITY primary key.

---

### Task 1: `DashboardArmada` query module

**Files:**
- Create: `src/lib/queries/armada.ts`

**Interfaces:**
- Produces: `ArmadaRow { ArmadaID: number; Nama: string }`, `getArmadaList(): Promise<ArmadaRow[]>`, `createArmada(nama: string): Promise<number>`, `updateArmada(id: number, nama: string): Promise<void>`, `deleteArmada(id: number): Promise<void>`.

- [ ] **Step 1: Write `src/lib/queries/armada.ts`**

```ts
import { getPool, sql } from "@/lib/db";

export interface ArmadaRow {
  ArmadaID: number;
  Nama: string;
}

export async function getArmadaList(): Promise<ArmadaRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ArmadaID, Nama
    FROM DashboardArmada
    WHERE IsDeleted = 0
    ORDER BY Nama
  `);
  return result.recordset;
}

export async function createArmada(nama: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("nama", sql.VarChar(128), nama).query(`
      INSERT INTO DashboardArmada (Nama, IsDeleted, ModifiedDate)
      OUTPUT inserted.ArmadaID
      VALUES (@nama, 0, GETDATE())
    `);
  return (result.recordset[0] as { ArmadaID: number }).ArmadaID;
}

export async function updateArmada(id: number, nama: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("nama", sql.VarChar(128), nama)
    .query(`UPDATE DashboardArmada SET Nama = @nama, ModifiedDate = GETDATE() WHERE ArmadaID = @id`);
}

export async function deleteArmada(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE DashboardArmada SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE ArmadaID = @id`);
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `armada.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/armada.ts
git commit -m "Add DashboardArmada query module"
```

---

### Task 2: Armada management UI + actions

**Files:**
- Create: `src/app/(dashboard)/delivery/actions.ts`
- Create: `src/components/dashboard/armada-dialog.tsx`

**Interfaces:**
- Consumes: `getArmadaList`, `createArmada`, `updateArmada`, `deleteArmada`, `ArmadaRow` from Task 1 (`@/lib/queries/armada`).
- Produces: `createArmadaAction(nama: string): Promise<number>`, `updateArmadaAction(id: number, nama: string): Promise<void>`, `deleteArmadaAction(id: number): Promise<void>` (all in `@/app/(dashboard)/delivery/actions`); `ArmadaManager({ armada: ArmadaRow[] })` component (in `@/components/dashboard/armada-dialog`) — a single "Kelola Armada" button that opens a dialog listing/adding/editing/deleting armada.

- [ ] **Step 1: Write `src/app/(dashboard)/delivery/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createArmada, updateArmada, deleteArmada } from "@/lib/queries/armada";

export async function createArmadaAction(nama: string): Promise<number> {
  const id = await createArmada(nama);
  revalidatePath("/delivery");
  return id;
}

export async function updateArmadaAction(id: number, nama: string): Promise<void> {
  await updateArmada(id, nama);
  revalidatePath("/delivery");
}

export async function deleteArmadaAction(id: number): Promise<void> {
  await deleteArmada(id);
  revalidatePath("/delivery");
}
```

- [ ] **Step 2: Write `src/components/dashboard/armada-dialog.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ArmadaRow } from "@/lib/queries/armada";
import { createArmadaAction, updateArmadaAction, deleteArmadaAction } from "@/app/(dashboard)/delivery/actions";

// One dialog holding both the list and inline add/edit rows (no nested
// Dialog-inside-Dialog) — Armada only has a single field, so a full
// separate form dialog per action would be more chrome than the data
// warrants.
export function ArmadaManager({ armada }: { armada: ArmadaRow[] }) {
  const [open, setOpen] = useState(false);
  const [newNama, setNewNama] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNama, setEditingNama] = useState("");
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    const nama = newNama.trim();
    if (!nama) return;
    startTransition(async () => {
      await createArmadaAction(nama);
      setNewNama("");
    });
  }

  function startEdit(row: ArmadaRow) {
    setEditingId(row.ArmadaID);
    setEditingNama(row.Nama);
  }

  function handleUpdate() {
    const nama = editingNama.trim();
    if (!nama || editingId == null) return;
    startTransition(async () => {
      await updateArmadaAction(editingId, nama);
      setEditingId(null);
    });
  }

  function handleDelete(row: ArmadaRow) {
    if (!confirm(`Hapus armada "${row.Nama}"?`)) return;
    startTransition(async () => {
      await deleteArmadaAction(row.ArmadaID);
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Kelola Armada
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kelola Armada</DialogTitle>
            <DialogDescription>Daftar kendaraan yang bisa dipilih saat menugaskan pengiriman.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                placeholder="Nama Kendaraan (mis. GrandMax 1972)"
                value={newNama}
                onChange={(e) => setNewNama(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <Button size="icon" className="shrink-0" disabled={pending || !newNama.trim()} onClick={handleCreate}>
                <Plus className="size-4" />
              </Button>
            </div>
            <div className="flex flex-col divide-y rounded-lg border">
              {armada.map((a) => (
                <div key={a.ArmadaID} className="flex items-center justify-between gap-2 px-3 py-2">
                  {editingId === a.ArmadaID ? (
                    <>
                      <Input
                        value={editingNama}
                        onChange={(e) => setEditingNama(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                        className="h-8"
                        autoFocus
                      />
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={handleUpdate}>
                          <Check className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditingId(null)}>
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-sm">{a.Nama}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => startEdit(a)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => handleDelete(a)}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {armada.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Belum ada armada.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `actions.ts` or `armada-dialog.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/delivery/actions.ts" src/components/dashboard/armada-dialog.tsx
git commit -m "Add Armada management UI (Kelola Armada dialog)"
```

---

### Task 3: Driver options + delivery assignment queries

**Files:**
- Modify: `src/lib/queries/delivery.ts`

**Interfaces:**
- Produces: `DriverOption { SalesmanID: string; Name: string }`, `getDriverOptions(): Promise<DriverOption[]>`; `DeliveryAssignmentRow { DeliveryOrderID: string; VoucherNo: string; TransDate: string | Date; Wilayah: string; CustomerName: string; SalesmanID: string | null; DriverName: string | null; VehicleNo: string | null }`, `getDeliveryAssignments(businessDate: Date): Promise<DeliveryAssignmentRow[]>`, `assignDeliveryDriver(deliveryOrderId: string, salesmanId: string | null): Promise<void>`, `assignDeliveryVehicle(deliveryOrderId: string, vehicleName: string | null): Promise<void>`.

- [ ] **Step 1: Append to `src/lib/queries/delivery.ts`**

Add after the existing `getOpenDeliveries` function (keep everything already in the file unchanged):

```ts
export interface DriverOption {
  SalesmanID: string;
  Name: string;
}

// Excludes '0127' ("Ambil Sendiri"/TakeAway, see PARTNER_TYPE_CASE in
// aging.ts) — not a real driver, so it must never show up as an
// assignable option.
export async function getDriverOptions(): Promise<DriverOption[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT SalesmanID, Name
    FROM Salesman
    WHERE ISNULL(IsDeleted, 0) = 0
      AND SalesmanID <> '0127'
    ORDER BY Name
  `);
  return result.recordset;
}

export interface DeliveryAssignmentRow {
  DeliveryOrderID: string;
  VoucherNo: string;
  // mssql returns DATETIME columns as real Date instances, which survive
  // Server->Client Component serialization as Date (not auto-stringified) —
  // this is only ever a plain string after a JSON round-trip, never
  // straight off this query's recordset. Format with formatTime()/
  // formatDate() (both already accept `string | Date`), never `.slice(...)`.
  TransDate: string | Date;
  Wilayah: string;
  CustomerName: string;
  SalesmanID: string | null;
  DriverName: string | null;
  VehicleNo: string | null;
}

// One row per DeliveryOrder (not per detail line, unlike getOpenDeliveries)
// for the given business date — this is what the assignment panel lists.
export async function getDeliveryAssignments(businessDate: Date): Promise<DeliveryAssignmentRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate).query(`
      SELECT
          do.DeliveryOrderID,
          do.VoucherNo,
          do.TransDate,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          bp.Name AS CustomerName,
          do.SalesmanID,
          sm.Name AS DriverName,
          NULLIF(do.VehicleNo, '') AS VehicleNo
      FROM DeliveryOrder do
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do.BusinessPartnerID
      LEFT JOIN Salesman sm ON sm.SalesmanID = do.SalesmanID
      WHERE do.IsDeleted = 0
        AND do.TransDate >= @businessDate AND do.TransDate < DATEADD(DAY, 1, @businessDate)
      ORDER BY do.TransDate DESC
    `);
  return result.recordset;
}

export async function assignDeliveryDriver(deliveryOrderId: string, salesmanId: string | null): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), deliveryOrderId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .query(`UPDATE DeliveryOrder SET SalesmanID = @salesmanId WHERE DeliveryOrderID = @id`);
}

export async function assignDeliveryVehicle(deliveryOrderId: string, vehicleName: string | null): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), deliveryOrderId)
    .input("vehicleName", sql.VarChar(50), vehicleName)
    .query(`UPDATE DeliveryOrder SET VehicleNo = @vehicleName WHERE DeliveryOrderID = @id`);
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `delivery.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/delivery.ts
git commit -m "Add driver options and delivery assignment queries"
```

---

### Task 4: Delivery assignment panel UI + actions

**Files:**
- Modify: `src/app/(dashboard)/delivery/actions.ts` (append)
- Create: `src/components/dashboard/delivery-assignment-panel.tsx`

**Interfaces:**
- Consumes: `ArmadaManager` from Task 2 (`@/components/dashboard/armada-dialog`); `DeliveryAssignmentRow`, `DriverOption`, `assignDeliveryDriver`, `assignDeliveryVehicle` from Task 3 (`@/lib/queries/delivery`); `ArmadaRow` from Task 1 (`@/lib/queries/armada`).
- Produces: `assignDeliveryDriverAction(deliveryOrderId: string, salesmanId: string | null): Promise<void>`, `assignDeliveryVehicleAction(deliveryOrderId: string, vehicleName: string | null): Promise<void>` (in `@/app/(dashboard)/delivery/actions`); `DeliveryAssignmentPanel({ rows, drivers, armada, businessDate, todayISO })` component (in `@/components/dashboard/delivery-assignment-panel`).

- [ ] **Step 1: Append to `src/app/(dashboard)/delivery/actions.ts`**

Add these imports to the top (merge with the existing `import { createArmada, ... }` line's neighbors) and functions at the bottom:

```ts
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";
```

```ts
export async function assignDeliveryDriverAction(deliveryOrderId: string, salesmanId: string | null): Promise<void> {
  await assignDeliveryDriver(deliveryOrderId, salesmanId);
  revalidatePath("/delivery");
}

export async function assignDeliveryVehicleAction(deliveryOrderId: string, vehicleName: string | null): Promise<void> {
  await assignDeliveryVehicle(deliveryOrderId, vehicleName);
  revalidatePath("/delivery");
}
```

- [ ] **Step 2: Write `src/components/dashboard/delivery-assignment-panel.tsx`**

```tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArmadaManager } from "@/components/dashboard/armada-dialog";
import { formatDate, formatTime } from "@/lib/format";
import type { DeliveryAssignmentRow, DriverOption } from "@/lib/queries/delivery";
import type { ArmadaRow } from "@/lib/queries/armada";
import { assignDeliveryDriverAction, assignDeliveryVehicleAction } from "@/app/(dashboard)/delivery/actions";

// Sentinel for "no driver/vehicle assigned yet" — Select items can't use an
// empty string as a value (established convention in this codebase, see
// the "all" sentinel in mitra-list.tsx's filter Selects).
const UNSET = "__unset__";

function AssignmentRowCard({
  row,
  drivers,
  armada,
}: {
  row: DeliveryAssignmentRow;
  drivers: DriverOption[];
  armada: ArmadaRow[];
}) {
  const [, startTransition] = useTransition();

  // If the current SalesmanID isn't in the assignable list (e.g. it's the
  // '0127' TakeAway sentinel, deliberately excluded from `drivers`), fall
  // back to showing "Belum ditugaskan" rather than a broken/empty Select.
  const driverValue = row.SalesmanID && drivers.some((d) => d.SalesmanID === row.SalesmanID) ? row.SalesmanID : UNSET;
  const vehicleValue = row.VehicleNo ?? UNSET;

  function handleDriverChange(value: string | null) {
    const salesmanId = !value || value === UNSET ? null : value;
    startTransition(async () => {
      await assignDeliveryDriverAction(row.DeliveryOrderID, salesmanId);
    });
  }

  function handleVehicleChange(value: string | null) {
    const vehicleName = !value || value === UNSET ? null : value;
    startTransition(async () => {
      await assignDeliveryVehicleAction(row.DeliveryOrderID, vehicleName);
    });
  }

  return (
    <Card className="py-3">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.CustomerName}</p>
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span>{row.Wilayah}</span>
              <span className="font-data">&middot; {formatTime(row.TransDate)}</span>
            </p>
          </div>
          <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
            {row.VoucherNo}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t pt-2">
          <Select value={driverValue} onValueChange={handleDriverChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Driver">
                {(v: string) => (v === UNSET ? "Belum ditugaskan" : (row.DriverName ?? "Belum ditugaskan"))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Belum ditugaskan</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                  {d.Name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={vehicleValue} onValueChange={handleVehicleChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Armada">
                {(v: string) => (v === UNSET ? "Belum ditugaskan" : v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Belum ditugaskan</SelectItem>
              {armada.map((a) => (
                <SelectItem key={a.ArmadaID} value={a.Nama}>
                  {a.Nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

export function DeliveryAssignmentPanel({
  rows,
  drivers,
  armada,
  businessDate,
  todayISO,
}: {
  rows: DeliveryAssignmentRow[];
  drivers: DriverOption[];
  armada: ArmadaRow[];
  businessDate: string;
  todayISO: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const isToday = businessDate === todayISO;

  function goToDate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pengirimanDate", newDate);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function shiftDate(deltaDays: number) {
    const d = new Date(businessDate);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + deltaDays));
    goToDate(next.toISOString().slice(0, 10));
  }

  return (
    <Card className="relative">
      {isPending && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15">
          <div className="h-full w-1/3 animate-indeterminate rounded-full bg-primary" />
        </div>
      )}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="font-display">
            Penugasan Pengiriman {isToday ? "Hari Ini" : formatDate(businessDate)}
          </CardTitle>
          <CardDescription>{rows.length} Delivery Order</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ArmadaManager armada={armada} />
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-8" disabled={isPending} onClick={() => shiftDate(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              type="date"
              value={businessDate}
              max={todayISO}
              disabled={isPending}
              onChange={(e) => e.target.value && goToDate(e.target.value)}
              className="h-8 w-40 text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={isToday || isPending}
              onClick={() => shiftDate(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @4xl:grid-cols-3">
          {rows.map((row) => (
            <AssignmentRowCard key={row.DeliveryOrderID} row={row} drivers={drivers} armada={armada} />
          ))}
          {rows.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              Tidak ada Delivery Order {isToday ? "hari ini" : "pada tanggal ini"}.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `actions.ts` or `delivery-assignment-panel.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/delivery/actions.ts" src/components/dashboard/delivery-assignment-panel.tsx
git commit -m "Add delivery assignment panel (Driver + Armada per DO)"
```

---

### Task 5: Restructure `/delivery` page into two tabs

**Files:**
- Create: `src/components/dashboard/open-deliveries-panel.tsx`
- Create: `src/components/dashboard/pengiriman-tabs.tsx`
- Modify: `src/app/(dashboard)/delivery/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `getOpenDeliveries`, `OpenDelivery` (existing, `@/lib/queries/delivery`); `getDeliveryAssignments`, `getDriverOptions` from Task 3; `getArmadaList` from Task 1; `DeliveryAssignmentPanel` from Task 4; `getBusinessDateISO` (existing, `@/lib/business-date`).

- [ ] **Step 1: Write `src/components/dashboard/open-deliveries-panel.tsx`**

Extracted as-is from the current `src/app/(dashboard)/delivery/page.tsx` body (KPI cards + table), so the "Pengiriman Terbuka" tab's behavior is unchanged:

```tsx
import { Truck, PackageOpen } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import type { OpenDelivery } from "@/lib/queries/delivery";

export function OpenDeliveriesPanel({ rows }: { rows: OpenDelivery[] }) {
  const totalSisa = rows.reduce((sum, r) => sum + r.SisaBelumDikirim, 0);
  const uniqueOrders = new Set(rows.map((r) => r.DeliveryOrderID)).size;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard label="Delivery Order Terbuka" value={uniqueOrders.toLocaleString("id-ID")} icon={Truck} />
        <KpiCard label="Total Sisa Belum Dikirim" value={totalSisa.toLocaleString("id-ID")} icon={PackageOpen} tone="warning" />
      </div>

      <p className="text-xs text-muted-foreground">
        Sisa kirim dihitung manual dari Qty − Delivered (kolom Outstanding pada sistem sumber
        tidak reliable).
      </p>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Voucher</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Jatuh Tempo</TableHead>
              <TableHead>Wilayah</TableHead>
              <TableHead>Mitra</TableHead>
              <TableHead>Kendaraan</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Terkirim</TableHead>
              <TableHead className="text-right">Sisa</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.DeliveryOrderID}-${r.ItemID}-${i}`}>
                <TableCell className="font-medium">{r.VoucherNo}</TableCell>
                <TableCell>{formatDate(r.TransDate)}</TableCell>
                <TableCell>{formatDate(r.DueDate)}</TableCell>
                <TableCell>{r.Wilayah}</TableCell>
                <TableCell>{r.CustomerName}</TableCell>
                <TableCell>{r.VehicleNo || "-"}</TableCell>
                <TableCell>{r.ItemName}</TableCell>
                <TableCell className="text-right tabular-nums">{r.Qty}</TableCell>
                <TableCell className="text-right tabular-nums">{r.Delivered}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{r.SisaBelumDikirim}</TableCell>
                <TableCell>
                  <Badge variant={r.IsInvoiced ? "default" : "secondary"}>
                    {r.IsInvoiced ? "Sudah Ditagih" : "Belum Ditagih"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                  Tidak ada pengiriman terbuka.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

Note: `r.VehicleNo ?? "-"` became `r.VehicleNo || "-"` — `VehicleNo` will now often be a real empty string `""` (not just `null`) once assignment is in use, and `??` doesn't catch that.

- [ ] **Step 2: Write `src/components/dashboard/pengiriman-tabs.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { value: "terbuka", label: "Pengiriman Terbuka" },
  { value: "penugasan", label: "Penugasan Armada & Driver" },
] as const;

// Same pattern as piutang-tabs.tsx: pure client-side tab state, no URL
// param, no navigation on switch — both panels' data is already fetched
// upfront by the server page.
export function PengirimanTabs({
  terbukaPanel,
  penugasanPanel,
}: {
  terbukaPanel: React.ReactNode;
  penugasanPanel: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<string>("terbuka");

  return (
    <Tabs value={activeTab} onValueChange={(v) => typeof v === "string" && setActiveTab(v)}>
      <TabsList className="no-scrollbar w-full justify-start overflow-x-auto">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="shrink-0">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="terbuka">{terbukaPanel}</TabsContent>
      <TabsContent value="penugasan">{penugasanPanel}</TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 3: Rewrite `src/app/(dashboard)/delivery/page.tsx`**

```tsx
import { requireModuleAccess } from "@/lib/require-access";
import { getOpenDeliveries, getDeliveryAssignments, getDriverOptions } from "@/lib/queries/delivery";
import { getArmadaList } from "@/lib/queries/armada";
import { getWilayahList } from "@/lib/queries/wilayah";
import { getBusinessDateISO } from "@/lib/business-date";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { OpenDeliveriesPanel } from "@/components/dashboard/open-deliveries-panel";
import { DeliveryAssignmentPanel } from "@/components/dashboard/delivery-assignment-panel";
import { PengirimanTabs } from "@/components/dashboard/pengiriman-tabs";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ wilayah?: string; pengirimanDate?: string }>;
}) {
  await requireModuleAccess("delivery");
  const params = await searchParams;
  // Wilayah only filters the "Pengiriman Terbuka" tab (getOpenDeliveries) —
  // the assignment tab is date-scoped instead and intentionally shows every
  // wilayah for that date.
  const wilayah = params.wilayah || undefined;

  const todayISO = getBusinessDateISO();
  const assignmentDate =
    params.pengirimanDate && params.pengirimanDate <= todayISO ? params.pengirimanDate : todayISO;
  const businessAssignmentDate = new Date(assignmentDate);

  const [rows, wilayahList, assignmentRows, drivers, armada] = await Promise.all([
    getOpenDeliveries(wilayah),
    getWilayahList(),
    getDeliveryAssignments(businessAssignmentDate),
    getDriverOptions(),
    getArmadaList(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pengiriman</h1>
        <FilterBar wilayahList={wilayahList} showDateRange={false} />
      </div>

      <PengirimanTabs
        terbukaPanel={<OpenDeliveriesPanel rows={rows} />}
        penugasanPanel={
          <DeliveryAssignmentPanel
            rows={assignmentRows}
            drivers={drivers}
            armada={armada}
            businessDate={assignmentDate}
            todayISO={todayISO}
          />
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/open-deliveries-panel.tsx src/components/dashboard/pengiriman-tabs.tsx "src/app/(dashboard)/delivery/page.tsx"
git commit -m "Restructure Pengiriman page into Pengiriman Terbuka + Penugasan tabs"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 0 TypeScript errors, 0 lint errors, build succeeds.

- [ ] **Step 2: Manual browser walkthrough — Armada CRUD**

Navigate to `/delivery`, switch to "Penugasan Armada & Driver" tab, click "Kelola Armada":
- Add an armada named "GrandMax 1972" — confirm it appears in the list immediately.
- Click its pencil icon, rename it, confirm the update sticks.
- Click its trash icon, confirm it disappears from the list.

- [ ] **Step 3: Manual browser walkthrough — assignment**

With at least one armada re-added and the tab showing today's Delivery Orders (if there are none today, use the date picker to go back to a date that has DOs):
- Pick a Driver from the dropdown on one DO card — confirm the selection persists after reloading the page.
- Pick an Armada — confirm it persists after reload.
- Confirm the driver dropdown never lists an entry for SalesmanID `0127`.
- Switch to "Pengiriman Terbuka" tab — confirm its content and Wilayah filter behave exactly as before this change.

- [ ] **Step 4: Confirm no regressions in existing DeliveryOrder-dependent panels**

Spot-check `/transaksi` and `/sales` pages still load without errors (they read `DeliveryOrder`/`DeliveryOrderDetail` too) — this task doesn't change any read query those pages use, but the DO rows you just wrote `SalesmanID`/`VehicleNo` to are live data now, so confirm nothing downstream chokes on a `VehicleNo` that's no longer always blank.
