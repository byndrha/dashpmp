// src/app/pmpersada/(dashboard)/piutang/actions.ts
"use server";

import { getPiutangPerAgen } from "@/lib/queries/penjualan-piutang";
import { getPiutangBayarContext, bayarPiutang, getPiutangTarikContext, tarikPiutang } from "@/lib/queries/piutang-pembayaran";
import { requirePmpersadaKeuangan } from "@/lib/require-access";

const KODE = "pmpersada";

export async function getPiutangPerAgenAction(startDate: string, endDate: string) {
  await requirePmpersadaKeuangan();
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  end.setDate(end.getDate() + 1); // inclusive of the end date itself
  return getPiutangPerAgen(KODE, start, end);
}

export async function getPiutangBayarContextAction(agenId: string) {
  await requirePmpersadaKeuangan();
  return getPiutangBayarContext(KODE, agenId);
}

export async function bayarPiutangAction(
  agenId: string,
  jumlah: number,
  kasBank: { utama?: string; logistik?: string },
  catatan: string | null
) {
  await requirePmpersadaKeuangan();
  return bayarPiutang(KODE, agenId, jumlah, kasBank, catatan);
}

export async function getPiutangTarikContextAction(agenId: string) {
  await requirePmpersadaKeuangan();
  return getPiutangTarikContext(KODE, agenId);
}

export async function tarikPiutangAction(
  agenId: string,
  jumlah: number,
  kasBank: { utama?: string; logistik?: string },
  catatan: string | null
) {
  await requirePmpersadaKeuangan();
  return tarikPiutang(KODE, agenId, jumlah, kasBank, catatan);
}
