"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateOwnProfile, changeOwnPassword } from "@/lib/queries/akun";
import { AppError } from "@/lib/action-result";

export async function updateOwnProfileAction(input: {
  nama: string;
  nomorTelepon: string | null;
  email: string | null;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AppError("Unauthorized");
  if (!input.nama.trim()) throw new AppError("Nama wajib diisi.");

  await updateOwnProfile({ userId: Number(userId), ...input });
  revalidatePath("/", "layout");
}

export async function changeOwnPasswordAction(input: { currentPassword: string; newPassword: string }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AppError("Unauthorized");
  if (input.newPassword.length < 6) throw new AppError("Password baru minimal 6 karakter.");

  await changeOwnPassword({ userId: Number(userId), ...input });
}
