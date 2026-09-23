import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { getMarketingUsers } from "@/lib/queries/marketing-wilayah";
import { getMonthlyCapacitySnapshot } from "@/lib/queries/mitra-capacity-snapshot";
import { getArmadaNooDailyCapacity } from "@/lib/queries/armada-noo-target";
import { resolveAllMitraOwnership, NOO_WINDOW_DAYS } from "@/lib/queries/marketing-ownership";

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

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
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

interface DailyRow {
  BusinessPartnerID: string;
  TransDate: string;
  QtyKantong: number;
}

// Per-Marketing (plus a company-wide `combined` row) monthly trend of
// Existing/NOO/Total — "Matriks Performa Marketing" (spec §5). `monthsBack`
// is 3 (default) or 12 (expanded) months ending at the current WIB business
// month, oldest first.
//
// NOO/Existing classification AND ownership now come from
// resolveAllMitraOwnership() (src/lib/queries/marketing-ownership.ts) — the
// SAME permanent-ownership + 30-day-rolling-window rule the Kinerja
// Karyawan payroll module (getHistoriPenjualanSemuaKaryawan) uses, so a
// Marketing's NOO qty here now matches their NOO qty on /mkesindo/kinerja
// exactly. Confirmed with user 2026-09-24 after the two pages were found
// showing different NOO figures for the same person/month (MKT 02,
// September 2026: 1.320 here vs 539 on Kinerja) — root cause was two
// independent rules (JoinDate-in-calendar-month + live Wilayah attribution
// here, vs Pengajuan-approval-30-day-window + permanent attribution on
// Kinerja). This file used the OLD rule until this change.
export async function getMarketingPerformanceTrend(monthsBack: number): Promise<MarketingPerformanceTrendData> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const currentMonthStart = monthBoundary(businessToday);

  const monthStarts: Date[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) monthStarts.push(monthBoundary(currentMonthStart, -i));
  const earliestMonthStart = monthStarts[0];
  const rangeEnd = monthBoundary(currentMonthStart, 1);

  const [marketingUsers, ownerships, dailyResult] = await Promise.all([
    getMarketingUsers(),
    resolveAllMitraOwnership(),
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

  const ownershipByMitra = new Map(ownerships.map((o) => [o.businessPartnerId, o]));
  const monthsISO = monthStarts.map((m) => m.toISOString().slice(0, 10));

  // Every Marketing who owns at least one mitra gets a row — permanent
  // ownership per Global Constraints, so this deliberately no longer
  // requires a currently-active DashboardMarketingWilayah assignment (a
  // Marketing who moved wilayah or left keeps their historical NOO/Existing
  // credit and must still show up here).
  const marketingIdsWithScope = new Set(ownerships.map((o) => o.ownerAkunId));
  const rows: MarketingTrendRow[] = [...marketingIdsWithScope].map((userId) => ({
    MarketingUserID: userId,
    MarketingNama: marketingUsers.find((u) => u.UserID === userId)?.Nama ?? "Tidak diketahui",
    months: monthsISO.map((iso) => makeMonth(iso)),
  }));
  const rowByMarketing = new Map(rows.map((r) => [r.MarketingUserID, r]));
  const combined: MarketingTrendMonth[] = monthsISO.map((iso) => makeMonth(iso));

  // Headcount (`general`): once per mitra per month it qualifies, decided
  // purely from the NOO-window dates (not tied to whether it actually had
  // any delivery that month) — same independence from qty the old rule
  // had. A mitra whose window ends mid-month counts in BOTH buckets'
  // `general` for that month (it genuinely was NOO for part of it and
  // Existing for the rest) — same straddling rule qtyNooBerjalan/
  // qtyExistingBerjalan already applies on /mkesindo/kinerja
  // (marketing-collection-penjualan.ts).
  for (let i = 0; i < monthStarts.length; i++) {
    const monthStart = monthStarts[i];
    const nextMonthStart = monthBoundary(monthStart, 1);
    for (const ownership of ownerships) {
      if (ownership.nooStartDate == null || ownership.nooStartDate.getTime() >= nextMonthStart.getTime()) continue;
      const windowEnd = addDays(ownership.nooStartDate, NOO_WINDOW_DAYS);
      const isNooThisMonth = windowEnd.getTime() >= monthStart.getTime();
      const isExistingThisMonth = windowEnd.getTime() < nextMonthStart.getTime();
      const row = rowByMarketing.get(ownership.ownerAkunId);
      if (isNooThisMonth) {
        if (row) row.months[i].noo.general += 1;
        combined[i].noo.general += 1;
      }
      if (isExistingThisMonth) {
        if (row) row.months[i].existing.general += 1;
        combined[i].existing.general += 1;
      }
    }
  }

  // bagQtyActual: day-granularity split — same rule
  // marketing-collection-penjualan.ts's per-day loop uses, so a mitra
  // whose 30-day window ends mid-month contributes to BOTH buckets that
  // month, split by day, instead of the whole month landing in one bucket.
  for (const r of dailyResult.recordset as DailyRow[]) {
    const ownership = ownershipByMitra.get(r.BusinessPartnerID);
    if (!ownership) continue;
    const rowDate = new Date(r.TransDate);
    const monthIndex = monthStarts.findIndex(
      (m) => rowDate.getTime() >= m.getTime() && rowDate.getTime() < monthBoundary(m, 1).getTime()
    );
    if (monthIndex < 0) continue;
    if (ownership.nooStartDate && rowDate.getTime() < ownership.nooStartDate.getTime()) continue; // before mitra existed
    const nooWindowEnd = ownership.nooStartDate ? addDays(ownership.nooStartDate, NOO_WINDOW_DAYS) : null;
    const isNoo = nooWindowEnd != null && rowDate.getTime() <= nooWindowEnd.getTime();
    const bucket = isNoo ? "noo" : "existing";

    const row = rowByMarketing.get(ownership.ownerAkunId);
    if (row) row.months[monthIndex][bucket].bagQtyActual += r.QtyKantong;
    combined[monthIndex][bucket].bagQtyActual += r.QtyKantong;
  }

  // bagQtyTarget: Existing's daily-capacity-based target (added once per
  // row per month it counts as Existing at all — same non-prorated
  // precision the old rule used), plus NOO's own shared target figure
  // (unchanged — still one flat figure per row per month, never per-mitra).
  for (let i = 0; i < monthStarts.length; i++) {
    const monthStart = monthStarts[i];
    const nextMonthStart = monthBoundary(monthStart, 1);
    const days = daysInMonth(monthStart);
    const [snapshot, nooDailyCapacity] = await Promise.all([
      getMonthlyCapacitySnapshot(monthStart),
      getArmadaNooDailyCapacity(monthStart.getTime() === currentMonthStart.getTime() ? businessToday : nextMonthStart),
    ]);
    const targetNooThisMonth = nooDailyCapacity * days;

    for (const ownership of ownerships) {
      if (ownership.nooStartDate == null || ownership.nooStartDate.getTime() >= nextMonthStart.getTime()) continue;
      const windowEnd = addDays(ownership.nooStartDate, NOO_WINDOW_DAYS);
      const isExistingThisMonth = windowEnd.getTime() < nextMonthStart.getTime();
      if (!isExistingThisMonth) continue;
      const capacity = snapshot.get(ownership.businessPartnerId) ?? 0;
      const row = rowByMarketing.get(ownership.ownerAkunId);
      if (row) row.months[i].existing.bagQtyTarget += capacity * days;
      combined[i].existing.bagQtyTarget += capacity * days;
    }

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
