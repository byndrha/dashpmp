import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: siapa yang memakai (Type DELIVERYORDER, ID) = ID 9 DO yang jurnalnya hilang?
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  const IDS = `('01244997','01244998','01244999','01245000','01245001','01245002','01245016','01245017','01245128')`;
  console.log("== Pemegang (Type DELIVERYORDER, ID tujuan) ==");
  console.log(JSON.stringify(await q(`
    SELECT g.ID, g.VoucherNo, LEFT(ISNULL(g.Memo,''),40) memo, CONVERT(char(16),g.TransDate,120) td, COUNT(*) baris,
      (SELECT TOP 1 d.VoucherNo FROM DeliveryOrder d WHERE d.DeliveryOrderID=g.ID) do_ber_id_ini,
      (SELECT COUNT(*) FROM DeliveryOrder d2 WHERE d2.VoucherNo=g.VoucherNo AND d2.IsDeleted=0) do_aktif_voucher_ini
    FROM GeneralLedger g WHERE g.[Type]='DELIVERYORDER' AND g.ID IN ${IDS} GROUP BY g.ID, g.VoucherNo, g.Memo, g.TransDate ORDER BY g.ID`)));
  console.log("== Seberapa meluas: jurnal dashboard DO yang ID-nya = DeliveryOrderID DO LAIN (voucher berbeda) ==");
  console.log(JSON.stringify(await q(`
    SELECT COUNT(DISTINCT g.VoucherNo) n_voucher
    FROM GeneralLedger g JOIN DeliveryOrder d ON d.DeliveryOrderID=g.ID AND d.VoucherNo<>g.VoucherNo
    WHERE g.[Type]='DELIVERYORDER' AND LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' AND g.TransDate>='2026-09-01'`)));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
