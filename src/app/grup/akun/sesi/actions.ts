"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { revokeAkunSesi } from "@/lib/queries/akun";

export async function revokeSesiAction(sesiId: string): Promise<void> {
  await requireGrupAccess();
  await revokeAkunSesi(sesiId);
  revalidatePath("/grup/akun/sesi");
}
