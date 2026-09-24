"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { Search, LocateFixed, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";
import type { MitraGrowthRow } from "@/lib/queries/mitra-es-balok-growth";

const agenIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const myLocationIcon = L.divIcon({
  className: "",
  html: '<div style="background:#2563eb;width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export interface AgenLocationPoint {
  agenId: string;
  nama: string;
  wilayah: string | null;
  latitude: number;
  longitude: number;
}

function FitToPoints({ points }: { points: AgenLocationPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 13);
      return;
    }
    const bounds = L.latLngBounds(points.map((p): [number, number] => [p.latitude, p.longitude]));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const RANKING_PAGE_SIZE = 5;

// Same quick-glance ranking overlay as mitra-locations-map.tsx's
// WilayahRankingOverlay -- top wilayah by total Mitra, paged one row at a
// time via the up/down arrows.
function WilayahRankingOverlay({ rows }: { rows: MitraGrowthRow[] }) {
  const ranked = [...rows].sort((a, b) => b.total.total - a.total.total);
  const [start, setStart] = useState(0);
  if (ranked.length === 0) return null;

  const canUp = start > 0;
  const canDown = start + RANKING_PAGE_SIZE < ranked.length;
  const visible = ranked.slice(start, start + RANKING_PAGE_SIZE);

  return (
    <div className="absolute top-1/2 right-2 z-1000 w-40 -translate-y-1/2 overflow-hidden rounded-md bg-card/90 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm">
      <p className="border-b border-border/50 px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">
        Total Mitra
      </p>
      <button
        type="button"
        disabled={!canUp}
        onClick={() => setStart((s) => Math.max(0, s - 1))}
        className="flex w-full items-center justify-center border-b border-border/50 py-0.5 text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronUp className="size-3" />
      </button>
      <div>
        {visible.map((r, idx) => (
          <div
            key={r.wilayah}
            className="flex items-center justify-between gap-2 border-b border-border/50 px-2 py-1.5 text-xs last:border-0"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="w-3.5 shrink-0 text-[10px] font-medium text-muted-foreground">{start + idx + 1}</span>
              <span className="truncate">{r.wilayah}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{r.total.total}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={!canDown}
        onClick={() => setStart((s) => Math.min(ranked.length - RANKING_PAGE_SIZE, s + 1))}
        className="flex w-full items-center justify-center border-t border-border/50 py-0.5 text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronDown className="size-3" />
      </button>
    </div>
  );
}

function GpsButton({ onLocate }: { onLocate: (lat: number, lng: number) => void }) {
  const [locating, setLocating] = useState(false);

  function handleClick() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocate(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <button
      type="button"
      title="Lokasi Saya"
      onClick={handleClick}
      disabled={locating}
      className="absolute bottom-3 right-3 z-1000 flex size-9 items-center justify-center rounded-full bg-card/90 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm transition-colors hover:bg-accent disabled:opacity-50"
    >
      <LocateFixed className={cn("size-4", locating && "animate-pulse text-primary")} />
    </button>
  );
}

function AgenSearchBox({
  points,
  onSelect,
}: {
  points: AgenLocationPoint[];
  onSelect: (point: AgenLocationPoint) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = query.trim()
    ? points.filter((p) => p.nama.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="absolute bottom-2 left-2 z-1000 flex w-56 max-w-[calc(100%-1rem)] flex-col-reverse gap-1">
      <div className="flex items-center gap-1.5 rounded-md bg-card/90 px-2 py-1.5 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Cari Mitra di peta..."
          className="w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
          >
            <X className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </div>
      {open && matches.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-md bg-card/95 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm">
          {matches.map((p) => (
            <button
              key={p.agenId}
              type="button"
              onClick={() => {
                onSelect(p);
                setQuery(p.nama);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="truncate font-medium">{p.nama}</span>
              {p.wilayah && <span className="text-[11px] text-muted-foreground">{p.wilayah}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Read-only overview map -- same feature set as mitra-locations-map.tsx
// (search, GPS, style switcher, wilayah ranking overlay), adapted to
// AgenLocationPoint's field names. `growthRows` is optional so existing
// callers of this component that only have points (no growth query result)
// keep working without change.
export function AgenLocationsMap({
  points,
  growthRows = [],
  centerFallback = [-7.8462825, 111.4759937],
}: {
  points: AgenLocationPoint[];
  growthRows?: MitraGrowthRow[];
  // Used only when there are no points to center on -- each company's own
  // Pabrik location (DashboardPerusahaan.PabrikLatitude/Longitude, see
  // getPabrikLocationByKode), not a shared hardcoded spot. Defaults to the
  // old hardcoded Ponorogo coordinate for any caller that doesn't pass one.
  centerFallback?: [number, number];
}) {
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const [myLocation, setMyLocation] = useState<[number, number] | null>(null);
  const tile = TILE_SOURCES[mapStyle];

  function handleLocate(lat: number, lng: number) {
    setMyLocation([lat, lng]);
    mapRef.current?.setView([lat, lng], 15);
  }

  function handleSelectAgen(point: AgenLocationPoint) {
    mapRef.current?.flyTo([point.latitude, point.longitude], 15);
    markerRefs.current.get(point.agenId)?.openPopup();
  }

  return (
    <div className="relative z-0">
      <MapContainer
        ref={mapRef}
        center={points[0] ? [points[0].latitude, points[0].longitude] : centerFallback}
        zoom={11}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        style={{ height: 320, width: "100%" }}
      >
        <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <MapZoomControl className="top-2 left-2" />
        {points.map((p) => (
          <Marker
            key={p.agenId}
            position={[p.latitude, p.longitude]}
            icon={agenIcon}
            ref={(instance) => {
              if (instance) markerRefs.current.set(p.agenId, instance);
              else markerRefs.current.delete(p.agenId);
            }}
          >
            <Popup>
              <strong>{p.nama}</strong>
              {p.wilayah && <div>{p.wilayah}</div>}
            </Popup>
          </Marker>
        ))}
        {myLocation && <Marker position={myLocation} icon={myLocationIcon} />}
        <FitToPoints points={points} />
      </MapContainer>

      <AgenSearchBox points={points} onSelect={handleSelectAgen} />
      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <WilayahRankingOverlay rows={growthRows} />
      <GpsButton onLocate={handleLocate} />
      <MapAttribution className="bottom-3 right-14" />
    </div>
  );
}
