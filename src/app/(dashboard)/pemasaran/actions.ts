"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createPengajuan,
  approvePengajuan,
  rejectPengajuan,
  deletePengajuan,
  APPROVER_ROLE_IDS,
  type PengajuanInput,
} from "@/lib/queries/mitra-pengajuan";
import { addMarketingWilayah, removeMarketingWilayah } from "@/lib/queries/marketing-wilayah";
import { setMarketingPeriodSetting } from "@/lib/queries/marketing-period";
import { setWilayahPotentialTarget } from "@/lib/queries/wilayah-potential-target";
import { WILAYAH_MANAGER_ROLE_IDS } from "@/lib/roles";

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

// Deliberately narrower than requireApprover() — deleting a pengajuan
// (unlike approve/reject) is restricted to Super Admin only, not
// Supervisor/Accounting, per explicit business decision.
export async function deletePengajuanAction(pengajuanId: number) {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new Error("Unauthorized");
  if (!user.isSuperAdmin) throw new Error("Hanya Super Admin yang dapat menghapus pengajuan");

  await deletePengajuan(pengajuanId);
  revalidatePath("/pemasaran");
}

// Deliberately separate from requireApprover() — who manages Cakupan
// Wilayah Marketing (Supervisor/Accounting/Manager/Super Admin) was
// requested independently of who approves/rejects Pengajuan, so the two
// checks must be free to diverge.
async function requireWilayahManager() {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new Error("Unauthorized");
  if (!user.isSuperAdmin && !WILAYAH_MANAGER_ROLE_IDS.includes(user.roleId)) {
    throw new Error("Tidak punya izin mengatur cakupan wilayah Marketing");
  }
  return user;
}

export async function addMarketingWilayahAction(input: {
  marketingUserId: string;
  wilayah: string;
  kecamatan: string | null;
}) {
  const user = await requireWilayahManager();
  await addMarketingWilayah({ ...input, createdByUserId: user.id });
  revalidatePath("/pemasaran");
  revalidatePath("/mitra");
  revalidatePath("/transaksi");
}

export async function removeMarketingWilayahAction(id: number) {
  await requireWilayahManager();
  await removeMarketingWilayah(id);
  revalidatePath("/pemasaran");
  revalidatePath("/mitra");
  revalidatePath("/transaksi");
}

export async function setMarketingPeriodSettingAction(input: { startDate: string; periodDays: number }) {
  const user = await requireWilayahManager();
  if (input.periodDays < 1 || input.periodDays > 62) {
    throw new Error("Panjang periode harus antara 1 dan 62 hari.");
  }
  await setMarketingPeriodSetting({ ...input, userId: user.id });
  revalidatePath("/pemasaran");
}

export async function setWilayahPotentialTargetAction(input: { wilayah: string; potentialTarget: number }) {
  const user = await requireWilayahManager();
  if (input.potentialTarget < 0) {
    throw new Error("Potensial target tidak boleh negatif.");
  }
  await setWilayahPotentialTarget({ ...input, userId: user.id });
  revalidatePath("/pemasaran");
}
