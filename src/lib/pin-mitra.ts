// Semua pin milik satu mitra (utama + lokasi pengiriman tambahan aktif) dan
// pencarian pin terdekat — dipakai validasi jarak check-in kunjungan
// Aplikasi Pemasaran, di client (tampilan) maupun server (validasi ulang).
// Spec §9.4: check-in diterima di lokasi MANA PUN milik mitra (terdekat).
// Client-safe: JANGAN import mssql/pg/next/* di sini.
import { haversineKm, type LatLng } from "@/lib/route-estimate";

export interface PinMitra {
  lat: number;
  lng: number;
  label: string; // "Utama" / label lokasi / "Lokasi N"
}

type Koordinat = { latitude: number | null; longitude: number | null };

const adaKoordinat = (k: Koordinat | null | undefined): k is { latitude: number; longitude: number } =>
  k != null && k.latitude != null && k.longitude != null;

/**
 * Pin utama (bila ada) lalu pin lokasi tambahan yang punya koordinat, urut
 * seperti diterima. Penamaan sama dengan titik peta /mitra: label lokasi,
 * atau "Lokasi N" (N = posisi di daftar + 2) bila tanpa label.
 */
export function daftarPinMitra(
  utama: Koordinat | null,
  tambahan: Array<Koordinat & { label: string | null }>
): PinMitra[] {
  const hasil: PinMitra[] = [];
  if (adaKoordinat(utama)) hasil.push({ lat: Number(utama.latitude), lng: Number(utama.longitude), label: "Utama" });
  tambahan.forEach((l, i) => {
    if (!adaKoordinat(l)) return;
    hasil.push({ lat: Number(l.latitude), lng: Number(l.longitude), label: l.label?.trim() || `Lokasi ${i + 2}` });
  });
  return hasil;
}

/** Pin dengan jarak terkecil ke `posisi` (meter), atau null bila tidak ada pin. */
export function pinTerdekat(pins: PinMitra[], posisi: LatLng): { pin: PinMitra; jarakMeter: number } | null {
  let terbaik: { pin: PinMitra; jarakMeter: number } | null = null;
  for (const pin of pins) {
    const jarakMeter = haversineKm({ lat: pin.lat, lng: pin.lng }, posisi) * 1000;
    if (!terbaik || jarakMeter < terbaik.jarakMeter) terbaik = { pin, jarakMeter };
  }
  return terbaik;
}
