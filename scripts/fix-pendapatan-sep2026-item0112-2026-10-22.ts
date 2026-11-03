import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Koreksi pendapatan September 2026 (22 Okt): 19 DO + 19 SI mitra 01343 yang
// terlewat engine karena item 0112 tak punya pemetaan akun. Setelah pemetaan
// 0112 := 0111 (buildItemAccountMapping), dokumen diposting lewat engine yang
// SAMA dgn tombol "Proses" (postBacklogForDate). Pagar: pratinjau 12-30 Sep
// HARUS hanya berisi 19 DO + 19 SI ini (+ DO/004673, koreksi 1399 yg diminta
// user); jika ada dokumen lain, ABORT sebelum menulis. Default DRY RUN.
// Revert: scripts/revert-pendapatan-sep2026-item0112-2026-10-22.ts

const EXECUTE = process.argv.includes("--execute");
const AKUN_PENCATAT = 2; // Super Administrator -- sama dgn koreksi 9 & 21 Okt
const OUT = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-22-pendapatan-sep2026-item0112-posted.json");

const DO_NOMOR = [1625, 1777, 1935, 2122, 2285, 2461, 2608, 2780, 2967, 3140, 3314, 3477, 3649, 3820, 4000, 4188, 4399, 4590, 4731];
const SI_NOMOR = [1639, 1794, 1951, 2142, 2304, 2481, 2632, 2809, 2998, 3170, 3365, 3530, 3704, 3876, 4063, 4252, 4464, 4660, 4811];
const v = (jenis: string, n: number) => `MKE/${jenis}/${String(n).padStart(6, "0")}/2026-09/003/001`;
const DO_SET = new Set(DO_NOMOR.map((n) => v("DO", n)));
const SI_SET = new Set(SI_NOMOR.map((n) => v("SI", n)));
const TANGGAL = Array.from({ length: 19 }, (_, i) => `2026-09-${String(12 + i).padStart(2, "0")}`);
const EXPECTED_PENDAPATAN = 4_800_000;

type Rencana = { tanggal: string; docType: string; voucherNo: string; pendapatan: number; debit1399: number; kredit1399: number };

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const rencana: Rencana[] = [];
  for (const tgl of TANGGAL) {
    const r = await computeBacklogForDate(tgl);
    const boleh = (p: { docType: string; voucherNo: string }) =>
      (p.docType === "DELIVERYORDER" && DO_SET.has(p.voucherNo)) || (p.docType === "SALESINVOICE" && SI_SET.has(p.voucherNo));
    // Keputusan user 22 Okt: pasangan Rp 0 mitra 01580 (item 0112) DIABAIKAN, tidak diposting.
    const diabaikan = r.postable.filter((p) => !boleh(p));
    console.log(tgl, "postable:", r.postable.length, "skipped:", r.skipped.length, "| diabaikan (bukan 19 mitra 01343):", diabaikan.map((p) => p.voucherNo));
    for (const p of r.postable.filter(boleh)) {
      rencana.push({
        tanggal: tgl, docType: p.docType, voucherNo: p.voucherNo,
        pendapatan: p.lines.filter((l) => l.accountNo.startsWith("4")).reduce((s, l) => s + l.credit - l.debit, 0),
        debit1399: p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.debit, 0),
        kredit1399: p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.credit, 0),
      });
    }
  }
  const ditemukanDO = new Set(rencana.filter((x) => x.docType === "DELIVERYORDER").map((x) => x.voucherNo));
  const ditemukanSI = new Set(rencana.filter((x) => x.docType === "SALESINVOICE").map((x) => x.voucherNo));
  const hilangDO = [...DO_SET].filter((x) => !ditemukanDO.has(x));
  const hilangSI = [...SI_SET].filter((x) => !ditemukanSI.has(x));
  const pend = rencana.reduce((s, x) => s + x.pendapatan, 0);
  const deb = rencana.reduce((s, x) => s + x.debit1399, 0);
  const kre = rencana.reduce((s, x) => s + x.kredit1399, 0);
  console.log(`Rencana: ${rencana.length} dokumen | DO ${ditemukanDO.size} SI ${ditemukanSI.size} | pendapatan 4xxx = ${pend.toFixed(2)} (harapan ${EXPECTED_PENDAPATAN})`);
  console.log(`1399: debit ${deb.toFixed(2)} kredit ${kre.toFixed(2)} net ${(deb - kre).toFixed(2)}`);
  for (const x of rencana) console.log("  ", x.tanggal, x.docType, x.voucherNo, "pend", x.pendapatan.toFixed(0), "d1399", x.debit1399.toFixed(2), "k1399", x.kredit1399.toFixed(2));
  if (hilangDO.length || hilangSI.length || Math.abs(pend - EXPECTED_PENDAPATAN) > 1) {
    console.error("ABORT: rencana tidak persis 19 DO + 19 SI. Hilang DO:", hilangDO, "SI:", hilangSI);
    await pool.close(); process.exit(1);
  }
  if (!EXECUTE) { console.log("DRY RUN selesai. Jalankan ulang dengan --execute untuk menulis."); await pool.close(); return; }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT }, null, 2));
  console.log("Rencana ditulis (trackback):", OUT);

  const hasil: unknown[] = [];
  for (const tgl of TANGGAL) {
    const ada = rencana.some((x) => x.tanggal === tgl);
    if (!ada) continue;
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
