// app/api/weather/route.ts
// Server-side proxy for current weather at a coordinate, used by the Patroli
// photo watermark. Open-Meteo needs no API key and has no special header
// requirements (unlike Nominatim in /api/geocode) — this route exists purely
// to centralize the WMO-weathercode-to-Indonesian-label mapping in one place,
// not because the browser is blocked from calling Open-Meteo directly.
import { NextRequest, NextResponse } from "next/server";

const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";

interface OpenMeteoResponse {
  current_weather?: {
    temperature: number;
    weathercode: number;
  };
}

// Kode cuaca WMO (dipakai Open-Meteo) -> label singkat Indonesia. Kode yang
// tidak ada di tabel ini jatuh ke label generik "Tidak diketahui", bukan
// error — beberapa kode salju (71-77, 85-86) nyaris tidak pernah terjadi di
// Indonesia tapi tetap dipetakan untuk kelengkapan/keamanan.
const WEATHER_CODE_LABEL: Record<number, string> = {
  0: "Cerah",
  1: "Cerah Berawan",
  2: "Berawan Sebagian",
  3: "Berawan",
  45: "Berkabut",
  48: "Berkabut",
  51: "Gerimis Ringan",
  53: "Gerimis Sedang",
  55: "Gerimis Lebat",
  56: "Gerimis Beku",
  57: "Gerimis Beku Lebat",
  61: "Hujan Ringan",
  63: "Hujan Sedang",
  65: "Hujan Lebat",
  66: "Hujan Beku Ringan",
  67: "Hujan Beku Lebat",
  71: "Salju Ringan",
  73: "Salju Sedang",
  75: "Salju Lebat",
  77: "Salju",
  80: "Hujan Lebat Sesaat",
  81: "Hujan Lebat Sesaat",
  82: "Hujan Sangat Lebat Sesaat",
  85: "Salju Sesaat Ringan",
  86: "Salju Sesaat Lebat",
  95: "Badai Petir",
  96: "Badai Petir dengan Hujan Es",
  99: "Badai Petir dengan Hujan Es Lebat",
};

function labelForWeatherCode(code: number): string {
  return WEATHER_CODE_LABEL[code] ?? "Tidak diketahui";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ error: "Parameter lat & lng wajib diisi" }, { status: 400 });
  }

  try {
    const url = `${OPEN_METEO_BASE_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(
      lng
    )}&current_weather=true`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: "Gagal memuat cuaca" }, { status: 502 });
    }
    const data = (await res.json()) as OpenMeteoResponse;
    if (!data.current_weather) {
      return NextResponse.json({ error: "Data cuaca tidak tersedia" }, { status: 502 });
    }
    return NextResponse.json({
      cuaca: labelForWeatherCode(data.current_weather.weathercode),
      suhu: data.current_weather.temperature,
    });
  } catch (err) {
    console.error("Weather error:", err);
    return NextResponse.json({ error: "Gagal memuat cuaca" }, { status: 502 });
  }
}
