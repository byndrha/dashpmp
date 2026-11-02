// Preset kamera & rentang alat Mode 3D Replika (spec v2 §7 "Alat 3D").
// MURNI & client-safe: TIDAK mengimpor three / React — diuji node:test di
// src/lib/__tests__/produksi-denah-kamera.test.ts. Koordinat masukan dalam
// sistem DENAH (x, y lantai; z elevasi); keluaran dalam sistem three (lihat
// keThree di koordinat.ts).

import type { DenahDokumen } from "@/lib/produksi-denah";
import { batasElemen, keThree, type BalokZ, type Vek3 } from "./koordinat";

export type PresetKamera = "iso" | "atas" | "depan" | "fokus";

/** Kotak denah sejajar sumbu + rentang elevasi. */
export interface Kotak3D {
  x: number;
  y: number;
  w: number;
  h: number;
  zBawah: number;
  zAtas: number;
}

export interface OpsiPreset {
  /** Field of view vertikal kamera perspektif (derajat). Bawaan 45. */
  fovDerajat?: number;
  /** Lebar ÷ tinggi viewport. Bawaan 1. */
  aspek?: number;
}

/** Arah kamera (dari target) per preset, sebelum dinormalkan. */
const ARAH: Record<PresetKamera, Vek3> = {
  iso: [1, 1, 1],
  atas: [0, 1, 0],
  // Dari selatan (+y denah = +z three), sedikit dari atas agar bak tertanam tetap terlihat.
  depan: [0, 0.25, 1],
  fokus: [1, 1, 1],
};
const MARGIN = 1.05;
/** Jarak minimum preset "fokus" (m) agar elemen kecil tidak menempel di lensa. */
const JARAK_FOKUS_MIN = 2;

/**
 * Posisi & target kamera untuk preset. Target = pusat 3D kotak; jarak dipilih
 * agar bola pembungkus kotak masuk ke field of view tersempit (vertikal atau
 * horizontal, tergantung aspek).
 */
export function posisiPreset(preset: PresetKamera, kotak: Kotak3D, opsi: OpsiPreset = {}): { posisi: Vek3; target: Vek3 } {
  const target = keThree(kotak.x + kotak.w / 2, kotak.y + kotak.h / 2, (kotak.zBawah + kotak.zAtas) / 2);
  const fovV = ((opsi.fovDerajat ?? 45) * Math.PI) / 180;
  const aspek = opsi.aspek && opsi.aspek > 0 ? opsi.aspek : 1;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspek);
  const fov = Math.min(fovV, fovH);
  const r = Math.max(Math.hypot(kotak.w, kotak.h, kotak.zAtas - kotak.zBawah) / 2, 0.5);
  let jarak = (r / Math.sin(fov / 2)) * MARGIN;
  if (preset === "fokus") jarak = Math.max(jarak, JARAK_FOKUS_MIN);
  const [ax, ay, az] = ARAH[preset];
  const n = Math.hypot(ax, ay, az);
  return { posisi: [target[0] + (ax / n) * jarak, target[1] + (ay / n) * jarak, target[2] + (az / n) * jarak], target };
}

/** Zoom kamera ortografis (piksel per meter) agar tapak kotak muat di viewport. */
export function zoomOrtografis(kotak: Kotak3D, lebarPx: number, tinggiPx: number): number {
  const z = Math.min(Math.max(lebarPx, 1) / Math.max(kotak.w, 0.5), Math.max(tinggiPx, 1) / Math.max(kotak.h, 0.5));
  return z / 1.1;
}

/** Kotak pembungkus beberapa batas elemen; null bila kosong. */
export function gabungKotak(daftar: readonly BalokZ[]): Kotak3D | null {
  if (daftar.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, z1 = Infinity, x2 = -Infinity, y2 = -Infinity, z2 = -Infinity;
  for (const b of daftar) {
    x1 = Math.min(x1, b.kotak.x);
    y1 = Math.min(y1, b.kotak.y);
    x2 = Math.max(x2, b.kotak.x + b.kotak.w);
    y2 = Math.max(y2, b.kotak.y + b.kotak.h);
    z1 = Math.min(z1, b.zBawah);
    z2 = Math.max(z2, b.zAtas);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, zBawah: z1, zAtas: z2 };
}

/** Kotak seluruh adegan: lahan + tebal pelat lantai + semua elemen. */
export function kotakAdegan(dok: DenahDokumen): Kotak3D {
  const { lebar, tinggi, pelatLantai } = dok.kanvas;
  const lahan: BalokZ = { kotak: { x: 0, y: 0, w: lebar, h: tinggi }, zBawah: -Math.max(pelatLantai.tebalM, 0), zAtas: 0 };
  return gabungKotak([lahan, ...dok.elemen.map(batasElemen)])!;
}

export type ModePotongan = "tidak" | "horizontal" | "x" | "y";

/** Rentang slider potongan: horizontal = elevasi; x/y = sumbu denah. */
export function rentangPotongan(mode: Exclude<ModePotongan, "tidak">, kotak: Kotak3D): { min: number; maks: number } {
  if (mode === "horizontal") return { min: kotak.zBawah, maks: kotak.zAtas };
  if (mode === "x") return { min: kotak.x, maks: kotak.x + kotak.w };
  return { min: kotak.y, maks: kotak.y + kotak.h };
}

/** Alat Ukur 3D: dua titik three → jarak 3D, Δ horizontal (bidang lantai), Δ tinggi (absolut). */
export function hasilUkur3D(a: Vek3, b: Vek3): { jarak: number; horizontal: number; tinggi: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return { jarak: Math.hypot(dx, dy, dz), horizontal: Math.hypot(dx, dz), tinggi: Math.abs(dy) };
}
