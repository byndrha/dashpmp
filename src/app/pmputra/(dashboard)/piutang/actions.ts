// src/app/pmputra/piutang/actions.ts
"use server";

import { getPiutangPerAgen } from "@/lib/queries/penjualan-piutang";
import { getPiutangBayarContext, bayarPiutang, getPiutangTarikContext, tarikPiutang } from "@/lib/queries/piutang-pembayaran";
import {
  getEsBalokInvoiceOutstanding,
  getEsBalokPiutangPeriodSummary,
  getEsBalokStatusOverview,
  getKomponenSelisihPiutang,
  type KomponenSelisih,
  type EsBalokInvoiceRow,
  type EsBalokPeriodSummary,
  type EsBalokStatusBucket,
} from "@/lib/queries/piutang-invoice-outstanding";
import { getEsBalokCollectionPriority, getEsBalokPembayaranByDate, type EsBalokPriorityRow, type EsBalokPembayaranRow } from "@/lib/queries/piutang-priority-es-balok";
import { setEsBalokCollectionTarget, removeEsBalokCollectionTarget } from "@/lib/queries/piutang-target-es-balok";
import { getUmurPiutangBersih, type UmurPiutangBersih } from "@/lib/queries/umur-piutang-bersih";
import { rentangQueryPiutang } from "@/lib/piutang-es-balok-periode";
import { requirePmputraKeuangan } from "@/lib/require-access";
import { ringkasPiutangTerbuka, type RingkasanPiutangTerbuka } from "@/lib/piutang-es-balok-status";

// Batas tanggal: rentangQueryPiutang (lib/piutang-es-balok-periode.ts) — dipakai juga
// oleh render server halaman, jadi angka awal = angka setelah "Terapkan".
const KODE = "pmputra";

export async function getPiutangPerAgenAction(startDate: string, endDate: string) {
  await requirePmputraKeuangan();
  const { start, end } = rentangQueryPiutang(startDate, endDate);
  return getPiutangPerAgen(KODE, start, end);
}

export async function getPiutangBayarContextAction(agenId: string) {
  await requirePmputraKeuangan();
  return getPiutangBayarContext(KODE, agenId);
}

export async function bayarPiutangAction(
  agenId: string,
  jumlah: number,
  kasBank: { utama?: string; logistik?: string },
  catatan: string | null
) {
  await requirePmputraKeuangan();
  return bayarPiutang(KODE, agenId, jumlah, kasBank, catatan);
}

export async function getPiutangTarikContextAction(agenId: string) {
  await requirePmputraKeuangan();
  return getPiutangTarikContext(KODE, agenId);
}

export async function tarikPiutangAction(
  agenId: string,
  jumlah: number,
  kasBank: { utama?: string; logistik?: string },
  catatan: string | null
) {
  await requirePmputraKeuangan();
  return tarikPiutang(KODE, agenId, jumlah, kasBank, catatan);
}

export async function getEsBalokInvoiceOutstandingAction(): Promise<EsBalokInvoiceRow[]> {
  await requirePmputraKeuangan();
  return getEsBalokInvoiceOutstanding(KODE);
}

// Versi ringkas untuk kartu per Agen (status Sehat/Perhatian/Kritis + umur
// per pesanan) — hanya angka per Agen/dokumen, bukan ribuan baris mentah.
export async function getRingkasanPiutangTerbukaAction(): Promise<RingkasanPiutangTerbuka> {
  await requirePmputraKeuangan();
  return ringkasPiutangTerbuka(await getEsBalokInvoiceOutstanding(KODE));
}

export async function getEsBalokPeriodSummaryAction(startDate: string, endDate: string): Promise<EsBalokPeriodSummary> {
  await requirePmputraKeuangan();
  const { start, end } = rentangQueryPiutang(startDate, endDate);
  const invoiceRows = await getEsBalokInvoiceOutstanding(KODE);
  return getEsBalokPiutangPeriodSummary(KODE, start, end, invoiceRows);
}

export async function getEsBalokStatusOverviewAction(): Promise<EsBalokStatusBucket[]> {
  await requirePmputraKeuangan();
  const invoiceRows = await getEsBalokInvoiceOutstanding(KODE);
  return getEsBalokStatusOverview(invoiceRows);
}

export async function getEsBalokCollectionPriorityAction(): Promise<EsBalokPriorityRow[]> {
  await requirePmputraKeuangan();
  const invoiceRows = await getEsBalokInvoiceOutstanding(KODE);
  return getEsBalokCollectionPriority(KODE, invoiceRows);
}

export async function setEsBalokCollectionTargetAction(
  agenId: string,
  input: { targetDate: string | null; targetAmount: number | null; note: string | null }
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await requirePmputraKeuangan();
  try {
    await setEsBalokCollectionTarget(KODE, agenId, input, String(session.user.id));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Gagal menyimpan target pelunasan" };
  }
}

export async function removeEsBalokCollectionTargetAction(agenId: string): Promise<{ success: true } | { success: false; error: string }> {
  await requirePmputraKeuangan();
  try {
    await removeEsBalokCollectionTarget(KODE, agenId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Gagal menghapus target pelunasan" };
  }
}

export async function getEsBalokPembayaranByDateAction(dateISO: string): Promise<EsBalokPembayaranRow[]> {
  await requirePmputraKeuangan();
  const date = new Date(`${dateISO}T00:00:00`);
  const invoiceRows = await getEsBalokInvoiceOutstanding(KODE);
  return getEsBalokPembayaranByDate(KODE, date, invoiceRows);
}

// Asal selisih antara Sisa Hutang kartu (sampai tanggal akhir) dan total
// pesanan belum lunas (FIFO) untuk satu Agen — dimuat saat diminta di kartu.
export async function getKomponenSelisihAction(agenId: string, endDate: string): Promise<KomponenSelisih[]> {
  await requirePmputraKeuangan();
  const { end } = rentangQueryPiutang(endDate, endDate);
  return getKomponenSelisihPiutang(KODE, agenId, end);
}

// Umur piutang atas dasar saldo bersih per Agen — menjumlah tepat ke Total
// Piutang (lihat umur-piutang-bersih.ts). Pengganti status/umur FIFO di
// panel ringkasan.
export async function getUmurPiutangBersihAction(): Promise<UmurPiutangBersih> {
  await requirePmputraKeuangan();
  return getUmurPiutangBersih(KODE);
}
