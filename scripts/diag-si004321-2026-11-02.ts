import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: DO induk SI/004321 dan jurnalnya (sisa kecil kategori Y, -15.926).
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  console.log(JSON.stringify(await q(`
    SELECT s.VoucherNo siv, CONVERT(char(16),s.TransDate,120) si_td, REPLACE(s.DeliveryOrderID,'''','') do_id, d.VoucherNo dov, d.IsDeleted do_del, CONVERT(char(16),d.TransDate,120) do_td,
      (SELECT COUNT(*) FROM GeneralLedger g WHERE g.VoucherNo=d.VoucherNo AND g.[Type]='DELIVERYORDER') baris_gl_do,
      (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID AND c.AccountNo='1399' WHERE g.VoucherNo=d.VoucherNo AND g.[Type]='DELIVERYORDER') do_net1399,
      (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID AND c.AccountNo='1399' WHERE g.VoucherNo=s.VoucherNo AND g.[Type]='SALESINVOICE') si_net1399
    FROM SalesInvoice s LEFT JOIN DeliveryOrder d ON d.DeliveryOrderID=REPLACE(s.DeliveryOrderID,'''','')
    WHERE s.VoucherNo='MKE/SI/004321/2026-10/003/001'`)));
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
