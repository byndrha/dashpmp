import { getPool, sql } from "@/lib/db";
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";
import { getArmadaList, type ArmadaRow } from "@/lib/queries/armada";
import { getPabrikLocation } from "@/lib/queries/pabrik-location";
import { getMultiPointRoute } from "@/lib/osrm";

// Same 5KG-counts-as-half-a-kantong normalization already established in
// mitra-do.ts's KANTONG_QTY_EXPR, applied to SalesOrderDetail.Qty since that
// (not DeliveryOrderDetail) is the uniform source of line-item data for
// both Draft and Terbit Jadwal rows — a Draft has no DeliveryOrderDetail
// yet.
const JADWAL_KANTONG_EXPR = `SUM(CASE WHEN sod.Name LIKE '%5 KG%' THEN sod.Qty / 2.0 ELSE sod.Qty END)`;

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
}

export async function getPengirimanBoard(businessDate: string): Promise<{ armada: ArmadaRow[]; jadwal: JadwalCard[] }> {
  const pool = await getPool();
  const [armada, jadwalResult] = await Promise.all([
    getArmadaList(),
    pool
      .request()
      .input("businessDate", sql.Date, businessDate).query(`
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
            COUNT(DISTINCT jd.JadwalDetailID) AS TotalStop
        FROM DashboardPengirimanJadwal j
        LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
        LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
        LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
        WHERE j.IsDeleted = 0
          AND j.JamJadwal >= DATEADD(HOUR, -7, CAST(@businessDate AS DATETIME)) AND j.JamJadwal < DATEADD(HOUR, -7, DATEADD(DAY, 1, CAST(@businessDate AS DATETIME)))
        GROUP BY j.JadwalID, j.ArmadaID, j.SalesmanID, sm.Name, j.JamJadwal, j.JamMulaiMuat, j.JamAktualBerangkat, j.Status
        ORDER BY j.JamJadwal
      `),
  ]);
  return { armada, jadwal: jadwalResult.recordset };
}

export interface JadwalDetailRow {
  JadwalDetailID: number;
  SalesOrderID: string;
  DeliveryOrderID: string | null;
  Urutan: number;
  CustomerName: string;
  Qty: number;
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
          so.DueDate
      FROM SalesOrder so
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = so.SalesOrderID
      WHERE so.IsDeleted = 0
        AND so.IsClosed = 0
        AND so.DueDate >= DATEADD(DAY, -@lookbackDays, DATEADD(HOUR, -7, CAST(@businessDate AS DATETIME)))
        AND so.DueDate < DATEADD(HOUR, -7, DATEADD(DAY, 1, CAST(@businessDate AS DATETIME)))
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

export async function createJadwalDraft(input: {
  armadaId: number;
  jamJadwal: Date;
  salesOrderIds: string[];
}): Promise<number> {
  const pool = await getPool();

  const totalQty = await sumSalesOrderQty(pool, input.salesOrderIds);
  await assertWithinCapacity(pool, input.armadaId, totalQty);

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
    .query(`SELECT ArmadaID, Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; Status: JadwalStatus } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new Error("Keberangkatan ini sudah berangkat, tidak bisa menambah SO.");

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

export async function updateJadwalDriverTime(
  jadwalId: number,
  input: { jamJadwal: Date; salesmanId: string | null }
): Promise<void> {
  const pool = await getPool();
  const current = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT Status, ArmadaID FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const row = current.recordset[0] as { Status: JadwalStatus; ArmadaID: number } | undefined;
  if (!row) throw new Error("Keberangkatan tidak ditemukan.");

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal)
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamJadwal = @jamJadwal, SalesmanID = @salesmanId, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);

  if (row.Status === "Terbit") {
    const armadaResult = await pool
      .request()
      .input("armadaId", sql.Int, row.ArmadaID)
      .query(`SELECT Nama FROM DashboardArmada WHERE ArmadaID = @armadaId`);
    const armadaNama = (armadaResult.recordset[0] as { Nama: string } | undefined)?.Nama ?? null;

    const linkedDOs = await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .query(`
        SELECT DeliveryOrderID FROM DashboardPengirimanJadwalDetail
        WHERE JadwalID = @jadwalId AND IsDeleted = 0 AND DeliveryOrderID IS NOT NULL
      `);
    for (const r of linkedDOs.recordset as { DeliveryOrderID: string }[]) {
      await assignDeliveryDriver(r.DeliveryOrderID, input.salesmanId);
      await assignDeliveryVehicle(r.DeliveryOrderID, armadaNama);
    }
  }
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
  try {
    await getMultiPointRoute([
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
    .query(
      `UPDATE DashboardPengirimanJadwal SET Status = 'Terbit', JamAktualBerangkat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId AND Status = 'Draft'`
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
      .input("armadaId", sql.Int, headerRow.ArmadaID)
      .query(`SELECT Nama FROM DashboardArmada WHERE ArmadaID = @armadaId AND IsDeleted = 0`);
    const armadaRow = armadaResult.recordset[0] as { Nama: string } | undefined;
    // Departure assigns a real vehicle to a real ERP document — a
    // soft-deleted Armada (deleted after this Draft was created, before it
    // departed) must block departure rather than silently write a stale or
    // blank VehicleNo onto a permanent DeliveryOrder.
    if (!armadaRow) throw new Error("Armada sudah dihapus, tidak bisa berangkat.");
    const armadaNama = armadaRow.Nama;

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
      // duplicate DO for the same SO.
      if (detail.DeliveryOrderID) continue;

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
        .input("vehicleNo", sql.VarChar(50), armadaNama)
        .input("salesmanId", sql.VarChar(16), headerRow.SalesmanID)
        .input("dueDate", sql.DateTime, so.DueDate).query(`
          INSERT INTO DeliveryOrder
            (DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, Notes, SalesOrderID,
             IsClosed, ExpeditionID, VehicleNo, AddressDelivery, IsDeleted, ModifiedDate, PIC, ShippingNo,
             BusinessPartnerLocationID, IsInvoiced, CurrencyID, Rate, StatusForm, SalesmanID, OverLimit,
             ReferenceNo, DueDate, ProjectID, AddressDeliveryID, IsDOReturn)
          VALUES
            (@id, @voucherNo, GETDATE(), @branchId, @departmentId, @bpId, '', @soId,
             0, '', @vehicleNo, '', 0, GETDATE(), '', NULL,
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
        `UPDATE DashboardPengirimanJadwal SET Status = 'Draft', JamAktualBerangkat = NULL, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`
      );
    throw err;
  }
}
