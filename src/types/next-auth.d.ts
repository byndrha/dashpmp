import type { DefaultSession } from "next-auth";
import type { PermissionMap } from "@/lib/permissions";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      roleId: number;
      isSuperAdmin: boolean;
      permissions: PermissionMap;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    roleId: number;
    isSuperAdmin: boolean;
    permissions: PermissionMap;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    roleId: number;
    isSuperAdmin: boolean;
    permissions: PermissionMap;
  }
}
