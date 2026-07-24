"use server";

import { revalidatePath } from "next/cache";
import { createArmada, updateArmada, deleteArmada, type ArmadaInput } from "@/lib/queries/armada";
import {
  createJadwalDraft,
  deleteJadwalDraft,
  addSalesOrdersToJadwal,
  updateJadwalUrutan,
  updateJadwalDriverTime,
  startMuat,
  startBerangkat,
  getJadwalDetail,
  getAvailableSalesOrders,
  type JadwalDetailRow,
  type AvailableSalesOrder,
} from "@/lib/queries/pengiriman-jadwal";

export async function createArmadaAction(input: ArmadaInput): Promise<number> {
  const id = await createArmada(input);
  revalidatePath("/delivery");
  return id;
}

export async function updateArmadaAction(id: number, input: ArmadaInput): Promise<void> {
  await updateArmada(id, input);
  revalidatePath("/delivery");
}

export async function deleteArmadaAction(id: number): Promise<void> {
  await deleteArmada(id);
  revalidatePath("/delivery");
}

export async function createJadwalDraftAction(input: {
  armadaId: number;
  jamJadwal: Date;
  salesOrderIds: string[];
}): Promise<number> {
  const id = await createJadwalDraft(input);
  revalidatePath("/delivery");
  return id;
}

export async function deleteJadwalDraftAction(jadwalId: number): Promise<void> {
  await deleteJadwalDraft(jadwalId);
  revalidatePath("/delivery");
}

export async function addSalesOrdersToJadwalAction(jadwalId: number, salesOrderIds: string[]): Promise<void> {
  await addSalesOrdersToJadwal(jadwalId, salesOrderIds);
  revalidatePath("/delivery");
}

export async function updateJadwalUrutanAction(jadwalId: number, orderedDetailIds: number[]): Promise<void> {
  await updateJadwalUrutan(jadwalId, orderedDetailIds);
  revalidatePath("/delivery");
}

export async function updateJadwalDriverTimeAction(
  jadwalId: number,
  input: { jamJadwal: Date; salesmanId: string | null }
): Promise<void> {
  await updateJadwalDriverTime(jadwalId, input);
  revalidatePath("/delivery");
}

export async function startMuatAction(jadwalId: number): Promise<void> {
  await startMuat(jadwalId);
  revalidatePath("/delivery");
}

export async function startBerangkatAction(jadwalId: number): Promise<void> {
  await startBerangkat(jadwalId);
  revalidatePath("/delivery");
}

// Read-only — no revalidatePath needed, these just fetch data on demand
// when a dialog opens.
export async function getJadwalDetailAction(jadwalId: number): Promise<JadwalDetailRow[]> {
  return getJadwalDetail(jadwalId);
}

export async function getAvailableSalesOrdersAction(businessDate: string): Promise<AvailableSalesOrder[]> {
  return getAvailableSalesOrders(businessDate);
}
