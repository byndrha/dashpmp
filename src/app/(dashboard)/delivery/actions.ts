"use server";

import { revalidatePath } from "next/cache";
import { createArmada, updateArmada, deleteArmada } from "@/lib/queries/armada";
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";

export async function createArmadaAction(nama: string): Promise<number> {
  const id = await createArmada(nama);
  revalidatePath("/delivery");
  return id;
}

export async function updateArmadaAction(id: number, nama: string): Promise<void> {
  await updateArmada(id, nama);
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
