import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/format";
import type { PiutangStatus } from "@/lib/queries/aging";

const STATUS_STYLE: Record<PiutangStatus, string> = {
  Sehat: "border-primary/30 bg-primary/5 text-primary",
  Perhatian: "border-warning/30 bg-warning/5 text-warning",
  Kritis: "border-destructive/30 bg-destructive/5 text-destructive",
};

export interface StatusBucket {
  status: PiutangStatus;
  count: number;
  total: number;
}

export function PiutangStatusPanel({ buckets }: { buckets: StatusBucket[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {buckets.map((b) => (
        <div key={b.status} className={cn("rounded-lg border p-3", STATUS_STYLE[b.status])}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide">{b.status}</span>
            <span className="text-xs text-muted-foreground">{b.count} mitra</span>
          </div>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums">{formatRupiah(b.total)}</p>
        </div>
      ))}
    </div>
  );
}
