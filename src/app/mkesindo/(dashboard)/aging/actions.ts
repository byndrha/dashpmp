"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { setCollectionTarget, removeCollectionTarget, setMitraNote } from "@/lib/queries/collection-priority";
import { getOutstandingInvoicesForMitra, recordPayment, type OutstandingInvoice } from "@/lib/queries/pelunasan";
import type { RecordPaymentInput, RecordPaymentResult } from "@/lib/pelunasan-types";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import { getMkesindoPerusahaanId } from "@/lib/queries/perusahaan";
import { canAccessAllPT } from "@/lib/require-access";

// Bypasses the permission grid for Direktur/Superadmin the same way
// assertCanEditLaporan does in laporan/actions.ts, so they can record
// payments too (support/testing), not just view outstanding invoices.
function assertCanEditAging(user: { isSuperAdmin: boolean; accountScope: string; permissions: { aging?: { canEdit: boolean } } }): void {
  const canEdit = canAccessAllPT(user) || !!user.permissions.aging?.canEdit;
  if (!canEdit) throw new AppError("Anda tidak punya izin mengubah data ini.");
}

export async function saveCollectionTargetAction(input: {
  businessPartnerId: string;
  targetDate: string | null;
  targetAmount: number | null;
  note: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await setCollectionTarget({ ...input, userId });
    revalidatePath("/mkesindo/aging");
  });
}

export async function removeCollectionTargetAction(businessPartnerId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    await removeCollectionTarget(businessPartnerId);
    revalidatePath("/mkesindo/aging");
  });
}

// Invoked from Beranda's Top 10 Mitra panel as well as anywhere else a
// quick note makes sense — revalidates both.
export async function setMitraNoteAction(input: {
  businessPartnerId: string;
  note: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await setMitraNote(input.businessPartnerId, input.note, userId);
    revalidatePath("/mkesindo/aging");
    revalidatePath("/mkesindo");
  });
}

export async function getOutstandingInvoicesAction(
  businessPartnerId: string
): Promise<ActionResult<OutstandingInvoice[]>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    return getOutstandingInvoicesForMitra(businessPartnerId);
  });
}

// konteks and perusahaanId are deliberately excluded from the
// caller-supplied input (Omit) and pinned below from the session instead
// of trusted from the client — see the pin site.
export async function recordPaymentAction(
  input: Omit<RecordPaymentInput, "konteks" | "perusahaanId">
): Promise<ActionResult<RecordPaymentResult>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");
    assertCanEditAging(session.user);

    // konteks and perusahaanId are pinned here, never trusted from the
    // client — same reasoning as recordDriverPaymentAction's own pin in
    // driver-app's actions.ts: without this, a forged request from this
    // surface could claim a different konteks/company and reach a
    // channel not meant for kasir, or another company's metode_pembayaran
    // configuration.
    //
    // /mkesindo/aging is unconditionally MKEsindo-scoped (middleware.ts
    // redirects other-PT-scoped sessions away before they reach this
    // action), so resolve via getMkesindoPerusahaanId() rather than
    // session.user.perusahaanId, which is null for every Direktur/superadmin
    // account by design (they aren't bound to one PT) and would otherwise
    // reject them outright. Real MKEsindo staff sessions already carry this
    // same id as their own perusahaanId, so this is a no-op for them —
    // same fix as getLaporanShiftDetailAction in laporan/actions.ts.
    const perusahaanId = await getMkesindoPerusahaanId();
    const result = await recordPayment({ ...input, konteks: "kasir", perusahaanId });
    revalidatePath("/mkesindo/aging");
    revalidatePath("/mkesindo");
    return result;
  });
}
