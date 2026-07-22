// lib/osrm.ts
// Wrapper untuk memanggil OSRM routing engine dari server-side (API routes / server actions).
// Jangan panggil OSRM langsung dari client component -- selalu lewat API route Next.js
// supaya bisa dikontrol, di-cache, dan digabung dengan data MSSQL kalau perlu.

const OSRM_BASE_URL = process.env.OSRM_BASE_URL ?? "https://route.pabrikespmp.com";

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  distanceKm: number;
  durationMinutes: number;
}

/**
 * Hitung jarak & durasi tempuh antara 2 titik (misal: pabrik -> alamat customer).
 */
export async function getRoute(
  origin: Coordinate,
  destination: Coordinate
): Promise<RouteResult> {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=false`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`OSRM request failed: ${res.status}`);
  }

  const data = await res.json();

  if (data.code !== "Ok") {
    throw new Error(`OSRM error: ${data.code} - ${data.message ?? "unknown"}`);
  }

  const route = data.routes[0];

  return {
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    distanceKm: Math.round((route.distance / 1000) * 10) / 10,
    durationMinutes: Math.round(route.duration / 60),
  };
}

/**
 * Hitung matrix jarak/durasi dari 1 titik asal ke banyak tujuan sekaligus.
 * Berguna untuk modul pengiriman: urutkan customer mana yang paling dekat dari pabrik.
 */
export async function getDistanceMatrix(
  origin: Coordinate,
  destinations: Coordinate[]
): Promise<{ distanceMeters: number; durationSeconds: number }[]> {
  const allCoords = [origin, ...destinations]
    .map((c) => `${c.lng},${c.lat}`)
    .join(";");

  // sources=0 artinya titik pertama (origin) jadi titik asal untuk semua perhitungan
  const destIndexes = destinations.map((_, i) => i + 1).join(";");
  const url = `${OSRM_BASE_URL}/table/v1/driving/${allCoords}?sources=0&destinations=${destIndexes}`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`OSRM table request failed: ${res.status}`);
  }

  const data = await res.json();

  if (data.code !== "Ok") {
    throw new Error(`OSRM error: ${data.code}`);
  }

  return data.distances[0].map((distanceMeters: number, i: number) => ({
    distanceMeters,
    durationSeconds: data.durations[0][i],
  }));
}
