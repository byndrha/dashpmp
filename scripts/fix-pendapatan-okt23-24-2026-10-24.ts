import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Posting DO + SI tanggal 23 & 24 Okt 2026 yang belum terjurnal (disetujui user 24 Okt), KECUALI
// pasangan Rp 0 mitra 01580. Lewat engine yang SAMA dgn tombol "Proses" (postBacklogForDate) + filter voucher.
// Pagar: tiap SI terencana punya pendapatan 4xxx = Netto di DB; jumlah SI = jumlah DO terencana; net 1399 = 0;
// pada --execute, jumlah SI & total pendapatan HARUS sama dgn --si=<N> --pendapatan=<Rp> (hasil dry-run).
// Default DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-pendapatan-sep2026-item0112-2026-10-22.ts docs/data-fixes/2026-10-24-pendapatan-okt23-24-posted.json

const EXECUTE = process.argv.includes("--execute");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const AKUN_PENCATAT = 2;
const MITRA_DIKECUALIKAN = "01580";
const TANGGAL = ["2026-10-23", "2026-10-24"];
const OUT = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-24-pendapatan-okt23-24-posted.json");

type Rencana = { tanggal: string; docType: string; voucherNo: string; mitra: string | null; pendapatan: number; net1399: number };

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const netto = new Map<string, number>(
    ((await pool.request().query(`SELECT VoucherNo, Netto FROM SalesInvoice WHERE IsDeleted=0 AND TransDate>='2026-10-23' AND TransDate<'2026-10-25'`)).recordset as { VoucherNo: string; Netto: number }[])
      .map((r) => [r.VoucherNo, r.Netto])
  );

  const rencana: Rencana[] = [];
  const diabaikan: string[] = [];
  const izin = new Set<string>();
  for (const tgl of TANGGAL) {
    const r = await computeBacklogForDate(tgl);
    for (const p of r.postable) {
      if (p.businessPartnerId === MITRA_DIKECUALIKAN) { diabaikan.push(`${p.docType[0]} ${p.voucherNo}`); continue; }
      izin.add(p.voucherNo);
      rencana.push({
        tanggal: tgl, docType: p.docType, voucherNo: p.voucherNo, mitra: p.businessPartnerId,
        pendapatan: p.lines.filter((l) => l.accountNo.startsWith("4")).reduce((s, l) => s + l.credit - l.debit, 0),
        net1399: p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.debit - l.credit, 0),
      });
    }
    console.log(tgl, "postable:", r.postable.length, "| skipped:", r.skipped.length);
  }
  const siR = rencana.filter((x) => x.docType === "SALESINVOICE");
  const doR = rencana.filter((x) => x.docType === "DELIVERYORDER");
  const pend = siR.reduce((s, x) => s + x.pendapatan, 0);
  const net = rencana.reduce((s, x) => s + x.net1399, 0);
  const salah = siR.filter((x) => Math.abs(x.pendapatan - (netto.get(x.voucherNo) ?? NaN)) > 1);
  for (const x of rencana) console.log("  ", x.tanggal, x.docType === "SALESINVOICE" ? "SI" : "DO", x.voucherNo, "mitra", x.mitra, "pend", x.pendapatan.toFixed(0), "net1399", x.net1399.toFixed(2));
  console.log("Diabaikan (mitra 01580):", diabaikan.length, diabaikan);
  console.log(`Rencana: SI ${siR.length} | DO ${doR.length} | pendapatan ${pend.toFixed(2)} | net 1399 ${net.toFixed(2)} | SI nominal != Netto: ${salah.length}`);
  if (salah.length > 0 || siR.length === 0 || siR.length !== doR.length || Math.abs(net) > 0.5) {
    console.error("ABORT: rencana tidak konsisten (nominal/jumlah pasangan/net 1399)."); await pool.close(); process.exit(1);
  }
  if (!EXECUTE) {
    console.log(`DRY RUN selesai. Untuk menulis: --execute --si=${siR.length} --pendapatan=${pend}`);
    await pool.close(); return;
  }
  if (Number(arg("si")) !== siR.length || Math.abs(Number(arg("pendapatan")) - pend) > 1) {
    console.error(`ABORT: angka harapan (--si=${arg("si")} --pendapatan=${arg("pendapatan")}) tidak cocok dengan hitungan saat ini.`);
    await pool.close(); process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ rencana, diabaikan, akunPencatat: AKUN_PENCATAT }, null, 2));
  console.log("Rencana (trackback) ditulis:", OUT);
  const hasil: unknown[] = [];
  for (const tgl of TANGGAL) {
    if (!rencana.some((x) => x.tanggal === tgl)) continue;
    const r = await postBacklogForDate(tgl, AKUN_PENCATAT, izin);
    console.log(tgl, `posted=${r.jumlahPosted} gagal=${r.jumlahGagal}`);
    hasil.push({ tanggal: tgl, hasilPerDokumen: r.hasilPerDokumen });
    fs.writeFileSync(OUT, JSON.stringify({ rencana, diabaikan, akunPencatat: AKUN_PENCATAT, hasil }, null, 2));
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
