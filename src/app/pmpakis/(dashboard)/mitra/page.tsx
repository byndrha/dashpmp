import { getMitraList, getWilayahOptions } from "@/lib/queries/mitra-es-balok";
import { getMitraGrowthByWilayah } from "@/lib/queries/mitra-es-balok-growth";
import { getPabrikLocationByKode } from "@/lib/queries/perusahaan";
import { requirePmpakis } from "@/lib/require-access";
import { AgenLocationsPanel } from "@/components/dashboard/agen-locations-panel";
import { MitraPageClient } from "./mitra-page-client";

const KODE = "pmpakis";

export default async function PmpakisMitraPage() {
  await requirePmpakis();
  const [cards, wilayahOptions, growthRows, pabrikLocation] = await Promise.all([
    getMitraList(KODE),
    getWilayahOptions(KODE, "utama"),
    getMitraGrowthByWilayah(KODE),
    getPabrikLocationByKode(KODE),
  ]);
  const centerFallback: [number, number] | undefined = pabrikLocation
    ? [pabrikLocation.latitude, pabrikLocation.longitude]
    : undefined;

  // Reuses getMitraList()'s existing Latitude/Longitude (from
  // DashboardAgenLocation) -- no separate query needed. Deactivated
  // (!isActive) Mitra are excluded, same as MKEsindo's own map.
  const points = cards
    .filter((c): c is typeof c & { latitude: number; longitude: number } => c.latitude != null && c.longitude != null && c.isActive)
    .map((c) => ({ agenId: c.agenId, nama: c.nama, wilayah: c.wilayah, latitude: c.latitude, longitude: c.longitude }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Mitra</h1>
        <p className="text-sm text-muted-foreground">PT Panen Mutiara Pakis — Es Balok</p>
      </div>
      <AgenLocationsPanel points={points} growthRows={growthRows} centerFallback={centerFallback} />
      <MitraPageClient cards={cards} wilayahOptions={wilayahOptions} />
    </div>
  );
}
