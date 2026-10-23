import type { DefaultSession } from "next-auth";
import type { PermissionMap } from "@/lib/permissions";

// "mkesindo" = every account that exists today (MSSQL DashboardUser,
// unchanged). "direktur"/"pmputra" are new Postgres-directory accounts —
// see docs/superpowers/specs/2026-07-30-postgres-directory-multi-company.md.
type AccountScope = "mkesindo" | "direktur" | "pmputra" | "pmpersada" | "pmpakis";

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
      bolehGenerateKodeAmbilAlih: boolean;
      canAksesInventaris: boolean;
      salesmanId: string | null;
      permissions: PermissionMap;
      accountScope: AccountScope;
      perusahaanId: number | null;
      sessionId: string;
      // holding.kode akun (lihat JWT.holdingKode); dipakai mis. master
      // kompetitor per holding.
      holdingKode: string;
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
    bolehGenerateKodeAmbilAlih: boolean;
    canAksesInventaris: boolean;
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
    bolehGenerateKodeAmbilAlih: boolean;
    canAksesInventaris: boolean;
    salesmanId: string | null;
    permissions: PermissionMap;
    accountScope: AccountScope;
    perusahaanId: number | null;
    sessionId: string;
    // holding.kode akun saat login. Opsional: token yang terbit sebelum
    // kolom ini ada tidak membawanya (dianggap "pmp" oleh auth.ts).
    holdingKode?: string;
  }
}
