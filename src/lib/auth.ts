import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getPool, sql } from "@/lib/db";
import { getPermissionMapForRole } from "@/lib/queries/akun";
import { fullPermissionMap } from "@/lib/permissions";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const username = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!username || !password) return null;

        const pool = await getPool();
        const result = await pool
          .request()
          .input("username", sql.VarChar(128), username)
          .query(`
            SELECT du.UserID, du.Nama, du.Username, du.PasswordHash, du.IsActive,
                   du.FailedLoginCount, du.LockedUntil, du.RoleID, r.IsSuperAdmin
            FROM DashboardUser du
            JOIN DashboardRole r ON r.RoleID = du.RoleID
            WHERE du.Username = @username
          `);

        const row = result.recordset[0];
        if (!row || !row.IsActive) return null;

        if (row.LockedUntil && new Date(row.LockedUntil) > new Date()) {
          return null;
        }

        const ip = request?.headers?.get("x-forwarded-for") ?? null;
        const passwordOk = await bcrypt.compare(password, row.PasswordHash);

        if (!passwordOk) {
          const newFailedCount = (row.FailedLoginCount ?? 0) + 1;
          const lockedUntil =
            newFailedCount >= LOCKOUT_THRESHOLD
              ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
              : null;

          await pool
            .request()
            .input("userId", sql.Int, row.UserID)
            .input("failedCount", sql.Int, newFailedCount)
            .input("lockedUntil", sql.DateTime, lockedUntil)
            .query(`
              UPDATE DashboardUser
              SET FailedLoginCount = @failedCount, LockedUntil = @lockedUntil
              WHERE UserID = @userId
            `);
          return null;
        }

        await pool
          .request()
          .input("userId", sql.Int, row.UserID)
          .input("ip", sql.VarChar(64), ip)
          .query(`
            UPDATE DashboardUser
            SET FailedLoginCount = 0, LockedUntil = NULL,
                LastLoginAt = GETDATE(), LastLoginIP = @ip, UpdatedAt = GETDATE()
            WHERE UserID = @userId
          `);

        // Super Administrator bypasses the permission grid entirely (full
        // access to every module, including "akun" which isn't even a row
        // in DashboardRolePermission) rather than relying on someone having
        // remembered to grant it every module — see permissions.ts.
        const permissions = row.IsSuperAdmin ? fullPermissionMap() : await getPermissionMapForRole(row.RoleID);

        return {
          id: String(row.UserID),
          name: row.Nama,
          username: row.Username,
          roleId: row.RoleID,
          isSuperAdmin: !!row.IsSuperAdmin,
          permissions,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as {
          id: string;
          username: string;
          roleId: number;
          isSuperAdmin: boolean;
          permissions: ReturnType<typeof fullPermissionMap>;
        };
        token.id = u.id;
        token.username = u.username;
        token.roleId = u.roleId;
        token.isSuperAdmin = u.isSuperAdmin;
        token.permissions = u.permissions;
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
      }
      return session;
    },
  },
});
