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
  selesaiMuat,
  konfirmasiBerangkat,
  getJadwalDetail,
  getAvailableSalesOrders,
  mergeExternalDeliveriesIntoJadwal,
  getMaxSalesOrderTransDateForDeliveries,
  checkArmadaConflict,
  type JadwalDetailRow,
  type AvailableSalesOrder,
  type ArmadaConflictInfo,
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
import {
  getDriverProfiles,
  saveDriverProfile,
  deleteDriverProfile,
  type DriverProfileRow,
  type SaveDriverProfileInput,
} from "@/lib/queries/driver-profile";
import {
  getVehicleChecksForJadwal,
  createVehicleCheck,
  type VehicleCheckRow,
  type VehicleCheckTipe,
  type FuelBar,
  type VehicleCheckPhoto,
} from "@/lib/queries/vehicle-check";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function createArmadaAction(input: ArmadaInput): Promise<ActionResult<number>> {
  return runAction(async () => {
    const id = await createArmada(input);
    revalidatePath("/mkesindo/delivery");
    return id;
  });
}

export async function updateArmadaAction(id: number, input: ArmadaInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await updateArmada(id, input);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function deleteArmadaAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await deleteArmada(id);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function createJadwalDraftAction(input: {
  armadaId: number;
  jamJadwal: Date;
  salesOrderIds: string[];
}): Promise<ActionResult<number>> {
  return runAction(async () => {
    const id = await createJadwalDraft(input);
    revalidatePath("/mkesindo/delivery");
    return id;
  });
}

export async function deleteJadwalDraftAction(jadwalId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await deleteJadwalDraft(jadwalId);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function addSalesOrdersToJadwalAction(jadwalId: number, salesOrderIds: string[]): Promise<ActionResult<void>> {
  return runAction(async () => {
    await addSalesOrdersToJadwal(jadwalId, salesOrderIds);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function removeSalesOrderFromJadwalAction(jadwalId: number, salesOrderId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await removeSalesOrderFromJadwal(jadwalId, salesOrderId);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function updateJadwalUrutanAction(jadwalId: number, orderedDetailIds: number[]): Promise<ActionResult<void>> {
  return runAction(async () => {
    await updateJadwalUrutan(jadwalId, orderedDetailIds);
    revalidatePath("/mkesindo/delivery");
  });
}

// Returns the JadwalID actually holding the data afterwards — may differ
// from the one passed in if the new time merged this Jadwal into another
// Draft (see updateJadwalDriverTime's own comment). Callers must check this
// before chaining any further action onto the original jadwalId.
export async function updateJadwalDriverTimeAction(
  jadwalId: number,
  input: { jamJadwal: Date; salesmanId: string | null },
  options?: { skipOrderTimeCheck?: boolean }
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const resultId = await updateJadwalDriverTime(jadwalId, input, options);
    revalidatePath("/mkesindo/delivery");
    return resultId;
  });
}

// Papan Pengiriman's drag-and-drop-between-armada-rows feature. Returns
// the JadwalID actually holding the data afterwards — may differ from the
// one passed in if the move merged into an existing Draft on the target
// armada (see updateJadwalArmada's own comment).
export async function updateJadwalArmadaAction(jadwalId: number, newArmadaId: number, jamJadwal?: Date): Promise<ActionResult<number>> {
  return runAction(async () => {
    const resultId = await updateJadwalArmada(jadwalId, newArmadaId, jamJadwal);
    revalidatePath("/mkesindo/delivery");
    return resultId;
  });
}

// Returns an ISO string (not a Date) — kept as plain serializable data
// across the server action boundary, same reasoning as the other
// read-only actions below.
export async function getMaxSalesOrderTransDateForDeliveriesAction(deliveryOrderIds: string[]): Promise<string | null> {
  const date = await getMaxSalesOrderTransDateForDeliveries(deliveryOrderIds);
  return date ? date.toISOString() : null;
}

export async function checkArmadaConflictAction(
  armadaId: number,
  candidateStart: Date,
  candidateQty: number,
  excludeJadwalId: number | null
): Promise<ArmadaConflictInfo | null> {
  return checkArmadaConflict(armadaId, candidateStart, candidateQty, excludeJadwalId);
}

export async function mergeExternalDeliveriesAction(
  armadaId: number,
  deliveryOrderIds: string[],
  jamJadwal: Date
): Promise<ActionResult<number>> {
  return runAction(async () => {
    const id = await mergeExternalDeliveriesIntoJadwal(armadaId, deliveryOrderIds, jamJadwal);
    revalidatePath("/mkesindo/delivery");
    return id;
  });
}

export async function startMuatAction(jadwalId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await startMuat(jadwalId);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function selesaiMuatAction(jadwalId: number): Promise<ActionResult<{ jadwalDetailId: number; invoiceToken: string }[]>> {
  return runAction(async () => {
    const result = await selesaiMuat(jadwalId);
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}

export async function konfirmasiBerangkatAction(jadwalId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await konfirmasiBerangkat(jadwalId);
    revalidatePath("/mkesindo/delivery");
  });
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
}): Promise<ActionResult<number>> {
  return runAction(async () => {
    const session = await requireModuleAccess("delivery");
    const id = await createArmadaActivity({ ...input, createdByUserId: String(session.user.id) });
    revalidatePath("/mkesindo/delivery");
    return id;
  });
}

export async function updateArmadaActivityAction(activityId: number, input: UpdateArmadaActivityInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    await updateArmadaActivity(activityId, input);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function deleteArmadaActivityAction(activityId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireModuleAccess("delivery");
    await deleteArmadaActivity(activityId);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function getDriverProfilesAction(): Promise<DriverProfileRow[]> {
  await requireModuleAccess("delivery");
  return getDriverProfiles();
}

export async function saveDriverProfileAction(input: SaveDriverProfileInput): Promise<ActionResult<void>> {
  await requireModuleAccess("delivery");
  return runAction(async () => {
    await saveDriverProfile(input);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function deleteDriverProfileAction(salesmanId: string): Promise<ActionResult<void>> {
  await requireModuleAccess("delivery");
  return runAction(async () => {
    await deleteDriverProfile(salesmanId);
    revalidatePath("/mkesindo/delivery");
  });
}

export async function getVehicleChecksForJadwalAction(jadwalId: number): Promise<VehicleCheckRow[]> {
  await requireModuleAccess("delivery");
  return getVehicleChecksForJadwal(jadwalId);
}

export async function createVehicleCheckAction(input: {
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelBar: FuelBar;
  muatanQty: number;
  photos: VehicleCheckPhoto[];
}): Promise<ActionResult<void>> {
  const session = await requireModuleAccess("delivery");
  return runAction(async () => {
    // Deliberately NOT bypassed by isSuperAdmin — see the design spec's "Deliberately
    // not bypassed by isSuperAdmin" note. A gate-check record is a physical-presence
    // claim, not a general permission.
    if (!session.user.isSatpam) {
      throw new AppError("Hanya Satpam yang dapat mengisi Cek Berangkat/Cek Datang.");
    }
    if (input.photos.length !== 6) {
      throw new AppError("Semua 6 foto kendaraan wajib diisi.");
    }
    if (!(input.odometerKM > 0)) {
      throw new AppError("Odometer wajib diisi dengan angka yang valid.");
    }
    if (!(Number.isInteger(input.fuelBar) && input.fuelBar >= 0 && input.fuelBar <= 4)) {
      throw new AppError("Fuel Meter wajib diisi.");
    }
    if (!(input.muatanQty >= 0)) {
      throw new AppError("Jumlah muatan wajib diisi dengan angka 0 atau lebih.");
    }
    await createVehicleCheck({ ...input, userId: session.user.id });
    revalidatePath("/mkesindo/delivery");
  });
}
