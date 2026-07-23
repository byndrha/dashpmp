// app/api/pabrik-location/route.ts
import { NextResponse } from "next/server";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";

// GET-only, no auth guard — this is a single non-sensitive coordinate, and
// it's read from plain client components (map pickers) the same way
// /api/geocode already is.
export async function GET() {
  const location = await getPabrikLocation();
  return NextResponse.json(location);
}
