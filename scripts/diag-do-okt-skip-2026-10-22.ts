import "dotenv/config";
import { getPool } from "../src/lib/db";
import { computeBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// DIAGNOSTIK READ-ONLY: kenapa DO induk SI mitra 01343 (1-21 Okt) tidak muncul sebagai postable?
async function main() {
  const pool = await getPool();
  const q = async (s: string) => (await pool.request().query(s)).recordset;
  console.log("== DO induk 6 SI mitra 01343 pertama ==");
  console.log(JSON.stringify(await q(`
    SELECT s.VoucherNo siv, d.VoucherNo dov, CONVERT(char(16),d.TransDate,120) do_td, CONVERT(char(16),s.TransDate,120) si_td, d.IsDeleted,
      (SELECT COUNT(*) FROM GeneralLedger g WHERE g.VoucherNo=d.VoucherNo AND g.Type='DELIVERYORDER') gl_do,
      (SELECT COUNT(*) FROM DashboardPengirimanJadwalDetail j WHERE j.DeliveryOrderID=d.DeliveryOrderID AND j.IsDeleted=0) di_jadwal,
      (SELECT STRING_AGG(x.ItemID,',') FROM DeliveryOrderDetail x WHERE x.DeliveryOrderID=d.DeliveryOrderID) items
    FROM SalesInvoice s LEFT JOIN DeliveryOrder d ON d.DeliveryOrderID=REPLACE(s.DeliveryOrderID,'''','')
    WHERE s.VoucherNo IN ('MKE/SI/000070/2026-10/003/001','MKE/SI/000251/2026-10/003/001','MKE/SI/000484/2026-10/003/001',
      'MKE/SI/005041/2026-09/003/001','MKE/SI/001264/2026-10/003/001','MKE/SI/003838/2026-10/003/001')`), null, 1));
  console.log("== alasan skip semua dokumen per tanggal (1-21 Okt) ==");
  for (let h = 1; h <= 22; h++) {
    const tgl = `2026-10-${String(h).padStart(2, "0")}`;
    const r = await computeBacklogForDate(tgl);
    const hitung = new Map<string, number>();
    for (const s of r.skipped) hitung.set(`${s.docType} | ${s.alasan}`, (hitung.get(`${s.docType} | ${s.alasan}`) ?? 0) + 1);
    console.log(tgl, "postable:", r.postable.length, "| skipped:", JSON.stringify([...hitung]));
  }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
