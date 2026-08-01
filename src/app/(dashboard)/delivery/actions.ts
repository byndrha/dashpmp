"use server";

import { revalidatePath } from "next/cache";
import { requireModuleAccess } from "@/lib/require-access";
import { createArmada, updateArmada, deleteArmada, type ArmadaInput } from "@/lib/queries/armada";
import {
  createJadwalDraft,
  deleteJadwalDraft,
  addSalesOrdersToJadwal,
  removeSalesOrderFromJadwal,
  updateJadwalUrutan,
  updateJadwalDriverTime,
  updateJadwalArmada,
  startMuat,
  startBerangkat,
  getJadwalDetail,
  getAvailableSalesOrders,
  mergeExternalDeliveriesIntoJadwal,
  getMaxSalesOrderTransDateForDeliveries,
  type JadwalDetailRow,
  type AvailableSalesOrder,
} from "@/lib/queries/pengiriman-jadwal";
import {
  getArmadaActivities,
  createArmadaActivity,
  updateArmadaActivity,
  deleteArmadaActivity,
  type ArmadaActivity,
  type ArmadaActivityType,
  type UpdateArmadaActivityInput,
} from "@/lib/queries/armada-activity";
import { getDriverProfiles, saveDriverProfile, type DriverProfileRow, type SaveDriverProfileInput } from "@/lib/queries/driver-profile";

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

export async function removeSalesOrderFromJadwalAction(jadwalId: number, salesOrderId: string): Promise<void> {
  await removeSalesOrderFromJadwal(jadwalId, salesOrderId);
  revalidatePath("/delivery");
}

export async function updateJadwalUrutanAction(jadwalId: number, orderedDetailIds: number[]): Promise<void> {
  await updateJadwalUrutan(jadwalId, orderedDetailIds);
  revalidatePath("/delivery");
}

// Returns the JadwalID actually holding the data afterwards — may differ
// from the one passed in if the new time merged this Jadwal into another
// Draft (see updateJadwalDriverTime's own comment). Callers must check this
// before chaining any further action onto the original jadwalId.
export async function updateJadwalDriverTimeAction(
  jadwalId: number,
  input: { jamJadwal: Date; salesmanId: string | null },
  options?: { skipOrderTimeCheck?: boolean }
): Promise<number> {
  const resultId = await updateJadwalDriverTime(jadwalId, input, options);
  revalidatePath("/delivery");
  return resultId;
}

// Papan Pengiriman's drag-and-drop-between-armada-rows feature. Returns
// the JadwalID actually holding the data afterwards — may differ from the
// one passed in if the move merged into an existing Draft on the target
// armada (see updateJadwalArmada's own comment).
export async function updateJadwalArmadaAction(jadwalId: number, newArmadaId: number, jamJadwal?: Date): Promise<number> {
  const resultId = await updateJadwalArmada(jadwalId, newArmadaId, jamJadwal);
  revalidatePath("/delivery");
  return resultId;
}

// Returns an ISO string (not a Date) — kept as plain serializable data
// across the server action boundary, same reasoning as the other
// read-only actions below.
export async function getMaxSalesOrderTransDateForDeliveriesAction(deliveryOrderIds: string[]): Promise<string | null> {
  const date = await getMaxSalesOrderTransDateForDeliveries(deliveryOrderIds);
  return date ? date.toISOString() : null;
}

export async function mergeExternalDeliveriesAction(
  armadaId: number,
  deliveryOrderIds: string[],
  jamJadwal: Date
): Promise<number> {
  const id = await mergeExternalDeliveriesIntoJadwal(armadaId, deliveryOrderIds, jamJadwal);
  revalidatePath("/delivery");
  return id;
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

export async function getArmadaActivitiesAction(businessDate: string): Promise<ArmadaActivity[]> {
  return getArmadaActivities(businessDate);
}

export async function createArmadaActivityAction(input: {
  armadaId: number;
  activityType: ArmadaActivityType;
  startTime: Date;
  endTime: Date;
  notes: string | null;
}): Promise<number> {
  const session = await requireModuleAccess("delivery");
  const id = await createArmadaActivity({ ...input, createdByUserId: String(session.user.id) });
  revalidatePath("/delivery");
  return id;
}

export async function updateArmadaActivityAction(activityId: number, input: UpdateArmadaActivityInput): Promise<void> {
  await requireModuleAccess("delivery");
  await updateArmadaActivity(activityId, input);
  revalidatePath("/delivery");
}

export async function deleteArmadaActivityAction(activityId: number): Promise<void> {
  await requireModuleAccess("delivery");
  await deleteArmadaActivity(activityId);
  revalidatePath("/delivery");
}

export async function getDriverProfilesAction(): Promise<DriverProfileRow[]> {
  await requireModuleAccess("delivery");
  return getDriverProfiles();
}

export async function saveDriverProfileAction(input: SaveDriverProfileInput): Promise<void> {
  await requireModuleAccess("delivery");
  await saveDriverProfile(input);
  revalidatePath("/delivery");
}
