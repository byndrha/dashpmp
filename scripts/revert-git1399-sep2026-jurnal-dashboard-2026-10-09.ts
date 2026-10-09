import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Mengembalikan jurnal yang dihapus oleh
// fix-git1399-sep2026-jurnal-dashboard-2026-10-09.ts, dari snapshot
// docs/data-fixes/2026-10-09-git1399-sep2026-jurnal-dashboard-before.json.
// Idempoten per jurnal: jurnal yang sudah ada kembali (VoucherNo+Type+ID) dilewati.
// Pakai --execute untuk menulis; default DRY RUN.

const SNAPSHOT = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-09-git1399-sep2026-jurnal-dashboard-before.json");
const EXECUTE = process.argv.includes("--execute");

interface Row {
  ID: string; BranchID: string; DepartmentID: string; VoucherNo: string; TransDate: string; Type: string;
  ChartOfAccountID: string; Debit: number; Credit: number; Memo: string | null;
  BusinessPartnerID: string | null; CurrencyID: string; Rate: number;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) as { grup: string; key: string; rows: Row[] }[];
  const pool = await getPool();
  let kembali = 0, lewat = 0;
  for (const j of data) {
    const first = j.rows[0];
    const ada = await pool.request()
      .input("v", sql.VarChar(64), first.VoucherNo).input("id", sql.VarChar(16), first.ID).input("t", sql.VarChar(20), first.Type)
      .input("coa", sql.VarChar(16), first.ChartOfAccountID).input("td", sql.DateTime, new Date(first.TransDate))
      .query(`SELECT TOP 1 1 AS x FROM GeneralLedger WHERE ChartOfAccountID=@coa AND TransDate=@td AND VoucherNo=@v AND ID=@id AND [Type]=@t`);
    if (ada.recordset.length > 0) { lewat++; continue; }
    if (!EXECUTE) { kembali++; continue; }
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const r of j.rows) {
        await new sql.Request(tx)
          .input("id", sql.VarChar(16), r.ID).input("branchId", sql.VarChar(16), r.BranchID).input("departmentId", sql.VarChar(16), r.DepartmentID)
          .input("voucherNo", sql.VarChar(64), r.VoucherNo).input("transDate", sql.DateTime, new Date(r.TransDate))
          .input("docType", sql.VarChar(20), r.Type).input("coa", sql.VarChar(16), r.ChartOfAccountID)
          .input("debit", sql.Decimal(18, 6), r.Debit).input("credit", sql.Decimal(18, 6), r.Credit)
          .input("memo", sql.VarChar(255), r.Memo).input("bp", sql.VarChar(16), r.BusinessPartnerID)
          .input("cur", sql.VarChar(16), r.CurrencyID).input("rate", sql.Decimal(18, 6), r.Rate)
          .query(`INSERT INTO GeneralLedger (ID, BranchID, DepartmentID, VoucherNo, TransDate, [Type], ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
                  VALUES (@id, @branchId, @departmentId, @voucherNo, @transDate, @docType, @coa, @debit, @credit, @memo, @bp, @cur, @rate)`);
      }
      await tx.commit();
      kembali++;
    } catch (e) {
      await tx.rollback();
      console.error("GAGAL mengembalikan", j.key, e);
      await pool.close();
      process.exit(1);
    }
  }
  console.log(EXECUTE ? `Dikembalikan: ${kembali} jurnal, dilewati (sudah ada): ${lewat}` : `DRY RUN: akan dikembalikan ${kembali}, sudah ada ${lewat}`);
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
