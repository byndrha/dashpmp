import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatRupiah, formatPercentPoints, formatDays } from "@/lib/format";
import type { PiutangStatusOverview } from "@/lib/queries/aging";
import type { PiutangStatus } from "@/lib/queries/aging";

const STATUS_STYLE: Record<PiutangStatus, string> = {
  Sehat: "border-primary/30 bg-primary/5 text-primary",
  Perhatian: "border-warning/30 bg-warning/5 text-warning",
  Kritis: "border-destructive/30 bg-destructive/5 text-destructive",
};

// Beranda's "Detail Piutang" panel — left: total mitra with an outstanding
// balance and its nominal; right: the same total broken down per
// Kritis/Perhatian/Sehat status (count, nominal, share of the total, and
// average aging), all sourced from getPiutangStatusOverview()'s per-mitra
// rollup so the numbers stay consistent with /aging's status counts.
export function PiutangOverviewPanel({ overview }: { overview: PiutangStatusOverview }) {
  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="font-display">Detail Piutang</CardTitle>
        <CardDescription>Mitra dengan piutang berjalan, dikelompokkan berdasarkan status umur piutang.</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)]">
          <div className="flex flex-col justify-center gap-1.5 rounded-lg border bg-secondary/40 p-4">
            <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Users className="size-3.5" /> Total Mitra Piutang
            </span>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {overview.totalMitra.toLocaleString("id-ID")}
            </p>
            <p className="font-display text-sm font-semibold tabular-nums text-primary">
              {formatRupiah(overview.totalOutstanding)}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {overview.buckets.map((b) => (
              <div key={b.status} className={cn("flex flex-col gap-1 rounded-lg border p-3", STATUS_STYLE[b.status])}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide">{b.status}</span>
                  <span className="text-xs text-muted-foreground">{b.mitraCount} mitra</span>
                </div>
                <p className="font-display text-lg font-semibold tabular-nums">{formatRupiah(b.outstanding)}</p>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{formatPercentPoints(b.ratioPct)} dari total</span>
                  <span>Aging {formatDays(Math.round(b.avgAgingDays))}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
