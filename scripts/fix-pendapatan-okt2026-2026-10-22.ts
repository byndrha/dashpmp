import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Posting SI Oktober 2026 yang belum punya jurnal pendapatan (disetujui user 22 Okt): 49 SI
// (SI mitra 01343 item 0111+0112, SI item 019 tgl 21-22 Okt) beserta DO induknya jika DO itu
// juga belum terposting. Lewat engine yang SAMA dgn tombol "Proses" (postBacklogForDate).
// Dikecualikan: SI/002749 & SI/003337 (Netto 0 tapi sudah ada GL) dan pasangan Rp 0 mitra 01580.
// Pagar: tiap SI terencana harus punya pendapatan 4xxx = Netto di DB; dokumen di luar daftar DIABAIKAN.
// Default DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-pendapatan-sep2026-item0112-2026-10-22.ts docs/data-fixes/2026-10-22-pendapatan-okt2026-posted.json

const EXECUTE = process.argv.includes("--execute");
const AKUN_PENCATAT = 2;
const OUT = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-22-pendapatan-okt2026-posted.json");
const si = (n: number, bln: string) => `MKE/SI/${String(n).padStart(6, "0")}/${bln}/003/001`;
const SI_NOMOR = [70, 251, 484, 669, 891, 1264, 1448, 1628, 1809, 2031, 2226, 2415, 2603, 2784, 2951, 3148, 3335, 3519, 3768, 3769, 3770, 3771,
  3773, 3649, 3952, 3803, 3804, 3805, 3806, 3807, 3808, 3809, 3811, 3810, 3812, 3813, 3814, 3815, 3816, 3817, 3818, 3819, 3820, 3821, 3822, 3838];
const SI_SET = new Set<string>([si(5041, "2026-09"), ...SI_NOMOR.map((n) => si(n, "2026-10"))]);
const TANGGAL = Array.from({ length: 22 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

type Rencana = { tanggal: string; docType: string; voucherNo: string; pendapatan: number; net1399: number };

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)", "| SI target:", SI_SET.size);
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const netto = new Map<string, number>(
    ((await pool.request().query(`SELECT VoucherNo, Netto FROM SalesInvoice WHERE IsDeleted=0 AND TransDate>='2026-10-01' AND TransDate<'2026-11-01'`)).recordset as { VoucherNo: string; Netto: number }[])
      .map((r) => [r.VoucherNo, r.Netto])
  );

  const rencana: Rencana[] = [];
  const skippedTarget: string[] = [];
  const doBoleh = new Set<string>();
  for (const tgl of TANGGAL) {
    const r = await computeBacklogForDate(tgl);
    const siTerencana = r.postable.filter((p) => p.docType === "SALESINVOICE" && SI_SET.has(p.voucherNo));
    for (const p of siTerencana) if (p.parentDoVoucherNo) doBoleh.add(p.parentDoVoucherNo);
    const boleh = (p: { docType: string; voucherNo: string }) =>
      (p.docType === "SALESINVOICE" && SI_SET.has(p.voucherNo)) || (p.docType === "DELIVERYORDER" && doBoleh.has(p.voucherNo));
    for (const s of r.skipped.filter((s) => s.docType === "SALESINVOICE" && SI_SET.has(s.voucherNo))) skippedTarget.push(`${s.voucherNo}: ${s.alasan}`);
    const diabaikan = r.postable.filter((p) => !boleh(p));
    console.log(tgl, "postable:", r.postable.length, "| terpilih:", r.postable.filter(boleh).length, "| diabaikan:", diabaikan.length);
    for (const p of r.postable.filter(boleh)) {
      rencana.push({
        tanggal: tgl, docType: p.docType, voucherNo: p.voucherNo,
        pendapatan: p.lines.filter((l) => l.accountNo.startsWith("4")).reduce((s, l) => s + l.credit - l.debit, 0),
        net1399: p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.debit - l.credit, 0),
      });
    }
  }
  const siRencana = rencana.filter((x) => x.docType === "SALESINVOICE");
  const siTidakAda = [...SI_SET].filter((v) => !siRencana.some((x) => x.voucherNo === v));
  const salah = siRencana.filter((x) => Math.abs(x.pendapatan - (netto.get(x.voucherNo) ?? NaN)) > 1);
  const pend = siRencana.reduce((s, x) => s + x.pendapatan, 0);
  const net = rencana.reduce((s, x) => s + x.net1399, 0);
  for (const x of rencana) console.log("  ", x.tanggal, x.docType, x.voucherNo, "pend", x.pendapatan.toFixed(0), "net1399", x.net1399.toFixed(2));
  console.log(`Rencana: SI ${siRencana.length}/${SI_SET.size} | DO ${rencana.length - siRencana.length} | pendapatan ${pend.toFixed(2)} | net 1399 ${net.toFixed(2)}`);
  console.log("SI target tidak terencana:", siTidakAda.length ? siTidakAda : "-");
  console.log("SI target di-skip engine:", skippedTarget.length ? skippedTarget : "-");
  console.log("SI nominal != Netto:", salah.length ? salah.map((x) => `${x.voucherNo} ${x.pendapatan} vs ${netto.get(x.voucherNo)}`) : "-");
  if (salah.length > 0 || siRencana.length === 0) { console.error("ABORT: nominal tidak cocok / rencana kosong."); await pool.close(); process.exit(1); }
  if (!EXECUTE) { console.log("DRY RUN selesai. Jalankan ulang dengan --execute untuk menulis."); await pool.close(); return; }
  if (siTidakAda.length > 0) { console.error("ABORT: sebagian SI target tidak terencana; periksa dry-run dulu."); await pool.close(); process.exit(1); }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT }, null, 2));
  const izin = new Set<string>([...SI_SET, ...doBoleh]);
  const hasil: unknown[] = [];
  for (const tgl of TANGGAL) {
    if (!rencana.some((x) => x.tanggal === tgl)) continue;
    const r = await postBacklogForDate(tgl, AKUN_PENCATAT, izin);
    console.log(tgl, `posted=${r.jumlahPosted} gagal=${r.jumlahGagal}`);
    hasil.push({ tanggal: tgl, hasilPerDokumen: r.hasilPerDokumen });
    fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT, hasil }, null, 2));
    if (r.jumlahGagal > 0) { console.error("Ada yang GAGAL:", JSON.stringify(r.hasilPerDokumen)); break; }
  }
  const ukur = (await pool.request().query(`
    SELECT (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
             WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01') AS pendapatan_okt,
           (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399') AS saldo1399`)).recordset[0];
  console.log("Setelah posting:", JSON.stringify(ukur));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
