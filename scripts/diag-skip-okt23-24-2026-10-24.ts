import "dotenv/config";
import { getPool } from "../src/lib/db";
import { computeBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// DIAGNOSTIK READ-ONLY: kenapa SI 23-24 Okt belum terjurnal real-time? + jumlah yatim baru.
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  for (const tgl of ["2026-10-23", "2026-10-24"]) {
    const r = await computeBacklogForDate(tgl);
    const hitung = new Map<string, number>();
    for (const s of r.skipped) hitung.set(`${s.docType} | ${s.alasan}`, (hitung.get(`${s.docType} | ${s.alasan}`) ?? 0) + 1);
    console.log(tgl, "postable:", r.postable.length, JSON.stringify(r.postable.map((p) => p.docType[0]).reduce((a: Record<string, number>, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {})), "| skipped:", JSON.stringify([...hitung]));
  }
  console.log("== yatim pendapatan Okt sekarang ==");
  console.log(JSON.stringify(await q(`
    WITH y AS (SELECT g.VoucherNo, SUM(g.Credit-g.Debit) pend FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
      WHERE g.Type='SALESINVOICE' AND c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01'
        AND NOT EXISTS (SELECT 1 FROM SalesInvoice s WHERE s.VoucherNo=g.VoucherNo AND s.IsDeleted=0) GROUP BY g.VoucherNo)
    SELECT COUNT(*) n_voucher, SUM(pend) nilai FROM y`)));
  console.log("== jurnal real-time terakhir (tanda real-time jalan) ==");
  console.log(JSON.stringify(await q(`SELECT TOP 4 VoucherNo, Type, CONVERT(char(16),TransDate,120) td, LEFT(Memo,40) memo FROM GeneralLedger WHERE LEFT(ISNULL(Memo,''),17)='[DASHPMP-REALTIME' ORDER BY ID DESC`)));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
