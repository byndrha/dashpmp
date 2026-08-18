export interface DateRangeFilter {
  startDate: string; // ISO date, inclusive
  endDate: string; // ISO date, exclusive
  wilayah?: string;
}

export type PartnerType = "Agen" | "Outlet" | "RPA" | "TakeAway" | "Lainnya";
