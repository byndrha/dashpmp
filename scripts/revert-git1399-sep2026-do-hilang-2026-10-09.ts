import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Membatalkan fix-git1399-sep2026-do-hilang-2026-10-09.ts: menghapus jurnal
// DO yang diposting skrip itu (Memo '[DASHPMP-BACKFILL] ...') beserta catatan
// auditnya di DashboardGLPostingBackfill(+Detail), untuk 14 voucher di file
// docs/data-fixes/2026-10-09-git1399-sep2026-do-hilang-posted.json.
// Default DRY RUN; --execute untuk menulis.

const IN = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-09-git1399-sep2026-do-hilang-posted.json");
const EXECUTE = process.argv.includes("--execute");

async function main() {
  const { rencana } = JSON.parse(fs.readFileSync(IN, "utf8")) as { rencana: { voucherNo: string }[] };
  const pool = await getPool();
  for (const { voucherNo } of rencana) {
    const gl = await pool.request().input("v", sql.VarChar(64), voucherNo)
      .query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE VoucherNo=@v AND [Type]='DELIVERYORDER' AND LEFT(ISNULL(Memo,''),19)='[DASHPMP-BACKFILL] '`);
    const n = (gl.recordset[0] as { n: number }).n;
    console.log(voucherNo, "baris GL backfill:", n);
    if (!EXECUTE || n === 0) continue;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input("v", sql.VarChar(64), voucherNo).query(`
        DELETE d FROM DashboardGLPostingBackfillDetail d JOIN DashboardGLPostingBackfill b ON b.BackfillID=d.BackfillID
        WHERE b.VoucherNo=@v AND b.DocType='DELIVERYORDER'`);
      await new sql.Request(tx).input("v", sql.VarChar(64), voucherNo).query(`DELETE FROM DashboardGLPostingBackfill WHERE VoucherNo=@v AND DocType='DELIVERYORDER'`);
      await new sql.Request(tx).input("v", sql.VarChar(64), voucherNo).query(
        `DELETE FROM GeneralLedger WHERE VoucherNo=@v AND [Type]='DELIVERYORDER' AND LEFT(ISNULL(Memo,''),19)='[DASHPMP-BACKFILL] '`);
      await tx.commit();
    } catch (e) { await tx.rollback(); console.error("GAGAL", voucherNo, e); await pool.close(); process.exit(1); }
  }
  console.log(EXECUTE ? "Revert selesai." : "DRY RUN selesai.");
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
