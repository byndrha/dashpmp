import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` and requires a plain
// exported function (default or named `proxy`) — NextAuth v5's
// `auth((req) => {...})` wrapper, the documented pattern for the OLD
// `middleware.ts` convention, is silently never invoked under this file
// name/shape in this Next.js version (confirmed directly: even an
// unconditional redirect placed at the top of an `auth(...)`-wrapped
// export never fired). `getToken` reads the session JWT directly and
// works with the plain function shape Next.js 16 actually loads.
//
// Also confirmed directly: in this dev environment, Proxy's own redirect
// is NOT reliably honored for every route (an unconditional redirect at
// the very top of this function — no logic at all — still fails to fire
// for "/" and "/pemasaran" specifically, while it fires correctly for
// every other route tested). Next.js's own docs advise against relying on
// Proxy as the sole enforcement layer for exactly this kind of reason
// ("Always verify authentication and authorization inside each Server
// Function rather than relying on Proxy alone"). This project already
// follows that advice everywhere — every protected page calls its own
// requireXXX() guard — so this file is defense-in-depth/UX convenience
// only. The actual Satpam confinement guarantee lives in
// `(dashboard)/layout.tsx`, which is proven reliable in this codebase
// (the same pattern already redirects Marketing accounts to /pemasaran).
export default async function proxy(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  const isLoggedIn = !!token;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isSatpam = (token?.isSatpam as boolean | undefined) ?? false;
  const isSatpamAppRoute = req.nextUrl.pathname.startsWith("/satpam-app");

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL(isSatpam ? "/satpam-app" : "/", req.nextUrl.origin));
  }

  if (isLoggedIn && isSatpam && !isSatpamAppRoute) {
    return NextResponse.redirect(new URL("/satpam-app", req.nextUrl.origin));
  }
}

export const config = {
  // Excludes common static image extensions in addition to the Next.js
  // internals — without this, a public asset like the login page's own
  // logo (public/brand/...) gets redirected to /login when requested by an
  // unauthenticated browser, since the <img> request itself is just
  // another page navigation as far as this matcher is concerned.
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"],
};
