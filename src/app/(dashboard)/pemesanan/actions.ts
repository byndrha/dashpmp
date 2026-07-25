"use server";

import { revalidatePath } from "next/cache";
import { createPemesanan, type CreatePemesananInput, type CreatePemesananResult } from "@/lib/queries/pemesanan";

export async function createPemesananAction(input: CreatePemesananInput): Promise<CreatePemesananResult> {
  const result = await createPemesanan(input);
  revalidatePath("/pemesanan");
  revalidatePath("/delivery");
  return result;
}
