// One-off: adds Keterangan to DashboardMitraPengajuan (general-purpose
// approval/rejection note, replacing CatatanTolak going forward — old
// CatatanTolak values are left in place as a read-fallback, not migrated).
// Usage: npx tsx scripts/add-pengajuan-keterangan-column.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('DashboardMitraPengajuan') AND name = 'Keterangan'
    )
    ALTER TABLE DashboardMitraPengajuan ADD Keterangan VARCHAR(500) NULL
  `);
  console.log("DashboardMitraPengajuan.Keterangan ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
