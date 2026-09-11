import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { getPool, sql } from "../src/lib/db";

// MKE/SI/000850/2026-09/003/001 is a dead SalesInvoice header: created
// 6 Sep 13:54:37, soft-deleted (IsDeleted=1) ~14 hours later on 7 Sep
// 04:14:33, with ZERO SalesInvoiceDetail rows and ZERO GeneralLedger
// entries ever posted — it never got past the header stage. It still
// references MKE/DO/000857/2026-09/003/001 via DeliveryOrderID, and is the
// only SalesInvoice referencing that DO. Finance staff reported the DO's
// qty isn't detected when attempting a fresh manual SI — this dead header
// (even soft-deleted) is the prime suspect for ERP Desktop's "already
// invoiced" check on the DO. Hard-deleting it removes that reference
// entirely; since it carries no line items and no ledger footprint, there
// is nothing else to clean up alongside it.

const SI_VOUCHER = "MKE/SI/000850/2026-09/003/001";

async function main() {
  const pool = await getPool();

  const before = await pool.request().query(`
    SELECT * FROM SalesInvoice WHERE VoucherNo = '${SI_VOUCHER}'
  `);
  const rows = before.recordset as Record<string, unknown>[];
  if (rows.length !== 1) {
    console.error(`MISMATCH: expected 1 baris SalesInvoice, ditemukan ${rows.length}. Aborting.`, rows);
    await pool.close();
    process.exit(1);
  }
  const row = rows[0];
  if (row.IsDeleted !== true || row.VoucherNo !== SI_VOUCHER) {
    console.error("MISMATCH: baris tidak sesuai ekspektasi (IsDeleted harus true). Aborting.", row);
    await pool.close();
    process.exit(1);
  }

  // Re-verify live: still zero detail rows, zero GL rows, before deleting.
  const detailCheck = await pool.request().query(`
    SELECT COUNT(*) AS N FROM SalesInvoiceDetail sid JOIN SalesInvoice si ON si.SalesInvoiceID = sid.SalesInvoiceID
    WHERE si.VoucherNo = '${SI_VOUCHER}'
  `);
  const glCheck = await pool.request().query(`SELECT COUNT(*) AS N FROM GeneralLedger WHERE VoucherNo = '${SI_VOUCHER}'`);
  const detailN = (detailCheck.recordset[0] as { N: number }).N;
  const glN = (glCheck.recordset[0] as { N: number }).N;
  if (detailN !== 0 || glN !== 0) {
    console.error(`MISMATCH: diharapkan 0 detail dan 0 GL, ditemukan detail=${detailN} GL=${glN}. Aborting, tidak aman.`);
    await pool.close();
    process.exit(1);
  }

  const snapshotPath = path.join(__dirname, "..", "docs", "data-fixes", "2026-09-11-hapus-si000850-mati-before.json");
  fs.writeFileSync(snapshotPath, JSON.stringify(row, null, 2));
  console.log("Before-snapshot written to", snapshotPath);

  const req = pool.request();
  req.input("id", sql.VarChar(16), row.SalesInvoiceID as string);
  req.input("voucherNo", sql.VarChar(128), SI_VOUCHER);
  const res = await req.query(`
    DELETE FROM SalesInvoice WHERE SalesInvoiceID = @id AND VoucherNo = @voucherNo AND IsDeleted = 1
  `);
  if (res.rowsAffected[0] !== 1) {
    console.error(`DELETE tidak mengenai tepat 1 baris (kena ${res.rowsAffected[0]}). Kemungkinan sudah terhapus atau berubah.`);
    await pool.close();
    process.exit(1);
  }
  console.log(`Committed: baris SalesInvoice ${SI_VOUCHER} (ID ${row.SalesInvoiceID}) dihapus permanen.`);

  const verify = await pool.request().query(`SELECT COUNT(*) AS N FROM SalesInvoice WHERE VoucherNo = '${SI_VOUCHER}'`);
  console.log("Verifikasi sisa baris dengan voucher ini (harus 0):", verify.recordset[0]);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
