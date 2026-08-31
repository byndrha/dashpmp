// One-off schema migration -- introduces Tahap 4's "Kas Kecil" (petty
// cash) tracking: a per-shift shift-level table for Kas Masuk top-ups, an
// itemized child table for pengeluaran (expense) line items, and a
// singleton SaldoAwal table as the running-balance starting point -- see
// docs/superpowers/specs/2026-08-31-modul-laporan-tahap4-aktivitas-keuangan-operasional-design.md.
// Idempotent. Usage: npx tsx scripts/add-kas-kecil-tahap4.ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

async function tableExists(pool: sql.ConnectionPool, table: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("table", sql.VarChar, table)
    .query(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @table`);
  return result.recordset.length > 0;
}

async function main() {
  const pool = await getPool();

  if (!(await tableExists(pool, "DashboardKasKecilShift"))) {
    await pool.request().query(`
      CREATE TABLE DashboardKasKecilShift (
        KasKecilShiftID INT IDENTITY PRIMARY KEY,
        TanggalUsaha DATE NOT NULL,
        Shift TINYINT NOT NULL,
        ShiftMulai DATETIME NOT NULL,
        KasMasuk DECIMAL(18,2) NOT NULL DEFAULT 0,
        DiisiOlehAkunID INT NULL,
        CreatedDate DATETIME NOT NULL DEFAULT GETDATE(),
        ModifiedDate DATETIME NULL,
        CONSTRAINT UQ_KasKecilShift_TanggalShift UNIQUE (TanggalUsaha, Shift)
      )
    `);
    console.log("Created DashboardKasKecilShift.");
  } else {
    console.log("DashboardKasKecilShift already exists -- nothing to do.");
  }

  if (!(await tableExists(pool, "DashboardKasKecilPengeluaran"))) {
    await pool.request().query(`
      CREATE TABLE DashboardKasKecilPengeluaran (
        PengeluaranID INT IDENTITY PRIMARY KEY,
        KasKecilShiftID INT NOT NULL,
        Keterangan VARCHAR(200) NOT NULL,
        Nominal DECIMAL(18,2) NOT NULL,
        DicatatOlehAkunID INT NOT NULL,
        CreatedDate DATETIME NOT NULL DEFAULT GETDATE(),
        ModifiedDate DATETIME NULL
      )
    `);
    console.log("Created DashboardKasKecilPengeluaran.");
  } else {
    console.log("DashboardKasKecilPengeluaran already exists -- nothing to do.");
  }

  if (!(await tableExists(pool, "DashboardKasKecilSaldoAwal"))) {
    await pool.request().query(`
      CREATE TABLE DashboardKasKecilSaldoAwal (
        SaldoAwal DECIMAL(18,2) NOT NULL DEFAULT 0,
        DiisiOlehAkunID INT NULL,
        ModifiedDate DATETIME NULL
      )
    `);
    console.log("Created DashboardKasKecilSaldoAwal.");
  } else {
    console.log("DashboardKasKecilSaldoAwal already exists -- nothing to do.");
  }

  const existingSaldo = await pool.request().query(`SELECT COUNT(*) AS Total FROM DashboardKasKecilSaldoAwal`);
  if ((existingSaldo.recordset[0] as { Total: number }).Total === 0) {
    await pool.request().query(`INSERT INTO DashboardKasKecilSaldoAwal (SaldoAwal) VALUES (0)`);
    console.log("Seeded DashboardKasKecilSaldoAwal with SaldoAwal=0.");
  } else {
    console.log("DashboardKasKecilSaldoAwal already has a row -- skip seed.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
