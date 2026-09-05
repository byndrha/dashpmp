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

// next*Id helpers below are deliberately NOT imported from
// sales-order.ts/pengiriman-jadwal.ts -- this codebase's established
// convention is that every next*Id/next*VoucherSeq helper is unexported and
// privately duplicated per query-file (sales-order.ts, pengiriman-jadwal.ts
// and takeaway-muatan.ts each already carry their own separate copies of the
// DO/SI ones). These three copies also differ from their pengiriman-jadwal.ts
// counterparts in one required way: they take a `sql.Transaction` directly
// and call `new sql.Request(transaction)` instead of `pool.request()`,
// because jualUlangDalamRute runs its entire cascade inside one atomic
// transaction -- looking up a next-ID via a separate, non-transactional
// pool.request() would read against a different session than the one about
// to INSERT, reopening the exact kind of race claimSisaReturAtauGagal's
// UPDLOCK/HOLDLOCK guard above was hardened to close.
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
export async function jualUlangDalamRute(
  stopDeliveryItemId: number,
  targetJadwalDetailId: number,
  qty: number,
  akunId: number,
  via: "DRIVER" | "DISPATCHER"
): Promise<void> {
  const pool = await getPool();

  const targetResult = await pool.request().input("id", sql.Int, targetJadwalDetailId).query(`
    SELECT jd.SalesOrderID, jd.DeliveryOrderID, jd.SalesInvoiceID, sd.JamSelesai
    FROM DashboardPengirimanJadwalDetail jd
    LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
    WHERE jd.JadwalDetailID = @id AND jd.IsDeleted = 0
  `);
  const target = targetResult.recordset[0] as
    | { SalesOrderID: string; DeliveryOrderID: string | null; SalesInvoiceID: string | null; JamSelesai: Date | null }
    | undefined;
  if (!target) throw new AppError("Stop tujuan tidak ditemukan.");
  if (target.JamSelesai) throw new AppError("Stop mitra ini sudah selesai, tidak bisa ditambah qty dari sini.");
  if (!target.DeliveryOrderID) throw new AppError("Stop tujuan belum Selesai Muat, tidak bisa ditambah qty dari sini.");

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const claim = await claimSisaReturAtauGagal(transaction, stopDeliveryItemId, qty);

    // Cari baris SalesOrderDetail milik SO target dengan ItemID yang sama.
    const existingSod = await new sql.Request(transaction)
      .input("soId", sql.VarChar(16), target.SalesOrderID)
      .input("itemId", sql.VarChar(160), claim.itemId)
      .query(`SELECT SalesOrderDetailID, Qty, Price, Name, Unit FROM SalesOrderDetail WHERE SalesOrderID = @soId AND ItemID = @itemId`);
    let targetSodRow = existingSod.recordset[0] as
      | { SalesOrderDetailID: string; Qty: number; Price: number; Name: string; Unit: string }
      | undefined;

    if (!targetSodRow) {
      // Item ini belum pernah dipesan mitra target hari ini -- insert baris baru.
      const newSodId = await nextSalesOrderDetailId(transaction);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), newSodId)
        .input("soId", sql.VarChar(16), target.SalesOrderID)
        .input("itemId", sql.VarChar(160), claim.itemId)
        .input("name", sql.VarChar(150), claim.itemName)
        .input("qty", sql.Decimal(23, 4), qty)
        .input("price", sql.Decimal(23, 4), claim.price)
        .input("amount", sql.Decimal(23, 4), qty * claim.price).query(`
          INSERT INTO SalesOrderDetail (SalesOrderDetailID, SalesOrderID, ItemID, Name, Qty, Unit, Price, Disc, DiscValue, DiscRp, Ratio, Amount, FlagClosed)
          VALUES (@id, @soId, @itemId, @name, @qty, 'PCS', @price, 0, 0, 0, 1, @amount, '')
        `);
      targetSodRow = { SalesOrderDetailID: newSodId, Qty: 0, Price: claim.price, Name: claim.itemName, Unit: "PCS" };
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
    const existingDod = await new sql.Request(transaction)
      .input("doId", sql.VarChar(16), target.DeliveryOrderID)
      .input("soDetailId", sql.VarChar(16), targetSodRow.SalesOrderDetailID)
      .query(`SELECT DeliveryOrderDetailID, Qty, Delivered, Amount FROM DeliveryOrderDetail WHERE DeliveryOrderID = @doId AND SalesOrderDetailID = @soDetailId`);
    const dodRow = existingDod.recordset[0] as { DeliveryOrderDetailID: string; Qty: number; Delivered: number; Amount: number } | undefined;

    if (!dodRow) {
      const newDodId = await nextDeliveryOrderDetailId(transaction);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), newDodId)
        .input("doId", sql.VarChar(16), target.DeliveryOrderID)
        .input("itemId", sql.VarChar(160), claim.itemId)
        .input("name", sql.VarChar(160), claim.itemName)
        .input("qty", sql.Decimal(23, 4), qty)
        .input("price", sql.Decimal(23, 4), claim.price)
        .input("amount", sql.Decimal(23, 4), qty * claim.price)
        .input("soDetailId", sql.VarChar(16), targetSodRow.SalesOrderDetailID).query(`
          INSERT INTO DeliveryOrderDetail (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue, DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
          VALUES (@id, @doId, @itemId, @qty, 'PCS', @qty, 1, @price, 0, NULL, 0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
        `);
    } else {
      const newQty = dodRow.Qty + qty;
      const newAmount = newQty * claim.price;
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
    // pencocokan langsung lewat ItemID aman.
    if (target.SalesInvoiceID) {
      const existingSid = await new sql.Request(transaction)
        .input("siId", sql.VarChar(16), target.SalesInvoiceID)
        .input("itemId", sql.VarChar(160), claim.itemId)
        .query(`SELECT SalesInvoiceDetailID, Qty FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId AND ItemID = @itemId`);
      const sidRow = existingSid.recordset[0] as { SalesInvoiceDetailID: string; Qty: number } | undefined;

      if (!sidRow) {
        const newSidId = await nextSalesInvoiceDetailId(transaction);
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), newSidId)
          .input("siId", sql.VarChar(16), target.SalesInvoiceID)
          .input("itemId", sql.VarChar(160), claim.itemId)
          .input("name", sql.VarChar(160), claim.itemName)
          .input("qty", sql.Decimal(23, 4), qty)
          .input("price", sql.Decimal(23, 4), claim.price)
          .input("amount", sql.Decimal(23, 4), qty * claim.price).query(`
            INSERT INTO SalesInvoiceDetail (SalesInvoiceDetailID, SalesInvoiceID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue, DiscRp, Amount, Name, Value, Netto, Description, WaiterName, Cashback, Total)
            VALUES (@id, @siId, @itemId, @qty, 'PCS', 1, 1, @price, 0, 0, 0, @amount, @name, @amount, @amount, '', '', 0, NULL)
          `);
      } else {
        const newQty = sidRow.Qty + qty;
        const newAmount = newQty * claim.price;
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
