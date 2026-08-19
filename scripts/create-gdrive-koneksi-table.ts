// One-off table creation for perusahaan_gdrive_koneksi (pmp_directory DB).
// Idempotent — safe to re-run. Usage: npx tsx scripts/create-gdrive-koneksi-table.ts
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const client = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: process.env.DIRECTORY_DB_NAME || "pmp_directory",
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS perusahaan_gdrive_koneksi (
        id SERIAL PRIMARY KEY,
        perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
        connected_email VARCHAR(255) NOT NULL,
        refresh_token_encrypted VARCHAR(512) NOT NULL,
        root_folder_id VARCHAR(128) NOT NULL,
        connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (perusahaan_id)
      )
    `);
    console.log("perusahaan_gdrive_koneksi ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
