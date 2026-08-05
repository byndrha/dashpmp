import { getPgPool } from "@/lib/pg";
import { MARKETING_ROLE_ID } from "@/lib/roles";

const RETENTION_DAYS = 30;

// One row per ping. Self-cleaning: every insert also deletes this same
// account's rows older than RETENTION_DAYS, so the table stays bounded
// without a cron job or scheduled task (this project has none of its own —
// continuous 1-2 minute pings from an active device are what keep this
// cleanup running).
export async function recordLokasi(
  akunId: number,
  latitude: number,
  longitude: number,
  accuracy: number | null
): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO akun_lokasi (akun_id, latitude, longitude, accuracy) VALUES ($1, $2, $3, $4)`,
    [akunId, latitude, longitude, accuracy]
  );
  await pool.query(
    `DELETE FROM akun_lokasi WHERE akun_id = $1 AND recorded_at < now() - INTERVAL '${RETENTION_DAYS} days'`,
    [akunId]
  );
}

export interface MarketingPosition {
  akunId: number;
  nama: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
}

// Latest position per Marketing account — DISTINCT ON is Postgres's
// idiomatic "one row per group, picked by ORDER BY" pattern.
export async function getLatestMarketingPositions(): Promise<MarketingPosition[]> {
  const pool = getPgPool();
  const result = await pool.query<{
    akun_id: number;
    nama: string;
    latitude: number;
    longitude: number;
    recorded_at: Date;
  }>(
    `SELECT DISTINCT ON (a.id) a.id AS akun_id, a.nama, al.latitude, al.longitude, al.recorded_at
     FROM akun a
     JOIN akun_lokasi al ON al.akun_id = a.id
     WHERE a.peran_id = $1
     ORDER BY a.id, al.recorded_at DESC`,
    [MARKETING_ROLE_ID]
  );
  return result.rows.map((r) => ({
    akunId: r.akun_id,
    nama: r.nama,
    latitude: r.latitude,
    longitude: r.longitude,
    recordedAt: r.recorded_at.toISOString(),
  }));
}
