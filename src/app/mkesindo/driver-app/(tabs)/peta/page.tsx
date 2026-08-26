import type { Metadata } from "next";
import { requireDriver } from "@/lib/require-access";
import { getBusinessDateISO } from "@/lib/business-date";
import { getDriverJadwalList, getDriverJadwalStops } from "@/lib/queries/pengiriman-jadwal";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { DriverTabShell } from "@/components/driver-app/driver-tab-shell";

export const metadata: Metadata = { title: "Peta" };

export default async function DriverPetaPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const pabrik = await getPabrikLocation();

  if (!salesmanId) {
    return (
      <DriverTabShell
        initialTab="peta"
        driverName={session.user.name ?? session.user.username}
        initialPeta={{ pabrik: { lat: pabrik.latitude, lng: pabrik.longitude }, routes: [] }}
        initialError="Akun ini belum ditautkan ke data Driver, hubungi Admin."
      />
    );
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
    <DriverTabShell
      initialTab="peta"
      driverName={session.user.name ?? session.user.username}
      initialPeta={{ pabrik: { lat: pabrik.latitude, lng: pabrik.longitude }, routes }}
    />
  );
}
