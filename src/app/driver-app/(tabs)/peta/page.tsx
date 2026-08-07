import { requireDriver } from "@/lib/require-access";
import { getBusinessDateISO } from "@/lib/business-date";
import { getDriverJadwalList, getDriverJadwalStops } from "@/lib/queries/pengiriman-jadwal";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { PetaOverviewMap } from "@/components/driver-app/peta-overview-map";

export default async function DriverPetaPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const pabrik = await getPabrikLocation();

  if (!salesmanId) {
    return <p className="p-4 text-sm text-destructive">Akun ini belum ditautkan ke data Driver, hubungi Admin.</p>;
  }

  const todayISO = getBusinessDateISO();
  const jadwalList = await getDriverJadwalList(salesmanId, todayISO);
  const routes = await Promise.all(
    jadwalList.map(async (j) => ({
      jadwalId: j.JadwalID,
      stops: await getDriverJadwalStops(j.JadwalID),
    }))
  );

  return (
    // Explicit height, not h-full: confirmed live (DOM inspector showed the
    // Leaflet container at "425 x 0") that a plain `h-full` chain never
    // resolves here — this div's ancestor chain up to (tabs)/layout.tsx's
    // outer wrapper only has `min-h-dvh` (a minimum, not a definite height)
    // on a flex column, and a flex-1 child's own height isn't reliably
    // "definite" for percentage-height descendants to resolve against in
    // that setup. 4rem matches that layout's own `pb-16` reserved for the
    // fixed bottom nav.
    <div className="h-[calc(100dvh-4rem)] w-full">
      <PetaOverviewMap pabrik={{ lat: pabrik.latitude, lng: pabrik.longitude }} routes={routes} />
    </div>
  );
}
