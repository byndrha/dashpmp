import { NextRequest, NextResponse } from "next/server";
import { requireGrupAccess } from "@/lib/require-access";
import { createRootFolderForConnect, getConnectedAccountEmail } from "@/lib/storage/google-drive";
import { saveGDriveKoneksi, getPerusahaanNama } from "@/lib/queries/perusahaan-gdrive";

// Every redirect back to the app below is built off appUrl (NEXTAUTH_URL),
// never req.url/req.nextUrl — confirmed live in production (behind
// Coolify's reverse proxy) that req.url resolves to the container's
// internal bind address (0.0.0.0:3000) rather than the public
// dash.pabrikespmp.com host, sending the browser to an unreachable
// address after a successful connect. NEXTAUTH_URL is already the
// trusted source of truth for the outbound redirect_uri sent to Google
// (below), so reusing it here keeps both consistent.
export async function GET(req: NextRequest) {
  await requireGrupAccess();
  const appUrl = process.env.NEXTAUTH_URL!;
  const code = req.nextUrl.searchParams.get("code");
  const perusahaanIdRaw = req.nextUrl.searchParams.get("state");
  if (!code || !perusahaanIdRaw) {
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", appUrl));
  }
  const perusahaanId = Number(perusahaanIdRaw);

  const redirectUri = `${appUrl}/api/gdrive/oauth/callback`;
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
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", appUrl));
  }
  const tokenJson = (await tokenRes.json()) as { refresh_token?: string };
  if (!tokenJson.refresh_token) {
    console.error("[gdrive/oauth/callback] no refresh_token in response (unexpected — prompt=consent was sent)");
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", appUrl));
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
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", appUrl));
  }

  return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=connected", appUrl));
}
