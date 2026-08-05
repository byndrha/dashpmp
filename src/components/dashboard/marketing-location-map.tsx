"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";
import { formatRelativeTime } from "@/lib/format";
import type { MarketingPosition } from "@/lib/queries/akun-lokasi";

// Same CDN-hosted marker icon workaround as mitra-locations-map.tsx —
// Leaflet's default icon paths break under Next.js's bundler otherwise.
const marketingIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Fits the view to every marker once on mount — not on every re-render, so
// panning/zooming by the user isn't fought on each parent refresh. Same
// approach as mitra-locations-map.tsx's FitToPoints.
function FitToPositions({ positions }: { positions: MarketingPosition[] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView([positions[0].latitude, positions[0].longitude], 13);
      return;
    }
    const bounds = L.latLngBounds(positions.map((p): [number, number] => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// Read-only overview map of every Marketing account's latest known position
// (one pin each, from getLatestMarketingPositions). Mirrors
// mitra-locations-map.tsx's structure: MapStyleSwitcher/MapZoomControl/
// MapAttribution replace Leaflet's own controls, FitToPositions frames every
// pin on mount.
//
// The root wrapper is `relative z-0` deliberately, same reasoning as
// mitra-locations-map.tsx — Leaflet's own panes use z-index up to 1000
// internally, and without a contained stacking context here those would
// compare directly against the app's sticky navbar (z-40).
export function MarketingLocationMap({ positions }: { positions: MarketingPosition[] }) {
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const tile = TILE_SOURCES[mapStyle];

  if (positions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">
        Belum ada data posisi Marketing.
      </div>
    );
  }

  const center: [number, number] = [positions[0].latitude, positions[0].longitude];

  return (
    <div className="relative z-0">
      <MapContainer
        center={center}
        zoom={11}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        style={{ height: 320, width: "100%" }}
      >
        {/* key={mapStyle} forces a fresh TileLayer instance per style so
            Leaflet doesn't try to diff/reuse tiles across completely
            different tile servers. */}
        <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <MapZoomControl className="top-2 left-2" />
        {positions.map((p) => (
          <Marker key={p.akunId} position={[p.latitude, p.longitude]} icon={marketingIcon}>
            <Popup>
              <div className="text-sm">
                <p className="font-medium">{p.nama}</p>
                <p className="text-muted-foreground">Update {formatRelativeTime(p.recordedAt)}</p>
              </div>
            </Popup>
          </Marker>
        ))}
        <FitToPositions positions={positions} />
      </MapContainer>

      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <MapAttribution className="bottom-3 right-3" />
    </div>
  );
}
