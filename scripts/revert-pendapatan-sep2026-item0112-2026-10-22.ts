import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Membatalkan fix-pendapatan-sep2026-item0112-2026-10-22.ts: menghapus jurnal
// (Memo '[DASHPMP-BACKFILL] ...') beserta catatan auditnya di
// DashboardGLPostingBackfill(+Detail) untuk voucher di file rencana.
// Default DRY RUN; --execute untuk menulis.

// Argumen opsional: path file rencana (.json); default = rencana 19 DO/SI mitra 01343.
const IN = process.argv.find((a) => a.endsWith(".json")) ?? path.join(__dirname, "..", "docs", "data-fixes", "2026-10-22-pendapatan-sep2026-item0112-posted.json");
const EXECUTE = process.argv.includes("--execute");

async function main() {
  const { rencana } = JSON.parse(fs.readFileSync(IN, "utf8")) as { rencana: { voucherNo: string; docType: string }[] };
  const pool = await getPool();
  for (const { voucherNo, docType } of rencana) {
    const n = (await pool.request().input("v", sql.VarChar(64), voucherNo).input("t", sql.VarChar(20), docType)
      .query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE VoucherNo=@v AND [Type]=@t AND LEFT(ISNULL(Memo,''),19)='[DASHPMP-BACKFILL] '`)).recordset[0].n as number;
    console.log(docType, voucherNo, "baris GL backfill:", n);
    if (!EXECUTE || n === 0) continue;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input("v", sql.VarChar(64), voucherNo).input("t", sql.VarChar(20), docType).query(`
        DELETE d FROM DashboardGLPostingBackfillDetail d JOIN DashboardGLPostingBackfill b ON b.BackfillID=d.BackfillID
        WHERE b.VoucherNo=@v AND b.DocType=@t`);
      await new sql.Request(tx).input("v", sql.VarChar(64), voucherNo).input("t", sql.VarChar(20), docType).query(
        `DELETE FROM DashboardGLPostingBackfill WHERE VoucherNo=@v AND DocType=@t`);
      await new sql.Request(tx).input("v", sql.VarChar(64), voucherNo).input("t", sql.VarChar(20), docType).query(
        `DELETE FROM GeneralLedger WHERE VoucherNo=@v AND [Type]=@t AND LEFT(ISNULL(Memo,''),19)='[DASHPMP-BACKFILL] '`);
      await tx.commit();
    } catch (e) { await tx.rollback(); console.error("GAGAL", voucherNo, e); await pool.close(); process.exit(1); }
  }
  console.log(EXECUTE ? "Revert selesai." : "DRY RUN selesai.");
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
