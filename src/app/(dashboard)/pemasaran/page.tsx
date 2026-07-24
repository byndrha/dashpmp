import { requireModuleAccess } from "@/lib/require-access";
import { getPengajuanList, getMarketingKPI, APPROVER_ROLE_IDS, MARKETING_ROLE_ID } from "@/lib/queries/mitra-pengajuan";
import { getPriceLevelOptions } from "@/lib/queries/mitra";
import { getMarketingWilayahAssignments, getMarketingUsers } from "@/lib/queries/marketing-wilayah";
import { MarketingKPIPanel } from "@/components/dashboard/marketing-kpi-panel";
import { PemasaranSection } from "@/components/dashboard/pemasaran-section";
import { MarketingWilayahPanel } from "@/components/dashboard/marketing-wilayah-panel";

export default async function PemasaranPage() {
  const session = await requireModuleAccess("pemasaran");
  const canApprove = session.user.isSuperAdmin || APPROVER_ROLE_IDS.includes(session.user.roleId);

  const [rows, allKpiRows, priceLevels, wilayahAssignments, marketingUsers] = await Promise.all([
    getPengajuanList(),
    getMarketingKPI(),
    getPriceLevelOptions(),
    // Only fetched for approvers — Marketing themselves never see this
    // panel, so there's no point loading it for them.
    canApprove ? getMarketingWilayahAssignments() : Promise.resolve([]),
    canApprove ? getMarketingUsers() : Promise.resolve([]),
  ]);

  // Marketing sees only their own progress here — Supervisor/Accounting/Super
  // Admin (the roles that actually approve/reject and monitor the team)
  // still see every marketing person's KPI, unchanged.
  const isPlainMarketing = !session.user.isSuperAdmin && session.user.roleId === MARKETING_ROLE_ID;
  const kpiRows = isPlainMarketing ? allKpiRows.filter((r) => r.UserID === session.user.id) : allKpiRows;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Pemasaran</h1>

      <MarketingKPIPanel rows={kpiRows} />

      {canApprove && <MarketingWilayahPanel assignments={wilayahAssignments} marketingUsers={marketingUsers} />}

      <PemasaranSection
        rows={rows}
        priceLevels={priceLevels}
        canApprove={canApprove}
        isSuperAdmin={session.user.isSuperAdmin}
      />
    </div>
  );
}
