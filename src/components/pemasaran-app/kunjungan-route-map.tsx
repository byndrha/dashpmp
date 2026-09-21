"use client";

import "leaflet/dist/leaflet.css";
import { useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import L from "leaflet";
import { LocateFixed, Route as RouteIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";

// Leaflet's default marker icon paths resolve relative to the bundler's
// asset pipeline and break under Next.js/Webpack unless overridden -- point
// them at the CDN copy instead (same package version already installed).
// https://github.com/Leaflet/Leaflet/issues/4968
const mitraIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const myLocationIcon = L.divIcon({
  className: "",
  html: '<div style="background:#2563eb;width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export interface RouteInfo {
  distanceKm: number;
  durationMinutes: number;
}

export function KunjunganRouteMap({
  mitraLat,
  mitraLng,
  marketingPosition,
  onLocate,
  onGenerateRute,
  routeInfo,
  routeLoading,
  routeError,
}: {
  mitraLat: number;
  mitraLng: number;
  marketingPosition: [number, number] | null;
  onLocate: (lat: number, lng: number) => void;
  onGenerateRute: () => void;
  routeInfo: RouteInfo | null;
  routeLoading: boolean;
  routeError: string | null;
}) {
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const [locating, setLocating] = useState(false);
  const tile = TILE_SOURCES[mapStyle];
  const center: [number, number] = marketingPosition ?? [mitraLat, mitraLng];

  function handleLocate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocate(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="relative z-0">
      <MapContainer
        center={center}
        zoom={14}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        style={{ height: 280, width: "100%", borderRadius: "var(--radius-lg)" }}
      >
        <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <MapZoomControl className="top-2 left-2" />
        <Marker position={[mitraLat, mitraLng]} icon={mitraIcon} />
        {marketingPosition && (
          <>
            <Marker position={marketingPosition} icon={myLocationIcon} />
            <Polyline positions={[marketingPosition, [mitraLat, mitraLng]]} pathOptions={{ color: "#2563eb", weight: 3, dashArray: "6 6" }} />
          </>
        )}
      </MapContainer>

      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <MapAttribution className="bottom-3 left-1/2 -translate-x-1/2" />

      <button
        type="button"
        title="Lokasi Saya"
        onClick={handleLocate}
        disabled={locating}
        className="absolute right-3 bottom-3 z-1000 flex size-9 items-center justify-center rounded-full bg-card/90 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm transition-colors hover:bg-accent disabled:opacity-50"
      >
        <LocateFixed className={cn("size-4", locating && "animate-pulse text-primary")} />
      </button>

      {marketingPosition && (
        <button
          type="button"
          onClick={onGenerateRute}
          disabled={routeLoading}
          className="absolute bottom-3 left-3 z-1000 flex items-center gap-1.5 rounded-md bg-card/90 px-2.5 py-1.5 text-xs font-medium shadow-md ring-1 ring-foreground/10 backdrop-blur-sm transition-colors hover:bg-accent disabled:opacity-50"
        >
          <RouteIcon className="size-3.5" />
          {routeLoading ? "Menghitung..." : "Generate Rute"}
        </button>
      )}

      {routeInfo && (
        <div className="absolute top-2 left-1/2 z-1000 -translate-x-1/2 rounded-md bg-card/90 px-2.5 py-1 text-xs font-medium shadow-md ring-1 ring-foreground/10 backdrop-blur-sm">
          {routeInfo.distanceKm} km &middot; {routeInfo.durationMinutes} menit
        </div>
      )}
      {routeError && (
        <div className="absolute top-2 left-1/2 z-1000 -translate-x-1/2 rounded-md bg-destructive/90 px-2.5 py-1 text-xs font-medium text-destructive-foreground shadow-md">
          {routeError}
        </div>
      )}
    </div>
  );
}
