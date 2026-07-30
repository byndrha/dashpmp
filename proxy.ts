import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Next.js 16 renamed Middleware to Proxy (file/behavior otherwise
// identical) — see node_modules/next/dist/docs/01-app/01-getting-started/
// 16-proxy.md. Routes a session's accountScope (see auth.ts / next-auth.d.ts)
// to its own home: "direktur" -> /grup, "pmputra" -> /pmputra, "mkesindo"
// (every account that exists today) -> everything else, unchanged — except
// the MSSQL superadmin, who may also cross into /grup (see requireGrupAccess
// in require-access.ts for why).
//
// Public routes (login, API, static assets, public token pages) are
// checked explicitly in the function body rather than relied on via the
// matcher regex alone — the matcher below only trims obvious static-asset
// traffic for performance; the real "is this route gated" decision lives
// here where it's easy to audit.
const PUBLIC_PREFIXES = ["/login", "/api", "/invoice", "/payment"];

export const proxy = auth((req) => {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const scope = req.auth?.user?.accountScope;
  // No session (or a session predating this field) — let existing
  // page-level guards / the login page's own redirect handle it, same as
  // before this file existed.
  if (!scope) return NextResponse.next();

  if (scope === "direktur" && !path.startsWith("/grup")) {
    return NextResponse.redirect(new URL("/grup", req.nextUrl));
  }
  if (scope === "pmputra" && !path.startsWith("/pmputra")) {
    return NextResponse.redirect(new URL("/pmputra", req.nextUrl));
  }
  if (scope === "mkesindo") {
    if (path.startsWith("/pmputra")) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
    // /grup (PMP Group — holding-level ringkasan + Akun/Perusahaan/Akun
    // Direktori administration, see require-access.ts's requireGrupAccess)
    // is a bridge only the MSSQL superadmin may cross — every other
    // MKEsindo account is bounced back to its own dashboard.
    if (path.startsWith("/grup") && !req.auth?.user?.isSuperAdmin) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)"],
};
