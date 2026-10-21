// Tingkat teratas SaaS: Holding -> Perusahaan -> Akun. Holding = tenant;
// setiap holding terisolasi dari holding lain. Idempotent, aman dijalankan
// ulang.
//
// - Tabel baru `holding` di database direktori (pmp_directory).
// - `perusahaan.holding_id` dan `akun.holding_id` (akun level holding, mis.
//   CEO, punya perusahaan_id NULL tapi tetap terikat ke satu holding).
// - Seed: "PMP Group" (semua perusahaan & akun yang sudah ada) dan
//   "Demo Group" (showcase, is_demo=true).
//
// Kolom holding_id SENGAJA masih nullable: kode insert perusahaan/akun yang
// ada belum mengisinya. Ubah ke NOT NULL setelah semua jalur tulis diperbarui.
//
// Usage: npx tsx scripts/saas-migrate-holding.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

const PMP_PERUSAHAAN_KODE = ["mkesindo", "pmputra", "pmpersada", "pmpakis"];

async function main() {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS holding (
        id SERIAL PRIMARY KEY,
        kode VARCHAR(32) NOT NULL UNIQUE,
        nama VARCHAR(128) NOT NULL,
        is_demo BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`ALTER TABLE perusahaan ADD COLUMN IF NOT EXISTS holding_id INT REFERENCES holding(id)`);
    await client.query(`ALTER TABLE akun ADD COLUMN IF NOT EXISTS holding_id INT REFERENCES holding(id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS perusahaan_holding_id_idx ON perusahaan (holding_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS akun_holding_id_idx ON akun (holding_id)`);

    await client.query(
      `INSERT INTO holding (kode, nama, is_demo) VALUES ('pmp', 'PMP Group', false), ('demo', 'Demo Group', true)
       ON CONFLICT (kode) DO NOTHING`
    );
    const pmp = (await client.query(`SELECT id FROM holding WHERE kode = 'pmp'`)).rows[0].id as number;

    const p = await client.query(
      `UPDATE perusahaan SET holding_id = $1, updated_at = now() WHERE holding_id IS NULL AND kode = ANY($2)`,
      [pmp, PMP_PERUSAHAAN_KODE]
    );
    // Semua akun yang ada hari ini milik PMP Group -- termasuk akun Direktur
    // (perusahaan_id NULL).
    const a = await client.query(
      `UPDATE akun SET holding_id = COALESCE((SELECT holding_id FROM perusahaan WHERE id = akun.perusahaan_id), $1)
       WHERE holding_id IS NULL`,
      [pmp]
    );
    await client.query("COMMIT");
    console.log(`holding siap. perusahaan ditautkan ke PMP Group: ${p.rowCount}, akun ditautkan: ${a.rowCount}`);

    const v = await client.query(`
      SELECT h.kode, h.nama, h.is_demo,
             (SELECT count(*) FROM perusahaan WHERE holding_id = h.id) perusahaan,
             (SELECT count(*) FROM akun WHERE holding_id = h.id) akun
      FROM holding h ORDER BY h.id`);
    console.table(v.rows);
    const orphan = await client.query(`SELECT (SELECT count(*) FROM perusahaan WHERE holding_id IS NULL) p, (SELECT count(*) FROM akun WHERE holding_id IS NULL) a`);
    console.log("tanpa holding:", orphan.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("MIGRASI GAGAL:", err);
  process.exit(1);
});
