import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canView } from "@/lib/permissions";
import { canAccessAllPT } from "@/lib/require-access";
import { getHealthCheckTerbaru } from "@/lib/queries/driver-health-check";

// Validasi Rute — status Health Check terbaru untuk satu pengiriman
// (jadwal + driver). Sengaja route handler, BUKAN server action: Next.js
// menjalankan server action satu halaman satu per satu, sehingga status ini
// sempat mengantre >10 detik di belakang aksi lain dialog (pola yang sama
// dengan /api/mkesindo/jejak-armada).
//
// GET ?jadwalId&salesmanId → HealthCheckRow | null
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
  if (!canAccessAllPT(session.user) && !canView(session.user.permissions, "delivery")) {
    return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const jadwalId = Number(sp.get("jadwalId"));
  const salesmanId = (sp.get("salesmanId") ?? "").trim();
  if (!Number.isInteger(jadwalId) || jadwalId <= 0 || salesmanId === "" || salesmanId.length > 16) {
    return NextResponse.json({ error: "Parameter tidak valid" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getHealthCheckTerbaru(jadwalId, salesmanId));
  } catch (err) {
    console.error("[health-check] gagal:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Gagal memuat status Health Check" }, { status: 500 });
  }
}
