import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// One-time data fix, 2026-09-10: MKEsindo salesman ANTO (SalesmanID 01525)
// records a batch of Sales Orders one afternoon, then the field visit's
// Delivery Orders only get punched into the ERP the next day in a <20s
// burst. Confirmed via the DO-Retur-SI reconciliation investigation
// (see memory: rekonsiliasi-do-retur-si-sept-2026.md) that Rekap Manual's
// hand tally matches when these DOs are counted on the SO's date, not the
// DO's own (one day later) TransDate — user confirmed with the field that
// the goods actually went out on the SO date; DO entry was just late.
//
// This script shifts TransDate and DueDate back by exactly 1 calendar day
// (preserving time-of-day and the original TransDate->DueDate gap) for the
// 40 confirmed documents, and writes a full before/after snapshot so the
// change can be reverted if it turns out to be wrong.

const GELOMBANG_1 = [
  "MKE/DO/000538/2026-09/003/001", "MKE/DO/000536/2026-09/003/001", "MKE/DO/000544/2026-09/003/001",
  "MKE/DO/000539/2026-09/003/001", "MKE/DO/000533/2026-09/003/001", "MKE/DO/000548/2026-09/003/001",
  "MKE/DO/000546/2026-09/003/001", "MKE/DO/000537/2026-09/003/001", "MKE/DO/000541/2026-09/003/001",
  "MKE/DO/000547/2026-09/003/001", "MKE/DO/000549/2026-09/003/001", "MKE/DO/000534/2026-09/003/001",
  "MKE/DO/000542/2026-09/003/001", "MKE/DO/000540/2026-09/003/001", "MKE/DO/000535/2026-09/003/001",
  "MKE/DO/000545/2026-09/003/001",
];

const GELOMBANG_2 = [
  "MKE/DO/000697/2026-09/003/001", "MKE/DO/000701/2026-09/003/001", "MKE/DO/000684/2026-09/003/001",
  "MKE/DO/000679/2026-09/003/001", "MKE/DO/000692/2026-09/003/001", "MKE/DO/000698/2026-09/003/001",
  "MKE/DO/000678/2026-09/003/001", "MKE/DO/000688/2026-09/003/001", "MKE/DO/000699/2026-09/003/001",
  "MKE/DO/000680/2026-09/003/001", "MKE/DO/000700/2026-09/003/001", "MKE/DO/000687/2026-09/003/001",
  "MKE/DO/000685/2026-09/003/001", "MKE/DO/000693/2026-09/003/001", "MKE/DO/000691/2026-09/003/001",
  "MKE/DO/000689/2026-09/003/001", "MKE/DO/000694/2026-09/003/001", "MKE/DO/000695/2026-09/003/001",
  "MKE/DO/000686/2026-09/003/001", "MKE/DO/000683/2026-09/003/001", "MKE/DO/000696/2026-09/003/001",
  "MKE/DO/000682/2026-09/003/001", "MKE/DO/000690/2026-09/003/001", "MKE/DO/000681/2026-09/003/001",
];

const ALL_VOUCHERS = [...GELOMBANG_1, ...GELOMBANG_2];

async function main() {
  const pool = await getPool();

  const req = pool.request();
  const params = ALL_VOUCHERS.map((v, i) => { req.input(`v${i}`, sql.VarChar(128), v); return `@v${i}`; }).join(",");
  const before = await req.query(`
    SELECT DeliveryOrderID, VoucherNo, TransDate, DueDate, ModifiedDate
    FROM DeliveryOrder
    WHERE VoucherNo IN (${params})
  `);
  const rows = before.recordset as { DeliveryOrderID: string; VoucherNo: string; TransDate: Date; DueDate: Date | null; ModifiedDate: Date }[];

  if (rows.length !== ALL_VOUCHERS.length) {
    console.error(`MISMATCH: expected ${ALL_VOUCHERS.length} rows, found ${rows.length}. Aborting, no writes made.`);
    const foundVouchers = new Set(rows.map((r) => r.VoucherNo));
    for (const v of ALL_VOUCHERS) if (!foundVouchers.has(v)) console.error("  missing:", v);
    await pool.close();
    process.exit(1);
  }

  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-10-anto-do-transdate-before.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(rows, null, 2));
  console.log("Before-snapshot written to", snapshotPath);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const row of rows) {
      const newTransDate = new Date(row.TransDate.getTime() - 24 * 60 * 60 * 1000);
      const newDueDate = row.DueDate ? new Date(row.DueDate.getTime() - 24 * 60 * 60 * 1000) : null;
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), row.DeliveryOrderID);
      r.input("transDate", sql.DateTime, newTransDate);
      if (newDueDate) {
        r.input("dueDate", sql.DateTime, newDueDate);
        await r.query(`UPDATE DeliveryOrder SET TransDate = @transDate, DueDate = @dueDate, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @id`);
      } else {
        await r.query(`UPDATE DeliveryOrder SET TransDate = @transDate, ModifiedDate = GETDATE() WHERE DeliveryOrderID = @id`);
      }
    }
    await transaction.commit();
    console.log(`Committed: shifted TransDate (and DueDate where present) back 1 day for ${rows.length} documents.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Transaction rolled back due to error:", e);
    await pool.close();
    process.exit(1);
  }

  const afterReq = pool.request();
  const afterParams = rows.map((r, i) => { afterReq.input(`id${i}`, sql.VarChar(16), r.DeliveryOrderID); return `@id${i}`; }).join(",");
  const after = await afterReq.query(`
    SELECT DeliveryOrderID, VoucherNo, TransDate, DueDate, ModifiedDate
    FROM DeliveryOrder
    WHERE DeliveryOrderID IN (${afterParams})
  `);
  const afterSnapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-10-anto-do-transdate-after.json");
  fs.writeFileSync(afterSnapshotPath, JSON.stringify(after.recordset, null, 2));
  console.log("After-snapshot written to", afterSnapshotPath);
  console.log(JSON.stringify(after.recordset, null, 2));

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
