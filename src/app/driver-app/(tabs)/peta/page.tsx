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
    <div className="flex h-dvh flex-col">
      <div className="p-4 pb-0">
        <h1 className="font-display text-lg font-semibold">Peta Hari Ini</h1>
      </div>
      <div className="flex-1 p-4">
        <PetaOverviewMap pabrik={{ lat: pabrik.latitude, lng: pabrik.longitude }} routes={routes} />
      </div>
    </div>
  );
}
