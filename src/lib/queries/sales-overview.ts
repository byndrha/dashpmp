import { startOfMonth, startOfYear, subMonths } from "date-fns";
import { getPool, sql } from "@/lib/db";
import { getBusinessDate } from "@/lib/business-date";

// Kemasan classification verified against live item names in
// SalesInvoiceDetail: "Es Tube Jual 5 KG" / "Es Tube Bonus 5 KG" / "Es Tube
// 5 KG" are the only 5KG-labeled items; everything else ("Es Tube", "Es Tube
// Jual", "Es Tube Bonus", "Es Contoh", "Es Tube Afiliasi") is 10KG.
const KEMASAN_CASE = `CASE WHEN sid.Name LIKE '%5 KG%' THEN '5KG' ELSE '10KG' END`;

export interface KemasanQty {
  Qty10KG: number;
  Qty5KG: number;
}

export interface SalesToday extends KemasanQty {
  NetSales: number;
  SOCount: number;
  DOCount: number;
  SICount: number;
  AvgPrice: number;
}

export interface SalesMonthComparison {
  ThisMonth: number;
  LastMonth: number;
  PctChange: number | null;
}

export interface SalesYTD extends KemasanQty {
  NetSales: number;
  SOCount: number;
  DOCount: number;
  SICount: number;
  TotalPayment: number;
  AvgPrice: number;
  UniqueMitraOrdering: number;
}

export interface SalesOverview {
  today: SalesToday;
  monthComparison: SalesMonthComparison;
  ytd: SalesYTD;
}

function qtyByKemasan(rows: { Kemasan: string; Qty: number }[]): KemasanQty {
  return {
    Qty10KG: rows.find((r) => r.Kemasan === "10KG")?.Qty ?? 0,
    Qty5KG: rows.find((r) => r.Kemasan === "5KG")?.Qty ?? 0,
  };
}

// Reusable single-day snapshot — powers both the "Hari Ini" card's initial
// render and the prev/next day navigation on that same card.
export async function getSalesForDay(date: Date): Promise<SalesToday> {
  const pool = await getPool();
  const [dayResult, dayQtyResult] = await Promise.all([
    pool
      .request()
      .input("day", sql.Date, date)
      .query(`
        SELECT
            (SELECT ISNULL(SUM(Netto), 0) FROM SalesInvoice
              WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
                AND TransDate >= @day AND TransDate < DATEADD(DAY, 1, @day)) AS NetSales,
            (SELECT COUNT(*) FROM SalesOrder
              WHERE IsDeleted = 0
                AND TransDate >= @day AND TransDate < DATEADD(DAY, 1, @day)) AS SOCount,
            (SELECT COUNT(*) FROM DeliveryOrder
              WHERE IsDeleted = 0
                AND TransDate >= @day AND TransDate < DATEADD(DAY, 1, @day)) AS DOCount,
            (SELECT COUNT(*) FROM SalesInvoice
              WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
                AND TransDate >= @day AND TransDate < DATEADD(DAY, 1, @day)) AS SICount
      `),
    pool
      .request()
      .input("day", sql.Date, date)
      .query(`
        SELECT ${KEMASAN_CASE} AS Kemasan, SUM(sid.Qty) AS Qty
        FROM SalesInvoiceDetail sid
        JOIN SalesInvoice si ON si.SalesInvoiceID = sid.SalesInvoiceID
        WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
          AND si.TransDate >= @day AND si.TransDate < DATEADD(DAY, 1, @day)
        GROUP BY ${KEMASAN_CASE}
      `),
  ]);

  const day = dayResult.recordset[0] as Omit<SalesToday, "AvgPrice" | "Qty10KG" | "Qty5KG">;
  const kemasan = qtyByKemasan(dayQtyResult.recordset);
  const totalQty = kemasan.Qty10KG + kemasan.Qty5KG;

  return {
    ...day,
    ...kemasan,
    AvgPrice: totalQty ? day.NetSales / totalQty : 0,
  };
}

export async function getSalesOverview(): Promise<SalesOverview> {
  const pool = await getPool();
  const now = new Date();
  const businessToday = getBusinessDate(now);
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfMonth(subMonths(now, 1));
  const yearStart = startOfYear(now);

  const [today, monthResult, ytdResult, ytdQtyResult] = await Promise.all([
    getSalesForDay(businessToday),
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
            (SELECT ISNULL(SUM(Amount), 0) FROM SalesPayment
              WHERE IsDeleted = 0 AND TransDate >= @yearStart) AS TotalPayment,
            (SELECT COUNT(DISTINCT BusinessPartnerID) FROM SalesOrder
              WHERE IsDeleted = 0 AND TransDate >= @yearStart) AS UniqueMitraOrdering
      `),
    pool
      .request()
      .input("yearStart", sql.Date, yearStart)
      .query(`
        SELECT ${KEMASAN_CASE} AS Kemasan, SUM(sid.Qty) AS Qty
        FROM SalesInvoiceDetail sid
        JOIN SalesInvoice si ON si.SalesInvoiceID = sid.SalesInvoiceID
        WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
          AND si.TransDate >= @yearStart
        GROUP BY ${KEMASAN_CASE}
      `),
  ]);

  const month = monthResult.recordset[0] as { ThisMonth: number; LastMonth: number };
  const ytdRow = ytdResult.recordset[0] as Omit<SalesYTD, "AvgPrice" | "Qty10KG" | "Qty5KG">;
  const ytdKemasan = qtyByKemasan(ytdQtyResult.recordset);
  const ytdTotalQty = ytdKemasan.Qty10KG + ytdKemasan.Qty5KG;

  return {
    today,
    monthComparison: {
      ThisMonth: month.ThisMonth,
      LastMonth: month.LastMonth,
      PctChange: month.LastMonth ? ((month.ThisMonth - month.LastMonth) / month.LastMonth) * 100 : null,
    },
    ytd: {
      ...ytdRow,
      ...ytdKemasan,
      AvgPrice: ytdTotalQty ? ytdRow.NetSales / ytdTotalQty : 0,
    },
  };
}
