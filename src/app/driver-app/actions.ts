"use server";

import { revalidatePath } from "next/cache";
import { requireDriver } from "@/lib/require-access";
import {
  getDriverJadwalList,
  getDriverJadwalStops,
  getDriverJadwalHistory,
  getStopOrderItems,
  recordStopArrival,
  confirmStopDelivery,
  assertOwnsJadwal,
  assertOwnsJadwalDetail,
  type DriverJadwalCard,
  type DriverStopRow,
  type StopOrderItem,
  type ConfirmStopDeliveryInput,
} from "@/lib/queries/pengiriman-jadwal";
import {
  getOutstandingInvoicesForMitra,
  recordPayment,
  getInvoiceSalesmanId,
  type RecordPaymentInput,
  type RecordPaymentResult,
} from "@/lib/queries/pelunasan";
import { getDriverProfiles, type DriverProfileRow } from "@/lib/queries/driver-profile";
import { getPabrikLocation, type PabrikLocation } from "@/lib/queries/pabrik-location";
import { recordFuelLog } from "@/lib/queries/driver-fuel";
import { recordKendala } from "@/lib/queries/driver-kendala";
import type { JenisKendala } from "@/lib/kendala-options";
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
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwal(jadwalId, salesmanId);
    return getDriverJadwalStops(jadwalId);
  });
}

export async function getStopOrderItemsAction(jadwalDetailId: number): Promise<ActionResult<StopOrderItem[]>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwalDetail(jadwalDetailId, salesmanId);
    return getStopOrderItems(jadwalDetailId);
  });
}

export async function recordStopArrivalAction(jadwalDetailId: number): Promise<ActionResult<number>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwalDetail(jadwalDetailId, salesmanId);
    const id = await recordStopArrival(jadwalDetailId);
    revalidatePath("/driver-app");
    return id;
  });
}

export async function confirmStopDeliveryAction(
  input: ConfirmStopDeliveryInput
): Promise<ActionResult<{ stopDeliveryId: number; salesInvoiceId: string | null }>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwalDetail(input.jadwalDetailId, salesmanId);
    const result = await confirmStopDelivery(input);
    revalidatePath("/driver-app");
    return result;
  });
}

export async function recordDriverPaymentAction(input: RecordPaymentInput): Promise<ActionResult<RecordPaymentResult>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    // Real current outstanding for every invoice of this mitra, fetched
    // once and reused for every allocation below — the Tunai flow is
    // "pay this invoice in full", so the submitted amount must match the
    // server-computed Outstanding exactly (within rounding tolerance).
    // This closes an under-reporting gap: without it, a caller bypassing
    // the Pembayaran UI (direct action call, modified client) could submit
    // an artificially low amount and have it recorded as a legitimate
    // partial payment, with no server-side check catching the mismatch.
    const outstandingInvoices = await getOutstandingInvoicesForMitra(input.businessPartnerId);
    for (const alloc of input.allocations) {
      const invoiceSalesmanId = await getInvoiceSalesmanId(alloc.salesInvoiceId);
      if (invoiceSalesmanId !== salesmanId) {
        throw new AppError("Anda tidak memiliki akses ke salah satu invoice ini.");
      }
      const invoice = outstandingInvoices.find((i) => i.SalesInvoiceID === alloc.salesInvoiceId);
      if (!invoice) {
        throw new AppError("Invoice ini sudah lunas atau tidak ditemukan.");
      }
      if (Math.abs(alloc.amount - invoice.Outstanding) > 1) {
        throw new AppError("Jumlah pembayaran tidak sesuai dengan sisa tagihan invoice ini.");
      }
    }
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
    const salesmanId = await requireOwnSalesmanId();
    const invoiceSalesmanId = await getInvoiceSalesmanId(salesInvoiceId);
    if (invoiceSalesmanId !== salesmanId) {
      throw new AppError("Anda tidak memiliki akses ke invoice ini.");
    }
    const invoices = await getOutstandingInvoicesForMitra(businessPartnerId);
    const invoice = invoices.find((i) => i.SalesInvoiceID === salesInvoiceId);
    if (!invoice) throw new AppError("Invoice ini sudah lunas atau tidak ditemukan.");
    return invoice.Outstanding;
  });
}

// Client-callable versions of what the 4 tab pages used to fetch only in
// their own Server Component — needed now that DriverTabShell lazily
// fetches a tab's data client-side the first time it's switched to
// (every tab except whichever route the driver actually landed on still
// starts with no data at all).

export async function getDriverJadwalHistoryAction(limit?: number): Promise<ActionResult<DriverJadwalCard[]>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    return getDriverJadwalHistory(salesmanId, limit);
  });
}

export async function getOwnDriverProfileAction(): Promise<ActionResult<DriverProfileRow | null>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    const all = await getDriverProfiles();
    return all.find((d) => d.SalesmanID === salesmanId) ?? null;
  });
}

// Pabrik location is a single global setting, not per-driver data, but the
// existing getPabrikLocationAction (src/app/grup/akun/actions.ts) is gated
// by requireGrupAccess() and unusable by a driver session — this is the
// same read, just behind requireDriver() instead.
export async function getPabrikLocationForDriverAction(): Promise<ActionResult<PabrikLocation>> {
  return runAction(async () => {
    await requireOwnSalesmanId();
    return getPabrikLocation();
  });
}

export async function recordFuelLogAction(jadwalId: number, liter: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwal(jadwalId, salesmanId);
    if (!(liter > 0)) throw new AppError("Jumlah liter harus lebih dari 0.");
    await recordFuelLog(jadwalId, salesmanId, liter);
  });
}

// Persists the SOS dialog's report (Task per user's live-testing feedback
// on the Pengiriman screen) — the driver-app screen stops its own ETA
// countdown locally once this succeeds; an admin-facing viewer for these
// reports is a separate, not-yet-built follow-up.
export async function reportKendalaAction(
  jadwalId: number,
  jadwalDetailId: number,
  jenisKendala: JenisKendala,
  hubungiTeknisi: boolean
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const salesmanId = await requireOwnSalesmanId();
    await assertOwnsJadwalDetail(jadwalDetailId, salesmanId);
    await recordKendala(jadwalId, jadwalDetailId, salesmanId, jenisKendala, hubungiTeknisi);
  });
}
