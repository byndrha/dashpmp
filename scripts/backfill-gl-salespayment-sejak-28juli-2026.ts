// BACKFILL: posting jurnal GeneralLedger untuk SalesPayment (MKE/SP) yang
// dibuat lewat dashpmp sendiri (fitur Pelunasan, modul Piutang, diluncurkan
// 2026-07-28) sejak awal fitur itu ada sampai sekarang, yang 0 baris GL --
// root cause: recordPayment() (src/lib/queries/pelunasan.ts) hanya menulis
// ke SalesPayment/SalesPaymentDetail/DashboardSalesPaymentMetode, TIDAK
// PERNAH memposting ke GeneralLedger sama sekali sampai diperbaiki
// 2026-09-23 (lihat commit yang menambahkan posting GL langsung di
// recordPayment()). Ini HANYA membereskan data historis yang sudah
// terlanjur tercatat sebelum perbaikan itu ada -- SP baru sudah otomatis
// ter-posting lewat recordPayment() sendiri, tidak lewat script ini.
//
// Dibedakan dari SalesPayment yang dibuat lewat ERP desktop (SELALU sudah
// punya baris GL sendiri, terverifikasi 2026-09-23 lewat 3 sampel acak) --
// script ini HANYA menyasar SalesPayment yang punya baris
// DashboardSalesPaymentMetode (penanda satu-satunya bahwa SP itu dibuat
// lewat dashpmp, bukan ERP desktop).
//
// RUMUS JURNAL PER SP (sama persis dengan yang baru ditambahkan ke
// recordPayment(), diverifikasi terhadap pola SP ERP-desktop yang sudah
// benar):
//   Debit  <ChartOfAccountID metode pembayaran SP itu> = SalesPayment.Amount
//   Credit 019  (Piutang Usaha)      = SUM(SalesPaymentDetail.Amount) -- porsi
//                                      yang benar2 dialokasikan ke invoice
//   Credit 0185 (Uang Muka Customer) = SUM(SalesPaymentDetail.Deposit) --
//                                      porsi kelebihan bayar, HANYA ditulis
//                                      kalau > 0 (dikonfirmasi user 2026-09-23;
//                                      TIDAK ADA satu pun contoh historis
//                                      SP+Deposit>0 yang sudah ter-posting GL
//                                      untuk memverifikasi pola ini secara
//                                      empiris -- ini keputusan bisnis baru,
//                                      bukan pola yang direplikasi dari data).
//
// KESELAMATAN:
// - DRY-RUN secara default -- HANYA menampilkan preview, tidak menulis
//   apa pun ke database. Tambahkan --apply untuk benar-benar menulis.
// - Bahkan dengan --apply, wajib juga mengetik konfirmasi interaktif.
// - Applock yang sama dengan gl-posting-backfill.ts (SI/DO) dan
//   recordPayment() (SP baru) dipakai per-dokumen, supaya generate ID
//   GeneralLedger di sini tidak race dengan proses lain yang jalan
//   bersamaan.
// - Re-cek idempotency di DALAM transaksi tiap dokumen (bukan cuma sekali
//   di awal) -- SP yang keburu ter-posting oleh proses lain di antara waktu
//   dry-run dan --apply akan dilewati, bukan dobel-posting.
//
// CARA PAKAI:
//   npx tsx scripts/backfill-gl-salespayment-sejak-28juli-2026.ts           (dry-run, aman)
//   npx tsx scripts/backfill-gl-salespayment-sejak-28juli-2026.ts --apply   (benar-benar menulis, minta konfirmasi ketik)

import "dotenv/config";
import readline from "node:readline/promises";
import { getPool, sql } from "../src/lib/db";
import { nextGeneralLedgerId, acquireGLPostingApplock } from "../src/lib/queries/gl-posting-backfill";

const AKUN_PIUTANG_USAHA = "019";
const AKUN_UANG_MUKA_CUSTOMER = "0185";

interface UnpostedSP {
  SalesPaymentID: string;
  VoucherNo: string;
  TransDate: Date;
  Amount: number;
  ChartOfAccountID: string;
  BranchID: string;
  DepartmentID: string;
  BusinessPartnerID: string;
  BusinessPartnerName: string | null;
  AmountApplied: number;
  Deposit: number;
}

async function getUnpostedSalesPayments(pool: sql.ConnectionPool): Promise<UnpostedSP[]> {
  const result = await pool.request().query(`
    SELECT sp.SalesPaymentID, sp.VoucherNo, sp.TransDate, sp.Amount, sp.ChartOfAccountID,
           sp.BranchID, sp.DepartmentID, sp.BusinessPartnerID, bp.Name AS BusinessPartnerName,
           ISNULL(SUM(spd.Amount), 0) AS AmountApplied, ISNULL(SUM(spd.Deposit), 0) AS Deposit
    FROM SalesPayment sp
    JOIN DashboardSalesPaymentMetode m ON m.SalesPaymentID = sp.SalesPaymentID
    LEFT JOIN SalesPaymentDetail spd ON spd.SalesPaymentID = sp.SalesPaymentID
    LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = sp.BusinessPartnerID
    LEFT JOIN GeneralLedger gl ON gl.VoucherNo = sp.VoucherNo
    WHERE sp.IsDeleted = 0 AND gl.ID IS NULL
    GROUP BY sp.SalesPaymentID, sp.VoucherNo, sp.TransDate, sp.Amount, sp.ChartOfAccountID,
             sp.BranchID, sp.DepartmentID, sp.BusinessPartnerID, bp.Name
    ORDER BY sp.TransDate ASC
  `);
  return result.recordset as UnpostedSP[];
}

interface PlannedGLRow {
  ChartOfAccountID: string;
  Debit: number;
  Credit: number;
}

function computeGLRows(sp: UnpostedSP): PlannedGLRow[] {
  const rows: PlannedGLRow[] = [{ ChartOfAccountID: sp.ChartOfAccountID, Debit: sp.Amount, Credit: 0 }];
  if (sp.AmountApplied > 0) {
    rows.push({ ChartOfAccountID: AKUN_PIUTANG_USAHA, Debit: 0, Credit: sp.AmountApplied });
  }
  if (sp.Deposit > 0) {
    rows.push({ ChartOfAccountID: AKUN_UANG_MUKA_CUSTOMER, Debit: 0, Credit: sp.Deposit });
  }
  return rows;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = await getPool();

  const unposted = await getUnpostedSalesPayments(pool);
  console.log(`Ditemukan ${unposted.length} SalesPayment dashpmp (Pelunasan) yang 0 baris GL.`);

  const planned = unposted.map((sp) => ({ sp, rows: computeGLRows(sp) }));
  const totalAmount = planned.reduce((s, p) => s + p.sp.Amount, 0);
  const totalDeposit = planned.reduce((s, p) => s + p.sp.Deposit, 0);

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
  console.log(`Siap diposting : ${planned.length} SP, total Amount Rp ${totalAmount.toLocaleString("id-ID")}`);
  console.log(`  Termasuk Deposit/kelebihan bayar Rp ${totalDeposit.toLocaleString("id-ID")}`);
  console.log(`\nTotal per akun (Debit / Credit):`);
  for (const [coa, t] of [...totalPerCoa.entries()].sort()) {
    console.log(`  ${coa}: Debit ${t.debit.toLocaleString("id-ID")} / Credit ${t.credit.toLocaleString("id-ID")}`);
  }

  console.log(`\n=== CONTOH (5 pertama) ===`);
  for (const p of planned.slice(0, 5)) {
    console.log(`  ${p.sp.VoucherNo} (${p.sp.TransDate.toISOString().slice(0, 10)}) -> ${p.sp.BusinessPartnerName ?? p.sp.BusinessPartnerID}: Rp ${p.sp.Amount.toLocaleString("id-ID")}`);
  }

  if (!apply) {
    console.log(`\n[DRY-RUN] Tidak ada yang ditulis ke database. Jalankan ulang dengan --apply untuk benar-benar posting.`);
    process.exit(0);
  }

  console.log(`\n!!! MODE --apply AKTIF !!!`);
  console.log(`Ini akan menulis ${planned.length} SalesPayment (${planned.reduce((s, p) => s + p.rows.length, 0)} baris GL) ke GeneralLedger PRODUKSI.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Ketik persis "POSTING SEKARANG" untuk lanjut, apa pun selain itu akan membatalkan: `);
  rl.close();
  if (answer !== "POSTING SEKARANG") {
    console.log("Dibatalkan -- tidak ada perubahan ke database.");
    process.exit(0);
  }

  let posted = 0;
  let raceSkipped = 0;
  const failed: { voucherNo: string; error: string }[] = [];

  for (const p of planned) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await acquireGLPostingApplock(transaction);

      const check = await new sql.Request(transaction)
        .input("v", sql.VarChar(64), p.sp.VoucherNo)
        .query(`SELECT TOP 1 1 AS Found FROM GeneralLedger WHERE VoucherNo = @v`);
      if (check.recordset.length > 0) {
        await transaction.rollback();
        raceSkipped++;
        continue;
      }

      const glId = await nextGeneralLedgerId(transaction);
      const memo = `[DASHPMP-BACKFILL-SP] Sales Payment To ${p.sp.BusinessPartnerName ?? p.sp.BusinessPartnerID}`;
      for (const row of p.rows) {
        await new sql.Request(transaction)
          .input("id", sql.VarChar(16), glId)
          .input("branchId", sql.VarChar(16), p.sp.BranchID)
          .input("departmentId", sql.VarChar(16), p.sp.DepartmentID)
          .input("voucherNo", sql.VarChar(64), p.sp.VoucherNo)
          .input("transDate", sql.DateTime, p.sp.TransDate)
          .input("chartOfAccountId", sql.VarChar(16), row.ChartOfAccountID)
          .input("debit", sql.Decimal(18, 6), row.Debit)
          .input("credit", sql.Decimal(18, 6), row.Credit)
          .input("memo", sql.VarChar(255), memo)
          .input("businessPartnerId", sql.VarChar(16), p.sp.BusinessPartnerID).query(`
            INSERT INTO GeneralLedger
              (ID, BranchID, DepartmentID, VoucherNo, TransDate, [Type], ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
            VALUES
              (@id, @branchId, @departmentId, @voucherNo, @transDate, 'SALESPAYMENT', @chartOfAccountId, @debit, @credit, @memo, @businessPartnerId, '', 1)
          `);
      }

      await transaction.commit();
      posted++;
    } catch (err) {
      await transaction.rollback();
      failed.push({ voucherNo: p.sp.VoucherNo, error: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`\n=== SELESAI ===`);
  console.log(`Berhasil diposting : ${posted}`);
  console.log(`Dilewati (race)    : ${raceSkipped}`);
  console.log(`Gagal              : ${failed.length}`);
  if (failed.length > 0) {
    console.log(`\nDaftar gagal:`);
    for (const f of failed) console.log(`  ${f.voucherNo}: ${f.error}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
