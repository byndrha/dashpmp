import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Hapus jurnal dashboard GANDA pada voucher kembar SI Oktober 2026 (user 2 Nov: "perbaiki ketidaksesuaian").
// Kasus: ERP membuat ulang SI ber-voucher SAMA; jurnal ERP milik SI AKTIF benar (ID = SalesInvoiceID aktif, nilai = Netto),
// sedangkan jurnal dashboard milik SI TERHAPUS kembarannya tertinggal -> pendapatan terhitung dua kali.
// Pagar: hanya voucher dgn tepat 1 SI aktif; jurnal ERP semua ber-ID = ID SI aktif dan pendapatannya = Netto; jurnal yg dihapus
// SEMUA ber-memo [DASHPMP-] dan ber-ID != ID SI aktif; --voucher=<N> --pendapatan=<Rp> harus sama dgn dry-run.
// Semua baris jurnal yg dihapus disnapshot. Default DRY RUN; --execute untuk menulis.
// Revert: scripts/revert-ganda-kembar-okt2026-2026-11-02.ts <snapshot.json>

const EXECUTE = process.argv.includes("--execute");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const HARI = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const SNAP = path.join(__dirname, "..", "docs", "data-fixes", `${HARI}-ganda-kembar-okt2026-before.json`);

type Rev = { VoucherNo: string; ID: string; dash: number; pend: number };
type Doc = { id: string; voucherNo: string; terhapus: boolean; netto: number };

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  const rev = (await pool.request().query(`
    SELECT g.VoucherNo, g.ID, MAX(CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 1 ELSE 0 END) dash, SUM(g.Credit-g.Debit) pend
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE g.[Type]='SALESINVOICE' AND c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01'
    GROUP BY g.VoucherNo, g.ID`)).recordset as Rev[];
  const docs = (await pool.request().query(`SELECT SalesInvoiceID id, VoucherNo voucherNo, IsDeleted terhapus, Netto netto FROM SalesInvoice WHERE TransDate>='2026-10-01' AND TransDate<'2026-11-01'`)).recordset as Doc[];
  const perDoc = new Map<string, Doc[]>(); for (const d of docs) perDoc.set(d.voucherNo, [...(perDoc.get(d.voucherNo) ?? []), d]);
  const perRev = new Map<string, Rev[]>(); for (const r of rev) perRev.set(r.VoucherNo, [...(perRev.get(r.VoucherNo) ?? []), r]);

  const sasaran: { voucher: string; idHapus: string; pend: number }[] = [];
  for (const [v, rs] of perRev) {
    const aktif = (perDoc.get(v) ?? []).filter((d) => !d.terhapus);
    if (aktif.length !== 1) continue;
    const dashRs = rs.filter((r) => r.dash === 1), erpRs = rs.filter((r) => r.dash !== 1);
    if (dashRs.length === 0 || erpRs.length === 0) continue;
    const erpBenar = erpRs.every((r) => r.ID === aktif[0].id) && Math.abs(erpRs.reduce((s, r) => s + r.pend, 0) - aktif[0].netto) < 0.5;
    const dashBukanAktif = dashRs.every((r) => r.ID !== aktif[0].id);
    if (!erpBenar || !dashBukanAktif) { console.log("DILEWATI (tinjau manual):", v, JSON.stringify(rs)); continue; }
    for (const r of dashRs) sasaran.push({ voucher: v, idHapus: r.ID, pend: r.pend });
  }
  const totalPend = sasaran.reduce((s, x) => s + x.pend, 0);
  console.log(`Sasaran: ${sasaran.length} jurnal dashboard di ${new Set(sasaran.map((x) => x.voucher)).size} voucher | pendapatan berlebih ${totalPend}`);
  for (const x of sasaran) console.log("  ", x.voucher, "hapus ID", x.idHapus, "pendapatan", x.pend);

  // ambil seluruh baris yang akan dihapus (semua harus jurnal dashboard)
  const rows: Record<string, unknown>[] = [];
  for (const x of sasaran) {
    const r = await pool.request().input("v", sql.VarChar(64), x.voucher).input("id", sql.VarChar(16), x.idHapus)
      .query(`SELECT * FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo=@v AND ID=@id`);
    rows.push(...(r.recordset as Record<string, unknown>[]));
  }
  const bukanDash = rows.filter((r) => !String(r.Memo ?? "").startsWith("[DASHPMP-"));
  console.log(`Baris jurnal yang akan dihapus: ${rows.length} | bukan jurnal dashboard: ${bukanDash.length}`);
  if (bukanDash.length > 0 || sasaran.length === 0) { console.error("ABORT: ada baris non-dashboard / sasaran kosong."); await pool.close(); process.exit(1); }
  if (!EXECUTE) { console.log(`DRY RUN selesai. Untuk menulis: --execute --voucher=${new Set(sasaran.map((x) => x.voucher)).size} --pendapatan=${totalPend}`); await pool.close(); return; }
  if (Number(arg("voucher")) !== new Set(sasaran.map((x) => x.voucher)).size || Math.abs(Number(arg("pendapatan")) - totalPend) > 1) {
    console.error(`ABORT: angka harapan tidak cocok (--voucher=${arg("voucher")} --pendapatan=${arg("pendapatan")}).`); await pool.close(); process.exit(1);
  }

  fs.mkdirSync(path.dirname(SNAP), { recursive: true });
  fs.writeFileSync(SNAP, JSON.stringify(rows, null, 2));
  console.log("Snapshot (trackback) ditulis:", SNAP);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    let n = 0;
    for (const x of sasaran) {
      const del = await new sql.Request(tx).input("v", sql.VarChar(64), x.voucher).input("id", sql.VarChar(16), x.idHapus)
        .query(`DELETE FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo=@v AND ID=@id AND LEFT(ISNULL(Memo,''),9)='[DASHPMP-'`);
      n += del.rowsAffected[0];
    }
    if (n !== rows.length) throw new Error(`terhapus ${n} != snapshot ${rows.length}`);
    await tx.commit();
    console.log(`${n} baris jurnal ganda dihapus.`);
  } catch (e) { await tx.rollback(); console.error("GAGAL (rollback):", e); await pool.close(); process.exit(1); }

  const ukur = (await pool.request().query(`
    SELECT (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01') AS pendapatan_okt,
           (SELECT SUM(Netto) FROM SalesInvoice WHERE IsDeleted=0 AND TransDate>='2026-10-01' AND TransDate<'2026-11-01') AS total_si_okt`)).recordset[0];
  console.log("Setelah hapus:", JSON.stringify(ukur));
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
