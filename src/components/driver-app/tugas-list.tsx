"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatTime } from "@/lib/format";
import type { DriverJadwalCard } from "@/lib/queries/pengiriman-jadwal";
import { getDriverJadwalListAction } from "@/app/driver-app/actions";

function statusLabel(j: DriverJadwalCard): { label: string; variant: "outline" | "default" | "secondary" } {
  if (j.IsSelesai) return { label: "Selesai", variant: "secondary" };
  if (j.JamAktualBerangkat) return { label: "Dalam Pengiriman", variant: "default" };
  if (j.JamSelesaiMuat) return { label: "Menunggu Keberangkatan", variant: "outline" };
  if (j.Status === "Draft") return { label: "Dijadwalkan", variant: "outline" };
  return { label: "Proses Muat", variant: "outline" };
}

export function TugasList({
  initialJadwal,
  initialDateISO,
}: {
  initialJadwal: DriverJadwalCard[];
  initialDateISO: string;
}) {
  const [jadwal, setJadwal] = useState(initialJadwal);
  const [dateISO, setDateISO] = useState(initialDateISO);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Guards against a stale response overwriting a newer one when the date
  // picker is changed twice in quick succession (nothing disables the
  // Input while pending). Same pattern as
  // ubah-tanggal-pemesanan-dialog.tsx's targetIdRef: capture which date
  // this in-flight request is FOR, and discard the result if a newer
  // request has since superseded it.
  const requestedDateRef = useRef(initialDateISO);

  function handleDateChange(next: string) {
    requestedDateRef.current = next;
    setDateISO(next);
    setError(null);
    startTransition(async () => {
      const result = await getDriverJadwalListAction(next);
      if (requestedDateRef.current !== next) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setJadwal(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* "Total Hari Kerja" stat card was removed here: getDriverJadwalList
          filters to a single date, so a distinct-day count over `jadwal`
          could only ever be 0 or 1 — not a meaningful metric. A real
          multi-day count needs historical data out of scope for this
          single-date Tugas view (belongs in Riwayat instead). */}
      <Card size="sm" className="w-fit">
        <CardContent className="flex flex-col gap-0.5 px-3 py-2">
          <span className="text-[10px] uppercase text-muted-foreground">Tugas Hari Ini</span>
          <span className="text-lg font-semibold">{jadwal.length}</span>
        </CardContent>
      </Card>

      <Input type="date" value={dateISO} onChange={(e) => handleDateChange(e.target.value)} className="w-fit" />

      {error && <p className="text-sm text-destructive">{error}</p>}
      {pending && <p className="text-sm text-muted-foreground">Memuat...</p>}

      <div className="flex flex-col gap-3">
        {jadwal.map((j) => {
          const status = statusLabel(j);
          return (
            <Link key={j.JadwalID} href={`/driver-app/jadwal/${j.JadwalID}`}>
              <Card className="py-3">
                <CardContent className="flex flex-col gap-1.5 px-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{formatTime(j.JamJadwal)}</span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {j.ArmadaNama} {j.VehicleNo ? `• ${j.VehicleNo}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {j.StopSelesai}/{j.TotalStop} lokasi selesai &mdash; {j.TotalKantong} kantong
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {jadwal.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada tugas untuk tanggal ini.</p>
        )}
      </div>
    </div>
  );
}
