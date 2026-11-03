import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Posting ulang (user 2 Nov): (a) jurnal DO dashboard yang HILANG (entri terakhir log pemantau) dan (b) SI/004321 yang belum terjurnal.
// Lewat engine yang SAMA dgn tombol "Proses" (postBacklogForDate) + filter voucher. Pagar: tiap DO terencana harus ada dan debit 1399-nya
// sama dgn debit yang tercatat di log pemantau; DO itu tak boleh punya jurnal DELIVERYORDER sama sekali; SI/004321 pendapatan = Netto.
// Default DRY RUN; --execute --jumlah=<N> (jumlah dokumen terencana dari dry-run). Revert: revert-pendapatan-sep2026-item0112-2026-10-22.ts <rencana.json>

const EXECUTE = process.argv.includes("--execute");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const AKUN_PENCATAT = 2;
const HARI = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const OUT = path.join(__dirname, "..", "docs", "data-fixes", `${HARI}-repost-hilang-okt-posted.json`);
const SI_BELUM = "MKE/SI/004321/2026-10/003/001";

async function main() {
  const log = fs.readFileSync(path.join(__dirname, "..", "docs", "data-fixes", "monitor", "log.jsonl"), "utf8").trim().split("\n");
  // SEMUA entri log pemantau (bukan hanya yang terakhir): voucher hilang unik, debit terakhir yang tercatat
  const perVoucher = new Map<string, { voucher: string; debit: number }>();
  for (const baris of log) for (const h of (JSON.parse(baris) as { hilang: { voucher: string; debit: number }[] }).hilang) perVoucher.set(h.voucher, h);
  // Tambahan manual di luar log pemantau: --tambah=<voucher DO> --debit=<debit 1399 yang diharapkan (= kredit SI-nya)>
  if (arg("tambah")) perVoucher.set(arg("tambah")!, { voucher: arg("tambah")!, debit: Number(arg("debit")) });
  const hilangSemua = [...perVoucher.values()];
  const pool = await getPool();
  console.log("DB:", (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0].d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)", "| voucher hilang unik di seluruh log:", hilangSemua.length);

  // tanggal tiap DO; DO yang sudah terhapus (yatim) dilewati, bukan abort
  const tanggal = new Map<string, string>();
  const hilang: { voucher: string; debit: number }[] = [];
  for (const h of hilangSemua) {
    const r = (await pool.request().input("v", sql.VarChar(64), h.voucher).query(`SELECT CONVERT(char(10),TransDate,120) AS td, IsDeleted FROM DeliveryOrder WHERE VoucherNo=@v ORDER BY IsDeleted`)).recordset as { td: string; IsDeleted: boolean }[];
    if (r.length === 0 || r[0].IsDeleted) { console.log("  DILEWATI (DO terhapus/tidak ada):", h.voucher); continue; }
    tanggal.set(h.voucher, r[0].td); hilang.push(h);
  }
  const voucherSet = new Set<string>(hilang.map((h) => h.voucher));
  // keadaan awal: DO hilang tak boleh punya jurnal
  const adaGL: string[] = [];
  for (const h of hilang) {
    const n = (await pool.request().input("v", sql.VarChar(64), h.voucher).query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE [Type]='DELIVERYORDER' AND VoucherNo=@v`)).recordset[0].n as number;
    if (n > 0) adaGL.push(h.voucher);
  }
  console.log("DO hilang yang ternyata sudah punya jurnal lagi (dilewati):", adaGL.length ? adaGL : "-");

  const rencana: { tanggal: string; docType: string; voucherNo: string; debit1399: number; pendapatan: number }[] = [];
  const tglList = [...new Set(tanggal.values())].sort();
  for (const tgl of tglList) {
    const r = await computeBacklogForDate(tgl);
    for (const p of r.postable) {
      if (!voucherSet.has(p.voucherNo) || adaGL.includes(p.voucherNo)) continue;
      rencana.push({ tanggal: tgl, docType: p.docType, voucherNo: p.voucherNo,
        debit1399: p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.debit, 0),
        pendapatan: p.lines.filter((l) => l.accountNo.startsWith("4")).reduce((s, l) => s + l.credit - l.debit, 0) });
    }
    for (const s of r.skipped.filter((x) => voucherSet.has(x.voucherNo))) console.log("  DI-SKIP ENGINE:", s.voucherNo, s.alasan);
  }
  for (const x of rencana) console.log("  ", x.tanggal, x.docType === "SALESINVOICE" ? "SI" : "DO", x.voucherNo, "debit1399", x.debit1399.toFixed(2), "pend", x.pendapatan.toFixed(0));
  const salah: string[] = [];
  for (const h of hilang) {
    if (adaGL.includes(h.voucher)) continue;
    const p = rencana.find((x) => x.voucherNo === h.voucher);
    if (!p) salah.push(`${h.voucher}: tidak terencana`);
    else if (Math.abs(p.debit1399 - h.debit) > 0.01) salah.push(`${h.voucher}: debit ${p.debit1399} != log ${h.debit}`);
  }
  console.log(`Rencana: ${rencana.length} dokumen | ketidaksesuaian: ${salah.length}`, salah);
  if (salah.length > 0) { console.error("ABORT: rencana tidak sesuai log pemantau."); await pool.close(); process.exit(1); }
  if (!EXECUTE) { console.log(`DRY RUN selesai. Untuk menulis: --execute --jumlah=${rencana.length}`); await pool.close(); return; }
  if (Number(arg("jumlah")) !== rencana.length) { console.error(`ABORT: --jumlah=${arg("jumlah")} != ${rencana.length}`); await pool.close(); process.exit(1); }

  fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT }, null, 2));
  console.log("Rencana (trackback) ditulis:", OUT);
  const izin = new Set(rencana.map((x) => x.voucherNo));
  const hasil: unknown[] = [];
  for (const tgl of [...new Set(rencana.map((x) => x.tanggal))].sort()) {
    const r = await postBacklogForDate(tgl, AKUN_PENCATAT, izin);
    console.log(tgl, `posted=${r.jumlahPosted} gagal=${r.jumlahGagal}`);
    hasil.push({ tanggal: tgl, hasilPerDokumen: r.hasilPerDokumen });
    if (r.jumlahGagal > 0) console.error("GAGAL:", JSON.stringify(r.hasilPerDokumen));
  }
  fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT, hasil }, null, 2));
  const ukur = (await pool.request().query(`
    SELECT (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01') AS pendapatan_okt,
           (SELECT SUM(Netto) FROM SalesInvoice WHERE IsDeleted=0 AND TransDate>='2026-10-01' AND TransDate<'2026-11-01') AS total_si_okt,
           (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399') AS saldo1399`)).recordset[0];
  console.log("Setelah posting:", JSON.stringify(ukur));
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
