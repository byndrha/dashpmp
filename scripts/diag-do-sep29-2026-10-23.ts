import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: DO 01244831-34 (SI/004765-68 mengkredit 1399 tanpa debit DO).
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const IDS = `('01244831','01244832','01244833','01244834')`;
  console.log("== DO ==");
  console.log(JSON.stringify(await q(`SELECT DeliveryOrderID, VoucherNo, TransDate, ModifiedDate, IsDeleted, IsClosed, IsInvoiced FROM DeliveryOrder WHERE DeliveryOrderID IN ${IDS}`)));
  console.log("== Detail DO ==");
  console.log(JSON.stringify(await q(`SELECT DeliveryOrderID, ItemID, Qty FROM DeliveryOrderDetail WHERE DeliveryOrderID IN ${IDS}`)));
  console.log("== SI terkait ==");
  console.log(JSON.stringify(await q(`SELECT SalesInvoiceID, VoucherNo, TransDate, ModifiedDate, IsDeleted, Netto, DeliveryOrderID FROM SalesInvoice WHERE REPLACE(DeliveryOrderID,'''','') IN ${IDS}`)));
  console.log("== GL semua baris DO ini ==");
  console.log(JSON.stringify(await q(`SELECT g.ID, g.Type, g.VoucherNo, c.AccountNo, g.Debit, g.Credit, LEFT(ISNULL(g.Memo,''),40) memo, g.TransDate
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE g.VoucherNo IN (SELECT VoucherNo FROM DeliveryOrder WHERE DeliveryOrderID IN ${IDS}) ORDER BY g.VoucherNo, c.AccountNo`)));
  console.log("== Audit dashboard ==");
  console.log(JSON.stringify(await q(`SELECT * FROM DashboardGLPostingBackfill WHERE DocumentID IN ${IDS}`)));
  console.log("== Baris GL SI terkait (1399) memo ==");
  console.log(JSON.stringify(await q(`SELECT g.VoucherNo, g.ID, g.Credit, LEFT(ISNULL(g.Memo,''),40) memo FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID AND c.AccountNo='1399'
    WHERE g.VoucherNo IN ('MKE/SI/004765/2026-09/003/001','MKE/SI/004766/2026-09/003/001','MKE/SI/004767/2026-09/003/001','MKE/SI/004768/2026-09/003/001')`)));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
