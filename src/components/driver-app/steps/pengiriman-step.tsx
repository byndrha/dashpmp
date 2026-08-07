"use client";

import { useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import { recordStopArrivalAction } from "@/app/driver-app/actions";

const PengirimanMapContent = dynamic(() => import("./pengiriman-map-content"), { ssr: false });

const FOREGROUND_PING_INTERVAL_MS = 20_000;

export function PengirimanStep({
  jadwalId,
  stop,
  remainingCount,
  pabrik,
  driverName,
  onArrived,
}: {
  jadwalId: number;
  stop: DriverStopRow;
  remainingCount: number;
  pabrik: { lat: number; lng: number };
  driverName: string;
  onArrived: () => void;
}) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Foreground-only, higher-frequency position sampling while this screen
  // is open — deliberately separate from the app-wide 90s background
  // ping (LocationTrackingBootstrap, native-only) so the live route/marker
  // on this screen updates responsively without changing that global
  // baseline for every other screen/account.
  useEffect(() => {
    if (!navigator.geolocation) return;
    function poll() {
      navigator.geolocation.getCurrentPosition(
        (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true }
      );
    }
    poll();
    const intervalId = setInterval(poll, FOREGROUND_PING_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  function handleArrived() {
    setError(null);
    startTransition(async () => {
      const result = await recordStopArrivalAction(stop.JadwalDetailID);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onArrived();
    });
  }

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <ArrowLeft className="size-5" />
        <div>
          <p className="text-sm font-medium">{driverName}</p>
          <p className="text-xs text-muted-foreground">Jadwal #{jadwalId}</p>
        </div>
      </div>
      <div className="flex-1">
        <PengirimanMapContent pabrik={pabrik} stop={stop} position={position} />
      </div>
      <div className="flex flex-col gap-2 border-t border-border p-4">
        <div>
          <p className="text-sm font-medium">{stop.CustomerName}</p>
          <p className="text-xs text-muted-foreground">
            {stop.Alamat ?? "-"} &mdash; {stop.Wilayah}
          </p>
          <p className="text-xs text-muted-foreground">{remainingCount} lokasi tersisa</p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={pending} onClick={handleArrived}>
          {pending ? "Memproses..." : "Geser untuk Tiba"}
        </Button>
      </div>
    </div>
  );
}
