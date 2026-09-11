import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Reverts scripts/fix-git1399-orphan-debit-2026-09-11.ts using the
// before-snapshot it wrote. Re-inserts the GeneralLedger rows exactly as
// they were.
//
// By default reverts (re-inserts) EVERY row in the snapshot. To revert only
// a specific DO's journal pair, pass one or more DO VoucherNo as CLI args:
//   npx tsx scripts/revert-git1399-orphan-debit-2026-09-11.ts "MKE/DO/003220/2026-08/003/001"

async function main() {
  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-git1399-orphan-debit-before.json");
  const allBefore = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
    ID: string; BranchID: string; DepartmentID: string; VoucherNo: string; TransDate: string;
    Type: string; ChartOfAccountID: string; Debit: number; Credit: number; Memo: string;
    BusinessPartnerID: string; CurrencyID: string; Rate: number;
  }[];

  const filterVouchers = process.argv.slice(2);
  const before = filterVouchers.length > 0
    ? allBefore.filter((r) => filterVouchers.includes(r.VoucherNo))
    : allBefore;

  if (before.length === 0) {
    console.log("Tidak ada baris yang cocok untuk direvert.", filterVouchers.length > 0 ? `(filter: ${filterVouchers.join(", ")})` : "");
    return;
  }
  console.log(`Akan revert (re-insert) ${before.length} baris (dari total ${allBefore.length} di snapshot)${filterVouchers.length > 0 ? ` — filter: ${filterVouchers.join(", ")}` : " — SEMUA (tanpa filter)"}`);

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const row of before) {
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), row.ID);
      r.input("branchId", sql.VarChar(16), row.BranchID);
      r.input("departmentId", sql.VarChar(16), row.DepartmentID);
      r.input("voucherNo", sql.VarChar(128), row.VoucherNo);
      r.input("transDate", sql.DateTime, new Date(row.TransDate));
      r.input("type", sql.VarChar(32), row.Type);
      r.input("chartOfAccountId", sql.VarChar(16), row.ChartOfAccountID);
      r.input("debit", sql.Decimal(18, 6), row.Debit);
      r.input("credit", sql.Decimal(18, 6), row.Credit);
      r.input("memo", sql.VarChar(255), row.Memo ?? "");
      r.input("businessPartnerId", sql.VarChar(16), row.BusinessPartnerID);
      r.input("currencyId", sql.VarChar(16), row.CurrencyID ?? "");
      r.input("rate", sql.Decimal(18, 6), row.Rate);
      await r.query(`
        INSERT INTO GeneralLedger
          (ID, BranchID, DepartmentID, VoucherNo, TransDate, Type, ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
        VALUES
          (@id, @branchId, @departmentId, @voucherNo, @transDate, @type, @chartOfAccountId, @debit, @credit, @memo, @businessPartnerId, @currencyId, @rate)
      `);
      console.log("Restored", row.VoucherNo, "->", row.ChartOfAccountID, "Debit", row.Debit, "Credit", row.Credit);
    }
    await transaction.commit();
    console.log(`Reverted: re-inserted ${before.length} GeneralLedger rows.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Revert rolled back due to error:", e);
    process.exit(1);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
