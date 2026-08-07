"use server";

import { revalidatePath } from "next/cache";
import { requireDriver } from "@/lib/require-access";
import {
  getDriverJadwalList,
  getDriverJadwalStops,
  getStopOrderItems,
  recordStopArrival,
  confirmStopDelivery,
  type DriverJadwalCard,
  type DriverStopRow,
  type StopOrderItem,
  type ConfirmStopDeliveryInput,
} from "@/lib/queries/pengiriman-jadwal";
import { getDriverProfiles, type DriverProfileRow } from "@/lib/queries/driver-profile";
import { getOutstandingInvoicesForMitra, recordPayment, type RecordPaymentInput, type RecordPaymentResult } from "@/lib/queries/pelunasan";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

async function requireOwnSalesmanId(): Promise<string> {
  const session = await requireDriver();
  if (!session.user.salesmanId) {
    throw new AppError("Akun ini belum ditautkan ke data Driver, hubungi Admin.");
  }
  return session.user.salesmanId;
}

export async function getDriverJadwalListAction(dateISO: string): Promise<ActionResult<DriverJadwalCard[]>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    return getDriverJadwalList(salesmanId, dateISO);
  });
}

export async function getDriverJadwalStopsAction(jadwalId: number): Promise<ActionResult<DriverStopRow[]>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    return getDriverJadwalStops(jadwalId);
  });
}

export async function getStopOrderItemsAction(jadwalDetailId: number): Promise<ActionResult<StopOrderItem[]>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    return getStopOrderItems(jadwalDetailId);
  });
}

export async function recordStopArrivalAction(jadwalDetailId: number): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    const id = await recordStopArrival(jadwalDetailId);
    revalidatePath("/driver-app");
    return id;
  });
}

export async function confirmStopDeliveryAction(
  input: ConfirmStopDeliveryInput
): Promise<ActionResult<{ stopDeliveryId: number; salesInvoiceId: string | null }>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    const result = await confirmStopDelivery(input);
    revalidatePath("/driver-app");
    return result;
  });
}

export async function getOwnDriverProfileAction(): Promise<ActionResult<DriverProfileRow | null>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    const all = await getDriverProfiles();
    return all.find((d) => d.SalesmanID === salesmanId) ?? null;
  });
}

export async function recordDriverPaymentAction(input: RecordPaymentInput): Promise<ActionResult<RecordPaymentResult>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    return recordPayment(input);
  });
}

// Real current Outstanding for one invoice (post-retur-adjustment, since
// confirmStopDelivery already updated SalesInvoice.Netto by the time this
// is called from the Pembayaran screen) — reuses the same
// vCustomerStatement-backed query the dashboard's own Pelunasan dialog
// uses, just narrowed to one SalesInvoiceID instead of listing every
// outstanding invoice for the mitra.
export async function getInvoiceOutstandingAction(
  businessPartnerId: string,
  salesInvoiceId: string
): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    const invoices = await getOutstandingInvoicesForMitra(businessPartnerId);
    const invoice = invoices.find((i) => i.SalesInvoiceID === salesInvoiceId);
    if (!invoice) throw new AppError("Invoice ini sudah lunas atau tidak ditemukan.");
    return invoice.Outstanding;
  });
}
