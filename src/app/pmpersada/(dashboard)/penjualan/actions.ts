// src/app/pmpersada/(dashboard)/penjualan/actions.ts — server action modul Penjualan Es Balok (pmpersada).
"use server";

import { requirePmpersadaKeuangan } from "@/lib/require-access";
import { loadHariBalok, loadBulanBalok, loadTargetBalok, saveTargetBalok } from "@/lib/penjualan-es-balok-handlers";

const KODE = "pmpersada";

export async function loadHariAction(dateISO: string) {
  await requirePmpersadaKeuangan();
  return loadHariBalok(KODE, dateISO);
}

export async function loadBulanAction(monthISO: string) {
  await requirePmpersadaKeuangan();
  return loadBulanBalok(KODE, monthISO);
}

export async function loadTargetAction(monthISO: string) {
  await requirePmpersadaKeuangan();
  return loadTargetBalok(KODE, monthISO);
}

export async function saveTargetAction(input: { year: number; month: number; targetNominal: number; targetQty: number }) {
  await requirePmpersadaKeuangan();
  return saveTargetBalok(KODE, "/pmpersada/penjualan", input);
}
