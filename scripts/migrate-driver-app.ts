// Idempotent setup for the driver-app feature's Postgres columns:
// peran.is_driver (role-level access flag, mirrors peran.is_satpam) and
// akun.salesman_id (per-account link to the real ERP Salesman/driver
// identity — nullable, only meaningful for accounts whose peran has
// is_driver = true). Safe to re-run.
//
// Usage: npx tsx scripts/migrate-driver-app.ts
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
    await client.query(`ALTER TABLE peran ADD COLUMN IF NOT EXISTS is_driver BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE akun ADD COLUMN IF NOT EXISTS salesman_id VARCHAR(16)`);
    console.log("peran.is_driver + akun.salesman_id ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
