// src/app/pmputra/piutang/actions.ts
"use server";

import { getPiutangPerAgen } from "@/lib/queries/penjualan-piutang";
import { getPiutangBayarContext, bayarPiutang, getPiutangTarikContext, tarikPiutang } from "@/lib/queries/piutang-pembayaran";
import {
  getEsBalokInvoiceOutstanding,
  getEsBalokPiutangPeriodSummary,
  getEsBalokStatusOverview,
  type EsBalokInvoiceRow,
  type EsBalokPeriodSummary,
  type EsBalokStatusBucket,
} from "@/lib/queries/piutang-invoice-outstanding";
import { getEsBalokCollectionPriority, getEsBalokPembayaranByDate, type EsBalokPriorityRow, type EsBalokPembayaranRow } from "@/lib/queries/piutang-priority-es-balok";
import { setEsBalokCollectionTarget, removeEsBalokCollectionTarget } from "@/lib/queries/piutang-target-es-balok";
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

export async function getPiutangTarikContextAction(agenId: string) {
  await requirePmputra();
  return getPiutangTarikContext(KODE, agenId);
}

export async function tarikPiutangAction(
  agenId: string,
  jumlah: number,
  kasBank: { utama?: string; logistik?: string },
  catatan: string | null
) {
  await requirePmputra();
  return tarikPiutang(KODE, agenId, jumlah, kasBank, catatan);
}

export async function getEsBalokInvoiceOutstandingAction(): Promise<EsBalokInvoiceRow[]> {
  await requirePmputra();
  return getEsBalokInvoiceOutstanding(KODE);
}

export async function getEsBalokPeriodSummaryAction(startDate: string, endDate: string): Promise<EsBalokPeriodSummary> {
  await requirePmputra();
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  end.setDate(end.getDate() + 1); // inclusive of the end date itself
  const invoiceRows = await getEsBalokInvoiceOutstanding(KODE);
  return getEsBalokPiutangPeriodSummary(KODE, start, end, invoiceRows);
}

export async function getEsBalokStatusOverviewAction(): Promise<EsBalokStatusBucket[]> {
  await requirePmputra();
  const invoiceRows = await getEsBalokInvoiceOutstanding(KODE);
  return getEsBalokStatusOverview(invoiceRows);
}

export async function getEsBalokCollectionPriorityAction(): Promise<EsBalokPriorityRow[]> {
  await requirePmputra();
  const invoiceRows = await getEsBalokInvoiceOutstanding(KODE);
  return getEsBalokCollectionPriority(KODE, invoiceRows);
}

export async function setEsBalokCollectionTargetAction(
  agenId: string,
  input: { targetDate: string | null; targetAmount: number | null; note: string | null }
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await requirePmputra();
  try {
    await setEsBalokCollectionTarget(KODE, agenId, input, String(session.user.id));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Gagal menyimpan target pelunasan" };
  }
}

export async function removeEsBalokCollectionTargetAction(agenId: string): Promise<{ success: true } | { success: false; error: string }> {
  await requirePmputra();
  try {
    await removeEsBalokCollectionTarget(KODE, agenId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Gagal menghapus target pelunasan" };
  }
}

export async function getEsBalokPembayaranByDateAction(dateISO: string): Promise<EsBalokPembayaranRow[]> {
  await requirePmputra();
  const date = new Date(`${dateISO}T00:00:00`);
  const invoiceRows = await getEsBalokInvoiceOutstanding(KODE);
  return getEsBalokPembayaranByDate(KODE, date, invoiceRows);
}
