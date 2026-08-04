import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";
  const isSatpam = req.auth?.user.isSatpam ?? false;
  const isSatpamAppRoute = req.nextUrl.pathname.startsWith("/satpam-app");

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL(isSatpam ? "/satpam-app" : "/", req.nextUrl.origin));
  }

  // Satpam accounts are confined to the mobile inspection UI — every other
  // route (including the regular Beranda dashboard) redirects back there.
  if (isLoggedIn && isSatpam && !isSatpamAppRoute) {
    return NextResponse.redirect(new URL("/satpam-app", req.nextUrl.origin));
  }
});

export const config = {
  // Excludes common static image extensions in addition to the Next.js
  // internals — without this, a public asset like the login page's own
  // logo (public/brand/...) gets redirected to /login when requested by an
  // unauthenticated browser, since the <img> request itself is just
  // another page navigation as far as this matcher is concerned.
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)"],
};
