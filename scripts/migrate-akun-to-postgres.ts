// One-off migration: copies DashboardRole/DashboardRolePermission/DashboardUser
// from MSSQL into Postgres (peran/peran_izin/akun), preserving RoleID values
// exactly. Read-only against MSSQL — never writes there. Safe to re-run
// (roles/permissions use ON CONFLICT upsert; users are skipped if already
// present by username).
//
// Usage: npx tsx scripts/migrate-akun-to-postgres.ts
import "dotenv/config";
import { getPool as getMssqlPool } from "../src/lib/db";
import { getPgPool } from "../src/lib/pg";

interface MssqlRole {
  RoleID: number;
  RoleName: string;
  IsSuperAdmin: boolean;
}
interface MssqlRolePermission {
  RoleID: number;
  ModuleKey: string;
  CanView: boolean;
  CanEdit: boolean;
}
interface MssqlUser {
  UserID: number;
  Nama: string;
  Username: string;
  PasswordHash: string;
  NomorTelepon: string | null;
  Email: string | null;
  RoleID: number;
  IsActive: boolean;
  FailedLoginCount: number | null;
  LockedUntil: Date | null;
  LastLoginAt: Date | null;
  LastLoginIP: string | null;
}

async function main() {
  const mssql = await getMssqlPool();
  const pg = getPgPool();

  const perusahaanRow = await pg.query(`SELECT id FROM perusahaan WHERE kode = 'mkesindo'`);
  if (perusahaanRow.rows.length === 0) throw new Error('No perusahaan row with kode="mkesindo" — run migrate-directory-db.ts first.');
  const mkesindoId = perusahaanRow.rows[0].id as number;

  // 1. Roles — explicit id preserves the exact MSSQL RoleID.
  const rolesResult = await mssql.request().query(`SELECT RoleID, RoleName, IsSuperAdmin FROM DashboardRole`);
  const roles = rolesResult.recordset as MssqlRole[];
  for (const r of roles) {
    await pg.query(
      `INSERT INTO peran (id, perusahaan_id, nama, is_super_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET nama = EXCLUDED.nama, is_super_admin = EXCLUDED.is_super_admin`,
      [r.RoleID, mkesindoId, r.RoleName, r.IsSuperAdmin]
    );
  }
  await pg.query(`SELECT setval('peran_id_seq', (SELECT COALESCE(MAX(id), 1) FROM peran))`);
  console.log(`Migrated ${roles.length} roles (IDs preserved).`);

  // 2. Role permissions.
  const permsResult = await mssql.request().query(`SELECT RoleID, ModuleKey, CanView, CanEdit FROM DashboardRolePermission`);
  const perms = permsResult.recordset as MssqlRolePermission[];
  for (const p of perms) {
    await pg.query(
      `INSERT INTO peran_izin (peran_id, module_key, can_view, can_edit)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (peran_id, module_key) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
      [p.RoleID, p.ModuleKey, p.CanView, p.CanEdit]
    );
  }
  console.log(`Migrated ${perms.length} role permissions.`);

  // 3. Users — password_hash copied byte-for-byte (bcrypt hashes are
  // self-contained and portable, no re-hashing). New auto-increment akun.id
  // is fine; nothing in the codebase hardcodes a specific UserID.
  const usersResult = await mssql.request().query(`
    SELECT UserID, Nama, Username, PasswordHash, NomorTelepon, Email, RoleID, IsActive,
           FailedLoginCount, LockedUntil, LastLoginAt, LastLoginIP
    FROM DashboardUser
  `);
  const users = usersResult.recordset as MssqlUser[];
  let migrated = 0;
  let skipped = 0;
  for (const u of users) {
    const exists = await pg.query(`SELECT 1 FROM akun WHERE username = $1`, [u.Username]);
    if ((exists.rowCount ?? 0) > 0) {
      skipped++;
      continue;
    }
    await pg.query(
      `INSERT INTO akun
         (username, password_hash, nama, email, nomor_telepon, peran_id, perusahaan_id,
          is_active, failed_login_count, locked_until, last_login_at, last_login_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        u.Username, u.PasswordHash, u.Nama, u.Email, u.NomorTelepon, u.RoleID, mkesindoId,
        u.IsActive, u.FailedLoginCount ?? 0, u.LockedUntil, u.LastLoginAt, u.LastLoginIP,
      ]
    );
    migrated++;
  }
  console.log(`Migrated ${migrated} users, skipped ${skipped} already-present (of ${users.length} MSSQL source rows).`);

  // 4. Verification — row counts and RoleID-preservation spot-check.
  const pgRoleCount = await pg.query(`SELECT count(*) FROM peran WHERE perusahaan_id = $1`, [mkesindoId]);
  const pgUserCount = await pg.query(`SELECT count(*) FROM akun WHERE perusahaan_id = $1`, [mkesindoId]);
  console.log(`Postgres peran count (mkesindo): ${pgRoleCount.rows[0].count} vs MSSQL DashboardRole: ${roles.length}`);
  console.log(`Postgres akun count (mkesindo): ${pgUserCount.rows[0].count} vs MSSQL DashboardUser: ${users.length}`);

  for (const r of roles) {
    const check = await pg.query(`SELECT nama, is_super_admin FROM peran WHERE id = $1`, [r.RoleID]);
    const ok = check.rows[0]?.nama === r.RoleName && check.rows[0]?.is_super_admin === r.IsSuperAdmin;
    console.log(`  RoleID ${r.RoleID} ("${r.RoleName}") preserved correctly: ${ok}`);
    if (!ok) {
      console.error("MIGRATION FAILED: RoleID mismatch detected.");
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
