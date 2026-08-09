"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { setMonthlyTarget } from "@/lib/queries/revenue-target";
import { getSalesForDay, type SalesToday } from "@/lib/queries/sales-overview";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getSalesForDayAction(dateISO: string): Promise<SalesToday> {
  return getSalesForDay(new Date(dateISO));
}

export async function saveMonthlyTargetAction(input: {
  year: number;
  month: number;
  targetNominal: number;
  targetQty: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await setMonthlyTarget({ ...input, userId });
    revalidatePath("/mkesindo/sales");
  });
}
