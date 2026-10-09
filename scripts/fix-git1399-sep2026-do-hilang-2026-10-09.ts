import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Koreksi B GIT-1399 September 2026: 14 DeliveryOrder aktif (14-22 Sep, Jadwal)
// yang SI-nya sudah mengkredit 1399 tapi jurnal DO-nya (Dr 1399 / Cr 14013)
// tidak ada sama sekali (selisih Rp 78.047,25). Diposting lewat engine yang
// SAMA dengan tombol "Proses" (postBacklogForDate: applock, 1 transaksi per
// dokumen, tercatat di DashboardGLPostingBackfill) -- bukan INSERT manual.
// Pagar: pratinjau (computeBacklogForDate, read-only) HARUS persis berisi 14
// DO ini dan tidak ada dokumen lain; kalau tidak, ABORT sebelum menulis.
// Default = DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-git1399-sep2026-do-hilang-2026-10-09.ts

const EXECUTE = process.argv.includes("--execute");
const AKUN_PENCATAT = 2; // Super Administrator -- sama dgn run skrip backfill 21-23 Sep
const OUT = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-09-git1399-sep2026-do-hilang-posted.json");

const NOMOR = [2050, 2287, 2434, 2435, 2436, 2437, 2507, 2678, 2679, 2779, 2806, 2807, 3398, 3399];
const EXPECTED = new Set(NOMOR.map((n) => `MKE/DO/${String(n).padStart(6, "0")}/2026-09/003/001`));
const TANGGAL = ["2026-09-14", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-22"];
const EXPECTED_DEBIT_1399 = 78047.249412;

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT @@SERVERNAME AS s, DB_NAME() AS d`)).recordset[0] as { s: string; d: string };
  console.log("DB:", ident.s, ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const rencana: { tanggal: string; voucherNo: string; debit1399: number }[] = [];
  for (const tgl of TANGGAL) {
    const r = await computeBacklogForDate(tgl);
    const lain = r.postable.filter((p) => p.docType !== "DELIVERYORDER" || !EXPECTED.has(p.voucherNo));
    console.log(tgl, "postable:", r.postable.length, "skipped:", r.skipped.length, "| di luar 14 DO:", lain.length);
    if (lain.length > 0) {
      console.error("ABORT: ada dokumen lain yang akan ikut terposting:", lain.map((p) => `${p.docType} ${p.voucherNo}`));
      await pool.close();
      process.exit(1);
    }
    for (const p of r.postable) {
      const d = p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.debit, 0);
      rencana.push({ tanggal: tgl, voucherNo: p.voucherNo, debit1399: d });
    }
  }
  const ditemukan = new Set(rencana.map((x) => x.voucherNo));
  const hilang = [...EXPECTED].filter((v) => !ditemukan.has(v));
  const total = rencana.reduce((s, x) => s + x.debit1399, 0);
  console.log(`Rencana: ${rencana.length} DO, total debit 1399 = ${total.toFixed(6)} (harapan ${EXPECTED_DEBIT_1399})`);
  if (hilang.length > 0 || rencana.length !== 14 || Math.abs(total - EXPECTED_DEBIT_1399) > 0.01) {
    console.error("ABORT: rencana tidak persis 14 DO yang dimaksud. Tidak ditemukan:", hilang);
    await pool.close();
    process.exit(1);
  }
  if (!EXECUTE) { console.log("DRY RUN selesai. Jalankan ulang dengan --execute untuk menulis."); await pool.close(); return; }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT }, null, 2));
  console.log("Rencana ditulis (trackback):", OUT);

  const hasil: unknown[] = [];
  for (const tgl of TANGGAL) {
    const r = await postBacklogForDate(tgl, AKUN_PENCATAT);
    console.log(tgl, `posted=${r.jumlahPosted} gagal=${r.jumlahGagal}`);
    hasil.push({ tanggal: tgl, hasilPerDokumen: r.hasilPerDokumen });
    if (r.jumlahGagal > 0) { console.error("Ada yang GAGAL:", JSON.stringify(r.hasilPerDokumen)); break; }
  }
  fs.writeFileSync(OUT, JSON.stringify({ rencana, akunPencatat: AKUN_PENCATAT, hasil }, null, 2));

  const net = (await pool.request().query(
    `SELECT SUM(Debit-Credit) AS Net FROM GeneralLedger WITH (NOLOCK) WHERE ChartOfAccountID='01129' AND TransDate >= '2026-09-01'`
  )).recordset[0] as { Net: number };
  console.log("Net 1399 sejak 1 Sep 2026 sekarang:", net.Net);
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
