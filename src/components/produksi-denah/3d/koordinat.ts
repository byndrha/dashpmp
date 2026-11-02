// Koordinat & geometri turunan untuk Mode 3D Replika (spec v2 §7).
// MURNI & client-safe: TIDAK mengimpor three / React — diuji node:test di
// src/lib/__tests__/produksi-denah-3d.test.ts. Semua posisi berasal dari
// fungsi geometri BERSAMA (tataBakMeter, keDunia, kotakElemen, garisRel)
// agar 3D tidak pernah berbeda dengan 2D.
//
// Sistem koordinat: denah x kanan, y bawah (selatan bila utara 0°), z =
// elevasi dari ±0,00. three: x = x denah, y = elevasi (atas), z = y denah.
// Satu unit = 1 meter. Karena rotasi elemen selalu kelipatan 90°, setiap
// kotak (bak, can, mesin, …) tetap sejajar sumbu setelah rotasi.

import { kotakElemen, type BakElemen, type DenahDokumen, type DenahElemen, type DindingElemen, type GalatDenah, type JalurElemen, type PintuElemen, type Titik, type Varian } from "@/lib/produksi-denah";
import { keDunia, tataBakMeter } from "@/lib/produksi-denah-geometri";
import { ruangBebasDerekDibutuhkan } from "@/lib/produksi-denah-teknik";

export type Vek3 = [number, number, number];

export interface Kotak2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Denah (x, y, z=elevasi) → three [x, y=elevasi, z=y denah]. */
export function keThree(x: number, y: number, z: number): Vek3 {
  return [x, z, y];
}

/** Kotak denah + rentang elevasi → pusat & ukuran kotak three. */
export function kotakThree(k: Kotak2D, zBawah: number, tinggi: number): { pusat: Vek3; ukuran: Vek3 } {
  return { pusat: keThree(k.x + k.w / 2, k.y + k.h / 2, zBawah + tinggi / 2), ukuran: [k.w, tinggi, k.h] };
}

/** Kotak lokal-elemen (sebelum rotasi) → kotak dunia sejajar sumbu (via keDunia). */
export function kotakLokalKeDunia(e: DenahElemen, lokal: Kotak2D): Kotak2D {
  const p = keDunia(e, { x: lokal.x, y: lokal.y });
  const q = keDunia(e, { x: lokal.x + lokal.w, y: lokal.y + lokal.h });
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
}

// ---------- Bak ----------

export interface InstansIceCan {
  pusat: Vek3;
  ukuran: Vek3;
  kolomId: string;
  nonaktif: boolean;
}

/**
 * Semua ice can sebuah bak, dikelompokkan per varian (satu InstancedMesh per
 * varian). Bibir can sejajar bibir bak → dasar can = bibirZ − tinggi can.
 */
export function iceCanBak(bak: BakElemen): Record<Varian, InstansIceCan[]> {
  const t = tataBakMeter(bak);
  const hasil: Record<Varian, InstansIceCan[]> = { kecil: [], besar: [] };
  for (const k of t.kolom) {
    const tinggi = bak.iceCan[k.varian].tinggiMm / 1000;
    const zPusat = t.bibirZ - tinggi / 2;
    const langkah = k.panjangCan + k.jarakCan;
    for (let j = 0; j < k.jumlah; j++) {
      const w = kotakLokalKeDunia(bak, t.keXY(k.a0, k.b0 + j * langkah, k.lebar, k.panjangCan));
      hasil[k.varian].push({
        pusat: keThree(w.x + w.w / 2, w.y + w.h / 2, zPusat),
        ukuran: [w.w, tinggi, w.h],
        kolomId: k.kolomId,
        nonaktif: k.nonaktif,
      });
    }
  }
  return hasil;
}

/** Di atas ini (total ice can semua bak tampil) ice can tidak digambar — hanya cangkang bak. */
export const BATAS_INSTANS_ICE_CAN = 200_000;

/** Total instans ice can yang akan digambar (semua kolom, termasuk nonaktif — sama dengan iceCanBak). */
export function hitungInstansIceCan(elemen: readonly DenahElemen[]): number {
  let n = 0;
  for (const e of elemen) if (e.tipe === "bak") for (const k of e.kolom) n += Math.max(0, k.jumlahIceCan);
  return n;
}

/**
 * Kotak ruang bebas derek di atas bak (aturan 3): tapak bak × rentang dari
 * ruangBebasDerekDibutuhkan (fungsi yang sama dengan periksaTeknik, jadi
 * kotak 3D dan aturan tidak bisa berbeda). null bila tidak ada kolom aktif.
 */
export function ruangBebasDerek(bak: BakElemen): { kotak: Kotak2D; zBawah: number; zAtas: number } | null {
  const r = ruangBebasDerekDibutuhkan(bak);
  return r ? { kotak: kotakElemen(bak), ...r } : null;
}

/** Kunci pasangan derek–bak untuk derekTerlaluRendah. */
export function kunciDerekBak(derekId: string, bakId: string): string {
  return `${derekId}:${bakId}`;
}

/**
 * Pasangan `${derekId}:${bakId}` yang terkena aturan 3 (kode
 * "derek-terlalu-rendah") dari periksaTeknik — sumber tunggal merah/hijau
 * kotak ruang bebas, PER BAK (satu derek bisa melayani beberapa bak).
 */
export function derekTerlaluRendah(peringatan: readonly GalatDenah[]): Set<string> {
  const s = new Set<string>();
  for (const g of peringatan) {
    if (g.kode !== "derek-terlalu-rendah" || !g.elemenId) continue;
    for (const bakId of g.elemenTerkaitIds ?? []) s.add(kunciDerekBak(g.elemenId, bakId));
  }
  return s;
}

// ---------- Derek / balok miring ----------

/** Balok lurus a→b: titik tengah (denah), panjang, dan rotasi sumbu-Y three (radian). */
export function balokAntara(a: Titik, b: Titik): { pusat: Titik; panjang: number; rotY: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { pusat: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, panjang: Math.hypot(dx, dy), rotY: -Math.atan2(dy, dx) };
}

// ---------- Dinding & pintu ----------

export interface BalokZ {
  kotak: Kotak2D;
  zBawah: number;
  zAtas: number;
}

const EPS = 1e-9;

/**
 * Dinding dipotong oleh pintu yang bersinggungan (tapak & rentang tinggi
 * beririsan): di rentang pintu (sepanjang sumbu panjang dinding) hanya
 * tersisa bagian di atas (dan di bawah) pintu. Tanpa pintu → satu balok utuh.
 */
export function potongDinding(d: Pick<DindingElemen, "x" | "y" | "w" | "h" | "rotasi" | "elevasiM" | "tinggiM">, daftarPintu: readonly Pick<PintuElemen, "x" | "y" | "w" | "h" | "rotasi" | "elevasiM" | "tinggiM">[]): BalokZ[] {
  const k = kotakElemen(d);
  const zB = d.elevasiM;
  const zA = d.elevasiM + d.tinggiM;
  const sepanjangX = k.w >= k.h;
  const awal = sepanjangX ? k.x : k.y;
  const akhir = sepanjangX ? k.x + k.w : k.y + k.h;

  const rentang: { a: number; b: number; bawah: number; atas: number }[] = [];
  for (const p of daftarPintu) {
    const pk = kotakElemen(p);
    const irisX = Math.min(k.x + k.w, pk.x + pk.w) - Math.max(k.x, pk.x);
    const irisY = Math.min(k.y + k.h, pk.y + pk.h) - Math.max(k.y, pk.y);
    if (irisX <= EPS || irisY <= EPS) continue;
    const bawah = Math.max(zB, p.elevasiM);
    const atas = Math.min(zA, p.elevasiM + p.tinggiM);
    if (atas <= bawah + EPS) continue;
    const a = Math.max(awal, sepanjangX ? pk.x : pk.y);
    const b = Math.min(akhir, sepanjangX ? pk.x + pk.w : pk.y + pk.h);
    if (b > a + EPS) rentang.push({ a, b, bawah, atas });
  }
  if (rentang.length === 0) return [{ kotak: k, zBawah: zB, zAtas: zA }];

  // Gabungkan rentang yang bertumpuk.
  rentang.sort((p, q) => p.a - q.a);
  const gabung: typeof rentang = [];
  for (const r of rentang) {
    const akhirG = gabung[gabung.length - 1];
    if (akhirG && r.a <= akhirG.b + EPS) {
      akhirG.b = Math.max(akhirG.b, r.b);
      akhirG.bawah = Math.min(akhirG.bawah, r.bawah);
      akhirG.atas = Math.max(akhirG.atas, r.atas);
    } else gabung.push({ ...r });
  }

  const potong = (a: number, b: number): Kotak2D => (sepanjangX ? { x: a, y: k.y, w: b - a, h: k.h } : { x: k.x, y: a, w: k.w, h: b - a });
  const hasil: BalokZ[] = [];
  let kursor = awal;
  for (const r of gabung) {
    if (r.a > kursor + EPS) hasil.push({ kotak: potong(kursor, r.a), zBawah: zB, zAtas: zA });
    if (r.atas < zA - EPS) hasil.push({ kotak: potong(r.a, r.b), zBawah: r.atas, zAtas: zA });
    if (r.bawah > zB + EPS) hasil.push({ kotak: potong(r.a, r.b), zBawah: zB, zAtas: r.bawah });
    kursor = r.b;
  }
  if (akhir > kursor + EPS) hasil.push({ kotak: potong(kursor, akhir), zBawah: zB, zAtas: zA });
  return hasil;
}

// ---------- Pelat lantai ----------

/** Penyusutan tiap sisi lubang pelat (m) — ≈1 mm, tak terlihat di layar. */
export const SUSUT_LUBANG_PELAT = 0.001;

/**
 * Lubang di pelat lantai untuk bak/tangki yang tertanam (elevasi < 0), agar
 * pelat tidak menutupi isi bak. Triangulasi Shape menuntut lubang tidak
 * bertumpuk/bersinggungan satu sama lain maupun dengan tepi pelat, jadi:
 * - tiap lubang dipotong (clamp) ke lahan lalu disusutkan SUSUT_LUBANG_PELAT
 *   per sisi — bak yang menempel tepi lahan atau menempel bak lain (berbagi
 *   tepi, sah menurut validasiDenah) tetap berlubang;
 * - lubang yang masih bertumpuk SUNGGUHAN (uji ketat) dengan lubang
 *   sebelumnya dilewati.
 */
export function lubangPelat(dok: DenahDokumen): Kotak2D[] {
  const { lebar, tinggi } = dok.kanvas;
  const s = SUSUT_LUBANG_PELAT;
  const hasil: Kotak2D[] = [];
  for (const e of dok.elemen) {
    if ((e.tipe !== "bak" && e.tipe !== "tangki") || !(e.elevasiM < 0)) continue;
    const k = kotakElemen(e);
    const x1 = Math.max(k.x, 0) + s;
    const y1 = Math.max(k.y, 0) + s;
    const x2 = Math.min(k.x + k.w, lebar) - s;
    const y2 = Math.min(k.y + k.h, tinggi) - s;
    if (!(x2 - x1 > EPS) || !(y2 - y1 > EPS)) continue;
    const l2: Kotak2D = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    const tumpuk = hasil.some((l) => Math.min(l.x + l.w, x2) - Math.max(l.x, x1) > EPS && Math.min(l.y + l.h, y2) - Math.max(l.y, y1) > EPS);
    if (!tumpuk) hasil.push(l2);
  }
  return hasil;
}

// ---------- Batas elemen (outline seleksi, label, fokus kamera) ----------

/** Kotak dunia + rentang elevasi yang membungkus elemen. */
export function batasElemen(e: DenahElemen): BalokZ {
  switch (e.tipe) {
    case "jalur":
      return batasJalur(e);
    case "derek":
      return { kotak: kotakElemen(e), zBawah: e.elevasiM - e.tinggiKaitM, zAtas: e.elevasiM + e.tinggiM };
    case "area":
    case "label":
      return { kotak: kotakElemen(e), zBawah: e.elevasiM, zAtas: e.elevasiM + Math.max(e.tinggiM, 0.05) };
    default:
      return { kotak: kotakElemen(e), zBawah: e.elevasiM, zAtas: e.elevasiM + Math.max(e.tinggiM, 0.01) };
  }
}

/** Diameter visual jalur (m): diameter nyata, minimum 30 mm. */
export function diameterVisualM(j: Pick<JalurElemen, "diameterMm">): number {
  return Math.max(j.diameterMm / 1000, 0.03);
}

function batasJalur(j: JalurElemen): BalokZ {
  const r = diameterVisualM(j) / 2;
  if (j.titik.length === 0) return { kotak: kotakElemen(j), zBawah: j.elevasiM, zAtas: j.elevasiM + r * 2 };
  let x1 = Infinity, y1 = Infinity, z1 = Infinity, x2 = -Infinity, y2 = -Infinity, z2 = -Infinity;
  for (const t of j.titik) {
    x1 = Math.min(x1, t.x);
    y1 = Math.min(y1, t.y);
    z1 = Math.min(z1, t.z);
    x2 = Math.max(x2, t.x);
    y2 = Math.max(y2, t.y);
    z2 = Math.max(z2, t.z);
  }
  return { kotak: { x: x1 - r, y: y1 - r, w: x2 - x1 + 2 * r, h: y2 - y1 + 2 * r }, zBawah: z1 - r, zAtas: z2 + r };
}

// ---------- HUD mata angin ----------

/**
 * Sudut layar (derajat, 0 = atas, searah jarum jam) dari titik pusat ke
 * proyeksi ujung arah utara — untuk memutar HUD MawarAngin mengikuti kamera.
 * Koordinat layar: y ke bawah.
 */
export function sudutLayarUtara(pusat: Titik, ujungUtara: Titik): number {
  const d = (Math.atan2(ujungUtara.x - pusat.x, -(ujungUtara.y - pusat.y)) * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

/** Arah utara di dunia three (vektor satuan di bidang lantai) dari kanvas.utaraDerajat. */
export function arahUtaraThree(utaraDerajat: number): Vek3 {
  const r = (utaraDerajat * Math.PI) / 180;
  return keThree(Math.sin(r), -Math.cos(r), 0);
}
