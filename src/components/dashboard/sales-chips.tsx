import { Package, TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DocChip({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
      <Icon className="size-3" />
      {label} {value.toLocaleString("id-ID")}
    </span>
  );
}

export function QtyChip({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
      <Package className="size-3" />
      {value.toLocaleString("id-ID")} kantong {label}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

export function TrendPill({ percent }: { percent: number | null }) {
  if (percent == null) return <span className="text-[10px] text-muted-foreground">-</span>;
  const up = percent > 0;
  const down = percent < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1 py-0.5 text-[10px] font-medium",
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
