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
  getTermOfPaymentOptions,
  getPriceLevelOptions,
  type MitraInput,
  type MitraRow,
  type TermOfPaymentOption,
  type PriceLevelOption,
} from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";
import { setMitraCompetitor } from "@/lib/queries/mitra-competitor";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function createMitraAction(input: MitraInput): Promise<ActionResult<string>> {
  return runAction(async () => {
    const id = await createMitra(input);
    revalidatePath("/mkesindo/mitra");
    return id;
  });
}

export async function updateMitraAction(id: string, input: MitraInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await updateMitra(id, input);
    revalidatePath("/mkesindo/mitra");
  });
}

export async function updateMitraCapacityAction(id: string, capacity: number | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    await updateMitraCapacity(id, capacity);
    revalidatePath("/mkesindo/mitra");
    revalidatePath("/mkesindo/transaksi");
  });
}

export async function deleteMitraAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await deleteMitra(id);
    revalidatePath("/mkesindo/mitra");
  });
}

export async function setMitraSuspendedAction(id: string, suspended: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await setMitraSuspended(id, suspended);
    revalidatePath("/mkesindo/mitra");
    revalidatePath("/mkesindo/pemesanan");
  });
}

export async function setMitraLocationAction(input: {
  businessPartnerId: string;
  latitude: number;
  longitude: number;
  alamat: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await setMitraLocation({ ...input, userId });
    revalidatePath("/mkesindo/mitra");
  });
}

export async function setMitraCompetitorAction(input: {
  businessPartnerId: string;
  kompetitor: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await setMitraCompetitor({ ...input, userId });
    revalidatePath("/mkesindo/mitra");
  });
}

// Read-only, fetched on demand (e.g. clicking a mitra name in Kinerja
// Marketing) — same isAuthenticated-only baseline as the rest of this
// already-gated mkesindo route tree, no extra role check needed.
export async function getMitraDetailAction(businessPartnerId: string): Promise<ActionResult<MitraRow | null>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    return getMitraDetail(businessPartnerId);
  });
}

// Bundled in one round-trip for MitraEditDialog (mitra-edit-dialog.tsx) —
// both are needed to render MitraFormDialog's Harga/Tenggat Bayar selects,
// same two queries MitraPage already fetches server-side for MitraList's
// own inline edit flow.
export async function getMitraEditOptionsAction(): Promise<
  ActionResult<{ termOptions: TermOfPaymentOption[]; priceLevels: PriceLevelOption[] }>
> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    const [termOptions, priceLevels] = await Promise.all([getTermOfPaymentOptions(), getPriceLevelOptions()]);
    return { termOptions, priceLevels };
  });
}
