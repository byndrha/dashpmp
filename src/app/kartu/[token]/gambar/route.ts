import { NextResponse } from "next/server";
import { renderKartuPng } from "@/lib/bychat/kartu-image";
import { muatKartuDariTautan } from "@/lib/bychat/tautan";

// Gambar PNG kartu piutang dari tautan publik (tanpa login). Token tak
// dikenal/kedaluwarsa/dicabut -> 404 polos.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const kartu = await muatKartuDariTautan(token);
  if (!kartu) return new NextResponse("Tautan tidak ditemukan atau sudah kedaluwarsa.", { status: 404 });
  const png = await renderKartuPng(kartu);
  return new NextResponse(png as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="kartu-piutang-${kartu.tanggalPosisi}.png"`,
      "Cache-Control": "private, max-age=60",
      "X-Robots-Tag": "noindex",
    },
  });
}
