import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Mengembalikan 4 baris jurnal yatim SI/004941 dari snapshot (fix-yatim-si004941-2026-10-22.ts).
// Default DRY RUN; --execute untuk menulis.

const SNAP = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-22-yatim-si004941-before.json");
const EXECUTE = process.argv.includes("--execute");

async function main() {
  const rows = JSON.parse(fs.readFileSync(SNAP, "utf8")) as Record<string, unknown>[];
  const pool = await getPool();
  const n = (await pool.request().query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE VoucherNo='MKE/SI/004941/2026-09/003/001' AND [Type]='SALESINVOICE' AND ID='01249478'`)).recordset[0].n as number;
  console.log(`Baris saat ini: ${n} | snapshot: ${rows.length}`);
  if (!EXECUTE) { console.log("DRY RUN selesai."); await pool.close(); return; }
  if (n !== 0) { console.error("ABORT: baris sudah ada, tidak mengembalikan ulang."); await pool.close(); process.exit(1); }
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
