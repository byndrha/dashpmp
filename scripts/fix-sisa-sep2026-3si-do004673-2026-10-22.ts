import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Koreksi sisa September 2026 (22 Okt, disetujui user), diposting lewat engine yang sama dgn tombol "Proses":
//  - DO/004414-16 + SI/004480-82 (28 Sep, pendapatan Rp 1.112.000)
//  - DO/004673 (29 Sep, debit 1399 Rp 6.606,02; SI/004743 sudah mengkredit tanpa pasangan)
// Pagar: pratinjau 28 & 29 Sep, difilter ke 7 voucher ini, HARUS persis 4 DO + 3 SI,
// pendapatan 4xxx = 1.112.000, net 1399 = +6.606,02. Dokumen lain (mis. pasangan 01580) DIABAIKAN.
// Default DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-pendapatan-sep2026-item0112-2026-10-22.ts <path file rencana .json>

const EXECUTE = process.argv.includes("--execute");
const AKUN_PENCATAT = 2;
const OUT = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-22-sisa-sep2026-3si-do004673-posted.json");
const v = (j: string, n: number) => `MKE/${j}/${String(n).padStart(6, "0")}/2026-09/003/001`;
const DO_SET = new Set([4414, 4415, 4416, 4673].map((n) => v("DO", n)));
const SI_SET = new Set([4480, 4481, 4482].map((n) => v("SI", n)));
const TANGGAL = ["2026-09-28", "2026-09-29"];

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const rencana: { tanggal: string; docType: string; voucherNo: string; pendapatan: number; net1399: number }[] = [];
  for (const tgl of TANGGAL) {
    const r = await computeBacklogForDate(tgl);
    const boleh = (p: { docType: string; voucherNo: string }) =>
      (p.docType === "DELIVERYORDER" && DO_SET.has(p.voucherNo)) || (p.docType === "SALESINVOICE" && SI_SET.has(p.voucherNo));
    console.log(tgl, "postable:", r.postable.length, "| diabaikan:", r.postable.filter((p) => !boleh(p)).map((p) => p.voucherNo));
    for (const p of r.postable.filter(boleh)) {
      rencana.push({
        tanggal: tgl, docType: p.docType, voucherNo: p.voucherNo,
        pendapatan: p.lines.filter((l) => l.accountNo.startsWith("4")).reduce((s, l) => s + l.credit - l.debit, 0),
        net1399: p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.debit - l.credit, 0),
      });
    }
  }
  const pend = rencana.reduce((s, x) => s + x.pendapatan, 0);
  const net = rencana.reduce((s, x) => s + x.net1399, 0);
  const nDO = rencana.filter((x) => x.docType === "DELIVERYORDER").length;
  const nSI = rencana.filter((x) => x.docType === "SALESINVOICE").length;
  for (const x of rencana) console.log("  ", x.tanggal, x.docType, x.voucherNo, "pend", x.pendapatan.toFixed(0), "net1399", x.net1399.toFixed(2));
  console.log(`Rencana: DO ${nDO} SI ${nSI} | pendapatan ${pend.toFixed(2)} (harapan 1112000) | net 1399 ${net.toFixed(2)} (harapan 6606.02)`);
  if (nDO !== 4 || nSI !== 3 || Math.abs(pend - 1_112_000) > 1 || Math.abs(net - 6606.023527) > 1) {
    console.error("ABORT: rencana tidak sesuai harapan."); await pool.close(); process.exit(1);
  }
  if (!EXECUTE) { console.log("DRY RUN selesai. Jalankan ulang dengan --execute untuk menulis."); await pool.close(); return; }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT }, null, 2));
  const hasil: unknown[] = [];
  for (const tgl of TANGGAL) {
    const r = await postBacklogForDate(tgl, AKUN_PENCATAT, new Set([...DO_SET, ...SI_SET]));
    console.log(tgl, `posted=${r.jumlahPosted} gagal=${r.jumlahGagal}`);
    hasil.push({ tanggal: tgl, hasilPerDokumen: r.hasilPerDokumen });
    fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT, hasil }, null, 2));
    if (r.jumlahGagal > 0) { console.error("Ada yang GAGAL:", JSON.stringify(r.hasilPerDokumen)); break; }
  }
  const ukur = (await pool.request().query(`
    SELECT (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
             WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-09-01' AND g.TransDate<'2026-10-01') AS pendapatan,
           (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
             WHERE c.AccountNo='1399' AND g.TransDate<'2026-10-01') AS saldo1399`)).recordset[0];
  console.log("Setelah posting:", JSON.stringify(ukur));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
