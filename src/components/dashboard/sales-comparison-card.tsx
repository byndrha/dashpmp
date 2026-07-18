import { TrendingUp, TrendingDown, Minus, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesComparison } from "@/lib/queries/sales-overview";

function TrendBadge({ percent, size = "default" }: { percent: number | null; size?: "default" | "sm" }) {
  if (percent == null) return null;
  const up = percent > 0;
  const down = percent < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded font-medium",
        size === "default" ? "px-1.5 py-0.5 text-xs" : "px-1 py-0.5 text-[11px]",
        up && "bg-primary/15 text-primary",
        down && "bg-destructive/15 text-destructive",
        !up && !down && "bg-secondary text-muted-foreground"
      )}
    >
      {up && <TrendingUp className={size === "default" ? "size-3" : "size-2.5"} />}
      {down && <TrendingDown className={size === "default" ? "size-3" : "size-2.5"} />}
      {!up && !down && <Minus className={size === "default" ? "size-3" : "size-2.5"} />}
      {formatPercentPoints(Math.abs(percent))}
    </span>
  );
}

export function ComparisonCard({ title, comparison }: { title: string; comparison: SalesComparison }) {
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-2 px-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <div className="flex items-center gap-2">
          <p className="font-display text-2xl font-semibold tabular-nums">
            {formatRupiah(comparison.current.NetSales)}
          </p>
          <TrendBadge percent={comparison.NominalPctChange} />
        </div>
        <p className="text-xs text-muted-foreground">
          {comparison.previousLabel} {formatRupiah(comparison.previous.NetSales)}
        </p>

        <div className="mt-1 flex items-center justify-between gap-2 border-t pt-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Truck className="size-3" />
            DO {comparison.current.DOQty.toLocaleString("id-ID")} kantong
          </span>
          <TrendBadge percent={comparison.QtyPctChange} size="sm" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {comparison.previousLabel} {comparison.previous.DOQty.toLocaleString("id-ID")} kantong
        </p>
      </CardContent>
    </Card>
  );
}
