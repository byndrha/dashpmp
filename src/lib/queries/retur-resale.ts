import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

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
): Promise<{ itemId: string; itemName: string; price: number; salesOrderDetailId: string; salesReturnId: string; sisaSebelumnya: number }> {
  const result = await new sql.Request(transaction).input("id", sql.Int, stopDeliveryItemId).query(`
    SELECT
        sdi.ItemID, sod.Name AS ItemName, sod.Price, sdi.SalesOrderDetailID, sd.SalesReturnID,
        sdi.QtyRetur - ISNULL((SELECT SUM(Qty) FROM DashboardPengirimanReturResale WHERE StopDeliveryItemID = sdi.StopDeliveryItemID), 0) AS SisaQty,
        sdi.KondisiRetur
    FROM DashboardPengirimanStopDeliveryItem sdi WITH (UPDLOCK, HOLDLOCK)
    JOIN DashboardPengirimanStopDelivery sd ON sd.StopDeliveryID = sdi.StopDeliveryID
    JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = sdi.SalesOrderDetailID
    WHERE sdi.StopDeliveryItemID = @id
  `);
  const row = result.recordset[0] as
    | { ItemID: string; ItemName: string; Price: number; SalesOrderDetailID: string; SalesReturnID: string; SisaQty: number; KondisiRetur: string | null }
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
  const result = await new sql.Request(transaction)
    .input("srId", sql.VarChar(16), salesReturnId)
    .input("soDetailId", sql.VarChar(16), salesOrderDetailId)
    .query(
      `SELECT SalesReturnDetailID, Qty, Price FROM SalesReturnDetail WHERE SalesReturnID = @srId AND SalesOrderDetailID = @soDetailId`
    );
  const row = result.recordset[0] as { SalesReturnDetailID: string; Qty: number; Price: number } | undefined;
  if (!row) throw new AppError("Baris SalesReturnDetail untuk retur ini tidak ditemukan.");

  const newQty = row.Qty - qty;
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
