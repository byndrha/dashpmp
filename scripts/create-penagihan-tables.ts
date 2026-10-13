// One-off table creation for penagihan otomatis via ByChat (pmp_directory Postgres DB).
// Idempotent — safe to re-run. Usage: node_modules/.bin/tsx scripts/create-penagihan-tables.ts
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
    // Tombol aktif/nonaktif per PT (UI /grup/perusahaan). BAWAAN MATI.
    await client.query(`ALTER TABLE perusahaan_bychat_koneksi ADD COLUMN IF NOT EXISTS penagihan_aktif BOOLEAN NOT NULL DEFAULT FALSE`);

    // Pengaturan (UI modul Piutang), satu baris per PT; baris belum ada = nilai awal di kode.
    await client.query(`
      CREATE TABLE IF NOT EXISTS penagihan_pengaturan (
        perusahaan_id INTEGER PRIMARY KEY REFERENCES perusahaan(id) ON DELETE CASCADE,
        hari SMALLINT[] NOT NULL,
        jam_mulai VARCHAR(5) NOT NULL,
        jam_selesai VARCHAR(5) NOT NULL,
        jeda_min_dtk INTEGER NOT NULL,
        jeda_maks_dtk INTEGER NOT NULL,
        jeda_panjang_tiap INTEGER NOT NULL,
        jeda_panjang_dtk INTEGER NOT NULL,
        batas_harian INTEGER NOT NULL,
        min_hari_lewat INTEGER NOT NULL,
        min_piutang NUMERIC(18,2) NOT NULL,
        ulang_hari INTEGER NOT NULL,
        mode VARCHAR(10) NOT NULL,
        jeda_sampai TIMESTAMPTZ,
        gagal_beruntun INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_oleh VARCHAR(255)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS penagihan_ronde (
        id BIGSERIAL PRIMARY KEY,
        perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
        tanggal DATE NOT NULL,
        status VARCHAR(12) NOT NULL CHECK (status IN ('pratinjau','berjalan','selesai','dibatalkan')),
        dibuat_pada TIMESTAMPTZ NOT NULL DEFAULT now(),
        disetujui_oleh VARCHAR(255),
        disetujui_pada TIMESTAMPTZ,
        jumlah INTEGER NOT NULL DEFAULT 0,
        UNIQUE (perusahaan_id, tanggal)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS penagihan_antrean (
        id BIGSERIAL PRIMARY KEY,
        ronde_id BIGINT NOT NULL REFERENCES penagihan_ronde(id) ON DELETE CASCADE,
        perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
        mitra_id VARCHAR(64) NOT NULL,
        mitra_nama VARCHAR(255) NOT NULL,
        nomor VARCHAR(20),
        total_piutang NUMERIC(18,2) NOT NULL DEFAULT 0,
        jumlah_faktur INTEGER NOT NULL DEFAULT 0,
        hari_lewat_maks INTEGER NOT NULL DEFAULT 0,
        jadwal_rencana TIMESTAMPTZ,
        status VARCHAR(12) NOT NULL CHECK (status IN ('menunggu','terkirim','dilewati','gagal','dibatalkan')),
        alasan TEXT,
        message_id INTEGER,
        conversation_id INTEGER,
        diproses_pada TIMESTAMPTZ,
        UNIQUE (ronde_id, mitra_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS ix_penagihan_antrean_due ON penagihan_antrean (status, jadwal_rencana)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS penagihan_optout (
        id BIGSERIAL PRIMARY KEY,
        perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
        nomor VARCHAR(20) NOT NULL,
        alasan TEXT,
        sumber VARCHAR(16) NOT NULL DEFAULT 'manual',
        dicatat_oleh VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (perusahaan_id, nomor)
      )
    `);
    // Status akhir pesan (dibaca dari ByChat) + rahasia webhook pesan masuk per PT.
    await client.query(`ALTER TABLE penagihan_antrean ADD COLUMN IF NOT EXISTS status_pesan VARCHAR(20)`);
    await client.query(`ALTER TABLE penagihan_antrean ADD COLUMN IF NOT EXISTS status_cek_jumlah INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE penagihan_antrean ADD COLUMN IF NOT EXISTS status_cek_pada TIMESTAMPTZ`);
    await client.query(`ALTER TABLE perusahaan_bychat_koneksi ADD COLUMN IF NOT EXISTS webhook_secret_encrypted TEXT`);
    console.log("penagihan_* ready (penagihan_aktif default FALSE).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
