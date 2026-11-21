// src/app/pmputra/penjualan/actions.ts — server action modul Penjualan Es Balok (pmputra).
"use server";

import { requirePmputra } from "@/lib/require-access";
import { loadHariBalok, loadBulanBalok, loadTargetBalok, saveTargetBalok } from "@/lib/penjualan-es-balok-handlers";

const KODE = "pmputra";

export async function loadHariAction(dateISO: string) {
  await requirePmputra();
  return loadHariBalok(KODE, dateISO);
}

export async function loadBulanAction(monthISO: string) {
  await requirePmputra();
  return loadBulanBalok(KODE, monthISO);
}

export async function loadTargetAction(monthISO: string) {
  await requirePmputra();
  return loadTargetBalok(KODE, monthISO);
}

export async function saveTargetAction(input: { year: number; month: number; targetNominal: number; targetQty: number }) {
  await requirePmputra();
  return saveTargetBalok(KODE, "/pmputra/penjualan", input);
}
