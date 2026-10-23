import { getMitraList } from "@/lib/queries/mitra-es-balok";
import { getMitraGrowthByWilayah } from "@/lib/queries/mitra-es-balok-growth";
import { getPabrikLocationByKode } from "@/lib/queries/perusahaan";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import { AgenLocationsPanel } from "@/components/dashboard/agen-locations-panel";
import { titikPetaAgen } from "@/lib/mitra-es-balok-form";
import { MitraPageClient } from "./mitra-page-client";

const KODE = "pmpersada";

export default async function PmpersadaMitraPage() {
  await requirePmpersadaKeuangan();
  const [cards, growthRows, pabrikLocation] = await Promise.all([
    getMitraList(KODE),
    getMitraGrowthByWilayah(KODE),
    getPabrikLocationByKode(KODE),
  ]);
  const centerFallback: [number, number] | undefined = pabrikLocation
    ? [pabrikLocation.latitude, pabrikLocation.longitude]
    : undefined;

  // Satu titik per lokasi pengiriman (utama + tambahan) mitra aktif.
  const points = titikPetaAgen(cards);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Mitra</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <AgenLocationsPanel points={points} growthRows={growthRows} centerFallback={centerFallback} />
      <MitraPageClient cards={cards} />
    </div>
  );
}
