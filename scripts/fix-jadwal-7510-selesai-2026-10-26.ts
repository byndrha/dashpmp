import "dotenv/config";
import { getPool } from "../src/lib/db";
// FIX: tandai Jadwal 7510 (TRUK 02, 26 Okt 2026) SELESAI -- hanya mengisi JamSelesai pada stop 20020 (permintaan user).
async function main() {
  const pool = await getPool();
  const cek = await pool.request().query(`SELECT COUNT(*) n FROM DashboardPengirimanStopDelivery WHERE JadwalDetailID=20020`);
  if (cek.recordset[0].n !== 0) throw new Error("StopDelivery sudah ada, batal.");
  await pool.request().query(`INSERT INTO DashboardPengirimanStopDelivery (JadwalDetailID, JamSelesai) VALUES (20020, GETDATE())`);
  const r = await pool.request().query(`SELECT StopDeliveryID, JadwalDetailID, JamTiba, JamSelesai FROM DashboardPengirimanStopDelivery WHERE JadwalDetailID=20020`);
  console.log(JSON.stringify(r.recordset, null, 1));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
