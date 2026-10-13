import { NextResponse } from "next/server";
import { AppError } from "@/lib/action-result";
import { autentikasi, bacaBody, jsonGalat } from "@/lib/bychat/auth-request";
import { pratinjauKartu } from "@/lib/bychat/kirim";

// POST { token, mitraId } -> PNG kartu piutang (pratinjau sebelum kirim).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { token, mitraId } = await bacaBody(req);
    const { claims, koneksi } = await autentikasi(token);
    if (typeof mitraId !== "string" || !mitraId) throw new AppError("Mitra belum dipilih.");
    const png = await pratinjauKartu(koneksi, claims, mitraId);
    return new NextResponse(png as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonGalat(err);
  }
}
