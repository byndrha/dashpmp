"use server";

import { revalidatePath } from "next/cache";
import { createMitra, updateMitra, deleteMitra, type MitraInput } from "@/lib/queries/mitra";

export async function createMitraAction(input: MitraInput) {
  await createMitra(input);
  revalidatePath("/mitra");
}

export async function updateMitraAction(id: string, input: MitraInput) {
  await updateMitra(id, input);
  revalidatePath("/mitra");
}

export async function deleteMitraAction(id: string) {
  await deleteMitra(id);
  revalidatePath("/mitra");
}
