import { startOfMonth, startOfYear, subMonths } from "date-fns";
import { getPool, sql } from "@/lib/db";
import { getBusinessDate } from "@/lib/business-date";

export interface SalesToday {
  NetSales: number;
  SOCount: number;
  DOCount: number;
  SICount: number;
}

export interface SalesMonthComparison {
  ThisMonth: number;
  LastMonth: number;
  PctChange: number | null;
}

export interface SalesYTD {
  NetSales: number;
  SOCount: number;
  DOCount: number;
  SICount: number;
  // Qty and average price are order-based (SalesOrderDetail), the same
  // source already used for the "Rata-rata Pesan" figure in Piutang —
  // SalesInvoiceDetail wasn't reachable to verify as an alternative source
  // at the time this was built, so this is ordered qty, not invoiced qty.
  TotalQty: number;
  TotalPayment: number;
  AvgPrice: number;
  UniqueMitraOrdering: number;
}

export interface SalesOverview {
  today: SalesToday;
  monthComparison: SalesMonthComparison;
  ytd: SalesYTD;
}

export async function getSalesOverview(): Promise<SalesOverview> {
  const pool = await getPool();
  const now = new Date();
  const businessToday = getBusinessDate(now);
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const yearStart = startOfYear(now);

  const [todayResult, monthResult, ytdResult] = await Promise.all([
    pool
      .request()
      .input("businessDate", sql.Date, businessToday)
      .query(`
        SELECT
            (SELECT ISNULL(SUM(Netto), 0) FROM SalesInvoice
              WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
                AND TransDate >= @businessDate AND TransDate < DATEADD(DAY, 1, @businessDate)) AS NetSales,
            (SELECT COUNT(*) FROM SalesOrder
              WHERE IsDeleted = 0
                AND TransDate >= @businessDate AND TransDate < DATEADD(DAY, 1, @businessDate)) AS SOCount,
            (SELECT COUNT(*) FROM DeliveryOrder
              WHERE IsDeleted = 0
                AND TransDate >= @businessDate AND TransDate < DATEADD(DAY, 1, @businessDate)) AS DOCount,
            (SELECT COUNT(*) FROM SalesInvoice
              WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
                AND TransDate >= @businessDate AND TransDate < DATEADD(DAY, 1, @businessDate)) AS SICount
      `),
    pool
      .request()
      .input("thisMonthStart", sql.Date, thisMonthStart)
      .input("lastMonthStart", sql.Date, lastMonthStart)
      .query(`
        SELECT
            ISNULL(SUM(CASE WHEN TransDate >= @thisMonthStart THEN Netto ELSE 0 END), 0) AS ThisMonth,
            ISNULL(SUM(CASE WHEN TransDate >= @lastMonthStart AND TransDate < @thisMonthStart THEN Netto ELSE 0 END), 0) AS LastMonth
        FROM SalesInvoice
        WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
          AND TransDate >= @lastMonthStart
      `),
    pool
      .request()
      .input("yearStart", sql.Date, yearStart)
      .query(`
        SELECT
            (SELECT ISNULL(SUM(Netto), 0) FROM SalesInvoice
              WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0 AND TransDate >= @yearStart) AS NetSales,
            (SELECT COUNT(*) FROM SalesOrder
              WHERE IsDeleted = 0 AND TransDate >= @yearStart) AS SOCount,
            (SELECT COUNT(*) FROM DeliveryOrder
              WHERE IsDeleted = 0 AND TransDate >= @yearStart) AS DOCount,
            (SELECT COUNT(*) FROM SalesInvoice
              WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0 AND TransDate >= @yearStart) AS SICount,
            (SELECT ISNULL(SUM(sod.Qty), 0) FROM SalesOrder so
              JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
              WHERE so.IsDeleted = 0 AND so.TransDate >= @yearStart) AS TotalQty,
            (SELECT ISNULL(SUM(Amount), 0) FROM SalesPayment
              WHERE IsDeleted = 0 AND TransDate >= @yearStart) AS TotalPayment,
            (SELECT COUNT(DISTINCT BusinessPartnerID) FROM SalesOrder
              WHERE IsDeleted = 0 AND TransDate >= @yearStart) AS UniqueMitraOrdering
      `),
  ]);

  const today = todayResult.recordset[0] as SalesToday;
  const month = monthResult.recordset[0] as { ThisMonth: number; LastMonth: number };
  const ytdRow = ytdResult.recordset[0] as Omit<SalesYTD, "AvgPrice">;

  return {
    today,
    monthComparison: {
      ThisMonth: month.ThisMonth,
      LastMonth: month.LastMonth,
      PctChange: month.LastMonth ? ((month.ThisMonth - month.LastMonth) / month.LastMonth) * 100 : null,
    },
    ytd: {
      ...ytdRow,
      AvgPrice: ytdRow.TotalQty ? ytdRow.NetSales / ytdRow.TotalQty : 0,
    },
  };
}
