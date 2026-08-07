"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import type { MultiPointRoute } from "@/lib/osrm";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import type { RecenterTarget } from "./pengiriman-map";

// Small decorative marker for the route's starting point (distinct from the
// live truck marker, which moves) — plain colored dot, no icon glyph
// needed at this size.
const originIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:9999px;background:#16a34a;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function numberedIcon(n: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:white;border:2px solid #111827;color:#111827;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Inline SVG rather than a self-hosted PNG (the pattern used for the
// destination pin elsewhere in driver-app) since this needs a distinct
// truck glyph, not Leaflet's default marker shape. Position tracks the
// `position` prop reactively (react-leaflet calls setLatLng() under the
// hood when a Marker's position prop changes), so this marker follows
// whatever live GPS fix PengirimanStep's watchPosition last produced.
const truckIcon = L.divIcon({
  className: "",
  html: `<div style="width:36px;height:36px;border-radius:9999px;background:#111827;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4)">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white">
      <rect x="1" y="7" width="13" height="8" rx="1"/>
      <path d="M14 10h4l3 3v2h-7z"/>
      <circle cx="6" cy="17" r="2" fill="#111827" stroke="white" stroke-width="1.5"/>
      <circle cx="17" cy="17" r="2" fill="#111827" stroke="white" stroke-width="1.5"/>
    </svg>
  </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

function RecenterHandler({ recenter }: { recenter: RecenterTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!recenter) return;
    map.setView([recenter.lat, recenter.lng], 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenter?.key]);
  return null;
}

export default function PengirimanMapContent({
  origin,
  stops,
  route,
  position,
  mapStyle,
  recenter,
}: {
  origin: { lat: number; lng: number };
  stops: { lat: number; lng: number; label: number }[];
  // Fetched once by PengirimanStep (shared with its ETA/distance-list
  // calculations) rather than this component fetching its own copy — one
  // OSRM call instead of two for the same route.
  route: MultiPointRoute | null;
  position: { lat: number; lng: number } | null;
  mapStyle: MapStyle;
  recenter: RecenterTarget | null;
}) {
  const truckPosition = position ?? origin;
  const tile = TILE_SOURCES[mapStyle];

  return (
    <MapContainer center={[truckPosition.lat, truckPosition.lng]} zoom={14} zoomControl={false} attributionControl={false} className="h-full w-full">
      {/* keyed by mapStyle: same reasoning as marketing-location-map.tsx,
          Leaflet doesn't reliably diff/reuse tiles across different servers. */}
      <TileLayer key={mapStyle} url={tile.url} attribution={tile.attribution} subdomains={tile.subdomains ?? "abc"} />
      <Marker position={[origin.lat, origin.lng]} icon={originIcon} />
      <Marker position={[truckPosition.lat, truckPosition.lng]} icon={truckIcon} />
      {stops.map((s) => (
        <Marker key={s.label} position={[s.lat, s.lng]} icon={numberedIcon(s.label)} />
      ))}
      {route && (
        <Polyline
          positions={route.geometry.map(([lng, lat]) => [lat, lng] as [number, number])}
          pathOptions={{ color: "#16a34a", weight: 4, dashArray: "8 8" }}
        />
      )}
      <RecenterHandler recenter={recenter} />
    </MapContainer>
  );
}
