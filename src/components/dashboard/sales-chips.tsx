import { Package, type LucideIcon } from "lucide-react";

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
