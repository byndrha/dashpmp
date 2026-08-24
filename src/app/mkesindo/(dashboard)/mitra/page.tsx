import { auth } from "@/lib/auth";
import { requireModuleAccess } from "@/lib/require-access";
import { getMitraList, getTermOfPaymentOptions, getPriceLevelOptions } from "@/lib/queries/mitra";
import { getMitraGrowthByWilayah } from "@/lib/queries/mitra-growth";
import { getMarketingUsers, getDriverUserOptions, getMarketingMitraAssignments } from "@/lib/queries/marketing-wilayah";
import { WILAYAH_MANAGER_ROLE_IDS } from "@/lib/roles";
import { MitraList } from "@/components/dashboard/mitra-list";
import { MitraLocationsPanel } from "@/components/dashboard/mitra-locations-panel";

export default async function MitraPage() {
  await requireModuleAccess("mitra");
  const session = await auth();
  const user = session?.user;
  // Same role gate as setMitraPemilikAction (mitra/actions.ts) — the
  // dropdown itself is only fetched/rendered for a session that could
  // actually save a change through it.
  const canEditPemilik = !!user && (user.isSuperAdmin || WILAYAH_MANAGER_ROLE_IDS.includes(user.roleId));

  const [mitra, termOptions, priceLevels, growth, pemilikData] = await Promise.all([
    getMitraList(),
    getTermOfPaymentOptions(),
    getPriceLevelOptions(),
    getMitraGrowthByWilayah(),
    canEditPemilik
      ? Promise.all([getMarketingUsers(), getDriverUserOptions(), getMarketingMitraAssignments()])
      : Promise.resolve(null),
  ]);
  const pemilikOptions = pemilikData ? { marketing: pemilikData[0], driver: pemilikData[1] } : { marketing: [], driver: [] };
  // Only an EXPLICIT Mitra Prioritas override counts as "current Pemilik"
  // here — MitraRow.MarketingNama (used for display elsewhere) is the
  // resolved effective name, which can come from Wilayah/Kecamatan
  // fallback instead of a real override, and has no matching akun.id to
  // pre-fill the dropdown with.
  const currentPemilikMap: Record<string, string> = {};
  if (pemilikData) {
    for (const a of pemilikData[2]) currentPemilikMap[a.BusinessPartnerID] = a.MarketingUserID;
  }

  // Reuses getMitraList()'s existing Latitude/Longitude (from
  // DashboardMitraLocation) — no separate query needed. Deactivated
  // (IsSuspended) mitra are excluded — they've been hidden from operational
  // pickers already, the map should treat them the same way.
  const locations = mitra
    .filter(
      (m): m is typeof m & { Latitude: number; Longitude: number } =>
        m.Latitude != null && m.Longitude != null && !m.IsSuspended
    )
    .map((m) => ({ BusinessPartnerID: m.BusinessPartnerID, Name: m.Name, Wilayah: m.Wilayah, Latitude: m.Latitude, Longitude: m.Longitude }));

  return (
    <div className="flex flex-col gap-4">
      <MitraLocationsPanel points={locations} growthRows={growth} />

      <MitraList
        mitra={mitra}
        termOptions={termOptions}
        priceLevels={priceLevels}
        canEditPemilik={canEditPemilik}
        pemilikOptions={pemilikOptions}
        currentPemilikMap={currentPemilikMap}
      />
    </div>
  );
}
