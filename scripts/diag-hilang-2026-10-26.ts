import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: DO yang jurnalnya hilang (entri terakhir log pemantau) -- ciri bersama + status closing ERP.
async function main() {
  const log = fs.readFileSync(path.join(__dirname, "..", "docs", "data-fixes", "monitor", "log.jsonl"), "utf8").trim().split("\n");
  const terakhir = JSON.parse(log[log.length - 1]) as { jendela: string[]; hilang: { voucher: string }[] };
  const vouchers = terakhir.hilang.map((h) => h.voucher);
  console.log("Jendela:", terakhir.jendela.join(" -> "), "| hilang:", vouchers.length);
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r)}`);
  const IN = `(${vouchers.map((v) => `'${v}'`).join(",")})`;

  P("1. DO yang hilang: status, tanggal, kapan diubah", await q(`
    SELECT d.VoucherNo, d.DeliveryOrderID, CONVERT(char(16),d.TransDate,120) td, CONVERT(char(16),d.ModifiedDate,120) md, d.IsDeleted, d.IsClosed, d.IsInvoiced,
      (SELECT STRING_AGG(x.ItemID,',') FROM DeliveryOrderDetail x WHERE x.DeliveryOrderID=d.DeliveryOrderID) items,
      (SELECT COUNT(*) FROM GeneralLedger g WHERE g.VoucherNo=d.VoucherNo) baris_gl
    FROM DeliveryOrder d WHERE d.VoucherNo IN ${IN} ORDER BY d.VoucherNo`));
  P("2. Distribusi IsClosed/IsInvoiced DO tanggal 29-30 Sep yang MASIH punya jurnal (pembanding)", await q(`
    SELECT d.IsClosed, d.IsInvoiced, COUNT(*) n FROM DeliveryOrder d
    WHERE d.IsDeleted=0 AND d.TransDate>='2026-09-29' AND d.TransDate<'2026-10-01'
      AND EXISTS (SELECT 1 FROM GeneralLedger g WHERE g.VoucherNo=d.VoucherNo AND g.Type='DELIVERYORDER') GROUP BY d.IsClosed, d.IsInvoiced`));
  P("3. ItemAverage per bulan (closing ERP sudah mulai?)", await q(`SELECT Month, COUNT(*) n, MAX(ModifiedDate) md FROM ItemAverage WHERE Year=2026 AND Month>=9 GROUP BY Month ORDER BY Month`));
  P("4. Jurnal DO bawaan-ERP vs dashboard, September", await q(`
    SELECT CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 'dashboard' ELSE 'bawaan-ERP' END asal, COUNT(DISTINCT g.VoucherNo) n_voucher
    FROM GeneralLedger g WHERE g.Type='DELIVERYORDER' AND g.TransDate>='2026-09-01' AND g.TransDate<'2026-10-01'
    GROUP BY CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 'dashboard' ELSE 'bawaan-ERP' END`));
  P("5. Jurnal SI/SR milik DO yang hilang masih ada? (jumlah baris 1399 per voucher SI/SR)", await q(`
    SELECT g.Type, g.VoucherNo, SUM(g.Debit-g.Credit) net1399, LEFT(MAX(ISNULL(g.Memo,'')),30) memo
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID AND c.AccountNo='1399'
    WHERE g.Type IN ('SALESINVOICE','SALESRETURN') AND g.TransDate>='2026-09-30' AND g.TransDate<'2026-10-01' GROUP BY g.Type, g.VoucherNo ORDER BY g.VoucherNo`));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
