import { requireDriver } from "@/lib/require-access";
import { getDriverJadwalHistory } from "@/lib/queries/pengiriman-jadwal";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatTime } from "@/lib/format";

export default async function DriverRiwayatPage() {
  const session = await requireDriver();
  const salesmanId = session.user.salesmanId;
  const history = salesmanId ? await getDriverJadwalHistory(salesmanId) : [];

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Riwayat</h1>
      {!salesmanId && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Akun ini belum ditautkan ke data Driver, hubungi Admin.
        </p>
      )}
      {history.map((j) => (
        <Card key={j.JadwalID} className="py-3">
          <CardContent className="flex flex-col gap-1 px-4">
            <p className="text-sm font-medium">
              {formatDate(j.JamJadwal)} &mdash; {formatTime(j.JamJadwal)}
            </p>
            <p className="text-xs text-muted-foreground">
              {j.ArmadaNama} {j.VehicleNo ? `• ${j.VehicleNo}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {j.TotalStop} lokasi &mdash; {j.TotalKantong} kantong
            </p>
          </CardContent>
        </Card>
      ))}
      {history.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Belum ada riwayat pengiriman.</p>}
    </div>
  );
}
