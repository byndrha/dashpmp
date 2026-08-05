# Server Action Error-Handling Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every "use server" action whose underlying logic can throw a deliberate, user-facing validation error returns that message to the client unredacted in production, instead of React's generic "An error occurred in the Server Components render..." text — while genuinely unexpected errors stay safely generic.

**Architecture:** A new `AppError` class marks "this message is safe and meant for the user." A `runAction` wrapper catches thrown errors at the action layer: `AppError` instances pass their `.message` through as a plain return value (`ActionResult<T>`, never `throw`n, so React's RSC redaction never touches it); anything else is logged server-side and replaced with a safe generic message. Every existing `throw new Error(...)` across the app (115 sites) is renamed to `throw new AppError(...)` — pure rename, message text unchanged. Every action whose body (directly or transitively) can throw `AppError` gets wrapped in `runAction`; read-only actions that never throw stay exactly as they are. Every client call site of a wrapped action changes from `try/catch` to checking `result.success`.

**Tech Stack:** Next.js 16 App Router Server Actions, `unstable_rethrow` from `next/navigation` (required so `redirect()`/`notFound()` calls inside guarded actions keep working instead of being swallowed).

## Global Constraints

- `AppError` and `ActionResult<T>` live in one new file: `src/lib/action-result.ts`. No other new files.
- `runAction`'s `catch` block calls `unstable_rethrow(err)` as its very first statement, before any other check — required because `requireModuleAccess`, `requireGrupAccess`, `requirePmputra`, `requireSuperAdmin`, `requireSatpam` (`src/lib/require-access.ts`) call Next's `redirect()` internally, which throws a special control-flow error that must NOT be treated as an application failure.
- Only rename existing `throw new Error(msg)` to `throw new AppError(msg)` — the message string itself never changes in this plan.
- Only wrap an action in `runAction` if its body, or a function it calls (however many layers deep), contains a `throw new AppError`. An action that never throws a custom error (a plain read-only `SELECT`) keeps its current `Promise<T>` signature and is NOT touched — wrapping it would add churn with no benefit and force its callers to handle a `result.success` check that can never meaningfully be false.
- The generic fallback message for a non-`AppError` exception is always exactly: `"Terjadi kesalahan tak terduga. Silakan coba lagi."`
- Every non-`AppError` exception must still be logged server-side via `console.error(err)` before returning the generic message — this preserves today's existing server-log visibility (nothing about error observability gets worse).
- This plan does not touch `src/app/api/lokasi/actions.ts` (its one action, `recordLokasiAction`, never throws — it silently no-ops without a session, confirmed by reading the file) — no task needed there.
- This plan does not touch `error.tsx` at the `(dashboard)` route group level, `src/proxy.ts`, or NextAuth — out of scope.
- This project has no test runner (no vitest/jest) — verification is `npx tsc --noEmit`, `npx eslint`, and manual browser checks, per every other plan this session.

---

### Task 1: `action-result.ts` foundation

**Files:**
- Create: `src/lib/action-result.ts`

**Interfaces:**
- Produces: `export class AppError extends Error {}`, `export type ActionResult<T> = { success: true; data: T } | { success: false; error: string }`, `export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>>` — every later task imports these three names from `@/lib/action-result`.

- [ ] **Step 1: Write the file**

```ts
import { unstable_rethrow } from "next/navigation";

// Marks a thrown error's message as deliberately written for the end
// user (a business-validation failure, e.g. "Total muatan melebihi
// kapasitas maksimum armada") — runAction lets an AppError's .message
// reach the client as plain data, bypassing React's production RSC
// error redaction (which otherwise replaces EVERY thrown error's
// message with a generic "An error occurred in the Server Components
// render..." string, confirmed by reading
// node_modules/next/dist/compiled/react-server-dom-webpack/cjs/
// react-server-dom-webpack-client.node.production.js's resolveErrorProd()).
// Any error that is NOT an AppError is assumed unsafe to show verbatim
// (could be a raw SQL error, a stack trace, internal schema detail) and
// gets a safe generic message instead — the same protection the React
// redaction gave, just phrased in plain Indonesian instead of a
// confusing framework message.
export class AppError extends Error {}

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    // Several actions call requireModuleAccess/requirePmputra/etc (see
    // src/lib/require-access.ts), which redirect() on failure — redirect()
    // works by throwing a special Next.js control-flow error tagged with a
    // "NEXT_REDIRECT" digest. unstable_rethrow detects that (and
    // notFound()'s equivalent) and rethrows it untouched so Next.js's own
    // machinery still performs the redirect, instead of it being caught
    // here and turned into a "Terjadi kesalahan tak terduga" response.
    // Must be the first line of the catch block per Next's own docs
    // (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
    // unstable_rethrow.md).
    unstable_rethrow(err);
    if (err instanceof AppError) return { success: false, error: err.message };
    console.error(err);
    return { success: false, error: "Terjadi kesalahan tak terduga. Silakan coba lagi." };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (this file has no consumers yet, so it can't break anything else).

- [ ] **Step 3: Commit**

```bash
git add src/lib/action-result.ts
git commit -m "Add AppError/ActionResult/runAction foundation for action error handling"
```

---

### Task 2: Rename all 115 `throw new Error` to `throw new AppError`

**Files:**
- Modify (add `import { AppError } from "@/lib/action-result";` + rename `throw new Error(` → `throw new AppError(` at every line below — message text unchanged):

**`src/lib/queries/*.ts`** (59 occurrences, 13 files):
- `armada-activity.ts`:40, `:67`
- `akun.ts` (2 occurrences — locate via `grep -n "throw new Error" src/lib/queries/akun.ts`)
- `keuangan-detail-pmputra.ts`:27, `:157-159`
- `marketing-wilayah.ts`:110, `:234`
- `mitra-pengajuan.ts`:225
- `notifications.ts` (1 occurrence)
- `pelunasan.ts`:97
- `perusahaan-koneksi.ts`:99
- `pengiriman-jadwal.ts` (34 occurrences) — includes but is not limited to: `:461` (`assertWithinCapacity`, "Total muatan..."), `:483` (`assertJamJadwalNotBeforeOrders`), `:809`, `:906`, `:926`, `:951`, `:1003`, `:1040`, `:1041`, `:1117`, `:1118`, `:1144`, `:1181`, `:1182`, `:1193`, `:1212`, `:1355`, `:1356`, `:1357`, `:1365`, `:1368`, `:1379`, `:1412`, `:1425`, `:1437`, `:1462`, `:1603`, `:1604`, `:1605`, `:1612`, `:1622`, `:1640` — every `throw new Error` in this file, found via `grep -n "throw new Error" src/lib/queries/pengiriman-jadwal.ts`
- `sales-order.ts` (8 occurrences) — includes `:175`, `:176`, `:190`, `:191`, `:196`, `:261`, `:321`, `:330`, `:341`
- `pemesanan.ts` (2 occurrences)
- `takeaway.ts`:102
- `vehicle-check.ts`:99, `:107-111`

**`src/app/**/actions.ts`** (56 occurrences, 12 files — exact messages already catalogued; use `grep -n "throw new Error" <file>` on each to find every line, since some files have local helper functions like `assertValid`/`requireApprover`/`requireWilayahManager` whose throws also count):
- `src/app/(dashboard)/transaksi/actions.ts` (2)
- `src/app/grup/perusahaan/actions.ts` (5, including the local `assertValid()` helper)
- `src/app/grup/akun/actions.ts` (10)
- `src/app/grup/akun/peran/actions.ts` (3)
- `src/app/(dashboard)/mitra/actions.ts` (3)
- `src/app/(dashboard)/profile-actions.ts` (4)
- `src/app/(dashboard)/delivery/actions.ts` (5 — all inside `createVehicleCheckAction`)
- `src/app/(dashboard)/pemasaran/actions.ts` (11, including the local `requireApprover()`/`requireWilayahManager()` helpers)
- `src/app/(dashboard)/aging/actions.ts` (5)
- `src/app/(dashboard)/sales/actions.ts` (1)
- `src/app/pmputra/keuangan/actions.ts` (1)
- `src/app/(dashboard)/pnl/actions.ts` (6)

**Interfaces:**
- Consumes: `AppError` from Task 1.
- Produces: every `throw` site above is now `AppError`, ready for later tasks' `runAction` wrapping and `instanceof AppError` handling. No function signatures change in this task — only the thrown class.

This is a pure mechanical rename with zero behavior change (an `AppError` still `instanceof Error`, still has the same `.message`, and propagates through `await` calls exactly like a plain `Error` did). Do it as one pass across all files rather than splitting by feature area — there is nothing feature-specific to review here, only "is every `throw new Error` in these two layers now `throw new AppError`, with the import added, and no message text altered."

- [ ] **Step 1: Find every occurrence to confirm the count**

Run: `grep -rn "throw new Error" src/app/**/actions.ts src/app/(dashboard)/profile-actions.ts src/lib/queries/*.ts | wc -l`
Expected: `115` (56 + 59). If the count differs, list the files where it differs before proceeding — the ledger/brief's file list above may be missing a file if the count is higher, or a file may have been touched since the plan was written if lower.

- [ ] **Step 2: Rename in every file listed above**

For each file: add `import { AppError } from "@/lib/action-result";` near its other imports (if the file already imports from `@/lib/action-result` for any reason, just add `AppError` to the existing import), then replace every `throw new Error(` with `throw new AppError(` — leave everything else on each line (the message, the trailing `);`, surrounding code) completely unchanged.

- [ ] **Step 3: Verify no `throw new Error` remains in scope**

Run: `grep -rn "throw new Error" src/app/**/actions.ts src/app/(dashboard)/profile-actions.ts src/lib/queries/*.ts`
Expected: no output (all renamed to `AppError`).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors — `AppError extends Error`, so every existing catch/usage still type-checks unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/app/**/actions.ts "src/app/(dashboard)/profile-actions.ts" src/lib/queries/*.ts
git commit -m "Rename throw new Error to throw new AppError across all action/query throw sites"
```

---

### Task 3: `delivery/actions.ts` — wrap qualifying actions

**Files:**
- Modify: `src/app/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: `AppError` (renamed in Task 2), `runAction`/`ActionResult` from `@/lib/action-result` (Task 1).
- Produces: the new return types below — consumed by Tasks 4, 5, 6 (this file's callers).

Add `import { runAction, type ActionResult } from "@/lib/action-result";` (alongside the already-added `AppError` import from Task 2).

Wrap every action whose body or callee can throw `AppError` (skip the read-only ones — they keep `Promise<T>` unchanged). Canonical example (apply the exact same transformation shape to every function in the table below):

```ts
// Before
export async function mergeExternalDeliveriesAction(
  armadaId: number,
  deliveryOrderIds: string[],
  jamJadwal: Date
): Promise<number> {
  const id = await mergeExternalDeliveriesIntoJadwal(armadaId, deliveryOrderIds, jamJadwal);
  revalidatePath("/delivery");
  return id;
}

// After
export async function mergeExternalDeliveriesAction(
  armadaId: number,
  deliveryOrderIds: string[],
  jamJadwal: Date
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const id = await mergeExternalDeliveriesIntoJadwal(armadaId, deliveryOrderIds, jamJadwal);
    revalidatePath("/delivery");
    return id;
  });
}
```

Apply this same shape (old body moves verbatim inside `runAction(async () => { ... })`, return type `Promise<T>` becomes `Promise<ActionResult<T>>`) to each of these functions — every one of them calls something that can throw `AppError`, per the Task 2 rename:

| Function | Old return type | New return type |
|---|---|---|
| `createArmadaAction` | `Promise<number>` | `Promise<ActionResult<number>>` |
| `updateArmadaAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `deleteArmadaAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `createJadwalDraftAction` | `Promise<number>` | `Promise<ActionResult<number>>` |
| `deleteJadwalDraftAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `addSalesOrdersToJadwalAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `removeSalesOrderFromJadwalAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `updateJadwalUrutanAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `updateJadwalDriverTimeAction` | `Promise<number>` | `Promise<ActionResult<number>>` |
| `updateJadwalArmadaAction` | `Promise<number>` | `Promise<ActionResult<number>>` |
| `mergeExternalDeliveriesAction` | `Promise<number>` | `Promise<ActionResult<number>>` |
| `startMuatAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `selesaiMuatAction` | `Promise<{ jadwalDetailId: number; invoiceToken: string }[]>` | `Promise<ActionResult<{ jadwalDetailId: number; invoiceToken: string }[]>>` |
| `konfirmasiBerangkatAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `createArmadaActivityAction` | `Promise<number>` | `Promise<ActionResult<number>>` |
| `updateArmadaActivityAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `deleteArmadaActivityAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `saveDriverProfileAction` | `Promise<void>` | `Promise<ActionResult<void>>` — note: this one calls `requireModuleAccess` before the `runAction` call; keep that call OUTSIDE `runAction` (unchanged, still redirects normally on its own — it's a `redirect()`, not a throw the wrapper needs to catch, and calling it inside `runAction` would work too since `unstable_rethrow` handles it, but keeping the existing guard-then-runAction order matches every other action below and is simplest) |
| `deleteDriverProfileAction` | `Promise<void>` | `Promise<ActionResult<void>>` (same `requireModuleAccess`-outside note) |
| `createVehicleCheckAction` | `Promise<void>` | `Promise<ActionResult<void>>` (same `requireModuleAccess`-outside note; this one throws directly in its own body too — those throws are already `AppError` from Task 2, `runAction` catches them exactly the same as a transitive throw) |

Do NOT touch these — they never throw and stay exactly as they are:
`getMaxSalesOrderTransDateForDeliveriesAction`, `getJadwalDetailAction`, `getAvailableSalesOrdersAction`, `getArmadaActivitiesAction`, `getDriverProfilesAction`, `getVehicleChecksForJadwalAction`.

- [ ] **Step 1: Apply the wrapping to all 19 functions in the table**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: new errors will appear, but ONLY in this file's callers (Tasks 4-6 haven't run yet) — confirm every reported error is in one of `pengiriman-board.tsx`, `route-validation-dialog.tsx`, `armada-dialog.tsx`, `driver-manager.tsx`, or `live-inspeksi-client.tsx`, and that `src/app/(dashboard)/delivery/actions.ts` itself has zero errors. This file's own correctness is what this task verifies; the callers get fixed in the next three tasks.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/delivery/actions.ts"
git commit -m "Wrap delivery actions.ts's throwing actions in runAction"
```

---

### Task 4: `pengiriman-board.tsx` — update callers

**Files:**
- Modify: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- Consumes: the new `ActionResult<T>`-returning signatures from Task 3.

Update every call site below. The general transformation (canonical example, matching the `handleSubmit` function already shown in the design spec):

```ts
// Before
startTransition(async () => {
  try {
    await mergeExternalDeliveriesAction(armadaId, deliveries.map((d) => d.DeliveryOrderID), jamJadwal);
    onOpenChange(false);
    onDone();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Gagal menggabungkan pengiriman.");
  }
});

// After
startTransition(async () => {
  const result = await mergeExternalDeliveriesAction(armadaId, deliveries.map((d) => d.DeliveryOrderID), jamJadwal);
  if (!result.success) {
    setError(result.error);
    return;
  }
  onOpenChange(false);
  onDone();
});
```

Apply the same shape to each of these (file:line references are from before Task 3's edits — re-locate by function/action name if line numbers have drifted):

1. **Line ~196, `createJadwalDraftAction`** inside its own `try/catch { setError(...) }` — same transformation.
2. **Line ~356, `mergeExternalDeliveriesAction`** — exactly the canonical example above.
3. **Lines ~677/684, `createArmadaActivityAction`/`updateArmadaActivityAction`** — each in its own `try/catch { setError(...) }` — same transformation, checking `result.success` before proceeding.
4. **Line ~705, `deleteArmadaActivityAction`** — same transformation.
5. **Line ~976, `updateArmadaAction`** (in a different handler, `setEditError` instead of `setError`) — same transformation using `setEditError(result.error)`.
6. **Lines ~1340/1347, `handleDragEnd`** — this one calls BOTH `updateJadwalArmadaAction` and `updateJadwalDriverTimeAction` inside one `try/catch { toast.error(...) }`. Transform to:
   ```ts
   const result1 = await updateJadwalArmadaAction(/* existing args */);
   if (!result1.success) {
     toast.error(result1.error);
     return;
   }
   const result2 = await updateJadwalDriverTimeAction(/* existing args, using result1.data if it was used before */);
   if (!result2.success) {
     toast.error(result2.error);
     return;
   }
   // rest of the handler continues using result2.data where the old code used the awaited value
   ```
   Read the actual current code at this call site first (both calls' exact argument lists and how their return values were previously used, if at all) before writing the replacement — preserve every existing argument and post-call behavior exactly, only changing the error-detection mechanism.

Leave `getAvailableSalesOrdersAction` (line ~170) and `getMaxSalesOrderTransDateForDeliveriesAction` (line ~330) completely untouched — they were never wrapped (Task 3 skipped them, they're read-only), so their `.then(...)` call sites need no change.

- [ ] **Step 1: Apply all 6 transformations above**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors remaining in `pengiriman-board.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx
git commit -m "Update pengiriman-board.tsx to consume ActionResult from delivery actions"
```

---

### Task 5: `route-validation-dialog.tsx` — update callers

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`

**Interfaces:**
- Consumes: the new `ActionResult<T>`-returning signatures from Task 3.

This file has the most call sites and the trickiest ones (return-value comparisons). Read the actual current file content for the exact surrounding code (the excerpt below was confirmed by reading lines 426-583 directly) before editing — variable names like `printSelected`, `driverId`, `onDeleted` must be preserved exactly as they exist in the file.

Transform each handler:

**`handleDragEnd`** (line ~436-442) — simple case, same shape as the canonical example in Task 4:
```ts
startTransition(async () => {
  const result = await updateJadwalUrutanAction(jadwalId, next.map((d) => d.JadwalDetailID));
  if (!result.success) {
    setError(result.error);
  }
});
```

**`handleSaveDriverTime`** (line ~452-471) — return value IS compared (`resultId !== jadwalId`):
```ts
startTransition(async () => {
  const result = await updateJadwalDriverTimeAction(
    jadwalId,
    { jamJadwal: buildJamJadwal(), salesmanId: driverId || null },
    { skipOrderTimeCheck: true }
  );
  if (!result.success) {
    setError(result.error);
    return;
  }
  if (result.data !== jadwalId) {
    toast.success(`Digabung dengan keberangkatan lain di jam yang sama untuk armada ini.`);
    onDeleted?.();
    onOpenChange(false);
  }
});
```

**`handleRemoveStop`** (line ~481-494) — two sequential calls, second one (`getJadwalDetailAction`) is UNWRAPPED (read-only, untouched):
```ts
startTransition(async () => {
  const result = await removeSalesOrderFromJadwalAction(jadwalId, detail.SalesOrderID);
  if (!result.success) {
    setError(result.error);
    return;
  }
  if (order.length <= 1) {
    onDeleted?.();
    onOpenChange(false);
    return;
  }
  const rows = await getJadwalDetailAction(jadwalId);
  setOrder(rows);
});
```

**`handleDeleteDraft`** (line ~500-508):
```ts
startTransition(async () => {
  const result = await deleteJadwalDraftAction(jadwalId);
  if (!result.success) {
    setError(result.error);
    return;
  }
  onDeleted?.();
  onOpenChange(false);
});
```

**`handleMuat`** (line ~514-520):
```ts
startTransition(async () => {
  const result = await startMuatAction(jadwalId);
  if (!result.success) {
    setError(result.error);
  }
});
```

**`handleSelesaiMuat`** (line ~540-570) — three sequential calls; the first two are wrapped, the third (`getJadwalDetailAction`) is unwrapped:
```ts
startTransition(async () => {
  const driverTimeResult = await updateJadwalDriverTimeAction(
    jadwalId,
    { jamJadwal: buildJamJadwal(), salesmanId: driverId || null },
    { skipOrderTimeCheck: true }
  );
  if (!driverTimeResult.success) {
    setError(driverTimeResult.error);
    return;
  }
  if (driverTimeResult.data !== jadwalId) {
    toast.success(
      "Waktu ini tumpang tindih dengan keberangkatan lain untuk armada ini — sudah digabung. Buka kembali untuk melanjutkan keberangkatan."
    );
    onDeleted?.();
    onOpenChange(false);
    return;
  }
  const selesaiMuatResult = await selesaiMuatAction(jadwalId);
  if (!selesaiMuatResult.success) {
    setError(selesaiMuatResult.error);
    return;
  }
  for (const t of selesaiMuatResult.data) {
    if (printSelected.has(t.jadwalDetailId)) {
      window.open(`/invoice/${t.invoiceToken}`, "_blank");
    }
  }
  const rows = await getJadwalDetailAction(jadwalId);
  setOrder(rows);
});
```

**`handleKonfirmasiBerangkat`** (line ~576-582):
```ts
startTransition(async () => {
  const result = await konfirmasiBerangkatAction(jadwalId);
  if (!result.success) {
    setError(result.error);
  }
});
```

**`handleConfirmAdd`** (line ~609-618) — first call wrapped, second (`getJadwalDetailAction`) unwrapped:
```ts
startTransition(async () => {
  const result = await addSalesOrdersToJadwalAction(jadwalId, [...selectedToAdd]);
  if (!result.success) {
    setAddError(result.error);
    return;
  }
  const rows = await getJadwalDetailAction(jadwalId);
  setOrder(rows);
  setAdding(false);
});
```

Leave `getJadwalDetailAction` (lines ~314, 331, 489, 565, 612), `getVehicleChecksForJadwalAction` (line ~319), and `getAvailableSalesOrdersAction` (line ~590) completely untouched wherever they appear standalone — none of them were wrapped in Task 3.

- [ ] **Step 1: Apply all 8 handler transformations above**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors remaining in `route-validation-dialog.tsx`.

- [ ] **Step 3: Manual verification (this is the original bug report)**

Start the dev server, open the Papan Pengiriman board, and reproduce a capacity-exceeded merge or drag-drop (any armada with a Draft already close to its `KapasitasMaks`, add enough SO/DO to exceed it). Confirm the error message shown is the exact business message (e.g. `"Total muatan (X kantong) melebihi kapasitas maksimum armada (Y kantong)."`), NOT the generic React text — this is the direct fix for the user's original bug report.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx
git commit -m "Update route-validation-dialog.tsx to consume ActionResult from delivery actions"
```

---

### Task 6: `armada-dialog.tsx` + `driver-manager.tsx` + `live-inspeksi-client.tsx` — update remaining delivery callers

**Files:**
- Modify: `src/components/dashboard/armada-dialog.tsx`
- Modify: `src/components/dashboard/driver-manager.tsx`
- Modify: `src/components/satpam-app/live-inspeksi-client.tsx`

**Interfaces:**
- Consumes: the new `ActionResult<T>`-returning signatures from Task 3.

**`armada-dialog.tsx`**: `createArmadaAction` (line ~345), `updateArmadaAction` (line ~359) — each in its own `try { await ... } catch (err) { setError(...) }`, transform per the canonical Task 4 example (checking `result.success`, calling `setError(result.error)`). `deleteArmadaAction` (line ~372) is in a `try { await ... } catch (err) { alert(...) }` — same shape, `alert(result.error)` instead of `setError`.

**`driver-manager.tsx`**: `saveDriverProfileAction` (line ~107) — `try/catch { setError(...) }`, same transformation. `deleteDriverProfileAction` (line ~267) currently has **no catch at all** — `deleteDriverProfileAction(driver.SalesmanID).finally(() => setDeletingId(null))`. Since this component already has a `setError` (or equivalent) state used by the save handler, add the same error surfacing here:
```ts
// Before
deleteDriverProfileAction(driver.SalesmanID).finally(() => setDeletingId(null));

// After
deleteDriverProfileAction(driver.SalesmanID)
  .then((result) => {
    if (!result.success) setError(result.error);
  })
  .finally(() => setDeletingId(null));
```
(Read the component first to confirm the exact name of its existing error-display state — reuse it rather than introducing a new one.)

**`live-inspeksi-client.tsx`**: `createVehicleCheckAction` (line ~209) — `try/catch { setError(...) }`, same canonical transformation.

- [ ] **Step 1: Apply all transformations above (4 call sites across 3 files)**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors anywhere related to `src/app/(dashboard)/delivery/actions.ts` or its callers — this closes out the entire delivery feature area (Tasks 3-6). Confirm by running the full check and scanning for any remaining reference to these 5 files.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/armada-dialog.tsx src/components/dashboard/driver-manager.tsx src/components/satpam-app/live-inspeksi-client.tsx
git commit -m "Update remaining delivery-action callers to consume ActionResult"
```

---

### Task 7: `akun/actions.ts` + its callers

**Files:**
- Modify: `src/app/grup/akun/actions.ts`
- Modify: `src/components/dashboard/akun-list.tsx`
- Modify: `src/components/dashboard/doc-template-panel.tsx`
- Modify: `src/components/dashboard/pabrik-location-settings.tsx`
- Modify: `src/components/dashboard/site-settings-panel.tsx`

**Interfaces:**
- Produces (in `akun/actions.ts`): wrapped signatures per the table below, consumed by the 4 client files in this same task.

Add the `runAction`/`ActionResult` import (alongside the `AppError` import from Task 2). Wrap:

| Function | Old return type | New return type |
|---|---|---|
| `createAkunAction` | `Promise<number>` (check actual current return type by reading the file) | `Promise<ActionResult<number>>` |
| `updateAkunAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `resetAkunPasswordAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `deleteAkunAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `setPabrikLocationAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `setSiteSettingsAction` | `Promise<void>` | `Promise<ActionResult<void>>` |
| `saveDocTemplateAction` | `Promise<void>` | `Promise<ActionResult<void>>` |

Leave untouched (read-only, never throw): `getPabrikLocationAction`, `getSiteSettingsAction`, `getDocTemplateAction`.

Client updates, canonical transformation (per Task 4's example) applied to:
- `akun-list.tsx`: `createAkunAction` (~324), `updateAkunAction` (~336), `resetAkunPasswordAction` (~348), `deleteAkunAction` (~360) — all currently `try/catch { setError(...) }`.
- `doc-template-panel.tsx`: `saveDocTemplateAction` (~79) — `try/catch { setError(...) }`.
- `site-settings-panel.tsx`: `setSiteSettingsAction` (~94) — `try/catch { setError(...) }`.
- `pabrik-location-settings.tsx`: `setPabrikLocationAction` (~22) currently has **no try/catch** — `await setPabrikLocationAction({...}); setSaved(true);` bare inside `startTransition`. Read the file to find its existing error-display mechanism (if any state exists for this); if none exists, add a minimal one:
  ```ts
  const result = await setPabrikLocationAction({ /* existing args */ });
  if (!result.success) {
    setError(result.error); // or whatever state/toast pattern the file already uses elsewhere — check first
    return;
  }
  setSaved(true);
  ```

- [ ] **Step 1: Wrap the 7 functions in `akun/actions.ts`**

- [ ] **Step 2: Update the 4 client files' call sites**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors related to any of these 5 files.

- [ ] **Step 4: Commit**

```bash
git add src/app/grup/akun/actions.ts src/components/dashboard/akun-list.tsx src/components/dashboard/doc-template-panel.tsx src/components/dashboard/pabrik-location-settings.tsx src/components/dashboard/site-settings-panel.tsx
git commit -m "Wrap akun actions.ts in runAction and update its callers"
```

---

### Task 8: `akun/peran/actions.ts` + `peran-editor.tsx`

**Files:**
- Modify: `src/app/grup/akun/peran/actions.ts`
- Modify: `src/components/dashboard/peran-editor.tsx`

**Interfaces:**
- Produces: `createPeranAction`, `deletePeranAction`, `setPeranIzinAction`, `setPeranSatpamAction` all become `Promise<ActionResult<void>>` (read their current return types first — all four write/void actions in this file, none read-only, all wrapped).

Wrap all 4 exported functions the same way as the canonical example.

Client updates in `peran-editor.tsx`:
- `createPeranAction` (~150, `CreatePeranDialog.handleSubmit`) — `try/catch { setError(...) }`.
- `deletePeranAction` (~74, `RoleCard.handleDelete`) — `try/catch { setError(...) }`.
- `setPeranIzinAction` (looped over `MODULE_KEYS`) + `setPeranSatpamAction` (~53, ~60) called together via `Promise.all([...])` in `RoleCard.handleSave` — `try/catch { setError(...) }`. Since `Promise.all` returns an array of `ActionResult<void>`, transform to:
  ```ts
  const results = await Promise.all([
    ...MODULE_KEYS.map((key) => setPeranIzinAction({ /* existing args per key */ })),
    setPeranSatpamAction(peranId, isSatpam),
  ]);
  const failed = results.find((r) => !r.success);
  if (failed && !failed.success) {
    setError(failed.error);
    return;
  }
  ```
  Read the actual current code first to preserve the exact existing argument construction for each `setPeranIzinAction` call in the loop.

- [ ] **Step 1: Wrap all 4 functions in `peran/actions.ts`**

- [ ] **Step 2: Update `peran-editor.tsx`'s 3 handlers**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors in either file.

- [ ] **Step 4: Commit**

```bash
git add src/app/grup/akun/peran/actions.ts src/components/dashboard/peran-editor.tsx
git commit -m "Wrap peran actions.ts in runAction and update peran-editor.tsx"
```

---

### Task 9: `akun/sesi/actions.ts` + `akun-sesi-list.tsx`

**Files:**
- Modify: `src/app/grup/akun/sesi/actions.ts`
- Modify: `src/components/dashboard/akun-sesi-list.tsx`

**Interfaces:**
- Produces: `revokeSesiAction`: `Promise<void>` → `Promise<ActionResult<void>>`.

Wrap `revokeSesiAction` the same way as the canonical example.

Client update: `akun-sesi-list.tsx`'s `handleRevoke` (~19) currently has `try { await revokeSesiAction(sesiId); } finally { setPendingIds(...) }` with **no catch at all** — a failed revoke is currently silently swallowed. Since this component already has error-display machinery from its earlier development (per project memory, this list already handles pending/error UI for revocation), read the file to find its existing error-display pattern; if none exists for this specific action, add one:
```ts
try {
  const result = await revokeSesiAction(sesiId);
  if (!result.success) {
    // use whatever error-display convention this file already has (toast, setError, etc.) — check first
  }
} finally {
  setPendingIds(/* existing cleanup */);
}
```

- [ ] **Step 1: Wrap `revokeSesiAction`**

- [ ] **Step 2: Update `akun-sesi-list.tsx`'s `handleRevoke`**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/grup/akun/sesi/actions.ts src/components/dashboard/akun-sesi-list.tsx
git commit -m "Wrap sesi actions.ts in runAction and update akun-sesi-list.tsx"
```

---

### Task 10: `mitra/actions.ts` + its callers

**Files:**
- Modify: `src/app/(dashboard)/mitra/actions.ts`
- Modify: `src/components/dashboard/mitra-list.tsx`
- Modify: `src/components/dashboard/mitra-detail-dialog.tsx`
- Modify: `src/components/dashboard/mitra-do-panel.tsx`

**Interfaces:**
- Produces: `createMitraAction` → `Promise<ActionResult<string>>`; `updateMitraAction`, `deleteMitraAction`, `setMitraSuspendedAction`, `updateMitraCapacityAction`, `setMitraLocationAction`, `setMitraCompetitorAction` → `Promise<ActionResult<void>>`; `getMitraDetailAction` → `Promise<ActionResult<MitraRow | null>>` (it throws `"Unauthorized"`, so it qualifies for wrapping despite being a getter).

Wrap all 8 functions.

Client updates:
- `mitra-list.tsx`: `handleCreate` (~400-405) chains `createMitraAction` → `setMitraLocationAction` → `setMitraCompetitorAction` with **no try/catch currently**. Transform to sequential `result.success` checks, short-circuiting on the first failure, surfacing via whatever error-display this component uses (check the file — it may need a new error state since none currently exists for this handler):
  ```ts
  const createResult = await createMitraAction(/* existing args */);
  if (!createResult.success) { /* surface createResult.error */ return; }
  const locationResult = await setMitraLocationAction({ businessPartnerId: createResult.data, /* ... */ });
  if (!locationResult.success) { /* surface locationResult.error */ return; }
  const competitorResult = await setMitraCompetitorAction({ /* ... */ });
  if (!competitorResult.success) { /* surface competitorResult.error */ return; }
  ```
  Same pattern for `handleUpdate` (~414-418, `updateMitraAction`/`setMitraLocationAction`/`setMitraCompetitorAction`), `handleDelete` (~426, `deleteMitraAction` alone), `handleToggleSuspend` (~438, `setMitraSuspendedAction` alone) — read each handler's exact current code first; none of these four currently have error handling, so this task is also the first time these paths get any user-facing failure feedback at all.
- `mitra-detail-dialog.tsx`: `getMitraDetailAction` (~55) is a `.then(row => setDetail(row)).finally(...)` fetch with no catch — since it's now wrapped, change to `.then((result) => { if (result.success) setDetail(result.data); })` (on failure, leave `detail` as-is; this is a background detail fetch, not a user-initiated mutation, so silently not updating is acceptable — do not add new error UI here beyond not crashing). `setMitraLocationAction` (~77, `handleSaveLocation`) — already `try/catch { toast.error(...) }`, canonical transformation.
- `mitra-do-panel.tsx`: `updateMitraCapacityAction` (~288, `TargetButton.handleSave`) — already `try/catch { toast.error(...) }`, canonical transformation.

- [ ] **Step 1: Wrap all 8 functions in `mitra/actions.ts`**

- [ ] **Step 2: Update all call sites across the 3 client files**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/mitra/actions.ts" src/components/dashboard/mitra-list.tsx src/components/dashboard/mitra-detail-dialog.tsx src/components/dashboard/mitra-do-panel.tsx
git commit -m "Wrap mitra actions.ts in runAction and update its callers"
```

---

### Task 11: `sales/actions.ts` + its callers

**Files:**
- Modify: `src/app/(dashboard)/sales/actions.ts`
- Modify: `src/components/dashboard/sales-today-panel.tsx`
- Modify: `src/components/dashboard/revenue-target-panel.tsx`

**Interfaces:**
- Produces: `saveMonthlyTargetAction`: `Promise<void>` → `Promise<ActionResult<void>>`. `getSalesForDayAction` stays untouched (read-only, no throw).

Wrap `saveMonthlyTargetAction` only.

Client updates:
- `sales-today-panel.tsx`: `getSalesForDayAction` (~65) is unwrapped — no change needed, its `.then`/bare-await usage is untouched.
- `revenue-target-panel.tsx`: `saveMonthlyTargetAction` (~90, `handleSubmit`) currently has **no try/catch** — bare `await` inside `startTransition`. Add error surfacing (check the file for its existing state conventions first):
  ```ts
  const result = await saveMonthlyTargetAction(/* existing args */);
  if (!result.success) {
    // surface result.error via this component's existing pattern
    return;
  }
  ```

- [ ] **Step 1: Wrap `saveMonthlyTargetAction`**

- [ ] **Step 2: Update `revenue-target-panel.tsx`'s `handleSubmit`**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/sales/actions.ts" src/components/dashboard/revenue-target-panel.tsx
git commit -m "Wrap sales actions.ts in runAction and update revenue-target-panel.tsx"
```

---

### Task 12: `pnl/actions.ts` + `pmputra/keuangan/actions.ts` + shared callers

**Files:**
- Modify: `src/app/(dashboard)/pnl/actions.ts`
- Modify: `src/app/pmputra/keuangan/actions.ts`
- Modify: `src/components/dashboard/cash-flow-harian-panel.tsx`
- Modify: `src/components/dashboard/coa-detail-table.tsx`
- Modify: `src/components/dashboard/hpp-bersih-panel.tsx`
- Modify: `src/components/dashboard/cost-behavior-editor.tsx`

**Interfaces:**
- Produces: from `pnl/actions.ts` — `saveCOABudgetAction`, `saveCashFlowDailyFiguresAction`, `addCashFlowExpenseAction`, `deleteCashFlowExpenseAction` → `Promise<ActionResult<void>>`; `getHPPBersihAction` → `Promise<ActionResult<...>>` (it throws `"Unauthorized"`, so it's wrapped despite being a getter — check its actual current return type by reading the file). From `pmputra/keuangan/actions.ts` — `saveCOABudgetPmputraAction`, `saveCashFlowDailyFiguresPmputraAction`, `addCashFlowExpensePmputraAction`, `deleteCashFlowExpensePmputraAction`, `setCostBehaviorPmputraAction` → `Promise<ActionResult<void>>`; `getHPPBersihPmputraAction` → `Promise<ActionResult<...>>`.

Both `page.tsx` files (`pnl/page.tsx`, `pmputra/keuangan/page.tsx`) pass these actions down as typed props to the SAME shared child components — this task must update BOTH `page.tsx` files' prop type declarations (if they inline the callback types) alongside the 4 shared components, since a shared component's prop type must accept whichever `ActionResult<T>`-returning signature is now passed to it from either page.

Wrap all functions listed in Interfaces above, in both actions.ts files.

Client updates (shared across both pages):
- `cash-flow-harian-panel.tsx`: `onSaveFigures` (~52), `onAddExpense` (~63), `onDeleteExpense` (~75) — all currently **no try/catch**. Add `result.success` checks; check the file for its existing state/toast conventions first.
- `coa-detail-table.tsx`: `onSaveBudget` (~57) — currently **no try/catch**. Same treatment.
- `hpp-bersih-panel.tsx`: `onNavigateYear` (~39) — currently **no try/catch**, return value assigned directly to `setData(result)`. Transform to:
  ```ts
  const result = await onNavigateYear(nextYear);
  if (result.success) {
    setData(result.data);
  }
  // on failure: read the file for its existing convention — this is a background navigation fetch, likely fine to just not update on failure, matching the read-only-fetch treatment elsewhere in this plan
  ```
- `cost-behavior-editor.tsx`: `onSetCostBehavior` (~36, `handleChange`) — this one already has `try/catch { setError(...) } finally { setPendingId(null) }`, the canonical transformation.

- [ ] **Step 1: Wrap all functions in both actions.ts files**

- [ ] **Step 2: Update both `page.tsx` files' prop-passing if they declare inline callback prop types (read them first — if the prop type is inferred/imported rather than inlined, no page.tsx edit is needed and this step is a no-op, but confirm by type-checking)**

- [ ] **Step 3: Update all 4 shared client components**

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors across all 6 files — this is the trickiest task in the plan because the same 4 client components serve two different page/action-source pairs; a signature mismatch between the `pnl` and `pmputra` versions of a same-named action would surface here.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/pnl/actions.ts" src/app/pmputra/keuangan/actions.ts src/components/dashboard/cash-flow-harian-panel.tsx src/components/dashboard/coa-detail-table.tsx src/components/dashboard/hpp-bersih-panel.tsx src/components/dashboard/cost-behavior-editor.tsx
git commit -m "Wrap pnl and pmputra keuangan actions in runAction and update shared callers"
```

---

### Task 13: `transaksi/actions.ts` + its callers

**Files:**
- Modify: `src/app/(dashboard)/transaksi/actions.ts`
- Modify: `src/components/dashboard/sales-transaction-cards.tsx`
- Modify: `src/components/dashboard/mitra-do-panel.tsx`

**Interfaces:**
- Produces: `getMitraContactLogAction` → `Promise<ActionResult<...>>` (throws `"Unauthorized"`), `saveMitraContactLogAction` → `Promise<ActionResult<void>>`. `getDeliveryCardsAction` stays untouched (read-only, no throw).

Wrap `getMitraContactLogAction` and `saveMitraContactLogAction`.

Client updates:
- `sales-transaction-cards.tsx`: `getDeliveryCardsAction` (~223) is unwrapped — no change.
- `mitra-do-panel.tsx`: `getMitraContactLogAction` (~119, `ContactLogButton.handleOpenChange`) — currently `.then(...).catch(() => toast.error("Gagal memuat catatan."))`. Since it's now wrapped, the `.catch()` won't fire on a business error (only on a genuine network/promise rejection, which shouldn't happen since `runAction` never rejects) — transform to:
  ```ts
  getMitraContactLogAction(businessPartnerId, dateISO).then((result) => {
    if (result.success) {
      setLog(result.data); // or whatever the existing .then callback did with the row
    } else {
      toast.error(result.error);
    }
  });
  ```
  `saveMitraContactLogAction` (~134, `handleSave`) — already `try/catch { toast.error(...) }`, canonical transformation.

- [ ] **Step 1: Wrap both functions in `transaksi/actions.ts`**

- [ ] **Step 2: Update both call sites in `mitra-do-panel.tsx`**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/transaksi/actions.ts" src/components/dashboard/mitra-do-panel.tsx
git commit -m "Wrap transaksi actions.ts in runAction and update mitra-do-panel.tsx"
```

---

### Task 14: `pemasaran/actions.ts` + its callers

**Files:**
- Modify: `src/app/(dashboard)/pemasaran/actions.ts`
- Modify: `src/components/dashboard/pemasaran-section.tsx`
- Modify: `src/components/dashboard/pengajuan-list.tsx`
- Modify: `src/components/dashboard/marketing-wilayah-panel.tsx`
- Modify: `src/components/dashboard/marketing-performance-panel.tsx`
- Modify: `src/components/dashboard/pemasaran-wilayah-delivery-panel.tsx`

**Interfaces:**
- Produces: `createPengajuanAction`, `approvePengajuanAction`, `rejectPengajuanAction`, `deletePengajuanAction`, `addMarketingWilayahAction`, `removeMarketingWilayahAction`, `addMarketingMitraAction`, `removeMarketingMitraAction`, `setMarketingPeriodSettingAction`, `setWilayahPotentialTargetAction`, `getMarketingVisitLogAction`, `saveMarketingVisitLogAction` — all wrapped (every one of these 12 either throws directly or calls something that does, per the map; this file has the largest single-file action count in the app after `delivery`).

Wrap all 12 functions the same way. `getMarketingVisitLogAction` throws `"Unauthorized"` directly, so it's wrapped despite being a getter — check its current return type by reading the file.

Client updates:
- `pemasaran-section.tsx`: `createPengajuanAction` (~28, `handleCreate`) — currently **no try/catch**. Add `result.success` check (this component likely already has form-error display given it's a create form — check first).
- `pengajuan-list.tsx`: `approvePengajuanAction` (~143), `rejectPengajuanAction` (~155), `deletePengajuanAction` (~167) — all already `try/catch { toast.error(...) }`, canonical transformation.
- `marketing-wilayah-panel.tsx`: `addMarketingWilayahAction` (~87), `removeMarketingWilayahAction` (~104), `addMarketingMitraAction` (~121), `removeMarketingMitraAction` (~135) — all already `try/catch { toast.error(...) } ` followed by `router.refresh()`, canonical transformation (keep the `router.refresh()` call after the success check).
- `marketing-performance-panel.tsx`: `setMarketingPeriodSettingAction` (~483, `PeriodSettings.handleSave`) — already `try/catch { toast.error(...) }`, canonical transformation. `getMarketingVisitLogAction` (~134, `MitraDayCell.handleOpenChange`) — currently `.then(...).catch(() => toast.error(...))`; transform like `mitra-do-panel.tsx`'s `getMitraContactLogAction` in Task 13 (check `result.success` inside `.then`, `toast.error(result.error)` on failure). `saveMarketingVisitLogAction` (~146, `handleSave`) — already `try/catch { toast.error(...) }`, canonical transformation.
- `pemasaran-wilayah-delivery-panel.tsx`: `setWilayahPotentialTargetAction` (~54, `PotentialTargetButton.handleSave`) — already `try/catch { toast.error(...) }`, canonical transformation.

- [ ] **Step 1: Wrap all 12 functions in `pemasaran/actions.ts`**

- [ ] **Step 2: Update all call sites across the 5 client files**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/pemasaran/actions.ts" src/components/dashboard/pemasaran-section.tsx src/components/dashboard/pengajuan-list.tsx src/components/dashboard/marketing-wilayah-panel.tsx src/components/dashboard/marketing-performance-panel.tsx src/components/dashboard/pemasaran-wilayah-delivery-panel.tsx
git commit -m "Wrap pemasaran actions.ts in runAction and update its callers"
```

---

### Task 15: `aging/actions.ts` + its callers

**Files:**
- Modify: `src/app/(dashboard)/aging/actions.ts`
- Modify: `src/components/dashboard/collection-priority-table.tsx`
- Modify: `src/components/dashboard/top-mitra-piutang-panel.tsx`
- Modify: `src/components/dashboard/pelunasan-dialog.tsx`

**Interfaces:**
- Produces: `saveCollectionTargetAction`, `removeCollectionTargetAction`, `setMitraNoteAction`, `recordPaymentAction` → `Promise<ActionResult<void>>` (check `recordPaymentAction`'s actual current return type — the map shows its result is used for `result.voucherNo`/`totalAmount`/`totalDeposit`, so it's NOT `void`, likely an object; read the file to confirm the exact shape and use that as `T` in `ActionResult<T>`). `getOutstandingInvoicesAction` → `Promise<ActionResult<...>>` (throws `"Unauthorized"`).

Wrap all 5 functions.

Client updates:
- `collection-priority-table.tsx`: `saveCollectionTargetAction` (~211, `handleSubmit`), `removeCollectionTargetAction` (~224, `handleRemove`) — both currently **no try/catch**. Add `result.success` checks (check for existing state/toast conventions in the file first).
- `top-mitra-piutang-panel.tsx`: `setMitraNoteAction` (~121, `handleSaveNote`) — currently **no try/catch**. Same treatment.
- `pelunasan-dialog.tsx`: `getOutstandingInvoicesAction` (~52) — `.then(rows => {...})`, no catch; transform to check `result.success` inside `.then`, same background-fetch treatment as other read-only-turned-wrapped getters in this plan. `recordPaymentAction` (~93, `handleSubmit`) — already `try/catch { toast.error(...) }`; its return value IS used beyond the try/catch (`result.voucherNo`, `result.totalAmount`, `result.totalDeposit` interpolated into a success toast) — transform to:
  ```ts
  const result = await recordPaymentAction(/* existing args */);
  if (!result.success) {
    toast.error(result.error);
    return;
  }
  toast.success(`... ${result.data.voucherNo} ... ${result.data.totalAmount} ... ${result.data.totalDeposit} ...`);
  // (read the file for the exact existing toast message template and substitute result.data.<field> for each formerly-bare result.<field>)
  ```

- [ ] **Step 1: Wrap all 5 functions in `aging/actions.ts`**

- [ ] **Step 2: Update all call sites across the 3 client files**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/aging/actions.ts" src/components/dashboard/collection-priority-table.tsx src/components/dashboard/top-mitra-piutang-panel.tsx src/components/dashboard/pelunasan-dialog.tsx
git commit -m "Wrap aging actions.ts in runAction and update its callers"
```

---

### Task 16: `grup/perusahaan/actions.ts` + `perusahaan-list.tsx`

**Files:**
- Modify: `src/app/grup/perusahaan/actions.ts`
- Modify: `src/components/dashboard/perusahaan-list.tsx`

**Interfaces:**
- Produces: `createPerusahaanAction`, `updatePerusahaanAction`, `deletePerusahaanAction`, `upsertKoneksiAction`, `deleteKoneksiAction` → `Promise<ActionResult<void>>`.

Wrap all 5 functions, including `deleteKoneksiAction` even though it has zero callers anywhere in the client codebase (confirmed via the exploration — keep it consistent with its siblings for whenever it does get wired up; do not delete it, that's out of scope for this plan).

Client updates in `perusahaan-list.tsx`:
- `createPerusahaanAction`/`updatePerusahaanAction` (~49/~51) + `upsertKoneksiAction` (~54, looped over `koneksiBlocks`) — all inside one `try/catch { setError(...) }` in `handleSubmit`. Transform to sequential checks:
  ```ts
  const mainResult = isEditing
    ? await updatePerusahaanAction(id, input)
    : await createPerusahaanAction(input);
  if (!mainResult.success) {
    setError(mainResult.error);
    return;
  }
  for (const block of koneksiBlocks) {
    const koneksiResult = await upsertKoneksiAction(block);
    if (!koneksiResult.success) {
      setError(koneksiResult.error);
      return;
    }
  }
  ```
  (Read the actual current `handleSubmit` first — the exact conditional between create/update and the loop's exact shape must be preserved; this is illustrative of the required check-and-short-circuit pattern, not necessarily the literal existing branching.)
- `deletePerusahaanAction` (~67, `handleDelete`) — `try/catch { alert(...) }`, canonical transformation with `alert(result.error)`.

- [ ] **Step 1: Wrap all 5 functions in `perusahaan/actions.ts`**

- [ ] **Step 2: Update `perusahaan-list.tsx`'s `handleSubmit` and `handleDelete`**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/grup/perusahaan/actions.ts src/components/dashboard/perusahaan-list.tsx
git commit -m "Wrap perusahaan actions.ts in runAction and update perusahaan-list.tsx"
```

---

### Task 17: `pemesanan/actions.ts` + its callers

**Files:**
- Modify: `src/app/(dashboard)/pemesanan/actions.ts`
- Modify: `src/components/dashboard/pemesanan-form-dialog.tsx`
- Modify: `src/components/dashboard/pemesanan-list.tsx`
- Modify: `src/components/dashboard/ubah-pemesanan-dialog.tsx`
- Modify: `src/components/dashboard/ubah-tanggal-pemesanan-dialog.tsx`

**Interfaces:**
- Produces: `createPemesananAction` → `Promise<ActionResult<CreatePemesananResult>>`; `deletePemesananAction` → `Promise<ActionResult<void>>`; `createTakeAwayPemesananAction` → `Promise<ActionResult<CreateTakeAwayResult>>`; `reschedulePemesananAction` → `Promise<ActionResult<{ jadwalId: number }>>`; `updateSalesOrderTransDateAction` → `Promise<ActionResult<void>>`; `updateSalesOrderQtyAction` → `Promise<ActionResult<void>>`. `getCurrentAssignmentAction` and `getEditableSalesOrderQtyAction` stay untouched (read-only, no throw).

Wrap the 6 functions listed.

Client updates:
- `pemesanan-form-dialog.tsx`: `createTakeAwayPemesananAction`/`createPemesananAction` (~114/~126, `handleSubmit`) — already `try/catch { setError(...) }`; the takeaway branch uses `result.deliveryOrderId` to `window.open(...)` — transform to:
  ```ts
  const result = isTakeAway
    ? await createTakeAwayPemesananAction(input)
    : await createPemesananAction(input);
  if (!result.success) {
    setError(result.error);
    return;
  }
  if (isTakeAway) {
    window.open(`/invoice/${result.data.deliveryOrderId /* or whatever field name — check CreateTakeAwayResult's actual shape */}`, "_blank");
  }
  ```
- `pemesanan-list.tsx`: `deletePemesananAction` (~49, `PemesananRow.handleDelete`) — already `try/catch { toast.error(...) }`, canonical transformation.
- `ubah-pemesanan-dialog.tsx`: `getCurrentAssignmentAction`/`getEditableSalesOrderQtyAction` (~79) via `Promise.all(...).then(...).finally(...)` — both unwrapped, no change. `updateSalesOrderQtyAction` (called up to 2×, ~114/~117) + `reschedulePemesananAction` (~119) — all inside one `try/catch { setError(...) }` in `handleSubmit`. Transform to sequential checks (same short-circuit pattern as Task 16's example), reading the actual current branching (up to 2 qty updates depending on which variants changed) before writing the replacement.
- `ubah-tanggal-pemesanan-dialog.tsx`: `updateSalesOrderTransDateAction` (~62) — already `try/catch { setError(...) }`, canonical transformation.

- [ ] **Step 1: Wrap all 6 functions in `pemesanan/actions.ts`**

- [ ] **Step 2: Update all call sites across the 4 client files**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/pemesanan/actions.ts" src/components/dashboard/pemesanan-form-dialog.tsx src/components/dashboard/pemesanan-list.tsx src/components/dashboard/ubah-pemesanan-dialog.tsx src/components/dashboard/ubah-tanggal-pemesanan-dialog.tsx
git commit -m "Wrap pemesanan actions.ts in runAction and update its callers"
```

---

### Task 18: `profile-actions.ts` + `account-settings-dialog.tsx`

**Files:**
- Modify: `src/app/(dashboard)/profile-actions.ts`
- Modify: `src/components/dashboard/account-settings-dialog.tsx`

**Interfaces:**
- Produces: `updateOwnProfileAction`, `changeOwnPasswordAction` → `Promise<ActionResult<void>>`.

Wrap both functions.

Client updates in `account-settings-dialog.tsx`:
- `updateOwnProfileAction` (~34, `ProfileForm.handleSubmit`) — already `try/catch { setError(...) }`, then `setSuccess(true)`. Transform:
  ```ts
  const result = await updateOwnProfileAction(input);
  if (!result.success) {
    setError(result.error);
    return;
  }
  setSuccess(true);
  ```
- `changeOwnPasswordAction` (~90, `PasswordForm.handleSubmit`) — same shape, plus the existing form reset after success (preserve whatever reset logic already runs there).

- [ ] **Step 1: Wrap both functions in `profile-actions.ts`**

- [ ] **Step 2: Update both handlers in `account-settings-dialog.tsx`**

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/profile-actions.ts" src/components/dashboard/account-settings-dialog.tsx
git commit -m "Wrap profile-actions.ts in runAction and update account-settings-dialog.tsx"
```

---

### Task 19: Full verification pass

**Files:**
- None created — this task verifies Tasks 1-18 together.

**Interfaces:**
- Consumes: everything from Tasks 1-18.

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: zero errors anywhere in the project. If anything remains, it means a caller was missed somewhere outside the files explicitly listed in this plan — find it via the error message's file:line and fix it following the same `result.success` pattern used throughout this plan.

- [ ] **Step 2: Full lint**

Run: `npx eslint`
Expected: zero errors/warnings introduced by this plan's changes (pre-existing warnings elsewhere in the project, if any, are out of scope).

- [ ] **Step 3: Confirm the rename swept everything**

Run: `grep -rn "throw new Error" src/app/**/actions.ts "src/app/(dashboard)/profile-actions.ts" src/lib/queries/*.ts`
Expected: no output.

- [ ] **Step 4: Manual verification — original bug scenario**

Repeat Task 5 Step 3's manual check (Gabungkan jadi Jadwal / drag-drop capacity-exceeded scenario) one more time against the fully-merged tree, confirming the real business message still displays correctly end-to-end.

- [ ] **Step 5: Manual verification — a second, unrelated area**

Pick one more area with an easily-triggerable validation error (e.g. `akun/peran/actions.ts`'s `"Peran Super Administrator tidak dapat dihapus."` — try deleting the Super Administrator peran from `/grup/akun/peran`) and confirm its exact message displays too, not the generic text — this spot-checks that the pattern actually works consistently across a second, independently-wired feature area, not just the one from the original report.

- [ ] **Step 6: Commit any fixes found during verification**

If Steps 1-5 required any code changes to pass, commit them individually with descriptive messages before considering this plan complete. If everything already passed, no commit is needed for this task.
