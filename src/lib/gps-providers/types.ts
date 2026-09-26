// Provider-agnostic types and normalization utilities for the GPS Kendaraan feature.
// Adapters for individual providers (Hino Connect, SoloFleet — Tasks 5 and 6) import
// from this file. Keep this file limited to shared types + pure normalization helpers.

export interface NormalizedVehiclePosition {
  provider: "hino" | "solofleet";
  externalVehicleId: string;
  plateRaw: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  ignitionOn: boolean | null;
  recordedAtUtc: Date; // ALWAYS UTC — see normalizeToUtc below
  rawPayload: unknown;
}

export interface VehicleGpsProvider {
  readonly provider: "hino" | "solofleet";
  fetchPositions(): Promise<NormalizedVehiclePosition[]>;
}

/**
 * Normalizes a license plate string for comparison/lookup purposes: uppercases
 * it, then strips everything that isn't A-Z or 0-9 (spaces, dashes, dots, etc.
 * all removed in one pass).
 *
 * normalizePlate("AE 8072 SQ") -> "AE8072SQ"
 */
export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Normalizes a timestamp string from either GPS provider into a UTC Date.
 *
 * Hino Connect reports UTC with a trailing "Z" (e.g. "2026-09-26T06:43:06Z").
 * SoloFleet reports local WIB time with an explicit "+07:00" offset (e.g.
 * "2026-09-26T13:46:45+07:00"). JavaScript's native `Date` parser already
 * correctly interprets both forms as the same real-world instant, storing an
 * internal UTC timestamp regardless of which offset was present in the
 * string. This function exists as a single named seam so that fact is
 * documented and verified once, rather than re-reasoned-about at every call
 * site (see task-4-brief.md Step 3 for the verification).
 */
export function normalizeToUtc(isoOrOffsetString: string): Date {
  return new Date(isoOrOffsetString);
}
