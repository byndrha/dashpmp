import "dotenv/config";
import { getPool, sql } from "../src/lib/db";
// FIX: Jadwal 7510 (TRUK 02, 26 Okt 2026) -> tampil Selesai/Tiba di Pabrik di papan.
// Isi manual atas permintaan user: JamAktualBerangkat + Cek Berangkat & Cek Datang bertanda manual (tanpa angka/foto inspeksi karangan).
async function main() {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const cek = await new sql.Request(tx).query(`SELECT (SELECT COUNT(*) FROM DashboardVehicleCheck WHERE JadwalID=7510) vc, (SELECT COUNT(*) FROM DashboardPengirimanJadwal WHERE JadwalID=7510 AND Status='Terbit' AND JamAktualBerangkat IS NULL) j`);
    if (cek.recordset[0].vc !== 0 || cek.recordset[0].j !== 1) throw new Error("Kondisi awal tidak sesuai, batal.");
    await new sql.Request(tx).query(`UPDATE DashboardPengirimanJadwal SET JamAktualBerangkat=GETDATE(), ModifiedDate=GETDATE() WHERE JadwalID=7510`);
    for (const tipe of ["BERANGKAT", "DATANG"]) {
      await new sql.Request(tx).input("tipe", sql.VarChar(10), tipe).query(`
        INSERT INTO DashboardVehicleCheck (JadwalID, Tipe, OdometerKM, FuelBar, MuatanQty, Remark, CheckedByUserID)
        VALUES (7510, @tipe, 0, 0, 360, N'Diselesaikan manual oleh admin (tanpa inspeksi Satpam)', 'MANUAL')`);
    }
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  const r = await pool.request().query(`SELECT j.JamAktualBerangkat, (SELECT STRING_AGG(Tipe+'@'+CONVERT(varchar(23),CheckedAt,121),', ') FROM DashboardVehicleCheck WHERE JadwalID=7510) vc FROM DashboardPengirimanJadwal j WHERE JadwalID=7510`);
  console.log(JSON.stringify(r.recordset));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
