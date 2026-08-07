"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Geolocation } from "@capacitor/geolocation";
import { Locate, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MapStyle } from "@/lib/map-styles";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

const MapContent = dynamic(() => import("./peta-overview-map-content"), { ssr: false });

const ROUTE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

export interface RecenterTarget {
  lat: number;
  lng: number;
  key: number;
}

export function PetaOverviewMap({
  pabrik,
  routes,
}: {
  pabrik: { lat: number; lng: number };
  routes: { jadwalId: number; stops: DriverStopRow[] }[];
}) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const [recenter, setRecenter] = useState<RecenterTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 15_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const coloredRoutes = useMemo(
    () => routes.map((r, i) => ({ ...r, color: ROUTE_COLORS[i % ROUTE_COLORS.length] })),
    [routes]
  );

  // Plain click/Enter handler, not a <form> — same reasoning as
  // mitra-location-field.tsx's identical search box (no surrounding form
  // on this page to conflict with anyway, but kept consistent).
  async function handleSearch() {
    const query = searchQuery.trim();
    if (!query) return;
    setSearchError(null);
    setSearching(true);
    try {
      const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setSearchError(data.error ?? "Lokasi tidak ditemukan.");
        return;
      }
      setRecenter((prev) => ({ lat: data.latitude, lng: data.longitude, key: (prev?.key ?? 0) + 1 }));
    } catch {
      setSearchError("Gagal mencari lokasi.");
    } finally {
      setSearching(false);
    }
  }

  // Explicit one-shot GPS fix via Capacitor (same plugin/error-handling
  // shape as mitra-location-field.tsx's "Pakai Lokasi Saya") rather than
  // waiting for the next background watchPosition tick — a driver tapping
  // this button expects an immediate response.
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
    <div className="relative h-full w-full">
      <MapContent
        pabrik={pabrik}
        routes={coloredRoutes}
        position={position}
        mapStyle={mapStyle}
        onMapStyleChange={setMapStyle}
        recenter={recenter}
      />
      {/* Bottom-left, mirrors mitra-location-field.tsx's search box exactly
          (same placeholder, same solid-card styling, same avoid-top-left-
          zoom-control reasoning). */}
      <div className="absolute bottom-2 left-2 z-1000 flex w-[calc(100%-56px)] max-w-64 gap-1">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearch();
            }
          }}
          placeholder="Cari lokasi..."
          className="h-8 bg-card text-xs shadow-md dark:bg-card"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8 shrink-0 bg-card shadow-md dark:bg-card"
          disabled={searching}
          onClick={handleSearch}
        >
          <Search className="size-3.5" />
        </Button>
      </div>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="absolute bottom-2 right-2 z-1000 size-8 bg-card shadow-md dark:bg-card"
        onClick={handleLocateMe}
        disabled={locating}
        title="Lokasi Saya"
      >
        <Locate className={cn("size-3.5", locating && "animate-spin")} />
      </Button>
      {(searchError ?? locateError) && (
        <p className="absolute bottom-12 left-2 z-1000 max-w-64 rounded bg-destructive/90 px-2 py-1 text-[10px] text-destructive-foreground shadow-md">
          {searchError ?? locateError}
        </p>
      )}
    </div>
  );
}
