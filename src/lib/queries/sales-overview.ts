import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";

// Kemasan classification verified against live item names in both
// SalesInvoiceDetail.Name and DeliveryOrderDetail.Name: "Es Tube Jual 5 KG" /
// "Es Tube Bonus 5 KG" / "Es Tube 5 KG" are the only 5KG-labeled items;
// everything else ("Es Tube", "Es Tube Jual", "Es Tube Bonus", "Es Contoh",
// "Es Tube Afiliasi") is 10KG.
function kemasanCase(column: string): string {
  return `CASE WHEN ${column} LIKE '%5 KG%' THEN '5KG' ELSE '10KG' END`;
}
const KEMASAN_CASE = kemasanCase("sid.Name");

export interface KemasanQty {
  Qty10KG: number;
  Qty5KG: number;
}

export interface SalesToday extends KemasanQty {
  NetSales: number;
  SOCount: number;
  DOCount: number;
  SICount: number;
  SPCount: number;
  AvgPrice: number;
  LastMonthNetSales: number;
  GrowthPercent: number | null;
}

export interface SalesPeriodStat {
  NetSales: number;
  DOQty: number;
}

export interface SalesComparison {
  previousLabel: string;
  current: SalesPeriodStat;
  previous: SalesPeriodStat;
  NominalPctChange: number | null;
  QtyPctChange: number | null;
}

export interface SalesYTD extends KemasanQty {
  NetSales: number;
  SOCount: number;
  DOCount: number;
  SICount: number;
  SPCount: number;
  TotalPayment: number;
  AvgPrice: number;
  UniqueMitraOrdering: number;
}

export interface SalesAverages {
  AvgKantongPerHariThisMonth: number;
  AvgKantongPerHariLastMonth: number;
  AvgKantongPerHariPctChange: number | null;
  AvgHarga10KGThisMonth: number;
  AvgHarga10KGLastMonth: number;
  AvgHarga10KGPctChange: number | null;
  AvgHarga5KGThisMonth: number;
  AvgHarga5KGLastMonth: number;
  AvgHarga5KGPctChange: number | null;
}

export interface SalesOverview {
  today: SalesToday;
  comparisons: SalesComparison[];
  averages: SalesAverages;
  ytd: SalesYTD;
}

export interface SalesDayPoint {
  NetSales: number;
  DOQty: number;
}

export interface SalesDayComparison {
  label: string;
  current: SalesDayPoint;
  previous: SalesDayPoint | null;
  NominalPctChange: number | null;
  QtyPctChange: number | null;
}

// Same calendar day-of-month `monthsBack` months earlier, clamped to the
// last day of the target month when it doesn't have that many days. Plain
// UTC arithmetic (not date-fns) to stay consistent with the rest of this
// file's date handling — see monthBoundary()'s comment in business-date.ts
// for why local-time Date construction is unsafe here. Shared by
// getSalesForDay's "last month" lookback and getSalesDayComparison's
// "Bulan Lalu"/"Tahun Lalu" points.
function sameDayMonthsBack(date: Date, monthsBack: number): Date {
  const targetYear = date.getUTCFullYear();
  const targetMonthIndex = date.getUTCMonth() - monthsBack;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonthIndex, Math.min(date.getUTCDate(), daysInTargetMonth)));
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
  // Same calendar day-of-month, one month back — see sameDayMonthsBack()'s
  // comment for why the clamp matters and why plain UTC arithmetic is used.
  const lastMonthDay = sameDayMonthsBack(date, 1);

  const [dayResult, doQtyResult, siQtyResult, lastMonthResult] = await Promise.all([
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
                AND TransDate >= @day AND TransDate < DATEADD(DAY, 1, @day)) AS SICount,
            (SELECT COUNT(*) FROM SalesPayment
              WHERE IsDeleted = 0
                AND TransDate >= @day AND TransDate < DATEADD(DAY, 1, @day)) AS SPCount
      `),
    // "Kantong Terkirim" must reflect what actually left the warehouse (DO),
    // not what was invoiced (SI) — those can differ on any given day.
    // Uses DeliveryOrderDetail.Delivered, not .Qty (the original-order-line
    // quantity) — see getSalesTrend() in sales.ts for why .Qty inflates totals.
    pool
      .request()
      .input("day", sql.Date, date)
      .query(`
        SELECT ${kemasanCase("dod.Name")} AS Kemasan, SUM(dod.Delivered) AS Qty
        FROM DeliveryOrderDetail dod
        JOIN DeliveryOrder do_ ON do_.DeliveryOrderID = dod.DeliveryOrderID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @day AND do_.TransDate < DATEADD(DAY, 1, @day)
        GROUP BY ${kemasanCase("dod.Name")}
      `),
    // Invoiced qty, kept separate from the DO-delivered qty above — Harga
    // rata-rata is revenue per kantong *invoiced*, so its denominator must
    // match the NetSales numerator's source (SI), not the delivered qty.
    pool
      .request()
      .input("day", sql.Date, date)
      .query(`
        SELECT ISNULL(SUM(sid.Qty), 0) AS Qty
        FROM SalesInvoiceDetail sid
        JOIN SalesInvoice si ON si.SalesInvoiceID = sid.SalesInvoiceID
        WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
          AND si.TransDate >= @day AND si.TransDate < DATEADD(DAY, 1, @day)
      `),
    // Same calendar date one month back, for the day-over-day-last-month growth badge.
    pool
      .request()
      .input("day", sql.Date, lastMonthDay)
      .query(`
        SELECT ISNULL(SUM(Netto), 0) AS NetSales FROM SalesInvoice
          WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
            AND TransDate >= @day AND TransDate < DATEADD(DAY, 1, @day)
      `),
  ]);

  const day = dayResult.recordset[0] as Omit<
    SalesToday,
    "AvgPrice" | "Qty10KG" | "Qty5KG" | "LastMonthNetSales" | "GrowthPercent"
  >;
  const doKemasan = qtyByKemasan(doQtyResult.recordset);
  const siQty = siQtyResult.recordset[0].Qty as number;
  const lastMonthNetSales = lastMonthResult.recordset[0].NetSales as number;

  return {
    ...day,
    ...doKemasan,
    AvgPrice: siQty ? day.NetSales / siQty : 0,
    LastMonthNetSales: lastMonthNetSales,
    GrowthPercent: lastMonthNetSales
      ? ((day.NetSales - lastMonthNetSales) / lastMonthNetSales) * 100
      : null,
  };
}

function pctChange(current: number, previous: number): number | null {
  return previous ? ((current - previous) / previous) * 100 : null;
}

// "YYYY/MM" for the comparison period labels — plain UTC arithmetic to
// match how these Date objects were built (monthBoundary()), not
// Intl/date-fns local-time formatting.
function yearMonthLabel(date: Date): string {
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getSalesOverview(): Promise<SalesOverview> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  // All month/year boundaries below are built with monthBoundary()'s plain
  // UTC arithmetic, anchored on the WIB business date — NOT date-fns'
  // startOfMonth/subMonths/startOfYear on a raw `new Date()`. Those construct
  // *local* midnight, and once sent to SQL Server as a `DATE` parameter
  // (which mssql serializes via UTC components), a host running in a
  // positive-UTC-offset timezone silently shifts the boundary back one
  // calendar day — verified live: "this month" was leaking in the entirety
  // of the previous day's revenue this way.
  const thisMonthStart = monthBoundary(businessToday);
  const lastMonthStart = monthBoundary(businessToday, -1);
  const lastYearMonthStart = monthBoundary(businessToday, -12);
  const lastYearMonthEnd = monthBoundary(businessToday, -11);
  const twoYearsAgoMonthStart = monthBoundary(businessToday, -24);
  const twoYearsAgoMonthEnd = monthBoundary(businessToday, -23);
  const yearStart = new Date(Date.UTC(businessToday.getUTCFullYear(), 0, 1));

  const [today, netResult, qtyResult, priceResult, ytdResult, ytdQtyResult] = await Promise.all([
    getSalesForDay(businessToday),
    pool
      .request()
      .input("thisMonthStart", sql.Date, thisMonthStart)
      .input("lastMonthStart", sql.Date, lastMonthStart)
      .input("lastYearMonthStart", sql.Date, lastYearMonthStart)
      .input("lastYearMonthEnd", sql.Date, lastYearMonthEnd)
      .input("twoYearsAgoMonthStart", sql.Date, twoYearsAgoMonthStart)
      .input("twoYearsAgoMonthEnd", sql.Date, twoYearsAgoMonthEnd)
      .query(`
        SELECT
            ISNULL(SUM(CASE WHEN TransDate >= @thisMonthStart THEN Netto ELSE 0 END), 0) AS ThisMonthNet,
            ISNULL(SUM(CASE WHEN TransDate >= @lastMonthStart AND TransDate < @thisMonthStart THEN Netto ELSE 0 END), 0) AS LastMonthNet,
            ISNULL(SUM(CASE WHEN TransDate >= @lastYearMonthStart AND TransDate < @lastYearMonthEnd THEN Netto ELSE 0 END), 0) AS LastYearMonthNet,
            ISNULL(SUM(CASE WHEN TransDate >= @twoYearsAgoMonthStart AND TransDate < @twoYearsAgoMonthEnd THEN Netto ELSE 0 END), 0) AS TwoYearsAgoMonthNet
        FROM SalesInvoice
        WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
          AND TransDate >= @twoYearsAgoMonthStart
      `),
    // DOQty uses DeliveryOrderDetail.Delivered, not .Qty (the original-order-line
    // quantity) — see getSalesTrend() in sales.ts for why .Qty inflates totals.
    pool
      .request()
      .input("thisMonthStart", sql.Date, thisMonthStart)
      .input("lastMonthStart", sql.Date, lastMonthStart)
      .input("lastYearMonthStart", sql.Date, lastYearMonthStart)
      .input("lastYearMonthEnd", sql.Date, lastYearMonthEnd)
      .input("twoYearsAgoMonthStart", sql.Date, twoYearsAgoMonthStart)
      .input("twoYearsAgoMonthEnd", sql.Date, twoYearsAgoMonthEnd)
      .query(`
        SELECT
            ISNULL(SUM(CASE WHEN do_.TransDate >= @thisMonthStart THEN dod.Delivered ELSE 0 END), 0) AS ThisMonthQty,
            ISNULL(SUM(CASE WHEN do_.TransDate >= @lastMonthStart AND do_.TransDate < @thisMonthStart THEN dod.Delivered ELSE 0 END), 0) AS LastMonthQty,
            ISNULL(SUM(CASE WHEN do_.TransDate >= @lastYearMonthStart AND do_.TransDate < @lastYearMonthEnd THEN dod.Delivered ELSE 0 END), 0) AS LastYearMonthQty,
            ISNULL(SUM(CASE WHEN do_.TransDate >= @twoYearsAgoMonthStart AND do_.TransDate < @twoYearsAgoMonthEnd THEN dod.Delivered ELSE 0 END), 0) AS TwoYearsAgoMonthQty
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @twoYearsAgoMonthStart
      `),
    // Average selling price per kantong, split by kemasan — sid.Amount is
    // the per-line revenue field that actually rolls up to SalesInvoice.Netto
    // (verified live: SUM(sid.Amount) over a period matched
    // SUM(SalesInvoice.Netto) exactly; sid.Netto does not — it's some other,
    // much smaller figure, not a per-line revenue rollup).
    pool
      .request()
      .input("thisMonthStart", sql.Date, thisMonthStart)
      .input("lastMonthStart", sql.Date, lastMonthStart)
      .query(`
        SELECT
            ${kemasanCase("sid.Name")} AS Kemasan,
            ISNULL(SUM(CASE WHEN si.TransDate >= @thisMonthStart THEN sid.Amount ELSE 0 END), 0) AS ThisMonthAmount,
            ISNULL(SUM(CASE WHEN si.TransDate >= @thisMonthStart THEN sid.Qty ELSE 0 END), 0) AS ThisMonthQty,
            ISNULL(SUM(CASE WHEN si.TransDate >= @lastMonthStart AND si.TransDate < @thisMonthStart THEN sid.Amount ELSE 0 END), 0) AS LastMonthAmount,
            ISNULL(SUM(CASE WHEN si.TransDate >= @lastMonthStart AND si.TransDate < @thisMonthStart THEN sid.Qty ELSE 0 END), 0) AS LastMonthQty
        FROM SalesInvoiceDetail sid
        JOIN SalesInvoice si ON si.SalesInvoiceID = sid.SalesInvoiceID
        WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma,0) = 0
          AND si.TransDate >= @lastMonthStart
        GROUP BY ${kemasanCase("sid.Name")}
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
            (SELECT COUNT(*) FROM SalesPayment
              WHERE IsDeleted = 0 AND TransDate >= @yearStart) AS SPCount,
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

  const net = netResult.recordset[0] as {
    ThisMonthNet: number;
    LastMonthNet: number;
    LastYearMonthNet: number;
    TwoYearsAgoMonthNet: number;
  };
  const qty = qtyResult.recordset[0] as {
    ThisMonthQty: number;
    LastMonthQty: number;
    LastYearMonthQty: number;
    TwoYearsAgoMonthQty: number;
  };
  const priceRows = priceResult.recordset as {
    Kemasan: string;
    ThisMonthAmount: number;
    ThisMonthQty: number;
    LastMonthAmount: number;
    LastMonthQty: number;
  }[];
  const price10KG = priceRows.find((r) => r.Kemasan === "10KG");
  const price5KG = priceRows.find((r) => r.Kemasan === "5KG");
  const avgHarga10ThisMonth = price10KG?.ThisMonthQty ? price10KG.ThisMonthAmount / price10KG.ThisMonthQty : 0;
  const avgHarga10LastMonth = price10KG?.LastMonthQty ? price10KG.LastMonthAmount / price10KG.LastMonthQty : 0;
  const avgHarga5ThisMonth = price5KG?.ThisMonthQty ? price5KG.ThisMonthAmount / price5KG.ThisMonthQty : 0;
  const avgHarga5LastMonth = price5KG?.LastMonthQty ? price5KG.LastMonthAmount / price5KG.LastMonthQty : 0;

  // "Rata-rata kantong terkirim" = average DO qty per day — this-month is
  // month-to-date (total so far / days elapsed), last-month is the full
  // month (total / days in that month), mirroring how ThisMonth/LastMonth
  // are already treated as partial-vs-full elsewhere in this file.
  const currentDay = businessToday.getUTCDate();
  // Day 0 of thisMonthStart's month === the last day of lastMonthStart's
  // month. Plain UTC arithmetic, not date-fns' getDaysInMonth() — that reads
  // the Date's *local* year/month, which is unsafe on a host running behind
  // UTC (see monthBoundary()'s comment in business-date.ts for the same
  // class of bug this file has already hit with SQL DATE parameters).
  const daysInLastMonth = new Date(Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth(), 0)).getUTCDate();
  const avgKantongThisMonth = currentDay ? qty.ThisMonthQty / currentDay : 0;
  const avgKantongLastMonth = daysInLastMonth ? qty.LastMonthQty / daysInLastMonth : 0;

  const averages: SalesAverages = {
    AvgKantongPerHariThisMonth: avgKantongThisMonth,
    AvgKantongPerHariLastMonth: avgKantongLastMonth,
    AvgKantongPerHariPctChange: pctChange(avgKantongThisMonth, avgKantongLastMonth),
    AvgHarga10KGThisMonth: avgHarga10ThisMonth,
    AvgHarga10KGLastMonth: avgHarga10LastMonth,
    AvgHarga10KGPctChange: pctChange(avgHarga10ThisMonth, avgHarga10LastMonth),
    AvgHarga5KGThisMonth: avgHarga5ThisMonth,
    AvgHarga5KGLastMonth: avgHarga5LastMonth,
    AvgHarga5KGPctChange: pctChange(avgHarga5ThisMonth, avgHarga5LastMonth),
  };

  const ytdRow = ytdResult.recordset[0] as Omit<SalesYTD, "AvgPrice" | "Qty10KG" | "Qty5KG">;
  const ytdKemasan = qtyByKemasan(ytdQtyResult.recordset);
  const ytdTotalQty = ytdKemasan.Qty10KG + ytdKemasan.Qty5KG;

  const thisMonth: SalesPeriodStat = { NetSales: net.ThisMonthNet, DOQty: qty.ThisMonthQty };
  const buildComparison = (previousLabel: string, previous: SalesPeriodStat): SalesComparison => ({
    previousLabel,
    current: thisMonth,
    previous,
    NominalPctChange: pctChange(thisMonth.NetSales, previous.NetSales),
    QtyPctChange: pctChange(thisMonth.DOQty, previous.DOQty),
  });

  return {
    today,
    comparisons: [
      buildComparison(yearMonthLabel(lastMonthStart), { NetSales: net.LastMonthNet, DOQty: qty.LastMonthQty }),
      buildComparison(yearMonthLabel(lastYearMonthStart), {
        NetSales: net.LastYearMonthNet,
        DOQty: qty.LastYearMonthQty,
      }),
      buildComparison(yearMonthLabel(twoYearsAgoMonthStart), {
        NetSales: net.TwoYearsAgoMonthNet,
        DOQty: qty.TwoYearsAgoMonthQty,
      }),
    ],
    averages,
    ytd: {
      ...ytdRow,
      ...ytdKemasan,
      AvgPrice: ytdTotalQty ? ytdRow.NetSales / ytdTotalQty : 0,
    },
  };
}

// Day-level comparison for Beranda's "Perbandingan Penjualan" panel — distinct
// from getSalesOverview()'s month-level comparisons array. `today` is passed
// in (from a getSalesForDay() call the page already made) rather than
// re-queried here.
export async function getSalesDayComparison(today: SalesToday, businessToday: Date): Promise<SalesDayComparison[]> {
  const pool = await getPool();

  const kemarin = new Date(
    Date.UTC(businessToday.getUTCFullYear(), businessToday.getUTCMonth(), businessToday.getUTCDate() - 1)
  );
  const pekanLalu = new Date(
    Date.UTC(businessToday.getUTCFullYear(), businessToday.getUTCMonth(), businessToday.getUTCDate() - 7)
  );
  // "Pekan Lalu" is deliberately scoped to the current calendar month — if
  // H-7 lands in the previous month, that comparison point is left out
  // (previous: null) rather than silently comparing across a month boundary,
  // per explicit product decision.
  const pekanLaluAvailable =
    pekanLalu.getUTCFullYear() === businessToday.getUTCFullYear() &&
    pekanLalu.getUTCMonth() === businessToday.getUTCMonth();
  const bulanLalu = sameDayMonthsBack(businessToday, 1);
  const tahunLalu = sameDayMonthsBack(businessToday, 12);

  // Lower-bounded by @tahunLalu (the earliest of the four dates) so SQL
  // Server can prune the scan, mirroring getSalesOverview()'s
  // twoYearsAgoMonthStart bound.
  const [netResult, qtyResult] = await Promise.all([
    pool
      .request()
      .input("kemarin", sql.Date, kemarin)
      .input("pekanLalu", sql.Date, pekanLalu)
      .input("bulanLalu", sql.Date, bulanLalu)
      .input("tahunLalu", sql.Date, tahunLalu)
      .query(`
        SELECT
            ISNULL(SUM(CASE WHEN TransDate >= @kemarin AND TransDate < DATEADD(DAY, 1, @kemarin) THEN Netto ELSE 0 END), 0) AS KemarinNet,
            ISNULL(SUM(CASE WHEN TransDate >= @pekanLalu AND TransDate < DATEADD(DAY, 1, @pekanLalu) THEN Netto ELSE 0 END), 0) AS PekanLaluNet,
            ISNULL(SUM(CASE WHEN TransDate >= @bulanLalu AND TransDate < DATEADD(DAY, 1, @bulanLalu) THEN Netto ELSE 0 END), 0) AS BulanLaluNet,
            ISNULL(SUM(CASE WHEN TransDate >= @tahunLalu AND TransDate < DATEADD(DAY, 1, @tahunLalu) THEN Netto ELSE 0 END), 0) AS TahunLaluNet
        FROM SalesInvoice
        WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
          AND TransDate >= @tahunLalu
      `),
    // DOQty uses DeliveryOrderDetail.Delivered, not .Qty — see getSalesTrend()
    // in sales.ts for why .Qty inflates totals.
    pool
      .request()
      .input("kemarin", sql.Date, kemarin)
      .input("pekanLalu", sql.Date, pekanLalu)
      .input("bulanLalu", sql.Date, bulanLalu)
      .input("tahunLalu", sql.Date, tahunLalu)
      .query(`
        SELECT
            ISNULL(SUM(CASE WHEN do_.TransDate >= @kemarin AND do_.TransDate < DATEADD(DAY, 1, @kemarin) THEN dod.Delivered ELSE 0 END), 0) AS KemarinQty,
            ISNULL(SUM(CASE WHEN do_.TransDate >= @pekanLalu AND do_.TransDate < DATEADD(DAY, 1, @pekanLalu) THEN dod.Delivered ELSE 0 END), 0) AS PekanLaluQty,
            ISNULL(SUM(CASE WHEN do_.TransDate >= @bulanLalu AND do_.TransDate < DATEADD(DAY, 1, @bulanLalu) THEN dod.Delivered ELSE 0 END), 0) AS BulanLaluQty,
            ISNULL(SUM(CASE WHEN do_.TransDate >= @tahunLalu AND do_.TransDate < DATEADD(DAY, 1, @tahunLalu) THEN dod.Delivered ELSE 0 END), 0) AS TahunLaluQty
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @tahunLalu
      `),
  ]);

  const net = netResult.recordset[0] as {
    KemarinNet: number;
    PekanLaluNet: number;
    BulanLaluNet: number;
    TahunLaluNet: number;
  };
  const qty = qtyResult.recordset[0] as {
    KemarinQty: number;
    PekanLaluQty: number;
    BulanLaluQty: number;
    TahunLaluQty: number;
  };

  const current: SalesDayPoint = { NetSales: today.NetSales, DOQty: today.Qty10KG + today.Qty5KG };

  const buildDay = (label: string, previous: SalesDayPoint | null): SalesDayComparison => ({
    label,
    current,
    previous,
    NominalPctChange: previous ? pctChange(current.NetSales, previous.NetSales) : null,
    QtyPctChange: previous ? pctChange(current.DOQty, previous.DOQty) : null,
  });

  return [
    buildDay("Kemarin", { NetSales: net.KemarinNet, DOQty: qty.KemarinQty }),
    buildDay("Pekan Lalu", pekanLaluAvailable ? { NetSales: net.PekanLaluNet, DOQty: qty.PekanLaluQty } : null),
    buildDay("Bulan Lalu", { NetSales: net.BulanLaluNet, DOQty: qty.BulanLaluQty }),
    buildDay("Tahun Lalu", { NetSales: net.TahunLaluNet, DOQty: qty.TahunLaluQty }),
  ];
}
