import { requireModuleAccess } from "@/lib/require-access";
import { getPengajuanList, getMarketingKPI, APPROVER_ROLE_IDS, MARKETING_ROLE_ID } from "@/lib/queries/mitra-pengajuan";
import { getPriceLevelOptions } from "@/lib/queries/mitra";
import { MarketingKPIPanel } from "@/components/dashboard/marketing-kpi-panel";
import { PemasaranSection } from "@/components/dashboard/pemasaran-section";

export default async function PemasaranPage() {
  const session = await requireModuleAccess("pemasaran");
  const [rows, allKpiRows, priceLevels] = await Promise.all([
    getPengajuanList(),
    getMarketingKPI(),
    getPriceLevelOptions(),
  ]);

  const canApprove = session.user.isSuperAdmin || APPROVER_ROLE_IDS.includes(session.user.roleId);

  // Marketing sees only their own progress here — Supervisor/Accounting/Super
  // Admin (the roles that actually approve/reject and monitor the team)
  // still see every marketing person's KPI, unchanged.
  const isPlainMarketing = !session.user.isSuperAdmin && session.user.roleId === MARKETING_ROLE_ID;
  const kpiRows = isPlainMarketing ? allKpiRows.filter((r) => r.UserID === session.user.id) : allKpiRows;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Pemasaran</h1>

      <MarketingKPIPanel rows={kpiRows} />

      <PemasaranSection
        rows={rows}
        priceLevels={priceLevels}
        canApprove={canApprove}
        isSuperAdmin={session.user.isSuperAdmin}
      />
    </div>
  );
}
