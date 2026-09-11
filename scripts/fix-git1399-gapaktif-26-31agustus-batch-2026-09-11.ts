import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Same methodology as fix-git1399-gapaktif-25agustus-2026-09-11.ts, but
// processes 26-31 Aug 2026 ONE DAY AT A TIME, each in its own transaction
// with its own snapshot file. The first attempt at doing all 6 days (800
// DOs, 1600 rows) in a single transaction lost its connection mid-run
// (confirmed harmless — SQL Server auto-rolled back, verified 0 rows
// leaked, balance unchanged) — this version trades one giant transaction
// for six small ones so a failure on one day never touches the others,
// and each day gets its own revert file for surgical rollback.

const ACC_1399 = "01129";
const ACC_14013 = "01159";
const DAYS = ["2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01"];

async function chunkedQuery<T>(pool: Awaited<ReturnType<typeof getPool>>, table: string, selectCols: string, column: string, values: string[]): Promise<T[]> {
  const out: T[] = [];
  const CHUNK = 900;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    const req = pool.request();
    const params = chunk.map((v, j) => { req.input(`v${j}`, sql.VarChar(128), v); return `@v${j}`; }).join(",");
    const res = await req.query(`SELECT ${selectCols} FROM ${table} WHERE ${column} IN (${params})`);
    out.push(...(res.recordset as T[]));
  }
  return out;
}

async function chunkedQueryGrouped(pool: Awaited<ReturnType<typeof getPool>>, vouchers: string[]): Promise<{ VoucherNo: string; N: number }[]> {
  const out: { VoucherNo: string; N: number }[] = [];
  const CHUNK = 900;
  for (let i = 0; i < vouchers.length; i += CHUNK) {
    const chunk = vouchers.slice(i, i + CHUNK);
    if (chunk.length === 0) continue;
    const req = pool.request();
    const params = chunk.map((v, j) => { req.input(`v${j}`, sql.VarChar(128), v); return `@v${j}`; }).join(",");
    const res = await req.query(`SELECT VoucherNo, COUNT(*) AS N FROM GeneralLedger WHERE VoucherNo IN (${params}) AND Type = 'DELIVERYORDER' GROUP BY VoucherNo`);
    out.push(...(res.recordset as { VoucherNo: string; N: number }[]));
  }
  return out;
}

async function processDay(pool: Awaited<ReturnType<typeof getPool>>, dayFrom: string, dayTo: string, label: string) {
  console.log(`\n========== ${label} (${dayFrom} - ${dayTo}) ==========`);

  const glRes = await pool.request().query(`
    SELECT gl.VoucherNo, gl.Type, gl.Credit
    FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
    WHERE coa.AccountNo = '1399' AND gl.Type IN ('SALESINVOICE','SALESRETURN')
      AND gl.TransDate >= '${dayFrom}' AND gl.TransDate < '${dayTo}'
  `);
  const creditRows = glRes.recordset as { VoucherNo: string; Type: "SALESINVOICE" | "SALESRETURN"; Credit: number }[];
  console.log("Total SI/SR Credit rows di 1399:", creditRows.length);
  if (creditRows.length === 0) { console.log("Tidak ada apa-apa untuk hari ini, skip."); return; }

  const siVouchers = [...new Set(creditRows.filter((r) => r.Type === "SALESINVOICE").map((r) => r.VoucherNo))];
  const srVouchers = [...new Set(creditRows.filter((r) => r.Type === "SALESRETURN").map((r) => r.VoucherNo))];

  const siRows = await chunkedQuery<{ VoucherNo: string; CleanDoId: string }>(
    pool, "SalesInvoice", "VoucherNo, REPLACE(DeliveryOrderID, CHAR(39), '') AS CleanDoId", "VoucherNo", siVouchers,
  );
  const srRows = await chunkedQuery<{ VoucherNo: string; DeliveryOrderID: string }>(
    pool, "SalesReturn", "VoucherNo, DeliveryOrderID", "VoucherNo", srVouchers,
  );
  const doIdBySiVoucher = new Map(siRows.map((r) => [r.VoucherNo, r.CleanDoId]));
  const doIdBySrVoucher = new Map(srRows.map((r) => [r.VoucherNo, r.DeliveryOrderID]));

  const creditByDoId = new Map<string, number>();
  const pairedVouchersByDoId = new Map<string, string[]>();
  for (const r of creditRows) {
    const doId = r.Type === "SALESINVOICE" ? doIdBySiVoucher.get(r.VoucherNo) : doIdBySrVoucher.get(r.VoucherNo);
    if (!doId) continue;
    creditByDoId.set(doId, (creditByDoId.get(doId) ?? 0) + r.Credit);
    const arr = pairedVouchersByDoId.get(doId) ?? [];
    arr.push(r.VoucherNo);
    pairedVouchersByDoId.set(doId, arr);
  }
  const allDoIds = [...creditByDoId.keys()];
  console.log("Total DO unik:", allDoIds.length);

  const doRows = await chunkedQuery<{
    DeliveryOrderID: string; VoucherNo: string; TransDate: string; BranchID: string; DepartmentID: string;
    BusinessPartnerID: string; CurrencyID: string; Rate: number; IsDeleted: boolean;
  }>(
    pool, "DeliveryOrder",
    "DeliveryOrderID, VoucherNo, TransDate, BranchID, DepartmentID, BusinessPartnerID, CurrencyID, Rate, IsDeleted",
    "DeliveryOrderID", allDoIds,
  );
  const doById = new Map(doRows.map((r) => [r.DeliveryOrderID, r]));

  const missingDoIds = allDoIds.filter((id) => !doById.has(id));
  if (missingDoIds.length > 0) console.log(`INFO: ${missingDoIds.length} DoId tanpa baris DeliveryOrder (orphan credit, di luar scope):`, missingDoIds.slice(0, 10));
  const deletedDos = doRows.filter((r) => r.IsDeleted);
  if (deletedDos.length > 0) console.log(`INFO: ${deletedDos.length} DO IsDeleted=true (di luar scope):`, deletedDos.map((r) => r.VoucherNo));

  const candidateDoIds = allDoIds.filter((id) => { const d = doById.get(id); return d && !d.IsDeleted; });
  const candidateVouchers = candidateDoIds.map((id) => doById.get(id)!.VoucherNo);
  const alreadyPostedRows = await chunkedQuery<{ VoucherNo: string }>(
    pool, "GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID AND coa.AccountNo = '1399' AND gl.Type = 'DELIVERYORDER'",
    "gl.VoucherNo", "gl.VoucherNo", candidateVouchers,
  );
  const alreadyPostedSet = new Set(alreadyPostedRows.map((r) => r.VoucherNo));
  const gapDoIds = candidateDoIds.filter((id) => !alreadyPostedSet.has(doById.get(id)!.VoucherNo));
  console.log("GAP (perlu backfill):", gapDoIds.length, "| Sudah ada Debit (dilewati):", candidateDoIds.length - gapDoIds.length);

  const insertPlan = gapDoIds.map((doId) => {
    const d = doById.get(doId)!;
    return {
      doVoucherNo: d.VoucherNo, transDate: d.TransDate, branchId: d.BranchID, departmentId: d.DepartmentID,
      businessPartnerId: d.BusinessPartnerID, currencyId: d.CurrencyID ?? "", rate: d.Rate ?? 1,
      amount: creditByDoId.get(doId)!, pairedVouchers: pairedVouchersByDoId.get(doId)!,
    };
  }).filter((p) => p.amount > 0);

  const totalAmount = insertPlan.reduce((s, p) => s + p.amount, 0);
  console.log(`Rencana insert: ${insertPlan.length} DO, total Rp ${totalAmount.toFixed(2)}`);
  if (insertPlan.length === 0) { console.log("Tidak ada yang perlu diinsert untuk hari ini."); return; }

  const maxIdRes = await pool.request().query(`SELECT MAX(TRY_CAST(ID AS BIGINT)) AS MaxId FROM GeneralLedger`);
  let nextId = Number((maxIdRes.recordset[0] as { MaxId: number }).MaxId) + 1;

  const rowsToInsert: {
    ID: string; BranchID: string; DepartmentID: string; VoucherNo: string; TransDate: string;
    Type: string; ChartOfAccountID: string; Debit: number; Credit: number; Memo: string;
    BusinessPartnerID: string; CurrencyID: string; Rate: number; PairedVouchers: string[];
  }[] = [];
  for (const p of insertPlan) {
    const id = String(nextId++).padStart(8, "0");
    rowsToInsert.push({ ID: id, BranchID: p.branchId, DepartmentID: p.departmentId, VoucherNo: p.doVoucherNo, TransDate: new Date(p.transDate).toISOString(), Type: "DELIVERYORDER", ChartOfAccountID: ACC_1399, Debit: p.amount, Credit: 0, Memo: "", BusinessPartnerID: p.businessPartnerId, CurrencyID: p.currencyId, Rate: p.rate, PairedVouchers: p.pairedVouchers });
    rowsToInsert.push({ ID: id, BranchID: p.branchId, DepartmentID: p.departmentId, VoucherNo: p.doVoucherNo, TransDate: new Date(p.transDate).toISOString(), Type: "DELIVERYORDER", ChartOfAccountID: ACC_14013, Debit: 0, Credit: p.amount, Memo: "", BusinessPartnerID: p.businessPartnerId, CurrencyID: p.currencyId, Rate: p.rate, PairedVouchers: p.pairedVouchers });
  }
  console.log(`Total baris: ${rowsToInsert.length}`);

  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", `2026-09-11-git1399-gapaktif-${label}-inserted.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(rowsToInsert, null, 2));
  console.log("Snapshot ditulis ke", snapshotPath);

  // Multi-row INSERT (chunked to stay under SQL Server's 2100-param limit —
  // 13 params/row, so 150 rows/statement = 1950 params) to minimize
  // round-trips. A prior single-row-per-request loop looked "stuck" for a
  // long time on a 288-row batch; DB state afterward showed it had in fact
  // committed fine — but many round-trips in one open transaction is still
  // needlessly fragile on this remote connection, so this cuts it down to
  // a handful of statements per batch.
  const INSERT_CHUNK = 150;
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (let i = 0; i < rowsToInsert.length; i += INSERT_CHUNK) {
      const chunk = rowsToInsert.slice(i, i + INSERT_CHUNK);
      const r = new sql.Request(transaction);
      const valueClauses = chunk.map((row, j) => {
        r.input(`id${j}`, sql.VarChar(16), row.ID);
        r.input(`branchId${j}`, sql.VarChar(16), row.BranchID);
        r.input(`departmentId${j}`, sql.VarChar(16), row.DepartmentID);
        r.input(`voucherNo${j}`, sql.VarChar(128), row.VoucherNo);
        r.input(`transDate${j}`, sql.DateTime, new Date(row.TransDate));
        r.input(`type${j}`, sql.VarChar(32), row.Type);
        r.input(`chartOfAccountId${j}`, sql.VarChar(16), row.ChartOfAccountID);
        r.input(`debit${j}`, sql.Decimal(18, 6), row.Debit);
        r.input(`credit${j}`, sql.Decimal(18, 6), row.Credit);
        r.input(`memo${j}`, sql.VarChar(255), row.Memo);
        r.input(`businessPartnerId${j}`, sql.VarChar(16), row.BusinessPartnerID);
        r.input(`currencyId${j}`, sql.VarChar(16), row.CurrencyID);
        r.input(`rate${j}`, sql.Decimal(18, 6), row.Rate);
        return `(@id${j}, @branchId${j}, @departmentId${j}, @voucherNo${j}, @transDate${j}, @type${j}, @chartOfAccountId${j}, @debit${j}, @credit${j}, @memo${j}, @businessPartnerId${j}, @currencyId${j}, @rate${j})`;
      }).join(",\n");
      await r.query(`
        INSERT INTO GeneralLedger (ID, BranchID, DepartmentID, VoucherNo, TransDate, Type, ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
        VALUES ${valueClauses}
      `);
      console.log(`  ... inserted chunk ${i}-${i + chunk.length - 1} (${chunk.length} baris)`);
    }
    await transaction.commit();
    console.log(`Committed: ${rowsToInsert.length} baris untuk ${label}.`);
  } catch (e) {
    console.error(`Gagal pada ${label}, mencoba rollback:`, e);
    try { await transaction.rollback(); } catch (e2) { console.error("Rollback juga gagal (kemungkinan koneksi sudah putus; SQL Server akan auto-rollback):", e2); }
    throw e;
  }

  const verifyRows = await chunkedQueryGrouped(pool, insertPlan.map((p) => p.doVoucherNo));
  const bad = verifyRows.filter((c) => c.N !== 2);
  console.log(`Verifikasi: ${verifyRows.filter((c) => c.N === 2).length}/${insertPlan.length} DO punya 2 baris. Bermasalah:`, bad);
}

async function main() {
  const pool = await getPool();

  // Optional CLI arg: start from this date (YYYY-MM-DD) instead of the
  // first day — used to resume after 0826/0827 already committed safely
  // in an earlier run that was killed mid-way (output buffering made it
  // look stuck; DB state confirmed both had already committed).
  const startFrom = process.argv[2];
  const startIdx = startFrom ? DAYS.indexOf(startFrom) : 0;
  if (startFrom && startIdx === -1) {
    console.error(`Tanggal start "${startFrom}" tidak ada di DAYS array.`, DAYS);
    process.exit(1);
  }

  const balStart = await pool.request().query(`SELECT SUM(Debit) - SUM(Credit) AS NetSaldo FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID WHERE coa.AccountNo = '1399'`);
  console.log("Saldo 1399 SEBELUM BATCH INI:", balStart.recordset[0]);

  for (let i = startIdx; i < DAYS.length - 1; i++) {
    const from = DAYS[i];
    const to = DAYS[i + 1];
    const label = from.replace(/-/g, "").slice(4); // e.g. "0826"
    try {
      await processDay(pool, from, to, label);
    } catch (e) {
      console.error(`\n!!! Batch ${from} GAGAL, menghentikan proses. Batch-batch sebelumnya (jika ada) TETAP AMAN ter-commit. !!!`, e);
      await pool.close();
      process.exit(1);
    }
  }

  const balEnd = await pool.request().query(`SELECT SUM(Debit) - SUM(Credit) AS NetSaldo FROM GeneralLedger gl JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID WHERE coa.AccountNo = '1399'`);
  console.log("\nSaldo 1399 SESUDAH SEMUA BATCH:", balEnd.recordset[0]);

  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
