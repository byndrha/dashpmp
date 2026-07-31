"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { createPeran, deletePeran, setPeranIzin, listAllPeran } from "@/lib/queries/akun";
import type { ModuleKey } from "@/lib/permissions";

export async function createPeranAction(perusahaanId: number, nama: string) {
  await requireGrupAccess();
  if (!nama.trim()) throw new Error("Nama peran wajib diisi.");
  await createPeran(perusahaanId, nama.trim());
  revalidatePath("/grup/akun/peran");
}

export async function deletePeranAction(peranId: number) {
  await requireGrupAccess();
  const peranList = await listAllPeran();
  const peran = peranList.find((p) => p.id === peranId);
  if (!peran) return;
  if (peran.isSuperAdmin) throw new Error("Peran Super Administrator tidak dapat dihapus.");
  if (peran.akunCount > 0) throw new Error("Peran masih dipakai oleh akun aktif, pindahkan akun tersebut dahulu.");
  await deletePeran(peranId);
  revalidatePath("/grup/akun/peran");
}

export async function setPeranIzinAction(input: { peranId: number; moduleKey: ModuleKey; canView: boolean; canEdit: boolean }) {
  await requireGrupAccess();
  await setPeranIzin(input);
  revalidatePath("/grup/akun/peran");
}
