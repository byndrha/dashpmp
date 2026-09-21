// app/api/mkesindo/routing/kunjungan/route.ts
// Berbeda dari /api/mkesindo/routing/route.ts (origin selalu Pabrik) -- rute
// ini originnya posisi GPS marketing saat itu, bukan Pabrik.
import { NextRequest, NextResponse } from "next/server";
import { getRoute } from "@/lib/osrm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const originLat = searchParams.get("originLat");
  const originLng = searchParams.get("originLng");
  const destLat = searchParams.get("destLat");
  const destLng = searchParams.get("destLng");

  if (!originLat || !originLng || !destLat || !destLng) {
    return NextResponse.json({ error: "Parameter originLat, originLng, destLat, destLng wajib diisi" }, { status: 400 });
  }

  try {
    const result = await getRoute(
      { lat: parseFloat(originLat), lng: parseFloat(originLng) },
      { lat: parseFloat(destLat), lng: parseFloat(destLng) }
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[routing/kunjungan] gagal menghitung rute:", err);
    return NextResponse.json({ error: "Gagal menghitung rute" }, { status: 502 });
  }
}
