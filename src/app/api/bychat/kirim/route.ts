import { NextResponse } from "next/server";
import { AppError } from "@/lib/action-result";
import { autentikasi, bacaBody, jsonGalat } from "@/lib/bychat/auth-request";
import { kirimKartu } from "@/lib/bychat/kirim";

// POST { token, mitraId, konfirmasi: true } -> kirim kartu ke WhatsApp mitra
// lewat ByChat. Wajib konfirmasi eksplisit dari UI (pratinjau + nomor tujuan).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { token, mitraId, konfirmasi } = await bacaBody(req);
    const { claims, koneksi } = await autentikasi(token);
    if (typeof mitraId !== "string" || !mitraId) throw new AppError("Mitra belum dipilih.");
    if (konfirmasi !== true) throw new AppError("Pengiriman memerlukan konfirmasi.");
    const hasil = await kirimKartu(koneksi, claims, mitraId);
    return NextResponse.json({ ok: true, ...hasil }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonGalat(err);
  }
}
