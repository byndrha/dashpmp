import "dotenv/config";
import { getPool } from "@/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardLaporanShiftStokEsSnapshot' AND xtype='U')
    BEGIN
      CREATE TABLE DashboardLaporanShiftStokEsSnapshot (
        SnapshotID INT IDENTITY PRIMARY KEY,
        TanggalUsaha DATE NOT NULL,
        Shift TINYINT NOT NULL,
        TotalSisaQty10KG DECIMAL(18,2) NOT NULL,
        CreatedDate DATETIME NOT NULL,
        IsDeleted BIT NOT NULL DEFAULT 0,
        CONSTRAINT UQ_LaporanShiftStokEsSnapshot UNIQUE (TanggalUsaha, Shift)
      )
    END
  `);

  console.log("DashboardLaporanShiftStokEsSnapshot ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
