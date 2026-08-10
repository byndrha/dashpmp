import { requireDriver } from "@/lib/require-access";
import { getDriverTimeline } from "@/lib/queries/pengiriman-jadwal";
import { getBusinessDateISO } from "@/lib/business-date";
import { DriverTabShell } from "@/components/driver-app/driver-tab-shell";

export default async function DriverRiwayatPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const timeline = salesmanId ? await getDriverTimeline(salesmanId, getBusinessDateISO()) : [];

  return (
    <DriverTabShell
      initialTab="riwayat"
      driverName={session.user.name ?? session.user.username}
      initialRiwayat={timeline}
      initialError={salesmanId ? undefined : "Akun ini belum ditautkan ke data Driver, hubungi Admin."}
    />
  );
}
