// One-off column addition — idempotent, safe to re-run.
// Usage: npx tsx scripts/add-peran-is-operasional-column.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pool = getPgPool();
  await pool.query(`ALTER TABLE peran ADD COLUMN IF NOT EXISTS is_operasional BOOLEAN NOT NULL DEFAULT false`);
  console.log("peran.is_operasional ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
