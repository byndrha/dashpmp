import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Posting ulang jurnal 3 DO 30 Sep 2026 (disetujui user 23 Okt): DO/004768, 004770, 004774 kehilangan
// seluruh jurnalnya (penyebab belum terbukti), sementara kredit 1399 SI/004848, 004850, 004854 masih ada
// (selisih GIT -Rp 21.469,58). Lewat engine yang SAMA dgn tombol "Proses" (postBacklogForDate) + filter voucher.
// Pagar: pratinjau tanggal itu, difilter ke 3 DO, HARUS persis 3 DO dan total debit 1399 = 21.469,576462;
// keadaan SEBELUM (0 baris jurnal DO) dicatat. Default DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-pendapatan-sep2026-item0112-2026-10-22.ts docs/data-fixes/2026-10-23-git1399-do-sep30-posted.json

const EXECUTE = process.argv.includes("--execute");
const AKUN_PENCATAT = 2;
const OUT = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-23-git1399-do-sep30-posted.json");
const TANGGAL = "2026-09-30";
const DO_SET = new Set([4768, 4770, 4774].map((n) => `MKE/DO/${String(n).padStart(6, "0")}/2026-09/003/001`));
const EXPECTED_DEBIT = 21469.576462;

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const r = await computeBacklogForDate(TANGGAL);
  const target = r.postable.filter((p) => p.docType === "DELIVERYORDER" && DO_SET.has(p.voucherNo));
  const diabaikan = r.postable.filter((p) => !(p.docType === "DELIVERYORDER" && DO_SET.has(p.voucherNo)));
  console.log(TANGGAL, "postable:", r.postable.length, "| target:", target.length, "| diabaikan:", diabaikan.map((p) => p.voucherNo));
  const rencana = target.map((p) => ({
    tanggal: TANGGAL, docType: p.docType, voucherNo: p.voucherNo, documentId: p.documentId,
    debit1399: p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.debit, 0),
  }));
  const total = rencana.reduce((s, x) => s + x.debit1399, 0);
  for (const x of rencana) console.log("  ", x.voucherNo, x.debit1399.toFixed(6));
  console.log(`Rencana: ${rencana.length} DO | total debit 1399 ${total.toFixed(6)} (harapan ${EXPECTED_DEBIT})`);

  const req = pool.request();
  const ph = [...DO_SET].map((v, i) => { req.input(`v${i}`, sql.VarChar(64), v); return `@v${i}`; });
  const sebelum = (await req.query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE [Type]='DELIVERYORDER' AND VoucherNo IN (${ph.join(",")})`)).recordset[0].n as number;
  console.log("Baris jurnal DO yang sudah ada utk 3 voucher:", sebelum, "(harus 0)");
  if (rencana.length !== 3 || Math.abs(total - EXPECTED_DEBIT) > 0.01 || sebelum !== 0) {
    console.error("ABORT: rencana tidak persis 3 DO / nominal / keadaan awal tidak sesuai."); await pool.close(); process.exit(1);
  }
  if (!EXECUTE) { console.log("DRY RUN selesai. Jalankan ulang dengan --execute untuk menulis."); await pool.close(); return; }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ keadaanSebelum: { barisJurnalDO: sebelum }, rencana, akunPencatat: AKUN_PENCATAT }, null, 2));
  console.log("Rencana (trackback) ditulis:", OUT);
  const hasil = await postBacklogForDate(TANGGAL, AKUN_PENCATAT, DO_SET);
  console.log(`posted=${hasil.jumlahPosted} gagal=${hasil.jumlahGagal}`);
  fs.writeFileSync(OUT, JSON.stringify({ keadaanSebelum: { barisJurnalDO: sebelum }, rencana, akunPencatat: AKUN_PENCATAT, hasil: hasil.hasilPerDokumen }, null, 2));
  if (hasil.jumlahGagal > 0) { console.error("Ada yang GAGAL:", JSON.stringify(hasil.hasilPerDokumen)); await pool.close(); process.exit(1); }

  const ukur = (await pool.request().query(`
    SELECT (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate<'2026-10-01') AS saldo_30sep`)).recordset[0];
  console.log("Setelah posting:", JSON.stringify(ukur));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
