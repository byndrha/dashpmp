const WIB_TIME_ZONE = "Asia/Jakarta";
const ROLLOVER_HOUR = 14; // 14:00 WIB — after this, "today's" transactions mean tomorrow's date.

/**
 * Returns the parts of the current instant as seen in WIB (Asia/Jakarta),
 * regardless of the server process's own timezone (Coolify containers
 * commonly run UTC).
 */
function getWibParts(now: Date): { year: number; month: number; day: number; hour: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: WIB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl reports midnight as "24" with hour12:false in some engines; normalize.
    hour: Number(parts.hour) % 24,
  };
}

/**
 * The "business date" for transaction data: after 14:00 WIB, staff consider
 * new orders/deliveries to belong to the next day, so anything labeled
 * "hari ini" (today) in the dashboard should mean tomorrow's calendar date
 * from that point on. This is independent of the viewer's device timezone —
 * it always follows WIB, since that's the timezone the underlying
 * transaction data is entered in.
 */
export function getBusinessDate(now: Date = new Date()): Date {
  const wib = getWibParts(now);
  const businessDay = wib.hour >= ROLLOVER_HOUR ? wib.day + 1 : wib.day;
  // Construct as a UTC midnight Date for the WIB calendar date, since SQL Server
  // DATE parameters only care about the calendar date, not a specific instant.
  return new Date(Date.UTC(wib.year, wib.month - 1, businessDay));
}

export function getBusinessDateISO(now: Date = new Date()): string {
  return getBusinessDate(now).toISOString().slice(0, 10);
}

/**
 * UTC-midnight boundary for the 1st of the month `monthsOffset` months from
 * the WIB business month containing `wibDate` (itself expected to already be
 * a UTC-midnight Date representing a WIB calendar date, e.g. from
 * getBusinessDate()).
 *
 * Deliberately built with plain Date.UTC() arithmetic instead of date-fns'
 * startOfMonth/subMonths: those construct *local* midnight, and when that
 * Date is later sent to SQL Server as a `DATE` parameter (which mssql
 * serializes via UTC components), a host process running in a
 * positive-UTC-offset timezone silently shifts the boundary back one
 * calendar day — verified against live data, a "this month" query leaked in
 * the entirety of the previous day's revenue this way.
 */
export function monthBoundary(wibDate: Date, monthsOffset = 0): Date {
  return new Date(Date.UTC(wibDate.getUTCFullYear(), wibDate.getUTCMonth() + monthsOffset, 1));
}
