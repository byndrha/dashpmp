"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { Search, LocateFixed, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";
import type { MitraGrowthRow } from "@/lib/queries/mitra-growth";

// Same CDN-hosted marker icon workaround as mitra-location-map.tsx — Leaflet's
// default icon paths break under Next.js's bundler otherwise.
const mitraIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Same self-contained divIcon approach as mitra-location-map.tsx's Pabrik
// marker — blue instead of orange so it doesn't get confused for either a
// mitra pin or a Pabrik reference point.
const myLocationIcon = L.divIcon({
  className: "",
  html: '<div style="background:#2563eb;width:14px;height:14px;border-radius:9999px;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export interface MitraLocationPoint {
  BusinessPartnerID: string;
  Name: string;
  Wilayah: string | null;
  Latitude: number;
  Longitude: number;
}

// Fits the view to every marker once on mount — not on every re-render, so
// panning/zooming by the user isn't fought on each parent refresh.
function FitToPoints({ points }: { points: MitraLocationPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].Latitude, points[0].Longitude], 13);
      return;
    }
    const bounds = L.latLngBounds(points.map((p): [number, number] => [p.Latitude, p.Longitude]));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const RANKING_PAGE_SIZE = 5;

// Quick-glance ranking overlaid on the map itself — top 5 wilayah by total
// mitra visible at once, total-only (no per-type breakdown, unlike the full
// MitraGrowthTable already shown below the map). Paged one row at a time
// via the up/down arrow buttons instead of a scrollbar.
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

// Searches among the mitra already plotted on this map (by name) rather
// than a general address/place search — this is a read-only overview of
// existing mitra pins, so "find the one I'm looking for and jump to it" is
// the useful search here, not geocoding a new place.
function MitraSearchBox({
  points,
  onSelect,
}: {
  points: MitraLocationPoint[];
  onSelect: (point: MitraLocationPoint) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = query.trim()
    ? points.filter((p) => p.Name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    // flex-col-reverse so the matches dropdown (2nd child in JSX order)
    // renders ABOVE the input row (1st child) — needed now that this sits
    // at the bottom-left corner, where a downward dropdown would run off
    // the map.
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
          placeholder="Cari mitra di peta..."
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
              key={p.BusinessPartnerID}
              type="button"
              onClick={() => {
                onSelect(p);
                setQuery(p.Name);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="truncate font-medium">{p.Name}</span>
              {p.Wilayah && <span className="text-[11px] text-muted-foreground">{p.Wilayah}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Read-only overview map (unlike mitra-location-map.tsx's single draggable
// pin, used for editing one mitra's location) — plots every mitra that has
// a saved DashboardMitraLocation as a static marker with a name/wilayah
// popup. `points` is already filtered upstream (page.tsx) to exclude
// deactivated (IsSuspended) mitra.
//
// The root wrapper below is `relative z-0` deliberately — Leaflet's own
// controls/panes use z-index up to 1000 internally, and without an explicit
// z-index here (creating a contained stacking context) those would compare
// directly against the app's sticky navbar (z-40) and can render on top of
// it once this map sits at the very top of the page.
export function MitraLocationsMap({
  points,
  growthRows,
}: {
  points: MitraLocationPoint[];
  growthRows: MitraGrowthRow[];
}) {
  const center: [number, number] =
    points.length > 0 ? [points[0].Latitude, points[0].Longitude] : [-7.8663, 111.4664];

  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const [myLocation, setMyLocation] = useState<[number, number] | null>(null);
  const tile = TILE_SOURCES[mapStyle];

  function handleLocate(lat: number, lng: number) {
    setMyLocation([lat, lng]);
    mapRef.current?.setView([lat, lng], 15);
  }

  function handleSelectMitra(point: MitraLocationPoint) {
    mapRef.current?.flyTo([point.Latitude, point.Longitude], 15);
    markerRefs.current.get(point.BusinessPartnerID)?.openPopup();
  }

  return (
    <div className="relative z-0">
      <MapContainer
        ref={mapRef}
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
        {points.map((p) => (
          <Marker
            key={p.BusinessPartnerID}
            position={[p.Latitude, p.Longitude]}
            icon={mitraIcon}
            ref={(instance) => {
              if (instance) markerRefs.current.set(p.BusinessPartnerID, instance);
              else markerRefs.current.delete(p.BusinessPartnerID);
            }}
          >
            <Popup>
              <strong>{p.Name}</strong>
              {p.Wilayah && (
                <>
                  <br />
                  {p.Wilayah}
                </>
              )}
            </Popup>
          </Marker>
        ))}
        {myLocation && <Marker position={myLocation} icon={myLocationIcon} />}
        <FitToPoints points={points} />
      </MapContainer>

      <MitraSearchBox points={points} onSelect={handleSelectMitra} />
      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <WilayahRankingOverlay rows={growthRows} />
      <GpsButton onLocate={handleLocate} />
      {/* Left of the GPS button (which is size-9 at right-3, i.e. spans to
          48px from the edge) rather than bottom-center, so it doesn't
          collide with either the search box (bottom-left) or GPS. */}
      <MapAttribution className="bottom-3 right-14" />
    </div>
  );
}
