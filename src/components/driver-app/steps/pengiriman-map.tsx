"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Geolocation } from "@capacitor/geolocation";
import { Locate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PengirimanMapContent = dynamic(() => import("./pengiriman-map-content"), { ssr: false });

const FOREGROUND_PING_INTERVAL_MS = 20_000;

export interface RecenterTarget {
  lat: number;
  lng: number;
  key: number;
}

// Owns live-position tracking + the "Lokasi Saya" recenter button; the
// Leaflet internals live in pengiriman-map-content.tsx (dynamic/ssr:false),
// same split as peta-overview-map.tsx.
export function PengirimanMap({
  origin,
  stops,
  className,
}: {
  origin: { lat: number; lng: number };
  stops: { lat: number; lng: number; label: number }[];
  className?: string;
}) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [recenter, setRecenter] = useState<RecenterTarget | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Foreground-only, higher-frequency position sampling while this screen
  // is open — deliberately separate from the app-wide 90s background ping
  // (LocationTrackingBootstrap, native-only) so the live truck marker/route
  // updates responsively without changing that global baseline elsewhere.
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

  async function handleLocateMe() {
    setLocateError(null);
    setLocating(true);
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      const { latitude, longitude } = pos.coords;
      setPosition({ lat: latitude, lng: longitude });
      setRecenter((prev) => ({ lat: latitude, lng: longitude, key: (prev?.key ?? 0) + 1 }));
    } catch {
      setLocateError("Gagal mengambil lokasi GPS.");
    } finally {
      setLocating(false);
    }
  }

  return (
    // relative z-0: contains Leaflet's internal panes AND MapZoomControl
    // (both z-1000) plus this wrapper's own locate-me button/error text in
    // ONE local stacking context — confirmed necessary live on the Peta
    // tab (peta-overview-map-content.tsx's identical wrapper): without it,
    // z-1000 here competes directly against PengirimanStep's floating top
    // bar/bottom sheet AND against any real <Dialog> (z-50), which loses
    // that comparison and renders invisibly behind this map.
    <div className={cn("relative z-0 h-full w-full", className)}>
      <PengirimanMapContent origin={origin} stops={stops} position={position} recenter={recenter} />
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="absolute top-44 right-2 z-1000 size-8 bg-card shadow-md dark:bg-card"
        onClick={handleLocateMe}
        disabled={locating}
        title="Lokasi Saya"
      >
        <Locate className={cn("size-3.5", locating && "animate-spin")} />
      </Button>
      {locateError && (
        <p className="absolute bottom-2 left-2 z-1000 max-w-64 rounded bg-destructive/90 px-2 py-1 text-[10px] text-destructive-foreground shadow-md">
          {locateError}
        </p>
      )}
    </div>
  );
}
