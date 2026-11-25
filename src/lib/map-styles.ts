import { Sun, Moon, Satellite } from "lucide-react";

// Shared between every Leaflet map in the dashboard that offers a style
// switcher (mitra-location-map.tsx's single-pin editor, mitra-locations-map.tsx's
// read-only overview) so the tile sources/icons/labels stay in sync instead
// of drifting between two copies.
export type MapStyle = "light" | "dark" | "satellite";

// Satellite (Esri) and Light (CyclOSM) need no signup/key. Dark: Jawg and
// Stadia need an access token, and CARTO Dark Matter (dipakai sebelumnya)
// sejak 2026-11 juga mengembalikan tile bertanda "API KEY REQUIRED" untuk
// permintaan tanpa kunci (terverifikasi langsung 2026-11-25). Diganti Esri
// World Dark Gray Canvas — server yang sama dengan Satelit, tanpa kunci —
// dengan label nama tempat sebagai lapisan terpisah (labelUrl). Tile Esri
// Canvas hanya tersedia sampai zoom 16 (maxNativeZoom), di atasnya diperbesar.
// Peta dasar vektor (MapLibre GL, lihat lapisan-vektor.tsx).
export interface VektorTile {
  styleUrl: string; // gaya Mapbox/MapLibre (JSON)
  tileServer: string; // VectorTileServer Esri — sumber gaya diganti pola tile-nya
  maxzoom: number; // zoom tile asli tertinggi; di atasnya diperbesar
}

export interface TileSource {
  url: string;
  attribution: string;
  subdomains?: string;
  // Lapisan label terpisah di atas dasar peta (dirender PetaTile).
  labelUrl?: string;
  maxNativeZoom?: number;
  // Bila ada, dipakai lebih dulu (url/labelUrl = cadangan raster bila tanpa
  // WebGL atau gaya gagal dimuat).
  vektor?: VektorTile;
}

export const TILE_SOURCES: Record<MapStyle, TileSource> = {
  light: {
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    attribution:
      '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> | Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  dark: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    labelUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
    maxNativeZoom: 16,
    // OpenStreetMap Streets Night (Esri, Web Mercator) — vektor, gratis tanpa
    // kunci (diuji 2026-11-25). Versi "WGS84" (fd7837ee…) TIDAK cocok:
    // proyeksinya EPSG:4326, sedangkan Leaflet di sini Web Mercator.
    vektor: {
      styleUrl: "https://www.arcgis.com/sharing/rest/content/items/cfd9ac2b1621469b9df9173de53c1601/resources/styles/root.json",
      tileServer: "https://basemaps.arcgis.com/arcgis/rest/services/OpenStreetMap_v2/VectorTileServer",
      maxzoom: 15,
    },
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
