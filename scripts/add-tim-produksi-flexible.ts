// One-off schema migration -- introduces flexible, named Tim Produksi
// (Tim A/B/C) decoupled from shift number, a monthly Jadwal Tim table, and
// a TimID column on DashboardAktivitasProduksiShift for live corrections --
// see docs/superpowers/specs/2026-08-30-tim-produksi-penjadwalan-fleksibel-design.md.
// DashboardTimProduksiAnggota was confirmed EMPTY in the live DB before this
// migration (no real member data existed yet), so its Shift->TimID column
// swap is a clean replacement, not a data migration. Idempotent.
// Usage: npx tsx scripts/add-tim-produksi-flexible.ts
import "dotenv/config";
import { getPool, sql } from "../src/lib/db";

const ROSTER: Record<string, string[]> = {
  "Tim A": ["Fendianto", "Irfan", "Aldo", "Deva", "Bayu"],
  "Tim B": ["Hartoyo", "Fian", "Reza", "Danar", "Rozi", "Bima"],
  "Tim C": ["Maicha", "Nizam", "Arif", "Dika", "Raga", "Bagas", "Rayhan"],
};

async function columnExists(pool: sql.ConnectionPool, table: string, column: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("table", sql.VarChar, table)
    .input("column", sql.VarChar, column)
    .query(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table AND COLUMN_NAME = @column`);
  return result.recordset.length > 0;
}

async function tableExists(pool: sql.ConnectionPool, table: string): Promise<boolean> {
  const result = await pool
    .request()
    .input("table", sql.VarChar, table)
    .query(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @table`);
  return result.recordset.length > 0;
}

async function main() {
  const pool = await getPool();

  if (!(await tableExists(pool, "DashboardTimProduksi"))) {
    await pool.request().query(`
      CREATE TABLE DashboardTimProduksi (
        TimID INT IDENTITY PRIMARY KEY,
        Nama VARCHAR(50) NOT NULL,
        KepalaAkunID INT NULL,
        IsDeleted BIT NOT NULL DEFAULT 0,
        CreatedDate DATETIME NOT NULL DEFAULT GETDATE(),
        ModifiedDate DATETIME NULL
      )
    `);
    console.log("Created DashboardTimProduksi.");
  } else {
    console.log("DashboardTimProduksi already exists -- nothing to do.");
  }

  if (!(await tableExists(pool, "DashboardJadwalTimProduksi"))) {
    await pool.request().query(`
      CREATE TABLE DashboardJadwalTimProduksi (
        JadwalID INT IDENTITY PRIMARY KEY,
        TanggalUsaha DATE NOT NULL,
        Shift TINYINT NOT NULL,
        TimID INT NOT NULL,
        CreatedByAkunID INT NOT NULL,
        ModifiedDate DATETIME NULL,
        CONSTRAINT UQ_JadwalTim_TanggalShift UNIQUE (TanggalUsaha, Shift)
      )
    `);
    console.log("Created DashboardJadwalTimProduksi.");
  } else {
    console.log("DashboardJadwalTimProduksi already exists -- nothing to do.");
  }

  if (await columnExists(pool, "DashboardTimProduksiAnggota", "Shift")) {
    await pool.request().query(`ALTER TABLE DashboardTimProduksiAnggota DROP COLUMN Shift`);
    await pool.request().query(`ALTER TABLE DashboardTimProduksiAnggota ADD TimID INT NOT NULL`);
    console.log("Replaced DashboardTimProduksiAnggota.Shift with TimID.");
  } else if (!(await columnExists(pool, "DashboardTimProduksiAnggota", "TimID"))) {
    await pool.request().query(`ALTER TABLE DashboardTimProduksiAnggota ADD TimID INT NOT NULL`);
    console.log("Added DashboardTimProduksiAnggota.TimID.");
  } else {
    console.log("DashboardTimProduksiAnggota.TimID already exists -- nothing to do.");
  }

  if (!(await columnExists(pool, "DashboardAktivitasProduksiShift", "TimID"))) {
    await pool.request().query(`ALTER TABLE DashboardAktivitasProduksiShift ADD TimID INT NULL`);
    console.log("Added DashboardAktivitasProduksiShift.TimID.");
  } else {
    console.log("DashboardAktivitasProduksiShift.TimID already exists -- nothing to do.");
  }

  const existingTim = await pool.request().query(`SELECT COUNT(*) AS Total FROM DashboardTimProduksi`);
  if ((existingTim.recordset[0] as { Total: number }).Total === 0) {
    for (const [nama, anggotaList] of Object.entries(ROSTER)) {
      const timResult = await pool
        .request()
        .input("nama", sql.VarChar(50), nama)
        .query(`INSERT INTO DashboardTimProduksi (Nama) OUTPUT INSERTED.TimID VALUES (@nama)`);
      const timId = (timResult.recordset[0] as { TimID: number }).TimID;
      for (const namaAnggota of anggotaList) {
        await pool
          .request()
          .input("timId", sql.Int, timId)
          .input("nama", sql.VarChar(100), namaAnggota)
          .query(`INSERT INTO DashboardTimProduksiAnggota (TimID, Nama) VALUES (@timId, @nama)`);
      }
      console.log(`Seeded ${nama} (TimID ${timId}) dengan ${anggotaList.length} anggota.`);
    }
  } else {
    console.log("DashboardTimProduksi sudah ada isinya -- skip seed.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
