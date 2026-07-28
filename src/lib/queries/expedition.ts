import { getPool, sql } from "@/lib/db";

// '012' — the ERP's own Expedition master record for the company's own
// fleet (as opposed to '014'/'015', which are "Di Ambil Sendiri"/pickup
// placeholders, not real vehicles). Every real DashboardArmada should link
// to one row under this ExpeditionID via ExpeditionDetailID.
export const OWN_FLEET_EXPEDITION_ID = "012";

export interface ExpeditionVehicleOption {
  ExpeditionDetailID: string;
  VehicleNo: string;
  Description: string | null;
}

// Feeds the "Kendaraan ERP" picker in Kelola Armada — lets a DashboardArmada
// row be linked to its real ExpeditionDetail record, so DeliveryOrder.
// VehicleNo/ExpeditionID (written at startBerangkat, see pengiriman-jadwal.ts)
// carry the actual plate number the ERP/printed DO expects instead of the
// dashboard's own internal nickname (DashboardArmada.Nama, e.g. "GM 14").
export async function getExpeditionVehicleOptions(): Promise<ExpeditionVehicleOption[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("expeditionId", sql.VarChar(16), OWN_FLEET_EXPEDITION_ID).query(`
      SELECT ExpeditionDetailID, VehicleNo, Description
      FROM ExpeditionDetail
      WHERE ExpeditionID = @expeditionId AND IsDeleted = 0
      ORDER BY VehicleNo
    `);
  return result.recordset;
}
