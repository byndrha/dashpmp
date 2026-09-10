import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Reverts scripts/fix-anto-do-transdate-2026-09-10.ts using the before-snapshot
// it wrote. Restores each document's original TransDate and DueDate exactly.
// Run this only if the ANTO SO->DO one-day-lag fix turns out to be wrong
// (i.e. the goods really did leave the factory on the DO's original date,
// not the SO's date).

async function main() {
  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-10-anto-do-transdate-before.json");
  const before = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
    DeliveryOrderID: string; VoucherNo: string; TransDate: string; DueDate: string | null;
  }[];

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const row of before) {
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), row.DeliveryOrderID);
      r.input("transDate", sql.DateTime, new Date(row.TransDate));
      if (row.DueDate) {
        r.input("dueDate", sql.DateTime, new Date(row.DueDate));
        await r.query(`UPDATE DeliveryOrder SET TransDate = @transDate, DueDate = @dueDate, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @id`);
      } else {
        await r.query(`UPDATE DeliveryOrder SET TransDate = @transDate, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @id`);
      }
      console.log("Reverted", row.VoucherNo, "->", row.TransDate);
    }
    await transaction.commit();
    console.log(`Reverted ${before.length} documents to their original TransDate/DueDate.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Revert rolled back due to error:", e);
    process.exit(1);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
