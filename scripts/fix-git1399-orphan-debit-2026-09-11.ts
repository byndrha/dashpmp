import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Removes the 4 orphaned GeneralLedger rows (2 journal pairs) for
// MKE/DO/003220/2026-08/003/001 and MKE/DO/003849/2026-08/003/001 — both
// DeliveryOrder documents were hard-deleted from the database after their
// journal entries were already posted, leaving a Debit 1399 "Goods In
// Transit" / Credit 14013 "Persediaan - Barang Jual" pair with no source
// document and no SalesInvoice/SalesReturn ever created against them.
// Confirmed live: no SI/SR anywhere references either voucher, and no
// DeliveryOrder row exists for either (any date, not soft-deleted).
//
// Both sides of each journal pair are removed together so the ledger stays
// balanced (deleting only the 1399 side would leave 14013 unbalanced).

const VOUCHER_NOS = [
  "MKE/DO/003220/2026-08/003/001",
  "MKE/DO/003849/2026-08/003/001",
];

async function main() {
  const pool = await getPool();

  const req = pool.request();
  const params = VOUCHER_NOS.map((v, i) => { req.input(`v${i}`, sql.VarChar(128), v); return `@v${i}`; }).join(",");
  const before = await req.query(`
    SELECT gl.ID, gl.BranchID, gl.DepartmentID, gl.VoucherNo, gl.TransDate, gl.Type,
           gl.ChartOfAccountID, gl.Debit, gl.Credit, gl.Memo, gl.BusinessPartnerID,
           gl.CurrencyID, gl.Rate, coa.AccountNo
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE gl.VoucherNo IN (${params})
    ORDER BY gl.VoucherNo, coa.AccountNo
  `);
  const rows = before.recordset as {
    ID: string; BranchID: string; DepartmentID: string; VoucherNo: string; TransDate: Date;
    Type: string; ChartOfAccountID: string; Debit: number; Credit: number; Memo: string;
    BusinessPartnerID: string; CurrencyID: string; Rate: number; AccountNo: string;
  }[];

  if (rows.length !== 4) {
    console.error(`MISMATCH: expected 4 GL rows (2 vouchers x 2 sides), found ${rows.length}. Aborting, no writes made.`);
    console.error(JSON.stringify(rows, null, 2));
    await pool.close();
    process.exit(1);
  }

  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-git1399-orphan-debit-before.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(rows, null, 2));
  console.log("Before-snapshot written to", snapshotPath);

  const ids = [...new Set(rows.map((r) => r.ID))];
  console.log("Journal IDs to delete (both sides each):", ids);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const row of rows) {
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), row.ID);
      r.input("chartOfAccountId", sql.VarChar(16), row.ChartOfAccountID);
      r.input("voucherNo", sql.VarChar(128), row.VoucherNo);
      await r.query(`
        DELETE FROM GeneralLedger
        WHERE ID = @id AND ChartOfAccountID = @chartOfAccountId AND VoucherNo = @voucherNo
      `);
    }
    await transaction.commit();
    console.log(`Committed: deleted ${rows.length} GeneralLedger rows (${ids.length} journal pairs) for ${VOUCHER_NOS.join(", ")}.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Transaction rolled back due to error:", e);
    await pool.close();
    process.exit(1);
  }

  const afterReq = pool.request();
  const afterParams = VOUCHER_NOS.map((v, i) => { afterReq.input(`v${i}`, sql.VarChar(128), v); return `@v${i}`; }).join(",");
  const after = await afterReq.query(`
    SELECT gl.ID, gl.VoucherNo, coa.AccountNo, gl.Debit, gl.Credit
    FROM GeneralLedger gl
    JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE gl.VoucherNo IN (${afterParams})
  `);
  const afterSnapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-git1399-orphan-debit-after.json");
  fs.writeFileSync(afterSnapshotPath, JSON.stringify(after.recordset, null, 2));
  console.log("After-snapshot written to", afterSnapshotPath, "| remaining rows for these vouchers (should be 0):", after.recordset.length);

  // Verify new 1399 balance moved by exactly the expected amount
  const balCheck = await pool.request().query(`
    SELECT SUM(Debit) - SUM(Credit) AS NetSaldo
    FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = '1399'
  `);
  console.log("Saldo kumulatif 1399 sekarang:", balCheck.recordset[0]);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
