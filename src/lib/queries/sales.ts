import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
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
  SOQty: number;
  DOCount: number;
  DOQty: number;
  SICount: number;
  SIQty: number;
}

// Per-day document counts AND quantities (kantong) for the trend chart.
// Deliberately not filtered by Wilayah — SO/DO don't carry
// BusinessPartner-derived Wilayah as cleanly as SalesInvoice does, and the
// trend is meant to read as one overall pulse.
//
// Previously a single query: a "Days" CTE (union of distinct days across the
// 3 tables) joined to 6 correlated subqueries per day — for a ~30-day filter
// that's ~180 independent scalar subquery scans. Measured at 14s even with a
// TransDate index in place. Rewritten as one grouped, set-based aggregation
// per source table (mirrors getSalesTrendMonthly's fix below), unioning the
// distinct day-keys from each result to reproduce the original "only days
// with at least one SI/SO/DO" behavior.
export async function getSalesTrend(filter: DateRangeFilter): Promise<SalesTrendPoint[]> {
  const pool = await getPool();
  const withParams = () =>
    pool.request().input("startDate", sql.Date, filter.startDate).input("endDate", sql.Date, filter.endDate);

  const [siResult, siQtyResult, soHeaderResult, soDetailResult, doHeaderResult, doDetailResult] = await Promise.all([
    withParams().query(`
      SELECT CAST(si.TransDate AS DATE) AS TransDate, SUM(si.Netto) AS NetSales, COUNT(*) AS SICount
      FROM SalesInvoice si
      WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
        AND si.TransDate >= @startDate AND si.TransDate < @endDate
      GROUP BY CAST(si.TransDate AS DATE)
    `),
    // Separate join-grouped pass for SIQty — folding it into the query above
    // would fan out si.Netto across detail rows and overcount NetSales.
    withParams().query(`
      SELECT CAST(si.TransDate AS DATE) AS TransDate, SUM(sid.Qty) AS SIQty
      FROM SalesInvoice si
      JOIN SalesInvoiceDetail sid ON sid.SalesInvoiceID = si.SalesInvoiceID
      WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
        AND si.TransDate >= @startDate AND si.TransDate < @endDate
      GROUP BY CAST(si.TransDate AS DATE)
    `),
    withParams().query(`
      SELECT CAST(so.TransDate AS DATE) AS TransDate, COUNT(*) AS SOCount
      FROM SalesOrder so
      WHERE so.IsDeleted = 0 AND so.TransDate >= @startDate AND so.TransDate < @endDate
      GROUP BY CAST(so.TransDate AS DATE)
    `),
    withParams().query(`
      SELECT CAST(so.TransDate AS DATE) AS TransDate, SUM(sod.Qty) AS SOQty
      FROM SalesOrder so
      JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
      WHERE so.IsDeleted = 0 AND so.TransDate >= @startDate AND so.TransDate < @endDate
      GROUP BY CAST(so.TransDate AS DATE)
    `),
    withParams().query(`
      SELECT CAST(do_.TransDate AS DATE) AS TransDate, COUNT(*) AS DOCount
      FROM DeliveryOrder do_
      WHERE do_.IsDeleted = 0 AND do_.TransDate >= @startDate AND do_.TransDate < @endDate
      GROUP BY CAST(do_.TransDate AS DATE)
    `),
    // DeliveryOrderDetail.Qty is the qty on the *original order line*, which
    // can be much larger than any single delivery when an order is
    // fulfilled across several DOs (verified against live data — summing
    // Qty inflated a day's total by ~5x). Delivered is the actual quantity
    // moved on this specific DO, same column already used for "Sisa Belum
    // Dikirim" in the Pengiriman module.
    withParams().query(`
      SELECT CAST(do_.TransDate AS DATE) AS TransDate, SUM(dod.Delivered) AS DOQty
      FROM DeliveryOrder do_
      JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
      WHERE do_.IsDeleted = 0 AND do_.TransDate >= @startDate AND do_.TransDate < @endDate
      GROUP BY CAST(do_.TransDate AS DATE)
    `),
  ]);

  const dateKey = (d: Date) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
  const byDate = <T>(recordset: { TransDate: Date }[], pick: (row: unknown) => T): Map<string, T> =>
    new Map(recordset.map((row) => [dateKey(row.TransDate), pick(row)]));

  const netSalesByDate = byDate(siResult.recordset, (r) => (r as { NetSales: number }).NetSales);
  const siCountByDate = byDate(siResult.recordset, (r) => (r as { SICount: number }).SICount);
  const siQtyByDate = byDate(siQtyResult.recordset, (r) => (r as { SIQty: number }).SIQty);
  const soCountByDate = byDate(soHeaderResult.recordset, (r) => (r as { SOCount: number }).SOCount);
  const soQtyByDate = byDate(soDetailResult.recordset, (r) => (r as { SOQty: number }).SOQty);
  const doCountByDate = byDate(doHeaderResult.recordset, (r) => (r as { DOCount: number }).DOCount);
  const doQtyByDate = byDate(doDetailResult.recordset, (r) => (r as { DOQty: number }).DOQty);

  const allDates = new Set<string>([
    ...netSalesByDate.keys(),
    ...soCountByDate.keys(),
    ...doCountByDate.keys(),
  ]);

  return [...allDates].sort().map((TransDate) => ({
    TransDate,
    NetSales: netSalesByDate.get(TransDate) ?? 0,
    SOCount: soCountByDate.get(TransDate) ?? 0,
    SOQty: soQtyByDate.get(TransDate) ?? 0,
    DOCount: doCountByDate.get(TransDate) ?? 0,
    DOQty: doQtyByDate.get(TransDate) ?? 0,
    SICount: siCountByDate.get(TransDate) ?? 0,
    SIQty: siQtyByDate.get(TransDate) ?? 0,
  }));
}

export interface SalesTrendMonthPoint {
  Month: string; // "YYYY-MM"
  NetSales: number;
  SOCount: number;
  SOQty: number;
  DOCount: number;
  DOQty: number;
  SICount: number;
  SIQty: number;
}

// Same per-period shape as getSalesTrend(), aggregated by month instead of
// by day, for the last 12 months (11 months ago through the current
// business month, i.e. this month back to the same month last year).
//
// Previously built as 12 UNION ALL'd blocks x 6 correlated subqueries each
// (72 scalar subquery scans per call) — measured live at 40s+ even with a
// TransDate index in place, since the optimizer never gets to do one
// sequential range scan per table, just 72 independent seeks. Rewritten as
// one grouped, set-based aggregation per source table (5 queries total,
// each a single pass over the 12-month range), then merged into the
// 12-month array in JS. Month boundaries still come from monthBoundary()'s
// UTC-safe arithmetic (see sales-overview.ts for why raw date-fns/local-time
// boundaries are unsafe once sent to SQL Server as DATE params).
// `yearsAgo` shifts the whole 12-month window back by that many years (e.g.
// yearsAgo=1 returns the same month-of-year through 12 months earlier,
// exactly one year before the default yearsAgo=0 window) — used to render a
// "tahun lalu" version of this same chart alongside the current one.
export async function getSalesTrendMonthly(yearsAgo: number = 0): Promise<SalesTrendMonthPoint[]> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const monthOffset = -12 * yearsAgo;
  const rangeStart = monthBoundary(businessToday, monthOffset - 11);
  const rangeEnd = monthBoundary(businessToday, monthOffset + 1);

  const monthBucket = (column: string) => `DATEFROMPARTS(YEAR(${column}), MONTH(${column}), 1)`;

  const withParams = () =>
    pool.request().input("rangeStart", sql.Date, rangeStart).input("rangeEnd", sql.Date, rangeEnd);

  const [siResult, soHeaderResult, soDetailResult, doHeaderResult, doDetailResult] = await Promise.all([
    withParams().query(`
      SELECT ${monthBucket("si.TransDate")} AS MonthStart,
             SUM(si.Netto) AS NetSales, COUNT(*) AS SICount
      FROM SalesInvoice si
      WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
        AND si.TransDate >= @rangeStart AND si.TransDate < @rangeEnd
      GROUP BY ${monthBucket("si.TransDate")}
    `),
    withParams().query(`
      SELECT ${monthBucket("so.TransDate")} AS MonthStart, COUNT(*) AS SOCount
      FROM SalesOrder so
      WHERE so.IsDeleted = 0 AND so.TransDate >= @rangeStart AND so.TransDate < @rangeEnd
      GROUP BY ${monthBucket("so.TransDate")}
    `),
    withParams().query(`
      SELECT ${monthBucket("so.TransDate")} AS MonthStart, SUM(sod.Qty) AS SOQty
      FROM SalesOrder so
      JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
      WHERE so.IsDeleted = 0 AND so.TransDate >= @rangeStart AND so.TransDate < @rangeEnd
      GROUP BY ${monthBucket("so.TransDate")}
    `),
    withParams().query(`
      SELECT ${monthBucket("do_.TransDate")} AS MonthStart, COUNT(*) AS DOCount
      FROM DeliveryOrder do_
      WHERE do_.IsDeleted = 0 AND do_.TransDate >= @rangeStart AND do_.TransDate < @rangeEnd
      GROUP BY ${monthBucket("do_.TransDate")}
    `),
    withParams().query(`
      SELECT ${monthBucket("do_.TransDate")} AS MonthStart, SUM(dod.Delivered) AS DOQty
      FROM DeliveryOrder do_
      JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
      WHERE do_.IsDeleted = 0 AND do_.TransDate >= @rangeStart AND do_.TransDate < @rangeEnd
      GROUP BY ${monthBucket("do_.TransDate")}
    `),
    // SIQty (kantong invoiced) needs its own join-grouped pass — folding it
    // into the siResult query above would fan out si.Netto across detail
    // rows and overcount NetSales.
  ]);
  const siQtyResult = await withParams().query(`
      SELECT ${monthBucket("si.TransDate")} AS MonthStart, SUM(sid.Qty) AS SIQty
      FROM SalesInvoice si
      JOIN SalesInvoiceDetail sid ON sid.SalesInvoiceID = si.SalesInvoiceID
      WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
        AND si.TransDate >= @rangeStart AND si.TransDate < @rangeEnd
      GROUP BY ${monthBucket("si.TransDate")}
    `);

  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const byMonth = <T>(recordset: { MonthStart: Date }[], pick: (row: unknown) => T): Map<string, T> =>
    new Map(recordset.map((row) => [monthKey(row.MonthStart), pick(row)]));

  const netSalesByMonth = byMonth(siResult.recordset, (r) => (r as { NetSales: number }).NetSales);
  const siCountByMonth = byMonth(siResult.recordset, (r) => (r as { SICount: number }).SICount);
  const soCountByMonth = byMonth(soHeaderResult.recordset, (r) => (r as { SOCount: number }).SOCount);
  const soQtyByMonth = byMonth(soDetailResult.recordset, (r) => (r as { SOQty: number }).SOQty);
  const doCountByMonth = byMonth(doHeaderResult.recordset, (r) => (r as { DOCount: number }).DOCount);
  const doQtyByMonth = byMonth(doDetailResult.recordset, (r) => (r as { DOQty: number }).DOQty);
  const siQtyByMonth = byMonth(siQtyResult.recordset, (r) => (r as { SIQty: number }).SIQty);

  const points: SalesTrendMonthPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const monthStart = monthBoundary(businessToday, monthOffset - i);
    const key = monthKey(monthStart);
    points.push({
      Month: key,
      NetSales: netSalesByMonth.get(key) ?? 0,
      SOCount: soCountByMonth.get(key) ?? 0,
      SOQty: soQtyByMonth.get(key) ?? 0,
      DOCount: doCountByMonth.get(key) ?? 0,
      DOQty: doQtyByMonth.get(key) ?? 0,
      SICount: siCountByMonth.get(key) ?? 0,
      SIQty: siQtyByMonth.get(key) ?? 0,
    });
  }
  return points;
}
