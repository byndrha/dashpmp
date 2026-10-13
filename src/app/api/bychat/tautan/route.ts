import { NextResponse } from "next/server";
import { AppError } from "@/lib/action-result";
import { autentikasi, bacaBody, jsonGalat } from "@/lib/bychat/auth-request";
import { ambilKartu } from "@/lib/bychat/kirim";
import { ambilAtauBuatTautan } from "@/lib/bychat/tautan";

// POST { token, mitraId } -> tautan publik kartu piutang mitra (untuk disalin
// agen). Mitra harus cocok dengan nomor percakapan, sama seperti kartu/kirim.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { token, mitraId } = await bacaBody(req);
    const { claims, koneksi } = await autentikasi(token);
    if (typeof mitraId !== "string" || !mitraId) throw new AppError("Mitra belum dipilih.");
    const kartu = await ambilKartu(koneksi, claims, mitraId);
    const t = await ambilAtauBuatTautan({
      ptKode: koneksi.perusahaanKode,
      perusahaanId: koneksi.perusahaanId,
      mitraId: kartu.mitra.id,
      agenNama: claims.agent.name,
      agenEmail: claims.agent.email,
    });
    return NextResponse.json({ url: t.url, kedaluwarsa: t.kedaluwarsa.toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonGalat(err);
  }
}
