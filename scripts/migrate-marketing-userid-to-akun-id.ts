// HISTORICAL — NO LONGER RUNNABLE. It reads DashboardUser to build the
// username -> akun.id map, and that table was dropped on 2026-08-22 by
// scripts/drop-legacy-auth-tables.ts. Kept as the record of why the
// MarketingUserID/CreatedByUserID/ReviewedByUserID values in those 3 tables
// are Postgres akun.id today, not MSSQL UserID.
//
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
// Postgres. Genuinely idempotent (not just accidentally so): a value only
// gets rewritten if it's a member of the actual known set of MSSQL
// DashboardUser.UserID values fetched at the top of this run — a value
// that's already a Postgres akun.id is never touched, even if it happens
// to numerically overlap with some other old UserID (a real, non-hypothetical
// risk: akun.id is a freshly-seeded SERIAL over the same ~16 rows, so its
// range plausibly overlaps DashboardUser.UserID's). Do NOT loosen this to a
// generic "is it a finite number" check — that was tried first and is
// unsafe: it can't distinguish "still needs migrating" from "already
// migrated," so a second run could silently reassign an already-correct
// row to the wrong person while the verification pass at the bottom would
// still report PASS (it only checks "does this id exist in akun," not
// "is it the SAME id it was before").
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
  const knownOldUserIds = new Set<number>();
  const mapping = new Map<number, number>(); // old MSSQL UserID -> new Postgres akun.id
  for (const u of mssqlUsers.recordset as { UserID: number; Username: string }[]) {
    knownOldUserIds.add(u.UserID);
    const pgRow = await pg.query(`SELECT id FROM akun WHERE username = $1`, [u.Username]);
    if (pgRow.rows[0]) mapping.set(u.UserID, pgRow.rows[0].id as number);
  }
  console.log(`Built mapping for ${mapping.size} of ${mssqlUsers.recordset.length} DashboardUser rows.`);

  let totalUpdated = 0;

  async function migrateColumn(table: string, column: string) {
    const distinctResult = await mssql.request().query(`
      SELECT DISTINCT ${column} AS val FROM ${table} WHERE ${column} IS NOT NULL
    `);
    for (const row of distinctResult.recordset as { val: string }[]) {
      const oldId = Number(row.val);
      // Only a value that's a genuine, known old DashboardUser.UserID is a
      // migration candidate — anything else (already an akun.id, or
      // malformed) is left untouched. This is the actual safety mechanism,
      // not "is it a finite number" (see the file header comment).
      if (!knownOldUserIds.has(oldId)) continue;
      const newId = mapping.get(oldId);
      if (newId == null) {
        console.log(`  WARNING: ${table}.${column} = '${row.val}' has no matching akun — leaving as-is.`);
        continue;
      }
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
