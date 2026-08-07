import { notFound } from "next/navigation";
import { requireDriver } from "@/lib/require-access";
import { getDriverJadwalStops, assertOwnsJadwal } from "@/lib/queries/pengiriman-jadwal";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { StopFlow } from "@/components/driver-app/stop-flow";

export default async function DriverJadwalPage({ params }: { params: Promise<{ jadwalId: string }> }) {
  const { jadwalId } = await params;
  const session = await requireDriver();
  const id = Number(jadwalId);
  if (!Number.isInteger(id)) notFound();

  // Every driver-app server action keyed by JadwalID gates on
  // assertOwnsJadwal (see actions.ts, added by the IDOR fix in
  // 2310feb) — this Server Component reads the same per-driver data
  // directly via getDriverJadwalStops and was missed by that fix, so
  // any authenticated driver could view another driver's stop list
  // (customer names/addresses, order items, quantities) by changing
  // the numeric id in the URL. notFound() (not a thrown AppError) both
  // matches the existing not-found convention just below and avoids
  // confirming to an unauthorized viewer whether the JadwalID exists —
  // and this route group has no error.tsx, so a thrown error here
  // would otherwise surface as the generic Next.js error page instead
  // of an Indonesian message.
  if (!session.user.salesmanId) notFound();
  try {
    await assertOwnsJadwal(id, session.user.salesmanId);
  } catch {
    notFound();
  }

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
