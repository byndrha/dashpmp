// One-off migration: DashboardMarketingWilayah, DashboardMarketingMitra, and
// DashboardMitraPengajuan store MarketingUserID (and, for the latter two,
// CreatedByUserID/ReviewedByUserID) as MSSQL DashboardUser.UserID values.
// After the Akun/Peran/Izin migration, session.user.id for MKEsindo accounts
// is now a Postgres akun.id — a DIFFERENT integer space. This script
// retroactively rewrites the stored values in these 3 MSSQL tables from the
// old MSSQL UserID to the new Postgres akun.id, using username as the join
// key (preserved 1:1 by the earlier Akun migration), so old and new data
// share one consistent ID space going forward.
//
// Read-write against MSSQL (these 3 tables only), read-only against
// Postgres. Safe to re-run: an UPDATE that finds no matching old UserID
// values simply affects 0 rows.
//
// Usage: npx tsx scripts/migrate-marketing-userid-to-akun-id.ts
import "dotenv/config";
import { getPool as getMssqlPool, sql } from "../src/lib/db";
import { getPgPool } from "../src/lib/pg";

async function main() {
  const mssql = await getMssqlPool();
  const pg = getPgPool();

  // Build the old-UserID -> new-akun.id mapping via username (every
  // DashboardUser row was migrated 1:1 into akun with username preserved).
  const mssqlUsers = await mssql.request().query(`SELECT UserID, Username FROM DashboardUser`);
  const mapping = new Map<number, number>(); // old MSSQL UserID -> new Postgres akun.id
  for (const u of mssqlUsers.recordset as { UserID: number; Username: string }[]) {
    const pgRow = await pg.query(`SELECT id FROM akun WHERE username = $1`, [u.Username]);
    if (pgRow.rows[0]) mapping.set(u.UserID, pgRow.rows[0].id as number);
  }
  console.log(`Built mapping for ${mapping.size} users.`);

  let totalUpdated = 0;

  async function migrateColumn(table: string, column: string) {
    const distinctResult = await mssql.request().query(`
      SELECT DISTINCT ${column} AS val FROM ${table} WHERE ${column} IS NOT NULL
    `);
    for (const row of distinctResult.recordset as { val: string }[]) {
      const oldId = Number(row.val);
      if (!Number.isFinite(oldId)) continue; // already migrated (new akun.id) or malformed — skip
      const newId = mapping.get(oldId);
      if (newId == null) {
        console.log(`  WARNING: ${table}.${column} = '${row.val}' has no matching akun — leaving as-is.`);
        continue;
      }
      // Skip a no-op update when old === new (would be rare, but avoids a
      // spurious "already migrated" ambiguity on re-run).
      if (oldId === newId) continue;
      const result = await mssql
        .request()
        .input("oldVal", sql.VarChar(16), row.val)
        .input("newVal", sql.VarChar(16), String(newId))
        .query(`UPDATE ${table} SET ${column} = @newVal WHERE ${column} = @oldVal`);
      const affected = result.rowsAffected[0];
      totalUpdated += affected;
      console.log(`  ${table}.${column}: '${row.val}' (old UserID ${oldId}) -> '${newId}' (akun.id), ${affected} row(s).`);
    }
  }

  console.log("\n=== DashboardMarketingWilayah ===");
  await migrateColumn("DashboardMarketingWilayah", "MarketingUserID");
  await migrateColumn("DashboardMarketingWilayah", "CreatedByUserID");

  console.log("\n=== DashboardMarketingMitra ===");
  await migrateColumn("DashboardMarketingMitra", "MarketingUserID");
  await migrateColumn("DashboardMarketingMitra", "CreatedByUserID");

  console.log("\n=== DashboardMitraPengajuan ===");
  await migrateColumn("DashboardMitraPengajuan", "MarketingUserID");
  await migrateColumn("DashboardMitraPengajuan", "ReviewedByUserID");

  console.log(`\nTotal rows updated: ${totalUpdated}`);

  // Verification: every remaining non-null value in these columns must now
  // resolve to a real akun.id.
  const akunIds = new Set((await pg.query(`SELECT id FROM akun`)).rows.map((r) => r.id as number));
  let allValid = true;
  for (const [table, column] of [
    ["DashboardMarketingWilayah", "MarketingUserID"],
    ["DashboardMarketingWilayah", "CreatedByUserID"],
    ["DashboardMarketingMitra", "MarketingUserID"],
    ["DashboardMarketingMitra", "CreatedByUserID"],
    ["DashboardMitraPengajuan", "MarketingUserID"],
    ["DashboardMitraPengajuan", "ReviewedByUserID"],
  ]) {
    const distinctResult = await mssql.request().query(`SELECT DISTINCT ${column} AS val FROM ${table} WHERE ${column} IS NOT NULL`);
    for (const row of distinctResult.recordset as { val: string }[]) {
      const id = Number(row.val);
      if (!akunIds.has(id)) {
        allValid = false;
        console.error(`VERIFY FAIL: ${table}.${column} = '${row.val}' does not resolve to a real akun.id`);
      }
    }
  }
  console.log(allValid ? "VERIFY: all values resolve to real akun.id — PASS" : "VERIFY: FAIL");
  process.exit(allValid ? 0 : 1);
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
