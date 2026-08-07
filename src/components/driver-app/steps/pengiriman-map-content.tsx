"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline } from "react-leaflet";
import L from "leaflet";
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

// Same CDN-hosted marker icon workaround as marketing-location-map.tsx (and
// every other Leaflet marker component in this codebase) — Leaflet's
// default icon paths break under Next.js's bundler otherwise.
const driverIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function PengirimanMapContent({
  pabrik,
  stop,
  position,
}: {
  pabrik: { lat: number; lng: number };
  stop: DriverStopRow;
  position: { lat: number; lng: number } | null;
}) {
  const [route, setRoute] = useState<MultiPointRoute | null>(null);
  const origin = position ?? pabrik;

  useEffect(() => {
    if (stop.Latitude == null || stop.Longitude == null) return;
    let cancelled = false;
    getMultiPointRoute([origin, { lat: stop.Latitude, lng: stop.Longitude }])
      .then((r) => {
        if (!cancelled) setRoute(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Re-fetches on every position change deliberately (that's the "live
    // route" effect); stop's own lat/lng never change within one stop's
    // lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.lat, origin.lng]);

  if (stop.Latitude == null || stop.Longitude == null) {
    return <p className="p-4 text-sm text-muted-foreground">Lokasi tujuan belum tersedia.</p>;
  }

  return (
    <MapContainer center={[origin.lat, origin.lng]} zoom={13} className="h-full w-full">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[origin.lat, origin.lng]} icon={driverIcon} />
      <Marker position={[stop.Latitude, stop.Longitude]} icon={driverIcon} />
      {route && <Polyline positions={route.geometry.map(([lng, lat]) => [lat, lng])} pathOptions={{ color: "#16a34a", weight: 5 }} />}
    </MapContainer>
  );
}
