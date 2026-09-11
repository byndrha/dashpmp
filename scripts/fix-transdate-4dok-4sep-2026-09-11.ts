import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Shifts TransDate (and DueDate where present) back exactly 1 calendar day
// (time-of-day preserved) for one linked SO->DO->SI chain plus its SP
// (SalesPayment), which were all mistakenly dated 5 Sep instead of 4 Sep:
//   MKE/SO/000557/2026-09/003/001 (SalesOrderID 01220186)
//   MKE/DO/000543/2026-09/003/001 (DeliveryOrderID 01240683)
//   MKE/SI/000528/2026-09/003/001 (SalesInvoiceID 01232757)
//   MKE/SP/000927/2026-09/003/001 (SalesPaymentID 01156987)
// Same pattern as fix-anto-do-transdate-2026-09-10.ts / fix-anto-si-transdate-2026-09-10.ts.
// SalesPayment has no DueDate column, so only its TransDate shifts.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const TARGETS = [
  { table: "SalesOrder", idCol: "SalesOrderID", id: "01220186", voucher: "MKE/SO/000557/2026-09/003/001", hasDueDate: true },
  { table: "DeliveryOrder", idCol: "DeliveryOrderID", id: "01240683", voucher: "MKE/DO/000543/2026-09/003/001", hasDueDate: true },
  { table: "SalesInvoice", idCol: "SalesInvoiceID", id: "01232757", voucher: "MKE/SI/000528/2026-09/003/001", hasDueDate: true },
  { table: "SalesPayment", idCol: "SalesPaymentID", id: "01156987", voucher: "MKE/SP/000927/2026-09/003/001", hasDueDate: false },
] as const;

async function main() {
  const pool = await getPool();

  const before: Record<string, unknown>[] = [];
  for (const t of TARGETS) {
    const cols = t.hasDueDate ? `${t.idCol}, VoucherNo, TransDate, DueDate` : `${t.idCol}, VoucherNo, TransDate`;
    const res = await pool.request().query(`SELECT ${cols} FROM ${t.table} WHERE ${t.idCol} = '${t.id}' AND VoucherNo = '${t.voucher}'`);
    if (res.recordset.length !== 1) {
      console.error(`MISMATCH: ${t.table} ${t.voucher} tidak ditemukan tepat 1 baris. Aborting.`, res.recordset);
      await pool.close();
      process.exit(1);
    }
    before.push({ table: t.table, ...res.recordset[0] });
  }
  console.log("Before state:", JSON.stringify(before, null, 2));

  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-transdate-4dok-4sep-before.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(before, null, 2));
  console.log("Before-snapshot written to", snapshotPath);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const row of before) {
      const t = TARGETS.find((x) => x.table === row.table)!;
      const newTransDate = new Date((row.TransDate as Date).getTime() - ONE_DAY_MS);
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), row[t.idCol] as string);
      r.input("transDate", sql.DateTime, newTransDate);
      if (t.hasDueDate && row.DueDate) {
        const newDueDate = new Date((row.DueDate as Date).getTime() - ONE_DAY_MS);
        r.input("dueDate", sql.DateTime, newDueDate);
        await r.query(`UPDATE ${t.table} SET TransDate = @transDate, DueDate = @dueDate, ModifiedDate = GETDATE() WHERE ${t.idCol} = @id`);
      } else {
        await r.query(`UPDATE ${t.table} SET TransDate = @transDate, ModifiedDate = GETDATE() WHERE ${t.idCol} = @id`);
      }
      console.log(`Updated ${t.table} ${row.VoucherNo}: TransDate -> ${newTransDate.toISOString()}`);
    }
    await transaction.commit();
    console.log("Committed: 4 dokumen berhasil digeser mundur 1 hari.");
  } catch (e) {
    await transaction.rollback();
    console.error("Transaction rolled back due to error:", e);
    await pool.close();
    process.exit(1);
  }

  const after: Record<string, unknown>[] = [];
  for (const t of TARGETS) {
    const cols = t.hasDueDate ? `${t.idCol}, VoucherNo, TransDate, DueDate` : `${t.idCol}, VoucherNo, TransDate`;
    const res = await pool.request().query(`SELECT ${cols} FROM ${t.table} WHERE ${t.idCol} = '${t.id}'`);
    after.push({ table: t.table, ...res.recordset[0] });
  }
  console.log("\nAfter state:", JSON.stringify(after, null, 2));
  const afterSnapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-transdate-4dok-4sep-after.json");
  fs.writeFileSync(afterSnapshotPath, JSON.stringify(after, null, 2));
  console.log("After-snapshot written to", afterSnapshotPath);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
