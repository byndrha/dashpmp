import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { getWilayahPotentialTargets } from "@/lib/queries/wilayah-potential-target";

export interface PemasaranWilayahDeliveryRow {
  Wilayah: string;
  // Total qty ÷ days-in-month (the FULL month, not just elapsed days) —
  // same convention as WilayahDeliveryPanel's AvgPerHari in delivery.ts, so
  // it naturally converges to the true daily average by month-end rather
  // than reading artificially low early in the month.
  AvgPerHariThisMonth: number;
  AvgPerHariLastMonth: number;
  PctChange: number | null;
  // Sum of Capacity across every active mitra in this Wilayah.
  TargetKapasitas: number;
  // Manually entered via setWilayahPotentialTarget() — opportunity beyond
  // existing mitra capacity.
  PotentialTarget: number;
  TotalTarget: number;
}

const WILAYAH_EXPR = `ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui')`;

function pctChange(current: number, previous: number): number | null {
  return previous ? ((current - previous) / previous) * 100 : null;
}

// Kemasan halved (5KG counts as half a kantong) — matches Capacity's own
// unit definition, same convention as delivery.ts's WilayahDeliveryPanel.
const KANTONG_QTY_EXPR = (column: string) =>
  `(CASE WHEN ${column} LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END)`;

// Pemasaran's own "Pengiriman per Wilayah" — same tile-per-Wilayah shape as
// Transaksi's WilayahDeliveryPanel, but built around a month-over-month
// average-per-day comparison and a manually adjustable capacity target
// instead of a period/target-achievement view. Only Wilayah with at least
// one transaction (this month or last month) are returned — per explicit
// request, an all-zero Wilayah shouldn't get a card at all.
export async function getPemasaranWilayahDelivery(): Promise<PemasaranWilayahDeliveryRow[]> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const thisMonthStart = monthBoundary(businessToday);
  const lastMonthStart = monthBoundary(businessToday, -1);
  const thisMonthEnd = monthBoundary(businessToday, 1);

  // Day 0 of a given month === the last day of the month before it — plain
  // UTC arithmetic, not date-fns' getDaysInMonth() (see monthBoundary()'s
  // comment in business-date.ts for why local-time helpers are unsafe here).
  const daysInThisMonth = new Date(
    Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const daysInLastMonth = new Date(
    Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth(), 0)
  ).getUTCDate();

  const [deliveryResult, targetResult, potentialTargets] = await Promise.all([
    pool
      .request()
      .input("thisMonthStart", sql.Date, thisMonthStart)
      .input("lastMonthStart", sql.Date, lastMonthStart)
      .input("thisMonthEnd", sql.Date, thisMonthEnd)
      .query(`
        SELECT
            ${WILAYAH_EXPR} AS Wilayah,
            ISNULL(SUM(CASE WHEN do_.TransDate >= @thisMonthStart THEN ${KANTONG_QTY_EXPR("dod.Name")} ELSE 0 END), 0) AS ThisMonthQty,
            ISNULL(SUM(CASE WHEN do_.TransDate >= @lastMonthStart AND do_.TransDate < @thisMonthStart THEN ${KANTONG_QTY_EXPR("dod.Name")} ELSE 0 END), 0) AS LastMonthQty
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @lastMonthStart AND do_.TransDate < @thisMonthEnd
        GROUP BY ${WILAYAH_EXPR}
      `),
    pool.request().query(`
      SELECT ${WILAYAH_EXPR} AS Wilayah, ISNULL(SUM(bp.Capacity), 0) AS TargetKapasitas
      FROM BusinessPartner bp
      WHERE ISNULL(bp.IsDeleted, 0) = 0
      GROUP BY ${WILAYAH_EXPR}
    `),
    getWilayahPotentialTargets(),
  ]);

  const targetByWilayah = new Map(
    (targetResult.recordset as { Wilayah: string; TargetKapasitas: number }[]).map((r) => [r.Wilayah, r.TargetKapasitas])
  );

  return (deliveryResult.recordset as { Wilayah: string; ThisMonthQty: number; LastMonthQty: number }[])
    .filter((r) => r.ThisMonthQty > 0 || r.LastMonthQty > 0)
    .map((r) => {
      const avgThisMonth = r.ThisMonthQty / daysInThisMonth;
      const avgLastMonth = r.LastMonthQty / daysInLastMonth;
      const targetKapasitas = targetByWilayah.get(r.Wilayah) ?? 0;
      const potentialTarget = potentialTargets.get(r.Wilayah) ?? 0;
      return {
        Wilayah: r.Wilayah,
        AvgPerHariThisMonth: avgThisMonth,
        AvgPerHariLastMonth: avgLastMonth,
        PctChange: pctChange(avgThisMonth, avgLastMonth),
        TargetKapasitas: targetKapasitas,
        PotentialTarget: potentialTarget,
        TotalTarget: targetKapasitas + potentialTarget,
      };
    })
    .sort((a, b) => b.AvgPerHariThisMonth - a.AvgPerHariThisMonth);
}
