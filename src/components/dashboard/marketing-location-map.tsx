"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";
import { formatRelativeTime } from "@/lib/format";
import type { MarketingPosition, MarketingPositionTrail } from "@/lib/queries/akun-lokasi";

// Fixed, visually distinct palette (not theme-derived) so a given
// Marketing's color stays legible against both map tile styles (light/
// satellite) and stays stable across reloads — keyed by akunId modulo
// length, not array position, so it never shifts just because someone's
// trail dropped out of the current 36h window on a later render.
const TRAIL_COLORS = [
  "#e11d48", "#2563eb", "#16a34a", "#d97706", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5",
];

function colorForAkunId(akunId: number): string {
  return TRAIL_COLORS[akunId % TRAIL_COLORS.length];
}

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
// (one dot each, from getLatestMarketingPositions) plus a colored trail line
// of their last 36 hours of pings (getMarketingPositionHistory) — explicit
// request to tell each Marketing's movement apart on the map. Mirrors
// mitra-locations-map.tsx's structure: MapStyleSwitcher/MapZoomControl/
// MapAttribution replace Leaflet's own controls, FitToPositions frames every
// pin on mount.
//
// The root wrapper is `relative z-0` deliberately, same reasoning as
// mitra-locations-map.tsx — Leaflet's own panes use z-index up to 1000
// internally, and without a contained stacking context here those would
// compare directly against the app's sticky navbar (z-40).
export function MarketingLocationMap({
  positions,
  trails,
}: {
  positions: MarketingPosition[];
  trails: MarketingPositionTrail[];
}) {
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const tile = TILE_SOURCES[mapStyle];

  // Legend only lists people who actually have a visible trail (2+ points
  // in the last 36h) — a lone ping draws no line, so a legend entry for it
  // would just be a color with nothing on the map to explain.
  const legendEntries = useMemo(
    () => trails.filter((t) => t.points.length >= 2).map((t) => ({ akunId: t.akunId, nama: t.nama })),
    [trails]
  );

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
        {trails.map((t) =>
          t.points.length >= 2 ? (
            <Polyline
              key={t.akunId}
              positions={t.points.map((p): [number, number] => [p.latitude, p.longitude])}
              pathOptions={{ color: colorForAkunId(t.akunId), weight: 3, opacity: 0.7 }}
            />
          ) : null
        )}
        {positions.map((p) => (
          <CircleMarker
            key={p.akunId}
            center={[p.latitude, p.longitude]}
            radius={8}
            pathOptions={{ color: "#fff", weight: 2, fillColor: colorForAkunId(p.akunId), fillOpacity: 1 }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-medium">{p.nama}</p>
                <p className="text-muted-foreground">Update {formatRelativeTime(p.recordedAt)}</p>
              </div>
            </Popup>
          </CircleMarker>
        ))}
        <FitToPositions positions={positions} />
      </MapContainer>

      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <MapAttribution className="bottom-3 right-3" />

      {legendEntries.length > 0 && (
        <div className="absolute bottom-3 left-3 z-1000 flex max-w-[55%] flex-col gap-1 rounded-md border bg-card/90 px-2.5 py-2 text-xs shadow-sm backdrop-blur-sm">
          {legendEntries.map((e) => (
            <div key={e.akunId} className="flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorForAkunId(e.akunId) }} />
              <span className="truncate">{e.nama}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
