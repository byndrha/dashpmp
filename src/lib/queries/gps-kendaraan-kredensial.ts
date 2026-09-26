import { getPgPool } from "@/lib/pg";
import { encryptGpsCredential, decryptGpsCredential } from "@/lib/crypto-secret";
import { AppError } from "@/lib/action-result";

export type GpsProvider = "hino" | "solofleet";

// Consumed by the provider adapters (Task 5/6) — resolves stored login
// credentials for a Hino Connect / SoloFleet account, decrypting the
// password on the way out.
export async function resolveGpsKredensial(
  provider: GpsProvider
): Promise<{ username: string; password: string; extraConfig: Record<string, unknown> | null } | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT username, password_encrypted, extra_config
     FROM gps_kendaraan_kredensial
     WHERE provider = $1`,
    [provider]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    username: row.username,
    password: decryptGpsCredential(row.password_encrypted),
    extraConfig: row.extra_config,
  };
}

export interface GpsKredensialRow {
  id: number;
  provider: GpsProvider;
  username: string;
  extraConfig: Record<string, unknown> | null;
  updatedAt: string;
}

// Feeds the admin UI (Task 10) — small table (one row per provider), so no
// filtering needed server-side. Never returns the encrypted password.
export async function listGpsKredensial(): Promise<GpsKredensialRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, provider, username, extra_config, updated_at FROM gps_kendaraan_kredensial ORDER BY provider`
  );
  return result.rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    username: r.username,
    extraConfig: r.extra_config,
    updatedAt: r.updated_at,
  }));
}

export interface UpsertGpsKredensialInput {
  provider: GpsProvider;
  username: string;
  // On create: required (the DB column is NOT NULL). On update: blank/null
  // means "keep the existing stored credential" — same write-only
  // convention as perusahaan-koneksi.ts's upsertKoneksi.
  password: string | null;
  extraConfig?: Record<string, unknown>;
}

export async function upsertGpsKredensial(
  input: UpsertGpsKredensialInput,
  updatedByAkunId: string | null
): Promise<void> {
  const pool = getPgPool();
  if (input.password) {
    const encrypted = encryptGpsCredential(input.password);
    await pool.query(
      `INSERT INTO gps_kendaraan_kredensial (provider, username, password_encrypted, extra_config, updated_by_akun_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider) DO UPDATE
       SET username = EXCLUDED.username, password_encrypted = EXCLUDED.password_encrypted,
           extra_config = EXCLUDED.extra_config, updated_by_akun_id = EXCLUDED.updated_by_akun_id,
           updated_at = now()`,
      [input.provider, input.username, encrypted, input.extraConfig ?? null, updatedByAkunId]
    );
    return;
  }
  const result = await pool.query(
    `UPDATE gps_kendaraan_kredensial SET username = $1, extra_config = $2, updated_by_akun_id = $3, updated_at = now()
     WHERE provider = $4`,
    [input.username, input.extraConfig ?? null, updatedByAkunId, input.provider]
  );
  if (result.rowCount === 0) {
    throw new AppError(`Kredensial "${input.provider}" belum ada — password wajib diisi untuk membuat kredensial baru.`);
  }
}
