// app/api/routing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRoute } from "@/lib/osrm";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const destLat = searchParams.get("lat");
  const destLng = searchParams.get("lng");

  if (!destLat || !destLng) {
    return NextResponse.json(
      { error: "Parameter lat & lng wajib diisi" },
      { status: 400 }
    );
  }

  try {
    const pabrik = await getPabrikLocation();
    const result = await getRoute(
      { lat: pabrik.latitude, lng: pabrik.longitude },
      { lat: parseFloat(destLat), lng: parseFloat(destLng) }
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("Routing error:", err);
    return NextResponse.json(
      { error: "Gagal menghitung rute" },
      { status: 502 }
    );
  }
}
