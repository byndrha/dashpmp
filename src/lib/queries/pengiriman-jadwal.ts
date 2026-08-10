import { getPool, sql } from "@/lib/db";
import { getArmadaList, type ArmadaRow } from "@/lib/queries/armada";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { getMultiPointRoute, type MultiPointRoute } from "@/lib/osrm";
import { formatDate, formatTime } from "@/lib/format";
import { estimateDeliveryMinutes, CONFIRMATION_MINUTES_PER_STOP } from "@/lib/delivery-duration";
import { estimateTravelMinutes, estimateTripMinutes, type LatLng } from "@/lib/route-estimate";
import { getJamKembaliAktualMap } from "@/lib/queries/vehicle-check";
import { encodeInvoiceToken } from "@/lib/queries/invoice-public";
import { AppError } from "@/lib/action-result";

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
  // Set at selesaiMuat (loading finished, DO+SI created) — null until then,
  // and for every Jadwal created before this column existed. Drives the
  // board's new "Menunggu Keberangkatan" segment (JamSelesaiMuat ->
  // JamAktualBerangkat, open-ended while the latter is still null).
  JamSelesaiMuat: string | Date | null;
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
        -- StopDuration estimates each stop's on-site time (bongkar +
        -- driver-app confirmation) from its own kantong qty, then sums it
        -- per JadwalID so a Jadwal's timeline card width reflects the total
        -- time its stops need. The CASE mirrors estimateDeliveryMinutes in
        -- delivery-duration.ts exactly: piecewise-linear interpolation
        -- between reference points 0->0, 5->1, 10->3, 15->5, 20->7, 25->10,
        -- 30->13, 35->16, 40->20 (menit), then a flat 1-menit/kantong slope
        -- past 40. The "+ 3" mirrors CONFIRMATION_MINUTES_PER_STOP (same
        -- file) — fixed per-stop time for driver-app confirmation data
        -- entry, added outside the interpolation. ROUND(...,1) matches the
        -- TS side's rounding to avoid binary-float drift from the /5 steps.
        -- Needs its own per-stop (JadwalDetailID) grouping first — applying
        -- the formula to the Jadwal's already-combined TotalKantong instead
        -- would treat e.g. two 3-kantong stops as one 6-kantong block.
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
                   SUM(ROUND(CASE
                     WHEN Qty <= 0 THEN 0
                     WHEN Qty <= 5 THEN Qty / 5.0
                     WHEN Qty <= 10 THEN 1 + 2 * (Qty - 5) / 5.0
                     WHEN Qty <= 15 THEN 3 + 2 * (Qty - 10) / 5.0
                     WHEN Qty <= 20 THEN 5 + 2 * (Qty - 15) / 5.0
                     WHEN Qty <= 25 THEN 7 + 3 * (Qty - 20) / 5.0
                     WHEN Qty <= 30 THEN 10 + 3 * (Qty - 25) / 5.0
                     WHEN Qty <= 35 THEN 13 + 3 * (Qty - 30) / 5.0
                     WHEN Qty <= 40 THEN 16 + 4 * (Qty - 35) / 5.0
                     ELSE Qty - 20
                   END, 1) + 3) AS EstimasiDurasiMenit
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
            j.JamSelesaiMuat,
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
        GROUP BY j.JadwalID, j.ArmadaID, j.SalesmanID, sm.Name, j.JamJadwal, j.JamMulaiMuat, j.JamAktualBerangkat, j.JamSelesaiMuat, j.Status, j.JarakKM, j.DurasiMenit, sdur.EstimasiDurasiMenit
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

// Card status shown on the driver's own Tugas list — a 4th value not
// present in JadwalStatus itself ("Selesai") is derived here, never
// stored: true once every one of this Jadwal's stops has a
// DashboardPengirimanStopDelivery row with JamSelesai populated. See the
// design spec's "Perubahan Data Model" section for why this is computed
// rather than a new Jadwal.Status value.
export interface DriverJadwalCard {
  JadwalID: number;
  ArmadaNama: string;
  VehicleNo: string | null;
  JamJadwal: string | Date;
  Status: JadwalStatus;
  JamSelesaiMuat: string | Date | null;
  JamAktualBerangkat: string | Date | null;
  TotalStop: number;
  StopSelesai: number;
  TotalKantong: number;
  IsSelesai: boolean;
}

// dateISO is a 14:00-WIB-rollover business-date label (see ROLLOVER_HOUR
// in business-date.ts), same convention as everywhere else in this file —
// the driver's date picker on the Tugas screen (tugas-list.tsx) picks one
// calendar date as that label, and the results reflect that label's full
// [date-1 14:00 WIB, date 13:59 WIB) window, not just that calendar day's
// 00:00-23:59. Deliberately made consistent with the default "today" load
// (both this function's only two calling paths) rather than giving the
// picker its own, different date semantics.
//
// The StopAgg CTE pre-aggregates to exactly one row per JadwalDetailID
// BEFORE joining up to the Jadwal level — same reason getPengirimanBoard's
// own StopQty/StopDuration CTEs exist in this file: SalesOrderDetail is
// one-to-many per stop, so joining it directly at the Jadwal-grouped level
// would fan out and make COUNT(jd.JadwalDetailID)/SUM(...) count each stop
// once per its own SalesOrderDetail line instead of once per stop.
export async function getDriverJadwalList(salesmanId: string, dateISO: string): Promise<DriverJadwalCard[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("date", sql.Date, dateISO).query(`
      WITH StopAgg AS (
          SELECT jd.JadwalID, jd.JadwalDetailID,
                 ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Kantong,
                 CASE WHEN sd.JamSelesai IS NOT NULL THEN 1 ELSE 0 END AS IsSelesai
          FROM DashboardPengirimanJadwalDetail jd
          LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
          LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
          WHERE jd.IsDeleted = 0
          GROUP BY jd.JadwalID, jd.JadwalDetailID, sd.JamSelesai
      )
      SELECT
          j.JadwalID,
          a.Nama AS ArmadaNama,
          ed.VehicleNo,
          j.JamJadwal,
          j.Status,
          j.JamSelesaiMuat,
          j.JamAktualBerangkat,
          COUNT(sa.JadwalDetailID) AS TotalStop,
          SUM(sa.IsSelesai) AS StopSelesai,
          SUM(sa.Kantong) AS TotalKantong
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      JOIN StopAgg sa ON sa.JadwalID = j.JadwalID
      WHERE j.SalesmanID = @salesmanId AND j.IsDeleted = 0
        -- @date is a 14:00 WIB rollover business-date label, not a plain
        -- calendar date — the old CAST(JamJadwal AS DATE) = @date match
        -- silently dropped/misfiled any Jadwal scheduled after 14:00 WIB
        -- (it falls on the NEXT business date but the SAME calendar date's
        -- UTC-naive JamJadwal). Same window expression as
        -- getSatpamInspectionList/getDriverTimeline/getSatpamTimeline.
        AND j.JamJadwal >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@date AS DATETIME)))
        AND j.JamJadwal < DATEADD(HOUR, 7, CAST(@date AS DATETIME))
      GROUP BY j.JadwalID, a.Nama, ed.VehicleNo, j.JamJadwal, j.Status, j.JamSelesaiMuat, j.JamAktualBerangkat
      ORDER BY j.JamJadwal
    `);
  return (result.recordset as Omit<DriverJadwalCard, "IsSelesai">[]).map((r) => ({
    ...r,
    IsSelesai: r.TotalStop > 0 && r.StopSelesai === r.TotalStop,
  }));
}

export interface JadwalHeader {
  ArmadaNama: string;
  VehicleNo: string | null;
  // BBM budget inputs for the driver-app's Isi BBM screen: quota liters =
  // JarakKM * KonsumsiBBM (L/km), quota cost = quota liters *
  // BiayaBBMPerLiter. Any of these can be null (JarakKM unset on a Draft
  // Jadwal, or KonsumsiBBM/BiayaBBMPerLiter never configured on this
  // Armada) — the dialog falls back to "no split" when the quota can't be
  // computed.
  JarakKM: number | null;
  KonsumsiBBM: number | null;
  BiayaBBMPerLiter: number | null;
  QrMyPertaminaPath: string | null;
}

// Vehicle info for the Pengiriman screen's floating top bar ("Hino Truck •
// AE 9045 TK") — same Armada/ExpeditionDetail join as getDriverJadwalList
// above, just keyed directly by JadwalID since that screen already has the
// ID from the URL rather than a driver+date pair.
export async function getJadwalHeader(jadwalId: number): Promise<JadwalHeader> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT a.Nama AS ArmadaNama, ed.VehicleNo, j.JarakKM, a.KonsumsiBBM, a.BiayaBBMPerLiter, a.QrMyPertaminaPath
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      WHERE j.JadwalID = @jadwalId AND j.IsDeleted = 0
    `);
  const row = result.recordset[0] as JadwalHeader | undefined;
  if (!row) throw new AppError("Jadwal tidak ditemukan.");
  return row;
}

// Riwayat tab — every Selesai Jadwal for this driver, most recent first,
// capped since there's no pagination UI yet (a driver's realistic history
// depth is small enough that a flat cap is fine for v1). Same StopAgg
// pre-aggregation as getDriverJadwalList, for the same fan-out reason.
export async function getDriverJadwalHistory(salesmanId: string, limit = 50): Promise<DriverJadwalCard[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("limit", sql.Int, limit).query(`
      WITH StopAgg AS (
          SELECT jd.JadwalID, jd.JadwalDetailID,
                 ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Kantong,
                 CASE WHEN sd.JamSelesai IS NOT NULL THEN 1 ELSE 0 END AS IsSelesai
          FROM DashboardPengirimanJadwalDetail jd
          LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
          LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
          WHERE jd.IsDeleted = 0
          GROUP BY jd.JadwalID, jd.JadwalDetailID, sd.JamSelesai
      )
      SELECT TOP (@limit)
          j.JadwalID,
          a.Nama AS ArmadaNama,
          ed.VehicleNo,
          j.JamJadwal,
          j.Status,
          j.JamSelesaiMuat,
          j.JamAktualBerangkat,
          COUNT(sa.JadwalDetailID) AS TotalStop,
          SUM(sa.IsSelesai) AS StopSelesai,
          SUM(sa.Kantong) AS TotalKantong
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      JOIN StopAgg sa ON sa.JadwalID = j.JadwalID
      WHERE j.SalesmanID = @salesmanId AND j.IsDeleted = 0
      GROUP BY j.JadwalID, a.Nama, ed.VehicleNo, j.JamJadwal, j.Status, j.JamSelesaiMuat, j.JamAktualBerangkat
      HAVING COUNT(sa.JadwalDetailID) = SUM(sa.IsSelesai)
      ORDER BY j.JamJadwal DESC
    `);
  return (result.recordset as Omit<DriverJadwalCard, "IsSelesai">[]).map((r) => ({ ...r, IsSelesai: true }));
}

export interface DriverTimelineBBM {
  waktuMasukSpbu: string;
  waktuIsi: string | null;
  liter: number | null;
}

export interface DriverTimelineKendala {
  waktuLapor: string;
  jenisKendala: string;
}

export interface DriverTimelineEntry {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  jamAktualBerangkat: string;
  totalStop: number;
  totalKantong: number;
  bbm: DriverTimelineBBM[];
  kendala: DriverTimelineKendala[];
}

// Timeline for driver-app's Riwayat tab — completed Jadwal (same
// HAVING COUNT(...) = SUM(IsSelesai) filter as getDriverJadwalHistory
// above, this function's sibling, which stays unmodified) whose actual
// departure falls in the current 14:00-WIB-rollover business-date window
// (see ROLLOVER_HOUR in business-date.ts). Unlike getDriverJadwalHistory,
// scoped to one business day rather than a flat row-count cap, and each
// entry carries its own BBM refuel and Kendala report rows (fetched
// separately below and merged in, the same "fetch flat rows once, group
// by parent ID in TS" shape as getVehicleChecksForJadwal groups photos) —
// both are shown as compact lines inside the Jadwal's own timeline card,
// never as separate timeline entries.
export async function getDriverTimeline(salesmanId: string, businessDateISO: string): Promise<DriverTimelineEntry[]> {
  const pool = await getPool();
  const jadwalResult = await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("businessDate", sql.Date, businessDateISO).query(`
      WITH StopAgg AS (
          SELECT jd.JadwalID, jd.JadwalDetailID,
                 ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Kantong,
                 CASE WHEN sd.JamSelesai IS NOT NULL THEN 1 ELSE 0 END AS IsSelesai
          FROM DashboardPengirimanJadwalDetail jd
          LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
          LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
          WHERE jd.IsDeleted = 0
          GROUP BY jd.JadwalID, jd.JadwalDetailID, sd.JamSelesai
      )
      SELECT
          j.JadwalID,
          a.Nama AS ArmadaNama,
          ed.VehicleNo,
          j.JamAktualBerangkat,
          COUNT(sa.JadwalDetailID) AS TotalStop,
          SUM(sa.Kantong) AS TotalKantong
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      JOIN StopAgg sa ON sa.JadwalID = j.JadwalID
      WHERE j.SalesmanID = @salesmanId AND j.IsDeleted = 0
        -- businessDate is a 14:00 WIB rollover label — same window as
        -- getSatpamInspectionList (satpam-inspection.ts).
        AND j.JamAktualBerangkat >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
        AND j.JamAktualBerangkat < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
      GROUP BY j.JadwalID, a.Nama, ed.VehicleNo, j.JamAktualBerangkat
      HAVING COUNT(sa.JadwalDetailID) = SUM(sa.IsSelesai)
      ORDER BY j.JamAktualBerangkat DESC
    `);

  const jadwalRows = jadwalResult.recordset as {
    JadwalID: number;
    ArmadaNama: string;
    VehicleNo: string | null;
    JamAktualBerangkat: Date;
    TotalStop: number;
    TotalKantong: number;
  }[];

  if (jadwalRows.length === 0) return [];

  const jadwalIds = jadwalRows.map((r) => r.JadwalID);
  const request = pool.request();
  const placeholders = jadwalIds.map((id, i) => {
    request.input(`j${i}`, sql.Int, id);
    return `@j${i}`;
  });

  const [bbmResult, kendalaResult] = await Promise.all([
    request.query(`
      SELECT JadwalID, WaktuMasukSpbu, WaktuIsi, Liter
      FROM DashboardPengirimanBBM
      WHERE JadwalID IN (${placeholders.join(",")})
      ORDER BY WaktuMasukSpbu
    `),
    pool
      .request()
      .query(
        // Separate request object — the one above already consumed its
        // positional @j0.. inputs for the BBM query; mssql request objects
        // are single-use per set of bound inputs.
        `SELECT JadwalID, WaktuLapor, JenisKendala FROM DashboardPengirimanKendala WHERE JadwalID IN (${jadwalIds.join(",")}) ORDER BY WaktuLapor`
      ),
  ]);

  const bbmByJadwal = new Map<number, DriverTimelineBBM[]>();
  for (const r of bbmResult.recordset as { JadwalID: number; WaktuMasukSpbu: Date; WaktuIsi: Date | null; Liter: number | null }[]) {
    const list = bbmByJadwal.get(r.JadwalID) ?? [];
    list.push({ waktuMasukSpbu: r.WaktuMasukSpbu.toISOString(), waktuIsi: r.WaktuIsi?.toISOString() ?? null, liter: r.Liter });
    bbmByJadwal.set(r.JadwalID, list);
  }

  const kendalaByJadwal = new Map<number, DriverTimelineKendala[]>();
  for (const r of kendalaResult.recordset as { JadwalID: number; WaktuLapor: Date; JenisKendala: string }[]) {
    const list = kendalaByJadwal.get(r.JadwalID) ?? [];
    list.push({ waktuLapor: r.WaktuLapor.toISOString(), jenisKendala: r.JenisKendala });
    kendalaByJadwal.set(r.JadwalID, list);
  }

  return jadwalRows.map((r) => ({
    jadwalId: r.JadwalID,
    armadaNama: r.ArmadaNama,
    vehicleNo: r.VehicleNo,
    jamAktualBerangkat: r.JamAktualBerangkat.toISOString(),
    totalStop: r.TotalStop,
    totalKantong: r.TotalKantong,
    bbm: bbmByJadwal.get(r.JadwalID) ?? [],
    kendala: kendalaByJadwal.get(r.JadwalID) ?? [],
  }));
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
  // encodeInvoiceToken(SalesInvoiceID) when a SalesInvoice exists for this
  // stop (set at selesaiMuat, alongside DeliveryOrderID) — null otherwise.
  // The client never sees the raw SalesInvoiceID, only this opaque token,
  // used to build the print URL /mkesindo/invoice/{InvoiceToken}.
  InvoiceToken: string | null;
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
          jd.SalesInvoiceID,
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
      GROUP BY jd.JadwalDetailID, jd.SalesOrderID, jd.DeliveryOrderID, jd.SalesInvoiceID, jd.Urutan,
               bp.Name, bp.NPWPName, bp.NPWPAddress, bp.Address, bp.MobileNo, ml.Latitude, ml.Longitude
      ORDER BY jd.Urutan
    `);
  const rows = result.recordset as (Omit<JadwalDetailRow, "InvoiceToken"> & { SalesInvoiceID: string | null })[];
  return rows.map((r) => {
    const { SalesInvoiceID, ...rest } = r;
    return { ...rest, InvoiceToken: SalesInvoiceID ? encodeInvoiceToken(SalesInvoiceID) : null };
  });
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
    throw new AppError(`Total muatan (${totalQty} kantong) melebihi kapasitas maksimum armada (${kapasitasMaks} kantong).`);
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
    throw new AppError(
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
// Delegates the actual bongkar+confirmation+travel math to
// estimateTripMinutes (route-estimate.ts) once locations are resolved from
// the DB — this function's own job is just that DB resolution and the
// missing-location edge case estimateTripMinutes can't see.
async function estimateBusyMinutes(
  pool: sql.ConnectionPool,
  pabrik: LatLng,
  orderedSalesOrderIds: string[],
  realTravelMinutes: number | null
): Promise<number> {
  if (orderedSalesOrderIds.length === 0) return 0;
  const locations = await getStopLocationsForSalesOrders(pool, orderedSalesOrderIds);

  // estimateTripMinutes needs a coordinate for every stop passed to it — a
  // SalesOrder whose location couldn't be resolved can't contribute to the
  // travel-time heuristic, so it's excluded from resolvedStops, but its
  // confirmation time (CONFIRMATION_MINUTES_PER_STOP) still applies (the
  // driver still fills delivery-confirmation data for it) and its bongkar
  // contribution is estimateDeliveryMinutes(0) = 0 — added back in below.
  let missingLocationMinutes = 0;
  const resolvedStops: (LatLng & { qty: number })[] = [];
  for (const id of orderedSalesOrderIds) {
    const loc = locations.get(id) ?? null;
    if (loc) {
      resolvedStops.push({ lat: loc.lat, lng: loc.lng, qty: loc.qty });
    } else {
      missingLocationMinutes += CONFIRMATION_MINUTES_PER_STOP;
    }
  }

  const tripMinutes = estimateTripMinutes(pabrik, resolvedStops, realTravelMinutes);

  // Floored to at least 1 minute whenever there's at least one stop: a
  // SalesOrder with a 0-qty detail line (seen live on a handful of old
  // "Retail / Direct Sales" adjustment orders) would otherwise produce an
  // exactly-zero-width window, which the overlap check's strict `<`
  // comparison (findOverlappingJadwalForArmada) never flags as conflicting
  // with anything — not even another Jadwal starting at that exact same
  // instant. A departure always occupies at least a moment of the armada's
  // time, degenerate cargo or not.
  return Math.max(1, tripMinutes + missingLocationMinutes);
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

export interface ArmadaConflictInfo {
  jadwalId: number;
  jamJadwal: string;
  existingQty: number;
  candidateQty: number;
  combinedQty: number;
  kapasitasMaks: number | null;
  wouldExceedCapacity: boolean;
}

// Decision-support check for the 6 UI flows that can silently fold a new
// stop/departure into an already-Draft Jadwal for the same armada
// (mergeExternalDeliveriesIntoJadwal, updateJadwalDriverTime,
// updateJadwalArmada, createJadwalDraft, and pemesanan.ts's
// createPemesanan/reschedulePemesanan, which call createJadwalDraft
// internally). Returns non-null ONLY for a genuine Draft-status conflict —
// a Terbit conflict returns null here so the caller proceeds straight to
// the real mutating action, which still rejects it hard exactly as before
// (this function never changes that behavior, it only adds a confirmation
// step in front of the Draft-merge case that previously happened silently).
//
// candidateEnd is a deliberate approximation
// (candidateStart + estimateDeliveryMinutes(candidateQty), no travel time)
// rather than the full estimateBusyMinutes used elsewhere — candidateQty
// is sometimes for an order that doesn't have a real SalesOrderID (and
// therefore no known stop coordinates) yet, e.g. Buat Pemesanan. This is
// fine because this function is purely "should we show a confirmation
// popup", never the actual capacity/overlap gate — that stays in the real
// mutating action, called after the user confirms, with full precision.
export async function checkArmadaConflict(
  armadaId: number,
  candidateStart: Date,
  candidateQty: number,
  excludeJadwalId: number | null
): Promise<ArmadaConflictInfo | null> {
  const pool = await getPool();
  const pabrikLocation = await getPabrikLocation();
  const pabrikLatLng: LatLng = { lat: pabrikLocation.latitude, lng: pabrikLocation.longitude };
  const candidateEnd = new Date(
    candidateStart.getTime() + (estimateDeliveryMinutes(candidateQty) + CONFIRMATION_MINUTES_PER_STOP) * 60 * 1000
  );
  const conflict = await findOverlappingJadwalForArmada(pool, pabrikLatLng, armadaId, candidateStart, candidateEnd, excludeJadwalId);
  if (!conflict || conflict.status !== "Draft") return null;

  const detailResult = await pool
    .request()
    .input("jadwalId", sql.Int, conflict.jadwalId)
    .query(`SELECT SalesOrderID FROM DashboardPengirimanJadwalDetail WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const existingSalesOrderIds = (detailResult.recordset as { SalesOrderID: string }[]).map((r) => r.SalesOrderID);
  const existingQty = await sumSalesOrderQty(pool, existingSalesOrderIds);

  const armadaResult = await pool
    .request()
    .input("armadaId", sql.Int, armadaId)
    .query(`SELECT KapasitasMaks FROM DashboardArmada WHERE ArmadaID = @armadaId AND IsDeleted = 0`);
  const kapasitasMaks = (armadaResult.recordset[0] as { KapasitasMaks: number | null } | undefined)?.KapasitasMaks ?? null;

  const combinedQty = existingQty + candidateQty;

  return {
    jadwalId: conflict.jadwalId,
    jamJadwal: conflict.start.toISOString(),
    existingQty,
    candidateQty,
    combinedQty,
    kapasitasMaks,
    wouldExceedCapacity: kapasitasMaks != null && combinedQty > kapasitasMaks,
  };
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
  if (!targetRow) throw new AppError("Keberangkatan tujuan penggabungan tidak ditemukan.");

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
  if (!headerRow) throw new AppError("Keberangkatan tujuan penggabungan tidak ditemukan.");

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
      throw new AppError(
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
// NULL until selesaiMuat) — this is intentional and safe: selesaiMuat's
// per-row loop already skips creating a new DO whenever DeliveryOrderID is
// already set (see its own idempotent-retry-guard comment), only correcting
// that DO's TransDate to the now-confirmed loading-complete moment — it
// deliberately does NOT create a SalesInvoice for these rows either (that
// DO was already issued, and invoiced if at all, by the desktop ERP itself).
// So clicking "Selesai Muat" on this backfilled Draft later just transitions
// Status -> Terbit and computes a real OSRM route, without attempting to
// re-issue or re-invoice any of the already-real DOs. "Berangkat"
// (konfirmasiBerangkat) comes after that, and only ever sets
// JamAktualBerangkat on an already-Terbit Jadwal.
export async function mergeExternalDeliveriesIntoJadwal(
  armadaId: number,
  deliveryOrderIds: string[],
  jamJadwal: Date
): Promise<number> {
  if (deliveryOrderIds.length === 0) throw new AppError("Tidak ada DO yang dipilih.");
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
  if (doRows.length === 0) throw new AppError("DO yang dipilih tidak ditemukan atau sudah masuk Jadwal lain.");

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
      throw new AppError(
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
    throw new AppError("Hanya keberangkatan berstatus Draft yang bisa dibatalkan.");
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
  if (!headerRow) throw new AppError("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new AppError("Keberangkatan ini sudah berangkat, tidak bisa menambah SO.");
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
  if (!row) throw new AppError("Keberangkatan tidak ditemukan.");
  if (row.Status === "Terbit") throw new AppError("Keberangkatan ini sudah rilis — tidak bisa diubah lagi.");

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
        throw new AppError(
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
  if (!row) throw new AppError("Keberangkatan tidak ditemukan.");
  if (row.Status === "Terbit") throw new AppError("Keberangkatan ini sudah rilis — tidak bisa diubah lagi.");

  const finalJamJadwal = jamJadwal ?? row.JamJadwal;
  if (row.ArmadaID === newArmadaId && finalJamJadwal.getTime() === row.JamJadwal.getTime()) {
    return jadwalId;
  }

  const targetArmada = await pool
    .request()
    .input("armadaId", sql.Int, newArmadaId)
    .query(`SELECT ArmadaID FROM DashboardArmada WHERE ArmadaID = @armadaId AND IsDeleted = 0`);
  if (!targetArmada.recordset[0]) throw new AppError("Armada tujuan tidak ditemukan.");

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
      throw new AppError(
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

// Widened from a plain sql.ConnectionPool so these helpers can run inside
// selesaiMuat's sql.Transaction (see its own comment) — both
// sql.ConnectionPool and sql.Transaction expose a compatible
// `.request(): Request` method (verified against @types/mssql/index.d.ts),
// so a single implementation works unchanged for either. No other caller of
// these six helpers exists outside selesaiMuat (they're module-private), so
// widening this type can't affect anything else.
type PoolOrTransaction = sql.ConnectionPool | sql.Transaction;

async function nextDeliveryOrderId(pool: PoolOrTransaction): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderID AS INT)) AS MaxID FROM DeliveryOrder`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDeliveryOrderDetailId(pool: PoolOrTransaction): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(DeliveryOrderDetailID AS INT)) AS MaxID FROM DeliveryOrderDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextDOVoucherSeq(pool: PoolOrTransaction, yearMonth: string): Promise<string> {
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

async function nextSalesInvoiceId(pool: PoolOrTransaction): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesInvoiceID AS INT)) AS MaxID FROM SalesInvoice`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSalesInvoiceDetailId(pool: PoolOrTransaction): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesInvoiceDetailID AS INT)) AS MaxID FROM SalesInvoiceDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

// Same numbering shape as nextDOVoucherSeq, MKE/SI/ prefix (matches the real
// SalesInvoice VoucherNo pattern already seen in takeaway.ts's own
// createTakeAwayPemesanan, e.g. "MKE/SI/000123/2026-08/003/001").
async function nextSIVoucherSeq(pool: PoolOrTransaction, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/SI/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM SalesInvoice WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

async function nextSalesReturnId(pool: PoolOrTransaction): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesReturnID AS INT)) AS MaxID FROM SalesReturn`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSalesReturnDetailId(pool: PoolOrTransaction): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesReturnDetailID AS INT)) AS MaxID FROM SalesReturnDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

// Same numbering shape as nextDOVoucherSeq/nextSIVoucherSeq, MKE/SR/ prefix
// (SalesReturn is a real, pre-existing ERP document type — 9,567 historical
// rows confirmed via direct schema inspection — never written by this
// dashboard until now).
async function nextSRVoucherSeq(pool: PoolOrTransaction, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/SR/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM SalesReturn WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

interface SalesOrderForPublish {
  BusinessPartnerID: string;
  DueDate: Date | null;
  TermOfPaymentID: string;
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

// Draft -> Terbit, fired by clicking "Selesai Muat" (loading finished). Does
// everything the old startBerangkat used to do EXCEPT recording the actual
// physical departure — that's konfirmasiBerangkat's job now, fired later by
// Satpam at the gate. Route/driver validation already happened while the
// Jadwal sat in Draft; this is the moment the dashboard's SO selection
// becomes real DeliveryOrder AND SalesInvoice documents (reusing
// createTakeAwayPemesanan's exact SalesInvoice column/value shape from
// takeaway.ts) so a Surat SI can be printed and handed to the driver before
// the vehicle leaves. For each detail row (in Urutan order), creates one real
// DeliveryOrder + DeliveryOrderDetail(s) AND one SalesInvoice +
// SalesInvoiceDetail(s) from the linked SalesOrder/SalesOrderDetail. Writes
// DeliveryOrderID/SalesInvoiceID back onto the detail row, then flips
// Jadwal.Status and sets JamSelesaiMuat together in the same atomic claim.
//
// Everything from the claim onward (claim UPDATE, armada/detail-rows reads,
// and the entire per-stop loop) runs inside one real sql.Transaction — same
// shape as createVehicleCheck in vehicle-check.ts, which established this
// pattern in this codebase for the same reason. This deliberately departs
// from createTakeAwayPemesanan's (takeaway.ts) compensating-cleanup-only
// style: this loop can create many DO/DODetail/SI/SIDetail rows plus
// per-row JadwalDetail updates across potentially many stops, and a
// JS-catchable error is not the only way it can fail partway through — a
// hard process crash mid-loop (not a catchable throw) could otherwise leave
// a half-created state (e.g. a DO with no matching SI) with the Jadwal
// stuck in Status='Terbit' and no client-triggerable retry path (this
// function immediately rejects any non-Draft Jadwal). A real
// transaction.rollback() undoes every uncommitted INSERT/UPDATE atomically
// regardless of how the failure happened, so the single catch block below
// rolls back rather than manually re-deleting/reverting each row it
// created.
export async function selesaiMuat(jadwalId: number): Promise<{ jadwalDetailId: number; invoiceToken: string }[]> {
  const pool = await getPool();

  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT ArmadaID, SalesmanID, Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; SalesmanID: string | null; Status: JadwalStatus } | undefined;
  if (!headerRow) throw new AppError("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new AppError("Muat untuk keberangkatan ini sudah selesai.");
  if (!headerRow.SalesmanID) throw new AppError("Driver wajib diisi sebelum menyelesaikan muat.");

  // Server-side mirror of the client's mandatory route-computed check
  // (design spec: checked client- AND server-side) — a direct server-action
  // call bypassing the UI must not be able to skip it. Deliberately BEFORE
  // the transaction below, so a failed route check never leaves the Jadwal
  // wrongly flipped to Terbit.
  const stopsForRouteCheck = await getJadwalDetail(jadwalId);
  if (stopsForRouteCheck.length === 0) throw new AppError("Tidak ada SO pada keberangkatan ini.");
  const missingCoords = stopsForRouteCheck.some((s) => s.Latitude == null || s.Longitude == null);
  if (missingCoords) {
    throw new AppError("Rute belum berhasil divalidasi — pastikan seluruh tujuan punya lokasi tersimpan.");
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
    throw new AppError("Rute belum berhasil divalidasi — pastikan seluruh tujuan punya lokasi tersimpan.");
  }

  // Server-side mirror of the capacity hard-block already enforced when SOs
  // are selected (createJadwalDraft / addSalesOrdersToJadwal) — re-checked
  // here too since an Armada's KapasitasMaks could in principle be edited
  // down after this Jadwal was assembled.
  const totalQty = stopsForRouteCheck.reduce((sum, s) => sum + s.Qty, 0);
  await assertWithinCapacity(pool, headerRow.ArmadaID, totalQty);

  const invoiceTokens: { jadwalDetailId: number; invoiceToken: string }[] = [];
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // Atomically claim: only succeeds if Status is still 'Draft'. Guards
    // against two racing selesaiMuat calls for the same jadwalId both passing
    // the Status!=='Draft' check above and then both creating a duplicate set
    // of real documents — the row lock this UPDATE takes is held until this
    // transaction commits or rolls back, so a second concurrent call's own
    // claim blocks here until the first fully finishes, then correctly finds
    // Status is no longer 'Draft'.
    const claim = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, jadwalId)
      .input("jarakKM", sql.Decimal(10, 2), validatedRoute.distanceKm)
      .input("durasiMenit", sql.Int, Math.round(validatedRoute.durationMinutes))
      .query(
        `UPDATE DashboardPengirimanJadwal SET Status = 'Terbit', JamSelesaiMuat = GETDATE(), JarakKM = @jarakKM, DurasiMenit = @durasiMenit, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId AND Status = 'Draft'`
      );
    if (claim.rowsAffected[0] === 0) {
      throw new AppError("Muat untuk keberangkatan ini sudah selesai atau sedang diproses.");
    }

    const armadaResult = await new sql.Request(transaction)
      .input("armadaId", sql.Int, headerRow.ArmadaID).query(`
        SELECT a.Nama, ed.ExpeditionID, ed.VehicleNo
        FROM DashboardArmada a
        LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
        WHERE a.ArmadaID = @armadaId AND a.IsDeleted = 0
      `);
    const armadaRow = armadaResult.recordset[0] as
      | { Nama: string; ExpeditionID: string | null; VehicleNo: string | null }
      | undefined;
    if (!armadaRow) throw new AppError("Armada sudah dihapus, tidak bisa menyelesaikan muat.");
    const doVehicleNo = armadaRow.VehicleNo ?? armadaRow.Nama;
    const doExpeditionId = armadaRow.ExpeditionID ?? "";

    const details = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, jadwalId)
      .query(`
        SELECT JadwalDetailID, SalesOrderID, DeliveryOrderID FROM DashboardPengirimanJadwalDetail
        WHERE JadwalID = @jadwalId AND IsDeleted = 0
        ORDER BY Urutan
      `);
    const detailRows = details.recordset as { JadwalDetailID: number; SalesOrderID: string; DeliveryOrderID: string | null }[];
    if (detailRows.length === 0) throw new AppError("Tidak ada SO pada keberangkatan ini.");

    for (const detail of detailRows) {
      // Idempotent-retry guard: if a previous selesaiMuat attempt already
      // created a DeliveryOrder for this detail row (and only failed later,
      // e.g. partway through this same loop), skip it instead of creating a
      // duplicate DO/SI. Also covers the merged-external-DO case
      // (mergeExternalDeliveriesIntoJadwal): that DO was already issued by
      // the desktop ERP, so it must never be re-created, and it never gets
      // an auto-created SalesInvoice either (its invoicing, if any, is the
      // desktop ERP's own separate concern) — only its TransDate gets
      // corrected to this now-confirmed loading-complete moment (same
      // GETDATE() reference as JamSelesaiMuat above; the original desktop-app
      // TransDate was just whenever the document was typed in).
      if (detail.DeliveryOrderID) {
        await new sql.Request(transaction)
          .input("doId", sql.VarChar(16), detail.DeliveryOrderID)
          .query(`UPDATE DeliveryOrder SET TransDate = GETDATE(), ModifiedDate = GETDATE() WHERE DeliveryOrderID = @doId`);
        continue;
      }

      const soResult = await new sql.Request(transaction)
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .query(`SELECT BusinessPartnerID, DueDate, TermOfPaymentID FROM SalesOrder WHERE SalesOrderID = @soId`);
      const so = soResult.recordset[0] as SalesOrderForPublish | undefined;
      if (!so) throw new AppError(`Sales Order ${detail.SalesOrderID} tidak ditemukan.`);

      const sodResult = await new sql.Request(transaction)
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .query(`SELECT SalesOrderDetailID, ItemID, Name, Qty, Unit, Price, Amount FROM SalesOrderDetail WHERE SalesOrderID = @soId`);
      const soDetails = sodResult.recordset as SalesOrderDetailForPublish[];

      const deliveryOrderId = await nextDeliveryOrderId(transaction);
      const voucherSeq = await nextDOVoucherSeq(transaction, yearMonth);
      const voucherNo = `MKE/DO/${voucherSeq}/${yearMonth}/${DOC_SUFFIX}`;

      await new sql.Request(transaction)
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

      for (const sod of soDetails) {
        const detailId = await nextDeliveryOrderDetailId(transaction);
        await new sql.Request(transaction)
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

      // --- SalesInvoice (new — reuses createTakeAwayPemesanan's exact
      // column/value shape from takeaway.ts) ---
      const salesInvoiceId = await nextSalesInvoiceId(transaction);
      const siVoucherSeq = await nextSIVoucherSeq(transaction, yearMonth);
      const siVoucherNo = `MKE/SI/${siVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
      const totalAmount = soDetails.reduce((sum, sod) => sum + sod.Amount, 0);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), salesInvoiceId)
        .input("voucherNo", sql.VarChar(128), siVoucherNo)
        .input("dueDate", sql.DateTime, so.DueDate)
        .input("termOfPaymentId", sql.VarChar(16), so.TermOfPaymentID)
        .input("soId", sql.VarChar(16), detail.SalesOrderID)
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .input("bpId", sql.VarChar(16), so.BusinessPartnerID)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("amount", sql.Decimal(23, 4), totalAmount)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID).query(`
          INSERT INTO SalesInvoice
            (SalesInvoiceID, VoucherNo, ReferenceNo, TaxNo, TransDate, DueDate, Notes, TermOfPaymentID,
             SalesOrderID, DeliveryOrderID, SalesDepositID, BusinessPartnerID, BranchID, DepartmentID,
             Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, BankID, Paid, Deposit, PaidDate,
             IsClosed, IsDeleted, ModifiedDate, Rate, CurrencyID, IsAccountReceiveable, StatusForm,
             SalesmanID, ServiceTax, ServiceTaxValue, Visitor, IsTX, PromotionID, IsPerforma,
             DiscRpBefore, ProjectID, IsExported, BillOfQuantityID)
          VALUES
            (@id, @voucherNo, '', '', GETDATE(), @dueDate, '', @termOfPaymentId,
             @soId, @doId, '', @bpId, @branchId, @departmentId,
             @amount, 0, 0, 0, 0, 0, @amount, '', 0, 0, NULL,
             0, 0, GETDATE(), 1, '', 1, 1,
             @salesmanId, 0, 0, 0, 0, '', 0,
             0, '', 0, '')
        `);

      for (const sod of soDetails) {
        const siDetailId = await nextSalesInvoiceDetailId(transaction);
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), siDetailId)
          .input("siId", sql.VarChar(16), salesInvoiceId)
          .input("itemId", sql.VarChar(160), sod.ItemID)
          .input("name", sql.VarChar(160), sod.Name)
          .input("qty", sql.Decimal(23, 4), sod.Qty)
          .input("unit", sql.VarChar(8), sod.Unit)
          .input("price", sql.Decimal(23, 4), sod.Price)
          .input("amount", sql.Decimal(23, 4), sod.Amount).query(`
            INSERT INTO SalesInvoiceDetail
              (SalesInvoiceDetailID, SalesInvoiceID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue,
               DiscRp, Amount, Name, Value, Netto, Description, WaiterName, Cashback, Total)
            VALUES
              (@id, @siId, @itemId, @qty, @unit, 1, 1, @price, 0, 0,
               0, @amount, @name, @amount, @amount, '', '', 0, NULL)
          `);
      }

      await new sql.Request(transaction)
        .input("detailId", sql.Int, detail.JadwalDetailID)
        .input("doId", sql.VarChar(16), deliveryOrderId)
        .input("siId", sql.VarChar(16), salesInvoiceId)
        .query(`UPDATE DashboardPengirimanJadwalDetail SET DeliveryOrderID = @doId, SalesInvoiceID = @siId WHERE JadwalDetailID = @detailId`);

      invoiceTokens.push({ jadwalDetailId: detail.JadwalDetailID, invoiceToken: encodeInvoiceToken(salesInvoiceId) });
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return invoiceTokens;
}

// Records the real physical departure — fired by Satpam pressing "Berangkat"
// at the gate, only once a Cek Berangkat inspection exists for this Jadwal
// (DashboardVehicleCheck, Tipe='BERANGKAT' — see vehicle-check.ts). Deliberately
// minimal: DeliveryOrder/SalesInvoice already exist (created at selesaiMuat),
// route/capacity already validated then too — this function only ever
// touches JamAktualBerangkat.
export async function konfirmasiBerangkat(jadwalId: number): Promise<void> {
  const pool = await getPool();

  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status, JamAktualBerangkat FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { Status: JadwalStatus; JamAktualBerangkat: Date | null } | undefined;
  if (!headerRow) throw new AppError("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Terbit") throw new AppError("Keberangkatan ini belum selesai dimuat.");
  if (headerRow.JamAktualBerangkat) throw new AppError("Keberangkatan ini sudah berangkat.");

  const check = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT VehicleCheckID FROM DashboardVehicleCheck WHERE JadwalID = @jadwalId AND Tipe = 'BERANGKAT'`);
  if (check.recordset.length === 0) {
    throw new AppError("Belum ada Cek Berangkat dari Satpam.");
  }

  const claim = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(
      `UPDATE DashboardPengirimanJadwal SET JamAktualBerangkat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId AND Status = 'Terbit' AND JamAktualBerangkat IS NULL`
    );
  if (claim.rowsAffected[0] === 0) {
    throw new AppError("Keberangkatan ini sudah berangkat atau sedang diproses.");
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
    throw new AppError("Hanya SO pada keberangkatan berstatus Draft yang bisa diubah penjadwalannya.");
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

export interface DriverStopRow extends JadwalDetailRow {
  JamTiba: string | Date | null;
  JamSelesai: string | Date | null;
  // Needed by the driver-app's Pembayaran screen to call recordPayment()
  // (SalesPayment.BusinessPartnerID) — fetched here rather than making
  // that screen do its own extra round-trip.
  BusinessPartnerID: string;
}

// Merges getJadwalDetail's existing per-stop data (customer/qty/address —
// unchanged, still the read path for the dashboard's own Validasi Rute)
// with this stop's own completion timestamps and BusinessPartnerID, for
// the driver-app's Pengiriman/Konfir/Pembayaran screens.
export async function getDriverJadwalStops(jadwalId: number): Promise<DriverStopRow[]> {
  const pool = await getPool();
  const [stops, extraRows] = await Promise.all([
    getJadwalDetail(jadwalId),
    pool
      .request()
      .input("jadwalId", sql.Int, jadwalId).query(`
        SELECT jd.JadwalDetailID, sd.JamTiba, sd.JamSelesai, so.BusinessPartnerID
        FROM DashboardPengirimanJadwalDetail jd
        JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
        LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = jd.JadwalDetailID
        WHERE jd.JadwalID = @jadwalId AND jd.IsDeleted = 0
      `),
  ]);
  const extraByDetailId = new Map(
    (
      extraRows.recordset as { JadwalDetailID: number; JamTiba: Date | null; JamSelesai: Date | null; BusinessPartnerID: string }[]
    ).map((r) => [r.JadwalDetailID, r])
  );
  return stops.map((s) => ({
    ...s,
    JamTiba: extraByDetailId.get(s.JadwalDetailID)?.JamTiba ?? null,
    JamSelesai: extraByDetailId.get(s.JadwalDetailID)?.JamSelesai ?? null,
    BusinessPartnerID: extraByDetailId.get(s.JadwalDetailID)?.BusinessPartnerID ?? "",
  }));
}

export interface StopOrderItem {
  SalesOrderDetailID: string;
  ItemID: string;
  Name: string;
  Qty: number;
  Price: number;
}

// Line-item breakdown for one stop (Layar "Konfir Kirim") — unlike
// JadwalDetailRow's aggregated Qty/Qty10KG/Qty5KG (used for card totals),
// this is one row per real SalesOrderDetail so the driver can adjust each
// item's received quantity independently.
export async function getStopOrderItems(jadwalDetailId: number): Promise<StopOrderItem[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalDetailId", sql.Int, jadwalDetailId).query(`
      SELECT sod.SalesOrderDetailID, sod.ItemID, sod.Name, sod.Qty, sod.Price
      FROM DashboardPengirimanJadwalDetail jd
      JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE jd.JadwalDetailID = @jadwalDetailId AND jd.IsDeleted = 0
      ORDER BY sod.Name
    `);
  return result.recordset;
}

// SQL Server error number for a unique-constraint/PK violation — thrown by
// the INSERT below when two near-simultaneous recordStopArrival calls for
// the same jadwalDetailId both pass the initial SELECT (TOCTOU race) and
// then race on the insert itself. mssql's RequestError exposes this
// directly as `.number` (and also mirrors it at
// `.originalError.info.number`) — checked defensively at both spots since
// only the top-level `.number` is documented as stable.
const SQL_UNIQUE_VIOLATION = 2627;

// "Geser untuk Tiba" (Layar Pengiriman) — idempotent: calling this again
// for a stop that already has a row just returns the existing
// StopDeliveryID rather than erroring, so a duplicate tap or a retried
// request after a dropped connection can't fail loudly. The SELECT-then-
// INSERT below still has a TOCTOU race window between two near-simultaneous
// calls (both can pass the "no existing row" SELECT before either INSERTs)
// — the losing INSERT hits UQ_DashboardPengirimanStopDelivery_JadwalDetailID
// instead of creating a duplicate row, and is caught here and turned into a
// re-SELECT of the winner's row, so the race resolves to the same
// "can't fail loudly" outcome instead of an uncaught exception.
export async function recordStopArrival(jadwalDetailId: number): Promise<number> {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .query(`SELECT StopDeliveryID FROM DashboardPengirimanStopDelivery WHERE JadwalDetailID = @id`);
  const existingRow = existing.recordset[0] as { StopDeliveryID: number } | undefined;
  if (existingRow) return existingRow.StopDeliveryID;

  try {
    const result = await pool
      .request()
      .input("id", sql.Int, jadwalDetailId)
      .query(
        `INSERT INTO DashboardPengirimanStopDelivery (JadwalDetailID, JamTiba) OUTPUT INSERTED.StopDeliveryID VALUES (@id, GETDATE())`
      );
    return (result.recordset[0] as { StopDeliveryID: number }).StopDeliveryID;
  } catch (err) {
    const errorNumber = (err as { number?: number; originalError?: { info?: { number?: number } } }).number ?? (err as { originalError?: { info?: { number?: number } } }).originalError?.info?.number;
    if (errorNumber !== SQL_UNIQUE_VIOLATION) throw err;

    const winner = await pool
      .request()
      .input("id", sql.Int, jadwalDetailId)
      .query(`SELECT StopDeliveryID FROM DashboardPengirimanStopDelivery WHERE JadwalDetailID = @id`);
    const winnerRow = winner.recordset[0] as { StopDeliveryID: number } | undefined;
    if (!winnerRow) throw err;
    return winnerRow.StopDeliveryID;
  }
}

// Ownership gate for driver-app actions: throws unless jadwalId's own
// SalesmanID matches the calling driver's session salesmanId. Every
// per-Jadwal driver-app action must call this before touching any data.
export async function assertOwnsJadwal(jadwalId: number, salesmanId: string): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT SalesmanID FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = result.recordset[0] as { SalesmanID: string | null } | undefined;
  if (!row || row.SalesmanID !== salesmanId) throw new AppError("Anda tidak memiliki akses ke Jadwal ini.");
}

// Same gate, one level deeper — for actions keyed by JadwalDetailID
// (a stop) instead of JadwalID directly.
export async function assertOwnsJadwalDetail(jadwalDetailId: number, salesmanId: string): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId).query(`
      SELECT j.SalesmanID
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwal j ON j.JadwalID = jd.JadwalID
      WHERE jd.JadwalDetailID = @id AND jd.IsDeleted = 0 AND j.IsDeleted = 0
    `);
  const row = result.recordset[0] as { SalesmanID: string | null } | undefined;
  if (!row || row.SalesmanID !== salesmanId) throw new AppError("Anda tidak memiliki akses ke stop ini.");
}

export interface StopDeliveryItemInput {
  salesOrderDetailId: string;
  qtyDiterima: number;
  fotoReturUrl: string | null;
  // Driver's own note on why this item is being returned — shown next to
  // the retur photo on the "Konfirmasi Pengiriman" screen.
  keteranganRetur: string | null;
}

export interface ConfirmStopDeliveryInput {
  jadwalDetailId: number;
  items: StopDeliveryItemInput[];
  // Merged "Bukti Pengiriman" + "Bukti Muatan" into one multi-photo
  // category (was two separate single-photo-only required fields).
  fotoBuktiUrls: string[];
  tandaTanganUrl: string;
  tanpaPembayaran: boolean;
}

interface SalesOrderDetailForReturn {
  SalesOrderDetailID: string;
  ItemID: string;
  Name: string;
  Qty: number;
  Price: number;
}

// The core "retur" transaction (Layar Konfir Terima's "Konfirmasi
// Penerima"): downward-only adjustment of what was already invoiced at
// selesaiMuat, driven by what the driver actually confirms was received.
// See the design spec's "Retur & penyesuaian Invoice" section for why
// SalesInvoice.Amount/Netto (not just SalesInvoiceDetail) must be
// recomputed — vCustomerStatement (aging.ts, the basis for every
// Outstanding/Piutang figure in the app, including Pelunasan's
// recordPayment) reads SalesInvoice.Netto directly, not a live SUM.
export async function confirmStopDelivery(
  input: ConfirmStopDeliveryInput
): Promise<{ stopDeliveryId: number; salesInvoiceId: string | null }> {
  const pool = await getPool();

  const detailResult = await pool
    .request()
    .input("id", sql.Int, input.jadwalDetailId)
    .query(
      `SELECT JadwalID, SalesOrderID, DeliveryOrderID, SalesInvoiceID FROM DashboardPengirimanJadwalDetail WHERE JadwalDetailID = @id AND IsDeleted = 0`
    );
  const detailRow = detailResult.recordset[0] as
    | { JadwalID: number; SalesOrderID: string; DeliveryOrderID: string | null; SalesInvoiceID: string | null }
    | undefined;
  if (!detailRow) throw new AppError("Stop pengiriman tidak ditemukan.");
  if (!detailRow.DeliveryOrderID || !detailRow.SalesInvoiceID) {
    throw new AppError("Muat untuk stop ini belum diselesaikan, tidak bisa konfirmasi penerimaan.");
  }

  const existingStop = await pool
    .request()
    .input("id", sql.Int, input.jadwalDetailId)
    .query(`SELECT StopDeliveryID, JamSelesai FROM DashboardPengirimanStopDelivery WHERE JadwalDetailID = @id`);
  const existingStopRow = existingStop.recordset[0] as { StopDeliveryID: number; JamSelesai: Date | null } | undefined;
  if (!existingStopRow) throw new AppError("Belum ada catatan kedatangan untuk stop ini — geser 'Tiba' terlebih dahulu.");
  if (existingStopRow.JamSelesai) throw new AppError("Stop ini sudah dikonfirmasi selesai.");

  const headerResult = await pool
    .request()
    .input("jadwalId", sql.Int, detailRow.JadwalID)
    .query(`SELECT SalesmanID FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = headerResult.recordset[0] as { SalesmanID: string | null } | undefined;
  if (!headerRow) throw new AppError("Keberangkatan tidak ditemukan.");

  const soResult = await pool
    .request()
    .input("soId", sql.VarChar(16), detailRow.SalesOrderID)
    .query(`SELECT BusinessPartnerID FROM SalesOrder WHERE SalesOrderID = @soId`);
  const soRow = soResult.recordset[0] as { BusinessPartnerID: string } | undefined;
  if (!soRow) throw new AppError(`Sales Order ${detailRow.SalesOrderID} tidak ditemukan.`);

  const sodResult = await pool
    .request()
    .input("soId", sql.VarChar(16), detailRow.SalesOrderID)
    .query(`SELECT SalesOrderDetailID, ItemID, Name, Qty, Price FROM SalesOrderDetail WHERE SalesOrderID = @soId`);
  const soDetails = sodResult.recordset as SalesOrderDetailForReturn[];
  const soDetailById = new Map(soDetails.map((d) => [d.SalesOrderDetailID, d]));

  // Validate every input item against its real loaded quantity BEFORE
  // opening the transaction — retur can only ever reduce, never exceed,
  // what was actually loaded.
  for (const item of input.items) {
    const sod = soDetailById.get(item.salesOrderDetailId);
    if (!sod) throw new AppError(`Item pesanan ${item.salesOrderDetailId} tidak ditemukan pada Sales Order ini.`);
    if (item.qtyDiterima < 0) throw new AppError(`Kuantitas diterima untuk ${sod.Name} tidak boleh negatif.`);
    if (item.qtyDiterima > sod.Qty) {
      throw new AppError(`Kuantitas diterima untuk ${sod.Name} tidak boleh melebihi kuantitas yang dimuat (${sod.Qty}).`);
    }
  }

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const hasRetur = input.items.some((item) => item.qtyDiterima < (soDetailById.get(item.salesOrderDetailId)?.Qty ?? 0));

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // Atomically claim: only succeeds if JamSelesai is still NULL — guards
    // the same double-submit race selesaiMuat's own claim UPDATE guards
    // against.
    const claim = await new sql.Request(transaction)
      .input("id", sql.Int, input.jadwalDetailId)
      .input("fotoBuktiUrls", sql.VarChar(sql.MAX), JSON.stringify(input.fotoBuktiUrls))
      .input("ttd", sql.VarChar(255), input.tandaTanganUrl)
      .input("tanpaBayar", sql.Bit, input.tanpaPembayaran).query(`
        UPDATE DashboardPengirimanStopDelivery
        SET JamSelesai = GETDATE(), FotoBuktiUrls = @fotoBuktiUrls,
            TandaTanganUrl = @ttd, TanpaPembayaran = @tanpaBayar, ModifiedDate = GETDATE()
        WHERE JadwalDetailID = @id AND JamSelesai IS NULL
      `);
    if (claim.rowsAffected[0] === 0) {
      throw new AppError("Stop ini sudah dikonfirmasi selesai atau sedang diproses.");
    }

    let salesReturnId: string | null = null;
    if (hasRetur) {
      salesReturnId = await nextSalesReturnId(transaction);
      const srVoucherSeq = await nextSRVoucherSeq(transaction, yearMonth);
      const srVoucherNo = `MKE/SR/${srVoucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
      const returAmount = input.items.reduce((sum, item) => {
        const sod = soDetailById.get(item.salesOrderDetailId)!;
        return sum + (sod.Qty - item.qtyDiterima) * sod.Price;
      }, 0);

      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), salesReturnId)
        .input("voucherNo", sql.VarChar(128), srVoucherNo)
        .input("soId", sql.VarChar(16), detailRow.SalesOrderID)
        .input("doId", sql.VarChar(16), detailRow.DeliveryOrderID)
        .input("bpId", sql.VarChar(16), soRow.BusinessPartnerID)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("amount", sql.Decimal(23, 4), returAmount)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID).query(`
          INSERT INTO SalesReturn
            (SalesReturnID, VoucherNo, TransDate, SalesOrderID, DeliveryOrderID, BusinessPartnerID, BranchID,
             DepartmentID, Amount, Disc, DiscValue, DiscRp, Tax, TaxValue, Netto, Paid, Deposit, IsClosed,
             IsDeleted, ModifiedDate, SalesmanID, Rate, IsInvoiced)
          VALUES
            (@id, @voucherNo, GETDATE(), @soId, @doId, @bpId, @branchId,
             @departmentId, @amount, 0, 0, 0, 0, 0, @amount, 0, 0, 0,
             0, GETDATE(), @salesmanId, 1, 1)
        `);

      for (const item of input.items) {
        const sod = soDetailById.get(item.salesOrderDetailId)!;
        const qtyRetur = sod.Qty - item.qtyDiterima;
        if (qtyRetur <= 0) continue;
        const srDetailId = await nextSalesReturnDetailId(transaction);
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), srDetailId)
          .input("srId", sql.VarChar(16), salesReturnId)
          .input("itemId", sql.VarChar(160), sod.ItemID)
          .input("name", sql.VarChar(150), sod.Name)
          .input("qty", sql.Decimal(23, 4), qtyRetur)
          .input("price", sql.Decimal(23, 4), sod.Price)
          .input("amount", sql.Decimal(23, 4), qtyRetur * sod.Price)
          .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID).query(`
            INSERT INTO SalesReturnDetail
              (SalesReturnDetailID, SalesReturnID, ItemID, Qty, Unit, Ratio, UnitRatio, Price, Disc, DiscValue,
               DiscRp, Amount, Name, Value, Netto, Retur, SalesOrderDetailID)
            VALUES
              (@id, @srId, @itemId, @qty, 'PCS', 1, 1, @price, 0, 0,
               0, @amount, @name, @amount, @amount, @qty, @soDetailId)
          `);
      }

      await new sql.Request(transaction)
        .input("id", sql.Int, existingStopRow.StopDeliveryID)
        .input("srId", sql.VarChar(16), salesReturnId)
        .query(`UPDATE DashboardPengirimanStopDelivery SET SalesReturnID = @srId WHERE StopDeliveryID = @id`);
    }

    // SalesInvoiceDetail has no SalesOrderDetailID (or any other) column
    // that directly keys back to the SalesOrderDetail row it was billed
    // from, and — confirmed live — an invoice can carry multiple detail
    // rows sharing the same ItemID (e.g. two separately-priced lines for
    // the same product), so `WHERE SalesInvoiceID = @siId AND ItemID =
    // @itemId` is NOT safe: it can match several rows at once and clobber
    // every one of them with a single line's Qty/Amount. DeliveryOrderDetail
    // DOES carry SalesOrderDetailID, and selesaiMuat (this file, above)
    // creates one DeliveryOrderDetail row then, immediately after in the
    // same soDetails loop iteration, one SalesInvoiceDetail row — both IDs
    // assigned via sequential MAX+1 at creation time. That means the Kth
    // DeliveryOrderDetail row for this DO (ordered by DeliveryOrderDetailID)
    // was created in the same iteration as, and therefore corresponds
    // positionally to, the Kth SalesInvoiceDetail row for its sibling SI
    // (ordered by SalesInvoiceDetailID) — true regardless of any other
    // concurrent activity elsewhere in the DB, since only relative order
    // within this one already-filtered DO/SI pair is used, never a global
    // ID comparison. This gives a real, safe key (SalesInvoiceDetailID, the
    // actual primary key) to update on instead.
    const doDetailsResult = await new sql.Request(transaction)
      .input("doId", sql.VarChar(16), detailRow.DeliveryOrderID)
      .query(`SELECT DeliveryOrderDetailID, SalesOrderDetailID FROM DeliveryOrderDetail WHERE DeliveryOrderID = @doId ORDER BY DeliveryOrderDetailID`);
    const doDetailRows = doDetailsResult.recordset as { DeliveryOrderDetailID: string; SalesOrderDetailID: string }[];

    const siDetailsResult = await new sql.Request(transaction)
      .input("siId", sql.VarChar(16), detailRow.SalesInvoiceID)
      .query(`SELECT SalesInvoiceDetailID FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId ORDER BY SalesInvoiceDetailID`);
    const siDetailRows = siDetailsResult.recordset as { SalesInvoiceDetailID: string }[];

    if (doDetailRows.length !== siDetailRows.length) {
      throw new AppError("Jumlah baris DeliveryOrderDetail dan SalesInvoiceDetail tidak sama, tidak bisa memproses konfirmasi ini.");
    }

    const salesInvoiceDetailIdBySoDetailId = new Map<string, string>();
    doDetailRows.forEach((doDetail, i) => {
      salesInvoiceDetailIdBySoDetailId.set(doDetail.SalesOrderDetailID, siDetailRows[i].SalesInvoiceDetailID);
    });

    for (const item of input.items) {
      const sod = soDetailById.get(item.salesOrderDetailId)!;
      const qtyRetur = sod.Qty - item.qtyDiterima;
      const newAmount = item.qtyDiterima * sod.Price;

      const dodUpdate = await new sql.Request(transaction)
        .input("doId", sql.VarChar(16), detailRow.DeliveryOrderID)
        .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID)
        .input("delivered", sql.Decimal(23, 4), item.qtyDiterima)
        .query(
          `UPDATE DeliveryOrderDetail SET Delivered = @delivered WHERE DeliveryOrderID = @doId AND SalesOrderDetailID = @soDetailId`
        );
      if (dodUpdate.rowsAffected[0] === 0) {
        throw new AppError(`Baris DeliveryOrderDetail untuk item ${sod.Name} tidak ditemukan, tidak bisa menyimpan konfirmasi ini.`);
      }

      // NOTE: SalesInvoiceDetail has no Retur column on the live schema
      // (confirmed via INFORMATION_SCHEMA.COLUMNS — its 19 live columns are
      // SalesInvoiceDetailID/SalesInvoiceID/ItemID/Qty/Unit/Ratio/UnitRatio/
      // Price/Disc/DiscValue/DiscRp/Amount/Name/Value/Netto/Description/
      // WaiterName/Cashback/Total). The brief's original draft included
      // `Retur = @retur` here, transcribed from SalesReturnDetail (which DOES
      // have a real Retur column, used correctly below) — that was a
      // schema-snapshot transcription mistake caught by this task's own
      // mandatory Step 4 live-schema diff and removed. The retur quantity for
      // this line is still fully recorded elsewhere: SalesReturnDetail.Retur
      // (the formal ERP document) and DashboardPengirimanStopDeliveryItem.QtyRetur
      // (this dashboard's own per-stop record).
      const salesInvoiceDetailId = salesInvoiceDetailIdBySoDetailId.get(sod.SalesOrderDetailID);
      if (!salesInvoiceDetailId) throw new AppError(`Baris invoice untuk item ${sod.Name} tidak ditemukan.`);

      const sidUpdate = await new sql.Request(transaction)
        .input("siDetailId", sql.VarChar(16), salesInvoiceDetailId)
        .input("qty", sql.Decimal(23, 4), item.qtyDiterima)
        .input("amount", sql.Decimal(23, 4), newAmount)
        .query(
          `UPDATE SalesInvoiceDetail SET Qty = @qty, Amount = @amount, Netto = @amount, Value = @amount
           WHERE SalesInvoiceDetailID = @siDetailId`
        );
      if (sidUpdate.rowsAffected[0] === 0) {
        throw new AppError(`Baris SalesInvoiceDetail untuk item ${sod.Name} tidak ditemukan, tidak bisa menyimpan konfirmasi ini.`);
      }

      await new sql.Request(transaction)
        .input("stopDeliveryId", sql.Int, existingStopRow.StopDeliveryID)
        .input("soDetailId", sql.VarChar(16), sod.SalesOrderDetailID)
        .input("itemId", sql.VarChar(160), sod.ItemID)
        .input("qtyDimuat", sql.Decimal(23, 4), sod.Qty)
        .input("qtyDiterima", sql.Decimal(23, 4), item.qtyDiterima)
        .input("qtyRetur", sql.Decimal(23, 4), qtyRetur)
        .input("fotoRetur", sql.VarChar(255), item.fotoReturUrl)
        .input("keteranganRetur", sql.VarChar(500), item.keteranganRetur).query(`
          INSERT INTO DashboardPengirimanStopDeliveryItem
            (StopDeliveryID, SalesOrderDetailID, ItemID, QtyDimuat, QtyDiterima, QtyRetur, FotoReturUrl, KeteranganRetur)
          VALUES
            (@stopDeliveryId, @soDetailId, @itemId, @qtyDimuat, @qtyDiterima, @qtyRetur, @fotoRetur, @keteranganRetur)
        `);
    }

    // Recompute the invoice header from its now-updated detail rows —
    // the step vCustomerStatement's Outstanding calculation depends on.
    const totalResult = await new sql.Request(transaction)
      .input("siId", sql.VarChar(16), detailRow.SalesInvoiceID)
      .query(`SELECT SUM(Amount) AS Total FROM SalesInvoiceDetail WHERE SalesInvoiceID = @siId`);
    const newTotal = (totalResult.recordset[0]?.Total as number | null) ?? 0;
    await new sql.Request(transaction)
      .input("siId", sql.VarChar(16), detailRow.SalesInvoiceID)
      .input("total", sql.Decimal(23, 4), newTotal)
      .query(`UPDATE SalesInvoice SET Amount = @total, Netto = @total WHERE SalesInvoiceID = @siId`);

    await transaction.commit();
    return { stopDeliveryId: existingStopRow.StopDeliveryID, salesInvoiceId: detailRow.SalesInvoiceID };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
