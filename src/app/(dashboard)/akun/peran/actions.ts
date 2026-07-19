"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/require-access";
import { createRole, deleteRole, setRolePermission, listRoles } from "@/lib/queries/akun";
import type { ModuleKey } from "@/lib/permissions";

export async function createRoleAction(roleName: string) {
  await requireSuperAdmin();
  if (!roleName.trim()) throw new Error("Nama peran wajib diisi.");
  await createRole(roleName.trim());
  revalidatePath("/akun/peran");
}

export async function deleteRoleAction(roleId: number) {
  await requireSuperAdmin();
  const roles = await listRoles();
  const role = roles.find((r) => r.roleId === roleId);
  if (!role) return;
  if (role.isSuperAdmin) throw new Error("Peran Super Administrator tidak dapat dihapus.");
  if (role.userCount > 0) throw new Error("Peran masih dipakai oleh akun aktif, pindahkan akun tersebut dahulu.");
  await deleteRole(roleId);
  revalidatePath("/akun/peran");
}

export async function setRolePermissionAction(input: {
  roleId: number;
  moduleKey: ModuleKey;
  canView: boolean;
  canEdit: boolean;
}) {
  await requireSuperAdmin();
  await setRolePermission(input);
  revalidatePath("/akun/peran");
}
