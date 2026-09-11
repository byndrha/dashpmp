import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Companion to fix-anto-do-transdate-2026-09-10.ts: that script shifted the
// 40 ANTO cohort DeliveryOrder documents' TransDate/DueDate back 1 day to
// match their SO date. This does the SAME shift for the 38 SalesInvoice
// documents paired with those DOs (2 of the 40 DOs went to SalesReturn
// instead of SalesInvoice — MKE/DO/000691 and MKE/DO/000699 — so there are
// 38, not 40, SI vouchers here). User explicitly confirmed: SI should move
// too, so the "Sistem" per-day SI total (which buckets by SI's own
// TransDate) lines up with the already-corrected DO total.
//
// Confirmed live before this run: SalesInvoice.TransDate for this cohort is
// still on the ORIGINAL (uncorrected) post-DO date — the earlier DO-only
// fix never touched SalesInvoice at all, which is exactly why the
// reconciliation's SI column hadn't moved.

const GELOMBANG_1_SI = [
  "MKE/SI/000518/2026-09/003/001", "MKE/SI/000519/2026-09/003/001", "MKE/SI/000520/2026-09/003/001",
  "MKE/SI/000521/2026-09/003/001", "MKE/SI/000522/2026-09/003/001", "MKE/SI/000523/2026-09/003/001",
  "MKE/SI/000524/2026-09/003/001", "MKE/SI/000525/2026-09/003/001", "MKE/SI/000526/2026-09/003/001",
  "MKE/SI/000527/2026-09/003/001", "MKE/SI/000529/2026-09/003/001", "MKE/SI/000530/2026-09/003/001",
  "MKE/SI/000531/2026-09/003/001", "MKE/SI/000532/2026-09/003/001", "MKE/SI/000533/2026-09/003/001",
  "MKE/SI/000534/2026-09/003/001",
];

const GELOMBANG_2_SI = [
  "MKE/SI/000670/2026-09/003/001", "MKE/SI/000671/2026-09/003/001", "MKE/SI/000672/2026-09/003/001",
  "MKE/SI/000673/2026-09/003/001", "MKE/SI/000674/2026-09/003/001", "MKE/SI/000675/2026-09/003/001",
  "MKE/SI/000676/2026-09/003/001", "MKE/SI/000677/2026-09/003/001", "MKE/SI/000678/2026-09/003/001",
  "MKE/SI/000679/2026-09/003/001", "MKE/SI/000680/2026-09/003/001", "MKE/SI/000681/2026-09/003/001",
  "MKE/SI/000682/2026-09/003/001", "MKE/SI/000684/2026-09/003/001", "MKE/SI/000685/2026-09/003/001",
  "MKE/SI/000686/2026-09/003/001", "MKE/SI/000687/2026-09/003/001", "MKE/SI/000688/2026-09/003/001",
  "MKE/SI/000689/2026-09/003/001", "MKE/SI/000690/2026-09/003/001", "MKE/SI/000692/2026-09/003/001",
  "MKE/SI/000693/2026-09/003/001",
];

const ALL_VOUCHERS = [...GELOMBANG_1_SI, ...GELOMBANG_2_SI];

async function main() {
  const pool = await getPool();

  const req = pool.request();
  const params = ALL_VOUCHERS.map((v, i) => { req.input(`v${i}`, sql.VarChar(128), v); return `@v${i}`; }).join(",");
  const before = await req.query(`
    SELECT SalesInvoiceID, VoucherNo, TransDate, DueDate, ModifiedDate
    FROM SalesInvoice
    WHERE VoucherNo IN (${params})
  `);
  const rows = before.recordset as { SalesInvoiceID: string; VoucherNo: string; TransDate: Date; DueDate: Date | null; ModifiedDate: Date }[];

  if (rows.length !== ALL_VOUCHERS.length) {
    console.error(`MISMATCH: expected ${ALL_VOUCHERS.length} rows, found ${rows.length}. Aborting, no writes made.`);
    const found = new Set(rows.map((r) => r.VoucherNo));
    for (const v of ALL_VOUCHERS) if (!found.has(v)) console.error("  missing:", v);
    await pool.close();
    process.exit(1);
  }

  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-10-anto-si-transdate-before.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(rows, null, 2));
  console.log("Before-snapshot written to", snapshotPath);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const row of rows) {
      const newTransDate = new Date(row.TransDate.getTime() - 24 * 60 * 60 * 1000);
      const newDueDate = row.DueDate ? new Date(row.DueDate.getTime() - 24 * 60 * 60 * 1000) : null;
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), row.SalesInvoiceID);
      r.input("transDate", sql.DateTime, newTransDate);
      if (newDueDate) {
        r.input("dueDate", sql.DateTime, newDueDate);
        await r.query(`UPDATE SalesInvoice SET TransDate = @transDate, DueDate = @dueDate, ModifiedDate = GETDATE() WHERE SalesInvoiceID = @id`);
      } else {
        await r.query(`UPDATE SalesInvoice SET TransDate = @transDate, ModifiedDate = GETDATE() WHERE SalesInvoiceID = @id`);
      }
    }
    await transaction.commit();
    console.log(`Committed: shifted TransDate (and DueDate where present) back 1 day for ${rows.length} SalesInvoice documents.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Transaction rolled back due to error:", e);
    await pool.close();
    process.exit(1);
  }

  const afterReq = pool.request();
  const afterParams = rows.map((r, i) => { afterReq.input(`id${i}`, sql.VarChar(16), r.SalesInvoiceID); return `@id${i}`; }).join(",");
  const after = await afterReq.query(`
    SELECT SalesInvoiceID, VoucherNo, TransDate, DueDate, ModifiedDate
    FROM SalesInvoice
    WHERE SalesInvoiceID IN (${afterParams})
  `);
  const afterSnapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-10-anto-si-transdate-after.json");
  fs.writeFileSync(afterSnapshotPath, JSON.stringify(after.recordset, null, 2));
  console.log("After-snapshot written to", afterSnapshotPath);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
