"use server";

import { revalidatePath } from "next/cache";
import { requirePmpakis } from "@/lib/require-access";
import { setCOABudgetPmpakis, setCostBehaviorPmpakis } from "@/lib/queries/keuangan-detail-pmpakis";
import {
  saveCashFlowDailyFiguresPmpakis,
  addCashFlowExpensePmpakis,
  deleteCashFlowExpensePmpakis,
} from "@/lib/queries/cash-flow-harian-pmpakis";
import { getHPPBersihPmpakis } from "@/lib/queries/hpp-bersih-pmpakis";
import type { HPPBersihData } from "@/lib/queries/hpp-bersih";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function saveCOABudgetPmpakisAction(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpakis();
    await setCOABudgetPmpakis({ ...input, userId: session.user.id });
    revalidatePath("/pmpakis/keuangan");
  });
}

export async function saveCashFlowDailyFiguresPmpakisAction(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpakis();
    await saveCashFlowDailyFiguresPmpakis({ ...input, userId: session.user.id });
    revalidatePath("/pmpakis/keuangan");
  });
}

export async function addCashFlowExpensePmpakisAction(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpakis();
    if (!input.deskripsi.trim() || !(input.nominal > 0)) throw new AppError("Data tidak valid");
    await addCashFlowExpensePmpakis({ ...input, userId: session.user.id });
    revalidatePath("/pmpakis/keuangan");
  });
}

export async function deleteCashFlowExpensePmpakisAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePmpakis();
    await deleteCashFlowExpensePmpakis(id);
    revalidatePath("/pmpakis/keuangan");
  });
}

export async function getHPPBersihPmpakisAction(year: number): Promise<ActionResult<HPPBersihData>> {
  return runAction(async () => {
    await requirePmpakis();
    return getHPPBersihPmpakis(year);
  });
}

export async function setCostBehaviorPmpakisAction(
  chartOfAccountId: string,
  costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePmpakis();
    await setCostBehaviorPmpakis(chartOfAccountId, costBehavior);
    revalidatePath("/pmpakis/keuangan");
  });
}
