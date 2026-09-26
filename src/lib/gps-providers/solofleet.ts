// SoloFleet GPS adapter — logs into the SoloFleet web account (ASP.NET MVC
// forms auth with an antiforgery token) and fetches the live vehicle list.
//
// Login flow (see task-5-brief.md for the field names, captured live from
// https://www.solofleet.com/Account/Login by the design's Discovery phase):
//   1. GET  /Account/Login          -> capture Set-Cookie + parse the hidden
//                                      __RequestVerificationToken value
//   2. POST /Account/Login          -> Email/Password/RememberMe/token, with
//                                      step 1's cookies forwarded; redirect
//                                      is NOT followed so we can read the
//                                      authenticated Set-Cookie headers
//   3. GET  /Vehicle/vehiclelivewithoutzonetripNewModelCondense
//                                   -> with step 2's cookies forwarded

import { AppError } from "@/lib/action-result";
import { resolveGpsKredensial } from "@/lib/queries/gps-kendaraan-kredensial";
import type { NormalizedVehiclePosition, VehicleGpsProvider } from "@/lib/gps-providers/types";
import { normalizeToUtc } from "@/lib/gps-providers/types";

const BASE_URL = "https://www.solofleet.com";
const LOGIN_URL = `${BASE_URL}/Account/Login`;
const VEHICLES_URL = `${BASE_URL}/Vehicle/vehiclelivewithoutzonetripNewModelCondense`;

interface SoloFleetVehicle {
  id: number;
  vehicleid: string;
  alias: string;
  companyid: number;
  lastupdated: string;
  spd: number | null;
  x: number;
  y: number;
  course: number | null;
  IP1?: number;
  deviceid?: string;
  [key: string]: unknown;
}

interface SoloFleetResponse {
  summary: Record<string, unknown>;
  vehicles: SoloFleetVehicle[];
}

// Extracts every Set-Cookie header from a fetch Response as a single
// "Cookie" header value (name=value pairs, semicolon-separated). Node 20+
// exposes headers.getSetCookie(); fall back to raw() / manual iteration if
// that's ever unavailable in this project's runtime.
function extractSetCookies(response: Response): string[] {
  const headersWithGetSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headersWithGetSetCookie.getSetCookie === "function") {
    return headersWithGetSetCookie.getSetCookie();
  }
  const rawHeaders = response.headers as unknown as { raw?: () => Record<string, string[]> };
  if (typeof rawHeaders.raw === "function") {
    return rawHeaders.raw()["set-cookie"] ?? [];
  }
  const cookies: string[] = [];
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") cookies.push(value);
  }
  return cookies;
}

// Turns a list of raw Set-Cookie header values into a "name=value; name2=value2"
// string suitable for a request's Cookie header (drops attributes like Path/HttpOnly/Expires).
function cookiesToHeader(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

// Merges two "name=value; ..." Cookie header strings, letting later entries
// override earlier ones with the same cookie name.
function mergeCookieHeaders(...headers: string[]): string {
  const jar = new Map<string, string>();
  for (const header of headers) {
    if (!header) continue;
    for (const pair of header.split(";")) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const name = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      jar.set(name, value);
    }
  }
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function extractRequestVerificationToken(html: string): string | null {
  const match = html.match(
    /<input[^>]+name=["']__RequestVerificationToken["'][^>]+value=["']([^"']+)["']/i
  );
  return match ? match[1] : null;
}

/**
 * Logs into SoloFleet and returns a Cookie header value carrying the
 * authenticated session. Throws AppError on any failure (missing
 * credentials, missing antiforgery token, or a rejected login).
 */
async function login(): Promise<string> {
  const kredensial = await resolveGpsKredensial("solofleet");
  if (!kredensial) {
    throw new AppError("Kredensial GPS SoloFleet belum dikonfigurasi.");
  }

  // Step 1: GET the login page to obtain the antiforgery cookie + token.
  const getResponse = await fetch(LOGIN_URL, { method: "GET" });
  if (!getResponse.ok) {
    throw new AppError(
      `Gagal membuka halaman login SoloFleet (status ${getResponse.status}).`
    );
  }
  const loginPageHtml = await getResponse.text();
  const getCookies = extractSetCookies(getResponse);
  const token = extractRequestVerificationToken(loginPageHtml);
  if (!token) {
    throw new AppError(
      "Tidak dapat menemukan __RequestVerificationToken pada halaman login SoloFleet — kemungkinan struktur halaman berubah."
    );
  }
  const getCookieHeader = cookiesToHeader(getCookies);

  // Step 2: POST the credentials, with the antiforgery cookie forwarded.
  // redirect: "manual" so we can read the POST's own Set-Cookie headers
  // instead of losing them by following a 302 to the app's landing page.
  const body = new URLSearchParams({
    Email: kredensial.username,
    Password: kredensial.password,
    RememberMe: "false",
    __RequestVerificationToken: token,
  });
  const postResponse = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: getCookieHeader,
    },
    body: body.toString(),
    redirect: "manual",
  });

  const postCookies = extractSetCookies(postResponse);
  const authCookieHeader = mergeCookieHeaders(getCookieHeader, cookiesToHeader(postCookies));

  // A successful SoloFleet login redirects (302) away from /Account/Login
  // and sets a fresh authenticated cookie. A failed login re-renders the
  // login page (200) with no new session cookie, or redirects back to
  // /Account/Login itself. Treat anything else as a login failure —
  // fetchPositions() below double-checks by verifying the vehicles fetch
  // actually returns JSON rather than another login page.
  const isRedirect = postResponse.status >= 300 && postResponse.status < 400;
  const location = postResponse.headers.get("location") ?? "";
  const redirectsBackToLogin = isRedirect && location.includes("/Account/Login");
  if (!isRedirect || redirectsBackToLogin || postCookies.length === 0) {
    throw new AppError(
      `Login SoloFleet gagal (status ${postResponse.status}) — periksa username/password kredensial.`
    );
  }

  return authCookieHeader;
}

async function fetchPositions(): Promise<NormalizedVehiclePosition[]> {
  const cookieHeader = await login();

  const vehiclesResponse = await fetch(VEHICLES_URL, {
    method: "GET",
    headers: { Cookie: cookieHeader },
  });
  if (!vehiclesResponse.ok) {
    throw new AppError(
      `Gagal mengambil data kendaraan SoloFleet (status ${vehiclesResponse.status}).`
    );
  }

  const contentType = vehiclesResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // Most likely the session cookie wasn't accepted and SoloFleet served
    // the login page (HTML) back instead of vehicle JSON.
    throw new AppError(
      "Respons SoloFleet bukan JSON — sesi login kemungkinan tidak valid."
    );
  }

  const payload = (await vehiclesResponse.json()) as SoloFleetResponse;
  const vehicles = payload.vehicles ?? [];

  return vehicles.map((v): NormalizedVehiclePosition => {
    const ignitionOn = v.IP1 === 1 ? true : v.IP1 === 0 ? false : null;
    return {
      provider: "solofleet",
      externalVehicleId: String(v.deviceid ?? v.vehicleid),
      plateRaw: v.alias,
      latitude: v.y,
      longitude: v.x,
      speedKmh: v.spd ?? null,
      heading: v.course ?? null,
      ignitionOn,
      recordedAtUtc: normalizeToUtc(v.lastupdated),
      rawPayload: v,
    };
  });
}

export const solofleetProvider: VehicleGpsProvider = {
  provider: "solofleet",
  fetchPositions,
};
