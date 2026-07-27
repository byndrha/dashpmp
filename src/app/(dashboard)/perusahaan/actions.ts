"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/require-access";
import { createPerusahaan, updatePerusahaan, softDeletePerusahaan, type PerusahaanInput } from "@/lib/queries/perusahaan";

function assertValid(input: PerusahaanInput) {
  if (!input.nama.trim()) throw new Error("Nama PT wajib diisi.");
  if (input.status === "StandaloneHTML" && !input.standaloneUrl?.trim()) {
    throw new Error("URL Standalone wajib diisi untuk status Standalone HTML.");
  }
}

export async function createPerusahaanAction(input: PerusahaanInput): Promise<void> {
  await requireSuperAdmin();
  assertValid(input);
  await createPerusahaan(input);
  revalidatePath("/perusahaan");
}

export async function updatePerusahaanAction(id: number, input: PerusahaanInput): Promise<void> {
  await requireSuperAdmin();
  assertValid(input);
  await updatePerusahaan(id, input);
  revalidatePath("/perusahaan");
}

export async function deletePerusahaanAction(id: number): Promise<void> {
  await requireSuperAdmin();
  await softDeletePerusahaan(id);
  revalidatePath("/perusahaan");
}
