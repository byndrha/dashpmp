import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Reverts scripts/fix-anto-si-transdate-2026-09-10.ts using the before-snapshot
// it wrote. Restores each SalesInvoice's original TransDate and DueDate exactly.

async function main() {
  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-10-anto-si-transdate-before.json");
  const before = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
    SalesInvoiceID: string; VoucherNo: string; TransDate: string; DueDate: string | null;
  }[];

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const row of before) {
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), row.SalesInvoiceID);
      r.input("transDate", sql.DateTime, new Date(row.TransDate));
      if (row.DueDate) {
        r.input("dueDate", sql.DateTime, new Date(row.DueDate));
        await r.query(`UPDATE SalesInvoice SET TransDate = @transDate, DueDate = @dueDate, ModifiedDate = GETDATE() WHERE SalesInvoiceID = @id`);
      } else {
        await r.query(`UPDATE SalesInvoice SET TransDate = @transDate, ModifiedDate = GETDATE() WHERE SalesInvoiceID = @id`);
      }
      console.log("Reverted", row.VoucherNo, "->", row.TransDate);
    }
    await transaction.commit();
    console.log(`Reverted ${before.length} SalesInvoice documents to their original TransDate/DueDate.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Revert rolled back due to error:", e);
    process.exit(1);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
