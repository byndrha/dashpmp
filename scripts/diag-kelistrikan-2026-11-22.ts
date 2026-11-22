// Uji BACA-SAJA (2026-11-22): bahan riset modul Kelistrikan MKEsindo —
// mesin + kWh, kelengkapan catatan On/Off, jam nyala, dan biaya listrik GL.
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  const mesin = await pool.request().query(`SELECT MesinID, Nama, Status, KapasitasProduksiPerHari, KonsumsiListrikKWh, LamaProduksiMenit FROM DashboardProduksiMesin`);
  console.table(mesin.recordset);
  const ev = await pool.request().query(`
    SELECT MesinID, JenisEvent, COUNT(*) AS n, MIN(WaktuEvent) AS pertama, MAX(WaktuEvent) AS terakhir
    FROM DashboardProduksiMesinEvent GROUP BY MesinID, JenisEvent ORDER BY MesinID, JenisEvent`);
  console.table(ev.recordset);
  const harian = await pool.request().query(`
    SELECT TOP 14 CONVERT(date, WaktuEvent) AS tgl, COUNT(*) AS n, COUNT(DISTINCT DicatatOlehAkunID) AS pencatat
    FROM DashboardProduksiMesinEvent GROUP BY CONVERT(date, WaktuEvent) ORDER BY tgl DESC`);
  console.table(harian.recordset);
  const gl = await pool.request().query(`
    SELECT CONVERT(varchar(7), TransDate, 120) AS bulan, SUM(Debit - Credit) AS biaya, COUNT(*) AS n
    FROM GeneralLedger WHERE ChartOfAccountID = '0166' AND TransDate >= DATEADD(MONTH, -12, GETDATE())
    GROUP BY CONVERT(varchar(7), TransDate, 120) ORDER BY bulan`);
  console.table(gl.recordset);
  const memo = await pool.request().query(`SELECT TOP 8 TransDate, VoucherNo, Debit - Credit AS jml, Memo FROM GeneralLedger WHERE ChartOfAccountID = '0166' ORDER BY TransDate DESC`);
  console.table(memo.recordset);
  const tabel = await pool.request().query(`SELECT name FROM sys.tables WHERE name LIKE '%Listrik%' OR name LIKE '%Meter%' OR name LIKE '%KWH%' OR name LIKE '%Energi%' OR name LIKE '%Daya%'`);
  console.log("tabel terkait:", tabel.recordset.map((r) => r.name));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
