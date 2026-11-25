import "dotenv/config";
import { getPool } from "../src/lib/db";
// DIAGNOSTIK READ-ONLY: skema DashboardVehicleCheck + contoh baris.
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  console.log(JSON.stringify(await q(`SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DashboardVehicleCheck'`)));
  console.log(JSON.stringify(await q(`SELECT name, definition FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('DashboardVehicleCheck')`)));
  console.log(JSON.stringify(await q(`SELECT TOP 3 VehicleCheckID, JadwalID, Tipe, OdometerKM, FuelBar, MuatanQty, CheckedByUserID, CheckedAt FROM DashboardVehicleCheck ORDER BY VehicleCheckID DESC`)));
  console.log(JSON.stringify(await q(`SELECT VehicleCheckID, Tipe FROM DashboardVehicleCheck WHERE JadwalID=7510`)));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
