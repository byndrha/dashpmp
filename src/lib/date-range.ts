import { startOfMonth, addMonths, formatISO } from "date-fns";
import type { DateRangeFilter } from "@/types/dashboard";

export interface DashboardSearchParams {
  from?: string;
  to?: string;
  wilayah?: string;
  cfDate?: string;
}

export function resolveFilter(searchParams: DashboardSearchParams): DateRangeFilter {
  const now = new Date();
  const defaultStart = startOfMonth(now);
  const defaultEnd = addMonths(defaultStart, 1);

  return {
    startDate: searchParams.from ?? formatISO(defaultStart, { representation: "date" }),
    endDate: searchParams.to ?? formatISO(defaultEnd, { representation: "date" }),
    wilayah: searchParams.wilayah || undefined,
  };
}

// Shifts both filter boundaries back `years` calendar years, in UTC — plain
// Date.UTC() arithmetic rather than date-fns' local-time subYears(), for the
// same reason monthBoundary() (business-date.ts) avoids local-time date-fns
// helpers: a Date built from local midnight silently shifts by the host's UTC
// offset once serialized as a SQL `DATE` param. filter.startDate/endDate are
// plain "YYYY-MM-DD" strings, which the Date constructor parses as UTC
// midnight, so getUTC*/Date.UTC() here stays consistent with that.
export function shiftFilterYears(filter: DateRangeFilter, years: number): DateRangeFilter {
  const shift = (iso: string) => {
    const d = new Date(iso);
    return new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  };
  return { ...filter, startDate: shift(filter.startDate), endDate: shift(filter.endDate) };
}
