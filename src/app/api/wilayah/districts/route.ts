// app/api/wilayah/districts/route.ts
// Daftar Kecamatan untuk satu Kabupaten/Kota (?regencyCode=...) — Wilayah
// harus dipilih dahulu di client sebelum route ini dipanggil.
import { NextRequest, NextResponse } from "next/server";

const BASE_URL = "https://www.emsifa.com/api-wilayah-indonesia/api";
const REVALIDATE_SECONDS = 60 * 60 * 24 * 30;

interface District {
  id: string;
  regency_id: string;
  name: string;
}

function toTitleCase(raw: string): string {
  return raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(req: NextRequest) {
  const regencyCode = req.nextUrl.searchParams.get("regencyCode");
  if (!regencyCode) {
    return NextResponse.json({ error: "Parameter regencyCode wajib diisi" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BASE_URL}/districts/${encodeURIComponent(regencyCode)}.json`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Gagal memuat daftar kecamatan" }, { status: 502 });
    }

    const districts = (await res.json()) as District[];
    const kecamatan = districts
      .map((d) => ({ code: d.id, name: toTitleCase(d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(kecamatan);
  } catch (err) {
    console.error("Wilayah districts error:", err);
    return NextResponse.json({ error: "Gagal memuat daftar kecamatan" }, { status: 502 });
  }
}
