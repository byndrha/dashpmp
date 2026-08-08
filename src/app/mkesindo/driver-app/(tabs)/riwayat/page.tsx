import { requireDriver } from "@/lib/require-access";
import { getDriverJadwalHistory } from "@/lib/queries/pengiriman-jadwal";
import { DriverTabShell } from "@/components/driver-app/driver-tab-shell";

export default async function DriverRiwayatPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const history = salesmanId ? await getDriverJadwalHistory(salesmanId) : [];

  return (
    <DriverTabShell
      initialTab="riwayat"
      driverName={session.user.name ?? session.user.username}
      initialRiwayat={history}
      initialError={salesmanId ? undefined : "Akun ini belum ditautkan ke data Driver, hubungi Admin."}
    />
  );
}
