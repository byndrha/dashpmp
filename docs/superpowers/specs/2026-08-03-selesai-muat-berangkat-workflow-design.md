# Selesai Muat / Satpam-Gated Berangkat Workflow — Design Spec

**Company:** PT Mitra Kelola Esindo only. **Module:** Pengiriman (`delivery`).

## Goal

Restructure the Validasi Rute departure flow so that:
1. Real documents (DeliveryOrder + SalesInvoice) get created when loading finishes
   ("Selesai Muat"), not when the vehicle actually leaves — closing the gap where
   a Sales Invoice today only ever gets created manually in the desktop ERP,
   often well after departure.
2. The physical departure ("Berangkat") cannot be confirmed until Satpam has
   recorded a Cek Berangkat gate inspection (built in the prior Satpam plan) for
   that Jadwal.
3. Operator-selected stops get their invoice printed automatically the moment
   Selesai Muat succeeds, without closing the dialog, so the printed Surat SI can
   be handed to the driver before the vehicle even leaves the loading area.

## Real-world flow this implements

Operasional arranges stop order in Validasi Rute → Produksi & Driver start
loading, Operasional clicks **Mulai Muat** → while waiting, Operasional marks
which stops need SI printed → loading finishes, Operasional clicks **Selesai
Muat** → DeliveryOrder + SalesInvoice get created for every marked (and
unmarked) stop, marked stops' invoices open automatically in new tabs → printed
Surat SI handed to driver → driver takes the vehicle to the gate → Satpam
performs the vehicle check procedure (already built) → Satpam presses
**Berangkat**, which only works once that check exists.

## Non-goals

- No new PDF/invoice template — reuses the existing public `/invoice/[token]`
  page as-is (already decided: acceptable to print that page directly, not a
  formal letterhead document).
- No change to `mergeExternalDeliveriesIntoJadwal`'s desktop-ERP-originated DOs —
  those never get an auto-created SalesInvoice from this flow (same
  idempotent-skip reasoning `startBerangkat` already applies to their DO
  creation: an externally-issued document is never touched by dashboard-side
  invoice logic).
- No change to Cek Datang / "Kembali ke Pabrik" — unaffected by this plan.
- No change to who can create a Draft, edit stop order, add/remove SOs, or
  cancel a Draft — all Draft-phase capabilities are unchanged in *when* they're
  available, only the print-marking mechanism's underlying key changes (see
  below).

## Data model changes

```sql
ALTER TABLE DashboardPengirimanJadwal ADD JamSelesaiMuat DATETIME NULL;
ALTER TABLE DashboardPengirimanJadwalDetail ADD SalesInvoiceID VARCHAR(16) NULL;
```

`SalesInvoiceID` mirrors the existing `DeliveryOrderID` column on the same table
— one optional real-ERP-document reference per stop, populated at the same
moment `DeliveryOrderID` is (now Selesai Muat, not Berangkat).

## Server logic — `src/lib/queries/pengiriman-jadwal.ts`

`startBerangkat` is retired and replaced by two functions:

### `selesaiMuat(jadwalId: number): Promise<{ jadwalDetailId: number; invoiceToken: string }[]>`

Everything `startBerangkat` currently does, unchanged in order and shape
(server-side route-computed check, capacity check, atomic Draft→Terbit claim,
per-stop DeliveryOrder+DeliveryOrderDetail creation with the existing
idempotent-skip for rows that already carry a `DeliveryOrderID` from a merge),
**plus**:
- The atomic claim also sets `JamSelesaiMuat = GETDATE()` (not
  `JamAktualBerangkat` — that column is untouched by this function now).
- For every *newly created* DeliveryOrder in this call (never for a
  skip-because-already-merged row), immediately create one SalesInvoice +
  its SalesInvoiceDetail rows, using the exact column list and value shape
  `createTakeAwayPemesanan` (`src/lib/queries/takeaway.ts`) already uses for
  this — `TermOfPaymentID`/`DueDate` sourced from the same `SalesOrder` row
  already fetched for the DO, `SalesmanID` from the Jadwal's real driver
  (`headerRow.SalesmanID`), `VoucherNo` pattern `MKE/SI/{seq}/{yearMonth}/003/001`
  (new `nextSalesInvoiceId`/`nextSalesInvoiceDetailId`/`nextSIVoucherSeq`
  helpers, same shape as the DO ones already in this file). Writes the new
  `SalesInvoiceID` onto `DashboardPengirimanJadwalDetail.SalesInvoiceID` in the
  same statement that already writes `DeliveryOrderID` there.
- Returns `{ jadwalDetailId, invoiceToken }` for every stop that got a new
  invoice this call (`invoiceToken = encodeInvoiceToken(salesInvoiceId)`,
  reusing `src/lib/queries/invoice-public.ts`'s existing pure/stateless
  encoder — no new token table).
- On any failure mid-loop: same compensating cleanup `startBerangkat` already
  does for DeliveryOrder/JadwalDetail/Jadwal-status, extended to also
  soft-delete+detail-delete any SalesInvoice/SalesInvoiceDetail rows created
  earlier in the same failed attempt (mirrors `createTakeAwayPemesanan`'s own
  catch-block cleanup shape).

### `konfirmasiBerangkat(jadwalId: number): Promise<void>`

Replaces `startBerangkat` as the "Berangkat" button's action. Much lighter:
1. Fetch the Jadwal — must exist, `IsDeleted = 0`.
2. `Status` must be `'Terbit'` (thrown error otherwise: "Keberangkatan ini
   belum selesai dimuat.").
3. `JamAktualBerangkat` must be `NULL` (thrown error otherwise: "Keberangkatan
   ini sudah berangkat.").
4. A `DashboardVehicleCheck` row with `Tipe = 'BERANGKAT'` must exist for this
   `JadwalID` (thrown error otherwise: "Belum ada Cek Berangkat dari Satpam.")
   — same table the prior Satpam plan already created and populates.
5. `UPDATE DashboardPengirimanJadwal SET JamAktualBerangkat = GETDATE() WHERE
   JadwalID = @jadwalId AND Status = 'Terbit' AND JamAktualBerangkat IS NULL`
   (the `WHERE` clause doubles as the atomic race guard — no separate claim
   step needed since this is a single-column single-direction transition).

No route/capacity re-validation here — already done at `selesaiMuat`, and the
vehicle/stops physically haven't changed since then.

## Server actions — `src/app/(dashboard)/delivery/actions.ts`

- `startBerangkatAction` is removed. Two new actions replace it:
  `selesaiMuatAction(jadwalId)` (thin wrapper over `selesaiMuat`, returns its
  result, `revalidatePath("/delivery")`) and `konfirmasiBerangkatAction(jadwalId)`
  (thin wrapper over `konfirmasiBerangkat`, `revalidatePath("/delivery")`).

## `JadwalDetailRow` — one new field

`getJadwalDetail` (`pengiriman-jadwal.ts`) gains `InvoiceToken: string | null` on
each returned row — `encodeInvoiceToken(SalesInvoiceID)` when present, `null`
otherwise. The client never sees a raw `SalesInvoiceID`.

## UI — `src/components/dashboard/route-validation-dialog.tsx`

Three button states replace today's two (`isDraft` / not):

- **Draft, no `JamMulaiMuat`:** unchanged — "Batalkan Draft" / "Mulai Muat"
  (disabled if `isFutureDate`) / no departure action at all.
- **Draft, `JamMulaiMuat` set:** "Mulai Muat" becomes **"Selesai Muat"**. No
  "Berangkat" button in this state anymore.
- **Terbit, `JamAktualBerangkat` still null** (new state): a status line
  "Selesai Muat pukul HH:MM — menunggu Cek Berangkat", plus a **"Berangkat"**
  button, `disabled` until this Jadwal's `VehicleCheckPanel` data shows a
  `BERANGKAT` check exists (available to any `delivery`-access session, not
  Satpam-exclusive, per the earlier decision — Satpam is who's physically
  present to click it, not an enforced software restriction).
- **Terbit, `JamAktualBerangkat` set:** unchanged from today — read-only
  "Sudah berangkat pukul HH:MM".

`VehicleCheckPanel` continues to render under the same `!isDraft` condition —
now correctly covering both new Terbit sub-states, unchanged from the prior plan.

### Print-marking becomes available during Draft

`SortableStopRow`'s print-toggle icon currently only renders when
`detail.DeliveryOrderID != null` (true only after today's Berangkat). Since
marking must now happen *during* Draft/loading — before any document exists —
the toggle set (`printSelected`) is rekeyed from `Set<string>` of
`DeliveryOrderID` to `Set<number>` of `JadwalDetailID` (always present, from
Draft onward). The print-toggle icon becomes unconditional (always shown, not
gated on any field's presence).

### Selesai Muat action + auto-print

`handleSelesaiMuat()` (replaces today's `handleMuat`'s "start" role for the
completion side — `handleMuat`/"Mulai Muat" stays as today's `startMuatAction`
call, unchanged): calls `selesaiMuatAction(jadwalId)`, then for every
`{ jadwalDetailId, invoiceToken }` in the result where `jadwalDetailId` is in
the current `printSelected` set, `window.open(`/invoice/${invoiceToken}`,
"_blank")` — same non-dialog-closing mechanism `handlePrintSelected` already
uses for DO printing today. The existing manual "Cetak Terpilih" button stays
available afterward too (now driven by each stop's `InvoiceToken` instead of
`DeliveryOrderID`) for re-printing.

### Berangkat action

`handleKonfirmasiBerangkat()`: calls `konfirmasiBerangkatAction(jadwalId)`,
surfaces any thrown error (e.g. "Belum ada Cek Berangkat dari Satpam.") the
same way every other action's catch block in this dialog already does.

## Papan Pengiriman timeline — `src/components/dashboard/pengiriman-board.tsx`

`autoSegments`' existing "Sedang Memuat" segment (`JamMulaiMuat` →
`JamAktualBerangkat`) changes its end boundary to `JamSelesaiMuat` (a Jadwal
now needs `JamMulaiMuat && JamSelesaiMuat`, not `JamAktualBerangkat`, to show
this segment at all).

One new segment, **"Menunggu Keberangkatan"**: `JamSelesaiMuat` →
(`JamAktualBerangkat` if set, else the current render time — an open-ended,
visually-distinct segment showing the vehicle is loaded and waiting on Satpam).
Only rendered when `JamSelesaiMuat` is set.

"Dalam Perjalanan" / "Kembali ke Pabrik" segments are unchanged — still keyed
off `JamAktualBerangkat` exactly as today (including the already-built real
`JamKembaliAktual` override from Cek Datang).

`JadwalCard` gains `JamSelesaiMuat: string | Date | null`, populated by
`getPengirimanBoard`'s existing SELECT (straightforward new column, same
pattern as every other `DashboardPengirimanJadwal` column already selected
there).

## Access control

No new permission concept needed — `selesaiMuatAction`/`konfirmasiBerangkatAction`
both gate on the existing `requireModuleAccess("delivery")`, matching every
other action in this file. `konfirmasiBerangkat`'s Cek-Berangkat-exists check is
the actual gate keeping the button meaningfully locked, not a role check (per
the earlier decision: any delivery-access session may click it once unlocked).

## Open risk, explicitly accepted

`selesaiMuat` is a bigger, longer-running single call than `startBerangkat`
was (same work, plus N more SalesInvoice inserts) — no user-facing change in
shape (still one atomic claim, one loop, one compensating-cleanup catch), just
proportionally more DB round trips per stop. Given real Jadwal sizes (a handful
to ~20 stops, per live data seen this session), this is not expected to be a
meaningfully different latency experience than today's DO-only creation.
