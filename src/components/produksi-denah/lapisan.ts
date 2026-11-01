"use client";

// Visibilitas lapisan denah (spec v2 §4) — preferensi PER PENGGUNA di
// localStorage, bukan di dokumen. Dipakai kanvas 2D dan mode 3D.
//
// Yang disimpan adalah daftar lapisan TERSEMBUNYI, jadi lapisan baru di masa
// depan otomatis tampil. Semua akses storage dibungkus try/catch: tanpa
// storage (mode privat, diblokir) semuanya tetap tampil dan toggle tetap
// berfungsi selama halaman terbuka.

import { useCallback, useSyncExternalStore } from "react";
import { lapisanElemen, type DenahElemen, type Lapisan } from "@/lib/produksi-denah";

export const KUNCI_LAPISAN = "produksi-denah:lapisan";

export const DAFTAR_LAPISAN: readonly { id: Lapisan; label: string; petunjuk: string }[] = [
  { id: "arsitektur", label: "Arsitektur", petunjuk: "Dinding, pintu, area, label, beton" },
  { id: "proses", label: "Proses", petunjuk: "Bak, derek, tangki filling/thawing" },
  { id: "refrigerasi", label: "Refrigerasi", petunjuk: "Mesin refrigerasi, jalur NH3/brine" },
  { id: "air", label: "Air", petunjuk: "Tangki lain, pompa, jalur air/drain/udara" },
  { id: "listrik", label: "Listrik", petunjuk: "Mesin listrik, kabel" },
  { id: "lainnya", label: "Lainnya", petunjuk: "Mesin kategori lainnya" },
];

const ID_SAH: ReadonlySet<string> = new Set(DAFTAR_LAPISAN.map((l) => l.id));

/** Teks storage (JSON daftar tersembunyi) → set lapisan TAMPIL. Data rusak = semua tampil. */
export function uraiLapisan(raw: string | null): Set<Lapisan> {
  const tampil = new Set<Lapisan>(DAFTAR_LAPISAN.map((l) => l.id));
  if (!raw) return tampil;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return tampil;
  }
  if (!Array.isArray(data)) return tampil;
  for (const v of data) if (typeof v === "string" && ID_SAH.has(v)) tampil.delete(v as Lapisan);
  return tampil;
}

/** Set lapisan tampil → teks storage (JSON daftar tersembunyi). */
export function serialLapisan(tampil: ReadonlySet<Lapisan>): string {
  return JSON.stringify(DAFTAR_LAPISAN.map((l) => l.id).filter((id) => !tampil.has(id)));
}

/**
 * ID (mis. seleksi) yang elemennya ada DAN lapisannya tampil. Elemen di
 * lapisan tersembunyi tidak pernah dikenai aksi. Bila tidak ada yang dibuang,
 * array masukan dikembalikan apa adanya (referensi stabil untuk memo).
 */
export function idTerlihat(ids: readonly string[], elemen: readonly DenahElemen[], tampil: ReadonlySet<Lapisan>): readonly string[] {
  if (ids.length === 0) return ids;
  const byId = new Map(elemen.map((e) => [e.id, e]));
  const hasil = ids.filter((id) => {
    const e = byId.get(id);
    return !!e && tampil.has(lapisanElemen(e));
  });
  return hasil.length === ids.length ? ids : hasil;
}

/** Lapisan (unik, urut kemunculan) dari elemen ini yang sedang tersembunyi. */
export function lapisanTersembunyiDari(elemen: readonly DenahElemen[], tampil: ReadonlySet<Lapisan>): Lapisan[] {
  const hasil: Lapisan[] = [];
  for (const e of elemen) {
    const l = lapisanElemen(e);
    if (!tampil.has(l) && !hasil.includes(l)) hasil.push(l);
  }
  return hasil;
}

// ---------- Toko modul (bersama semua komponen di halaman) ----------

const pendengar = new Set<() => void>();
let rawCache: string | null | undefined; // undefined = belum dibaca
let snapCache: ReadonlySet<Lapisan> = uraiLapisan(null);
/** Nilai cadangan saat storage tidak bisa dibaca/ditulis (berlaku selama halaman terbuka). */
let rawMemori: string | null = null;
let storageGagal = false;
const SEMUA: ReadonlySet<Lapisan> = uraiLapisan(null);

function bacaRaw(): string | null {
  if (storageGagal) return rawMemori;
  try {
    return window.localStorage.getItem(KUNCI_LAPISAN);
  } catch {
    storageGagal = true;
    return rawMemori;
  }
}

function ambilSnapshot(): ReadonlySet<Lapisan> {
  const raw = bacaRaw();
  if (raw !== rawCache) {
    rawCache = raw;
    snapCache = uraiLapisan(raw);
  }
  return snapCache;
}

function ambilSnapshotServer(): ReadonlySet<Lapisan> {
  return SEMUA;
}

function langgan(cb: () => void): () => void {
  pendengar.add(cb);
  const dariTabLain = (e: StorageEvent) => {
    if (e.key === null || e.key === KUNCI_LAPISAN) cb();
  };
  window.addEventListener("storage", dariTabLain);
  return () => {
    pendengar.delete(cb);
    window.removeEventListener("storage", dariTabLain);
  };
}

function aturLapisan(l: Lapisan, tampil: boolean) {
  const baru = new Set(ambilSnapshot());
  if (tampil) baru.add(l);
  else baru.delete(l);
  const raw = serialLapisan(baru);
  rawMemori = raw;
  try {
    window.localStorage.setItem(KUNCI_LAPISAN, raw);
  } catch {
    storageGagal = true; // Storage tidak tersedia: pakai rawMemori.
  }
  for (const cb of pendengar) cb();
}

/** [lapisan tampil, atur(lapisan, tampil)] — bawaan semua tampil. */
export function useLapisanTampil(): [ReadonlySet<Lapisan>, (l: Lapisan, tampil: boolean) => void] {
  const tampil = useSyncExternalStore(langgan, ambilSnapshot, ambilSnapshotServer);
  const atur = useCallback((l: Lapisan, t: boolean) => aturLapisan(l, t), []);
  return [tampil, atur];
}
