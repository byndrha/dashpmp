// Geometri denah produksi Es Balok berskala nyata (meter) — dipakai BERSAMA
// oleh kanvas 2D (SVG) dan adegan 3D, supaya keduanya selalu sepakat.
// CLIENT-SAFE & murni: jangan mengimpor apa pun yang menarik pg/mssql/server.
// Spec: docs/superpowers/specs/2026-11-01-produksi-es-balok-denah-v2-3d-design.md
//
// Koordinat "lokal" elemen = relatif terhadap pojok kiri-atas elemen (x, y)
// SEBELUM rotasi — sama dengan isi grup SVG `translate(x y) rotate(r w/2 h/2)`.
// keDunia() menerapkan transformasi itu.

import { kotakElemen, orientasiKolom, type BakElemen, type OrientasiCan, type DenahDokumen, type DenahElemen, type DerekElemen, type JalurElemen, type Titik, type Titik3D, type Varian } from "./produksi-denah";

// ---------- Tata bak ----------

/**
 * Satu kolom dalam koordinat LOKAL bak (a = sumbu deret kolom, b = sumbu
 * sepanjang kolom). Ice can ke-j: b = b0 + j * (panjangCan + jarakCan),
 * selebar `lebar` di sumbu a mulai a0.
 */
export interface TataKolom {
  kolomId: string;
  /** Indeks di array bak.kolom. */
  indeks: number;
  /** Urutan fisik dari pangkal sumbu a (setelah arahNomor). */
  posisi: number;
  a0: number;
  lebar: number;
  b0: number;
  panjangCan: number;
  jarakCan: number;
  jumlah: number;
  varian: Varian;
  /** Orientasi can di kolom ini; `lebar` & `panjangCan` sudah mengikutinya. */
  orientasi: OrientasiCan;
  nonaktif: boolean;
}

export interface TataBak {
  /** Urut sesuai bak.kolom (indeks). */
  kolom: TataKolom[];
  /** Ruang dalam bak (sisi − 2 × tebal dinding) per sumbu. */
  ruangA: number;
  ruangB: number;
  /** Ruang yang dibutuhkan kolom & ice can per sumbu. */
  butuhA: number;
  butuhB: number;
  bibirZ: number;
  lantaiDalamZ: number;
  brineZ: number;
  /** (a, b, da, db) lokal-bak → kotak x/y lokal-elemen (sebelum rotasi). */
  keXY(a: number, b: number, da: number, db: number): { x: number; y: number; w: number; h: number };
}

// horizontal: a = x, b = y; vertikal: a = y, b = x (sama dengan tataBak lama di denah-kanvas.tsx).
export function tataBakMeter(bak: BakElemen): TataBak {
  const horizontal = bak.orientasiKolom === "horizontal";
  const tebal = bak.tebalDindingM;
  const jarakKolom = bak.jarakAntarKolomMm / 1000;
  const jarakCan = bak.jarakAntarCanMm / 1000;
  const n = bak.kolom.length;
  const posisiDari = (i: number) => (bak.arahNomor === "mundur" ? n - 1 - i : i);

  // Indeks kolom menurut urutan posisi fisik.
  const urutPosisi: number[] = new Array(n);
  for (let i = 0; i < n; i++) urutPosisi[posisiDari(i)] = i;

  const kolom: TataKolom[] = new Array(n);
  let a = tebal + jarakKolom;
  let maksB = 0;
  for (let p = 0; p < n; p++) {
    const i = urutPosisi[p];
    const k = bak.kolom[i];
    const dim = bak.iceCan[k.varian];
    const orientasi = orientasiKolom(k);
    const tegak = orientasi === "tegak";
    const lebar = (tegak ? dim.panjangMm : dim.lebarMm) / 1000;
    const panjangCan = (tegak ? dim.lebarMm : dim.panjangMm) / 1000;
    kolom[i] = {
      kolomId: k.id,
      indeks: i,
      posisi: p,
      a0: a,
      lebar,
      b0: tebal + jarakCan,
      panjangCan,
      jarakCan,
      jumlah: k.jumlahIceCan,
      varian: k.varian,
      nonaktif: k.nonaktif === true,
      orientasi,
    };
    a += lebar + jarakKolom;
    maksB = Math.max(maksB, k.jumlahIceCan * (panjangCan + jarakCan));
  }

  const sisiA = horizontal ? bak.w : bak.h;
  const sisiB = horizontal ? bak.h : bak.w;
  return {
    kolom,
    ruangA: sisiA - 2 * tebal,
    ruangB: sisiB - 2 * tebal,
    butuhA: a - tebal,
    butuhB: jarakCan + maksB,
    bibirZ: bak.elevasiM + bak.tinggiM,
    lantaiDalamZ: bak.elevasiM + bak.tebalDindingM,
    brineZ: bak.elevasiM + bak.levelBrineM,
    keXY: (ka, kb, da, db) => (horizontal ? { x: ka, y: kb, w: da, h: db } : { x: kb, y: ka, w: db, h: da }),
  };
}

// ---------- Rotasi ----------

/** Titik tengah elemen (poros rotasi) dalam koordinat dunia. */
export function pusatElemen(e: DenahElemen): { x: number; y: number } {
  return { x: e.x + e.w / 2, y: e.y + e.h / 2 };
}

/**
 * Lokal-elemen (relatif pojok kiri-atas, sebelum rotasi) → dunia. Sama persis
 * dengan SVG `translate(x y) rotate(rotasi w/2 h/2)` (y ke bawah, rotasi
 * positif searah jarum jam di layar).
 */
export function keDunia(e: DenahElemen, lokal: { x: number; y: number }): { x: number; y: number } {
  const dx = lokal.x - e.w / 2;
  const dy = lokal.y - e.h / 2;
  let rx: number, ry: number;
  switch (e.rotasi) {
    case 90:
      rx = -dy;
      ry = dx;
      break;
    case 180:
      rx = -dx;
      ry = -dy;
      break;
    case 270:
      rx = dy;
      ry = -dx;
      break;
    default:
      rx = dx;
      ry = dy;
  }
  const c = pusatElemen(e);
  return { x: c.x + rx, y: c.y + ry };
}

// ---------- Derek ----------

/** Garis rel (dunia). Titik belum diatur (sama) → garis tengah sisi terpanjang kotak efektif. */
export function garisRel(d: DerekElemen): { a: Titik; b: Titik } {
  const a = d.titikAwal;
  const b = d.titikAkhir;
  if (a.x !== b.x || a.y !== b.y) return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
  const k = kotakElemen(d);
  if (k.w >= k.h) return { a: { x: k.x, y: k.y + k.h / 2 }, b: { x: k.x + k.w, y: k.y + k.h / 2 } };
  return { a: { x: k.x + k.w / 2, y: k.y }, b: { x: k.x + k.w / 2, y: k.y + k.h } };
}

// ---------- Jalur ----------

export interface SegmenJalur {
  a: Titik3D;
  b: Titik3D;
  panjang: number;
}

/** Segmen berurutan (searah aliran) dengan panjang 3D. */
export function segmenJalur(j: JalurElemen): SegmenJalur[] {
  const hasil: SegmenJalur[] = [];
  for (let i = 1; i < j.titik.length; i++) {
    const a = j.titik[i - 1];
    const b = j.titik[i];
    hasil.push({ a, b, panjang: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) });
  }
  return hasil;
}

const EPS = 1e-9;

function titikTertanam(t: Titik3D, dok: DenahDokumen): boolean {
  if (t.z <= EPS && t.z >= -dok.kanvas.pelatLantai.tebalM - EPS) return true;
  for (const e of dok.elemen) {
    if (e.tipe !== "beton") continue;
    const k = kotakElemen(e);
    if (
      t.x >= k.x - EPS && t.x <= k.x + k.w + EPS &&
      t.y >= k.y - EPS && t.y <= k.y + k.h + EPS &&
      t.z >= e.elevasiM - EPS && t.z <= e.elevasiM + e.tinggiM + EPS
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Segmen tertanam di beton: setiap ujung berada di pelat lantai
 * (z ∈ [−tebalPelat, 0]) ATAU di dalam kotak + rentang z sebuah elemen beton.
 */
export function segmenTertanam(seg: { a: Titik3D; b: Titik3D }, dok: DenahDokumen): boolean {
  return titikTertanam(seg.a, dok) && titikTertanam(seg.b, dok);
}

/** Apakah segmen a→b menyentuh/menembus kotak 3D (metode slab). */
export function potongSegmenKotak(
  a: Titik3D,
  b: Titik3D,
  kotak: { x: number; y: number; w: number; h: number; zBawah: number; zAtas: number }
): boolean {
  let t0 = 0;
  let t1 = 1;
  const sumbu: [number, number, number, number][] = [
    [a.x, b.x - a.x, kotak.x, kotak.x + kotak.w],
    [a.y, b.y - a.y, kotak.y, kotak.y + kotak.h],
    [a.z, b.z - a.z, kotak.zBawah, kotak.zAtas],
  ];
  for (const [p, d, min, maks] of sumbu) {
    if (Math.abs(d) < EPS) {
      if (p < min || p > maks) return false;
      continue;
    }
    let ta = (min - p) / d;
    let tb = (maks - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}
