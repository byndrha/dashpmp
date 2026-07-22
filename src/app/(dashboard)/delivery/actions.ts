"use server";

import { revalidatePath } from "next/cache";
import { createArmada, updateArmada, deleteArmada } from "@/lib/queries/armada";

export async function createArmadaAction(nama: string): Promise<number> {
  const id = await createArmada(nama);
  revalidatePath("/delivery");
  return id;
}

export async function updateArmadaAction(id: number, nama: string): Promise<void> {
  await updateArmada(id, nama);
  revalidatePath("/delivery");
}

export async function deleteArmadaAction(id: number): Promise<void> {
  await deleteArmada(id);
  revalidatePath("/delivery");
}
