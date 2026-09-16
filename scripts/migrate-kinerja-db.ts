// One-off, idempotent setup for the Modul Kinerja Karyawan metadata layer
// (jabatan/aspek_kinerja) in the existing pmp_directory Postgres DB, plus
// the seed row for "Marketing and Collection" / "Penjualan". Safe to
// re-run — every statement uses IF NOT EXISTS / ON CONFLICT.
//
// Usage: npx tsx scripts/migrate-kinerja-db.ts
import "dotenv/config";
import { Client } from "pg";

const DIRECTORY_DB_NAME = process.env.DIRECTORY_DB_NAME || "pmp_directory";

async function main() {
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
      CREATE TABLE IF NOT EXISTS jabatan (
        id SERIAL PRIMARY KEY,
        kode VARCHAR(50) NOT NULL UNIQUE,
        nama VARCHAR(100) NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS jabatan_peran_map (
        jabatan_id INTEGER NOT NULL REFERENCES jabatan(id),
        peran_id INTEGER NOT NULL,
        PRIMARY KEY (jabatan_id, peran_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS aspek_kinerja (
        id SERIAL PRIMARY KEY,
        jabatan_id INTEGER NOT NULL REFERENCES jabatan(id),
        kode VARCHAR(50) NOT NULL,
        nama VARCHAR(100) NOT NULL,
        satuan VARCHAR(50) NOT NULL,
        UNIQUE (jabatan_id, kode)
      )
    `);

    const jabatanResult = await client.query(`
      INSERT INTO jabatan (kode, nama) VALUES ('marketing_collection', 'Marketing and Collection')
      ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama
      RETURNING id
    `);
    const jabatanId = jabatanResult.rows[0].id as number;

    // 1003 = MARKETING_ROLE_ID (src/lib/roles.ts) — kept as a literal here
    // rather than importing that TS constant, since this script runs
    // standalone via tsx and the value is a stable, already-existing
    // DashboardRole id, not something this migration should re-derive.
    await client.query(
      `INSERT INTO jabatan_peran_map (jabatan_id, peran_id) VALUES ($1, 1003) ON CONFLICT DO NOTHING`,
      [jabatanId]
    );

    await client.query(
      `INSERT INTO aspek_kinerja (jabatan_id, kode, nama, satuan)
       VALUES ($1, 'penjualan', 'Penjualan', 'Kantong Es Terjual')
       ON CONFLICT (jabatan_id, kode) DO UPDATE SET nama = EXCLUDED.nama, satuan = EXCLUDED.satuan`,
      [jabatanId]
    );

    console.log("Kinerja tables (jabatan, jabatan_peran_map, aspek_kinerja) ready + seeded.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
