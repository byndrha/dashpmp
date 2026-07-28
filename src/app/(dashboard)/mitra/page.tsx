import { requireModuleAccess } from "@/lib/require-access";
import { getMitraList, getTermOfPaymentOptions, getPriceLevelOptions } from "@/lib/queries/mitra";
import { getMitraGrowthByWilayah } from "@/lib/queries/mitra-growth";
import { MitraList } from "@/components/dashboard/mitra-list";
import { MitraLocationsPanel } from "@/components/dashboard/mitra-locations-panel";

export default async function MitraPage() {
  await requireModuleAccess("mitra");
  const [mitra, termOptions, priceLevels, growth] = await Promise.all([
    getMitraList(),
    getTermOfPaymentOptions(),
    getPriceLevelOptions(),
    getMitraGrowthByWilayah(),
  ]);

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

      <MitraList mitra={mitra} termOptions={termOptions} priceLevels={priceLevels} />
    </div>
  );
}
