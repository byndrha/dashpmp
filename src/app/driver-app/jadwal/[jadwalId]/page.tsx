import { notFound } from "next/navigation";
import { requireDriver } from "@/lib/require-access";
import { getDriverJadwalStops } from "@/lib/queries/pengiriman-jadwal";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { StopFlow } from "@/components/driver-app/stop-flow";

export default async function DriverJadwalPage({ params }: { params: Promise<{ jadwalId: string }> }) {
  const { jadwalId } = await params;
  const session = await requireDriver();
  const id = Number(jadwalId);
  if (!Number.isInteger(id)) notFound();

  const stops = await getDriverJadwalStops(id);
  if (stops.length === 0) notFound();

  const pabrik = await getPabrikLocation();

  return (
    <StopFlow
      jadwalId={id}
      initialStops={stops}
      pabrik={{ lat: pabrik.latitude, lng: pabrik.longitude }}
      driverName={session.user.name ?? session.user.username}
    />
  );
}
