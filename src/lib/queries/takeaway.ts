import { createSalesOrderManual, softDeleteSalesOrder, type KantongVariant } from "@/lib/queries/sales-order";
import { createTakeAwayMuatanDraft, TAKEAWAY_SALESMAN_ID } from "@/lib/queries/takeaway-muatan";

export interface CreateTakeAwayInput {
  businessPartnerId: string;
  variant: KantongVariant;
  qtyKantong: number;
  bonusQty: number;
  deliveryDateTime: Date;
}

export interface CreateTakeAwayResult {
  salesOrderId: string;
}

// TakeAway ("Ambil Sendiri") skips the whole Jadwal/Armada flow entirely.
// As of docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md
// it no longer creates DeliveryOrder/SalesInvoice immediately either — only
// the SalesOrder + a Draft DashboardTakeAwayMuatan row are created here. The
// real DO/SI documents are created later, at "Selesai Muat" time in
// produksi-app (see takeAwaySelesaiMuat in takeaway-muatan.ts), mirroring
// how non-TakeAway deliveries only get their documents at Selesai Muat.
export async function createTakeAwayPemesanan(input: CreateTakeAwayInput): Promise<CreateTakeAwayResult> {
  const salesOrderId = await createSalesOrderManual({
    businessPartnerId: input.businessPartnerId,
    variant: input.variant,
    qtyKantong: input.qtyKantong,
    bonusQty: input.bonusQty,
    deliveryDateTime: input.deliveryDateTime,
    salesmanId: TAKEAWAY_SALESMAN_ID,
  });

  try {
    await createTakeAwayMuatanDraft(salesOrderId, input.variant, input.qtyKantong);
  } catch (err) {
    await softDeleteSalesOrder(salesOrderId);
    throw err;
  }

  return { salesOrderId };
}
