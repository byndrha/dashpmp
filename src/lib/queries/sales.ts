import { getPool, sql } from "@/lib/db";
import type { DateRangeFilter } from "@/types/dashboard";

export interface DailySales {
  Wilayah: string;
  SalesDate: string;
  InvoiceCount: number;
  GrossAmount: number;
  TotalDiscount: number;
  TotalTax: number;
  NetSales: number;
}

export async function getDailySales(filter: DateRangeFilter): Promise<DailySales[]> {
  const pool = await getPool();
  const request = pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate);

  if (filter.wilayah) request.input("wilayah", sql.VarChar(128), filter.wilayah);

  const result = await request.query(`
    SELECT
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        CAST(si.TransDate AS DATE) AS SalesDate,
        COUNT(DISTINCT si.SalesInvoiceID) AS InvoiceCount,
        SUM(si.Amount)     AS GrossAmount,
        SUM(si.DiscRp)     AS TotalDiscount,
        SUM(si.TaxValue)   AS TotalTax,
        SUM(si.Netto)      AS NetSales
    FROM SalesInvoice si
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
    WHERE si.IsDeleted = 0
      AND ISNULL(si.IsPerforma, 0) = 0
      AND si.TransDate >= @startDate
      AND si.TransDate <  @endDate
      ${filter.wilayah ? "AND bp.NPWPName = @wilayah" : ""}
    GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui'), CAST(si.TransDate AS DATE)
    ORDER BY SalesDate DESC, Wilayah
  `);

  // mssql returns SQL `DATE` columns as JS Date objects, not strings — normalize
  // to an ISO date string so downstream code (sorting, grouping by key, display
  // formatting) can treat SalesDate as the plain string the type declares.
  return result.recordset.map((row) => ({
    ...row,
    SalesDate:
      row.SalesDate instanceof Date ? row.SalesDate.toISOString().slice(0, 10) : row.SalesDate,
  }));
}

export interface SalesTrendPoint {
  TransDate: string;
  NetSales: number;
  SOCount: number;
  DOCount: number;
  SICount: number;
}

// Per-day document counts for the trend chart. Deliberately not filtered by
// Wilayah — SO/DO don't carry BusinessPartner-derived Wilayah as cleanly as
// SalesInvoice does, and the trend is meant to read as one overall pulse.
export async function getSalesTrend(filter: DateRangeFilter): Promise<SalesTrendPoint[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("startDate", sql.Date, filter.startDate)
    .input("endDate", sql.Date, filter.endDate).query(`
      WITH Days AS (
          SELECT CAST(si.TransDate AS DATE) AS TransDate FROM SalesInvoice si
            WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0 AND si.TransDate >= @startDate AND si.TransDate < @endDate
          UNION
          SELECT CAST(so.TransDate AS DATE) FROM SalesOrder so
            WHERE so.IsDeleted = 0 AND so.TransDate >= @startDate AND so.TransDate < @endDate
          UNION
          SELECT CAST(do_.TransDate AS DATE) FROM DeliveryOrder do_
            WHERE do_.IsDeleted = 0 AND do_.TransDate >= @startDate AND do_.TransDate < @endDate
      )
      SELECT
          d.TransDate,
          ISNULL((SELECT SUM(si.Netto) FROM SalesInvoice si
                  WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
                    AND CAST(si.TransDate AS DATE) = d.TransDate), 0) AS NetSales,
          (SELECT COUNT(*) FROM SalesOrder so
             WHERE so.IsDeleted = 0 AND CAST(so.TransDate AS DATE) = d.TransDate) AS SOCount,
          (SELECT COUNT(*) FROM DeliveryOrder do_
             WHERE do_.IsDeleted = 0 AND CAST(do_.TransDate AS DATE) = d.TransDate) AS DOCount,
          (SELECT COUNT(*) FROM SalesInvoice si
             WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
               AND CAST(si.TransDate AS DATE) = d.TransDate) AS SICount
      FROM Days d
      ORDER BY d.TransDate ASC
    `);

  return result.recordset.map((row) => ({
    ...row,
    TransDate: row.TransDate instanceof Date ? row.TransDate.toISOString().slice(0, 10) : row.TransDate,
  }));
}
