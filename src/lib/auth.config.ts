import type { NextAuthConfig } from "next-auth";
import type { PermissionMap } from "@/lib/permissions";

type AccountScope = "mkesindo" | "direktur" | "pmputra";

// Edge-safe base shared between the full auth.ts (Server Components, Server
// Actions, the actual login flow) and the root middleware.ts, which needs
// its own separate, Edge-compatible NextAuth instance — see middleware.ts's
// own comment for why. No providers and no DB calls here: bcryptjs (the
// Credentials provider's authorize()) and pg (auth.ts's jwt() revocation
// check) both pull in Node built-ins the Edge runtime can't load (confirmed
// by a real crash — "Native module not found: node:util/types" — before
// this split existed). Session revocation is still enforced on every real
// page load via auth.ts's own full auth(); this light config only backs
// middleware's redirect-routing convenience, not the actual security
// boundary — matching this codebase's existing "proxy is UX convenience,
// page guards are the real gate" philosophy (see require-access.ts).
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.roleId = token.roleId as number;
        session.user.isSuperAdmin = token.isSuperAdmin as boolean;
        session.user.isSatpam = token.isSatpam as boolean;
        session.user.isDriver = token.isDriver as boolean;
        session.user.isProduksi = token.isProduksi as boolean;
        session.user.salesmanId = token.salesmanId as string | null;
        session.user.permissions = token.permissions as PermissionMap;
        session.user.accountScope = token.accountScope as AccountScope;
        session.user.perusahaanId = token.perusahaanId as number | null;
        session.user.sessionId = token.sessionId as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
