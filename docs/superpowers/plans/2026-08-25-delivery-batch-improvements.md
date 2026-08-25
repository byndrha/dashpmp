# Delivery/Pemesanan/Satpam Batch Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six independent improvements: a "Lihat SI" view/reprint popup in Validasi Rute, a click-to-enlarge photo lightbox for vehicle checks, a satpam "cek kedatangan" quantity bug fix, Takeaway orders printing through the thermal print-queue instead of a DO PDF, a "Lihat SI" button on `/mkesindo/pemesanan`, and a new Takeaway timeline row on `/mkesindo/delivery`.

**Architecture:** Each task is self-contained to its own file set with no cross-task file overlap, so all six tasks may be executed in any order. (The seventh item from the spec — enlarging the printed QRIS image 1.5x — is already implemented and pushed; no task exists for it here.)

**Tech Stack:** Next.js server actions, MSSQL (`mssql` via `getPool()`/`sql` from `@/lib/db`), React client components, existing `@/components/ui/dialog` primitives.

**Spec:** `docs/superpowers/specs/2026-08-25-delivery-batch-improvements-design.md`

## Global Constraints

- No test framework exists in this repository (`package.json` has no `test` script). Every task's verification is `npx tsc --noEmit` (whole project, must stay clean) + `npx eslint <changed files>` (must stay clean). For any task touching SQL, also run a one-off `npx tsx` smoke script (written directly, not via `-e`, since this shell has previously produced no stdout for `npx tsx -e "..."` — write a temp `.ts` file, run it, delete it) against the live dev DB to confirm the query is correct before committing.
- Every new/modified server action in `src/app/mkesindo/(dashboard)/delivery/actions.ts` calls `await requireModuleAccess("delivery")` as its first line inside `runAction(async () => { ... })`, matching every existing action in that file.
- `src/app/mkesindo/(dashboard)/pemesanan/actions.ts` currently has **no** `requireModuleAccess` call anywhere (verified) — do not add one as a side effect of this plan's changes; that's a pre-existing condition out of scope here.
- MSSQL columns/constraints changed by a migration script must use an idempotent guard (check `INFORMATION_SCHEMA`/`sys.columns` first) and be safe to re-run, matching every existing script under `scripts/`.
- Commit after each task using this repo's existing style: a short imperative `feat:`/`fix:` summary line.

---

### Task 1: "Lihat SI" popup replaces the reprint icon in Validasi Rute

**Files:**
- Create: `src/components/dashboard/stop-sales-invoice-dialog.tsx`
- Modify: `src/components/dashboard/route-validation-dialog.tsx`
- Modify: `src/app/mkesindo/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: `getInvoiceByToken`/`PublicInvoice` from `@/lib/queries/invoice-public` (existing), `enqueueManualReprintAction` (existing), `triggerPrintQueuePollNow` (existing, `@/components/dashboard/print-queue-poller`), `DriverStopRow` (existing, has `InvoiceToken: string | null` already).
- Produces: `getSalesInvoiceForViewAction(invoiceToken: string): Promise<ActionResult<PublicInvoice | null>>` and `StopSalesInvoiceDialog` — used only within this task.

- [ ] **Step 1: Add the new server action to `src/app/mkesindo/(dashboard)/delivery/actions.ts`**

Add this import near the top (this file does not currently import from `invoice-public.ts`):
```typescript
import { getInvoiceByToken, type PublicInvoice } from "@/lib/queries/invoice-public";
```

Append the action anywhere alongside the other print-queue actions:
```typescript
export async function getSalesInvoiceForViewAction(invoiceToken: string): Promise<ActionResult<PublicInvoice | null>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    return getInvoiceByToken(invoiceToken);
  });
}
```

- [ ] **Step 2: Create `src/components/dashboard/stop-sales-invoice-dialog.tsx`**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate, formatRupiah } from "@/lib/format";
import { getSalesInvoiceForViewAction, enqueueManualReprintAction } from "@/app/mkesindo/(dashboard)/delivery/actions";
import { triggerPrintQueuePollNow } from "@/components/dashboard/print-queue-poller";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import type { PublicInvoice } from "@/lib/queries/invoice-public";

// Popup opened from the "Lihat SI" icon that replaced the old standalone
// reprint icon in RouteValidationDialog's SortableStopRow — shows the
// SalesInvoice's content (reusing the same getInvoiceByToken/PublicInvoice
// shape the public /mkesindo/invoice/[token] page already renders) plus a
// reprint button, so viewing and reprinting share one entry point instead
// of two separate icons.
export function StopSalesInvoiceDialog({
  detail,
  onOpenChange,
}: {
  // Null closes the dialog — same open-via-prop convention
  // StopDeliveryProofDialog already uses.
  detail: DriverStopRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [reprinting, startTransition] = useTransition();

  useEffect(() => {
    if (!detail?.InvoiceToken) {
      setInvoice(null);
      return;
    }
    setLoading(true);
    getSalesInvoiceForViewAction(detail.InvoiceToken).then((result) => {
      setInvoice(result.success ? result.data : null);
      setLoading(false);
    });
  }, [detail]);

  function handleReprint() {
    if (!detail) return;
    startTransition(async () => {
      const result = await enqueueManualReprintAction(detail.JadwalDetailID);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("SI ditambahkan ke antrian cetak.");
      triggerPrintQueuePollNow();
    });
  }

  return (
    <Dialog open={detail != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>SI{detail ? ` — ${detail.CustomerName}` : ""}</DialogTitle>
          <DialogDescription className="sr-only">Isi SalesInvoice untuk tujuan ini, dan tombol cetak ulang.</DialogDescription>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
        {!loading && !invoice && <p className="py-6 text-center text-sm text-muted-foreground">SI tidak ditemukan.</p>}

        {!loading && invoice && (
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{invoice.VoucherNo}</p>
                <p className="text-xs text-muted-foreground">{formatDate(invoice.TransDate)}</p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReprint} disabled={reprinting}>
                <Printer className="size-3.5" /> Cetak Ulang
              </Button>
            </div>
            {invoice.Delivery?.Lines.map((line, i) => (
              <div key={i} className="flex items-center justify-between border-b pb-1.5 text-xs">
                <span>
                  {line.Name} x{line.Qty}
                </span>
                <span className="tabular-nums">{formatRupiah(line.Amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t pt-2 font-medium">
              <span>TOTAL</span>
              <span className="tabular-nums">{formatRupiah(invoice.Netto)}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Edit `SortableStopRow` in `src/components/dashboard/route-validation-dialog.tsx`**

Read the file first to confirm current line numbers (they may have shifted). The icon-slot block currently reads (around line 189-215):
```tsx
{!hasDeparted ? (
  // Always shown pre-departure, even before Selesai Muat has created
  // this stop's SalesInvoice — enqueueManualReprintAction (Task 3)
  // already rejects with a clear AppError ("SI ... belum terbit") in
  // that case, surfaced below as a toast, so there's no need to hide
  // the button and make an operator wonder where it went.
  <button
    type="button"
    title="Cetak ulang SI"
    onClick={() => onReprint(detail.JadwalDetailID)}
    disabled={reprinting}
    className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-border disabled:cursor-default disabled:opacity-50"
  >
    <Printer className="size-3.5" />
  </button>
) : detail.JamSelesai != null ? (
  <button
    type="button"
    title="Lihat bukti pengiriman"
    onClick={() => onOpenProof(detail)}
    className="shrink-0 rounded border border-transparent p-1 text-green-600 transition-colors hover:border-border hover:bg-green-600/10"
  >
    <CheckCircle2 className="size-4" />
  </button>
) : (
  <span className="size-6 shrink-0" />
)}
```

Replace it with:
```tsx
{detail.InvoiceToken != null ? (
  <button
    type="button"
    title="Lihat SI"
    onClick={() => onOpenSi(detail)}
    className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-border"
  >
    <Printer className="size-3.5" />
  </button>
) : hasDeparted && detail.JamSelesai != null ? (
  <button
    type="button"
    title="Lihat bukti pengiriman"
    onClick={() => onOpenProof(detail)}
    className="shrink-0 rounded border border-transparent p-1 text-green-600 transition-colors hover:border-border hover:bg-green-600/10"
  >
    <CheckCircle2 className="size-4" />
  </button>
) : (
  <span className="size-6 shrink-0" />
)}
```

Update `SortableStopRow`'s props: remove `onReprint: (jadwalDetailId: number) => void;` and `reprinting: boolean;` (and their JSDoc-style comments) from the props type and destructuring, add `onOpenSi: (detail: DriverStopRow) => void;` instead.

- [ ] **Step 4: Update `RouteValidationDialog` (same file)**

- Add state near `proofDetail`: `const [siDetail, setSiDetail] = useState<DriverStopRow | null>(null);`
- In the jadwal-switch effect where `setProofDetail(null);` is called, add `setSiDetail(null);` right next to it.
- Remove `handleReprint` and the `reprintingId` state entirely (find `const [reprintingId, setReprintingId] = useState<number | null>(null);` and the `function handleReprint(jadwalDetailId: number) { ... }` block below it) — nothing calls them once Step 3 lands.
- At `SortableStopRow`'s call site, remove the `onReprint={handleReprint}` and `reprinting={reprintingId === d.JadwalDetailID}` props, add `onOpenSi={setSiDetail}`.
- Near `<StopDeliveryProofDialog detail={proofDetail} onOpenChange={(open) => !open && setProofDetail(null)} />`, add a sibling:
```tsx
<StopSalesInvoiceDialog detail={siDetail} onOpenChange={(open) => !open && setSiDetail(null)} />
```
Add the import: `import { StopSalesInvoiceDialog } from "@/components/dashboard/stop-sales-invoice-dialog";`

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/components/dashboard/stop-sales-invoice-dialog.tsx src/components/dashboard/route-validation-dialog.tsx "src/app/mkesindo/(dashboard)/delivery/actions.ts"
git add src/components/dashboard/stop-sales-invoice-dialog.tsx src/components/dashboard/route-validation-dialog.tsx "src/app/mkesindo/(dashboard)/delivery/actions.ts"
git commit -m "feat: replace Validasi Rute reprint icon with a Lihat SI + reprint popup"
```

---

### Task 2: Click-to-enlarge popup for vehicle-check photos

**Files:**
- Create: `src/components/ui/image-lightbox.tsx`
- Modify: `src/components/vehicle-check-summary.tsx`

**Interfaces:**
- Produces: `ImageLightboxTrigger({ src, alt, className }): JSX.Element` — a generic, reusable thumbnail-that-enlarges-on-click component.

- [ ] **Step 1: Create `src/components/ui/image-lightbox.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// Click-to-enlarge popup for a single thumbnail — no header/padding, just
// the full-size image on a dark backdrop, dismissed by clicking outside or
// closing the dialog (DialogContent's own built-in behavior). Generic over
// any thumbnail image in the app, not vehicle-check-specific.
export function ImageLightboxTrigger({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element -- thumbnail source is a remote/proxied URL, not a static build asset */}
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl border-none bg-transparent p-0 shadow-none">
          {/* eslint-disable-next-line @next/next/no-img-element -- same remote/proxied source as the thumbnail above, shown at full size */}
          <img src={src} alt={alt} className="max-h-[85vh] w-full rounded-lg object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Wire it into `src/components/vehicle-check-summary.tsx`**

Add the import: `import { ImageLightboxTrigger } from "@/components/ui/image-lightbox";`

Replace the photo grid (currently):
```tsx
<div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
  {check.photos.map((p) => (
    // eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset
    <img key={p.jenisFoto} src={p.filePath} alt={JENIS_FOTO_LABEL[p.jenisFoto]} className="h-14 w-full rounded object-cover" />
  ))}
</div>
```
with:
```tsx
<div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
  {check.photos.map((p) => (
    <ImageLightboxTrigger
      key={p.jenisFoto}
      src={p.filePath}
      alt={JENIS_FOTO_LABEL[p.jenisFoto]}
      className="h-14 w-full overflow-hidden rounded"
    />
  ))}
</div>
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/components/ui/image-lightbox.tsx src/components/vehicle-check-summary.tsx
git add src/components/ui/image-lightbox.tsx src/components/vehicle-check-summary.tsx
git commit -m "feat: click-to-enlarge popup for vehicle-check photos"
```

Manually verify (this is a UI change observable in a running dev server): open any completed vehicle check (e.g. via Validasi Rute's "Hasil Inspeksi Kendaraan (Satpam)" section), click a photo thumbnail, confirm it opens enlarged in a popup and closing it works.

---

### Task 3: Fix satpam "Cek Kedatangan" showing departure qty instead of return qty

**Files:**
- Modify: `src/lib/queries/satpam-inspection.ts`
- Modify: `src/components/satpam-app/beranda-client.tsx`

**Interfaces:**
- Produces: `SatpamInspectionCard` gains `qtyRetur10KG: number` and `qtyRetur5KG: number` (0 for BERANGKAT cards, the real returned-quantity aggregate for DATANG cards).

- [ ] **Step 1: Extend `SatpamInspectionCard` and `RawInspectionRow` in `src/lib/queries/satpam-inspection.ts`**

Add to `SatpamInspectionCard` (after the existing `qty5KG: number;` line):
```typescript
  // Only meaningful/non-zero for tipe === "DATANG" — aggregated from
  // DashboardPengirimanStopDeliveryItem.QtyRetur across every stop on this
  // Jadwal (the quantity that came back on the armada, not what it left
  // with). BERANGKAT cards always get 0 here (nothing has been delivered
  // yet to have a retur).
  qtyRetur10KG: number;
  qtyRetur5KG: number;
```

Add to `RawInspectionRow` (after `Qty5KG: number;`):
```typescript
  QtyRetur10KG: number;
  QtyRetur5KG: number;
```

- [ ] **Step 2: Extend `INSPECTION_ROW_SELECT`**

Add these two subqueries to the SELECT list, right after the existing `Qty5KG` subquery and before `vcb.VehicleCheckID AS BerangkatCheckID,`:
```sql
    (
      SELECT ISNULL(SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN 0 ELSE sdi.QtyRetur END), 0)
      FROM DashboardPengirimanStopDeliveryItem sdi
      JOIN DashboardPengirimanStopDelivery sd ON sd.StopDeliveryID = sdi.StopDeliveryID
      JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalDetailID = sd.JadwalDetailID
      JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = sdi.SalesOrderDetailID
      WHERE jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
    ) AS QtyRetur10KG,
    (
      SELECT ISNULL(SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN sdi.QtyRetur ELSE 0 END), 0)
      FROM DashboardPengirimanStopDeliveryItem sdi
      JOIN DashboardPengirimanStopDelivery sd ON sd.StopDeliveryID = sdi.StopDeliveryID
      JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalDetailID = sd.JadwalDetailID
      JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = sdi.SalesOrderDetailID
      WHERE jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
    ) AS QtyRetur5KG,
```

- [ ] **Step 3: Update `toCard()` and both call sites**

Change `toCard`'s signature to take two more parameters:
```typescript
function toCard(
  r: RawInspectionRow,
  tipe: "BERANGKAT" | "DATANG",
  hasCheck: boolean,
  jamEstimasiKedatangan: string | null,
  qtyRetur10KG: number,
  qtyRetur5KG: number
): SatpamInspectionCard {
  return {
    jadwalId: r.JadwalID,
    armadaNama: r.ArmadaNama,
    vehicleNo: r.VehicleNo,
    driverName: r.DriverName,
    jamJadwal: r.JamJadwal.toISOString(),
    jamEstimasiKedatangan,
    qty10KG: r.Qty10KG,
    qty5KG: r.Qty5KG,
    status: r.Status,
    tipe,
    hasCheck,
    qtyRetur10KG,
    qtyRetur5KG,
  };
}
```

Update the two call sites in `getSatpamInspectionList`:
```typescript
  for (const r of berangkatResult.recordset as RawInspectionRow[]) {
    cards.push(toCard(r, "BERANGKAT", r.BerangkatCheckID != null, null, 0, 0));
  }
  for (const r of datangResult.recordset as RawInspectionRow[]) {
    const jamEstimasiKedatangan =
      r.JamAktualBerangkat && r.DurasiMenit != null
        ? new Date(r.JamAktualBerangkat.getTime() + r.DurasiMenit * 60_000).toISOString()
        : null;
    cards.push(toCard(r, "DATANG", r.DatangCheckID != null, jamEstimasiKedatangan, r.QtyRetur10KG, r.QtyRetur5KG));
  }
```

- [ ] **Step 4: Update `InspectionCard` in `src/components/satpam-app/beranda-client.tsx`**

Change the qty display line (currently `<span className="text-sm text-muted-foreground">{formatKemasanQty(card.qty10KG, card.qty5KG)}</span>`) to:
```tsx
<span className="text-sm text-muted-foreground">
  {card.tipe === "DATANG" ? formatKemasanQty(card.qtyRetur10KG, card.qtyRetur5KG) : formatKemasanQty(card.qty10KG, card.qty5KG)}
</span>
```

- [ ] **Step 5: Smoke-test against the live dev DB**

Write a temporary script (delete it after running):
```typescript
// scratch-check-satpam-qty.ts (temporary — delete after running)
import "dotenv/config";
import { getSatpamInspectionList } from "./src/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "./src/lib/business-date";

async function main() {
  const cards = await getSatpamInspectionList(getBusinessDateISO());
  for (const c of cards.filter((c) => c.tipe === "DATANG")) {
    console.log({ jadwalId: c.jadwalId, qty10KG: c.qty10KG, qty5KG: c.qty5KG, qtyRetur10KG: c.qtyRetur10KG, qtyRetur5KG: c.qtyRetur5KG });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```
Run `npx tsx scratch-check-satpam-qty.ts`. There may be zero DATANG cards at the moment this runs (depends on live traffic) — that's fine, it just means nothing to eyeball; if there ARE rows, confirm `qtyRetur10KG`/`qtyRetur5KG` are plausible (usually 0, since most deliveries have no retur, but shouldn't equal the full departure `qty10KG`/`qty5KG` unless every single item on that Jadwal was genuinely returned). Delete the script when done.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/lib/queries/satpam-inspection.ts src/components/satpam-app/beranda-client.tsx
git add src/lib/queries/satpam-inspection.ts src/components/satpam-app/beranda-client.tsx
git commit -m "fix: satpam kedatangan card showed departure qty instead of return qty"
```

---

### Task 4: Takeaway prints via the thermal print-queue instead of a DO PDF

**Files:**
- Create: `scripts/make-print-queue-jadwal-id-nullable.ts`
- Modify: `src/lib/queries/print-queue.ts`
- Modify: `src/app/mkesindo/(dashboard)/pemesanan/actions.ts`
- Modify: `src/components/dashboard/pemesanan-form-dialog.tsx`

**Interfaces:**
- Consumes: `enqueuePrintJob` (existing, signature widens), `triggerPrintQueuePollNow` (existing).
- Produces: `enqueuePrintJob`'s `jadwalId` parameter becomes `number | null`; `PendingPrintJob.jadwalId` and `PrintQueueHistoryRow.jadwalId` become `number | null`. No other task in this plan touches `print-queue.ts` or reads these two interfaces, so this widening is self-contained.

- [ ] **Step 1: Write and run the migration script**

`scripts/make-print-queue-jadwal-id-nullable.ts`:
```typescript
// One-off schema migration — DashboardPrintQueue.JadwalID becomes nullable
// so a Takeaway order (which has no Jadwal at all) can still be enqueued
// for thermal printing. Idempotent, safe to re-run.
// Usage: npx tsx scripts/make-print-queue-jadwal-id-nullable.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardPrintQueue' AND COLUMN_NAME = 'JadwalID'
  `);
  const isNullable = (result.recordset[0] as { IS_NULLABLE: string } | undefined)?.IS_NULLABLE === "YES";
  if (!isNullable) {
    await pool.request().query(`ALTER TABLE DashboardPrintQueue ALTER COLUMN JadwalID INT NULL`);
  }
  console.log("DashboardPrintQueue.JadwalID is nullable.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```
Run it twice (`npx tsx scripts/make-print-queue-jadwal-id-nullable.ts`) to confirm idempotency — both runs must exit 0.

- [ ] **Step 2: Widen the TypeScript types in `src/lib/queries/print-queue.ts`**

- `enqueuePrintJob`'s signature: change `jadwalId: number` to `jadwalId: number | null`. No change needed to the `.input("jadwalId", sql.Int, jadwalId)` call itself — `mssql` accepts `null` for a nullable `sql.Int` parameter.
- `PendingPrintJob.jadwalId: number` → `jadwalId: number | null`. `getPendingPrintQueue`'s inline recordset cast type (`{ PrintQueueID: number; SalesInvoiceID: string; JadwalID: number }`) → `JadwalID: number | null`.
- `PrintQueueHistoryRow.jadwalId: number` → `jadwalId: number | null`. `getPrintQueueHistory`'s inline recordset cast type (`JadwalID: number;`) → `JadwalID: number | null;` (the SQL itself needs no change — the existing `LEFT JOIN DashboardPengirimanJadwal jad ON jad.JadwalID = pq.JadwalID` already tolerates a null `pq.JadwalID` correctly, since a `LEFT JOIN` on a null key simply produces no match, yielding null `armadaNama`/`vehicleNo`/`jamJadwal` exactly as it already does for any other unmatched row).
- `retryPrintQueueJob`'s inline recordset cast type (`{ SalesInvoiceID: string; JadwalID: number }`) → `JadwalID: number | null`.

- [ ] **Step 3: Update `createTakeAwayPemesananAction` in `src/app/mkesindo/(dashboard)/pemesanan/actions.ts`**

Current code:
```typescript
export async function createTakeAwayPemesananAction(input: CreateTakeAwayInput): Promise<ActionResult<CreateTakeAwayResult>> {
  return runAction(async () => {
    const result = await createTakeAwayPemesanan(input);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}
```
Change to:
```typescript
export async function createTakeAwayPemesananAction(input: CreateTakeAwayInput): Promise<ActionResult<CreateTakeAwayResult>> {
  return runAction(async () => {
    const result = await createTakeAwayPemesanan(input);
    const pool = await getPool();
    await enqueuePrintJob(pool, result.salesInvoiceId, null, false);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}
```
Add imports: `import { enqueuePrintJob } from "@/lib/queries/print-queue";` and `import { getPool } from "@/lib/db";`.

Do NOT add a `requireModuleAccess` call — this file has none anywhere today, and adding one here would be an unrelated, unrequested change.

- [ ] **Step 4: Update `handleSubmit` in `src/components/dashboard/pemesanan-form-dialog.tsx`**

Current code inside the `isTakeAway` branch:
```tsx
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
    // "langsung Cetak PDF" — opens the freshly-issued DO's print
    // endpoint right away, inside this same click's user-gesture
    // window so the browser doesn't treat it as an unrequested popup.
    window.open(`/api/mkesindo/print/delivery-order/${result.data.deliveryOrderId}`, "_blank");
    handleOpenChange(false);
  });
  return;
}
```
Change to:
```tsx
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
    toast.success("SI ditambahkan ke antrian cetak.");
    triggerPrintQueuePollNow();
    handleOpenChange(false);
  });
  return;
}
```
Add imports (this file has neither today): `import { toast } from "sonner";` and `import { triggerPrintQueuePollNow } from "@/components/dashboard/print-queue-poller";`.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/lib/queries/print-queue.ts "src/app/mkesindo/(dashboard)/pemesanan/actions.ts" src/components/dashboard/pemesanan-form-dialog.tsx scripts/make-print-queue-jadwal-id-nullable.ts
git add scripts/make-print-queue-jadwal-id-nullable.ts src/lib/queries/print-queue.ts "src/app/mkesindo/(dashboard)/pemesanan/actions.ts" src/components/dashboard/pemesanan-form-dialog.tsx
git commit -m "feat: Takeaway orders print via the thermal print-queue instead of a DO PDF"
```

---

### Task 5: "Lihat SI" button on `/mkesindo/pemesanan`

**Files:**
- Modify: `src/lib/queries/pemesanan.ts`
- Modify: `src/components/dashboard/pemesanan-list.tsx`

**Interfaces:**
- Produces: `SalesOrderListRow` gains `InvoiceToken: string | null`.

- [ ] **Step 1: Extend `src/lib/queries/pemesanan.ts`**

Add the import: `import { encodeInvoiceToken } from "@/lib/queries/invoice-public";`

Add to `SalesOrderListRow` (after `Status: SalesOrderStatus;`):
```typescript
  // null until an SI has actually been issued for this order (Terbit
  // orders always have one; Draft/Belum Dijadwalkan never do).
  InvoiceToken: string | null;
```

In `getSalesOrderList`'s query, add a new `OUTER APPLY` right after the existing `do_` one:
```sql
    OUTER APPLY (
      SELECT TOP 1 si.SalesInvoiceID
      FROM SalesInvoice si
      WHERE si.IsDeleted = 0
        AND (
          si.SalesOrderID = so.SalesOrderID
          OR REPLACE(si.DeliveryOrderID, '''', '') = do_.DeliveryOrderID
        )
    ) si
```
Add `si.SalesInvoiceID AS InvoiceSalesInvoiceID` to the SELECT list (anywhere after `Status`).

Change the function's return statement from `return result.recordset;` to:
```typescript
  return (result.recordset as (Omit<SalesOrderListRow, "InvoiceToken"> & { InvoiceSalesInvoiceID: string | null })[]).map(
    (r) => {
      const { InvoiceSalesInvoiceID, ...rest } = r;
      return { ...rest, InvoiceToken: InvoiceSalesInvoiceID ? encodeInvoiceToken(InvoiceSalesInvoiceID) : null };
    }
  );
```

- [ ] **Step 2: Update `src/components/dashboard/pemesanan-list.tsx`**

Add `FileText` to the existing lucide-react import: `import { Pencil, Trash2, CalendarClock, FileText } from "lucide-react";`

Replace the row's action-buttons block (currently two separate `canModify ? (...) : (...)` `<div>`s):
```tsx
      {canModify ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={handleDelete}>
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      ) : (
        // Scheduling (Ubah Pemesanan) and delete are gone once Terbit — this
        // is the one thing staff can still fix on a shipped order: a wrong
        // TransDate (see UbahTanggalPemesananDialog's own comment).
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" onClick={onEditTransDate} title="Ubah tanggal pemesanan">
            <CalendarClock className="size-3.5" />
          </Button>
        </div>
      )}
```
with:
```tsx
      <div className="flex shrink-0 items-center gap-1">
        {row.InvoiceToken && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Lihat SI"
            render={<a href={`/mkesindo/invoice/${row.InvoiceToken}`} target="_blank" rel="noopener noreferrer" />}
          >
            <FileText className="size-3.5" />
          </Button>
        )}
        {canModify ? (
          <>
            <Button variant="ghost" size="icon" className="size-7" onClick={onEdit}>
              <Pencil className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={handleDelete}>
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          </>
        ) : (
          // Scheduling (Ubah Pemesanan) and delete are gone once Terbit —
          // this is the one thing staff can still fix on a shipped order: a
          // wrong TransDate (see UbahTanggalPemesananDialog's own comment).
          <Button variant="ghost" size="icon" className="size-7" onClick={onEditTransDate} title="Ubah tanggal pemesanan">
            <CalendarClock className="size-3.5" />
          </Button>
        )}
      </div>
```

- [ ] **Step 3: Smoke-test against the live dev DB**

Write a temporary script (delete after running):
```typescript
// scratch-check-pemesanan-si.ts (temporary — delete after running)
import "dotenv/config";
import { getSalesOrderList } from "./src/lib/queries/pemesanan";

async function main() {
  const rows = await getSalesOrderList({ from: "2026-08-01", to: "2026-08-26" });
  console.log(rows.filter((r) => r.InvoiceToken != null).slice(0, 3).map((r) => ({ id: r.SalesOrderID, status: r.Status, token: r.InvoiceToken })));
  console.log("Total rows:", rows.length, "with InvoiceToken:", rows.filter((r) => r.InvoiceToken != null).length);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```
Expected: at least some `Terbit`-status rows have a non-null `InvoiceToken`; `Belum Dijadwalkan`/most `Draft` rows have `null`.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/lib/queries/pemesanan.ts src/components/dashboard/pemesanan-list.tsx
git add src/lib/queries/pemesanan.ts src/components/dashboard/pemesanan-list.tsx
git commit -m "feat: add Lihat SI button to /mkesindo/pemesanan"
```

---

### Task 6: Takeaway timeline row on `/mkesindo/delivery`

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`
- Modify: `src/components/dashboard/pengiriman-board.tsx`
- Modify: `src/app/mkesindo/(dashboard)/delivery/page.tsx`

**Interfaces:**
- Produces: `TakeawayOrder` interface and `getPengirimanBoard`'s return type gains `takeawayOrders: TakeawayOrder[]`.

- [ ] **Step 1: Extend `getPengirimanBoard` in `src/lib/queries/pengiriman-jadwal.ts`**

Add near `ExternalDelivery`'s own definition:
```typescript
export interface TakeawayOrder {
  DeliveryOrderID: string;
  VoucherNo: string;
  CustomerName: string;
  TransDate: string | Date;
  TotalKantong: number;
}
```

Change `getPengirimanBoard`'s return type:
```typescript
export async function getPengirimanBoard(
  businessDate: string
): Promise<{ armada: ArmadaRow[]; jadwal: JadwalCard[]; externalDeliveries: ExternalDelivery[]; takeawayOrders: TakeawayOrder[] }> {
```

Add a 4th query to the existing `Promise.all([getArmadaList(), ...])` array (alongside `armada`, the Jadwal query, and the external-DO query):
```typescript
    pool
      .request()
      .input("businessDate", sql.Date, businessDate).query(`
        SELECT
            do_.DeliveryOrderID,
            do_.VoucherNo,
            ISNULL(bp.Name, 'Tidak Diketahui') AS CustomerName,
            do_.TransDate,
            ISNULL(SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Qty / 2.0 ELSE dod.Qty END), 0) AS TotalKantong
        FROM DeliveryOrder do_
        LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        LEFT JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        WHERE do_.IsDeleted = 0
          AND do_.SalesmanID = '0127'
          -- TransDate here is written by this dashboard's own code
          -- (takeaway.ts's GETDATE()), so it's true UTC — same
          -- true-UTC + 14:00-WIB-rollover window as this function's own
          -- Jadwal query above, NOT the plain-WIB-calendar-date match the
          -- externalDeliveries query above uses (that one is specifically
          -- for naive-WIB desktop-ERP-authored timestamps).
          AND do_.TransDate >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
          AND do_.TransDate < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
        GROUP BY do_.DeliveryOrderID, do_.VoucherNo, bp.Name, do_.TransDate
        ORDER BY do_.TransDate
      `),
```
Update the destructuring right after the `Promise.all` from `const [armada, jadwalResult, externalResult, pabrik] = await Promise.all([` to `const [armada, jadwalResult, externalResult, takeawayResult, pabrik] = await Promise.all([`, inserting the new query in the array in the matching position (before `getPabrikLocation()`, after the external-DO query).

Update the final `return` statement:
```typescript
  return { armada, jadwal, externalDeliveries: externalResult.recordset, takeawayOrders: takeawayResult.recordset };
```

- [ ] **Step 2: Add `TakeawayCard` and `TakeawayRowBoard` to `src/components/dashboard/pengiriman-board.tsx`**

Add the import: extend the existing `import type { JadwalCard as JadwalCardData, AvailableSalesOrder, ExternalDelivery, ArmadaConflictInfo } from "@/lib/queries/pengiriman-jadwal";` to also import `TakeawayOrder` (as a value... no, it's a type-only import — add `type TakeawayOrder` to that same `import type { ... }` line).

Add these two functions anywhere near `ExternalDoCard` (e.g. right after it):
```tsx
function TakeawayCard({ order, hourWidth, top }: { order: TakeawayOrder; hourWidth: number; top: number }) {
  return (
    <div
      title={`${order.VoucherNo} — ${order.CustomerName} (${order.TotalKantong} kantong) — Takeaway`}
      className="absolute flex flex-col justify-center overflow-hidden rounded-md border border-primary/30 bg-primary/10 px-1.5 py-1 text-left text-[9px] text-primary"
      style={{ left: hourFraction(order.TransDate) * hourWidth, top, width: EXTERNAL_DO_WIDTH, height: CARD_HEIGHT }}
    >
      <span className="truncate font-semibold">{order.CustomerName}</span>
      <span className="truncate tabular-nums opacity-80">
        {formatTime(order.TransDate)} &middot; {order.TotalKantong} kantong
      </span>
      <span className="truncate opacity-70">Takeaway</span>
    </div>
  );
}

function TakeawayRowBoard({ orders, hourWidth, dayWidth }: { orders: TakeawayOrder[]; hourWidth: number; dayWidth: number }) {
  const blocks = useMemo(
    () => orders.map((o) => ({ key: o.DeliveryOrderID, left: hourFraction(o.TransDate) * hourWidth, width: EXTERNAL_DO_WIDTH })),
    [orders, hourWidth]
  );
  const { laneOf, laneCount } = useMemo(() => assignLanes(blocks), [blocks]);
  const rowHeight = ROW_TOP_PADDING + Math.max(1, laneCount) * (CARD_HEIGHT + CARD_GAP);

  if (orders.length === 0) return null;

  return (
    <div className="flex items-stretch">
      <div className="sticky left-0 z-10 flex w-56 shrink-0 items-center bg-card py-1 pr-3 text-xs font-medium">Takeaway</div>
      <div className="relative shrink-0 border-l" style={{ width: dayWidth, height: rowHeight }}>
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute top-0 h-full border-r" style={{ left: h * hourWidth, width: hourWidth }} />
        ))}
        {orders.map((o) => (
          <TakeawayCard
            key={o.DeliveryOrderID}
            order={o}
            hourWidth={hourWidth}
            top={ROW_TOP_PADDING + (laneOf.get(o.DeliveryOrderID) ?? 0) * (CARD_HEIGHT + CARD_GAP)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire `takeawayOrders` through `PengirimanBoard`'s props and render it**

In `PengirimanBoard`'s prop destructuring and type block (currently `armada, jadwal, externalDeliveries, activities, ...` and matching type entries), add `takeawayOrders` as a prop of type `TakeawayOrder[]`.

In the render, change:
```tsx
                <div className="flex flex-col divide-y gap-y-3">
                  {sortedArmada.map((a) => (
```
to:
```tsx
                <div className="flex flex-col divide-y gap-y-3">
                  <TakeawayRowBoard orders={takeawayOrders} hourWidth={hourWidth} dayWidth={dayWidth} />
                  {sortedArmada.map((a) => (
```
(no other change to that `.map(...)` block — it continues exactly as before, just with the new row inserted above it as a sibling in the same flex container.)

- [ ] **Step 4: Pass `takeawayOrders` from `src/app/mkesindo/(dashboard)/delivery/page.tsx`**

Add `takeawayOrders={board.takeawayOrders}` alongside the existing `armada={board.armada}` / `jadwal={board.jadwal}` / `externalDeliveries={board.externalDeliveries}` props on `<PengirimanBoard>`.

- [ ] **Step 5: Smoke-test against the live dev DB**

Write a temporary script (delete after running):
```typescript
// scratch-check-takeaway-timeline.ts (temporary — delete after running)
import "dotenv/config";
import { getPengirimanBoard } from "./src/lib/queries/pengiriman-jadwal";
import { getBusinessDateISO } from "./src/lib/business-date";

async function main() {
  const board = await getPengirimanBoard(getBusinessDateISO());
  console.log(board.takeawayOrders);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```
There may be zero rows today (depends on live Takeaway traffic) — that's an acceptable result as long as the query runs without error; if Task 4 has already been merged and a fresh Takeaway order created since, confirm it appears with a plausible `TotalKantong` and `TransDate`.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npx eslint src/lib/queries/pengiriman-jadwal.ts src/components/dashboard/pengiriman-board.tsx "src/app/mkesindo/(dashboard)/delivery/page.tsx"
git add src/lib/queries/pengiriman-jadwal.ts src/components/dashboard/pengiriman-board.tsx "src/app/mkesindo/(dashboard)/delivery/page.tsx"
git commit -m "feat: add hour-axis Takeaway timeline row above the armada board"
```

Manually verify (UI change observable in a running dev server): open `/mkesindo/delivery`, confirm the board still renders correctly with no Takeaway orders today (the row should simply not appear, per `if (orders.length === 0) return null;`), and if a Takeaway order exists for today's business date, confirm its card appears in its own row above the armada rows, positioned at roughly the right hour.

---

## Final verification (after all tasks)

```bash
npx tsc --noEmit
npx eslint src
```
Both clean. Then manually exercise: Validasi Rute's new "Lihat SI" icon + its reprint button; a vehicle-check photo's enlarge-on-click; create a fresh Takeaway order and confirm it enqueues a print job (visible in `/mkesindo/delivery/cetak`'s Antrian Cetak tab) instead of opening a DO PDF, and that it now shows a "Lihat SI" button on `/mkesindo/pemesanan` and a card in the new Takeaway timeline row on `/mkesindo/delivery`.
