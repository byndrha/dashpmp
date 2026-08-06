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
import {
  addMarketingWilayah,
  removeMarketingWilayah,
  addMarketingMitra,
  removeMarketingMitra,
} from "@/lib/queries/marketing-wilayah";
import { setMarketingPeriodSetting } from "@/lib/queries/marketing-period";
import { setWilayahPotentialTarget } from "@/lib/queries/wilayah-potential-target";
import {
  getMarketingVisitLogForDate,
  saveMarketingVisitLog,
  type MarketingVisitLogEntry,
} from "@/lib/queries/marketing-visit-log";
import { WILAYAH_MANAGER_ROLE_IDS } from "@/lib/roles";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function createPengajuanAction(input: PengajuanInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await createPengajuan(input, userId);
    revalidatePath("/pemasaran");
  });
}

// Checked here, not just hidden in the UI — Setujui/Tolak must not be
// callable by anyone else even if they invoke the action directly.
async function requireApprover() {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new AppError("Unauthorized");
  if (!user.isSuperAdmin && !APPROVER_ROLE_IDS.includes(user.roleId)) {
    throw new AppError("Tidak punya izin menyetujui/menolak pengajuan");
  }
  return user;
}

export async function approvePengajuanAction(pengajuanId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireApprover();
    await approvePengajuan(pengajuanId, user.id);
    revalidatePath("/pemasaran");
    revalidatePath("/mitra");
  });
}

export async function rejectPengajuanAction(
  pengajuanId: number,
  catatan: string | null
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireApprover();
    await rejectPengajuan(pengajuanId, user.id, catatan);
    revalidatePath("/pemasaran");
  });
}

// Deliberately narrower than requireApprover() — deleting a pengajuan
// (unlike approve/reject) is restricted to Super Admin only, not
// Supervisor/Accounting, per explicit business decision.
export async function deletePengajuanAction(pengajuanId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const user = session?.user;
    if (!user) throw new AppError("Unauthorized");
    if (!user.isSuperAdmin) throw new AppError("Hanya Super Admin yang dapat menghapus pengajuan");

    await deletePengajuan(pengajuanId);
    revalidatePath("/pemasaran");
  });
}

// Deliberately separate from requireApprover() — who manages Cakupan
// Wilayah Marketing (Supervisor/Accounting/Manager/Super Admin) was
// requested independently of who approves/rejects Pengajuan, so the two
// checks must be free to diverge.
async function requireWilayahManager() {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new AppError("Unauthorized");
  if (!user.isSuperAdmin && !WILAYAH_MANAGER_ROLE_IDS.includes(user.roleId)) {
    throw new AppError("Tidak punya izin mengatur cakupan wilayah Marketing");
  }
  return user;
}

export async function addMarketingWilayahAction(input: {
  marketingUserId: string;
  wilayah: string;
  kecamatan: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireWilayahManager();
    await addMarketingWilayah({ ...input, createdByUserId: user.id });
    revalidatePath("/pemasaran");
    revalidatePath("/mitra");
    revalidatePath("/transaksi");
  });
}

export async function removeMarketingWilayahAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireWilayahManager();
    await removeMarketingWilayah(id);
    revalidatePath("/pemasaran");
    revalidatePath("/mitra");
    revalidatePath("/transaksi");
  });
}

export async function addMarketingMitraAction(input: {
  marketingUserId: string;
  businessPartnerId: string;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireWilayahManager();
    await addMarketingMitra({ ...input, createdByUserId: user.id });
    revalidatePath("/pemasaran");
    revalidatePath("/mitra");
    revalidatePath("/transaksi");
  });
}

export async function removeMarketingMitraAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireWilayahManager();
    await removeMarketingMitra(id);
    revalidatePath("/pemasaran");
    revalidatePath("/mitra");
    revalidatePath("/transaksi");
  });
}

export async function setMarketingPeriodSettingAction(input: {
  startDate: string;
  periodDays: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireWilayahManager();
    if (input.periodDays < 1 || input.periodDays > 62) {
      throw new AppError("Panjang periode harus antara 1 dan 62 hari.");
    }
    await setMarketingPeriodSetting({ ...input, userId: user.id });
    revalidatePath("/pemasaran");
  });
}

export async function setWilayahPotentialTargetAction(input: {
  wilayah: string;
  potentialTarget: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireWilayahManager();
    if (input.potentialTarget < 0) {
      throw new AppError("Potensial target tidak boleh negatif.");
    }
    await setWilayahPotentialTarget({ ...input, userId: user.id });
    revalidatePath("/pemasaran");
  });
}

export async function getMarketingVisitLogAction(
  businessPartnerId: string,
  dateISO: string
): Promise<ActionResult<MarketingVisitLogEntry | null>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    return getMarketingVisitLogForDate(businessPartnerId, dateISO);
  });
}

export async function saveMarketingVisitLogAction(input: {
  businessPartnerId: string;
  dateISO: string;
  hasilKunjungan: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await saveMarketingVisitLog({ ...input, userId });
  });
}
