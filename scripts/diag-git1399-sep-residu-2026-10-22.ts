import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: (1) jejak waktu jurnal yatim SI/004941, (2) sisa 1399 September per rantai DO.
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;

  console.log("== 1. Seluruh kolom jurnal SI/004941 (1399) ==");
  console.log(JSON.stringify(await q(`SELECT TOP 1 g.* FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE g.VoucherNo='MKE/SI/004941/2026-09/003/001' AND c.AccountNo='1399'`), null, 1));
  console.log("== SI/004941 + SR/000077 header ==");
  console.log(JSON.stringify(await q(`SELECT 'SI' t, VoucherNo, TransDate, ModifiedDate, IsDeleted FROM SalesInvoice WHERE VoucherNo='MKE/SI/004941/2026-09/003/001'
    UNION ALL SELECT 'SR', VoucherNo, TransDate, ModifiedDate, IsDeleted FROM SalesReturn WHERE VoucherNo='MKE/SR/000077/2026-09/003/001'`), null, 1));
  console.log("== Audit posting dashboard utk SI/004941 ==");
  console.log(JSON.stringify(await q(`SELECT * FROM DashboardGLPostingBackfill WHERE VoucherNo='MKE/SI/004941/2026-09/003/001'`), null, 1));

  console.log("== 2. Saldo 1399 s/d 30 Sep ==");
  console.log(JSON.stringify(await q(`SELECT SUM(g.Debit-g.Credit) saldo FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate<'2026-10-01'`)));

  console.log("== 3. Rantai DO (Sep) dgn |net|>0.5 -- per voucher GL, dedup ==");
  console.log(JSON.stringify(await q(`
    WITH g AS (
      SELECT g.Type, g.VoucherNo, SUM(g.Debit-g.Credit) net, MIN(g.TransDate) td
      FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
      WHERE c.AccountNo='1399' AND g.TransDate>='2026-09-01' AND g.TransDate<'2026-10-01' GROUP BY g.Type, g.VoucherNo),
    dosi AS (SELECT VoucherNo, MAX(REPLACE(DeliveryOrderID,'''','')) doid FROM SalesInvoice GROUP BY VoucherNo),
    dosr AS (SELECT VoucherNo, MAX(REPLACE(DeliveryOrderID,'''','')) doid FROM SalesReturn GROUP BY VoucherNo),
    dodo AS (SELECT VoucherNo, MAX(DeliveryOrderID) doid FROM DeliveryOrder GROUP BY VoucherNo),
    m AS (SELECT g.*, CASE g.Type WHEN 'DELIVERYORDER' THEN dodo.doid WHEN 'SALESINVOICE' THEN dosi.doid ELSE dosr.doid END doid
          FROM g LEFT JOIN dodo ON g.Type='DELIVERYORDER' AND dodo.VoucherNo=g.VoucherNo
                 LEFT JOIN dosi ON g.Type='SALESINVOICE' AND dosi.VoucherNo=g.VoucherNo
                 LEFT JOIN dosr ON g.Type='SALESRETURN' AND dosr.VoucherNo=g.VoucherNo)
    SELECT m.doid, m.Type, m.VoucherNo, CONVERT(char(16),m.td,120) td, ROUND(m.net,2) net
    FROM m WHERE m.doid IN (SELECT doid FROM m GROUP BY doid HAVING ABS(SUM(net))>0.5) ORDER BY m.doid, m.Type`), null, 1));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
