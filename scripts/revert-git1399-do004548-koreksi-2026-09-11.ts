import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Reverts fix-git1399-do004548-koreksi-2026-09-11.ts — deletes the 2
// correcting rows it inserted, leaving the original (pre-existing,
// untouched) journal entry for MKE/DO/004548 exactly as it was.

async function main() {
  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-git1399-do004548-koreksi-inserted.json");
  const rows = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as { ID: string; VoucherNo: string; ChartOfAccountID: string }[];

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    let deleted = 0;
    for (const row of rows) {
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), row.ID);
      r.input("chartOfAccountId", sql.VarChar(16), row.ChartOfAccountID);
      r.input("voucherNo", sql.VarChar(128), row.VoucherNo);
      const res = await r.query(`DELETE FROM GeneralLedger WHERE ID = @id AND ChartOfAccountID = @chartOfAccountId AND VoucherNo = @voucherNo`);
      deleted += res.rowsAffected[0] ?? 0;
      console.log("Reverted", row.VoucherNo, "->", row.ChartOfAccountID, "ID", row.ID);
    }
    await transaction.commit();
    console.log(`Reverted: ${deleted} baris dihapus.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Revert rolled back due to error:", e);
    process.exit(1);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
