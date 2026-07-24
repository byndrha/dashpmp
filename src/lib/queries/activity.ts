import { getPool, sql } from "@/lib/db";
import { getBusinessDate } from "@/lib/business-date";

export interface TodayWilayahPulse {
  Wilayah: string;
  NetSales: number;
  InvoiceCount: number;
}

// "Today" follows the business date (WIB, rolls over at 14:00) rather than
// the calendar date, so this matches whatever date staff are actively
// entering orders/deliveries against — see src/lib/business-date.ts.
export async function getTodayWilayahPulse(limit = 6): Promise<TodayWilayahPulse[]> {
  const pool = await getPool();
  const businessDate = getBusinessDate();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate)
    .query(`
    SELECT TOP ${limit}
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        SUM(si.Netto) AS NetSales,
        COUNT(si.SalesInvoiceID) AS InvoiceCount
    FROM SalesInvoice si
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
    WHERE si.IsDeleted = 0
      AND ISNULL(si.IsPerforma, 0) = 0
      AND si.TransDate >= @businessDate
      AND si.TransDate <  DATEADD(DAY, 1, @businessDate)
    GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui')
    ORDER BY NetSales DESC
  `);

  return result.recordset;
}
