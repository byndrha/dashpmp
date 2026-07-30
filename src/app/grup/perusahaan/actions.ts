"use server";

import { revalidatePath } from "next/cache";
import { requireGrupAccess } from "@/lib/require-access";
import { createPerusahaan, updatePerusahaan, softDeletePerusahaan, type PerusahaanInput } from "@/lib/queries/perusahaan";
import { PERUSAHAAN_JENIS_BISNIS } from "@/lib/perusahaan-status";
import { upsertKoneksi, deleteKoneksi, type UpsertKoneksiInput } from "@/lib/queries/perusahaan-koneksi";

function assertValid(input: PerusahaanInput) {
  if (!input.nama.trim()) throw new Error("Nama PT wajib diisi.");
  if (input.status === "StandaloneHTML" && !input.standaloneUrl?.trim()) {
    throw new Error("URL Standalone wajib diisi untuk status Standalone HTML.");
  }
  // Locked enum — every module that branches on business type depends on
  // this never being an arbitrary string (see PERUSAHAAN_JENIS_BISNIS).
  if (!input.jenisBisnis || !(PERUSAHAAN_JENIS_BISNIS as readonly string[]).includes(input.jenisBisnis)) {
    throw new Error("Jenis Bisnis wajib dipilih (Es Kristal atau Es Balok).");
  }
}

export async function createPerusahaanAction(input: PerusahaanInput): Promise<void> {
  await requireGrupAccess();
  assertValid(input);
  await createPerusahaan(input);
  revalidatePath("/grup/perusahaan");
}

export async function updatePerusahaanAction(id: number, input: PerusahaanInput): Promise<void> {
  await requireGrupAccess();
  assertValid(input);
  await updatePerusahaan(id, input);
  revalidatePath("/grup/perusahaan");
}

export async function deletePerusahaanAction(id: number): Promise<void> {
  await requireGrupAccess();
  await softDeletePerusahaan(id);
  revalidatePath("/grup/perusahaan");
}

export async function upsertKoneksiAction(input: UpsertKoneksiInput): Promise<void> {
  await requireGrupAccess();
  if (!input.host.trim() || !input.dbName.trim() || !input.dbUser.trim()) {
    throw new Error("Host, Nama Database, dan Username wajib diisi untuk setiap koneksi.");
  }
  if (!Number.isFinite(input.port) || input.port <= 0) {
    throw new Error("Port harus berupa angka positif untuk setiap koneksi.");
  }
  await upsertKoneksi(input);
  revalidatePath("/grup/perusahaan");
}

export async function deleteKoneksiAction(id: number): Promise<void> {
  await requireGrupAccess();
  await deleteKoneksi(id);
  revalidatePath("/grup/perusahaan");
}
