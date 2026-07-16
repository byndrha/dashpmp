import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/format";
import type { TodayBranchPulse } from "@/lib/queries/activity";

export function BranchPulse({ branches }: { branches: TodayBranchPulse[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {branches.map((b) => {
        const active = b.NetSales > 0;
        return (
          <div
            key={b.BranchID}
            className={cn(
              "rounded-lg border p-3 transition-colors",
              active ? "border-primary/30 bg-primary/5" : "border-border bg-card/50"
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", active ? "bg-primary" : "bg-muted-foreground/40")} />
              <p className="truncate text-xs font-medium text-muted-foreground">{b.BranchName}</p>
            </div>
            <p className="mt-1.5 font-display text-sm font-semibold tabular-nums">
              {active ? formatRupiah(b.NetSales) : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground">{b.InvoiceCount} invoice hari ini</p>
          </div>
        );
      })}
    </div>
  );
}
