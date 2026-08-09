"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateOwnProfile, changeOwnPassword } from "@/lib/queries/akun";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function updateOwnProfileAction(input: {
  nama: string;
  nomorTelepon: string | null;
  email: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");
    if (!input.nama.trim()) throw new AppError("Nama wajib diisi.");

    await updateOwnProfile({ userId: Number(userId), ...input });
    revalidatePath("/mkesindo", "layout");
  });
}

export async function changeOwnPasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");
    if (input.newPassword.length < 6) throw new AppError("Password baru minimal 6 karakter.");

    await changeOwnPassword({ userId: Number(userId), ...input });
  });
}
