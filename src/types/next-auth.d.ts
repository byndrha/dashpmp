import type { DefaultSession } from "next-auth";
import type { PermissionMap } from "@/lib/permissions";

// "mkesindo" = every account that exists today (MSSQL DashboardUser,
// unchanged). "direktur"/"pmputra" are new Postgres-directory accounts —
// see docs/superpowers/specs/2026-07-30-postgres-directory-multi-company.md.
type AccountScope = "mkesindo" | "direktur" | "pmputra" | "pmpersada";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      roleId: number;
      isSuperAdmin: boolean;
      isSatpam: boolean;
      isDriver: boolean;
      isProduksi: boolean;
      isOperasional: boolean;
      salesmanId: string | null;
      permissions: PermissionMap;
      accountScope: AccountScope;
      perusahaanId: number | null;
      sessionId: string;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    roleId: number;
    isSuperAdmin: boolean;
    isSatpam: boolean;
    isDriver: boolean;
    isProduksi: boolean;
    isOperasional: boolean;
    salesmanId: string | null;
    permissions: PermissionMap;
    accountScope: AccountScope;
    perusahaanId: number | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    roleId: number;
    isSuperAdmin: boolean;
    isSatpam: boolean;
    isDriver: boolean;
    isProduksi: boolean;
    isOperasional: boolean;
    salesmanId: string | null;
    permissions: PermissionMap;
    accountScope: AccountScope;
    perusahaanId: number | null;
    sessionId: string;
  }
}
