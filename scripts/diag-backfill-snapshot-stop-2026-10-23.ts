import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/lib/db";
import { STOP_LOKASI_JOIN, STOP_LOKASI_COLUMNS } from "../src/lib/queries/mitra-lokasi-pengiriman";

// DRY-RUN (SELECT saja) backfill snapshot alamat stop — spec
// 2026-10-23-mitra-identitas-lokasi-pengiriman §6.1 "Pembekuan alamat per stop".
// Menghitung DashboardPengirimanJadwalDetail yang sudah punya DeliveryOrderID
// tetapi belum dibekukan (KirimDibekukanAt IS NULL), lalu menulis ringkasan +
// contoh nilai yang AKAN diisi fix-backfill-snapshot-stop-2026-10-23.ts.
// DB target = getPool() bawaan (mkesindo; ESKRISTAL_PERUSAHAAN_KODE untuk tenant lain).
// Output: docs/data-fixes/2026-10-23-backfill-snapshot-stop-dryrun.json
// Usage: npx tsx scripts/diag-backfill-snapshot-stop-2026-10-23.ts

async function main() {
  const pool = await getPool();
  const dbName = (await pool.request().query(`SELECT DB_NAME() AS DbName`)).recordset[0].DbName as string;

  const ringkasan = (
    await pool.request().query(`
      SELECT
        COUNT(*) AS Kandidat,
        SUM(CASE WHEN jd.IsDeleted = 0 THEN 1 ELSE 0 END) AS KandidatAktif,
        SUM(CASE WHEN jd.IsDeleted = 1 THEN 1 ELSE 0 END) AS KandidatTerhapus,
        SUM(CASE WHEN jd.LokasiPengirimanID IS NOT NULL THEN 1 ELSE 0 END) AS KandidatDenganLokasiTerpilih,
        SUM(CASE WHEN ml.BusinessPartnerID IS NULL THEN 1 ELSE 0 END) AS KandidatTanpaPinUtama,
        SUM(CASE WHEN so.SalesOrderID IS NULL THEN 1 ELSE 0 END) AS KandidatTanpaSalesOrder,
        MIN(jd.JadwalDetailID) AS MinJadwalDetailID,
        MAX(jd.JadwalDetailID) AS MaxJadwalDetailID
      FROM DashboardPengirimanJadwalDetail jd
      LEFT JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      ${STOP_LOKASI_JOIN("jd", "so")}
      WHERE jd.DeliveryOrderID IS NOT NULL AND jd.KirimDibekukanAt IS NULL
    `)
  ).recordset[0];
  const sudahBeku = (
    await pool.request().query(`
      SELECT COUNT(*) AS SudahBeku,
             SUM(CASE WHEN KirimDibekukanAt = '1900-01-01' THEN 1 ELSE 0 END) AS SudahBekuPenandaBackfill
      FROM DashboardPengirimanJadwalDetail WHERE KirimDibekukanAt IS NOT NULL
    `)
  ).recordset[0];
  const contoh = (
    await pool.request().query(`
      SELECT TOP 25 jd.JadwalDetailID, jd.JadwalID, jd.DeliveryOrderID, jd.IsDeleted, ${STOP_LOKASI_COLUMNS("jd")}
      FROM DashboardPengirimanJadwalDetail jd
      LEFT JOIN SalesOrder so ON so.SalesOrderID = jd.SalesOrderID
      LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = so.BusinessPartnerID
      ${STOP_LOKASI_JOIN("jd", "so")}
      WHERE jd.DeliveryOrderID IS NOT NULL AND jd.KirimDibekukanAt IS NULL
      ORDER BY jd.JadwalDetailID DESC
    `)
  ).recordset;

  const out = { dibuatPada: new Date().toISOString(), dbName, ringkasan, sudahBeku, contohTerbaru: contoh };
  const file = join(process.cwd(), "docs", "data-fixes", "2026-10-23-backfill-snapshot-stop-dryrun.json");
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`DB ${dbName}:`, JSON.stringify(ringkasan), JSON.stringify(sudahBeku));
  console.log(`Ditulis: ${file}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
