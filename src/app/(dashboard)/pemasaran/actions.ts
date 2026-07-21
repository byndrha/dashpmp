"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createPengajuan,
  approvePengajuan,
  rejectPengajuan,
  APPROVER_ROLE_IDS,
  type PengajuanInput,
} from "@/lib/queries/mitra-pengajuan";

export async function createPengajuanAction(input: PengajuanInput) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await createPengajuan(input, userId);
  revalidatePath("/pemasaran");
}

// Checked here, not just hidden in the UI — Setujui/Tolak must not be
// callable by anyone else even if they invoke the action directly.
async function requireApprover() {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new Error("Unauthorized");
  if (!user.isSuperAdmin && !APPROVER_ROLE_IDS.includes(user.roleId)) {
    throw new Error("Tidak punya izin menyetujui/menolak pengajuan");
  }
  return user;
}

export async function approvePengajuanAction(pengajuanId: number) {
  const user = await requireApprover();
  await approvePengajuan(pengajuanId, user.id);
  revalidatePath("/pemasaran");
  revalidatePath("/mitra");
}

export async function rejectPengajuanAction(pengajuanId: number, catatan: string | null) {
  const user = await requireApprover();
  await rejectPengajuan(pengajuanId, user.id, catatan);
  revalidatePath("/pemasaran");
}
