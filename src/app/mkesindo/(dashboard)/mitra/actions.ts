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
import {
  getMarketingUsers,
  getDriverUserOptions,
  setMitraPemilik,
  type MarketingUserOption,
} from "@/lib/queries/marketing-wilayah";
import { WILAYAH_MANAGER_ROLE_IDS } from "@/lib/roles";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

// Same role gate as Cakupan Wilayah's own requireWilayahManager
// (pemasaran/actions.ts) — Supervisor/Accounting/Manager/Super Admin —
// kept as its own local copy rather than a shared export since the two
// call sites were requested independently and shouldn't be forced to
// change together.
async function requireWilayahManager() {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new AppError("Unauthorized");
  if (!user.isSuperAdmin && !WILAYAH_MANAGER_ROLE_IDS.includes(user.roleId)) {
    throw new AppError("Tidak punya izin mengubah Pemilik mitra.");
  }
  return user;
}

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

// Gated the same as setMitraPemilikAction below — no point handing out the
// Marketing/Driver picker list to a session that isn't allowed to act on it.
export async function getMitraPemilikOptionsAction(): Promise<
  ActionResult<{ marketing: MarketingUserOption[]; driver: MarketingUserOption[] }>
> {
  return runAction(async () => {
    await requireWilayahManager();
    const [marketing, driver] = await Promise.all([getMarketingUsers(), getDriverUserOptions()]);
    return { marketing, driver };
  });
}

// ownerAkunId is a Postgres akun.id (either a Marketing or a Driver
// account) — null clears the override, reverting this Mitra to whatever
// Wilayah/Kecamatan coverage or cross-wilayah proposal would otherwise
// resolve it to.
export async function setMitraPemilikAction(businessPartnerId: string, ownerAkunId: string | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireWilayahManager();
    await setMitraPemilik(businessPartnerId, ownerAkunId, user.id);
    revalidatePath("/mkesindo/mitra");
    revalidatePath("/mkesindo/pemasaran");
    revalidatePath("/mkesindo/transaksi");
  });
}
