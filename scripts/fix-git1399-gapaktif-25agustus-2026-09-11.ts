import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Backfills the missing GeneralLedger Debit-1399/Credit-14013 journal pair
// for 43 DeliveryOrder documents dated 25 Aug 2026 that are part of the
// active "GAP AKTIF" bug: their SalesInvoice/SalesReturn already posted a
// Credit to 1399, but the DO's own Debit never posted (root cause: August
// 2026 period-closing stuck in ERP Desktop). All 43 DOs were confirmed to
// still exist (not deleted), IsClosed=true, IsInvoiced=true.
//
// User explicitly chose to post these manually now (accepting the risk that
// ERP Desktop may later auto-post the same entries once period-closing is
// fixed, requiring a future reconciliation pass to catch duplicates).
//
// Debit amount per DO = sum of Credit already posted to 1399 for its
// paired SalesInvoice/SalesReturn (one DO — 003716 — has both an SI and an
// SR pairing; all others have exactly one SI pairing), re-derived live from
// GeneralLedger rather than hardcoded, so the amounts are guaranteed to
// match what's actually posted right now.

const DO_VOUCHERS = [
  "003696","003697","003698","003699","003700","003701","003702","003703","003704","003705",
  "003706","003707","003708","003709","003726","003711","003712","003714","003715","003713",
  "003717","003718","003719","003720","003721","003722","003723","003724","003725","003727",
  "003728","003729","003730","003731","003732","003733","003734","003735","003736","003737",
  "003738","003739","003716",
].map((n) => `MKE/DO/${n}/2026-08/003/001`);

const ACC_1399 = "01129";
const ACC_14013 = "01159";

async function main() {
  const pool = await getPool();

  // 1. Fetch DO source rows
  const doReq = pool.request();
  const doParams = DO_VOUCHERS.map((v, i) => { doReq.input(`v${i}`, sql.VarChar(128), v); return `@v${i}`; }).join(",");
  const doRes = await doReq.query(`
    SELECT DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, CurrencyID, Rate, IsDeleted
    FROM DeliveryOrder WHERE VoucherNo IN (${doParams})
  `);
  const doRows = doRes.recordset as {
    DeliveryOrderID: string; VoucherNo: string; TransDate: Date; BranchID: string; DepartmentID: string;
    BusinessPartnerID: string; CurrencyID: string; Rate: number; IsDeleted: boolean;
  }[];
  if (doRows.length !== DO_VOUCHERS.length) {
    console.error(`MISMATCH: expected ${DO_VOUCHERS.length} DO rows, found ${doRows.length}. Aborting.`);
    const found = new Set(doRows.map((r) => r.VoucherNo));
    for (const v of DO_VOUCHERS) if (!found.has(v)) console.error("  missing:", v);
    await pool.close();
    process.exit(1);
  }
  if (doRows.some((r) => r.IsDeleted)) {
    console.error("MISMATCH: some DO rows are IsDeleted=true. Aborting.", doRows.filter((r) => r.IsDeleted).map((r) => r.VoucherNo));
    await pool.close();
    process.exit(1);
  }

  // 2. For each DO, find its paired SI (via SalesInvoice.DeliveryOrderID, quote-stripped)
  //    and SR (via SalesReturn.DeliveryOrderID, no stripping needed) GL Credit rows on 1399.
  const doIds = doRows.map((r) => r.DeliveryOrderID);
  const siReq = pool.request();
  const siParams = doIds.map((v, i) => { siReq.input(`v${i}`, sql.VarChar(32), v); return `@v${i}`; }).join(",");
  const siMatch = await siReq.query(`
    SELECT VoucherNo, REPLACE(DeliveryOrderID, CHAR(39), '') AS CleanDoId
    FROM SalesInvoice WHERE REPLACE(DeliveryOrderID, CHAR(39), '') IN (${siParams})
  `);
  const srReq = pool.request();
  const srParams = doIds.map((v, i) => { srReq.input(`v${i}`, sql.VarChar(32), v); return `@v${i}`; }).join(",");
  const srMatch = await srReq.query(`
    SELECT VoucherNo, DeliveryOrderID FROM SalesReturn WHERE DeliveryOrderID IN (${srParams})
  `);

  const siByDoId = new Map<string, string[]>();
  for (const r of siMatch.recordset as { VoucherNo: string; CleanDoId: string }[]) {
    const arr = siByDoId.get(r.CleanDoId) ?? [];
    arr.push(r.VoucherNo);
    siByDoId.set(r.CleanDoId, arr);
  }
  const srByDoId = new Map<string, string[]>();
  for (const r of srMatch.recordset as { VoucherNo: string; DeliveryOrderID: string }[]) {
    const arr = srByDoId.get(r.DeliveryOrderID) ?? [];
    arr.push(r.VoucherNo);
    srByDoId.set(r.DeliveryOrderID, arr);
  }

  const allPairedVouchers = [...new Set([...siByDoId.values(), ...srByDoId.values()].flat())];
  const glReq = pool.request();
  const glParams = allPairedVouchers.map((v, i) => { glReq.input(`v${i}`, sql.VarChar(128), v); return `@v${i}`; }).join(",");
  const glCredits = await glReq.query(`
    SELECT gl.VoucherNo, gl.Credit
    FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = '1399' AND gl.Type IN ('SALESINVOICE','SALESRETURN') AND gl.VoucherNo IN (${glParams})
  `);
  const creditByVoucher = new Map<string, number>();
  for (const r of glCredits.recordset as { VoucherNo: string; Credit: number }[]) creditByVoucher.set(r.VoucherNo, r.Credit);

  // 3. Compute total Debit needed per DO
  const insertPlan: {
    doVoucherNo: string; transDate: Date; branchId: string; departmentId: string;
    businessPartnerId: string; currencyId: string; rate: number; amount: number; pairedVouchers: string[];
  }[] = [];
  for (const row of doRows) {
    const sis = siByDoId.get(row.DeliveryOrderID) ?? [];
    const srs = srByDoId.get(row.DeliveryOrderID) ?? [];
    const paired = [...sis, ...srs];
    if (paired.length === 0) {
      console.error(`MISMATCH: DO ${row.VoucherNo} has no paired SI/SR found. Aborting.`);
      await pool.close();
      process.exit(1);
    }
    const amount = paired.reduce((s, v) => s + (creditByVoucher.get(v) ?? 0), 0);
    if (amount <= 0) {
      console.error(`MISMATCH: DO ${row.VoucherNo} paired vouchers have zero/missing Credit on 1399. Aborting.`, paired);
      await pool.close();
      process.exit(1);
    }
    insertPlan.push({
      doVoucherNo: row.VoucherNo, transDate: row.TransDate, branchId: row.BranchID, departmentId: row.DepartmentID,
      businessPartnerId: row.BusinessPartnerID, currencyId: row.CurrencyID ?? "", rate: row.Rate ?? 1,
      amount, pairedVouchers: paired,
    });
  }

  console.log(`Rencana insert untuk ${insertPlan.length} DO:`);
  for (const p of insertPlan) console.log(` - ${p.doVoucherNo}: Rp ${p.amount.toFixed(6)} (pasangan: ${p.pairedVouchers.join(", ")})`);
  const totalAmount = insertPlan.reduce((s, p) => s + p.amount, 0);
  console.log("Total nominal yang akan di-Debit ke 1399:", totalAmount);

  // 4. Generate new unique IDs (numeric, zero-padded 8 digits), one per DO (shared by its 2 GL rows)
  const maxIdRes = await pool.request().query(`SELECT MAX(TRY_CAST(ID AS BIGINT)) AS MaxId FROM GeneralLedger`);
  let nextId = Number((maxIdRes.recordset[0] as { MaxId: number }).MaxId) + 1;

  const rowsToInsert: {
    ID: string; BranchID: string; DepartmentID: string; VoucherNo: string; TransDate: string;
    Type: string; ChartOfAccountID: string; Debit: number; Credit: number; Memo: string;
    BusinessPartnerID: string; CurrencyID: string; Rate: number;
  }[] = [];
  for (const p of insertPlan) {
    const id = String(nextId++).padStart(8, "0");
    rowsToInsert.push({
      ID: id, BranchID: p.branchId, DepartmentID: p.departmentId, VoucherNo: p.doVoucherNo,
      TransDate: p.transDate.toISOString(), Type: "DELIVERYORDER", ChartOfAccountID: ACC_1399,
      Debit: p.amount, Credit: 0, Memo: "", BusinessPartnerID: p.businessPartnerId,
      CurrencyID: p.currencyId, Rate: p.rate,
    });
    rowsToInsert.push({
      ID: id, BranchID: p.branchId, DepartmentID: p.departmentId, VoucherNo: p.doVoucherNo,
      TransDate: p.transDate.toISOString(), Type: "DELIVERYORDER", ChartOfAccountID: ACC_14013,
      Debit: 0, Credit: p.amount, Memo: "", BusinessPartnerID: p.businessPartnerId,
      CurrencyID: p.currencyId, Rate: p.rate,
    });
  }

  console.log(`Total baris yang akan diinsert: ${rowsToInsert.length} (${insertPlan.length} DO x 2)`);

  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-git1399-gapaktif-25agustus-inserted.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(rowsToInsert, null, 2));
  console.log("Snapshot rencana insert ditulis ke", snapshotPath);

  // Balance check before
  const balBefore = await pool.request().query(`
    SELECT SUM(Debit) - SUM(Credit) AS NetSaldo FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID WHERE coa.AccountNo = '1399'
  `);
  console.log("Saldo 1399 SEBELUM insert:", balBefore.recordset[0]);

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
        INSERT INTO GeneralLedger
          (ID, BranchID, DepartmentID, VoucherNo, TransDate, Type, ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
        VALUES
          (@id, @branchId, @departmentId, @voucherNo, @transDate, @type, @chartOfAccountId, @debit, @credit, @memo, @businessPartnerId, @currencyId, @rate)
      `);
    }
    await transaction.commit();
    console.log(`Committed: ${rowsToInsert.length} baris GeneralLedger baru berhasil diinsert.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Transaction rolled back due to error:", e);
    await pool.close();
    process.exit(1);
  }

  // Verify each DO now has exactly 2 GL rows
  const verifyReq = pool.request();
  const verifyParams = DO_VOUCHERS.map((v, i) => { verifyReq.input(`v${i}`, sql.VarChar(128), v); return `@v${i}`; }).join(",");
  const verifyRes = await verifyReq.query(`
    SELECT VoucherNo, COUNT(*) AS N FROM GeneralLedger WHERE VoucherNo IN (${verifyParams}) AND Type = 'DELIVERYORDER' GROUP BY VoucherNo
  `);
  const counts = verifyRes.recordset as { VoucherNo: string; N: number }[];
  const bad = counts.filter((c) => c.N !== 2);
  console.log("DO dengan jumlah baris GL != 2 (harus kosong):", bad);
  console.log("Total DO terverifikasi 2 baris:", counts.filter((c) => c.N === 2).length, "dari", DO_VOUCHERS.length);

  const balAfter = await pool.request().query(`
    SELECT SUM(Debit) - SUM(Credit) AS NetSaldo FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID WHERE coa.AccountNo = '1399'
  `);
  console.log("Saldo 1399 SESUDAH insert:", balAfter.recordset[0]);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
