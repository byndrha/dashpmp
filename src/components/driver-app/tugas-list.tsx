"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { History, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DriverJadwalCard } from "@/lib/queries/pengiriman-jadwal";
import type { DriverProfileRow } from "@/lib/queries/driver-profile";
import { getDriverJadwalListAction } from "@/app/mkesindo/driver-app/actions";
import { DriverJadwalCardItem } from "@/components/driver-app/jadwal-card";

export function TugasList({
  initialJadwal,
  initialDateISO,
  driverProfile,
  driverName,
}: {
  initialJadwal: DriverJadwalCard[];
  initialDateISO: string;
  driverProfile: DriverProfileRow | null;
  driverName: string;
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

  // Already-Berjalan Jadwal are rendered in their own sticky block above
  // the rest of the list -- the backend already floats them first in
  // `jadwal`, this just also pins them visually while scrolling.
  const berjalan = jadwal.filter((j) => j.IsBerjalan);
  const lainnya = jadwal.filter((j) => !j.IsBerjalan);

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Beranda Driver</h1>

      <div className="grid grid-cols-2 gap-2">
        <Card size="sm">
          <CardContent className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-[10px] uppercase text-muted-foreground">Profil</span>
            <span className="truncate text-sm font-semibold">{driverProfile?.Name ?? driverName}</span>
            <span className="truncate text-[11px] text-muted-foreground">
              {driverProfile && driverProfile.SimTypes.length > 0 ? `SIM ${driverProfile.SimTypes.join(", ")}` : "-"}
            </span>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-[10px] uppercase text-muted-foreground">Tugas Hari Ini</span>
            <span className="text-lg font-semibold">{jadwal.length}</span>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Input type="date" value={dateISO} onChange={(e) => handleDateChange(e.target.value)} className="flex-1" />
        <Button variant="outline" size="icon" render={<Link href="/mkesindo/driver-app/riwayat" />} title="Riwayat">
          <History className="size-4" />
        </Button>
        <Button variant="outline" size="icon" render={<Link href="/mkesindo/driver-app/pengajuan" />} title="Pengajuan Mitra">
          <ClipboardList className="size-4" />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {pending && <p className="text-sm text-muted-foreground">Memuat...</p>}

      <div className="flex flex-col gap-3">
        {berjalan.length > 0 && (
          <div className="sticky top-0 z-10 flex flex-col gap-3 bg-background pb-1">
            {berjalan.map((j) => (
              <DriverJadwalCardItem key={j.JadwalID} jadwal={j} />
            ))}
          </div>
        )}
        {lainnya.map((j) => (
          <DriverJadwalCardItem key={j.JadwalID} jadwal={j} />
        ))}
        {jadwal.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada tugas untuk tanggal ini.</p>
        )}
      </div>
    </div>
  );
}
