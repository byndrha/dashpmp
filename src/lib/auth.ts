import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import {
  findAkunByUsername,
  recordFailedLogin,
  recordSuccessfulLogin,
  getPermissionMapForPeran,
  createAkunSesi,
  checkAkunSesi,
  touchAkunSesiLastSeen,
} from "@/lib/queries/akun";
import { fullPermissionMap } from "@/lib/permissions";

type AccountScope = "mkesindo" | "direktur" | "pmputra" | "pmpersada";

interface AuthorizedUser {
  id: string;
  name: string;
  username: string;
  roleId: number;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isDriver: boolean;
  isProduksi: boolean;
  isOperasional: boolean;
  salesmanId: string | null;
  permissions: ReturnType<typeof fullPermissionMap>;
  accountScope: AccountScope;
  perusahaanId: number | null;
  sessionId: string;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
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

        const userAgent = request?.headers?.get("user-agent") ?? null;
        const sessionId = await createAkunSesi(row.id, userAgent, ip);

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
          isSatpam: row.isSatpam,
          isDriver: row.isDriver,
          isProduksi: row.isProduksi,
          isOperasional: row.isOperasional,
          salesmanId: row.salesmanId,
          permissions,
          accountScope: (row.perusahaanKode ?? "direktur") as AccountScope,
          perusahaanId: row.perusahaanId,
          sessionId,
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
        token.isSatpam = u.isSatpam;
        token.isDriver = u.isDriver;
        token.isProduksi = u.isProduksi;
        token.isOperasional = u.isOperasional;
        token.salesmanId = u.salesmanId;
        token.permissions = u.permissions;
        token.accountScope = u.accountScope;
        token.perusahaanId = u.perusahaanId;
        token.sessionId = u.sessionId;
        return token;
      }
      // Every subsequent call (no fresh `user` — just decoding an existing
      // token) is the revocation check: if this session was force-logged-out
      // from the sesi-login-aktif admin page, invalidate it immediately
      // rather than waiting for the JWT to naturally expire.
      //
      // Performance trade-off: this adds one extra Postgres query per
      // authenticated request. Separately, background location tracking
      // (src/components/location-tracking-bootstrap.tsx) calls the
      // recordLokasiAction server action roughly every 90 seconds per active
      // native-Android device, which also runs through this same jwt
      // callback and therefore this same revocation check. That makes the
      // check's call volume a continuous background baseline, not just a
      // function of interactive user requests. Both lookups are indexed PK
      // reads, and at this app's current scale (an internal company
      // dashboard, not high request volume) this was assessed as an
      // acceptable addition to the existing per-request trade-off above —
      // documented here intentionally, not an oversight. If request/device
      // volume grows significantly, revisit.
      if (typeof token.sessionId !== "string") return null;
      // Fail open on a DB error: a transient Postgres connectivity blip
      // (observed in practice — connections dropping under load) must not
      // sign every active user out or block every navigation in the app.
      // A truly revoked session is still caught the moment this query
      // successfully returns revoked_at set; only the "can't tell right
      // now" case is treated as "assume still valid".
      try {
        const valid = await checkAkunSesi(token.sessionId);
        if (!valid) return null;
        await touchAkunSesiLastSeen(token.sessionId);
      } catch (err) {
        console.error("[auth] Session revocation check failed, allowing session through:", err);
      }
      return token;
    },
    // Field-copying session() callback is identical to the light
    // auth.config.ts's own — reused from there rather than duplicated.
    ...authConfig.callbacks,
  },
});
