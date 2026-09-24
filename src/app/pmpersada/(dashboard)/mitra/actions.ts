// src/app/pmpersada/(dashboard)/mitra/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import {
  getMitraList,
  getMitraDetail,
  getWilayahOptions,
  createMitra,
  updateMitra,
  setMitraSuspended,
  deleteMitra,
  setAgenLocation,
  type SumberAgen,
  type MitraInput,
} from "@/lib/queries/mitra-es-balok";

const KODE = "pmpersada";

export async function getMitraListAction() {
  await requirePmpersadaKeuangan();
  return getMitraList(KODE);
}

export async function getMitraDetailAction(sumber: SumberAgen, agenId: string) {
  await requirePmpersadaKeuangan();
  return getMitraDetail(KODE, sumber, agenId);
}

export async function getWilayahOptionsAction(sumber: SumberAgen) {
  await requirePmpersadaKeuangan();
  return getWilayahOptions(KODE, sumber);
}

export async function createMitraAction(
  sumber: SumberAgen,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmpersadaKeuangan();
  const agenId = await createMitra(KODE, sumber, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmpersada/mitra");
  return agenId;
}

export async function updateMitraAction(
  sumber: SumberAgen,
  agenId: string,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmpersadaKeuangan();
  await updateMitra(KODE, sumber, agenId, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmpersada/mitra");
}

export async function setMitraSuspendedAction(sumber: SumberAgen, agenId: string, isActive: boolean) {
  await requirePmpersadaKeuangan();
  await setMitraSuspended(KODE, sumber, agenId, isActive);
  revalidatePath("/pmpersada/mitra");
}

export async function deleteMitraAction(sumber: SumberAgen, agenId: string) {
  await requirePmpersadaKeuangan();
  await deleteMitra(KODE, sumber, agenId);
  revalidatePath("/pmpersada/mitra");
}
