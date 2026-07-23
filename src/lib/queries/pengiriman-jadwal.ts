import { getPool, sql } from "@/lib/db";
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";
import { getArmadaList, type ArmadaRow } from "@/lib/queries/armada";

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

// SO is "available" for a departure on businessDate when: DueDate falls on
// that day, it's open (not closed/deleted), no DeliveryOrder has been
// created from it yet, and it isn't already sitting in another active
// (non-deleted) Jadwal's detail rows — draft or published.
export async function getAvailableSalesOrders(businessDate: string): Promise<AvailableSalesOrder[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate).query(`
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
        AND so.DueDate >= DATEADD(HOUR, -7, CAST(@businessDate AS DATETIME)) AND so.DueDate < DATEADD(HOUR, -7, DATEADD(DAY, 1, CAST(@businessDate AS DATETIME)))
        AND NOT EXISTS (
          SELECT 1 FROM DeliveryOrder do_ WHERE do_.SalesOrderID = so.SalesOrderID AND do_.IsDeleted = 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM DashboardPengirimanJadwalDetail jd
          JOIN DashboardPengirimanJadwal j ON j.JadwalID = jd.JadwalID
          WHERE jd.SalesOrderID = so.SalesOrderID AND jd.IsDeleted = 0 AND j.IsDeleted = 0
        )
      GROUP BY so.SalesOrderID, so.VoucherNo, bp.Name, bp.NPWPName, so.DueDate
      ORDER BY bp.Name
    `);
  return result.recordset;
}

export async function createJadwalDraft(input: {
  armadaId: number;
  jamJadwal: Date;
  salesOrderIds: string[];
}): Promise<number> {
  const pool = await getPool();

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

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwalDetail SET IsDeleted = 1 WHERE JadwalID = @jadwalId`);
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
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
    .query(`UPDATE DashboardPengirimanJadwal SET JamMulaiMuat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}

export async function startBerangkat(jadwalId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET JamAktualBerangkat = GETDATE(), ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
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

// Draft -> Terbit. For each detail row (in Urutan order), creates one real
// DeliveryOrder + its DeliveryOrderDetail line(s) from the linked
// SalesOrder/SalesOrderDetail, shaped to match live-verified existing
// SO-linked DO rows exactly (see this plan's Global Constraints). Writes
// the new DeliveryOrderID back onto the detail row, then flips
// Jadwal.Status. On partial failure, soft-deletes only the DeliveryOrder/
// DeliveryOrderDetail rows this call itself created (not the Jadwal/SO
// selection) and rethrows — matching createJadwalDraft's own compensating-
// cleanup precedent, scoped to what this function owns.
export async function publishJadwal(jadwalId: number): Promise<void> {
  const pool = await getPool();

  const header = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`SELECT ArmadaID, SalesmanID, Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
  const headerRow = header.recordset[0] as { ArmadaID: number; SalesmanID: string | null; Status: JadwalStatus } | undefined;
  if (!headerRow) throw new Error("Keberangkatan tidak ditemukan.");
  if (headerRow.Status !== "Draft") throw new Error("Keberangkatan ini sudah diterbitkan.");
  if (!headerRow.SalesmanID) throw new Error("Driver wajib diisi sebelum menerbitkan.");

  const armadaResult = await pool
    .request()
    .input("armadaId", sql.Int, headerRow.ArmadaID)
    .query(`SELECT Nama FROM DashboardArmada WHERE ArmadaID = @armadaId`);
  const armadaNama = (armadaResult.recordset[0] as { Nama: string } | undefined)?.Nama ?? null;

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

  const createdDeliveryOrderIds: string[] = [];
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    for (const detail of detailRows) {
      // Idempotent-retry guard: if a previous publishJadwal attempt already
      // created a DeliveryOrder for this detail row (and only failed later,
      // e.g. on the final Status='Terbit' UPDATE), skip it instead of
      // creating a duplicate DO for the same SO.
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
    throw err;
  }

  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`UPDATE DashboardPengirimanJadwal SET Status = 'Terbit', ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
}
