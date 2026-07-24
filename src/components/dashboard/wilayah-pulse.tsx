import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/format";
import type { TodayWilayahPulse } from "@/lib/queries/activity";

export function WilayahPulse({ wilayah }: { wilayah: TodayWilayahPulse[] }) {
  if (wilayah.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada penjualan hari ini.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {wilayah.map((w, i) => (
        <div
          key={w.Wilayah}
          className={cn(
            "rounded-lg border p-3 transition-colors",
            i === 0 ? "border-primary/30 bg-primary/5" : "border-border bg-card/50"
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", i === 0 ? "bg-primary" : "bg-muted-foreground/40")} />
            <p className="truncate text-xs font-medium text-muted-foreground">{w.Wilayah}</p>
          </div>
          <p className="mt-1.5 font-display text-sm font-semibold tabular-nums">{formatRupiah(w.NetSales)}</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {w.Qty.toLocaleString("id-ID")} kantong &middot; {w.DOCount} DO hari ini
          </p>
        </div>
      ))}
    </div>
  );
}
