// app/api/geocode/route.ts
// Server-side proxy for reverse geocoding (koordinat -> alamat). Combines two
// free sources, each covering the other's weak spot for rural Indonesia:
//   - Nominatim (OpenStreetMap) for the street-level bit (Jalan + Desa) --
//     good road/POI coverage, but Indonesia's kecamatan boundaries are
//     largely untagged in OSM (verified against live data, see below).
//   - BigDataCloud's free client reverse-geocode endpoint for the
//     administrative hierarchy (Kabupaten/Kecamatan) -- no API key needed,
//     and unlike Nominatim it reliably resolves Indonesian kecamatan names
//     (verified: correctly returned "Dolopo"/"Babadan" as kecamatan for
//     points where Nominatim had no suburb/city_district tag at all).
// Must go through this server route, not called directly from the browser:
// Nominatim's usage policy requires a descriptive User-Agent identifying the
// application, and browser fetch() cannot set that header itself (User-Agent
// is a forbidden header on outgoing browser requests).
// https://operations.osmfoundation.org/policies/nominatim/
import { NextRequest, NextResponse } from "next/server";

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const BIGDATACLOUD_BASE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";
const USER_AGENT = "PMP-Dashboard/1.0 (internal tool, dash.pabrikespmp.com)";

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  residential?: string;
  village?: string;
  hamlet?: string;
}

interface NominatimResponse {
  error?: string;
  display_name?: string;
  address?: NominatimAddress;
}

interface BigDataCloudAdminEntry {
  name: string;
  description?: string;
  adminLevel?: number;
}

interface BigDataCloudResponse {
  city?: string;
  localityInfo?: {
    administrative?: BigDataCloudAdminEntry[];
    informative?: BigDataCloudAdminEntry[];
  };
}

async function fetchNominatimAlamat(lat: string, lng: string): Promise<string | null> {
  const url = `${NOMINATIM_BASE_URL}/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(
    lng
  )}&format=jsonv2&addressdetails=1&accept-language=id&zoom=18`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
  if (!res.ok) return null;

  const data = (await res.json()) as NominatimResponse;
  if (data.error) return null;

  const addr = data.address ?? {};
  // "Alamat" as Jalan + desa/dusun, e.g. "Jalan Raya Madiun - Ponorogo,
  // Glonggong" — shorter and closer to how the mitra form's own Alamat field
  // is normally filled in than Nominatim's full display_name (which trails
  // off into kabupaten/provinsi/negara/kode pos).
  const road = addr.road ?? addr.pedestrian ?? addr.residential ?? null;
  const desa = addr.village ?? addr.hamlet ?? null;
  return [road, desa].filter(Boolean).join(", ") || data.display_name || null;
}

async function fetchBigDataCloudAdmin(
  lat: string,
  lng: string
): Promise<{ wilayah: string | null; kecamatan: string | null }> {
  const url = `${BIGDATACLOUD_BASE_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(
    lng
  )}&localityLanguage=id`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { wilayah: null, kecamatan: null };

  const data = (await res.json()) as BigDataCloudResponse;
  const admin = data.localityInfo?.administrative ?? [];
  const info = data.localityInfo?.informative ?? [];

  const kabupaten = admin.find((e) => /kabupaten|kota di/i.test(e.description ?? ""));

  // Near a kecamatan border, BigDataCloud can list more than one candidate
  // kecamatan in `informative` (verified live: a point near the
  // Ponorogo/Madiun border returned both "Jenangan" and "Dolopo") — prefer
  // whichever one's own description names the same kabupaten already picked
  // above, so Wilayah and Kecamatan don't end up naming two different
  // kabupaten. Falls back to the first kecamatan-tagged entry if none match.
  const kecamatanCandidates = [
    ...info.filter((e) => /kecamatan/i.test(e.description ?? "")),
    ...admin.filter((e) => /kecamatan/i.test(e.description ?? "")),
  ];
  const kecamatanEntry =
    (kabupaten && kecamatanCandidates.find((e) => e.description?.includes(kabupaten.name))) ??
    kecamatanCandidates[0];

  return {
    wilayah: kabupaten?.name ?? null,
    kecamatan: kecamatanEntry?.name ?? data.city ?? null,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ error: "Parameter lat & lng wajib diisi" }, { status: 400 });
  }

  try {
    const [alamat, admin] = await Promise.all([
      fetchNominatimAlamat(lat, lng).catch(() => null),
      fetchBigDataCloudAdmin(lat, lng).catch(() => ({ wilayah: null, kecamatan: null })),
    ]);

    return NextResponse.json({ alamat, wilayah: admin.wilayah, kecamatan: admin.kecamatan });
  } catch (err) {
    console.error("Geocode error:", err);
    return NextResponse.json({ error: "Gagal memuat alamat" }, { status: 502 });
  }
}
