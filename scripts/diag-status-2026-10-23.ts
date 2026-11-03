import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY 23 Okt 2026: status akhir September dan Oktober setelah semalam.
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r)}`);
  const pend = (a: string, b: string) => `(SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
     WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='${a}' AND g.TransDate<'${b}')`;
  const siTot = (a: string, b: string) => `(SELECT SUM(Netto) FROM SalesInvoice WHERE IsDeleted=0 AND TransDate>='${a}' AND TransDate<'${b}')`;

  P("1. September: pendapatan GL vs total SI", await q(`SELECT ${pend("2026-09-01", "2026-10-01")} AS pendapatan_gl, ${siTot("2026-09-01", "2026-10-01")} AS total_si`));
  P("2. GIT 1399: saldo s/d 30 Sep, net Okt, total", await q(`SELECT
    (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate<'2026-10-01') AS saldo_30sep,
    (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate>='2026-10-01') AS net_okt,
    (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399') AS total`));
  P("3. Oktober: pendapatan GL vs total SI", await q(`SELECT ${pend("2026-10-01", "2026-11-01")} AS pendapatan_gl, ${siTot("2026-10-01", "2026-11-01")} AS total_si`));
  P("4. Yatim pendapatan Okt (jumlah voucher, nilai)", await q(`
    WITH y AS (SELECT g.VoucherNo, SUM(g.Credit-g.Debit) pend FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
      WHERE g.Type='SALESINVOICE' AND c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01'
        AND NOT EXISTS (SELECT 1 FROM SalesInvoice s WHERE s.VoucherNo=g.VoucherNo AND s.IsDeleted=0) GROUP BY g.VoucherNo)
    SELECT COUNT(*) n_voucher, SUM(pend) nilai FROM y`));
  P("5. SI aktif Okt tanpa jurnal pendapatan (jumlah, nilai) per kelompok item", await q(`
    WITH r AS (SELECT g.VoucherNo FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
      WHERE g.Type='SALESINVOICE' AND c.AccountNo IN ('4001','4004') GROUP BY g.VoucherNo)
    SELECT CASE WHEN EXISTS (SELECT 1 FROM SalesInvoiceDetail x WHERE x.SalesInvoiceID=s.SalesInvoiceID AND x.ItemID='0112') THEN 'ada-0112' ELSE 'lain' END kel,
           COUNT(*) n, SUM(s.Netto) nilai, SUM(CASE WHEN s.Netto=0 THEN 1 ELSE 0 END) n_nol
    FROM SalesInvoice s LEFT JOIN r ON r.VoucherNo=s.VoucherNo
    WHERE s.IsDeleted=0 AND s.TransDate>='2026-10-01' AND s.TransDate<'2026-11-01' AND r.VoucherNo IS NULL
    GROUP BY CASE WHEN EXISTS (SELECT 1 FROM SalesInvoiceDetail x WHERE x.SalesInvoiceID=s.SalesInvoiceID AND x.ItemID='0112') THEN 'ada-0112' ELSE 'lain' END`));
  P("6. ItemAverage terbaru (ada baris Oktober? bulan 10)", await q(`SELECT Year, Month, COUNT(*) n, MAX(ModifiedDate) md FROM ItemAverage WHERE Year=2026 AND Month>=9 GROUP BY Year, Month ORDER BY 2`));
  P("7. Jurnal dashboard terakhir (tanda posting real-time jalan)", await q(`SELECT TOP 3 VoucherNo, Type, CONVERT(char(16),TransDate,120) td, LEFT(Memo,40) memo FROM GeneralLedger WHERE LEFT(ISNULL(Memo,''),10)='[DASHPMP-' ORDER BY ID DESC`));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
