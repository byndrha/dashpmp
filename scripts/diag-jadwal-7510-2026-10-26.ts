import "dotenv/config";
import { getPool } from "../src/lib/db";
// DIAGNOSTIK READ-ONLY: stop Jadwal 7510 (TRUK 02, 26 Okt 2026).
async function main() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT jd.JadwalDetailID, jd.SalesOrderID, jd.DeliveryOrderID, jd.SalesInvoiceID, jd.IsDeleted,
      sd.StopDeliveryID, sd.JamTiba, sd.JamSelesai
    FROM DashboardPengirimanJadwalDetail jd
    LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID=jd.JadwalDetailID
    WHERE jd.JadwalID=7510`);
  console.log(JSON.stringify(r.recordset, null, 1));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
