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
  // The real intended delivery moment — used ONLY for SalesOrder.DueDate
  // (createSalesOrderManual). Deliberately NOT used for scheduling: see
  // jamJadwal below.
  deliveryDateTime: Date;
  // Same moment as deliveryDateTime, but reconciled against the 14:00 WIB
  // rollover via resolveBusinessDateTime (business-date.ts) — used for the
  // Jadwal's own scheduling (findDraftJadwalByArmadaAndTime/
  // createJadwalDraft/updateJadwalDriverTime) so the Papan Pengiriman board
  // buckets this order under the period covering when it was actually
  // placed, not a period derived a second rollover-application further out.
  jamJadwal: Date;
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
    const existingJadwalId = await findDraftJadwalByArmadaAndTime(input.armadaId, input.jamJadwal);
    if (existingJadwalId != null) {
      await addSalesOrdersToJadwal(existingJadwalId, [salesOrderId]);
      return { salesOrderId, jadwalId: existingJadwalId };
    }

    createdJadwalId = await createJadwalDraft({
      armadaId: input.armadaId,
      jamJadwal: input.jamJadwal,
      salesOrderIds: [salesOrderId],
    });

    if (input.salesmanId) {
      await updateJadwalDriverTime(createdJadwalId, {
        jamJadwal: input.jamJadwal,
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
  // Whether a real DeliveryOrder row exists for this SO — independent of
  // Status, which can read 'Terbit' purely from a linked Jadwal's own
  // Status (see the OUTER APPLY below) even in the narrow window that
  // Jadwal flip and this SO's own DO row are both written in the same
  // selesaiMuat transaction. In practice they coincide; this field is the
  // direct signal for the "SO -> DO" filter rather than reusing Status.
  HasDO: boolean;
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
  // Matched via SalesOrderID specifically — kept separate from
  // HasDoInvoice so a mismatch between the two (an SI exists for one but
  // not the other) is visible to the "SO -> SI" / "DO -> SI" filters, the
  // same pattern of divergence the duplicate-SI investigation this
  // session was built to catch.
  HasSoInvoice: boolean;
  // Matched via DeliveryOrderID specifically — always false when HasDO is
  // false (there's no DeliveryOrderID to match against).
  HasDoInvoice: boolean;
  // Internal SalesReturnID (not a public token — "Lihat SR" is an
  // authenticated dialog, not a shared link like invoice) for the most
  // recent SalesReturn matched by this SO's DeliveryOrderID. Always null
  // when HasDO is false: SalesReturn.SalesOrderID is live-confirmed to be
  // NULL on every recently-created row (both dashboard- and desktop-ERP-
  // originated) — a return can only be recorded against an already-issued
  // DeliveryOrderID (confirmDeliveryDelivery/stop-delivery confirmation
  // runs strictly after DO creation), so DeliveryOrderID is the only
  // reliable match key, not SalesOrderID.
  SalesReturnId: string | null;
  // The Jadwal's own JamAktualBerangkat (actual departure) — null unless
  // this SO went through the dashboard's own Jadwal/Papan Pengiriman flow.
  // Deliberately NOT falling back to the DeliveryOrder's own TransDate for
  // a Jadwal-less DO (e.g. one entered directly in the desktop ERP): shown
  // as "-" in that case instead, per explicit product decision.
  ShippedAt: string | Date | null;
  // Same Jadwal-only convention as ShippedAt — null if this SO was never
  // scheduled through the dashboard.
  DriverName: string | null;
  ArmadaName: string | null;
}

export interface SalesOrderListFilter {
  from: string;
  to: string;
  wilayah?: string;
  hasDO?: "yes" | "no";
  hasSoInvoice?: "yes" | "no";
  hasDoInvoice?: "yes" | "no";
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

// Same shape as loadAllInvoiceIdsByKey (see its comment for why this is an
// unfiltered aggregate, not an id-restricted one) but against SalesReturn,
// keyed only by DeliveryOrderID — SalesReturn.SalesOrderID is
// live-confirmed NULL on every observed row, dashboard- and desktop-ERP-
// originated alike, and DeliveryOrderID is never quote-wrapped there (only
// SalesInvoice.DeliveryOrderID has that convention), so no REPLACE() is
// needed here.
async function loadAllReturnIdsByDeliveryOrderId(pool: sql.ConnectionPool): Promise<Map<string, string>> {
  const result = await pool.request().query(`
    SELECT DeliveryOrderID AS MatchKey, MAX(SalesReturnID) AS SalesReturnID
    FROM SalesReturn
    WHERE IsDeleted = 0 AND DeliveryOrderID IS NOT NULL AND DeliveryOrderID <> ''
    GROUP BY DeliveryOrderID
  `);
  const map = new Map<string, string>();
  for (const row of result.recordset as { MatchKey: string; SalesReturnID: string }[]) {
    map.set(row.MatchKey, row.SalesReturnID);
  }
  return map;
}

// Every /mkesindo/pemesanan page load pays these three lookups' combined
// cost, even though a newly-issued invoice/return showing up a little late
// is harmless here (it's just which rows get a button) — so the Maps are
// cached process-wide for a short TTL instead of re-querying on every
// request. In-flight promise (not just the resolved Maps) is what's
// cached, so concurrent requests during a refresh share one query set
// instead of each starting their own (a "thundering herd" on this app's
// single long-lived Node process — see Coolify deployment note in
// [[mkesindo-route-restructuring]] — not a distributed cache, deliberately:
// this process is the only reader/writer of it).
const DOCUMENT_ID_CACHE_TTL_MS = 45_000;
let documentIdCache: {
  promise: Promise<[Map<string, string>, Map<string, string>, Map<string, string>]>;
  loadedAt: number;
} | null = null;

function getDocumentIdMaps(pool: sql.ConnectionPool): Promise<[Map<string, string>, Map<string, string>, Map<string, string>]> {
  if (documentIdCache && Date.now() - documentIdCache.loadedAt < DOCUMENT_ID_CACHE_TTL_MS) {
    return documentIdCache.promise;
  }
  const promise = Promise.all([
    loadAllInvoiceIdsByKey(pool, "SalesOrderID"),
    loadAllInvoiceIdsByKey(pool, "REPLACE(DeliveryOrderID, '''', '')"),
    loadAllReturnIdsByDeliveryOrderId(pool),
  ]);
  documentIdCache = { promise, loadedAt: Date.now() };
  // A failed load must not poison the cache for the next 45s — clear it so
  // the next call retries instead of rethrowing the same stale error.
  promise.catch(() => {
    if (documentIdCache?.promise === promise) documentIdCache = null;
  });
  return promise;
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
        do_.DeliveryOrderID,
        j.JamAktualBerangkat AS ShippedAt,
        sm.Name AS DriverName,
        arm.Nama AS ArmadaName
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
      SELECT TOP 1 jh.Status, jh.JamAktualBerangkat, jh.SalesmanID, jh.ArmadaID
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwal jh ON jh.JadwalID = jd.JadwalID AND jh.IsDeleted = 0
      WHERE jd.SalesOrderID = so.SalesOrderID AND jd.IsDeleted = 0
      ORDER BY jd.JadwalDetailID DESC
    ) j
    LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
    LEFT JOIN DashboardArmada arm ON arm.ArmadaID = j.ArmadaID
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

  const rows = result.recordset as (Omit<
    SalesOrderListRow,
    "HasDO" | "InvoiceToken" | "HasSoInvoice" | "HasDoInvoice" | "SalesReturnId"
  > & { DeliveryOrderID: string | null })[];

  // SalesInvoice/SalesReturn have 200K+/9K+ rows and no index on
  // SalesOrderID/DeliveryOrderID (only PK and TransDate). Joining either
  // into the query above — even via pre-aggregated GROUP BY derived tables
  // — was confirmed live to collapse SQL Server's plan for the whole query
  // to 245s+/timeout the moment a column from those joins is actually
  // selected, most likely from a bad plan interaction with the OUTER
  // APPLYs already above. Looking them up in completely separate, cached
  // query/round-trips instead (getDocumentIdMaps above) keeps those joins
  // out of this query's plan entirely — see SalesOrderListRow.InvoiceToken
  // for which Status values can have one.
  const [soInvoiceMap, doInvoiceMap, doReturnMap] = await getDocumentIdMaps(pool);

  const mapped = rows.map((r) => {
    const { DeliveryOrderID, ...rest } = r;
    const hasDO = DeliveryOrderID != null;
    const soInvoiceId = soInvoiceMap.get(r.SalesOrderID);
    const doInvoiceId = hasDO ? doInvoiceMap.get(DeliveryOrderID) : undefined;
    const invoiceSalesInvoiceId = soInvoiceId ?? doInvoiceId;
    const salesReturnId = hasDO ? (doReturnMap.get(DeliveryOrderID) ?? null) : null;
    return {
      ...rest,
      HasDO: hasDO,
      InvoiceToken: invoiceSalesInvoiceId ? encodeInvoiceToken(invoiceSalesInvoiceId) : null,
      HasSoInvoice: soInvoiceId != null,
      HasDoInvoice: doInvoiceId != null,
      SalesReturnId: salesReturnId,
    };
  });

  return mapped.filter((r) => {
    if (filter.hasDO === "yes" && !r.HasDO) return false;
    if (filter.hasDO === "no" && r.HasDO) return false;
    if (filter.hasSoInvoice === "yes" && !r.HasSoInvoice) return false;
    if (filter.hasSoInvoice === "no" && r.HasSoInvoice) return false;
    if (filter.hasDoInvoice === "yes" && !r.HasDoInvoice) return false;
    if (filter.hasDoInvoice === "no" && r.HasDoInvoice) return false;
    return true;
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

export interface SalesReturnDetailLine {
  Name: string;
  Qty: number;
  Unit: string;
  Price: number;
  Amount: number;
}

export interface SalesReturnDetail {
  SalesReturnID: string;
  VoucherNo: string;
  TransDate: string | Date;
  CustomerName: string;
  Amount: number;
  Lines: SalesReturnDetailLine[];
}

// Backs the "Lihat SR" dialog on /mkesindo/pemesanan — an internal,
// authenticated view (unlike SI's /mkesindo/invoice/[token] public page),
// so this takes the raw internal SalesReturnID directly rather than a
// signed/public token.
export async function getSalesReturnDetail(salesReturnId: string): Promise<SalesReturnDetail | null> {
  const pool = await getPool();
  const headerResult = await pool
    .request()
    .input("id", sql.VarChar(16), salesReturnId).query(`
      SELECT sr.SalesReturnID, sr.VoucherNo, sr.TransDate, sr.Amount, ISNULL(bp.Name, 'Tidak Diketahui') AS CustomerName
      FROM SalesReturn sr
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = sr.BusinessPartnerID
      WHERE sr.SalesReturnID = @id AND sr.IsDeleted = 0
    `);
  const header = headerResult.recordset[0] as Omit<SalesReturnDetail, "Lines"> | undefined;
  if (!header) return null;

  const linesResult = await pool
    .request()
    .input("id", sql.VarChar(16), salesReturnId)
    .query(`SELECT Name, Qty, Unit, Price, Amount FROM SalesReturnDetail WHERE SalesReturnID = @id`);

  return { ...header, Lines: linesResult.recordset as SalesReturnDetailLine[] };
}

export interface SalesReturnListRow {
  SalesReturnID: string;
  VoucherNo: string;
  TransDate: string | Date;
  CustomerName: string;
  Wilayah: string;
  Amount: number;
  // The DO this return was recorded against — SalesReturn.DeliveryOrderID
  // is reliable (unlike SalesOrderID, live-confirmed NULL on every
  // observed row — see getSalesOrderList's own comment), so the join goes
  // through DeliveryOrder, not SalesOrder, for traceability context.
  DeliveryOrderVoucherNo: string | null;
}

export interface SalesReturnListFilter {
  from: string;
  to: string;
  wilayah?: string;
}

// Backs the "Pesanan Kembali" tab on /mkesindo/pemesanan — every MKE/SR/
// transaction in range, dashboard- and desktop-ERP-originated alike (both
// write to the same SalesReturn table). Same date-bounded convention as
// getSalesOrderList — SalesReturn is a much smaller table (~9.6K rows) with
// no equivalent large-table join to worry about, so this is a plain
// filtered query, not the unfiltered-aggregate-then-filter-in-JS pattern
// that table required.
export async function getSalesReturnList(filter: SalesReturnListFilter): Promise<SalesReturnListRow[]> {
  const pool = await getPool();
  const request = pool.request().input("from", sql.Date, filter.from).input("to", sql.Date, filter.to);
  if (filter.wilayah) request.input("wilayah", sql.VarChar(128), filter.wilayah);

  const result = await request.query(`
    SELECT
        sr.SalesReturnID,
        sr.VoucherNo,
        sr.TransDate,
        ISNULL(bp.Name, 'Tidak Diketahui') AS CustomerName,
        ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
        sr.Amount,
        do_.VoucherNo AS DeliveryOrderVoucherNo
    FROM SalesReturn sr
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = sr.BusinessPartnerID
    LEFT JOIN DeliveryOrder do_ ON do_.DeliveryOrderID = sr.DeliveryOrderID
    WHERE sr.IsDeleted = 0
      AND sr.TransDate >= @from AND sr.TransDate < @to
      ${filter.wilayah ? "AND bp.NPWPName = @wilayah" : ""}
    ORDER BY sr.TransDate DESC
  `);
  return result.recordset as SalesReturnListRow[];
}
