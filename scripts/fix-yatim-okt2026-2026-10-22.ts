import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Hapus jurnal yatim Oktober 2026 (disetujui user 22-23 Okt): jurnal [DASHPMP-REALTIME] milik SI yang
// sudah di-soft-delete ERP dan tidak punya SI aktif ber-voucher sama.
// Angka harapan DIBERIKAN sebagai argumen (jumlah ini terus berubah selama ERP menghapus SI):
//   --voucher=<N> --pendapatan=<Rp>   (wajib saat --execute; tanpa argumen hanya mencetak hitungan saat ini)
// Pagar: jumlah voucher & total pendapatan 4001/4004 HARUS persis argumen; semua baris ber-memo realtime.
// Semua baris jurnal voucher itu (Type SALESINVOICE) disimpan ke snapshot lalu dihapus dalam 1 transaksi.
// Default DRY RUN; --execute untuk menulis. Revert: revert-yatim-okt2026-2026-10-22.ts

const EXECUTE = process.argv.includes("--execute");
const arg = (nama: string) => process.argv.find((a) => a.startsWith(`--${nama}=`))?.split("=")[1];
const EXPECTED_VOUCHER = arg("voucher") ? Number(arg("voucher")) : null;
const EXPECTED_PENDAPATAN = arg("pendapatan") ? Number(arg("pendapatan")) : null;
// Nama snapshot per hari agar trackback eksekusi sebelumnya (2026-10-23-...) tidak tertimpa.
const HARI = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const SNAP = path.join(__dirname, "..", "docs", "data-fixes", `${HARI}-yatim-okt2026-before.json`);

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const yatim = (await pool.request().query(`
    SELECT g.VoucherNo, SUM(g.Credit-g.Debit) AS pend
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE g.Type='SALESINVOICE' AND c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01'
      AND NOT EXISTS (SELECT 1 FROM SalesInvoice s WHERE s.VoucherNo=g.VoucherNo AND s.IsDeleted=0)
    GROUP BY g.VoucherNo`)).recordset as { VoucherNo: string; pend: number }[];
  const total = yatim.reduce((s, x) => s + x.pend, 0);
  console.log(`Voucher yatim saat ini: ${yatim.length} | pendapatan ${total}`);

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < yatim.length; i += 50) {
    const batch = yatim.slice(i, i + 50);
    const req = pool.request();
    const ph = batch.map((b, j) => { req.input(`v${j}`, sql.VarChar(64), b.VoucherNo); return `@v${j}`; });
    const r = await req.query(`SELECT * FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo IN (${ph.join(",")})`);
    rows.push(...(r.recordset as Record<string, unknown>[]));
  }
  // Hanya jurnal buatan dashboard ([DASHPMP-REALTIME] dari posting real-time, [DASHPMP-BACKFILL] dari tombol Proses)
  // yang boleh dihapus; jurnal bawaan ERP tidak pernah disentuh skrip ini.
  const bukanRealtime = rows.filter((r) => !String(r.Memo ?? "").startsWith("[DASHPMP-"));
  console.log(`Baris jurnal: ${rows.length} | bukan jurnal dashboard: ${bukanRealtime.length}`);
  if (bukanRealtime.length > 0) {
    console.error("ABORT: ada baris non-realtime pada voucher yatim:", bukanRealtime.slice(0, 5).map((r) => `${r.VoucherNo} ${r.ID}`));
    await pool.close(); process.exit(1);
  }
  if (!EXECUTE) { console.log("DRY RUN selesai. Untuk menulis: --execute --voucher=<N> --pendapatan=<Rp> sesuai angka di atas."); await pool.close(); return; }
  if (EXPECTED_VOUCHER === null || EXPECTED_PENDAPATAN === null || yatim.length !== EXPECTED_VOUCHER || Math.abs(total - EXPECTED_PENDAPATAN) > 1) {
    console.error(`ABORT: angka harapan (--voucher=${EXPECTED_VOUCHER} --pendapatan=${EXPECTED_PENDAPATAN}) tidak cocok dengan hitungan saat ini.`);
    await pool.close(); process.exit(1);
  }

  fs.mkdirSync(path.dirname(SNAP), { recursive: true });
  fs.writeFileSync(SNAP, JSON.stringify(rows, null, 2));
  console.log("Snapshot (trackback) ditulis:", SNAP);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    let terhapus = 0;
    for (let i = 0; i < yatim.length; i += 50) {
      const batch = yatim.slice(i, i + 50);
      const req = new sql.Request(tx);
      const ph = batch.map((b, j) => { req.input(`v${j}`, sql.VarChar(64), b.VoucherNo); return `@v${j}`; });
      const del = await req.query(
        `DELETE FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo IN (${ph.join(",")}) AND LEFT(ISNULL(Memo,''),9)='[DASHPMP-'`);
      terhapus += del.rowsAffected[0];
    }
    if (terhapus !== rows.length) throw new Error(`terhapus ${terhapus} != snapshot ${rows.length}`);
    await tx.commit();
    console.log(`${terhapus} baris jurnal yatim dihapus.`);
  } catch (e) { await tx.rollback(); console.error("GAGAL (rollback):", e); await pool.close(); process.exit(1); }

  const ukur = (await pool.request().query(`
    SELECT (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
             WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01') AS pendapatan_okt,
           (SELECT SUM(Netto) FROM SalesInvoice WHERE IsDeleted=0 AND TransDate>='2026-10-01' AND TransDate<'2026-11-01') AS total_si_okt,
           (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399') AS saldo1399`)).recordset[0];
  console.log("Setelah hapus:", JSON.stringify(ukur));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
