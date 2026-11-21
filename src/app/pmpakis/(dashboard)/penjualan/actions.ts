// src/app/pmpakis/(dashboard)/penjualan/actions.ts — server action modul Penjualan Es Balok (pmpakis).
"use server";

import { requirePmpakisKeuangan } from "@/lib/require-access";
import { loadHariBalok, loadBulanBalok, loadTargetBalok, saveTargetBalok } from "@/lib/penjualan-es-balok-handlers";

const KODE = "pmpakis";

export async function loadHariAction(dateISO: string) {
  await requirePmpakisKeuangan();
  return loadHariBalok(KODE, dateISO);
}

export async function loadBulanAction(monthISO: string) {
  await requirePmpakisKeuangan();
  return loadBulanBalok(KODE, monthISO);
}

export async function loadTargetAction(monthISO: string) {
  await requirePmpakisKeuangan();
  return loadTargetBalok(KODE, monthISO);
}

export async function saveTargetAction(input: { year: number; month: number; targetNominal: number; targetQty: number }) {
  await requirePmpakisKeuangan();
  return saveTargetBalok(KODE, "/pmpakis/penjualan", input);
}
