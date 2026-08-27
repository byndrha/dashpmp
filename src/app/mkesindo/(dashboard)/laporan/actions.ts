"use server";

import { revalidatePath } from "next/cache";
import { requireModuleAccess, canAccessAllPT } from "@/lib/require-access";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import {
  getCurrentShiftRows,
  getStokBahanBakuHistory,
  upsertOperasionalStok,
  getSaldoAwal,
  setSaldoAwal,
  type StokBahanBakuRow,
  type CurrentShiftInfo,
  type SaldoAwalRow,
  type UpsertOperasionalStokInput,
  type JenisBarang,
} from "@/lib/queries/stok-bahan-baku";

// Bypasses the permission grid for Direktur/Superadmin the same way every
// other module's canAccessAllPT() checks do, so they can exercise the
// input form too (support/testing), not just view it.
function assertCanEditLaporan(user: { isSuperAdmin: boolean; accountScope: string; permissions: { laporan?: { canEdit: boolean } } }): void {
  const canEdit = canAccessAllPT(user) || !!user.permissions.laporan?.canEdit;
  if (!canEdit) throw new AppError("Anda tidak punya izin mengubah data ini.");
}

export async function getCurrentShiftRowsAction(): Promise<ActionResult<{ current: CurrentShiftInfo; rows: StokBahanBakuRow[] }>> {
  return runAction(async () => {
    await requireModuleAccess("laporan");
    return getCurrentShiftRows();
  });
}

export async function getStokBahanBakuHistoryAction(): Promise<ActionResult<StokBahanBakuRow[]>> {
  return runAction(async () => {
    await requireModuleAccess("laporan");
    return getStokBahanBakuHistory();
  });
}

export async function upsertOperasionalStokAction(
  input: Omit<UpsertOperasionalStokInput, "akunId">
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    assertCanEditLaporan(session.user);
    if (input.stokMasukGudang < 0 || input.stokMasukInventoriOperasional < 0) {
      throw new AppError("Jumlah tidak boleh negatif.");
    }
    await upsertOperasionalStok({ ...input, akunId: Number(session.user.id) });
    revalidatePath("/mkesindo/laporan");
    revalidatePath("/mkesindo/produksi-app");
  });
}

export async function getSaldoAwalAction(): Promise<ActionResult<SaldoAwalRow[]>> {
  return runAction(async () => {
    await requireModuleAccess("laporan");
    return getSaldoAwal();
  });
}

export async function setSaldoAwalAction(
  jenisBarang: JenisBarang,
  saldoAwalGudang: number,
  saldoAwalInventoriOperasional: number
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireModuleAccess("laporan");
    if (!canAccessAllPT(session.user)) {
      throw new AppError("Hanya Direktur/Superadmin yang bisa mengubah saldo awal.");
    }
    if (saldoAwalGudang < 0 || saldoAwalInventoriOperasional < 0) {
      throw new AppError("Saldo awal tidak boleh negatif.");
    }
    await setSaldoAwal(jenisBarang, saldoAwalGudang, saldoAwalInventoriOperasional, Number(session.user.id));
    revalidatePath("/mkesindo/laporan");
  });
}
