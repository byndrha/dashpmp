import { NextResponse } from "next/server";
import { renderKartuPng } from "@/lib/bychat/kartu-image";
import { muatKartuDariTautan } from "@/lib/bychat/tautan";
import { batasTokenGagal, batasUmum, ipDari } from "@/lib/bychat/rate-limit";

const NOT_FOUND = () => new NextResponse("Tidak ditemukan.", { status: 404, headers: { "Cache-Control": "no-store" } });

// Gambar PNG kartu piutang dari tautan publik (tanpa login). Token tak
// dikenal/kedaluwarsa/dicabut -> 404 polos.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ip = ipDari(req.headers);
  if (!batasUmum.coba(ip)) return NOT_FOUND();
  const kartu = await muatKartuDariTautan(token, ip);
  if (!kartu) {
    batasTokenGagal.coba(ip);
    return NOT_FOUND();
  }
  const png = await renderKartuPng(kartu);
  return new NextResponse(png as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="kartu-piutang-${kartu.tanggalPosisi}.png"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
