import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mssql"],
  // Safety net for old MKEsindo bookmarks/links after the /mkesindo route
  // restructuring (docs/superpowers/specs/2026-08-08-restrukturisasi-rute-
  // mkesindo-design.md) — every internal reference was already updated
  // directly, this only catches traffic from outside the app. Bare "/" is
  // deliberately NOT listed here: it needs accountScope-aware dispatch
  // (pmputra -> /pmputra, mkesindo/direktur/superadmin -> /mkesindo), which
  // only proxy.ts can do — a static redirect here would fire before proxy.ts
  // ever runs (redirects() executes before Proxy in the Next.js request
  // pipeline) and send every account, including pmputra ones, to /mkesindo
  // first.
  async redirects() {
    return [
      { source: "/pnl/:path*", destination: "/mkesindo/pnl/:path*", permanent: false },
      { source: "/aging/:path*", destination: "/mkesindo/aging/:path*", permanent: false },
      { source: "/sales/:path*", destination: "/mkesindo/sales/:path*", permanent: false },
      { source: "/transaksi/:path*", destination: "/mkesindo/transaksi/:path*", permanent: false },
      { source: "/electricity/:path*", destination: "/mkesindo/electricity/:path*", permanent: false },
      { source: "/delivery/:path*", destination: "/mkesindo/delivery/:path*", permanent: false },
      { source: "/pemesanan/:path*", destination: "/mkesindo/pemesanan/:path*", permanent: false },
      { source: "/mitra/:path*", destination: "/mkesindo/mitra/:path*", permanent: false },
      { source: "/pemasaran/:path*", destination: "/mkesindo/pemasaran/:path*", permanent: false },
      { source: "/driver-app/:path*", destination: "/mkesindo/driver-app/:path*", permanent: false },
      { source: "/satpam-app/:path*", destination: "/mkesindo/satpam-app/:path*", permanent: false },
      { source: "/invoice/:path*", destination: "/mkesindo/invoice/:path*", permanent: false },
      { source: "/payment/:path*", destination: "/mkesindo/payment/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
