import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { getNaiveWibTransDate } from "@/lib/business-date";
import { getPriceLevelOptions } from "@/lib/queries/mitra";
import { KANTONG_ITEM_ID } from "@/lib/queries/sales-order";

export interface SisaReturRow {
  stopDeliveryItemId: number;
  jadwalDetailId: number;
  stopCustomerName: string;
  itemId: string;
  itemName: string;
  sisaQty: number;
  price: number;
  salesOrderDetailId: string;
  salesReturnId: string;
}

// Baris StopDeliveryItem berkondisi Baik dengan sisa > 0, untuk satu
// Jadwal -- dipakai badge + panel detail Papan Pengiriman & driver-app.
// "Sisa" dihitung live dari QtyRetur dikurangi SUM ReturResale yang sudah
// terjadi untuk baris itu, tidak pernah disimpan sebagai kolom sendiri.
export async function getSisaReturTersedia(jadwalId: number): Promise<SisaReturRow[]> {
  const pool = await getPool();
  const result = await pool.request().input("jadwalId", sql.Int, jadwalId).query(`
    SELECT
        sdi.StopDeliveryItemID, jd.JadwalDetailID, bp.Name AS StopCustomerName,
        sdi.ItemID, sod.Name AS ItemName, sod.Price, sdi.SalesOrderDetailID,
        sd.SalesReturnID,
        sdi.QtyRetur - ISNULL(rr.SudahTerjual, 0) AS SisaQty
    FROM DashboardPengirimanStopDeliveryItem sdi
    JOIN DashboardPengirimanStopDelivery sd ON sd.StopDeliveryID = sdi.StopDeliveryID
    JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalDetailID = sd.JadwalDetailID
    JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
    JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = sdi.SalesOrderDetailID
    OUTER APPLY (
        SELECT SUM(Qty) AS SudahTerjual FROM DashboardPengirimanReturResale
        WHERE StopDeliveryItemID = sdi.StopDeliveryItemID
    ) rr
    WHERE jd.JadwalID = @jadwalId
      AND sdi.KondisiRetur = 'BAIK'
      AND sdi.QtyRetur > 0
      AND (sdi.QtyRetur - ISNULL(rr.SudahTerjual, 0)) > 0
  `);
  return (result.recordset as {
    StopDeliveryItemID: number;
    JadwalDetailID: number;
    StopCustomerName: string;
    ItemID: string;
    ItemName: string;
    Price: number;
    SalesOrderDetailID: string;
    SalesReturnID: string;
    SisaQty: number;
  }[]).map((r) => ({
    stopDeliveryItemId: r.StopDeliveryItemID,
    jadwalDetailId: r.JadwalDetailID,
    stopCustomerName: r.StopCustomerName,
    itemId: r.ItemID,
    itemName: r.ItemName,
    sisaQty: r.SisaQty,
    price: r.Price,
    salesOrderDetailId: r.SalesOrderDetailID,
    salesReturnId: r.SalesReturnID,
  }));
}

// Claim-guard bersama untuk ketiga jalur Jual Ulang -- membaca ulang sisa
// tersedia DI DALAM transaksi yang sama (bukan dari state yang sudah
// di-fetch pemanggil), menolak kalau qty diminta melebihi sisa saat itu.
// Sama sekali tidak melakukan partial-fill otomatis.
//
// WITH (UPDLOCK, HOLDLOCK) pada sdi BUKAN sekadar hint performa: itulah yang
// membuat guard ini benar-benar aman dari race. Tanpa lock hint, di bawah
// READ COMMITTED (default SQL Server) dua pemanggil yang genuinely
// concurrent -- misalnya HP driver dan desktop dispatcher yang sama-sama
// mencoba menjual ulang StopDeliveryItemID yang sama nyaris berbarengan --
// bisa sama-sama membaca SisaQty sebelum salah satu commit, sama-sama lolos
// guard ini, dan sama-sama insert: oversell dari sisa retur fisik yang
// jumlahnya terbatas. UPDLOCK mengambil update lock pada baris sdi yang
// match WHERE di bawah, dan HOLDLOCK menahannya sampai transaksi commit
// atau rollback (setara serializable untuk baris ini saja). Karena UPDLOCK
// tidak kompatibel dengan UPDLOCK/exclusive lock lain pada baris yang sama,
// pemanggil kedua terhadap StopDeliveryItemID yang SAMA akan BLOCK di
// SELECT ini sampai transaksi pertama selesai -- baru kemudian SELECT-nya
// melihat hasil final (baris DashboardPengirimanReturResale baru kalau
// commit, atau tidak ada kalau rollback) sebelum menghitung sisa. Dua
// StopDeliveryItemID yang berbeda tidak saling mengunci, jadi ini tidak
// membuat resale-resale yang tidak terkait saling menunggu.
async function claimSisaReturAtauGagal(
  transaction: sql.Transaction,
  stopDeliveryItemId: number,
  qtyDiminta: number
): Promise<{ itemId: string; itemName: string; price: number; salesOrderDetailId: string; salesReturnId: string; jadwalId: number; sisaSebelumnya: number }> {
  const result = await new sql.Request(transaction).input("id", sql.Int, stopDeliveryItemId).query(`
    SELECT
        sdi.ItemID, sod.Name AS ItemName, sod.Price, sdi.SalesOrderDetailID, sd.SalesReturnID, jd.JadwalID,
        sdi.QtyRetur - ISNULL((SELECT SUM(Qty) FROM DashboardPengirimanReturResale WHERE StopDeliveryItemID = sdi.StopDeliveryItemID), 0) AS SisaQty,
        sdi.KondisiRetur
    FROM DashboardPengirimanStopDeliveryItem sdi WITH (UPDLOCK, HOLDLOCK)
    JOIN DashboardPengirimanStopDelivery sd ON sd.StopDeliveryID = sdi.StopDeliveryID
    JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalDetailID = sd.JadwalDetailID
    JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = sdi.SalesOrderDetailID
    WHERE sdi.StopDeliveryItemID = @id
  `);
  const row = result.recordset[0] as
    | { ItemID: string; ItemName: string; Price: number; SalesOrderDetailID: string; SalesReturnID: string; JadwalID: number; SisaQty: number; KondisiRetur: string | null }
    | undefined;
  if (!row) throw new AppError("Baris retur tidak ditemukan.");
  if (row.KondisiRetur !== "BAIK") throw new AppError("Retur ini berkondisi Rusak, tidak bisa dijual ulang.");
  if (qtyDiminta <= 0) throw new AppError("Qty yang dijual ulang harus lebih dari 0.");
  if (qtyDiminta > row.SisaQty) {
    throw new AppError(`Sisa retur yang tersedia tinggal ${row.SisaQty}, tidak bisa menjual ${qtyDiminta}.`);
  }
  return {
    itemId: row.ItemID,
    itemName: row.ItemName,
    price: row.Price,
    salesOrderDetailId: row.SalesOrderDetailID,
    salesReturnId: row.SalesReturnID,
    jadwalId: row.JadwalID,
    sisaSebelumnya: row.SisaQty,
  };
}

// Mengurangi SalesReturnDetail (dan header SalesReturn) sebesar qty yang
// berhasil dijual ulang -- berlaku sama di ketiga jalur, dipanggil setelah
// claimSisaReturAtauGagal berhasil, di dalam transaksi yang sama.
async function kurangiSalesReturDetail(
  transaction: sql.Transaction,
  salesReturnId: string,
  salesOrderDetailId: string,
  qty: number
): Promise<void> {
  // Retur (bukan Qty) adalah baseline yang benar -- koreksi retur sisi
  // desktop-ERP live-terkonfirmasi bisa memperbarui Retur tanpa
  // menyinkronkan ulang Qty/Amount, meninggalkan Qty di angka klaim lama
  // (lebih besar). Kalau baseline di sini pakai Qty yang basi, hasilnya
  // malah menimpa Retur yang tadinya sudah benar dengan angka baru yang
  // salah (lihat [[papan-pengiriman-open-findings]] pola serupa).
  const result = await new sql.Request(transaction)
    .input("srId", sql.VarChar(16), salesReturnId)
    .input("soDetailId", sql.VarChar(16), salesOrderDetailId)
    .query(
      `SELECT SalesReturnDetailID, Retur, Price FROM SalesReturnDetail WHERE SalesReturnID = @srId AND SalesOrderDetailID = @soDetailId`
    );
  const row = result.recordset[0] as { SalesReturnDetailID: string; Retur: number; Price: number } | undefined;
  if (!row) throw new AppError("Baris SalesReturnDetail untuk retur ini tidak ditemukan.");

  const newQty = row.Retur - qty;
  const newAmount = newQty * row.Price;
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), row.SalesReturnDetailID)
    .input("qty", sql.Decimal(23, 4), newQty)
    .input("amount", sql.Decimal(23, 4), newAmount)
    .query(
      `UPDATE SalesReturnDetail SET Qty = @qty, Amount = @amount, Netto = @amount, Value = @amount, Retur = @qty WHERE SalesReturnDetailID = @id`
    );

  await new sql.Request(transaction).input("srId", sql.VarChar(16), salesReturnId).query(`
    UPDATE SalesReturn SET
      Amount = (SELECT ISNULL(SUM(Amount), 0) FROM SalesReturnDetail WHERE SalesReturnID = @srId),
      Netto = (SELECT ISNULL(SUM(Amount), 0) FROM SalesReturnDetail WHERE SalesReturnID = @srId)
    WHERE SalesReturnID = @srId
  `);
}

async function insertReturResale(
  transaction: sql.Transaction,
  input: {
    stopDeliveryItemId: number;
    jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL";
    qty: number;
    targetSalesOrderDetailId: string | null;
    salesOrderId: string | null;
    lokasiLat: number | null;
    lokasiLng: number | null;
    akunId: number;
    via: "DRIVER" | "DISPATCHER";
  }
): Promise<void> {
  await new sql.Request(transaction)
    .input("stopDeliveryItemId", sql.Int, input.stopDeliveryItemId)
    .input("jalur", sql.VarChar(20), input.jalur)
    .input("qty", sql.Decimal(23, 4), input.qty)
    .input("targetSodId", sql.VarChar(16), input.targetSalesOrderDetailId)
    .input("soId", sql.VarChar(16), input.salesOrderId)
    .input("lat", sql.Decimal(10, 7), input.lokasiLat)
    .input("lng", sql.Decimal(10, 7), input.lokasiLng)
    .input("akunId", sql.Int, input.akunId)
    .input("via", sql.VarChar(10), input.via).query(`
      INSERT INTO DashboardPengirimanReturResale
        (StopDeliveryItemID, Jalur, Qty, TargetSalesOrderDetailID, SalesOrderID, LokasiLat, LokasiLng, DicatatOlehAkunID, DicatatVia)
      VALUES
        (@stopDeliveryItemId, @jalur, @qty, @targetSodId, @soId, @lat, @lng, @akunId, @via)
    `);
}

export { claimSisaReturAtauGagal, kurangiSalesReturDetail, insertReturResale };

// Bulk resale breakdown for a batch of StopDeliveryItemID, grouped by
// Jalur -- used by Laporan Shift (Task 4) to show "qty X dijual ulang lewat
// jalur Y" per retur item. Deliberately DIFFERENT from getSisaReturTersedia
// above: that function only returns items with UNSOLD sisa > 0 (it answers
// "what's still available to sell"), while a shift report needs to show
// EVERY retur item's resale history including ones that are already fully
// sold out (sisa = 0) -- so this reads DashboardPengirimanReturResale
// directly, with no SisaQty filter at all.
export async function getResaleBreakdownUntukStopItems(
  stopDeliveryItemIds: number[]
): Promise<Map<number, { jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; qty: number }[]>> {
  const map = new Map<number, { jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; qty: number }[]>();
  if (stopDeliveryItemIds.length === 0) return map;
  const pool = await getPool();
  const request = pool.request();
  const placeholders = stopDeliveryItemIds.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const result = await request.query(`
    SELECT StopDeliveryItemID, Jalur, SUM(Qty) AS TotalQty
    FROM DashboardPengirimanReturResale
    WHERE StopDeliveryItemID IN (${placeholders.join(",")})
    GROUP BY StopDeliveryItemID, Jalur
  `);
  for (const row of result.recordset as { StopDeliveryItemID: number; Jalur: "DALAM_RUTE" | "LUAR_RUTE" | "RETAIL"; TotalQty: number }[]) {
    const list = map.get(row.StopDeliveryItemID) ?? [];
    list.push({ jalur: row.Jalur, qty: row.TotalQty });
    map.set(row.StopDeliveryItemID, list);
  }
  return map;
}

// next*Id helpers below are deliberately NOT imported from
// sales-order.ts/pengiriman-jadwal.ts -- this codebase's established
// convention is that every next*Id/next*VoucherSeq helper is unexported and
// privately duplicated per query-file (sales-order.ts, pengiriman-jadwal.ts
// and takeaway-muatan.ts each already carry their own separate copies of the
// DO/SI ones). These copies also differ from their pengiriman-jadwal.ts
// counterparts in one required way: they take a `sql.Transaction` directly
// and call `new sql.Request(transaction)` instead of `pool.request()`,
// because jualUlangDalamRute/jualUlangLuarRute/jualUlangRetail each run their
// entire cascade inside one atomic transaction -- looking up a next-ID via a
// separate, non-transactional pool.request() would read against a different
// session than the one about to INSERT, reopening the exact kind of race
// claimSisaReturAtauGagal's UPDLOCK/HOLDLOCK guard above was hardened to
// close.
async function nextSalesOrderDetailId(transaction: sql.Transaction): Promise<string> {
  const result = await new sql.Request(transaction).query(`SELECT MAX(TRY_CAST(SalesOrderDetailID AS INT)) AS MaxID FROM SalesOrderDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDeliveryOrderDetailId(transaction: sql.Transaction): Promise<string> {
  const result = await new sql.Request(transaction).query(`SELECT MAX(TRY_CAST(DeliveryOrderDetailID AS INT)) AS MaxID FROM DeliveryOrderDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSalesInvoiceDetailId(transaction: sql.Transaction): Promise<string> {
  const result = await new sql.Request(transaction).query(`SELECT MAX(TRY_CAST(SalesInvoiceDetailID AS INT)) AS MaxID FROM SalesInvoiceDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

// Header-level next*Id/next*VoucherSeq + document constants, added for Jalur
// (b)/(c) (jualUlangLuarRute/jualUlangRetail) -- these two paths build a
// brand-new SalesOrder+DeliveryOrder+SalesInvoice from scratch (Jalur (a)
// above only ever touches an *existing* SO/DO/SI's detail rows, so it never
// needed these). SQL bodies copied verbatim from sales-order.ts
// (nextSalesOrderId/BRANCH_ID/DEPARTMENT_ID/DOC_SUFFIX) and
// pengiriman-jadwal.ts (nextDeliveryOrderId/nextDOVoucherSeq/
// nextSalesInvoiceId/nextSIVoucherSeq, lines ~1910-1970) -- same
// transaction-scoped-copy rationale as the three detail-level helpers above.
const BRANCH_ID = "011";
const DEPARTMENT_ID = "0110";
const DOC_SUFFIX = "003/001";

async function nextSalesOrderId(transaction: sql.Transaction): Promise<string> {
  const result = await new sql.Request(transaction).query(`SELECT MAX(TRY_CAST(SalesOrderID AS INT)) AS MaxID FROM SalesOrder`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSOVoucherSeq(transaction: sql.Transaction, yearMonth: string): Promise<string> {
  const result = await new sql.Request(transaction)
    .input("pattern", sql.VarChar(64), `MKE/SO/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM SalesOrder WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

async function nextDeliveryOrderId(transaction: sql.Transaction): Promise<string> {
  const result = await new sql.Request(transaction).query(`SELECT MAX(TRY_CAST(DeliveryOrderID AS INT)) AS MaxID FROM DeliveryOrder`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDOVoucherSeq(transaction: sql.Transaction, yearMonth: string): Promise<string> {
  const result = await new sql.Request(transaction)
    .input("pattern", sql.VarChar(64), `MKE/DO/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM DeliveryOrder WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

async function nextSalesInvoiceId(transaction: sql.Transaction): Promise<string> {
  const result = await new sql.Request(transaction).query(`SELECT MAX(TRY_CAST(SalesInvoiceID AS INT)) AS MaxID FROM SalesInvoice`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSIVoucherSeq(transaction: sql.Transaction, yearMonth: string): Promise<string> {
  const result = await new sql.Request(transaction)
    .input("pattern", sql.VarChar(64), `MKE/SI/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM SalesInvoice WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

interface BuatSoDoSiInput {
  businessPartnerId: string;
  itemId: string;
  itemName: string;
  qty: number;
  price: number;
  jadwalId: number;
}

// Membuat SalesOrder + SalesOrderDetail + DeliveryOrder + DeliveryOrderDetail
// + SalesInvoice + SalesInvoiceDetail sekaligus, atomik, dalam SATU transaksi
// -- dipakai jalur (b)/(c) yang butuh dokumen langsung jadi saat itu juga
// (barangnya sudah di atas truk, tidak ada "Selesai Muat" susulan seperti
// TakeAway). Struktur INSERT DO/SI disalin dari takeAwaySelesaiMuat
// (src/lib/queries/takeaway-muatan.ts) dengan VehicleNo/ExpeditionID/
// SalesmanID diisi dari armada Jadwal yang sedang berjalan, bukan string
// kosong / TAKEAWAY_SALESMAN_ID.
//
// VehicleNo/ExpeditionID lookup: DashboardArmada punya kolom
// ExpeditionDetailID langsung (BUKAN lewat tabel junction terpisah seperti
// draf awal task ini menebak) -- ini JOIN yang SAMA persis dipakai
// selesaiMuat() di pengiriman-jadwal.ts (baris ~2237-2249) untuk mengisi
// DeliveryOrder.VehicleNo/ExpeditionID pada jalur Selesai Muat yang normal:
//   SELECT a.Nama, ed.ExpeditionID, ed.VehicleNo
//   FROM DashboardArmada a
//   LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
//   WHERE a.ArmadaID = @armadaId AND a.IsDeleted = 0
// dengan doVehicleNo = ed.VehicleNo ?? a.Nama (armada nickname jadi fallback
// kalau belum ditautkan ke ExpeditionDetail) dan doExpeditionId = ed.ExpeditionID ?? "".
// Disatukan di sini jadi satu query lewat DashboardPengirimanJadwal.ArmadaID
// (kolom asli, terkonfirmasi dipakai headerRow.ArmadaID di file yang sama).
async function buatSoDoSiSekaligus(
  transaction: sql.Transaction,
  input: BuatSoDoSiInput
): Promise<{ salesOrderId: string; deliveryOrderId: string; salesInvoiceId: string }> {
  const jadwalResult = await new sql.Request(transaction).input("jadwalId", sql.Int, input.jadwalId).query(`
    SELECT j.SalesmanID, a.Nama AS ArmadaNama, ed.ExpeditionID, ed.VehicleNo
    FROM DashboardPengirimanJadwal j
    LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
    LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
    WHERE j.JadwalID = @jadwalId AND j.IsDeleted = 0
  `);
  const jadwalRow = jadwalResult.recordset[0] as
    | { SalesmanID: string | null; ArmadaNama: string | null; ExpeditionID: string | null; VehicleNo: string | null }
    | undefined;
  if (!jadwalRow) throw new AppError("Jadwal tidak ditemukan.");
  const doVehicleNo = jadwalRow.VehicleNo ?? jadwalRow.ArmadaNama ?? "";
  const doExpeditionId = jadwalRow.ExpeditionID ?? "";

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const amount = input.qty * input.price;
  const dueDate = now;

  const salesOrderId = await nextSalesOrderId(transaction);
  const soVoucherSeq = await nextSOVoucherSeq(transaction, yearMonth);
  const soVoucherNo = `MKE/SO/${soVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), salesOrderId)
    .input("voucherNo", sql.VarChar(128), soVoucherNo)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("branchId", sql.VarChar(16), BRANCH_ID)
    .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
    .input("salesmanId", sql.VarChar(16), jadwalRow.SalesmanID ?? "")
    .input("transDate", sql.DateTime, getNaiveWibTransDate())
    .input("dueDate", sql.DateTime, dueDate)
    .input("amount", sql.Decimal(23, 4), amount).query(`
      INSERT INTO SalesOrder
        (SalesOrderID, VoucherNo, ReferenceNo, TransDate, DueDate, BranchID, DepartmentID, BusinessPartnerID,
         TermOfPaymentID, AddressInvoice, AddressDelivery, AddressDeliveryID, CurrencyID, IsClosed, Notes,
         Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, IsInvoiced, IsDeleted, ModifiedDate, Rate,
         StatusForm, SalesmanID, ServiceTaxValue, ServiceTax, Visitor, PromotionID, Number, DiscRpBefore,
         ProjectID, BillOfQuantityID, NotesDelivery, DeliveryMemo, Status)
      VALUES
        (@id, @voucherNo, '', @transDate, @dueDate, @branchId, @departmentId, @bpId,
         '', '', '', '', '', 0, '',
         @amount, 0, 0, 0, 0, 0, @amount, 0, 0, GETDATE(), 1,
         1, @salesmanId, 0, 0, 0, '', 1, 0,
         '', '', '', '', '')
    `);
  const soDetailId = await nextSalesOrderDetailId(transaction);
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), soDetailId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("itemId", sql.VarChar(160), input.itemId)
    .input("name", sql.VarChar(150), input.itemName)
    .input("qty", sql.Decimal(23, 4), input.qty)
    .input("price", sql.Decimal(23, 4), input.price)
    .input("amount", sql.Decimal(23, 4), amount).query(`
      INSERT INTO SalesOrderDetail (SalesOrderDetailID, SalesOrderID, ItemID, Name, Qty, Unit, Price, Disc, DiscValue, DiscRp, Ratio, Amount, FlagClosed)
      VALUES (@id, @soId, @itemId, @name, @qty, 'PCS', @price, 0, 0, 0, 1, @amount, '')
    `);

  const deliveryOrderId = await nextDeliveryOrderId(transaction);
  const doVoucherSeq = await nextDOVoucherSeq(transaction, yearMonth);
  const doVoucherNo = `MKE/DO/${doVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), deliveryOrderId)
    .input("voucherNo", sql.VarChar(128), doVoucherNo)
    .input("branchId", sql.VarChar(16), BRANCH_ID)
    .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .input("salesmanId", sql.VarChar(16), jadwalRow.SalesmanID ?? "")
    .input("expeditionId", sql.VarChar(16), doExpeditionId)
    .input("vehicleNo", sql.VarChar(50), doVehicleNo)
    .input("transDate", sql.DateTime, getNaiveWibTransDate())
    .input("dueDate", sql.DateTime, dueDate).query(`
      INSERT INTO DeliveryOrder
        (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
         IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
         BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
         ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
      VALUES
        (@id, @voucherNo, @transDate, @branchId, @departmentId, @bpId, '', @soId,
         0, @expeditionId, @vehicleNo, '', 0, GETDATE(), '', NULL,
         NULL, 0, '', 1, 1, @salesmanId, 0,
         '', @dueDate, '', '', NULL)
    `);
  const doDetailId = await nextDeliveryOrderDetailId(transaction);
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), doDetailId)
    .input("doId", sql.VarChar(16), deliveryOrderId)
    .input("itemId", sql.VarChar(160), input.itemId)
    .input("name", sql.VarChar(160), input.itemName)
    .input("qty", sql.Decimal(23, 4), input.qty)
    .input("price", sql.Decimal(23, 4), input.price)
    .input("amount", sql.Decimal(23, 4), amount)
    .input("soDetailId", sql.VarChar(16), soDetailId).query(`
      INSERT INTO DeliveryOrderDetail
        (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue,
         DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
      VALUES
        (@id, @doId, @itemId, @qty, 'PCS', @qty, 1, @price, 0, NULL,
         0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
    `);

  const salesInvoiceId = await nextSalesInvoiceId(transaction);
  const siVoucherSeq = await nextSIVoucherSeq(transaction, yearMonth);
  const siVoucherNo = `MKE/SI/${siVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), salesInvoiceId)
    .input("voucherNo", sql.VarChar(128), siVoucherNo)
    .input("dueDate", sql.DateTime, dueDate)
    .input("soId", sql.VarChar(16), salesOrderId)
    // Wrapped in literal single quotes to match the ERP's own historical
    // storage convention for SalesInvoice.DeliveryOrderID -- same quirk
    // documented/fixed identically in takeAwaySelesaiMuat
    // (takeaway-muatan.ts) and createSalesInvoiceForStop (pengiriman-jadwal.ts).
    .input("doId", sql.VarChar(16), `'${deliveryOrderId}'`)
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .input("branchId", sql.VarChar(16), BRANCH_ID)
    .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
    .input("amount", sql.Decimal(23, 4), amount)
    .input("transDate", sql.DateTime, getNaiveWibTransDate())
    .input("salesmanId", sql.VarChar(16), jadwalRow.SalesmanID ?? "").query(`
      INSERT INTO SalesInvoice
        (SalesInvoiceID, VoucherNo, ReferenceNo, TaxNo, TransDate, DueDate, Notes, TermOfPaymentID,
         SalesOrderID, DeliveryOrderID, SalesDepositID, BusinessPartnerID, BranchID, DepartmentID,
         Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, BankID, Paid, Deposit, PaidDate,
         IsClosed, IsDeleted, ModifiedDate, Rate, CurrencyID, IsAccountReceiveable, StatusForm,
         SalesmanID, ServiceTax, ServiceTaxValue, Visitor, IsTX, PromotionID, IsPerforma,
         DiscRpBefore, ProjectID, IsExported, BillOfQuantityID)
      VALUES
        (@id, @voucherNo, '', '', @transDate, @dueDate, '', '',
         @soId, @doId, '', @bpId, @branchId, @departmentId,
         @amount, 0, 0, 0, 0, 0, @amount, '', 0, 0, NULL,
         0, 0, GETDATE(), 1, '', 0, 1,
         @salesmanId, 0, 0, 0, 0, '', 0,
         0, '', 0, '')
    `);
  const siDetailId = await nextSalesInvoiceDetailId(transaction);
  await new sql.Request(transaction)
    .input("id", sql.VarChar(16), siDetailId)
    .input("siId", sql.VarChar(16), salesInvoiceId)
    .input("itemId", sql.VarChar(160), input.itemId)
    .input("name", sql.VarChar(160), input.itemName)
    .input("qty", sql.Decimal(23, 4), input.qty)
    .input("price", sql.Decimal(23, 4), input.price)
    .input("amount", sql.Decimal(23, 4), amount).query(`
      INSERT INTO SalesInvoiceDetail
        (SalesInvoiceDetailID, SalesInvoiceID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue,
         DiscRp, Amount, Name, Value, Netto, Description, WaiterName, Cashback, Total)
      VALUES
        (@id, @siId, @itemId, @qty, 'PCS', 1, 1, @price, 0, 0,
         0, @amount, @name, @amount, @amount, '', '', 0, NULL)
    `);

  await new sql.Request(transaction).input("soId", sql.VarChar(16), salesOrderId).query(`UPDATE SalesOrder SET IsClosed = 1, IsInvoiced = 1 WHERE SalesOrderID = @soId`);
  await new sql.Request(transaction).input("doId", sql.VarChar(16), deliveryOrderId).query(`UPDATE DeliveryOrder SET IsClosed = 1, IsInvoiced = 1 WHERE DeliveryOrderID = @doId`);

  return { salesOrderId, deliveryOrderId, salesInvoiceId };
}

// Jalur (b): jual ulang ke mitra terdaftar nyata yang TIDAK ada di rute
// Jadwal ini -- beda dari jualUlangDalamRute, ini membuat SO+DO+SI baru dari
// nol (via buatSoDoSiSekaligus di atas), bukan menambah qty ke dokumen milik
// mitra yang sudah ada di rute. Harga diambil dari Price Level mitar target,
// dengan mekanisme lookup yang SAMA PERSIS dipakai createSalesOrderManual
// (sales-order.ts): BusinessPartner.PriceLevel (1-8) menentukan kolom
// Item.UnitPriceN mana yang dipakai lewat getPriceLevelOptions (mitra.ts) --
// TIDAK ADA tabel "DashboardPriceLevel" terpisah seperti draf awal task ini
// menebak, itu tidak pernah dibaca langsung dari kode manapun di codebase ini.
export async function jualUlangLuarRute(
  stopDeliveryItemId: number,
  businessPartnerId: string,
  qty: number,
  jadwalId: number,
  akunId: number,
  via: "DRIVER" | "DISPATCHER"
): Promise<{ salesOrderId: string }> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const claim = await claimSisaReturAtauGagal(transaction, stopDeliveryItemId, qty);

    // Finding 1 (review akhir): jadwalId di sini dipakai buatSoDoSiSekaligus
    // untuk menentukan SalesmanID/VehicleNo/ExpeditionID pada DO+SI baru --
    // itu HARUS armada/truk yang secara fisik sedang membawa retur ini,
    // bukan Jadwal sembarang yang kebetulan dimiliki si pemanggil. Tanpa
    // pengecekan ini seorang driver yang lolos assertOwnsJadwal pada
    // Jadwal-nya sendiri bisa tetap mengoper stopDeliveryItemId dari Jadwal
    // (rute/hari) lain sama sekali.
    if (claim.jadwalId !== jadwalId) {
      throw new AppError("Jadwal yang dipakai tidak sesuai dengan rute asal retur ini.");
    }

    const bpResult = await new sql.Request(transaction)
      .input("bpId", sql.VarChar(16), businessPartnerId)
      .query(`SELECT PriceLevel FROM BusinessPartner WHERE BusinessPartnerID = @bpId AND ISNULL(IsDeleted, 0) = 0`);
    const bpRow = bpResult.recordset[0] as { PriceLevel: number | null } | undefined;
    if (!bpRow) throw new AppError("Mitra tidak ditemukan.");
    if (bpRow.PriceLevel == null) throw new AppError("Mitra ini belum punya Price Level -- atur dulu di modul Mitra.");

    const priceLevels = await getPriceLevelOptions(claim.itemName);
    const priceLevelEntry = priceLevels.find((p) => p.Level === bpRow.PriceLevel);
    if (!priceLevelEntry) {
      throw new AppError(`Harga untuk item ${claim.itemName} pada Price Level ${bpRow.PriceLevel} belum diatur.`);
    }

    const { salesOrderId } = await buatSoDoSiSekaligus(transaction, {
      businessPartnerId,
      itemId: claim.itemId,
      itemName: claim.itemName,
      qty,
      price: priceLevelEntry.Price,
      jadwalId,
    });

    await kurangiSalesReturDetail(transaction, claim.salesReturnId, claim.salesOrderDetailId, qty);
    await insertReturResale(transaction, {
      stopDeliveryItemId,
      jalur: "LUAR_RUTE",
      qty,
      targetSalesOrderDetailId: null,
      salesOrderId,
      lokasiLat: null,
      lokasiLng: null,
      akunId,
      via,
    });

    await transaction.commit();
    return { salesOrderId };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Jalur (c): jual ulang ke pembeli walk-up tanpa akun mitra di sistem --
// selalu dibukukan ke BusinessPartner ID "01856" (Task 1: baris minimal,
// hanya BusinessPartnerID/Name/IsDeleted/Gender terisi -- lihat komentar di
// bawah kenapa itu tidak masalah untuk jalur ini) dengan harga FIXED per
// varian kantong (bukan Price Level, mitra ini tidak punya satu pun), dan
// WAJIB merekam lokasi (LokasiLat/LokasiLng) karena tidak ada jejak identitas
// pembeli lain yang bisa dipakai audit di kemudian hari.
//
// FIX 2026-09-08: BusinessPartnerID awalnya literal string 'RETAILRETURN'
// (huruf), yang melanggar konvensi tak-tertulis tapi UNIVERSAL di skema ERP
// ini -- setiap ID dokumen (SalesOrderID, DeliveryOrderID, SalesInvoiceID,
// dan BusinessPartnerID sendiri lewat nextBusinessPartnerId di mitra.ts)
// SELALU berupa string angka murni, dialokasikan via
// MAX(TRY_CAST(id AS INT))+1. FINAC ERP client (compiled .exe, tanpa source)
// ternyata mengandalkan konvensi yang sama secara internal: layar Search
// Delivery Order-nya (dibuka saat membuat Sales Invoice) mem-build lookup
// lewat MIT.Utility.GetObjects yang men-convert BusinessPartnerID ke INT --
// begitu ada dokumen SO/DO/SI dengan BusinessPartnerID='RETAILRETURN', FINAC
// crash dengan "Conversion failed when converting the varchar value
// 'RETAILRETURN' to data type int." saat form itu dibuka. Diperbaiki via
// migrasi satu kali (scripts/_fix-retailreturn-bpid.ts, sudah dijalankan
// dan dihapus) yang memindahkan BusinessPartner + 1 SalesOrder + 1
// DeliveryOrder + 1 SalesInvoice yang sudah terlanjur dibuat ke ID numerik
// "01856" (MAX(TRY_CAST(BusinessPartnerID AS INT)) di BusinessPartner saat
// itu = 1855) -- dikonfirmasi live sebagai satu-satunya BusinessPartnerID
// non-numerik di seluruh tabel BusinessPartner, dan satu-satunya referensi
// di antara 55 tabel ERP yang punya kolom BusinessPartnerID.
const RETAIL_RETURN_BP_ID = "01856";
const HARGA_RETAIL_RETURN_10KG = 8000;
const HARGA_RETAIL_RETURN_5KG = 6000;

export async function jualUlangRetail(
  stopDeliveryItemId: number,
  qty: number,
  lokasiLat: number,
  lokasiLng: number,
  jadwalId: number,
  akunId: number,
  via: "DRIVER" | "DISPATCHER"
): Promise<{ salesOrderId: string }> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const claim = await claimSisaReturAtauGagal(transaction, stopDeliveryItemId, qty);

    // Finding 1 (review akhir): sama seperti jualUlangLuarRute di atas --
    // jadwalId menentukan armada/truk yang dipakai buatSoDoSiSekaligus untuk
    // DO+SI baru, jadi harus benar-benar Jadwal yang sama dengan retur
    // sumbernya, bukan sekadar Jadwal yang dimiliki si pemanggil.
    if (claim.jadwalId !== jadwalId) {
      throw new AppError("Jadwal yang dipakai tidak sesuai dengan rute asal retur ini.");
    }

    // ItemID untuk 10kg vs 5kg -- dibandingkan lewat KANTONG_ITEM_ID (item
    // 10kg "Es Tube Jual", ItemID "019", diekspor dari sales-order.ts)
    // alih-alih menebak/duplikasi string ItemID di sini secara manual.
    const hargaFixed = claim.itemId === KANTONG_ITEM_ID ? HARGA_RETAIL_RETURN_10KG : HARGA_RETAIL_RETURN_5KG;

    // BusinessPartner "01856" (Retail Return) punya GroupBusinessPartner/
    // AccountReceivableID/TermOfPaymentID/PriceLevel semua NULL (Task 1) --
    // tidak masalah di sini karena buatSoDoSiSekaligus TIDAK PERNAH membaca
    // kolom-kolom itu dari BusinessPartner sama sekali: TermOfPaymentID pada
    // SalesOrder/SalesInvoice yang dibuatnya selalu string kosong hardcoded
    // (bukan dibaca dari BusinessPartner.TermOfPaymentID seperti
    // createSalesOrderManual), dan harga di jalur ini adalah hargaFixed di
    // atas, bukan dari BusinessPartner.PriceLevel. BusinessPartnerID sendiri
    // satu-satunya kolom NOT NULL pada tabel BusinessPartner (lihat
    // create-retur-resale-schema.ts) dan sudah terisi ID numerik ini (lihat
    // RETAIL_RETURN_BP_ID di atas untuk kenapa harus numerik).
    const { salesOrderId } = await buatSoDoSiSekaligus(transaction, {
      businessPartnerId: RETAIL_RETURN_BP_ID,
      itemId: claim.itemId,
      itemName: claim.itemName,
      qty,
      price: hargaFixed,
      jadwalId,
    });

    await kurangiSalesReturDetail(transaction, claim.salesReturnId, claim.salesOrderDetailId, qty);
    await insertReturResale(transaction, {
      stopDeliveryItemId,
      jalur: "RETAIL",
      qty,
      targetSalesOrderDetailId: null,
      salesOrderId,
      lokasiLat,
      lokasiLng,
      akunId,
      via,
    });

    await transaction.commit();
    return { salesOrderId };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Jalur (a): jual ulang ke mitra lain yang MASIH ADA di rute Jadwal yang
// sama, yang stop-nya belum JamSelesai. Tidak membuat dokumen baru sama
// sekali -- hanya menambah Qty/Amount pada SalesOrder/DeliveryOrder/(kalau
// sudah terbit) SalesInvoice milik mitra target yang sudah ada, lalu
// mengurangi SalesReturnDetail retur sumbernya sebesar qty yang sama.
//
// Teknik pencocokan DeliveryOrderDetail<->SalesInvoiceDetail SENGAJA BUKAN
// korespondensi posisi seperti confirmStopDelivery (pengiriman-jadwal.ts)
// -- lihat komentar di titik pencocokan SalesInvoiceDetail di bawah untuk
// alasannya.
//
// Review akhir (Finding 1/2/3): target lookup sekarang jalan DI DALAM
// transaksi dengan UPDLOCK/HOLDLOCK pada sd (bukan pool.request() sebelum
// transaction.begin() seperti draf awal) supaya JamSelesai tidak bisa
// berubah di window antara pre-check dan write aktual, JadwalID target
// diverifikasi sama dengan JadwalID pemilik retur sumbernya (spec: Jalur
// (a) hanya berlaku dalam SATU Jadwal yang sama), dan existingSod/
// existingDod/existingSid masing-masing dikunci UPDLOCK/HOLDLOCK supaya dua
// panggilan konkuren ke baris target yang sama tidak saling lost-update.
export async function jualUlangDalamRute(
  stopDeliveryItemId: number,
  targetJadwalDetailId: number,
  qty: number,
  akunId: number,
  via: "DRIVER" | "DISPATCHER"
): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Target lookup + JamSelesai check: dikunci lewat UPDLOCK/HOLDLOCK pada
    // sd (DashboardPengirimanStopDelivery) sehingga kalau proses lain sedang
    // menuju konfirmasi selesai (yang men-set JamSelesai) di baris stop yang
    // sama, salah satu transaksi akan BLOCK di sini sampai yang lain
    // commit/rollback -- lalu benar-benar melihat JamSelesai versi final,
    // bukan versi basi dari sebelum transaction.begin() seperti draf lama.
    // so.BusinessPartnerID ikut diambil di sini untuk Finding 4 di bawah
    // (lookup Price Level mitra target pada cabang insert-baris-baru).
    const targetResult = await new sql.Request(transaction).input("id", sql.Int, targetJadwalDetailId).query(`
      SELECT jd.SalesOrderID, jd.DeliveryOrderID, jd.SalesInvoiceID, jd.JadwalID, so.BusinessPartnerID, sd.JamSelesai
      FROM DashboardPengirimanJadwalDetail jd
      JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
      LEFT JOIN DashboardPengirimanStopDelivery sd WITH (UPDLOCK, HOLDLOCK) ON sd.JadwalDetailID = jd.JadwalDetailID
      WHERE jd.JadwalDetailID = @id AND jd.IsDeleted = 0
    `);
    const target = targetResult.recordset[0] as
      | { SalesOrderID: string; DeliveryOrderID: string | null; SalesInvoiceID: string | null; JadwalID: number; BusinessPartnerID: string; JamSelesai: Date | null }
      | undefined;
    if (!target) throw new AppError("Stop tujuan tidak ditemukan.");
    if (target.JamSelesai) throw new AppError("Stop mitra ini sudah selesai, tidak bisa ditambah qty dari sini.");
    if (!target.DeliveryOrderID) throw new AppError("Stop tujuan belum Selesai Muat, tidak bisa ditambah qty dari sini.");

    const claim = await claimSisaReturAtauGagal(transaction, stopDeliveryItemId, qty);

    // Finding 1 (review akhir): Jalur (a) hanya berlaku selama target masih
    // ada di rute Jadwal yang SAMA dengan retur sumbernya -- ini bukan cuma
    // aturan spec, tapi juga authorization boundary (lihat komentar finding
    // di task dispatch): tanpa ini targetJadwalDetailId dari Jadwal lain
    // sama sekali tetap bisa lolos meski stopDeliveryItemId & jadwalId yang
    // dioper masing-masing valid secara terpisah.
    if (claim.jadwalId !== target.JadwalID) {
      throw new AppError("Stop tujuan bukan bagian dari Jadwal yang sama dengan retur ini.");
    }

    // Cari baris SalesOrderDetail milik SO target dengan ItemID yang sama.
    // UPDLOCK/HOLDLOCK di sini (Finding 2, review akhir) mencegah lost
    // update kalau dua panggilan jualUlangDalamRute konkuren menyasar baris
    // target yang sama -- idiom sama persis dengan claimSisaReturAtauGagal.
    const existingSod = await new sql.Request(transaction)
      .input("soId", sql.VarChar(16), target.SalesOrderID)
      .input("itemId", sql.VarChar(160), claim.itemId)
      .query(`SELECT SalesOrderDetailID, Qty, Price, Name, Unit FROM SalesOrderDetail WITH (UPDLOCK, HOLDLOCK) WHERE SalesOrderID = @soId AND ItemID = @itemId`);
    let targetSodRow = existingSod.recordset[0] as
      | { SalesOrderDetailID: string; Qty: number; Price: number; Name: string; Unit: string }
      | undefined;

    if (!targetSodRow) {
      // Item ini belum pernah dipesan mitra target hari ini -- insert baris
      // baru. Finding 4 (review akhir): harga di cabang ini HARUS harga
      // mitra TARGET, bukan claim.price (harga retur sumber) -- pola lookup
      // sama persis dengan jualUlangLuarRute di atas (BusinessPartner.
      // PriceLevel -> getPriceLevelOptions). Lookup ini sengaja hanya jalan
      // di cabang !targetSodRow ini (baris pertama untuk item ini di SO
      // target), bukan tanpa syarat, supaya jalur "update baris existing"
      // yang jauh lebih umum (dan sudah benar pakai targetSodRow.Price
      // sejak dua ronde fix Task 4 sebelumnya) tidak kena biaya query ekstra.
      const bpResult = await new sql.Request(transaction)
        .input("bpId", sql.VarChar(16), target.BusinessPartnerID)
        .query(`SELECT PriceLevel FROM BusinessPartner WHERE BusinessPartnerID = @bpId AND ISNULL(IsDeleted, 0) = 0`);
      const bpRow = bpResult.recordset[0] as { PriceLevel: number | null } | undefined;
      if (!bpRow) throw new AppError("Mitra tidak ditemukan.");
      if (bpRow.PriceLevel == null) throw new AppError("Mitra ini belum punya Price Level -- atur dulu di modul Mitra.");

      const priceLevels = await getPriceLevelOptions(claim.itemName);
      const priceLevelEntry = priceLevels.find((p) => p.Level === bpRow.PriceLevel);
      if (!priceLevelEntry) {
        throw new AppError(`Harga untuk item ${claim.itemName} pada Price Level ${bpRow.PriceLevel} belum diatur.`);
      }
      const targetPrice = priceLevelEntry.Price;

      const newSodId = await nextSalesOrderDetailId(transaction);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), newSodId)
        .input("soId", sql.VarChar(16), target.SalesOrderID)
        .input("itemId", sql.VarChar(160), claim.itemId)
        .input("name", sql.VarChar(150), claim.itemName)
        .input("qty", sql.Decimal(23, 4), qty)
        .input("price", sql.Decimal(23, 4), targetPrice)
        .input("amount", sql.Decimal(23, 4), qty * targetPrice).query(`
          INSERT INTO SalesOrderDetail (SalesOrderDetailID, SalesOrderID, ItemID, Name, Qty, Unit, Price, Disc, DiscValue, DiscRp, Ratio, Amount, FlagClosed)
          VALUES (@id, @soId, @itemId, @name, @qty, 'PCS', @price, 0, 0, 0, 1, @amount, '')
        `);
      targetSodRow = { SalesOrderDetailID: newSodId, Qty: 0, Price: targetPrice, Name: claim.itemName, Unit: "PCS" };
    } else {
      const newQty = targetSodRow.Qty + qty;
      const newAmount = newQty * targetSodRow.Price;
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), targetSodRow.SalesOrderDetailID)
        .input("qty", sql.Decimal(23, 4), newQty)
        .input("amount", sql.Decimal(23, 4), newAmount)
        .query(`UPDATE SalesOrderDetail SET Qty = @qty, Amount = @amount WHERE SalesOrderDetailID = @id`);
    }

    // Cascade ke DeliveryOrderDetail, dicocokkan lewat SalesOrderDetailID.
    // UPDLOCK/HOLDLOCK di sini juga (Finding 2) -- alasan sama dengan
    // existingSod di atas.
    const existingDod = await new sql.Request(transaction)
      .input("doId", sql.VarChar(16), target.DeliveryOrderID)
      .input("soDetailId", sql.VarChar(16), targetSodRow.SalesOrderDetailID)
      .query(`SELECT DeliveryOrderDetailID, Qty, Delivered, Amount FROM DeliveryOrderDetail WITH (UPDLOCK, HOLDLOCK) WHERE DeliveryOrderID = @doId AND SalesOrderDetailID = @soDetailId`);
    const dodRow = existingDod.recordset[0] as { DeliveryOrderDetailID: string; Qty: number; Delivered: number; Amount: number } | undefined;

    if (!dodRow) {
      // Finding 4: harga baris DOD baru mengikuti targetSodRow.Price (sudah
      // resolved ke harga mitra target di atas, baik lewat lookup Price
      // Level barusan maupun dari baris SOD existing) -- bukan claim.price.
      const newDodId = await nextDeliveryOrderDetailId(transaction);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), newDodId)
        .input("doId", sql.VarChar(16), target.DeliveryOrderID)
        .input("itemId", sql.VarChar(160), claim.itemId)
        .input("name", sql.VarChar(160), claim.itemName)
        .input("qty", sql.Decimal(23, 4), qty)
        .input("price", sql.Decimal(23, 4), targetSodRow.Price)
        .input("amount", sql.Decimal(23, 4), qty * targetSodRow.Price)
        .input("soDetailId", sql.VarChar(16), targetSodRow.SalesOrderDetailID).query(`
          INSERT INTO DeliveryOrderDetail (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue, DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
          VALUES (@id, @doId, @itemId, @qty, 'PCS', @qty, 1, @price, 0, NULL, 0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
        `);
    } else {
      const newQty = dodRow.Qty + qty;
      const newAmount = newQty * targetSodRow.Price;
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), dodRow.DeliveryOrderDetailID)
        .input("qty", sql.Decimal(23, 4), newQty)
        .input("delivered", sql.Decimal(23, 4), dodRow.Delivered + qty)
        .input("amount", sql.Decimal(23, 4), newAmount)
        .query(`UPDATE DeliveryOrderDetail SET Qty = @qty, Delivered = @delivered, Amount = @amount WHERE DeliveryOrderDetailID = @id`);
    }
    await new sql.Request(transaction)
      .input("doId", sql.VarChar(16), target.DeliveryOrderID)
      .query(`UPDATE DeliveryOrder SET ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);

    // Cascade ke SalesInvoiceDetail kalau SI sudah terbit -- dicocokkan
    // lewat ItemID langsung DI SINI (bukan korespondensi posisi seperti
    // confirmStopDelivery) karena baris baru yang barusan
    // di-insert/diupdate di atas TIDAK PUNYA rekan SalesInvoiceDetail yang
    // "diciptakan di iterasi loop yang sama" seperti asumsi teknik posisi
    // itu -- di sini cukup ada SATU baris SalesInvoiceDetail per ItemID per
    // SO (order manual tidak pernah punya dua baris ItemID sama), jadi
    // pencocokan langsung lewat ItemID aman. UPDLOCK/HOLDLOCK di sini juga
    // (Finding 2) -- alasan sama dengan existingSod/existingDod di atas.
    if (target.SalesInvoiceID) {
      const existingSid = await new sql.Request(transaction)
        .input("siId", sql.VarChar(16), target.SalesInvoiceID)
        .input("itemId", sql.VarChar(160), claim.itemId)
        .query(`SELECT SalesInvoiceDetailID, Qty FROM SalesInvoiceDetail WITH (UPDLOCK, HOLDLOCK) WHERE SalesInvoiceID = @siId AND ItemID = @itemId`);
      const sidRow = existingSid.recordset[0] as { SalesInvoiceDetailID: string; Qty: number } | undefined;

      if (!sidRow) {
        // Finding 4: sama seperti cabang insert DOD di atas -- pakai
        // targetSodRow.Price, bukan claim.price.
        const newSidId = await nextSalesInvoiceDetailId(transaction);
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), newSidId)
          .input("siId", sql.VarChar(16), target.SalesInvoiceID)
          .input("itemId", sql.VarChar(160), claim.itemId)
          .input("name", sql.VarChar(160), claim.itemName)
          .input("qty", sql.Decimal(23, 4), qty)
          .input("price", sql.Decimal(23, 4), targetSodRow.Price)
          .input("amount", sql.Decimal(23, 4), qty * targetSodRow.Price).query(`
            INSERT INTO SalesInvoiceDetail (SalesInvoiceDetailID, SalesInvoiceID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue, DiscRp, Amount, Name, Value, Netto, Description, WaiterName, Cashback, Total)
            VALUES (@id, @siId, @itemId, @qty, 'PCS', 1, 1, @price, 0, 0, 0, @amount, @name, @amount, @amount, '', '', 0, NULL)
          `);
      } else {
        const newQty = sidRow.Qty + qty;
        const newAmount = newQty * targetSodRow.Price;
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), sidRow.SalesInvoiceDetailID)
          .input("qty", sql.Decimal(23, 4), newQty)
          .input("amount", sql.Decimal(23, 4), newAmount)
          .query(`UPDATE SalesInvoiceDetail SET Qty = @qty, Amount = @amount, Netto = @amount, Value = @amount WHERE SalesInvoiceDetailID = @id`);
      }
      await new sql.Request(transaction).input("siId", sql.VarChar(16), target.SalesInvoiceID).query(`
        UPDATE SalesInvoice SET
          Amount = (SELECT ISNULL(SUM(Amount), 0) FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId),
          Netto = (SELECT ISNULL(SUM(Amount), 0) FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId)
        WHERE SalesInvoiceID = @siId
      `);
    }

    // Recompute header SalesOrder.
    await new sql.Request(transaction).input("soId", sql.VarChar(16), target.SalesOrderID).query(`
      UPDATE SalesOrder SET
        Amount = (SELECT ISNULL(SUM(Amount), 0) FROM SalesOrderDetail WHERE SalesOrderID = @soId),
        Netto = (SELECT ISNULL(SUM(Amount), 0) FROM SalesOrderDetail WHERE SalesOrderID = @soId),
        ModifiedDate = GETDATE()
      WHERE SalesOrderID = @soId
    `);

    await kurangiSalesReturDetail(transaction, claim.salesReturnId, claim.salesOrderDetailId, qty);
    await insertReturResale(transaction, {
      stopDeliveryItemId,
      jalur: "DALAM_RUTE",
      qty,
      targetSalesOrderDetailId: targetSodRow.SalesOrderDetailID,
      salesOrderId: null,
      lokasiLat: null,
      lokasiLng: null,
      akunId,
      via,
    });

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
