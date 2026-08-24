// One-off backfill: DashboardPengirimanJadwalDetail rows belonging to an
// already-Terbit Jadwal whose stop went through selesaiMuat()'s
// merged-external-DO branch BEFORE that branch was fixed to also create a
// SalesInvoice (2026-08-24) — these stops have a real DeliveryOrder but no
// SalesInvoice anywhere, which also means no print pipeline / no aging /
// no outstanding-balance visibility for them. Creates the missing
// SalesInvoice (full ordered qty/amount, same "SI Awal" shape selesaiMuat
// itself uses) via the same createSalesInvoiceForStop() helper, or links an
// already-existing SalesInvoice for that DeliveryOrderID if one turns out
// to exist (invoiced directly in the desktop ERP) — never creates a
// duplicate. Deliberately does NOT enqueue a print job: these are
// historical deliveries, not something to physically reprint.
//
// Usage:
//   npx tsx scripts/backfill-missing-sales-invoice.ts          (dry run — lists only)
//   npx tsx scripts/backfill-missing-sales-invoice.ts --apply  (writes for real)
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";
import { createSalesInvoiceForStop } from "../src/lib/queries/pengiriman-jadwal";

const APPLY = process.argv.includes("--apply");

async function main() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT jd.JadwalDetailID, jd.SalesOrderID, jd.DeliveryOrderID, j.JadwalID, j.SalesmanID, j.JamSelesaiMuat
    FROM DashboardPengirimanJadwal j
    JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
    WHERE j.IsDeleted = 0 AND j.Status = 'Terbit' AND jd.SalesInvoiceID IS NULL AND jd.DeliveryOrderID IS NOT NULL
    ORDER BY j.JamSelesaiMuat
  `);
  const rows = result.recordset as {
    JadwalDetailID: number;
    SalesOrderID: string;
    DeliveryOrderID: string;
    JadwalID: number;
    SalesmanID: string | null;
    JamSelesaiMuat: Date;
  }[];

  console.log(`Found ${rows.length} stop(s) missing a SalesInvoice.`);
  if (!APPLY) console.log("DRY RUN — pass --apply to actually write. Listing what would happen:\n");

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let created = 0;
  let linked = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const existingSiResult = await pool
        .request()
        .input("doId", sql.VarChar(16), row.DeliveryOrderID)
        .query(
          `SELECT SalesInvoiceID FROM SalesInvoice WHERE REPLACE(DeliveryOrderID, '''', '') = @doId AND IsDeleted = 0`
        );
      const existingSalesInvoiceId = (existingSiResult.recordset[0] as { SalesInvoiceID: string } | undefined)
        ?.SalesInvoiceID;

      if (existingSalesInvoiceId) {
        console.log(
          `[LINK] JadwalDetailID=${row.JadwalDetailID} JadwalID=${row.JadwalID} DO=${row.DeliveryOrderID} -> existing SI=${existingSalesInvoiceId}`
        );
        if (APPLY) {
          await pool
            .request()
            .input("detailId", sql.Int, row.JadwalDetailID)
            .input("siId", sql.VarChar(16), existingSalesInvoiceId)
            .query(`UPDATE DashboardPengirimanJadwalDetail SET SalesInvoiceID = @siId WHERE JadwalDetailID = @detailId`);
        }
        linked++;
        continue;
      }

      console.log(
        `[CREATE] JadwalDetailID=${row.JadwalDetailID} JadwalID=${row.JadwalID} SO=${row.SalesOrderID} DO=${row.DeliveryOrderID} (Selesai Muat ${row.JamSelesaiMuat.toISOString()})`
      );
      if (APPLY) {
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
          const salesInvoiceId = await createSalesInvoiceForStop(transaction, {
            jadwalDetailId: row.JadwalDetailID,
            salesOrderId: row.SalesOrderID,
            deliveryOrderId: row.DeliveryOrderID,
            salesmanId: row.SalesmanID,
            yearMonth,
          });
          await transaction.commit();
          console.log(`  -> created SalesInvoiceID=${salesInvoiceId}`);
        } catch (err) {
          await transaction.rollback();
          throw err;
        }
      }
      created++;
    } catch (err) {
      failed++;
      console.error(`[FAIL] JadwalDetailID=${row.JadwalDetailID}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nSummary: ${created} to create, ${linked} to link, ${failed} failed.${APPLY ? "" : " (dry run — nothing written)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
