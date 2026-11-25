"use client";

import { useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { TileLayer } from "react-leaflet";
import { TILE_SOURCES, type MapStyle } from "@/lib/map-styles";

// MapLibre GL (~800 KB) hanya diunduh saat gaya vektor (mode gelap) dipakai.
const LapisanVektor = dynamic(() => import("@/components/dashboard/lapisan-vektor").then((m) => m.LapisanVektor), {
  ssr: false,
});

// Dicek SEKALI per sesi lalu disimpan: getSnapshot dipanggil tiap render,
// dan setiap getContext membuat konteks WebGL baru — browser hanya
// mengizinkan ~16 sekaligus, sehingga konteks milik peta MapLibre sendiri
// ikut dibuang ("context lost", peta jadi kosong). Konteks uji juga
// langsung dilepas.
let webglTersedia: boolean | null = null;
function cekWebgl(): boolean {
  if (webglTersedia != null) return webglTersedia;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    webglTersedia = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglTersedia = false;
  }
  return webglTersedia;
}
const langgananKosong = () => () => {};

// Lapisan peta dasar untuk gaya terpilih — dipakai semua peta Leaflet yang
// punya pengalih gaya, supaya sumber peta selalu seragam:
// - gaya vektor (mode gelap: OpenStreetMap Streets Night Esri) lewat
//   MapLibre GL; tanpa WebGL atau bila gaya gagal dimuat → tile raster
//   cadangan (url/labelUrl) supaya peta tidak pernah kosong;
// - gaya raster: TileLayer + lapisan label terpisah bila ada.
// key={mapStyle}: instance baru per gaya, supaya Leaflet tidak mencoba
// memakai ulang tile antar server yang berbeda.
export function PetaTile({ mapStyle }: { mapStyle: MapStyle }) {
  const tile = TILE_SOURCES[mapStyle];
  const webgl = useSyncExternalStore(langgananKosong, cekWebgl, () => false);
  const [vektorGagal, setVektorGagal] = useState(false);

  if (tile.vektor && webgl && !vektorGagal) {
    return <LapisanVektor key={mapStyle} vektor={tile.vektor} onGagal={() => setVektorGagal(true)} />;
  }
  return (
    <>
      <TileLayer
        key={mapStyle}
        attribution={tile.attribution}
        url={tile.url}
        subdomains={tile.subdomains ?? "abc"}
        maxNativeZoom={tile.maxNativeZoom}
      />
      {tile.labelUrl && <TileLayer key={`${mapStyle}-label`} url={tile.labelUrl} maxNativeZoom={tile.maxNativeZoom} />}
    </>
  );
}
