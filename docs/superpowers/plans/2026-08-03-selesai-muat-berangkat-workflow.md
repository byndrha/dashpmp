# Selesai Muat / Satpam-Gated Berangkat Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split "Berangkat" into two moments — "Selesai Muat" (creates the real
DeliveryOrder AND a real SalesInvoice per stop, auto-prints marked stops'
invoices) and "Berangkat" (a light action, gated on a Satpam Cek Berangkat gate
check existing) — closing the gap where invoices today only get created
manually, often after the vehicle has already left.

**Architecture:** `startBerangkat` (`src/lib/queries/pengiriman-jadwal.ts`) is
retired and replaced by `selesaiMuat` (same route/capacity validation + DO
creation it already does, plus new SalesInvoice creation reusing
`createTakeAwayPemesanan`'s proven column/value shape from `takeaway.ts`) and
`konfirmasiBerangkat` (new, minimal — one status/guard check, one UPDATE). Two
new columns (`JamSelesaiMuat`, `SalesInvoiceID`) support this. The dialog UI
gains a third button-state (Terbit-but-not-departed) and rekeys its
print-marking mechanism to work from Draft onward. The board gains one new
timeline segment for the loaded-but-waiting gap.

**Tech Stack:** Next.js Server Actions, `mssql` (MKEsindo's own DB via
`getPool()`), existing `encodeInvoiceToken` (`src/lib/queries/invoice-public.ts`,
pure/stateless — no new token storage needed).

## Global Constraints

- No test framework — verification is `npx eslint <files>`, `npm run build`,
  `npx tsc --noEmit`, and live checks against real data via throwaway `npx tsx`
  scripts (deleted after use) or the browser.
- MKEsindo-only — never touch `getPmputraPool` or any `*-pmputra.ts` file.
- All new MSSQL access goes through `getPool()` from `@/lib/db`.
- `mergeExternalDeliveriesIntoJadwal`'s desktop-ERP-originated rows (identified
  by already carrying a non-null `DeliveryOrderID` before `selesaiMuat` runs)
  NEVER get an auto-created SalesInvoice — same reasoning `startBerangkat`
  already applies to skipping their DO creation.
- `konfirmasiBerangkat` must never create or modify a DeliveryOrder/SalesInvoice
  — that's `selesaiMuat`'s job only. `konfirmasiBerangkat` only ever touches
  `DashboardPengirimanJadwal.JamAktualBerangkat`.
- Accepted, documented tradeoff: `startBerangkat`'s existing TransDate-correction
  for idempotent-skip (already-merged-external) rows moves into `selesaiMuat`
  unchanged in shape — it now fires at "loading finished" time instead of
  "departed" time for those specific rows. Not fixed in this plan; call out in
  a code comment, don't silently drop it.

---

## Task 0: DDL — 2 new columns

**Files:**
- Create (temporary, deleted at the end of this task):
  `scripts/migrate-selesai-muat-schema.ts`

**Interfaces:**
- Produces: `DashboardPengirimanJadwal.JamSelesaiMuat` (`DATETIME NULL`),
  `DashboardPengirimanJadwalDetail.SalesInvoiceID` (`VARCHAR(16) NULL`).

- [ ] **Step 1: Write the DDL script**

```ts
// scripts/migrate-selesai-muat-schema.ts
// One-off DDL for the Selesai Muat / Satpam-gated Berangkat workflow. Run
// once, then delete this file (same convention as every other one-off DDL
// script in this project).
//
// Usage: npx tsx scripts/migrate-selesai-muat-schema.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  const col1 = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardPengirimanJadwal' AND COLUMN_NAME = 'JamSelesaiMuat'
  `);
  if (col1.recordset.length === 0) {
    await pool.request().query(`ALTER TABLE DashboardPengirimanJadwal ADD JamSelesaiMuat DATETIME NULL`);
    console.log("Added DashboardPengirimanJadwal.JamSelesaiMuat.");
  } else {
    console.log("DashboardPengirimanJadwal.JamSelesaiMuat already exists.");
  }

  const col2 = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DashboardPengirimanJadwalDetail' AND COLUMN_NAME = 'SalesInvoiceID'
  `);
  if (col2.recordset.length === 0) {
    await pool.request().query(`ALTER TABLE DashboardPengirimanJadwalDetail ADD SalesInvoiceID VARCHAR(16) NULL`);
    console.log("Added DashboardPengirimanJadwalDetail.SalesInvoiceID.");
  } else {
    console.log("DashboardPengirimanJadwalDetail.SalesInvoiceID already exists.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/migrate-selesai-muat-schema.ts`
Expected: both "Added ..." lines (or "already exists"), exit code 0.

- [ ] **Step 3: Verify against live data**

```ts
import "dotenv/config";
import { getPool } from "./src/lib/db";
async function main() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE (TABLE_NAME = 'DashboardPengirimanJadwal' AND COLUMN_NAME = 'JamSelesaiMuat')
       OR (TABLE_NAME = 'DashboardPengirimanJadwalDetail' AND COLUMN_NAME = 'SalesInvoiceID')
  `);
  console.log(r.recordset);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Expected: 2 rows.

- [ ] **Step 4: Delete the script and commit**

```bash
rm scripts/migrate-selesai-muat-schema.ts
git status
```
Expected: nothing to commit for this task (schema lives in the DB) — confirm
clean working tree before moving to Task 1.

---

## Task 1: Split `startBerangkat` into `selesaiMuat` + `konfirmasiBerangkat`

**Files:**
- Modify: `src/lib/queries/pengiriman-jadwal.ts`

**Interfaces:**
- Consumes: `encodeInvoiceToken` from `@/lib/queries/invoice-public` (existing,
  pure function — `encodeInvoiceToken(salesInvoiceId: string): string`).
- Produces: `selesaiMuat(jadwalId: number): Promise<{ jadwalDetailId: number;
  invoiceToken: string }[]>`, `konfirmasiBerangkat(jadwalId: number):
  Promise<void>`. `JadwalCard` gains `JamSelesaiMuat: string | Date | null`.
  `JadwalDetailRow` gains `InvoiceToken: string | null`.
- **Removes:** `startBerangkat` (no longer exported — every caller is updated
  in Task 2).

- [ ] **Step 1: Add the import and the 3 new SalesInvoice ID/voucher helpers**

Add near the top of the file, alongside the existing imports:
```ts
import { encodeInvoiceToken } from "@/lib/queries/invoice-public";
```

Add these 3 functions right after the existing `nextDOVoucherSeq` function
(find it via `grep -n "async function nextDOVoucherSeq" src/lib/queries/pengiriman-jadwal.ts`):
```ts
async function nextSalesInvoiceId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesInvoiceID AS INT)) AS MaxID FROM SalesInvoice`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSalesInvoiceDetailId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesInvoiceDetailID AS INT)) AS MaxID FROM SalesInvoiceDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

// Same numbering shape as nextDOVoucherSeq, MKE/SI/ prefix (matches the real
// SalesInvoice VoucherNo pattern already seen in takeaway.ts's own
// createTakeAwayPemesanan, e.g. "MKE/SI/000123/2026-08/003/001").
async function nextSIVoucherSeq(pool: sql.ConnectionPool, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/SI/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM SalesInvoice WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}
```

- [ ] **Step 2: Extend `SalesOrderForPublish` with `TermOfPaymentID`**

Find the current interface (via `grep -n "interface SalesOrderForPublish" src/lib/queries/pengiriman-jadwal.ts`) and change it:
```ts
interface SalesOrderForPublish {
  BusinessPartnerID: string;
  DueDate: Date | null;
  TermOfPaymentID: string;
}
```

- [ ] **Step 3: Add `JamSelesaiMuat` to `JadwalCard` and `InvoiceToken` to `JadwalDetailRow`**

In the `JadwalCard` interface, add right after the `DurasiMenit` field:
```ts
  DurasiMenit: number | null;
  // Set at selesaiMuat (loading finished, DO+SI created) — null until then,
  // and for every Jadwal created before this column existed. Drives the
  // board's new "Menunggu Keberangkatan" segment (JamSelesaiMuat ->
  // JamAktualBerangkat, open-ended while the latter is still null).
  JamSelesaiMuat: string | Date | null;
```
(Leave `JamKembaliAktual` and everything else in the interface exactly where it
already is — this is a pure addition.)

In the `JadwalDetailRow` interface, add right after `DeliveryOrderID`:
```ts
  DeliveryOrderID: string | null;
  // encodeInvoiceToken(SalesInvoiceID) when a SalesInvoice exists for this
  // stop (set at selesaiMuat, alongside DeliveryOrderID) — null otherwise.
  // The client never sees the raw SalesInvoiceID, only this opaque token,
  // used to build the print URL /invoice/{InvoiceToken}.
  InvoiceToken: string | null;
```

- [ ] **Step 4: Update `getJadwalDetail`'s SELECT to produce `InvoiceToken`**

Find the current function (`grep -n "export async function getJadwalDetail\b" src/lib/queries/pengiriman-jadwal.ts`) and change its SELECT list and GROUP BY
to include `jd.SalesInvoiceID`, then map the raw column to the encoded token in
JS (don't compute `encodeInvoiceToken` in SQL):
```ts
export async function getJadwalDetail(jadwalId: number): Promise<JadwalDetailRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT
          jd.JadwalDetailID,
          jd.SalesOrderID,
          jd.DeliveryOrderID,
          jd.SalesInvoiceID,
          jd.Urutan,
          bp.Name AS CustomerName,
          ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty,
          ISNULL(${JADWAL_BONUS_QTY_EXPR}, 0) AS BonusQty,
          ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KG,
          ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KG,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          bp.NPWPAddress AS Kecamatan,
          bp.Address AS Alamat,
          bp.MobileNo,
          ml.Latitude,
          ml.Longitude
      FROM DashboardPengirimanJadwalDetail jd
      JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
      JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = so.BusinessPartnerID
      WHERE jd.JadwalID = @jadwalId AND jd.IsDeleted = 0
      GROUP BY jd.JadwalDetailID, jd.SalesOrderID, jd.DeliveryOrderID, jd.SalesInvoiceID, jd.Urutan,
               bp.Name, bp.NPWPName, bp.NPWPAddress, bp.Address, bp.MobileNo, ml.Latitude, ml.Longitude
      ORDER BY jd.Urutan
    `);
  const rows = result.recordset as (Omit<JadwalDetailRow, "InvoiceToken"> & { SalesInvoiceID: string | null })[];
  return rows.map((r) => {
    const { SalesInvoiceID, ...rest } = r;
    return { ...rest, InvoiceToken: SalesInvoiceID ? encodeInvoiceToken(SalesInvoiceID) : null };
  });
}
```

- [ ] **Step 5: Replace `startBerangkat` with `selesaiMuat`**

Find the current `startBerangkat` function (starts at the comment block
beginning `// Draft -> Terbit, fired by clicking "Berangkat"` — search
`grep -n "export async function startBerangkat" src/lib/queries/pengiriman-jadwal.ts`)
and replace the ENTIRE function (comment included) with:

```ts
// Draft -> Terbit, fired by clicking "Selesai Muat" (loading finished). Does
// everything the old startBerangkat used to do EXCEPT recording the actual
// physical departure — that's konfirmasiBerangkat's job now, fired later by
// Satpam at the gate. Route/driver validation already happened while the
// Jadwal sat in Draft; this is the moment the dashboard's SO selection
// becomes real DeliveryOrder AND SalesInvoice documents (reusing
// createTakeAwayPemesanan's exact SalesInvoice column/value shape from
// takeaway.ts) so a Surat SI can be printed and handed to the driver before
// the vehicle leaves. For each detail row (in Urutan order), creates one real
// DeliveryOrder + DeliveryOrderDetail(s) AND one SalesInvoice +
// SalesInvoiceDetail(s) from the linked SalesOrder/SalesOrderDetail. Writes
// DeliveryOrderID/SalesInvoiceID back onto the detail row, then flips
// Jadwal.Status and sets JamSelesaiMuat together in the same atomic claim. On
// partial failure, soft-deletes only the DeliveryOrder/DeliveryOrderDetail/
// SalesInvoice/SalesInvoiceDetail rows this call itself created (not the
// Jadwal/SO selection) and rethrows.
export async function selesaiMuat(jadwalId: number): Promise<{ jadwalDetailId: number; invoiceToken: string }[]> {
  const pool = await getPool();

  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT ArmadaID, SalesmanID, Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; SalesmanID: string | null; Status: JadwalStatus } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new Error("Muat untuk keberangkatan ini sudah selesai.");
  if (!headerRow.SalesmanID) throw new Error("Driver wajib diisi sebelum menyelesaikan muat.");

  // Server-side mirror of the client's mandatory route-computed check
  // (design spec: checked client- AND server-side) — a direct server-action
  // call bypassing the UI must not be able to skip it. Deliberately BEFORE
  // the claim below, so a failed route check never leaves the Jadwal wrongly
  // flipped to Terbit.
  const stopsForRouteCheck = await getJadwalDetail(jadwalId);
  if (stopsForRouteCheck.length === 0) throw new Error("Tidak ada SO pada keberangkatan ini.");
  const missingCoords = stopsForRouteCheck.some((s) => s.Latitude == null || s.Longitude == null);
  if (missingCoords) {
    throw new Error("Rute belum berhasil divalidasi — pastikan seluruh tujuan punya lokasi tersimpan.");
  }
  const pabrik = await getPabrikLocation();
  let validatedRoute: MultiPointRoute;
  try {
    validatedRoute = await getMultiPointRoute([
      { lat: pabrik.latitude, lng: pabrik.longitude },
      ...stopsForRouteCheck.map((s) => ({ lat: s.Latitude as number, lng: s.Longitude as number })),
      { lat: pabrik.latitude, lng: pabrik.longitude },
    ]);
  } catch {
    throw new Error("Rute belum berhasil divalidasi — pastikan seluruh tujuan punya lokasi tersimpan.");
  }

  // Server-side mirror of the capacity hard-block already enforced when SOs
  // are selected (createJadwalDraft / addSalesOrdersToJadwal) — re-checked
  // here too since an Armada's KapasitasMaks could in principle be edited
  // down after this Jadwal was assembled.
  const totalQty = stopsForRouteCheck.reduce((sum, s) => sum + s.Qty, 0);
  await assertWithinCapacity(pool, headerRow.ArmadaID, totalQty);

  // Atomically claim: only succeeds if Status is still 'Draft'. Guards
  // against two racing selesaiMuat calls for the same jadwalId both passing
  // the Status!=='Draft' check above and then both creating a duplicate set
  // of real documents.
  const claim = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jarakKM", sql.Decimal(10, 2), validatedRoute.distanceKm)
    .input("durasiMenit", sql.Int, Math.round(validatedRoute.durationMinutes))
    .query(
      `UPDATE DashboardPengirimanJadwal SET Status = 'Terbit', JamSelesaiMuat = GETDATE(), JarakKM = @jarakKM, DurasiMenit = @durasiMenit, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId AND Status = 'Draft'`
    );
  if (claim.rowsAffected[0] === 0) {
    throw new Error("Muat untuk keberangkatan ini sudah selesai atau sedang diproses.");
  }

  const createdDeliveryOrderIds: string[] = [];
  const createdSalesInvoiceIds: string[] = [];
  const invoiceTokens: { jadwalDetailId: number; invoiceToken: string }[] = [];
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const armadaResult = await pool
      .request()
      .input("armadaId", sql.Int, headerRow.ArmadaID).query(`
        SELECT a.Nama, ed.ExpeditionID, ed.VehicleNo
        FROM DashboardArmada a
        LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
        WHERE a.ArmadaID = @armadaId AND a.IsDeleted = 0
      `);
    const armadaRow = armadaResult.recordset[0] as
      | { Nama: string; ExpeditionID: string | null; VehicleNo: string | null }
      | undefined;
    if (!armadaRow) throw new Error("Armada sudah dihapus, tidak bisa menyelesaikan muat.");
    const doVehicleNo = armadaRow.VehicleNo ?? armadaRow.Nama;
    const doExpeditionId = armadaRow.ExpeditionID ?? "";

    const details = await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`
        SELECT JadwalDetailID, SalesOrderID, DeliveryOrderID FROM DashboardPengirimanJadwalDetail
        WHERE JadwalID = @jadwalId AND IsDeleted = 0
        ORDER BY Urutan
      `);
    const detailRows = details.recordset as { JadwalDetailID: number; SalesOrderID: string; DeliveryOrderID: string | null }[];
    if (detailRows.length === 0) throw new Error("Tidak ada SO pada keberangkatan ini.");

    for (const detail of detailRows) {
      // Idempotent-retry guard: if a previous selesaiMuat attempt already
      // created a DeliveryOrder for this detail row (and only failed later,
      // e.g. partway through this same loop), skip it instead of creating a
      // duplicate DO/SI. Also covers the merged-external-DO case
      // (mergeExternalDeliveriesIntoJadwal): that DO was already issued by
      // the desktop ERP, so it must never be re-created, and it never gets
      // an auto-created SalesInvoice either (its invoicing, if any, is the
      // desktop ERP's own separate concern) — only its TransDate gets
      // corrected to this now-confirmed loading-complete moment (same
      // GETDATE() reference as JamSelesaiMuat above; the original desktop-app
      // TransDate was just whenever the document was typed in).
      if (detail.DeliveryOrderID) {
        await pool
          .request()
          .input("doId", sql.VarChar(16), detail.DeliveryOrderID)
          .query(`UPDATE DeliveryOrder SET TransDate = GETDATE(), ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);
        continue;
      }

      const soResult = await pool
        .request()
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .query(`SELECT BusinessPartnerID, DueDate, TermOfPaymentID FROM SalesOrder WHERE SalesOrderID = @soId`);
      const so = soResult.recordset[0] as SalesOrderForPublish | undefined;
      if (!so) throw new Error(`Sales Order ${detail.SalesOrderID} tidak ditemukan.`);

      const sodResult = await pool
        .request()
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .query(`SELECT SalesOrderDetailID, ItemID, Name, Qty, Unit, Price, Amount FROM SalesOrderDetail WHERE SalesOrderID = @soId`);
      const soDetails = sodResult.recordset as SalesOrderDetailForPublish[];

      const deliveryOrderId = await nextDeliveryOrderId(pool);
      const voucherSeq = await nextDOVoucherSeq(pool, yearMonth);
      const voucherNo = `MKE/DO/${voucherSeq}/${yearMonth}/${DOC_SUFFIX}`;

      await pool
        .request()
        .input("id", sql.VarChar(16), deliveryOrderId)
        .input("voucherNo", sql.VarChar(128), voucherNo)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .input("vehicleNo", sql.VarChar(50), doVehicleNo)
        .input("expeditionId", sql.VarChar(16), doExpeditionId)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID)
        .input("dueDate", sql.DateTime, so.DueDate).query(`
          INSERT INTO DeliveryOrder
            (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
             IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
             BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
             ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
          VALUES
            (@id, @voucherNo, GETDATE(), @branchId, @departmentId, @bpId, '', @soId,
             0, @expeditionId, @vehicleNo, '', 0, GETDATE(), '', NULL,
             NULL, 0, '', 1, 1, @salesmanId, 0,
             '', @dueDate, '', '', NULL)
        `);
      createdDeliveryOrderIds.push(deliveryOrderId);

      for (const sod of soDetails) {
        const detailId = await nextDeliveryOrderDetailId(pool);
        await pool
          .request()
          .input("id", sql.VarChar(16), detailId)
          .input("doId", sql.VarChar(16), deliveryOrderId)
          .input("itemId", sql.VarChar(160), sod.ItemID)
          .input("name", sql.VarChar(160), sod.Name)
          .input("qty", sql.Decimal(23, 4), sod.Qty)
          .input("unit", sql.VarChar(8), sod.Unit)
          .input("price", sql.Decimal(23, 4), sod.Price)
          .input("amount", sql.Decimal(23, 4), sod.Amount)
          .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID).query(`
            INSERT INTO DeliveryOrderDetail
              (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue,
               DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
            VALUES
              (@id, @doId, @itemId, @qty, @unit, @qty, 1, @price, 0, NULL,
               0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
          `);
      }

      // --- SalesInvoice (new — reuses createTakeAwayPemesanan's exact
      // column/value shape from takeaway.ts) ---
      const salesInvoiceId = await nextSalesInvoiceId(pool);
      const siVoucherSeq = await nextSIVoucherSeq(pool, yearMonth);
      const siVoucherNo = `MKE/SI/${siVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
      const totalAmount = soDetails.reduce((sum, sod) => sum + sod.Amount, 0);
      await pool
        .request()
        .input("id", sql.VarChar(16), salesInvoiceId)
        .input("voucherNo", sql.VarChar(128), siVoucherNo)
        .input("dueDate", sql.DateTime, so.DueDate)
        .input("termOfPaymentId", sql.VarChar(16), so.TermOfPaymentID)
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("amount", sql.Decimal(23, 4), totalAmount)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID).query(`
          INSERT INTO SalesInvoice
            (SalesInvoiceID, VoucherNo, ReferenceNo, TaxNo, TransDate, DueDate, Notes, TermOfPaymentID,
             SalesOrderID, DeliveryOrderID, SalesDepositID, BusinessPartnerID, BranchID, DepartmentID,
             Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, BankID, Paid, Deposit, PaidDate,
             IsClosed, IsDeleted, ModifiedDate, Rate, CurrencyID, IsAccountReceiveable, StatusForm,
             SalesmanID, ServiceTax, ServiceTaxValue, Visitor, IsTX, PromotionID, IsPerforma,
             DiscRpBefore, ProjectID, IsExported, BillOfQuantityID)
          VALUES
            (@id, @voucherNo, '', '', GETDATE(), @dueDate, '', @termOfPaymentId,
             @soId, @doId, '', @bpId, @branchId, @departmentId,
             @amount, 0, 0, 0, 0, 0, @amount, '', 0, 0, NULL,
             0, 0, GETDATE(), 1, '', 1, 1,
             @salesmanId, 0, 0, 0, 0, '', 0,
             0, '', 0, '')
        `);
      createdSalesInvoiceIds.push(salesInvoiceId);

      for (const sod of soDetails) {
        const siDetailId = await nextSalesInvoiceDetailId(pool);
        await pool
          .request()
          .input("id", sql.VarChar(16), siDetailId)
          .input("siId", sql.VarChar(16), salesInvoiceId)
          .input("itemId", sql.VarChar(160), sod.ItemID)
          .input("name", sql.VarChar(160), sod.Name)
          .input("qty", sql.Decimal(23, 4), sod.Qty)
          .input("unit", sql.VarChar(8), sod.Unit)
          .input("price", sql.Decimal(23, 4), sod.Price)
          .input("amount", sql.Decimal(23, 4), sod.Amount).query(`
            INSERT INTO SalesInvoiceDetail
              (SalesInvoiceDetailID, SalesInvoiceID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue,
               DiscRp, Amount, Name, Value, Netto, Description, WaiterName, Cashback, Total)
            VALUES
              (@id, @siId, @itemId, @qty, @unit, 1, 1, @price, 0, 0,
               0, @amount, @name, @amount, @amount, '', '', 0, NULL)
          `);
      }

      await pool
        .request()
        .input("detailId", sql.Int, detail.JadwalDetailID)
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .input("siId", sql.VarChar(16), salesInvoiceId)
        .query(`UPDATE DashboardPengirimanJadwalDetail SET DeliveryOrderID = @doId, SalesInvoiceID = @siId WHERE JadwalDetailID = @detailId`);

      invoiceTokens.push({ jadwalDetailId: detail.JadwalDetailID, invoiceToken: encodeInvoiceToken(salesInvoiceId) });
    }
  } catch (err) {
    for (const siId of createdSalesInvoiceIds) {
      await pool
        .request()
        .input("id", sql.VarChar(16), siId)
        .query(`UPDATE SalesInvoice SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE SalesInvoiceID = @id`);
      await pool
        .request()
        .input("siId", sql.VarChar(16), siId)
        .query(`DELETE FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId`);
    }
    for (const doId of createdDeliveryOrderIds) {
      await pool
        .request()
        .input("doId", sql.VarChar(16), doId)
        .query(`UPDATE DeliveryOrder SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);
      await pool
        .request()
        .input("doId", sql.VarChar(16), doId)
        .query(`UPDATE DashboardPengirimanJadwalDetail SET DeliveryOrderID = NULL, SalesInvoiceID = NULL WHERE DeliveryOrderID = @doId`);
    }
    // The claim above already flipped Status to 'Terbit' and set
    // JamSelesaiMuat before this loop ran — a genuinely failed attempt must
    // revert both so it can be retried, on top of the
    // DeliveryOrder/SalesInvoice/JadwalDetail cleanup already done above.
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(
        `UPDATE DashboardPengirimanJadwal SET Status = 'Draft', JamSelesaiMuat = NULL, JarakKM = NULL, DurasiMenit = NULL, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`
      );
    throw err;
  }

  return invoiceTokens;
}

// Records the real physical departure — fired by Satpam pressing "Berangkat"
// at the gate, only once a Cek Berangkat inspection exists for this Jadwal
// (DashboardVehicleCheck, Tipe='BERANGKAT' — see vehicle-check.ts). Deliberately
// minimal: DeliveryOrder/SalesInvoice already exist (created at selesaiMuat),
// route/capacity already validated then too — this function only ever
// touches JamAktualBerangkat.
export async function konfirmasiBerangkat(jadwalId: number): Promise<void> {
  const pool = await getPool();

  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status, JamAktualBerangkat FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { Status: JadwalStatus; JamAktualBerangkat: Date | null } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Terbit") throw new Error("Keberangkatan ini belum selesai dimuat.");
  if (headerRow.JamAktualBerangkat) throw new Error("Keberangkatan ini sudah berangkat.");

  const check = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT VehicleCheckID FROM DashboardVehicleCheck WHERE JadwalID = @jadwalId AND Tipe = 'BERANGKAT'`);
  if (check.recordset.length === 0) {
    throw new Error("Belum ada Cek Berangkat dari Satpam.");
  }

  const claim = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(
      `UPDATE DashboardPengirimanJadwal SET JamAktualBerangkat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId AND Status = 'Terbit' AND JamAktualBerangkat IS NULL`
    );
  if (claim.rowsAffected[0] === 0) {
    throw new Error("Keberangkatan ini sudah berangkat atau sedang diproses.");
  }
}
```

- [ ] **Step 6: Add `j.JamSelesaiMuat` to `getPengirimanBoard`'s SELECT and GROUP BY**

Find the board query (`grep -n "j.JamAktualBerangkat," src/lib/queries/pengiriman-jadwal.ts` — the SELECT list one, not inside `selesaiMuat`) and add `j.JamSelesaiMuat,` right after it:
```sql
            j.JamMulaiMuat,
            j.JamAktualBerangkat,
            j.JamSelesaiMuat,
            j.Status,
```
Then find the matching `GROUP BY` line and add `j.JamSelesaiMuat` to it too:
```sql
        GROUP BY j.JadwalID, j.ArmadaID, j.SalesmanID, sm.Name, j.JamJadwal, j.JamMulaiMuat, j.JamAktualBerangkat, j.JamSelesaiMuat, j.Status, j.JarakKM, j.DurasiMenit, sdur.EstimasiDurasiMenit
```
(Every other line/column in this query is unchanged — this only adds one
column to two places.)

- [ ] **Step 7: Typecheck, lint, build**

```bash
npx eslint src/lib/queries/pengiriman-jadwal.ts
npx tsc --noEmit
npm run build
```
Expected: all clean. The build is the strongest check here — a mismatch
between `selesaiMuat`'s new return type and how Task 2's action wraps it, or a
stale reference to the removed `startBerangkat`, would surface here (Task 2
hasn't updated its caller yet, so `npm run build` at this point is EXPECTED to
fail with "startBerangkat is not exported" from `delivery/actions.ts` — that's
fine, it confirms the old export is genuinely gone; Task 2 fixes this. Run
`npx tsc --noEmit` scoped to just this file's own correctness if you want a
cleaner signal: `npx tsc --noEmit 2>&1 | grep pengiriman-jadwal.ts` should show
nothing wrong with lines inside this file itself.)

- [ ] **Step 8: Verify against live data**

Write a throwaway script (delete after use). Find a real Draft Jadwal (or
create one first via the existing UI/API if none exists) and confirm the full
round trip:
```ts
// scratchpad_verify_selesai_muat.ts
import "dotenv/config";
import { getPool } from "./src/lib/db";
import { selesaiMuat, konfirmasiBerangkat, getJadwalDetail } from "./src/lib/queries/pengiriman-jadwal";

async function main() {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT TOP 1 JadwalID FROM DashboardPengirimanJadwal WHERE Status='Draft' AND IsDeleted=0`);
  const jadwalId = (r.recordset[0] as { JadwalID: number } | undefined)?.JadwalID;
  if (!jadwalId) {
    console.log("No Draft Jadwal found to test against — skipping live verification, note this in your report.");
    process.exit(0);
  }
  console.log("Testing against JadwalID", jadwalId);

  // konfirmasiBerangkat must reject before selesaiMuat has run.
  try {
    await konfirmasiBerangkat(jadwalId);
    console.error("FAIL: konfirmasiBerangkat succeeded on a Draft Jadwal");
  } catch (e) {
    console.log("OK: konfirmasiBerangkat rejected a Draft Jadwal:", (e as Error).message);
  }

  const tokens = await selesaiMuat(jadwalId);
  console.log("selesaiMuat tokens:", tokens);

  const detail = await getJadwalDetail(jadwalId);
  console.log("JadwalDetail after selesaiMuat:", detail.map((d) => ({ id: d.JadwalDetailID, hasToken: d.InvoiceToken != null })));

  // konfirmasiBerangkat must still reject — no Cek Berangkat exists yet.
  try {
    await konfirmasiBerangkat(jadwalId);
    console.error("FAIL: konfirmasiBerangkat succeeded with no Cek Berangkat recorded");
  } catch (e) {
    console.log("OK: konfirmasiBerangkat rejected with no Cek Berangkat:", (e as Error).message);
  }

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```
Run: `npx tsx scratchpad_verify_selesai_muat.ts`
Expected: both rejection cases print "OK", `selesaiMuat` returns one token per
stop (unless the Jadwal has merged-external rows, which correctly produce no
token), and `getJadwalDetail` shows `hasToken: true` for those same stops.
**Do not attempt to clean this up by deleting the created DO/SI** — treat it
like every other live-verification write in this project's history (a real SO
scheduled for delivery, now correctly invoiced). Then `rm scratchpad_verify_selesai_muat.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/queries/pengiriman-jadwal.ts
git commit -m "Split startBerangkat into selesaiMuat (creates DO+SI) and konfirmasiBerangkat (Satpam-gated)"
```

---

## Task 2: Server actions — `selesaiMuatAction` / `konfirmasiBerangkatAction`

**Files:**
- Modify: `src/app/(dashboard)/delivery/actions.ts`

**Interfaces:**
- Consumes: `selesaiMuat`, `konfirmasiBerangkat` from
  `@/lib/queries/pengiriman-jadwal` (Task 1).
- Produces: `selesaiMuatAction(jadwalId: number): Promise<{ jadwalDetailId:
  number; invoiceToken: string }[]>`, `konfirmasiBerangkatAction(jadwalId:
  number): Promise<void>`. **Removes** `startBerangkatAction`.

- [ ] **Step 1: Update the import block**

Find the import from `@/lib/queries/pengiriman-jadwal` (currently includes
`startMuat, startBerangkat, ...`) and change `startBerangkat` to `selesaiMuat,
konfirmasiBerangkat`:
```ts
import {
  createJadwalDraft,
  deleteJadwalDraft,
  addSalesOrdersToJadwal,
  removeSalesOrderFromJadwal,
  updateJadwalUrutan,
  updateJadwalDriverTime,
  updateJadwalArmada,
  startMuat,
  selesaiMuat,
  konfirmasiBerangkat,
  getJadwalDetail,
  getAvailableSalesOrders,
  mergeExternalDeliveriesIntoJadwal,
  getMaxSalesOrderTransDateForDeliveries,
  type JadwalDetailRow,
  type AvailableSalesOrder,
} from "@/lib/queries/pengiriman-jadwal";
```

- [ ] **Step 2: Replace `startBerangkatAction`**

Find the current action (`grep -n "export async function startBerangkatAction" "src/app/(dashboard)/delivery/actions.ts"`) and replace it entirely:
```ts
export async function selesaiMuatAction(jadwalId: number): Promise<{ jadwalDetailId: number; invoiceToken: string }[]> {
  const result = await selesaiMuat(jadwalId);
  revalidatePath("/delivery");
  return result;
}

export async function konfirmasiBerangkatAction(jadwalId: number): Promise<void> {
  await konfirmasiBerangkat(jadwalId);
  revalidatePath("/delivery");
}
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
npx eslint "src/app/(dashboard)/delivery/actions.ts"
npx tsc --noEmit
```
Expected: eslint clean. `tsc` will still show an error in
`route-validation-dialog.tsx` (it imports the now-removed `startBerangkatAction`)
— that's expected and fixed in Task 3. Confirm the error is ONLY in that one
file (`npx tsc --noEmit 2>&1 | grep -v route-validation-dialog` should show
nothing related to this change).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/delivery/actions.ts"
git commit -m "Replace startBerangkatAction with selesaiMuatAction/konfirmasiBerangkatAction"
```

---

## Task 3: `RouteValidationDialog` — 3-state buttons, print-marking from Draft, auto-print

**Files:**
- Modify: `src/components/dashboard/route-validation-dialog.tsx`

**Interfaces:**
- Consumes: `selesaiMuatAction`, `konfirmasiBerangkatAction` from Task 2;
  `JadwalDetailRow.InvoiceToken` from Task 1.
- Produces: no new exports — internal restructuring of this component only.

- [ ] **Step 1: Update the actions import**

Change the import block (currently importing `startMuatAction,
startBerangkatAction, ...`):
```ts
import {
  getJadwalDetailAction,
  updateJadwalUrutanAction,
  updateJadwalDriverTimeAction,
  addSalesOrdersToJadwalAction,
  removeSalesOrderFromJadwalAction,
  getAvailableSalesOrdersAction,
  deleteJadwalDraftAction,
  startMuatAction,
  selesaiMuatAction,
  konfirmasiBerangkatAction,
  getVehicleChecksForJadwalAction,
  createVehicleCheckAction,
} from "@/app/(dashboard)/delivery/actions";
```

- [ ] **Step 2: Rekey `printSelected` from `DeliveryOrderID` to `JadwalDetailID`**

Change the state declaration:
```ts
const [printSelected, setPrintSelected] = useState<Set<number>>(new Set());
```

Change `togglePrint` and `handlePrintSelected`:
```ts
  function togglePrint(jadwalDetailId: number) {
    setPrintSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jadwalDetailId)) next.delete(jadwalDetailId);
      else next.add(jadwalDetailId);
      return next;
    });
  }

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

- [ ] **Step 3: Update `SortableStopRow`'s print-toggle to be unconditional and keyed by `JadwalDetailID`**

Change the component's props type and the toggle button's condition/handler
(currently `{detail.DeliveryOrderID && (<button ... onClick={() =>
onTogglePrint(detail.DeliveryOrderID as string)} ...>`):
```ts
function SortableStopRow({
  detail,
  index,
  onEdit,
  disabled,
  printChecked,
  onTogglePrint,
  onRemove,
}: {
  detail: JadwalDetailRow;
  index: number;
  onEdit: (detail: JadwalDetailRow) => void;
  disabled: boolean;
  printChecked: boolean;
  onTogglePrint: (jadwalDetailId: number) => void;
  onRemove?: (detail: JadwalDetailRow) => void;
}) {
```
And the button itself — remove the `detail.DeliveryOrderID &&` guard entirely,
always render it:
```tsx
      <button
        type="button"
        title={printChecked ? "Batal tandai untuk dicetak" : "Tandai untuk dicetak"}
        onClick={() => onTogglePrint(detail.JadwalDetailID)}
        className={cn(
          "shrink-0 rounded border p-1 transition-colors",
          printChecked ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:border-border"
        )}
      >
        <Printer className="size-3.5" />
      </button>
```
(This button now shows on every stop, Draft or Terbit — matching the design's
"mark during loading" requirement. `onRemove`'s block right after it is
unchanged.)

Update the call site inside the main component's stop-list rendering (the
`<SortableStopRow ... printChecked={d.DeliveryOrderID != null &&
printSelected.has(d.DeliveryOrderID)} onTogglePrint={togglePrint} ...>`):
```tsx
                      <SortableStopRow
                        key={d.JadwalDetailID}
                        detail={d}
                        index={i}
                        onEdit={onEditSalesOrder}
                        disabled={!isDraft}
                        printChecked={printSelected.has(d.JadwalDetailID)}
                        onTogglePrint={togglePrint}
                        onRemove={isDraft ? handleRemoveStop : undefined}
                      />
```

- [ ] **Step 4: Replace `handleMuat`/`handleBerangkat` with `handleMuat`/`handleSelesaiMuat`/`handleKonfirmasiBerangkat`**

`handleMuat` (the "Mulai Muat" handler) is unchanged — leave it exactly as-is.
Replace `handleBerangkat` entirely with two new functions:
```ts
  // Selesai Muat creates the real DO+SI documents (see selesaiMuat) and
  // auto-opens the invoice for every stop marked in printSelected — same
  // window.open mechanism handlePrintSelected already uses, just triggered
  // automatically instead of manually, and without closing this dialog so
  // the operator can keep working here while the print tabs load.
  function handleSelesaiMuat() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        const tokens = await selesaiMuatAction(jadwalId);
        for (const t of tokens) {
          if (printSelected.has(t.jadwalDetailId)) {
            window.open(`/invoice/${t.invoiceToken}`, "_blank");
          }
        }
        const rows = await getJadwalDetailAction(jadwalId);
        setOrder(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyelesaikan muat.");
      }
    });
  }

  function handleKonfirmasiBerangkat() {
    if (jadwalId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await konfirmasiBerangkatAction(jadwalId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengonfirmasi keberangkatan.");
      }
    });
  }
```
(The old `handleBerangkat`'s "persist driver/time first" behavior is
deliberately NOT carried over — `konfirmasiBerangkat` no longer creates any
document that could read a stale driver/time, it only sets
`JamAktualBerangkat`. Driver/time editing for a Terbit-but-not-departed Jadwal
still goes through the existing `handleSaveDriverTime`/"Simpan" path, which
already works for any non-Draft state today.)

- [ ] **Step 5: Add the Terbit-but-not-departed tri-state to the button/status area**

Add a new derived boolean right next to the existing `isDraft`/`isFutureDate`
declarations:
```ts
  const isDraft = jadwal?.Status === "Draft";
  const isWaitingDeparture = jadwal?.Status === "Terbit" && jadwal?.JamAktualBerangkat == null;
  const hasBerangkatCheck = vehicleChecks.some((c) => c.tipe === "BERANGKAT");
```

Replace the button-row block (currently `{isDraft ? (<div className="flex
gap-2">...Batalkan Draft / Mulai Muat / Berangkat...</div>) : (jadwal?.JamAktualBerangkat
&& (<p>...Sudah berangkat...</p>))}`) with:
```tsx
            {isDraft ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={handleDeleteDraft}>
                  Batalkan Draft
                </Button>
                {jadwal?.JamMulaiMuat == null ? (
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={pending || isFutureDate}
                    onClick={handleMuat}
                  >
                    Mulai Muat
                  </Button>
                ) : (
                  <Button size="sm" className="flex-1" disabled={pending || isFutureDate} onClick={handleSelesaiMuat}>
                    {pending ? "Memproses..." : "Selesai Muat"}
                  </Button>
                )}
              </div>
            ) : isWaitingDeparture ? (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  Selesai Muat pukul {formatTime(jadwal!.JamSelesaiMuat as string)} — menunggu Cek Berangkat
                </p>
                <Button size="sm" className="w-fit" disabled={pending || !hasBerangkatCheck} onClick={handleKonfirmasiBerangkat}>
                  {pending ? "Memproses..." : "Berangkat"}
                </Button>
              </div>
            ) : (
              jadwal?.JamAktualBerangkat && (
                <p className="flex items-center gap-1.5 text-xs text-primary">
                  <PackageCheck className="size-3.5" />
                  Sudah berangkat pukul {formatTime(jadwal.JamAktualBerangkat)}
                </p>
              )
            )}
```
(`jadwal!.JamSelesaiMuat as string` — `isWaitingDeparture` already guarantees
`jadwal` and its `Status === "Terbit"` state, and `selesaiMuat` always sets
`JamSelesaiMuat` in the same statement it sets `Status = 'Terbit'`, so this
value is guaranteed non-null whenever `isWaitingDeparture` is true; the
non-null assertion is safe here, matching this file's existing style
elsewhere, e.g. `drivers.find(...)`.)

- [ ] **Step 6: Rename `canBerangkat` to `canSelesaiMuat` and gate the "Selesai Muat" button with it**

`canBerangkat` (currently `isDraft && driverId !== "" && route != null &&
!routeLoading && !overCapacity && !isFutureDate`) used to gate the OLD single
"Berangkat" button — the same guarantee (a driver is picked, the route
computed successfully, capacity isn't exceeded) is exactly what should block
"Selesai Muat" now, since that's the moment real documents get created.
Rename the variable (this file has no other reference to `canBerangkat`) and
wire it into Step 5's "Selesai Muat" button:
```ts
  const canSelesaiMuat = isDraft && driverId !== "" && route != null && !routeLoading && !overCapacity && !isFutureDate;
```
Update Step 5's `JamMulaiMuat != null` branch button to:
```tsx
                  <Button size="sm" className="flex-1" disabled={!canSelesaiMuat || pending} onClick={handleSelesaiMuat}>
                    {pending ? "Memproses..." : "Selesai Muat"}
                  </Button>
```
(replacing the `disabled={pending || isFutureDate}` shown in Step 5 above with
this — `canSelesaiMuat` already includes `!isFutureDate`, so this is the same
condition, just consistently named and including the driver/route/capacity
checks the old "Berangkat" button always had, which "Selesai Muat" needs now
that it's the action creating real documents).

Update the print-selected button's condition — it currently reads
`{!isDraft && printSelected.size > 0 && (...)}` and its label/handler
(`Cetak DO Terpilih`, `handlePrintSelected`). Change the label (documents are
now invoices, not raw DOs) and remove the `!isDraft` gate (marking, and now
also printing already-tokened stops, both need to work before Terbit too —
though nothing will actually be openable until tokens exist post-Selesai-Muat,
`handlePrintSelected` already no-ops safely for stops with no `InvoiceToken`
per Step 2):
```tsx
            {printSelected.size > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5" data-capture-hide="true" onClick={handlePrintSelected}>
                <Printer className="size-3.5" />
                Cetak SI Terpilih ({printSelected.size})
              </Button>
            )}
```

- [ ] **Step 7: Typecheck, lint, build**

```bash
npx eslint src/components/dashboard/route-validation-dialog.tsx
npx tsc --noEmit
npm run build
```
Expected: all clean, 0 errors project-wide (this is the point where Task 2's
expected `route-validation-dialog.tsx` error from its own Step 3 should now be
resolved).

- [ ] **Step 8: Manually verify**

Start the dev server. Log in as an MKEsindo user with delivery access. Open a
Draft Jadwal's Validasi Rute:
- Confirm the print-toggle icon appears on every stop row (not just ones with
  an existing DO).
- Mark 1-2 stops for printing.
- Click "Mulai Muat" — confirm it flips to "Selesai Muat".
- Click "Selesai Muat" — confirm: new tabs open for the marked stops'
  `/invoice/{token}` pages (showing real billing data, not "tidak ditemukan"),
  the dialog itself stays open and shows the new "menunggu Cek Berangkat"
  status with a disabled "Berangkat" button.
- If you have a Satpam test account (from the prior plan) available, log in
  as it, open the same Jadwal, complete Cek Berangkat, then confirm the
  "Berangkat" button becomes enabled (for this same Jadwal, from any
  delivery-access session) and clicking it sets the real departure time.
- If no Satpam test account is available, note this explicitly in your report
  instead of skipping the check silently — code-level verification (Task 1's
  live-data script already proved the guard rejects with no check present) is
  an acceptable substitute for the "becomes enabled" half specifically.

- [ ] **Step 9: Commit**

```bash
git add src/components/dashboard/route-validation-dialog.tsx
git commit -m "Restructure Validasi Rute for Selesai Muat / Satpam-gated Berangkat"
```

---

## Task 4: Papan Pengiriman — "Menunggu Keberangkatan" timeline segment

**Files:**
- Modify: `src/components/dashboard/pengiriman-board.tsx`

**Interfaces:**
- Consumes: `JadwalCard.JamSelesaiMuat` from Task 1.

- [ ] **Step 1: Change "Sedang Memuat"'s end boundary and add the new segment**

Find the `autoSegments` `useMemo` block (`grep -n "const autoSegments = useMemo" src/components/dashboard/pengiriman-board.tsx`) and replace its inner loop body:
```ts
  const autoSegments = useMemo(() => {
    type AutoSegment = { key: string; jadwalId: number; label: string; start: Date; end: Date };
    const segments: AutoSegment[] = [];
    const now = new Date();
    for (const j of jadwal) {
      if (j.Status !== "Terbit") continue;
      if (j.JamMulaiMuat && j.JamSelesaiMuat) {
        segments.push({
          key: `memuat-${j.JadwalID}`,
          jadwalId: j.JadwalID,
          label: "Sedang Memuat",
          start: new Date(j.JamMulaiMuat),
          end: new Date(j.JamSelesaiMuat),
        });
      }
      if (j.JamSelesaiMuat) {
        segments.push({
          key: `tunggu-${j.JadwalID}`,
          jadwalId: j.JadwalID,
          label: "Menunggu Keberangkatan",
          start: new Date(j.JamSelesaiMuat),
          end: j.JamAktualBerangkat ? new Date(j.JamAktualBerangkat) : now,
        });
      }
      if (j.JamAktualBerangkat && j.DurasiMenit != null) {
        const start = new Date(j.JamAktualBerangkat);
        const estimatedEnd = new Date(start.getTime() + j.DurasiMenit * 60_000);
        const end = j.JamKembaliAktual ? new Date(j.JamKembaliAktual) : estimatedEnd;
        segments.push({ key: `jalan-${j.JadwalID}`, jadwalId: j.JadwalID, label: "Dalam Perjalanan", start, end });
        segments.push({
          key: `kembali-${j.JadwalID}`,
          jadwalId: j.JadwalID,
          label: "Kembali ke Pabrik",
          start: end,
          end: new Date(end.getTime() + 15 * 60_000),
        });
      }
    }
    return segments;
  }, [jadwal]);
```
(Only the `"Sedang Memuat"` condition/end value changed — from
`j.JamMulaiMuat && j.JamAktualBerangkat` / `new Date(j.JamAktualBerangkat)` to
`j.JamMulaiMuat && j.JamSelesaiMuat` / `new Date(j.JamSelesaiMuat)` — plus one
new `if (j.JamSelesaiMuat)` block for "Menunggu Keberangkatan". The
`"Dalam Perjalanan"`/`"Kembali ke Pabrik"` block is untouched, copied verbatim.)

- [ ] **Step 2: Typecheck, lint, build**

```bash
npx eslint src/components/dashboard/pengiriman-board.tsx
npx tsc --noEmit
npm run build
```
Expected: all clean.

- [ ] **Step 3: Verify against live data**

Reuse the throwaway-script convention: confirm `getPengirimanBoard`'s returned
`JadwalCard[]` includes a real `JamSelesaiMuat` for the Jadwal Task 1's Step 8
already ran `selesaiMuat` against, then reload `/delivery` in the browser
(board date matching that Jadwal's business day) and confirm:
- "Sedang Memuat" now ends where "Menunggu Keberangkatan" begins (visually
  adjacent, not overlapping).
- "Menunggu Keberangkatan" extends up to "now" (keeps growing on each reload,
  since no real departure has been confirmed yet for that test Jadwal) unless
  you already ran `konfirmasiBerangkat` against it in Task 3's manual check —
  in that case it should stop exactly at the real `JamAktualBerangkat`.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/pengiriman-board.tsx
git commit -m "Add Menunggu Keberangkatan timeline segment for the Selesai-Muat-to-Berangkat gap"
```

---

## Task 5: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full build**

```bash
npm run build
```
Expected: clean, 0 errors, all routes present.

- [ ] **Step 2: Full lint**

```bash
npx eslint src
```
Expected: no new errors (pre-existing unrelated warnings from before this plan
are fine — do not fix them here).

- [ ] **Step 3: Full type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors project-wide.

- [ ] **Step 4: Live browser end-to-end walkthrough**

Start the dev server. Log in as an MKEsindo user with delivery access:
- Create (or find) a fresh Draft Jadwal with at least 2 stops.
- Open Validasi Rute, mark one stop for printing, click "Mulai Muat" then
  "Selesai Muat" — confirm exactly one new tab opens (`/invoice/{token}`
  showing real billing data for the marked stop, not "tidak ditemukan"), the
  dialog stays open, and the status now reads "Selesai Muat pukul ... —
  menunggu Cek Berangkat" with a disabled "Berangkat" button.
- Confirm the Papan Pengiriman board shows this Jadwal's row with "Sedang
  Memuat" then "Menunggu Keberangkatan" segments in sequence, the latter
  extending to the current time.
- If a Satpam test account exists: log in as it, complete Cek Berangkat for
  this Jadwal, confirm the "Berangkat" button becomes clickable (any
  delivery-access session), click it, confirm `JamAktualBerangkat` is now set
  and the board's "Menunggu Keberangkatan" segment stops growing (frozen at
  the real departure time) with "Dalam Perjalanan" now appearing after it.
- Regression-check: open an OLDER, already-Terbit-and-departed Jadwal from
  before this plan (one with `JamAktualBerangkat` set but `JamSelesaiMuat`
  NULL, since it predates this column) — confirm its dialog still correctly
  shows the read-only "Sudah berangkat pukul ..." state (not stuck in
  "menunggu Cek Berangkat", since `isWaitingDeparture` requires
  `JamAktualBerangkat == null`, which is false for this row) and the board's
  timeline still renders sensibly for it (no "Sedang Memuat"/"Menunggu
  Keberangkatan" segments show for it, since `JamSelesaiMuat` is null on that
  legacy row — matches this plan's stated backward-compatible design).

- [ ] **Step 5: Confirm no leftover scratchpad scripts**

```bash
git status --short
```
Expected: clean.

- [ ] **Step 6: Final commit if any fixes were needed**

If Steps 1-5 surfaced any issues, fix them, re-run Steps 1-5, then:
```bash
git add -A
git commit -m "Fix issues found during Selesai Muat / Berangkat verification pass"
```
