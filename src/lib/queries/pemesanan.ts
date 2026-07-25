import { getPool, sql } from "@/lib/db";
import { createSalesOrderManual, softDeleteSalesOrder, type KantongVariant } from "@/lib/queries/sales-order";
import {
  createJadwalDraft,
  deleteJadwalDraft,
  updateJadwalDriverTime,
  JADWAL_KANTONG_EXPR,
  getCurrentAssignment,
  removeSalesOrderFromJadwal,
} from "@/lib/queries/pengiriman-jadwal";

export interface CreatePemesananInput {
  businessPartnerId: string;
  variant: KantongVariant;
  qtyKantong: number;
  deliveryDateTime: Date;
  armadaId: number;
  salesmanId: string | null;
}

export interface CreatePemesananResult {
  salesOrderId: string;
  jadwalId: number;
}

// Orchestrates the Pemesanan module's single-submit flow: create the real
// SalesOrder, then immediately schedule it as a Draft keberangkatan on the
// Papan Pengiriman board (createJadwalDraft already enforces Armada
// capacity). Deliberately stops at Draft, not a real DeliveryOrder — the
// existing route-validation gate in startBerangkat (pengiriman-jadwal.ts)
// stays the only path from Draft to Terbit, so this doesn't add a second,
// unvalidated way to create a real DeliveryOrder. If scheduling fails after
// the SO was already created, the SO is soft-deleted so it doesn't linger
// as an unscheduled orphan the user never asked for.
export async function createPemesanan(input: CreatePemesananInput): Promise<CreatePemesananResult> {
  const salesOrderId = await createSalesOrderManual({
    businessPartnerId: input.businessPartnerId,
    variant: input.variant,
    qtyKantong: input.qtyKantong,
    deliveryDateTime: input.deliveryDateTime,
  });

  let jadwalId: number | null = null;
  try {
    jadwalId = await createJadwalDraft({
      armadaId: input.armadaId,
      jamJadwal: input.deliveryDateTime,
      salesOrderIds: [salesOrderId],
    });

    if (input.salesmanId) {
      await updateJadwalDriverTime(jadwalId, {
        jamJadwal: input.deliveryDateTime,
        salesmanId: input.salesmanId,
      });
    }

    return { salesOrderId, jadwalId };
  } catch (err) {
    if (jadwalId != null) {
      await deleteJadwalDraft(jadwalId);
    }
    await softDeleteSalesOrder(salesOrderId);
    throw err;
  }
}

export type SalesOrderStatus = "Belum Dijadwalkan" | "Draft" | "Terbit";

export interface SalesOrderListRow {
  SalesOrderID: string;
  VoucherNo: string;
  TransDate: string | Date;
  DueDate: string | Date | null;
  CustomerName: string;
  Wilayah: string;
  Qty: number;
  Amount: number;
  Status: SalesOrderStatus;
}

export interface SalesOrderListFilter {
  from: string;
  to: string;
  wilayah?: string;
}

// Lists Sales Orders from every source (Pemesanan module, Pengajuan-approval
// auto-creation, manual desktop-ERP entry) with a resolved scheduling
// status — a linked, non-deleted DashboardPengirimanJadwal's own Status
// (Draft/Terbit) wins when one exists; otherwise a directly-linked
// DeliveryOrder (created outside the Jadwal flow) still counts as Terbit;
// anything else is not yet scheduled at all. TransDate-bounded (exclusive
// upper bound, same convention as the rest of the app) rather than an
// unbounded IsClosed=0 filter — SalesOrder carries years of open backlog
// (see the documented SO-availability-window finding) an unbounded query
// would flood this list with.
export async function getSalesOrderList(filter: SalesOrderListFilter): Promise<SalesOrderListRow[]> {
  const pool = await getPool();
  const request = pool.request().input("from", sql.Date, filter.from).input("to", sql.Date, filter.to);
  if (filter.wilayah) request.input("wilayah", sql.VarChar(128), filter.wilayah);

  const result = await request.query(`
    SELECT
        so.SalesOrderID,
        so.VoucherNo,
        so.TransDate,
        so.DueDate,
        bp.Name AS CustomerName,
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        ISNULL(sod.TotalQty, 0) AS Qty,
        ISNULL(sod.TotalAmount, 0) AS Amount,
        CASE
          WHEN j.Status IS NOT NULL THEN j.Status
          WHEN do_.DeliveryOrderID IS NOT NULL THEN 'Terbit'
          ELSE 'Belum Dijadwalkan'
        END AS Status
    FROM SalesOrder so
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN (
      SELECT SalesOrderID, ${JADWAL_KANTONG_EXPR} AS TotalQty, SUM(Amount) AS TotalAmount
      FROM SalesOrderDetail sod
      GROUP BY SalesOrderID
    ) sod ON sod.SalesOrderID = so.SalesOrderID
    OUTER APPLY (
      SELECT TOP 1 jh.Status
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwal jh ON jh.JadwalID = jd.JadwalID AND jh.IsDeleted = 0
      WHERE jd.SalesOrderID = so.SalesOrderID AND jd.IsDeleted = 0
      ORDER BY jd.JadwalDetailID DESC
    ) j
    OUTER APPLY (
      SELECT TOP 1 do2.DeliveryOrderID
      FROM DeliveryOrder do2
      WHERE do2.SalesOrderID = so.SalesOrderID AND do2.IsDeleted = 0
    ) do_
    WHERE so.IsDeleted = 0
      AND so.TransDate >= @from AND so.TransDate < @to
      ${filter.wilayah ? "AND bp.NPWPName = @wilayah" : ""}
    ORDER BY so.TransDate DESC
  `);
  return result.recordset;
}

export interface ReschedulePemesananInput {
  salesOrderId: string;
  armadaId: number;
  deliveryDateTime: Date;
  salesmanId: string | null;
}

// Moves ONE Sales Order to a different armada/waktu/driver without
// touching whatever other SOs are still bundled in its current Draft (if
// it's currently assigned to one at all — a never-scheduled SO, status
// "Belum Dijadwalkan", has no current assignment and this just schedules
// it fresh). Reuses createJadwalDraft/updateJadwalDriverTime exactly as
// createPemesanan already does, so the same capacity check and
// JamJadwal-not-before-TransDate validation (pengiriman-jadwal.ts) apply
// here too — nothing about this path bypasses either rule. Deliberately
// creates the NEW Jadwal draft before removing the SO from its OLD one:
// if createJadwalDraft/updateJadwalDriverTime throws (capacity exceeded,
// JamJadwal validation, etc.), the old assignment is still untouched and
// there's nothing to roll back — removeSalesOrderFromJadwal only runs
// once the new assignment has fully succeeded.
export async function reschedulePemesanan(input: ReschedulePemesananInput): Promise<{ jadwalId: number }> {
  const current = await getCurrentAssignment(input.salesOrderId);

  const jadwalId = await createJadwalDraft({
    armadaId: input.armadaId,
    jamJadwal: input.deliveryDateTime,
    salesOrderIds: [input.salesOrderId],
  });

  if (input.salesmanId) {
    await updateJadwalDriverTime(jadwalId, {
      jamJadwal: input.deliveryDateTime,
      salesmanId: input.salesmanId,
    });
  }

  if (current) {
    await removeSalesOrderFromJadwal(current.jadwalId, input.salesOrderId);
  }

  return { jadwalId };
}
