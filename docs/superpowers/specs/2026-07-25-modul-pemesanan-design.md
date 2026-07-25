# Modul Pemesanan (Sales Order) — Design Spec

**Status:** Approved by user 2026-07-25, proceeding to implementation plan.

## Goal

Let staff create a Sales Order directly from the dashboard — picking an existing Mitra, entering a quantity, having price/wilayah/kecamatan/address auto-detected from that Mitra's existing data, and scheduling delivery (time + Armada + optional Driver) in the same action. Also give staff a list view of Sales Orders (all sources: this module, Pengajuan-approval auto-creation, and manual desktop-ERP entry) with a resolved scheduling status.

## Why this shape

The codebase already has two mature, independently-reviewed subsystems this module builds on top of rather than duplicating:

1. **SO creation** (`src/lib/queries/sales-order.ts`, `createSalesOrderFromPengajuan`) — already solves ID/VoucherNo sequencing, the full required-column shape of `SalesOrder`/`SalesOrderDetail` verified against live data, and price resolution via `PriceLevel`.
2. **Draft scheduling → route validation → real DeliveryOrder** (`src/lib/queries/pengiriman-jadwal.ts`, the Papan Pengiriman board) — already solves Armada capacity checks, Draft/Terbit lifecycle, and — critically — a **mandatory server-side route validation** before a Draft can become a real `DeliveryOrder` (`startBerangkat`). This was added deliberately after a prior plan found and fixed a Critical bug where publishing could bypass route validation.

Pemesanan's "pilih waktu pengiriman dan armada" therefore creates a `DashboardPengirimanJadwal` **Draft** (via the existing `createJadwalDraft`), not a real `DeliveryOrder` directly. It shows up immediately on the Papan Pengiriman board and still needs the existing "Berangkat" step (with its route-validation gate) before it becomes a real ERP document. This preserves the safeguard already built and reviewed rather than adding a second, unvalidated path to `DeliveryOrder` creation.

## Data shape reference (verified live against SQL Server)

`SalesOrder` — only `SalesOrderID` (PK, `varchar(16)`) is `NOT NULL`; every other column is nullable. `createSalesOrderFromPengajuan` already populates the full live-verified shape (StatusForm=1, Rate=1, empty-string placeholders for unused fields, IsClosed=0, IsDeleted=0). The new manual-creation function reuses that exact shape, changing only: `BusinessPartnerID` (real, selected), `TermOfPaymentID` (mitra's own, not hardcoded), `AddressInvoice`/`AddressDelivery` (mitra's own `Address`), `SalesmanID` (left blank on the SO itself — driver lives on the Jadwal/DeliveryOrder, not the SO), `DueDate` (= chosen delivery datetime).

`SalesOrderDetail` — only `SalesOrderDetailID` (PK) is `NOT NULL`. Same shape as `createSalesOrderFromPengajuan`'s detail insert, with `ItemID`/`Name`/`Unit`/`Price` switched based on the chosen kantong variant.

Both tables' `NOT NULL` constraints are satisfied identically to the already-shipped, live-verified `createSalesOrderFromPengajuan` path — no new nullability risk.

## Backend changes

### `src/lib/queries/mitra.ts`
- `getPriceLevelOptions(itemName: string = "Es Tube Jual")` — add an optional parameter (defaults preserve all 4 existing call sites unchanged) so it can also resolve price levels for `"Es Tube Jual 5 KG"`.

### `src/lib/queries/sales-order.ts`
- Add `KANTONG_VARIANTS` map: `{ "10kg": { itemId: "019", name: "Es Tube Jual" }, "5kg": { itemId: "0111", name: "Es Tube Jual 5 KG" } }`.
- Add `createSalesOrderManual(input): Promise<string>`:
  - `input: { businessPartnerId: string; variant: "10kg" | "5kg"; qtyKantong: number; deliveryDateTime: Date }`.
  - Looks up the mitra's `TermOfPaymentID` and `Address` (from `BusinessPartner`) — falls back to the existing hardcoded `SO_TERM_OF_PAYMENT_ID = "012"` only if the mitra's own value is null/blank.
  - Resolves price via `getPriceLevelOptions(variant.name)` and the mitra's `PriceLevel`; throws a descriptive error if the mitra has no `PriceLevel` set (caught by the UI to block submit early, but re-checked here as the real guard).
  - `DueDate` = `input.deliveryDateTime`.
  - Reuses the existing private `nextSalesOrderId`/`nextSalesOrderDetailId`/`nextVoucherSeq` helpers already in this file.
  - Returns the new `SalesOrderID`.

### `src/lib/queries/pemesanan.ts` (new file)
- `createPemesanan(input): Promise<{ salesOrderId: string; jadwalId: number }>`:
  - `input: { businessPartnerId, variant, qtyKantong, deliveryDateTime, armadaId, salesmanId: string | null }`.
  - Calls `createSalesOrderManual(...)`, then `createJadwalDraft({ armadaId, jamJadwal: deliveryDateTime, salesOrderIds: [salesOrderId] })`, then (only if `salesmanId` provided) `updateJadwalDriverTime(jadwalId, { jamJadwal: deliveryDateTime, salesmanId })`.
  - On any failure after the SO is created, soft-deletes the `SalesOrder`+`SalesOrderDetail` it just created (`IsDeleted = 1`) before rethrowing — same compensating-cleanup discipline `createJadwalDraft` itself already uses.
- `SalesOrderListRow` + `getSalesOrderList(filter: { from?: string; to?: string; wilayah?: string }): Promise<SalesOrderListRow[]>`:
  - Joins `SalesOrder` → `BusinessPartner` → `SalesOrderDetail` (summed qty/amount) → `DashboardPengirimanJadwalDetail`/`DashboardPengirimanJadwal` (LEFT) → `DeliveryOrder` (LEFT, by `SalesOrderID`, `IsDeleted=0`).
  - Status resolution: linked non-deleted Jadwal exists → its `Status` (`"Draft"`/`"Terbit"`); else a `DeliveryOrder` referencing this SO exists → `"Terbit"`; else → `"Belum Dijadwalkan"`.
  - Filtered by `TransDate` (exclusive-upper-bound convention, same as the rest of the app) and optional Wilayah (`bp.NPWPName`), defaulting via the existing `resolveFilter`/current-month convention — avoids the known `SalesOrder` backlog landmine (3400+ open rows back to 2018, see prior finding) since no query here goes unbounded.

### `src/app/(dashboard)/pemesanan/actions.ts` (new file)
- `"use server"` wrappers: `createPemesananAction`, calling `revalidatePath("/pemesanan")` and also `revalidatePath("/delivery")` (new Draft affects the Papan Pengiriman board too).

### `src/lib/permissions.ts`
- Add `"pemesanan"` to `MODULE_KEYS` and `MODULE_LABEL` (`"Pemesanan"`).

### `src/components/dashboard/app-sidebar.tsx`
- Insert nav entry between `delivery` and `mitra`: `{ href: "/pemesanan", label: "Pemesanan", icon: ClipboardList, moduleKey: "pemesanan" }` (new `lucide-react` import — not already used elsewhere in the sidebar).

## Frontend

### `src/components/dashboard/pemesanan-form-dialog.tsx` (new)
"Buat Pemesanan" button + dialog:
1. **Mitra** — searchable `Select` (or combobox) sourced from `getMitraList()`.
2. Read-only auto-filled block once a mitra is picked: Wilayah, Kecamatan, Alamat, Termin Pembayaran.
3. **Varian Kantong** — `10kg` / `5kg` toggle.
4. **Qty** — number input.
5. Read-only computed **Harga/kantong** and **Total** (client-side, mirrors the same `PriceLevel`×variant lookup — final authoritative calc happens server-side in `createSalesOrderManual`).
6. **Waktu Pengiriman** — date + time inputs, combined client-side into one `Date` (same `combineDateAndTime` pattern already used in `pengiriman-board.tsx`).
7. **Armada** — `Select` from `getArmadaList()`; rows with `Status !== "Baik"` rendered but disabled, matching the existing Papan Pengiriman rule.
8. **Driver** — optional `Select` from `getDriverOptions()`.
9. Submit disabled until Mitra, Qty > 0, Waktu, and Armada are all set, and the Mitra has a resolvable `PriceLevel`. On error, surface the thrown message inline (same pattern as `armada-dialog.tsx`/`delivery-assignment-panel.tsx`).

### `src/components/dashboard/pemesanan-list.tsx` (new)
Table: No. Voucher, Tanggal, Mitra, Wilayah, Qty, Total, Jatuh Tempo, Status (badge — Belum Dijadwalkan / Draft / Terbit).

### `src/app/(dashboard)/pemesanan/page.tsx` (new)
`requireModuleAccess("pemesanan")`, `FilterBar` (date range + wilayah, reusing `resolveFilter`), fetches `getSalesOrderList`, `getMitraList`, `getArmadaList`, `getDriverOptions` in parallel, renders the "Buat Pemesanan" dialog trigger + list.

## Error handling

- Every write path (`createSalesOrderManual`, `createPemesanan`) throws descriptive `Error`s (mitra missing `PriceLevel`, Armada capacity exceeded — already enforced inside `createJadwalDraft`) surfaced verbatim in the dialog, matching the established pattern across `armada-dialog.tsx` / `delivery-assignment-panel.tsx` / `pengiriman-board.tsx`.
- No new nullability risk: every inserted column mirrors the already-live-verified `createSalesOrderFromPengajuan` shape.

## Out of scope (explicitly not building)

- Editing/cancelling a Sales Order once created (existing Papan Pengiriman "Batalkan Draft" already covers cancelling the scheduling side while still Draft; SO-level edit/cancel is a separate, unrequested feature).
- Multi-item orders (more than one product line per SO) — every order is a single line of one kantong variant, matching how the rest of the system already treats "Es Tube Jual" as the sole real product.
- New database tables/columns — everything reuses existing schema.
