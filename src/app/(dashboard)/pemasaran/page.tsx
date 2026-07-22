import { requireModuleAccess } from "@/lib/require-access";
import { getPengajuanList, getMarketingKPI, APPROVER_ROLE_IDS } from "@/lib/queries/mitra-pengajuan";
import { getPriceLevelOptions } from "@/lib/queries/mitra";
import { MarketingKPIPanel } from "@/components/dashboard/marketing-kpi-panel";
import { PemasaranSection } from "@/components/dashboard/pemasaran-section";

export default async function PemasaranPage() {
  const session = await requireModuleAccess("pemasaran");
  const [rows, kpiRows, priceLevels] = await Promise.all([
    getPengajuanList(),
    getMarketingKPI(),
    getPriceLevelOptions(),
  ]);

  const canApprove = session.user.isSuperAdmin || APPROVER_ROLE_IDS.includes(session.user.roleId);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Pemasaran</h1>

      <MarketingKPIPanel rows={kpiRows} />

      <PemasaranSection rows={rows} priceLevels={priceLevels} canApprove={canApprove} />
    </div>
  );
}
