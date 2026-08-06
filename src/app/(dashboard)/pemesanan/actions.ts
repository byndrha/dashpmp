"use server";

import { revalidatePath } from "next/cache";
import {
  createPemesanan,
  reschedulePemesanan,
  deletePemesanan,
  updateSalesOrderTransDate,
  type CreatePemesananInput,
  type CreatePemesananResult,
  type ReschedulePemesananInput,
} from "@/lib/queries/pemesanan";
import { getCurrentAssignment, type CurrentAssignment } from "@/lib/queries/pengiriman-jadwal";
import { createTakeAwayPemesanan, type CreateTakeAwayInput, type CreateTakeAwayResult } from "@/lib/queries/takeaway";
import {
  getEditableSalesOrderQty,
  updateSalesOrderDetailQty,
  type EditableSalesOrderQty,
  type KantongVariant,
} from "@/lib/queries/sales-order";
import { runAction, type ActionResult } from "@/lib/action-result";

export async function createPemesananAction(input: CreatePemesananInput): Promise<ActionResult<CreatePemesananResult>> {
  return runAction(async () => {
    const result = await createPemesanan(input);
    revalidatePath("/pemesanan");
    revalidatePath("/delivery");
    return result;
  });
}

export async function deletePemesananAction(salesOrderId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await deletePemesanan(salesOrderId);
    revalidatePath("/pemesanan");
    revalidatePath("/delivery");
  });
}

export async function createTakeAwayPemesananAction(input: CreateTakeAwayInput): Promise<ActionResult<CreateTakeAwayResult>> {
  return runAction(async () => {
    const result = await createTakeAwayPemesanan(input);
    revalidatePath("/pemesanan");
    revalidatePath("/delivery");
    return result;
  });
}

export async function reschedulePemesananAction(input: ReschedulePemesananInput): Promise<ActionResult<{ jadwalId: number }>> {
  return runAction(async () => {
    const result = await reschedulePemesanan(input);
    revalidatePath("/pemesanan");
    revalidatePath("/delivery");
    return result;
  });
}

// Read-only — no revalidatePath needed, fetched on demand when the "Ubah
// Pemesanan" dialog opens.
export async function getCurrentAssignmentAction(salesOrderId: string): Promise<CurrentAssignment | null> {
  return getCurrentAssignment(salesOrderId);
}

export async function updateSalesOrderTransDateAction(salesOrderId: string, transDate: Date): Promise<ActionResult<void>> {
  return runAction(async () => {
    await updateSalesOrderTransDate(salesOrderId, transDate);
    revalidatePath("/pemesanan");
    revalidatePath("/delivery");
  });
}

// Read-only — no revalidatePath needed, fetched on demand when "Ubah
// Pemesanan" opens, same shape as getCurrentAssignmentAction above.
export async function getEditableSalesOrderQtyAction(salesOrderId: string): Promise<EditableSalesOrderQty> {
  return getEditableSalesOrderQty(salesOrderId);
}

export async function updateSalesOrderQtyAction(
  salesOrderId: string,
  variant: KantongVariant,
  newQty: number
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await updateSalesOrderDetailQty(salesOrderId, variant, newQty);
    revalidatePath("/pemesanan");
    revalidatePath("/delivery");
  });
}
