import { getMitraList } from "@/lib/queries/mitra-es-balok";
import { getMitraGrowthByWilayah } from "@/lib/queries/mitra-es-balok-growth";
import { getPabrikLocationByKode } from "@/lib/queries/perusahaan";
import { requirePmputra } from "@/lib/require-access";
import { AgenLocationsPanel } from "@/components/dashboard/agen-locations-panel";
import { titikPetaAgen } from "@/lib/mitra-es-balok-form";
import { MitraPageClient } from "./mitra-page-client";

const KODE = "pmputra";

export default async function PmputraMitraPage() {
  await requirePmputra();
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
      {/* Tanpa judul terlihat, sama dengan Mitra Es Kristal: peta di puncak
          halaman, tombol ☰ melayang di pojoknya. */}
      <h1 className="sr-only">Mitra</h1>
      <AgenLocationsPanel points={points} growthRows={growthRows} centerFallback={centerFallback} />
      <MitraPageClient cards={cards} />
    </div>
  );
}
