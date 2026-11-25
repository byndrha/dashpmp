import "dotenv/config";
import { getPool } from "../src/lib/db";
// DIAGNOSTIK READ-ONLY: Jadwal Armada 9002 / TRUK 02 tanggal 26 Okt 2026.
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r, null, 1)}`);
  P("Jadwal", await q(`
    SELECT j.JadwalID, a.Nama, ed.VehicleNo, j.Status, j.JamJadwal, j.JamMulaiMuat, j.JamSelesaiMuat, j.JamAktualBerangkat, j.JarakKM, j.IsDeleted,
      sm.Name AS Sales
    FROM DashboardPengirimanJadwal j
    LEFT JOIN DashboardArmada a ON a.ArmadaID=j.ArmadaID
    LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID=a.ExpeditionDetailID
    LEFT JOIN Salesman sm ON sm.SalesmanID=j.SalesmanID
    WHERE j.JamJadwal>='2026-10-25' AND j.JamJadwal<'2026-10-27' AND (a.Nama LIKE '%9002%' OR a.Nama LIKE '%02%' OR ed.VehicleNo LIKE '%9002%')`));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
