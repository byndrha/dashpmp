"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { TILE_SOURCES } from "@/lib/map-styles";
import { MapZoomControl, MapAttribution } from "@/components/dashboard/map-controls";

const agenIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
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

export function AgenLocationsMap({ points }: { points: AgenLocationPoint[] }) {
  const tile = TILE_SOURCES.light;
  return (
    <div className="relative z-0">
      <MapContainer
        center={points[0] ? [points[0].latitude, points[0].longitude] : [-7.8462825, 111.4759937]}
        zoom={11}
        scrollWheelZoom
        zoomControl={false}
        attributionControl={false}
        style={{ height: 320, width: "100%", borderRadius: "var(--radius-lg)" }}
      >
        <TileLayer attribution={tile.attribution} url={tile.url} subdomains={tile.subdomains ?? "abc"} />
        <MapZoomControl className="top-2 left-2" />
        {points.map((p) => (
          <Marker key={p.agenId} position={[p.latitude, p.longitude]} icon={agenIcon}>
            <Popup>
              <strong>{p.nama}</strong>
              {p.wilayah && <div>{p.wilayah}</div>}
            </Popup>
          </Marker>
        ))}
        <FitToPoints points={points} />
      </MapContainer>
      <MapAttribution className="top-2 left-1/2 -translate-x-1/2" />
    </div>
  );
}
