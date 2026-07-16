import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getPool, sql } from "@/lib/db";

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

        // NOTE: assumes User.UserName is the login identifier — could not verify
        // against the live schema at scaffold time (DB unreachable). Adjust the
        // column name here if MKEsindo's actual login field differs.
        const pool = await getPool();
        const result = await pool
          .request()
          .input("username", sql.NVarChar, username)
          .query(`
            SELECT u.UserID, u.UserName, u.Name,
                   da.PasswordHash, da.IsActive, da.FailedLoginCount, da.LockedUntil
            FROM [User] u
            JOIN DashboardAuth da ON da.UserID = u.UserID
            WHERE u.UserName = @username
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
              UPDATE DashboardAuth
              SET FailedLoginCount = @failedCount, LockedUntil = @lockedUntil
              WHERE UserID = @userId
            `);
          return null;
        }

        await pool
          .request()
          .input("userId", sql.Int, row.UserID)
          .input("ip", sql.NVarChar, ip)
          .query(`
            UPDATE DashboardAuth
            SET FailedLoginCount = 0, LockedUntil = NULL,
                LastLoginAt = GETDATE(), LastLoginIP = @ip
            WHERE UserID = @userId
          `);

        return { id: String(row.UserID), name: row.Name, username: row.UserName };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = (user as { username?: string }).username;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { username?: string }).username = token.username as string;
      }
      return session;
    },
  },
});
