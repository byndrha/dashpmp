// Idempotent setup for Modul Inventaris Tahap 1 — creates the 8 vendor-
// related tables in the existing pmp_directory Postgres DB, plus the
// akun.can_akses_inventaris column. Safe to re-run.
//
// Usage: npx tsx scripts/migrate-inventaris-db.ts
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
      CREATE TABLE IF NOT EXISTS vendor (
        id SERIAL PRIMARY KEY,
        nama VARCHAR(255) NOT NULL,
        npwp VARCHAR(32),
        npwp_alamat VARCHAR(512),
        catatan TEXT,
        is_aktif BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_lokasi (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        nama_lokasi VARCHAR(255) NOT NULL,
        alamat VARCHAR(512),
        kota VARCHAR(128),
        kontak VARCHAR(128),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_pic (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        nama VARCHAR(128) NOT NULL,
        jabatan VARCHAR(128),
        telepon VARCHAR(32),
        email VARCHAR(128),
        urutan INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // urutan=0 is the vendor's PRIMARY PIC — its nama/telepon feed
    // BusinessPartner.ContactPerson/MobileNo on sync (Task 5).

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_pic_internal (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        perusahaan_id INT NOT NULL REFERENCES perusahaan(id),
        akun_id INT NOT NULL REFERENCES akun(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (vendor_id, perusahaan_id, akun_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_kategori (
        id SERIAL PRIMARY KEY,
        nama VARCHAR(128) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_produk (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        kategori_id INT NOT NULL REFERENCES vendor_kategori(id),
        brand VARCHAR(128),
        model VARCHAR(128),
        spesifikasi TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_perusahaan_link (
        id SERIAL PRIMARY KEY,
        vendor_id INT NOT NULL REFERENCES vendor(id) ON DELETE CASCADE,
        perusahaan_id INT NOT NULL REFERENCES perusahaan(id),
        business_partner_id VARCHAR(16) NOT NULL,
        term_of_payment_id VARCHAR(16) NOT NULL DEFAULT '014',
        is_suspended BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (vendor_id, perusahaan_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendor_pengiriman (
        id SERIAL PRIMARY KEY,
        vendor_perusahaan_link_id INT NOT NULL REFERENCES vendor_perusahaan_link(id) ON DELETE CASCADE,
        vendor_produk_id INT REFERENCES vendor_produk(id),
        tanggal_pesan DATE NOT NULL,
        tanggal_tiba DATE NOT NULL,
        rating_kualitas SMALLINT NOT NULL CHECK (rating_kualitas BETWEEN 1 AND 5),
        catatan TEXT,
        dicatat_oleh_akun_id INT NOT NULL REFERENCES akun(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      ALTER TABLE akun ADD COLUMN IF NOT EXISTS can_akses_inventaris BOOLEAN NOT NULL DEFAULT false
    `);

    console.log("Modul Inventaris tables + akun.can_akses_inventaris ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
