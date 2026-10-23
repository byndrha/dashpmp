import "dotenv/config";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool, sql } from "../src/lib/db";
import { STOP_LOKASI_JOIN, STOP_LOKASI_COLUMNS } from "../src/lib/queries/mitra-lokasi-pengiriman";

// Backfill snapshot alamat stop — spec 2026-10-23-mitra-identitas-lokasi-pengiriman §6.1.
// Untuk setiap DashboardPengirimanJadwalDetail dengan DeliveryOrderID IS NOT NULL dan
// KirimDibekukanAt IS NULL: isi Kirim* dari resolusi alamat stop SAAT INI
// (STOP_LOKASI_COLUMNS — untuk baris lama LokasiPengirimanID selalu NULL, jadi = bp.* +
// DashboardMitraLocation) dan KirimDibekukanAt = '1900-01-01' sebagai PENANDA backfill
// (beda dari pembekuan asli yang memakai GETDATE()).
// - Idempoten: hanya baris yang masih KirimDibekukanAt IS NULL yang disentuh.
// - DeliveryOrder.AddressDelivery TIDAK disentuh (DO lama tidak diubah).
// - Satu transaksi. Default DRY RUN (UPDATE dijalankan lalu di-rollback); --execute untuk menulis.
// - JANGAN dijalankan dengan --execute sebelum pengguna menyetujui jumlah dari
//   diag-backfill-snapshot-stop-2026-10-23.ts.
// Revert: revert-backfill-snapshot-stop-2026-10-23.ts
// Output (saat --execute): docs/data-fixes/2026-10-23-backfill-snapshot-stop-posted.json
// Usage: npx tsx scripts/fix-backfill-snapshot-stop-2026-10-23.ts [--execute]

const EXECUTE = process.argv.includes("--execute");
const PENANDA = "1900-01-01";

async function main() {
  const pool = await getPool();
  const dbName = (await pool.request().query(`SELECT DB_NAME() AS DbName`)).recordset[0].DbName as string;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const res = await new sql.Request(tx).query(`
      UPDATE t SET
        KirimAlamat = LEFT(x.StopAlamat, 1024),
        KirimWilayah = LEFT(x.StopWilayah, 128),
        KirimKecamatan = LEFT(x.StopKecamatan, 128),
        KirimKontak = LEFT(x.StopKontak, 128),
        KirimLatitude = x.StopLatitude,
        KirimLongitude = x.StopLongitude,
        KirimDibekukanAt = '${PENANDA}'
      OUTPUT inserted.JadwalDetailID
      FROM DashboardPengirimanJadwalDetail t
      JOIN (
        SELECT jd.JadwalDetailID, ${STOP_LOKASI_COLUMNS("jd")}
        FROM DashboardPengirimanJadwalDetail jd
        LEFT JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
        LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
        ${STOP_LOKASI_JOIN("jd", "so")}
        WHERE jd.DeliveryOrderID IS NOT NULL AND jd.KirimDibekukanAt IS NULL
      ) x ON x.JadwalDetailID = t.JadwalDetailID
      WHERE t.DeliveryOrderID IS NOT NULL AND t.KirimDibekukanAt IS NULL
    `);
    const ids = (res.recordset as { JadwalDetailID: number }[]).map((r) => r.JadwalDetailID).sort((a, b) => a - b);
    console.log(`DB ${dbName}: ${ids.length} baris dibekukan${EXECUTE ? "" : " (DRY RUN — di-rollback)"}`);
    if (!EXECUTE) {
      await tx.rollback();
      return;
    }
    await tx.commit();
    const file = join(process.cwd(), "docs", "data-fixes", "2026-10-23-backfill-snapshot-stop-posted.json");
    const lama = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as { jadwalDetailIds: number[] }).jadwalDetailIds
      : [];
    const gabung = [...new Set([...lama, ...ids])].sort((a, b) => a - b);
    writeFileSync(
      file,
      JSON.stringify(
        { dbName, penanda: PENANDA, dijalankanPada: new Date().toISOString(), jumlah: gabung.length, jadwalDetailIds: gabung },
        null,
        2
      )
    );
    console.log(`Ditulis: ${file}`);
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
