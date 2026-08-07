import { requireDriver } from "@/lib/require-access";
import { getBusinessDateISO } from "@/lib/business-date";
import { getDriverJadwalList } from "@/lib/queries/pengiriman-jadwal";
import { TugasList } from "@/components/driver-app/tugas-list";

export default async function DriverTugasPage() {
  const session = await requireDriver();
  const todayISO = getBusinessDateISO();
  const salesmanId = session.user.salesmanId;
  const jadwal = salesmanId ? await getDriverJadwalList(salesmanId, todayISO) : [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-lg font-semibold">Beranda Driver</h1>
      {!salesmanId && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Akun ini belum ditautkan ke data Driver, hubungi Admin.
        </p>
      )}
      <TugasList initialJadwal={jadwal} initialDateISO={todayISO} />
    </div>
  );
}
