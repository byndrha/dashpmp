import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Membatalkan scripts/fix-git1399-okt2026-sr-si-hpp-2026-11-03.ts: hapus baris ber-Memo TAG pada (Type, VoucherNo, ID) di berkas rencana.
// Baris jurnal ERP (Memo lain) tidak disentuh. Default DRY RUN; --execute untuk menulis.

const EXECUTE = process.argv.includes("--execute");
const RENCANA = path.join(__dirname, "..", "docs", "data-fixes", "2026-11-03-git1399-okt2026-sr-si-hpp-posted.json");

async function main() {
  const { tag, rencana } = JSON.parse(fs.readFileSync(RENCANA, "utf8")) as { tag: string; rencana: { type: string; voucherNo: string; id: string; lines: unknown[] }[] };
  const harap = rencana.reduce((s, j) => s + j.lines.length, 0);
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    let n = 0;
    for (const j of rencana) {
      const r = new sql.Request(tx).input("t", sql.VarChar(20), j.type).input("v", sql.VarChar(64), j.voucherNo).input("id", sql.VarChar(16), j.id).input("m", sql.VarChar(255), tag);
      n += EXECUTE
        ? (await r.query(`DELETE FROM GeneralLedger WHERE [Type]=@t AND VoucherNo=@v AND ID=@id AND Memo=@m`)).rowsAffected[0]
        : ((await r.query(`SELECT COUNT(*) n FROM GeneralLedger WHERE [Type]=@t AND VoucherNo=@v AND ID=@id AND Memo=@m`)).recordset[0].n as number);
    }
    console.log(`${EXECUTE ? "Dihapus" : "Akan dihapus"} ${n} baris (rencana ${harap}).`);
    if (EXECUTE && n !== harap) throw new Error(`jumlah baris ${n} != rencana ${harap}`);
    if (EXECUTE) await tx.commit(); else await tx.rollback();
  } catch (e) { await tx.rollback(); console.error("GAGAL (rollback):", e); await pool.close(); process.exit(1); }
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
