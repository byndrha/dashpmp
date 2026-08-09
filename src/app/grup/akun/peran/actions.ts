"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { createPeran, deletePeran, setPeranIzin, setPeranSatpam, setPeranDriver, setPeranProduksi, listAllPeran } from "@/lib/queries/akun";
import type { ModuleKey } from "@/lib/permissions";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function createPeranAction(perusahaanId: number, nama: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (!nama.trim()) throw new AppError("Nama peran wajib diisi.");
    await createPeran(perusahaanId, nama.trim());
    revalidatePath("/grup/akun/peran");
  });
}

export async function deletePeranAction(peranId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    const peranList = await listAllPeran();
    const peran = peranList.find((p) => p.id === peranId);
    if (!peran) return;
    if (peran.isSuperAdmin) throw new AppError("Peran Super Administrator tidak dapat dihapus.");
    if (peran.akunCount > 0) throw new AppError("Peran masih dipakai oleh akun aktif, pindahkan akun tersebut dahulu.");
    await deletePeran(peranId);
    revalidatePath("/grup/akun/peran");
  });
}

export async function setPeranIzinAction(input: {
  peranId: number;
  moduleKey: ModuleKey;
  canView: boolean;
  canEdit: boolean;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setPeranIzin(input);
    revalidatePath("/grup/akun/peran");
  });
}

export async function setPeranSatpamAction(peranId: number, isSatpam: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setPeranSatpam(peranId, isSatpam);
    revalidatePath("/grup/akun/peran");
  });
}

export async function setPeranDriverAction(peranId: number, isDriver: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setPeranDriver(peranId, isDriver);
    revalidatePath("/grup/akun/peran");
  });
}

export async function setPeranProduksiAction(peranId: number, isProduksi: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await setPeranProduksi(peranId, isProduksi);
    revalidatePath("/grup/akun/peran");
  });
}
