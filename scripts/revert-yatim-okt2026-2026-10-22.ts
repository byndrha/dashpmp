import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Mengembalikan jurnal yatim Oktober dari snapshot (fix-yatim-okt2026-2026-10-22.ts).
// Default DRY RUN; --execute untuk menulis.

// Argumen opsional: path snapshot (.json); default = snapshot eksekusi 23 Okt (73 voucher).
const SNAP = process.argv.find((a) => a.endsWith(".json")) ?? path.join(__dirname, "..", "docs", "data-fixes", "2026-10-23-yatim-okt2026-before.json");
const EXECUTE = process.argv.includes("--execute");

async function main() {
  const rows = JSON.parse(fs.readFileSync(SNAP, "utf8")) as Record<string, unknown>[];
  const pool = await getPool();
  const vouchers = [...new Set(rows.map((r) => String(r.VoucherNo)))];
  let ada = 0;
  for (let i = 0; i < vouchers.length; i += 50) {
    const req = pool.request();
    const ph = vouchers.slice(i, i + 50).map((v, j) => { req.input(`v${j}`, sql.VarChar(64), v); return `@v${j}`; });
    ada += (await req.query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo IN (${ph.join(",")})`)).recordset[0].n as number;
  }
  console.log(`Voucher: ${vouchers.length} | baris di snapshot: ${rows.length} | baris ada sekarang: ${ada}`);
  if (!EXECUTE) { console.log("DRY RUN selesai."); await pool.close(); return; }
  if (ada !== 0) { console.error("ABORT: sebagian baris sudah ada, tidak mengembalikan ulang."); await pool.close(); process.exit(1); }
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const r of rows) {
      const cols = Object.keys(r);
      const req = new sql.Request(tx);
      cols.forEach((c, i) => req.input(`p${i}`, c === "TransDate" ? new Date(String(r[c])) : r[c]));
      await req.query(`INSERT INTO GeneralLedger (${cols.map((c) => `[${c}]`).join(",")}) VALUES (${cols.map((_, i) => `@p${i}`).join(",")})`);
    }
    await tx.commit();
    console.log("Revert selesai.");
  } catch (e) { await tx.rollback(); console.error("GAGAL (rollback):", e); await pool.close(); process.exit(1); }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
