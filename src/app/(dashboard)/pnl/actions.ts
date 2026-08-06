"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { setCOABudget } from "@/lib/queries/keuangan-detail";
import {
  saveCashFlowDailyFigures,
  addCashFlowExpense,
  deleteCashFlowExpense,
} from "@/lib/queries/cash-flow-harian";
import { getHPPBersih, type HPPBersihData } from "@/lib/queries/hpp-bersih";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function saveCOABudgetAction(input: {
  chartOfAccountId: string;
  year: number;
  month: number;
  amount: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await setCOABudget({ ...input, userId });
    revalidatePath("/pnl");
  });
}

export async function saveCashFlowDailyFiguresAction(input: {
  businessDate: string;
  kasDiTangan: number;
  pengeluaranKasDiTangan: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await saveCashFlowDailyFigures({ ...input, userId });
    revalidatePath("/pnl");
  });
}

export async function addCashFlowExpenseAction(input: {
  businessDate: string;
  deskripsi: string;
  nominal: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");
    if (!input.deskripsi.trim() || !(input.nominal > 0)) throw new AppError("Data tidak valid");

    await addCashFlowExpense({ ...input, userId });
    revalidatePath("/pnl");
  });
}

export async function deleteCashFlowExpenseAction(id: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    await deleteCashFlowExpense(id);
    revalidatePath("/pnl");
  });
}

// Read-only — just refetches a different year's worth of already-visible
// page data, so an isAuthenticated check is enough (no role-gate, same as
// the rest of /pnl which is already gated by requireModuleAccess).
export async function getHPPBersihAction(year: number): Promise<ActionResult<HPPBersihData>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    return getHPPBersih(year);
  });
}
