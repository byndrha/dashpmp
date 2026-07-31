import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import {
  findAkunByUsername,
  recordFailedLogin,
  recordSuccessfulLogin,
  getPermissionMapForPeran,
} from "@/lib/queries/akun";
import { fullPermissionMap } from "@/lib/permissions";

type AccountScope = "mkesindo" | "direktur" | "pmputra";

interface AuthorizedUser {
  id: string;
  name: string;
  username: string;
  roleId: number;
  isSuperAdmin: boolean;
  permissions: ReturnType<typeof fullPermissionMap>;
  accountScope: AccountScope;
  perusahaanId: number | null;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      // Single Postgres lookup — every account (Direktur, MKEsindo, PMPutra)
      // now lives in the same akun table. See docs/superpowers/specs/
      // 2026-07-31-migrasi-akun-postgres-design.md for why the previous
      // "try Postgres, fall back to MSSQL" two-hop lookup was removed.
      async authorize(credentials, request) {
        const username = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!username || !password) return null;

        const row = await findAkunByUsername(username);
        if (!row || !row.isActive) return null;

        if (row.lockedUntil && new Date(row.lockedUntil) > new Date()) return null;

        const ip = request?.headers?.get("x-forwarded-for") ?? null;
        const passwordOk = await bcrypt.compare(password, row.passwordHash);

        if (!passwordOk) {
          await recordFailedLogin(row.id, row.failedLoginCount);
          return null;
        }

        await recordSuccessfulLogin(row.id, ip);

        // Super Administrator bypasses the permission grid entirely, same
        // as before — now sourced from peran.is_super_admin instead of
        // DashboardRole.IsSuperAdmin. A Direktur account has no peran at
        // all (peranId null) — /grup gates on accountScope directly, not
        // this permission map, so an empty map is correct for it.
        const permissions = row.isSuperAdmin
          ? fullPermissionMap()
          : row.peranId != null
            ? await getPermissionMapForPeran(row.peranId)
            : {};

        const user: AuthorizedUser = {
          id: String(row.id),
          name: row.nama,
          username: row.username,
          roleId: row.peranId ?? 0,
          isSuperAdmin: row.isSuperAdmin,
          permissions,
          accountScope: (row.perusahaanKode ?? "direktur") as AccountScope,
          perusahaanId: row.perusahaanId,
        };
        return user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as AuthorizedUser;
        token.id = u.id;
        token.username = u.username;
        token.roleId = u.roleId;
        token.isSuperAdmin = u.isSuperAdmin;
        token.permissions = u.permissions;
        token.accountScope = u.accountScope;
        token.perusahaanId = u.perusahaanId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = token.username as string;
        session.user.roleId = token.roleId as number;
        session.user.isSuperAdmin = token.isSuperAdmin as boolean;
        session.user.permissions = token.permissions as ReturnType<typeof fullPermissionMap>;
        session.user.accountScope = token.accountScope as AccountScope;
        session.user.perusahaanId = token.perusahaanId as number | null;
      }
      return session;
    },
  },
});
