// app/api/geocode/search/route.ts
// Server-side proxy for forward geocoding (teks alamat -> koordinat) — the
// counterpart to ../route.ts's reverse lookup. Backs both the map's own
// search box and the "center on Wilayah/Kecamatan" default-pin behavior in
// mitra-location-field.tsx. Must go through this server route for the same
// reason as the reverse endpoint: Nominatim requires a descriptive
// User-Agent that browser fetch() cannot set itself.
import { NextRequest, NextResponse } from "next/server";

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "PMP-Dashboard/1.0 (internal tool, dash.pabrikespmp.com)";

interface NominatimSearchResult {
  lat: string;
  lon: string;
  display_name: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ error: "Parameter q wajib diisi" }, { status: 400 });
  }

  try {
    // countrycodes=id keeps results relevant since every mitra is local;
    // limit=1 because the callers just want "go to this place", not a
    // picker list of candidates.
    const url = `${NOMINATIM_BASE_URL}/search?q=${encodeURIComponent(
      q
    )}&format=jsonv2&countrycodes=id&limit=1&accept-language=id`;

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: "Gagal mencari lokasi" }, { status: 502 });
    }

    const data = (await res.json()) as NominatimSearchResult[];
    const first = data[0];
    if (!first) {
      return NextResponse.json({ error: "Lokasi tidak ditemukan" }, { status: 404 });
    }

    return NextResponse.json({
      latitude: parseFloat(first.lat),
      longitude: parseFloat(first.lon),
      alamat: first.display_name,
    });
  } catch (err) {
    console.error("Geocode search error:", err);
    return NextResponse.json({ error: "Gagal mencari lokasi" }, { status: 502 });
  }
}
