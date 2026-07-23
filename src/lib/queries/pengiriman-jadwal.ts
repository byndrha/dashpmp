import { getPool, sql } from "@/lib/db";
import { assignDeliveryDriver, assignDeliveryVehicle } from "@/lib/queries/delivery";
import { getArmadaList, type ArmadaRow } from "@/lib/queries/armada";

// Same 5KG-counts-as-half-a-kantong normalization already established in
// mitra-do.ts's KANTONG_QTY_EXPR, but against `Qty` (what's ordered/loaded)
// rather than `Delivered` — a departure is being planned/loaded, it hasn't
// necessarily been marked delivered yet.
const JADWAL_KANTONG_EXPR = `SUM(CASE WHEN dod.Name LIKE '%5 KG%' THEN dod.Qty / 2.0 ELSE dod.Qty END)`;

export interface JadwalCard {
  JadwalID: number;
  ArmadaID: number;
  SalesmanID: string | null;
  DriverName: string | null;
  JamJadwal: string | Date;
  JamMulaiMuat: string | Date | null;
  JamAktualBerangkat: string | Date | null;
  TotalKantong: number;
  TotalDO: number;
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
            ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS TotalKantong,
            COUNT(DISTINCT jd.DeliveryOrderID) AS TotalDO
        FROM DashboardPengirimanJadwal j
        LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
        LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
        LEFT JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = jd.DeliveryOrderID
        WHERE j.IsDeleted = 0
          AND j.JamJadwal >= @businessDate AND j.JamJadwal < DATEADD(DAY, 1, @businessDate)
        GROUP BY j.JadwalID, j.ArmadaID, j.SalesmanID, sm.Name, j.JamJadwal, j.JamMulaiMuat, j.JamAktualBerangkat
        ORDER BY j.JamJadwal
      `),
  ]);
  return { armada, jadwal: jadwalResult.recordset };
}

export interface JadwalDetailRow {
  DeliveryOrderID: string;
  CustomerName: string;
  Qty: number;
  Wilayah: string;
  Kecamatan: string | null;
  Alamat: string | null;
  MobileNo: string | null;
}

export async function getJadwalDetail(jadwalId: number): Promise<JadwalDetailRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT
          jd.DeliveryOrderID,
          bp.Name AS CustomerName,
          ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          bp.NPWPAddress AS Kecamatan,
          bp.Address AS Alamat,
          bp.MobileNo
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DeliveryOrder do_ ON do_.DeliveryOrderID = jd.DeliveryOrderID
      JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
      LEFT JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = jd.DeliveryOrderID
      WHERE jd.JadwalID = @jadwalId AND jd.IsDeleted = 0
      GROUP BY jd.DeliveryOrderID, bp.Name, bp.NPWPName, bp.NPWPAddress, bp.Address, bp.MobileNo
      ORDER BY bp.Name
    `);
  return result.recordset;
}

export interface UnassignedDO {
  DeliveryOrderID: string;
  VoucherNo: string;
  CustomerName: string;
  Wilayah: string;
  Qty: number;
}

export async function getUnassignedDeliveryOrders(businessDate: string): Promise<UnassignedDO[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate).query(`
      SELECT
          do_.DeliveryOrderID,
          do_.VoucherNo,
          bp.Name AS CustomerName,
          ISNULL(NULLIF(LTRIM(RTRIM(bp.NPWPName)), ''), 'Tidak Diketahui') AS Wilayah,
          ISNULL(${JADWAL_KANTONG_EXPR}, 0) AS Qty
      FROM DeliveryOrder do_
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do_.BusinessPartnerID
      LEFT JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do_.DeliveryOrderID
      WHERE do_.IsDeleted = 0
        AND do_.TransDate >= @businessDate AND do_.TransDate < DATEADD(DAY, 1, @businessDate)
        AND NOT EXISTS (
          SELECT 1 FROM DashboardPengirimanJadwalDetail jd
          WHERE jd.DeliveryOrderID = do_.DeliveryOrderID AND jd.IsDeleted = 0
        )
      GROUP BY do_.DeliveryOrderID, do_.VoucherNo, bp.Name, bp.NPWPName
      ORDER BY bp.Name
    `);
  return result.recordset;
}

export async function createJadwal(input: {
  armadaId: number;
  salesmanId: string | null;
  jamJadwal: Date;
  deliveryOrderIds: string[];
}): Promise<number> {
  const pool = await getPool();

  // VehicleNo (written to each DO below) stores the Armada's display name,
  // not its numeric ID — same convention assignDeliveryVehicle already
  // uses. Resolved here so callers only need to pass armadaId.
  const armadaResult = await pool
    .request()
    .input("armadaId", sql.Int, input.armadaId)
    .query(`SELECT Nama FROM DashboardArmada WHERE ArmadaID = @armadaId`);
  const armadaNama = (armadaResult.recordset[0] as { Nama: string } | undefined)?.Nama ?? null;

  const result = await pool
    .request()
    .input("armadaId", sql.Int, input.armadaId)
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .input("jamJadwal", sql.DateTime, input.jamJadwal).query(`
      INSERT INTO DashboardPengirimanJadwal (ArmadaID, SalesmanID, JamJadwal, IsDeleted, ModifiedDate)
      OUTPUT inserted.JadwalID
      VALUES (@armadaId, @salesmanId, @jamJadwal, 0, GETDATE())
    `);
  const jadwalId = (result.recordset[0] as { JadwalID: number }).JadwalID;

  for (const doId of input.deliveryOrderIds) {
    await pool
      .request()
      .input("jadwalId", sql.Int, jadwalId)
      .input("doId", sql.VarChar(16), doId)
      .query(`INSERT INTO DashboardPengirimanJadwalDetail (JadwalID, DeliveryOrderID, IsDeleted) VALUES (@jadwalId, @doId, 0)`);
    await assignDeliveryDriver(doId, input.salesmanId);
    await assignDeliveryVehicle(doId, armadaNama);
  }

  return jadwalId;
}

export async function updateJadwalTime(jadwalId: number, jamJadwal: Date): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jamJadwal", sql.DateTime, jamJadwal)
    .query(`UPDATE DashboardPengirimanJadwal SET JamJadwal = @jamJadwal, ModifiedDate = GETDATE() WHERE JadwalID = @jadwalId`);
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
