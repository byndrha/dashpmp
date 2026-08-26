// One-off backfill for the SalesOrder.SalesmanID bug fixed in
// syncSalesOrderSalesman (pengiriman-jadwal.ts): updateJadwalDriverTime and
// addSalesOrdersToJadwal never propagated a Jadwal's driver to the
// SalesOrder rows it schedules, so every SO created/scheduled through
// /mkesindo/pemesanan or Papan Pengiriman before this fix has a blank
// SalesmanID even though its Jadwal and resulting DeliveryOrder both have
// the correct driver — this is why the desktop ERP shows no Salesman on
// these SOs. Live-confirmed root cause: MKE/SO/003911/2026-08/003/001
// (SalesOrderID 01218555), 2026-08-26.
//
// Dry-run by default (prints what would change, touches nothing). Pass
// --apply to actually update.
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = await getPool();

  const affected = await pool.request().query(`
    SELECT so.SalesOrderID, so.VoucherNo, so.TransDate, jh.SalesmanID, sm.Name AS DriverName
    FROM SalesOrder so
    JOIN DashboardPengirimanJadwalDetail jd ON jd.SalesOrderID = so.SalesOrderID AND jd.IsDeleted = 0
    JOIN DashboardPengirimanJadwal jh ON jh.JadwalID = jd.JadwalID AND jh.IsDeleted = 0
    LEFT JOIN Salesman sm ON sm.SalesmanID = jh.SalesmanID
    WHERE so.IsDeleted = 0
      AND jh.SalesmanID IS NOT NULL AND jh.SalesmanID <> ''
      AND (so.SalesmanID IS NULL OR so.SalesmanID = '')
    ORDER BY so.TransDate
  `);
  const rows = affected.recordset as {
    SalesOrderID: string;
    VoucherNo: string;
    TransDate: Date;
    SalesmanID: string;
    DriverName: string | null;
  }[];

  console.log(`Found ${rows.length} SalesOrder rows with a real Jadwal driver but blank SalesOrder.SalesmanID.`);
  for (const r of rows) {
    console.log(`  ${r.VoucherNo} (${r.SalesOrderID}) -> ${r.SalesmanID} (${r.DriverName ?? "?"})`);
  }

  if (!apply) {
    console.log("\nDry run only — no changes made. Re-run with --apply to update these rows.");
    process.exit(0);
  }

  console.log(`\nApplying ${rows.length} updates...`);
  let updated = 0;
  for (const r of rows) {
    const result = await pool
      .request()
      .input("soId", sql.VarChar(16), r.SalesOrderID)
      .input("salesmanId", sql.VarChar(16), r.SalesmanID)
      .query(
        `UPDATE SalesOrder SET SalesmanID = @salesmanId, ModifiedDate = GETDATE() WHERE SalesOrderID = @soId AND (SalesmanID IS NULL OR SalesmanID = '')`
      );
    if (result.rowsAffected[0] > 0) updated++;
  }
  console.log(`Done: ${updated}/${rows.length} rows updated.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
