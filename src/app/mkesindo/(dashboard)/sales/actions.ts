"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getRevenueTargetForMonth, setMonthlyTarget, type RevenueTarget } from "@/lib/queries/revenue-target";
import {
  getSalesForDay,
  getSalesComparisonForMonth,
  type SalesToday,
  type SalesAverages,
  type SalesComparison,
} from "@/lib/queries/sales-overview";
import { getBusinessDate } from "@/lib/business-date";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getSalesForDayAction(dateISO: string): Promise<SalesToday> {
  return getSalesForDay(new Date(dateISO));
}

// Powers the "Bulan Ini" panel's prev/next month navigation — `monthISO` is
// "YYYY-MM-01" (always the 1st, per the panel's own month-only navigation).
export async function getSalesComparisonForMonthAction(
  monthISO: string
): Promise<{ comparisons: SalesComparison[]; averages: SalesAverages; isCurrentMonth: boolean }> {
  return getSalesComparisonForMonth(new Date(monthISO), getBusinessDate());
}

// Powers the "Target Revenue vs Realisasi" panel's prev/next month navigation.
export async function getRevenueTargetForMonthAction(monthISO: string): Promise<RevenueTarget> {
  const monthStart = new Date(monthISO);
  return getRevenueTargetForMonth(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1);
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
