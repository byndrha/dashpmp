import { getPgPool } from "@/lib/pg";
import { normalizePlate, type NormalizedVehiclePosition } from "@/lib/gps-providers/types";

const RETENTION_DAYS = 14;

export interface VehiclePositionRow {
  armadaId: number | null;
  provider: "hino" | "solofleet";
  plateRaw: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  recordedAt: string; // ISO
}

export interface VehicleTrailPoint {
  latitude: number;
  longitude: number;
  recordedAt: string; // ISO
}

// One row per ping, per provider position. `armadaByPlate` is built by the
// caller (Task 8) from live Armada.PlatNomor (MSSQL ERP) keyed by
// normalizePlate() — looked up here per position so an unmatched plate still
// gets recorded (armada_id NULL) rather than being dropped.
export async function insertVehiclePositions(
  positions: NormalizedVehiclePosition[],
  armadaByPlate: Map<string, number>
): Promise<void> {
  const pool = getPgPool();
  for (const position of positions) {
    const armadaId = armadaByPlate.get(normalizePlate(position.plateRaw)) ?? null;
    try {
      await pool.query(
        `INSERT INTO armada_gps_riwayat
           (provider, external_vehicle_id, plat_nomor_raw, plat_nomor_normalized, armada_id,
            latitude, longitude, speed_kmh, heading, ignition_on, recorded_at, raw_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          position.provider,
          position.externalVehicleId,
          position.plateRaw,
          normalizePlate(position.plateRaw),
          armadaId,
          position.latitude,
          position.longitude,
          position.speedKmh,
          position.heading,
          position.ignitionOn,
          position.recordedAtUtc,
          JSON.stringify(position.rawPayload),
        ]
      );
    } catch (err) {
      // One bad row (e.g. an invalid/NaN recorded_at) shouldn't abort the
      // rest of the batch — log and continue with the remaining positions.
      console.warn(
        `[armada-gps] Gagal insert posisi (provider=${position.provider}, externalVehicleId=${position.externalVehicleId}):`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

// Latest ping per distinct physical device. Grouping by
// COALESCE(armada_id::text, provider || ':' || external_vehicle_id) — rather
// than by armada_id alone — keeps two different devices visible even if they
// somehow resolved to the same armada_id (matching collision), while still
// deduping repeated pings from the same device down to its single latest one.
// Unmatched devices (armada_id NULL) are grouped by their own provider +
// external_vehicle_id, so each one still shows up as its own row.
export async function getLatestVehiclePositions(): Promise<VehiclePositionRow[]> {
  const pool = getPgPool();
  const result = await pool.query<{
    armada_id: number | null;
    provider: "hino" | "solofleet";
    plat_nomor_raw: string;
    latitude: number;
    longitude: number;
    speed_kmh: number | null;
    heading: number | null;
    recorded_at: Date;
  }>(
    `SELECT DISTINCT ON (COALESCE(armada_id::text, provider || ':' || external_vehicle_id))
            armada_id, provider, plat_nomor_raw, latitude, longitude, speed_kmh, heading, recorded_at
     FROM armada_gps_riwayat
     ORDER BY COALESCE(armada_id::text, provider || ':' || external_vehicle_id), recorded_at DESC`
  );
  return result.rows.map((r) => ({
    armadaId: r.armada_id,
    provider: r.provider,
    plateRaw: r.plat_nomor_raw,
    latitude: r.latitude,
    longitude: r.longitude,
    speedKmh: r.speed_kmh,
    heading: r.heading,
    recordedAt: r.recorded_at.toISOString(),
  }));
}

// Every ping in the last `hoursBack` hours for one armada, ordered oldest ->
// newest, ready to draw directly as a Polyline path (same shape as
// akun-lokasi.ts's getMarketingPositionHistory, scoped to a single armada_id
// instead of grouping by account).
export async function getVehicleTrail(armadaId: number, hoursBack: number): Promise<VehicleTrailPoint[]> {
  const pool = getPgPool();
  const result = await pool.query<{
    latitude: number;
    longitude: number;
    recorded_at: Date;
  }>(
    `SELECT latitude, longitude, recorded_at
     FROM armada_gps_riwayat
     WHERE armada_id = $1 AND recorded_at >= now() - ($2 || ' hours')::interval
     ORDER BY recorded_at ASC`,
    [armadaId, hoursBack]
  );
  return result.rows.map((r) => ({
    latitude: r.latitude,
    longitude: r.longitude,
    recordedAt: r.recorded_at.toISOString(),
  }));
}

// Called once per sync cycle (Task 8) rather than on a separate schedule —
// same self-cleaning pattern as akun_lokasi's RETENTION_DAYS cleanup, keeping
// the table bounded without a cron job.
export async function cleanupOldVehiclePositions(): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM armada_gps_riwayat WHERE recorded_at < now() - INTERVAL '${RETENTION_DAYS} days'`);
}
