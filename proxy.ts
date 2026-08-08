import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Next.js 16 renamed Middleware to Proxy (file/behavior otherwise
// identical) — see node_modules/next/dist/docs/01-app/01-getting-started/
// 16-proxy.md. Routes a session's accountScope (see auth.ts / next-auth.d.ts)
// to its own home: "pmputra" -> /pmputra, "mkesindo" -> /mkesindo. An
// account with cross-PT authority — isSuperAdmin, or accountScope
// "direktur" (Perusahaan "PMP Group", which sits above every PT) — is
// exempt from the per-PT confinement below and may go anywhere; it still
// gets bounced off bare "/" to /mkesindo, since nothing is served there
// anymore (MKEsindo's dashboard moved to /mkesindo). See canAccessAllPT
// in require-access.ts for the same rule applied at the page/layout level.
//
// Public routes (login, API, static assets, public token pages) are
// checked explicitly in the function body rather than relied on via the
// matcher regex alone — the matcher below only trims obvious static-asset
// traffic for performance; the real "is this route gated" decision lives
// here where it's easy to audit.
const PUBLIC_PREFIXES = ["/login", "/api", "/mkesindo/invoice", "/mkesindo/payment"];

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

  // Inlined rather than imported from require-access.ts's canAccessAllPT()
  // to keep this file's own dependency graph self-contained (it runs in
  // the Edge runtime, unlike that module's other exports which use
  // next/navigation's redirect()) — keep the two definitions in sync.
  const isSuperAdmin = req.auth?.user?.isSuperAdmin ?? false;
  const hasGroupAccess = isSuperAdmin || scope === "direktur";
  if (hasGroupAccess) {
    if (path === "/") {
      return NextResponse.redirect(new URL("/mkesindo", req.nextUrl));
    }
    return NextResponse.next();
  }

  if (scope === "pmputra" && !path.startsWith("/pmputra")) {
    return NextResponse.redirect(new URL("/pmputra", req.nextUrl));
  }
  if (scope === "mkesindo" && !path.startsWith("/mkesindo")) {
    return NextResponse.redirect(new URL("/mkesindo", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)"],
};
