"use server";

import { auth } from "@/lib/auth";
import { getDeliveryCardsForOrders, type DeliveryCard } from "@/lib/queries/sales-cards";
import {
  getMitraContactLogForDate,
  saveMitraContactLog,
  type ContactType,
  type MitraContactLogEntry,
} from "@/lib/queries/mitra-contact-log";
import { AppError } from "@/lib/action-result";

export async function getDeliveryCardsAction(salesOrderIds: string[]): Promise<DeliveryCard[]> {
  return getDeliveryCardsForOrders(salesOrderIds);
}

export async function getMitraContactLogAction(
  businessPartnerId: string,
  dateISO: string
): Promise<MitraContactLogEntry[]> {
  const session = await auth();
  if (!session?.user?.id) throw new AppError("Unauthorized");

  return getMitraContactLogForDate(businessPartnerId, dateISO);
}

export async function saveMitraContactLogAction(input: {
  businessPartnerId: string;
  dateISO: string;
  contactType: ContactType;
  hasilPenawaran: string | null;
  angkaPemesanan: number | null;
  alasanTidakSesuai: string | null;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AppError("Unauthorized");

  await saveMitraContactLog({ ...input, userId });
}
