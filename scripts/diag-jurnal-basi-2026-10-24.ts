import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: 3 SI dgn jurnal pendapatan != Netto (SI/004140, SI/003337, SI/002749).
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const V = `('MKE/SI/004140/2026-10/003/001','MKE/SI/003337/2026-10/003/001','MKE/SI/002749/2026-10/003/001')`;
  console.log("== Baris SalesInvoice per voucher ==");
  console.log(JSON.stringify(await q(`SELECT VoucherNo, SalesInvoiceID, IsDeleted, Netto, Amount, DiscRp, CONVERT(char(16),TransDate,120) td, CONVERT(char(16),ModifiedDate,120) md, DeliveryOrderID FROM SalesInvoice WHERE VoucherNo IN ${V} ORDER BY VoucherNo, IsDeleted`)));
  console.log("== Jurnal GL per voucher ==");
  console.log(JSON.stringify(await q(`SELECT g.VoucherNo, g.ID, c.AccountNo, g.Debit, g.Credit, LEFT(ISNULL(g.Memo,''),40) memo FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE g.[Type]='SALESINVOICE' AND g.VoucherNo IN ${V} ORDER BY g.VoucherNo, g.ID, c.AccountNo`)));
  console.log("== Detail SI ==");
  console.log(JSON.stringify(await q(`SELECT s.VoucherNo, s.SalesInvoiceID, s.IsDeleted, x.ItemID, x.Qty FROM SalesInvoice s JOIN SalesInvoiceDetail x ON x.SalesInvoiceID=s.SalesInvoiceID WHERE s.VoucherNo IN ${V} ORDER BY s.VoucherNo`)));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
