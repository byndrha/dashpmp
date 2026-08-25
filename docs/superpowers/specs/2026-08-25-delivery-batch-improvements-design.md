# Delivery/Pemesanan/Satpam Batch Improvements

## Context

Seven independent requests landed in one batch, spanning the thermal-print feature, Validasi Rute, satpam-app, Takeaway orders, and the Papan Pengiriman board. They don't share a single theme, but several share infrastructure (the print-queue, the `getInvoiceByToken`/`encodeInvoiceToken` view-link pattern, `CheckSummary`) — grouped here as one spec, still one plan, since none is large enough alone to justify its own spec/plan cycle, and several tasks in the resulting plan touch the same files.

## 1. QRIS Statis image — enlarge 1.5x

The image printed too small to scan reliably (per live test against a real printer, on `MKE/SI/003497/2026-08/003/001`).

**Decision:** `QRIS_IMAGE_TARGET_DOTS` in `src/lib/thermal-printer/receipt-builder.ts` goes from 200 to 300 (the longer side; the other side scales proportionally, unchanged logic). Already implemented and pushed (commit history: `712fe3e`, `7e69fe3`, then this bump) — no plan task needed for this item; it's done.

## 2. "Lihat SI" replaces the manual reprint icon in Validasi Rute

**Decision (from user):** The existing standalone "Cetak ulang" icon in `SortableStopRow` (`src/components/dashboard/route-validation-dialog.tsx:189-203`) is replaced, not duplicated. A new icon-only "Lihat SI" button takes its place, shown only once `detail.InvoiceToken != null` (an SI has actually been issued for this stop — practically always right after Selesai Muat, since that action issues SO+DO+SI together). Clicking it opens a popup showing the SI's content; a reprint icon lives inside that popup.

**Current icon-slot logic to change** (`route-validation-dialog.tsx:189-215`):
```tsx
{!hasDeparted ? (
  <button ... onClick={() => onReprint(detail.JadwalDetailID)} ...><Printer .../></button>
) : detail.JamSelesai != null ? (
  <button ... onClick={() => onOpenProof(detail)} ...><CheckCircle2 .../></button>
) : (
  <span className="size-6 shrink-0" />
)}
```

**New logic:** the print icon becomes conditional on `detail.InvoiceToken != null` instead of `!hasDeparted`, and its `onClick` opens the new SI popup instead of calling `onReprint` directly:
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
  <button ... onClick={() => onOpenProof(detail)} ...><CheckCircle2 .../></button>
) : (
  <span className="size-6 shrink-0" />
)}
```
(`InvoiceToken != null` is checked first regardless of `hasDeparted` — an SI exists well before departure, right after Selesai Muat, so "Lihat SI" is available pre-departure too, same window the old reprint icon covered. Post-departure with a completed stop, the proof-of-delivery checkmark still takes over, exactly as today, since `InvoiceToken` doesn't change mid-flow.)

`onReprint`/`reprinting`/`reprintingId` props and the standalone reprint button are removed from `SortableStopRow` entirely — reprinting now only happens from inside the new popup.

**New component: `src/components/dashboard/stop-sales-invoice-dialog.tsx`**, modeled directly on `stop-delivery-proof-dialog.tsx` (same shape: `{ detail: DriverStopRow | null; onOpenChange }`, fetch-on-detail-change effect, loading/empty states):
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

export function StopSalesInvoiceDialog({
  detail,
  onOpenChange,
}: {
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
                <span>{line.Name} x{line.Qty}</span>
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
(`Delivery` is used, not `SalesOrder`, since it reflects what actually loaded on this specific stop's DO — matching what the thermal receipt itself prints — and falls back to nothing rendered if `Delivery` is null, which `getInvoiceByToken` already returns whenever the linked DeliveryOrder can't be resolved.)

**New server action** in `src/app/mkesindo/(dashboard)/delivery/actions.ts`, next to the existing print-queue actions:
```typescript
export async function getSalesInvoiceForViewAction(invoiceToken: string): Promise<ActionResult<PublicInvoice | null>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    return getInvoiceByToken(invoiceToken);
  });
}
```
(imports `getInvoiceByToken`, `type PublicInvoice` from `@/lib/queries/invoice-public` — a new import block, that file isn't currently imported in `actions.ts`.)

**Wiring in `RouteValidationDialog`** (mirrors `proofDetail`'s existing wiring exactly):
- New state: `const [siDetail, setSiDetail] = useState<DriverStopRow | null>(null);`
- Reset alongside `proofDetail` in the jadwal-switch effect (`route-validation-dialog.tsx:426`, add `setSiDetail(null);` next to `setProofDetail(null);`).
- `SortableStopRow` gets a new `onOpenSi: (detail: DriverStopRow) => void` prop, wired at the call site (`:1437` area) as `onOpenSi={setSiDetail}`, alongside `onOpenProof={setProofDetail}`. Remove the `onReprint`/`reprinting` props from `SortableStopRow` and its call site (the `handleReprint`/`reprintingId` state in `RouteValidationDialog` itself — `:363-380` — becomes dead code once nothing calls it, and is removed).
- Render `<StopSalesInvoiceDialog detail={siDetail} onOpenChange={(open) => !open && setSiDetail(null)} />` right next to `<StopDeliveryProofDialog .../>` (`:1594` area).

## 3. Click-to-enlarge popup for vehicle-check photos

No lightbox component exists anywhere in this codebase today — every read-only vehicle-check photo renders through one shared component, `CheckSummary` (`src/components/vehicle-check-summary.tsx:44-49`), consumed by three places (`vehicle-check-dialog.tsx`, `route-validation-dialog.tsx`'s "Hasil Inspeksi Kendaraan (Satpam)" section, `satpam-app/beranda-client.tsx`'s `TimelineCard` popup) — fixing it there covers all three at once.

**New component: `src/components/ui/image-lightbox.tsx`**:
```tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// Click-to-enlarge popup for a single thumbnail — no header/padding, just
// the full-size image on a dark backdrop, dismissed by clicking outside or
// closing the dialog (DialogContent's own built-in behavior). Generic over
// any thumbnail image in the app, not vehicle-check-specific, so it lives
// in ui/ rather than alongside CheckSummary.
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

**Change in `vehicle-check-summary.tsx:44-49`** — replace the bare `<img>` with the new trigger:
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
Add the import: `import { ImageLightboxTrigger } from "@/components/ui/image-lightbox";`. No other file changes — `VehicleCheckDialog`, `RouteValidationDialog`'s inspection section, and `satpam-app/beranda-client.tsx`'s `TimelineCard` all render through `CheckSummary` already, so they inherit the enlarge-on-click behavior automatically.

## 4. Satpam "Cek Kedatangan" qty bug — showing departure qty, not return qty

**Root cause** (confirmed by reading `src/lib/queries/satpam-inspection.ts:48-78`): `INSPECTION_ROW_SELECT` computes `Qty10KG`/`Qty5KG` once, from `SalesOrderDetail.Qty` (the original loaded/departure amount), and reuses that exact same subquery for both the BERANGKAT and DATANG branches (`toCard()` at `:80-99` copies `r.Qty10KG`/`r.Qty5KG` verbatim regardless of `tipe`). The DATANG card should instead show how much came back — `DashboardPengirimanStopDeliveryItem.QtyRetur`, already tracked per stop (written in `pengiriman-jadwal.ts` at `confirmStopDelivery`, read back per-stop in `getStopDeliveryProof`) — but nothing today aggregates it to the whole-Jadwal level for this card.

**Decision:** add a second, DATANG-only aggregate query, and a new pair of fields on `SatpamInspectionCard` (`qtyRetur10KG`/`qtyRetur5KG`) so BERANGKAT's existing loaded-qty fields are untouched and DATANG gets its own, correctly-labeled numbers instead of overloading `qty10KG`/`qty5KG` with two different meanings depending on `tipe`.

**`src/lib/queries/satpam-inspection.ts` changes:**

Add to `SatpamInspectionCard` (after `qty5KG`):
```typescript
// Only meaningful/non-zero for tipe === "DATANG" — aggregated from
// DashboardPengirimanStopDeliveryItem.QtyRetur across every stop on this
// Jadwal (the quantity that came back on the armada, not what it left
// with). BERANGKAT cards always get 0 here (nothing has been delivered
// yet to have a retur), matching how jamEstimasiKedatangan is already
// BERANGKAT-null/DATANG-only above.
qtyRetur10KG: number;
qtyRetur5KG: number;
```

Extend `RawInspectionRow` with `QtyRetur10KG: number; QtyRetur5KG: number;` and add to `INSPECTION_ROW_SELECT` (same `SalesOrderDetail.Name LIKE '%5 KG%'` split convention `JADWAL_KANTONG_10KG_EXPR`/`_5KG_EXPR` already use, applied to `QtyRetur` instead of `Qty`):
```sql
,
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
    ) AS QtyRetur5KG
```
(joins `SalesOrderDetailID` — `DashboardPengirimanStopDeliveryItem`'s own `SalesOrderDetailID` column, confirmed present per its `StopDeliveryProofItem` type — to `SalesOrderDetail` purely to read `Name` for the same 10KG/5KG split test already used everywhere else; this mirrors the exact join shape the rest of this query already uses for the departure-qty subqueries, just against a different source table.)

`toCard()` gains a 5th parameter `qtyRetur10KG: number, qtyRetur5KG: number` (BERANGKAT branch passes `0, 0`; DATANG branch passes `r.QtyRetur10KG, r.QtyRetur5KG`).

**`src/components/satpam-app/beranda-client.tsx:52` change** — `InspectionCard` shows retur qty instead of loaded qty specifically when rendering a DATANG card:
```tsx
<span className="text-sm text-muted-foreground">
  {card.tipe === "DATANG"
    ? formatKemasanQty(card.qtyRetur10KG, card.qtyRetur5KG)
    : formatKemasanQty(card.qty10KG, card.qty5KG)}
</span>
```

## 5. Takeaway prints via the thermal print-queue, not a DO PDF

**Current behavior** (`src/components/dashboard/pemesanan-form-dialog.tsx:133-156`): on successful Takeaway submission, `window.open(\`/api/mkesindo/print/delivery-order/${result.data.deliveryOrderId}\`, "_blank")` opens a pdfmake-rendered DeliveryOrder PDF.

**Decision (from user):** switch to the same thermal print-queue mechanism non-Takeaway SI printing already uses (`enqueuePrintJob`) — a physical SI Awal receipt prints automatically via whichever browser has `/mkesindo/delivery` open with the printer connected, same as every other SI. Takeaway has no `JadwalID` (it skips the whole Jadwal/Armada flow — `takeaway.ts:73-82`), so `DashboardPrintQueue.JadwalID` must become nullable.

**Schema migration** — new script `scripts/make-print-queue-jadwal-id-nullable.ts` (idempotent, matching the established pattern in this codebase's other one-off migration scripts):
```typescript
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

**`src/lib/queries/print-queue.ts` changes** (every `jadwalId`/`JadwalID` reference that currently assumes non-null):
- `enqueuePrintJob(pool, salesInvoiceId, jadwalId: number | null, isManual)` — `.input("jadwalId", sql.Int, jadwalId)` already accepts `null` fine with `mssql`'s `sql.Int` type (no change needed to the `.input()` call itself, only the TS parameter type).
- `PendingPrintJob.jadwalId: number | null`, `getPendingPrintQueue`'s mapping accordingly (`r.JadwalID` can now be `null`).
- `PrintQueueHistoryRow.jadwalId: number | null` (the SELECT already `LEFT JOIN`s everything off `pq.JadwalID`, so a null `JadwalID` already flows through as `armadaNama: null, vehicleNo: null, jamJadwal: null` with zero query changes needed there — only the TS type annotations need to widen).
- `retryPrintQueueJob`'s inline recordset type: `JadwalID: number | null`, passed straight through to `enqueuePrintJob` unchanged.
- `enqueueManualReprint` is untouched — it only ever operates on real Jadwal-backed stops (`DashboardPengirimanJadwalDetail`), never Takeaway.

**`src/components/dashboard/print-queue-poller.tsx` / `print-management-view.tsx`:** no changes needed — neither reads `jadwalId` for anything beyond passing it through display fields that are already null-safe (`armadaNama ?? "-"` etc., already written that way since Task 1 of the print-management feature treated every one of those fields as nullable from the start).

**`pemesanan-form-dialog.tsx:133-156` change:**
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
(`window.open(...)` line removed; `toast`/`triggerPrintQueuePollNow` imports added — `import { toast } from "sonner";`, `import { triggerPrintQueuePollNow } from "@/components/dashboard/print-queue-poller";`.)

**`createTakeAwayPemesananAction`** (`src/app/mkesindo/(dashboard)/pemesanan/actions.ts:40-47`) — current code (verified, has no `requireModuleAccess` call at all; this file has none anywhere, so this plan doesn't add one — that's a pre-existing, out-of-scope condition, not something this batch touches):
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
Changes to enqueue the print job right after `createTakeAwayPemesanan` succeeds, inside the same action (so the caller doesn't need its own DB access):
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
(imports added: `enqueuePrintJob` from `@/lib/queries/print-queue`, `getPool` from `@/lib/db`.)

## 6. "Lihat SI" button on `/mkesindo/pemesanan`

`getSalesOrderList` (`src/lib/queries/pemesanan.ts:123-172`) currently never joins `SalesInvoice`, so `SalesOrderListRow` has no way to know if an SI exists for a row. Add it as one more `OUTER APPLY`, alongside the existing `do_` one, resolving the same `SalesInvoice.DeliveryOrderID`-has-literal-quotes quirk `sales-cards.ts`/`invoice-public.ts` already work around:

**`src/lib/queries/pemesanan.ts` changes:**

Add to `SalesOrderListRow`:
```typescript
// null until an SI has actually been issued for this order (Terbit orders
// always have one; Draft/Belum Dijadwalkan never do).
InvoiceToken: string | null;
```

Add a new `OUTER APPLY` (alongside the existing `do_` one, `:161-165`):
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
(matches on `SalesOrderID` directly when set — true for every SI this dashboard's own code creates, including the new Takeaway path above — OR falls back to the DO-based match for any legacy/desktop-ERP-created SI that only links via `DeliveryOrderID`, same fallback shape `enqueueManualReprint`'s self-healing lookup already established.)

Add `si.SalesInvoiceID AS InvoiceSalesInvoiceID` to the outer `SELECT`, and map it in the returned row:
```typescript
return (result.recordset as (Omit<SalesOrderListRow, "InvoiceToken"> & { InvoiceSalesInvoiceID: string | null })[]).map(
  (r) => {
    const { InvoiceSalesInvoiceID, ...rest } = r;
    return { ...rest, InvoiceToken: InvoiceSalesInvoiceID ? encodeInvoiceToken(InvoiceSalesInvoiceID) : null };
  }
);
```
(add `import { encodeInvoiceToken } from "@/lib/queries/invoice-public";` — same token, same public `/mkesindo/invoice/{token}` page every other "Lihat Invoice" link already opens, per `sales-transaction-cards.tsx:63-80`'s established pattern.)

**`src/components/dashboard/pemesanan-list.tsx` changes** — add a "Lihat SI" icon button, always visible when `row.InvoiceToken != null` regardless of `canModify` (an issued SI doesn't go away when an order becomes Terbit — it's the opposite, it only starts existing once Terbit), placed as its own action group so it doesn't interfere with the existing `canModify` conditional:
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
      <Button variant="ghost" size="icon" className="size-7" onClick={onEdit}><Pencil className="size-3.5" /></Button>
      <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={handleDelete}><Trash2 className="size-3.5 text-destructive" /></Button>
    </>
  ) : (
    <Button variant="ghost" size="icon" className="size-7" onClick={onEditTransDate} title="Ubah tanggal pemesanan"><CalendarClock className="size-3.5" /></Button>
  )}
</div>
```
(replaces the two separate `canModify ? (...) : (...)` blocks at `pemesanan-list.tsx:84-102` with one wrapping div containing the new conditional button plus the existing two branches unchanged inside it; add `FileText` to the `lucide-react` import already at the top of the file, and the `render={<a .../>}` composition pattern already established for `Button` elsewhere in this codebase, e.g. `src/app/grup/akun/page.tsx`.)

## 7. Takeaway timeline row on `/mkesindo/delivery`

**Decision (from user):** a genuine hour-axis-aligned row, visually consistent with the armada rows below it, not a simple chronological list — reuses `hourFraction`/`hourWidth` exactly as `ArmadaRowBoard`/`ExternalDoCard` already do.

**New query** in `src/lib/queries/pengiriman-jadwal.ts` (alongside `ExternalDelivery`/`getPengirimanBoard`, added to that same function's `Promise.all` so it's one board load, not two round trips):

```typescript
export interface TakeawayOrder {
  DeliveryOrderID: string;
  VoucherNo: string;
  CustomerName: string;
  TransDate: string | Date;
  TotalKantong: number;
}
```

Add a 4th parallel query inside `getPengirimanBoard`'s existing `Promise.all` (alongside `armada`, the Jadwal query, the external-DO query):
```sql
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
  -- TransDate here is written by THIS dashboard's own code (takeaway.ts's
  -- GETDATE()), unlike the plain-WIB-calendar-date desktop-ERP externalDO
  -- query above — same true-UTC + 14:00-WIB-rollover window as the Jadwal
  -- query in this same function, not the naive-WIB plain-date match used
  -- for ERP-authored DOs.
  AND do_.TransDate >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
  AND do_.TransDate < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
GROUP BY do_.DeliveryOrderID, do_.VoucherNo, bp.Name, do_.TransDate
ORDER BY do_.TransDate
```
Add `takeawayOrders: TakeawayOrder[]` to `getPengirimanBoard`'s return type and destructure/return it alongside `externalDeliveries`.

**New component in `pengiriman-board.tsx`** — `TakeawayCard`, modeled directly on `ExternalDoCard` (`:706-743`) but simpler (no selection/merge behavior — Takeaway orders are terminal, already fully invoiced, nothing to merge into a Jadwal):
```tsx
function TakeawayCard({ order, hourWidth, top }: { order: TakeawayOrder; hourWidth: number; top: number }) {
  return (
    <div
      title={`${order.VoucherNo} — ${order.CustomerName} (${order.TotalKantong} kantong) — Takeaway`}
      className="absolute flex flex-col justify-center overflow-hidden rounded-md border border-primary/30 bg-primary/10 px-1.5 py-1 text-left text-[9px] text-primary"
      style={{ left: hourFraction(order.TransDate) * hourWidth, top, width: EXTERNAL_DO_WIDTH, height: CARD_HEIGHT }}
    >
      <span className="truncate font-semibold">{order.CustomerName}</span>
      <span className="truncate tabular-nums opacity-80">{formatTime(order.TransDate)} &middot; {order.TotalKantong} kantong</span>
      <span className="truncate opacity-70">Takeaway</span>
    </div>
  );
}
```
(reuses the existing `EXTERNAL_DO_WIDTH`/`CARD_HEIGHT` constants — no new sizing constant needed.)

**New row wrapper** `TakeawayRowBoard`, structurally a trimmed `ArmadaRowBoard` (own hour-gridlines background matching `:1319-1332`'s pattern, own lane assignment via the existing generic `assignLanes()` since multiple Takeaway orders can land in the same hour, but only one card type — no Jadwal/activity/external-DO cards mixed in):
```tsx
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
          <TakeawayCard key={o.DeliveryOrderID} order={o} hourWidth={hourWidth} top={ROW_TOP_PADDING + (laneOf.get(o.DeliveryOrderID) ?? 0) * (CARD_HEIGHT + CARD_GAP)} />
        ))}
      </div>
    </div>
  );
}
```

**Wiring into `PengirimanBoard`'s render** (`:1679-1696`) — inserted as the first child of the same `<div className="flex flex-col divide-y gap-y-3">`, before `sortedArmada.map(...)`, so it shares the exact same `hourWidth`/`dayWidth`/scroll container and sits visually above every armada row:
```tsx
<div className="flex flex-col divide-y gap-y-3">
  <TakeawayRowBoard orders={takeawayOrders} hourWidth={hourWidth} dayWidth={dayWidth} />
  {sortedArmada.map((a) => ( ... ))}
</div>
```
**Wiring `takeawayOrders` through:**
- `src/app/mkesindo/(dashboard)/delivery/page.tsx:63-68` — add `takeawayOrders={board.takeawayOrders}` alongside the existing `armada={board.armada}` / `jadwal={board.jadwal}` / `externalDeliveries={board.externalDeliveries}` props passed to `<PengirimanBoard>`.
- `PengirimanBoard`'s own signature (`pengiriman-board.tsx:1340-1364`) — add `takeawayOrders` to both the destructured prop list and its type block, alongside the existing `armada`/`jadwal`/`externalDeliveries: ExternalDelivery[]` entries: `takeawayOrders: TakeawayOrder[]` (import `TakeawayOrder` from `@/lib/queries/pengiriman-jadwal` alongside the existing `JadwalCard`/`ExternalDelivery` type imports at the top of this file).

No new state, no click handler — read-only, matching the decision that Takeaway orders are terminal/already fully processed by the time they'd appear here.

## Out of scope

- No changes to the driver-app, produksi-app, or any Takeaway creation-time validation.
- The `DashboardPrintQueue.JadwalID` nullable migration only relaxes the column — no other table's schema changes.
- Item 6's "Lihat SI" reuses the exact same public invoice page every other "Lihat Invoice" link in this codebase already opens; no new document/PDF type is introduced anywhere in this batch (item 5 also deliberately avoids building a pdfmake SalesInvoice template, per the user's own choice of the print-queue option over that alternative).
