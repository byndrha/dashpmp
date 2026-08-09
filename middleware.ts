import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";

// This file MUST be named middleware.ts, not proxy.ts. Next.js's own
// vendored docs (node_modules/next/dist/docs/01-app/01-getting-started/
// 16-proxy.md) claim Next.js 16 renamed Middleware to Proxy and that
// proxy.ts is the current convention — but empirically, in this exact
// installed Next.js build, a root-level proxy.ts is NEVER picked up:
// .next/server/middleware-manifest.json comes out completely empty
// (`{"middleware":{},"sortedMiddleware":[],"functions":{}}`) even for a
// trivial proxy.ts with zero imports, both in local builds and on the
// actual Coolify production deployment (confirmed via matching commit SHA
// with a plain 404 and no redirect Location header on "/"). Renaming the
// identical file/content to middleware.ts (this file) — with the exported
// function renamed from `proxy` to `middleware` — immediately produces a
// populated manifest and working redirects. Do not rename this back to
// proxy.ts without re-verifying against a real deployment first.
//
// Uses its own light `auth()` built from auth.config.ts, NOT the full one
// exported by @/lib/auth — middleware runs in the Edge runtime, which
// can't load bcryptjs (the Credentials provider's authorize()) or pg
// (auth.ts's jwt() revocation check), both pulled in transitively by the
// full config. Confirmed by a real crash here ("Native module not found:
// node:util/types") before this split existed. Session revocation is
// still enforced on every real page load via auth.ts's own full auth() in
// Server Components; this file's redirects are UX convenience only, not
// the security boundary — see require-access.ts for the actual gates.
const { auth } = NextAuth(authConfig);

// Routes a session's accountScope (see auth.ts / next-auth.d.ts) to its own
// home: "pmputra" -> /pmputra, "mkesindo" -> /mkesindo. An account with
// cross-PT authority — isSuperAdmin, or accountScope "direktur" (Perusahaan
// "PMP Group", which sits above every PT) — is exempt from the per-PT
// confinement below and may go anywhere; it still gets bounced off bare "/"
// to /grup (the PMP Group holding overview — its natural home, not any one
// PT's dashboard), since nothing is served at bare "/" anymore. See
// canAccessAllPT in require-access.ts for the same rule applied at the
// page/layout level.
//
// Public routes (login, API, static assets, public token pages) are
// checked explicitly in the function body rather than relied on via the
// matcher regex alone — the matcher below only trims obvious static-asset
// traffic for performance; the real "is this route gated" decision lives
// here where it's easy to audit.
const PUBLIC_PREFIXES = ["/login", "/api", "/mkesindo/invoice", "/mkesindo/payment"];

// Shared across every PT and exempt from the per-PT confinement below, but
// NOT public like PUBLIC_PREFIXES above — these still rely on their own
// guard to be reached correctly: "/akses-ditolak" is only ever reached by
// an already-authenticated session per require-access.ts's guards, and
// "/static/prima-maesa-putra"'s route handler runs its own auth() check
// internally.
const SHARED_PREFIXES = ["/akses-ditolak", "/static"];

// Forwards the current pathname as a request header so Server Components
// (which don't otherwise get the request path) can read it via
// `(await headers()).get("x-pathname")` — needed by src/app/mkesindo/layout.tsx
// to avoid redirecting a request that's already AT the satpam-app/driver-app
// destination back to itself (see that file's own comment for the incident
// this fixes: driver-app and satpam-app now live inside the same layout
// subtree they're being redirected to, and that layout has no other way to
// know it's already looking at its own redirect target).
function passThrough(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const middleware = auth((req) => {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return passThrough(req);
  }
  if (SHARED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return passThrough(req);
  }

  const scope = req.auth?.user?.accountScope;
  // No session (or a session predating this field) — let existing
  // page-level guards handle every other route. Bare "/" is the one
  // exception: it has no page of its own since MKEsindo's dashboard moved
  // to /mkesindo, so there's nothing left to 404 into or for a page-level
  // guard to redirect from — this must send an unauthenticated visit to
  // /login explicitly, or it 404s instead.
  if (!scope) {
    if (path === "/") {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }
    return passThrough(req);
  }

  // Inlined rather than imported from require-access.ts's canAccessAllPT()
  // to keep this file's own dependency graph self-contained (it runs in
  // the Edge runtime, unlike that module's other exports which use
  // next/navigation's redirect()) — keep the two definitions in sync.
  const isSuperAdmin = req.auth?.user?.isSuperAdmin ?? false;
  const hasGroupAccess = isSuperAdmin || scope === "direktur";
  if (hasGroupAccess) {
    if (path === "/") {
      return NextResponse.redirect(new URL("/grup", req.nextUrl));
    }
    return passThrough(req);
  }

  if (scope === "pmputra" && !path.startsWith("/pmputra")) {
    return NextResponse.redirect(new URL("/pmputra", req.nextUrl));
  }
  if (scope === "mkesindo" && !path.startsWith("/mkesindo")) {
    return NextResponse.redirect(new URL("/mkesindo", req.nextUrl));
  }

  return passThrough(req);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)"],
};
