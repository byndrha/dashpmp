"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Geolocation } from "@capacitor/geolocation";
import { Locate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MapStyleSwitcher } from "@/components/dashboard/map-controls";
import { cn } from "@/lib/utils";
import type { MapStyle } from "@/lib/map-styles";
import type { MultiPointRoute } from "@/lib/osrm";

const PengirimanMapContent = dynamic(() => import("./pengiriman-map-content"), { ssr: false });

export interface RecenterTarget {
  lat: number;
  lng: number;
  key: number;
}

// Gap kept between the floating controls and the bottom sheet's current
// (possibly mid-drag) top edge.
const CONTROL_GAP = 12;
const LOCATE_BUTTON_HEIGHT = 32;

// Owns map style + the "Lokasi Saya" recenter button; live position
// tracking now lives in PengirimanStep (shared with its ETA/distance-list
// calculations), passed in as a controlled prop instead of watched here.
export function PengirimanMap({
  origin,
  stops,
  route,
  position,
  onPositionChange,
  bottomOffset,
  className,
}: {
  origin: { lat: number; lng: number };
  stops: { lat: number; lng: number; label: number }[];
  route: MultiPointRoute | null;
  position: { lat: number; lng: number } | null;
  onPositionChange: (pos: { lat: number; lng: number }) => void;
  // Current height (px) of PengirimanStep's bottom sheet — the locate/style
  // controls sit just above its top edge and must move with it live during
  // a drag, not just after it settles.
  bottomOffset: number;
  className?: string;
}) {
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const [recenter, setRecenter] = useState<RecenterTarget | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  async function handleLocateMe() {
    setLocateError(null);
    setLocating(true);
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      const { latitude, longitude } = pos.coords;
      onPositionChange({ lat: latitude, lng: longitude });
      setRecenter((prev) => ({ lat: latitude, lng: longitude, key: (prev?.key ?? 0) + 1 }));
    } catch {
      setLocateError("Gagal mengambil lokasi GPS.");
    } finally {
      setLocating(false);
    }
  }

  const controlsBottom = bottomOffset + CONTROL_GAP;

  return (
    // relative z-0: contains Leaflet's internal panes (z-1000) plus this
    // wrapper's own floating controls in ONE local stacking context —
    // confirmed necessary live (see peta-overview-map-content.tsx and this
    // screen's earlier Dialog-invisible-behind-map bug): without it, these
    // z-1000 controls compete directly against PengirimanStep's own
    // floating chrome and any real <Dialog> (z-50).
    <div className={cn("relative z-0 h-full w-full", className)}>
      <PengirimanMapContent origin={origin} stops={stops} route={route} position={position} mapStyle={mapStyle} recenter={recenter} />
      <MapStyleSwitcher
        mapStyle={mapStyle}
        onChange={setMapStyle}
        className="right-2 flex-col"
        style={{ bottom: controlsBottom + LOCATE_BUTTON_HEIGHT + CONTROL_GAP }}
      />
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="absolute right-2 z-1000 size-8 bg-card shadow-md dark:bg-card"
        style={{ bottom: controlsBottom }}
        onClick={handleLocateMe}
        disabled={locating}
        title="Lokasi Saya"
      >
        <Locate className={cn("size-3.5", locating && "animate-spin")} />
      </Button>
      {locateError && (
        <p
          className="absolute left-2 z-1000 max-w-64 rounded bg-destructive/90 px-2 py-1 text-[10px] text-destructive-foreground shadow-md"
          style={{ bottom: controlsBottom }}
        >
          {locateError}
        </p>
      )}
    </div>
  );
}
