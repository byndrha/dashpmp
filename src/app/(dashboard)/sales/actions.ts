"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { setMonthlyTarget } from "@/lib/queries/revenue-target";
import { getSalesForDay, type SalesToday } from "@/lib/queries/sales-overview";

export async function getSalesForDayAction(dateISO: string): Promise<SalesToday> {
  return getSalesForDay(new Date(dateISO));
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
