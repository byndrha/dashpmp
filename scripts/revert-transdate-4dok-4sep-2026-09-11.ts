import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Reverts fix-transdate-4dok-4sep-2026-09-11.ts using its before-snapshot.
// Restores each document's original TransDate (and DueDate where present)
// exactly. By default reverts all 4; pass one or more VoucherNo as CLI
// args to revert only specific document(s).

const TABLE_ID_COL: Record<string, string> = {
  SalesOrder: "SalesOrderID",
  DeliveryOrder: "DeliveryOrderID",
  SalesInvoice: "SalesInvoiceID",
  SalesPayment: "SalesPaymentID",
};

async function main() {
  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-transdate-4dok-4sep-before.json");
  const allRows = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
    table: string; VoucherNo: string; TransDate: string; DueDate?: string; [key: string]: unknown;
  }[];

  const filterVouchers = process.argv.slice(2);
  const rows = filterVouchers.length > 0 ? allRows.filter((r) => filterVouchers.includes(r.VoucherNo)) : allRows;
  if (rows.length === 0) {
    console.log("Tidak ada baris yang cocok untuk direvert.");
    return;
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const row of rows) {
      const idCol = TABLE_ID_COL[row.table];
      const id = row[idCol] as string;
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), id);
      r.input("transDate", sql.DateTime, new Date(row.TransDate));
      if (row.DueDate) {
        r.input("dueDate", sql.DateTime, new Date(row.DueDate));
        await r.query(`UPDATE ${row.table} SET TransDate = @transDate, DueDate = @dueDate, ModifiedDate = GETDATE() WHERE ${idCol} = @id`);
      } else {
        await r.query(`UPDATE ${row.table} SET TransDate = @transDate, ModifiedDate = GETDATE() WHERE ${idCol} = @id`);
      }
      console.log("Reverted", row.VoucherNo, "->", row.TransDate);
    }
    await transaction.commit();
    console.log(`Reverted ${rows.length} dokumen ke TransDate/DueDate aslinya.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Revert rolled back due to error:", e);
    process.exit(1);
  }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
