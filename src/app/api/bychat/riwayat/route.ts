import { NextResponse } from "next/server";
import { AppError } from "@/lib/action-result";
import { autentikasi, bacaBody, jsonGalat } from "@/lib/bychat/auth-request";
import { cariMitraUntukKontak } from "@/lib/bychat/kirim";
import { assertPtKode } from "@/lib/bychat/mitra";
import { getRiwayatMitra } from "@/lib/bychat/riwayat";
import { rentangRiwayat } from "@/lib/bychat/riwayat-util";

// POST { token, mitraId, hari? } -> riwayat pembayaran + faktur lunas mitra
// (mitra harus cocok dengan nomor kontak percakapan pada klaim token).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { token, mitraId, hari } = await bacaBody(req);
    const { claims, koneksi } = await autentikasi(token);
    if (typeof mitraId !== "string" || !mitraId) throw new AppError("Mitra belum dipilih.");
    const { mitra } = await cariMitraUntukKontak(koneksi, claims);
    const dipilih = mitra.find((m) => m.id === mitraId);
    if (!dipilih) throw new AppError("Mitra tidak cocok dengan nomor percakapan ini.");
    const riwayat = await getRiwayatMitra(assertPtKode(koneksi.perusahaanKode), dipilih, rentangRiwayat(hari));
    return NextResponse.json(riwayat, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonGalat(err);
  }
}
