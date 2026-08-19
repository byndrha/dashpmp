import { getPgPool } from "@/lib/pg";
import { encryptGDriveToken, decryptGDriveToken } from "@/lib/crypto-secret";

export interface GDriveKoneksiRow {
  perusahaanId: number;
  connectedEmail: string;
  connectedAt: string;
}

export interface ResolvedGDriveKoneksi {
  refreshToken: string;
  rootFolderId: string;
}

// Used by the storage module (Task 3) on every upload/read — looks up by
// the same human-readable `kode` the MSSQL side already hardcodes
// ("mkesindo"), not a Postgres perusahaan.id, mirroring resolveKoneksi()'s
// own resolution path in perusahaan-koneksi.ts.
export async function resolveGDriveKoneksi(perusahaanKode: string): Promise<ResolvedGDriveKoneksi | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT gk.refresh_token_encrypted, gk.root_folder_id
     FROM perusahaan_gdrive_koneksi gk
     JOIN perusahaan p ON p.id = gk.perusahaan_id
     WHERE p.kode = $1`,
    [perusahaanKode]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { refreshToken: decryptGDriveToken(row.refresh_token_encrypted), rootFolderId: row.root_folder_id };
}

// Feeds the admin UI (Task 7) — small table, no per-company filtering
// needed server-side, same pattern as perusahaan-koneksi.ts's listAllKoneksi().
export async function listAllGDriveKoneksi(): Promise<GDriveKoneksiRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT perusahaan_id, connected_email, connected_at FROM perusahaan_gdrive_koneksi ORDER BY perusahaan_id`
  );
  return result.rows.map((r) => ({
    perusahaanId: r.perusahaan_id,
    connectedEmail: r.connected_email,
    connectedAt: (r.connected_at as Date).toISOString(),
  }));
}

export async function saveGDriveKoneksi(input: {
  perusahaanId: number;
  connectedEmail: string;
  refreshToken: string;
  rootFolderId: string;
}): Promise<void> {
  const pool = getPgPool();
  const encrypted = encryptGDriveToken(input.refreshToken);
  await pool.query(
    `INSERT INTO perusahaan_gdrive_koneksi (perusahaan_id, connected_email, refresh_token_encrypted, root_folder_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (perusahaan_id) DO UPDATE
     SET connected_email = EXCLUDED.connected_email, refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         root_folder_id = EXCLUDED.root_folder_id, updated_at = now()`,
    [input.perusahaanId, input.connectedEmail, encrypted, input.rootFolderId]
  );
}

export async function deleteGDriveKoneksi(perusahaanId: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM perusahaan_gdrive_koneksi WHERE perusahaan_id = $1`, [perusahaanId]);
}

// Used once by the OAuth callback (Task 4) to name the root Drive folder
// ("Dashboard PMP — <nama> Uploads").
export async function getPerusahaanNama(perusahaanId: number): Promise<string | null> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT nama FROM perusahaan WHERE id = $1`, [perusahaanId]);
  return result.rows[0]?.nama ?? null;
}
