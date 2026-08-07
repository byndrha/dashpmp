"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

interface ColoredRoute {
  jadwalId: number;
  stops: DriverStopRow[];
  color: string;
}

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
                <Marker key={s.JadwalDetailID} position={[s.Latitude as number, s.Longitude as number]}>
                  <Popup>{s.CustomerName}</Popup>
                </Marker>
              ))}
          </div>
        );
      })}
      {position && <Marker position={[position.lat, position.lng]} />}
    </MapContainer>
  );
}
