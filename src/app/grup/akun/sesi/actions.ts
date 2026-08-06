"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { revokeAkunSesi } from "@/lib/queries/akun";
import { runAction, type ActionResult } from "@/lib/action-result";

export async function revokeSesiAction(sesiId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await revokeAkunSesi(sesiId);
    revalidatePath("/grup/akun/sesi");
  });
}
