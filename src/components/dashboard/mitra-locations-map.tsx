"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

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

// Read-only overview map (unlike mitra-location-map.tsx's single draggable
// pin, used for editing one mitra's location) — plots every mitra that has
// a saved DashboardMitraLocation as a static marker with a name/wilayah
// popup.
export function MitraLocationsMap({ points }: { points: MitraLocationPoint[] }) {
  const center: [number, number] =
    points.length > 0 ? [points[0].Latitude, points[0].Longitude] : [-7.8663, 111.4664];

  return (
    <MapContainer
      center={center}
      zoom={11}
      scrollWheelZoom
      attributionControl={false}
      style={{ height: 320, width: "100%", borderRadius: "var(--radius-lg)" }}
    >
      <TileLayer
        url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
        attribution='<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases">CyclOSM</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {points.map((p) => (
        <Marker key={p.BusinessPartnerID} position={[p.Latitude, p.Longitude]} icon={mitraIcon}>
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
      <FitToPoints points={points} />
    </MapContainer>
  );
}
