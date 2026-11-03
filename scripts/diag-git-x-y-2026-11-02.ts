import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: rincian kategori X (jurnal DO milik DO terhapus) dan Y (jurnal SI/SR 1399 tanpa DO terhubung).
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r)}`);

  P("X. jurnal DO 1399 Okt yang DO-nya terhapus / tak ada", await q(`
    SELECT g.VoucherNo, SUM(g.Debit-g.Credit) net1399, LEFT(MAX(ISNULL(g.Memo,'')),22) memo, MAX(g.ID) glId,
      (SELECT COUNT(*) FROM DeliveryOrder d WHERE d.VoucherNo=g.VoucherNo AND d.IsDeleted=0) do_aktif,
      (SELECT COUNT(*) FROM DeliveryOrder d WHERE d.VoucherNo=g.VoucherNo AND d.IsDeleted=1) do_terhapus
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID AND c.AccountNo='1399'
    WHERE g.[Type]='DELIVERYORDER' AND g.TransDate>='2026-10-01'
      AND NOT EXISTS (SELECT 1 FROM DeliveryOrder d WHERE d.VoucherNo=g.VoucherNo AND d.IsDeleted=0)
    GROUP BY g.VoucherNo`));

  P("Y. jurnal SI/SR 1399 Okt yang tak terhubung ke DO aktif di jendela (rincian)", await q(`
    SELECT g.[Type], g.VoucherNo, SUM(g.Debit-g.Credit) net1399, LEFT(MAX(ISNULL(g.Memo,'')),22) memo,
      (SELECT COUNT(*) FROM SalesInvoice s WHERE s.VoucherNo=g.VoucherNo AND s.IsDeleted=0) si_aktif,
      (SELECT TOP 1 REPLACE(s.DeliveryOrderID,'''','') FROM SalesInvoice s WHERE s.VoucherNo=g.VoucherNo ORDER BY s.IsDeleted) do_id,
      (SELECT TOP 1 CONCAT(d.VoucherNo,' del=',d.IsDeleted,' td=',CONVERT(char(10),d.TransDate,120)) FROM SalesInvoice s JOIN DeliveryOrder d ON d.DeliveryOrderID=REPLACE(s.DeliveryOrderID,'''','') WHERE s.VoucherNo=g.VoucherNo ORDER BY s.IsDeleted) do_info
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID AND c.AccountNo='1399'
    WHERE g.[Type] IN ('SALESINVOICE','SALESRETURN') AND g.TransDate>='2026-10-01'
      AND (g.[Type]='SALESRETURN' OR NOT EXISTS (SELECT 1 FROM SalesInvoice s JOIN DeliveryOrder d ON d.DeliveryOrderID=REPLACE(s.DeliveryOrderID,'''','') WHERE s.VoucherNo=g.VoucherNo AND s.IsDeleted=0 AND d.IsDeleted=0 AND d.TransDate>='2026-09-25'))
    GROUP BY g.[Type], g.VoucherNo`));
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
