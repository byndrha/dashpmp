import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";
import { acquireGLPostingApplock, warmItemAccountMappingCache } from "../src/lib/queries/gl-posting-backfill";

// Lengkapi GIT 1399 Oktober 2026 sebelum closing ERP, meniru pola jurnal ERP (tervalidasi thd Sep: SR 78/78, SI 4.979/4.990):
//   A. SalesReturn Okt aktif tanpa jurnal  -> Dr Persediaan / Cr 1399 = SUM(Retur x Average), ID = SalesReturnID, Type SALESRETURN.
//   B. SalesInvoice Okt aktif yg jurnalnya tak punya baris 1399 (SI buatan ERP 2 baris, atau SI nilai 0 tanpa jurnal)
//      -> Dr HPP / Cr 1399 = SUM(Qty x Average), ID = SalesInvoiceID (sama dgn jurnal ERP-nya) supaya closing ERP menggantinya bersih.
// Average Okt belum ada (closing belum jalan) -> rata-rata bulan terakhir (Sep), Memo [PROVISIONAL]. Baris biaya 0 (item 0112) dilewati.
// Dokumen yg DO induknya tidak aktif / tak punya jurnal DO dilewati (dilaporkan).
// Pagar: --jurnal=<N> --net1399=<Rp> harus sama dgn dry-run. 1 transaksi + applock. Default DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-git1399-okt2026-sr-si-hpp-2026-11-03.ts (hapus baris ber-Memo TAG pada (Type, VoucherNo, ID) di rencana).

const EXECUTE = process.argv.includes("--execute");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const HARI = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
export const TAG = "[DASHPMP-BACKFILL] 2026-11-03 GIT-OKT [PROVISIONAL]";
const RENCANA = path.join(__dirname, "..", "docs", "data-fixes", `${HARI}-git1399-okt2026-sr-si-hpp-posted.json`);

type Baris = { accountNo: string; debit: number; credit: number };
type Jurnal = {
  kelas: "SR" | "SI"; type: "SALESRETURN" | "SALESINVOICE"; id: string; voucherNo: string; transDate: Date;
  branchId: string; departmentId: string; businessPartnerId: string | null; currencyId: string; rate: number; biaya: number; lines: Baris[];
};

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);
  const q = async <T>(s: string) => (await pool.request().query(s)).recordset as T[];

  const mapping = await warmItemAccountMappingCache(pool);
  const avgRows = await q<{ ItemID: string; Average: number }>(`
    SELECT a.ItemID, a.Average FROM ItemAverage a
    WHERE a.IsDeleted=0 AND a.Year=2026 AND a.Month=(SELECT MAX(b.Month) FROM ItemAverage b WHERE b.IsDeleted=0 AND b.Year=2026 AND b.Month<=10)`);
  const avg = new Map(avgRows.map((r) => [r.ItemID, r.Average]));
  const bulanAvg = (await q<{ m: number }>(`SELECT MAX(Month) m FROM ItemAverage WHERE IsDeleted=0 AND Year=2026 AND Month<=10`))[0].m;
  console.log("ItemAverage dipakai: bulan", bulanAvg, "2026");
  if (bulanAvg === 10) throw new Error("ItemAverage Oktober sudah ada (closing ERP sudah jalan?) -- tinjau ulang sebelum memakai skrip ini");

  const doBerjurnal = new Set((await q<{ id: string }>(`
    SELECT d.DeliveryOrderID id FROM DeliveryOrder d WHERE d.IsDeleted=0 AND d.TransDate>='2026-09-01'
      AND EXISTS (SELECT 1 FROM GeneralLedger g WHERE g.VoucherNo=d.VoucherNo AND g.[Type]='DELIVERYORDER')`)).map((r) => r.id));

  const rencana: Jurnal[] = [];
  const dilewati: string[] = [];

  // A. SalesReturn tanpa jurnal
  const srs = await q<{ id: string; v: string; t: Date; doId: string; br: string; dp: string; bp: string | null; cur: string; rate: number }>(`
    SELECT r.SalesReturnID id, r.VoucherNo v, r.TransDate t, REPLACE(r.DeliveryOrderID,'''','') doId, r.BranchID br, r.DepartmentID dp,
           r.BusinessPartnerID bp, ISNULL(r.CurrencyID,'') cur, ISNULL(r.Rate,1) rate
    FROM SalesReturn r WHERE r.IsDeleted=0 AND r.TransDate>='2026-10-01' AND r.TransDate<'2026-11-01'
      AND NOT EXISTS (SELECT 1 FROM GeneralLedger g WHERE g.VoucherNo=r.VoucherNo AND g.[Type]='SALESRETURN')
      AND NOT EXISTS (SELECT 1 FROM GeneralLedger g WHERE g.ID=r.SalesReturnID AND g.[Type]='SALESRETURN')`);
  const srDet = await q<{ id: string; ItemID: string; Retur: number | null }>(`
    SELECT d.SalesReturnID id, d.ItemID, d.Retur FROM SalesReturnDetail d JOIN SalesReturn r ON r.SalesReturnID=d.SalesReturnID
    WHERE r.IsDeleted=0 AND r.TransDate>='2026-10-01' AND r.TransDate<'2026-11-01'`);
  for (const r of srs) {
    if (!doBerjurnal.has(r.doId)) { dilewati.push(`SR ${r.v}: DO induk ${r.doId} tidak aktif / tanpa jurnal DO`); continue; }
    const perAkun = new Map<string, number>();
    let gagal = "";
    for (const d of srDet.filter((x) => x.id === r.id)) {
      const akun = mapping.get(d.ItemID), a = avg.get(d.ItemID);
      if (!akun || a === undefined) { gagal = `item ${d.ItemID} tanpa pemetaan/Average`; break; }
      perAkun.set(akun.persediaanAccountNo, (perAkun.get(akun.persediaanAccountNo) ?? 0) + (d.Retur ?? 0) * a);
    }
    if (gagal) { dilewati.push(`SR ${r.v}: ${gagal}`); continue; }
    const biaya = [...perAkun.values()].reduce((s, x) => s + x, 0);
    if (biaya < 0.005) { dilewati.push(`SR ${r.v}: biaya 0`); continue; }
    rencana.push({ kelas: "SR", type: "SALESRETURN", id: r.id, voucherNo: r.v, transDate: r.t, branchId: r.br, departmentId: r.dp,
      businessPartnerId: r.bp, currencyId: r.cur, rate: r.rate, biaya,
      lines: [...[...perAkun].map(([accountNo, x]) => ({ accountNo, debit: x, credit: 0 })), { accountNo: "1399", debit: 0, credit: biaya }] });
  }

  // B. SalesInvoice tanpa baris 1399
  const sis = await q<{ id: string; v: string; t: Date; doId: string; br: string; dp: string; bp: string | null; cur: string; rate: number; glId: string | null; glT: Date | null; nId: number }>(`
    SELECT s.SalesInvoiceID id, s.VoucherNo v, s.TransDate t, REPLACE(s.DeliveryOrderID,'''','') doId, s.BranchID br, s.DepartmentID dp,
           s.BusinessPartnerID bp, ISNULL(s.CurrencyID,'') cur, ISNULL(s.Rate,1) rate,
           (SELECT MIN(g.ID) FROM GeneralLedger g WHERE g.VoucherNo=s.VoucherNo AND g.[Type]='SALESINVOICE') glId,
           (SELECT MIN(g.TransDate) FROM GeneralLedger g WHERE g.VoucherNo=s.VoucherNo AND g.[Type]='SALESINVOICE') glT,
           (SELECT COUNT(DISTINCT g.ID) FROM GeneralLedger g WHERE g.VoucherNo=s.VoucherNo AND g.[Type]='SALESINVOICE') nId
    FROM SalesInvoice s WHERE s.IsDeleted=0 AND s.TransDate>='2026-10-01' AND s.TransDate<'2026-11-01'
      AND NOT EXISTS (SELECT 1 FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
                      WHERE g.VoucherNo=s.VoucherNo AND g.[Type]='SALESINVOICE' AND c.AccountNo='1399')`);
  const siDet = await q<{ id: string; ItemID: string; Qty: number }>(`
    SELECT d.SalesInvoiceID id, d.ItemID, d.Qty FROM SalesInvoiceDetail d JOIN SalesInvoice s ON s.SalesInvoiceID=d.SalesInvoiceID
    WHERE s.IsDeleted=0 AND s.TransDate>='2026-10-01' AND s.TransDate<'2026-11-01'`);
  for (const s of sis) {
    if (s.nId > 1) { dilewati.push(`SI ${s.v}: ${s.nId} ID jurnal berbeda (ganda?) -- tinjau manual`); continue; }
    if (s.glId && s.glId !== s.id) { dilewati.push(`SI ${s.v}: ID jurnal ${s.glId} != SalesInvoiceID ${s.id}`); continue; }
    if (!doBerjurnal.has(s.doId)) { dilewati.push(`SI ${s.v}: DO induk ${s.doId} tidak aktif / tanpa jurnal DO`); continue; }
    const perAkun = new Map<string, number>();
    let gagal = "";
    for (const d of siDet.filter((x) => x.id === s.id)) {
      const akun = mapping.get(d.ItemID), a = avg.get(d.ItemID);
      if (!akun || a === undefined) { gagal = `item ${d.ItemID} tanpa pemetaan/Average`; break; }
      perAkun.set(akun.hppAccountNo, (perAkun.get(akun.hppAccountNo) ?? 0) + d.Qty * a);
    }
    if (gagal) { dilewati.push(`SI ${s.v}: ${gagal}`); continue; }
    const biaya = [...perAkun.values()].reduce((x, y) => x + y, 0);
    if (biaya < 0.005) { dilewati.push(`SI ${s.v}: biaya 0`); continue; }
    rencana.push({ kelas: "SI", type: "SALESINVOICE", id: s.id, voucherNo: s.v, transDate: s.glT ?? s.t, branchId: s.br, departmentId: s.dp,
      businessPartnerId: s.bp, currencyId: s.cur, rate: s.rate, biaya,
      lines: [...[...perAkun].map(([accountNo, x]) => ({ accountNo, debit: x, credit: 0 })), { accountNo: "1399", debit: 0, credit: biaya }] });
  }

  const net = -rencana.reduce((s, j) => s + j.biaya, 0);
  const per = (k: string) => rencana.filter((j) => j.kelas === k);
  console.log(`A. SR   : ${per("SR").length} jurnal, kredit 1399 ${per("SR").reduce((s, j) => s + j.biaya, 0).toFixed(2)}`);
  console.log(`B. SI   : ${per("SI").length} jurnal, kredit 1399 ${per("SI").reduce((s, j) => s + j.biaya, 0).toFixed(2)}`);
  console.log(`Dilewati: ${dilewati.length}`); for (const d of dilewati) console.log("   -", d);
  const okt = (await q<{ s: number }>(`SELECT SUM(g.Debit-g.Credit) s FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01'`))[0].s;
  console.log(`Net 1399 Okt sekarang ${okt.toFixed(2)} -> perkiraan sesudah ${(okt + net).toFixed(2)}`);
  if (!EXECUTE) { console.log(`DRY RUN selesai. Untuk menulis: --execute --jurnal=${rencana.length} --net1399=${net.toFixed(2)}`); await pool.close(); process.exit(0); }
  if (Number(arg("jurnal")) !== rencana.length || Math.abs(Number(arg("net1399")) - net) > 0.01) {
    console.error(`ABORT: angka harapan tidak cocok (--jurnal=${arg("jurnal")} --net1399=${arg("net1399")}).`); await pool.close(); process.exit(1);
  }

  const coa = new Map((await q<{ AccountNo: string; ChartOfAccountID: string }>(`SELECT AccountNo, ChartOfAccountID FROM ChartOfAccount`)).map((r) => [r.AccountNo, r.ChartOfAccountID]));
  fs.mkdirSync(path.dirname(RENCANA), { recursive: true });
  fs.writeFileSync(RENCANA, JSON.stringify({ tag: TAG, rencana, dilewati }, null, 2));
  console.log("Rencana (trackback) ditulis:", RENCANA);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await acquireGLPostingApplock(tx);
    let n = 0;
    for (const j of rencana) {
      const cek = await new sql.Request(tx).input("t", sql.VarChar(20), j.type).input("v", sql.VarChar(64), j.voucherNo)
        .query(`SELECT COUNT(*) n FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE g.VoucherNo=@v AND g.[Type]=@t AND (c.AccountNo='1399' OR g.Memo=@t)`);
      if (j.kelas === "SI" && cek.recordset[0].n > 0) throw new Error(`${j.voucherNo} sudah punya baris 1399 (berubah sejak dry-run)`);
      for (const l of j.lines) {
        const coaId = coa.get(l.accountNo);
        if (!coaId) throw new Error(`akun ${l.accountNo} tidak ada`);
        await new sql.Request(tx)
          .input("id", sql.VarChar(16), j.id).input("br", sql.VarChar(16), j.branchId).input("dp", sql.VarChar(16), j.departmentId)
          .input("v", sql.VarChar(64), j.voucherNo).input("td", sql.DateTime, j.transDate).input("t", sql.VarChar(20), j.type)
          .input("coa", sql.VarChar(16), coaId).input("d", sql.Decimal(18, 6), l.debit).input("c", sql.Decimal(18, 6), l.credit)
          .input("m", sql.VarChar(255), TAG).input("bp", sql.VarChar(16), j.businessPartnerId).input("cur", sql.VarChar(16), j.currencyId)
          .input("rate", sql.Decimal(18, 6), j.rate)
          .query(`INSERT INTO GeneralLedger (ID, BranchID, DepartmentID, VoucherNo, TransDate, [Type], ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
                  VALUES (@id, @br, @dp, @v, @td, @t, @coa, @d, @c, @m, @bp, @cur, @rate)`);
        n++;
      }
    }
    await tx.commit();
    console.log(`${rencana.length} jurnal (${n} baris) ditulis.`);
  } catch (e) { await tx.rollback(); console.error("GAGAL (rollback):", e); await pool.close(); process.exit(1); }
  const sesudah = (await q<{ s: number }>(`SELECT SUM(g.Debit-g.Credit) s FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01'`))[0].s;
  console.log("Net 1399 Okt sesudah:", sesudah);
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
