import { getPool, sql } from "@/lib/db";
import { createSalesOrderManual, softDeleteSalesOrder, type KantongVariant } from "@/lib/queries/sales-order";
import { AppError } from "@/lib/action-result";

// '0127' ("Ambil Sendiri") — same code PARTNER_TYPE_CASE (aging.ts) already
// treats as the TakeAway classification, confirmed against real historical
// TakeAway SO/DO/SI rows (BusinessPartnerID '01109' "Direct Customer"):
// SalesOrder.SalesmanID and DeliveryOrder.SalesmanID both '0127',
// DeliveryOrder.VehicleNo blank (no armada), SalesInvoice linked to both.
const TAKEAWAY_SALESMAN_ID = "0127";
const BRANCH_ID = "011";
const DEPARTMENT_ID = "0110";
const DOC_SUFFIX = "003/001";

async function nextDeliveryOrderId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderID AS INT)) AS MaxID FROM DeliveryOrder`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDeliveryOrderDetailId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderDetailID AS INT)) AS MaxID FROM DeliveryOrderDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDOVoucherSeq(pool: sql.ConnectionPool, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/DO/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM DeliveryOrder WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

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

async function nextSIVoucherSeq(pool: sql.ConnectionPool, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/SI/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM SalesInvoice WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

export interface CreateTakeAwayInput {
  businessPartnerId: string;
  variant: KantongVariant;
  qtyKantong: number;
  bonusQty: number;
  deliveryDateTime: Date;
}

export interface CreateTakeAwayResult {
  salesOrderId: string;
  deliveryOrderId: string;
  salesInvoiceId: string;
}

// TakeAway ("Ambil Sendiri") skips the whole Jadwal/Armada flow entirely —
// the SO is created, then a DeliveryOrder and SalesInvoice are issued
// immediately in the same call, matching how a walk-in pickup is recorded
// in the real desktop-app data (verified against SalesOrderID '01206980').
// Deliberately stops short of a SalesPayment: every real TakeAway invoice
// sampled has a genuine SalesPayment row created as a separate, slightly
// later step (the cashier actually receiving cash) — auto-marking this
// invoice Paid without a matching payment record would leave a
// looks-settled-but-isn't ledger inconsistency, so it's created unpaid
// (IsAccountReceiveable) like any other invoice awaiting collection.
export async function createTakeAwayPemesanan(input: CreateTakeAwayInput): Promise<CreateTakeAwayResult> {
  const salesOrderId = await createSalesOrderManual({
    businessPartnerId: input.businessPartnerId,
    variant: input.variant,
    qtyKantong: input.qtyKantong,
    bonusQty: input.bonusQty,
    deliveryDateTime: input.deliveryDateTime,
    salesmanId: TAKEAWAY_SALESMAN_ID,
  });

  const pool = await getPool();
  let deliveryOrderId: string | null = null;
  let salesInvoiceId: string | null = null;

  try {
    const soResult = await pool
      .request()
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`SELECT BusinessPartnerID, DueDate, TermOfPaymentID FROM SalesOrder WHERE SalesOrderID = @soId`);
    const so = soResult.recordset[0] as { BusinessPartnerID: string; DueDate: Date; TermOfPaymentID: string } | undefined;
    if (!so) throw new AppError("Sales Order tidak ditemukan setelah dibuat.");

    const sodResult = await pool
      .request()
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`SELECT SalesOrderDetailID, ItemID, Name, Qty, Unit, Price, Amount FROM SalesOrderDetail WHERE SalesOrderID = @soId`);
    const soDetails = sodResult.recordset as {
      SalesOrderDetailID: string;
      ItemID: string;
      Name: string;
      Qty: number;
      Unit: string;
      Price: number;
      Amount: number;
    }[];
    const totalAmount = soDetails.reduce((sum, d) => sum + d.Amount, 0);

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // --- DeliveryOrder (no armada — VehicleNo blank) ---
    deliveryOrderId = await nextDeliveryOrderId(pool);
    const doVoucherSeq = await nextDOVoucherSeq(pool, yearMonth);
    const doVoucherNo = `MKE/DO/${doVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
    await pool
      .request()
      .input("id", sql.VarChar(16), deliveryOrderId)
      .input("voucherNo", sql.VarChar(128), doVoucherNo)
      .input("branchId", sql.VarChar(16), BRANCH_ID)
      .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
      .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
      .input("soId", sql.VarChar(16), salesOrderId)
      .input("salesmanId", sql.VarChar(16), TAKEAWAY_SALESMAN_ID)
      .input("dueDate", sql.DateTime, so.DueDate).query(`
        INSERT INTO DeliveryOrder
          (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
           IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
           BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
           ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
        VALUES
          (@id, @voucherNo, GETDATE(), @branchId, @departmentId, @bpId, '', @soId,
           0, '', '', '', 0, GETDATE(), '', NULL,
           NULL, 0, '', 1, 1, @salesmanId, 0,
           '', @dueDate, '', '', NULL)
      `);

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

    // --- SalesInvoice ---
    salesInvoiceId = await nextSalesInvoiceId(pool);
    const siVoucherSeq = await nextSIVoucherSeq(pool, yearMonth);
    const siVoucherNo = `MKE/SI/${siVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
    await pool
      .request()
      .input("id", sql.VarChar(16), salesInvoiceId)
      .input("voucherNo", sql.VarChar(128), siVoucherNo)
      .input("dueDate", sql.DateTime, so.DueDate)
      .input("termOfPaymentId", sql.VarChar(16), so.TermOfPaymentID)
      .input("soId", sql.VarChar(16), salesOrderId)
      // Wrapped in literal single quotes to match the ERP's own historical
      // storage convention for SalesInvoice.DeliveryOrderID — see the
      // identical fix/comment on createSalesInvoiceForStop in
      // pengiriman-jadwal.ts for the live evidence behind this. Every read
      // site already strips these quotes via REPLACE(DeliveryOrderID,
      // '''', ''), so this doesn't break anything downstream.
      .input("doId", sql.VarChar(16), `'${deliveryOrderId}'`)
      .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
      .input("branchId", sql.VarChar(16), BRANCH_ID)
      .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
      .input("amount", sql.Decimal(23, 4), totalAmount)
      .input("salesmanId", sql.VarChar(16), TAKEAWAY_SALESMAN_ID).query(`
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

    for (const sod of soDetails) {
      const detailId = await nextSalesInvoiceDetailId(pool);
      await pool
        .request()
        .input("id", sql.VarChar(16), detailId)
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

    // Both SO and DO are now genuinely fulfilled+invoiced in one motion —
    // flip the flags only after every downstream document exists, matching
    // the real desktop-app data's IsClosed/IsInvoiced pattern for a
    // completed TakeAway sale.
    await pool
      .request()
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`UPDATE SalesOrder SET IsClosed = 1, IsInvoiced = 1, ModifiedDate = GETDATE() WHERE SalesOrderID = @soId`);
    await pool
      .request()
      .input("doId", sql.VarChar(16), deliveryOrderId)
      .query(`UPDATE DeliveryOrder SET IsClosed = 1, IsInvoiced = 1, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);

    return { salesOrderId, deliveryOrderId, salesInvoiceId };
  } catch (err) {
    if (salesInvoiceId) {
      await pool
        .request()
        .input("id", sql.VarChar(16), salesInvoiceId)
        .query(`UPDATE SalesInvoice SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE SalesInvoiceID = @id`);
      await pool
        .request()
        .input("siId", sql.VarChar(16), salesInvoiceId)
        .query(`DELETE FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId`);
    }
    if (deliveryOrderId) {
      await pool
        .request()
        .input("id", sql.VarChar(16), deliveryOrderId)
        .query(`UPDATE DeliveryOrder SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @id`);
      await pool
        .request()
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .query(`DELETE FROM DeliveryOrderDetail WHERE DeliveryOrderID = @doId`);
    }
    await softDeleteSalesOrder(salesOrderId);
    throw err;
  }
}
