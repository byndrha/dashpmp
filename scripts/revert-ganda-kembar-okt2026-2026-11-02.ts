import "dotenv/config";
import * as fs from "fs";
import { getPool, sql } from "../src/lib/db";

// Mengembalikan jurnal dashboard ganda yang dihapus fix-ganda-kembar-okt2026-2026-11-02.ts dari snapshot.
// Pemakaian: npx tsx scripts/revert-ganda-kembar-okt2026-2026-11-02.ts <snapshot.json> [--execute]
// Hanya mengembalikan bila pasangan (VoucherNo, ID) itu SUDAH TIDAK ADA (jurnal ERP voucher yang sama tidak disentuh).

const EXECUTE = process.argv.includes("--execute");
const berkas = process.argv.find((a) => a.endsWith(".json"));

async function main() {
  if (!berkas) throw new Error("Berikan path snapshot .json");
  const rows = JSON.parse(fs.readFileSync(berkas, "utf8")) as Record<string, unknown>[];
  const pool = await getPool();
  const pasangan = [...new Set(rows.map((r) => `${r.VoucherNo}|${r.ID}`))];
  let ada = 0;
  for (const p of pasangan) {
    const [v, id] = p.split("|");
    ada += (await pool.request().input("v", sql.VarChar(64), v).input("id", sql.VarChar(16), id)
      .query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo=@v AND ID=@id`)).recordset[0].n as number;
  }
  console.log(`Pasangan (voucher, ID): ${pasangan.length} | baris di snapshot: ${rows.length} | baris yang sudah ada sekarang: ${ada}`);
  if (!EXECUTE) { console.log("DRY RUN selesai."); await pool.close(); return; }
  if (ada !== 0) { console.error("ABORT: sebagian baris sudah ada; tidak mengembalikan ulang."); await pool.close(); process.exit(1); }
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const r of rows) {
      const cols = Object.keys(r);
      const req = new sql.Request(tx);
      cols.forEach((c, i) => req.input(`p${i}`, c === "TransDate" ? new Date(String(r[c])) : r[c]));
      await req.query(`INSERT INTO GeneralLedger (${cols.map((c) => `[${c}]`).join(",")}) VALUES (${cols.map((_, i) => `@p${i}`).join(",")})`);
    }
    await tx.commit(); console.log("Revert selesai.");
  } catch (e) { await tx.rollback(); console.error("GAGAL (rollback):", e); await pool.close(); process.exit(1); }
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
