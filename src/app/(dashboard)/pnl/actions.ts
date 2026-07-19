"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { setCOABudget } from "@/lib/queries/keuangan-detail";
import {
  saveCashFlowDailyFigures,
  addCashFlowExpense,
  deleteCashFlowExpense,
} from "@/lib/queries/cash-flow-harian";

export async function saveCOABudgetAction(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await setCOABudget({ ...input, userId });
  revalidatePath("/pnl");
}

export async function saveCashFlowDailyFiguresAction(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");

  await saveCashFlowDailyFigures({ ...input, userId });
  revalidatePath("/pnl");
}

export async function addCashFlowExpenseAction(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");
  if (!input.deskripsi.trim() || !(input.nominal > 0)) throw new Error("Data tidak valid");

  await addCashFlowExpense({ ...input, userId });
  revalidatePath("/pnl");
}

export async function deleteCashFlowExpenseAction(id: number) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await deleteCashFlowExpense(id);
  revalidatePath("/pnl");
}
