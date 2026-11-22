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
// Berhenti = kecepatan ≤ 3 km/j beruntun minimal sekian menit (SoloFleet saja).
const BERHENTI_MIN_MENIT = 5;

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

function hitungBerhenti(titik: TitikJejak[]): TitikBerhenti[] {
  const hasil: TitikBerhenti[] = [];
  let awal = -1;
  const tutup = (akhir: number) => {
    if (awal < 0) return;
    const a = titik[awal];
    const b = titik[akhir];
    const menit = Math.round(((b.t ?? 0) - (a.t ?? 0)) / 60_000);
    if (menit >= BERHENTI_MIN_MENIT) {
      hasil.push({
        lat: a.lat,
        lng: a.lng,
        mulai: new Date(a.t!).toISOString(),
        selesai: new Date(b.t!).toISOString(),
        menit,
      });
    }
    awal = -1;
  };
  for (let i = 0; i < titik.length; i++) {
    const p = titik[i];
    const diam = p.t != null && p.spd != null && p.spd <= 3;
    if (diam && awal < 0) awal = i;
    if (!diam && awal >= 0) tutup(i);
  }
  if (awal >= 0) tutup(titik.length - 1);
  return hasil;
}

function bentuk(
  sumber: SumberJejak | null,
  titik: TitikJejak[],
  dari: Date,
  sampai: Date,
  final: boolean,
  diambilAt: Date
): JejakAktual {
  let jarak = 0;
  for (let i = 1; i < titik.length; i++) jarak += haversineKm(titik[i - 1], titik[i]);
  return {
    status: sumber == null ? "tanpa_alat" : titik.length >= 2 ? "ada" : "kosong",
    sumber,
    titik: titik.map((p) => [p.lat, p.lng]),
    jarakKm: titik.length >= 2 ? Math.round(jarak * 10) / 10 : null,
    berhenti: hitungBerhenti(titik),
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
