// app/api/wilayah/regencies/route.ts
// Daftar Kabupaten/Kota se-Indonesia untuk dropdown pencarian "Wilayah" —
// dipakai lintas modul (bukan cuma Mitra), jadi datanya diambil dari sumber
// nasional (Kemendagri via emsifa/api-wilayah-indonesia, gratis tanpa API
// key) alih-alih daftar yang diturunkan dari data mitra sendiri.
// Server-side (bukan langsung dari client) supaya aggregasi 38 request
// per-provinsi bisa di-cache di sisi server, dan tidak bergantung pada CORS
// upstream yang tidak terjamin untuk fetch() browser.
import { NextResponse } from "next/server";

const BASE_URL = "https://www.emsifa.com/api-wilayah-indonesia/api";
// Data administratif Kemendagri jarang berubah — cache lama supaya 38
// request per-provinsi ke upstream tidak terjadi di setiap request.
const REVALIDATE_SECONDS = 60 * 60 * 24 * 30;

interface Province {
  id: string;
  name: string;
}

interface Regency {
  id: string;
  province_id: string;
  name: string;
}

function toTitleCase(raw: string): string {
  return raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// emsifa returns e.g. "KABUPATEN PONOROGO" / "KOTA MADIUN" — normalize to
// match this app's existing free-text convention ("Ponorogo"), but keep the
// "Kota" prefix since Kabupaten and Kota with the same base name are
// different regions (Kabupaten Madiun != Kota Madiun).
function normalizeRegencyName(raw: string): string {
  if (/^KOTA\s+/i.test(raw)) return `Kota ${toTitleCase(raw.replace(/^KOTA\s+/i, ""))}`;
  return toTitleCase(raw.replace(/^KABUPATEN\s+/i, ""));
}

export async function GET() {
  try {
    const provincesRes = await fetch(`${BASE_URL}/provinces.json`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!provincesRes.ok) {
      return NextResponse.json({ error: "Gagal memuat daftar provinsi" }, { status: 502 });
    }
    const provinces = (await provincesRes.json()) as Province[];

    const regencyLists = await Promise.all(
      provinces.map((p) =>
        fetch(`${BASE_URL}/regencies/${p.id}.json`, { next: { revalidate: REVALIDATE_SECONDS } })
          .then((r) => (r.ok ? (r.json() as Promise<Regency[]>) : []))
          .catch(() => [] as Regency[])
      )
    );

    const regencies = regencyLists
      .flat()
      .map((r) => ({ code: r.id, name: normalizeRegencyName(r.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(regencies);
  } catch (err) {
    console.error("Wilayah regencies error:", err);
    return NextResponse.json({ error: "Gagal memuat daftar wilayah" }, { status: 502 });
  }
}
