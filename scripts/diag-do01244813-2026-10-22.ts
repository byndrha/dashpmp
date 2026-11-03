import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: DO 01244813 (SI/004743 punya kredit 1399 tanpa debit DO).
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  console.log("== DO ==");
  console.log(JSON.stringify(await q(`SELECT DeliveryOrderID, VoucherNo, TransDate, ModifiedDate, IsDeleted, IsClosed, IsInvoiced FROM DeliveryOrder WHERE DeliveryOrderID='01244813'`), null, 1));
  console.log("== DO detail ==");
  console.log(JSON.stringify(await q(`SELECT ItemID, Qty FROM DeliveryOrderDetail WHERE DeliveryOrderID='01244813'`)));
  console.log("== SI yg menunjuk DO ini (semua, termasuk terhapus) ==");
  console.log(JSON.stringify(await q(`SELECT SalesInvoiceID, VoucherNo, TransDate, ModifiedDate, IsDeleted, Netto FROM SalesInvoice WHERE REPLACE(DeliveryOrderID,'''','')='01244813'`), null, 1));
  console.log("== GL semua baris utk DO ini & SI-nya ==");
  console.log(JSON.stringify(await q(`SELECT g.ID, g.Type, g.VoucherNo, c.AccountNo, g.Debit, g.Credit, g.Memo, g.TransDate FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE g.VoucherNo IN (SELECT VoucherNo FROM DeliveryOrder WHERE DeliveryOrderID='01244813') OR g.VoucherNo='MKE/SI/004743/2026-09/003/001' ORDER BY g.VoucherNo, c.AccountNo`), null, 1));
  console.log("== Audit dashboard utk DO/SI ini ==");
  console.log(JSON.stringify(await q(`SELECT * FROM DashboardGLPostingBackfill WHERE DocumentID IN ('01244813') OR VoucherNo='MKE/SI/004743/2026-09/003/001'`), null, 1));
  console.log("== Jadwal dashboard ==");
  console.log(JSON.stringify(await q(`SELECT DeliveryOrderID, SalesInvoiceID, IsDeleted FROM DashboardPengirimanJadwalDetail WHERE DeliveryOrderID='01244813'`)));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
