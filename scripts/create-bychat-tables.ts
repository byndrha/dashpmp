// One-off table creation for the ByChat integration (pmp_directory Postgres DB):
//   - perusahaan_bychat_koneksi: per-PT ByChat account mapping + encrypted API token
//   - bychat_kirim_audit: audit of every "Kirim kartu piutang" attempt
// Idempotent — safe to re-run. Usage: node_modules/.bin/tsx scripts/create-bychat-tables.ts
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
      CREATE TABLE IF NOT EXISTS perusahaan_bychat_koneksi (
        id SERIAL PRIMARY KEY,
        perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
        bychat_url VARCHAR(255) NOT NULL,
        bychat_account_id INTEGER NOT NULL,
        api_token_encrypted VARCHAR(1024) NOT NULL,
        inbox_id INTEGER,
        aktif BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (perusahaan_id),
        UNIQUE (bychat_account_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS bychat_kirim_audit (
        id BIGSERIAL PRIMARY KEY,
        perusahaan_kode VARCHAR(32) NOT NULL,
        mitra_id VARCHAR(64) NOT NULL,
        mitra_nama VARCHAR(255) NOT NULL,
        nomor VARCHAR(20) NOT NULL,
        agen_id INTEGER,
        agen_nama VARCHAR(255),
        agen_email VARCHAR(255),
        bychat_account_id INTEGER NOT NULL,
        conversation_id INTEGER,
        message_id INTEGER,
        idempotency_key VARCHAR(80) NOT NULL,
        status VARCHAR(16) NOT NULL,
        http_status INTEGER,
        pesan_galat TEXT,
        total_piutang NUMERIC(18,2),
        tanggal_posisi DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS ix_bychat_kirim_audit_mitra ON bychat_kirim_audit (perusahaan_kode, mitra_id, created_at DESC)`
    );
    // Tautan publik kartu piutang (tanpa login): token acak ringkas, kedaluwarsa, bisa dicabut.
    await client.query(`
      CREATE TABLE IF NOT EXISTS kartu_piutang_tautan (
        id BIGSERIAL PRIMARY KEY,
        token VARCHAR(16) NOT NULL UNIQUE,
        perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
        perusahaan_kode VARCHAR(32) NOT NULL,
        mitra_id VARCHAR(64) NOT NULL,
        dibuat_oleh_nama VARCHAR(255),
        dibuat_oleh_email VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        kedaluwarsa TIMESTAMPTZ NOT NULL,
        dicabut BOOLEAN NOT NULL DEFAULT FALSE,
        jumlah_dibuka INTEGER NOT NULL DEFAULT 0,
        terakhir_dibuka TIMESTAMPTZ
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS ix_kartu_tautan_mitra ON kartu_piutang_tautan (perusahaan_kode, mitra_id, kedaluwarsa DESC)`
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS kartu_piutang_akses (
        id BIGSERIAL PRIMARY KEY,
        token VARCHAR(16) NOT NULL,
        ip_hash VARCHAR(16),
        waktu TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_kartu_akses_token ON kartu_piutang_akses (token, waktu DESC)`);
    console.log("perusahaan_bychat_koneksi + bychat_kirim_audit + kartu_piutang_tautan + kartu_piutang_akses ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
