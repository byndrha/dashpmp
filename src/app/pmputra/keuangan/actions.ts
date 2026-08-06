"use server";

import { revalidatePath } from "next/cache";
import { requirePmputra } from "@/lib/require-access";
import { setCOABudgetPmputra, setCostBehaviorPmputra } from "@/lib/queries/keuangan-detail-pmputra";
import {
  saveCashFlowDailyFiguresPmputra,
  addCashFlowExpensePmputra,
  deleteCashFlowExpensePmputra,
} from "@/lib/queries/cash-flow-harian-pmputra";
import { getHPPBersihPmputra } from "@/lib/queries/hpp-bersih-pmputra";
import type { HPPBersihData } from "@/lib/queries/hpp-bersih";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function saveCOABudgetPmputraAction(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmputra();
    await setCOABudgetPmputra({ ...input, userId: session.user.id });
    revalidatePath("/pmputra/keuangan");
  });
}

export async function saveCashFlowDailyFiguresPmputraAction(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmputra();
    await saveCashFlowDailyFiguresPmputra({ ...input, userId: session.user.id });
    revalidatePath("/pmputra/keuangan");
  });
}

export async function addCashFlowExpensePmputraAction(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmputra();
    if (!input.deskripsi.trim() || !(input.nominal > 0)) throw new AppError("Data tidak valid");
    await addCashFlowExpensePmputra({ ...input, userId: session.user.id });
    revalidatePath("/pmputra/keuangan");
  });
}

export async function deleteCashFlowExpensePmputraAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePmputra();
    await deleteCashFlowExpensePmputra(id);
    revalidatePath("/pmputra/keuangan");
  });
}

// Read-only refetch (year navigation) — but this app is multi-tenant
// (accountScope mkesindo/direktur/pmputra), unlike MKEsindo's own
// getHPPBersihAction which lives in a single-tenant context. requirePmputra()
// enforces the PT Prima Maesa Putra company boundary, matching every other
// action in this file.
export async function getHPPBersihPmputraAction(year: number): Promise<ActionResult<HPPBersihData>> {
  return runAction(async () => {
    await requirePmputra();
    return getHPPBersihPmputra(year);
  });
}

export async function setCostBehaviorPmputraAction(
  chartOfAccountId: string,
  costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requirePmputra();
    await setCostBehaviorPmputra(chartOfAccountId, costBehavior);
    revalidatePath("/pmputra/keuangan");
  });
}
