import { requireModuleAccess } from "@/lib/require-access";
import { getPengajuanList, getMarketingKPI, APPROVER_ROLE_IDS, MARKETING_ROLE_ID } from "@/lib/queries/mitra-pengajuan";
import { getPriceLevelOptions } from "@/lib/queries/mitra";
import {
  getMarketingWilayahAssignments,
  getMarketingUsers,
  getMarketingMitraAssignments,
  getMitraOptions,
} from "@/lib/queries/marketing-wilayah";
import { getMarketingPerformance } from "@/lib/queries/marketing-performance";
import { getPemasaranWilayahDelivery } from "@/lib/queries/pemasaran-wilayah-delivery";
import { WILAYAH_MANAGER_ROLE_IDS, STAFF_ROLE_ID } from "@/lib/roles";
import { PemasaranSection } from "@/components/dashboard/pemasaran-section";
import { MarketingWilayahPanel } from "@/components/dashboard/marketing-wilayah-panel";
import { MarketingPerformancePanel } from "@/components/dashboard/marketing-performance-panel";
import { PemasaranWilayahDeliveryPanel } from "@/components/dashboard/pemasaran-wilayah-delivery-panel";

export default async function PemasaranPage() {
  const session = await requireModuleAccess("pemasaran");
  const canApprove = session.user.isSuperAdmin || APPROVER_ROLE_IDS.includes(session.user.roleId);
  // Who can see/manage Cakupan Wilayah Marketing — Supervisor/Accounting/
  // Manager/Super Admin, deliberately separate from canApprove (Pengajuan
  // approve/reject), per explicit request.
  const canManageWilayah = session.user.isSuperAdmin || WILAYAH_MANAGER_ROLE_IDS.includes(session.user.roleId);
  // Kinerja Marketing is explicitly hidden from Staff — everyone else
  // (Marketing, Supervisor, Accounting, Manager, Super Admin) still sees it.
  const canViewKinerjaMarketing = !(session.user.roleId === STAFF_ROLE_ID && !session.user.isSuperAdmin);

  const [rows, allKpiRows, priceLevels, wilayahAssignments, marketingUsers, mitraAssignments, mitraOptions, performance, wilayahDelivery] =
    await Promise.all([
      getPengajuanList(),
      getMarketingKPI(),
      getPriceLevelOptions(),
      // Only fetched for those who can manage it — Marketing themselves never
      // see this panel, so there's no point loading it for them.
      canManageWilayah ? getMarketingWilayahAssignments() : Promise.resolve([]),
      canManageWilayah ? getMarketingUsers() : Promise.resolve([]),
      // Priority per-mitra assignments are shown to everyone (collapsed, in
      // Kinerja Marketing) but only fetched with the searchable Mitra list
      // (mitraOptions) when the management dialog is actually available.
      getMarketingMitraAssignments(),
      canManageWilayah ? getMitraOptions() : Promise.resolve([]),
      // Staff can't see Kinerja Marketing at all — no point querying it.
      canViewKinerjaMarketing ? getMarketingPerformance() : Promise.resolve(null),
      getPemasaranWilayahDelivery(),
    ]);

  // Marketing sees only their own progress here — Supervisor/Accounting/Super
  // Admin (the roles that actually approve/reject and monitor the team)
  // still see every marketing person's KPI, unchanged.
  const isPlainMarketing = !session.user.isSuperAdmin && session.user.roleId === MARKETING_ROLE_ID;
  const kpiRows = isPlainMarketing ? allKpiRows.filter((r) => r.UserID === session.user.id) : allKpiRows;
  const performanceForSession =
    isPlainMarketing && performance
      ? { ...performance, cells: performance.cells.filter((c) => c.MarketingUserID === session.user.id) }
      : performance;
  const mitraAssignmentsForSession = isPlainMarketing
    ? mitraAssignments.filter((a) => a.MarketingUserID === session.user.id)
    : mitraAssignments;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pemasaran</h1>
        {canManageWilayah && (
          <MarketingWilayahPanel
            assignments={wilayahAssignments}
            mitraAssignments={mitraAssignments}
            marketingUsers={marketingUsers}
            mitraOptions={mitraOptions}
          />
        )}
      </div>

      {canViewKinerjaMarketing && performanceForSession && (
        <MarketingPerformancePanel
          data={performanceForSession}
          kpiRows={kpiRows}
          canManageSettings={canManageWilayah}
          mitraAssignments={mitraAssignmentsForSession}
        />
      )}

      <PemasaranWilayahDeliveryPanel
        data={wilayahDelivery}
        canEditTarget={canManageWilayah}
        isSuperAdmin={session.user.isSuperAdmin}
      />

      <PemasaranSection
        rows={rows}
        priceLevels={priceLevels}
        canApprove={canApprove}
        isSuperAdmin={session.user.isSuperAdmin}
      />
    </div>
  );
}
