import bcrypt from "bcryptjs";
import { getPgPool } from "@/lib/pg";
import { MODULE_KEYS, type ModuleKey, type PermissionMap } from "@/lib/permissions";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

// ---------- Auth (consumed by auth.ts's single-stage authorize()) ----------

export interface AkunAuthRow {
  id: number;
  username: string;
  passwordHash: string;
  nama: string;
  peranId: number | null;
  perusahaanId: number | null;
  perusahaanKode: string | null; // null only for Direktur accounts
  isSuperAdmin: boolean;
  isSatpam: boolean;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export async function findAkunByUsername(username: string): Promise<AkunAuthRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT a.id, a.username, a.password_hash, a.nama, a.peran_id, a.perusahaan_id, p.kode AS perusahaan_kode,
            COALESCE(r.is_super_admin, false) AS is_super_admin,
            COALESCE(r.is_satpam, false) AS is_satpam,
            a.is_active, a.failed_login_count, a.locked_until
     FROM akun a
     LEFT JOIN perusahaan p ON p.id = a.perusahaan_id
     LEFT JOIN peran r ON r.id = a.peran_id
     WHERE a.username = $1`,
    [username]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    nama: row.nama,
    peranId: row.peran_id,
    perusahaanId: row.perusahaan_id,
    perusahaanKode: row.perusahaan_kode,
    isSuperAdmin: row.is_super_admin,
    isSatpam: row.is_satpam,
    isActive: row.is_active,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
  };
}

export async function recordFailedLogin(id: number, currentFailedCount: number): Promise<void> {
  const pool = getPgPool();
  const newFailedCount = currentFailedCount + 1;
  const lockedUntil = newFailedCount >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
  await pool.query(`UPDATE akun SET failed_login_count = $1, locked_until = $2 WHERE id = $3`, [
    newFailedCount,
    lockedUntil,
    id,
  ]);
}

export async function recordSuccessfulLogin(id: number, ip: string | null): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE akun SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), last_login_ip = $1, updated_at = now()
     WHERE id = $2`,
    [ip, id]
  );
}

export async function getPermissionMapForPeran(peranId: number): Promise<PermissionMap> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT module_key, can_view, can_edit FROM peran_izin WHERE peran_id = $1`, [peranId]);
  const map: PermissionMap = {};
  for (const row of result.rows as { module_key: string; can_view: boolean; can_edit: boolean }[]) {
    if ((MODULE_KEYS as readonly string[]).includes(row.module_key)) {
      map[row.module_key as ModuleKey] = { canView: row.can_view, canEdit: row.can_edit };
    }
  }
  return map;
}

// ---------- Own profile — names/shapes preserved exactly for
// src/app/(dashboard)/profile-actions.ts and src/app/(dashboard)/layout.tsx,
// which import getUserById/updateOwnProfile/changeOwnPassword and must not
// need any changes. ----------

export interface OwnProfileRow {
  nama: string;
  username: string;
  nomorTelepon: string | null;
  email: string | null;
}

export async function getUserById(id: number): Promise<OwnProfileRow | null> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT nama, username, nomor_telepon, email FROM akun WHERE id = $1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return { nama: row.nama, username: row.username, nomorTelepon: row.nomor_telepon, email: row.email };
}

export async function updateOwnProfile(input: {
  userId: number;
  nama: string;
  nomorTelepon: string | null;
  email: string | null;
}): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE akun SET nama = $1, nomor_telepon = $2, email = $3, updated_at = now() WHERE id = $4`, [
    input.nama,
    input.nomorTelepon,
    input.email,
    input.userId,
  ]);
}

export async function changeOwnPassword(input: {
  userId: number;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT password_hash FROM akun WHERE id = $1`, [input.userId]);
  const row = result.rows[0] as { password_hash: string } | undefined;
  if (!row) throw new Error("Akun tidak ditemukan.");

  const currentOk = await bcrypt.compare(input.currentPassword, row.password_hash);
  if (!currentOk) throw new Error("Password saat ini salah.");

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await pool.query(`UPDATE akun SET password_hash = $1, updated_at = now() WHERE id = $2`, [passwordHash, input.userId]);
}

// ---------- Perusahaan lookup — preserved exactly for perusahaan-form-dialog.tsx,
// perusahaan-list.tsx, grup/perusahaan/page.tsx (previous plan's admin UI). ----------

export interface PerusahaanDirektoriOption {
  id: number;
  kode: string;
  nama: string;
}

export async function listPerusahaanDirektori(): Promise<PerusahaanDirektoriOption[]> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT id, kode, nama FROM perusahaan ORDER BY nama`);
  return result.rows;
}

// ---------- Admin: Akun CRUD (consumed by /grup/akun) ----------

export interface AkunRow {
  id: number;
  username: string;
  nama: string;
  email: string | null;
  nomorTelepon: string | null;
  perusahaanId: number | null;
  perusahaanNama: string | null; // null for Direktur
  perusahaanKode: string | null; // null for Direktur
  peranId: number | null;
  peranNama: string | null; // null for Direktur
  isActive: boolean;
  lastLoginAt: Date | null;
}

export async function listAkun(): Promise<AkunRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT a.id, a.username, a.nama, a.email, a.nomor_telepon,
           a.perusahaan_id, p.nama AS perusahaan_nama, p.kode AS perusahaan_kode,
           a.peran_id, r.nama AS peran_nama,
           a.is_active, a.last_login_at
    FROM akun a
    LEFT JOIN perusahaan p ON p.id = a.perusahaan_id
    LEFT JOIN peran r ON r.id = a.peran_id
    ORDER BY a.nama
  `);
  return result.rows.map((row) => ({
    id: row.id,
    username: row.username,
    nama: row.nama,
    email: row.email,
    nomorTelepon: row.nomor_telepon,
    perusahaanId: row.perusahaan_id,
    perusahaanNama: row.perusahaan_nama,
    perusahaanKode: row.perusahaan_kode,
    peranId: row.peran_id,
    peranNama: row.peran_nama,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
  }));
}

// PT-scoped: "at least one active superadmin" is now an invariant per
// perusahaan_id, not global — a Direktur-only account count (perusahaanId
// null) never needs this check.
export async function countActiveSuperAdmins(perusahaanId: number, excludeAkunId?: number): Promise<number> {
  const pool = getPgPool();
  const params: unknown[] = [perusahaanId];
  let query = `
    SELECT count(*) FROM akun a
    JOIN peran r ON r.id = a.peran_id
    WHERE a.perusahaan_id = $1 AND r.is_super_admin = true AND a.is_active = true
  `;
  if (excludeAkunId != null) {
    params.push(excludeAkunId);
    query += ` AND a.id <> $2`;
  }
  const result = await pool.query(query, params);
  return Number(result.rows[0].count);
}

export interface CreateAkunInput {
  nama: string;
  username: string;
  password: string;
  email: string | null;
  nomorTelepon: string | null;
  perusahaanId: number | null; // null = Direktur
  peranId: number | null; // null = Direktur
}

export async function createAkun(input: CreateAkunInput): Promise<void> {
  const pool = getPgPool();
  const passwordHash = await bcrypt.hash(input.password, 12);
  await pool.query(
    `INSERT INTO akun (username, password_hash, nama, email, nomor_telepon, perusahaan_id, peran_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.username, passwordHash, input.nama, input.email, input.nomorTelepon, input.perusahaanId, input.peranId]
  );
}

export interface UpdateAkunInput {
  id: number;
  nama: string;
  email: string | null;
  nomorTelepon: string | null;
  perusahaanId: number | null;
  peranId: number | null;
  isActive: boolean;
}

export async function updateAkun(input: UpdateAkunInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE akun SET nama = $1, email = $2, nomor_telepon = $3, perusahaan_id = $4, peran_id = $5, is_active = $6, updated_at = now()
     WHERE id = $7`,
    [input.nama, input.email, input.nomorTelepon, input.perusahaanId, input.peranId, input.isActive, input.id]
  );
}

export async function resetAkunPassword(id: number, newPassword: string): Promise<void> {
  const pool = getPgPool();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    `UPDATE akun SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $2`,
    [passwordHash, id]
  );
}

export async function deleteAkun(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM akun WHERE id = $1`, [id]);
}

// ---------- Admin: Peran CRUD (consumed by /grup/akun/peran). "listAll"/
// "getAll" (not per-PT-filtered server-side) matches the established
// pattern from the previous plan's listAllKoneksi() — small table, UI
// filters client-side by the selected PT. ----------

export interface PeranRow {
  id: number;
  perusahaanId: number;
  nama: string;
  isSuperAdmin: boolean;
  isSatpam: boolean;
  akunCount: number;
}

export async function listAllPeran(): Promise<PeranRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT r.id, r.perusahaan_id, r.nama, r.is_super_admin, r.is_satpam,
           (SELECT count(*) FROM akun a WHERE a.peran_id = r.id) AS akun_count
    FROM peran r
    ORDER BY r.perusahaan_id, r.is_super_admin DESC, r.nama
  `);
  return result.rows.map((row) => ({
    id: row.id,
    perusahaanId: row.perusahaan_id,
    nama: row.nama,
    isSuperAdmin: row.is_super_admin,
    isSatpam: row.is_satpam,
    akunCount: Number(row.akun_count),
  }));
}

export interface PeranIzinRow {
  peranId: number;
  moduleKey: string;
  canView: boolean;
  canEdit: boolean;
}

export async function getAllPeranIzin(): Promise<PeranIzinRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT peran_id, module_key, can_view, can_edit FROM peran_izin`);
  return result.rows.map((row) => ({
    peranId: row.peran_id,
    moduleKey: row.module_key,
    canView: row.can_view,
    canEdit: row.can_edit,
  }));
}

export async function createPeran(perusahaanId: number, nama: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(`INSERT INTO peran (perusahaan_id, nama) VALUES ($1, $2)`, [perusahaanId, nama]);
}

export async function deletePeran(peranId: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM peran_izin WHERE peran_id = $1`, [peranId]);
  await pool.query(`DELETE FROM peran WHERE id = $1`, [peranId]);
}

export async function setPeranIzin(input: {
  peranId: number;
  moduleKey: ModuleKey;
  canView: boolean;
  canEdit: boolean;
}): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO peran_izin (peran_id, module_key, can_view, can_edit)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (peran_id, module_key) DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit`,
    [input.peranId, input.moduleKey, input.canView, input.canEdit]
  );
}

export async function setPeranSatpam(peranId: number, isSatpam: boolean): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE peran SET is_satpam = $1 WHERE id = $2`, [isSatpam, peranId]);
}
