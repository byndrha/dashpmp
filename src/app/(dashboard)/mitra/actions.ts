"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createMitra, updateMitra, deleteMitra, type MitraInput } from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";

export async function createMitraAction(input: MitraInput): Promise<string> {
  const id = await createMitra(input);
  revalidatePath("/mitra");
  return id;
}

export async function updateMitraAction(id: string, input: MitraInput) {
  await updateMitra(id, input);
  revalidatePath("/mitra");
}

export async function deleteMitraAction(id: string) {
  await deleteMitra(id);
  revalidatePath("/mitra");
}

export async function setMitraLocationAction(input: {
  businessPartnerId: string;
  latitude: number;
  longitude: number;
  alamat: string | null;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await setMitraLocation({ ...input, userId });
  revalidatePath("/mitra");
}
