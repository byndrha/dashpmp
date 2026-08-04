# Pengiriman/Pemesanan/Driver Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four independent fixes/additions clarified with the user: (1) a clear message when "Cetak SI Terpilih" can't open an SI that doesn't exist yet, (2) a "Biaya BBM tambahan" figure next to the existing fuel-cost total, (3) editable Qty (10KG/5KG) in the "Ubah Pemesanan" dialog, (4) a delete button for driver profiles in "Kelola Driver".

**Architecture:** Each fix is scoped to its own file(s) with no shared code between them. (1) and (2) are pure front-end additions to `route-validation-dialog.tsx`. (3) adds a query+action pair for editing `SalesOrderDetail.Qty`/`Amount` (and keeping `SalesOrder.Amount`/`Netto` consistent), then wires it into `UbahPemesananDialog`. (4) adds a hard-delete query+action for the dashboard-only `DashboardDriverProfile`/`DashboardDriverSim` tables (the real ERP `Salesman` row is never touched), then wires a delete button into `DriverManager`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript, MSSQL via `mssql` (`sql`/`getPool()` from `@/lib/db`).

## Global Constraints

- No change to `Selesai Muat`'s own SI/DO creation timing — confirmed with the user this stays as-is; only the print-button's messaging when an SI doesn't exist yet changes.
- "Biaya BBM tambahan" formula, confirmed with the user: for every complete 5km of route distance, add the cost of 5km worth of fuel, as its own separate figure (not merged into the existing total): `extraFuelCost = floor(distanceKm / 5) * (5 * konsumsiBBM * biayaBBMPerLiter)`.
- Qty editing in "Ubah Pemesanan" only ever touches the existing **sold** `SalesOrderDetail` row's `Qty`/`Amount` for a kantong variant (10KG item `"019"`, 5KG item `"0111"`) — never the bonus row (`"0110"`/`"0112"`), and never creates a new row for a variant the order doesn't already have. `Amount` is recomputed from the row's own already-stored `Price` (never re-fetched from the current Price Level) — editing Qty must never silently change the unit price.
- Editing Qty must refuse if the Sales Order already has a real `DeliveryOrder` (already shipped) — same guard `deletePemesanan` already uses for the same reason.
- Deleting a driver removes only `DashboardDriverProfile`/`DashboardDriverSim` rows (dashboard-only extension data) — the real ERP `Salesman` row, and any historical `SalesOrder`/`DeliveryOrder` referencing that `SalesmanID`, are never touched.
- Every server action in `pemesanan/actions.ts` matches that file's existing convention of no explicit `requireModuleAccess` call (this module doesn't gate per-action). Every server action touching driver data matches `delivery/actions.ts`'s existing convention of `await requireModuleAccess("delivery")` first.
- Destructive UI actions use the plain `confirm(...)` browser dialog — the same pattern `handleRemoveStop` in `route-validation-dialog.tsx` already uses, not a new modal component.

---

## Task 1: SI-belum-terbit print message + Biaya BBM tambahan

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`

**Interfaces:** None new — this task only adds local state and JSX to an existing component, no exported signatures change.

- [ ] **Step 1: Add a dedicated error state for the print action**

Find the existing state declarations (near `const [printSelected, setPrintSelected] = useState<Set<number>>(new Set());`, around line 241) and add a sibling state right after it:

```tsx
const [printError, setPrintError] = useState<string | null>(null);
```

- [ ] **Step 2: Update `handlePrintSelected` to report stops with no SI yet**

Replace:

```tsx
  // Opens the printable invoice for every currently-marked stop that already
  // has an InvoiceToken (a stop marked before Selesai Muat runs has none yet
  // — nothing to open for it here; the auto-print in handleSelesaiMuat is
  // what actually opens it the moment its token becomes available).
  function handlePrintSelected() {
    for (const d of order) {
      if (printSelected.has(d.JadwalDetailID) && d.InvoiceToken) {
        window.open(`/invoice/${d.InvoiceToken}`, "_blank");
      }
    }
  }
```

with:

```tsx
  // Opens the printable invoice for every currently-marked stop that already
  // has an InvoiceToken (a stop marked before Selesai Muat runs has none yet
  // — nothing to open for it here; the auto-print in handleSelesaiMuat is
  // what actually opens it the moment its token becomes available). Stops
  // marked but still missing a token are reported instead of silently
  // skipped, so a Draft-stage click doesn't look like it did nothing.
  function handlePrintSelected() {
    setPrintError(null);
    let missingCount = 0;
    for (const d of order) {
      if (!printSelected.has(d.JadwalDetailID)) continue;
      if (d.InvoiceToken) {
        window.open(`/invoice/${d.InvoiceToken}`, "_blank");
      } else {
        missingCount++;
      }
    }
    if (missingCount > 0) {
      setPrintError(
        `${missingCount} SI belum terbit — SI baru dibuat otomatis saat "Selesai Muat" diklik. Tetap ditandai; akan otomatis tercetak begitu Selesai Muat selesai.`
      );
    }
  }
```

- [ ] **Step 3: Render the message near the print button**

Find the "Cetak SI Terpilih" button block:

```tsx
            {printSelected.size > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5" data-capture-hide="true" onClick={handlePrintSelected}>
                <Printer className="size-3.5" />
                Cetak SI Terpilih ({printSelected.size})
              </Button>
            )}
```

Add the error message right after this block (still inside the same parent):

```tsx
            {printSelected.size > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5" data-capture-hide="true" onClick={handlePrintSelected}>
                <Printer className="size-3.5" />
                Cetak SI Terpilih ({printSelected.size})
              </Button>
            )}
            {printError && <p className="text-xs text-destructive">{printError}</p>}
```

- [ ] **Step 4: Add the "Biaya BBM tambahan" computed value**

Find the existing `totalFuelCost` `useMemo` (around line 618):

```tsx
  const totalFuelCost = useMemo(() => {
    if (totalFuelLiters == null || biayaBBMPerLiter == null) return null;
    return Math.round(totalFuelLiters * biayaBBMPerLiter);
  }, [totalFuelLiters, biayaBBMPerLiter]);
```

Add a new `useMemo` right after it:

```tsx
  // "Biaya BBM tambahan": an extra buffer figure on top of the normal fuel
  // cost above, shown separately (never merged into totalFuelCost) — for
  // every complete 5km of route distance, add the cost of 5km worth of
  // fuel. Confirmed formula with the user: floor(distanceKm / 5) * (5km
  // worth of fuel cost), not a re-scaling of the existing total.
  const extraFuelCost = useMemo(() => {
    if (route == null || konsumsiBBM == null || biayaBBMPerLiter == null) return null;
    const segments = Math.floor(route.distanceKm / 5);
    const costPer5Km = 5 * konsumsiBBM * biayaBBMPerLiter;
    return Math.round(segments * costPer5Km);
  }, [route, konsumsiBBM, biayaBBMPerLiter]);
```

- [ ] **Step 5: Render it next to the existing total**

Find the BBM display block:

```tsx
                {totalFuelCost != null && (
                  <span className="flex items-center gap-1 font-medium">{formatRupiah(totalFuelCost)}</span>
                )}
```

Add right after it, still inside the same `<div className="flex flex-wrap gap-3 ...">`:

```tsx
                {totalFuelCost != null && (
                  <span className="flex items-center gap-1 font-medium">{formatRupiah(totalFuelCost)}</span>
                )}
                {extraFuelCost != null && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    + {formatRupiah(extraFuelCost)}
                    <span className="text-[10px]">(BBM tambahan)</span>
                  </span>
                )}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/components/dashboard/route-validation-dialog.tsx` — expect 0 errors.

Live-verify in the browser against a real Draft Jadwal with a validated route:
1. Mark a stop for printing whose Jadwal is still Draft (no Selesai Muat yet), click "Cetak SI Terpilih" — confirm the new message appears instead of nothing happening.
2. Confirm the "Biaya BBM tambahan" figure renders next to the existing total BBM cost once a route is validated, and that its value matches `Math.round(Math.floor(distanceKm / 5) * 5 * konsumsiBBM * biayaBBMPerLiter)` computed by hand from the same Jadwal's real `route.distanceKm`/Armada's `konsumsiBBM`/`biayaBBMPerLiter`.
3. Confirm a Jadwal already past Selesai Muat (real InvoiceToken present) still opens the invoice tab normally when marked and printed — no regression to the working case.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx
git commit -m "Add SI-not-yet-issued print message and Biaya BBM tambahan figure"
```

---

## Task 2: Qty edit query + action layer

**Files:**
- Modify: `src/lib/queries/sales-order.ts`
- Modify: `src/app/(dashboard)/pemesanan/actions.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EditableSalesOrderQty {
    qty10KG: number | null; // null = this SO has no existing sold 10KG row (not editable)
    qty5KG: number | null;  // null = this SO has no existing sold 5KG row (not editable)
  }
  export async function getEditableSalesOrderQty(salesOrderId: string): Promise<EditableSalesOrderQty>
  export async function updateSalesOrderDetailQty(salesOrderId: string, variant: KantongVariant, newQty: number): Promise<void>
  ```
  (both in `sales-order.ts`, `KantongVariant` already exported there from the existing `createSalesOrderManual` work)
  ```ts
  export async function getEditableSalesOrderQtyAction(salesOrderId: string): Promise<EditableSalesOrderQty>
  export async function updateSalesOrderQtyAction(salesOrderId: string, variant: KantongVariant, newQty: number): Promise<void>
  ```
  (both in `pemesanan/actions.ts`) — Task 3's `UbahPemesananDialog` calls these exact two action names.

- [ ] **Step 1: Add `getEditableSalesOrderQty` to `sales-order.ts`**

Add after `createSalesOrderManual` (the constants `KANTONG_ITEM_ID`, `KANTONG_VARIANTS` are already defined earlier in this file, in scope):

```ts
export interface EditableSalesOrderQty {
  qty10KG: number | null;
  qty5KG: number | null;
}

// Only the SOLD row per variant — deliberately excludes the separate bonus
// rows (BONUS_ITEM_VARIANTS), so this never conflates billed quantity with
// free/bonus quantity. null means this SO has no sold row for that variant
// at all (nothing to edit — the UI must not offer an input for it, since
// this function never creates a new row).
export async function getEditableSalesOrderQty(salesOrderId: string): Promise<EditableSalesOrderQty> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("item10", sql.VarChar(150), KANTONG_ITEM_ID)
    .input("item5", sql.VarChar(150), KANTONG_VARIANTS["5kg"].itemId)
    .query(`SELECT ItemID, Qty FROM SalesOrderDetail WHERE SalesOrderID = @soId AND ItemID IN (@item10, @item5)`);
  const rows = result.recordset as { ItemID: string; Qty: number }[];
  const row10 = rows.find((r) => r.ItemID === KANTONG_ITEM_ID);
  const row5 = rows.find((r) => r.ItemID === KANTONG_VARIANTS["5kg"].itemId);
  return {
    qty10KG: row10 ? row10.Qty : null,
    qty5KG: row5 ? row5.Qty : null,
  };
}
```

- [ ] **Step 2: Add `updateSalesOrderDetailQty` to `sales-order.ts`**

Add right after `getEditableSalesOrderQty`:

```ts
// Edits an existing sold-row's Qty (and its Amount, recomputed from that
// row's own already-stored Price — never re-fetched from the current Price
// Level, so editing Qty never silently changes the unit price the customer
// was quoted). Refuses if the variant has no existing sold row (this never
// creates one) or if the SO has already shipped (a real DeliveryOrder
// exists) — same shipped-order guard deletePemesanan already uses, for the
// same reason: editing an SO after its DO/SI already reflects the old Qty
// would silently desync real ERP documents.
export async function updateSalesOrderDetailQty(salesOrderId: string, variant: KantongVariant, newQty: number): Promise<void> {
  if (!(newQty > 0)) throw new Error("Qty pemesanan harus lebih dari 0.");

  const pool = await getPool();

  const doCheck = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`SELECT COUNT(*) AS Cnt FROM DeliveryOrder WHERE SalesOrderID = @soId AND IsDeleted = 0`);
  if ((doCheck.recordset[0] as { Cnt: number }).Cnt > 0) {
    throw new Error("Pesanan ini sudah terkirim (DO sudah terbit) — Qty tidak bisa diubah dari sini.");
  }

  const itemId = KANTONG_VARIANTS[variant].itemId;
  const existing = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("itemId", sql.VarChar(150), itemId)
    .query(`SELECT SalesOrderDetailID, Price FROM SalesOrderDetail WHERE SalesOrderID = @soId AND ItemID = @itemId`);
  const row = existing.recordset[0] as { SalesOrderDetailID: string; Price: number } | undefined;
  if (!row) {
    throw new Error(`Pesanan ini tidak memiliki baris ${variant === "10kg" ? "10 KG" : "5 KG"} untuk diubah.`);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const newAmount = newQty * row.Price;
    await new sql.Request(transaction)
      .input("detailId", sql.VarChar(16), row.SalesOrderDetailID)
      .input("qty", sql.Float, newQty)
      .input("amount", sql.Float, newAmount)
      .query(`UPDATE SalesOrderDetail SET Qty = @qty, Amount = @amount WHERE SalesOrderDetailID = @detailId`);

    // Keeps the header's Amount/Netto consistent with the sum of its own
    // details (bonus rows included, always Amount=0) — the same
    // header-equals-sum-of-details relationship createSalesOrderManual
    // establishes at creation time.
    await new sql.Request(transaction)
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`
        UPDATE SalesOrder SET
          Amount = (SELECT ISNULL(SUM(Amount), 0) FROM SalesOrderDetail WHERE SalesOrderID = @soId),
          Netto = (SELECT ISNULL(SUM(Amount), 0) FROM SalesOrderDetail WHERE SalesOrderID = @soId),
          ModifiedDate = GETDATE()
        WHERE SalesOrderID = @soId
      `);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
```

- [ ] **Step 3: Add the two server actions to `pemesanan/actions.ts`**

Update the import block:

```ts
import {
  createPemesanan,
  reschedulePemesanan,
  deletePemesanan,
  updateSalesOrderTransDate,
  type CreatePemesananInput,
  type CreatePemesananResult,
  type ReschedulePemesananInput,
} from "@/lib/queries/pemesanan";
import { getCurrentAssignment, type CurrentAssignment } from "@/lib/queries/pengiriman-jadwal";
import { createTakeAwayPemesanan, type CreateTakeAwayInput, type CreateTakeAwayResult } from "@/lib/queries/takeaway";
import {
  getEditableSalesOrderQty,
  updateSalesOrderDetailQty,
  type EditableSalesOrderQty,
  type KantongVariant,
} from "@/lib/queries/sales-order";
```

Add at the end of the file:

```ts
// Read-only — no revalidatePath needed, fetched on demand when "Ubah
// Pemesanan" opens, same shape as getCurrentAssignmentAction above.
export async function getEditableSalesOrderQtyAction(salesOrderId: string): Promise<EditableSalesOrderQty> {
  return getEditableSalesOrderQty(salesOrderId);
}

export async function updateSalesOrderQtyAction(salesOrderId: string, variant: KantongVariant, newQty: number): Promise<void> {
  await updateSalesOrderDetailQty(salesOrderId, variant, newQty);
  revalidatePath("/pemesanan");
  revalidatePath("/delivery");
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expect 0 errors project-wide.
Run: `npx eslint src/lib/queries/sales-order.ts "src/app/(dashboard)/pemesanan/actions.ts"` — expect 0 errors.

- [ ] **Step 5: Live-verify against real data**

Write a throwaway `npx tsx -r dotenv/config` script (this project's one-off DB scripts need `-r dotenv/config` to load the Postgres directory connection env vars, confirmed earlier this session — plain `npx tsx` fails with ECONNREFUSED), wrapped in an async `main()`, that:
1. Finds a real Draft-stage SalesOrder (one with a current Jadwal assignment, `Status = 'Draft'`, no real `DeliveryOrder` yet) that has a sold 10KG or 5KG row.
2. Calls `getEditableSalesOrderQty` on it, confirms the returned qty matches what's really in `SalesOrderDetail`.
3. Calls `updateSalesOrderDetailQty` with a new Qty, then re-reads `SalesOrderDetail.Qty`/`Amount` and `SalesOrder.Amount`/`Netto` directly to confirm they updated correctly and consistently (`SalesOrder.Amount` equals the sum of all its `SalesOrderDetail.Amount` rows).
4. Confirms calling `updateSalesOrderDetailQty` with `newQty <= 0` throws, and calling it for a variant with no existing row throws the expected message.
5. Restores the original Qty/Amount afterward if this was tested against a real, in-use SO (or use an SO you're confident is safe to leave modified — prefer restoring).

Delete the script after running it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/sales-order.ts "src/app/(dashboard)/pemesanan/actions.ts"
git commit -m "Add query/action layer for editing SalesOrderDetail Qty"
```

---

## Task 3: Wire Qty edit into `UbahPemesananDialog`

**Files:**
- Modify: `src/components/dashboard/ubah-pemesanan-dialog.tsx`

**Interfaces:**
- Consumes: `getEditableSalesOrderQtyAction`, `updateSalesOrderQtyAction`, `EditableSalesOrderQty` (Task 2).

- [ ] **Step 1: Update imports**

Replace:

```tsx
import { getCurrentAssignmentAction, reschedulePemesananAction } from "@/app/(dashboard)/pemesanan/actions";
```

with:

```tsx
import {
  getCurrentAssignmentAction,
  reschedulePemesananAction,
  getEditableSalesOrderQtyAction,
  updateSalesOrderQtyAction,
} from "@/app/(dashboard)/pemesanan/actions";
```

- [ ] **Step 2: Add Qty state**

Add alongside the existing state declarations (after `const [salesmanId, setSalesmanId] = useState<string>(UNSET);`):

```tsx
  const [qty10KG, setQty10KG] = useState<number | null>(null);
  const [qty5KG, setQty5KG] = useState<number | null>(null);
  const [initialQty10KG, setInitialQty10KG] = useState<number | null>(null);
  const [initialQty5KG, setInitialQty5KG] = useState<number | null>(null);
```

- [ ] **Step 3: Fetch editable Qty alongside the existing assignment fetch**

Replace the existing `useEffect`:

```tsx
  useEffect(() => {
    if (!target) return;
    // Kicks off a fetch for the newly-opened target — not derivable from
    // render, so the loading/error reset has to happen here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getCurrentAssignmentAction(target.salesOrderId)
      .then((assignment) => {
        if (assignment) {
          const d = new Date(assignment.jamJadwal);
          setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
          setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
          setArmadaId(String(assignment.armadaId));
          setSalesmanId(assignment.salesmanId ?? UNSET);
        } else {
          setDate("");
          setTime("08:00");
          setArmadaId(UNSET);
          setSalesmanId(UNSET);
        }
      })
      .finally(() => setLoading(false));
  }, [target]);
```

with:

```tsx
  useEffect(() => {
    if (!target) return;
    // Kicks off a fetch for the newly-opened target — not derivable from
    // render, so the loading/error reset has to happen here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    Promise.all([getCurrentAssignmentAction(target.salesOrderId), getEditableSalesOrderQtyAction(target.salesOrderId)])
      .then(([assignment, editableQty]) => {
        if (assignment) {
          const d = new Date(assignment.jamJadwal);
          setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
          setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
          setArmadaId(String(assignment.armadaId));
          setSalesmanId(assignment.salesmanId ?? UNSET);
        } else {
          setDate("");
          setTime("08:00");
          setArmadaId(UNSET);
          setSalesmanId(UNSET);
        }
        setQty10KG(editableQty.qty10KG);
        setQty5KG(editableQty.qty5KG);
        setInitialQty10KG(editableQty.qty10KG);
        setInitialQty5KG(editableQty.qty5KG);
      })
      .finally(() => setLoading(false));
  }, [target]);
```

- [ ] **Step 4: Update `canSubmit` and `handleSubmit`**

Replace:

```tsx
  const canSubmit = !!target && !!date && armadaId !== UNSET;

  function handleSubmit() {
    if (!target || !canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await reschedulePemesananAction({
          salesOrderId: target.salesOrderId,
          armadaId: Number(armadaId),
          deliveryDateTime: new Date(`${date}T${time}:00`),
          salesmanId: salesmanId === UNSET ? null : salesmanId,
        });
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengubah pemesanan.");
      }
    });
  }
```

with:

```tsx
  const canSubmit =
    !!target &&
    !!date &&
    armadaId !== UNSET &&
    (qty10KG == null || qty10KG > 0) &&
    (qty5KG == null || qty5KG > 0);

  function handleSubmit() {
    if (!target || !canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await reschedulePemesananAction({
          salesOrderId: target.salesOrderId,
          armadaId: Number(armadaId),
          deliveryDateTime: new Date(`${date}T${time}:00`),
          salesmanId: salesmanId === UNSET ? null : salesmanId,
        });
        if (qty10KG != null && qty10KG !== initialQty10KG) {
          await updateSalesOrderQtyAction(target.salesOrderId, "10kg", qty10KG);
        }
        if (qty5KG != null && qty5KG !== initialQty5KG) {
          await updateSalesOrderQtyAction(target.salesOrderId, "5kg", qty5KG);
        }
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengubah pemesanan.");
      }
    });
  }
```

- [ ] **Step 5: Add the Qty inputs to the form**

Find the armada/driver `<div className="grid grid-cols-2 gap-2">` block (the second one, containing the Armada and Driver `Select`s) and add a new row right after it, still inside the `<>` fragment, before `{error && ...}`:

```tsx
                {(initialQty10KG != null || initialQty5KG != null) && (
                  <div className="grid grid-cols-2 gap-2">
                    {initialQty10KG != null && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="ubah-qty10" className="text-xs text-muted-foreground">
                          Qty 10 KG
                        </Label>
                        <Input
                          id="ubah-qty10"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={qty10KG ?? ""}
                          onChange={(e) => setQty10KG(e.target.value === "" ? null : Number(e.target.value))}
                        />
                      </div>
                    )}
                    {initialQty5KG != null && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="ubah-qty5" className="text-xs text-muted-foreground">
                          Qty 5 KG
                        </Label>
                        <Input
                          id="ubah-qty5"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={qty5KG ?? ""}
                          onChange={(e) => setQty5KG(e.target.value === "" ? null : Number(e.target.value))}
                        />
                      </div>
                    )}
                  </div>
                )}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/components/dashboard/ubah-pemesanan-dialog.tsx` — expect 0 errors.
Run: `npm run build` — expect success.

Live-verify: open "Ubah Pemesanan" for a real Draft-stage SO with an existing 10KG or 5KG sold row, confirm the corresponding Qty input appears pre-filled with the real current value, change it, click "Simpan Perubahan", confirm no error and the board's kantong total for that stop updates to the new value after the dialog closes and the page revalidates. Also confirm a variant the SO doesn't have (e.g. 5KG on a 10KG-only order) shows no input at all — the grid should still render cleanly with just one column populated. Confirm entering `0` or a blank value disables the Simpan button (via `canSubmit`).

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/ubah-pemesanan-dialog.tsx
git commit -m "Add editable Qty 10KG/5KG inputs to Ubah Pemesanan"
```

---

## Task 4: Delete driver profile

**Files:**
- Modify: `src/lib/queries/driver-profile.ts`
- Modify: `src/app/(dashboard)/delivery/actions.ts`
- Modify: `src/components/dashboard/driver-manager.tsx`

**Interfaces:**
- Produces: `deleteDriverProfile(salesmanId: string): Promise<void>` (`driver-profile.ts`), `deleteDriverProfileAction(salesmanId: string): Promise<void>` (`delivery/actions.ts`) — the UI task step in this same task consumes it.

- [ ] **Step 1: Add `deleteDriverProfile` to `driver-profile.ts`**

Add at the end of the file, after `saveDriverProfile`:

```ts
// Hard-deletes only this SalesmanID's dashboard-side extension data
// (DashboardDriverProfile + DashboardDriverSim) — the real ERP Salesman
// row, and any historical SalesOrder/DeliveryOrder referencing this
// SalesmanID, are never touched. Matches saveDriverProfile's own
// no-transaction style for this same table pair (a partial failure here
// just leaves stale SIM rows for a profile-less SalesmanID, which
// re-running this same delete cleans up — not a real data-integrity risk
// the way the SalesOrder/SalesOrderDetail pair in sales-order.ts is).
export async function deleteDriverProfile(salesmanId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .query(`DELETE FROM DashboardDriverSim WHERE SalesmanID = @salesmanId`);
  await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .query(`DELETE FROM DashboardDriverProfile WHERE SalesmanID = @salesmanId`);
}
```

- [ ] **Step 2: Add the server action to `delivery/actions.ts`**

Find the existing driver-profile import and export:

```ts
import { getDriverProfiles, saveDriverProfile, type DriverProfileRow, type SaveDriverProfileInput } from "@/lib/queries/driver-profile";
```

Replace with:

```ts
import {
  getDriverProfiles,
  saveDriverProfile,
  deleteDriverProfile,
  type DriverProfileRow,
  type SaveDriverProfileInput,
} from "@/lib/queries/driver-profile";
```

Add after the existing `saveDriverProfileAction`:

```ts
export async function deleteDriverProfileAction(salesmanId: string): Promise<void> {
  await requireModuleAccess("delivery");
  await deleteDriverProfile(salesmanId);
  revalidatePath("/delivery");
}
```

- [ ] **Step 3: Add the delete button to `DriverManager`**

Update the import:

```tsx
import { saveDriverProfileAction } from "@/app/(dashboard)/delivery/actions";
```

with:

```tsx
import { saveDriverProfileAction, deleteDriverProfileAction } from "@/app/(dashboard)/delivery/actions";
```

Add `Trash2` to the existing lucide-react import:

```tsx
import { Pencil, X, EyeOff, Eye, Trash2 } from "lucide-react";
```

In `DriverManager`, add a delete handler and wire the button. Replace:

```tsx
export function DriverManager({ drivers }: { drivers: DriverProfileRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DriverProfileRow | null>(null);

  return (
```

with:

```tsx
export function DriverManager({ drivers }: { drivers: DriverProfileRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DriverProfileRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleDelete(driver: DriverProfileRow) {
    if (!confirm(`Hapus data profil dashboard untuk "${driver.Name}"? Data Salesman ERP asli tidak akan terhapus.`)) return;
    setDeletingId(driver.SalesmanID);
    deleteDriverProfileAction(driver.SalesmanID).finally(() => setDeletingId(null));
  }

  return (
```

Then replace the per-driver row's button block:

```tsx
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => {
                    setOpen(false);
                    setEditing(d);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
```

with:

```tsx
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setOpen(false);
                      setEditing(d);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    disabled={deletingId === d.SalesmanID}
                    onClick={() => handleDelete(d)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
```

Also update the file's own header comment (currently claims "no create/delete actions" for this manager) — replace:

```tsx
// Driver identity itself comes from the real ERP Salesman table (no
// "Tambah Driver" here — nothing to create, only extend with dashboard-only
// personal data) — same read-only-identity/extend-with-a-side-table shape
// as ArmadaManager, just without the create/delete actions since those
// don't apply to a Salesman record from here.
```

with:

```tsx
// Driver identity itself comes from the real ERP Salesman table (no
// "Tambah Driver" here — nothing to create, the ERP Salesman row is never
// touched). Delete here only removes this SalesmanID's dashboard-only
// extension rows (DashboardDriverProfile/DashboardDriverSim) — the driver
// reappears with a blank profile the moment anyone re-saves against the
// same SalesmanID, since identity itself isn't stored here.
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/driver-profile.ts "src/app/(dashboard)/delivery/actions.ts" src/components/dashboard/driver-manager.tsx` — expect 0 errors.
Run: `npm run build` — expect success.

Live-verify: open "Kelola Driver", click the new delete icon on a driver whose profile data you can safely test against (prefer a driver with minimal/no real SIM or personal data filled in, or one you can confirm with the DB is safe to test), confirm the browser's native confirm dialog appears, confirm it, confirm the driver's profile row (SIM badges, etc.) disappears from the list — but the driver's NAME still shows up correctly elsewhere in the app (e.g. still selectable as a Driver in Ubah Pemesanan/Validasi Rute), confirming the ERP Salesman identity itself is untouched.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/driver-profile.ts "src/app/(dashboard)/delivery/actions.ts" src/components/dashboard/driver-manager.tsx
git commit -m "Add delete button for dashboard-only driver profile data"
```

---

## Task 5: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Re-run the full static check suite**

Run: `npx tsc --noEmit`, `npx eslint src`, `npm run build` — all three must pass clean with zero errors.

- [ ] **Step 2: Confirm no leftover scratch files**

Run: `git status --short` — must be clean.

- [ ] **Step 3: End-to-end live browser walkthrough**

Repeat, against the real dev server:
1. The SI-belum-terbit message and Biaya BBM tambahan checks from Task 1.
2. A full "Ubah Pemesanan" Qty edit from Task 3, confirming the change is reflected on the Papan Pengiriman board afterward (not just inside the dialog).
3. A driver profile delete from Task 4, confirming the driver survives as a selectable Driver option elsewhere.

- [ ] **Step 4: Confirm nothing else regressed**

Open Validasi Rute for at least one Jadwal that's already past Selesai Muat (has real DO+SI) and confirm the existing "Cetak SI Terpilih" flow for already-issued SI still works exactly as before (Task 1 only added a message for the missing case, must not have broken the working case).
