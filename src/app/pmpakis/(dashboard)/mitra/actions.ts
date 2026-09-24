// src/app/pmpakis/(dashboard)/mitra/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requirePmpakis } from "@/lib/require-access";
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

const KODE = "pmpakis";

export async function getMitraListAction() {
  await requirePmpakis();
  return getMitraList(KODE);
}

export async function getMitraDetailAction(sumber: SumberAgen, agenId: string) {
  await requirePmpakis();
  return getMitraDetail(KODE, sumber, agenId);
}

export async function getWilayahOptionsAction(sumber: SumberAgen) {
  await requirePmpakis();
  return getWilayahOptions(KODE, sumber);
}

export async function createMitraAction(
  sumber: SumberAgen,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmpakis();
  const agenId = await createMitra(KODE, sumber, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmpakis/mitra");
  return agenId;
}

export async function updateMitraAction(
  sumber: SumberAgen,
  agenId: string,
  input: MitraInput,
  location: { latitude: number; longitude: number; alamat: string | null } | null
) {
  const session = await requirePmpakis();
  await updateMitra(KODE, sumber, agenId, input);
  if (location) {
    await setAgenLocation(KODE, sumber, agenId, { ...location, userId: String(session.user.id) });
  }
  revalidatePath("/pmpakis/mitra");
}

export async function setMitraSuspendedAction(sumber: SumberAgen, agenId: string, isActive: boolean) {
  await requirePmpakis();
  await setMitraSuspended(KODE, sumber, agenId, isActive);
  revalidatePath("/pmpakis/mitra");
}

export async function deleteMitraAction(sumber: SumberAgen, agenId: string) {
  await requirePmpakis();
  await deleteMitra(KODE, sumber, agenId);
  revalidatePath("/pmpakis/mitra");
}
