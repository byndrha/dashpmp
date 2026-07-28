"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  createMitra,
  updateMitra,
  updateMitraCapacity,
  deleteMitra,
  setMitraSuspended,
  getMitraDetail,
  type MitraInput,
  type MitraRow,
} from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";
import { setMitraCompetitor } from "@/lib/queries/mitra-competitor";

export async function createMitraAction(input: MitraInput): Promise<string> {
  const id = await createMitra(input);
  revalidatePath("/mitra");
  return id;
}

export async function updateMitraAction(id: string, input: MitraInput) {
  await updateMitra(id, input);
  revalidatePath("/mitra");
}

export async function updateMitraCapacityAction(id: string, capacity: number | null) {
  await updateMitraCapacity(id, capacity);
  revalidatePath("/mitra");
  revalidatePath("/transaksi");
}

export async function deleteMitraAction(id: string) {
  await deleteMitra(id);
  revalidatePath("/mitra");
}

export async function setMitraSuspendedAction(id: string, suspended: boolean) {
  await setMitraSuspended(id, suspended);
  revalidatePath("/mitra");
  revalidatePath("/pemesanan");
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

export async function setMitraCompetitorAction(input: { businessPartnerId: string; kompetitor: string | null }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await setMitraCompetitor({ ...input, userId });
  revalidatePath("/mitra");
}

// Read-only, fetched on demand (e.g. clicking a mitra name in Kinerja
// Marketing) — same isAuthenticated-only baseline as the rest of this
// already-gated (dashboard) route group, no extra role check needed.
export async function getMitraDetailAction(businessPartnerId: string): Promise<MitraRow | null> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return getMitraDetail(businessPartnerId);
}
