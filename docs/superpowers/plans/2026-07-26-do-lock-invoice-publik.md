# Kunci DO, Halaman Invoice Publik Implementation Plan (Fase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Once a departure is "Berangkat" (real `DeliveryOrder` created), nothing in this dashboard can change it anymore. (2) A new, dashboard-owned companion table + public route lets anyone with an unguessable link view a `SalesInvoice`'s amount due, with a static QRIS placeholder.

**Architecture:** Part 1 (DO lock) is a pure guard-and-UI change to already-existing, already-hardened code (`updateJadwalDriverTime`, `route-validation-dialog.tsx`) — no schema change, no new unknowns. Part 2 (public invoice link) adds one new dashboard-owned table (`DashboardInvoicePublicLink`) and reads only `SalesInvoice`/`BusinessPartner` columns already confirmed live in this codebase's existing queries (`aging.ts`, `sales.ts`) — no new, unverified column is read or written.

**Tech Stack:** Next.js Server Components (public route, outside the `(dashboard)` layout group — same pattern as the existing `/login` page), Node's built-in `crypto` module for the token, raw parameterized `mssql` queries.

## Global Constraints

- No automated test suite exists in this codebase. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual browser checks where the environment's DB connectivity allows.
- **Explicitly out of scope for this plan** (see spec, Part 2/4/out-of-scope): auto-creating the `SalesInvoice` row itself at `startBerangkat` time (blocked on live-verifying `SalesInvoice`/`SalesInvoiceDetail`'s exact column list first — a separate follow-up plan once DB access is confirmed), WhatsApp delivery of the invoice link, and Dynamic QRIS. This plan only builds: the DO lock, the public-link infrastructure, and the public page (which will simply show "not found" until a real `SalesInvoice` + `DashboardInvoicePublicLink` row exists — that pairing is what the follow-up plan creates).
- Every new query touching `SalesInvoice` in this plan reads ONLY these already-confirmed-live columns: `SalesInvoiceID`, `VoucherNo`, `TransDate`, `DueDate`, `Netto`, `Amount`, `BusinessPartnerID`, `IsDeleted` (confirmed via existing usage in `src/lib/queries/aging.ts` and `src/lib/queries/sales.ts`). Do not reference any other `SalesInvoice`/`SalesInvoiceDetail` column — anything beyond this list is unverified and out of scope until the follow-up plan's schema check.
- Reference: `docs/superpowers/specs/2026-07-26-do-lock-invoice-publik-design.md` for the full approved design.

---

### Task 0: Database schema (controller-run, not delegated)

- [ ] **Step 1: Run this DDL**

```sql
CREATE TABLE DashboardInvoicePublicLink (
  SalesInvoiceID VARCHAR(16) NOT NULL PRIMARY KEY,
  Token VARCHAR(64) NOT NULL UNIQUE,
  CreatedDate DATETIME NOT NULL DEFAULT GETDATE()
);
```

- [ ] **Step 2: Verify**

Confirm the table exists with the 3 columns above, `SalesInvoiceID` as PK, `Token` UNIQUE, via `INFORMATION_SCHEMA` or equivalent.

**Note:** if the database connector is unavailable when this task is picked up, proceed with Tasks 1-2 first (they do not depend on this table at all), and retry this task before starting Task 3.

---

### Task 1: Lock `updateJadwalDriverTime` once a Jadwal is Terbit

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`
- Modify: `src/lib/queries/delivery.ts`

**Interfaces:**
- `updateJadwalDriverTime`'s signature is unchanged — it now throws instead of succeeding when the target Jadwal's `Status` is `"Terbit"`.
- `assignDeliveryDriver`/`assignDeliveryVehicle` are removed from `delivery.ts` (their only caller is removed in this same task).

- [ ] **Step 1: Edit `src/lib/queries/pengiriman-jadwal.ts`**

Find the top import:
```ts
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";
```
Delete this line entirely (no longer used after this task).

Find:
```ts
export async function updateJadwalDriverTime(
  jadwalId: number,
  input: { jamJadwal: Date; salesmanId: string | null }
): Promise<void> {
  const pool = await getPool();
  const current = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status, ArmadaID FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = current.recordset[0] as { Status: JadwalStatus; ArmadaID: number } | undefined;
  if (!row) throw new Error("Keberangkatan tidak ditemukan.");

  const detailResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT SalesOrderID FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const bundledSalesOrderIds = (detailResult.recordset as { SalesOrderID: string }[]).map((r) => r.SalesOrderID);
  await assertJamJadwalNotBeforeOrders(pool, bundledSalesOrderIds, input.jamJadwal);

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal)
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamJadwal = @jamJadwal, SalesmanID = @salesmanId, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);

  if (row.Status === "Terbit") {
    const armadaResult = await pool
      .request()
      .input("armadaId", sql.Int, row.ArmadaID)
      .query(`SELECT Nama FROM DashboardArmada WHERE ArmadaID = @armadaId`);
    const armadaNama = (armadaResult.recordset[0] as { Nama: string } | undefined)?.Nama ?? null;

    const linkedDOs = await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`
        SELECT DeliveryOrderID FROM DashboardPengirimanJadwalDetail
        WHERE JadwalID = @jadwalId AND IsDeleted = 0 AND DeliveryOrderID IS NOT NULL
      `);
    for (const r of linkedDOs.recordset as { DeliveryOrderID: string }[]) {
      await assignDeliveryDriver(r.DeliveryOrderID, input.salesmanId);
      await assignDeliveryVehicle(r.DeliveryOrderID, armadaNama);
    }
  }
}
```

Replace the entire function with:
```ts
// Once a Jadwal is Terbit, a real DeliveryOrder (and, from a follow-up
// plan, a real SalesInvoice) already exists off it — nothing about the
// departure (time, driver, vehicle) may change through this dashboard
// anymore. This is a hard guard, not a soft warning: there is currently no
// correction/cancellation flow for an already-released DO, so this
// function simply refuses outright rather than silently cascading changes
// onto live documents the way it used to.
export async function updateJadwalDriverTime(
  jadwalId: number,
  input: { jamJadwal: Date; salesmanId: string | null }
): Promise<void> {
  const pool = await getPool();
  const current = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status, ArmadaID FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = current.recordset[0] as { Status: JadwalStatus; ArmadaID: number } | undefined;
  if (!row) throw new Error("Keberangkatan tidak ditemukan.");
  if (row.Status === "Terbit") throw new Error("Keberangkatan ini sudah rilis — tidak bisa diubah lagi.");

  const detailResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT SalesOrderID FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const bundledSalesOrderIds = (detailResult.recordset as { SalesOrderID: string }[]).map((r) => r.SalesOrderID);
  await assertJamJadwalNotBeforeOrders(pool, bundledSalesOrderIds, input.jamJadwal);

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal)
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamJadwal = @jamJadwal, SalesmanID = @salesmanId, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}
```

- [ ] **Step 2: Edit `src/lib/queries/delivery.ts`**

Find and delete the two functions `assignDeliveryDriver` and `assignDeliveryVehicle` in their entirety (search for `export async function assignDeliveryDriver` and `export async function assignDeliveryVehicle` — remove both complete function bodies). Confirm via `grep -rn "assignDeliveryDriver\|assignDeliveryVehicle" src/` that no other file references them before deleting (Task 1's own investigation already confirmed this — `pengiriman-jadwal.ts` was their only caller, and Step 1 just removed that call site).

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `pengiriman-jadwal.ts` or `delivery.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts src/lib/queries/delivery.ts
git commit -m "Lock updateJadwalDriverTime once a Jadwal is Terbit"
```

---

### Task 2: Lock the Validasi Rute UI and disable dragging a Terbit card

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`
- Modify: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- No new props. Purely internal rendering/behavior changes gated on the already-existing `isDraft` derivation in both files.

- [ ] **Step 1: Edit `src/components/dashboard/route-validation-dialog.tsx`**

Find:
```tsx
            <div className="flex flex-wrap items-center gap-2">
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32 shrink-0" />
              <Select value={driverId} onValueChange={(v) => setDriverId(v ?? "")}>
                <SelectTrigger className="min-w-40 flex-1">
                  <SelectValue placeholder="Driver">
                    {(v: string) => drivers.find((d) => d.SalesmanID === v)?.Name ?? "Pilih Driver"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => (
                    <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                      {d.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="shrink-0" disabled={pending} onClick={handleSaveDriverTime}>
                Simpan
              </Button>
            </div>
```

Change to (the editable form only renders while still Draft; once Terbit, a plain read-only summary line takes its place):
```tsx
            {isDraft ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32 shrink-0" />
                <Select value={driverId} onValueChange={(v) => setDriverId(v ?? "")}>
                  <SelectTrigger className="min-w-40 flex-1">
                    <SelectValue placeholder="Driver">
                      {(v: string) => drivers.find((d) => d.SalesmanID === v)?.Name ?? "Pilih Driver"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {drivers.map((d) => (
                      <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                        {d.Name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="shrink-0" disabled={pending} onClick={handleSaveDriverTime}>
                  Simpan
                </Button>
              </div>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{time}</span>
                <span className="text-muted-foreground">
                  {drivers.find((d) => d.SalesmanID === driverId)?.Name ?? "Tanpa driver"}
                </span>
              </p>
            )}
```

Find the `SortableStopRow` component's click-to-edit button:
```tsx
      <button type="button" onClick={() => onEdit(detail)} className="min-w-0 flex-1 text-left hover:underline">
        <p className="truncate font-medium">{detail.CustomerName}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {detail.Wilayah}
          {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
        </p>
      </button>
```

`SortableStopRow` needs a new `disabled: boolean` prop to know whether it's being rendered for a Draft or Terbit Jadwal. Find the component's signature:
```tsx
function SortableStopRow({
  detail,
  index,
  onEdit,
}: {
  detail: JadwalDetailRow;
  index: number;
  onEdit: (detail: JadwalDetailRow) => void;
}) {
```

Change to:
```tsx
function SortableStopRow({
  detail,
  index,
  onEdit,
  disabled,
}: {
  detail: JadwalDetailRow;
  index: number;
  onEdit: (detail: JadwalDetailRow) => void;
  disabled: boolean;
}) {
```

Change the click-to-edit button to:
```tsx
      <button
        type="button"
        onClick={() => !disabled && onEdit(detail)}
        disabled={disabled}
        className="min-w-0 flex-1 text-left hover:underline disabled:cursor-default disabled:hover:no-underline"
      >
        <p className="truncate font-medium">{detail.CustomerName}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {detail.Wilayah}
          {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
        </p>
      </button>
```

Find where `SortableStopRow` is rendered:
```tsx
                    {order.map((d, i) => (
                      <SortableStopRow key={d.JadwalDetailID} detail={d} index={i} onEdit={onEditSalesOrder} />
                    ))}
```

Change to:
```tsx
                    {order.map((d, i) => (
                      <SortableStopRow key={d.JadwalDetailID} detail={d} index={i} onEdit={onEditSalesOrder} disabled={!isDraft} />
                    ))}
```

- [ ] **Step 2: Edit `src/components/dashboard/pengiriman-board.tsx`**

Find (inside `DraggableJadwalCard`):
```tsx
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `jadwal-${j.JadwalID}`,
    data: { jadwalId: j.JadwalID },
  });
  const isDraft = j.Status === "Draft";
```

Change to:
```tsx
  const isDraft = j.Status === "Draft";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `jadwal-${j.JadwalID}`,
    data: { jadwalId: j.JadwalID },
    disabled: !isDraft,
  });
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx src/components/dashboard/pengiriman-board.tsx
git commit -m "Lock Validasi Rute UI and disable dragging once a Jadwal is Terbit"
```

---

### Task 3: Public invoice link query layer

**Files:**
- Create: `src/lib/queries/invoice-public.ts`

**Interfaces:**
- Produces: `generateInvoiceToken(): string`, `PublicInvoice` interface, `getInvoiceByToken(token: string): Promise<PublicInvoice | null>`.

- [ ] **Step 1: Write `src/lib/queries/invoice-public.ts`**

```ts
import { randomBytes } from "crypto";
import { getPool, sql } from "@/lib/db";

// A random, unguessable bearer token — not literal encryption (nothing here
// is ever decrypted). Anyone holding the token can view the invoice; the
// security property this needs is "can't be guessed or enumerated", which a
// 32-byte random value already gives without any cipher/key-management
// machinery.
export function generateInvoiceToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface PublicInvoice {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string | Date;
  DueDate: string | Date | null;
  Netto: number;
  CustomerName: string;
}

// Only ever selects the SalesInvoice/BusinessPartner columns already
// confirmed live elsewhere in this codebase (aging.ts, sales.ts) — no
// column here is a guess. Returns null for an unknown/expired token,
// deliberately without distinguishing "malformed" from "valid but
// nonexistent" so a caller can't fingerprint which tokens are real.
export async function getInvoiceByToken(token: string): Promise<PublicInvoice | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("token", sql.VarChar(64), token).query(`
      SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate, si.DueDate, si.Netto, bp.Name AS CustomerName
      FROM DashboardInvoicePublicLink pl
      JOIN SalesInvoice si ON si.SalesInvoiceID = pl.SalesInvoiceID AND si.IsDeleted = 0
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
      WHERE pl.Token = @token
    `);
  return (result.recordset[0] as PublicInvoice | undefined) ?? null;
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/invoice-public.ts
git commit -m "Add public invoice token generation and lookup"
```

---

### Task 4: Public invoice page

**Files:**
- Create: `src/app/invoice/[token]/page.tsx`

**Interfaces:**
- Consumes: `getInvoiceByToken` from Task 3 (`@/lib/queries/invoice-public`).

- [ ] **Step 1: Write `src/app/invoice/[token]/page.tsx`**

```tsx
import { getInvoiceByToken } from "@/lib/queries/invoice-public";
import { formatDate, formatRupiah } from "@/lib/format";

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invoice = await getInvoiceByToken(token);

  if (!invoice) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Invoice tidak ditemukan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Link ini tidak valid atau sudah tidak berlaku. Hubungi PT Mitra Kelola Esindo untuk bantuan.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-xs text-muted-foreground">Tagihan untuk</p>
        <h1 className="text-lg font-semibold">{invoice.CustomerName}</h1>

        <div className="mt-4 flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">No. Voucher</span>
            <span className="font-medium">{invoice.VoucherNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tanggal</span>
            <span className="font-medium">{formatDate(invoice.TransDate)}</span>
          </div>
          {invoice.DueDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Jatuh Tempo</span>
              <span className="font-medium">{formatDate(invoice.DueDate)}</span>
            </div>
          )}
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs text-muted-foreground">Total Tagihan</p>
          <p className="text-2xl font-semibold">{formatRupiah(invoice.Netto)}</p>
        </div>

        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="flex size-48 items-center justify-center rounded-lg bg-black">
            <span className="text-xs text-white">QRIS segera hadir</span>
          </div>
          <p className="text-xs text-muted-foreground">Pembayaran QRIS akan tersedia di sini</p>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/invoice/[token]/page.tsx"
git commit -m "Add public invoice page with static QRIS placeholder"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 0 TypeScript errors, 0 lint errors, build succeeds, `/invoice/[token]` appears in the production route table.

- [ ] **Step 2: Manual browser walkthrough — DO lock**

Open a Terbit Jadwal's Validasi Rute — confirm the Jam/Driver/Simpan block is replaced by the read-only line, "Batalkan Draft"/"Mulai Muat"/"Berangkat" are absent (already governed by the existing `isDraft` branch), and clicking a stop does nothing (no "Ubah Pemesanan" dialog opens). On the board, attempt to drag a Terbit card — confirm it doesn't move at all (not even a failed-then-reverted animation).

- [ ] **Step 3: Manual browser walkthrough — public invoice page (if DB access allows a test row)**

If database access is available: manually insert one test `DashboardInvoicePublicLink` row pointing at any real, existing `SalesInvoiceID` (there are live `SalesInvoice` rows already, from the desktop app / other flows), visit `/invoice/{token}` and confirm the amount/date/name render correctly; visit `/invoice/not-a-real-token` and confirm the "tidak ditemukan" page renders instead of an error. Delete the test row afterward. If database access is not available at verification time, note this step as deferred and record what would need to be checked once it's restored.

- [ ] **Step 4: Regression spot-check**

Confirm a Draft Jadwal's Validasi Rute still shows the full editable form (time/driver/Simpan, Batalkan Draft/Mulai Muat/Berangkat, clickable stops) exactly as before — this task must change nothing about Draft-status behavior. Confirm `/delivery`, `/pemesanan` still load normally.

- [ ] **Step 5: Record progress**

Append a summary of this plan's completion to `.superpowers/sdd/progress.md`, following the same format as prior entries. Explicitly note that Part 2 (auto `SalesInvoice` creation at `startBerangkat`) is a separate, not-yet-started follow-up plan blocked on live schema verification of `SalesInvoice`/`SalesInvoiceDetail`.
