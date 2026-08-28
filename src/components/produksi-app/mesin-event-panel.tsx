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
      <CardContent className="grid grid-cols-3 gap-3">
        {mesinList.map((m) => {
          const mesinEvents = events.filter(
            (e) => e.mesinId === m.MesinID
          );

          const lastEvent =
            mesinEvents.length > 0
              ? [...mesinEvents].sort(
                  (a, b) =>
                    new Date(b.waktuEvent).getTime() -
                    new Date(a.waktuEvent).getTime()
                )[0]
              : null;

          return (
            <div
              key={m.MesinID}
              className="flex h-full flex-col rounded-md border p-3 pt-[8px]"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium">
                  {m.Nama}
                </span>

                {/* Tombol mepet border kanan & atas */}
                <div className="-mr-3 -mt-3 flex shrink-0 gap-1">
                  {(!lastEvent || lastEvent.jenisEvent === "Off") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-none rounded-bl-md rounded-tr-md"
                      disabled={pending}
                      onClick={() => handleToggle(m.MesinID, "On")}
                    >
                      ON
                    </Button>
                  )}

                  {lastEvent?.jenisEvent === "On" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-none rounded-bl-md rounded-tr-md"
                      disabled={pending}
                      onClick={() => handleToggle(m.MesinID, "Off")}
                    >
                      OFF
                    </Button>
                  )}
                </div>
              </div>

              {/* Detail event */}
              <div className="mt-3 flex flex-col gap-1 border-t pt-2 text-xs">
                {mesinEvents.map((e) => (
                  <p
                    key={e.eventId}
                    className="text-muted-foreground"
                  >
                    {formatJamNaiveWib(e.waktuEvent)} — {e.jenisEvent}
                  </p>
                ))}

                {mesinEvents.length === 0 && (
                  <p className="text-muted-foreground">
                    Tanpa Catatan
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
