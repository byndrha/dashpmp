"use client";

import { Card, CardContent } from "@/components/ui/card";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
import { formatTime } from "@/lib/format";
import type { AuditLogRow } from "@/lib/queries/produksi-bak-pmpersada";

export function RiwayatProduksiAppView({ entries }: { entries: AuditLogRow[] }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Riwayat Saya</h1>
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Belum ada aktivitas.</p>
      ) : (
        <VerticalTimeline>
          {entries.map((e, i) => (
            <VerticalTimelineItem key={e.LogID} time={formatTime(e.CreatedDate)} isLast={i === entries.length - 1}>
              <Card className="py-3">
                <CardContent className="flex flex-col gap-1 px-4">
                  <p className="text-sm font-medium">
                    {e.BakNama} Rek {e.NomorRek}
                  </p>
                  <p className="text-xs text-muted-foreground">{e.AksiLabel}</p>
                </CardContent>
              </Card>
            </VerticalTimelineItem>
          ))}
        </VerticalTimeline>
      )}
    </div>
  );
}
