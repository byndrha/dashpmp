"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import { Search, X } from "lucide-react";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";
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

// Top-down truck (cargo box + cab), not a pin — the front (cab) points
// geographic north at bearingDeg=0 and rotates from there, so passing the
// route's own heading at the driver's nearest point makes the icon's front
// track the direction of travel rather than just marking a location.
function truckIcon(bearingDeg: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;transform:rotate(${bearingDeg}deg);transform-origin:50% 50%;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))">
      <svg viewBox="0 0 24 24" width="28" height="28">
        <rect x="7" y="10" width="10" height="12" rx="1.5" fill="#2563eb" stroke="white" stroke-width="1.2" />
        <rect x="8.5" y="2" width="7" height="9" rx="1.5" fill="#1d4ed8" stroke="white" stroke-width="1.2" />
      </svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Nearest-segment heading: finds the route polyline segment whose midpoint
// is closest to the driver's current position, then returns that segment's
// compass bearing. A single GPS ping has no bearing of its own (no prior
// point to compare against) — the route geometry itself stands in for
// "which way is the truck facing" between 10-second polls, matching what
// the driver-app design settled on (bearing from route, not from position
// history).
function bearingToNearestSegment(position: [number, number], route: [number, number][]): number {
  if (route.length < 2) return 0;
  let bestDistSq = Infinity;
  let bestBearing = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const [lat1, lng1] = route[i];
    const [lat2, lng2] = route[i + 1];
    const midLat = (lat1 + lat2) / 2;
    const midLng = (lng1 + lng2) / 2;
    const distSq = (position[0] - midLat) ** 2 + (position[1] - midLng) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLng = toRad(lng2 - lng1);
      const y = Math.sin(dLng) * Math.cos(toRad(lat2));
      const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
      bestBearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }
  }
  return bestBearing;
}

type Stop = JadwalDetailRow & { Latitude: number; Longitude: number };

// Keeps the map framed on the whole route (pabrik + every stop + the
// actual road geometry, not just the straight lines between markers) —
// without this, MapContainer's own fixed center/zoom={12} only happens to
// show the whole route by coincidence, and a route with far-flung stops
// (e.g. a Pacitan-area run, ~50-60km from the Ponorogo pabrik) gets several
// markers cut off past the initial viewport. Re-fits whenever the route's
// own data changes, plus whenever refitTrigger is bumped — the latter lets
// a caller (route-validation-dialog.tsx's "Bagikan") force an immediate,
// un-animated re-fit right before a screenshot, overriding any manual
// pan/zoom so a shared image always shows the entire route.
function FitBounds({
  pabrik,
  stops,
  routePoints,
  refitTrigger,
}: {
  pabrik: { latitude: number; longitude: number };
  stops: Stop[];
  routePoints: [number, number][] | undefined;
  refitTrigger: number;
}) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [
      [pabrik.latitude, pabrik.longitude],
      ...stops.map((s): [number, number] => [s.Latitude, s.Longitude]),
      ...(routePoints ?? []),
    ];
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 15, animate: false });
    // stops/routePoints are new array references most renders — keyed on
    // stop identity + point count instead so this only re-fits when the
    // route's actual data changes (or refitTrigger is bumped on purpose),
    // not on every unrelated re-render (which would fight a manual pan/zoom).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pabrik.latitude, pabrik.longitude, stops.map((s) => s.JadwalDetailID).join(","), routePoints?.length, refitTrigger]);
  return null;
}

// Searches among this route's own stops (by CustomerName) rather than a
// general address search — same "find the one I'm looking for and jump to
// it" role as mitra-locations-map.tsx's MitraSearchBox, just scoped to one
// route's stop list instead of every mitra on the map.
function StopSearchBox({ stops, onSelect }: { stops: Stop[]; onSelect: (stop: Stop) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = query.trim()
    ? stops.filter((s) => s.CustomerName.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
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
          placeholder="Cari mitra di rute..."
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
          {matches.map((s) => (
            <button
              key={s.JadwalDetailID}
              type="button"
              onClick={() => {
                onSelect(s);
                setQuery(s.CustomerName);
                setOpen(false);
              }}
              className="flex w-full flex-col items-start px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="truncate font-medium">
                #{s.Urutan} {s.CustomerName}
              </span>
              <span className="text-[11px] text-muted-foreground">{s.Wilayah}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RouteMap({
  pabrik,
  stops,
  geometry,
  refitTrigger = 0,
  driverPosition = null,
}: {
  pabrik: { latitude: number; longitude: number };
  stops: (JadwalDetailRow & { Latitude: number; Longitude: number })[];
  // Raw GeoJSON [lng, lat] pairs from MultiPointRoute — flipped to Leaflet's
  // [lat, lng] here, the only place in this feature that cares about the
  // difference.
  geometry: [number, number][] | null;
  // Bump to force an immediate, un-animated bounds re-fit — see FitBounds.
  refitTrigger?: number;
  // Live driver GPS, polled by the caller every 10s once "Mulai Muat" is
  // done — null hides the marker entirely (not yet loading, no ping ever
  // received, or the caller hasn't started polling yet). Deliberately left
  // out of FitBounds below: re-framing the whole map on every 10s ping
  // would fight any manual pan/zoom and jump the view around as the truck
  // moves, when the point is to watch it move within a fixed frame.
  driverPosition?: { latitude: number; longitude: number } | null;
}) {
  const polylinePositions: [number, number][] | undefined = geometry?.map(([lng, lat]) => [lat, lng]);
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Map<number, L.Marker>>(new Map());
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const tile = TILE_SOURCES[mapStyle];
  const driverBearing = driverPosition && polylinePositions ? bearingToNearestSegment([driverPosition.latitude, driverPosition.longitude], polylinePositions) : 0;

  function handleSelectStop(stop: Stop) {
    mapRef.current?.flyTo([stop.Latitude, stop.Longitude], 15);
    markerRefs.current.get(stop.JadwalDetailID)?.openPopup();
  }

  return (
    <div className="relative z-0">
      <MapContainer
        ref={mapRef}
        center={[pabrik.latitude, pabrik.longitude]}
        zoom={12}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        style={{ height: "100%", minHeight: 320, width: "100%", borderRadius: "var(--radius-lg)" }}
      >
        {/* key={mapStyle} forces a fresh TileLayer instance per style so
            Leaflet doesn't try to diff/reuse tiles across completely
            different tile servers. */}
        <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <FitBounds pabrik={pabrik} stops={stops} routePoints={polylinePositions} refitTrigger={refitTrigger} />
        <MapZoomControl className="top-2 left-2" />
        <Marker position={[pabrik.latitude, pabrik.longitude]} icon={pabrikIcon} />
        {stops.map((s, i) => (
          <Marker
            key={s.JadwalDetailID}
            position={[s.Latitude, s.Longitude]}
            icon={stopIcon(i + 1)}
            ref={(instance) => {
              if (instance) markerRefs.current.set(s.JadwalDetailID, instance);
              else markerRefs.current.delete(s.JadwalDetailID);
            }}
          >
            <Popup>
              <strong>
                #{s.Urutan} {s.CustomerName}
              </strong>
              <br />
              {s.Wilayah}
            </Popup>
          </Marker>
        ))}
        {polylinePositions && <Polyline positions={polylinePositions} pathOptions={{ color: "#2563eb", weight: 4 }} />}
        {driverPosition && (
          <Marker position={[driverPosition.latitude, driverPosition.longitude]} icon={truckIcon(driverBearing)} zIndexOffset={1000} />
        )}
      </MapContainer>

      <StopSearchBox stops={stops} onSelect={handleSelectStop} />
      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <MapAttribution className="bottom-2 right-2" />
    </div>
  );
}
