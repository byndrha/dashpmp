import { estimateDeliveryMinutes, CONFIRMATION_MINUTES_PER_STOP } from "@/lib/delivery-duration";

export interface LatLng {
  lat: number;
  lng: number;
}

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Average speed assumption for a PRE-route (Draft) travel-time estimate —
// before a real route has been validated via OSRM (only computed once
// Terbit, at startBerangkat). Deliberately conservative for local town
// delivery (traffic, turns, stop-and-go), not open-road cruising speed.
// Only meant to be good enough to size a Draft's timeline card and catch
// armada double-booking before departure, never shown to the user as a
// precise number.
const ESTIMATED_AVG_SPEED_KMH = 30;

// Straight-line pabrik -> stop1 -> stop2 -> ... -> stopN -> pabrik round
// trip, divided by an assumed average speed — the same round-trip shape
// startBerangkat's real OSRM call computes, just a cheap heuristic usable
// before any stop has been route-validated (no network call, no failure
// mode from a stop temporarily lacking a route).
export function estimateTravelMinutes(pabrik: LatLng, orderedStops: LatLng[]): number {
  if (orderedStops.length === 0) return 0;
  let km = 0;
  let prev = pabrik;
  for (const stop of orderedStops) {
    km += haversineKm(prev, stop);
    prev = stop;
  }
  km += haversineKm(prev, pabrik);
  return (km / ESTIMATED_AVG_SPEED_KMH) * 60;
}

// Full estimated busy duration for a trip — on-site bongkar time at every
// stop (estimateDeliveryMinutes) plus a fixed CONFIRMATION_MINUTES_PER_STOP
// per stop for driver-app confirmation data entry, plus the travel estimate
// above. `qty` null skips that stop's bongkar contribution (treated as 0),
// matching estimateDeliveryMinutes(0) — confirmation time still applies.
export function estimateTripMinutes(pabrik: LatLng, orderedStops: (LatLng & { qty: number })[]): number {
  const bongkarMinutes = orderedStops.reduce(
    (sum, s) => sum + estimateDeliveryMinutes(s.qty) + CONFIRMATION_MINUTES_PER_STOP,
    0
  );
  const travelMinutes = estimateTravelMinutes(
    pabrik,
    orderedStops.map((s) => ({ lat: s.lat, lng: s.lng }))
  );
  return bongkarMinutes + travelMinutes;
}
