// Migrasi skema (aditif, idempoten, aman dijalankan ulang) untuk proyek
// "Mitra: identitas, alamat mitra & lokasi pengiriman ganda"
// (docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md §6).
//
//   - Es Kristal (MKEsindo + DemoEsKristal, lewat perusahaan_koneksi label
//     "utama"): DashboardMitraAlamat, DashboardMitraLokasiPengiriman, kolom
//     snapshot di DashboardPengirimanJadwalDetail, KompetitorIDs di
//     DashboardMitraPengajuan.
//   - Es Balok (5 DB fisik): DashboardAgenAlamat, DashboardAgenLokasiPengiriman
//     (Wilayah -> WilayahID), Kecamatan di DashboardAgenProfil.
//   - Postgres direktori: mitra_identitas, kompetitor, mitra_kompetitor.
//
// Hanya CREATE/ADD yang dijaga IF NOT EXISTS -- tidak pernah DROP, tidak
// pernah ALTER kolom yang sudah ada, tidak menyentuh data. Setiap target
// dijalankan berurutan dan berhenti di error pertama. DB_NAME() setiap
// target dicek dulu sebelum DDL dijalankan.
//
// Usage: npx tsx scripts/create-mitra-lokasi-identitas-schema.ts
import "dotenv/config";
import type sql from "mssql";
import { getPgPool } from "../src/lib/pg";
import { getCompanyPool, type CompanyKoneksiLabel } from "../src/lib/db-company";

type Target = { kode: string; label: CompanyKoneksiLabel; db: string };

// Es Kristal: kode perusahaan yang punya baris perusahaan_koneksi "utama"
// (diverifikasi ke Postgres saat jalan).
const ES_KRISTAL_TARGETS: Target[] = [
  { kode: "mkesindo", label: "utama", db: "MKEsindo" },
  { kode: "demokristal", label: "utama", db: "DemoEsKristal" },
];

// Es Balok: 5 DB fisik (logistik pmpersada & pmpakis = satu DB bersama
// FINAC_PMP_LOGISTIC, cukup sekali).
const ES_BALOK_TARGETS: Target[] = [
  { kode: "pmputra", label: "utama", db: "FINAC_ES_PO" },
  { kode: "pmputra", label: "logistik", db: "FINAC_LOGISTIC_PO" },
  { kode: "pmpersada", label: "utama", db: "FINAC_ES_TB" },
  { kode: "pmpersada", label: "logistik", db: "FINAC_PMP_LOGISTIC" },
  { kode: "pmpakis", label: "utama", db: "FINAC_ES_PAKIS" },
];

async function openTarget(t: Target): Promise<sql.ConnectionPool> {
  const pool = await getCompanyPool(t.kode, t.label);
  const dbName = (await pool.request().query(`SELECT DB_NAME() AS DbName`)).recordset[0].DbName as string;
  console.log(`\n== ${t.kode}/${t.label} -> DB_NAME() = ${dbName}`);
  if (dbName !== t.db) {
    throw new Error(`DB_NAME() ${t.kode}/${t.label} = "${dbName}", diharapkan "${t.db}" -- dibatalkan`);
  }
  return pool;
}

async function createTable(pool: sql.ConnectionPool, db: string, name: string, body: string) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${name}' AND xtype='U')
    CREATE TABLE ${name} (${body})
  `);
  console.log(`[${db}] ${name} siap.`);
}

async function addColumn(pool: sql.ConnectionPool, db: string, table: string, column: string, def: string) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('${table}') AND name = '${column}'
    )
    ALTER TABLE ${table} ADD ${column} ${def}
  `);
  console.log(`[${db}] ${table}.${column} siap.`);
}

async function createIndex(pool: sql.ConnectionPool, db: string, table: string, index: string, column: string) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('${table}') AND name = '${index}'
    )
    CREATE INDEX ${index} ON ${table} (${column})
  `);
  console.log(`[${db}] index ${index} siap.`);
}

// Kolom bersama alamat/lokasi (spec §6.1). Es Balok memakai WilayahID
// (PMP_Wilayah.WilayahID) sebagai pengganti Wilayah.
function alamatCols(wilayahCol: string): string {
  return `
      ${wilayahCol} NULL,
      Kecamatan VARCHAR(128) NULL,
      Alamat VARCHAR(1024) NULL,
      Kontak VARCHAR(128) NULL`;
}

const AUDIT_COLS = `
      CreatedByUserID VARCHAR(16) NULL,
      UpdatedByUserID VARCHAR(16) NULL,
      CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
      UpdatedAt DATETIME NOT NULL DEFAULT GETDATE()`;

function lokasiCols(keyCol: string, wilayahCol: string): string {
  return `
      LokasiPengirimanID INT IDENTITY PRIMARY KEY,
      ${keyCol} VARCHAR(16) NOT NULL,
      Urutan INT NOT NULL,
      Label VARCHAR(64) NULL,${alamatCols(wilayahCol)},
      Latitude DECIMAL(10,7) NULL,
      Longitude DECIMAL(10,7) NULL,
      GeoAlamat VARCHAR(512) NULL,
      IsDeleted BIT NOT NULL DEFAULT 0,${AUDIT_COLS}`;
}

async function esKristal(t: Target) {
  const pool = await openTarget(t);
  const db = t.db;

  await createTable(pool, db, "DashboardMitraAlamat", `
      BusinessPartnerID VARCHAR(16) NOT NULL PRIMARY KEY,${alamatCols("Wilayah VARCHAR(128)")},${AUDIT_COLS}
  `);

  await createTable(pool, db, "DashboardMitraLokasiPengiriman", lokasiCols("BusinessPartnerID", "Wilayah VARCHAR(128)"));
  await createIndex(pool, db, "DashboardMitraLokasiPengiriman",
    "IX_DashboardMitraLokasiPengiriman_BusinessPartnerID", "BusinessPartnerID");

  const jd = "DashboardPengirimanJadwalDetail";
  await addColumn(pool, db, jd, "LokasiPengirimanID", "INT NULL");
  await addColumn(pool, db, jd, "KirimAlamat", "VARCHAR(1024) NULL");
  await addColumn(pool, db, jd, "KirimWilayah", "VARCHAR(128) NULL");
  await addColumn(pool, db, jd, "KirimKecamatan", "VARCHAR(128) NULL");
  await addColumn(pool, db, jd, "KirimKontak", "VARCHAR(128) NULL");
  await addColumn(pool, db, jd, "KirimLatitude", "DECIMAL(10,7) NULL");
  await addColumn(pool, db, jd, "KirimLongitude", "DECIMAL(10,7) NULL");
  await addColumn(pool, db, jd, "KirimDibekukanAt", "DATETIME NULL");

  await addColumn(pool, db, "DashboardMitraPengajuan", "KompetitorIDs", "VARCHAR(512) NULL");
}

async function esBalok(t: Target) {
  const pool = await openTarget(t);
  const db = t.db;

  await createTable(pool, db, "DashboardAgenAlamat", `
      AgenID VARCHAR(16) NOT NULL PRIMARY KEY,${alamatCols("WilayahID VARCHAR(16)")},${AUDIT_COLS}
  `);

  await createTable(pool, db, "DashboardAgenLokasiPengiriman", lokasiCols("AgenID", "WilayahID VARCHAR(16)"));
  await createIndex(pool, db, "DashboardAgenLokasiPengiriman", "IX_DashboardAgenLokasiPengiriman_AgenID", "AgenID");

  await addColumn(pool, db, "DashboardAgenProfil", "Kecamatan", "VARCHAR(128) NULL");
}

async function postgres() {
  const pg = getPgPool();
  console.log("\n== Postgres direktori");

  // Pastikan target Es Kristal memang punya koneksi "utama".
  const rows = (
    await pg.query<{ kode: string; db_name: string }>(
      `SELECT p.kode, k.db_name FROM perusahaan p
       JOIN perusahaan_koneksi k ON k.perusahaan_id = p.id
       WHERE k.label = 'utama' AND p.kode = ANY($1)`,
      [ES_KRISTAL_TARGETS.map((t) => t.kode)]
    )
  ).rows;
  for (const t of ES_KRISTAL_TARGETS) {
    const r = rows.find((x) => x.kode === t.kode);
    if (!r) throw new Error(`Tidak ada perusahaan_koneksi "utama" untuk ${t.kode}`);
    console.log(`perusahaan_koneksi ${t.kode}/utama -> ${r.db_name}`);
  }

  await pg.query(`
    CREATE TABLE IF NOT EXISTS mitra_identitas (
      perusahaan_kode text NOT NULL,
      sumber text NOT NULL CHECK (sumber IN ('utama','logistik')),
      partner_id text NOT NULL,
      nama_penanggung_jawab text NULL,
      nik text NULL,
      nik_file_id text NULL,
      nik_file_nama text NULL,
      nik_file_mime text NULL,
      sk_file_id text NULL,
      sk_file_nama text NULL,
      sk_file_mime text NULL,
      tanggal_pendaftaran date NULL,
      updated_by text NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (perusahaan_kode, sumber, partner_id)
    )
  `);
  console.log("[postgres] mitra_identitas siap.");

  await pg.query(`
    CREATE TABLE IF NOT EXISTS kompetitor (
      id serial PRIMARY KEY,
      holding_kode text NOT NULL,
      nama text NOT NULL,
      bisnis text NOT NULL CHECK (bisnis IN ('es_kristal','es_balok')),
      created_by text NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pg.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS kompetitor_holding_nama_bisnis_uniq
      ON kompetitor (holding_kode, lower(trim(nama)), bisnis)
  `);
  console.log("[postgres] kompetitor siap.");

  await pg.query(`
    CREATE TABLE IF NOT EXISTS mitra_kompetitor (
      perusahaan_kode text NOT NULL,
      sumber text NOT NULL CHECK (sumber IN ('utama','logistik')),
      partner_id text NOT NULL,
      kompetitor_id int NOT NULL REFERENCES kompetitor(id) ON DELETE CASCADE,
      PRIMARY KEY (perusahaan_kode, sumber, partner_id, kompetitor_id)
    )
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS mitra_kompetitor_kompetitor_id_idx ON mitra_kompetitor (kompetitor_id)
  `);
  console.log("[postgres] mitra_kompetitor siap.");
}

async function main() {
  await postgres();
  for (const t of ES_KRISTAL_TARGETS) await esKristal(t);
  for (const t of ES_BALOK_TARGETS) await esBalok(t);
  console.log("\nSelesai.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
