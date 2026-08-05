// Idempotent setup for the akun_lokasi table — one row per background
// location ping, per account. Safe to re-run.
//
// Usage: npx tsx scripts/migrate-akun-lokasi.ts
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const client = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: process.env.DIRECTORY_DB_NAME,
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS akun_lokasi (
        id BIGSERIAL PRIMARY KEY,
        akun_id INTEGER NOT NULL REFERENCES akun(id),
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        accuracy DOUBLE PRECISION,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS akun_lokasi_akun_id_recorded_at_idx ON akun_lokasi (akun_id, recorded_at DESC)
    `);
    console.log("akun_lokasi table ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
