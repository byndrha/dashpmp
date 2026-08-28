// One-off cleanup: backs up then DROPs the four legacy MSSQL auth tables that
// were superseded when accounts/roles/permissions moved to Postgres on
// 2026-07-31 (see docs/superpowers/specs/2026-07-31-akun-peran-postgres-design.md).
// They were deliberately left in place as an inert safety net; the user
// authorized removal on 2026-08-22.
//
//   DashboardUser           -> Postgres akun
//   DashboardRole           -> Postgres peran
//   DashboardRolePermission -> Postgres peran_izin
//   DashboardAuth           -> dead since before that migration (the even
//                              older login scheme keyed on the desktop ERP's
//                              own [User] table)
//
// WHY THIS ALSO FIXES A LIVE BUG — DashboardNotificationRead.UserID carries a
// foreign key to DashboardUser.UserID. Since the Postgres migration that
// column receives an `akun.id`, and migrate-akun-to-postgres.ts deliberately
// did NOT preserve the old UserID values ("New auto-increment akun.id is
// fine"), so an akun.id with no coincidental twin in DashboardUser (4, 5, 7,
// 8, 9, 11, 12, and every new account from 17 up) makes
// markNotificationRead()'s INSERT fail with FK error 547 — which
// src/lib/queries/notifications.ts only swallows for unique violations, not
// FK ones. Dropping DashboardUser drops that FK with it, so mark-as-read
// stops depending on a table that no longer holds the account list.
//
// This is also why "just DELETE the rows" was rejected: an empty
// DashboardUser behind a live FK would break mark-as-read for EVERY user
// instead of just some.
//
// Usage:
//   npx tsx scripts/drop-legacy-auth-tables.ts --dry-run   (backup + report only)
//   npx tsx scripts/drop-legacy-auth-tables.ts             (backup, then drop)
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getPool, sql } from "../src/lib/db";

// Drop order matters: children before parents, so no FK blocks the DROP.
// DashboardRolePermission and DashboardUser both reference DashboardRole,
// DashboardAuth references the ERP's own [User] (untouched here).
const DROP_ORDER = ["DashboardRolePermission", "DashboardUser", "DashboardAuth", "DashboardRole"] as const;

// The one FK pointing INTO this set from a table that stays. Looked up by
// parent/child pair rather than by name — the live name is a system-generated
// FK__Dashboard__UserI__6E5295FF, which differs per environment.
const EXTERNAL_FK_CHILD = "DashboardNotificationRead";
const EXTERNAL_FK_PARENT = "DashboardUser";

interface TableBackup {
  columns: { name: string; type: string; nullable: boolean }[];
  rowCount: number;
  rows: Record<string, unknown>[];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const pool = await getPool();

  // 1. Refuse to run if anything OTHER than the known external FK still
  // depends on these tables — a new dependency added since this script was
  // written must be a deliberate decision, not silently dropped.
  const deps = await pool.request().query(`
    SELECT fk.name AS FKName,
           OBJECT_NAME(fk.parent_object_id)     AS ChildTable,
           OBJECT_NAME(fk.referenced_object_id) AS ParentTable
    FROM sys.foreign_keys fk
    WHERE OBJECT_NAME(fk.referenced_object_id) IN ('DashboardUser','DashboardRole','DashboardRolePermission','DashboardAuth')
  `);
  const externalDeps = (deps.recordset as { FKName: string; ChildTable: string; ParentTable: string }[]).filter(
    (d) => !(DROP_ORDER as readonly string[]).includes(d.ChildTable)
  );
  const unexpected = externalDeps.filter(
    (d) => !(d.ChildTable === EXTERNAL_FK_CHILD && d.ParentTable === EXTERNAL_FK_PARENT)
  );
  if (unexpected.length > 0) {
    console.error("ABORT — unexpected foreign keys still point at these tables:");
    for (const d of unexpected) console.error(`  ${d.FKName}: ${d.ChildTable} -> ${d.ParentTable}`);
    process.exit(1);
  }

  // Views / procedures / functions referencing them by name would also break.
  const exprDeps = await pool.request().query(`
    SELECT DISTINCT OBJECT_NAME(d.referencing_id) AS ReferencingObject, o.type_desc AS ObjectType
    FROM sys.sql_expression_dependencies d
    JOIN sys.objects o ON o.object_id = d.referencing_id
    WHERE d.referenced_entity_name IN ('DashboardUser','DashboardRole','DashboardRolePermission','DashboardAuth')
      AND OBJECT_NAME(d.referencing_id) NOT IN ('DashboardUser','DashboardRole','DashboardRolePermission','DashboardAuth')
  `);
  if (exprDeps.recordset.length > 0) {
    console.error("ABORT — views/procedures still reference these tables:");
    for (const r of exprDeps.recordset as { ReferencingObject: string; ObjectType: string }[]) {
      console.error(`  ${r.ObjectType} ${r.ReferencingObject}`);
    }
    process.exit(1);
  }

  // 2. Back up every row before touching anything. Written to /scratchpad
  // (gitignored — these tables hold bcrypt PasswordHash values that must
  // never reach the repo).
  const backup: Record<string, TableBackup> = {};
  for (const table of DROP_ORDER) {
    const exists = await pool
      .request()
      .input("t", sql.VarChar(128), table)
      .query(`SELECT COUNT(*) AS Cnt FROM sys.tables WHERE name = @t`);
    if ((exists.recordset[0] as { Cnt: number }).Cnt === 0) {
      console.log(`  ${table}: already gone, skipping.`);
      continue;
    }

    const cols = await pool
      .request()
      .input("t", sql.VarChar(128), table).query(`
        SELECT c.name AS ColumnName, ty.name AS DataType, c.is_nullable AS IsNullable
        FROM sys.columns c
        JOIN sys.tables t ON t.object_id = c.object_id
        JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE t.name = @t
        ORDER BY c.column_id
      `);
    // Table names come from the DROP_ORDER literal above, never from input —
    // string interpolation here cannot be an injection vector.
    const rows = await pool.request().query(`SELECT * FROM [${table}]`);
    backup[table] = {
      columns: (cols.recordset as { ColumnName: string; DataType: string; IsNullable: boolean }[]).map((c) => ({
        name: c.ColumnName,
        type: c.DataType,
        nullable: c.IsNullable,
      })),
      rowCount: rows.recordset.length,
      rows: rows.recordset,
    };
    console.log(`  ${table}: ${rows.recordset.length} rows captured.`);
  }

  const scratchpad = path.join(process.cwd(), "scratchpad");
  fs.mkdirSync(scratchpad, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(scratchpad, `legacy-auth-tables-backup-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        note: "Legacy MSSQL auth tables superseded by Postgres akun/peran/peran_izin. Dropped by scripts/drop-legacy-auth-tables.ts.",
        droppedForeignKeys: externalDeps,
        tables: backup,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`\nBackup written: ${backupPath}`);

  // Guard: never proceed on a backup that clearly failed to serialize.
  const written = JSON.parse(fs.readFileSync(backupPath, "utf8")) as { tables: Record<string, TableBackup> };
  for (const [table, data] of Object.entries(backup)) {
    if (written.tables[table]?.rows.length !== data.rowCount) {
      console.error(`ABORT — backup verification failed for ${table}. Nothing dropped.`);
      process.exit(1);
    }
  }
  console.log("Backup verified (row counts match).");

  if (dryRun) {
    console.log("\n--dry-run: stopping here. Nothing dropped.");
    process.exit(0);
  }

  // 3. Drop the incoming FK first, then the tables themselves.
  const fkName = (
    await pool
      .request()
      .input("child", sql.VarChar(128), EXTERNAL_FK_CHILD)
      .input("parent", sql.VarChar(128), EXTERNAL_FK_PARENT).query(`
        SELECT fk.name AS FKName FROM sys.foreign_keys fk
        WHERE OBJECT_NAME(fk.parent_object_id) = @child
          AND OBJECT_NAME(fk.referenced_object_id) = @parent
      `)
  ).recordset[0] as { FKName: string } | undefined;

  if (fkName) {
    await pool.request().query(`ALTER TABLE [${EXTERNAL_FK_CHILD}] DROP CONSTRAINT [${fkName.FKName}]`);
    console.log(`\nDropped FK ${fkName.FKName} (${EXTERNAL_FK_CHILD} -> ${EXTERNAL_FK_PARENT}).`);
  } else {
    console.log(`\nFK ${EXTERNAL_FK_CHILD} -> ${EXTERNAL_FK_PARENT} already absent.`);
  }

  for (const table of DROP_ORDER) {
    await pool.request().query(`DROP TABLE IF EXISTS [${table}]`);
    console.log(`Dropped ${table}.`);
  }

  // 4. Verify.
  const remaining = await pool.request().query(`
    SELECT name FROM sys.tables
    WHERE name IN ('DashboardUser','DashboardRole','DashboardRolePermission','DashboardAuth')
  `);
  if (remaining.recordset.length > 0) {
    console.error("VERIFY FAILED — still present:", remaining.recordset.map((r) => r.name).join(", "));
    process.exit(1);
  }
  console.log("\nVerified: all four legacy auth tables are gone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
