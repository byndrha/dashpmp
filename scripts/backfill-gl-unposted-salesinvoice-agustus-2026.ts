// ============================================================================
// BACKFILL: posting jurnal GeneralLedger untuk SalesInvoice (MKE/SI) Agustus
// 2026 yang belum pernah ter-posting sama sekali (0 baris GL) akibat proses
// posting eksternal (di luar dashpmp, kemungkinan ERP desktop / staf akunting)
// yang berhenti berjalan sejak 26 Agustus 2026. Investigasi lengkap ada di
// riwayat chat sesi ini -- root cause BUKAN bug dashpmp (dashpmp tidak pernah
// menulis ke GeneralLedger sama sekali) dan BUKAN karakter/data korup
// (dicek: NULL field, tanda kutip, non-ASCII -- semua bersih).
//
// RUMUS JURNAL PER INVOICE (diverifikasi 100% cocok terhadap >5 invoice yang
// SUDAH ter-posting normal, termasuk yang multi-item):
//   Debit  019   (Piutang Usaha)     = SalesInvoice.Netto
//   Credit <Sales account per item>  = SUM(SalesInvoiceDetail.Amount) per
//                                      Item.Sales (biasanya 1 akun/invoice)
//   Debit  <COGSID account per item> = SUM(SalesInvoiceDetail.Qty *
//                                      ItemAverage.Average) per Item.COGSID,
//                                      ItemAverage dicocokkan ke
//                                      (Year, Month) dari TransDate invoice
//   Credit 01129 (Goods In Transit)  = sama persis dengan nilai Debit COGSID
//                                      di atas, per grup COGSID
// Dikonfirmasi: tidak ada satu pun dari invoice yang belum ter-posting ini
// yang mencampur lebih dari 1 kategori item (Sales account) dalam 1 invoice,
// dan SUM(Amount) selalu persis sama dengan Netto untuk semuanya -- jadi
// rumus di atas berlaku eksak, bukan perkiraan.
//
// KESELAMATAN:
// - DRY-RUN secara default -- HANYA menampilkan preview, tidak menulis
//   apa pun ke database. Tambahkan --apply untuk benar-benar menulis.
// - Bahkan dengan --apply, wajib juga mengetik konfirmasi interaktif
//   (lihat di bawah) -- mencegah eksekusi tidak sengaja.
// - Re-cek per invoice PERSIS SEBELUM insert (di dalam transaksi yang sama)
//   bahwa VoucherNo itu masih 0 baris GL -- kalau proses eksternal ternyata
//   sudah memprosesnya duluan (race condition), invoice itu DILEWATI, bukan
//   di-posting ganda.
// - Setiap baris GL hasil backfill diberi Memo unik ("BACKFILL-DASHPMP-...")
//   supaya bisa dibedakan dari posting asli saat diaudit nanti.
// - Idempoten -- aman dijalankan ulang, invoice yang sudah punya GL row
//   (baik dari proses asli maupun backfill sebelumnya) otomatis dilewati.
//
// Usage:
//   npx tsx scripts/backfill-gl-unposted-salesinvoice-agustus-2026.ts             (dry-run, aman)
//   npx tsx scripts/backfill-gl-unposted-salesinvoice-agustus-2026.ts --apply     (benar-benar menulis, minta konfirmasi ketik)
// ============================================================================
import "dotenv/config";
import readline from "node:readline/promises";
import { getPool, sql } from "../src/lib/db";

const PIUTANG_USAHA_COA = "019"; // 1301 - Piutang Usaha
const GOODS_IN_TRANSIT_COA = "01129"; // 1399 - Goods In Transit
const MEMO_TAG = "BACKFILL-DASHPMP-2026-08";

interface UnpostedInvoice {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: Date;
  Netto: number;
  BranchID: string | null;
  DepartmentID: string | null;
  BusinessPartnerID: string | null;
}

interface DetailRow {
  Qty: number;
  Amount: number;
  Sales: string | null;
  COGSID: string | null;
  Average: number | null;
}

interface PlannedGLRow {
  ChartOfAccountID: string;
  Debit: number;
  Credit: number;
}

async function getUnpostedInvoices(pool: Awaited<ReturnType<typeof getPool>>): Promise<UnpostedInvoice[]> {
  const req = pool.request();
  const result = await req.query(`
    SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate, si.Netto,
           si.BranchID, si.DepartmentID, si.BusinessPartnerID
    FROM SalesInvoice si
    LEFT JOIN (SELECT DISTINCT VoucherNo FROM GeneralLedger) gl ON gl.VoucherNo = si.VoucherNo
    WHERE si.VoucherNo LIKE 'MKE/SI%'
      AND si.IsDeleted = 0
      AND si.TransDate >= '2026-08-01' AND si.TransDate < '2026-09-01'
      AND si.Netto > 0
      AND gl.VoucherNo IS NULL
    ORDER BY si.TransDate ASC
  `);
  return result.recordset as UnpostedInvoice[];
}

async function getDetailRows(
  pool: Awaited<ReturnType<typeof getPool>>,
  salesInvoiceId: string,
  year: number,
  month: number
): Promise<DetailRow[]> {
  const req = pool.request();
  req.input("id", sql.VarChar(20), salesInvoiceId);
  req.input("yr", sql.Int, year);
  req.input("mo", sql.Int, month);
  const result = await req.query(`
    SELECT sid.Qty, sid.Amount, i.Sales, i.COGSID, ia.Average
    FROM SalesInvoiceDetail sid
    LEFT JOIN Item i ON i.ItemID = sid.ItemID
    LEFT JOIN ItemAverage ia ON ia.ItemID = sid.ItemID AND ia.[Year] = @yr AND ia.[Month] = @mo
    WHERE sid.SalesInvoiceID = @id
  `);
  return result.recordset as DetailRow[];
}

// Menghitung 4 (atau lebih, kalau ada >1 kategori item) baris GL untuk satu
// invoice. Melempar error kalau ada data yang tidak lengkap (item tanpa
// Sales/COGSID, atau ItemAverage yang tidak ada untuk bulan itu) -- lebih
// baik invoice itu dilewati (lihat pemanggil) daripada menulis jurnal yang
// salah/tidak lengkap.
function computeGLRows(invoice: UnpostedInvoice, details: DetailRow[]): PlannedGLRow[] {
  const salesTotals = new Map<string, number>();
  const cogsTotals = new Map<string, number>();

  for (const d of details) {
    if (!d.Sales || !d.COGSID) {
      throw new Error(`Item tanpa Sales/COGSID account (SalesInvoiceID=${invoice.SalesInvoiceID})`);
    }
    if (d.Average == null) {
      throw new Error(
        `Tidak ada ItemAverage untuk bulan invoice ini (SalesInvoiceID=${invoice.SalesInvoiceID}) -- perlu dicek manual, JANGAN diasumsikan 0.`
      );
    }
    salesTotals.set(d.Sales, (salesTotals.get(d.Sales) ?? 0) + Number(d.Amount));
    cogsTotals.set(d.COGSID, (cogsTotals.get(d.COGSID) ?? 0) + Number(d.Qty) * Number(d.Average));
  }

  const sumSales = [...salesTotals.values()].reduce((s, v) => s + v, 0);
  if (Math.abs(sumSales - invoice.Netto) > 0.01) {
    throw new Error(
      `SUM(Amount)=${sumSales} tidak sama dengan Netto=${invoice.Netto} (SalesInvoiceID=${invoice.SalesInvoiceID}) -- data tidak sesuai asumsi, dilewati demi keamanan.`
    );
  }

  const rows: PlannedGLRow[] = [{ ChartOfAccountID: PIUTANG_USAHA_COA, Debit: invoice.Netto, Credit: 0 }];
  for (const [coa, amount] of salesTotals) {
    rows.push({ ChartOfAccountID: coa, Debit: 0, Credit: amount });
  }
  let totalCogs = 0;
  for (const [coa, amount] of cogsTotals) {
    rows.push({ ChartOfAccountID: coa, Debit: amount, Credit: 0 });
    totalCogs += amount;
  }
  if (totalCogs > 0) {
    rows.push({ ChartOfAccountID: GOODS_IN_TRANSIT_COA, Debit: 0, Credit: totalCogs });
  }
  return rows;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = await getPool();

  const invoices = await getUnpostedInvoices(pool);
  console.log(`Ditemukan ${invoices.length} invoice belum ter-posting (Agustus 2026, nilai riil).`);

  const planned: { invoice: UnpostedInvoice; rows: PlannedGLRow[] }[] = [];
  const skipped: { invoice: UnpostedInvoice; reason: string }[] = [];

  for (const invoice of invoices) {
    const year = invoice.TransDate.getUTCFullYear();
    const month = invoice.TransDate.getUTCMonth() + 1;
    try {
      const details = await getDetailRows(pool, invoice.SalesInvoiceID, year, month);
      if (details.length === 0) {
        skipped.push({ invoice, reason: "Tidak ada SalesInvoiceDetail sama sekali." });
        continue;
      }
      const rows = computeGLRows(invoice, details);
      planned.push({ invoice, rows });
    } catch (err) {
      skipped.push({ invoice, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const totalNetto = planned.reduce((s, p) => s + p.invoice.Netto, 0);
  const totalPerCoa = new Map<string, { debit: number; credit: number }>();
  for (const p of planned) {
    for (const row of p.rows) {
      const cur = totalPerCoa.get(row.ChartOfAccountID) ?? { debit: 0, credit: 0 };
      cur.debit += row.Debit;
      cur.credit += row.Credit;
      totalPerCoa.set(row.ChartOfAccountID, cur);
    }
  }

  console.log(`\n=== RINGKASAN ===`);
  console.log(`Siap diposting : ${planned.length} invoice, total Netto Rp ${totalNetto.toLocaleString("id-ID")}`);
  console.log(`Dilewati       : ${skipped.length} invoice (lihat detail di bawah)`);
  console.log(`\nTotal per akun (Debit / Credit):`);
  for (const [coa, t] of [...totalPerCoa.entries()].sort()) {
    console.log(`  ${coa}: Debit ${t.debit.toLocaleString("id-ID")} / Credit ${t.credit.toLocaleString("id-ID")}`);
  }

  if (skipped.length > 0) {
    console.log(`\n=== INVOICE YANG DILEWATI (perlu dicek manual) ===`);
    for (const s of skipped) {
      console.log(`  ${s.invoice.VoucherNo}: ${s.reason}`);
    }
  }

  if (!apply) {
    console.log(`\n[DRY-RUN] Tidak ada yang ditulis ke database. Jalankan ulang dengan --apply untuk benar-benar posting.`);
    process.exit(0);
  }

  console.log(`\n!!! MODE --apply AKTIF !!!`);
  console.log(`Ini akan menulis ${planned.length} invoice (${planned.reduce((s, p) => s + p.rows.length, 0)} baris GL) ke GeneralLedger PRODUKSI.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Ketik persis "POSTING SEKARANG" untuk lanjut, apa pun selain itu akan membatalkan: `);
  rl.close();
  if (answer !== "POSTING SEKARANG") {
    console.log("Dibatalkan -- tidak ada perubahan ke database.");
    process.exit(0);
  }

  let posted = 0;
  let raceSkipped = 0;
  for (const p of planned) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const checkReq = new sql.Request(transaction);
      checkReq.input("v", sql.VarChar(50), p.invoice.VoucherNo);
      const check = await checkReq.query(`SELECT TOP 1 1 AS Found FROM GeneralLedger WHERE VoucherNo = @v`);
      if (check.recordset.length > 0) {
        // Sudah keburu ter-posting oleh proses lain (asli atau run sebelumnya)
        // di antara waktu dry-run tadi dan sekarang -- lewati, jangan dobel.
        await transaction.rollback();
        raceSkipped++;
        continue;
      }

      for (const row of p.rows) {
        const insertReq = new sql.Request(transaction);
        insertReq.input("id", sql.VarChar(20), p.invoice.SalesInvoiceID);
        insertReq.input("branchId", sql.VarChar(20), p.invoice.BranchID);
        insertReq.input("deptId", sql.VarChar(20), p.invoice.DepartmentID);
        insertReq.input("voucherNo", sql.VarChar(50), p.invoice.VoucherNo);
        insertReq.input("transDate", sql.DateTime, p.invoice.TransDate);
        insertReq.input("coa", sql.VarChar(20), row.ChartOfAccountID);
        insertReq.input("debit", sql.Decimal(23, 10), row.Debit);
        insertReq.input("credit", sql.Decimal(23, 10), row.Credit);
        insertReq.input("memo", sql.VarChar(200), MEMO_TAG);
        insertReq.input("bp", sql.VarChar(20), p.invoice.BusinessPartnerID);
        await insertReq.query(`
          INSERT INTO GeneralLedger
            (ID, BranchID, DepartmentID, VoucherNo, TransDate, Type, ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
          VALUES
            (@id, @branchId, @deptId, @voucherNo, @transDate, 'SALESINVOICE', @coa, @debit, @credit, @memo, @bp, '', 1)
        `);
      }

      await transaction.commit();
      posted++;
    } catch (err) {
      await transaction.rollback();
      console.error(`GAGAL posting ${p.invoice.VoucherNo}, dibatalkan (transaksi di-rollback):`, err);
    }
  }

  console.log(`\nSelesai. Ter-posting: ${posted}. Dilewati karena sudah ter-posting duluan (race): ${raceSkipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
