import { getPool, sql } from "@/lib/db";
import type { JenisKendala } from "@/lib/kendala-options";

// Persisted so it's visible later from an admin/dispatcher view (not built
// yet — this is the data layer only) — the driver-app screen itself just
// stops showing its live ETA countdown once this succeeds, replacing it
// with a "kendala dilaporkan" state.
export async function recordKendala(
  jadwalId: number,
  jadwalDetailId: number,
  salesmanId: string,
  jenisKendala: JenisKendala,
  hubungiTeknisi: boolean
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jadwalDetailId", sql.Int, jadwalDetailId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("jenisKendala", sql.VarChar(50), jenisKendala)
    .input("hubungiTeknisi", sql.Bit, hubungiTeknisi).query(`
      INSERT INTO DashboardPengirimanKendala (JadwalID, JadwalDetailID, SalesmanID, JenisKendala, HubungiTeknisi)
      VALUES (@jadwalId, @jadwalDetailId, @salesmanId, @jenisKendala, @hubungiTeknisi)
    `);
}

export interface KendalaReportRow {
  KendalaID: number;
  JadwalID: number;
  JadwalDetailID: number;
  JenisKendala: string;
  HubungiTeknisi: boolean;
  WaktuLapor: string | Date;
  ArmadaNama: string;
  VehicleNo: string | null;
  DriverName: string | null;
  CustomerName: string | null;
}

// Admin/dispatcher viewer for the driver-app SOS reports — the counterpart
// to recordKendala above. Same Armada/ExpeditionDetail join as
// getJadwalHeader (pengiriman-jadwal.ts) plus the customer name for
// whichever stop was active when the driver reported the issue.
export async function getKendalaReports(limit = 100): Promise<KendalaReportRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit).query(`
      SELECT TOP (@limit)
          k.KendalaID,
          k.JadwalID,
          k.JadwalDetailID,
          k.JenisKendala,
          k.HubungiTeknisi,
          k.WaktuLapor,
          a.Nama AS ArmadaNama,
          ed.VehicleNo,
          sm.Name AS DriverName,
          bp.Name AS CustomerName
      FROM DashboardPengirimanKendala k
      JOIN DashboardPengirimanJadwal j ON j.JadwalID = k.JadwalID
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      LEFT JOIN Salesman sm ON sm.SalesmanID = k.SalesmanID
      LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalDetailID = k.JadwalDetailID
      LEFT JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      ORDER BY k.WaktuLapor DESC
    `);
  return result.recordset as KendalaReportRow[];
}
