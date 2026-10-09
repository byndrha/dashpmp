import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// Koreksi selisih GIT-1399 September 2026 (-Rp 249.480,11) bagian jurnal
// DASHBOARD yang salah. Diagnosis 9 Okt 2026 (lihat memori
// gl-itemaverage-closing-gate-and-orphan-journals): jurnal bawaan ERP memakai
// GeneralLedger.ID = ID dokumen, jurnal dashboard memakai ID urut sendiri,
// sehingga saat staf ERP menghapus SI lama / menggeser tanggal dokumen, jurnal
// dashboard TIDAK ikut hilang. Dua kelompok yang dihapus:
//   A. Jurnal dashboard milik dokumen (SI/DO) yang sudah IsDeleted=1.
//   C. Jurnal dashboard yang MENGGANDAKAN jurnal bawaan ERP untuk voucher+tipe
//      yang sama (dokumen aktif; jurnal ERP-nya dipertahankan).
// Kelompok B (14 DO yang debitnya hilang) ditangani terpisah lewat engine
// postBacklogForDate. Default = DRY RUN; tambahkan --execute untuk menulis.
// Revert: scripts/revert-git1399-sep2026-jurnal-dashboard-2026-10-09.ts

const ACC_1399 = "01129";
const SNAPSHOT = path.join(__dirname, "..", "docs", "data-fixes", "2026-10-09-git1399-sep2026-jurnal-dashboard-before.json");
const EXECUTE = process.argv.includes("--execute");

// Angka hasil analisis 9 Okt 2026 -- skrip ABORT kalau data sudah berubah.
const EXPECT = {
  A: { jurnal: 39, baris: 150, siKredit1399: 201492.886481, doDebit1399: 4296.534982 },
  C: { doJurnal: 8, siJurnal: 3, doDebit1399: 32039.214105, siKredit1399: 6275.72235 },
};
const TOL = 0.01;

interface GLRow {
  ID: string; BranchID: string; DepartmentID: string; VoucherNo: string; TransDate: Date; Type: string;
  ChartOfAccountID: string; Debit: number; Credit: number; Memo: string | null;
  BusinessPartnerID: string | null; CurrencyID: string; Rate: number;
}
type Journal = { key: string; voucherNo: string; type: string; id: string; rows: GLRow[]; grup: "A" | "C" };

const COLS = "ID, BranchID, DepartmentID, VoucherNo, TransDate, [Type] AS Type, ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate";
const near = (a: number, b: number) => Math.abs(a - b) <= TOL;

async function main() {
  const pool = await getPool();
  const ident = (await pool.request().query(`SELECT @@SERVERNAME AS s, DB_NAME() AS d`)).recordset[0] as { s: string; d: string };
  console.log("DB:", ident.s, ident.d, EXECUTE ? "(EXECUTE)" : "(DRY RUN)");
  if (ident.d !== "MKEsindo") throw new Error(`DB bukan MKEsindo: ${ident.d}`);

  // 1. Seluruh jurnal dashboard September (semua akun).
  const dash = (await pool.request().query(`
    SELECT ${COLS} FROM GeneralLedger WITH (NOLOCK)
    WHERE TransDate >= '2026-09-01' AND TransDate < '2026-10-01' AND LEFT(ISNULL(Memo,''),9) = '[DASHPMP-'
  `)).recordset as GLRow[];

  // 2. Jurnal bawaan ERP (non-dashboard) di akun 1399 -- cukup utk deteksi duplikat.
  const native = (await pool.request().query(`
    SELECT VoucherNo, [Type] AS Type, ID, SUM(Debit) AS D, SUM(Credit) AS C FROM GeneralLedger WITH (NOLOCK)
    WHERE ChartOfAccountID = '${ACC_1399}' AND TransDate >= '2026-09-01' AND LEFT(ISNULL(Memo,''),9) <> '[DASHPMP-'
    GROUP BY VoucherNo, [Type], ID
  `)).recordset as { VoucherNo: string; Type: string; ID: string; D: number; C: number }[];

  // 3. Status dokumen (MIN(IsDeleted): 1 hanya bila SEMUA dokumen ber-voucher itu terhapus).
  const docStatus = new Map<string, number>();
  for (const [tbl, tipe] of [["SalesInvoice", "SALESINVOICE"], ["DeliveryOrder", "DELIVERYORDER"]] as const) {
    const r = (await pool.request().query(
      `SELECT VoucherNo, MIN(CAST(IsDeleted AS INT)) AS Del FROM ${tbl} WITH (NOLOCK) WHERE TransDate >= '2026-08-01' GROUP BY VoucherNo`
    )).recordset as { VoucherNo: string; Del: number }[];
    for (const x of r) docStatus.set(`${tipe}|${x.VoucherNo}`, x.Del);
  }

  // 4. Kelompokkan baris dashboard jadi jurnal (VoucherNo|Type|ID) dan klasifikasi.
  const jurnalMap = new Map<string, Journal>();
  for (const r of dash) {
    const key = `${r.Type}|${r.VoucherNo}|${r.ID}`;
    if (!jurnalMap.has(key)) jurnalMap.set(key, { key, voucherNo: r.VoucherNo, type: r.Type, id: r.ID, rows: [], grup: "A" });
    jurnalMap.get(key)!.rows.push(r);
  }
  const targets: Journal[] = [];
  for (const j of jurnalMap.values()) {
    if (j.type !== "SALESINVOICE" && j.type !== "DELIVERYORDER") continue;
    const del = docStatus.get(`${j.type}|${j.voucherNo}`);
    if (del === 1) { j.grup = "A"; targets.push(j); continue; }
    if (del === 0) {
      const dup = native.find((n) => n.VoucherNo === j.voucherNo && n.Type === j.type && n.ID !== j.id);
      if (dup) {
        const r1399 = j.rows.filter((r) => r.ChartOfAccountID === ACC_1399);
        const d = r1399.reduce((s, r) => s + r.Debit, 0);
        const c = r1399.reduce((s, r) => s + r.Credit, 0);
        if (!near(d, dup.D) || !near(c, dup.C)) {
          console.log("LEWATI (jumlah 1399 tidak sama dgn jurnal ERP):", j.key, { d, c }, dup);
          continue;
        }
        j.grup = "C"; targets.push(j);
      }
    }
  }

  const sum = (g: "A" | "C", type: string, side: "Debit" | "Credit") =>
    targets.filter((j) => j.grup === g && j.type === type).flatMap((j) => j.rows)
      .filter((r) => r.ChartOfAccountID === ACC_1399).reduce((s, r) => s + r[side], 0);
  const A = targets.filter((j) => j.grup === "A");
  const C = targets.filter((j) => j.grup === "C");
  const got = {
    A: { jurnal: A.length, baris: A.reduce((s, j) => s + j.rows.length, 0), siKredit1399: sum("A", "SALESINVOICE", "Credit"), doDebit1399: sum("A", "DELIVERYORDER", "Debit") },
    C: {
      doJurnal: C.filter((j) => j.type === "DELIVERYORDER").length, siJurnal: C.filter((j) => j.type === "SALESINVOICE").length,
      doDebit1399: sum("C", "DELIVERYORDER", "Debit"), siKredit1399: sum("C", "SALESINVOICE", "Credit"),
    },
  };
  console.log("Ditemukan:", JSON.stringify(got));
  console.log("Diharapkan:", JSON.stringify(EXPECT));
  const ok =
    got.A.jurnal === EXPECT.A.jurnal && got.A.baris === EXPECT.A.baris &&
    near(got.A.siKredit1399, EXPECT.A.siKredit1399) && near(got.A.doDebit1399, EXPECT.A.doDebit1399) &&
    got.C.doJurnal === EXPECT.C.doJurnal && got.C.siJurnal === EXPECT.C.siJurnal &&
    near(got.C.doDebit1399, EXPECT.C.doDebit1399) && near(got.C.siKredit1399, EXPECT.C.siKredit1399);
  if (!ok) { console.error("ABORT: angka tidak cocok dengan analisis. Data berubah -- analisis ulang."); await pool.close(); process.exit(1); }

  // Tiap jurnal harus seimbang (Debit = Kredit) supaya penghapusan tidak merusak neraca.
  for (const j of targets) {
    const d = j.rows.reduce((s, r) => s + r.Debit, 0), c = j.rows.reduce((s, r) => s + r.Credit, 0);
    if (!near(d, c)) { console.error("ABORT: jurnal tidak seimbang", j.key, d, c); await pool.close(); process.exit(1); }
  }
  const efek = -(got.A.doDebit1399 + got.C.doDebit1399) + (got.A.siKredit1399 + got.C.siKredit1399);
  console.log(`Efek penghapusan pada net 1399: ${efek.toFixed(6)} (A+C)`);

  if (!EXECUTE) { console.log("DRY RUN selesai. Jalankan ulang dengan --execute untuk menulis."); await pool.close(); return; }

  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, JSON.stringify(targets.map((j) => ({ grup: j.grup, key: j.key, rows: j.rows })), null, 2));
  console.log("Snapshot ditulis:", SNAPSHOT);

  let selesai = 0;
  for (const j of targets) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const r of j.rows) {
        const res = await new sql.Request(tx)
          .input("coa", sql.VarChar(16), r.ChartOfAccountID).input("td", sql.DateTime, r.TransDate)
          .input("v", sql.VarChar(64), r.VoucherNo).input("id", sql.VarChar(16), r.ID).input("t", sql.VarChar(20), r.Type)
          .query(`DELETE TOP (1) FROM GeneralLedger WHERE ChartOfAccountID=@coa AND TransDate=@td AND VoucherNo=@v AND ID=@id AND [Type]=@t AND LEFT(ISNULL(Memo,''),9)='[DASHPMP-'`);
        if (res.rowsAffected[0] !== 1) throw new Error(`baris tidak terhapus tepat 1: ${j.key} ${r.ChartOfAccountID}`);
      }
      await tx.commit();
      selesai++;
    } catch (e) {
      await tx.rollback();
      console.error("GAGAL, rollback jurnal ini, berhenti:", j.key, e);
      console.log(`Sudah terhapus: ${selesai}/${targets.length} jurnal (snapshot memuat semua target).`);
      await pool.close();
      process.exit(1);
    }
  }
  console.log(`Selesai: ${selesai}/${targets.length} jurnal dihapus.`);
  const net = (await pool.request().query(
    `SELECT SUM(Debit-Credit) AS Net FROM GeneralLedger WITH (NOLOCK) WHERE ChartOfAccountID='${ACC_1399}' AND TransDate >= '2026-09-01'`
  )).recordset[0] as { Net: number };
  console.log("Net 1399 sejak 1 Sep 2026 sekarang:", net.Net);
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
