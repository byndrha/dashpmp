import { getPool, sql } from "@/lib/db";
import { getPriceLevelOptions } from "@/lib/queries/mitra";
import { AppError } from "@/lib/action-result";

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

export type KantongVariant = "10kg" | "5kg";

const KANTONG_VARIANTS: Record<KantongVariant, { itemId: string; name: string; unit: string }> = {
  "10kg": { itemId: KANTONG_ITEM_ID, name: KANTONG_ITEM_NAME, unit: KANTONG_UNIT },
  "5kg": { itemId: "0111", name: "Es Tube Jual 5 KG", unit: KANTONG_UNIT },
};

// Same "Es Tube Bonus" / "Es Tube Bonus 5 KG" items already used elsewhere
// in the ERP (SalesInvoiceDetail — see sales-overview.ts/sales-cards.ts's
// kemasan-classification comments) to record free goods as their own line,
// distinct from the sold item — confirmed live against the Item table.
// Bonus qty rides in its own SalesOrderDetail row under one of these
// ItemIDs instead of being folded into the sold row's Qty, so any query
// that filters/sums by the sold ItemID (KANTONG_ITEM_ID/"0111") naturally
// excludes it without special-casing.
const BONUS_ITEM_VARIANTS: Record<KantongVariant, { itemId: string; name: string }> = {
  "10kg": { itemId: "0110", name: "Es Tube Bonus" },
  "5kg": { itemId: "0112", name: "Es Tube Bonus 5 KG" },
};

export interface CreateSalesOrderManualInput {
  businessPartnerId: string;
  variant: KantongVariant;
  qtyKantong: number;
  // Free/bonus kantong bundled into this order — physically shipped but
  // not billed. Recorded as its own SalesOrderDetail row under the
  // dedicated bonus ItemID (see BONUS_ITEM_VARIANTS), Amount=0.
  bonusQty: number;
  deliveryDateTime: Date;
  // '0127' for TakeAway (see PARTNER_TYPE_CASE in aging.ts and
  // lib/queries/takeaway.ts) — omitted (stored as '') for the normal
  // scheduled-delivery flow, since the driver usually isn't picked until
  // the Jadwal step right after this SO is created. Not the final value in
  // that case: syncSalesOrderSalesman (pengiriman-jadwal.ts) fills it in
  // moments later once a driver is set on the Jadwal — see its comment for
  // why (desktop ERP reads Salesman off SalesOrder, not DeliveryOrder).
  salesmanId?: string;
}

// Manual Sales Order creation for the Pemesanan module (mitra already
// exists, unlike createSalesOrderFromPengajuan which may run before a full
// mitra record does) — mirrors that function's live-verified SalesOrder/
// SalesOrderDetail shape exactly, except TermOfPaymentID/AddressInvoice
// come from the mitra's own BusinessPartner row (falling back to the same
// hardcoded default only when the mitra's own value is blank), and either
// kantong variant can be ordered. DueDate is set to the chosen delivery
// datetime, not a separately-entered due date — in this flow they're the
// same moment by construction.
export async function createSalesOrderManual(input: CreateSalesOrderManualInput): Promise<string> {
  if (input.qtyKantong <= 0) throw new AppError("Qty pemesanan harus lebih dari 0.");
  if (input.bonusQty < 0) throw new AppError("Bonus qty tidak boleh negatif.");

  const pool = await getPool();
  const variant = KANTONG_VARIANTS[input.variant];

  const bpResult = await pool
    .request()
    .input("bpId", sql.VarChar(16), input.businessPartnerId).query(`
      SELECT TermOfPaymentID, Address, PriceLevel FROM BusinessPartner
      WHERE BusinessPartnerID = @bpId AND ISNULL(IsDeleted, 0) = 0
    `);
  const bp = bpResult.recordset[0] as
    | { TermOfPaymentID: string | null; Address: string | null; PriceLevel: number | null }
    | undefined;
  if (!bp) throw new AppError("Mitra tidak ditemukan.");
  if (bp.PriceLevel == null) throw new AppError("Mitra belum punya Price Level — atur dulu di modul Mitra.");

  const priceLevels = await getPriceLevelOptions(variant.name);
  const priceLevelEntry = priceLevels.find((p) => p.Level === bp.PriceLevel);
  if (!priceLevelEntry) {
    throw new AppError(`Harga untuk varian ${variant.name} pada Price Level ${bp.PriceLevel} belum diatur.`);
  }
  const price = priceLevelEntry.Price;
  // Billed only on the ordered qty — the bonus row (below) is its own line
  // at Amount=0, so it never enters SalesOrder.Amount/Netto.
  const amount = input.qtyKantong * price;

  const termOfPaymentId = bp.TermOfPaymentID?.trim() ? bp.TermOfPaymentID : SO_TERM_OF_PAYMENT_ID;
  const addressInvoice = bp.Address?.slice(0, 128) ?? "";

  const salesOrderId = await nextSalesOrderId(pool);
  const salesOrderDetailId = await nextSalesOrderDetailId(pool);
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const voucherSeq = await nextVoucherSeq(pool, yearMonth);
  const voucherNo = `MKE/SO/${voucherSeq}/${yearMonth}/${SO_DOC_SUFFIX}`;

  await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderId)
    .input("voucherNo", sql.VarChar(128), voucherNo)
    .input("dueDate", sql.DateTime, input.deliveryDateTime)
    .input("branchId", sql.VarChar(16), SO_BRANCH_ID)
    .input("departmentId", sql.VarChar(16), SO_DEPARTMENT_ID)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("termOfPaymentId", sql.VarChar(16), termOfPaymentId)
    .input("addressInvoice", sql.VarChar(128), addressInvoice)
    .input("amount", sql.Decimal(23, 4), amount)
    .input("netto", sql.Decimal(23, 4), amount)
    .input("salesmanId", sql.VarChar(16), input.salesmanId ?? "").query(`
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
         1, @salesmanId, 0, 0, 0, '', 1, 0,
         '', '', '', '', '')
    `);

  await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderDetailId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("itemId", sql.VarChar(150), variant.itemId)
    .input("name", sql.VarChar(150), variant.name)
    .input("qty", sql.Float, input.qtyKantong)
    .input("unit", sql.VarChar(16), variant.unit)
    .input("price", sql.Float, price)
    .input("amount", sql.Float, amount).query(`
      INSERT INTO SalesOrderDetail
        (SalesOrderDetailID, SalesOrderID, ItemID, Name, Qty, Unit, Price, Disc, DiscValue, DiscRp,
         Ratio, Amount, FlagClosed)
      VALUES
        (@id, @soId, @itemId, @name, @qty, @unit, @price, 0, 0, 0,
         1, @amount, '')
    `);

  if (input.bonusQty > 0) {
    const bonusVariant = BONUS_ITEM_VARIANTS[input.variant];
    // Called only after the row above is inserted — nextSalesOrderDetailId
    // is a plain MAX+1 lookup (same convention as nextSalesOrderId/
    // nextVoucherSeq in this file), so it only sees the right next ID once
    // that insert has actually landed.
    const bonusDetailId = await nextSalesOrderDetailId(pool);
    await pool
      .request()
      .input("id", sql.VarChar(16), bonusDetailId)
      .input("soId", sql.VarChar(16), salesOrderId)
      .input("itemId", sql.VarChar(150), bonusVariant.itemId)
      .input("name", sql.VarChar(150), bonusVariant.name)
      .input("qty", sql.Float, input.bonusQty)
      .input("unit", sql.VarChar(16), variant.unit).query(`
        INSERT INTO SalesOrderDetail
          (SalesOrderDetailID, SalesOrderID, ItemID, Name, Qty, Unit, Price, Disc, DiscValue, DiscRp,
           Ratio, Amount, FlagClosed)
        VALUES
          (@id, @soId, @itemId, @name, @qty, @unit, 0, 0, 0, 0,
           1, 0, '')
      `);
  }

  return salesOrderId;
}

export interface EditableSalesOrderQty {
  qty10KG: number | null;
  qty5KG: number | null;
}

// Only the SOLD row per variant — deliberately excludes the separate bonus
// rows (BONUS_ITEM_VARIANTS), so this never conflates billed quantity with
// free/bonus quantity. null means this SO has no sold row for that variant
// at all (nothing to edit — the UI must not offer an input for it, since
// this function never creates a new row).
export async function getEditableSalesOrderQty(salesOrderId: string): Promise<EditableSalesOrderQty> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("item10", sql.VarChar(150), KANTONG_ITEM_ID)
    .input("item5", sql.VarChar(150), KANTONG_VARIANTS["5kg"].itemId)
    .query(`SELECT ItemID, Qty FROM SalesOrderDetail WHERE SalesOrderID = @soId AND ItemID IN (@item10, @item5)`);
  const rows = result.recordset as { ItemID: string; Qty: number }[];
  const row10 = rows.find((r) => r.ItemID === KANTONG_ITEM_ID);
  const row5 = rows.find((r) => r.ItemID === KANTONG_VARIANTS["5kg"].itemId);
  return {
    qty10KG: row10 ? row10.Qty : null,
    qty5KG: row5 ? row5.Qty : null,
  };
}

// Edits an existing sold-row's Qty (and its Amount, recomputed from that
// row's own already-stored Price — never re-fetched from the current Price
// Level, so editing Qty never silently changes the unit price the customer
// was quoted). Refuses if the variant has no existing sold row (this never
// creates one) or if the SO has already shipped (a real DeliveryOrder
// exists) — same shipped-order guard deletePemesanan already uses, for the
// same reason: editing an SO after its DO/SI already reflects the old Qty
// would silently desync real ERP documents.
export async function updateSalesOrderDetailQty(salesOrderId: string, variant: KantongVariant, newQty: number): Promise<void> {
  if (!(newQty > 0)) throw new AppError("Qty pemesanan harus lebih dari 0.");

  const pool = await getPool();

  const doCheck = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`SELECT COUNT(*) AS Cnt FROM DeliveryOrder WHERE SalesOrderID = @soId AND IsDeleted = 0`);
  if ((doCheck.recordset[0] as { Cnt: number }).Cnt > 0) {
    throw new AppError("Pesanan ini sudah terkirim (DO sudah terbit) — Qty tidak bisa diubah dari sini.");
  }

  const itemId = KANTONG_VARIANTS[variant].itemId;
  const existing = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("itemId", sql.VarChar(150), itemId)
    .query(`SELECT SalesOrderDetailID, Price FROM SalesOrderDetail WHERE SalesOrderID = @soId AND ItemID = @itemId`);
  const row = existing.recordset[0] as { SalesOrderDetailID: string; Price: number } | undefined;
  if (!row) {
    throw new AppError(`Pesanan ini tidak memiliki baris ${variant === "10kg" ? "10 KG" : "5 KG"} untuk diubah.`);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const newAmount = newQty * row.Price;
    await new sql.Request(transaction)
      .input("detailId", sql.VarChar(16), row.SalesOrderDetailID)
      .input("qty", sql.Float, newQty)
      .input("amount", sql.Float, newAmount)
      .query(`UPDATE SalesOrderDetail SET Qty = @qty, Amount = @amount WHERE SalesOrderDetailID = @detailId`);

    // Keeps the header's Amount/Netto consistent with the sum of its own
    // details (bonus rows included, always Amount=0) — the same
    // header-equals-sum-of-details relationship createSalesOrderManual
    // establishes at creation time.
    await new sql.Request(transaction)
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`
        UPDATE SalesOrder SET
          Amount = (SELECT ISNULL(SUM(Amount), 0) FROM SalesOrderDetail WHERE SalesOrderID = @soId),
          Netto = (SELECT ISNULL(SUM(Amount), 0) FROM SalesOrderDetail WHERE SalesOrderID = @soId),
          ModifiedDate = GETDATE()
        WHERE SalesOrderID = @soId
      `);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Soft-deletes a SalesOrder — compensating cleanup for createPemesanan
// (pemesanan.ts) when the scheduling step after SO creation fails, matching
// createJadwalDraft's own cleanup discipline in pengiriman-jadwal.ts.
export async function softDeleteSalesOrder(salesOrderId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderId)
    .query(`UPDATE SalesOrder SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE SalesOrderID = @id`);
}
