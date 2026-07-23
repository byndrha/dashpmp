"use server";

import { revalidatePath } from "next/cache";
import { createArmada, updateArmada, deleteArmada, type ArmadaInput } from "@/lib/queries/armada";
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";
import {
  createJadwal,
  updateJadwalTime,
  startMuat,
  startBerangkat,
  getJadwalDetail,
  getUnassignedDeliveryOrders,
  type JadwalDetailRow,
  type UnassignedDO,
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

export async function assignDeliveryDriverAction(deliveryOrderId: string, salesmanId: string | null): Promise<void> {
  await assignDeliveryDriver(deliveryOrderId, salesmanId);
  revalidatePath("/delivery");
}

export async function assignDeliveryVehicleAction(deliveryOrderId: string, vehicleName: string | null): Promise<void> {
  await assignDeliveryVehicle(deliveryOrderId, vehicleName);
  revalidatePath("/delivery");
}

export async function createJadwalAction(input: {
  armadaId: number;
  salesmanId: string | null;
  jamJadwal: Date;
  deliveryOrderIds: string[];
}): Promise<number> {
  const id = await createJadwal(input);
  revalidatePath("/delivery");
  return id;
}

export async function updateJadwalTimeAction(jadwalId: number, jamJadwal: Date): Promise<void> {
  await updateJadwalTime(jadwalId, jamJadwal);
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
// when a dialog opens (fetching every Jadwal's detail / every date's
// unassigned DOs upfront in the page load would be wasteful).
export async function getJadwalDetailAction(jadwalId: number): Promise<JadwalDetailRow[]> {
  return getJadwalDetail(jadwalId);
}

export async function getUnassignedDeliveryOrdersAction(businessDate: string): Promise<UnassignedDO[]> {
  return getUnassignedDeliveryOrders(businessDate);
}
