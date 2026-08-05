// Idempotent setup for the akun_sesi table — one row per login, used to
// track and force-revoke individual active sessions. Safe to re-run.
//
// Usage: npx tsx scripts/migrate-akun-sesi.ts
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
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS akun_sesi (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        akun_id INTEGER NOT NULL REFERENCES akun(id),
        user_agent TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS akun_sesi_akun_id_idx ON akun_sesi (akun_id) WHERE revoked_at IS NULL
    `);
    console.log("akun_sesi table ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
