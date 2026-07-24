const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatRupiah(value: number): string {
  return rupiahFormatter.format(value ?? 0);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** For values already expressed 0-100 (not a 0-1 fraction). */
export function formatPercentPoints(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatQty(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "-";
  return `±${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}`;
}

export function formatRupiahAvg(value: number): string {
  return `±${formatRupiah(value)}`;
}

export function formatDays(value: number | null): string {
  if (value === null || value === undefined) return "-";
  return `${value} hari`;
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(value));
}

// "dd/MM" — compact day+month, e.g. for a comparison-period column header
// where a bare day number would be ambiguous across month/year boundaries.
// UTC getters (not local) to match this app's UTC-midnight-as-WIB-calendar-date
// convention (see business-date.ts) — a local-time formatter could shift the
// displayed day by one on a host running behind UTC.
export function formatDayMonth(value: string | Date): string {
  const date = new Date(value);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat("id-ID", { timeStyle: "short" }).format(new Date(value));
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });

export function formatRelativeTime(value: string | Date, now: Date = new Date()): string {
  const date = new Date(value);
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);

  if (Math.abs(diffSeconds) < 60) return "Baru saja";

  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return relativeFormatter.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return relativeFormatter.format(Math.round(diffSeconds / 60), "minute");
}
