import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Membatalkan fix-jurnal-basi-okt2026-2026-10-24.ts: hapus jurnal dashboard yang ada sekarang untuk 3 SI itu
// (+ catatan audit backfill-nya), lalu kembalikan jurnal LAMA dari snapshot. Default DRY RUN; --execute untuk menulis.

const SNAP = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-24-jurnal-basi-okt2026-before.json");
const EXECUTE = process.argv.includes("--execute");

async function main() {
  const lama = JSON.parse(fs.readFileSync(SNAP, "utf8")) as Record<string, Record<string, unknown>[]>;
  const pool = await getPool();
  for (const [v, rows] of Object.entries(lama)) {
    const n = (await pool.request().input("v", sql.VarChar(64), v).query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo=@v`)).recordset[0].n as number;
    console.log(`${v}: baris sekarang ${n} | baris lama di snapshot ${rows.length}`);
  }
  if (!EXECUTE) { console.log("DRY RUN selesai."); await pool.close(); return; }
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const [v, rows] of Object.entries(lama)) {
      await new sql.Request(tx).input("v", sql.VarChar(64), v).query(`
        DELETE d FROM DashboardGLPostingBackfillDetail d JOIN DashboardGLPostingBackfill b ON b.BackfillID=d.BackfillID WHERE b.VoucherNo=@v AND b.DocType='SALESINVOICE'`);
      await new sql.Request(tx).input("v", sql.VarChar(64), v).query(`DELETE FROM DashboardGLPostingBackfill WHERE VoucherNo=@v AND DocType='SALESINVOICE'`);
      await new sql.Request(tx).input("v", sql.VarChar(64), v).query(`DELETE FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo=@v AND LEFT(ISNULL(Memo,''),9)='[DASHPMP-'`);
      for (const r of rows) {
        const cols = Object.keys(r);
        const req = new sql.Request(tx);
        cols.forEach((c, i) => req.input(`p${i}`, c === "TransDate" ? new Date(String(r[c])) : r[c]));
        await req.query(`INSERT INTO GeneralLedger (${cols.map((c) => `[${c}]`).join(",")}) VALUES (${cols.map((_, i) => `@p${i}`).join(",")})`);
      }
    }
    await tx.commit();
    console.log("Revert selesai.");
  } catch (e) { await tx.rollback(); console.error("GAGAL (rollback):", e); await pool.close(); process.exit(1); }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
