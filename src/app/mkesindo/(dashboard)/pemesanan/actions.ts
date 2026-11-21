"use server";

import { revalidatePath } from "next/cache";
import {
  createPemesanan,
  reschedulePemesanan,
  deletePemesanan,
  updateSalesOrderTransDate,
  getSalesReturnDetail,
  type CreatePemesananInput,
  type CreatePemesananResult,
  type ReschedulePemesananInput,
  type SalesReturnDetail,
} from "@/lib/queries/pemesanan";
import {
  getCurrentAssignment,
  getArmadaKetersediaan,
  type CurrentAssignment,
  type ArmadaKetersediaan,
} from "@/lib/queries/pengiriman-jadwal";
import { getArmadaList } from "@/lib/queries/armada";
import { requireModuleAccess } from "@/lib/require-access";
import { createTakeAwayPemesanan, type CreateTakeAwayInput, type CreateTakeAwayResult } from "@/lib/queries/takeaway";
import {
  getEditableSalesOrderQty,
  updateSalesOrderDetailQty,
  type EditableSalesOrderQty,
  type KantongVariant,
} from "@/lib/queries/sales-order";
import { getMitraPiutangSummary, type MitraPiutangSummary } from "@/lib/queries/mitra-piutang";
import { runAction, type ActionResult } from "@/lib/action-result";

// Dropdown "Pilih armada" di Buat Pemesanan: status armada sekarang + isi
// keberangkatan (batch) yang bentrok dengan jam pengiriman yang dipilih.
// jamJadwalISO dihitung di browser (resolveBusinessDateTime, zona WIB) —
// sama dengan yang dikirim checkArmadaConflictAction — bukan dihitung ulang
// di server yang berzona UTC.
export async function getArmadaKetersediaanAction(
  jamJadwalISO: string,
  candidateQty: number,
  excludeSalesOrderId?: string
): Promise<ArmadaKetersediaan[]> {
  await requireModuleAccess("pemesanan");
  const jamJadwal = new Date(jamJadwalISO);
  if (Number.isNaN(jamJadwal.getTime())) return [];
  const qty = Number.isFinite(candidateQty) && candidateQty > 0 ? candidateQty : 0;
  const armadaIds = (await getArmadaList()).map((a) => a.ArmadaID);
  return getArmadaKetersediaan(armadaIds, jamJadwal, qty, excludeSalesOrderId ? [excludeSalesOrderId] : []);
}

// Powers the mitra-info card in the "Buat Pemesanan" dialog — fetched
// on-demand once an operator picks a mitra, not with the initial page load
// (this dialog's mitra list can be long, and most selections never need it).
export async function getMitraPiutangSummaryAction(businessPartnerId: string): Promise<MitraPiutangSummary> {
  return getMitraPiutangSummary(businessPartnerId);
}

export async function createPemesananAction(input: CreatePemesananInput): Promise<ActionResult<CreatePemesananResult>> {
  return runAction(async () => {
    const result = await createPemesanan(input);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}

export async function deletePemesananAction(salesOrderId: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await deletePemesanan(salesOrderId);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
  });
}

export async function createTakeAwayPemesananAction(input: CreateTakeAwayInput): Promise<ActionResult<CreateTakeAwayResult>> {
  return runAction(async () => {
    const result = await createTakeAwayPemesanan(input);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
    revalidatePath("/mkesindo/produksi-app");
    return result;
  });
}

export async function reschedulePemesananAction(input: ReschedulePemesananInput): Promise<ActionResult<{ jadwalId: number }>> {
  return runAction(async () => {
    const result = await reschedulePemesanan(input);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
    return result;
  });
}

// Read-only — no revalidatePath needed, fetched on demand when the "Ubah
// Pemesanan" dialog opens.
export async function getCurrentAssignmentAction(salesOrderId: string): Promise<CurrentAssignment | null> {
  return getCurrentAssignment(salesOrderId);
}

export async function updateSalesOrderTransDateAction(salesOrderId: string, transDate: Date): Promise<ActionResult<void>> {
  return runAction(async () => {
    await updateSalesOrderTransDate(salesOrderId, transDate);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
  });
}

// Read-only — no revalidatePath needed, fetched on demand when "Ubah
// Pemesanan" opens, same shape as getCurrentAssignmentAction above.
export async function getEditableSalesOrderQtyAction(salesOrderId: string): Promise<EditableSalesOrderQty> {
  return getEditableSalesOrderQty(salesOrderId);
}

export async function updateSalesOrderQtyAction(
  salesOrderId: string,
  variant: KantongVariant,
  newQty: number
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await updateSalesOrderDetailQty(salesOrderId, variant, newQty);
    revalidatePath("/mkesindo/pemesanan");
    revalidatePath("/mkesindo/delivery");
  });
}

// Read-only — no revalidatePath needed, fetched on demand when "Lihat SR"
// opens, same shape as getCurrentAssignmentAction above.
export async function getSalesReturnDetailAction(salesReturnId: string): Promise<SalesReturnDetail | null> {
  return getSalesReturnDetail(salesReturnId);
}
