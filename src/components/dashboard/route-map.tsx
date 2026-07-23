"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import L from "leaflet";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";

const pabrikIcon = L.divIcon({
  className: "",
  html: '<div style="background:#ea580c;width:16px;height:16px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function stopIcon(order: number) {
  return L.divIcon({
    className: "",
    html: `<div style="background:#16a34a;color:white;width:22px;height:22px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;font-family:sans-serif">${order}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export function RouteMap({
  pabrik,
  stops,
  geometry,
}: {
  pabrik: { latitude: number; longitude: number };
  stops: (JadwalDetailRow & { Latitude: number; Longitude: number })[];
  // Raw GeoJSON [lng, lat] pairs from MultiPointRoute — flipped to Leaflet's
  // [lat, lng] here, the only place in this feature that cares about the
  // difference.
  geometry: [number, number][] | null;
}) {
  const polylinePositions: [number, number][] | undefined = geometry?.map(([lng, lat]) => [lat, lng]);

  return (
    <MapContainer
      center={[pabrik.latitude, pabrik.longitude]}
      zoom={12}
      scrollWheelZoom
      attributionControl={false}
      style={{ height: "100%", minHeight: 320, width: "100%", borderRadius: "var(--radius-lg)" }}
    >
      <TileLayer url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png" />
      <Marker position={[pabrik.latitude, pabrik.longitude]} icon={pabrikIcon} />
      {stops.map((s, i) => (
        <Marker key={s.JadwalDetailID} position={[s.Latitude, s.Longitude]} icon={stopIcon(i + 1)} />
      ))}
      {polylinePositions && <Polyline positions={polylinePositions} pathOptions={{ color: "#2563eb", weight: 4 }} />}
    </MapContainer>
  );
}
