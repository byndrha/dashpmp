"use client";

import { Fragment, useState } from "react";
import { Truck, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TrendPill } from "@/components/dashboard/sales-chips";
import { formatRupiah, formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesDayComparison, HourlyPoint } from "@/lib/queries/sales-overview";

// Shorter than formatRupiah() — needed so a value + trend pill still fit on
// one line inside this panel's narrow columns, same approach as
// sales-comparison-panel.tsx.
const compactRupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  maximumFractionDigits: 1,
});

function pctChange(current: number, previous: number): number | null {
  return previous ? ((current - previous) / previous) * 100 : null;
}

// Expanded per-period detail: that date's own 24 WIB hours, hour-by-hour
// against today's same hour so far — hours after `currentWibHour` haven't
// happened yet today, shown as "-" rather than a misleading 0.
function HourlyComparisonTable({
  periodHourly,
  todayHourly,
  currentWibHour,
}: {
  periodHourly: HourlyPoint[];
  todayHourly: HourlyPoint[];
  currentWibHour: number;
}) {
  return (
    <div className="col-span-3 -mx-1 mt-1 mb-2 max-h-64 overflow-y-auto rounded-md border bg-secondary/20 px-2 py-2">
      <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2 gap-y-1">
        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Jam</span>
        <span className="justify-self-end text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          Periode Ini
        </span>
        <span />
        <span className="justify-self-end text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          Hari Ini
        </span>
        {periodHourly.map((h) => {
          const todayPoint = todayHourly[h.hour];
          const isPast = h.hour <= currentWibHour;
          const pct = isPast && todayPoint ? pctChange(todayPoint.NetSales, h.NetSales) : null;
          return (
            <Fragment key={h.hour}>
              <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                {String(h.hour).padStart(2, "0")}:00
              </span>
              <span className="justify-self-end whitespace-nowrap text-[10px] tabular-nums">
                {compactRupiahFormatter.format(h.NetSales)}{" "}
                <span className="text-muted-foreground">&middot; {h.DOQty.toLocaleString("id-ID")}</span>
              </span>
              <TrendPill percent={pct} />
              <span className="justify-self-end whitespace-nowrap text-[10px] tabular-nums">
                {isPast && todayPoint ? (
                  <>
                    {compactRupiahFormatter.format(todayPoint.NetSales)}{" "}
                    <span className="text-muted-foreground">&middot; {todayPoint.DOQty.toLocaleString("id-ID")}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Belum terjadi</span>
                )}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Day-level counterpart to the Penjualan module's SalesComparisonPanel (which
// compares whole months) — same "VS Periode" table layout, but rows are
// Kemarin/Pekan Lalu/Bulan Lalu/Tahun Lalu instead of prior months. "Pekan
// Lalu" can be unavailable (previous: null) when H-7 crosses into the
// previous month; that row renders "-" with no trend pill instead of a
// cross-month comparison. Each row expands (click the date) into a full
// 24-hour WIB breakdown compared against today's same hours so far.
export function SalesDayComparisonPanel({
  comparisons,
  todayHourly,
  currentWibHour,
}: {
  comparisons: SalesDayComparison[];
  todayHourly: HourlyPoint[];
  currentWibHour: number;
}) {
  const current = comparisons[0]?.current;
  const [expanded, setExpanded] = useState<string | null>(null);

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
            {comparisons.map((c) => {
              const isOpen = expanded === c.label;
              return (
                <Fragment key={c.label}>
                  <button
                    type="button"
                    onClick={() => c.hourly && setExpanded(isOpen ? null : c.label)}
                    disabled={!c.hourly}
                    className={cn(
                      "flex items-center gap-1 whitespace-nowrap text-left text-xs tabular-nums text-foreground",
                      c.hourly && "hover:text-primary"
                    )}
                  >
                    {c.hourly && (
                      <ChevronRight className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-90")} />
                    )}
                    {formatDayMonth(c.dateISO)} <span className="text-muted-foreground">({c.label})</span>
                  </button>
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
                  {isOpen && c.hourly && (
                    <HourlyComparisonTable
                      periodHourly={c.hourly}
                      todayHourly={todayHourly}
                      currentWibHour={currentWibHour}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
