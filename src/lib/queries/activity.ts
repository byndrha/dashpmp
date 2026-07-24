import { getPool, sql } from "@/lib/db";
import { getBusinessDate } from "@/lib/business-date";

export interface TodayWilayahPulse {
  Wilayah: string;
  NetSales: number;
  Qty: number;
  DOCount: number;
}

// "Today" follows the business date (WIB, rolls over at 14:00) rather than
// the calendar date, so this matches whatever date staff are actively
// entering orders/deliveries against — see src/lib/business-date.ts.
//
// Sourced from DeliveryOrder/DeliveryOrderDetail (what actually left the
// warehouse), not SalesInvoice (what's been billed) — those can differ on
// any given day, and this widget is meant to track delivery activity, not
// billing. NetSales comes from DeliveryOrderDetail.Amount (populated at DO
// creation, same as the SO/DO pricing carried over — see
// pengiriman-jadwal.ts's publishJadwal()), not a proxy/estimate.
export async function getTodayWilayahPulse(limit = 6): Promise<TodayWilayahPulse[]> {
  const pool = await getPool();
  const businessDate = getBusinessDate();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate)
    .query(`
    SELECT TOP ${limit}
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        SUM(dod.Amount) AS NetSales,
        SUM(dod.Delivered) AS Qty,
        COUNT(DISTINCT do_.DeliveryOrderID) AS DOCount
    FROM DeliveryOrder do_
    JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
    WHERE do_.IsDeleted = 0
      AND do_.TransDate >= @businessDate
      AND do_.TransDate <  DATEADD(DAY, 1, @businessDate)
    GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui')
    ORDER BY NetSales DESC
  `);

  return result.recordset;
}
