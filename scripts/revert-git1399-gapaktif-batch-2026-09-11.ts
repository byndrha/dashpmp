import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Reverts one day-batch written by fix-git1399-gapaktif-26-31agustus-batch-2026-09-11.ts.
//
// Usage:
//   npx tsx scripts/revert-git1399-gapaktif-batch-2026-09-11.ts 0826
//     -> reverts EVERY row from the 26 Aug batch snapshot
//   npx tsx scripts/revert-git1399-gapaktif-batch-2026-09-11.ts 0826 "MKE/DO/003800/2026-08/003/001"
//     -> reverts only that one DO's journal pair from the 26 Aug batch

async function main() {
  const dayLabel = process.argv[2];
  if (!dayLabel) {
    console.error("Usage: revert-git1399-gapaktif-batch-2026-09-11.ts <dayLabel e.g. 0826> [voucherNo ...]");
    process.exit(1);
  }
  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", `2026-09-11-git1399-gapaktif-${dayLabel}-inserted.json`);
  if (!fs.existsSync(snapshotPath)) {
    console.error("Snapshot tidak ditemukan:", snapshotPath);
    process.exit(1);
  }
  const allRows = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
    ID: string; VoucherNo: string; ChartOfAccountID: string;
  }[];

  const filterVouchers = process.argv.slice(3);
  const rows = filterVouchers.length > 0
    ? allRows.filter((r) => filterVouchers.includes(r.VoucherNo))
    : allRows;

  if (rows.length === 0) {
    console.log("Tidak ada baris yang cocok untuk direvert.", filterVouchers.length > 0 ? `(filter: ${filterVouchers.join(", ")})` : "");
    return;
  }
  console.log(`Batch ${dayLabel}: akan revert ${rows.length} baris (dari total ${allRows.length} di snapshot)${filterVouchers.length > 0 ? ` — filter: ${filterVouchers.join(", ")}` : " — SEMUA (tanpa filter)"}`);

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
      const res = await r.query(`DELETE FROM GeneralLedger WHERE ID = @id AND ChartOfAccountID = @chartOfAccountId AND VoucherNo = @voucherNo`);
      deleted += res.rowsAffected[0] ?? 0;
      console.log("Reverted", row.VoucherNo, "->", row.ChartOfAccountID, "ID", row.ID);
    }
    await transaction.commit();
    console.log(`Reverted: ${deleted} baris GeneralLedger dihapus dari batch ${dayLabel}.`);
  } catch (e) {
    await transaction.rollback();
    console.error("Revert rolled back due to error:", e);
    process.exit(1);
  }
  await pool.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
