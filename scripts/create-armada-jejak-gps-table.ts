// Migrasi skema (aditif, idempoten) — cache jejak rute AKTUAL per Jadwal
// untuk Validasi Rute (src/lib/queries/jejak-armada.ts). Jejak diambil dari
// riwayat provider GPS (SoloFleet / Hino); perjalanan yang sudah selesai
// (final) disimpan permanen supaya dialog berikutnya cukup satu baca DB.
//
// Hanya CREATE ... IF NOT EXISTS. Tidak pernah DROP atau DELETE.
//
// Usage: npx tsx scripts/create-armada-jejak-gps-table.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pg = getPgPool();
  const db = (await pg.query<{ db: string }>(`SELECT current_database() AS db`)).rows[0].db;
  console.log(`== Postgres direktori -> current_database() = ${db}`);

  await pg.query(`
    CREATE TABLE IF NOT EXISTS armada_jejak_gps (
      perusahaan_kode text NOT NULL,
      jadwal_id integer NOT NULL,
      armada_id integer NOT NULL,
      sumber text NULL,
      titik jsonb NOT NULL DEFAULT '[]'::jsonb,
      dari timestamptz NOT NULL,
      sampai timestamptz NOT NULL,
      final boolean NOT NULL DEFAULT false,
      diambil_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (perusahaan_kode, jadwal_id),
      CONSTRAINT armada_jejak_gps_sumber_chk CHECK (sumber IS NULL OR sumber IN ('solofleet','hino'))
    )
  `);
  console.log("armada_jejak_gps siap.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
