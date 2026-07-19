import bcrypt from "bcryptjs";
import { getPool, sql } from "@/lib/db";
import { MODULE_KEYS, type ModuleKey, type PermissionMap } from "@/lib/permissions";

export interface DashboardRoleRow {
  roleId: number;
  roleName: string;
  isSuperAdmin: boolean;
  userCount: number;
}

export interface DashboardUserRow {
  userId: number;
  nama: string;
  username: string;
  nomorTelepon: string | null;
  email: string | null;
  roleId: number;
  roleName: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export async function getPermissionMapForRole(roleId: number): Promise<PermissionMap> {
  const pool = await getPool();
  const result = await pool.request().input("roleId", sql.Int, roleId).query(`
    SELECT ModuleKey, CanView, CanEdit FROM DashboardRolePermission WHERE RoleID = @roleId
  `);
  const map: PermissionMap = {};
  for (const row of result.recordset as { ModuleKey: string; CanView: boolean; CanEdit: boolean }[]) {
    if ((MODULE_KEYS as readonly string[]).includes(row.ModuleKey)) {
      map[row.ModuleKey as ModuleKey] = { canView: row.CanView, canEdit: row.CanEdit };
    }
  }
  return map;
}

export async function listUsers(): Promise<DashboardUserRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT du.UserID, du.Nama, du.Username, du.NomorTelepon, du.Email,
           du.RoleID, r.RoleName, du.IsActive, du.LastLoginAt
    FROM DashboardUser du
    JOIN DashboardRole r ON r.RoleID = du.RoleID
    ORDER BY du.Nama
  `);
  return (
    result.recordset as {
      UserID: number;
      Nama: string;
      Username: string;
      NomorTelepon: string | null;
      Email: string | null;
      RoleID: number;
      RoleName: string;
      IsActive: boolean;
      LastLoginAt: string | null;
    }[]
  ).map((r) => ({
    userId: r.UserID,
    nama: r.Nama,
    username: r.Username,
    nomorTelepon: r.NomorTelepon,
    email: r.Email,
    roleId: r.RoleID,
    roleName: r.RoleName,
    isActive: r.IsActive,
    lastLoginAt: r.LastLoginAt,
  }));
}

export async function listRoles(): Promise<DashboardRoleRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT r.RoleID, r.RoleName, r.IsSuperAdmin,
           (SELECT COUNT(*) FROM DashboardUser du WHERE du.RoleID = r.RoleID) AS UserCount
    FROM DashboardRole r
    ORDER BY r.IsSuperAdmin DESC, r.RoleName
  `);
  return (
    result.recordset as { RoleID: number; RoleName: string; IsSuperAdmin: boolean; UserCount: number }[]
  ).map((r) => ({ roleId: r.RoleID, roleName: r.RoleName, isSuperAdmin: r.IsSuperAdmin, userCount: r.UserCount }));
}

export async function getRolePermissions(): Promise<
  { roleId: number; moduleKey: string; canView: boolean; canEdit: boolean }[]
> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT RoleID, ModuleKey, CanView, CanEdit FROM DashboardRolePermission`);
  return (result.recordset as { RoleID: number; ModuleKey: string; CanView: boolean; CanEdit: boolean }[]).map(
    (r) => ({ roleId: r.RoleID, moduleKey: r.ModuleKey, canView: r.CanView, canEdit: r.CanEdit })
  );
}

export async function countActiveSuperAdmins(excludeUserId?: number): Promise<number> {
  const pool = await getPool();
  const request = pool.request();
  let query = `
    SELECT COUNT(*) AS N
    FROM DashboardUser du
    JOIN DashboardRole r ON r.RoleID = du.RoleID
    WHERE r.IsSuperAdmin = 1 AND du.IsActive = 1
  `;
  if (excludeUserId != null) {
    request.input("excludeUserId", sql.Int, excludeUserId);
    query += ` AND du.UserID <> @excludeUserId`;
  }
  const result = await request.query(query);
  return (result.recordset[0] as { N: number }).N;
}

export async function createUser(input: {
  nama: string;
  username: string;
  password: string;
  nomorTelepon: string | null;
  email: string | null;
  roleId: number;
}): Promise<void> {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash(input.password, 12);
  await pool
    .request()
    .input("nama", sql.VarChar(128), input.nama)
    .input("username", sql.VarChar(128), input.username)
    .input("passwordHash", sql.VarChar(255), passwordHash)
    .input("nomorTelepon", sql.VarChar(32), input.nomorTelepon)
    .input("email", sql.VarChar(128), input.email)
    .input("roleId", sql.Int, input.roleId).query(`
      INSERT INTO DashboardUser (Nama, Username, PasswordHash, NomorTelepon, Email, RoleID)
      VALUES (@nama, @username, @passwordHash, @nomorTelepon, @email, @roleId)
    `);
}

export async function updateUser(input: {
  userId: number;
  nama: string;
  nomorTelepon: string | null;
  email: string | null;
  roleId: number;
  isActive: boolean;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("userId", sql.Int, input.userId)
    .input("nama", sql.VarChar(128), input.nama)
    .input("nomorTelepon", sql.VarChar(32), input.nomorTelepon)
    .input("email", sql.VarChar(128), input.email)
    .input("roleId", sql.Int, input.roleId)
    .input("isActive", sql.Bit, input.isActive).query(`
      UPDATE DashboardUser
      SET Nama = @nama, NomorTelepon = @nomorTelepon, Email = @email,
          RoleID = @roleId, IsActive = @isActive, UpdatedAt = GETDATE()
      WHERE UserID = @userId
    `);
}

export async function resetUserPassword(userId: number, newPassword: string): Promise<void> {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool
    .request()
    .input("userId", sql.Int, userId)
    .input("passwordHash", sql.VarChar(255), passwordHash).query(`
      UPDATE DashboardUser
      SET PasswordHash = @passwordHash, FailedLoginCount = 0, LockedUntil = NULL, UpdatedAt = GETDATE()
      WHERE UserID = @userId
    `);
}

export async function createRole(roleName: string): Promise<void> {
  const pool = await getPool();
  await pool.request().input("roleName", sql.VarChar(64), roleName).query(`
    INSERT INTO DashboardRole (RoleName) VALUES (@roleName)
  `);
}

export async function deleteRole(roleId: number): Promise<void> {
  const pool = await getPool();
  await pool.request().input("roleId", sql.Int, roleId).query(`
    DELETE FROM DashboardRolePermission WHERE RoleID = @roleId;
    DELETE FROM DashboardRole WHERE RoleID = @roleId;
  `);
}

export async function setRolePermission(input: {
  roleId: number;
  moduleKey: ModuleKey;
  canView: boolean;
  canEdit: boolean;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("roleId", sql.Int, input.roleId)
    .input("moduleKey", sql.VarChar(32), input.moduleKey)
    .input("canView", sql.Bit, input.canView)
    .input("canEdit", sql.Bit, input.canEdit).query(`
      MERGE DashboardRolePermission AS target
      USING (SELECT @roleId AS RoleID, @moduleKey AS ModuleKey) AS src
      ON target.RoleID = src.RoleID AND target.ModuleKey = src.ModuleKey
      WHEN MATCHED THEN
        UPDATE SET CanView = @canView, CanEdit = @canEdit
      WHEN NOT MATCHED THEN
        INSERT (RoleID, ModuleKey, CanView, CanEdit) VALUES (@roleId, @moduleKey, @canView, @canEdit);
    `);
}
