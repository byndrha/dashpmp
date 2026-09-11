import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Reverts scripts/fix-git1399-gapaktif-25agustus-2026-09-11.ts using the
// inserted-rows snapshot it wrote. Deletes exactly those rows by
// ID + ChartOfAccountID + VoucherNo (never a broader match).
//
// By default reverts EVERY row in the snapshot. To revert only specific
// DO(s) — e.g. because ERP Desktop later auto-posted a duplicate — pass one
// or more DO VoucherNo as CLI args:
//   npx tsx scripts/revert-git1399-gapaktif-25agustus-2026-09-11.ts "MKE/DO/003696/2026-08/003/001"

async function main() {
  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-git1399-gapaktif-25agustus-inserted.json");
  const allRows = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
    ID: string; VoucherNo: string; ChartOfAccountID: string;
  }[];

  const filterVouchers = process.argv.slice(2);
  const rows = filterVouchers.length > 0
    ? allRows.filter((r) => filterVouchers.includes(r.VoucherNo))
    : allRows;

  if (rows.length === 0) {
    console.log("Tidak ada baris yang cocok untuk direvert.", filterVouchers.length > 0 ? `(filter: ${filterVouchers.join(", ")})` : "");
    return;
  }
  console.log(`Akan revert ${rows.length} baris (dari total ${allRows.length} di snapshot)${filterVouchers.length > 0 ? ` — filter: ${filterVouchers.join(", ")}` : " — SEMUA (tanpa filter)"}`);

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    let deleted = 0;
    for (const row of rows) {
      const r = new sql.Request(transaction);
      r.input("id", sql.VarChar(16), row.ID);
      r.input("chartOfAccountId", sql.VarChar(16), row.ChartOfAccountID);
      r.input("voucherNo", sql.VarChar(128), row.VoucherNo);
      const res = await r.query(`
        DELETE FROM GeneralLedger
        WHERE ID = @id AND ChartOfAccountID = @chartOfAccountId AND VoucherNo = @voucherNo
      `);
      deleted += res.rowsAffected[0] ?? 0;
      console.log("Reverted", row.VoucherNo, "->", row.ChartOfAccountID, "ID", row.ID);
    }
    await transaction.commit();
    console.log(`Reverted: ${deleted} baris GeneralLedger dihapus (dari ${rows.length} baris di snapshot).`);
  } catch (e) {
    await transaction.rollback();
    console.error("Revert rolled back due to error:", e);
    process.exit(1);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
