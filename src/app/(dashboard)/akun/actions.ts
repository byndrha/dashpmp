"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/require-access";
import {
  createUser,
  updateUser,
  resetUserPassword,
  countActiveSuperAdmins,
  listRoles,
} from "@/lib/queries/akun";

export async function createUserAction(input: {
  nama: string;
  username: string;
  password: string;
  nomorTelepon: string | null;
  email: string | null;
  roleId: number;
}) {
  await requireSuperAdmin();
  if (!input.nama.trim() || !input.username.trim() || input.password.length < 6) {
    throw new Error("Nama, username wajib diisi dan password minimal 6 karakter.");
  }
  try {
    await createUser(input);
  } catch (err) {
    if (err instanceof Error && /UQ_DashboardUser_Username/i.test(err.message)) {
      throw new Error("Username sudah digunakan, pilih username lain.");
    }
    throw err;
  }
  revalidatePath("/akun");
}

export async function updateUserAction(input: {
  userId: number;
  nama: string;
  nomorTelepon: string | null;
  email: string | null;
  roleId: number;
  isActive: boolean;
}) {
  await requireSuperAdmin();
  if (!input.nama.trim()) throw new Error("Nama wajib diisi.");

  const roles = await listRoles();
  const newRoleIsSuperAdmin = roles.find((r) => r.roleId === input.roleId)?.isSuperAdmin ?? false;
  if (!input.isActive || !newRoleIsSuperAdmin) {
    const remaining = await countActiveSuperAdmins(input.userId);
    if (remaining === 0) {
      throw new Error(
        "Tidak bisa menonaktifkan atau mengubah peran akun ini — minimal harus ada satu Super Administrator aktif."
      );
    }
  }

  await updateUser(input);
  revalidatePath("/akun");
}

export async function resetUserPasswordAction(userId: number, newPassword: string) {
  await requireSuperAdmin();
  if (newPassword.length < 6) throw new Error("Password minimal 6 karakter.");
  await resetUserPassword(userId, newPassword);
  revalidatePath("/akun");
}
