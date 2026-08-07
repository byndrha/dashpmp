"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

interface ColoredRoute {
  jadwalId: number;
  stops: DriverStopRow[];
  color: string;
}

// Same CDN-hosted marker icon workaround as marketing-location-map.tsx (and
// every other Leaflet marker component in this codebase) — Leaflet's
// default icon paths break under Next.js's bundler otherwise. Reused as-is
// for both the per-stop markers and the driver's own position marker; this
// screen has no need for visually distinct icons.
const driverIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function PetaOverviewMapContent({
  pabrik,
  routes,
  position,
}: {
  pabrik: { lat: number; lng: number };
  routes: ColoredRoute[];
  position: { lat: number; lng: number } | null;
}) {
  const [geometries, setGeometries] = useState<Map<number, MultiPointRoute>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        routes.map(async (r) => {
          const points = [pabrik, ...r.stops.filter((s) => s.Latitude != null && s.Longitude != null).map((s) => ({ lat: s.Latitude as number, lng: s.Longitude as number }))];
          if (points.length < 2) return null;
          try {
            const route = await getMultiPointRoute(points);
            return [r.jadwalId, route] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      setGeometries(new Map(entries.filter((e): e is readonly [number, MultiPointRoute] => e !== null)));
    })();
    return () => {
      cancelled = true;
    };
  }, [routes, pabrik]);

  return (
    <MapContainer center={[pabrik.lat, pabrik.lng]} zoom={12} className="h-full w-full rounded-lg">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {routes.map((r) => {
        const geometry = geometries.get(r.jadwalId);
        return (
          <div key={r.jadwalId}>
            {geometry && (
              <Polyline positions={geometry.geometry.map(([lng, lat]) => [lat, lng])} pathOptions={{ color: r.color, weight: 4 }} />
            )}
            {r.stops
              .filter((s) => s.Latitude != null && s.Longitude != null)
              .map((s) => (
                <Marker key={s.JadwalDetailID} position={[s.Latitude as number, s.Longitude as number]} icon={driverIcon}>
                  <Popup>{s.CustomerName}</Popup>
                </Marker>
              ))}
          </div>
        );
      })}
      {position && <Marker position={[position.lat, position.lng]} icon={driverIcon} />}
    </MapContainer>
  );
}
