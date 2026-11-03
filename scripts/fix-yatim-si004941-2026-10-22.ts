import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Hapus jurnal yatim SI/004941 (ID 01249478, 4 baris, memo [DASHPMP-REALTIME]):
// SI di-soft-delete ERP 9 Okt 03:51, jurnal dashboard-nya tertinggal (kredit 1399 Rp 3.303,01,
// pendapatan 4001 Rp 70.000). Disetujui user 22 Okt. Snapshot dulu, hapus dalam 1 transaksi.
// Default DRY RUN; --execute untuk menulis. Revert: revert-yatim-si004941-2026-10-22.ts

const EXECUTE = process.argv.includes("--execute");
const SNAP = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-22-yatim-si004941-before.json");
const SI = "MKE/SI/004941/2026-09/003/001";
const GL_ID = "01249478";

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const si = (await pool.request().input("v", sql.VarChar(64), SI).query(`SELECT IsDeleted FROM SalesInvoice WHERE VoucherNo=@v`)).recordset as { IsDeleted: boolean }[];
  const gl = (await pool.request().input("v", sql.VarChar(64), SI).input("id", sql.VarChar(16), GL_ID).query(
    `SELECT * FROM GeneralLedger WHERE VoucherNo=@v AND [Type]='SALESINVOICE' AND ID=@id`)).recordset as Record<string, unknown>[];
  const memoOk = gl.every((g) => String(g.Memo ?? "").startsWith("[DASHPMP-REALTIME]"));
  console.log(`SI baris=${si.length} aktif=${si.filter((x) => !x.IsDeleted).length} | baris GL=${gl.length} memoRealtime=${memoOk}`);
  for (const g of gl) console.log("  ", g.ChartOfAccountID, "D", g.Debit, "K", g.Credit);
  if (si.length !== 1 || si.some((x) => !x.IsDeleted) || gl.length !== 4 || !memoOk) {
    console.error("ABORT: SI harus 1 baris terhapus & GL persis 4 baris realtime."); await pool.close(); process.exit(1);
  }
  if (!EXECUTE) { console.log("DRY RUN selesai. Jalankan ulang dengan --execute untuk menulis."); await pool.close(); return; }

  fs.mkdirSync(path.dirname(SNAP), { recursive: true });
  fs.writeFileSync(SNAP, JSON.stringify(gl, null, 2));
  console.log("Snapshot ditulis:", SNAP);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const del = await new sql.Request(tx).input("v", sql.VarChar(64), SI).input("id", sql.VarChar(16), GL_ID).query(
      `DELETE FROM GeneralLedger WHERE VoucherNo=@v AND [Type]='SALESINVOICE' AND ID=@id AND LEFT(ISNULL(Memo,''),18)='[DASHPMP-REALTIME]'`);
    if (del.rowsAffected[0] !== 4) throw new Error(`rowsAffected=${del.rowsAffected[0]} (harapan 4)`);
    await tx.commit();
    console.log("4 baris jurnal yatim dihapus.");
  } catch (e) { await tx.rollback(); console.error("GAGAL (rollback):", e); await pool.close(); process.exit(1); }
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
