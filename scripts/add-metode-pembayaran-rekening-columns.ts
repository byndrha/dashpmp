// One-off column addition: bank-transfer detail fields on
// metode_pembayaran, relevant when metode = 'TRANSFER'. Idempotent.
// Usage: npx tsx scripts/add-metode-pembayaran-rekening-columns.ts
import "dotenv/config";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const pool = getPgPool();
  await pool.query(`
    ALTER TABLE metode_pembayaran
      ADD COLUMN IF NOT EXISTS bank_nama VARCHAR,
      ADD COLUMN IF NOT EXISTS nomor_rekening VARCHAR,
      ADD COLUMN IF NOT EXISTS atas_nama VARCHAR
  `);
  console.log("metode_pembayaran bank-transfer columns ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
