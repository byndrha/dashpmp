import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: rekonsiliasi pendapatan Oktober 2026 (GL 4001+4004 vs total SI), per kelas penyebab.
type Rev = { VoucherNo: string; ID: string; dash: number; pend: number };
type Doc = { id: string; voucherNo: string; terhapus: boolean; netto: number };

async function main() {
  const pool = await getPool();
  const q = async <T>(s: string) => (await pool.request().query(s)).recordset as T[];

  const rev = await q<Rev>(`
    SELECT g.VoucherNo, g.ID, MAX(CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 1 ELSE 0 END) dash, SUM(g.Credit-g.Debit) pend
    FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE g.[Type]='SALESINVOICE' AND c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01'
    GROUP BY g.VoucherNo, g.ID`);
  const docs = await q<Doc>(`SELECT SalesInvoiceID id, VoucherNo voucherNo, IsDeleted terhapus, Netto netto FROM SalesInvoice WHERE TransDate>='2026-10-01' AND TransDate<'2026-11-01'`);
  const perVoucherDoc = new Map<string, Doc[]>(); for (const d of docs) perVoucherDoc.set(d.voucherNo, [...(perVoucherDoc.get(d.voucherNo) ?? []), d]);
  const perVoucherRev = new Map<string, Rev[]>(); for (const r of rev) perVoucherRev.set(r.VoucherNo, [...(perVoucherRev.get(r.VoucherNo) ?? []), r]);

  const kelas: Record<string, { n: number; selisih: number; contoh: string[] }> = {};
  const catat = (k: string, selisih: number, contoh: string) => { const x = (kelas[k] ??= { n: 0, selisih: 0, contoh: [] }); x.n++; x.selisih += selisih; if (x.contoh.length < 4) x.contoh.push(contoh); };

  // selisih = (jurnal GL) - (Netto SI aktif) per voucher
  const semua = new Set<string>([...perVoucherDoc.keys(), ...perVoucherRev.keys()]);
  for (const v of semua) {
    const ds = perVoucherDoc.get(v) ?? [];
    const aktif = ds.filter((d) => !d.terhapus);
    const nettoAktif = aktif.reduce((s, d) => s + d.netto, 0);
    const rs = perVoucherRev.get(v) ?? [];
    const glTotal = rs.reduce((s, r) => s + r.pend, 0);
    const sel = glTotal - nettoAktif;
    if (Math.abs(sel) < 0.5) continue;
    const dashRs = rs.filter((r) => r.dash === 1), erpRs = rs.filter((r) => r.dash !== 1);
    const dashPend = dashRs.reduce((s, r) => s + r.pend, 0), erpPend = erpRs.reduce((s, r) => s + r.pend, 0);
    const info = `${v} netto=${nettoAktif} gl=${glTotal} (dashboard ${dashPend} / ERP ${erpPend})`;
    if (aktif.length === 0) catat("1. YATIM: tak ada SI aktif, jurnal tertinggal", sel, info);
    else if (rs.length === 0) catat("2. BELUM TERJURNAL: SI aktif tanpa jurnal pendapatan", sel, info);
    else if (dashRs.length > 0 && erpRs.length > 0) {
      const idAktif = aktif[0].id;
      const erpBenar = erpRs.every((r) => r.ID === idAktif) && Math.abs(erpPend - nettoAktif) < 0.5;
      catat(erpBenar ? "3a. GANDA (voucher kembar): jurnal ERP benar, jurnal dashboard milik SI terhapus -> hapus yg dashboard" : "3b. GANDA tapi jurnal ERP tidak cocok -> tinjau manual", sel, info);
    } else if (dashRs.length > 0) catat("4. BASI: hanya jurnal dashboard, nilainya != Netto SI aktif", sel, info);
    else catat("5. ERP saja, nilai != Netto SI aktif", sel, info);
  }
  let total = 0;
  for (const k of Object.keys(kelas).sort()) { total += kelas[k].selisih; console.log(k, JSON.stringify({ n: kelas[k].n, selisihGL_minus_SI: Math.round(kelas[k].selisih), contoh: kelas[k].contoh })); }
  console.log("TOTAL selisih terklasifikasi (GL - SI):", Math.round(total));

  // GIT Oktober: komposisi
  const git = await q<{ net: number }>(`SELECT SUM(g.Debit-g.Credit) net FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399'`);
  console.log("Saldo 1399 total:", git[0].net);
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
