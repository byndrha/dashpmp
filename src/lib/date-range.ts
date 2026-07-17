import { startOfMonth, addMonths, formatISO } from "date-fns";
import type { DateRangeFilter } from "@/types/dashboard";

export interface DashboardSearchParams {
  from?: string;
  to?: string;
  wilayah?: string;
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
