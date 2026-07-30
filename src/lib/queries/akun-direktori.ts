import bcrypt from "bcryptjs";
import { getPgPool } from "@/lib/pg";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

// "direktur" sees /grup (cross-company summary, no perusahaanId); "pmputra"
// sees /pmputra (perusahaanId always set to the pmputra row). MKEsindo
// accounts never live here — they stay in MSSQL DashboardUser, unchanged.
export type AkunDirektoriScope = "direktur" | "pmputra";

export interface AkunDirektoriAuthRow {
  id: number;
  username: string;
  passwordHash: string;
  nama: string;
  scope: AkunDirektoriScope;
  perusahaanId: number | null;
  isActive: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

// Looked up first in auth.ts's authorize() — see docs/superpowers/specs/
// 2026-07-30-postgres-directory-multi-company.md for why Postgres is
// checked before falling back to the existing MSSQL DashboardUser query.
export async function findAkunDirektoriByUsername(username: string): Promise<AkunDirektoriAuthRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, username, password_hash, nama, scope, perusahaan_id, is_active, failed_login_count, locked_until
     FROM akun_direktori WHERE username = $1`,
    [username]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    nama: row.nama,
    scope: row.scope,
    perusahaanId: row.perusahaan_id,
    isActive: row.is_active,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
  };
}

// Same lockout arithmetic as auth.ts's MSSQL branch (5 attempts / 15 min).
export async function recordFailedLogin(id: number, currentFailedCount: number): Promise<void> {
  const pool = getPgPool();
  const newFailedCount = currentFailedCount + 1;
  const lockedUntil = newFailedCount >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
  await pool.query(`UPDATE akun_direktori SET failed_login_count = $1, locked_until = $2 WHERE id = $3`, [
    newFailedCount,
    lockedUntil,
    id,
  ]);
}

export async function recordSuccessfulLogin(id: number, ip: string | null): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE akun_direktori
     SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), last_login_ip = $1, updated_at = now()
     WHERE id = $2`,
    [ip, id]
  );
}

export interface AkunDirektoriRow {
  id: number;
  username: string;
  nama: string;
  email: string | null;
  scope: AkunDirektoriScope;
  perusahaanId: number | null;
  perusahaanNama: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
}

export async function listAkunDirektori(): Promise<AkunDirektoriRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`
    SELECT a.id, a.username, a.nama, a.email, a.scope, a.perusahaan_id, p.nama AS perusahaan_nama,
           a.is_active, a.last_login_at
    FROM akun_direktori a
    LEFT JOIN perusahaan p ON p.id = a.perusahaan_id
    ORDER BY a.nama
  `);
  return result.rows.map((r) => ({
    id: r.id,
    username: r.username,
    nama: r.nama,
    email: r.email,
    scope: r.scope,
    perusahaanId: r.perusahaan_id,
    perusahaanNama: r.perusahaan_nama,
    isActive: r.is_active,
    lastLoginAt: r.last_login_at,
  }));
}

export interface PerusahaanDirektoriOption {
  id: number;
  kode: string;
  nama: string;
}

// Feeds the admin form's "Perusahaan" picker — only shown for scope=pmputra
// (direktur accounts are cross-company, perusahaanId stays null).
export async function listPerusahaanDirektori(): Promise<PerusahaanDirektoriOption[]> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT id, kode, nama FROM perusahaan ORDER BY nama`);
  return result.rows;
}

export interface CreateAkunDirektoriInput {
  username: string;
  password: string;
  nama: string;
  email: string | null;
  scope: AkunDirektoriScope;
  perusahaanId: number | null;
}

export async function createAkunDirektori(input: CreateAkunDirektoriInput): Promise<void> {
  const pool = getPgPool();
  const passwordHash = await bcrypt.hash(input.password, 12);
  await pool.query(
    `INSERT INTO akun_direktori (username, password_hash, nama, email, scope, perusahaan_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.username, passwordHash, input.nama, input.email, input.scope, input.perusahaanId]
  );
}

export interface UpdateAkunDirektoriInput {
  id: number;
  nama: string;
  email: string | null;
  scope: AkunDirektoriScope;
  perusahaanId: number | null;
  isActive: boolean;
}

export async function updateAkunDirektori(input: UpdateAkunDirektoriInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE akun_direktori
     SET nama = $1, email = $2, scope = $3, perusahaan_id = $4, is_active = $5, updated_at = now()
     WHERE id = $6`,
    [input.nama, input.email, input.scope, input.perusahaanId, input.isActive, input.id]
  );
}

export async function resetAkunDirektoriPassword(id: number, newPassword: string): Promise<void> {
  const pool = getPgPool();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    `UPDATE akun_direktori
     SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now()
     WHERE id = $2`,
    [passwordHash, id]
  );
}

export async function deleteAkunDirektori(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM akun_direktori WHERE id = $1`, [id]);
}
