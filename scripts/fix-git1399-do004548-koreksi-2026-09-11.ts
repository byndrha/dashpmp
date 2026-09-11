import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// MKE/DO/004548/2026-08/003/001 already had a Debit posted to 1399 BEFORE
// the 25-31 Aug batch backfill (fix-git1399-gapaktif-26-31agustus-batch-
// 2026-09-11.ts), so that script's "skip if already posted" logic left it
// untouched. Audit found the existing Debit (Rp 5.284,818822) is short of
// the sum of its 3 paired SI/SR credits (Rp 6.606,023527) by exactly
// Rp 1.321,204705 — which was the ENTIRE remaining residual on account
// 1399 after all other backfills.
//
// Rather than mutating the existing (correct-as-far-as-it-goes) journal
// row, this adds a small CORRECTING journal pair for just the shortfall —
// same convention as every other fix this session, easy to audit/revert
// on its own without touching the original 2026-08 entry.

const DO_VOUCHER = "MKE/DO/004548/2026-08/003/001";
const ACC_1399 = "01129";
const ACC_14013 = "01159";
const EXPECTED_SHORTFALL = 1321.204705;

async function main() {
  const pool = await getPool();

  const doRes = await pool.request().query(`
    SELECT DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, CurrencyID, Rate, IsDeleted
    FROM DeliveryOrder WHERE VoucherNo = '${DO_VOUCHER}'
  `);
  const doRow = doRes.recordset[0] as {
    DeliveryOrderID: string; VoucherNo: string; TransDate: Date; BranchID: string; DepartmentID: string;
    BusinessPartnerID: string; CurrencyID: string; Rate: number; IsDeleted: boolean;
  } | undefined;
  if (!doRow || doRow.IsDeleted) {
    console.error("DO tidak ditemukan atau IsDeleted=true. Aborting.", doRow);
    await pool.close();
    process.exit(1);
  }

  // Re-verify live: existing Debit on 1399, and true sum of paired SI/SR credits
  const existingDebit = await pool.request().query(`
    SELECT gl.ID, gl.Debit FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = '1399' AND gl.Type = 'DELIVERYORDER' AND gl.VoucherNo = '${DO_VOUCHER}'
  `);
  console.log("Baris Debit 1399 yang sudah ada untuk DO ini:", existingDebit.recordset);
  if (existingDebit.recordset.length !== 1) {
    console.error("Diharapkan tepat 1 baris Debit existing, ditemukan", existingDebit.recordset.length, ". Aborting.");
    await pool.close();
    process.exit(1);
  }
  const existingDebitAmount = (existingDebit.recordset[0] as { Debit: number }).Debit;

  const allSi = await pool.request().query(`SELECT VoucherNo, REPLACE(DeliveryOrderID, CHAR(39), '') AS CleanDoId FROM SalesInvoice`);
  const allSr = await pool.request().query(`SELECT VoucherNo, DeliveryOrderID FROM SalesReturn`);
  const pairedSi = (allSi.recordset as { VoucherNo: string; CleanDoId: string }[]).filter((r) => r.CleanDoId === doRow.DeliveryOrderID).map((r) => r.VoucherNo);
  const pairedSr = (allSr.recordset as { VoucherNo: string; DeliveryOrderID: string }[]).filter((r) => r.DeliveryOrderID === doRow.DeliveryOrderID).map((r) => r.VoucherNo);
  const pairedVouchers = [...pairedSi, ...pairedSr];
  console.log("Pasangan SI/SR:", pairedVouchers);

  const creditReq = pool.request();
  const params = pairedVouchers.map((v, i) => { creditReq.input(`v${i}`, sql.VarChar(128), v); return `@v${i}`; }).join(",");
  const creditRes = await creditReq.query(`
    SELECT gl.VoucherNo, gl.Credit FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = '1399' AND gl.Type IN ('SALESINVOICE','SALESRETURN') AND gl.VoucherNo IN (${params})
  `);
  const creditRows = creditRes.recordset as { VoucherNo: string; Credit: number }[];
  console.log("Credit rows pasangan:", creditRows);
  const totalCredit = creditRows.reduce((s, r) => s + r.Credit, 0);
  const shortfall = totalCredit - existingDebitAmount;
  console.log(`Debit existing: ${existingDebitAmount} | Total Credit pasangan: ${totalCredit} | Shortfall: ${shortfall}`);

  if (Math.abs(shortfall - EXPECTED_SHORTFALL) > 0.01) {
    console.error(`MISMATCH: shortfall live (${shortfall}) tidak sama dengan yang diharapkan (${EXPECTED_SHORTFALL}). Aborting, tidak melakukan apapun.`);
    await pool.close();
    process.exit(1);
  }
  if (shortfall <= 0) {
    console.log("Tidak ada shortfall (>=0), tidak perlu koreksi. Selesai.");
    await pool.close();
    return;
  }

  const maxIdRes = await pool.request().query(`SELECT MAX(TRY_CAST(ID AS BIGINT)) AS MaxId FROM GeneralLedger`);
  const newId = String(Number((maxIdRes.recordset[0] as { MaxId: number }).MaxId) + 1).padStart(8, "0");
  console.log("ID baru untuk jurnal koreksi:", newId);

  const rowsToInsert = [
    { ID: newId, BranchID: doRow.BranchID, DepartmentID: doRow.DepartmentID, VoucherNo: DO_VOUCHER, TransDate: doRow.TransDate.toISOString(), Type: "DELIVERYORDER", ChartOfAccountID: ACC_1399, Debit: shortfall, Credit: 0, Memo: "Koreksi kekurangan Debit 1399 (backfill 2026-09-11)", BusinessPartnerID: doRow.BusinessPartnerID, CurrencyID: doRow.CurrencyID ?? "", Rate: doRow.Rate ?? 1 },
    { ID: newId, BranchID: doRow.BranchID, DepartmentID: doRow.DepartmentID, VoucherNo: DO_VOUCHER, TransDate: doRow.TransDate.toISOString(), Type: "DELIVERYORDER", ChartOfAccountID: ACC_14013, Debit: 0, Credit: shortfall, Memo: "Koreksi kekurangan Debit 1399 (backfill 2026-09-11)", BusinessPartnerID: doRow.BusinessPartnerID, CurrencyID: doRow.CurrencyID ?? "", Rate: doRow.Rate ?? 1 },
  ];

  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-git1399-do004548-koreksi-inserted.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(rowsToInsert, null, 2));
  console.log("Snapshot ditulis ke", snapshotPath);

  const balBefore = await pool.request().query(`SELECT SUM(Debit) - SUM(Credit) AS NetSaldo FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID WHERE coa.AccountNo = '1399'`);
  console.log("Saldo 1399 SEBELUM koreksi:", balBefore.recordset[0]);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const row of rowsToInsert) {
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
      r.input("memo", sql.VarChar(255), row.Memo);
      r.input("businessPartnerId", sql.VarChar(16), row.BusinessPartnerID);
      r.input("currencyId", sql.VarChar(16), row.CurrencyID);
      r.input("rate", sql.Decimal(18, 6), row.Rate);
      await r.query(`
        INSERT INTO GeneralLedger (ID, BranchID, DepartmentID, VoucherNo, TransDate, Type, ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
        VALUES (@id, @branchId, @departmentId, @voucherNo, @transDate, @type, @chartOfAccountId, @debit, @credit, @memo, @businessPartnerId, @currencyId, @rate)
      `);
    }
    await transaction.commit();
    console.log("Committed: 2 baris koreksi berhasil diinsert.");
  } catch (e) {
    await transaction.rollback();
    console.error("Rolled back due to error:", e);
    await pool.close();
    process.exit(1);
  }

  const balAfter = await pool.request().query(`SELECT SUM(Debit) - SUM(Credit) AS NetSaldo FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID WHERE coa.AccountNo = '1399'`);
  console.log("Saldo 1399 SESUDAH koreksi:", balAfter.recordset[0]);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
