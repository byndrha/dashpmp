// Hino Connect GPS adapter — logs into the Hino Connect account via AWS
// Cognito (SRP, handled internally by amazon-cognito-identity-js) and fetches
// the live vehicle cluster map.
//
// Login flow (see task-6-brief.md, identifiers confirmed live by the
// design's Discovery phase):
//   1. CognitoUser.authenticateUser(AuthenticationDetails) against the fixed
//      Hino Connect user pool / app client (SRP is handled internally by the
//      library — we never touch the password's cryptography ourselves).
//   2. On success, extract the access token from the returned session.
//   3. POST /mapproxy/map/clusters with `Authorization: Bearer <token>` and a
//      fixed Indonesia-wide bounding box; flatten every returned cluster's
//      devices[] into one array.

import { CognitoUser, CognitoUserPool, AuthenticationDetails } from "amazon-cognito-identity-js";

import { AppError } from "@/lib/action-result";
import { resolveGpsKredensial } from "@/lib/queries/gps-kendaraan-kredensial";
import type { NormalizedVehiclePosition, VehicleGpsProvider } from "@/lib/gps-providers/types";
import { normalizeToUtc } from "@/lib/gps-providers/types";

// Identifies the Hino Connect application itself (not per-customer values) —
// confirmed live via Discovery.
const USER_POOL_ID = "ap-southeast-1_D0GwdGbuB";
const CLIENT_ID = "keguk4gegt09c9kmfa5rvb1b8";

const CLUSTERS_URL = "https://be-pub-sg-hino.gazellecomputing.com/mapproxy/map/clusters";

// Fixed Indonesia-wide bounding box from the spec.
const CLUSTERS_REQUEST_BODY = {
  topLeftCorner: { lon: 103.0977934375, lat: -1.9072132966240953 },
  bottomRightCorner: { lon: 114.89710984375, lat: -11.798864459079624 },
  fleets: [] as string[],
  // Raised from Discovery's captured 25 so a growing fleet doesn't silently
  // get truncated.
  deviceListMaxLen: 500,
  zoomLevel: 7,
  hideExpired: true,
};

interface HinoVehicleLastInfo {
  vehicleState: string;
  lastTransmissionTimestamp: string;
  deviceId: string;
  vehicleId: string;
  latitude_deg: number;
  longitude_deg: number;
  altitude_m: number;
  heading_deg: number;
  speed_kmh: number;
  engineHours_s: number;
  distance_m: number;
}

interface HinoDevice {
  vehicleId: string;
  deviceId: string;
  name: string;
  plate: string;
  vin: string;
  type: string;
  unreadAlarms: boolean;
  vehicleLastInfo: HinoVehicleLastInfo;
  position: { lat: number; lon: number; geohash: string; fragment: boolean };
  [key: string]: unknown;
}

interface HinoCluster {
  geoHash: string;
  size: number;
  devices: HinoDevice[];
  clusterCenter: { lat: number; lon: number; geohash: string; fragment: boolean };
}

interface HinoClustersResponse {
  status: boolean;
  statusCode: number;
  message: string;
  error: string;
  data: HinoCluster[];
  status_code: number;
}

/**
 * Logs into Hino Connect via AWS Cognito (SRP handled internally by
 * amazon-cognito-identity-js) and returns the access token from the
 * resulting session. Throws AppError on any failure (missing credentials or
 * a rejected login), never logging the password.
 */
async function login(perusahaanId: number): Promise<string> {
  const kredensial = await resolveGpsKredensial(perusahaanId, "hino");
  if (!kredensial) {
    throw new AppError("Kredensial GPS Hino Connect belum dikonfigurasi.");
  }

  const userPool = new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID });
  const cognitoUser = new CognitoUser({ Username: kredensial.username, Pool: userPool });
  const authenticationDetails = new AuthenticationDetails({
    Username: kredensial.username,
    Password: kredensial.password,
  });

  const accessToken = await new Promise<string>((resolve, reject) => {
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (session) => {
        resolve(session.getAccessToken().getJwtToken());
      },
      onFailure: (err) => {
        reject(
          new AppError(
            `Login Hino Connect gagal (${err?.name ?? "unknown error"}) — periksa username/password kredensial.`
          )
        );
      },
      // Cognito can demand extra steps (new-password-required, MFA, etc.)
      // for accounts configured that way. Treat any of these as a login
      // failure for now rather than silently hanging — none are expected
      // for this service account, but this keeps the promise from ever
      // going unresolved.
      newPasswordRequired: () => {
        reject(
          new AppError(
            "Login Hino Connect meminta penggantian password baru — tidak didukung oleh integrasi ini."
          )
        );
      },
      mfaRequired: () => {
        reject(new AppError("Login Hino Connect meminta MFA — tidak didukung oleh integrasi ini."));
      },
    });
  });

  return accessToken;
}

async function fetchPositions(perusahaanId: number): Promise<NormalizedVehiclePosition[]> {
  const accessToken = await login(perusahaanId);

  const response = await fetch(CLUSTERS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(CLUSTERS_REQUEST_BODY),
  });
  if (!response.ok) {
    throw new AppError(`Gagal mengambil data kendaraan Hino Connect (status ${response.status}).`);
  }

  const payload = (await response.json()) as HinoClustersResponse;
  if (!payload.status) {
    throw new AppError(`Respons Hino Connect menandakan gagal: ${payload.message || payload.error}`);
  }

  const clusters = payload.data ?? [];
  const devices = clusters.flatMap((cluster) => cluster.devices ?? []);

  const positions: NormalizedVehiclePosition[] = [];
  for (const d of devices) {
    try {
      // Discovery: some devices report VIN as a placeholder plate — skip these entirely.
      // Inside the try so a malformed top-level device record (null/undefined,
      // or missing `plate`/`vin` themselves) is caught below instead of
      // throwing straight out of fetchPositions().
      if (d.plate === d.vin) continue;
      positions.push({
        provider: "hino",
        externalVehicleId: d.vehicleId,
        plateRaw: d.plate,
        latitude: d.vehicleLastInfo.latitude_deg,
        longitude: d.vehicleLastInfo.longitude_deg,
        speedKmh: d.vehicleLastInfo.speed_kmh,
        heading: d.vehicleLastInfo.heading_deg,
        // Hino's payload has no reliable ignition boolean — only the coarser
        // vehicleState (MOVING/IDLE/OFF) — so leave null rather than guessing.
        ignitionOn: null,
        recordedAtUtc: normalizeToUtc(d.vehicleLastInfo.lastTransmissionTimestamp),
        rawPayload: d,
      });
    } catch (err) {
      // One malformed device (missing vehicleLastInfo, bad timestamp, etc.)
      // shouldn't zero out the whole provider's sync cycle — skip it and
      // keep processing the rest.
      console.warn(
        `[hino-connect] Melewati device (vehicleId=${d?.vehicleId ?? "unknown"}) karena gagal dipetakan:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return positions;
}

export const hinoConnectProvider: VehicleGpsProvider = {
  provider: "hino",
  fetchPositions,
};
