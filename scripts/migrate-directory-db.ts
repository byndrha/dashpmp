// Idempotent setup for the Postgres "directory" DB — creates pmp_directory
// (if missing), its 3 tables, and seeds the two Perusahaan rows + PMPutra's
// two DB connection entries. Safe to re-run.
//
// Usage: npx tsx scripts/migrate-directory-db.ts
import "dotenv/config";
import { Client } from "pg";
import { encryptSecret } from "../src/lib/crypto-secret";

const DIRECTORY_DB_NAME = process.env.DIRECTORY_DB_NAME || "pmp_directory";

async function ensureDatabaseExists() {
  // Connect to the always-present "postgres" DB first — CREATE DATABASE
  // can't target the database the connection is already using, and can't
  // run inside a transaction block either (pg's single query() calls run
  // each statement outside an implicit transaction, so this is safe).
  const client = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: "postgres",
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DIRECTORY_DB_NAME]);
    if (exists.rowCount === 0) {
      // Identifier can't be parameterized — DIRECTORY_DB_NAME comes from our
      // own .env, not user input.
      await client.query(`CREATE DATABASE ${DIRECTORY_DB_NAME}`);
      console.log(`Created database "${DIRECTORY_DB_NAME}".`);
    } else {
      console.log(`Database "${DIRECTORY_DB_NAME}" already exists.`);
    }
  } finally {
    await client.end();
  }
}

async function migrateSchema() {
  const client = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: DIRECTORY_DB_NAME,
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS perusahaan (
        id SERIAL PRIMARY KEY,
        kode VARCHAR(32) NOT NULL UNIQUE,
        nama VARCHAR(128) NOT NULL,
        jenis_bisnis VARCHAR(128),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS perusahaan_koneksi (
        id SERIAL PRIMARY KEY,
        perusahaan_id INT NOT NULL REFERENCES perusahaan(id),
        label VARCHAR(64) NOT NULL,
        db_engine VARCHAR(16) NOT NULL DEFAULT 'mssql',
        host VARCHAR(256) NOT NULL,
        port INT NOT NULL DEFAULT 1433,
        db_name VARCHAR(128) NOT NULL,
        db_user VARCHAR(128) NOT NULL,
        db_password_encrypted VARCHAR(512) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (perusahaan_id, label)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS akun_direktori (
        id SERIAL PRIMARY KEY,
        username VARCHAR(128) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        nama VARCHAR(128) NOT NULL,
        email VARCHAR(128),
        scope VARCHAR(16) NOT NULL,
        perusahaan_id INT REFERENCES perusahaan(id),
        is_active BOOLEAN NOT NULL DEFAULT true,
        failed_login_count INT NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
        last_login_at TIMESTAMPTZ,
        last_login_ip VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    console.log("Tables ensured.");

    await client.query(
      `INSERT INTO perusahaan (kode, nama, jenis_bisnis) VALUES ($1, $2, $3) ON CONFLICT (kode) DO NOTHING`,
      ["mkesindo", "PT Mitra Kelola Esindo", "Es Kristal"]
    );
    await client.query(
      `INSERT INTO perusahaan (kode, nama, jenis_bisnis) VALUES ($1, $2, $3) ON CONFLICT (kode) DO NOTHING`,
      ["pmputra", "PT Prima Maesa Putra", "Es Balok"]
    );
    console.log("Perusahaan rows seeded.");

    const pmputraRow = await client.query(`SELECT id FROM perusahaan WHERE kode = 'pmputra'`);
    const pmputraId = pmputraRow.rows[0].id as number;

    const pmputraHost = process.env.PMPUTRA_DB_HOST || "";
    const pmputraPort = Number(process.env.PMPUTRA_DB_PORT || 1433);
    const pmputraUser = process.env.PMPUTRA_DB_USER || "";
    const pmputraPasswordEncrypted = encryptSecret(process.env.PMPUTRA_DB_PASSWORD || "");

    for (const [label, dbNameEnvKey] of [
      ["utama", "PMPUTRA_DB_NAME_UTAMA"],
      ["logistik", "PMPUTRA_DB_NAME_LOGISTIK"],
    ] as const) {
      const dbName = process.env[dbNameEnvKey] || "";
      await client.query(
        `INSERT INTO perusahaan_koneksi (perusahaan_id, label, db_engine, host, port, db_name, db_user, db_password_encrypted)
         VALUES ($1, $2, 'mssql', $3, $4, $5, $6, $7)
         ON CONFLICT (perusahaan_id, label) DO UPDATE
         SET host = EXCLUDED.host, port = EXCLUDED.port, db_name = EXCLUDED.db_name,
             db_user = EXCLUDED.db_user, db_password_encrypted = EXCLUDED.db_password_encrypted,
             updated_at = now()`,
        [pmputraId, label, pmputraHost, pmputraPort, dbName, pmputraUser, pmputraPasswordEncrypted]
      );
    }
    console.log("perusahaan_koneksi rows seeded/updated (utama -> FINAC_ES_PO, logistik -> FINAC_LOGISTIC_PO).");
  } finally {
    await client.end();
  }
}

async function verify() {
  const client = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: DIRECTORY_DB_NAME,
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    const perusahaan = await client.query("SELECT id, kode, nama, jenis_bisnis FROM perusahaan ORDER BY id");
    console.log("perusahaan:", perusahaan.rows);
    const koneksi = await client.query(
      "SELECT id, perusahaan_id, label, host, port, db_name, db_user, length(db_password_encrypted) AS pw_len FROM perusahaan_koneksi ORDER BY id"
    );
    console.log("perusahaan_koneksi:", koneksi.rows);
    const akun = await client.query("SELECT count(*) FROM akun_direktori");
    console.log("akun_direktori row count:", akun.rows[0].count);
  } finally {
    await client.end();
  }
}

async function main() {
  await ensureDatabaseExists();
  await migrateSchema();
  await verify();
  process.exit(0);
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
