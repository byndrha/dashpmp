import { getPgPool } from "@/lib/pg";
import { encryptSecret, decryptSecret } from "@/lib/crypto-secret";
import { AppError } from "@/lib/action-result";

export interface ResolvedKoneksi {
  host: string;
  port: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

// Runtime resolution path — db.ts and db-pmputra.ts only know static `kode`
// constants ("mkesindo" / "pmputra"), not a Postgres perusahaan.id, so this
// resolves by the human-readable pair instead of a foreign key. See
// docs/superpowers/specs/2026-07-30-perusahaan-db-koneksi-design.md.
export async function resolveKoneksi(kode: string, label: string): Promise<ResolvedKoneksi | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT pk.host, pk.port, pk.db_name, pk.db_user, pk.db_password_encrypted
     FROM perusahaan_koneksi pk
     JOIN perusahaan p ON p.id = pk.perusahaan_id
     WHERE p.kode = $1 AND pk.label = $2`,
    [kode, label]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    dbName: row.db_name,
    dbUser: row.db_user,
    dbPassword: decryptSecret(row.db_password_encrypted),
  };
}

export interface KoneksiRow {
  id: number;
  perusahaanId: number;
  label: string;
  host: string;
  port: number;
  dbName: string;
  dbUser: string;
}

// Feeds the admin UI (Task 6) — small table (a handful of rows total across
// all companies), so no per-company filtering needed server-side; the
// dialog filters client-side by the currently linked perusahaanId.
export async function listAllKoneksi(): Promise<KoneksiRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, perusahaan_id, label, host, port, db_name, db_user FROM perusahaan_koneksi ORDER BY perusahaan_id, label`
  );
  return result.rows.map((r) => ({
    id: r.id,
    perusahaanId: r.perusahaan_id,
    label: r.label,
    host: r.host,
    port: r.port,
    dbName: r.db_name,
    dbUser: r.db_user,
  }));
}

export interface UpsertKoneksiInput {
  perusahaanId: number;
  label: string;
  host: string;
  port: number;
  dbName: string;
  dbUser: string;
  // On create: required (the DB column is NOT NULL). On update: blank means
  // "keep the existing stored credential" — same write-only convention as
  // perusahaan.ts's dbPassword.
  dbPassword: string | null;
}

export async function upsertKoneksi(input: UpsertKoneksiInput): Promise<void> {
  const pool = getPgPool();
  if (input.dbPassword) {
    const encrypted = encryptSecret(input.dbPassword);
    await pool.query(
      `INSERT INTO perusahaan_koneksi (perusahaan_id, label, db_engine, host, port, db_name, db_user, db_password_encrypted)
       VALUES ($1, $2, 'mssql', $3, $4, $5, $6, $7)
       ON CONFLICT (perusahaan_id, label) DO UPDATE
       SET host = EXCLUDED.host, port = EXCLUDED.port, db_name = EXCLUDED.db_name,
           db_user = EXCLUDED.db_user, db_password_encrypted = EXCLUDED.db_password_encrypted,
           updated_at = now()`,
      [input.perusahaanId, input.label, input.host, input.port, input.dbName, input.dbUser, encrypted]
    );
    return;
  }
  const result = await pool.query(
    `UPDATE perusahaan_koneksi SET host = $1, port = $2, db_name = $3, db_user = $4, updated_at = now()
     WHERE perusahaan_id = $5 AND label = $6`,
    [input.host, input.port, input.dbName, input.dbUser, input.perusahaanId, input.label]
  );
  if (result.rowCount === 0) {
    throw new AppError(`Koneksi "${input.label}" belum ada — password wajib diisi untuk membuat koneksi baru.`);
  }
}

export async function deleteKoneksi(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM perusahaan_koneksi WHERE id = $1`, [id]);
}
