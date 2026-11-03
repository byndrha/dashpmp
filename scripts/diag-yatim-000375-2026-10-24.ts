import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: SI/000375 (yatim, 4 baris non-realtime ID 01254599) + 2 yatim lain.
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r)}`);
  P("Voucher yatim (3)", await q(`
    SELECT g.VoucherNo, COUNT(*) baris, MIN(g.ID) id, SUM(g.Credit-g.Debit) FILTER_PEND, LEFT(MAX(ISNULL(g.Memo,'')),50) memo, CONVERT(char(16),MIN(g.TransDate),120) td
    FROM GeneralLedger g WHERE g.Type='SALESINVOICE' AND g.VoucherNo IN (
      SELECT g2.VoucherNo FROM GeneralLedger g2 JOIN ChartOfAccount c ON c.ChartOfAccountID=g2.ChartOfAccountID
      WHERE g2.Type='SALESINVOICE' AND c.AccountNo IN ('4001','4004') AND g2.TransDate>='2026-10-01' AND g2.TransDate<'2026-11-01'
        AND NOT EXISTS (SELECT 1 FROM SalesInvoice s WHERE s.VoucherNo=g2.VoucherNo AND s.IsDeleted=0))
    GROUP BY g.VoucherNo`.replace("FILTER_PEND", "pend_semua")));
  P("SI/000375 di tabel SalesInvoice (semua baris)", await q(`SELECT SalesInvoiceID, VoucherNo, TransDate, ModifiedDate, IsDeleted, Netto, DeliveryOrderID FROM SalesInvoice WHERE VoucherNo LIKE 'MKE/SI/000375/%'`));
  P("Jurnal SI/000375", await q(`SELECT g.ID, c.AccountNo, g.Debit, g.Credit, g.Memo, g.TransDate FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE g.VoucherNo LIKE 'MKE/SI/000375/%'`));
  P("Audit backfill SI/000375", await q(`SELECT * FROM DashboardGLPostingBackfill WHERE VoucherNo LIKE 'MKE/SI/000375/%'`));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
