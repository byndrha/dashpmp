"use server";

import { revalidatePath } from "next/cache";
import { requirePmpersada } from "@/lib/require-access";
import { setCOABudgetPmpersada, setCostBehaviorPmpersada } from "@/lib/queries/keuangan-detail-pmpersada";
import {
  saveCashFlowDailyFiguresPmpersada,
  addCashFlowExpensePmpersada,
  deleteCashFlowExpensePmpersada,
} from "@/lib/queries/cash-flow-harian-pmpersada";
import { getHPPBersihPmpersada } from "@/lib/queries/hpp-bersih-pmpersada";
import type { HPPBersihData } from "@/lib/queries/hpp-bersih";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function saveCOABudgetPmpersadaAction(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    await setCOABudgetPmpersada({ ...input, userId: session.user.id });
    revalidatePath("/pmpersada/keuangan");
  });
}

export async function saveCashFlowDailyFiguresPmpersadaAction(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    await saveCashFlowDailyFiguresPmpersada({ ...input, userId: session.user.id });
    revalidatePath("/pmpersada/keuangan");
  });
}

export async function addCashFlowExpensePmpersadaAction(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    if (!input.deskripsi.trim() || !(input.nominal > 0)) throw new AppError("Data tidak valid");
    await addCashFlowExpensePmpersada({ ...input, userId: session.user.id });
    revalidatePath("/pmpersada/keuangan");
  });
}

export async function deleteCashFlowExpensePmpersadaAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePmpersada();
    await deleteCashFlowExpensePmpersada(id);
    revalidatePath("/pmpersada/keuangan");
  });
}

export async function getHPPBersihPmpersadaAction(year: number): Promise<ActionResult<HPPBersihData>> {
  return runAction(async () => {
    await requirePmpersada();
    return getHPPBersihPmpersada(year);
  });
}

export async function setCostBehaviorPmpersadaAction(
  chartOfAccountId: string,
  costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePmpersada();
    await setCostBehaviorPmpersada(chartOfAccountId, costBehavior);
    revalidatePath("/pmpersada/keuangan");
  });
}
