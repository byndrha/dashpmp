import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import {
  getMarketingUsers,
  getMarketingWilayahAssignments,
  resolveResponsibleMarketing,
  resolveMitraOverrideSources,
} from "@/lib/queries/marketing-wilayah";
import { getMonthlyCapacitySnapshot } from "@/lib/queries/mitra-capacity-snapshot";
import { getArmadaNooDailyCapacity } from "@/lib/queries/armada-noo-target";

const KANTONG_QTY_EXPR = `SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Delivered / 2.0 ELSE dod.Delivered END)`;

export interface CategoryAnatomy {
  general: number;
  bagQtyActual: number;
  bagQtyTarget: number;
  pct: number | null;
}

export interface MarketingTrendMonth {
  monthStartISO: string;
  existing: CategoryAnatomy;
  noo: CategoryAnatomy;
  total: CategoryAnatomy;
}

export interface MarketingTrendRow {
  MarketingUserID: string;
  MarketingNama: string;
  months: MarketingTrendMonth[];
}

export interface MarketingPerformanceTrendData {
  months: string[];
  rows: MarketingTrendRow[];
  combined: MarketingTrendMonth[];
}

function daysInMonth(monthStart: Date): number {
  return Math.round((monthBoundary(monthStart, 1).getTime() - monthStart.getTime()) / 86400000);
}

function makeAnatomy(): CategoryAnatomy {
  return { general: 0, bagQtyActual: 0, bagQtyTarget: 0, pct: null };
}

function makeMonth(monthStartISO: string): MarketingTrendMonth {
  return { monthStartISO, existing: makeAnatomy(), noo: makeAnatomy(), total: makeAnatomy() };
}

function finalizeAnatomy(a: CategoryAnatomy): void {
  a.pct = a.bagQtyTarget > 0 ? (a.bagQtyActual / a.bagQtyTarget) * 100 : null;
}

interface MitraMeta {
  BusinessPartnerID: string;
  JoinDate: string | null;
  MarketingUserID: string | null;
  IsCrossWilayahProposal: boolean;
}

// Per-Marketing (plus a company-wide `combined` row) monthly trend of
// Existing/NOO/Total — "Matriks Performa Marketing" (spec §5). `monthsBack`
// is 3 (default) or 12 (expanded) months ending at the current WIB business
// month, oldest first. Only Marketing with at least one Wilayah/Kecamatan
// assignment (or a per-mitra priority override) get a row — same rule as
// getMarketingPerformance().
export async function getMarketingPerformanceTrend(monthsBack: number): Promise<MarketingPerformanceTrendData> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const currentMonthStart = monthBoundary(businessToday);

  const monthStarts: Date[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) monthStarts.push(monthBoundary(currentMonthStart, -i));
  const earliestMonthStart = monthStarts[0];
  const rangeEnd = monthBoundary(currentMonthStart, 1);

  const [assignments, marketingUsers, mitraResult, dailyResult] = await Promise.all([
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
    pool.request().query(`
      SELECT
          BusinessPartnerID,
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          JoinDate
      FROM BusinessPartner
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
    pool
      .request()
      .input("rangeStart", sql.Date, earliestMonthStart)
      .input("rangeEnd", sql.Date, rangeEnd)
      .query(`
        SELECT
            bp.BusinessPartnerID,
            CAST(do_.TransDate AS DATE) AS TransDate,
            ${KANTONG_QTY_EXPR} AS QtyKantong
        FROM DeliveryOrder do_
        JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
        JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        WHERE do_.IsDeleted = 0
          AND do_.TransDate >= @rangeStart AND do_.TransDate < @rangeEnd
        GROUP BY bp.BusinessPartnerID, CAST(do_.TransDate AS DATE)
      `),
  ]);

  // Single shared source for the crossWilayah/prioritas merge (and the
  // per-source breakdown Task 3's IsCrossWilayahProposal flag needs below)
  // — see resolveMitraOverrideSources() in marketing-wilayah.ts.
  const { crossWilayahOverrides, prioritasOverrides, merged: mitraOverrides } = await resolveMitraOverrideSources(assignments);
  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));

  const mitraMeta = new Map<string, MitraMeta>();
  for (const r of mitraResult.recordset as { BusinessPartnerID: string; Wilayah: string; Kecamatan: string | null; JoinDate: string | null }[]) {
    const marketingName = resolveResponsibleMarketing(r.BusinessPartnerID, r.Wilayah, r.Kecamatan, assignments, mitraOverrides);
    const user = marketingName ? marketingByName.get(marketingName) : undefined;
    mitraMeta.set(r.BusinessPartnerID, {
      BusinessPartnerID: r.BusinessPartnerID,
      JoinDate: r.JoinDate,
      MarketingUserID: user?.UserID ?? null,
      IsCrossWilayahProposal: crossWilayahOverrides.has(r.BusinessPartnerID) && !prioritasOverrides.has(r.BusinessPartnerID),
    });
  }

  const actualByMitraMonth = new Map<string, Map<string, number>>();
  for (const r of dailyResult.recordset as { BusinessPartnerID: string; TransDate: string; QtyKantong: number }[]) {
    const rowMonthStartISO = monthBoundary(new Date(r.TransDate)).toISOString().slice(0, 10);
    let byMonth = actualByMitraMonth.get(r.BusinessPartnerID);
    if (!byMonth) {
      byMonth = new Map();
      actualByMitraMonth.set(r.BusinessPartnerID, byMonth);
    }
    byMonth.set(rowMonthStartISO, (byMonth.get(rowMonthStartISO) ?? 0) + r.QtyKantong);
  }

  const marketingIdsWithScope = new Set<string>();
  for (const a of assignments) {
    const id = marketingByName.get(a.MarketingNama)?.UserID;
    if (id) marketingIdsWithScope.add(id);
  }
  for (const name of mitraOverrides.values()) {
    const id = marketingByName.get(name)?.UserID;
    if (id) marketingIdsWithScope.add(id);
  }

  const monthsISO = monthStarts.map((m) => m.toISOString().slice(0, 10));
  const rows: MarketingTrendRow[] = [...marketingIdsWithScope].map((userId) => ({
    MarketingUserID: userId,
    MarketingNama: marketingUsers.find((u) => u.UserID === userId)?.Nama ?? "Tidak diketahui",
    months: monthsISO.map((iso) => makeMonth(iso)),
  }));
  const rowByMarketing = new Map(rows.map((r) => [r.MarketingUserID, r]));
  const combined: MarketingTrendMonth[] = monthsISO.map((iso) => makeMonth(iso));

  for (let i = 0; i < monthStarts.length; i++) {
    const monthStart = monthStarts[i];
    const monthStartISO = monthsISO[i];
    const nextMonthStart = monthBoundary(monthStart, 1);
    const days = daysInMonth(monthStart);

    const [snapshot, nooDailyCapacity] = await Promise.all([
      getMonthlyCapacitySnapshot(monthStart),
      getArmadaNooDailyCapacity(monthStart.getTime() === currentMonthStart.getTime() ? businessToday : nextMonthStart),
    ]);
    const targetNooThisMonth = nooDailyCapacity * days;

    for (const meta of mitraMeta.values()) {
      if (!meta.MarketingUserID) continue;
      // A cross-wilayah-proposed mitra is permanently NOO regardless of
      // JoinDate (per the accepted design), so it must never be skipped by
      // the null/future-JoinDate guard below — that guard only applies to
      // non-cross-wilayah mitra, for whom JoinDate is the sole NOO signal.
      if (!meta.IsCrossWilayahProposal && (meta.JoinDate == null || new Date(meta.JoinDate).getTime() >= nextMonthStart.getTime())) continue;
      const isNoo = meta.IsCrossWilayahProposal || (meta.JoinDate != null && new Date(meta.JoinDate).getTime() >= monthStart.getTime());
      const actual = actualByMitraMonth.get(meta.BusinessPartnerID)?.get(monthStartISO) ?? 0;
      const capacity = snapshot.get(meta.BusinessPartnerID) ?? 0;

      const row = rowByMarketing.get(meta.MarketingUserID);
      if (row) {
        const bucket = isNoo ? row.months[i].noo : row.months[i].existing;
        bucket.general += 1;
        bucket.bagQtyActual += actual;
        // capacity is a DAILY figure (BusinessPartner.Capacity, snapshotted
        // — see getMonthlyCapacitySnapshot) while bagQtyActual accumulates
        // the WHOLE month's DO qty, so it must be scaled by `days` to be
        // comparable — the same daily->monthly scaling NOO's own target
        // already does a few lines below (targetNooThisMonth). Without
        // this, Existing's pct compared a monthly total against a bare
        // daily-target sum and read as 1000%+.
        if (!isNoo) bucket.bagQtyTarget += (capacity ?? 0) * days;
      }

      const combinedBucket = isNoo ? combined[i].noo : combined[i].existing;
      combinedBucket.general += 1;
      combinedBucket.bagQtyActual += actual;
      if (!isNoo) combinedBucket.bagQtyTarget += (capacity ?? 0) * days;
    }

    // Target NOO is one shared figure added once per row per month (never
    // per-mitra) — see Global Constraints.
    for (const row of rows) row.months[i].noo.bagQtyTarget = targetNooThisMonth;
    combined[i].noo.bagQtyTarget = targetNooThisMonth;
  }

  for (const row of rows) {
    for (const month of row.months) {
      month.total.general = month.existing.general + month.noo.general;
      month.total.bagQtyActual = month.existing.bagQtyActual + month.noo.bagQtyActual;
      month.total.bagQtyTarget = month.existing.bagQtyTarget + month.noo.bagQtyTarget;
      finalizeAnatomy(month.existing);
      finalizeAnatomy(month.noo);
      finalizeAnatomy(month.total);
    }
  }
  for (const month of combined) {
    month.total.general = month.existing.general + month.noo.general;
    month.total.bagQtyActual = month.existing.bagQtyActual + month.noo.bagQtyActual;
    month.total.bagQtyTarget = month.existing.bagQtyTarget + month.noo.bagQtyTarget;
    finalizeAnatomy(month.existing);
    finalizeAnatomy(month.noo);
    finalizeAnatomy(month.total);
  }

  rows.sort((a, b) => a.MarketingNama.localeCompare(b.MarketingNama));
  return { months: monthsISO, rows, combined };
}
