import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Posting ulang 9 jurnal DO yang HILANG (30 Sep / 1 Okt 2026) -- penyebab terbukti 26 Okt: jurnal dashboard DO
// ber-ID MAX+1 ikut terhapus saat ERP membuat DeliveryOrder baru ber-ID sama (Type DELIVERYORDER).
// Langkah (--execute): (1) posting lewat engine (postBacklogForDate + filter voucher); (2) ubah ID jurnal baru menjadi
// DeliveryOrderID dokumennya sendiri agar TIDAK bisa bentrok lagi dengan DO baru ERP dan diganti benar saat ERP memposting.
// Pagar: tepat 9 DO, total debit 1399 = 31.378,611753, 0 baris jurnal DO sebelumnya, ID tujuan (Type DELIVERYORDER)
// belum dipakai baris lain. Default DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-pendapatan-sep2026-item0112-2026-10-22.ts docs/data-fixes/2026-10-26-git1399-do-sep30b-posted.json
//   (menghapus jurnal backfill voucher-voucher itu, apa pun ID-nya, beserta catatan auditnya)

const EXECUTE = process.argv.includes("--execute");
const AKUN_PENCATAT = 2;
const OUT = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-26-git1399-do-sep30b-posted.json");
const NOMOR = [4857, 4858, 4859, 4860, 4861, 4862, 4876, 4877, 4988];
const DO_SET = new Set(NOMOR.map((n) => `MKE/DO/${String(n).padStart(6, "0")}/2026-09/003/001`));
const EXPECTED_DEBIT = 31378.611753;

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  // tanggal DO -> kumpulkan rencana dari tiap tanggal terkait (30 Sep dan 1 Okt)
  const rencana: { tanggal: string; voucherNo: string; documentId: string; debit1399: number }[] = [];
  const diabaikan: string[] = [];
  for (const tgl of ["2026-09-30", "2026-10-01"]) {
    const r = await computeBacklogForDate(tgl);
    for (const p of r.postable) {
      if (p.docType === "DELIVERYORDER" && DO_SET.has(p.voucherNo)) {
        rencana.push({ tanggal: tgl, voucherNo: p.voucherNo, documentId: p.documentId,
          debit1399: p.lines.filter((l) => l.accountNo === "1399").reduce((s, l) => s + l.debit, 0) });
      } else diabaikan.push(`${p.docType[0]} ${p.voucherNo}`);
    }
    console.log(tgl, "postable:", r.postable.length, "| skipped:", r.skipped.length);
  }
  const total = rencana.reduce((s, x) => s + x.debit1399, 0);
  for (const x of rencana) console.log("  ", x.tanggal, x.voucherNo, "docId", x.documentId, x.debit1399.toFixed(6));
  console.log("Diabaikan:", diabaikan.length ? diabaikan : "-");
  console.log(`Rencana: ${rencana.length} DO | total debit 1399 ${total.toFixed(6)} (harapan ${EXPECTED_DEBIT})`);

  // keadaan awal: 0 jurnal DO utk 9 voucher; ID tujuan belum dipakai
  const req = pool.request();
  const ph = [...DO_SET].map((v, i) => { req.input(`v${i}`, sql.VarChar(64), v); return `@v${i}`; });
  const sebelum = (await req.query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE [Type]='DELIVERYORDER' AND VoucherNo IN (${ph.join(",")})`)).recordset[0].n as number;
  const req2 = pool.request();
  const ph2 = rencana.map((x, i) => { req2.input(`d${i}`, sql.VarChar(16), x.documentId); return `@d${i}`; });
  const bentrok = ph2.length === 0 ? 0 : (await req2.query(`SELECT COUNT(*) AS n FROM GeneralLedger WHERE [Type]='DELIVERYORDER' AND ID IN (${ph2.join(",")})`)).recordset[0].n as number;
  console.log(`Baris jurnal DO yang sudah ada utk 9 voucher: ${sebelum} (harus 0) | baris (Type DELIVERYORDER) ber-ID tujuan: ${bentrok} (harus 0)`);
  // Penggantian ID jurnal ke DeliveryOrderID DIMATIKAN (ID tujuan sudah dipakai 6 jurnal DO lain, 26 Okt);
  // hanya aktif bila --rekey diberikan DAN tidak ada bentrok.
  const REKEY = process.argv.includes("--rekey");
  if (rencana.length !== 9 || Math.abs(total - EXPECTED_DEBIT) > 0.01 || sebelum !== 0 || (REKEY && bentrok !== 0)) {
    console.error("ABORT: rencana tidak persis 9 DO / nominal / keadaan awal / ID tujuan tidak sesuai."); await pool.close(); process.exit(1);
  }
  if (!EXECUTE) { console.log("DRY RUN selesai. Jalankan ulang dengan --execute untuk menulis."); await pool.close(); return; }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ keadaanSebelum: { barisJurnalDO: sebelum }, rencana: rencana.map((x) => ({ ...x, docType: "DELIVERYORDER" })), akunPencatat: AKUN_PENCATAT }, null, 2));
  console.log("Rencana (trackback) ditulis:", OUT);

  // (1) posting lewat engine
  const hasil: unknown[] = [];
  for (const tgl of [...new Set(rencana.map((x) => x.tanggal))]) {
    const r = await postBacklogForDate(tgl, AKUN_PENCATAT, DO_SET);
    console.log(tgl, `posted=${r.jumlahPosted} gagal=${r.jumlahGagal}`);
    hasil.push({ tanggal: tgl, hasilPerDokumen: r.hasilPerDokumen });
    if (r.jumlahGagal > 0) { console.error("Ada yang GAGAL:", JSON.stringify(r.hasilPerDokumen)); break; }
  }

  // (2) ubah ID jurnal baru -> DeliveryOrderID dokumennya
  const idLama: { voucher: string; idLama: string; idBaru: string }[] = [];
  if (!REKEY) console.log("Penggantian ID dilewati (tanpa --rekey): jurnal baru tetap ber-ID MAX+1.");
  const tx = new sql.Transaction(pool);
  if (REKEY) await tx.begin();
  try {
    if (!REKEY) throw new Error("__LEWATI__");
    for (const x of rencana) {
      const baris = (await new sql.Request(tx).input("v", sql.VarChar(64), x.voucherNo).query(
        `SELECT DISTINCT ID FROM GeneralLedger WHERE [Type]='DELIVERYORDER' AND VoucherNo=@v AND LEFT(ISNULL(Memo,''),19)='[DASHPMP-BACKFILL] '`)).recordset as { ID: string }[];
      if (baris.length !== 1) throw new Error(`${x.voucherNo}: ID jurnal baru ${baris.length} (harapan 1)`);
      const lama = baris[0].ID;
      const pakai = (await new sql.Request(tx).input("id", sql.VarChar(16), x.documentId).query(
        `SELECT COUNT(*) AS n FROM GeneralLedger WHERE [Type]='DELIVERYORDER' AND ID=@id`)).recordset[0].n as number;
      if (pakai !== 0) throw new Error(`${x.voucherNo}: ID tujuan ${x.documentId} sudah dipakai`);
      const up = await new sql.Request(tx).input("v", sql.VarChar(64), x.voucherNo).input("lama", sql.VarChar(16), lama).input("baru", sql.VarChar(16), x.documentId)
        .query(`UPDATE GeneralLedger SET ID=@baru WHERE [Type]='DELIVERYORDER' AND VoucherNo=@v AND ID=@lama AND LEFT(ISNULL(Memo,''),19)='[DASHPMP-BACKFILL] '`);
      if (up.rowsAffected[0] !== 2) throw new Error(`${x.voucherNo}: baris diubah ${up.rowsAffected[0]} (harapan 2)`);
      await new sql.Request(tx).input("v", sql.VarChar(64), x.voucherNo).input("lama", sql.VarChar(16), lama).input("baru", sql.VarChar(16), x.documentId).query(`
        UPDATE d SET d.GeneralLedgerID=@baru FROM DashboardGLPostingBackfillDetail d JOIN DashboardGLPostingBackfill b ON b.BackfillID=d.BackfillID
        WHERE b.VoucherNo=@v AND b.DocType='DELIVERYORDER' AND d.GeneralLedgerID=@lama`);
      idLama.push({ voucher: x.voucherNo, idLama: lama, idBaru: x.documentId });
    }
    await tx.commit();
    console.log("ID jurnal diubah menjadi DeliveryOrderID:", idLama.length, "voucher");
  } catch (e) {
    if (e instanceof Error && e.message === "__LEWATI__") { /* tanpa --rekey: tidak ada transaksi */ }
    else { await tx.rollback(); console.error("GAGAL ubah ID (rollback; jurnal tetap ber-ID MAX+1):", e); }
  }
  fs.writeFileSync(OUT, JSON.stringify({ keadaanSebelum: { barisJurnalDO: sebelum }, rencana: rencana.map((x) => ({ ...x, docType: "DELIVERYORDER" })), akunPencatat: AKUN_PENCATAT, hasil, idLama }, null, 2));

  const ukur = (await pool.request().query(`
    SELECT SUM(g.Debit-g.Credit) AS saldo_30sep FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate<'2026-10-01'`)).recordset[0];
  console.log("Setelah posting:", JSON.stringify(ukur));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
