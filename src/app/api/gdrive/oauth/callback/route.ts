import { NextRequest, NextResponse } from "next/server";
import { requireGrupAccess } from "@/lib/require-access";
import { createRootFolderForConnect, getConnectedAccountEmail } from "@/lib/storage/google-drive";
import { saveGDriveKoneksi, getPerusahaanNama } from "@/lib/queries/perusahaan-gdrive";

export async function GET(req: NextRequest) {
  await requireGrupAccess();
  const code = req.nextUrl.searchParams.get("code");
  const perusahaanIdRaw = req.nextUrl.searchParams.get("state");
  if (!code || !perusahaanIdRaw) {
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", req.url));
  }
  const perusahaanId = Number(perusahaanIdRaw);

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/gdrive/oauth/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.error("[gdrive/oauth/callback] token exchange failed:", await tokenRes.text());
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", req.url));
  }
  const tokenJson = (await tokenRes.json()) as { refresh_token?: string };
  if (!tokenJson.refresh_token) {
    console.error("[gdrive/oauth/callback] no refresh_token in response (unexpected — prompt=consent was sent)");
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", req.url));
  }
  const refreshToken = tokenJson.refresh_token;

  try {
    const perusahaanNama = (await getPerusahaanNama(perusahaanId)) ?? `PT #${perusahaanId}`;
    const [email, rootFolderId] = await Promise.all([
      getConnectedAccountEmail(refreshToken),
      createRootFolderForConnect(refreshToken, perusahaanNama),
    ]);

    await saveGDriveKoneksi({ perusahaanId, connectedEmail: email, refreshToken, rootFolderId });
  } catch (err) {
    console.error("[gdrive/oauth/callback] post-token-exchange setup failed:", err);
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", req.url));
  }

  return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=connected", req.url));
}
