import "dotenv/config";
import * as fs from "fs";
import { getPool, sql } from "../src/lib/db";

// VERIFIKASI READ-ONLY migrasi ID jurnal: bandingkan keadaan sekarang dengan snapshot.
// Pemakaian: npx tsx scripts/verifikasi-migrasi-id-jurnal.ts <snapshot.json>
type Item = { tipe: string; voucherNo: string; idLama: string; idBaru: string; baris: { coa: string; td: string; debit: number; kredit: number }[] };

async function main() {
  const berkas = process.argv.find((a) => a.endsWith(".json"));
  if (!berkas) throw new Error("Berikan path snapshot .json");
  const { jurnal } = JSON.parse(fs.readFileSync(berkas, "utf8")) as { jurnal: Item[] };
  const pool = await getPool();
  let ok = 0; const masalah: string[] = [];
  let debitSnap = 0, kreditSnap = 0, debitNow = 0, kreditNow = 0;
  for (const p of jurnal) {
    const sekarang = (await pool.request().input("v", sql.VarChar(64), p.voucherNo).input("t", sql.VarChar(20), p.tipe)
      .query(`SELECT ID, Debit, Credit, LEFT(ISNULL(Memo,''),9) AS memoAwal FROM GeneralLedger WHERE [Type]=@t AND VoucherNo=@v AND TransDate>='2026-08-20'`)).recordset as { ID: string; Debit: number; Credit: number; memoAwal: string }[];
    const idBaru = sekarang.filter((r) => r.ID === p.idBaru);
    const sisaLama = sekarang.filter((r) => r.ID !== p.idBaru);
    const dS = p.baris.reduce((s, b) => s + b.debit, 0), kS = p.baris.reduce((s, b) => s + b.kredit, 0);
    const dN = idBaru.reduce((s, r) => s + r.Debit, 0), kN = idBaru.reduce((s, r) => s + r.Credit, 0);
    debitSnap += dS; kreditSnap += kS; debitNow += dN; kreditNow += kN;
    if (idBaru.length === p.baris.length && sisaLama.length === 0 && Math.abs(dS - dN) < 0.01 && Math.abs(kS - kN) < 0.01 && idBaru.every((r) => r.memoAwal === "[DASHPMP-")) ok++;
    else masalah.push(`${p.tipe} ${p.voucherNo}: baris ID baru ${idBaru.length}/${p.baris.length}, sisa ID lain ${sisaLama.length}, debit ${dS}->${dN}, kredit ${kS}->${kN}`);
  }
  console.log(`Jurnal di snapshot: ${jurnal.length} | sesuai: ${ok} | bermasalah: ${masalah.length}`);
  for (const m of masalah.slice(0, 10)) console.log("  !", m);
  console.log(`Total debit snapshot ${debitSnap.toFixed(6)} vs sekarang ${debitNow.toFixed(6)} | kredit ${kreditSnap.toFixed(6)} vs ${kreditNow.toFixed(6)}`);

  // slot ID baru: tiap (Type, ID) hanya satu voucher
  const dobel = (await pool.request().query(`
    SELECT TOP 5 g.[Type], g.ID, COUNT(DISTINCT g.VoucherNo) n FROM GeneralLedger g
    WHERE g.TransDate >= '2026-08-20' AND g.[Type] IN ('DELIVERYORDER','SALESINVOICE') AND LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-'
    GROUP BY g.[Type], g.ID HAVING COUNT(DISTINCT g.VoucherNo) > 1`)).recordset;
  console.log("Slot (Type, ID) yang dipegang >1 voucher (jurnal dashboard):", dobel.length, JSON.stringify(dobel));
  const ukur = (await pool.request().query(`
    SELECT (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate<'2026-10-01') AS saldo_30sep,
           (SELECT SUM(g.Debit-g.Credit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate>='2026-10-01') AS net_okt,
           (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01') AS pendapatan_okt`)).recordset[0];
  console.log("Saldo/pendapatan sekarang:", JSON.stringify(ukur));
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
