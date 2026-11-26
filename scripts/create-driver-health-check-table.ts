// Driver Health Check (Es Kristal / MKEsindo): riwayat pemeriksaan kelayakan
// driver per keberangkatan (satu baris per pemeriksaan; cek ulang menambah
// baris baru), plus nomor & masa berlaku SIM di DashboardDriverSim.
// Idempoten dan aditif — aman diulang, tidak mengubah baris data apa pun.
//
// Usage:
//   npx tsx scripts/create-driver-health-check-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardDriverHealthCheck' AND xtype='U')
    CREATE TABLE DashboardDriverHealthCheck (
      HealthCheckID        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      JadwalID             INT NOT NULL,
      SalesmanID           VARCHAR(16) NOT NULL,
      Sistolik             INT NULL,
      Diastolik            INT NULL,
      KadarAlkohol         DECIMAL(6, 3) NULL,
      PandanganLolos       BIT NULL,
      SimDibawa            BIT NOT NULL,
      SimBerlakuHingga     DATE NULL,
      Lolos                BIT NOT NULL,
      AlasanGagal          NVARCHAR(400) NULL,
      Catatan              NVARCHAR(400) NULL,
      DiperiksaOlehAkunID  INT NOT NULL,
      DiperiksaPada        DATETIME NOT NULL DEFAULT GETDATE(),
      AmbilAlih            BIT NOT NULL DEFAULT 0,
      AmbilAlihAlasan      NVARCHAR(400) NULL,
      AmbilAlihOlehAkunID  INT NULL,
      AmbilAlihPada        DATETIME NULL
    )
  `);
  console.log("Tabel DashboardDriverHealthCheck: siap.");

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.indexes
      WHERE name = 'IX_DashboardDriverHealthCheck_Jadwal_Salesman'
        AND object_id = OBJECT_ID('DashboardDriverHealthCheck')
    )
    CREATE INDEX IX_DashboardDriverHealthCheck_Jadwal_Salesman
      ON DashboardDriverHealthCheck (JadwalID, SalesmanID, HealthCheckID DESC)
  `);
  console.log("Indeks (JadwalID, SalesmanID, HealthCheckID DESC): siap.");

  await pool.request().query(`
    IF COL_LENGTH('DashboardDriverSim', 'NomorSim') IS NULL
      ALTER TABLE DashboardDriverSim ADD NomorSim VARCHAR(30) NULL
  `);
  await pool.request().query(`
    IF COL_LENGTH('DashboardDriverSim', 'BerlakuHingga') IS NULL
      ALTER TABLE DashboardDriverSim ADD BerlakuHingga DATE NULL
  `);
  console.log("Kolom DashboardDriverSim.NomorSim & BerlakuHingga: siap.");

  const kolom = await pool.request().query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN ('DashboardDriverHealthCheck', 'DashboardDriverSim')
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);
  console.table(kolom.recordset);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
