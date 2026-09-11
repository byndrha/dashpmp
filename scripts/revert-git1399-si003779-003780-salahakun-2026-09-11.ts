import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Reverts fix-git1399-si003779-003780-salahakun-2026-09-11.ts — moves the
// ChartOfAccountID back from 1399 to 14013 for both rows, using the
// before-snapshot as the source of truth.

async function main() {
  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-git1399-si003779-003780-before.json");
  const rows = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as { ID: string; VoucherNo: string; ChartOfAccountID: string }[];

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const r of rows) {
      const req = new sql.Request(transaction);
      req.input("id", sql.VarChar(16), r.ID);
      req.input("voucherNo", sql.VarChar(128), r.VoucherNo);
      req.input("originalAccount", sql.VarChar(16), r.ChartOfAccountID);
      const res = await req.query(`
        UPDATE GeneralLedger SET ChartOfAccountID = @originalAccount
        WHERE ID = @id AND VoucherNo = @voucherNo AND Type = 'SALESINVOICE'
      `);
      console.log("Reverted", r.VoucherNo, "-> ChartOfAccountID", r.ChartOfAccountID, "| rows affected:", res.rowsAffected[0]);
    }
    await transaction.commit();
    console.log("Revert committed.");
  } catch (e) {
    await transaction.rollback();
    console.error("Revert rolled back due to error:", e);
    process.exit(1);
  }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
