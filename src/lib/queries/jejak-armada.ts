// Jejak rute AKTUAL satu Jadwal untuk Validasi Rute: riwayat provider GPS
// (src/lib/gps-providers/riwayat.ts) pada [berangkat − 10 mnt, kembali + 10
// mnt], disimpan di armada_jejak_gps (scripts/create-armada-jejak-gps-table.ts).
//
// Supaya membuka Validasi Rute tetap cepat, dialog meminta jejak ini terpisah
// SETELAH tampil, dan:
//   - perjalanan yang sudah kembali (final) cukup diambil sekali, lalu dibaca
//     dari cache selamanya;
//   - perjalanan berlangsung dibaca dari cache bila umurnya < 2 menit;
//   - armada tanpa alat GPS dicatat juga (sumber NULL) selama 30 menit agar
//     tidak bertanya ke provider tiap dialog dibuka.

import { getPgPool } from "@/lib/pg";
import { currentEskristalKode } from "@/lib/tenant-request";
import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";
import { ambilJejakAktual, type SumberJejak, type TitikJejak } from "@/lib/gps-providers/riwayat";

const JEDA_MS = 10 * 60 * 1000;
const SEGAR_BERLANGSUNG_MS = 2 * 60 * 1000;
const SEGAR_TANPA_ALAT_MS = 30 * 60 * 1000;
// Singgah = armada bertahan dalam radius RADIUS_SINGGAH_M minimal sekian
// menit — berbasis POSISI, bukan kecepatan: kecepatan GPS saat parkir/
// manuver bongkar sering melompat 0–10 km/j sehingga deteksi "kecepatan ≤ 3"
// melewatkan bongkar singkat (kasus GM 14, 25 Nov 2026: singgah 7 mnt tidak
// terdeteksi). Penyaringan tampil (mis. ≥5 mnt untuk berhenti biasa)
// dilakukan di src/lib/analisis-jejak.ts.
const SINGGAH_MIN_MS = 2 * 60_000;
const RADIUS_SINGGAH_M = 100;
// SoloFleet (permintaan timezone "7") mengirim gpstimeISO = jam dinding WIB
// yang dikodekan sebagai UTC → epoch maju 7 jam. Dikoreksi saat membentuk
// hasil (bukan saat mengambil) supaya cache lama di armada_jejak_gps ikut
// benar tanpa migrasi data.
const GESER_WIB_MS = 7 * 3600_000;

export interface TitikBerhenti {
  lat: number;
  lng: number;
  mulai: string; // ISO
  selesai: string; // ISO
  menit: number;
}

export interface JejakAktual {
  status: "ada" | "kosong" | "tanpa_alat";
  sumber: SumberJejak | null;
  // [lat, lng] siap digambar Leaflet.
  titik: [number, number][];
  jarakKm: number | null;
  berhenti: TitikBerhenti[];
  // Sejajar dengan `titik`: epoch ms (null = provider tanpa cap waktu, mis.
  // Hino) dan kecepatan km/j (null = tidak ada).
  waktu: (number | null)[];
  kecepatan: (number | null)[];
  dari: string;
  sampai: string;
  final: boolean;
  diambilAt: string;
}

function haversineKm(a: TitikJejak, b: TitikJejak): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function jarakTitikM(a: TitikJejak, b: TitikJejak): number {
  return haversineKm(a, b) * 1000;
}

// Kelompok titik beruntun yang semuanya dalam RADIUS_SINGGAH_M dari titik
// pertamanya dan berlangsung ≥ SINGGAH_MIN_MS → satu singgah (titik pusat).
export function hitungBerhenti(titik: TitikJejak[]): TitikBerhenti[] {
  const hasil: TitikBerhenti[] = [];
  let i = 0;
  while (i < titik.length) {
    const a = titik[i];
    if (a.t == null) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < titik.length && titik[j + 1].t != null && jarakTitikM(a, titik[j + 1]) <= RADIUS_SINGGAH_M) j++;
    const lama = (titik[j].t ?? 0) - a.t;
    if (lama >= SINGGAH_MIN_MS) {
      let lat = 0;
      let lng = 0;
      for (let k = i; k <= j; k++) {
        lat += titik[k].lat;
        lng += titik[k].lng;
      }
      const n = j - i + 1;
      hasil.push({
        lat: lat / n,
        lng: lng / n,
        mulai: new Date(a.t).toISOString(),
        selesai: new Date(titik[j].t!).toISOString(),
        menit: Math.round(lama / 60_000),
      });
      i = j + 1;
    } else {
      i++;
    }
  }
  // Satu singgah bisa terpecah bila armada sempat bergeser sedikit (manuver
  // bongkar) — gabungkan yang berdekatan & nyaris bersambung.
  const gabung: TitikBerhenti[] = [];
  for (const h of hasil) {
    const p = gabung[gabung.length - 1];
    if (p && Date.parse(h.mulai) - Date.parse(p.selesai) <= SINGGAH_MIN_MS && jarakTitikM({ ...p, t: null, spd: null }, { ...h, t: null, spd: null }) <= RADIUS_SINGGAH_M) {
      const bobotP = p.menit || 1;
      const bobotH = h.menit || 1;
      p.lat = (p.lat * bobotP + h.lat * bobotH) / (bobotP + bobotH);
      p.lng = (p.lng * bobotP + h.lng * bobotH) / (bobotP + bobotH);
      p.selesai = h.selesai;
      p.menit = Math.round((Date.parse(p.selesai) - Date.parse(p.mulai)) / 60_000);
    } else {
      gabung.push({ ...h });
    }
  }
  return gabung;
}

// Lihat GESER_WIB_MS. Terdeteksi bila titik TERAKHIR jatuh > 1 jam setelah
// ujung jendela pengambilan — titik yang benar tidak pernah melewati jendela,
// sedangkan titik bergeser selalu ±7 jam di depannya.
export function koreksiZonaWaktu(sumber: SumberJejak | null, titik: TitikJejak[], sampai: Date): TitikJejak[] {
  if (sumber !== "solofleet") return titik;
  const terakhir = Math.max(...titik.map((p) => p.t ?? -Infinity));
  if (!(terakhir > sampai.getTime() + 3600_000)) return titik;
  return titik.map((p) => (p.t == null ? p : { ...p, t: p.t - GESER_WIB_MS }));
}

function bentuk(
  sumber: SumberJejak | null,
  titik: TitikJejak[],
  dari: Date,
  sampai: Date,
  final: boolean,
  diambilAt: Date
): JejakAktual {
  titik = koreksiZonaWaktu(sumber, titik, sampai);
  let jarak = 0;
  for (let i = 1; i < titik.length; i++) jarak += haversineKm(titik[i - 1], titik[i]);
  return {
    status: sumber == null ? "tanpa_alat" : titik.length >= 2 ? "ada" : "kosong",
    sumber,
    titik: titik.map((p) => [p.lat, p.lng]),
    jarakKm: titik.length >= 2 ? Math.round(jarak * 10) / 10 : null,
    berhenti: hitungBerhenti(titik),
    waktu: titik.map((p) => p.t),
    kecepatan: titik.map((p) => p.spd),
    dari: dari.toISOString(),
    sampai: sampai.toISOString(),
    final,
    diambilAt: diambilAt.toISOString(),
  };
}

export async function getJejakAktualJadwal(input: {
  jadwalId: number;
  armadaId: number;
  platNomor: string;
  berangkat: Date;
  kembali: Date | null;
}): Promise<JejakAktual> {
  const pg = getPgPool();
  const kode = await currentEskristalKode();
  const sekarang = Date.now();
  const dari = new Date(input.berangkat.getTime() - JEDA_MS);
  const sampai = new Date(Math.min(sekarang, (input.kembali?.getTime() ?? sekarang) + JEDA_MS));
  // Final hanya bila truk sudah kembali DAN jeda 10 menitnya sudah lewat —
  // titik-titik terakhir dari provider kadang datang terlambat.
  const final = input.kembali != null && input.kembali.getTime() + JEDA_MS < sekarang;

  const cache = (
    await pg.query<{
      sumber: SumberJejak | null;
      titik: TitikJejak[];
      dari: Date;
      final: boolean;
      diambil_at: Date;
    }>(
      `SELECT sumber, titik, dari, final, diambil_at FROM armada_jejak_gps WHERE perusahaan_kode = $1 AND jadwal_id = $2`,
      [kode, input.jadwalId]
    )
  ).rows[0];
  if (cache && cache.dari.getTime() === dari.getTime()) {
    const umur = sekarang - cache.diambil_at.getTime();
    const masihSah =
      cache.sumber == null
        ? umur < SEGAR_TANPA_ALAT_MS
        : // Cache "berlangsung" tidak sah lagi begitu perjalanan sudah final.
          cache.final || (!final && umur < SEGAR_BERLANGSUNG_MS);
    if (masihSah) {
      return bentuk(cache.sumber, cache.titik, dari, cache.final ? sampai : new Date(cache.diambil_at), cache.final, cache.diambil_at);
    }
  }

  const perusahaanId = await getMkesindoPerusahaanId();
  const jejak = await ambilJejakAktual(perusahaanId, input.platNomor, dari, sampai);
  const sumber = jejak?.sumber ?? null;
  const titik = jejak?.titik ?? [];
  const diambilAt = new Date();
  await pg.query(
    `INSERT INTO armada_jejak_gps (perusahaan_kode, jadwal_id, armada_id, sumber, titik, dari, sampai, final, diambil_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     ON CONFLICT (perusahaan_kode, jadwal_id) DO UPDATE SET
       armada_id = EXCLUDED.armada_id, sumber = EXCLUDED.sumber, titik = EXCLUDED.titik,
       dari = EXCLUDED.dari, sampai = EXCLUDED.sampai, final = EXCLUDED.final, diambil_at = EXCLUDED.diambil_at`,
    // Jejak kosong tidak pernah dikunci final — alat bisa saja mengirim
    // titiknya terlambat, jadi tetap dicoba lagi pada pembukaan berikutnya.
    [kode, input.jadwalId, input.armadaId, sumber, JSON.stringify(titik), dari, sampai, final && titik.length >= 2, diambilAt]
  );
  return bentuk(sumber, titik, dari, sampai, final, diambilAt);
}
