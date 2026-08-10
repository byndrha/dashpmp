"use client";

import { Fuel, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
import { formatTime } from "@/lib/format";
import type { DriverTimelineEntry } from "@/lib/queries/pengiriman-jadwal";

export function RiwayatList({ entries }: { entries: DriverTimelineEntry[] }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Riwayat</h1>
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Belum ada aktivitas hari ini.</p>
      ) : (
        <VerticalTimeline>
          {entries.map((e, i) => (
            <VerticalTimelineItem key={e.jadwalId} time={formatTime(e.jamAktualBerangkat)} isLast={i === entries.length - 1}>
              <Card className="py-3">
                <CardContent className="flex flex-col gap-1 px-4">
                  <p className="text-sm font-medium">
                    {e.armadaNama} {e.vehicleNo ? `• ${e.vehicleNo}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.totalStop} lokasi &mdash; {e.totalKantong} kantong
                  </p>
                  {e.bbm.map((b, bi) => (
                    <p key={bi} className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Fuel className="size-3" /> Isi BBM {formatTime(b.waktuIsi ?? b.waktuMasukSpbu)}
                    </p>
                  ))}
                  {e.kendala.map((k, ki) => (
                    <p key={ki} className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="size-3" /> Kendala: {k.jenisKendala} {formatTime(k.waktuLapor)}
                    </p>
                  ))}
                </CardContent>
              </Card>
            </VerticalTimelineItem>
          ))}
        </VerticalTimeline>
      )}
    </div>
  );
}
