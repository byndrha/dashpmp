"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { TrendPill } from "@/components/dashboard/sales-chips";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesAverages } from "@/lib/queries/sales-overview";

function AverageRow({
  label,
  thisMonthValue,
  lastMonthValue,
  percent,
}: {
  label: string;
  thisMonthValue: string;
  lastMonthValue: string;
  percent: number | null;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2 gap-y-1">
      <span className="whitespace-nowrap text-[11px] font-medium tabular-nums text-foreground">{thisMonthValue}</span>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <TrendPill percent={percent} />
      <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">{lastMonthValue}</span>
    </div>
  );
}

// Collapsed by default so this detail doesn't add to the panel's height
// until asked for — toggled open with the chevron button below.
export function SalesAveragesSection({ averages }: { averages: SalesAverages }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Rata-rata Bulan Ini vs Bulan Lalu
        </p>
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="-mx-1 mt-2 overflow-x-auto px-1">
          <div className="flex min-w-max flex-col gap-1.5">
            <AverageRow
              label="Kantong Terkirim / Hari"
              thisMonthValue={Math.round(averages.AvgKantongPerHariThisMonth).toLocaleString("id-ID")}
              lastMonthValue={Math.round(averages.AvgKantongPerHariLastMonth).toLocaleString("id-ID")}
              percent={averages.AvgKantongPerHariPctChange}
            />
            <AverageRow
              label="Harga Jual 10KG"
              thisMonthValue={formatRupiah(averages.AvgHarga10KGThisMonth)}
              lastMonthValue={formatRupiah(averages.AvgHarga10KGLastMonth)}
              percent={averages.AvgHarga10KGPctChange}
            />
            <AverageRow
              label="Harga Jual 5KG"
              thisMonthValue={formatRupiah(averages.AvgHarga5KGThisMonth)}
              lastMonthValue={formatRupiah(averages.AvgHarga5KGLastMonth)}
              percent={averages.AvgHarga5KGPctChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
