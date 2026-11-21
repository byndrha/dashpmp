// Diagnostik read-only: kenapa kartu Pemesanan SO MKE/SO/003646 tertulis
// "Belum ada pengiriman" padahal sudah ada DO MKE/DO/003407.
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const so = await pool.request().input("v", sql.VarChar(64), "MKE/SO/003646/2026-11/003/001").query(
    `SELECT SalesOrderID, VoucherNo, TransDate, BusinessPartnerID FROM SalesOrder WHERE VoucherNo = @v`);
  console.log("SO:", so.recordset);
  const soId = so.recordset[0]?.SalesOrderID;
  const dos = await pool.request().input("v", sql.VarChar(64), "MKE/DO/003407/2026-11/003/001").query(
    `SELECT * FROM DeliveryOrder WHERE VoucherNo = @v`);
  const d = dos.recordset[0] ?? {};
  console.log("DO kolom terisi:", Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== "" && v !== 0)));
  const jad = await pool.request().input("so", sql.VarChar(64), soId).query(`
    SELECT jd.JadwalDetailID, jd.IsDeleted AS DetailDeleted, jh.JadwalID, jh.Status, jh.IsDeleted AS JadwalDeleted,
           jh.JamAktualBerangkat, jh.SalesmanID, jh.ArmadaID
    FROM DashboardPengirimanJadwalDetail jd JOIN DashboardPengirimanJadwal jh ON jh.JadwalID = jd.JadwalID
    WHERE jd.SalesOrderID = @so ORDER BY jd.JadwalDetailID DESC`);
  console.log("Jadwal tertaut:", jad.recordset);
  const doBySo = await pool.request().input("so", sql.VarChar(64), soId).query(
    `SELECT DeliveryOrderID, VoucherNo, SalesOrderID, IsDeleted FROM DeliveryOrder WHERE SalesOrderID = @so`);
  console.log("DO via SalesOrderID:", doBySo.recordset);
  const sm = await pool.request().query(`SELECT SalesmanID, Name FROM Salesman WHERE SalesmanID = '0127'`);
  console.log("Salesman DO:", sm.recordset);
  // Seberapa umum: DO tanpa jadwal dashboard dalam 30 hari terakhir.
  const umum = await pool.request().query(`
    SELECT COUNT(*) AS TotalDO,
      SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM DashboardPengirimanJadwalDetail jd
             JOIN DashboardPengirimanJadwal jh ON jh.JadwalID = jd.JadwalID AND jh.IsDeleted = 0
             WHERE jd.SalesOrderID = d.SalesOrderID AND jd.IsDeleted = 0) THEN 1 ELSE 0 END) AS TanpaJadwal,
      SUM(CASE WHEN ISNULL(d.VehicleNo,'') <> '' THEN 1 ELSE 0 END) AS AdaVehicleNo,
      SUM(CASE WHEN ISNULL(d.SalesmanID,'') <> '' THEN 1 ELSE 0 END) AS AdaSalesman
    FROM DeliveryOrder d WHERE d.IsDeleted = 0 AND d.TransDate >= DATEADD(DAY, -30, GETDATE())`);
  console.log("DO 30 hari:", umum.recordset[0]);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
