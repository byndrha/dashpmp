import { Fragment } from "react";
import { Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TrendPill } from "@/components/dashboard/sales-chips";
import { formatRupiah } from "@/lib/format";
import type { SalesDayComparison } from "@/lib/queries/sales-overview";

// Shorter than formatRupiah() — needed so a value + trend pill still fit on
// one line inside this panel's narrow columns, same approach as
// sales-comparison-panel.tsx.
const compactRupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Day-level counterpart to the Penjualan module's SalesComparisonPanel (which
// compares whole months) — same "VS Periode" table layout, but rows are
// Kemarin/Pekan Lalu/Bulan Lalu/Tahun Lalu instead of prior months. "Pekan
// Lalu" can be unavailable (previous: null) when H-7 crosses into the
// previous month; that row renders "-" with no trend pill instead of a
// cross-month comparison.
export function SalesDayComparisonPanel({ comparisons }: { comparisons: SalesDayComparison[] }) {
  const current = comparisons[0]?.current;

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="font-display">Perbandingan Penjualan</CardTitle>
        <CardDescription>Penjualan hari ini dibandingkan beberapa periode sebelumnya.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hari Ini</p>
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

        {/* Horizontal-scroll safety net, mirroring sales-comparison-panel.tsx. */}
        <div className="-mx-1 overflow-x-auto border-t px-1 pt-3">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">VS Periode</span>
            <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Nominal
            </span>
            <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Kantong
            </span>
            {comparisons.map((c) => (
              <Fragment key={c.label}>
                <span className="whitespace-nowrap text-xs text-foreground">{c.label}</span>
                {c.previous ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <span className="justify-self-end text-[10px] text-muted-foreground">-</span>
                    <span className="justify-self-end text-[10px] text-muted-foreground">-</span>
                  </>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
