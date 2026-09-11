import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// MKE/SI/003779 and MKE/SI/003780 (paired with MKE/DO/003696 and
// MKE/DO/003697) each have an internally-balanced 4-line SALESINVOICE
// journal, but the "cost" credit line was posted to the WRONG account:
// 14013 "Persediaan - Barang Jual" instead of 1399 "Goods In Transit".
// Confirmed by comparing against a verified-healthy sibling (MKE/SI/003859,
// paired with MKE/DO/003701) which has the identical 4-line shape but
// correctly credits 1399, not 14013.
//
// Effect of the bug: 14013 gets double-credited (once by the DO's own
// entry, once again by this misrouted SI credit), while 1399 never
// receives its expected credit — leaving the DO's Debit unmatched. Since
// each SI's own journal is already balanced, the correct fix is to MOVE
// the credit to the right account (UPDATE ChartOfAccountID), not add a
// new row.

const ACC_1399 = "01129";
const ACC_14013 = "01159";
const TARGETS = [
  { siVoucher: "MKE/SI/003779/2026-08/003/001", expectedAmount: 3963.614116 },
  { siVoucher: "MKE/SI/003780/2026-08/003/001", expectedAmount: 3963.614116 },
];

async function main() {
  const pool = await getPool();

  const req = pool.request();
  const params = TARGETS.map((t, i) => { req.input(`v${i}`, sql.VarChar(128), t.siVoucher); return `@v${i}`; }).join(",");
  const before = await req.query(`
    SELECT gl.ID, gl.BranchID, gl.DepartmentID, gl.VoucherNo, gl.TransDate, gl.Type,
           gl.ChartOfAccountID, gl.Debit, gl.Credit, gl.Memo, gl.BusinessPartnerID, gl.CurrencyID, gl.Rate
    FROM GeneralLedger gl
    WHERE gl.VoucherNo IN (${params}) AND gl.ChartOfAccountID = '${ACC_14013}' AND gl.Type = 'SALESINVOICE'
  `);
  const rows = before.recordset as {
    ID: string; BranchID: string; DepartmentID: string; VoucherNo: string; TransDate: Date; Type: string;
    ChartOfAccountID: string; Debit: number; Credit: number; Memo: string; BusinessPartnerID: string; CurrencyID: string; Rate: number;
  }[];

  if (rows.length !== TARGETS.length) {
    console.error(`MISMATCH: expected ${TARGETS.length} baris di 14013, ditemukan ${rows.length}. Aborting.`, rows);
    await pool.close();
    process.exit(1);
  }
  for (const r of rows) {
    const target = TARGETS.find((t) => t.siVoucher === r.VoucherNo);
    if (!target || Math.abs(r.Credit - target.expectedAmount) > 0.01 || r.Debit !== 0) {
      console.error("MISMATCH: baris tidak sesuai ekspektasi. Aborting.", r);
      await pool.close();
      process.exit(1);
    }
  }
  console.log("Baris yang akan dipindah akunnya (14013 -> 1399):", JSON.stringify(rows, null, 2));

  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-git1399-si003779-003780-before.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(rows, null, 2));
  console.log("Before-snapshot written to", snapshotPath);

  const balBefore = await pool.request().query(`SELECT SUM(Debit) - SUM(Credit) AS NetSaldo FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID WHERE coa.AccountNo = '1399'`);
  console.log("Saldo 1399 SEBELUM:", balBefore.recordset[0]);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const r of rows) {
      const req2 = new sql.Request(transaction);
      req2.input("id", sql.VarChar(16), r.ID);
      req2.input("voucherNo", sql.VarChar(128), r.VoucherNo);
      req2.input("oldAccount", sql.VarChar(16), ACC_14013);
      req2.input("newAccount", sql.VarChar(16), ACC_1399);
      const res = await req2.query(`
        UPDATE GeneralLedger SET ChartOfAccountID = @newAccount
        WHERE ID = @id AND VoucherNo = @voucherNo AND ChartOfAccountID = @oldAccount AND Type = 'SALESINVOICE'
      `);
      if (res.rowsAffected[0] !== 1) {
        throw new Error(`UPDATE tidak mengenai tepat 1 baris untuk ${r.VoucherNo} (kena ${res.rowsAffected[0]})`);
      }
    }
    await transaction.commit();
    console.log(`Committed: ${rows.length} baris dipindah dari akun 14013 ke 1399.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Rolled back due to error:", e);
    await pool.close();
    process.exit(1);
  }

  const balAfter = await pool.request().query(`SELECT SUM(Debit) - SUM(Credit) AS NetSaldo FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID WHERE coa.AccountNo = '1399'`);
  console.log("Saldo 1399 SESUDAH:", balAfter.recordset[0]);

  // Verify each DO now correctly pairs (Debit == Credit for its pair)
  for (const t of TARGETS) {
    const check = await pool.request().query(`
      SELECT gl.VoucherNo, gl.Type, gl.Debit, gl.Credit, coa.AccountNo
      FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
      WHERE coa.AccountNo = '1399' AND gl.VoucherNo = '${t.siVoucher}'
    `);
    console.log(`Verifikasi ${t.siVoucher} di 1399 sekarang:`, check.recordset);
  }

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
