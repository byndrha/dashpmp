// app/api/routing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRoute } from "@/lib/osrm";

// Titik asal: lokasi Pabrik Es PMP Ponorogo (dari Google Maps).
const PABRIK_ORIGIN = {
  lat: -7.8462825,
  lng: 111.4759937,
};

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
    const result = await getRoute(PABRIK_ORIGIN, {
      lat: parseFloat(destLat),
      lng: parseFloat(destLng),
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Routing error:", err);
    return NextResponse.json(
      { error: "Gagal menghitung rute" },
      { status: 502 }
    );
  }
}
