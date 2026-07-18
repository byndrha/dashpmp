import { Fragment } from "react";
import { Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendPill } from "@/components/dashboard/sales-chips";
import { SalesAveragesSection } from "@/components/dashboard/sales-averages-section";
import { formatRupiah } from "@/lib/format";
import type { SalesAverages, SalesComparison } from "@/lib/queries/sales-overview";

// Shorter than formatRupiah() — needed so a value + trend pill still fit on
// one line inside this panel's narrow columns at the 3-up desktop layout.
const compactRupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Merges what used to be three separate cards ("Bulan Ini vs Bulan Lalu" plus
// two YoY cards) into one compact panel — "Bulan Ini" shown once up top
// (nominal left, DO qty as a pill on the right, mirroring the "Penjualan
// Hari Ini" panel's kantong-terkirim pill), then each comparison as a single
// line: value and its trend pill share one row instead of stacking, so the
// panel stays short instead of growing tall.
export function SalesComparisonPanel({
  comparisons,
  averages,
}: {
  comparisons: SalesComparison[];
  averages: SalesAverages;
}) {
  const current = comparisons[0]?.current;

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bulan Ini</p>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p className="font-display text-xl font-semibold tabular-nums">{formatRupiah(current?.NetSales ?? 0)}</p>
            <div className="flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2 py-1">
              <Truck className="size-3.5 text-primary" />
              <div className="flex flex-col leading-tight">
                <span className="font-display text-xs font-semibold tabular-nums text-primary">
                  {(current?.DOQty ?? 0).toLocaleString("id-ID")}
                </span>
                <span className="text-[9px] whitespace-nowrap text-muted-foreground">kantong terkirim</span>
              </div>
            </div>
          </div>
        </div>

        {/* Horizontal-scroll safety net: the two "auto" value columns don't
            wrap, so at very narrow container widths (e.g. the tablet 2-up
            layout) this scrolls instead of spilling past the card edge. */}
        <div className="-mx-1 overflow-x-auto border-t px-1 pt-3">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">VS Periode</span>
            <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Nominal
            </span>
            <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              DO Qty
            </span>
            {comparisons.map((c) => (
              <Fragment key={c.previousLabel}>
                <span className="whitespace-nowrap text-xs text-foreground">{c.previousLabel}</span>
                <div className="flex items-center justify-end gap-1">
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                    {compactRupiahFormatter.format(c.previous.NetSales)}
                  </span>
                  <TrendPill percent={c.NominalPctChange} />
                </div>
                <div className="flex items-center justify-end gap-1">
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                    {c.previous.DOQty.toLocaleString("id-ID")}
                  </span>
                  <TrendPill percent={c.QtyPctChange} />
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        <SalesAveragesSection averages={averages} />
      </CardContent>
    </Card>
  );
}
