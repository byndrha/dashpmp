# Armada Conflict Confirmation Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current silent auto-merge into an overlapping Draft Jadwal (armada double-booking) with an explicit confirmation popup showing candidate/existing/combined quantities and a capacity warning, across all 6 UI trigger points that share this overlap-detection logic.

**Architecture:** A new read-only query `checkArmadaConflict()` (mirroring the existing `findOverlappingJadwalForArmada`, but only surfacing Draft-status conflicts with quantity/capacity info) is called by the client BEFORE the real mutating action, at each of the 6 trigger points. If it returns a conflict, a shared `ArmadaConflictDialog` component shows the confirmation; only on confirm does the client call the real mutating action (unchanged, still enforcing capacity/overlap as the final safety net).

**Tech Stack:** Next.js Server Actions using the existing `ActionResult<T>`/`runAction` pattern (`src/lib/action-result.ts`), shadcn `Dialog` primitive, existing `mssql`/`sql.ConnectionPool` query conventions in `src/lib/queries/pengiriman-jadwal.ts`.

## Global Constraints

- Conflict with a **Terbit** Jadwal is unchanged in all 6 flows — still rejected hard by the existing mutating action's own check, no confirmation dialog for this case.
- The confirmation dialog only appears for conflicts with a **Draft** Jadwal.
- `checkArmadaConflict()` takes a plain `candidateQty: number`, not `SalesOrderID[]` — the candidate order/stop may not exist in the database yet (Buat Pemesanan creates the SalesOrder in the same submit). Every one of the 6 call sites already has this quantity available client-side.
- `candidateEnd` inside `checkArmadaConflict()` is computed as `candidateStart + estimateDeliveryMinutes(candidateQty)` minutes — a deliberate rough approximation (no travel-time component), since real per-stop coordinates aren't always known yet. This function is a decision-support heuristic only; the actual hard enforcement (capacity, precise overlap) remains unchanged in the real mutating actions.
- "Gabungkan" button in `ArmadaConflictDialog` is **disabled** (not just warned) when the combined quantity would exceed the target armada's `KapasitasMaks`.
- No changes to `ActionResult<T>` itself, `assertWithinCapacity`, or any existing overlap/capacity enforcement inside the mutating actions — this feature only adds a pre-check step in front of them.
- This project has no test runner — verification is `npx tsc --noEmit`, `npx eslint`, and manual/static verification, per every other plan this session.

---

### Task 1: `checkArmadaConflict()` query function

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Consumes: `findOverlappingJadwalForArmada` (existing, private to this file), `sumSalesOrderQty` (existing, private), `getPabrikLocation` (existing import), `estimateDeliveryMinutes` from `@/lib/delivery-duration` (not yet imported in this file — add it).
- Produces: `export interface ArmadaConflictInfo { jadwalId: number; jamJadwal: string; existingQty: number; candidateQty: number; combinedQty: number; kapasitasMaks: number | null; wouldExceedCapacity: boolean; }` and `export async function checkArmadaConflict(armadaId: number, candidateStart: Date, candidateQty: number, excludeJadwalId: number | null): Promise<ArmadaConflictInfo | null>` — consumed by Task 2.

- [ ] **Step 1: Add the `estimateDeliveryMinutes` import**

Add to the existing import block near the top of `src/lib/queries/pengiriman-jadwal.ts` (alongside the other `@/lib/...` imports already there):

```ts
import { estimateDeliveryMinutes } from "@/lib/delivery-duration";
```

- [ ] **Step 2: Write `ArmadaConflictInfo` and `checkArmadaConflict`**

Add this after `findOverlappingJadwalForArmada`'s closing brace (around line 639, right before the `mergeJadwalInto` comment block):

```ts
export interface ArmadaConflictInfo {
  jadwalId: number;
  jamJadwal: string;
  existingQty: number;
  candidateQty: number;
  combinedQty: number;
  kapasitasMaks: number | null;
  wouldExceedCapacity: boolean;
}

// Decision-support check for the 6 UI flows that can silently fold a new
// stop/departure into an already-Draft Jadwal for the same armada
// (mergeExternalDeliveriesIntoJadwal, updateJadwalDriverTime,
// updateJadwalArmada, createJadwalDraft, and pemesanan.ts's
// createPemesanan/reschedulePemesanan, which call createJadwalDraft
// internally). Returns non-null ONLY for a genuine Draft-status conflict —
// a Terbit conflict returns null here so the caller proceeds straight to
// the real mutating action, which still rejects it hard exactly as before
// (this function never changes that behavior, it only adds a confirmation
// step in front of the Draft-merge case that previously happened silently).
//
// candidateEnd is a deliberate approximation
// (candidateStart + estimateDeliveryMinutes(candidateQty), no travel time)
// rather than the full estimateBusyMinutes used elsewhere — candidateQty
// is sometimes for an order that doesn't have a real SalesOrderID (and
// therefore no known stop coordinates) yet, e.g. Buat Pemesanan. This is
// fine because this function is purely "should we show a confirmation
// popup", never the actual capacity/overlap gate — that stays in the real
// mutating action, called after the user confirms, with full precision.
export async function checkArmadaConflict(
  armadaId: number,
  candidateStart: Date,
  candidateQty: number,
  excludeJadwalId: number | null
): Promise<ArmadaConflictInfo | null> {
  const pool = await getPool();
  const pabrikLocation = await getPabrikLocation();
  const pabrikLatLng: LatLng = { lat: pabrikLocation.latitude, lng: pabrikLocation.longitude };
  const candidateEnd = new Date(candidateStart.getTime() + estimateDeliveryMinutes(candidateQty) * 60 * 1000);
  const conflict = await findOverlappingJadwalForArmada(pool, pabrikLatLng, armadaId, candidateStart, candidateEnd, excludeJadwalId);
  if (!conflict || conflict.status !== "Draft") return null;

  const detailResult = await pool
    .request()
    .input("jadwalId", sql.Int, conflict.jadwalId)
    .query(`SELECT SalesOrderID FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const existingSalesOrderIds = (detailResult.recordset as { SalesOrderID: string }[]).map((r) => r.SalesOrderID);
  const existingQty = await sumSalesOrderQty(pool, existingSalesOrderIds);

  const armadaResult = await pool
    .request()
    .input("armadaId", sql.Int, armadaId)
    .query(`SELECT KapasitasMaks FROM DashboardArmada WHERE ArmadaID = @armadaId AND IsDeleted = 0`);
  const kapasitasMaks = (armadaResult.recordset[0] as { KapasitasMaks: number | null } | undefined)?.KapasitasMaks ?? null;

  const combinedQty = existingQty + candidateQty;

  return {
    jadwalId: conflict.jadwalId,
    jamJadwal: conflict.start.toISOString(),
    existingQty,
    candidateQty,
    combinedQty,
    kapasitasMaks,
    wouldExceedCapacity: kapasitasMaks != null && combinedQty > kapasitasMaks,
  };
}
```

`sumSalesOrderQty` and `findOverlappingJadwalForArmada` are both already `async function` (not exported) in this same file, above this new code — no import needed, they're in scope.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "Add checkArmadaConflict query for armada-conflict confirmation"
```

---

### Task 2: `checkArmadaConflictAction` server action

**Files:**
- Modify: `src/app/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: `checkArmadaConflict`, `type ArmadaConflictInfo` from `@/lib/queries/pengiriman-jadwal` (Task 1).
- Produces: `export async function checkArmadaConflictAction(armadaId: number, candidateStart: Date, candidateQty: number, excludeJadwalId: number | null): Promise<ArmadaConflictInfo | null>` — consumed by Tasks 4-9.

This is a plain read-only passthrough — no `runAction` wrapping (it can't throw a business `AppError`; `null` already means "nothing to show", matching this plan's Global Constraint that only actually-throwing actions get wrapped).

- [ ] **Step 1: Add the import and action**

Add `checkArmadaConflict` and `type ArmadaConflictInfo` to the existing `from "@/lib/queries/pengiriman-jadwal"` import block in `src/app/(dashboard)/delivery/actions.ts`, then add near the other read-only actions (e.g. right after `getMaxSalesOrderTransDateForDeliveriesAction`):

```ts
export async function checkArmadaConflictAction(
  armadaId: number,
  candidateStart: Date,
  candidateQty: number,
  excludeJadwalId: number | null
): Promise<ArmadaConflictInfo | null> {
  return checkArmadaConflict(armadaId, candidateStart, candidateQty, excludeJadwalId);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/delivery/actions.ts"
git commit -m "Add checkArmadaConflictAction server action"
```

---

### Task 3: `ArmadaConflictDialog` shared component

**Files:**
- Create: `src/components/dashboard/armada-conflict-dialog.tsx`

**Interfaces:**
- Consumes: `type ArmadaConflictInfo` from `@/lib/queries/pengiriman-jadwal` (Task 1), `formatTime` from `@/lib/format` (existing).
- Produces: `export function ArmadaConflictDialog({ conflict, onConfirm, onCancel }: { conflict: ArmadaConflictInfo; onConfirm: () => void; onCancel: () => void }): JSX.Element` — consumed by Tasks 4-9. Note this component takes the conflict as a required prop (not `| null`) — every call site conditionally renders it (`{conflict && <ArmadaConflictDialog .../>}`), so the component itself never needs to handle a null/closed state.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatTime } from "@/lib/format";
import type { ArmadaConflictInfo } from "@/lib/queries/pengiriman-jadwal";

export function ArmadaConflictDialog({
  conflict,
  onConfirm,
  onCancel,
}: {
  conflict: ArmadaConflictInfo;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gabungkan dengan Kartu Pengiriman yang Sudah Ada?</DialogTitle>
          <DialogDescription>
            Sudah ada keberangkatan Draft untuk armada ini di sekitar jam {formatTime(conflict.jamJadwal)}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Kuantitas terpilih</span>
            <span className="tabular-nums">{conflict.candidateQty} kantong</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sudah ada di Kartu Pengiriman</span>
            <span className="tabular-nums">{conflict.existingQty} kantong</span>
          </div>
          <div className="flex justify-between border-t pt-1 font-medium">
            <span>Total setelah gabung</span>
            <span className="tabular-nums">{conflict.combinedQty} kantong</span>
          </div>
          {conflict.wouldExceedCapacity && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Melebihi kapasitas maksimum armada ({conflict.kapasitasMaks} kantong).
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Batal
          </Button>
          <Button onClick={onConfirm} disabled={conflict.wouldExceedCapacity}>
            Gabungkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Verify `formatTime` in `src/lib/format.ts` accepts an ISO string (matching `conflict.jamJadwal`'s type) before assuming — read that function's signature; if it only accepts `Date`, wrap the call as `formatTime(new Date(conflict.jamJadwal))` instead.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/armada-conflict-dialog.tsx
git commit -m "Add shared ArmadaConflictDialog component"
```

---

### Task 4: Integrate into "Gabungkan jadi Jadwal" (`MergeExternalDialog`)

**Files:**
- Modify: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- Consumes: `checkArmadaConflictAction` (Task 2), `ArmadaConflictDialog` (Task 3).

`MergeExternalDialog`'s current `handleSubmit` (read the file to confirm current line numbers — this was correct as of the plan's writing):

```ts
function handleSubmit() {
  if (armadaId == null || deliveries.length === 0) return;
  setError(null);
  const jamJadwal = !timeEdited && defaultJamJadwal ? defaultJamJadwal : new Date(`${date}T${time}:00`);
  startTransition(async () => {
    const result = await mergeExternalDeliveriesAction(armadaId, deliveries.map((d) => d.DeliveryOrderID), jamJadwal);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onDone();
  });
}
```

Add a new `conflict` state to `MergeExternalDialog`, insert the check before calling `mergeExternalDeliveriesAction`, and extract the actual merge call into its own function so both "no conflict" and "user confirmed" paths can call it:

```ts
const [conflict, setConflict] = useState<ArmadaConflictInfo | null>(null);

function doMerge(jamJadwal: Date) {
  if (armadaId == null) return;
  startTransition(async () => {
    const result = await mergeExternalDeliveriesAction(armadaId, deliveries.map((d) => d.DeliveryOrderID), jamJadwal);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onDone();
  });
}

function handleSubmit() {
  if (armadaId == null || deliveries.length === 0) return;
  setError(null);
  const jamJadwal = !timeEdited && defaultJamJadwal ? defaultJamJadwal : new Date(`${date}T${time}:00`);
  startTransition(async () => {
    const check = await checkArmadaConflictAction(armadaId, jamJadwal, totalKantong, null);
    if (check) {
      setConflict(check);
      return;
    }
    doMerge(jamJadwal);
  });
}
```

`totalKantong` is already computed in this component (`const totalKantong = deliveries.reduce((sum, d) => sum + d.TotalKantong, 0);`) — reuse it as `candidateQty`. `excludeJadwalId` is `null` here since this flow always creates or appends into an existing Draft, never retiming an existing one.

Render the dialog at the end of `MergeExternalDialog`'s JSX, as a sibling after the closing `</Dialog>`:

```tsx
{conflict && (
  <ArmadaConflictDialog
    conflict={conflict}
    onCancel={() => setConflict(null)}
    onConfirm={() => {
      const jamJadwal = !timeEdited && defaultJamJadwal ? defaultJamJadwal : new Date(`${date}T${time}:00`);
      setConflict(null);
      doMerge(jamJadwal);
    }}
  />
)}
```

Add the two new imports at the top of `pengiriman-board.tsx`:

```ts
import { ArmadaConflictDialog } from "@/components/dashboard/armada-conflict-dialog";
import { checkArmadaConflictAction } from "@/app/(dashboard)/delivery/actions"; // add to the existing import block from this path
import type { ArmadaConflictInfo } from "@/lib/queries/pengiriman-jadwal"; // add to the existing import block from this path
```

- [ ] **Step 1: Apply the changes above**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx
git commit -m "Add armada-conflict confirmation to Gabungkan jadi Jadwal"
```

---

### Task 5: Integrate into "Buat keberangkatan baru" (`JadwalDraftDialog`)

**Files:**
- Modify: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- Consumes: `checkArmadaConflictAction`, `ArmadaConflictDialog` (already imported by Task 4, same file).

Same file as Task 4 — the component whose `handleSubmit` looked like this (the dialog titled "Keberangkatan Baru"):

```ts
function handleSubmit() {
  if (armadaId == null || selected.size === 0) return;
  setError(null);
  startTransition(async () => {
    const result = await createJadwalDraftAction({
      armadaId,
      jamJadwal: resolveBusinessDateTime(businessDate, time),
      salesOrderIds: [...selected],
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
  });
}
```

Apply the same conflict-check-then-confirm restructuring, using `selectedQty` (already computed in this component) as `candidateQty`:

```ts
const [conflict, setConflict] = useState<ArmadaConflictInfo | null>(null);

function doCreate(jamJadwal: Date) {
  if (armadaId == null) return;
  startTransition(async () => {
    const result = await createJadwalDraftAction({
      armadaId,
      jamJadwal,
      salesOrderIds: [...selected],
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
  });
}

function handleSubmit() {
  if (armadaId == null || selected.size === 0) return;
  setError(null);
  const jamJadwal = resolveBusinessDateTime(businessDate, time);
  startTransition(async () => {
    const check = await checkArmadaConflictAction(armadaId, jamJadwal, selectedQty, null);
    if (check) {
      setConflict(check);
      return;
    }
    doCreate(jamJadwal);
  });
}
```

Render, as a sibling after this component's own `</Dialog>` closing tag:

```tsx
{conflict && (
  <ArmadaConflictDialog
    conflict={conflict}
    onCancel={() => setConflict(null)}
    onConfirm={() => {
      setConflict(null);
      doCreate(resolveBusinessDateTime(businessDate, time));
    }}
  />
)}
```

- [ ] **Step 1: Apply the changes above**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx
git commit -m "Add armada-conflict confirmation to buat keberangkatan baru"
```

---

### Task 6: Integrate into drag-and-drop (`handleDragEnd`)

**Files:**
- Modify: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- Consumes: `checkArmadaConflictAction`, `ArmadaConflictDialog` (already imported by Task 4).

This is the top-level board component's own `handleDragEnd` (NOT inside a sub-dialog like Tasks 4-5 — its confirm dialog needs board-level state). Current code:

```ts
function handleDragEnd(event: DragEndEvent) {
  const jadwalId = event.active.data.current?.jadwalId as number | undefined;
  if (jadwalId == null) return;

  const current = jadwal.find((j) => j.JadwalID === jadwalId);
  if (!current) return;

  const overId = event.over?.id;
  const targetArmadaId =
    typeof overId === "string" && overId.startsWith("armada-") ? Number(overId.slice("armada-".length)) : current.ArmadaID;

  let newTime: string | null = null;
  if (event.delta.x !== 0) {
    const currentHour = hourFraction(current.JamJadwal);
    const deltaHours = event.delta.x / hourWidth;
    const newTimelineHour = Math.min(23.75, Math.max(0, Math.round((currentHour + deltaHours) * 4) / 4));
    const actualHour = (newTimelineHour + ROLLOVER_HOUR) % 24;
    const hour = Math.floor(actualHour);
    const minute = Math.round((actualHour - hour) * 60);
    newTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  if (targetArmadaId === current.ArmadaID && newTime == null) return;

  startTransition(async () => {
    if (targetArmadaId !== current.ArmadaID) {
      const result = await updateJadwalArmadaAction(
        jadwalId,
        targetArmadaId,
        newTime != null ? resolveBusinessDateTime(businessDate, newTime) : undefined
      );
      if (!result.success) {
        toast.error(result.error);
        return;
      }
    } else if (newTime != null) {
      const result = await updateJadwalDriverTimeAction(jadwalId, {
        jamJadwal: resolveBusinessDateTime(businessDate, newTime),
        salesmanId: current.SalesmanID,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
    }
  });
}
```

Add board-level state to hold a pending drag-drop's conflict, plus what to do if confirmed. Since the two branches (`updateJadwalArmadaAction` vs `updateJadwalDriverTimeAction`) take different arguments, store enough info in the pending-conflict state to know which one to call on confirm:

```ts
const [dragConflict, setDragConflict] = useState<{
  info: ArmadaConflictInfo;
  jadwalId: number;
  targetArmadaId: number;
  currentArmadaId: number;
  newJamJadwal: Date | undefined; // undefined = time unchanged (pure armada-row move)
  salesmanId: string | null;
} | null>(null);

async function commitDragMove(pending: {
  jadwalId: number;
  targetArmadaId: number;
  currentArmadaId: number;
  newJamJadwal: Date | undefined;
  salesmanId: string | null;
}) {
  if (pending.targetArmadaId !== pending.currentArmadaId) {
    const result = await updateJadwalArmadaAction(pending.jadwalId, pending.targetArmadaId, pending.newJamJadwal);
    if (!result.success) toast.error(result.error);
  } else if (pending.newJamJadwal != null) {
    const result = await updateJadwalDriverTimeAction(pending.jadwalId, {
      jamJadwal: pending.newJamJadwal,
      salesmanId: pending.salesmanId,
    });
    if (!result.success) toast.error(result.error);
  }
}

function handleDragEnd(event: DragEndEvent) {
  const jadwalId = event.active.data.current?.jadwalId as number | undefined;
  if (jadwalId == null) return;

  const current = jadwal.find((j) => j.JadwalID === jadwalId);
  if (!current) return;

  const overId = event.over?.id;
  const targetArmadaId =
    typeof overId === "string" && overId.startsWith("armada-") ? Number(overId.slice("armada-".length)) : current.ArmadaID;

  let newTime: string | null = null;
  if (event.delta.x !== 0) {
    const currentHour = hourFraction(current.JamJadwal);
    const deltaHours = event.delta.x / hourWidth;
    const newTimelineHour = Math.min(23.75, Math.max(0, Math.round((currentHour + deltaHours) * 4) / 4));
    const actualHour = (newTimelineHour + ROLLOVER_HOUR) % 24;
    const hour = Math.floor(actualHour);
    const minute = Math.round((actualHour - hour) * 60);
    newTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  if (targetArmadaId === current.ArmadaID && newTime == null) return;

  const newJamJadwal = newTime != null ? resolveBusinessDateTime(businessDate, newTime) : undefined;
  const candidateStart = newJamJadwal ?? new Date(current.JamJadwal);
  const pending = {
    jadwalId,
    targetArmadaId,
    currentArmadaId: current.ArmadaID,
    newJamJadwal,
    salesmanId: current.SalesmanID,
  };

  startTransition(async () => {
    const check = await checkArmadaConflictAction(targetArmadaId, candidateStart, current.TotalKantong, jadwalId);
    if (check) {
      setDragConflict({ info: check, ...pending });
      return;
    }
    await commitDragMove(pending);
  });
}
```

`excludeJadwalId` is `jadwalId` here (unlike Tasks 4-5's `null`) — the Jadwal being dragged is itself a real Jadwal already in the DB, and `findOverlappingJadwalForArmada` must not treat it as conflicting with itself.

Render, as a sibling near the board's other top-level dialogs (search for where `RouteValidationDialog`/`UbahPemesananDialog` are rendered in this component's return JSX, and add alongside them):

```tsx
{dragConflict && (
  <ArmadaConflictDialog
    conflict={dragConflict.info}
    onCancel={() => setDragConflict(null)}
    onConfirm={() => {
      const pending = dragConflict;
      setDragConflict(null);
      startTransition(async () => {
        await commitDragMove(pending);
      });
    }}
  />
)}
```

- [ ] **Step 1: Apply the changes above**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx
git commit -m "Add armada-conflict confirmation to drag-and-drop"
```

---

### Task 7: Integrate into Validasi Rute date/time editing

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`

**Interfaces:**
- Consumes: `checkArmadaConflictAction`, `ArmadaConflictDialog`, `type ArmadaConflictInfo`.

Add the same 3 imports used in Task 4 to this file's import block.

This file already has `totalQty` computed (used for its own capacity display) and `jadwalIdRef`/`armadaId` in scope — read the actual current file to confirm exact variable names before editing (it has evolved across several tasks this session; the excerpts below are from the plan-writing pass and should match, but confirm).

Add dialog-local state:

```ts
const [conflict, setConflict] = useState<ArmadaConflictInfo | null>(null);
```

**`handleSaveDriverTime`** — current shape:

```ts
function handleSaveDriverTime() {
  if (jadwalId == null) return;
  const targetId = jadwalId;
  setError(null);
  startTransition(async () => {
    const result = await updateJadwalDriverTimeAction(
      targetId,
      { jamJadwal: buildJamJadwal(), salesmanId: driverId || null },
      { skipOrderTimeCheck: true }
    );
    if (!result.success) {
      if (jadwalIdRef.current === targetId) setError(result.error);
      return;
    }
    if (result.data !== targetId) {
      toast.success(`Digabung dengan keberangkatan lain di jam yang sama untuk armada ini.`);
      if (jadwalIdRef.current === targetId) {
        onDeleted?.();
        onOpenChange(false);
      }
    }
  });
}
```

Restructure into a check-then-commit shape, extracting the actual save into `doSaveDriverTime`:

```ts
function doSaveDriverTime(targetId: number, jamJadwal: Date) {
  startTransition(async () => {
    const result = await updateJadwalDriverTimeAction(
      targetId,
      { jamJadwal, salesmanId: driverId || null },
      { skipOrderTimeCheck: true }
    );
    if (!result.success) {
      if (jadwalIdRef.current === targetId) setError(result.error);
      return;
    }
    if (result.data !== targetId) {
      toast.success(`Digabung dengan keberangkatan lain di jam yang sama untuk armada ini.`);
      if (jadwalIdRef.current === targetId) {
        onDeleted?.();
        onOpenChange(false);
      }
    }
  });
}

function handleSaveDriverTime() {
  if (jadwalId == null || armadaId == null) return;
  const targetId = jadwalId;
  const jamJadwal = buildJamJadwal();
  setError(null);
  startTransition(async () => {
    const check = await checkArmadaConflictAction(armadaId, jamJadwal, totalQty, targetId);
    if (jadwalIdRef.current !== targetId) return;
    if (check) {
      setConflict(check);
      return;
    }
    doSaveDriverTime(targetId, jamJadwal);
  });
}
```

Read the file to confirm `armadaId` is actually in scope in this component (it's used elsewhere in this file per earlier reads, e.g. capacity display) — if it's named differently, adjust accordingly.

**`handleSelesaiMuat`** — apply the identical check-then-commit restructuring around its own `updateJadwalDriverTimeAction` call (the FIRST of its two sequential awaited calls — `selesaiMuatAction` afterward is unaffected, it doesn't touch armada scheduling). Read the current full function before editing; extract the driver-time-save portion into a `doSaveDriverTimeThenSelesaiMuat(targetId, jamJadwal)` helper (or reuse `doSaveDriverTime` if its shape fits — but `handleSelesaiMuat` continues on to `selesaiMuatAction` afterward on success, which `doSaveDriverTime` does not do, so this needs its own small helper, not literal reuse) that runs the existing post-save logic (the fold-into-another-Draft toast/close, or on non-folded success, proceeding to `selesaiMuatAction` and the invoice-printing loop), guarded by the same `checkArmadaConflictAction` pre-check pattern shown above.

Render the dialog once, near this component's other dialog-closing JSX (e.g. right before or after the vehicle-check dialog render, inside the outer `<Dialog>`'s content but as a sibling — a nested `Dialog` inside `DialogContent` is fine, this codebase already does this elsewhere for similar cases):

```tsx
{conflict && (
  <ArmadaConflictDialog
    conflict={conflict}
    onCancel={() => setConflict(null)}
    onConfirm={() => {
      if (jadwalId == null) return;
      const targetId = jadwalId;
      setConflict(null);
      doSaveDriverTime(targetId, buildJamJadwal());
    }}
  />
)}
```

Note: since `handleSelesaiMuat`'s check shares the same `conflict` state, its `onConfirm` needs to know which of the two flows (`doSaveDriverTime` vs the `handleSelesaiMuat` variant) triggered the pending conflict. Add a small discriminant, e.g. store `{ info: ArmadaConflictInfo; then: "save" | "selesaiMuat" }` in the state instead of a bare `ArmadaConflictInfo`, and branch in `onConfirm` accordingly.

- [ ] **Step 1: Apply the changes above to both handlers**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx
git commit -m "Add armada-conflict confirmation to Validasi Rute date/time editing"
```

---

### Task 8: Integrate into Buat Pemesanan

**Files:**
- Modify: `src/components/dashboard/pemesanan-form-dialog.tsx`

**Interfaces:**
- Consumes: `checkArmadaConflictAction`, `ArmadaConflictDialog`, `type ArmadaConflictInfo`.

Only the NON-take-away branch needs this (`isTakeAway` orders don't get scheduled onto an armada at all). Current `handleSubmit`:

```ts
function handleSubmit() {
  if (!canSubmit || !mitra) return;
  setError(null);
  startTransition(async () => {
    if (isTakeAway) {
      const result = await createTakeAwayPemesananAction({
        businessPartnerId: mitra.BusinessPartnerID,
        variant,
        qtyKantong: qtyNumber,
        bonusQty: bonusQtyNumber,
        deliveryDateTime: new Date(`${date}T${time}:00`),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      window.open(`/api/print/delivery-order/${result.data.deliveryOrderId}`, "_blank");
    } else {
      const result = await createPemesananAction({
        businessPartnerId: mitra.BusinessPartnerID,
        variant,
        qtyKantong: qtyNumber,
        bonusQty: bonusQtyNumber,
        deliveryDateTime: new Date(`${date}T${time}:00`),
        armadaId: Number(armadaId),
        salesmanId: salesmanId === UNSET ? null : salesmanId,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
    }
    handleOpenChange(false);
  });
}
```

Add state and restructure the non-take-away branch:

```ts
const [conflict, setConflict] = useState<ArmadaConflictInfo | null>(null);

function doCreatePemesanan() {
  if (!mitra) return;
  startTransition(async () => {
    const result = await createPemesananAction({
      businessPartnerId: mitra.BusinessPartnerID,
      variant,
      qtyKantong: qtyNumber,
      bonusQty: bonusQtyNumber,
      deliveryDateTime: new Date(`${date}T${time}:00`),
      armadaId: Number(armadaId),
      salesmanId: salesmanId === UNSET ? null : salesmanId,
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    handleOpenChange(false);
  });
}

function handleSubmit() {
  if (!canSubmit || !mitra) return;
  setError(null);
  if (isTakeAway) {
    startTransition(async () => {
      const result = await createTakeAwayPemesananAction({
        businessPartnerId: mitra.BusinessPartnerID,
        variant,
        qtyKantong: qtyNumber,
        bonusQty: bonusQtyNumber,
        deliveryDateTime: new Date(`${date}T${time}:00`),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      window.open(`/api/print/delivery-order/${result.data.deliveryOrderId}`, "_blank");
      handleOpenChange(false);
    });
    return;
  }
  const candidateQty = qtyNumber + bonusQtyNumber;
  startTransition(async () => {
    const check = await checkArmadaConflictAction(Number(armadaId), new Date(`${date}T${time}:00`), candidateQty, null);
    if (check) {
      setConflict(check);
      return;
    }
    doCreatePemesanan();
  });
}
```

Render, as a sibling after this component's own `</Dialog>`:

```tsx
{conflict && (
  <ArmadaConflictDialog conflict={conflict} onCancel={() => setConflict(null)} onConfirm={() => { setConflict(null); doCreatePemesanan(); }} />
)}
```

- [ ] **Step 1: Apply the changes above**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pemesanan-form-dialog.tsx
git commit -m "Add armada-conflict confirmation to Buat Pemesanan"
```

---

### Task 9: Integrate into Ubah Pemesanan

**Files:**
- Modify: `src/components/dashboard/ubah-pemesanan-dialog.tsx`

**Interfaces:**
- Consumes: `checkArmadaConflictAction`, `ArmadaConflictDialog`, `type ArmadaConflictInfo`.

Current `handleSubmit` (already has the stale-race guard from the error-handling rollout's final review — preserve `targetIdRef` checks exactly):

```ts
function handleSubmit() {
  if (!target || !canSubmit) return;
  const targetId = target.salesOrderId;
  setError(null);
  startTransition(async () => {
    if (initialQty10KG != null && Number(qty10KG) !== initialQty10KG) {
      const result = await updateSalesOrderQtyAction(targetId, "10kg", Number(qty10KG));
      if (targetIdRef.current !== targetId) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
    }
    if (initialQty5KG != null && Number(qty5KG) !== initialQty5KG) {
      const result = await updateSalesOrderQtyAction(targetId, "5kg", Number(qty5KG));
      if (targetIdRef.current !== targetId) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
    }
    const result = await reschedulePemesananAction({
      salesOrderId: targetId,
      armadaId: Number(armadaId),
      deliveryDateTime: new Date(`${date}T${time}:00`),
      salesmanId: salesmanId === UNSET ? null : salesmanId,
    });
    if (targetIdRef.current !== targetId) return;
    if (!result.success) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
  });
}
```

Extract the qty-updates + reschedule tail into its own function so the conflict-check can sit in front of just the reschedule step (the qty updates themselves don't move the Jadwal, only `reschedulePemesananAction` does):

```ts
const [conflict, setConflict] = useState<ArmadaConflictInfo | null>(null);

async function applyQtyChanges(targetId: string): Promise<boolean> {
  if (initialQty10KG != null && Number(qty10KG) !== initialQty10KG) {
    const result = await updateSalesOrderQtyAction(targetId, "10kg", Number(qty10KG));
    if (targetIdRef.current !== targetId) return false;
    if (!result.success) {
      setError(result.error);
      return false;
    }
  }
  if (initialQty5KG != null && Number(qty5KG) !== initialQty5KG) {
    const result = await updateSalesOrderQtyAction(targetId, "5kg", Number(qty5KG));
    if (targetIdRef.current !== targetId) return false;
    if (!result.success) {
      setError(result.error);
      return false;
    }
  }
  return true;
}

function doReschedule(targetId: string) {
  startTransition(async () => {
    const result = await reschedulePemesananAction({
      salesOrderId: targetId,
      armadaId: Number(armadaId),
      deliveryDateTime: new Date(`${date}T${time}:00`),
      salesmanId: salesmanId === UNSET ? null : salesmanId,
    });
    if (targetIdRef.current !== targetId) return;
    if (!result.success) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
  });
}

function handleSubmit() {
  if (!target || !canSubmit) return;
  const targetId = target.salesOrderId;
  setError(null);
  startTransition(async () => {
    const qtyOk = await applyQtyChanges(targetId);
    if (!qtyOk || targetIdRef.current !== targetId) return;

    // Combined kantong-equivalent, matching JADWAL_KANTONG_EXPR's 5KG-halving
    // convention used everywhere else in this file/app.
    const candidateQty = (Number(qty10KG) || 0) + (Number(qty5KG) || 0) / 2;
    const deliveryDateTime = new Date(`${date}T${time}:00`);
    const check = await checkArmadaConflictAction(Number(armadaId), deliveryDateTime, candidateQty, null);
    if (targetIdRef.current !== targetId) return;
    if (check) {
      setConflict(check);
      return;
    }
    doReschedule(targetId);
  });
}
```

Note `excludeJadwalId` is `null` here (not the Jadwal's own id) — this flow doesn't know the SO's *current* JadwalID at this point without an extra lookup, and `reschedulePemesananAction` internally handles the "already on the right Jadwal" case itself via `findDraftJadwalByArmadaAndTime`; treating it as `null` here means the confirmation may show up slightly more often than strictly necessary in the (uncommon) case of rescheduling to the SAME slot it's already on, which is an acceptable false-positive for a decision-support dialog, not a correctness bug.

Render, as a sibling after this component's own `</Dialog>`:

```tsx
{conflict && (
  <ArmadaConflictDialog
    conflict={conflict}
    onCancel={() => setConflict(null)}
    onConfirm={() => {
      if (!target) return;
      const targetId = target.salesOrderId;
      setConflict(null);
      doReschedule(targetId);
    }}
  />
)}
```

- [ ] **Step 1: Apply the changes above**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/ubah-pemesanan-dialog.tsx
git commit -m "Add armada-conflict confirmation to Ubah Pemesanan"
```

---

### Task 10: Full verification pass

**Files:**
- None created — this task verifies Tasks 1-9 together.

**Interfaces:**
- Consumes: everything from Tasks 1-9.

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: zero errors anywhere in the project.

- [ ] **Step 2: Full lint**

Run: `npx eslint`
Expected: zero errors; any warnings must be pre-existing (check against `git stash`/`git diff` if in doubt — do not introduce new warnings in the 5 touched files).

- [ ] **Step 3: Manual/static verification of at least 2 flows**

Pick one simple flow (Gabungkan jadi Jadwal or buat keberangkatan baru) and one complex flow (Buat Pemesanan or Ubah Pemesanan). If the dev server's login can be reached (start it via the project's `.claude/launch.json` "dev" config), manually trigger a real armada-double-booking scenario for each and confirm the popup shows correct quantities and the capacity-exceeded case disables "Gabungkan". If login access is unavailable in this environment (a constraint that recurred throughout this session's prior plan), do a careful static trace instead: read each flow's final code end-to-end and confirm the conflict-check → dialog → confirm → commit sequence is wired correctly and no path skips the check.

- [ ] **Step 4: Confirm Terbit-conflict behavior is unchanged**

Read `updateJadwalDriverTime`, `updateJadwalArmada`, `createJadwalDraft`, and `mergeExternalDeliveriesIntoJadwal` in `src/lib/queries/pengiriman-jadwal.ts` one more time — confirm none of them were modified by this plan (Task 1 only ADDED `checkArmadaConflict` as a new function; it must not have touched any existing function's body). `git diff` against the plan's start commit for this file and confirm the diff is purely additive.

- [ ] **Step 5: Commit any fixes found during verification**

If Steps 1-4 required any code changes to pass, commit them individually with descriptive messages before considering this plan complete. If everything already passed, no commit is needed for this task.
