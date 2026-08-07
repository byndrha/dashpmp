"use client";

import { useState, useTransition } from "react";
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

  function handleDateChange(next: string) {
    setDateISO(next);
    setError(null);
    startTransition(async () => {
      const result = await getDriverJadwalListAction(next);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setJadwal(result.data);
    });
  }

  const totalHariKerja = new Set(jadwal.map((j) => String(j.JamJadwal).slice(0, 10))).size;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Card size="sm">
          <CardContent className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-[10px] uppercase text-muted-foreground">Total Hari Kerja</span>
            <span className="text-lg font-semibold">{totalHariKerja} Hari</span>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-[10px] uppercase text-muted-foreground">Tugas Hari Ini</span>
            <span className="text-lg font-semibold">{jadwal.length}</span>
          </CardContent>
        </Card>
      </div>

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
