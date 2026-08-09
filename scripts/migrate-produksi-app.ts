// Idempotent setup for the Produksi module's Postgres column: peran.is_produksi
// (role-level access flag, mirrors peran.is_driver / peran.is_satpam). Safe to
// re-run.
//
// Usage: npx tsx scripts/migrate-produksi-app.ts
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
    await client.query(`ALTER TABLE peran ADD COLUMN IF NOT EXISTS is_produksi BOOLEAN NOT NULL DEFAULT false`);
    console.log("peran.is_produksi ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
