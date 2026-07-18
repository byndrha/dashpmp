import { Fragment } from "react";
import { TrendingUp, TrendingDown, Minus, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRupiah, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesComparison } from "@/lib/queries/sales-overview";

function TrendPill({ percent, tooltip }: { percent: number | null; tooltip: string }) {
  if (percent == null) return <span className="justify-self-end text-[11px] text-muted-foreground">-</span>;
  const up = percent > 0;
  const down = percent < 0;
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          "inline-flex items-center gap-0.5 justify-self-end rounded px-1.5 py-0.5 text-[11px] font-medium",
          up && "bg-primary/15 text-primary",
          down && "bg-destructive/15 text-destructive",
          !up && !down && "bg-secondary text-muted-foreground"
        )}
      >
        {up && <TrendingUp className="size-2.5" />}
        {down && <TrendingDown className="size-2.5" />}
        {!up && !down && <Minus className="size-2.5" />}
        {formatPercentPoints(Math.abs(percent))}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// Merges what used to be three separate cards ("Bulan Ini vs Bulan Lalu" plus
// two YoY cards) into one compact panel — "Bulan Ini" shown once up top,
// then each comparison as a single row so all three fit without wasted
// width. Exact prior-period figures are on the trend pill's hover tooltip.
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

        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1.5 border-t pt-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Periode</span>
          <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Nominal
          </span>
          <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            DO Qty
          </span>
          {comparisons.map((c) => (
            <Fragment key={c.previousLabel}>
              <span className="truncate text-xs text-foreground">vs {c.previousLabel}</span>
              <TrendPill percent={c.NominalPctChange} tooltip={formatRupiah(c.previous.NetSales)} />
              <TrendPill percent={c.QtyPctChange} tooltip={`${c.previous.DOQty.toLocaleString("id-ID")} kantong`} />
            </Fragment>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
