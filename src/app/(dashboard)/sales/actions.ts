"use server";

import { getDeliveryCardsForOrders, type DeliveryCard } from "@/lib/queries/sales-cards";

export async function getDeliveryCardsAction(salesOrderIds: string[]): Promise<DeliveryCard[]> {
  return getDeliveryCardsForOrders(salesOrderIds);
}
