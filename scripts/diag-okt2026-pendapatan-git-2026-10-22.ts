import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY Oktober 2026: selisih pendapatan GL vs SI dan sisa GIT 1399.
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r, null, 1)}`);
  const OKT = `>='2026-10-01' AND TransDate<'2026-11-01'`;

  P("1. Total", await q(`SELECT
    (SELECT SUM(Netto) FROM SalesInvoice WHERE IsDeleted=0 AND TransDate ${OKT}) total_si,
    (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
       WHERE c.AccountNo IN ('4001','4004') AND g.TransDate ${OKT.replace(/TransDate/g, "g.TransDate")}) pendapatan_gl,
    (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
       WHERE c.AccountNo='1399') saldo_1399_total`));

  P("2. SI aktif Okt yang nilainya != pendapatan GL, ringkas per tanggal & jumlah baris GL", await q(`
    WITH r AS (SELECT g.VoucherNo, SUM(g.Credit-g.Debit) pend, COUNT(*) n FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
               WHERE g.Type='SALESINVOICE' AND c.AccountNo IN ('4001','4004') GROUP BY g.VoucherNo)
    SELECT CONVERT(char(10),s.TransDate,120) tgl, COUNT(*) n_si, SUM(s.Netto) netto, SUM(ISNULL(r.pend,0)) pend, SUM(s.Netto-ISNULL(r.pend,0)) selisih,
           SUM(CASE WHEN r.VoucherNo IS NULL THEN 1 ELSE 0 END) tanpa_gl
    FROM SalesInvoice s LEFT JOIN r ON r.VoucherNo=s.VoucherNo
    WHERE s.IsDeleted=0 AND s.TransDate ${OKT.replace(/TransDate/g, "s.TransDate")} AND ABS(s.Netto-ISNULL(r.pend,0))>0.5
    GROUP BY CONVERT(char(10),s.TransDate,120) ORDER BY 1`));

  P("3. 40 SI selisih terbesar (termasuk tautan jadwal dashboard & jumlah detail)", await q(`
    WITH r AS (SELECT g.VoucherNo, SUM(g.Credit-g.Debit) pend, COUNT(*) n FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
               WHERE g.Type='SALESINVOICE' AND c.AccountNo IN ('4001','4004') GROUP BY g.VoucherNo)
    SELECT TOP 40 s.VoucherNo, CONVERT(char(16),s.TransDate,120) td, s.Netto, ISNULL(r.pend,0) pend, s.Netto-ISNULL(r.pend,0) selisih,
      (SELECT COUNT(*) FROM SalesInvoiceDetail x WHERE x.SalesInvoiceID=s.SalesInvoiceID) n_detail,
      (SELECT STRING_AGG(x.ItemID, ',') FROM SalesInvoiceDetail x WHERE x.SalesInvoiceID=s.SalesInvoiceID) items,
      (SELECT COUNT(*) FROM DashboardPengirimanJadwalDetail j WHERE j.SalesInvoiceID=s.SalesInvoiceID AND j.IsDeleted=0) di_jadwal,
      (SELECT COUNT(*) FROM DashboardTakeAwayMuatan t WHERE t.SalesInvoiceID=s.SalesInvoiceID) di_takeaway
    FROM SalesInvoice s LEFT JOIN r ON r.VoucherNo=s.VoucherNo
    WHERE s.IsDeleted=0 AND s.TransDate ${OKT.replace(/TransDate/g, "s.TransDate")} AND ABS(s.Netto-ISNULL(r.pend,0))>0.5
    ORDER BY ABS(s.Netto-ISNULL(r.pend,0)) DESC`));

  P("4. Jurnal pendapatan Okt milik SI terhapus / voucher tanpa SI aktif", await q(`
    SELECT g.VoucherNo, CONVERT(char(16),g.TransDate,120) td, SUM(g.Credit-g.Debit) pend, LEFT(MAX(ISNULL(g.Memo,'')),30) memo
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE g.Type='SALESINVOICE' AND c.AccountNo IN ('4001','4004') AND g.TransDate ${OKT.replace(/TransDate/g, "g.TransDate")}
      AND NOT EXISTS (SELECT 1 FROM SalesInvoice s WHERE s.VoucherNo=g.VoucherNo AND s.IsDeleted=0)
    GROUP BY g.VoucherNo, g.TransDate`));

  P("5. DO Okt dgn debit 1399 vs kredit SI/SR (selisih per DO), ringkas per kategori", await q(`
    WITH d AS (SELECT g.VoucherNo, SUM(g.Debit-g.Credit) deb FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
               WHERE c.AccountNo='1399' AND g.Type='DELIVERYORDER' AND g.TransDate ${OKT.replace(/TransDate/g, "g.TransDate")} GROUP BY g.VoucherNo)
    SELECT d.VoucherNo, ROUND(d.deb,2) deb, dd.IsInvoiced inv,
      (SELECT COUNT(*) FROM SalesInvoice s WHERE REPLACE(s.DeliveryOrderID,'''','')=dd.DeliveryOrderID AND s.IsDeleted=0) si_aktif,
      (SELECT ROUND(SUM(g.Credit-g.Debit),2) FROM SalesInvoice s JOIN GeneralLedger g ON g.VoucherNo=s.VoucherNo AND g.Type='SALESINVOICE'
         JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID AND c.AccountNo='1399'
        WHERE REPLACE(s.DeliveryOrderID,'''','')=dd.DeliveryOrderID AND s.IsDeleted=0) kredit_si
    FROM d JOIN DeliveryOrder dd ON dd.VoucherNo=d.VoucherNo AND dd.IsDeleted=0
    WHERE dd.IsInvoiced=1 ORDER BY d.VoucherNo`));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
