import { requireModuleAccess } from "@/lib/require-access";
import { getMitraList, getTermOfPaymentOptions, getPriceLevelOptions } from "@/lib/queries/mitra";
import { getMitraGrowthByWilayah } from "@/lib/queries/mitra-growth";
import { MitraList } from "@/components/dashboard/mitra-list";
import { MitraGrowthPanel } from "@/components/dashboard/mitra-growth-panel";
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
  // DashboardMitraLocation) — no separate query needed.
  const locations = mitra
    .filter((m): m is typeof m & { Latitude: number; Longitude: number } => m.Latitude != null && m.Longitude != null)
    .map((m) => ({ BusinessPartnerID: m.BusinessPartnerID, Name: m.Name, Wilayah: m.Wilayah, Latitude: m.Latitude, Longitude: m.Longitude }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Mitra</h1>

      {/* Map stacks ABOVE the growth panel on narrow screens (order-1 vs
          order-2), then swaps to growth-left/map-right once there's room
          side-by-side (lg:) — per explicit layout request. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="order-2 lg:order-1">
          <MitraGrowthPanel rows={growth} />
        </div>
        <div className="order-1 lg:order-2">
          <MitraLocationsPanel points={locations} />
        </div>
      </div>

      <MitraList mitra={mitra} termOptions={termOptions} priceLevels={priceLevels} />
    </div>
  );
}
