import { getPool, sql } from "@/lib/db";
import type { SalesDayComparisonResult, SalesDayComparison, SalesDayPoint, HourlyPoint } from "@/lib/queries/sales-overview";
import {
  getMarketingWilayahAssignments,
  getMarketingMitraAssignments,
  resolveResponsibleMarketing,
  buildMitraOverrideMap,
} from "@/lib/queries/marketing-wilayah";
import { getBusinessDate } from "@/lib/business-date";

// Same calendar day-of-month N months earlier, clamped to the last day of
// the target month — copied from sales-overview.ts's private
// sameDayMonthsBack (not exported there, so duplicated here verbatim rather
// than changing that file's export surface for one new caller).
function sameDayMonthsBack(date: Date, monthsBack: number): Date {
  const targetYear = date.getUTCFullYear();
  const targetMonthIndex = date.getUTCMonth() - monthsBack;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonthIndex, Math.min(date.getUTCDate(), daysInTargetMonth)));
}

async function resolveMitraIdsForMarketing(marketingUserId: string): Promise<string[]> {
  const [assignments, mitraAssignments] = await Promise.all([
    getMarketingWilayahAssignments(),
    getMarketingMitraAssignments(),
  ]);
  const mitraOverrides = buildMitraOverrideMap(mitraAssignments);
  const ownName =
    assignments.find((a) => a.MarketingUserID === marketingUserId)?.MarketingNama ??
    mitraAssignments.find((a) => a.MarketingUserID === marketingUserId)?.MarketingNama;
  if (!ownName) return [];

  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT BusinessPartnerID,
           ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
           NPWPAddress AS Kecamatan
    FROM BusinessPartner
    WHERE ISNULL(IsDeleted, 0) = 0
  `);
  return (result.recordset as { BusinessPartnerID: string; Wilayah: string; Kecamatan: string | null }[])
    .filter(
      (r) => resolveResponsibleMarketing(r.BusinessPartnerID, r.Wilayah, r.Kecamatan, assignments, mitraOverrides) === ownName
    )
    .map((r) => r.BusinessPartnerID);
}

// Current WIB wall-clock hour (0-23) for the actual current instant — copied
// verbatim from getSalesDayComparison()'s own computation in
// sales-overview.ts. Deliberately NOT derived from businessToday: that value
// is a calendar-date-only UTC-midnight marker (see getBusinessDate() in
// business-date.ts), so it carries no time-of-day information — any
// arithmetic on it (e.g. businessToday + 7h) would always land on the same
// wall-clock hour, not "now".
function currentWibHour(): number {
  return (
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", hour: "2-digit", hour12: false }).format(new Date())
    ) % 24
  );
}

// Marketing-scoped mirror of sales-overview.ts's getSalesDayComparison() —
// same 4 comparison points (Kemarin/Pekan Lalu/Bulan Lalu/Tahun Lalu), same
// "Pekan Lalu skipped if it crosses into last month" rule, same per-jam
// breakdown — but every query filtered to BusinessPartnerID IN (mitra
// roster for this marketing). Returns an all-zero result (empty comparisons
// still shaped correctly) when the marketing has no resolved mitra, rather
// than throwing.
export async function getSalesDayComparisonForMarketing(marketingUserId: string): Promise<SalesDayComparisonResult> {
  const mitraIds = await resolveMitraIdsForMarketing(marketingUserId);
  const businessToday = getBusinessDate();

  const zeroPoint: SalesDayPoint = { NetSales: 0, DOQty: 0 };
  const zeroHourly = (): HourlyPoint[] => Array.from({ length: 24 }, (_, hour) => ({ hour, NetSales: 0, DOQty: 0 }));

  const points = [
    { label: "Kemarin", date: new Date(Date.UTC(businessToday.getUTCFullYear(), businessToday.getUTCMonth(), businessToday.getUTCDate() - 1)) },
    { label: "Pekan Lalu", date: new Date(Date.UTC(businessToday.getUTCFullYear(), businessToday.getUTCMonth(), businessToday.getUTCDate() - 7)) },
    { label: "Bulan Lalu", date: sameDayMonthsBack(businessToday, 1) },
    { label: "Tahun Lalu", date: sameDayMonthsBack(businessToday, 12) },
  ];

  if (mitraIds.length === 0) {
    return {
      comparisons: points.map(
        ({ label, date }): SalesDayComparison => ({
          label,
          dateISO: date.toISOString().slice(0, 10),
          current: zeroPoint,
          previous: zeroPoint,
          // Not rendered by this scope's own beranda-tab.tsx (unlike the
          // MKEsindo panel this mirrors) — zeroPoint keeps the shared type
          // satisfied without computing a real rollover-window query here.
          previousCumulative: zeroPoint,
          NominalPctChange: null,
          QtyPctChange: null,
          hourly: zeroHourly(),
        })
      ),
      todayHourly: zeroHourly(),
      currentWibHour: currentWibHour(),
      currentCumulative: zeroPoint,
    };
  }

  const pool = await getPool();
  const idParams = (request: sql.Request) =>
    mitraIds.map((id, i) => {
      request.input(`bp${i}`, sql.VarChar(16), id);
      return `@bp${i}`;
    });

  // "Pekan Lalu" skipped when it crosses into a different calendar month —
  // same rule as getSalesDayComparison().
  const pekanLalu = points[1].date;
  const pekanLaluAvailable =
    pekanLalu.getUTCFullYear() === businessToday.getUTCFullYear() && pekanLalu.getUTCMonth() === businessToday.getUTCMonth();

  async function pointFor(date: Date, includeHourly: boolean): Promise<{ point: SalesDayPoint; hourly: HourlyPoint[] | null }> {
    const dayStart = date;
    const dayEnd = new Date(date.getTime() + 86400000);

    const netRequest = pool.request().input("start", sql.DateTime, dayStart).input("end", sql.DateTime, dayEnd);
    const netIds = idParams(netRequest);
    const netResult = await netRequest.query(`
      SELECT ISNULL(SUM(Netto), 0) AS NetSales
      FROM SalesInvoice
      WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
        AND TransDate >= @start AND TransDate < @end
        AND BusinessPartnerID IN (${netIds.join(", ")})
    `);

    const qtyRequest = pool.request().input("start", sql.DateTime, dayStart).input("end", sql.DateTime, dayEnd);
    const qtyIds = idParams(qtyRequest);
    const qtyResult = await qtyRequest.query(`
      SELECT ISNULL(SUM(dod.Delivered), 0) AS DOQty
      FROM DeliveryOrder do_
      JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
      WHERE do_.IsDeleted = 0
        AND do_.TransDate >= @start AND do_.TransDate < @end
        AND do_.BusinessPartnerID IN (${qtyIds.join(", ")})
    `);

    const point: SalesDayPoint = {
      NetSales: netResult.recordset[0].NetSales,
      DOQty: qtyResult.recordset[0].DOQty,
    };

    if (!includeHourly) return { point, hourly: null };

    const hourlyNetRequest = pool
      .request()
      .input("start", sql.DateTime, new Date(dayStart.getTime() - 7 * 60 * 60 * 1000))
      .input("end", sql.DateTime, new Date(dayEnd.getTime() - 7 * 60 * 60 * 1000));
    const hourlyNetIds = idParams(hourlyNetRequest);
    const hourlyNetResult = await hourlyNetRequest.query(`
      SELECT DATEPART(HOUR, DATEADD(HOUR, 7, TransDate)) AS HourWIB, SUM(Netto) AS NetSales
      FROM SalesInvoice
      WHERE IsDeleted = 0 AND ISNULL(IsPerforma,0) = 0
        AND TransDate >= @start AND TransDate < @end
        AND BusinessPartnerID IN (${hourlyNetIds.join(", ")})
      GROUP BY DATEPART(HOUR, DATEADD(HOUR, 7, TransDate))
    `);
    const hourlyQtyRequest = pool
      .request()
      .input("start", sql.DateTime, new Date(dayStart.getTime() - 7 * 60 * 60 * 1000))
      .input("end", sql.DateTime, new Date(dayEnd.getTime() - 7 * 60 * 60 * 1000));
    const hourlyQtyIds = idParams(hourlyQtyRequest);
    const hourlyQtyResult = await hourlyQtyRequest.query(`
      SELECT DATEPART(HOUR, DATEADD(HOUR, 7, do_.TransDate)) AS HourWIB, SUM(dod.Delivered) AS DOQty
      FROM DeliveryOrder do_
      JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
      WHERE do_.IsDeleted = 0
        AND do_.TransDate >= @start AND do_.TransDate < @end
        AND do_.BusinessPartnerID IN (${hourlyQtyIds.join(", ")})
      GROUP BY DATEPART(HOUR, DATEADD(HOUR, 7, do_.TransDate))
    `);

    const hourly = zeroHourly();
    for (const r of hourlyNetResult.recordset as { HourWIB: number; NetSales: number }[]) hourly[r.HourWIB].NetSales = r.NetSales;
    for (const r of hourlyQtyResult.recordset as { HourWIB: number; DOQty: number }[]) hourly[r.HourWIB].DOQty = r.DOQty;
    return { point, hourly };
  }

  function pctChange(current: number, previous: number): number | null {
    return previous ? ((current - previous) / previous) * 100 : null;
  }

  const [kemarin, pekan, bulan, tahun, todayResult] = await Promise.all([
    pointFor(points[0].date, true),
    pekanLaluAvailable ? pointFor(points[1].date, true) : Promise.resolve(null),
    pointFor(points[2].date, true),
    pointFor(points[3].date, true),
    pointFor(businessToday, true),
  ]);

  function buildComparison(label: string, date: Date, result: { point: SalesDayPoint; hourly: HourlyPoint[] | null } | null): SalesDayComparison {
    if (!result) {
      return {
        label,
        dateISO: date.toISOString().slice(0, 10),
        current: todayResult.point,
        previous: null,
        previousCumulative: null,
        NominalPctChange: null,
        QtyPctChange: null,
        hourly: null,
      };
    }
    return {
      label,
      dateISO: date.toISOString().slice(0, 10),
      current: todayResult.point,
      previous: result.point,
      // Not rendered by this scope's own beranda-tab.tsx — see the
      // mitraIds.length === 0 branch's comment above for why this stays a
      // placeholder instead of a real rollover-window query.
      previousCumulative: zeroPoint,
      NominalPctChange: pctChange(todayResult.point.NetSales, result.point.NetSales),
      QtyPctChange: pctChange(todayResult.point.DOQty, result.point.DOQty),
      hourly: result.hourly,
    };
  }

  return {
    comparisons: [
      buildComparison("Kemarin", points[0].date, kemarin),
      buildComparison("Pekan Lalu", points[1].date, pekan),
      buildComparison("Bulan Lalu", points[2].date, bulan),
      buildComparison("Tahun Lalu", points[3].date, tahun),
    ],
    todayHourly: todayResult.hourly ?? zeroHourly(),
    currentWibHour: currentWibHour(),
    currentCumulative: zeroPoint,
  };
}
