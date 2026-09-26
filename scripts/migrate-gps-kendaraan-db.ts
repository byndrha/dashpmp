// Idempotent setup for the GPS Kendaraan tables — gps_kendaraan_kredensial
// (one row per provider's credentials) and armada_gps_riwayat (GPS ping
// history fetched from provider APIs). Safe to re-run.
//
// Usage: npx tsx scripts/migrate-gps-kendaraan-db.ts
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
      CREATE TABLE IF NOT EXISTS gps_kendaraan_kredensial (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(16) NOT NULL CHECK (provider IN ('hino', 'solofleet')),
        username TEXT NOT NULL,
        password_encrypted TEXT NOT NULL,
        extra_config JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by_akun_id TEXT,
        UNIQUE (provider)
      )
    `);
    console.log("gps_kendaraan_kredensial table ready.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS armada_gps_riwayat (
        id BIGSERIAL PRIMARY KEY,
        provider VARCHAR(16) NOT NULL CHECK (provider IN ('hino', 'solofleet')),
        external_vehicle_id TEXT NOT NULL,
        plat_nomor_raw TEXT NOT NULL,
        plat_nomor_normalized TEXT NOT NULL,
        armada_id INTEGER,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        speed_kmh DOUBLE PRECISION,
        heading DOUBLE PRECISION,
        ignition_on BOOLEAN,
        recorded_at TIMESTAMPTZ NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        raw_payload JSONB
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS armada_gps_riwayat_armada_id_recorded_at_idx ON armada_gps_riwayat (armada_id, recorded_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS armada_gps_riwayat_provider_external_vehicle_id_recorded_at_idx ON armada_gps_riwayat (provider, external_vehicle_id, recorded_at)
    `);
    console.log("armada_gps_riwayat table ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
