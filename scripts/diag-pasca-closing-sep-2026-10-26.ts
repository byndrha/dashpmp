import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: dampak closing September ERP (26 Okt 2026) pada jurnal GL.
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r)}`);

  P("1. Saldo 1399 per akhir bulan", await q(`
    SELECT 'sampai-30Sep' bln, SUM(g.Debit-g.Credit) saldo FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate<'2026-10-01'
    UNION ALL SELECT 'net-Okt', SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate>='2026-10-01'`));
  P("2. Pendapatan 4001+4004 vs total SI, per bulan", await q(`
    SELECT '2026-09' bln,
      (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-09-01' AND g.TransDate<'2026-10-01') gl,
      (SELECT SUM(Netto) FROM SalesInvoice WHERE IsDeleted=0 AND TransDate>='2026-09-01' AND TransDate<'2026-10-01') si
    UNION ALL SELECT '2026-10',
      (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01'),
      (SELECT SUM(Netto) FROM SalesInvoice WHERE IsDeleted=0 AND TransDate>='2026-10-01' AND TransDate<'2026-11-01')`));
  P("3. Asal jurnal DO/SI per bulan (jumlah voucher): dashboard vs ERP", await q(`
    SELECT CONVERT(char(7),g.TransDate,120) bln, g.[Type], CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 'dashboard' ELSE 'ERP' END asal, COUNT(DISTINCT g.VoucherNo) n_voucher
    FROM GeneralLedger g WHERE g.TransDate>='2026-09-01' AND g.[Type] IN ('DELIVERYORDER','SALESINVOICE')
    GROUP BY CONVERT(char(7),g.TransDate,120), g.[Type], CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 'dashboard' ELSE 'ERP' END ORDER BY 1,2,3`));
  P("4. DUPLIKAT: voucher dgn >1 jurnal berbeda ID (per Type), sejak 1 Sep", await q(`
    SELECT x.[Type], COUNT(*) n_voucher_ganda FROM (
      SELECT g.[Type], g.VoucherNo FROM GeneralLedger g WHERE g.TransDate>='2026-09-01' AND g.[Type] IN ('DELIVERYORDER','SALESINVOICE')
      GROUP BY g.[Type], g.VoucherNo HAVING COUNT(DISTINCT g.ID) > 1) x GROUP BY x.[Type]`));
  P("5. Contoh duplikat (maks 8)", await q(`
    SELECT TOP 8 g.[Type], g.VoucherNo, STRING_AGG(CONCAT(g.ID,':',CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 'D' ELSE 'E' END),',') ids
    FROM GeneralLedger g WHERE g.TransDate>='2026-09-01' AND g.[Type] IN ('DELIVERYORDER','SALESINVOICE')
    GROUP BY g.[Type], g.VoucherNo HAVING COUNT(DISTINCT g.ID) > 1`));
  P("6. Konvensi ID jurnal ERP: jurnal bawaan ERP DO/SI Sep -- apakah ID = ID dokumen?", await q(`
    SELECT TOP 1 (SELECT COUNT(*) FROM (SELECT DISTINCT g.VoucherNo, g.ID FROM GeneralLedger g WHERE g.TransDate>='2026-09-15' AND g.TransDate<'2026-09-16' AND g.[Type]='DELIVERYORDER' AND LEFT(ISNULL(g.Memo,''),9)<>'[DASHPMP-') a) n_jurnal,
      (SELECT COUNT(*) FROM (SELECT DISTINCT g.VoucherNo, g.ID FROM GeneralLedger g JOIN DeliveryOrder d ON d.DeliveryOrderID=g.ID AND d.VoucherNo=g.VoucherNo WHERE g.TransDate>='2026-09-15' AND g.TransDate<'2026-09-16' AND g.[Type]='DELIVERYORDER' AND LEFT(ISNULL(g.Memo,''),9)<>'[DASHPMP-') b) n_id_sama_id_dokumen`));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
