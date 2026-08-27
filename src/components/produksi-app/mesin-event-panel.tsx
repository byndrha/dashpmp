"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { MesinEventRow, JenisMesinEvent } from "@/lib/queries/produksi-mesin-event";
import { catatMesinEventAction } from "@/app/mkesindo/produksi/actions";

// WaktuEvent is naive-WIB (see catatMesinEvent's own comment) — reading
// with local Date getters here would be WRONG unless the browser's OS
// timezone happens to be WIB. Use UTC getters, matching every other
// naive-WIB display in this app (e.g. ubah-tanggal-pemesanan-dialog.tsx).
function formatJamNaiveWib(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function MesinEventPanel({
  mesinList,
  events,
  onChanged,
}: {
  mesinList: MesinRow[];
  events: MesinEventRow[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleToggle(mesinId: number, jenisEvent: JenisMesinEvent) {
    startTransition(async () => {
      const result = await catatMesinEventAction(mesinId, jenisEvent);
      if (result.success) onChanged();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Status Mesin</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {mesinList.map((m) => (
          <div key={m.MesinID} className="flex items-center justify-between gap-2 rounded-md border p-2">
            <span className="text-sm">{m.Nama}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => handleToggle(m.MesinID, "On")}>
                On
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => handleToggle(m.MesinID, "Off")}>
                Off
              </Button>
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-1 text-xs">
          {events.map((e) => {
            const mesin = mesinList.find((m) => m.MesinID === e.mesinId);
            return (
              <p key={e.eventId} className="text-muted-foreground">
                {formatJamNaiveWib(e.waktuEvent)} — {mesin?.Nama ?? "?"}: {e.jenisEvent}
              </p>
            );
          })}
          {events.length === 0 && <p className="text-muted-foreground">Belum ada kejadian shift ini.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
