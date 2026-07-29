import { getPool, sql } from "@/lib/db";

export interface DeliveryOrderPrintHeader {
  DeliveryOrderID: string;
  VoucherNo: string;
  TransDate: string | Date;
  VehicleNo: string;
  DriverName: string | null;
  CustomerName: string;
  Alamat: string | null;
  Wilayah: string | null;
}

export interface DeliveryOrderPrintLine {
  Name: string;
  Qty: number;
  Unit: string;
  BonusQty: number;
}

export interface DeliveryOrderPrintData {
  header: DeliveryOrderPrintHeader;
  lines: DeliveryOrderPrintLine[];
}

// Everything a printed DO needs: header (voucher/date/vehicle/driver/
// customer) plus line items with the bonus portion split out — same dual
// scheme as JADWAL_BONUS_QTY_EXPR in pengiriman-jadwal.ts: a dedicated
// "Bonus"-named row (see BONUS_ITEM_VARIANTS in sales-order.ts) is entirely
// bonus, while an older order's bonus rides on the main row's
// SalesOrderDetail.Custom1 instead (DeliveryOrderDetail itself never
// stores bonus directly either way — always resolved by joining back to
// the SO line it was copied from at startBerangkat).
export async function getDeliveryOrderPrintData(deliveryOrderId: string): Promise<DeliveryOrderPrintData | null> {
  const pool = await getPool();
  const headerResult = await pool
    .request()
    .input("id", sql.VarChar(16), deliveryOrderId).query(`
      SELECT
          do_.DeliveryOrderID, do_.VoucherNo, do_.TransDate, do_.VehicleNo,
          sm.Name AS DriverName,
          bp.Name AS CustomerName, bp.Address AS Alamat,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), NULL) AS Wilayah
      FROM DeliveryOrder do_
      LEFT JOIN Salesman sm ON sm.SalesmanID = do_.SalesmanID
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
      WHERE do_.DeliveryOrderID = @id AND do_.IsDeleted = 0
    `);
  const header = headerResult.recordset[0] as DeliveryOrderPrintHeader | undefined;
  if (!header) return null;

  const linesResult = await pool
    .request()
    .input("id", sql.VarChar(16), deliveryOrderId).query(`
      SELECT
          dod.Name,
          dod.Qty,
          dod.Unit,
          CASE
            WHEN dod.Name LIKE '%Bonus%' THEN (CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Qty / 2.0 ELSE dod.Qty END)
            ELSE (CASE WHEN dod.Name LIKE '%5 KG%'
              THEN ISNULL(TRY_CAST(NULLIF(sod.Custom1, '') AS FLOAT), 0) / 2.0
              ELSE ISNULL(TRY_CAST(NULLIF(sod.Custom1, '') AS FLOAT), 0)
            END)
          END AS BonusQty
      FROM DeliveryOrderDetail dod
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderDetailID = dod.SalesOrderDetailID
      WHERE dod.DeliveryOrderID = @id
    `);

  return { header, lines: linesResult.recordset as DeliveryOrderPrintLine[] };
}
