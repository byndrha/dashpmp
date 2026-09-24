"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useRef, useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";
import { MapStyleSwitcher, MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";

// Leaflet's default marker icon paths break under Next.js's bundler unless
// pointed at a CDN copy explicitly -- same known issue/fix Es Kristal's
// mitra-location-map.tsx already uses (https://github.com/Leaflet/Leaflet/issues/4968).
const agenIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function ClickToMove({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMove(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function RecenterOnTrigger({ lat, lng, triggerKey }: { lat: number; lng: number; triggerKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (triggerKey > 0) map.setView([lat, lng], 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);
  return null;
}

export interface AgenLocationMapProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
  recenterKey: number;
  readOnly?: boolean;
}

export function AgenLocationMap({ latitude, longitude, onChange, recenterKey, readOnly }: AgenLocationMapProps) {
  const markerRef = useRef<L.Marker>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>("light");
  const tile = TILE_SOURCES[mapStyle];

  const handleDragEnd = useCallback(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const pos = marker.getLatLng();
    onChange(pos.lat, pos.lng);
  }, [onChange]);

  return (
    <div className="relative z-0">
      <MapContainer
        center={[latitude, longitude]}
        zoom={15}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        style={{ height: 260, width: "100%", borderRadius: "var(--radius-lg)" }}
      >
        <TileLayer key={mapStyle} attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <MapZoomControl className="top-2 left-2" />
        <Marker
          position={[latitude, longitude]}
          icon={agenIcon}
          draggable={!readOnly}
          eventHandlers={readOnly ? undefined : { dragend: handleDragEnd }}
          ref={markerRef}
        />
        {!readOnly && <ClickToMove onMove={onChange} />}
        <RecenterOnTrigger lat={latitude} lng={longitude} triggerKey={recenterKey} />
      </MapContainer>
      <MapStyleSwitcher mapStyle={mapStyle} onChange={setMapStyle} className="top-2 right-2" />
      <MapAttribution className="top-2 left-1/2 -translate-x-1/2" />
    </div>
  );
}
