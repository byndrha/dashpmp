"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";

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

export function LocationViewMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  return (
    <MapContainer
      center={[latitude, longitude]}
      zoom={15}
      scrollWheelZoom={false}
      dragging={false}
      doubleClickZoom={false}
      attributionControl={false}
      style={{ height: 260, width: "100%", borderRadius: "var(--radius-lg)" }}
    >
      <TileLayer url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png" />
      <Marker position={[latitude, longitude]} icon={markerIcon} />
    </MapContainer>
  );
}
