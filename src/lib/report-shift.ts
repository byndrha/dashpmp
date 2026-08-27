import { getBusinessDateWithRollover } from "@/lib/business-date";

const WIB_TIME_ZONE = "Asia/Jakarta";

export type ReportShiftKind = "sales" | "work";
export type ShiftNumber = 1 | 2 | 3;

// The hour WIB where Shift 1 ends and Shift 2 begins — the only boundary
// that differs between the two kinds (Shift 2↔3 at 23:00 and Shift 3↔1 at
// 07:00 are identical for both). "sales" matches the pre-existing
// ROLLOVER_HOUR (14:00); "work" is the shift-cutoff table's own 15:00.
export const REPORT_SHIFT_ROLLOVER_HOUR: Record<ReportShiftKind, number> = {
  sales: 14,
  work: 15,
};

function getWibHour(now: Date): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: WIB_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  });
  return Number(formatter.format(now)) % 24;
}

// Which shift (1/2/3) a WIB hour-of-day falls into. Shift1: 07:00 up to
// (rolloverHour-1):59. Shift2: rolloverHour:00 up to 22:59. Shift3: 23:00
// up to 06:59 (wraps past midnight).
export function getShiftNumber(wibHour: number, kind: ReportShiftKind): ShiftNumber {
  const shift2Start = REPORT_SHIFT_ROLLOVER_HOUR[kind];
  if (wibHour >= 23 || wibHour < 7) return 3;
  if (wibHour < shift2Start) return 1;
  return 2;
}

// Which shift + business-date label `now` belongs to. businessDate reuses
// getBusinessDateWithRollover with the SAME rollover hour as the shift
// boundary above, so both stay consistent by construction (a shift-2
// instant, hour >= rolloverHour, always lands on businessDate+1 — see the
// spec's worked example).
export function getReportShift(kind: ReportShiftKind, now: Date = new Date()): { shift: ShiftNumber; businessDate: Date } {
  const wibHour = getWibHour(now);
  return {
    shift: getShiftNumber(wibHour, kind),
    businessDate: getBusinessDateWithRollover(REPORT_SHIFT_ROLLOVER_HOUR[kind], now),
  };
}

// Real-time [start, end] window (naive-WIB Dates — see this plan's Global
// Constraints) that a given (businessDate, shift, kind) covers. Shift 2
// and Shift 3 both fall on the calendar day BEFORE businessDate (Shift 2
// starts the cycle, Shift 3 continues it overnight); only Shift 1 falls on
// businessDate itself — see the spec's "urutan kronologis" note. Date.UTC's
// automatic day/month/year normalization (day: -1) handles month/year
// boundaries the same way shiftDateISO already relies on elsewhere.
export function getShiftWindow(businessDate: Date, shift: ShiftNumber, kind: ReportShiftKind): { start: Date; end: Date } {
  const shift2Start = REPORT_SHIFT_ROLLOVER_HOUR[kind];
  const y = businessDate.getUTCFullYear();
  const m = businessDate.getUTCMonth();
  const d = businessDate.getUTCDate();
  if (shift === 1) {
    return {
      start: new Date(Date.UTC(y, m, d, 7, 0, 0)),
      end: new Date(Date.UTC(y, m, d, shift2Start - 1, 59, 59)),
    };
  }
  if (shift === 2) {
    return {
      start: new Date(Date.UTC(y, m, d - 1, shift2Start, 0, 0)),
      end: new Date(Date.UTC(y, m, d - 1, 22, 59, 59)),
    };
  }
  return {
    start: new Date(Date.UTC(y, m, d - 1, 23, 0, 0)),
    end: new Date(Date.UTC(y, m, d, 6, 59, 59)),
  };
}

const SHIFT_START_HOUR_LABEL: Record<ReportShiftKind, Record<ShiftNumber, number>> = {
  work: { 1: 7, 2: 15, 3: 23 },
  sales: { 1: 7, 2: 14, 3: 23 },
};

// Display label, e.g. "Shift 2 (15:00)" — matches SHIFT_LABEL's existing
// "Shift 2 (15:00)" style in produksi-shift.ts, parameterized by kind.
export function getShiftLabel(shift: ShiftNumber, kind: ReportShiftKind): string {
  const hour = SHIFT_START_HOUR_LABEL[kind][shift];
  return `Shift ${shift} (${String(hour).padStart(2, "0")}:00)`;
}
