import { getPool, sql } from "@/lib/db";
import { getBusinessDateISO } from "@/lib/business-date";
import { getMarketingPeriodSetting } from "@/lib/queries/marketing-period";
import {
  getMarketingUsers,
  getMarketingWilayahAssignments,
  resolveResponsibleMarketing,
} from "@/lib/queries/marketing-wilayah";

// One (Marketing, Wilayah, Kecamatan) bucket — kept unaggregated (not
// collapsed straight to one row per Marketing) so the panel can filter by
// Wilayah/Kecamatan and re-aggregate client-side without another round trip.
export interface MarketingScopeCell {
  MarketingUserID: string;
  MarketingNama: string;
  Wilayah: string;
  Kecamatan: string | null;
  // Sum of Capacity across mitra in this (Wilayah, Kecamatan) bucket — same
  // aggregation WilayahDeliveryPanel already does per Wilayah.
  TargetHarian: number;
  DailyQty: number[];
}

export interface MarketingPerformanceData {
  periodDays: number;
  rangeStartISO: string;
  todayISO: string;
  cells: MarketingScopeCell[];
}

// Kantong here counts a 5KG bag as half a kantong — same KANTONG_QTY_EXPR
// convention as mitra-do.ts, required so DailyQty stays directly comparable
// to TargetHarian (aggregated from BusinessPartner.Capacity, itself defined
// in this same halved unit).
const KANTONG_QTY_EXPR = `SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END)`;

// Per-Marketing counterpart to getMitraDOMonthly() — instead of one row per
// mitra, buckets every mitra resolved (via DashboardMarketingWilayah) to a
// Marketing's Wilayah/Kecamatan scope. The period is NOT the calendar month
// used elsewhere in the app — it's the configurable range from
// getMarketingPeriodSetting() (default: calendar month).
//
// Only Marketing with at least one Wilayah/Kecamatan assignment are
// included — one with no scope has no mitra to attribute deliveries to, so
// showing them would just be a confusing all-zero row.
export async function getMarketingPerformance(): Promise<MarketingPerformanceData> {
  const [period, assignments, marketingUsers] = await Promise.all([
    getMarketingPeriodSetting(),
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
  ]);

  const pool = await getPool();
  const rangeStart = new Date(period.startDate);
  const rangeEnd = new Date(rangeStart.getTime() + period.periodDays * 86400000);
  const todayISO = getBusinessDateISO();

  const [dailyResult, mitraResult] = await Promise.all([
    pool
      .request()
      .input("rangeStart", sql.Date, rangeStart)
      .input("rangeEnd", sql.Date, rangeEnd)
      .query(`
        SELECT
            ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
            bp.NPWPAddress AS Kecamatan,
            CAST(do_.TransDate AS DATE) AS TransDate,
            ${KANTONG_QTY_EXPR} AS QtyKantong
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @rangeStart AND do_.TransDate < @rangeEnd
        GROUP BY bp.NPWPName, bp.NPWPAddress, CAST(do_.TransDate AS DATE)
      `),
    pool.request().query(`
      SELECT
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          Capacity
      FROM BusinessPartner
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
  ]);

  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));
  const cellKey = (marketingUserId: string, wilayah: string, kecamatan: string | null) =>
    `${marketingUserId}|${wilayah}|${kecamatan ?? ""}`;
  const cells = new Map<string, MarketingScopeCell>();

  function getCell(wilayah: string, kecamatan: string | null): MarketingScopeCell | null {
    const marketingName = resolveResponsibleMarketing(wilayah, kecamatan, assignments);
    if (!marketingName) return null;
    const user = marketingByName.get(marketingName);
    if (!user) return null;
    const key = cellKey(user.UserID, wilayah, kecamatan);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        MarketingUserID: user.UserID,
        MarketingNama: user.Nama,
        Wilayah: wilayah,
        Kecamatan: kecamatan,
        TargetHarian: 0,
        DailyQty: new Array(period.periodDays).fill(0),
      };
      cells.set(key, cell);
    }
    return cell;
  }

  for (const r of mitraResult.recordset as { Wilayah: string; Kecamatan: string | null; Capacity: number | null }[]) {
    const cell = getCell(r.Wilayah, r.Kecamatan);
    if (cell && r.Capacity) cell.TargetHarian += r.Capacity;
  }

  for (const r of dailyResult.recordset as {
    Wilayah: string;
    Kecamatan: string | null;
    TransDate: string;
    QtyKantong: number;
  }[]) {
    const cell = getCell(r.Wilayah, r.Kecamatan);
    if (!cell) continue;
    const dayIndex = Math.round((new Date(r.TransDate).getTime() - rangeStart.getTime()) / 86400000);
    if (dayIndex >= 0 && dayIndex < period.periodDays) cell.DailyQty[dayIndex] += r.QtyKantong;
  }

  return { periodDays: period.periodDays, rangeStartISO: period.startDate, todayISO, cells: [...cells.values()] };
}
