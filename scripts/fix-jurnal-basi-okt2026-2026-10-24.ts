import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";
import { computeBacklogForDate, postBacklogForDate } from "../src/lib/queries/gl-posting-backfill";

// Koreksi 3 jurnal dashboard BASI/YATIM (disetujui user 24 Okt), hasil diagnostik:
//  A. SI/004140: dua SI sama-voucher. SI AKTIF (ID 01241528, Rp 195.000) punya jurnal ERP 2 baris yang benar;
//     SI TERHAPUS (ID 01241527, Rp 130.000) meninggalkan jurnal dashboard 4 baris (GL ID 01257848).
//     -> hapus HANYA 4 baris dashboard itu (tanpa posting ulang; jurnal ERP tidak disentuh).
//  B. SI/003337 & SI/002749: SI aktif dgn Netto Rp 0 tapi jurnal dashboard masih pendapatan 16.000 / 15.000.
//     -> hapus jurnal dashboard lama, engine menghitung ulang; jika rencana engine TIDAK persis pendapatan = Netto (0),
//        jurnal lama DIPULIHKAN dari snapshot dan SI itu tidak diposting.
// Default DRY RUN (periksa keadaan awal saja); --execute untuk menulis.
// Revert: scripts/revert-jurnal-basi-okt2026-2026-10-24.ts

const EXECUTE = process.argv.includes("--execute");
const AKUN_PENCATAT = 2;
const DIR = path.join(__dirname, "..", "docs", "data-fixes");
const SNAP = path.join(DIR, "2026-10-24-jurnal-basi-okt2026-before.json");
const OUT = path.join(DIR, "2026-10-24-jurnal-basi-okt2026-posted.json");
const v = (n: number) => `MKE/SI/${String(n).padStart(6, "0")}/2026-10/003/001`;

const A = { voucher: v(4140), glId: "01257848", pendapatanDashboard: 130000, pendapatanErp: 195000 };
const B = [
  { voucher: v(3337), tgl: "2026-10-19", glId: "01253547", pendapatanLama: 16000 },
  { voucher: v(2749), tgl: "2026-10-15", glId: "01252501", pendapatanLama: 15000 },
];

type Baris = Record<string, unknown>;
const pendapatanDari = (rows: Baris[]) => rows.reduce((s, r) => s + (r.AccountNo ? 0 : 0), 0);
void pendapatanDari;

async function jurnal(pool: sql.ConnectionPool, voucher: string, glId?: string) {
  const req = pool.request().input("v", sql.VarChar(64), voucher);
  if (glId) req.input("id", sql.VarChar(16), glId);
  return (await req.query(`
    SELECT g.*, c.AccountNo FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE g.[Type]='SALESINVOICE' AND g.VoucherNo=@v ${glId ? "AND g.ID=@id" : ""}`)).recordset as (Baris & { AccountNo: string; Credit: number; Debit: number; Memo: string | null })[];
}
const pend = (rows: { AccountNo: string; Credit: number; Debit: number }[]) =>
  rows.filter((r) => r.AccountNo === "4001" || r.AccountNo === "4004").reduce((s, r) => s + r.Credit - r.Debit, 0);
const bersih = (rows: Baris[]) => rows.map((r) => { const { AccountNo, ...sisa } = r as Baris & { AccountNo?: string }; void AccountNo; return sisa; });

async function sisipkan(tx: sql.Transaction, rows: Baris[]) {
  for (const r of rows) {
    const cols = Object.keys(r);
    const req = new sql.Request(tx);
    cols.forEach((c, i) => req.input(`p${i}`, c === "TransDate" ? new Date(String(r[c])) : r[c]));
    await req.query(`INSERT INTO GeneralLedger (${cols.map((c) => `[${c}]`).join(",")}) VALUES (${cols.map((_, i) => `@p${i}`).join(",")})`);
  }
}

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT DB_NAME() AS d`)).recordset[0] as { d: string };
  console.log("DB:", ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  // ---- pagar keadaan awal ----
  const siA = (await pool.request().input("v", sql.VarChar(64), A.voucher).query(`SELECT IsDeleted, Netto FROM SalesInvoice WHERE VoucherNo=@v`)).recordset as { IsDeleted: boolean; Netto: number }[];
  const aktifA = siA.filter((x) => !x.IsDeleted), hapusA = siA.filter((x) => x.IsDeleted);
  const dashA = await jurnal(pool, A.voucher, A.glId);
  const semuaA = await jurnal(pool, A.voucher);
  const erpA = semuaA.filter((r) => !String(r.Memo ?? "").startsWith("[DASHPMP-"));
  console.log(`A ${A.voucher}: SI aktif ${aktifA.length} (Netto ${aktifA[0]?.Netto}) terhapus ${hapusA.length} (Netto ${hapusA[0]?.Netto}) | jurnal dashboard ${dashA.length} baris pendapatan ${pend(dashA)} | jurnal ERP ${erpA.length} baris pendapatan ${pend(erpA)}`);
  const okA = aktifA.length === 1 && hapusA.length === 1 && aktifA[0].Netto === A.pendapatanErp && dashA.length === 4
    && dashA.every((r) => String(r.Memo ?? "").startsWith("[DASHPMP-")) && Math.abs(pend(dashA) - A.pendapatanDashboard) < 1 && Math.abs(pend(erpA) - A.pendapatanErp) < 1;
  const lamaB: Record<string, Baris[]> = {};
  const nettoB: Record<string, number> = {};
  let okB = true;
  for (const s of B) {
    const si = (await pool.request().input("v", sql.VarChar(64), s.voucher).query(`SELECT IsDeleted, Netto FROM SalesInvoice WHERE VoucherNo=@v`)).recordset as { IsDeleted: boolean; Netto: number }[];
    const rows = await jurnal(pool, s.voucher);
    const dash = rows.length > 0 && rows.every((r) => String(r.Memo ?? "").startsWith("[DASHPMP-"));
    console.log(`B ${s.voucher}: SI baris ${si.length} aktif ${si.filter((x) => !x.IsDeleted).length} Netto ${si[0]?.Netto} | jurnal ${rows.length} baris pendapatan ${pend(rows)} (harapan ${s.pendapatanLama}) semua dashboard=${dash}`);
    const ok = si.length === 1 && !si[0].IsDeleted && si[0].Netto === 0 && rows.length === 4 && dash && Math.abs(pend(rows) - s.pendapatanLama) < 1;
    okB = okB && ok; lamaB[s.voucher] = rows; nettoB[s.voucher] = si[0]?.Netto ?? NaN;
  }
  if (!okA || !okB) { console.error(`ABORT: keadaan awal tidak sesuai harapan (A ok=${okA}, B ok=${okB}).`); await pool.close(); process.exit(1); }
  if (!EXECUTE) { console.log("DRY RUN selesai. Jalankan ulang dengan --execute untuk menulis."); await pool.close(); return; }

  // ---- snapshot ----
  fs.mkdirSync(DIR, { recursive: true });
  const snapshot: Record<string, Baris[]> = { [A.voucher]: bersih(dashA), ...Object.fromEntries(Object.entries(lamaB).map(([k, r]) => [k, bersih(r)])) };
  fs.writeFileSync(SNAP, JSON.stringify(snapshot, null, 2));
  console.log("Snapshot (trackback) ditulis:", SNAP);

  // ---- hapus A (4 baris dashboard) + hapus lama B, satu transaksi ----
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const dA = await new sql.Request(tx).input("v", sql.VarChar(64), A.voucher).input("id", sql.VarChar(16), A.glId)
      .query(`DELETE FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo=@v AND ID=@id AND LEFT(ISNULL(Memo,''),9)='[DASHPMP-'`);
    if (dA.rowsAffected[0] !== 4) throw new Error(`A terhapus ${dA.rowsAffected[0]} != 4`);
    for (const s of B) {
      const d = await new sql.Request(tx).input("v", sql.VarChar(64), s.voucher).input("id", sql.VarChar(16), s.glId)
        .query(`DELETE FROM GeneralLedger WHERE [Type]='SALESINVOICE' AND VoucherNo=@v AND ID=@id AND LEFT(ISNULL(Memo,''),9)='[DASHPMP-'`);
      if (d.rowsAffected[0] !== 4) throw new Error(`${s.voucher} terhapus ${d.rowsAffected[0]} != 4`);
    }
    await tx.commit();
    console.log("Jurnal dashboard lama dihapus: 4 (A) + 4 + 4 (B).");
  } catch (e) { await tx.rollback(); console.error("GAGAL hapus (rollback):", e); await pool.close(); process.exit(1); }

  // ---- rencana engine utk B; pulihkan yang tidak sesuai ----
  const izin = new Set<string>();
  const rencana: { tanggal: string; docType: string; voucherNo: string; pendapatan: number }[] = [];
  const dipulihkan: string[] = [];
  for (const s of B) {
    const r = await computeBacklogForDate(s.tgl);
    const p = r.postable.find((d) => d.docType === "SALESINVOICE" && d.voucherNo === s.voucher);
    const pendEngine = p ? p.lines.filter((l) => l.accountNo.startsWith("4")).reduce((a, l) => a + l.credit - l.debit, 0) : NaN;
    console.log(`${s.voucher}: rencana engine ${p ? "ada" : "TIDAK ADA"} | pendapatan ${pendEngine} (Netto ${nettoB[s.voucher]})`);
    if (p && Math.abs(pendEngine - nettoB[s.voucher]) <= 1) { izin.add(s.voucher); rencana.push({ tanggal: s.tgl, docType: "SALESINVOICE", voucherNo: s.voucher, pendapatan: pendEngine }); }
    else dipulihkan.push(s.voucher);
  }
  if (dipulihkan.length > 0) {
    const tx2 = new sql.Transaction(pool);
    await tx2.begin();
    try { for (const vv of dipulihkan) await sisipkan(tx2, snapshot[vv]); await tx2.commit(); console.log("DIPULIHKAN dari snapshot (rencana tidak sesuai):", dipulihkan); }
    catch (e) { await tx2.rollback(); console.error("GAGAL pulihkan (rollback) -- pulihkan manual dari snapshot:", SNAP, e); await pool.close(); process.exit(1); }
  }

  // ---- posting B ----
  const hasil: unknown[] = [];
  for (const tgl of [...new Set(rencana.map((x) => x.tanggal))]) {
    const r = await postBacklogForDate(tgl, AKUN_PENCATAT, izin);
    console.log(tgl, `posted=${r.jumlahPosted} gagal=${r.jumlahGagal}`);
    hasil.push({ tanggal: tgl, hasilPerDokumen: r.hasilPerDokumen });
    if (r.jumlahGagal > 0) console.error("Ada yang GAGAL:", JSON.stringify(r.hasilPerDokumen));
  }
  fs.writeFileSync(OUT, JSON.stringify({ rencana, dipulihkan, akunPencatat: AKUN_PENCATAT, hasil }, null, 2));
  const ukur = (await pool.request().query(`
    SELECT (SELECT SUM(g.Credit-g.Debit) FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
             WHERE c.AccountNo IN ('4001','4004') AND g.TransDate>='2026-10-01' AND g.TransDate<'2026-11-01') AS pendapatan_okt,
           (SELECT SUM(Netto) FROM SalesInvoice WHERE IsDeleted=0 AND TransDate>='2026-10-01' AND TransDate<'2026-11-01') AS total_si_okt`)).recordset[0];
  console.log("Setelah koreksi:", JSON.stringify(ukur));
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
