// Uji BACA-SAJA (2026-11-22): latensi Postgres direktori & jumlah koneksi aktif.
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pool = getPgPool();
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await pool.query("SELECT 1");
    console.log("SELECT 1:", Date.now() - t, "ms");
  }
  const r = await pool.query("SELECT state, count(*)::int AS n, max(now() - query_start) AS terlama FROM pg_stat_activity WHERE datname = current_database() GROUP BY state");
  console.table(r.rows);
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
