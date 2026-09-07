import type { Metadata } from "next";
import { requireDriver } from "@/lib/require-access";
import { getBusinessDateISO } from "@/lib/business-date";
import { getDriverJadwalList } from "@/lib/queries/pengiriman-jadwal";
import { getDriverProfiles } from "@/lib/queries/driver-profile";
import { DriverTabShell } from "@/components/driver-app/driver-tab-shell";

export const metadata: Metadata = { title: "Tugas" };

export default async function DriverTugasPage() {
  const session = await requireDriver();
  const todayISO = getBusinessDateISO();
  const salesmanId = session.user.salesmanId;
  const [jadwal, profile] = await Promise.all([
    salesmanId ? getDriverJadwalList(salesmanId, todayISO) : Promise.resolve([]),
    salesmanId ? getDriverProfiles().then((rows) => rows.find((d) => d.SalesmanID === salesmanId) ?? null) : Promise.resolve(null),
  ]);

  return (
    <DriverTabShell
      initialTab="tugas"
      driverName={session.user.name ?? session.user.username}
      driverProfile={profile}
      initialTugas={{ dateISO: todayISO, jadwal }}
      initialError={salesmanId ? undefined : "Akun ini belum ditautkan ke data Driver, hubungi Admin."}
    />
  );
}
