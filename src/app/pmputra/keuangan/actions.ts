"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requirePmputra } from "@/lib/require-access";
import { setCOABudgetPmputra, setCostBehaviorPmputra } from "@/lib/queries/keuangan-detail-pmputra";
import {
  saveCashFlowDailyFiguresPmputra,
  addCashFlowExpensePmputra,
  deleteCashFlowExpensePmputra,
} from "@/lib/queries/cash-flow-harian-pmputra";
import { getHPPBersihPmputra } from "@/lib/queries/hpp-bersih-pmputra";

export async function saveCOABudgetPmputraAction(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
}) {
  const session = await requirePmputra();
  await setCOABudgetPmputra({ ...input, userId: session.user.id });
  revalidatePath("/pmputra/keuangan");
}

export async function saveCashFlowDailyFiguresPmputraAction(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
}) {
  const session = await requirePmputra();
  await saveCashFlowDailyFiguresPmputra({ ...input, userId: session.user.id });
  revalidatePath("/pmputra/keuangan");
}

export async function addCashFlowExpensePmputraAction(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
}) {
  const session = await requirePmputra();
  if (!input.deskripsi.trim() || !(input.nominal > 0)) throw new Error("Data tidak valid");
  await addCashFlowExpensePmputra({ ...input, userId: session.user.id });
  revalidatePath("/pmputra/keuangan");
}

export async function deleteCashFlowExpensePmputraAction(id: number) {
  await requirePmputra();
  await deleteCashFlowExpensePmputra(id);
  revalidatePath("/pmputra/keuangan");
}

// Read-only refetch (year navigation) — auth() alone is enough, same
// reasoning as MKEsindo's getHPPBersihAction.
export async function getHPPBersihPmputraAction(year: number) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return getHPPBersihPmputra(year);
}

export async function setCostBehaviorPmputraAction(
  chartOfAccountId: string,
  costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null
) {
  await requirePmputra();
  await setCostBehaviorPmputra(chartOfAccountId, costBehavior);
  revalidatePath("/pmputra/keuangan");
}
