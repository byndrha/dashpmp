// Migrasi skema (aditif, idempoten, aman dijalankan ulang) untuk Builder
// Denah Produksi Es Balok tahap 1
// (docs/superpowers/specs/2026-10-25-produksi-es-balok-builder-denah-design.md §Model data).
//
// Postgres direktori saja:
//   - produksi_denah: satu dokumen denah (jsonb) per perusahaan + nomor versi
//     untuk optimistic locking.
//   - produksi_kolom_isi: isi kolom (diisi tahap operasional). Tahap 1 hanya
//     MEMBACA baris aktif (selesai_at IS NULL) untuk aturan "kolom berisi es
//     tidak boleh diubah".
//
// Hanya CREATE ... IF NOT EXISTS -- tidak pernah DROP/ALTER, tidak menyentuh data.
//
// Usage: npx tsx scripts/create-produksi-denah-tables.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pg = getPgPool();
  const db = (await pg.query<{ db: string }>(`SELECT current_database() AS db`)).rows[0].db;
  console.log(`== Postgres direktori -> current_database() = ${db}`);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS produksi_denah (
      perusahaan_kode text PRIMARY KEY,
      versi integer NOT NULL CHECK (versi >= 1),
      data jsonb NOT NULL,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log("produksi_denah siap.");

  await pg.query(`
    CREATE TABLE IF NOT EXISTS produksi_kolom_isi (
      id bigserial PRIMARY KEY,
      perusahaan_kode text NOT NULL,
      kolom_id text NOT NULL,
      mulai_at timestamptz NOT NULL,
      selesai_at timestamptz NULL
    )
  `);
  console.log("produksi_kolom_isi siap.");

  await pg.query(`
    CREATE INDEX IF NOT EXISTS produksi_kolom_isi_aktif_idx
      ON produksi_kolom_isi (perusahaan_kode, kolom_id) WHERE selesai_at IS NULL
  `);
  console.log("index produksi_kolom_isi_aktif_idx siap.");

  console.log("\nSelesai.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
