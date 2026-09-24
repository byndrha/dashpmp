// src/app/pmputra/piutang/actions.ts
"use server";

import { getPiutangPerAgen } from "@/lib/queries/penjualan-piutang";
import { requirePmputra } from "@/lib/require-access";

export async function getPiutangPerAgenAction(startDate: string, endDate: string) {
  await requirePmputra();
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  end.setDate(end.getDate() + 1); // inclusive of the end date itself
  return getPiutangPerAgen("pmputra", start, end);
}
