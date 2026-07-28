import { Sun, Moon, Satellite } from "lucide-react";

// Shared between every Leaflet map in the dashboard that offers a style
// switcher (mitra-location-map.tsx's single-pin editor, mitra-locations-map.tsx's
// read-only overview) so the tile sources/icons/labels stay in sync instead
// of drifting between two copies.
export type MapStyle = "light" | "dark" | "satellite";

// Satellite (Esri) and Light (CyclOSM) need no signup/key. Dark deliberately
// isn't Jawg.Matrix — like Stadia's AlidadeSatellite, Jawg requires an
// access token for every request (verified live: an unkeyed request comes
// back "NO_ACCESS_TOKEN_PROVIDED") — CartoDB Dark Matter was picked instead
// since it needs no signup either.
export const TILE_SOURCES: Record<MapStyle, { url: string; attribution: string; subdomains?: string }> = {
  light: {
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    attribution:
      '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> | Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
};

export const STYLE_OPTIONS: { key: MapStyle; label: string; icon: typeof Sun }[] = [
  { key: "light", label: "Terang", icon: Sun },
  { key: "dark", label: "Gelap", icon: Moon },
  { key: "satellite", label: "Satelit", icon: Satellite },
];
