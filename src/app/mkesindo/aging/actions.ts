"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { setCollectionTarget, removeCollectionTarget, setMitraNote } from "@/lib/queries/collection-priority";
import { getOutstandingInvoicesForMitra, recordPayment, type OutstandingInvoice } from "@/lib/queries/pelunasan";
import type { RecordPaymentInput, RecordPaymentResult } from "@/lib/pelunasan-types";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

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

export async function recordPaymentAction(input: RecordPaymentInput): Promise<ActionResult<RecordPaymentResult>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    const result = await recordPayment(input);
    revalidatePath("/mkesindo/aging");
    revalidatePath("/mkesindo");
    return result;
  });
}
