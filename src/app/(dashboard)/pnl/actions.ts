"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { setCOABudget } from "@/lib/queries/keuangan-detail";

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
