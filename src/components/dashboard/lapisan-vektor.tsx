"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { getVersion, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import type { VektorTile } from "@/lib/map-styles";

// MapLibre v6 mencari worker-nya ("./maplibre-gl-worker.mjs") relatif dari
// skripnya sendiri — setelah dibundel Turbopack file itu tidak ada, worker
// gagal dibuat TANPA pesan error dan semua tile tertahan "loading" (peta
// kosong). Worker disajikan dari public/vendor (salinan
// node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs, file mandiri).
// Saat maplibre-gl di-upgrade: salin ulang file worker versi baru ke
// public/vendor/maplibre-gl-worker-<versi>.mjs — nama file memuat versi,
// jadi versi yang tak cocok langsung ketahuan (404) dan tidak di-cache basi.
setWorkerUrl(`/vendor/maplibre-gl-worker-${getVersion()}.mjs`);

// Gaya vektor Esri dimuat sekali per sesi lalu dipakai ulang semua peta.
const cacheGaya = new Map<string, Promise<StyleSpecification>>();

// Gaya Esri menunjuk sumbernya ke metadata VectorTileServer (bukan TileJSON
// yang dikenali MapLibre) — diganti pola URL tile langsung.
function muatGaya(v: VektorTile): Promise<StyleSpecification> {
  let p = cacheGaya.get(v.styleUrl);
  if (!p) {
    p = fetch(v.styleUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`Gaya peta gagal dimuat (${r.status})`);
        return r.json() as Promise<StyleSpecification>;
      })
      .then((gaya) => {
        const sources = { ...gaya.sources };
        for (const [kunci, sumber] of Object.entries(sources)) {
          if (sumber.type === "vector" && "url" in sumber && sumber.url?.startsWith(v.tileServer)) {
            sources[kunci] = { type: "vector", tiles: [`${v.tileServer}/tile/{z}/{y}/{x}.pbf`], maxzoom: v.maxzoom };
          }
        }
        return { ...gaya, sources };
      });
    p.catch(() => cacheGaya.delete(v.styleUrl));
    cacheGaya.set(v.styleUrl, p);
  }
  return p;
}

// Lapisan peta dasar vektor (MapLibre GL) di dalam peta Leaflet. `onGagal`
// dipanggil bila gaya gagal dimuat — pemanggil kembali ke tile raster.
export function LapisanVektor({ vektor, onGagal }: { vektor: VektorTile; onGagal: () => void }) {
  const map = useMap();
  useEffect(() => {
    let batal = false;
    let lapisan: ReturnType<typeof maplibreGL> | null = null;
    muatGaya(vektor)
      .then((style) => {
        if (batal) return;
        lapisan = maplibreGL({ style, attributionControl: false });
        lapisan.addTo(map);
      })
      .catch(() => {
        if (!batal) onGagal();
      });
    return () => {
      batal = true;
      if (lapisan) map.removeLayer(lapisan);
    };
    // onGagal sengaja tidak jadi dependensi (fungsi baru tiap render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, vektor.styleUrl]);
  return null;
}
