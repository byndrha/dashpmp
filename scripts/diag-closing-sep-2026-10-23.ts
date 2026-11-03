import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: apakah closing ERP September sedang/sudah berjalan?
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const P = (t: string, r: unknown) => console.log(`== ${t} ==\n${JSON.stringify(r)}`);
  P("1. ItemAverage per bulan (2026, bulan >= 8)", await q(`SELECT Month, COUNT(*) n, MAX(ModifiedDate) md FROM ItemAverage WHERE Year=2026 AND Month>=8 GROUP BY Month ORDER BY Month`));
  P("2. DO September aktif tanpa jurnal DELIVERYORDER sama sekali (jumlah), per tanggal", await q(`
    WITH ada AS (SELECT DISTINCT VoucherNo FROM GeneralLedger WHERE Type='DELIVERYORDER' AND TransDate>='2026-09-01' AND TransDate<'2026-10-01')
    SELECT CONVERT(char(10),d.TransDate,120) tgl, COUNT(*) n_tanpa_jurnal
    FROM DeliveryOrder d LEFT JOIN ada ON ada.VoucherNo=d.VoucherNo
    WHERE d.IsDeleted=0 AND d.TransDate>='2026-09-01' AND d.TransDate<'2026-10-01' AND ada.VoucherNo IS NULL
    GROUP BY CONVERT(char(10),d.TransDate,120) ORDER BY 1`));
  P("3. Jurnal DO September: memo dashboard vs bawaan ERP (jumlah baris 1399)", await q(`
    SELECT CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 'dashboard' ELSE 'bawaan-ERP' END asal, COUNT(*) n, SUM(g.Debit) debit
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID AND c.AccountNo='1399'
    WHERE g.Type='DELIVERYORDER' AND g.TransDate>='2026-09-01' AND g.TransDate<'2026-10-01'
    GROUP BY CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 'dashboard' ELSE 'bawaan-ERP' END`));
  P("4. Jurnal DO Sep milik 4 DO itu & tetangga (DO 004685-004700) 1399", await q(`
    SELECT d.VoucherNo, (SELECT COUNT(*) FROM GeneralLedger g WHERE g.VoucherNo=d.VoucherNo AND g.Type='DELIVERYORDER') baris_gl, CONVERT(char(16),d.ModifiedDate,120) md
    FROM DeliveryOrder d WHERE d.VoucherNo LIKE 'MKE/DO/0046[89]%/2026-09/%' OR d.VoucherNo LIKE 'MKE/DO/00470%/2026-09/%' ORDER BY d.VoucherNo`));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
