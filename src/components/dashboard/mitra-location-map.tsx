"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { cn } from "@/lib/utils";
import { TILE_SOURCES, STYLE_OPTIONS, type MapStyle } from "@/lib/map-styles";

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
  // [lat, lng] — sourced from DashboardPabrikLocation via the caller
  // (MitraLocationField), not hardcoded here anymore. Omitted entirely in
  // readOnly view contexts that don't need the Pabrik reference marker.
  pabrikPosition?: [number, number];
  // Plain display — no drag, no click-to-move, no style switcher clutter.
  // Used by MitraDetailDialog's default (non-editing) view.
  readOnly?: boolean;
}

export function MitraLocationMap({ latitude, longitude, onChange, recenterKey, pabrikPosition, readOnly }: MitraLocationMapProps) {
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
        {pabrikPosition && <Marker position={pabrikPosition} icon={pabrikIcon} />}
        <Marker
          position={[latitude, longitude]}
          icon={mitraIcon}
          draggable={!readOnly}
          eventHandlers={readOnly ? undefined : { dragend: handleDragEnd }}
          ref={markerRef}
        />
        {!readOnly && <ClickToMove onMove={onChange} />}
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
