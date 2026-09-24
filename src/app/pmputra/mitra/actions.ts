// src/app/pmputra/mitra/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmputra } from "@/lib/require-access";
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

const KODE = "pmputra";

export async function getMitraListAction() {
  await requirePmputra();
  return getMitraList(KODE);
}

export async function getMitraDetailAction(sumber: SumberAgen, agenId: string) {
  await requirePmputra();
  return getMitraDetail(KODE, sumber, agenId);
}

export async function getWilayahOptionsAction(sumber: SumberAgen) {
  await requirePmputra();
  return getWilayahOptions(KODE, sumber);
}

export async function createMitraAction(
  sumber: SumberAgen,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmputra();
  const agenId = await createMitra(KODE, sumber, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmputra/mitra");
  return agenId;
}

export async function updateMitraAction(
  sumber: SumberAgen,
  agenId: string,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmputra();
  await updateMitra(KODE, sumber, agenId, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmputra/mitra");
}

export async function setMitraSuspendedAction(sumber: SumberAgen, agenId: string, isActive: boolean) {
  await requirePmputra();
  await setMitraSuspended(KODE, sumber, agenId, isActive);
  revalidatePath("/pmputra/mitra");
}

export async function deleteMitraAction(sumber: SumberAgen, agenId: string) {
  await requirePmputra();
  await deleteMitra(KODE, sumber, agenId);
  revalidatePath("/pmputra/mitra");
}
