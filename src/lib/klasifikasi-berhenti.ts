// Klasifikasi titik berhenti armada (dari jejak GPS) terhadap rencana rute:
// - "bongkar"   : dalam RADIUS_BONGKAR_M dari titik mitra tujuan → dianggap
//                 tiba/bongkar di mitra itu (toleransi selisih titik mitra
//                 di sistem vs posisi GPS);
// - "pabrik"    : dalam RADIUS_PABRIK_M dari pabrik;
// - "di_jalur"  : bukan di mitra/pabrik tapi masih dekat garis rute rencana
//                 (≤ BATAS_MENYIMPANG_M) — mis. istirahat, macet;
// - "menyimpang": jauh dari rute rencana (> BATAS_MENYIMPANG_M) — aktivitas
//                 di luar rencana, patut diperiksa (mis. penjualan liar).
// Fungsi murni (tanpa Leaflet) supaya bisa diuji.

export const RADIUS_BONGKAR_M = 200;
export const RADIUS_PABRIK_M = 300;
export const BATAS_MENYIMPANG_M = 300;

export type JenisBerhenti = "bongkar" | "pabrik" | "di_jalur" | "menyimpang";

export interface TitikLatLng {
  lat: number;
  lng: number;
}

export interface TujuanRute extends TitikLatLng {
  id: number; // JadwalDetailID
  nama: string;
  nomor: number; // nomor tampil (mulai 1)
}

export interface BerhentiMasukan extends TitikLatLng {
  mulai: string;
  selesai: string;
  menit: number;
}

export interface BerhentiTerklasifikasi extends BerhentiMasukan {
  jenis: JenisBerhenti;
  tujuan: TujuanRute | null; // mitra terdekat (selalu diisi bila ada tujuan)
  jarakTujuanM: number | null; // jarak ke mitra terdekat
  jarakRencanaM: number | null; // jarak ke garis rute rencana (null = tanpa rencana)
}

const R_BUMI_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function jarakM(a: TitikLatLng, b: TitikLatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_BUMI_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Jarak titik ke ruas garis — proyeksi equirectangular lokal (akurat untuk
// jarak beberapa km, cukup untuk skala kota/kabupaten).
function jarakKeRuasM(p: TitikLatLng, a: TitikLatLng, b: TitikLatLng): number {
  const kx = Math.cos(rad(p.lat)) * R_BUMI_M * (Math.PI / 180);
  const ky = R_BUMI_M * (Math.PI / 180);
  const ax = (a.lng - p.lng) * kx;
  const ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx;
  const by = (b.lat - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function jarakKeGarisM(p: TitikLatLng, garis: TitikLatLng[]): number | null {
  if (garis.length === 0) return null;
  if (garis.length === 1) return jarakM(p, garis[0]);
  let min = Infinity;
  for (let i = 1; i < garis.length; i++) min = Math.min(min, jarakKeRuasM(p, garis[i - 1], garis[i]));
  return min;
}

export function klasifikasiBerhenti(
  berhenti: BerhentiMasukan[],
  tujuan: TujuanRute[],
  pabrik: TitikLatLng | null,
  rencana: TitikLatLng[]
): BerhentiTerklasifikasi[] {
  return berhenti.map((b) => {
    let terdekat: TujuanRute | null = null;
    let jarakTujuanM: number | null = null;
    for (const t of tujuan) {
      const d = jarakM(b, t);
      if (jarakTujuanM == null || d < jarakTujuanM) {
        jarakTujuanM = d;
        terdekat = t;
      }
    }
    const jarakRencanaM = jarakKeGarisM(b, rencana);
    let jenis: JenisBerhenti;
    if (jarakTujuanM != null && jarakTujuanM <= RADIUS_BONGKAR_M) jenis = "bongkar";
    else if (pabrik && jarakM(b, pabrik) <= RADIUS_PABRIK_M) jenis = "pabrik";
    else if (jarakRencanaM != null && jarakRencanaM <= BATAS_MENYIMPANG_M) jenis = "di_jalur";
    else jenis = "menyimpang";
    return { ...b, jenis, tujuan: terdekat, jarakTujuanM, jarakRencanaM };
  });
}

export function formatJarakM(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} km`;
}
