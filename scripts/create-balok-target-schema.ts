// Migrasi skema (aditif, idempoten, aman dijalankan ulang) untuk panel
// "Target Revenue vs Realisasi" di modul Penjualan Es Balok
// (src/lib/queries/penjualan-es-balok.ts -> getTargetBalok/setTargetBalok).
//
// Membuat DashboardBalokTarget di DB "utama" milik tiap PT Es Balok. Hanya
// CREATE TABLE IF NOT EXISTS — tidak pernah DROP/ALTER, tidak menyentuh data.
// DB_NAME() tiap target dicek dulu sebelum DDL dijalankan.
//
// Usage: npx tsx scripts/create-balok-target-schema.ts
import "dotenv/config";
import { getCompanyPool } from "../src/lib/db-company";

const TARGETS = [
  { kode: "pmputra", db: "FINAC_ES_PO" },
  { kode: "pmpersada", db: "FINAC_ES_TB" },
  { kode: "pmpakis", db: "FINAC_ES_PAKIS" },
];

async function main() {
  for (const t of TARGETS) {
    const pool = await getCompanyPool(t.kode, "utama");
    const dbName = (await pool.request().query(`SELECT DB_NAME() AS db`)).recordset[0].db as string;
    if (dbName !== t.db) throw new Error(`${t.kode}: DB_NAME()=${dbName}, diharapkan ${t.db} — berhenti`);
    await pool.request().query(`
      IF OBJECT_ID('DashboardBalokTarget', 'U') IS NULL
      CREATE TABLE DashboardBalokTarget (
        TargetYear int NOT NULL,
        TargetMonth int NOT NULL,
        TargetNominal decimal(23,4) NOT NULL,
        TargetQty decimal(23,4) NOT NULL,
        CreatedByUserID varchar(64) NULL,
        UpdatedByUserID varchar(64) NULL,
        CreatedAt datetime NOT NULL DEFAULT GETDATE(),
        UpdatedAt datetime NULL,
        CONSTRAINT PK_DashboardBalokTarget PRIMARY KEY (TargetYear, TargetMonth)
      )
    `);
    const ada = (await pool.request().query(`SELECT OBJECT_ID('DashboardBalokTarget','U') AS id`)).recordset[0].id;
    console.log(`${t.kode} (${dbName}): DashboardBalokTarget ${ada ? "OK" : "GAGAL"}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
