// src/app/pmputra/piutang/actions.ts
"use server";

import { getPiutangPerAgen } from "@/lib/queries/penjualan-piutang";
import { getPiutangBayarContext, bayarPiutang } from "@/lib/queries/piutang-pembayaran";
import { requirePmputra } from "@/lib/require-access";

const KODE = "pmputra";

export async function getPiutangPerAgenAction(startDate: string, endDate: string) {
  await requirePmputra();
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  end.setDate(end.getDate() + 1); // inclusive of the end date itself
  return getPiutangPerAgen(KODE, start, end);
}

export async function getPiutangBayarContextAction(agenId: string) {
  await requirePmputra();
  return getPiutangBayarContext(KODE, agenId);
}

export async function bayarPiutangAction(
  agenId: string,
  jumlah: number,
  kasBank: { utama?: string; logistik?: string },
  catatan: string | null
) {
  await requirePmputra();
  return bayarPiutang(KODE, agenId, jumlah, kasBank, catatan);
}
