const WIB_TIME_ZONE = "Asia/Jakarta";
export const ROLLOVER_HOUR = 14; // 14:00 WIB — after this, "today's" transactions mean tomorrow's date.

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
 * Same WIB-rollover concept as getBusinessDate below, but with an explicit
 * rollover hour instead of the app-wide ROLLOVER_HOUR (14:00) — some panels
 * (e.g. Kinerja Marketing, 13:00) have their own, different cutoff. Kept as
 * the shared implementation so every rollover-hour variant stays consistent
 * WIB-timezone math, not hand-rolled per call site.
 */
export function getBusinessDateWithRollover(rolloverHour: number, now: Date = new Date()): Date {
  const wib = getWibParts(now);
  const businessDay = wib.hour >= rolloverHour ? wib.day + 1 : wib.day;
  // Construct as a UTC midnight Date for the WIB calendar date, since SQL Server
  // DATE parameters only care about the calendar date, not a specific instant.
  return new Date(Date.UTC(wib.year, wib.month - 1, businessDay));
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
  return getBusinessDateWithRollover(ROLLOVER_HOUR, now);
}

export function getBusinessDateISO(now: Date = new Date()): string {
  return getBusinessDate(now).toISOString().slice(0, 10);
}

// Current wall-clock time in WIB as "HH:mm", regardless of the caller's own
// timezone (client device or server process) — same Intl-based approach as
// getWibParts, just also reading minute. Used to default a time <input>'s
// value, not for any business-date-rollover math (unlike everything else in
// this file, a time input doesn't care which calendar day it is).
export function getWibTimeHHmm(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: WIB_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(now);
}

// The value every SO/DO/SI/SR this dashboard creates should store as
// TransDate — the WIB business-date (14:00 rollover, see getBusinessDate:
// a transaction entered at 22:00 WIB is dated the NEXT calendar day) paired
// with the real WIB wall-clock time-of-day (full precision, not rolled).
// Explicit request (2026-08-27): before this, every such write used
// GETDATE() directly, which is this server's own true-UTC clock — for the
// 7 hours/day between 17:00-23:59 UTC (00:00-06:59 WIB) that stored a
// calendar date ONE DAY EARLIER than the WIB business-date convention every
// desktop-ERP-authored TransDate already follows, live-confirmed against
// ~12,000 existing dashboard-authored rows carrying that same mismatch.
// This fixes new writes only — the ~12,000 already-affected historical
// rows are deliberately left as-is (explicit decision, not an oversight:
// some may already be reconciled in accounting reports run against the
// old, wrong dates).
//
// Built via Date.UTC(...) component construction, never string-parsed —
// same reasoning as monthBoundary's own comment: a Date built any other way
// risks the host process's own OS timezone silently shifting what actually
// reaches SQL Server as a DATETIME parameter.
export function getNaiveWibTransDate(now: Date = new Date()): Date {
  const businessDate = getBusinessDate(now);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: WIB_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  return new Date(
    Date.UTC(
      businessDate.getUTCFullYear(),
      businessDate.getUTCMonth(),
      businessDate.getUTCDate(),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    )
  );
}

// Plain "right now" as a naive-WIB Date (raw UTC-component values ARE
// the WIB wall-clock value) — unlike getNaiveWibTransDate, this has NO
// business-date rollover logic at all (no ROLLOVER_HOUR involved): it's
// for a pure event timestamp (e.g. a machine on/off toggle) where "which
// business day does this belong to" isn't a meaningful question, only
// "what did the clock say." Built via Date.UTC(...), same reasoning as
// every other naive-WIB constructor in this file.
export function getNaiveWibNow(now: Date = new Date()): Date {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: WIB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    )
  );
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // WIB has no DST — a fixed UTC+7.

// Converts a "naive WIB" Date (raw UTC-component values ARE the WIB
// wall-clock value — see combineDateAndTime's comment on this whole
// convention split) into the true-UTC instant it actually represents.
// Needed wherever a naive-WIB value (SalesOrder/DeliveryOrder/SalesInvoice/
// SalesReturn.TransDate) is compared against a true-UTC value
// (DashboardPengirimanJadwal.JamJadwal) — confirmed live 2026-08-27 these
// two column families use DIFFERENT conventions, so comparing their raw
// Date values directly is off by 7 hours (see assertJamJadwalNotBeforeOrders
// in pengiriman-jadwal.ts).
export function naiveWibToUtcInstant(naiveWib: Date): Date {
  return new Date(naiveWib.getTime() - WIB_OFFSET_MS);
}

// Inverse of naiveWibToUtcInstant: shifts a true-UTC instant so its raw
// UTC-component values equal the WIB wall-clock time — lets a true-UTC
// value (e.g. JamJadwal) be displayed via formatDate/formatTime, which
// (like every other "naive WIB" display in this app) read a Date's raw UTC
// components directly rather than doing real timezone conversion.
export function utcInstantToWibDisplay(trueUtc: Date): Date {
  return new Date(trueUtc.getTime() + WIB_OFFSET_MS);
}

// Calendar-safe (UTC math, no local-timezone drift) day shift on a plain
// "YYYY-MM-DD" string.
export function shiftDateISO(dateISO: string, deltaDays: number): string {
  const d = new Date(dateISO);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + deltaDays))
    .toISOString()
    .slice(0, 10);
}

// Combines a "YYYY-MM-DD" date string and an "HH:mm" (or "HH:mm:ss") time
// string into a Date whose raw UTC-component values directly equal the
// typed values — i.e. NOT what `new Date(\`${date}T${time}:00\`)` does.
// That string form has no timezone suffix, so JS parses it as LOCAL time of
// whatever environment runs the code: in a browser set to WIB (true for
// virtually every real user of this dashboard), typing "27/08/2026 02:00"
// silently becomes an internal instant of "2026-08-26T19:00:00Z" — 7 hours
// earlier than what was typed. Use this ONLY for values that follow the
// "naive WIB" convention — confirmed live 2026-08-27 to be exactly
// SalesOrder/DeliveryOrder/SalesInvoice/SalesReturn.TransDate (via
// getNaiveWibTransDate) and nothing else: DashboardPengirimanJadwal.JamJadwal
// was confirmed the SAME day to be a genuinely correct true-UTC instant
// instead (its stored values sit within minutes/~1h of CreatedDate's own
// true-UTC clock, not offset by WIB's +7h) — for JamJadwal, the OLD
// `new Date(\`${date}T${time}:00\`)` browser-local-timezone parse is what's
// actually correct (see resolveBusinessDateTime below, which intentionally
// does NOT use this helper).
export function combineDateAndTime(dateISO: string, timeHHMM: string): Date {
  const [year, month, day] = dateISO.split("-").map(Number);
  const [hour, minute] = timeHHMM.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
}

// Resolves a business date (the 14:00 WIB rollover label — see getBusinessDate)
// plus a literal HH:MM wall-clock time into the actual calendar-date Date it
// falls on. Business date "28 Juli" spans 27 Juli 14:00 through 28 Juli
// 13:59, so a hour >= ROLLOVER_HOUR under that label means the day BEFORE
// it, not the label's own date. Used by the Papan Pengiriman timeline
// (pengiriman-board.tsx / route-validation-dialog.tsx) to build JamJadwal —
// a true-UTC value (see combineDateAndTime's comment) — so this
// deliberately parses via the browser's own local (WIB) timezone rather
// than combineDateAndTime's naive-WIB passthrough.
export function resolveBusinessDateTime(businessDate: string, timeHHMM: string): Date {
  const hour = Number(timeHHMM.slice(0, 2));
  const calendarDate = hour >= ROLLOVER_HOUR ? shiftDateISO(businessDate, -1) : businessDate;
  return new Date(`${calendarDate}T${timeHHMM}:00`);
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
