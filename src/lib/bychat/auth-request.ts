import { NextResponse } from "next/server";
import { AppError } from "@/lib/action-result";
import { TokenError, verifyContextToken, type BychatClaims } from "@/lib/bychat/token";
import { resolveByChatByAccountId, type ResolvedByChat } from "@/lib/queries/perusahaan-bychat";

// Otentikasi semua endpoint /api/bychat/*: token konteks bertanda tangan ->
// account_id -> PT (gagal tertutup bila belum dipetakan). Tidak ada cookie
// dashpmp yang dipakai; otoritas = token ByChat.

export interface KonteksByChat {
  claims: BychatClaims;
  koneksi: ResolvedByChat;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public kode: string,
    message: string
  ) {
    super(message);
  }
}

export async function autentikasi(token: unknown): Promise<KonteksByChat> {
  if (typeof token !== "string" || !token) throw new HttpError(401, "tidak_valid", "Token konteks tidak ada.");
  let claims: BychatClaims;
  try {
    claims = await verifyContextToken(token);
  } catch (e) {
    if (e instanceof TokenError) {
      const status = e.kode === "konfigurasi" ? 503 : 401;
      throw new HttpError(status, e.kode, e.message);
    }
    throw e;
  }
  const koneksi = await resolveByChatByAccountId(claims.accountId);
  if (!koneksi) {
    throw new HttpError(403, "belum_dipetakan", "Akun ByChat ini belum dipetakan ke PT di dashpmp. Hubungi admin dashpmp.");
  }
  return { claims, koneksi };
}

export function jsonGalat(err: unknown): NextResponse {
  const noStore = { "Cache-Control": "no-store" };
  if (err instanceof HttpError) {
    return NextResponse.json({ error: { kode: err.kode, pesan: err.message } }, { status: err.status, headers: noStore });
  }
  if (err instanceof AppError) {
    return NextResponse.json({ error: { kode: "ditolak", pesan: err.message } }, { status: 422, headers: noStore });
  }
  console.error("Galat /api/bychat:", err instanceof Error ? err.message : err);
  return NextResponse.json({ error: { kode: "galat", pesan: "Terjadi kesalahan tak terduga. Silakan coba lagi." } }, { status: 500, headers: noStore });
}

export async function bacaBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
