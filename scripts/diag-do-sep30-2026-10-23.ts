import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: DO 01244908/10/14 (SI/004848, 004850, 004854 mengkredit 1399 tanpa debit DO).
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const IDS = `('01244908','01244910','01244914')`;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r)}`);
  P("DO", await q(`SELECT DeliveryOrderID, VoucherNo, TransDate, ModifiedDate, IsDeleted, IsClosed, IsInvoiced FROM DeliveryOrder WHERE DeliveryOrderID IN ${IDS}`));
  P("Detail DO", await q(`SELECT DeliveryOrderID, ItemID, Qty FROM DeliveryOrderDetail WHERE DeliveryOrderID IN ${IDS}`));
  P("SI terkait (semua, termasuk terhapus)", await q(`SELECT SalesInvoiceID, VoucherNo, TransDate, ModifiedDate, IsDeleted, Netto, DeliveryOrderID FROM SalesInvoice WHERE REPLACE(DeliveryOrderID,'''','') IN ${IDS}`));
  P("GL baris DO ini", await q(`SELECT g.ID, g.Type, g.VoucherNo, c.AccountNo, g.Debit, g.Credit, LEFT(ISNULL(g.Memo,''),40) memo
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE g.VoucherNo IN (SELECT VoucherNo FROM DeliveryOrder WHERE DeliveryOrderID IN ${IDS})`));
  P("GL 1399 SI terkait", await q(`SELECT g.VoucherNo, g.ID, g.Credit, g.TransDate, LEFT(ISNULL(g.Memo,''),40) memo FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID AND c.AccountNo='1399'
    WHERE g.VoucherNo IN ('MKE/SI/004848/2026-09/003/001','MKE/SI/004850/2026-09/003/001','MKE/SI/004854/2026-09/003/001')`));
  P("DO tanpa jurnal Sep 29-30 (semua)", await q(`SELECT d.VoucherNo, d.DeliveryOrderID, CONVERT(char(16),d.TransDate,120) td, d.IsInvoiced,
      (SELECT STRING_AGG(x.ItemID,',') FROM DeliveryOrderDetail x WHERE x.DeliveryOrderID=d.DeliveryOrderID) items
    FROM DeliveryOrder d WHERE d.IsDeleted=0 AND d.TransDate>='2026-09-29' AND d.TransDate<'2026-10-01'
      AND NOT EXISTS (SELECT 1 FROM GeneralLedger g WHERE g.VoucherNo=d.VoucherNo AND g.Type='DELIVERYORDER')`));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
