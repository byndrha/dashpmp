// Palet warna Denah Produksi (nilai hex) — SATU sumber untuk 2D (SVG) dan 3D
// (material three.js), agar kedua tampilan sepakat. MURNI: tanpa React.
//
// Konvensi warna jalur mengikuti kebiasaan lapangan: air biru, drain coklat,
// amonia (NH3) kuning/oranye, brine ungu, udara abu muda; kabel daya merah,
// kabel kontrol hijau.

import { FLUIDA_BAWAAN, SISTEM_KABEL_BAWAAN, type Fluida, type JalurElemen, type KategoriMesin } from "@/lib/produksi-denah";

export const WARNA_FLUIDA: Record<Fluida, string> = {
  "air-baku": "#2563eb", // biru
  "air-pendingin": "#06b6d4", // cyan
  "air-thawing": "#60a5fa", // biru muda
  drain: "#92400e", // coklat
  brine: "#9333ea", // ungu
  "nh3-cair": "#f97316", // oranye
  "nh3-gas": "#facc15", // kuning
  udara: "#cbd5e1", // abu muda
};

export const WARNA_KABEL: Record<"daya" | "kontrol", string> = {
  daya: "#dc2626", // merah
  kontrol: "#16a34a", // hijau
};

export const WARNA_MESIN: Record<KategoriMesin, string> = {
  refrigerasi: "#8b5cf6", // ungu (sama dengan mesin di 2D)
  pompa: "#0ea5e9", // biru langit
  listrik: "#ef4444", // merah
  lainnya: "#64748b", // abu
};

/** Beton (bak, pondasi, plinth). */
export const WARNA_BETON = "#a8a29e";
/** Air di dalam tangki / brine. */
export const WARNA_AIR = "#38bdf8";

/** Warna jalur: pipa per fluida, kabel per sistem (bawaan bila kosong). */
export function warnaJalur(j: Pick<JalurElemen, "jenis" | "fluida" | "sistem">): string {
  return j.jenis === "kabel" ? WARNA_KABEL[j.sistem ?? SISTEM_KABEL_BAWAAN] : WARNA_FLUIDA[j.fluida ?? FLUIDA_BAWAAN];
}
