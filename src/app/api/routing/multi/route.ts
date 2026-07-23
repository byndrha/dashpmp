// app/api/routing/multi/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getMultiPointRoute, type Coordinate } from "@/lib/osrm";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const points = body?.points as Coordinate[] | undefined;

  if (!Array.isArray(points) || points.length < 2) {
    return NextResponse.json({ error: "Minimal 2 titik diperlukan" }, { status: 400 });
  }
  if (points.some((p) => typeof p.lat !== "number" || typeof p.lng !== "number")) {
    return NextResponse.json({ error: "Setiap titik harus punya lat & lng numerik" }, { status: 400 });
  }

  try {
    const result = await getMultiPointRoute(points);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Multi-point routing error:", err);
    return NextResponse.json({ error: "Gagal menghitung rute" }, { status: 502 });
  }
}
