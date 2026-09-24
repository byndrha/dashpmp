// src/app/pmpersada/(dashboard)/piutang/actions.ts
"use server";

import { getPiutangPerAgen } from "@/lib/queries/penjualan-piutang";
import { requirePmpersadaKeuangan } from "@/lib/require-access";

export async function getPiutangPerAgenAction(startDate: string, endDate: string) {
  await requirePmpersadaKeuangan();
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  end.setDate(end.getDate() + 1); // inclusive of the end date itself
  return getPiutangPerAgen("pmpersada", start, end);
}
