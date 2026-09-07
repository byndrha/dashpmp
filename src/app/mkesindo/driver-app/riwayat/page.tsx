import type { Metadata } from "next";
import { requireDriver } from "@/lib/require-access";
import { getDriverJadwalList } from "@/lib/queries/pengiriman-jadwal";
import { getBusinessDateISO } from "@/lib/business-date";
import { RiwayatView } from "@/components/driver-app/riwayat-view";

export const metadata: Metadata = { title: "Riwayat" };

// A regular drill-down route now (reached via a button on the Tugas
// screen), not a bottom-nav tab -- same shape as pengajuan/page.tsx, no
// longer rendered through DriverTabShell's keep-alive tab mechanism.
export default async function DriverRiwayatPage() {
  const session = await requireDriver();
  const todayISO = getBusinessDateISO();
  const salesmanId = session.user.salesmanId;
  const jadwal = salesmanId ? await getDriverJadwalList(salesmanId, todayISO) : [];

  return <RiwayatView initialJadwal={jadwal} initialDateISO={todayISO} />;
}
