// Analisis jejak GPS aktual satu perjalanan terhadap rencananya — sumber
// tunggal semua catatan "Log Pergerakan" di Validasi Rute (daftar tujuan dan
// peta memakai hasil yang sama). Fungsi murni, tanpa React/Leaflet.
//
// Masalah per TUJUAN (ditampilkan di kartu mitranya):
//   - pin_di_pabrik   : titik mitra berada di area pabrik (pin hampir pasti salah);
//   - drop_meleset    : tidak ada singgah di titik mitra, tapi ada singgah tak
//                       terjelaskan ≤ BATAS_KANDIDAT_M darinya → kemungkinan
//                       titik drop di sistem salah (lokasi sebenarnya di sana);
//   - hanya_melintas  : armada lewat dalam radius mitra tanpa singgah;
//   - tidak_didatangi : armada tidak pernah mendekati titik mitra;
//   - bongkar_lama    : total singgah di mitra ≥ BONGKAR_LAMA_MENIT.
// Catatan PERJALANAN (disisipkan di antara kartu, urut waktu):
//   - berhenti        : singgah di pabrik / di jalur (≥ BERHENTI_TAMPIL_MENIT)
//                       atau di luar rute yang tidak tercakup segmen;
//   - keluar_jalur    : armada bergerak > BATAS_MENYIMPANG_M dari rute rencana;
//   - sinyal_hilang   : jeda titik GPS panjang sambil berpindah jauh;
//   - ngebut          : kecepatan ≥ BATAS_NGEBUT_KMJ.
// Plus urutan kunjungan aktual bila berbeda dari rencana.

import {
  BATAS_MENYIMPANG_M,
  RADIUS_BONGKAR_M,
  RADIUS_PABRIK_M,
  jarakKeGarisM,
  jarakM,
  klasifikasiBerhenti,
  type BerhentiMasukan,
  type BerhentiTerklasifikasi,
  type TitikLatLng,
  type TujuanRute,
} from "./klasifikasi-berhenti";

export const BATAS_KANDIDAT_M = 1500;
export const BERHENTI_TAMPIL_MENIT = 5;
export const BONGKAR_LAMA_MENIT = 30;
export const SINYAL_HILANG_MS = 10 * 60_000;
export const SINYAL_HILANG_LOMPAT_M = 500;
export const BATAS_NGEBUT_KMJ = 70;
// Segmen keluar jalur dicatat bila cukup berarti (bukan pantulan GPS sesaat).
const KELUAR_MIN_MS = 2 * 60_000;
const KELUAR_MIN_TEMPUH_M = 500;
const KELUAR_GABUNG_MS = 60_000;

export type MasalahTujuan =
  | { jenis: "pin_di_pabrik"; jarakM: number }
  | {
      jenis: "drop_meleset";
      kandidat: BerhentiTerklasifikasi;
      jarakM: number;
      arah: string;
      // Jarak terdekat armada melintas dari pin (null = tanpa jejak titik).
      lintasM: number | null;
    }
  | { jenis: "hanya_melintas"; jarakM: number; waktu: string | null; lat: number; lng: number }
  | { jenis: "tidak_didatangi"; jarakM: number; waktu: string | null; lat: number; lng: number }
  | { jenis: "bongkar_lama"; menit: number };

export type CatatanPerjalanan =
  | { jenis: "berhenti"; mulai: string; b: BerhentiTerklasifikasi }
  | {
      jenis: "keluar_jalur";
      mulai: string;
      selesai: string;
      menit: number;
      tempuhM: number;
      maksM: number;
      lat: number; // titik terjauh dari rute
      lng: number;
      singgah: BerhentiTerklasifikasi[];
      // Segmen ini memuat singgah kandidat drop mitra (#nomor) — wajar,
      // armada menuju lokasi drop sebenarnya.
      menujuDrop: TujuanRute[];
    }
  | { jenis: "sinyal_hilang"; mulai: string; selesai: string; menit: number; lompatM: number; lat: number; lng: number }
  | { jenis: "ngebut"; mulai: string; selesai: string; maksKmj: number; lat: number; lng: number };

export interface MasukanAnalisis {
  titik: [number, number][];
  waktu: (number | null)[];
  kecepatan: (number | null)[];
  berhenti: BerhentiMasukan[];
  tujuan: TujuanRute[]; // urut rencana
  pabrik: TitikLatLng | null;
  rencana: TitikLatLng[];
  // Perjalanan sudah kembali — "tidak didatangi" baru berarti setelah selesai.
  final: boolean;
}

export interface AnalisisJejak {
  berhenti: BerhentiTerklasifikasi[];
  bongkarPerTujuan: Map<number, BerhentiTerklasifikasi[]>;
  // Singgah (kunci: mulai) yang diduga lokasi drop sebenarnya sebuah tujuan.
  kandidatDrop: Map<string, TujuanRute>;
  masalahPerTujuan: Map<number, MasalahTujuan[]>;
  catatan: CatatanPerjalanan[]; // urut waktu
  // Waktu kunjungan pertama tiap tujuan (bongkar atau kandidat drop).
  kunjungan: Map<number, string>;
  urutanAktual: TujuanRute[] | null; // null = sesuai rencana / belum cukup data
  // Singgah non-bongkar yang digambar di peta (sama dengan yang tercatat).
  berhentiPeta: BerhentiTerklasifikasi[];
  segmenKeluar: [number, number][][];
}

const ARAH = ["utara", "timur laut", "timur", "tenggara", "selatan", "barat daya", "barat", "barat laut"];
export function arahMataAngin(dari: TitikLatLng, ke: TitikLatLng): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(ke.lng - dari.lng)) * Math.cos(rad(ke.lat));
  const x = Math.cos(rad(dari.lat)) * Math.sin(rad(ke.lat)) - Math.sin(rad(dari.lat)) * Math.cos(rad(ke.lat)) * Math.cos(rad(ke.lng - dari.lng));
  const sudut = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ARAH[Math.round(sudut / 45) % 8];
}

const iso = (t: number) => new Date(t).toISOString();

export function analisisJejak(m: MasukanAnalisis): AnalisisJejak {
  const pts = m.titik.map(([lat, lng]) => ({ lat, lng }));
  const berhenti = klasifikasiBerhenti(m.berhenti, m.tujuan, m.pabrik, m.rencana);

  // ---- Bongkar per tujuan.
  const bongkarPerTujuan = new Map<number, BerhentiTerklasifikasi[]>();
  for (const b of berhenti) {
    if (b.jenis === "bongkar" && b.tujuan) bongkarPerTujuan.set(b.tujuan.id, [...(bongkarPerTujuan.get(b.tujuan.id) ?? []), b]);
  }

  // ---- Lintasan terdekat armada ke tiap tujuan.
  const lintas = new Map<number, { jarakM: number; waktu: string | null; lat: number; lng: number }>();
  for (const t of m.tujuan) {
    let min = Infinity;
    let k = -1;
    pts.forEach((p, i) => {
      const d = jarakM(p, t);
      if (d < min) {
        min = d;
        k = i;
      }
    });
    if (k >= 0) lintas.set(t.id, { jarakM: min, waktu: m.waktu[k] != null ? iso(m.waktu[k]!) : null, lat: pts[k].lat, lng: pts[k].lng });
  }

  // ---- Kandidat drop: pasangan (tujuan tanpa bongkar, singgah tak
  // terjelaskan) terdekat lebih dulu; satu singgah untuk satu tujuan.
  const tanpaBongkar = m.tujuan.filter((t) => !bongkarPerTujuan.has(t.id));
  const lepas = berhenti.filter((b) => b.jenis === "di_jalur" || b.jenis === "menyimpang");
  const pasangan: { t: TujuanRute; b: BerhentiTerklasifikasi; d: number }[] = [];
  for (const t of tanpaBongkar) {
    for (const b of lepas) {
      const d = jarakM(b, t);
      if (d <= BATAS_KANDIDAT_M) pasangan.push({ t, b, d });
    }
  }
  pasangan.sort((x, y) => x.d - y.d);
  const kandidatDrop = new Map<string, TujuanRute>();
  const kandidatTujuan = new Map<number, { b: BerhentiTerklasifikasi; d: number }>();
  for (const p of pasangan) {
    if (kandidatDrop.has(p.b.mulai) || kandidatTujuan.has(p.t.id)) continue;
    kandidatDrop.set(p.b.mulai, p.t);
    kandidatTujuan.set(p.t.id, { b: p.b, d: p.d });
  }

  // ---- Masalah per tujuan.
  const masalahPerTujuan = new Map<number, MasalahTujuan[]>();
  const tambah = (id: number, x: MasalahTujuan) => masalahPerTujuan.set(id, [...(masalahPerTujuan.get(id) ?? []), x]);
  for (const t of m.tujuan) {
    if (m.pabrik) {
      const d = jarakM(t, m.pabrik);
      if (d <= RADIUS_PABRIK_M) tambah(t.id, { jenis: "pin_di_pabrik", jarakM: d });
    }
    const bongkar = bongkarPerTujuan.get(t.id);
    if (bongkar) {
      const menit = bongkar.reduce((s, b) => s + b.menit, 0);
      if (menit >= BONGKAR_LAMA_MENIT) tambah(t.id, { jenis: "bongkar_lama", menit });
      continue;
    }
    const k = kandidatTujuan.get(t.id);
    const l = lintas.get(t.id);
    if (k) {
      tambah(t.id, { jenis: "drop_meleset", kandidat: k.b, jarakM: k.d, arah: arahMataAngin(t, k.b), lintasM: l?.jarakM ?? null });
    } else if (l && m.final) {
      tambah(t.id, { jenis: l.jarakM <= RADIUS_BONGKAR_M ? "hanya_melintas" : "tidak_didatangi", ...l });
    }
  }

  // ---- Segmen keluar jalur (butuh rencana & cap waktu).
  const catatan: CatatanPerjalanan[] = [];
  const segmenKeluar: [number, number][][] = [];
  const dalamSegmen = new Set<string>();
  if (m.rencana.length >= 2) {
    const luar = pts.map((p, i) => {
      if (m.waktu[i] == null) return null;
      if (m.pabrik && jarakM(p, m.pabrik) <= RADIUS_PABRIK_M) return null;
      const d = jarakKeGarisM(p, m.rencana) ?? 0;
      return d > BATAS_MENYIMPANG_M ? d : null;
    });
    // Rentang indeks beruntun di luar jalur, digabung bila jedanya singkat.
    const rentang: [number, number][] = [];
    for (let i = 0; i < luar.length; i++) {
      if (luar[i] == null) continue;
      let j = i;
      while (j + 1 < luar.length && luar[j + 1] != null) j++;
      const akhir = rentang[rentang.length - 1];
      if (akhir && m.waktu[i]! - m.waktu[akhir[1]]! <= KELUAR_GABUNG_MS) akhir[1] = j;
      else rentang.push([i, j]);
      i = j;
    }
    for (const [i, j] of rentang) {
      const t0 = m.waktu[i]!;
      const t1 = m.waktu[j]!;
      let tempuh = 0;
      let maks = 0;
      let kMaks = i;
      for (let k = i; k <= j; k++) {
        if (k > i) tempuh += jarakM(pts[k - 1], pts[k]);
        const d = luar[k] ?? 0;
        if (d > maks) {
          maks = d;
          kMaks = k;
        }
      }
      if (t1 - t0 < KELUAR_MIN_MS && tempuh < KELUAR_MIN_TEMPUH_M) continue;
      // Sertakan satu titik sebelum & sesudah supaya garis merah tersambung
      // ke jejak di jalur.
      const a = Math.max(0, i - 1);
      const z = Math.min(pts.length - 1, j + 1);
      segmenKeluar.push(pts.slice(a, z + 1).map((p) => [p.lat, p.lng]));
      const singgah = berhenti.filter((b) => {
        const t = Date.parse(b.mulai);
        return b.jenis !== "bongkar" && t >= t0 - 60_000 && t <= t1 + 60_000;
      });
      singgah.forEach((b) => dalamSegmen.add(b.mulai));
      const menujuDrop = singgah.map((b) => kandidatDrop.get(b.mulai)).filter((t): t is TujuanRute => !!t);
      catatan.push({
        jenis: "keluar_jalur",
        mulai: iso(t0),
        selesai: iso(t1),
        menit: Math.round((t1 - t0) / 60_000),
        tempuhM: tempuh,
        maksM: maks,
        lat: pts[kMaks].lat,
        lng: pts[kMaks].lng,
        singgah: singgah.filter((b) => !kandidatDrop.has(b.mulai)),
        menujuDrop,
      });
    }
  }

  // ---- Singgah yang dicatat sendiri & yang digambar di peta.
  const berhentiPeta: BerhentiTerklasifikasi[] = [];
  for (const b of berhenti) {
    if (b.jenis === "bongkar") continue;
    const kandidat = kandidatDrop.has(b.mulai);
    const tampil = kandidat || b.jenis === "menyimpang" || b.menit >= BERHENTI_TAMPIL_MENIT;
    if (!tampil) continue;
    berhentiPeta.push(b);
    if (!kandidat && !dalamSegmen.has(b.mulai)) catatan.push({ jenis: "berhenti", mulai: b.mulai, b });
  }

  // ---- Sinyal hilang & ngebut.
  for (let i = 1; i < pts.length; i++) {
    const a = m.waktu[i - 1];
    const b = m.waktu[i];
    if (a == null || b == null) continue;
    const lompat = jarakM(pts[i - 1], pts[i]);
    if (b - a >= SINYAL_HILANG_MS && lompat >= SINYAL_HILANG_LOMPAT_M) {
      catatan.push({ jenis: "sinyal_hilang", mulai: iso(a), selesai: iso(b), menit: Math.round((b - a) / 60_000), lompatM: lompat, lat: pts[i].lat, lng: pts[i].lng });
    }
  }
  for (let i = 0; i < pts.length; i++) {
    if ((m.kecepatan[i] ?? 0) < BATAS_NGEBUT_KMJ || m.waktu[i] == null) continue;
    let j = i;
    while (j + 1 < pts.length && (m.kecepatan[j + 1] ?? 0) >= BATAS_NGEBUT_KMJ && m.waktu[j + 1] != null) j++;
    let kMaks = i;
    for (let k = i; k <= j; k++) if ((m.kecepatan[k] ?? 0) > (m.kecepatan[kMaks] ?? 0)) kMaks = k;
    catatan.push({ jenis: "ngebut", mulai: iso(m.waktu[i]!), selesai: iso(m.waktu[j]!), maksKmj: m.kecepatan[kMaks]!, lat: pts[kMaks].lat, lng: pts[kMaks].lng });
    i = j;
  }
  catatan.sort((x, y) => x.mulai.localeCompare(y.mulai));

  // ---- Kunjungan & urutan aktual.
  const kunjungan = new Map<number, string>();
  for (const [id, bs] of bongkarPerTujuan) kunjungan.set(id, bs.map((b) => b.mulai).sort()[0]);
  for (const [id, k] of kandidatTujuan) kunjungan.set(id, k.b.mulai);
  const dikunjungi = m.tujuan.filter((t) => kunjungan.has(t.id));
  const aktual = [...dikunjungi].sort((x, y) => kunjungan.get(x.id)!.localeCompare(kunjungan.get(y.id)!));
  const urutanAktual = aktual.length >= 2 && aktual.some((t, i) => t.id !== dikunjungi[i].id) ? aktual : null;

  return { berhenti, bongkarPerTujuan, kandidatDrop, masalahPerTujuan, catatan, kunjungan, urutanAktual, berhentiPeta, segmenKeluar };
}

// Tempatkan catatan perjalanan di antara kartu tujuan (urut rencana): tiap
// catatan disisipkan SETELAH kartu yang terakhir dikunjungi sebelum catatan
// itu dimulai ("awal" = sebelum kunjungan pertama, di atas daftar).
export function tempatkanCatatan(a: Pick<AnalisisJejak, "catatan" | "kunjungan">) {
  const peristiwa: { mulai: string; kartu?: number; c?: CatatanPerjalanan }[] = [
    ...[...a.kunjungan].map(([kartu, mulai]) => ({ mulai, kartu })),
    ...a.catatan.map((c) => ({ mulai: c.mulai, c })),
  ];
  // Kunjungan didahulukan bila waktunya sama dengan catatan.
  peristiwa.sort((x, y) => x.mulai.localeCompare(y.mulai) || (x.kartu != null ? -1 : 0) - (y.kartu != null ? -1 : 0));
  const sisipan = new Map<number | "awal", CatatanPerjalanan[]>();
  let terakhir: number | "awal" = "awal";
  for (const p of peristiwa) {
    if (p.kartu != null) terakhir = p.kartu;
    else if (p.c) sisipan.set(terakhir, [...(sisipan.get(terakhir) ?? []), p.c]);
  }
  return sisipan;
}
