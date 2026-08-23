// One-off table creation for metode_pembayaran + metode_pembayaran_snap_bi_kredensial.
// Idempotent — safe to re-run. Usage: npx tsx scripts/create-metode-pembayaran-tables.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pool = getPgPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metode_pembayaran (
      id SERIAL PRIMARY KEY,
      perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
      kode VARCHAR(64) NOT NULL,
      metode VARCHAR(16) NOT NULL CHECK (metode IN ('TUNAI', 'QRIS', 'TRANSFER')),
      jenis VARCHAR(16) NOT NULL CHECK (jenis IN ('manual', 'qris_static', 'qris_dinamis')),
      coa_id VARCHAR(16) NOT NULL,
      konteks TEXT[] NOT NULL,
      wajib_catatan BOOLEAN NOT NULL DEFAULT false,
      catatan TEXT,
      qris_statis_image_path TEXT,
      urutan INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (perusahaan_id, kode)
    )
  `);

  // Partial unique index: at most one ACTIVE qris_dinamis row per company —
  // matches Bank Mandiri's own one-merchant-account-per-PT reality.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS metode_pembayaran_one_qris_dinamis_per_pt
    ON metode_pembayaran (perusahaan_id)
    WHERE jenis = 'qris_dinamis' AND is_active
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metode_pembayaran_snap_bi_kredensial (
      perusahaan_id INTEGER PRIMARY KEY REFERENCES perusahaan(id) ON DELETE CASCADE,
      client_id VARCHAR(255) NOT NULL,
      client_secret_encrypted VARCHAR(512) NOT NULL,
      merchant_id VARCHAR(128) NOT NULL,
      partner_id VARCHAR(128) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  console.log("metode_pembayaran + metode_pembayaran_snap_bi_kredensial ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
