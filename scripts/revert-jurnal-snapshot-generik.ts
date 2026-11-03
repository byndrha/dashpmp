import "dotenv/config";
import * as fs from "fs";
import { getPool, sql } from "../src/lib/db";

// Mengembalikan baris GeneralLedger dari snapshot hasil skrip hapus (semua tipe). Tiap baris snapshot membawa kolom Type.
// Pemakaian: npx tsx scripts/revert-jurnal-snapshot-generik.ts <snapshot.json> [--execute]
// Hanya mengembalikan bila pasangan (Type, VoucherNo, ID) SUDAH TIDAK ADA; selain itu ABORT.

const EXECUTE = process.argv.includes("--execute");
const berkas = process.argv.find((a) => a.endsWith(".json"));

async function main() {
  if (!berkas) throw new Error("Berikan path snapshot .json");
  const rows = JSON.parse(fs.readFileSync(berkas, "utf8")) as Record<string, unknown>[];
  const pool = await getPool();
  const pasangan = [...new Set(rows.map((r) => `${r.Type}|${r.VoucherNo}|${r.ID}`))];
  let ada = 0;
  for (const p of pasangan) {
    const [t, v, id] = p.split("|");
    ada += (await pool.request().input("t", sql.VarChar(20), t).input("v", sql.VarChar(64), v).input("id", sql.VarChar(16), id)
      .query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE [Type]=@t AND VoucherNo=@v AND ID=@id`)).recordset[0].n as number;
  }
  console.log(`Jurnal: ${pasangan.length} | baris snapshot: ${rows.length} | baris yang sudah ada sekarang: ${ada}`);
  if (!EXECUTE) { console.log("DRY RUN selesai."); await pool.close(); process.exit(0); }
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
