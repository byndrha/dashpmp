import { Fragment } from "react";
import { TrendingUp, TrendingDown, Minus, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesComparison } from "@/lib/queries/sales-overview";

function TrendPill({ percent }: { percent: number | null }) {
  if (percent == null) return <span className="justify-self-end text-[10px] text-muted-foreground">-</span>;
  const up = percent > 0;
  const down = percent < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 justify-self-end whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium",
        up && "bg-primary/15 text-primary",
        down && "bg-destructive/15 text-destructive",
        !up && !down && "bg-secondary text-muted-foreground"
      )}
    >
      {up && <TrendingUp className="size-2.5" />}
      {down && <TrendingDown className="size-2.5" />}
      {!up && !down && <Minus className="size-2.5" />}
      {formatPercentPoints(Math.abs(percent))}
    </span>
  );
}

// Merges what used to be three separate cards ("Bulan Ini vs Bulan Lalu" plus
// two YoY cards) into one compact panel — "Bulan Ini" shown once up top,
// then each comparison as a row. Nominal/qty figures for the prior period
// are shown directly (not tucked behind a hover tooltip) under each trend
// pill, so the whole comparison reads at a glance.
export function SalesComparisonPanel({ comparisons }: { comparisons: SalesComparison[] }) {
  const current = comparisons[0]?.current;

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bulan Ini</p>
          <p className="font-display text-2xl font-semibold tabular-nums">{formatRupiah(current?.NetSales ?? 0)}</p>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Truck className="size-3" />
            DO {(current?.DOQty ?? 0).toLocaleString("id-ID")} kantong
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_auto] items-start gap-x-3 gap-y-2 border-t pt-3">
          <span className="self-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Periode
          </span>
          <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Nominal
          </span>
          <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            DO Qty
          </span>
          {comparisons.map((c) => (
            <Fragment key={c.previousLabel}>
              <span className="self-center truncate text-xs text-foreground">vs {c.previousLabel}</span>
              <div className="flex flex-col items-end gap-0.5">
                <TrendPill percent={c.NominalPctChange} />
                <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                  {formatRupiah(c.previous.NetSales)}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <TrendPill percent={c.QtyPctChange} />
                <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                  {c.previous.DOQty.toLocaleString("id-ID")} kantong
                </span>
              </div>
            </Fragment>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
