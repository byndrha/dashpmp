import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Reverts fix-hapus-si000850-mati-2026-09-11.ts — re-inserts the exact
// SalesInvoice header row from the before-snapshot.

async function main() {
  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-hapus-si000850-mati-before.json");
  const row = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as Record<string, unknown>;

  const pool = await getPool();
  const cols = Object.keys(row).filter((c) => c !== "Timestamp"); // Timestamp is a DB-managed rowversion column, cannot be inserted
  const req = pool.request();
  for (const col of cols) {
    const val = row[col];
    if (val === null || val === undefined) {
      req.input(col, sql.NVarChar, null);
    } else if (col.toLowerCase().includes("date") && typeof val === "string") {
      req.input(col, sql.DateTime, new Date(val));
    } else if (typeof val === "number") {
      req.input(col, sql.Decimal(18, 6), val);
    } else if (typeof val === "boolean") {
      req.input(col, sql.Bit, val);
    } else {
      req.input(col, sql.NVarChar, String(val));
    }
  }
  const columnList = cols.join(", ");
  const paramList = cols.map((c) => `@${c}`).join(", ");
  await req.query(`INSERT INTO SalesInvoice (${columnList}) VALUES (${paramList})`);
  console.log("Reverted: baris SalesInvoice", row.VoucherNo, "dikembalikan.");

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
