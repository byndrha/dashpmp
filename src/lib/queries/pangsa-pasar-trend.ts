import { getPool } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import { getMarketingUsers, getMarketingWilayahAssignments, resolveMitraOverrideSources } from "@/lib/queries/marketing-wilayah";
import { resolveAllMitraOwnership, resolveHybridOwner } from "@/lib/queries/marketing-ownership";
import type { MarketingPerformanceTrendData } from "@/lib/queries/marketing-performance-trend";

export interface PangsaPasarMonth {
  monthStartISO: string;
  agen: number;
  rpa: number;
  outlet: number;
  total: number;
  agenPct: number | null;
  rpaPct: number | null;
  outletPct: number | null;
  lost: number;
}

export interface PangsaPasarRow {
  MarketingUserID: string;
  MarketingNama: string;
  months: PangsaPasarMonth[];
}

export interface PangsaPasarTrendData {
  months: string[];
  rows: PangsaPasarRow[];
  combined: PangsaPasarMonth[];
}

function makeMonth(monthStartISO: string): PangsaPasarMonth {
  return { monthStartISO, agen: 0, rpa: 0, outlet: 0, total: 0, agenPct: null, rpaPct: null, outletPct: null, lost: 0 };
}

interface MitraMeta {
  BusinessPartnerID: string;
  JoinDate: string | null;
  PartnerType: string;
  MarketingUserID: string | null;
}

// "Pangsa Pasar & Kontribusi Internal" (spec §6) — per-Marketing monthly
// Agen/RPA/Outlet roster counts (as-of-month-end, PARTNER_TYPE_CASE-based;
// TakeAway/Lainnya excluded, same convention as Mitra Growth), each with %
// share of the company-wide total that month, plus Lost (month-over-month
// delta of Total Bag Qty). Reuses `performanceTrend` (from
// getMarketingPerformanceTrend()) for Lost instead of re-querying
// DeliveryOrder — `performanceTrend.months` MUST be the same `monthsBack`
// call result, same order; callers always fetch performanceTrend first and
// pass it straight through. The first displayed month has no prior-month
// data available in the window, so its `lost` is 0 (documented boundary
// case, not a bug).
export async function getPangsaPasarTrend(
  monthsBack: number,
  performanceTrend: MarketingPerformanceTrendData
): Promise<PangsaPasarTrendData> {
  const pool = await getPool();
  const monthStarts = performanceTrend.months.map((iso) => new Date(iso));

  const [assignments, marketingUsers, mitraResult, ownerships] = await Promise.all([
    getMarketingWilayahAssignments(),
    getMarketingUsers(),
    pool.request().query(`
      SELECT
          BusinessPartnerID,
          ISNULL(NULLIF(LTRIM(RTRIM(NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          NPWPAddress AS Kecamatan,
          JoinDate,
          ${PARTNER_TYPE_CASE} AS PartnerType
      FROM BusinessPartner bp
      WHERE ISNULL(IsDeleted, 0) = 0
    `),
    resolveAllMitraOwnership(),
  ]);
  const { prioritasOverrides } = await resolveMitraOverrideSources(assignments);
  const ownershipByMitra = new Map(ownerships.map((o) => [o.businessPartnerId, o]));
  const akunIdToNama = new Map(marketingUsers.map((u) => [u.UserID, u.Nama]));
  const today = getBusinessDate();
  const marketingByName = new Map(marketingUsers.map((u) => [u.Nama, u]));

  // Atribusi sekarang pakai aturan hybrid yang sama dengan
  // marketing-performance.ts (Prioritas > mitra-yang-masih-NOO permanen ke
  // pendaftar > mitra Existing ikut wilayah-live) — confirmed with user
  // 2026-09-24. Aturan "kapan mitra masuk roster bulan itu" (JoinDate di
  // bawah, `meta.JoinDate == null || ... >= nextMonthStart`) TIDAK berubah.
  const mitraMeta: MitraMeta[] = (
    mitraResult.recordset as { BusinessPartnerID: string; Wilayah: string; Kecamatan: string | null; JoinDate: string | null; PartnerType: string }[]
  ).map((r) => {
    const { marketingNama } = resolveHybridOwner(
      r.BusinessPartnerID,
      r.Wilayah,
      r.Kecamatan,
      assignments,
      prioritasOverrides,
      ownershipByMitra,
      akunIdToNama,
      today
    );
    const user = marketingNama ? marketingByName.get(marketingNama) : undefined;
    return { BusinessPartnerID: r.BusinessPartnerID, JoinDate: r.JoinDate, PartnerType: r.PartnerType, MarketingUserID: user?.UserID ?? null };
  });

  const marketingIdsWithScope = new Set(performanceTrend.rows.map((r) => r.MarketingUserID));
  const rows: PangsaPasarRow[] = [...marketingIdsWithScope].map((userId) => ({
    MarketingUserID: userId,
    MarketingNama: marketingUsers.find((u) => u.UserID === userId)?.Nama ?? "Tidak diketahui",
    months: performanceTrend.months.map((iso) => makeMonth(iso)),
  }));
  const rowByMarketing = new Map(rows.map((r) => [r.MarketingUserID, r]));
  const combined: PangsaPasarMonth[] = performanceTrend.months.map((iso) => makeMonth(iso));

  for (let i = 0; i < monthStarts.length; i++) {
    const nextMonthStart = monthBoundary(monthStarts[i], 1);
    for (const meta of mitraMeta) {
      if (!meta.MarketingUserID) continue;
      if (meta.PartnerType !== "Agen" && meta.PartnerType !== "RPA" && meta.PartnerType !== "Outlet") continue;
      if (meta.JoinDate == null || new Date(meta.JoinDate).getTime() >= nextMonthStart.getTime()) continue;

      const key: "agen" | "rpa" | "outlet" = meta.PartnerType === "Agen" ? "agen" : meta.PartnerType === "RPA" ? "rpa" : "outlet";
      const row = rowByMarketing.get(meta.MarketingUserID);
      if (row) {
        row.months[i][key] += 1;
        row.months[i].total += 1;
      }
      combined[i][key] += 1;
      combined[i].total += 1;
    }
  }

  for (let i = 0; i < monthStarts.length; i++) {
    for (const row of rows) {
      const m = row.months[i];
      m.agenPct = combined[i].agen > 0 ? (m.agen / combined[i].agen) * 100 : null;
      m.rpaPct = combined[i].rpa > 0 ? (m.rpa / combined[i].rpa) * 100 : null;
      m.outletPct = combined[i].outlet > 0 ? (m.outlet / combined[i].outlet) * 100 : null;

      const trendRow = performanceTrend.rows.find((p) => p.MarketingUserID === row.MarketingUserID);
      const currActual = trendRow?.months[i].total.bagQtyActual ?? 0;
      const prevActual = i > 0 ? trendRow?.months[i - 1].total.bagQtyActual : undefined;
      m.lost = prevActual != null ? currActual - prevActual : 0;
    }
    const cm = combined[i];
    const prevCombinedActual = i > 0 ? performanceTrend.combined[i - 1].total.bagQtyActual : undefined;
    cm.lost = prevCombinedActual != null ? performanceTrend.combined[i].total.bagQtyActual - prevCombinedActual : 0;
  }

  rows.sort((a, b) => a.MarketingNama.localeCompare(b.MarketingNama));
  return { months: performanceTrend.months, rows, combined };
}
