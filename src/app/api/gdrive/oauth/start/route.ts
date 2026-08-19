import { NextRequest, NextResponse } from "next/server";
import { requireGrupAccess } from "@/lib/require-access";

export async function GET(req: NextRequest) {
  await requireGrupAccess();
  const perusahaanId = req.nextUrl.searchParams.get("perusahaanId");
  if (!perusahaanId) {
    return NextResponse.json({ error: "perusahaanId wajib diisi" }, { status: 400 });
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/gdrive/oauth/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    // offline is required to receive a refresh_token at all; prompt=consent
    // is required to receive one again on a reconnect (Google only issues
    // it on first-ever consent otherwise).
    access_type: "offline",
    prompt: "consent",
    state: perusahaanId,
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
