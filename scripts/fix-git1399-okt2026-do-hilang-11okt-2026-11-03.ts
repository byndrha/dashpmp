import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Posting ulang 2 jurnal DO 11 Okt 2026 yang HILANG (bentrok ID) padahal SI-nya sudah mengkredit 1399.
// Lewat engine tombol "Proses" (postBacklogForDate) + filter voucher. Pagar: DO belum punya jurnal DELIVERYORDER,
// debit 1399 terencana = kredit 1399 SI-nya. Default DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-pendapatan-sep2026-item0112-2026-10-22.ts <rencana.json>

const EXECUTE = process.argv.includes("--execute");
const TGL = "2026-10-11";
const AKUN_PENCATAT = 2;
const SASARAN: Record<string, number> = {
  "MKE/DO/001925/2026-10/003/001": 660.602353,
  "MKE/DO/001930/2026-10/003/001": 2321.277152,
};
const OUT = path.join(__dirname, "..", "docs", "data-fixes", "2026-11-03-git1399-okt2026-do-hilang-11okt-posted.json");

async function main() {
  const pool = await getPool();
  console.log("DB:", (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0].d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  for (const v of Object.keys(SASARAN)) {
    const n = (await pool.request().input("v", sql.VarChar(64), v).query(`SELECT COUNT(*) n FROM GeneralLedger WHERE [Type]='DELIVERYORDER' AND VoucherNo=@v`)).recordset[0].n as number;
    if (n > 0) throw new Error(`${v} sudah punya jurnal DO`);
  }
  const r = await computeBacklogForDate(TGL);
  const rencana = r.postable.filter((p) => p.voucherNo in SASARAN).map((p) => ({
    voucherNo: p.voucherNo, docType: p.docType, debit1399: p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.debit, 0), lines: p.lines,
  }));
  for (const s of r.skipped.filter((x) => x.voucherNo in SASARAN)) console.log("  DI-SKIP ENGINE:", s.voucherNo, s.alasan);
  for (const x of rencana) console.log("  ", x.voucherNo, "debit1399", x.debit1399.toFixed(6), "harap", SASARAN[x.voucherNo]);
  const salah = Object.keys(SASARAN).filter((v) => { const p = rencana.find((x) => x.voucherNo === v); return !p || Math.abs(p.debit1399 - SASARAN[v]) > 0.01; });
  if (salah.length) { console.error("ABORT: tidak sesuai:", salah); await pool.close(); process.exit(1); }
  if (!EXECUTE) { console.log("DRY RUN selesai."); await pool.close(); process.exit(0); }
  fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT }, null, 2));
  const hasil = await postBacklogForDate(TGL, AKUN_PENCATAT, new Set(Object.keys(SASARAN)));
  console.log(`posted=${hasil.jumlahPosted} gagal=${hasil.jumlahGagal}`, JSON.stringify(hasil.hasilPerDokumen));
  fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT, hasil }, null, 2));
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
