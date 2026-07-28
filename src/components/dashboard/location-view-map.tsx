"use client";

import "leaflet/dist/leaflet.css";
import { useState } from "react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapAttribution } from "@/components/dashboard/map-controls";

// Same icon setup as mitra-location-map.tsx, but this map is read-only
// (no drag, no click-to-move) — it's for viewing a location that's already
// been recorded, not for picking/editing one.
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Deliberately no zoom control or search box here — panning/zooming is
// disabled entirely (this is a locked snapshot of one already-recorded
// point, not something to navigate), so those controls wouldn't have
// anything meaningful to do. The style switcher and attribution are purely
// visual though, so they still apply for consistency with every other map.
export function LocationViewMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const tile = TILE_SOURCES[mapStyle];

  return (
    <div className="relative z-0">
      <MapContainer
        center={[latitude, longitude]}
        zoom={15}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        zoomControl={false}
        attributionControl={false}
        style={{ height: 260, width: "100%", borderRadius: "var(--radius-lg)" }}
      >
        <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <Marker position={[latitude, longitude]} icon={markerIcon} />
      </MapContainer>

      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <MapAttribution className="bottom-2 left-2" />
    </div>
  );
}
