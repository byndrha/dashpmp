import { getPool, sql } from "@/lib/db";
import { createSalesOrderManual, softDeleteSalesOrder, type KantongVariant } from "@/lib/queries/sales-order";
import { encodeInvoiceToken } from "@/lib/queries/invoice-public";
import {
  createJadwalDraft,
  deleteJadwalDraft,
  updateJadwalDriverTime,
  JADWAL_KANTONG_EXPR,
  JADWAL_KANTONG_10KG_EXPR,
  JADWAL_KANTONG_5KG_EXPR,
  getCurrentAssignment,
  removeSalesOrderFromJadwal,
  findDraftJadwalByArmadaAndTime,
  addSalesOrdersToJadwal,
} from "@/lib/queries/pengiriman-jadwal";
import { AppError } from "@/lib/action-result";

export interface CreatePemesananInput {
  businessPartnerId: string;
  variant: KantongVariant;
  qtyKantong: number;
  // Free/bonus kantong on top of qtyKantong — not billed, see
  // createSalesOrderManual for how it's stored.
  bonusQty: number;
  deliveryDateTime: Date;
  armadaId: number;
  salesmanId: string | null;
}

export interface CreatePemesananResult {
  salesOrderId: string;
  jadwalId: number;
}

// Orchestrates the Pemesanan module's single-submit flow: create the real
// SalesOrder, then immediately schedule it on the Papan Pengiriman board.
// If a Draft already exists for the exact same Armada + departure time
// (e.g. a second mitra's order aimed at the same trip), the new SO joins
// that Draft as another stop via addSalesOrdersToJadwal instead of
// spawning a sibling Jadwal — otherwise both would render on top of each
// other on the board and only one route validation would exist per trip
// where the user expects one. createJadwalDraft/addSalesOrdersToJadwal
// already enforce Armada capacity either way. Deliberately stops at Draft,
// not a real DeliveryOrder — the existing route-validation gate in
// startBerangkat (pengiriman-jadwal.ts) stays the only path from Draft to
// Terbit, so this doesn't add a second, unvalidated way to create a real
// DeliveryOrder. If scheduling fails after the SO was already created, the
// SO is soft-deleted so it doesn't linger as an unscheduled orphan the
// user never asked for.
export async function createPemesanan(input: CreatePemesananInput): Promise<CreatePemesananResult> {
  const salesOrderId = await createSalesOrderManual({
    businessPartnerId: input.businessPartnerId,
    variant: input.variant,
    qtyKantong: input.qtyKantong,
    bonusQty: input.bonusQty,
    deliveryDateTime: input.deliveryDateTime,
  });

  let createdJadwalId: number | null = null;
  try {
    const existingJadwalId = await findDraftJadwalByArmadaAndTime(input.armadaId, input.deliveryDateTime);
    if (existingJadwalId != null) {
      await addSalesOrdersToJadwal(existingJadwalId, [salesOrderId]);
      return { salesOrderId, jadwalId: existingJadwalId };
    }

    createdJadwalId = await createJadwalDraft({
      armadaId: input.armadaId,
      jamJadwal: input.deliveryDateTime,
      salesOrderIds: [salesOrderId],
    });

    if (input.salesmanId) {
      await updateJadwalDriverTime(createdJadwalId, {
        jamJadwal: input.deliveryDateTime,
        salesmanId: input.salesmanId,
      });
    }

    return { salesOrderId, jadwalId: createdJadwalId };
  } catch (err) {
    if (createdJadwalId != null) {
      await deleteJadwalDraft(createdJadwalId);
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
  // Raw (un-halved) per-kemasan bag counts — see formatKemasanQty in
  // lib/format.ts.
  Qty10KG: number;
  Qty5KG: number;
  Amount: number;
  Status: SalesOrderStatus;
  // null until an SI has actually been issued for this SalesOrderID (via
  // either its SalesOrderID or its linked DeliveryOrderID). Belum
  // Dijadwalkan is never non-null (live-confirmed: 0/64 in a 2026-08
  // spot-check) since nothing has been created for it yet. Terbit is
  // non-null except a rare few (~5/1406) — legacy/edge-case DOs invoiced
  // outside this dashboard's own flow. Draft is often non-null too
  // (~2511/2559 live) even though Draft's own trip hasn't been invoiced:
  // Status here reflects this SO's MOST RECENT Jadwal link (see the
  // OUTER APPLY above, ORDER BY JadwalDetailID DESC), which can be a
  // newer Draft re-schedule of an SO that was already invoiced through an
  // earlier, now-Terbit Jadwal — so Status and InvoiceToken are resolved
  // independently and are not implied by each other.
  InvoiceToken: string | null;
}

export interface SalesOrderListFilter {
  from: string;
  to: string;
  wilayah?: string;
}

// Aggregates MAX(SalesInvoiceID) by a match key across ALL of SalesInvoice
// (200K+ rows), unfiltered by any caller-supplied id set. This looks
// wasteful but is the fast path: filtering via `WHERE <keyExpr> IN (...)`
// with a large id list was tried and confirmed live to make SQL Server pick
// a nested-loop plan (probing the IN list against a table scan once per
// value) that times out well past 40s for 1000+ ids — especially for the
// DeliveryOrderID key, which needs a non-sargable REPLACE() to strip the
// stored quote-wrapping. A single unfiltered hash-aggregate over the whole
// table is a one-pass scan and was confirmed live to take under 3s either
// way (~660ms by SalesOrderID, ~2.4s by the REPLACE'd DeliveryOrderID) —
// the caller filters the resulting Map down to the ids it actually needs.
async function loadAllInvoiceIdsByKey(pool: sql.ConnectionPool, keyExpr: string): Promise<Map<string, string>> {
  const result = await pool.request().query(`
    SELECT ${keyExpr} AS MatchKey, MAX(SalesInvoiceID) AS SalesInvoiceID
    FROM SalesInvoice
    WHERE IsDeleted = 0 AND ${keyExpr} IS NOT NULL
    GROUP BY ${keyExpr}
  `);
  const map = new Map<string, string>();
  for (const row of result.recordset as { MatchKey: string; SalesInvoiceID: string }[]) {
    map.set(row.MatchKey, row.SalesInvoiceID);
  }
  return map;
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
        ISNULL(sod.TotalQty10KG, 0) AS Qty10KG,
        ISNULL(sod.TotalQty5KG, 0) AS Qty5KG,
        ISNULL(sod.TotalAmount, 0) AS Amount,
        CASE
          WHEN j.Status IS NOT NULL THEN j.Status
          WHEN do_.DeliveryOrderID IS NOT NULL THEN 'Terbit'
          ELSE 'Belum Dijadwalkan'
        END AS Status,
        do_.DeliveryOrderID
    FROM SalesOrder so
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
    LEFT JOIN (
      SELECT SalesOrderID, ${JADWAL_KANTONG_EXPR} AS TotalQty,
             ${JADWAL_KANTONG_10KG_EXPR} AS TotalQty10KG, ${JADWAL_KANTONG_5KG_EXPR} AS TotalQty5KG,
             SUM(Amount) AS TotalAmount
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

  const rows = result.recordset as (Omit<SalesOrderListRow, "InvoiceToken"> & { DeliveryOrderID: string | null })[];

  // SalesInvoice has 200K+ rows and no index on SalesOrderID/DeliveryOrderID
  // (only PK and TransDate). Joining it into the query above — even via
  // pre-aggregated GROUP BY derived tables — was confirmed live to collapse
  // SQL Server's plan for the whole query to 245s+/timeout the moment a
  // column from those joins is actually selected, most likely from a bad
  // plan interaction with the OUTER APPLYs already above. Looking it up in
  // two completely separate query/round-trips instead (loadAllInvoiceIdsByKey
  // below) keeps that join out of this query's plan entirely — see
  // SalesOrderListRow.InvoiceToken for which Status values can have one.
  const [soMap, doMap] = await Promise.all([
    loadAllInvoiceIdsByKey(pool, "SalesOrderID"),
    loadAllInvoiceIdsByKey(pool, "REPLACE(DeliveryOrderID, '''', '')"),
  ]);

  return rows.map((r) => {
    const { DeliveryOrderID, ...rest } = r;
    const invoiceSalesInvoiceId = soMap.get(r.SalesOrderID) ?? (DeliveryOrderID ? doMap.get(DeliveryOrderID) : undefined);
    return { ...rest, InvoiceToken: invoiceSalesInvoiceId ? encodeInvoiceToken(invoiceSalesInvoiceId) : null };
  });
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
// it fresh). Same join-existing-Draft rule as createPemesanan: if another
// Draft already sits at the target Armada + departure time, this SO joins
// it as another stop instead of spawning a sibling Jadwal that would
// overlap it on the board. Reuses createJadwalDraft/addSalesOrdersToJadwal/
// updateJadwalDriverTime exactly as createPemesanan does, so the same
// capacity check and JamJadwal-not-before-TransDate validation
// (pengiriman-jadwal.ts) apply here too. Deliberately resolves/creates the
// NEW assignment before removing the SO from its OLD one: if that step
// throws (capacity exceeded, JamJadwal validation, etc.), the old
// assignment is still untouched and there's nothing to roll back —
// removeSalesOrderFromJadwal only runs once the new assignment has fully
// succeeded.
export async function reschedulePemesanan(input: ReschedulePemesananInput): Promise<{ jadwalId: number }> {
  const current = await getCurrentAssignment(input.salesOrderId);
  const existingJadwalId = await findDraftJadwalByArmadaAndTime(input.armadaId, input.deliveryDateTime);

  // Target is the Jadwal the SO is already sitting in (armada/time
  // unchanged) — nothing to move, just let a driver change (if any) apply.
  if (existingJadwalId != null && current && existingJadwalId === current.jadwalId) {
    if (input.salesmanId) {
      await updateJadwalDriverTime(existingJadwalId, {
        jamJadwal: input.deliveryDateTime,
        salesmanId: input.salesmanId,
      });
    }
    return { jadwalId: existingJadwalId };
  }

  let jadwalId: number;
  if (existingJadwalId != null) {
    await addSalesOrdersToJadwal(existingJadwalId, [input.salesOrderId]);
    jadwalId = existingJadwalId;
  } else {
    jadwalId = await createJadwalDraft({
      armadaId: input.armadaId,
      jamJadwal: input.deliveryDateTime,
      salesOrderIds: [input.salesOrderId],
    });

    if (input.salesmanId) {
      try {
        await updateJadwalDriverTime(jadwalId, {
          jamJadwal: input.deliveryDateTime,
          salesmanId: input.salesmanId,
        });
      } catch (err) {
        await deleteJadwalDraft(jadwalId);
        throw err;
      }
    }
  }

  if (current) {
    await removeSalesOrderFromJadwal(current.jadwalId, input.salesOrderId);
  }

  return { jadwalId };
}

// Directly edits SalesOrder.TransDate — the desktop-ERP "order date" field
// this dashboard otherwise only ever sets once, at creation
// (createSalesOrderManual/createSalesOrderFromPengajuan), and never touches
// again. Exists specifically for Terbit orders: TransDate is routinely
// bumped by same-day desktop-ERP edits to a value later than the real order
// time (see assertJamJadwalNotBeforeOrders's own comment in
// pengiriman-jadwal.ts), and once an SO has shipped, reschedulePemesanan
// (Ubah Pemesanan) is no longer reachable to work around it — that dialog
// only ever touched scheduling (Jadwal.JamJadwal), never TransDate itself,
// so this is a genuinely new write path, not a relaxed version of an
// existing one.
export async function updateSalesOrderTransDate(salesOrderId: string, transDate: Date): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.VarChar(16), salesOrderId)
    .input("transDate", sql.DateTime, transDate)
    .query(`UPDATE SalesOrder SET TransDate = @transDate, ModifiedDate = GETDATE() WHERE SalesOrderID = @id AND IsDeleted = 0`);
  if (result.rowsAffected[0] === 0) throw new AppError("Sales Order tidak ditemukan.");
}

// Soft-deletes an SO from the Pemesanan list — only for orders that haven't
// actually shipped. getCurrentAssignment only resolves a Draft-status
// Jadwal (its own query filters on that), so a directly-linked, non-Draft
// DeliveryOrder (Status='Terbit', or one created outside the Jadwal flow
// entirely) wouldn't be caught by it — checked separately here so this
// can't silently soft-delete an SO a real DO already exists against.
export async function deletePemesanan(salesOrderId: string): Promise<void> {
  const pool = await getPool();
  const doCheck = await pool
    .request()
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`SELECT COUNT(*) AS Cnt FROM DeliveryOrder WHERE SalesOrderID = @soId AND IsDeleted = 0`);
  if ((doCheck.recordset[0] as { Cnt: number }).Cnt > 0) {
    throw new AppError("Pesanan ini sudah terkirim (DO sudah terbit) — tidak bisa dihapus.");
  }

  const current = await getCurrentAssignment(salesOrderId);
  if (current) {
    await removeSalesOrderFromJadwal(current.jadwalId, salesOrderId);
  }
  await softDeleteSalesOrder(salesOrderId);
}
