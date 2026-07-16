export interface DateRangeFilter {
  startDate: string; // ISO date, inclusive
  endDate: string; // ISO date, exclusive
  branchId?: number;
}

export type PartnerType = "Agen" | "Retail" | "TakeAway" | "Lainnya";

export interface Branch {
  BranchID: number;
  BranchName: string;
}
