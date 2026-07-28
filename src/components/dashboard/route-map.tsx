"use client";

import "leaflet/dist/leaflet.css";
import { useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
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

type Stop = JadwalDetailRow & { Latitude: number; Longitude: number };

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
}: {
  pabrik: { latitude: number; longitude: number };
  stops: (JadwalDetailRow & { Latitude: number; Longitude: number })[];
  // Raw GeoJSON [lng, lat] pairs from MultiPointRoute — flipped to Leaflet's
  // [lat, lng] here, the only place in this feature that cares about the
  // difference.
  geometry: [number, number][] | null;
}) {
  const polylinePositions: [number, number][] | undefined = geometry?.map(([lng, lat]) => [lat, lng]);
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef<Map<number, L.Marker>>(new Map());
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const tile = TILE_SOURCES[mapStyle];

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
      </MapContainer>

      <StopSearchBox stops={stops} onSelect={handleSelectStop} />
      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <MapAttribution className="bottom-2 right-2" />
    </div>
  );
}
