import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

// Revert fix-backfill-snapshot-stop-2026-10-23.ts: kosongkan Kirim* dan
// KirimDibekukanAt pada baris yang bertanda backfill (KirimDibekukanAt =
// '1900-01-01'). Baris yang dibekukan sungguhan (GETDATE() saat DO dibuat)
// tidak disentuh. DeliveryOrder.AddressDelivery memang tidak pernah diubah
// oleh fix, jadi tidak ada yang perlu dikembalikan di sana.
// Default DRY RUN (UPDATE dijalankan lalu di-rollback); --execute untuk menulis.
// Usage: npx tsx scripts/revert-backfill-snapshot-stop-2026-10-23.ts [--execute]

const EXECUTE = process.argv.includes("--execute");

async function main() {
  const pool = await getPool();
  const dbName = (await pool.request().query(`SELECT DB_NAME() AS DbName`)).recordset[0].DbName as string;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const res = await new sql.Request(tx).query(`
      UPDATE DashboardPengirimanJadwalDetail SET
        KirimAlamat = NULL, KirimWilayah = NULL, KirimKecamatan = NULL, KirimKontak = NULL,
        KirimLatitude = NULL, KirimLongitude = NULL, KirimDibekukanAt = NULL
      OUTPUT inserted.JadwalDetailID
      WHERE KirimDibekukanAt = '1900-01-01'
    `);
    console.log(`DB ${dbName}: ${res.recordset.length} baris dikembalikan${EXECUTE ? "" : " (DRY RUN — di-rollback)"}`);
    if (EXECUTE) await tx.commit();
    else await tx.rollback();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
