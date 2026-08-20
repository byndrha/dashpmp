import { getPool, sql } from "@/lib/db";
import { getBusinessDate, getBusinessDateISO, getBusinessDateWithRollover, monthBoundary } from "@/lib/business-date";
import {
  getMarketingUsers,
  getMarketingWilayahAssignments,
  resolveResponsibleMarketing,
  resolveMitraOverrideSources,
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

// One mitra resolved into a Marketing's Wilayah/Kecamatan coverage — the
// full roster behind the "seluruh mitra di wilayah tanggung jawab" collapse
// in Kinerja Marketing, distinct from the small curated "mitra prioritas"
// list (DashboardMarketingMitra overrides).
export interface MarketingScopeAllMitra {
  BusinessPartnerID: string;
  Name: string;
  Wilayah: string;
  Kecamatan: string | null;
  Capacity: number | null;
  JoinDate: string | null;
  PriceLevel: number | null;
  // A mitra qualifying via cross-wilayah Pengajuan ownership (Task 2) counts
  // as NOO every month it's resolved into this scope, not just its JoinDate
  // month — see marketing-performance-trend.ts's isNoo for the same rule
  // applied historically.
  IsCrossWilayahProposal: boolean;
  // Shown separately in the roster as "Mitra Prioritas", same admin-set
  // DashboardMarketingMitra override desktop already curates.
  IsPriorityOverride: boolean;
}

export interface MarketingPerformanceData {
  periodDays: number;
  rangeStartISO: string;
  todayISO: string;
  cells: MarketingScopeCell[];
  // Daily qty per BusinessPartnerID, for every mitra resolved into ANY
  // Marketing's scope (priority-override or plain Wilayah/Kecamatan match)
  // — covers both the "mitra prioritas" and "seluruh mitra" collapses in
  // Kinerja Marketing. A Wilayah can have hundreds of mitra (e.g. Ponorogo,
  // ~290 live) — still just one extra in-memory pass over the same
  // already-fetched dailyResult/mitraResult rows below, not a new query.
  mitraDailyQty: Record<string, number[]>;
  // Full mitra roster per Marketing (by UserID), for the "seluruh mitra"
  // collapse — sorted by highest Capacity first at the call site, same as
  // mitraPrioritas.
  allMitraByMarketing: Record<string, MarketingScopeAllMitra[]>;
}

// Kantong here counts a 5KG bag as half a kantong — same KANTONG_QTY_EXPR
// convention as mitra-do.ts, required so DailyQty stays directly comparable
// to TargetHarian (aggregated from BusinessPartner.Capacity, itself defined
// in this same halved unit).
const KANTONG_QTY_EXPR = `SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END)`;

// Kinerja Marketing's own rollover cutoff — deliberately 13:00 WIB, not the
// app-wide ROLLOVER_HOUR (14:00) used by Papan Pengiriman. Standing
// business rule (explicit request): the panel's visible range must never
// lag behind "today" WIB, and once it's past 13:00 WIB it must already
// include "tomorrow" too — every render recomputes this off the current
// instant, so it keeps holding as days pass rather than needing a manual
// periodDays bump.
const KINERJA_MARKETING_ROLLOVER_HOUR = 13;

// Per-Marketing counterpart to getMitraDOMonthly() — instead of one row per
// mitra, buckets every mitra resolved (via DashboardMarketingWilayah) to a
// Marketing's Wilayah/Kecamatan scope. The period is always "this calendar
// month, from the 1st through today" (see rangeStart/rangeEnd below) — no
// longer admin-configurable (the old getMarketingPeriodSetting()-backed
// "Atur Periode" control let the range drift arbitrarily, once observed
// stretching data all the way into September while August was still the
// current month; confirmed with the user 2026-08-20 that the range must
// never reach past today in the current month).
//
// Only Marketing with at least one Wilayah/Kecamatan assignment are
// included — one with no scope has no mitra to attribute deliveries to, so
// showing them would just be a confusing all-zero row.
export async function getMarketingPerformance(): Promise<MarketingPerformanceData> {
  const [assignments, marketingUsers] = await Promise.all([getMarketingWilayahAssignments(), getMarketingUsers()]);
  // Single shared source for the crossWilayah/prioritas merge (and the
  // per-source breakdown Task 3's IsCrossWilayahProposal/IsPriorityOverride
  // flags need below) — see resolveMitraOverrideSources() in
  // marketing-wilayah.ts.
  const { crossWilayahOverrides, prioritasOverrides, merged: mitraOverrides } = await resolveMitraOverrideSources(assignments);

  const pool = await getPool();
  // Always the 1st of the current WIB business month, self-correcting as
  // months pass.
  const rangeStart = monthBoundary(getBusinessDate());
  const todayISO = getBusinessDateISO();

  // Exclusive upper bound: today, one day later — per the 13:00 WIB
  // rollover above, one more day past that once it's past 13:00 WIB. Never
  // extends any further (no more admin-configurable minimum length here).
  const rolloverLastVisibleDay = getBusinessDateWithRollover(KINERJA_MARKETING_ROLLOVER_HOUR);
  const rangeEnd = new Date(rolloverLastVisibleDay.getTime() + 86400000);
  const periodDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000);

  // Grouped per-mitra (not just per Wilayah/Kecamatan) so a mitra with a
  // priority override (resolveResponsibleMarketing) can be pulled into its
  // overriding Marketing's bucket individually, without dragging the rest of
  // its Wilayah/Kecamatan along with it.
  const [dailyResult, mitraResult] = await Promise.all([
    pool
      .request()
      .input("rangeStart", sql.Date, rangeStart)
      .input("rangeEnd", sql.Date, rangeEnd)
      .query(`
        SELECT
            bp.BusinessPartnerID,
            ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
            bp.NPWPAddress AS Kecamatan,
            CAST(do_.TransDate AS DATE) AS TransDate,
            ${KANTONG_QTY_EXPR} AS QtyKantong
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @rangeStart AND do_.TransDate < @rangeEnd
        GROUP BY bp.BusinessPartnerID, bp.NPWPName, bp.NPWPAddress, CAST(do_.TransDate AS DATE)
      `),
    pool.request().query(`
      SELECT
          BusinessPartnerID,
          Name,
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          Capacity,
          JoinDate,
          PriceLevel
      FROM BusinessPartner
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
  ]);

  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));
  const cellKey = (marketingUserId: string, wilayah: string, kecamatan: string | null) =>
    `${marketingUserId}|${wilayah}|${kecamatan ?? ""}`;
  const cells = new Map<string, MarketingScopeCell>();

  function getCell(businessPartnerId: string, wilayah: string, kecamatan: string | null): MarketingScopeCell | null {
    const marketingName = resolveResponsibleMarketing(businessPartnerId, wilayah, kecamatan, assignments, mitraOverrides);
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
        DailyQty: new Array(periodDays).fill(0),
      };
      cells.set(key, cell);
    }
    return cell;
  }

  // Full roster per Marketing, for the "seluruh mitra" collapse — built
  // alongside TargetHarian in the same pass since both need the same
  // per-mitra Marketing resolution.
  const allMitraByMarketing = new Map<string, MarketingScopeAllMitra[]>();
  const resolvedMarketingByMitra = new Map<string, string>();

  for (const r of mitraResult.recordset as {
    BusinessPartnerID: string;
    Name: string;
    Wilayah: string;
    Kecamatan: string | null;
    Capacity: number | null;
    JoinDate: string | null;
    PriceLevel: number | null;
  }[]) {
    const cell = getCell(r.BusinessPartnerID, r.Wilayah, r.Kecamatan);
    if (!cell) continue;
    if (r.Capacity) cell.TargetHarian += r.Capacity;
    resolvedMarketingByMitra.set(r.BusinessPartnerID, cell.MarketingUserID);
    const roster = allMitraByMarketing.get(cell.MarketingUserID) ?? [];
    roster.push({
      BusinessPartnerID: r.BusinessPartnerID,
      Name: r.Name,
      Wilayah: r.Wilayah,
      Kecamatan: r.Kecamatan,
      Capacity: r.Capacity,
      JoinDate: r.JoinDate,
      PriceLevel: r.PriceLevel,
      IsCrossWilayahProposal: crossWilayahOverrides.has(r.BusinessPartnerID) && !prioritasOverrides.has(r.BusinessPartnerID),
      IsPriorityOverride: prioritasOverrides.has(r.BusinessPartnerID),
    });
    allMitraByMarketing.set(cell.MarketingUserID, roster);
  }

  // Per-mitra daily breakdown for every mitra resolved into any Marketing's
  // scope — covers both the "mitra prioritas" collapse (priority overrides)
  // and the "seluruh mitra" collapse (every other resolved mitra). Reuses
  // dailyResult (already fetched for the cell aggregation above) rather than
  // a second query.
  const mitraDailyQty: Record<string, number[]> = {};
  for (const id of resolvedMarketingByMitra.keys()) mitraDailyQty[id] = new Array(periodDays).fill(0);

  for (const r of dailyResult.recordset as {
    BusinessPartnerID: string;
    Wilayah: string;
    Kecamatan: string | null;
    TransDate: string;
    QtyKantong: number;
  }[]) {
    const cell = getCell(r.BusinessPartnerID, r.Wilayah, r.Kecamatan);
    if (!cell) continue;
    const dayIndex = Math.round((new Date(r.TransDate).getTime() - rangeStart.getTime()) / 86400000);
    if (dayIndex < 0 || dayIndex >= periodDays) continue;
    cell.DailyQty[dayIndex] += r.QtyKantong;
    if (mitraDailyQty[r.BusinessPartnerID]) mitraDailyQty[r.BusinessPartnerID][dayIndex] += r.QtyKantong;
  }

  return {
    periodDays,
    rangeStartISO: rangeStart.toISOString().slice(0, 10),
    todayISO,
    cells: [...cells.values()],
    mitraDailyQty,
    allMitraByMarketing: Object.fromEntries(allMitraByMarketing),
  };
}
