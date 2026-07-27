"use server";

import { revalidatePath } from "next/cache";
import {
  createPemesanan,
  reschedulePemesanan,
  deletePemesanan,
  type CreatePemesananInput,
  type CreatePemesananResult,
  type ReschedulePemesananInput,
} from "@/lib/queries/pemesanan";
import { getCurrentAssignment, type CurrentAssignment } from "@/lib/queries/pengiriman-jadwal";
import { createTakeAwayPemesanan, type CreateTakeAwayInput, type CreateTakeAwayResult } from "@/lib/queries/takeaway";

export async function createPemesananAction(input: CreatePemesananInput): Promise<CreatePemesananResult> {
  const result = await createPemesanan(input);
  revalidatePath("/pemesanan");
  revalidatePath("/delivery");
  return result;
}

export async function deletePemesananAction(salesOrderId: string): Promise<void> {
  await deletePemesanan(salesOrderId);
  revalidatePath("/pemesanan");
  revalidatePath("/delivery");
}

export async function createTakeAwayPemesananAction(input: CreateTakeAwayInput): Promise<CreateTakeAwayResult> {
  const result = await createTakeAwayPemesanan(input);
  revalidatePath("/pemesanan");
  revalidatePath("/delivery");
  return result;
}

export async function reschedulePemesananAction(input: ReschedulePemesananInput): Promise<{ jadwalId: number }> {
  const result = await reschedulePemesanan(input);
  revalidatePath("/pemesanan");
  revalidatePath("/delivery");
  return result;
}

// Read-only — no revalidatePath needed, fetched on demand when the "Ubah
// Pemesanan" dialog opens.
export async function getCurrentAssignmentAction(salesOrderId: string): Promise<CurrentAssignment | null> {
  return getCurrentAssignment(salesOrderId);
}
