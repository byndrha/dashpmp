import { getPool, sql } from "@/lib/db";
import { getArmadaList, type ArmadaRow } from "@/lib/queries/armada";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
import { formatDate, formatTime } from "@/lib/format";
import { estimateDeliveryMinutes } from "@/lib/delivery-duration";
import { estimateTravelMinutes, type LatLng } from "@/lib/route-estimate";
import { getJamKembaliAktualMap } from "@/lib/queries/vehicle-check";

// Same 5KG-counts-as-half-a-kantong normalization already established in
// mitra-do.ts's KANTONG_QTY_EXPR, applied to SalesOrderDetail.Qty since that
// (not DeliveryOrderDetail) is the uniform source of line-item data for
// both Draft and Terbit Jadwal rows — a Draft has no DeliveryOrderDetail
// yet.
export const JADWAL_KANTONG_EXPR = `SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN sod.Qty / 2.0 ELSE sod.Qty END)`;

// Bonus kantong (free goods bundled into an order, not billed) now get
// their own SalesOrderDetail row under a dedicated "Es Tube Bonus"/"Es Tube
// Bonus 5 KG" ItemID (see BONUS_ITEM_VARIANTS in sales-order.ts) — that
// row's own (5KG-halved) Qty is entirely bonus. Older orders created before
// this change instead piggyback the bonus qty on the main row's
// SalesOrderDetail.Custom1 (a generic POS leftover column, confirmed
// unused elsewhere) — kept as a fallback so historical orders still show
// their bonus split correctly. Qty in those older rows already includes
// the bonus (JADWAL_KANTONG_EXPR sums the raw Qty either way, so total
// kantong is correct under both schemes without change).
export const JADWAL_BONUS_QTY_EXPR = `SUM(CASE
  WHEN sod.Name LIKE '%Bonus%' THEN (CASE WHEN sod.Name LIKE '%5 KG%' THEN sod.Qty / 2.0 ELSE sod.Qty END)
  ELSE (CASE WHEN sod.Name LIKE '%5 KG%' THEN ISNULL(TRY_CAST(NULLIF(sod.Custom1, '') AS FLOAT), 0) / 2.0 ELSE ISNULL(TRY_CAST(NULLIF(sod.Custom1, '') AS FLOAT), 0) END)
END)`;

// Raw (un-halved) per-kemasan bag counts — unlike JADWAL_KANTONG_EXPR these
// are never converted to a 10KG-equivalent, so a reader sees exactly how
// many 10KG bags and how many 5KG bags without doing the /2 conversion
// themselves. Same '%5 KG%' name classification as everywhere else in this
// file (see sales-overview.ts's KemasanQty for the same Qty10KG/Qty5KG
// shape used elsewhere in the app).
export const JADWAL_KANTONG_10KG_EXPR = `SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN 0 ELSE sod.Qty END)`;
export const JADWAL_KANTONG_5KG_EXPR = `SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN sod.Qty ELSE 0 END)`;

export type JadwalStatus = "Draft" | "Terbit";

export interface JadwalCard {
  JadwalID: number;
  ArmadaID: number;
  SalesmanID: string | null;
  DriverName: string | null;
  JamJadwal: string | Date;
  JamMulaiMuat: string | Date | null;
  JamAktualBerangkat: string | Date | null;
  Status: JadwalStatus;
  TotalKantong: number;
  // Renamed from TotalDO — during Draft this counts SO lines, not DO
  // documents (there are none yet). Same count either way since one SO
  // becomes exactly one DO, just a more accurate name.
  TotalStop: number;
  // Only ever set once, at startBerangkat — null for every Draft.
  JarakKM: number | null;
  // Estimated round-trip duration (OSRM), set alongside JarakKM at
  // startBerangkat — null for every Draft, and for any Terbit Jadwal
  // created before this column existed. Drives the auto-derived "Dalam
  // Perjalanan" / "Kembali ke Pabrik" segments on the board (see
  // computeArmadaTimelineSegments).
  DurasiMenit: number | null;
  // The real vehicle-return timestamp from a Satpam's Cek Datang, when one
  // exists (see vehicle-check.ts) — null for any Jadwal without a recorded
  // arrival check yet, in which case the board falls back to the
  // JamAktualBerangkat + DurasiMenit estimate (unchanged legacy behavior).
  JamKembaliAktual: string | null;
  // Estimated total busy duration: each stop's own bongkar/unloading time
  // (estimateDeliveryMinutes, delivery-duration.ts) plus pabrik->stop1->...
  // ->pabrik travel time — the real OSRM-derived DurasiMenit when already
  // known (Terbit), otherwise a haversine-distance heuristic (Draft, see
  // route-estimate.ts). Drives this card's width on the Papan Pengiriman
  // timeline, and is also what the armada-double-booking overlap check
  // (findOverlappingJadwalForArmada) uses to size each Jadwal's busy
  // window.
  EstimasiDurasiMenit: number;
}

// A real DeliveryOrder created directly in the desktop ERP app (not through
// this dashboard's Buat Pemesanan -> Validasi Rute -> Berangkat flow) — see
// [[armada-expeditiondetail-linkage]] memory. Shown on the board as a
// read-only marker so an armada's real workload isn't invisible just
// because it was dispatched outside this dashboard.
export interface ExternalDelivery {
  DeliveryOrderID: string;
  VoucherNo: string;
  CustomerName: string;
  TransDate: string | Date;
  ArmadaID: number;
  TotalKantong: number;
}

export async function getPengirimanBoard(
  businessDate: string
): Promise<{ armada: ArmadaRow[]; jadwal: JadwalCard[]; externalDeliveries: ExternalDelivery[] }> {
  const pool = await getPool();
  const [armada, jadwalResult, externalResult, pabrik] = await Promise.all([
    getArmadaList(),
    pool
      .request()
      .input("businessDate", sql.Date, businessDate).query(`
        -- StopDuration estimates each stop's on-site delivery time from its
        -- own kantong qty — mirrors estimateDeliveryMinutes in
        -- delivery-duration.ts exactly (qty<=5: 5 min; 5<qty<=40: 5 + 2.5
        -- min per 5-kantong block past the first; qty>40: 22.5 min, the
        -- value at exactly 40, + 10 min per 5-kantong block past 40) — and
        -- sums it per JadwalID, so a Jadwal's timeline card width reflects
        -- the total time its stops need. Needs its own per-stop
        -- (JadwalDetailID) grouping first — applying the formula to the
        -- Jadwal's already-combined TotalKantong instead would treat e.g.
        -- two 3-kantong stops as one 6-kantong block.
        WITH StopQty AS (
            SELECT jd.JadwalID, jd.JadwalDetailID,
                   ISNULL(SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN sod.Qty / 2.0 ELSE sod.Qty END), 0) AS Qty
            FROM DashboardPengirimanJadwalDetail jd
            LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
            WHERE jd.IsDeleted = 0
            GROUP BY jd.JadwalID, jd.JadwalDetailID
        ),
        StopDuration AS (
            SELECT JadwalID,
                   SUM(CASE
                     WHEN Qty <= 0 THEN 0
                     WHEN Qty <= 5 THEN 5
                     WHEN Qty <= 40 THEN 5 + 2.5 * CEILING((Qty - 5) / 5.0)
                     ELSE 22.5 + 10 * CEILING((Qty - 40) / 5.0)
                   END) AS EstimasiDurasiMenit
            FROM StopQty
            GROUP BY JadwalID
        )
        SELECT
            j.JadwalID,
            j.ArmadaID,
            j.SalesmanID,
            sm.Name AS DriverName,
            j.JamJadwal,
            j.JamMulaiMuat,
            j.JamAktualBerangkat,
            j.Status,
            ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS TotalKantong,
            COUNT(DISTINCT jd.JadwalDetailID) AS TotalStop,
            j.JarakKM,
            j.DurasiMenit,
            ISNULL(sdur.EstimasiDurasiMenit, 0) AS EstimasiDurasiMenit
        FROM DashboardPengirimanJadwal j
        LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
        LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
        LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
        LEFT JOIN StopDuration sdur ON sdur.JadwalID = j.JadwalID
        WHERE j.IsDeleted = 0
          -- businessDate is a 14:00 WIB rollover label, not a plain calendar
          -- date (see ROLLOVER_HOUR in business-date.ts): it spans 14:00 WIB
          -- the day before through 13:59 WIB the labeled day itself, so the
          -- window here shifts by ROLLOVER_HOUR (14) instead of a plain
          -- midnight-to-midnight day. Kept as WIB->UTC (-7h) on top of that,
          -- same convention as the rest of this file's businessDate filters.
          AND j.JamJadwal >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME))) AND j.JamJadwal < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
        GROUP BY j.JadwalID, j.ArmadaID, j.SalesmanID, sm.Name, j.JamJadwal, j.JamMulaiMuat, j.JamAktualBerangkat, j.Status, j.JarakKM, j.DurasiMenit, sdur.EstimasiDurasiMenit
        ORDER BY j.JamJadwal
      `),
    pool
      .request()
      .input("businessDate", sql.Date, businessDate).query(`
        -- VehicleMap resolves an armada three different ways because
        -- DeliveryOrder.VehicleNo's real-world convention has drifted over
        -- the years: the desktop ERP app writes the linked
        -- ExpeditionDetailID (e.g. "0120", confirmed live), this dashboard
        -- used to write the armada's own nickname (DashboardArmada.Nama,
        -- e.g. "GM 14"), and now writes the real plate
        -- (ExpeditionDetail.VehicleNo, e.g. "AE 9874 SH") once linked — see
        -- [[armada-expeditiondetail-linkage]].
        WITH VehicleMap AS (
            SELECT a.ArmadaID, a.ExpeditionDetailID AS Key1, ed.VehicleNo AS Key2, a.Nama AS Key3
            FROM DashboardArmada a
            LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
            WHERE a.IsDeleted = 0
        ),
        DoQty AS (
            SELECT DeliveryOrderID, SUM(CASE WHEN Name LIKE '%5 KG%' THEN Qty / 2.0 ELSE Qty END) AS TotalKantong
            FROM DeliveryOrderDetail
            GROUP BY DeliveryOrderID
        )
        SELECT
            do_.DeliveryOrderID,
            do_.VoucherNo,
            ISNULL(bp.Name, 'Tidak Diketahui') AS CustomerName,
            do_.TransDate,
            vm.ArmadaID,
            ISNULL(dq.TotalKantong, 0) AS TotalKantong
        FROM DeliveryOrder do_
        JOIN VehicleMap vm ON do_.VehicleNo <> '' AND (do_.VehicleNo = vm.Key1 OR do_.VehicleNo = vm.Key2 OR do_.VehicleNo = vm.Key3)
        LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
        LEFT JOIN DoQty dq ON dq.DeliveryOrderID = do_.DeliveryOrderID
        WHERE do_.IsDeleted = 0
          -- Plain WIB-calendar-date match, NOT the 14:00-WIB-rollover window
          -- used elsewhere in this file (JamJadwal) — deliberately
          -- different. Every row reaching this query is, by construction,
          -- desktop-ERP-originated (the NOT EXISTS below excludes anything
          -- this dashboard itself created), and confirmed live that the
          -- desktop app writes TransDate as a NAIVE WIB wall-clock value
          -- (no UTC shift), NOT true UTC like this dashboard's own
          -- GETDATE()/resolveBusinessDateTime writes. The rollover window
          -- (originally used here too) was designed for true-UTC values
          -- AND additionally re-interprets any time-of-day >= 14:00 WIB as
          -- "belongs to the next business day" — appropriate for a
          -- dispatcher actively picking a JamJadwal, wrong for an
          -- already-dated ERP document where the time-of-day is often just
          -- incidental (e.g. a DO manually dated a day ahead for regulatory
          -- reasons keeps whatever time-of-day the desktop app auto-filled,
          -- with no intent to shift days). Confirmed live: DO
          -- MKE/DO/003707/2026-07/003/001, TransDate '2026-07-30 15:17:39'
          -- (WIB), was showing under businessDate 2026-07-31 with the old
          -- window — this plain date match correctly shows it under
          -- 2026-07-30 instead.
          AND CAST(do_.TransDate AS DATE) = @businessDate
          -- Excludes any DO already scheduled through this dashboard's own
          -- Jadwal flow, so it renders as a real Jadwal card instead of
          -- being double-counted here as an "external" one.
          AND NOT EXISTS (
              SELECT 1 FROM DashboardPengirimanJadwalDetail jd
              WHERE jd.DeliveryOrderID = do_.DeliveryOrderID AND jd.IsDeleted = 0
          )
        ORDER BY do_.TransDate
      `),
    getPabrikLocation(),
  ]);

  const jadwalRows = jadwalResult.recordset as Omit<JadwalCard, "JamKembaliAktual">[];
  const [travelByJadwalId, jamKembaliMap] = await Promise.all([
    estimateTravelMinutesForJadwal(pool, pabrik, jadwalRows),
    getJamKembaliAktualMap(jadwalRows.map((jr) => jr.JadwalID)),
  ]);
  const jadwal: JadwalCard[] = jadwalRows.map((jr) => ({
    ...jr,
    EstimasiDurasiMenit: jr.EstimasiDurasiMenit + (travelByJadwalId.get(jr.JadwalID) ?? 0),
    JamKembaliAktual: jamKembaliMap.get(jr.JadwalID) ?? null,
  }));

  return { armada, jadwal, externalDeliveries: externalResult.recordset };
}

// Bulk-resolves the travel-time component of EstimasiDurasiMenit for every
// Jadwal on the board in a single extra query (rather than one round-trip
// per Jadwal) — fetches every stop's coordinates grouped by JadwalID
// (ordered by Urutan, though the haversine estimate is order-sensitive only
// in aggregate distance, not in a way that matters for a rough estimate),
// then per Jadwal prefers the real OSRM DurasiMenit (Terbit, already
// travel-only — see startBerangkat) over the haversine heuristic (Draft, or
// a legacy Terbit row created before DurasiMenit existed).
async function estimateTravelMinutesForJadwal(
  pool: sql.ConnectionPool,
  pabrik: { latitude: number; longitude: number },
  jadwalRows: Omit<JadwalCard, "JamKembaliAktual">[]
): Promise<Map<number, number>> {
  const travelByJadwalId = new Map<number, number>();
  if (jadwalRows.length === 0) return travelByJadwalId;

  const request = pool.request();
  const placeholders = jadwalRows.map((jr, i) => {
    request.input(`jid${i}`, sql.Int, jr.JadwalID);
    return `@jid${i}`;
  });
  const stopsResult = await request.query(`
    SELECT jd.JadwalID, ml.Latitude, ml.Longitude
    FROM DashboardPengirimanJadwalDetail jd
    JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
    LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = so.BusinessPartnerID
    WHERE jd.JadwalID IN (${placeholders.join(",")}) AND jd.IsDeleted = 0
    ORDER BY jd.JadwalID, jd.Urutan
  `);
  const stopsByJadwal = new Map<number, LatLng[]>();
  for (const row of stopsResult.recordset as { JadwalID: number; Latitude: number | null; Longitude: number | null }[]) {
    if (row.Latitude == null || row.Longitude == null) continue;
    const arr = stopsByJadwal.get(row.JadwalID) ?? [];
    arr.push({ lat: row.Latitude, lng: row.Longitude });
    stopsByJadwal.set(row.JadwalID, arr);
  }

  const pabrikLatLng: LatLng = { lat: pabrik.latitude, lng: pabrik.longitude };
  for (const jr of jadwalRows) {
    const travel = jr.DurasiMenit ?? estimateTravelMinutes(pabrikLatLng, stopsByJadwal.get(jr.JadwalID) ?? []);
    travelByJadwalId.set(jr.JadwalID, travel);
  }
  return travelByJadwalId;
}

export interface JadwalDetailRow {
  JadwalDetailID: number;
  SalesOrderID: string;
  DeliveryOrderID: string | null;
  Urutan: number;
  CustomerName: string;
  Qty: number;
  // Portion of Qty that's free/bonus (not billed) — always <= Qty.
  BonusQty: number;
  // Raw (un-halved) per-kemasan bag counts — see formatKemasanQty in
  // lib/format.ts. Qty10KG + Qty5KG/2 == Qty (the 10KG-equivalent total).
  Qty10KG: number;
  Qty5KG: number;
  Wilayah: string;
  Kecamatan: string | null;
  Alamat: string | null;
  MobileNo: string | null;
  Latitude: number | null;
  Longitude: number | null;
}

// Always sources customer/qty/address from SalesOrder/SalesOrderDetail via
// jd.SalesOrderID, uniformly for Draft and Terbit — DeliveryOrderID is
// bookkeeping only (set once real DO rows exist after publish), never a
// read dependency. Ordered by Urutan so this doubles as "the current stop
// order" for the route-validation UI.
export async function getJadwalDetail(jadwalId: number): Promise<JadwalDetailRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT
          jd.JadwalDetailID,
          jd.SalesOrderID,
          jd.DeliveryOrderID,
          jd.Urutan,
          bp.Name AS CustomerName,
          ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty,
          ISNULL(${JADWAL_BONUS_QTY_EXPR}, 0) AS BonusQty,
          ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KG,
          ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KG,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          bp.NPWPAddress AS Kecamatan,
          bp.Address AS Alamat,
          bp.MobileNo,
          ml.Latitude,
          ml.Longitude
      FROM DashboardPengirimanJadwalDetail jd
      JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
      JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = so.BusinessPartnerID
      WHERE jd.JadwalID = @jadwalId AND jd.IsDeleted = 0
      GROUP BY jd.JadwalDetailID, jd.SalesOrderID, jd.DeliveryOrderID, jd.Urutan,
               bp.Name, bp.NPWPName, bp.NPWPAddress, bp.Address, bp.MobileNo, ml.Latitude, ml.Longitude
      ORDER BY jd.Urutan
    `);
  return result.recordset;
}

export interface AvailableSalesOrder {
  SalesOrderID: string;
  VoucherNo: string;
  CustomerName: string;
  Wilayah: string;
  Qty: number;
  // Raw (un-halved) per-kemasan bag counts — see formatKemasanQty in
  // lib/format.ts.
  Qty10KG: number;
  Qty5KG: number;
  DueDate: string | Date | null;
}

// SO is "available" for a departure on businessDate when: it's due within
// the last 7 days up to and including that day (a DueDate is the earliest
// it can ship, not the only day it can ship — an order that's overdue by a
// few days still needs to go out, so it stays available on later
// businessDates too, not just its original due date. Capped at 7 days back
// rather than left unbounded: the live SalesOrder table carries thousands
// of IsClosed=0 rows going back to 2018 that were evidently fulfilled
// through a process this dashboard doesn't track, so an unbounded lower
// bound would flood the picker with years of stale, not-actually-pending
// orders), it's open (not closed/deleted), no DeliveryOrder has been
// created from it yet, and it isn't already sitting in another active
// (non-deleted) Jadwal's detail rows — draft or published. Ordered by
// TransDate descending (newest SO first) per business priority —
// most-recently-placed orders surface first in the picker.
const AVAILABLE_SO_LOOKBACK_DAYS = 7;

export async function getAvailableSalesOrders(businessDate: string): Promise<AvailableSalesOrder[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate)
    .input("lookbackDays", sql.Int, AVAILABLE_SO_LOOKBACK_DAYS).query(`
      SELECT
          so.SalesOrderID,
          so.VoucherNo,
          bp.Name AS CustomerName,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty,
          ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KG,
          ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KG,
          so.DueDate
      FROM SalesOrder so
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
      WHERE so.IsDeleted = 0
        AND so.IsClosed = 0
        -- Same 14:00-WIB-rollover window as getPengirimanBoard's businessDate
        -- (not plain midnight-to-midnight) — see the comment there.
        AND so.DueDate >= DATEADD(DAY, -@lookbackDays, DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME))))
        AND so.DueDate < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
        AND NOT EXISTS (
          SELECT 1 FROM DeliveryOrder do_ WHERE do_.SalesOrderID = so.SalesOrderID AND do_.IsDeleted = 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM DashboardPengirimanJadwalDetail jd
          JOIN DashboardPengirimanJadwal j ON j.JadwalID = jd.JadwalID
          WHERE jd.SalesOrderID = so.SalesOrderID AND jd.IsDeleted = 0 AND j.IsDeleted = 0
        )
      GROUP BY so.SalesOrderID, so.VoucherNo, bp.Name, bp.NPWPName, so.DueDate, so.TransDate
      ORDER BY so.TransDate DESC
    `);
  return result.recordset;
}

// Sums the kantong quantity (same 5KG-halved convention as JADWAL_KANTONG_EXPR)
// across an arbitrary set of SalesOrderIDs — shared by the capacity check at
// draft creation and at "Tambahkan" time.
async function sumSalesOrderQty(pool: sql.ConnectionPool, salesOrderIds: string[]): Promise<number> {
  if (salesOrderIds.length === 0) return 0;
  const request = pool.request();
  const placeholders = salesOrderIds.map((id, i) => {
    request.input(`so${i}`, sql.VarChar(16), id);
    return `@so${i}`;
  });
  const result = await request.query(`
    SELECT ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS TotalQty
    FROM SalesOrderDetail sod
    WHERE sod.SalesOrderID IN (${placeholders.join(",")})
  `);
  return (result.recordset[0]?.TotalQty as number | null) ?? 0;
}

// Hard-blocks a total kantong load exceeding the Armada's KapasitasMaks — a
// null KapasitasMaks means no limit has been configured yet, so the check is
// skipped rather than blocking everything.
async function assertWithinCapacity(pool: sql.ConnectionPool, armadaId: number, totalQty: number): Promise<void> {
  const armadaResult = await pool
    .request()
    .input("armadaId", sql.Int, armadaId)
    .query(`SELECT KapasitasMaks FROM DashboardArmada WHERE ArmadaID = @armadaId AND IsDeleted = 0`);
  const kapasitasMaks = (armadaResult.recordset[0] as { KapasitasMaks: number | null } | undefined)?.KapasitasMaks;
  if (kapasitasMaks != null && totalQty > kapasitasMaks) {
    throw new Error(`Total muatan (${totalQty} kantong) melebihi kapasitas maksimum armada (${kapasitasMaks} kantong).`);
  }
}

// Single enforcement point for the rule that a departure can never be
// scheduled earlier than the Sales Order(s) it's delivering — a Jadwal
// can't exist before the order that created the need for it. Called from
// every path that sets or changes JamJadwal (createJadwalDraft,
// updateJadwalDriverTime, addSalesOrdersToJadwal) so there's exactly one
// place this rule lives, not one per call site.
async function assertJamJadwalNotBeforeOrders(pool: sql.ConnectionPool, salesOrderIds: string[], jamJadwal: Date): Promise<void> {
  if (salesOrderIds.length === 0) return;
  const request = pool.request();
  const placeholders = salesOrderIds.map((id, i) => {
    request.input(`so${i}`, sql.VarChar(16), id);
    return `@so${i}`;
  });
  const result = await request.query(`
    SELECT MAX(TransDate) AS MaxTransDate FROM SalesOrder WHERE SalesOrderID IN (${placeholders.join(",")})
  `);
  const maxTransDate = (result.recordset[0]?.MaxTransDate as Date | null) ?? null;
  if (maxTransDate && jamJadwal < maxTransDate) {
    throw new Error(
      `Waktu pengiriman (${formatDate(jamJadwal)} ${formatTime(jamJadwal)}) tidak boleh sebelum waktu pemesanan SO terkait (${formatDate(maxTransDate)} ${formatTime(maxTransDate)}).`
    );
  }
}

// Companion to assertJamJadwalNotBeforeOrders, used by "Gabungkan jadi
// Jadwal" (mergeExternalDeliveriesIntoJadwal/appendRowsToDraft) instead of
// it. That flow backfills a Draft from DeliveryOrders that already exist in
// the desktop ERP — there's no "pick a later time instead" escape hatch
// like every other write path has, since the DO already happened at a
// fixed moment. SalesOrder.TransDate on these routinely drifts to sit
// after that moment (same same-day-edit staleness documented on
// assertJamJadwalNotBeforeOrders itself), so rather than blocking the
// merge, this pulls the offending SalesOrder(s)' TransDate back to
// jamJadwal — fixing the stale order time instead of working around it.
async function overwriteOrderTimeIfAfter(pool: sql.ConnectionPool, salesOrderIds: string[], jamJadwal: Date): Promise<void> {
  if (salesOrderIds.length === 0) return;
  const request = pool.request();
  const placeholders = salesOrderIds.map((id, i) => {
    request.input(`so${i}`, sql.VarChar(16), id);
    return `@so${i}`;
  });
  request.input("jamJadwal", sql.DateTime, jamJadwal);
  await request.query(`
    UPDATE SalesOrder SET TransDate = @jamJadwal, ModifiedDate = GETDATE()
    WHERE SalesOrderID IN (${placeholders.join(",")}) AND TransDate > @jamJadwal
  `);
}

// Resolves lat/lng/qty for an arbitrary set of SalesOrderIDs in one query —
// shared by the busy-window estimate below. A SO with no saved mitra
// location maps to null so its bongkar time is still counted (via
// estimateBusyMinutes) even though it can't contribute to the travel leg.
async function getStopLocationsForSalesOrders(
  pool: sql.ConnectionPool,
  salesOrderIds: string[]
): Promise<Map<string, { lat: number; lng: number; qty: number } | null>> {
  const map = new Map<string, { lat: number; lng: number; qty: number } | null>();
  if (salesOrderIds.length === 0) return map;
  const request = pool.request();
  const placeholders = salesOrderIds.map((id, i) => {
    request.input(`so${i}`, sql.VarChar(16), id);
    return `@so${i}`;
  });
  const result = await request.query(`
    SELECT so.SalesOrderID, ml.Latitude, ml.Longitude, ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty
    FROM SalesOrder so
    LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
    LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = so.BusinessPartnerID
    WHERE so.SalesOrderID IN (${placeholders.join(",")})
    GROUP BY so.SalesOrderID, ml.Latitude, ml.Longitude
  `);
  for (const row of result.recordset as { SalesOrderID: string; Latitude: number | null; Longitude: number | null; Qty: number }[]) {
    map.set(row.SalesOrderID, row.Latitude != null && row.Longitude != null ? { lat: row.Latitude, lng: row.Longitude, qty: row.Qty } : null);
  }
  return map;
}

// Estimated total busy duration (bongkar + travel) for an ordered list of
// SalesOrderIDs — same shape as EstimasiDurasiMenit on the board, usable
// both for a not-yet-created candidate Jadwal (createJadwalDraft) and for
// an existing one (getJadwalBusyWindow passes its own SalesOrderIDs in
// Urutan order). realTravelMinutes overrides the haversine heuristic
// whenever a real OSRM duration is already known (Terbit) — see
// estimateTravelMinutesForJadwal for the same convention on the board.
async function estimateBusyMinutes(
  pool: sql.ConnectionPool,
  pabrik: LatLng,
  orderedSalesOrderIds: string[],
  realTravelMinutes: number | null
): Promise<number> {
  if (orderedSalesOrderIds.length === 0) return 0;
  const locations = await getStopLocationsForSalesOrders(pool, orderedSalesOrderIds);
  let bongkarMinutes = 0;
  const travelStops: LatLng[] = [];
  for (const id of orderedSalesOrderIds) {
    const loc = locations.get(id) ?? null;
    bongkarMinutes += estimateDeliveryMinutes(loc?.qty ?? 0);
    if (loc) travelStops.push({ lat: loc.lat, lng: loc.lng });
  }
  const travelMinutes = realTravelMinutes ?? estimateTravelMinutes(pabrik, travelStops);
  // Floored to at least 1 minute whenever there's at least one stop: a
  // SalesOrder with a 0-qty detail line (seen live on a handful of old
  // "Retail / Direct Sales" adjustment orders) would otherwise produce an
  // exactly-zero-width window, which the overlap check's strict `<`
  // comparison (findOverlappingJadwalForArmada) never flags as conflicting
  // with anything — not even another Jadwal starting at that exact same
  // instant. A departure always occupies at least a moment of the armada's
  // time, degenerate cargo or not.
  return Math.max(1, bongkarMinutes + travelMinutes);
}

interface JadwalBusyWindow {
  jadwalId: number;
  status: JadwalStatus;
  start: Date;
  end: Date;
}

// An armada's estimated occupied window for one Jadwal: JamJadwal through
// JamJadwal + its own estimated busy duration (see estimateBusyMinutes).
async function getJadwalBusyWindow(pool: sql.ConnectionPool, pabrik: LatLng, jadwalId: number): Promise<JadwalBusyWindow | null> {
  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status, JamJadwal, DurasiMenit FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = header.recordset[0] as { Status: JadwalStatus; JamJadwal: Date; DurasiMenit: number | null } | undefined;
  if (!row) return null;

  const detailResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT SalesOrderID FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0 ORDER BY Urutan`);
  const salesOrderIds = (detailResult.recordset as { SalesOrderID: string }[]).map((r) => r.SalesOrderID);

  const minutes = await estimateBusyMinutes(pool, pabrik, salesOrderIds, row.Status === "Terbit" ? row.DurasiMenit : null);
  const start = row.JamJadwal;
  return { jadwalId, status: row.Status, start, end: new Date(start.getTime() + minutes * 60 * 1000) };
}

// Hard rule: one armada cannot have two Jadwal (Draft or Terbit) with
// overlapping estimated busy windows — see EstimasiDurasiMenit /
// getJadwalBusyWindow above. Searches a +/-1 day window around the
// candidate start (a single delivery run never spans longer than that) so
// this stays a couple of cheap queries instead of scanning the whole table.
async function findOverlappingJadwalForArmada(
  pool: sql.ConnectionPool,
  pabrik: LatLng,
  armadaId: number,
  candidateStart: Date,
  candidateEnd: Date,
  excludeJadwalId: number | null
): Promise<JadwalBusyWindow | null> {
  const dayMs = 24 * 60 * 60 * 1000;
  const request = pool
    .request()
    .input("armadaId", sql.Int, armadaId)
    .input("from", sql.DateTime, new Date(candidateStart.getTime() - dayMs))
    .input("to", sql.DateTime, new Date(candidateStart.getTime() + dayMs));
  if (excludeJadwalId != null) request.input("excludeJadwalId", sql.Int, excludeJadwalId);
  const result = await request.query(`
      SELECT JadwalID FROM DashboardPengirimanJadwal
      WHERE ArmadaID = @armadaId AND IsDeleted = 0 AND Status IN ('Draft', 'Terbit')
        AND JamJadwal >= @from AND JamJadwal <= @to
        ${excludeJadwalId != null ? "AND JadwalID <> @excludeJadwalId" : ""}
      ORDER BY JamJadwal
    `);
  for (const row of result.recordset as { JadwalID: number }[]) {
    const window = await getJadwalBusyWindow(pool, pabrik, row.JadwalID);
    if (window && window.start < candidateEnd && candidateStart < window.end) {
      return window;
    }
  }
  return null;
}

// Moves every JadwalDetail row from `sourceJadwalId` onto `targetJadwalId`
// (continuing target's own Urutan) and soft-deletes the now-empty source
// header — used when updateJadwalDriverTime retimes a Draft into another
// Draft's estimated busy window (see findOverlappingJadwalForArmada). Rows
// keep their own JadwalDetailID and DeliveryOrderID untouched (only JadwalID
// + Urutan change), so a source Draft that was itself backfilled from real
// ERP DOs (mergeExternalDeliveriesIntoJadwal) carries its real
// DeliveryOrderID across the merge correctly.
async function mergeJadwalInto(
  pool: sql.ConnectionPool,
  sourceJadwalId: number,
  targetJadwalId: number,
  // Same override as updateJadwalDriverTime's own skipOrderTimeCheck (see
  // its comment) — Validasi Rute's manual edit can land the source's new
  // time inside an existing Draft's busy window, forcing a merge, and this
  // check must not reintroduce the lockout for a target time staff didn't
  // even choose directly. updateJadwalArmada's drag-and-drop call site
  // leaves this false, keeping strict behavior there.
  skipOrderTimeCheck = false
): Promise<void> {
  const targetHeader = await pool
    .request()
    .input("jadwalId", sql.Int, targetJadwalId)
    .query(`SELECT ArmadaID, JamJadwal FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const targetRow = targetHeader.recordset[0] as { ArmadaID: number; JamJadwal: Date } | undefined;
  if (!targetRow) throw new Error("Keberangkatan tujuan penggabungan tidak ditemukan.");

  const sourceDetails = await pool
    .request()
    .input("jadwalId", sql.Int, sourceJadwalId)
    .query(`SELECT JadwalDetailID, SalesOrderID FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0 ORDER BY Urutan`);
  const sourceRows = sourceDetails.recordset as { JadwalDetailID: number; SalesOrderID: string }[];
  if (sourceRows.length === 0) return;

  if (!skipOrderTimeCheck) {
    await assertJamJadwalNotBeforeOrders(
      pool,
      sourceRows.map((r) => r.SalesOrderID),
      targetRow.JamJadwal
    );
  }

  const existing = await pool
    .request()
    .input("jadwalId", sql.Int, targetJadwalId)
    .query(`SELECT SalesOrderID, Urutan FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const existingRows = existing.recordset as { SalesOrderID: string; Urutan: number }[];
  const maxUrutan = existingRows.reduce((max, r) => Math.max(max, r.Urutan), -1);

  const totalQty = await sumSalesOrderQty(pool, [...existingRows.map((r) => r.SalesOrderID), ...sourceRows.map((r) => r.SalesOrderID)]);
  await assertWithinCapacity(pool, targetRow.ArmadaID, totalQty);

  for (let i = 0; i < sourceRows.length; i++) {
    await pool
      .request()
      .input("detailId", sql.Int, sourceRows[i].JadwalDetailID)
      .input("targetJadwalId", sql.Int, targetJadwalId)
      .input("urutan", sql.Int, maxUrutan + 1 + i)
      .query(`UPDATE DashboardPengirimanJadwalDetail SET JadwalID = @targetJadwalId, Urutan = @urutan WHERE JadwalDetailID = @detailId`);
  }

  await pool
    .request()
    .input("jadwalId", sql.Int, sourceJadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}

// Appends fresh JadwalDetail rows (each optionally carrying an already-real
// DeliveryOrderID) onto an existing Draft — the mergeExternalDeliveriesIntoJadwal
// counterpart to mergeJadwalInto above: there the rows already exist and get
// moved, here they don't exist yet and get inserted. Kept separate from
// addSalesOrdersToJadwal (which always inserts DeliveryOrderID = NULL) since
// external DOs already have a real one that must be preserved.
async function appendRowsToDraft(
  pool: sql.ConnectionPool,
  targetJadwalId: number,
  rows: { salesOrderId: string; deliveryOrderId: string | null }[]
): Promise<void> {
  const header = await pool
    .request()
    .input("jadwalId", sql.Int, targetJadwalId)
    .query(`SELECT ArmadaID, JamJadwal FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; JamJadwal: Date } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tujuan penggabungan tidak ditemukan.");

  const newSalesOrderIds = rows.map((r) => r.salesOrderId);
  await overwriteOrderTimeIfAfter(pool, newSalesOrderIds, headerRow.JamJadwal);

  const existing = await pool
    .request()
    .input("jadwalId", sql.Int, targetJadwalId)
    .query(`SELECT SalesOrderID, Urutan FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const existingRows = existing.recordset as { SalesOrderID: string; Urutan: number }[];
  const maxUrutan = existingRows.reduce((max, r) => Math.max(max, r.Urutan), -1);

  const totalQty = await sumSalesOrderQty(pool, [...existingRows.map((r) => r.SalesOrderID), ...newSalesOrderIds]);
  await assertWithinCapacity(pool, headerRow.ArmadaID, totalQty);

  await insertJadwalDetailRows(pool, targetJadwalId, rows, maxUrutan + 1);
}

// Shared insert loop for JadwalDetail rows that already know their
// DeliveryOrderID (or explicitly have none) — used both when
// mergeExternalDeliveriesIntoJadwal creates a brand new Draft and when it
// appends onto an existing one (appendRowsToDraft above).
async function insertJadwalDetailRows(
  pool: sql.ConnectionPool,
  jadwalId: number,
  rows: { salesOrderId: string; deliveryOrderId: string | null }[],
  startUrutan: number
): Promise<void> {
  for (let i = 0; i < rows.length; i++) {
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .input("soId", sql.VarChar(16), rows[i].salesOrderId)
      .input("doId", sql.VarChar(16), rows[i].deliveryOrderId)
      .input("urutan", sql.Int, startUrutan + i).query(`
        INSERT INTO DashboardPengirimanJadwalDetail (JadwalID, SalesOrderID, DeliveryOrderID, Urutan, IsDeleted)
        VALUES (@jadwalId, @soId, @doId, @urutan, 0)
      `);
  }
}

// Finds a still-open Draft already scheduled for the exact same Armada +
// departure time, so a second (or third...) Pemesanan aimed at the same
// trip joins it as another stop instead of spawning a sibling Jadwal that
// would otherwise render exactly on top of it on the Papan Pengiriman
// timeline. Only Draft matters here — a Terbit Jadwal already has real
// DeliveryOrder documents and addSalesOrdersToJadwal refuses those anyway.
export async function findDraftJadwalByArmadaAndTime(armadaId: number, jamJadwal: Date): Promise<number | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("armadaId", sql.Int, armadaId)
    .input("jamJadwal", sql.DateTime, jamJadwal).query(`
      SELECT TOP 1 JadwalID FROM DashboardPengirimanJadwal
      WHERE ArmadaID = @armadaId AND JamJadwal = @jamJadwal AND Status = 'Draft' AND IsDeleted = 0
      ORDER BY JadwalID
    `);
  const row = result.recordset[0] as { JadwalID: number } | undefined;
  return row?.JadwalID ?? null;
}

export async function createJadwalDraft(input: {
  armadaId: number;
  jamJadwal: Date;
  salesOrderIds: string[];
}): Promise<number> {
  const pool = await getPool();

  const totalQty = await sumSalesOrderQty(pool, input.salesOrderIds);
  await assertWithinCapacity(pool, input.armadaId, totalQty);
  await assertJamJadwalNotBeforeOrders(pool, input.salesOrderIds, input.jamJadwal);

  // An armada can't have two Jadwal with overlapping estimated busy windows
  // (see findOverlappingJadwalForArmada) — a new departure whose window
  // falls inside an already-Draft one for the same armada joins it as more
  // stops instead of spawning a sibling Jadwal that would otherwise render
  // on top of it on the Papan Pengiriman timeline. Overlapping an already-
  // Terbit Jadwal is a hard block instead: real DeliveryOrder documents
  // already exist for that trip, so there's nothing to merge into.
  const pabrikLocation = await getPabrikLocation();
  const pabrikLatLng: LatLng = { lat: pabrikLocation.latitude, lng: pabrikLocation.longitude };
  const candidateMinutes = await estimateBusyMinutes(pool, pabrikLatLng, input.salesOrderIds, null);
  const candidateEnd = new Date(input.jamJadwal.getTime() + candidateMinutes * 60 * 1000);
  const conflict = await findOverlappingJadwalForArmada(pool, pabrikLatLng, input.armadaId, input.jamJadwal, candidateEnd, null);
  if (conflict) {
    if (conflict.status === "Terbit") {
      throw new Error(
        `Armada ini diperkirakan masih dalam perjalanan (berangkat, estimasi kembali ${formatTime(conflict.end)}) — tidak bisa membuat keberangkatan baru yang tumpang tindih waktunya.`
      );
    }
    await addSalesOrdersToJadwal(conflict.jadwalId, input.salesOrderIds);
    return conflict.jadwalId;
  }

  const result = await pool
    .request()
    .input("armadaId", sql.Int, input.armadaId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal).query(`
      INSERT INTO DashboardPengirimanJadwal (ArmadaID, SalesmanID, JamJadwal, Status, IsDeleted, ModifiedDate)
      OUTPUT inserted.JadwalID
      VALUES (@armadaId, NULL, @jamJadwal, 'Draft', 0, GETDATE())
    `);
  const jadwalId = (result.recordset[0] as { JadwalID: number }).JadwalID;

  try {
    for (let i = 0; i < input.salesOrderIds.length; i++) {
      await pool
        .request()
        .input("jadwalId", sql.Int, jadwalId)
        .input("soId", sql.VarChar(16), input.salesOrderIds[i])
        .input("urutan", sql.Int, i)
        .query(`
          INSERT INTO DashboardPengirimanJadwalDetail (JadwalID, SalesOrderID, DeliveryOrderID, Urutan, IsDeleted)
          VALUES (@jadwalId, @soId, NULL, @urutan, 0)
        `);
    }
  } catch (err) {
    // Same compensating-cleanup discipline as the rest of this file's
    // multi-step writes: don't leave a half-created draft visible.
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`UPDATE DashboardPengirimanJadwalDetail SET IsDeleted = 1 WHERE JadwalID = @jadwalId`);
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`UPDATE DashboardPengirimanJadwal SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
    throw err;
  }

  return jadwalId;
}

// Lets the merge dialog default its departure-time input to a value that's
// guaranteed to satisfy assertJamJadwalNotBeforeOrders, instead of guessing
// from a DeliveryOrder's own TransDate (which isn't reliably >= its own
// SalesOrder's TransDate — confirmed live, ~11% of DO/SO pairs disagree).
// Caller is expected to ceil-round the result to the next full minute
// before using it as an "HH:MM" input default, since that validation does a
// strict `<` compare against the full-precision SalesOrder.TransDate.
export async function getMaxSalesOrderTransDateForDeliveries(deliveryOrderIds: string[]): Promise<Date | null> {
  if (deliveryOrderIds.length === 0) return null;
  const pool = await getPool();
  const request = pool.request();
  const placeholders = deliveryOrderIds.map((id, i) => {
    request.input(`do${i}`, sql.VarChar(16), id);
    return `@do${i}`;
  });
  const result = await request.query(`
    SELECT MAX(so.TransDate) AS MaxTransDate
    FROM DeliveryOrder do_
    JOIN SalesOrder so ON so.SalesOrderID = do_.SalesOrderID
    WHERE do_.DeliveryOrderID IN (${placeholders.join(",")})
  `);
  return (result.recordset[0]?.MaxTransDate as Date | null) ?? null;
}

// Backfills a real Draft Jadwal from DeliveryOrder rows that already exist
// (created directly in the desktop ERP, never scheduled through this
// dashboard — see ExternalDelivery / [[papan-pengiriman-external-do]]).
// Deliberately created as Status='Draft', NOT 'Terbit', even though real
// DeliveryOrder documents already exist for every stop — this is what
// unlocks full editing (JamJadwal, driver, stop order) through the
// existing Validasi Rute UI, since updateJadwalDriverTime hard-refuses any
// change once Status='Terbit'. The cosmetic cost: the card reads "Draft"
// for shipments that, in reality, already happened. Each JadwalDetail row
// gets a real DeliveryOrderID (unlike a normal Draft, where it's always
// NULL until startBerangkat) — this is intentional and safe: startBerangkat's
// per-row loop already skips creating a new DO whenever DeliveryOrderID is
// already set, so clicking "Berangkat" on this backfilled Draft later just
// transitions Status -> Terbit and computes a real OSRM route, without
// attempting to re-issue any of the already-real DOs.
export async function mergeExternalDeliveriesIntoJadwal(
  armadaId: number,
  deliveryOrderIds: string[],
  jamJadwal: Date
): Promise<number> {
  if (deliveryOrderIds.length === 0) throw new Error("Tidak ada DO yang dipilih.");
  const pool = await getPool();

  const request = pool.request();
  const placeholders = deliveryOrderIds.map((id, i) => {
    request.input(`do${i}`, sql.VarChar(16), id);
    return `@do${i}`;
  });
  const doResult = await request.query(`
    SELECT do_.DeliveryOrderID, do_.SalesOrderID, do_.TransDate
    FROM DeliveryOrder do_
    WHERE do_.DeliveryOrderID IN (${placeholders.join(",")}) AND do_.IsDeleted = 0
      AND NOT EXISTS (
          SELECT 1 FROM DashboardPengirimanJadwalDetail jd
          WHERE jd.DeliveryOrderID = do_.DeliveryOrderID AND jd.IsDeleted = 0
      )
  `);
  const doRows = (doResult.recordset as { DeliveryOrderID: string; SalesOrderID: string; TransDate: Date }[]).sort(
    (a, b) => a.TransDate.getTime() - b.TransDate.getTime()
  );
  if (doRows.length === 0) throw new Error("DO yang dipilih tidak ditemukan atau sudah masuk Jadwal lain.");

  await overwriteOrderTimeIfAfter(
    pool,
    doRows.map((r) => r.SalesOrderID),
    jamJadwal
  );

  // Same armada-overlap rule as createJadwalDraft (see there for the full
  // rationale) — a backfilled Draft from real ERP DOs is still a Jadwal
  // like any other, so it can't sit on top of an existing one for the same
  // armada either. Appends onto the conflicting Draft (appendRowsToDraft)
  // instead of creating a header at all when that's the outcome.
  const pabrikLocation = await getPabrikLocation();
  const pabrikLatLng: LatLng = { lat: pabrikLocation.latitude, lng: pabrikLocation.longitude };
  const candidateMinutes = await estimateBusyMinutes(
    pool,
    pabrikLatLng,
    doRows.map((r) => r.SalesOrderID),
    null
  );
  const candidateEnd = new Date(jamJadwal.getTime() + candidateMinutes * 60 * 1000);
  const conflict = await findOverlappingJadwalForArmada(pool, pabrikLatLng, armadaId, jamJadwal, candidateEnd, null);
  if (conflict) {
    if (conflict.status === "Terbit") {
      throw new Error(
        `Armada ini diperkirakan masih dalam perjalanan (estimasi kembali ${formatTime(conflict.end)}) — tidak bisa menggabungkan DO ke keberangkatan baru yang tumpang tindih waktunya.`
      );
    }
    await appendRowsToDraft(
      pool,
      conflict.jadwalId,
      doRows.map((r) => ({ salesOrderId: r.SalesOrderID, deliveryOrderId: r.DeliveryOrderID }))
    );
    return conflict.jadwalId;
  }

  const result = await pool
    .request()
    .input("armadaId", sql.Int, armadaId)
    .input("jamJadwal", sql.DateTime, jamJadwal).query(`
      INSERT INTO DashboardPengirimanJadwal (ArmadaID, SalesmanID, JamJadwal, Status, IsDeleted, ModifiedDate)
      OUTPUT inserted.JadwalID
      VALUES (@armadaId, NULL, @jamJadwal, 'Draft', 0, GETDATE())
    `);
  const jadwalId = (result.recordset[0] as { JadwalID: number }).JadwalID;

  try {
    await insertJadwalDetailRows(
      pool,
      jadwalId,
      doRows.map((r) => ({ salesOrderId: r.SalesOrderID, deliveryOrderId: r.DeliveryOrderID })),
      0
    );
  } catch (err) {
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`UPDATE DashboardPengirimanJadwalDetail SET IsDeleted = 1 WHERE JadwalID = @jadwalId`);
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`UPDATE DashboardPengirimanJadwal SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
    throw err;
  }

  return jadwalId;
}

export async function deleteJadwalDraft(jadwalId: number): Promise<void> {
  const pool = await getPool();
  const statusResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const status = (statusResult.recordset[0] as { Status: JadwalStatus } | undefined)?.Status;
  if (status !== "Draft") {
    throw new Error("Hanya keberangkatan berstatus Draft yang bisa dibatalkan.");
  }

  // Header first, details second: if the second statement never runs (e.g.
  // a connection drop between the two calls), the Jadwal is already
  // IsDeleted=1 — every read that joins through it (including
  // getAvailableSalesOrders's NOT EXISTS check, which requires
  // j.IsDeleted = 0) already treats its SOs as available again, so there's
  // no phantom "0 visible stops but still active" Draft possible even if
  // the detail cleanup below never completes.
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwalDetail SET IsDeleted = 1 WHERE JadwalID = @jadwalId`);
}

// Appends more SO deliveries to an existing Draft Jadwal — usable any time
// before Berangkat (including after Mulai Muat, since that's just a
// dashboard timestamp with no ERP-side consequence yet). Blocked once the
// Jadwal has already departed (Status='Terbit'), since real DeliveryOrder
// documents exist by then and this function has no notion of adding a line
// to an already-issued DO. Urutan continues from the current max so new
// stops land at the end of the route by default (still reorderable via
// drag-and-drop afterwards).
export async function addSalesOrdersToJadwal(jadwalId: number, salesOrderIds: string[]): Promise<void> {
  if (salesOrderIds.length === 0) return;
  const pool = await getPool();

  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT ArmadaID, Status, JamJadwal FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; Status: JadwalStatus; JamJadwal: Date } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new Error("Keberangkatan ini sudah berangkat, tidak bisa menambah SO.");
  await assertJamJadwalNotBeforeOrders(pool, salesOrderIds, headerRow.JamJadwal);

  const existing = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT SalesOrderID, Urutan FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const existingRows = existing.recordset as { SalesOrderID: string; Urutan: number }[];
  const maxUrutan = existingRows.reduce((max, r) => Math.max(max, r.Urutan), -1);

  const totalQty = await sumSalesOrderQty(pool, [...existingRows.map((r) => r.SalesOrderID), ...salesOrderIds]);
  await assertWithinCapacity(pool, headerRow.ArmadaID, totalQty);

  for (let i = 0; i < salesOrderIds.length; i++) {
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .input("soId", sql.VarChar(16), salesOrderIds[i])
      .input("urutan", sql.Int, maxUrutan + 1 + i)
      .query(`
        INSERT INTO DashboardPengirimanJadwalDetail (JadwalID, SalesOrderID, DeliveryOrderID, Urutan, IsDeleted)
        VALUES (@jadwalId, @soId, NULL, @urutan, 0)
      `);
  }
}

// Persists a manual drag-and-drop stop reorder — dashboard-only bookkeeping,
// touches no DeliveryOrder field, so it's safe to call regardless of
// Draft/Terbit status.
export async function updateJadwalUrutan(jadwalId: number, orderedDetailIds: number[]): Promise<void> {
  const pool = await getPool();
  for (let i = 0; i < orderedDetailIds.length; i++) {
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .input("detailId", sql.Int, orderedDetailIds[i])
      .input("urutan", sql.Int, i)
      .query(`UPDATE DashboardPengirimanJadwalDetail SET Urutan = @urutan WHERE JadwalID = @jadwalId AND JadwalDetailID = @detailId`);
  }
}

// Once a Jadwal is Terbit, a real DeliveryOrder (and, from a follow-up
// plan, a real SalesInvoice) already exists off it — nothing about the
// departure (time, driver, vehicle) may change through this dashboard
// anymore. This is a hard guard, not a soft warning: there is currently no
// correction/cancellation flow for an already-released DO, so this
// function simply refuses outright rather than silently cascading changes
// onto live documents the way it used to.
// Returns the JadwalID that now holds this data — normally the same
// jadwalId passed in, but if the new jamJadwal lands inside another Draft's
// estimated busy window for the same armada, this Jadwal gets merged into
// that one instead (see mergeJadwalInto) and the OTHER id comes back.
// Callers that chain more calls onto jadwalId afterwards (handleBerangkat)
// must use the returned id, not the one they passed in.
export async function updateJadwalDriverTime(
  jadwalId: number,
  input: { jamJadwal: Date; salesmanId: string | null },
  // skipOrderTimeCheck: Validasi Rute's own date/time editor is the
  // explicit manual override for exactly the "departure before the order
  // it's delivering" case assertJamJadwalNotBeforeOrders exists to catch —
  // real desktop-ERP SalesOrder.TransDate values aren't reliably "when the
  // order was placed" (confirmed live: routinely bumped by same-day edits
  // to a value later than an already-correct delivery slot), so re-running
  // that check against a value staff picked on purpose here would just
  // reintroduce the exact lockout it was meant to prevent. Defaults to
  // false so every other caller (createPemesanan/reschedulePemesanan in
  // pemesanan.ts, which explicitly document depending on this check) keeps
  // the strict behavior unchanged.
  options: { skipOrderTimeCheck?: boolean } = {}
): Promise<number> {
  const pool = await getPool();
  const current = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status, ArmadaID, JamJadwal FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = current.recordset[0] as { Status: JadwalStatus; ArmadaID: number; JamJadwal: Date } | undefined;
  if (!row) throw new Error("Keberangkatan tidak ditemukan.");
  if (row.Status === "Terbit") throw new Error("Keberangkatan ini sudah rilis — tidak bisa diubah lagi.");

  const detailResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT SalesOrderID FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const bundledSalesOrderIds = (detailResult.recordset as { SalesOrderID: string }[]).map((r) => r.SalesOrderID);
  if (!options.skipOrderTimeCheck) {
    await assertJamJadwalNotBeforeOrders(pool, bundledSalesOrderIds, input.jamJadwal);
  }

  // Only re-check the armada-overlap rule when the departure time is
  // actually moving — an unchanged time can't newly create an overlap that
  // wasn't already there (createJadwalDraft/mergeExternalDeliveriesIntoJadwal
  // already prevent one from existing in the first place), and this same
  // function also runs as a save-before-departing guard (handleBerangkat)
  // where the time is normally unchanged — skipping the check there avoids
  // a spurious self-lookup on every single departure.
  if (input.jamJadwal.getTime() !== row.JamJadwal.getTime()) {
    const pabrikLocation = await getPabrikLocation();
    const pabrikLatLng: LatLng = { lat: pabrikLocation.latitude, lng: pabrikLocation.longitude };
    const candidateMinutes = await estimateBusyMinutes(pool, pabrikLatLng, bundledSalesOrderIds, null);
    const candidateEnd = new Date(input.jamJadwal.getTime() + candidateMinutes * 60 * 1000);
    const conflict = await findOverlappingJadwalForArmada(pool, pabrikLatLng, row.ArmadaID, input.jamJadwal, candidateEnd, jadwalId);
    if (conflict) {
      if (conflict.status === "Terbit") {
        throw new Error(
          `Waktu baru ini tumpang tindih dengan armada yang diperkirakan masih dalam perjalanan (estimasi kembali ${formatTime(conflict.end)}) — tidak bisa diubah ke waktu tersebut.`
        );
      }
      await mergeJadwalInto(pool, jadwalId, conflict.jadwalId, options.skipOrderTimeCheck);
      return conflict.jadwalId;
    }
  }

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal)
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamJadwal = @jamJadwal, SalesmanID = @salesmanId, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);

  return jadwalId;
}

// Reassigns a Draft Jadwal to a different Armada — Papan Pengiriman's
// drag-and-drop-between-rows feature. jamJadwal is optional since a drag
// can move purely vertically (armada only, time unchanged) or diagonally
// (armada + time together in one drop); omitted, the existing JamJadwal
// carries over unchanged. Same overlap rule as the other write paths
// applies, but against the TARGET armada: a resulting window that lands
// inside an existing Draft there merges into it (mergeJadwalInto);
// overlapping a Terbit Jadwal on the target armada blocks the move
// outright. Returns the JadwalID that now holds the data — may differ
// from the one passed in if merged, same convention as
// updateJadwalDriverTime.
export async function updateJadwalArmada(jadwalId: number, newArmadaId: number, jamJadwal?: Date): Promise<number> {
  const pool = await getPool();
  const current = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status, ArmadaID, JamJadwal FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = current.recordset[0] as { Status: JadwalStatus; ArmadaID: number; JamJadwal: Date } | undefined;
  if (!row) throw new Error("Keberangkatan tidak ditemukan.");
  if (row.Status === "Terbit") throw new Error("Keberangkatan ini sudah rilis — tidak bisa diubah lagi.");

  const finalJamJadwal = jamJadwal ?? row.JamJadwal;
  if (row.ArmadaID === newArmadaId && finalJamJadwal.getTime() === row.JamJadwal.getTime()) {
    return jadwalId;
  }

  const targetArmada = await pool
    .request()
    .input("armadaId", sql.Int, newArmadaId)
    .query(`SELECT ArmadaID FROM DashboardArmada WHERE ArmadaID = @armadaId AND IsDeleted = 0`);
  if (!targetArmada.recordset[0]) throw new Error("Armada tujuan tidak ditemukan.");

  const detailResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT SalesOrderID FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const bundledSalesOrderIds = (detailResult.recordset as { SalesOrderID: string }[]).map((r) => r.SalesOrderID);
  await assertJamJadwalNotBeforeOrders(pool, bundledSalesOrderIds, finalJamJadwal);

  const totalQty = await sumSalesOrderQty(pool, bundledSalesOrderIds);
  await assertWithinCapacity(pool, newArmadaId, totalQty);

  const pabrikLocation = await getPabrikLocation();
  const pabrikLatLng: LatLng = { lat: pabrikLocation.latitude, lng: pabrikLocation.longitude };
  const candidateMinutes = await estimateBusyMinutes(pool, pabrikLatLng, bundledSalesOrderIds, null);
  const candidateEnd = new Date(finalJamJadwal.getTime() + candidateMinutes * 60 * 1000);
  const conflict = await findOverlappingJadwalForArmada(pool, pabrikLatLng, newArmadaId, finalJamJadwal, candidateEnd, jadwalId);
  if (conflict) {
    if (conflict.status === "Terbit") {
      throw new Error(
        `Armada tujuan diperkirakan masih dalam perjalanan (estimasi kembali ${formatTime(conflict.end)}) — tidak bisa dipindah ke sana pada waktu ini.`
      );
    }
    await mergeJadwalInto(pool, jadwalId, conflict.jadwalId);
    return conflict.jadwalId;
  }

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("armadaId", sql.Int, newArmadaId)
    .input("jamJadwal", sql.DateTime, finalJamJadwal)
    .query(`UPDATE DashboardPengirimanJadwal SET ArmadaID = @armadaId, JamJadwal = @jamJadwal, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);

  return jadwalId;
}

export async function startMuat(jadwalId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(
      `UPDATE DashboardPengirimanJadwal SET JamMulaiMuat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId AND Status = 'Draft'`
    );
}

const DOC_SUFFIX = "003/001";
const BRANCH_ID = "011";
const DEPARTMENT_ID = "0110";

async function nextDeliveryOrderId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderID AS INT)) AS MaxID FROM DeliveryOrder`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDeliveryOrderDetailId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderDetailID AS INT)) AS MaxID FROM DeliveryOrderDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDOVoucherSeq(pool: sql.ConnectionPool, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/DO/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq
      FROM DeliveryOrder
      WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

interface SalesOrderForPublish {
  BusinessPartnerID: string;
  DueDate: Date | null;
}
interface SalesOrderDetailForPublish {
  SalesOrderDetailID: string;
  ItemID: string;
  Name: string;
  Qty: number;
  Unit: string;
  Price: number;
  Amount: number;
}

// Draft -> Terbit, fired by clicking "Berangkat" (there is no separate
// "Terbitkan" step — route/driver validation already happened while the
// Jadwal sat in Draft, so Berangkat is both the real-world departure event
// and the moment the dashboard's SO selection becomes real DO documents).
// For each detail row (in Urutan order), creates one real DeliveryOrder +
// its DeliveryOrderDetail line(s) from the linked SalesOrder/SalesOrderDetail,
// shaped to match live-verified existing SO-linked DO rows exactly (see this
// plan's Global Constraints). Writes the new DeliveryOrderID back onto the
// detail row, then flips Jadwal.Status and sets JamAktualBerangkat together
// in the same atomic claim. On partial failure, soft-deletes only the
// DeliveryOrder/DeliveryOrderDetail rows this call itself created (not the
// Jadwal/SO selection) and rethrows — matching createJadwalDraft's own
// compensating-cleanup precedent, scoped to what this function owns.
export async function startBerangkat(jadwalId: number): Promise<void> {
  const pool = await getPool();

  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT ArmadaID, SalesmanID, Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; SalesmanID: string | null; Status: JadwalStatus } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new Error("Keberangkatan ini sudah berangkat.");
  if (!headerRow.SalesmanID) throw new Error("Driver wajib diisi sebelum berangkat.");

  // Server-side mirror of the client's mandatory route-computed check
  // (design spec: checked client- AND server-side) — a direct server-action
  // call bypassing the UI must not be able to skip it. Deliberately BEFORE
  // the departure claim below, so a failed route check never leaves the
  // Jadwal wrongly flipped to Terbit.
  const stopsForRouteCheck = await getJadwalDetail(jadwalId);
  if (stopsForRouteCheck.length === 0) throw new Error("Tidak ada SO pada keberangkatan ini.");
  const missingCoords = stopsForRouteCheck.some((s) => s.Latitude == null || s.Longitude == null);
  if (missingCoords) {
    throw new Error("Rute belum berhasil divalidasi — pastikan seluruh tujuan punya lokasi tersimpan.");
  }
  const pabrik = await getPabrikLocation();
  let validatedRoute: MultiPointRoute;
  try {
    validatedRoute = await getMultiPointRoute([
      { lat: pabrik.latitude, lng: pabrik.longitude },
      ...stopsForRouteCheck.map((s) => ({ lat: s.Latitude as number, lng: s.Longitude as number })),
      { lat: pabrik.latitude, lng: pabrik.longitude },
    ]);
  } catch {
    throw new Error("Rute belum berhasil divalidasi — pastikan seluruh tujuan punya lokasi tersimpan.");
  }

  // Server-side mirror of the capacity hard-block already enforced when SOs
  // are selected (createJadwalDraft / addSalesOrdersToJadwal) — re-checked
  // here too since an Armada's KapasitasMaks could in principle be edited
  // down after this Jadwal was assembled.
  const totalQty = stopsForRouteCheck.reduce((sum, s) => sum + s.Qty, 0);
  await assertWithinCapacity(pool, headerRow.ArmadaID, totalQty);

  // Atomically claim the departure: only succeeds if Status is still
  // 'Draft'. Guards against two racing startBerangkat calls for the same
  // jadwalId both passing the Status!=='Draft' check above and then both
  // creating a duplicate set of real DeliveryOrder/DeliveryOrderDetail rows.
  const claim = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jarakKM", sql.Decimal(10, 2), validatedRoute.distanceKm)
    .input("durasiMenit", sql.Int, Math.round(validatedRoute.durationMinutes))
    .query(
      `UPDATE DashboardPengirimanJadwal SET Status = 'Terbit', JamAktualBerangkat = GETDATE(), JarakKM = @jarakKM, DurasiMenit = @durasiMenit, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId AND Status = 'Draft'`
    );
  if (claim.rowsAffected[0] === 0) {
    throw new Error("Keberangkatan ini sudah berangkat atau sedang diproses.");
  }

  const createdDeliveryOrderIds: string[] = [];
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    const armadaResult = await pool
      .request()
      .input("armadaId", sql.Int, headerRow.ArmadaID).query(`
        SELECT a.Nama, ed.ExpeditionID, ed.VehicleNo
        FROM DashboardArmada a
        LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
        WHERE a.ArmadaID = @armadaId AND a.IsDeleted = 0
      `);
    const armadaRow = armadaResult.recordset[0] as
      | { Nama: string; ExpeditionID: string | null; VehicleNo: string | null }
      | undefined;
    // Departure assigns a real vehicle to a real ERP document — a
    // soft-deleted Armada (deleted after this Draft was created, before it
    // departed) must block departure rather than silently write a stale or
    // blank VehicleNo onto a permanent DeliveryOrder.
    if (!armadaRow) throw new Error("Armada sudah dihapus, tidak bisa berangkat.");
    // Prefers the real ERP plate (ExpeditionDetail.VehicleNo, linked via
    // Kelola Armada) over the dashboard's own nickname (DashboardArmada.Nama,
    // e.g. "GM 14") — this is what ends up on the printed DO, so it needs to
    // be the actual plate whenever the link exists. Falls back to Nama
    // (previous behavior) for any armada not yet linked, rather than
    // blocking departure over an incomplete data-linking task.
    const doVehicleNo = armadaRow.VehicleNo ?? armadaRow.Nama;
    const doExpeditionId = armadaRow.ExpeditionID ?? "";

    const details = await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`
        SELECT JadwalDetailID, SalesOrderID, DeliveryOrderID FROM DashboardPengirimanJadwalDetail
        WHERE JadwalID = @jadwalId AND IsDeleted = 0
        ORDER BY Urutan
      `);
    const detailRows = details.recordset as { JadwalDetailID: number; SalesOrderID: string; DeliveryOrderID: string | null }[];
    if (detailRows.length === 0) throw new Error("Tidak ada SO pada keberangkatan ini.");

    for (const detail of detailRows) {
      // Idempotent-retry guard: if a previous startBerangkat attempt already
      // created a DeliveryOrder for this detail row (and only failed later,
      // e.g. partway through this same loop), skip it instead of creating a
      // duplicate DO for the same SO. Also covers the merged-external-DO
      // case (mergeExternalDeliveriesIntoJadwal): that DO was already
      // issued by the desktop ERP, so it must never be re-created — but its
      // TransDate gets corrected to this now-confirmed departure moment
      // (same GETDATE() reference as JamAktualBerangkat above), since the
      // desktop app's original TransDate was just whenever the document was
      // typed in, not a real departure time.
      if (detail.DeliveryOrderID) {
        await pool
          .request()
          .input("doId", sql.VarChar(16), detail.DeliveryOrderID)
          .query(`UPDATE DeliveryOrder SET TransDate = GETDATE(), ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);
        continue;
      }

      const soResult = await pool
        .request()
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .query(`SELECT BusinessPartnerID, DueDate FROM SalesOrder WHERE SalesOrderID = @soId`);
      const so = soResult.recordset[0] as SalesOrderForPublish | undefined;
      if (!so) throw new Error(`Sales Order ${detail.SalesOrderID} tidak ditemukan.`);

      const sodResult = await pool
        .request()
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .query(`SELECT SalesOrderDetailID, ItemID, Name, Qty, Unit, Price, Amount FROM SalesOrderDetail WHERE SalesOrderID = @soId`);
      const soDetails = sodResult.recordset as SalesOrderDetailForPublish[];

      const deliveryOrderId = await nextDeliveryOrderId(pool);
      const voucherSeq = await nextDOVoucherSeq(pool, yearMonth);
      const voucherNo = `MKE/DO/${voucherSeq}/${yearMonth}/${DOC_SUFFIX}`;

      await pool
        .request()
        .input("id", sql.VarChar(16), deliveryOrderId)
        .input("voucherNo", sql.VarChar(128), voucherNo)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .input("vehicleNo", sql.VarChar(50), doVehicleNo)
        .input("expeditionId", sql.VarChar(16), doExpeditionId)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID)
        .input("dueDate", sql.DateTime, so.DueDate).query(`
          INSERT INTO DeliveryOrder
            (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
             IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
             BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
             ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
          VALUES
            (@id, @voucherNo, GETDATE(), @branchId, @departmentId, @bpId, '', @soId,
             0, @expeditionId, @vehicleNo, '', 0, GETDATE(), '', NULL,
             NULL, 0, '', 1, 1, @salesmanId, 0,
             '', @dueDate, '', '', NULL)
        `);
      createdDeliveryOrderIds.push(deliveryOrderId);

      for (const sod of soDetails) {
        const detailId = await nextDeliveryOrderDetailId(pool);
        await pool
          .request()
          .input("id", sql.VarChar(16), detailId)
          .input("doId", sql.VarChar(16), deliveryOrderId)
          .input("itemId", sql.VarChar(160), sod.ItemID)
          .input("name", sql.VarChar(160), sod.Name)
          .input("qty", sql.Decimal(23, 4), sod.Qty)
          .input("unit", sql.VarChar(8), sod.Unit)
          .input("price", sql.Decimal(23, 4), sod.Price)
          .input("amount", sql.Decimal(23, 4), sod.Amount)
          .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID).query(`
            INSERT INTO DeliveryOrderDetail
              (DeliveryOrderDetailID, DeliveryOrderID, ItemID, Qty, Unit, UnitRatio, Ratio, Price, Disc, DiscValue,
               DiscRp, Amount, Delivered, Name, Outstanding, Description, Cashback, SalesOrderDetailID)
            VALUES
              (@id, @doId, @itemId, @qty, @unit, @qty, 1, @price, 0, NULL,
               0, @amount, @qty, @name, @qty, NULL, 0, @soDetailId)
          `);
      }

      await pool
        .request()
        .input("detailId", sql.Int, detail.JadwalDetailID)
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .query(`UPDATE DashboardPengirimanJadwalDetail SET DeliveryOrderID = @doId WHERE JadwalDetailID = @detailId`);
    }
  } catch (err) {
    for (const doId of createdDeliveryOrderIds) {
      await pool
        .request()
        .input("doId", sql.VarChar(16), doId)
        .query(`UPDATE DeliveryOrder SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);
      await pool
        .request()
        .input("doId", sql.VarChar(16), doId)
        .query(`UPDATE DashboardPengirimanJadwalDetail SET DeliveryOrderID = NULL WHERE DeliveryOrderID = @doId`);
    }
    // The claim above already flipped Status to 'Terbit' and set
    // JamAktualBerangkat before this loop ran — a genuinely failed departure
    // attempt must revert both so it can be retried, on top of the
    // DeliveryOrder/JadwalDetail cleanup already done above.
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(
        `UPDATE DashboardPengirimanJadwal SET Status = 'Draft', JamAktualBerangkat = NULL, JarakKM = NULL, DurasiMenit = NULL, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`
      );
    throw err;
  }
}

// Detaches one SO from a Draft without disturbing the other SOs still
// bundled in it — the gap "Batalkan Draft" (whole-departure cancel) and
// "Tambahkan" (add-only) leave: there was no way to move a single stop to
// a different vehicle/time. If this was the last remaining stop, the
// now-empty Draft is cleaned up too, mirroring deleteJadwalDraft's own
// discipline of never leaving a visible-but-empty ghost Draft.
export async function removeSalesOrderFromJadwal(jadwalId: number, salesOrderId: string): Promise<void> {
  const pool = await getPool();
  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const status = (header.recordset[0] as { Status: JadwalStatus } | undefined)?.Status;
  if (status !== "Draft") {
    throw new Error("Hanya SO pada keberangkatan berstatus Draft yang bisa diubah penjadwalannya.");
  }

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("soId", sql.VarChar(16), salesOrderId)
    .query(`UPDATE DashboardPengirimanJadwalDetail SET IsDeleted = 1 WHERE JadwalID = @jadwalId AND SalesOrderID = @soId AND IsDeleted = 0`);

  const remaining = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT COUNT(*) AS Cnt FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const cnt = (remaining.recordset[0] as { Cnt: number }).Cnt;
  if (cnt === 0) {
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`UPDATE DashboardPengirimanJadwal SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
  }
}

export interface CurrentAssignment {
  jadwalId: number;
  armadaId: number;
  jamJadwal: Date;
  salesmanId: string | null;
}

// Resolves a Sales Order's current Draft assignment, if any — used to
// pre-fill "Ubah Pemesanan". Deliberately Draft-only (Status = 'Draft'):
// once a Jadwal is Terbit, reassigning driver/vehicle already has its own
// established path (RouteValidationDialog's "Simpan", which cascades onto
// the real DeliveryOrder) — that's a different edit surface from this one.
export async function getCurrentAssignment(salesOrderId: string): Promise<CurrentAssignment | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesOrderId", sql.VarChar(16), salesOrderId).query(`
      SELECT TOP 1 j.JadwalID, j.ArmadaID, j.JamJadwal, j.SalesmanID
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwal j ON j.JadwalID = jd.JadwalID AND j.IsDeleted = 0 AND j.Status = 'Draft'
      WHERE jd.SalesOrderID = @salesOrderId AND jd.IsDeleted = 0
      ORDER BY jd.JadwalDetailID DESC
    `);
  const row = result.recordset[0] as { JadwalID: number; ArmadaID: number; JamJadwal: Date; SalesmanID: string | null } | undefined;
  if (!row) return null;
  return { jadwalId: row.JadwalID, armadaId: row.ArmadaID, jamJadwal: row.JamJadwal, salesmanId: row.SalesmanID };
}
