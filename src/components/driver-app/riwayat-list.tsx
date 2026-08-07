"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatTime } from "@/lib/format";
import type { DriverJadwalCard } from "@/lib/queries/pengiriman-jadwal";

export function RiwayatList({ history }: { history: DriverJadwalCard[] }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Riwayat</h1>
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
