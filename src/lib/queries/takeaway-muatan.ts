import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { getNaiveWibTransDate } from "@/lib/business-date";
import type { KantongVariant } from "@/lib/queries/sales-order";

export interface TakeAwayMuatanPendingRow {
  takeAwayMuatanId: number;
  salesOrderId: string;
  customerName: string;
  variant: KantongVariant;
  qtyDipesan: number;
  jamMulaiMuat: Date | null;
}

export interface TakeAwayMuatanSelesaiRow {
  takeAwayMuatanId: number;
  salesOrderId: string;
  customerName: string;
  variant: KantongVariant;
  qtyDimuat: number;
  jamSelesaiMuat: Date;
}

// Called from createTakeAwayPemesanan (takeaway.ts) right after the
// SalesOrder itself is created — one Draft row per TakeAway order,
// JamMulaiMuat/JamSelesaiMuat/QtyDimuat all NULL until produksi-app acts
// on it. See docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md.
export async function createTakeAwayMuatanDraft(
  salesOrderId: string,
  variant: KantongVariant,
  qtyDipesan: number
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("variant", sql.VarChar(8), variant)
    .input("qty", sql.Int, qtyDipesan)
    .query(`INSERT INTO DashboardTakeAwayMuatan (SalesOrderID, Variant, QtyDipesan) VALUES (@soId, @variant, @qty)`);
}

// Menunggu diproses ("Draft") + sedang dimuat (JamMulaiMuat sudah diisi,
// JamSelesaiMuat belum) digabung satu daftar — sama seperti
// getAllDraftJadwalForProduksi (produksi-muatan.ts) menampilkan Draft apa
// pun status JamMulaiMuat-nya. Oldest-first: ini antrian walk-in, bukan
// jadwal jauh ke depan seperti Jadwal bertruk, jadi first-come-first-served.
// LEFT JOIN (bukan INNER) supaya baris tetap tampil walau BusinessPartner-nya
// pernah dihapus setelah order dibuat.
export async function getTakeAwayMuatanPending(): Promise<TakeAwayMuatanPendingRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT tam.TakeAwayMuatanID, tam.SalesOrderID, ISNULL(bp.Name, 'Tidak diketahui') AS CustomerName,
           tam.Variant, tam.QtyDipesan, tam.JamMulaiMuat
    FROM DashboardTakeAwayMuatan tam
    LEFT JOIN SalesOrder so ON so.SalesOrderID = tam.SalesOrderID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    WHERE tam.IsDeleted = 0 AND tam.JamSelesaiMuat IS NULL
    ORDER BY tam.CreatedDate ASC
  `);
  return (
    result.recordset as {
      TakeAwayMuatanID: number;
      SalesOrderID: string;
      CustomerName: string;
      Variant: KantongVariant;
      QtyDipesan: number;
      JamMulaiMuat: Date | null;
    }[]
  ).map((r) => ({
    takeAwayMuatanId: r.TakeAwayMuatanID,
    salesOrderId: r.SalesOrderID,
    customerName: r.CustomerName,
    variant: r.Variant,
    qtyDipesan: r.QtyDipesan,
    jamMulaiMuat: r.JamMulaiMuat,
  }));
}

// Sudah Selesai Muat — 50 terbaru, sekadar agar operator melihat apa yang
// baru saja diselesaikan tanpa pindah tab (pola sama seperti
// fetchRecentSelesaiMuatJadwalForProduksi di produksi-muatan.ts).
export async function getTakeAwayMuatanSelesaiRecent(): Promise<TakeAwayMuatanSelesaiRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP (50) tam.TakeAwayMuatanID, tam.SalesOrderID, ISNULL(bp.Name, 'Tidak diketahui') AS CustomerName,
           tam.Variant, tam.QtyDimuat, tam.JamSelesaiMuat
    FROM DashboardTakeAwayMuatan tam
    LEFT JOIN SalesOrder so ON so.SalesOrderID = tam.SalesOrderID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    WHERE tam.IsDeleted = 0 AND tam.JamSelesaiMuat IS NOT NULL
    ORDER BY tam.JamSelesaiMuat DESC
  `);
  return (
    result.recordset as {
      TakeAwayMuatanID: number;
      SalesOrderID: string;
      CustomerName: string;
      Variant: KantongVariant;
      QtyDimuat: number;
      JamSelesaiMuat: Date;
    }[]
  ).map((r) => ({
    takeAwayMuatanId: r.TakeAwayMuatanID,
    salesOrderId: r.SalesOrderID,
    customerName: r.CustomerName,
    variant: r.Variant,
    qtyDimuat: r.QtyDimuat,
    jamSelesaiMuat: r.JamSelesaiMuat,
  }));
}

// Atomic claim — the guard is the WHERE clause itself (JamMulaiMuat IS
// NULL), not a separate SELECT-then-UPDATE, so two concurrent taps on the
// same card can't both succeed. Mirrors startMuat()'s own
// UPDATE ... WHERE Status = 'Draft' pattern in pengiriman-jadwal.ts.
export async function takeAwayMulaiMuat(takeAwayMuatanId: number): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, takeAwayMuatanId)
    .query(
      `UPDATE DashboardTakeAwayMuatan SET JamMulaiMuat = GETDATE() WHERE TakeAwayMuatanID = @id AND IsDeleted = 0 AND JamMulaiMuat IS NULL`
    );
  if (result.rowsAffected[0] === 0) {
    throw new AppError("Order TakeAway ini sudah tidak tersedia atau sudah dimulai.");
  }
}

// Dipanggil dari deletePemesanan (pemesanan.ts, Task 4) saat SO TakeAway
// dibatalkan sebelum Mulai Muat — mencegah baris ini terus muncul di daftar
// menunggu produksi-app padahal SO-nya sudah dihapus. Aman dipanggil untuk
// SO non-TakeAway juga: tidak ada baris yang cocok, tidak melakukan apa-apa.
export async function softDeleteTakeAwayMuatanForSalesOrder(salesOrderId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`UPDATE DashboardTakeAwayMuatan SET IsDeleted = 1 WHERE SalesOrderID = @soId`);
}

// '0127' ("Ambil Sendiri") — same code PARTNER_TYPE_CASE (aging.ts) already
// treats as the TakeAway classification. Moved here from takeaway.ts along
// with the DO/SI-creation code below (docs/superpowers/specs/
// 2026-08-31-takeaway-alur-muat-produksi-design.md) — takeaway.ts still
// needs this value to pass to createSalesOrderManual, so it's exported.
export const TAKEAWAY_SALESMAN_ID = "0127";
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

export interface TakeAwaySelesaiMuatResult {
  deliveryOrderId: string;
  salesInvoiceId: string;
}

// The "Selesai Muat" step for TakeAway: creates the real
// DeliveryOrder+DeliveryOrderDetail+SalesInvoice+SalesInvoiceDetail
// documents (this SQL is unchanged from what used to run immediately in
// createTakeAwayPemesanan — only the timing moved, per
// docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md),
// then records the result on the DashboardTakeAwayMuatan row. Caller
// (takeAwaySelesaiMuatAction) enqueues the print job afterward — this
// function only creates documents, matching how selesaiMuat() in
// pengiriman-jadwal.ts doesn't enqueue prints itself either.
export async function takeAwaySelesaiMuat(
  takeAwayMuatanId: number,
  dicatatOlehAkunId: number
): Promise<TakeAwaySelesaiMuatResult> {
  const pool = await getPool();

  const muatanResult = await pool
    .request()
    .input("id", sql.Int, takeAwayMuatanId)
    .query(
      `SELECT SalesOrderID, JamMulaiMuat, JamSelesaiMuat FROM DashboardTakeAwayMuatan WHERE TakeAwayMuatanID = @id AND IsDeleted = 0`
    );
  const muatan = muatanResult.recordset[0] as
    | { SalesOrderID: string; JamMulaiMuat: Date | null; JamSelesaiMuat: Date | null }
    | undefined;
  if (!muatan) throw new AppError("Order TakeAway ini tidak ditemukan.");
  if (!muatan.JamMulaiMuat) throw new AppError("Mulai Muat belum dilakukan untuk order ini.");
  if (muatan.JamSelesaiMuat) throw new AppError("Order TakeAway ini sudah selesai dimuat.");

  const salesOrderId = muatan.SalesOrderID;
  let deliveryOrderId: string | null = null;
  let salesInvoiceId: string | null = null;

  try {
    const soResult = await pool
      .request()
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`SELECT BusinessPartnerID, DueDate, TermOfPaymentID FROM SalesOrder WHERE SalesOrderID = @soId`);
    const so = soResult.recordset[0] as { BusinessPartnerID: string; DueDate: Date; TermOfPaymentID: string } | undefined;
    if (!so) throw new AppError("Sales Order tidak ditemukan.");

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
      .input("transDate", sql.DateTime, getNaiveWibTransDate())
      .input("dueDate", sql.DateTime, so.DueDate).query(`
        INSERT INTO DeliveryOrder
          (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
           IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
           BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
           ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
        VALUES
          (@id, @voucherNo, @transDate, @branchId, @departmentId, @bpId, '', @soId,
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
      .input("doId", sql.VarChar(16), `'${deliveryOrderId}'`)
      .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
      .input("branchId", sql.VarChar(16), BRANCH_ID)
      .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
      .input("amount", sql.Decimal(23, 4), totalAmount)
      .input("transDate", sql.DateTime, getNaiveWibTransDate())
      .input("salesmanId", sql.VarChar(16), TAKEAWAY_SALESMAN_ID).query(`
        INSERT INTO SalesInvoice
          (SalesInvoiceID, VoucherNo, ReferenceNo, TaxNo, TransDate, DueDate, Notes, TermOfPaymentID,
           SalesOrderID, DeliveryOrderID, SalesDepositID, BusinessPartnerID, BranchID, DepartmentID,
           Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, BankID, Paid, Deposit, PaidDate,
           IsClosed, IsDeleted, ModifiedDate, Rate, CurrencyID, IsAccountReceiveable, StatusForm,
           SalesmanID, ServiceTax, ServiceTaxValue, Visitor, IsTX, PromotionID, IsPerforma,
           DiscRpBefore, ProjectID, IsExported, BillOfQuantityID)
        VALUES
          (@id, @voucherNo, '', '', @transDate, @dueDate, '', @termOfPaymentId,
           @soId, @doId, '', @bpId, @branchId, @departmentId,
           @amount, 0, 0, 0, 0, 0, @amount, '', 0, 0, NULL,
           0, 0, GETDATE(), 1, '', 0, 1,
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

    await pool
      .request()
      .input("soId", sql.VarChar(16), salesOrderId)
      .query(`UPDATE SalesOrder SET IsClosed = 1, IsInvoiced = 1, ModifiedDate = GETDATE() WHERE SalesOrderID = @soId`);
    await pool
      .request()
      .input("doId", sql.VarChar(16), deliveryOrderId)
      .query(`UPDATE DeliveryOrder SET IsClosed = 1, IsInvoiced = 1, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);

    await pool
      .request()
      .input("id", sql.Int, takeAwayMuatanId)
      .input("akunId", sql.Int, dicatatOlehAkunId)
      .input("doId", sql.VarChar(16), deliveryOrderId)
      .input("siId", sql.VarChar(16), salesInvoiceId).query(`
        UPDATE DashboardTakeAwayMuatan
        SET JamSelesaiMuat = GETDATE(), QtyDimuat = QtyDipesan, DicatatOlehAkunID = @akunId,
            DeliveryOrderID = @doId, SalesInvoiceID = @siId
        WHERE TakeAwayMuatanID = @id
      `);

    return { deliveryOrderId, salesInvoiceId };
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
    throw err;
  }
}
