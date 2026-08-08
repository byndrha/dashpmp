import { requireDriver } from "@/lib/require-access";
import { getBusinessDateISO } from "@/lib/business-date";
import { getDriverJadwalList } from "@/lib/queries/pengiriman-jadwal";
import { DriverTabShell } from "@/components/driver-app/driver-tab-shell";

export default async function DriverTugasPage() {
  const session = await requireDriver();
  const todayISO = getBusinessDateISO();
  const salesmanId = session.user.salesmanId;
  const jadwal = salesmanId ? await getDriverJadwalList(salesmanId, todayISO) : [];

  return (
    <DriverTabShell
      initialTab="tugas"
      driverName={session.user.name ?? session.user.username}
      initialTugas={{ dateISO: todayISO, jadwal }}
      initialError={salesmanId ? undefined : "Akun ini belum ditautkan ke data Driver, hubungi Admin."}
    />
  );
}
