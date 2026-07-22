import { getPool, sql } from "@/lib/db";
import { getPriceLevelOptions } from "@/lib/queries/mitra";

// The only product a Pengajuan-approval Sales Order ever lines up — "Es Tube
// Jual" (ItemID "019") is the same item getPriceLevelOptions() reads its
// price levels from, and is the standard 10KG "kantong" unit (the 5KG
// variant is a separate, unrelated Item in the ERP — see mitra-do.ts's
// KANTONG_QTY_EXPR).
const KANTONG_ITEM_ID = "019";
const KANTONG_ITEM_NAME = "Es Tube Jual";
const KANTONG_UNIT = "Kantong";

const SO_BRANCH_ID = "011";
const SO_DEPARTMENT_ID = "0110";
const SO_TERM_OF_PAYMENT_ID = "012";
// Constant document-type suffix on every existing VoucherNo sampled
// ("MKE/SO/002515/2026-07/003/001") — not derived from anything on this
// side, just reproduced as-is.
const SO_DOC_SUFFIX = "003/001";

async function nextSalesOrderId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesOrderID AS INT)) AS MaxID FROM SalesOrder`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSalesOrderDetailId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesOrderDetailID AS INT)) AS MaxID FROM SalesOrderDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

// The VoucherNo document-sequence segment (the "002515" in
// "MKE/SO/002515/2026-07/003/001") resets to 1 at the start of each
// calendar month — verified against live data: June's last row was
// .../003558/2026-06/... while July's SO immediately after started back at
// .../000001/2026-07/..., not .../003559/....
async function nextVoucherSeq(pool: sql.ConnectionPool, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/SO/%/${yearMonth}/${SO_DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq
      FROM SalesOrder
      WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

export interface CreateSalesOrderInput {
  businessPartnerId: string;
  address: string | null;
  qtyKantong: number;
  priceLevel: number | null;
  dueDate: Date | null;
}

// Creates the Sales Order (+ its single detail line) that a newly-approved
// Pengajuan Mitra's requested Qty/DueDate becomes. Shape mirrors the desktop
// ERP app's own SalesOrder rows exactly (StatusForm=1, Rate=1, empty-string
// placeholders for CurrencyID/SalesmanID/ProjectID/etc — verified against
// live rows) so it behaves like any other SO to downstream ERP processes.
// Financial fields beyond Amount/Netto (Disc, Tax, ServiceTax, ...) are
// zeroed — this dashboard doesn't know this mitra's actual discount/tax
// terms yet, that's filled in later from the desktop app if needed.
export async function createSalesOrderFromPengajuan(input: CreateSalesOrderInput): Promise<string> {
  const pool = await getPool();
  const priceLevels = await getPriceLevelOptions();
  const price = input.priceLevel != null ? priceLevels.find((p) => p.Level === input.priceLevel)?.Price ?? 0 : 0;
  const amount = input.qtyKantong * price;

  const salesOrderId = await nextSalesOrderId(pool);
  const salesOrderDetailId = await nextSalesOrderDetailId(pool);
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const voucherSeq = await nextVoucherSeq(pool, yearMonth);
  const voucherNo = `MKE/SO/${voucherSeq}/${yearMonth}/${SO_DOC_SUFFIX}`;
  // AddressInvoice is VarChar(128) on SalesOrder, while the source Alamat
  // field allows up to 1024 chars — truncate rather than let a long free-text
  // address overflow into an insert error.
  const addressInvoice = input.address?.slice(0, 128) ?? "";

  await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderId)
    .input("voucherNo", sql.VarChar(128), voucherNo)
    .input("dueDate", sql.DateTime, input.dueDate)
    .input("branchId", sql.VarChar(16), SO_BRANCH_ID)
    .input("departmentId", sql.VarChar(16), SO_DEPARTMENT_ID)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("termOfPaymentId", sql.VarChar(16), SO_TERM_OF_PAYMENT_ID)
    .input("addressInvoice", sql.VarChar(128), addressInvoice)
    .input("amount", sql.Decimal(23, 4), amount)
    .input("netto", sql.Decimal(23, 4), amount).query(`
      INSERT INTO SalesOrder
        (SalesOrderID, VoucherNo, ReferenceNo, TransDate, DueDate, BranchID, DepartmentID, BusinessPartnerID,
         TermOfPaymentID, AddressInvoice, AddressDelivery, AddressDeliveryID, CurrencyID, IsClosed, Notes,
         Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, IsInvoiced, IsDeleted, ModifiedDate, Rate,
         StatusForm, SalesmanID, ServiceTaxValue, ServiceTax, Visitor, PromotionID, Number, DiscRpBefore,
         ProjectID, BillOfQuantityID, NotesDelivery, DeliveryMemo, Status)
      VALUES
        (@id, @voucherNo, '', GETDATE(), @dueDate, @branchId, @departmentId, @bpId,
         @termOfPaymentId, @addressInvoice, '', '', '', 0, '',
         @amount, 0, 0, 0, 0, 0, @netto, 0, 0, GETDATE(), 1,
         1, '', 0, 0, 0, '', 1, 0,
         '', '', '', '', '')
    `);

  await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderDetailId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("itemId", sql.VarChar(150), KANTONG_ITEM_ID)
    .input("name", sql.VarChar(150), KANTONG_ITEM_NAME)
    .input("qty", sql.Float, input.qtyKantong)
    .input("unit", sql.VarChar(16), KANTONG_UNIT)
    .input("price", sql.Float, price)
    .input("amount", sql.Float, amount).query(`
      INSERT INTO SalesOrderDetail
        (SalesOrderDetailID, SalesOrderID, ItemID, Name, Qty, Unit, Price, Disc, DiscValue, DiscRp,
         Ratio, Amount, FlagClosed)
      VALUES
        (@id, @soId, @itemId, @name, @qty, @unit, @price, 0, 0, 0,
         1, @amount, '')
    `);

  return salesOrderId;
}
