import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: hipotesis bentrok ID -- jurnal dashboard DO yang hilang ber-ID yang kini dipakai ERP?
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r)}`);
  const IDS = `('01249469','01249507','01249471','01249473','01249475','01249477','01249479','01249509','01249657')`;

  P("1. Baris GL saat ini ber-ID jurnal DO yang hilang (ada penimpa?)", await q(`
    SELECT g.ID, g.[Type], g.VoucherNo, LEFT(ISNULL(g.Memo,''),30) memo, CONVERT(char(16),g.TransDate,120) td FROM GeneralLedger g WHERE g.ID IN ${IDS} ORDER BY g.ID`));
  P("2. ID dokumen ERP terbaru (MAX numerik) per tabel", await q(`
    SELECT 'DeliveryOrder' t, MAX(TRY_CAST(DeliveryOrderID AS BIGINT)) maks FROM DeliveryOrder
    UNION ALL SELECT 'SalesInvoice', MAX(TRY_CAST(SalesInvoiceID AS BIGINT)) FROM SalesInvoice
    UNION ALL SELECT 'SalesReturn', MAX(TRY_CAST(SalesReturnID AS BIGINT)) FROM SalesReturn
    UNION ALL SELECT 'GeneralLedger', MAX(TRY_CAST(ID AS BIGINT)) FROM GeneralLedger`));
  P("3. Dokumen ERP ber-ID di rentang jurnal yang hilang (01249400-01249700)", await q(`
    SELECT 'DO' t, DeliveryOrderID id, VoucherNo, CONVERT(char(16),TransDate,120) td FROM DeliveryOrder WHERE DeliveryOrderID BETWEEN '01249400' AND '01249700'
    UNION ALL SELECT 'SI', SalesInvoiceID, VoucherNo, CONVERT(char(16),TransDate,120) FROM SalesInvoice WHERE SalesInvoiceID BETWEEN '01249400' AND '01249700'
    UNION ALL SELECT 'SR', SalesReturnID, VoucherNo, CONVERT(char(16),TransDate,120) FROM SalesReturn WHERE SalesReturnID BETWEEN '01249400' AND '01249700'`));
  P("4. Jurnal dashboard (semua memo DASHPMP) ber-ID <= MAX ID dokumen ERP saat ini: risiko bentrok ke depan (jumlah)", await q(`
    SELECT COUNT(*) n, MIN(ID) id_min, MAX(ID) id_max FROM GeneralLedger WHERE LEFT(ISNULL(Memo,''),9)='[DASHPMP-' AND TRY_CAST(ID AS BIGINT) >
      (SELECT MAX(TRY_CAST(DeliveryOrderID AS BIGINT)) FROM DeliveryOrder)`));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
