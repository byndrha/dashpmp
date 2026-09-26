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
        perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id),
        provider VARCHAR(16) NOT NULL CHECK (provider IN ('hino', 'solofleet')),
        username TEXT NOT NULL,
        password_encrypted TEXT NOT NULL,
        extra_config JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by_akun_id TEXT,
        UNIQUE (perusahaan_id, provider)
      )
    `);
    // Corrects the original single-tenant design (UNIQUE(provider) only) —
    // each PT (MKEsindo, PMPutra, ...) has its own Hino Connect / SoloFleet
    // account, not one shared account for the whole app. Table had no real
    // rows yet when this was caught, so a plain ADD COLUMN + constraint swap
    // is safe (no backfill needed). Guarded so this script stays re-runnable
    // whether it's creating the table fresh or upgrading an existing one.
    await client.query(`
      ALTER TABLE gps_kendaraan_kredensial ADD COLUMN IF NOT EXISTS perusahaan_id INTEGER REFERENCES perusahaan(id)
    `);
    await client.query(`
      ALTER TABLE gps_kendaraan_kredensial ALTER COLUMN perusahaan_id SET NOT NULL
    `).catch(() => {
      // Fails only if a pre-existing row has perusahaan_id still NULL (a
      // real credential saved under the old single-tenant schema) — leave
      // it nullable rather than crash the migration; the app-level queries
      // below assume NOT NULL going forward, so any such row needs manual
      // attention, not a silent auto-fix.
      console.warn(
        "WARNING: gps_kendaraan_kredensial has a row with NULL perusahaan_id — could not SET NOT NULL. " +
          "Assign it to the correct PT manually, then re-run this script."
      );
    });
    await client.query(`
      ALTER TABLE gps_kendaraan_kredensial DROP CONSTRAINT IF EXISTS gps_kendaraan_kredensial_provider_key
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'gps_kendaraan_kredensial_perusahaan_id_provider_key'
        ) THEN
          ALTER TABLE gps_kendaraan_kredensial ADD CONSTRAINT gps_kendaraan_kredensial_perusahaan_id_provider_key UNIQUE (perusahaan_id, provider);
        END IF;
      END $$;
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
