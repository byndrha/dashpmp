"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Sun, Moon, Satellite } from "lucide-react";
import { cn } from "@/lib/utils";

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

// Small dot for the fixed, non-draggable Pabrik reference point -- self
// contained (no extra image asset) so it can't break the same way.
const pabrikIcon = L.divIcon({
  className: "",
  html: '<div style="background:#ea580c;width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// Same coordinates as PABRIK_ORIGIN in app/api/routing/route.ts.
const PABRIK_POSITION: [number, number] = [-7.8462825, 111.4759937];

type MapStyle = "light" | "dark" | "satellite";

// Satellite (Esri) and Light (CyclOSM) need no signup/key. Dark deliberately
// isn't Jawg.Matrix — like Stadia's AlidadeSatellite, Jawg requires an
// access token for every request (verified live: an unkeyed request comes
// back "NO_ACCESS_TOKEN_PROVIDED") — CartoDB Dark Matter was picked instead
// since it needs no signup either.
const TILE_SOURCES: Record<MapStyle, { url: string; attribution: string; subdomains?: string }> = {
  light: {
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    attribution:
      '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> | Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
};

const STYLE_OPTIONS: { key: MapStyle; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Terang", icon: Sun },
  { key: "dark", label: "Gelap", icon: Moon },
  { key: "satellite", label: "Satelit", icon: Satellite },
];

function ClickToMove({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMove(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Recenters the map only when `triggerKey` changes (e.g. after "Pakai Lokasi
// Saya") -- NOT on every lat/lng update, or the map would snap back to
// center on itself after every drag and fight the user's own panning.
function RecenterOnTrigger({ lat, lng, triggerKey }: { lat: number; lng: number; triggerKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (triggerKey > 0) map.setView([lat, lng], 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);
  return null;
}

export interface MitraLocationMapProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
  recenterKey: number;
}

export function MitraLocationMap({ latitude, longitude, onChange, recenterKey }: MitraLocationMapProps) {
  const markerRef = useRef<L.Marker>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const tile = TILE_SOURCES[mapStyle];

  const handleDragEnd = useCallback(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const pos = marker.getLatLng();
    onChange(pos.lat, pos.lng);
  }, [onChange]);

  return (
    <div className="relative">
      <MapContainer
        center={[latitude, longitude]}
        zoom={15}
        scrollWheelZoom
        attributionControl={false}
        style={{ height: 260, width: "100%", borderRadius: "var(--radius-lg)" }}
      >
        {/* key={mapStyle} forces a fresh TileLayer instance per style so
            Leaflet doesn't try to diff/reuse tiles across completely
            different tile servers. */}
        <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <Marker position={PABRIK_POSITION} icon={pabrikIcon} />
        <Marker
          position={[latitude, longitude]}
          icon={mitraIcon}
          draggable
          eventHandlers={{ dragend: handleDragEnd }}
          ref={markerRef}
        />
        <ClickToMove onMove={onChange} />
        <RecenterOnTrigger lat={latitude} lng={longitude} triggerKey={recenterKey} />
      </MapContainer>

      <div className="absolute top-2 right-2 z-1000 flex gap-1 rounded-md bg-card/90 p-1 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm">
        {STYLE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            title={opt.label}
            onClick={() => setMapStyle(opt.key)}
            className={cn(
              "flex size-7 items-center justify-center rounded transition-colors",
              mapStyle === opt.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            <opt.icon className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
