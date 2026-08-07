"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import type { RecenterTarget } from "./peta-overview-map";

interface ColoredRoute {
  jadwalId: number;
  stops: DriverStopRow[];
  color: string;
}

// Leaflet's default icon paths break under Next.js's bundler otherwise.
// Served from /public/leaflet/ (copied from node_modules/leaflet/dist/images
// at the same version this project depends on) rather than the unpkg.com
// CDN other Leaflet components in this codebase still use — confirmed live
// that browser tracking-prevention features (e.g. Microsoft Edge's, on by
// default) block storage access for that CDN's marker images, leaving the
// map with no visible markers. Self-hosting removes the third-party
// dependency entirely. Reused as-is for both the per-stop markers and the
// driver's own position marker; this screen has no need for visually
// distinct icons.
const driverIcon = L.icon({
  iconUrl: "/leaflet/marker-icon.png",
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  shadowUrl: "/leaflet/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Imperatively pans/zooms on every new `recenter.key` (search result or
// "Lokasi Saya") — must live inside <MapContainer> to use useMap(). Same
// pattern as mitra-location-map.tsx's own recenterKey handling.
function RecenterHandler({ recenter }: { recenter: RecenterTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!recenter) return;
    map.setView([recenter.lat, recenter.lng], 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenter?.key]);
  return null;
}

export default function PetaOverviewMapContent({
  pabrik,
  routes,
  position,
  mapStyle,
  onMapStyleChange,
  recenter,
}: {
  pabrik: { lat: number; lng: number };
  routes: ColoredRoute[];
  position: { lat: number; lng: number } | null;
  mapStyle: MapStyle;
  onMapStyleChange: (style: MapStyle) => void;
  recenter: RecenterTarget | null;
}) {
  const [geometries, setGeometries] = useState<Map<number, MultiPointRoute>>(new Map());
  const tile = TILE_SOURCES[mapStyle];

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
    // relative z-0 contains Leaflet's own panes (z-index up to 1000
    // internally) within this local stacking context — without it they
    // compare directly against the driver-app's fixed bottom nav (z-40)
    // and render on top of it. Same fix as marketing-location-map.tsx.
    <div className="relative z-0 h-full w-full">
      <MapContainer center={[pabrik.lat, pabrik.lng]} zoom={12} zoomControl={false} attributionControl={false} className="h-full w-full">
        {/* key={mapStyle} forces a fresh TileLayer instance per style —
            same reasoning as marketing-location-map.tsx, Leaflet doesn't
            reliably diff/reuse tiles across completely different servers. */}
        <TileLayer key={mapStyle} url={tile.url} attribution={tile.attribution} subdomains={tile.subdomains ?? "abc"} />
        <MapZoomControl className="top-2 left-2" />
        <MapStyleSwitcher mapStyle={mapStyle} onChange={onMapStyleChange} className="top-2 right-2" />
        <MapAttribution className="bottom-12 left-2" />
        <RecenterHandler recenter={recenter} />
        <Marker position={[pabrik.lat, pabrik.lng]} icon={driverIcon}>
          <Popup>Pabrik</Popup>
        </Marker>
        {routes.map((r) => {
          const geometry = geometries.get(r.jadwalId);
          return (
            <Fragment key={r.jadwalId}>
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
            </Fragment>
          );
        })}
        {position && <Marker position={[position.lat, position.lng]} icon={driverIcon} />}
      </MapContainer>
    </div>
  );
}
