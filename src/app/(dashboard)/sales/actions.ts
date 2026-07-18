"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getDeliveryCardsForOrders, type DeliveryCard } from "@/lib/queries/sales-cards";
import { setMonthlyTarget } from "@/lib/queries/revenue-target";

export async function getDeliveryCardsAction(salesOrderIds: string[]): Promise<DeliveryCard[]> {
  return getDeliveryCardsForOrders(salesOrderIds);
}

export async function saveMonthlyTargetAction(input: {
  year: number;
  month: number;
  targetNominal: number;
  targetQty: number;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await setMonthlyTarget({ ...input, userId });
  revalidatePath("/sales");
}
